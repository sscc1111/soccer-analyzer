import { Platform } from "react-native";
import Constants from "expo-constants";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { isExpoGo, warnExpoGo } from "../expo-go-guard";

// Conditional imports for Expo Go compatibility
let Notifications: typeof import("expo-notifications") | null = null;
let Device: typeof import("expo-device") | null = null;

// Only load native modules if not in Expo Go
if (!isExpoGo) {
  try {
    Notifications = require("expo-notifications");
    Device = require("expo-device");
  } catch {
    // Module loading failed
  }
}

const PUSH_TOKEN_KEY = "@soccer/push_token";
const NOTIFICATION_SETTINGS_KEY = "@soccer/notification_settings";

export type NotificationSettings = {
  /** Whether push notifications are enabled */
  enabled: boolean;
  /** Notify when analysis completes */
  onAnalysisComplete: boolean;
  /** Notify when analysis fails */
  onAnalysisError: boolean;
  /** Notify when review is needed */
  onReviewNeeded: boolean;
};

export const DEFAULT_NOTIFICATION_SETTINGS: NotificationSettings = {
  enabled: true,
  onAnalysisComplete: true,
  onAnalysisError: true,
  onReviewNeeded: true,
};

/**
 * Configure notification handlers
 * Call this at app startup
 */
export function configureNotifications() {
  if (isExpoGo || !Notifications) {
    warnExpoGo("Push notifications");
    return;
  }

  // Configure how notifications are handled when app is in foreground
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldPlaySound: true,
      shouldSetBadge: true,
      shouldShowBanner: true,
      shouldShowList: true,
    }),
  });
}

/**
 * Request notification permissions and get push token
 * @returns Push token or null if failed
 */
export async function registerForPushNotifications(): Promise<string | null> {
  if (isExpoGo || !Notifications || !Device) {
    warnExpoGo("Push notifications");
    return null;
  }

  // Check if physical device
  if (!Device.isDevice) {
    console.warn("Push notifications require a physical device");
    return null;
  }

  // Check existing permissions
  const { status: existingStatus } = await Notifications.getPermissionsAsync();
  let finalStatus = existingStatus;

  // Request permissions if not granted
  if (existingStatus !== "granted") {
    const { status } = await Notifications.requestPermissionsAsync();
    finalStatus = status;
  }

  if (finalStatus !== "granted") {
    console.warn("Push notification permission denied");
    return null;
  }

  // Get push token
  try {
    const projectId = Constants.expoConfig?.extra?.eas?.projectId;
    const token = await Notifications.getExpoPushTokenAsync({
      projectId,
    });

    // Store token for later use
    await AsyncStorage.setItem(PUSH_TOKEN_KEY, token.data);

    // Configure Android notification channel
    if (Platform.OS === "android") {
      await setupAndroidChannels();
    }

    return token.data;
  } catch (error) {
    console.error("Failed to get push token:", error);
    return null;
  }
}

/**
 * Setup Android notification channels
 */
async function setupAndroidChannels() {
  if (!Notifications) return;

  await Notifications.setNotificationChannelAsync("analysis", {
    name: "分析通知",
    description: "試合分析の完了・エラー通知",
    importance: Notifications.AndroidImportance.HIGH,
    vibrationPattern: [0, 250, 250, 250],
    lightColor: "#6366F1",
    sound: "default",
  });

  await Notifications.setNotificationChannelAsync("review", {
    name: "レビュー通知",
    description: "イベント確認が必要な時の通知",
    importance: Notifications.AndroidImportance.DEFAULT,
    sound: "default",
  });
}

/**
 * Get stored push token
 */
export async function getStoredPushToken(): Promise<string | null> {
  return AsyncStorage.getItem(PUSH_TOKEN_KEY);
}

/**
 * Get notification settings
 */
export async function getNotificationSettings(): Promise<NotificationSettings> {
  try {
    const stored = await AsyncStorage.getItem(NOTIFICATION_SETTINGS_KEY);
    if (stored) {
      return { ...DEFAULT_NOTIFICATION_SETTINGS, ...JSON.parse(stored) };
    }
  } catch {
    // Ignore parse errors
  }
  return DEFAULT_NOTIFICATION_SETTINGS;
}

/**
 * Save notification settings
 */
export async function saveNotificationSettings(
  settings: NotificationSettings
): Promise<void> {
  await AsyncStorage.setItem(NOTIFICATION_SETTINGS_KEY, JSON.stringify(settings));
}

/**
 * Schedule a local notification (for testing or immediate alerts)
 */
export async function scheduleLocalNotification(params: {
  title: string;
  body: string;
  data?: Record<string, unknown>;
  channelId?: string;
}): Promise<string> {
  if (isExpoGo || !Notifications) {
    warnExpoGo("Local notifications");
    return "";
  }

  return Notifications.scheduleNotificationAsync({
    content: {
      title: params.title,
      body: params.body,
      data: params.data,
      sound: "default",
    },
    trigger: null, // Immediate
  });
}

/**
 * Cancel all scheduled notifications
 */
export async function cancelAllNotifications(): Promise<void> {
  if (isExpoGo || !Notifications) return;
  await Notifications.cancelAllScheduledNotificationsAsync();
}

/**
 * Get badge count
 */
export async function getBadgeCount(): Promise<number> {
  if (isExpoGo || !Notifications) return 0;
  return Notifications.getBadgeCountAsync();
}

/**
 * Set badge count
 */
export async function setBadgeCount(count: number): Promise<void> {
  if (isExpoGo || !Notifications) return;
  await Notifications.setBadgeCountAsync(count);
}

/**
 * Clear badge
 */
export async function clearBadge(): Promise<void> {
  await setBadgeCount(0);
}

/**
 * Notification payload types for type-safe handling
 */
export type AnalysisCompletePayload = {
  type: "analysis_complete";
  matchId: string;
  matchTitle: string;
};

export type AnalysisErrorPayload = {
  type: "analysis_error";
  matchId: string;
  matchTitle: string;
  error: string;
};

export type ReviewNeededPayload = {
  type: "review_needed";
  matchId: string;
  matchTitle: string;
  reviewCount: number;
};

export type NotificationPayload =
  | AnalysisCompletePayload
  | AnalysisErrorPayload
  | ReviewNeededPayload;

/**
 * Type guard for notification payloads
 */
export function isNotificationPayload(
  data: unknown
): data is NotificationPayload {
  if (!data || typeof data !== "object") return false;
  const d = data as Record<string, unknown>;
  return (
    d.type === "analysis_complete" ||
    d.type === "analysis_error" ||
    d.type === "review_needed"
  );
}
