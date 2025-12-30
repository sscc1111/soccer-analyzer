import { View, Text, type ViewProps } from "react-native";
import { cn } from "../../lib/cn";

type BadgeVariant = "default" | "secondary" | "destructive" | "success" | "warning" | "outline";

type Props = ViewProps & {
  variant?: BadgeVariant;
  children: React.ReactNode;
};

const variantStyles: Record<BadgeVariant, { container: string; text: string }> = {
  default: {
    container: "bg-primary",
    text: "text-primary-foreground",
  },
  secondary: {
    container: "bg-muted",
    text: "text-foreground",
  },
  destructive: {
    container: "bg-destructive",
    text: "text-white",
  },
  success: {
    container: "bg-success",
    text: "text-white",
  },
  warning: {
    container: "bg-warning",
    text: "text-black",
  },
  outline: {
    container: "border border-border bg-transparent",
    text: "text-foreground",
  },
};

export function Badge({ variant = "default", className, children, ...props }: Props) {
  const styles = variantStyles[variant];
  return (
    <View
      className={cn("rounded-full px-2.5 py-0.5 self-start", styles.container, className)}
      {...props}
    >
      <Text className={cn("text-xs font-medium", styles.text)}>
        {children}
      </Text>
    </View>
  );
}
