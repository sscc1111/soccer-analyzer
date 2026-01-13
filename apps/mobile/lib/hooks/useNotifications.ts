import { useState, useEffect, useCallback, useRef } from "react";
import { router } from "expo-router";
import { isExpoGo } from "../expo-go-guard";
import {
  configureNotifications,
  registerForPushNotifications,
  getNotificationSettings,
  saveNotificationSettings,
  clearBadge,
  isNotificationPayload,
  type NotificationSettings,
  type NotificationPayload,
  DEFAULT_NOTIFICATION_SETTINGS,
} from "../notifications";

// Conditional import for expo-notifications
let Notifications: typeof import("expo-notifications") | null = null;
if (!isExpoGo) {
  try {
    Notifications = require("expo-notifications");
  } catch {
    // Module loading failed
  }
}

export type { NotificationSettings } from "../notifications";

type UseNotificationsReturn = {
  /** Push token (null if not registered) */
  pushToken: string | null;
  /** Whether notifications are enabled */
  isEnabled: boolean;
  /** Notification settings */
  settings: NotificationSettings;
  /** Whether currently registering */
  isRegistering: boolean;
  /** Register for push notifications */
  register: () => Promise<string | null>;
  /** Update notification settings */
  updateSettings: (updates: Partial<NotificationSettings>) => Promise<void>;
  /** Last received notification */
  lastNotification: unknown | null;
};

/**
 * Hook for managing push notifications
 *
 * @example
 * ```tsx
 * const { isEnabled, settings, register, updateSettings } = useNotifications();
 *
 * // Register for notifications
 * useEffect(() => {
 *   register();
 * }, [register]);
 *
 * // Update settings
 * await updateSettings({ onAnalysisComplete: false });
 * ```
 */
export function useNotifications(): UseNotificationsReturn {
  const [pushToken, setPushToken] = useState<string | null>(null);
  const [settings, setSettings] = useState<NotificationSettings>(
    DEFAULT_NOTIFICATION_SETTINGS
  );
  const [isRegistering, setIsRegistering] = useState(false);
  const [lastNotification, setLastNotification] = useState<unknown | null>(null);

  const notificationListener = useRef<{ remove: () => void } | undefined>();
  const responseListener = useRef<{ remove: () => void } | undefined>();

  // Configure notifications on mount (only if not Expo Go)
  useEffect(() => {
    if (!isExpoGo) {
      configureNotifications();
    }
  }, []);

  // Load settings on mount
  useEffect(() => {
    getNotificationSettings().then(setSettings);
  }, []);

  // Setup notification listeners (only if not Expo Go)
  useEffect(() => {
    if (isExpoGo || !Notifications) return;

    // Listen for notifications received while app is foregrounded
    notificationListener.current =
      Notifications.addNotificationReceivedListener((notification) => {
        setLastNotification(notification);
      });

    // Listen for user interactions with notifications
    responseListener.current =
      Notifications.addNotificationResponseReceivedListener((response) => {
        const data = response.notification.request.content.data;
        handleNotificationTap(data);
      });

    return () => {
      notificationListener.current?.remove();
      responseListener.current?.remove();
    };
  }, []);

  /**
   * Handle notification tap - navigate to relevant screen
   */
  const handleNotificationTap = useCallback((data: unknown) => {
    if (!isNotificationPayload(data)) return;

    // Clear badge when user taps notification
    clearBadge();

    const payload = data as NotificationPayload;

    switch (payload.type) {
      case "analysis_complete":
        router.push(`/match/${payload.matchId}`);
        break;
      case "analysis_error":
        router.push(`/match/${payload.matchId}`);
        break;
      case "review_needed":
        router.push(`/match/${payload.matchId}/review`);
        break;
    }
  }, []);

  /**
   * Register for push notifications
   */
  const register = useCallback(async () => {
    if (isRegistering) return null;

    setIsRegistering(true);
    try {
      const token = await registerForPushNotifications();
      setPushToken(token);
      return token;
    } finally {
      setIsRegistering(false);
    }
  }, [isRegistering]);

  /**
   * Update notification settings
   */
  const updateSettings = useCallback(
    async (updates: Partial<NotificationSettings>) => {
      const newSettings = { ...settings, ...updates };
      setSettings(newSettings);
      await saveNotificationSettings(newSettings);
    },
    [settings]
  );

  return {
    pushToken,
    isEnabled: settings.enabled,
    settings,
    isRegistering,
    register,
    updateSettings,
    lastNotification,
  };
}

/**
 * Hook to check if notifications are available
 * (Physical device + permissions granted)
 */
export function useNotificationStatus() {
  const [status, setStatus] = useState<{
    isAvailable: boolean;
    isGranted: boolean;
    isChecking: boolean;
  }>({
    isAvailable: false,
    isGranted: false,
    isChecking: true,
  });

  useEffect(() => {
    const checkStatus = async () => {
      // Not available in Expo Go
      if (isExpoGo || !Notifications) {
        setStatus({
          isAvailable: false,
          isGranted: false,
          isChecking: false,
        });
        return;
      }

      try {
        const { status: permissionStatus } =
          await Notifications.getPermissionsAsync();

        setStatus({
          isAvailable: true,
          isGranted: permissionStatus === "granted",
          isChecking: false,
        });
      } catch {
        setStatus({
          isAvailable: false,
          isGranted: false,
          isChecking: false,
        });
      }
    };

    checkStatus();
  }, []);

  return status;
}
