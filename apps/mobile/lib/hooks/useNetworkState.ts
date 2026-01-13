import { useState, useEffect, useCallback } from "react";
import { isExpoGo } from "../expo-go-guard";

// Conditional import for NetInfo
let NetInfo: typeof import("@react-native-community/netinfo").default | null = null;
let NetInfoStateType: typeof import("@react-native-community/netinfo").NetInfoStateType | null = null;

if (!isExpoGo) {
  try {
    const netInfoModule = require("@react-native-community/netinfo");
    NetInfo = netInfoModule.default;
    NetInfoStateType = netInfoModule.NetInfoStateType;
  } catch {
    // Module loading failed
  }
}

// Fallback type for when NetInfo is not available
type ConnectionType = "unknown" | "none" | "wifi" | "cellular" | "bluetooth" | "ethernet" | "wimax" | "vpn" | "other";

export type NetworkStatus = {
  /** Whether the device is connected to the internet */
  isConnected: boolean;
  /** Whether the connection is a cellular connection */
  isCellular: boolean;
  /** Whether the connection is a WiFi connection */
  isWifi: boolean;
  /** Connection type (wifi, cellular, none, unknown) */
  type: ConnectionType;
  /** Whether currently checking connection status */
  isChecking: boolean;
};

/**
 * Hook to monitor network connectivity state
 *
 * @returns Network status and utility functions
 *
 * @example
 * ```tsx
 * const { isConnected, isWifi, checkConnection } = useNetworkState();
 *
 * if (!isConnected) {
 *   return <OfflineBanner />;
 * }
 * ```
 */
export function useNetworkState() {
  const [status, setStatus] = useState<NetworkStatus>({
    isConnected: true, // Assume connected by default
    isCellular: false,
    isWifi: false,
    type: "unknown",
    isChecking: !isExpoGo && !!NetInfo, // Only checking if NetInfo is available
  });

  const updateStatus = useCallback((state: { isConnected: boolean | null; type: string }) => {
    const type = state.type as ConnectionType;
    setStatus({
      isConnected: state.isConnected ?? true,
      isCellular: type === "cellular",
      isWifi: type === "wifi",
      type,
      isChecking: false,
    });
  }, []);

  useEffect(() => {
    // Skip NetInfo in Expo Go - assume always connected
    if (isExpoGo || !NetInfo) {
      setStatus({
        isConnected: true,
        isCellular: false,
        isWifi: true,
        type: "wifi",
        isChecking: false,
      });
      return;
    }

    // Get initial state
    NetInfo.fetch().then(updateStatus).catch(() => {
      // On error, assume connected
      setStatus(prev => ({ ...prev, isChecking: false }));
    });

    // Subscribe to network state changes
    const unsubscribe = NetInfo.addEventListener(updateStatus);

    return () => {
      unsubscribe();
    };
  }, [updateStatus]);

  /**
   * Manually check connection status
   */
  const checkConnection = useCallback(async () => {
    // In Expo Go, always return true
    if (isExpoGo || !NetInfo) {
      return true;
    }

    setStatus((prev) => ({ ...prev, isChecking: true }));
    try {
      const state = await NetInfo.fetch();
      updateStatus(state);
      return state.isConnected ?? true;
    } catch {
      setStatus((prev) => ({ ...prev, isChecking: false }));
      return true; // Assume connected on error
    }
  }, [updateStatus]);

  return {
    ...status,
    checkConnection,
  };
}

/**
 * Simple hook that just returns whether the device is online
 */
export function useIsOnline(): boolean {
  const { isConnected } = useNetworkState();
  return isConnected;
}
