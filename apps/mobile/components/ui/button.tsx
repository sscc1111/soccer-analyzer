import { Pressable, Text, type PressableProps } from "react-native";
import { cn } from "../../lib/cn";

type Props = PressableProps & {
  variant?: "default" | "outline";
  className?: string;
  textClassName?: string;
};

export function Button({
  variant = "default",
  className,
  textClassName,
  children,
  ...props
}: Props) {
  return (
    <Pressable
      {...props}
      className={cn(
        "h-10 items-center justify-center rounded-md px-4",
        variant === "default" && "bg-primary",
        variant === "outline" && "border border-border bg-transparent",
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
