/**
 * Burnt shim for Expo Go compatibility
 *
 * Burnt requires native modules that are not available in Expo Go.
 * This shim provides fallback implementations.
 */
import { Alert as RNAlert, Platform } from "react-native";
import Constants from "expo-constants";

// Detect if running in Expo Go
const isExpoGo = Constants.appOwnership === "expo";

type ToastOptions = {
  title: string;
  message?: string;
  preset?: "done" | "error" | "none";
  duration?: number;
};

type AlertOptions = {
  title: string;
  message?: string;
  preset?: "done" | "error" | "none";
};

// Fallback implementations
const fallbackToast = (options: ToastOptions) => {
  console.log(`[Toast] ${options.title}${options.message ? `: ${options.message}` : ""}`);
};

const fallbackAlert = (options: AlertOptions) => {
  RNAlert.alert(options.title, options.message);
};

// Export either real burnt or fallbacks
let toastFn = fallbackToast;
let alertFn = fallbackAlert;

if (!isExpoGo) {
  try {
    // Only try to load burnt in development builds
    const burnt = require("burnt");
    toastFn = burnt.toast;
    alertFn = burnt.alert;
  } catch {
    // Fallback to console/Alert
  }
}

export const toast = toastFn;
export const alert = alertFn;
