export const colors = {
  background: "rgb(10, 10, 10)",
  foreground: "rgb(245, 245, 245)",
  border: "rgb(45, 45, 45)",
  muted: "rgb(30, 30, 30)",
  mutedForeground: "rgb(170, 170, 170)",
  primary: "rgb(99, 102, 241)",
  primaryForeground: "rgb(255, 255, 255)",
  destructive: "rgb(239, 68, 68)",
  destructiveForeground: "rgb(255, 255, 255)",
  success: "rgb(34, 197, 94)",
  successForeground: "rgb(255, 255, 255)",
  warning: "rgb(234, 179, 8)",
  warningForeground: "rgb(0, 0, 0)",
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
} as const;

export const radius = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  full: 9999,
} as const;
