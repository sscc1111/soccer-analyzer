import { alert as burntAlert, toast as burntToast } from "burnt";

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
  burntToast({
    title,
    message,
    preset: presetMap[variant],
    duration,
  });
}

export function alert({
  title,
  message,
  variant = "info",
}: Omit<ToastOptions, "duration">) {
  burntAlert({
    title,
    message,
    preset: presetMap[variant],
  });
}
