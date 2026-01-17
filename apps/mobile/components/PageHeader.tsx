import { View, Text, Pressable } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router } from "expo-router";

interface PageHeaderProps {
  /** Page title */
  title: string;
  /** Optional subtitle shown below the title */
  subtitle?: string;
  /** Optional element rendered on the right side (button, badge, etc.) */
  rightElement?: React.ReactNode;
  /** Show back button (defaults to false) */
  showBackButton?: boolean;
  /** Custom back button action (defaults to router.back()) */
  onBackPress?: () => void;
  /** Apply safe area insets for pages outside tab navigation (defaults to same as showBackButton) */
  useSafeArea?: boolean;
}

export function PageHeader({
  title,
  subtitle,
  rightElement,
  showBackButton = false,
  onBackPress,
  useSafeArea,
}: PageHeaderProps) {
  const insets = useSafeAreaInsets();
  // Default: apply safe area if showing back button (indicates non-tab page)
  const shouldApplySafeArea = useSafeArea ?? showBackButton;

  const handleBack = () => {
    if (onBackPress) {
      onBackPress();
    } else {
      router.back();
    }
  };

  return (
    <View
      className="px-4 pb-4 border-b border-border"
      style={{ paddingTop: shouldApplySafeArea ? insets.top + 16 : 16 }}
    >
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          {showBackButton && (
            <Pressable
              onPress={handleBack}
              className="mr-3 p-1"
              hitSlop={{ top: 10, bottom: 10, left: 10, right: 10 }}
              accessibilityLabel="Go back"
              accessibilityRole="button"
            >
              <Text className="text-primary text-lg">←</Text>
            </Pressable>
          )}
          <View className="flex-1">
            <Text className="text-2xl font-semibold text-foreground">
              {title}
            </Text>
            {subtitle && (
              <Text className="text-muted-foreground text-sm mt-0.5">
                {subtitle}
              </Text>
            )}
          </View>
        </View>
        {rightElement && <View className="ml-3">{rightElement}</View>}
      </View>
    </View>
  );
}
