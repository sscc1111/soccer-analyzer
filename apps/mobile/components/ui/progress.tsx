import { View, type ViewProps } from "react-native";
import { cn } from "../../lib/cn";

type Props = ViewProps & {
  value?: number; // 0-100
  max?: number;
};

export function Progress({ value = 0, max = 100, className, ...props }: Props) {
  const percentage = Math.min(100, Math.max(0, (value / max) * 100));

  return (
    <View
      className={cn("h-2 w-full overflow-hidden rounded-full bg-muted", className)}
      {...props}
    >
      <View
        className="h-full bg-primary rounded-full"
        style={{ width: `${percentage}%` }}
      />
    </View>
  );
}
