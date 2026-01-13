import { Alert } from "react-native";
import { isExpoGo } from "../../lib/expo-go-guard";

// Conditional import for burnt (not available in Expo Go)
let burntAlert: ((options: { title: string; message?: string; preset?: string }) => void) | null = null;
let burntToast: ((options: { title: string; message?: string; preset?: string; duration?: number }) => void) | null = null;

if (!isExpoGo) {
  try {
    const burnt = require("burnt");
    burntAlert = burnt.alert;
    burntToast = burnt.toast;
  } catch {
    // Module loading failed
  }
}

export type ToastVariant = "success" | "error" | "warning" | "info";

type ToastOptions = {
  title: string;
  message?: string;
  variant?: ToastVariant;
  duration?: number;
};

const presetMap: Record<ToastVariant, "done" | "error" | "none"> = {
  success: "done",
  error: "error",
  warning: "none",
  info: "none",
};

export function toast({ title, message, variant = "info", duration = 3 }: ToastOptions) {
  if (burntToast) {
    burntToast({
      title,
      message,
      preset: presetMap[variant],
      duration,
    });
  } else {
    // Fallback for Expo Go: use console.log (Alert is too intrusive for toasts)
    console.log(`[Toast] ${title}${message ? `: ${message}` : ""}`);
  }
}

export function alert({
  title,
  message,
  variant = "info",
}: Omit<ToastOptions, "duration">) {
  if (burntAlert) {
    burntAlert({
      title,
      message,
      preset: presetMap[variant],
    });
  } else {
    // Fallback for Expo Go: use React Native Alert
    Alert.alert(title, message);
  }
}
