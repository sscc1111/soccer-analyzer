import { Pressable, Text, type PressableProps } from "react-native";
import { cn } from "../../lib/cn";

type Props = PressableProps & {
  variant?: "default" | "outline";
  className?: string;
  textClassName?: string;
  disabled?: boolean;
};

export function Button({
  variant = "default",
  className,
  textClassName,
  children,
  disabled,
  ...props
}: Props) {
  return (
    <Pressable
      {...props}
      disabled={disabled}
      className={cn(
        "h-10 items-center justify-center rounded-md px-4",
        variant === "default" && "bg-primary",
        variant === "outline" && "border border-border bg-transparent",
        disabled && "opacity-50",
        className
      )}
    >
      <Text
        className={cn(
          "font-medium",
          variant === "default" ? "text-primary-foreground" : "text-foreground",
          textClassName
        )}
      >
        {children as any}
      </Text>
    </Pressable>
  );
}
