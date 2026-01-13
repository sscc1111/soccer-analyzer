/**
 * Expo Go compatibility utilities
 *
 * Expo Go has limited support for native modules. This utility helps
 * detect when running in Expo Go and provides fallback implementations.
 */
import Constants from "expo-constants";

/**
 * Check if the app is running in Expo Go
 */
export const isExpoGo = Constants.appOwnership === "expo";

/**
 * Log a warning when a feature is not available in Expo Go
 */
export function warnExpoGo(feature: string): void {
  if (isExpoGo) {
    console.warn(
      `[Expo Go] ${feature} is not available in Expo Go. Use a development build for full functionality.`
    );
  }
}
