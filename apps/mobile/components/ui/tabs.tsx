import { createContext, useContext, useState, type ReactNode } from "react";
import { View, Text, Pressable, type ViewProps } from "react-native";
import { cn } from "../../lib/cn";

type TabsContextValue = {
  value: string;
  onValueChange: (value: string) => void;
};

const TabsContext = createContext<TabsContextValue | null>(null);

function useTabsContext() {
  const ctx = useContext(TabsContext);
  if (!ctx) throw new Error("Tabs components must be used within Tabs");
  return ctx;
}

type TabsProps = ViewProps & {
  defaultValue: string;
  value?: string;
  onValueChange?: (value: string) => void;
  children: ReactNode;
};

export function Tabs({
  defaultValue,
  value: controlledValue,
  onValueChange,
  children,
  className,
  ...props
}: TabsProps) {
  const [uncontrolledValue, setUncontrolledValue] = useState(defaultValue);
  const isControlled = controlledValue !== undefined;
  const value = isControlled ? controlledValue : uncontrolledValue;

  const handleValueChange = (newValue: string) => {
    if (!isControlled) setUncontrolledValue(newValue);
    onValueChange?.(newValue);
  };

  return (
    <TabsContext.Provider value={{ value, onValueChange: handleValueChange }}>
      <View className={cn("", className)} {...props}>
        {children}
      </View>
    </TabsContext.Provider>
  );
}

type TabsListProps = ViewProps & {
  children: ReactNode;
};

export function TabsList({ children, className, ...props }: TabsListProps) {
  return (
    <View
      className={cn(
        "flex-row items-center rounded-lg bg-muted p-1",
        className
      )}
      {...props}
    >
      {children}
    </View>
  );
}

type TabsTriggerProps = {
  value: string;
  children: ReactNode;
  className?: string;
};

export function TabsTrigger({ value, children, className }: TabsTriggerProps) {
  const { value: currentValue, onValueChange } = useTabsContext();
  const isActive = currentValue === value;

  return (
    <Pressable
      onPress={() => onValueChange(value)}
      className={cn(
        "flex-1 items-center justify-center rounded-md px-3 py-1.5",
        isActive && "bg-background",
        className
      )}
    >
      <Text
        className={cn(
          "text-sm font-medium",
          isActive ? "text-foreground" : "text-muted-foreground"
        )}
      >
        {children}
      </Text>
    </Pressable>
  );
}

type TabsContentProps = ViewProps & {
  value: string;
  children: ReactNode;
};

export function TabsContent({ value, children, className, ...props }: TabsContentProps) {
  const { value: currentValue } = useTabsContext();
  if (currentValue !== value) return null;

  return (
    <View className={cn("mt-2", className)} {...props}>
      {children}
    </View>
  );
}
