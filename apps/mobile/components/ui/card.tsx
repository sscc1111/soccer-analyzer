import { View, Text } from "react-native";
import { cn } from "../../lib/cn";

export function Card({ className, ...props }: any) {
  return <View className={cn("rounded-xl border border-border bg-muted p-4", className)} {...props} />;
}

export function CardHeader({ className, ...props }: any) {
  return <View className={cn("mb-3", className)} {...props} />;
}

export function CardTitle({ className, children, ...props }: any) {
  return (
    <Text className={cn("text-lg font-semibold text-foreground", className)} {...props}>
      {children}
    </Text>
  );
}

export function CardContent({ className, ...props }: any) {
  return <View className={cn("", className)} {...props} />;
}
