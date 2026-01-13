import { View, ScrollView as RNScrollView, ScrollViewProps } from "react-native";
import { forwardRef } from "react";

type StyledScrollViewProps = ScrollViewProps & {
  className?: string;
  contentClassName?: string;
};

/**
 * ScrollView wrapper that fixes NativeWind className issues with Expo Go new architecture.
 * The className is applied to a wrapper View, while contentClassName is applied to content.
 */
export const StyledScrollView = forwardRef<RNScrollView, StyledScrollViewProps>(
  ({ className, contentClassName, children, style, ...props }, ref) => {
    // If className contains flex-1 or other layout classes, apply to wrapper View
    if (className) {
      return (
        <View className={className} style={style}>
          <RNScrollView ref={ref} {...props}>
            {contentClassName ? (
              <View className={contentClassName}>{children}</View>
            ) : (
              children
            )}
          </RNScrollView>
        </View>
      );
    }

    // No className - use ScrollView directly
    return (
      <RNScrollView ref={ref} style={style} {...props}>
        {contentClassName ? (
          <View className={contentClassName}>{children}</View>
        ) : (
          children
        )}
      </RNScrollView>
    );
  }
);

StyledScrollView.displayName = "StyledScrollView";
