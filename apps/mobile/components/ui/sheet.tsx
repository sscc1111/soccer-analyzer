import { forwardRef, useCallback, useMemo, type ReactNode } from "react";
import { View, Text, Pressable, type ViewProps } from "react-native";
import BottomSheet, {
  BottomSheetBackdrop,
  BottomSheetView,
  type BottomSheetProps,
} from "@gorhom/bottom-sheet";
import { cn } from "../../lib/cn";

type SheetProps = Omit<BottomSheetProps, "children"> & {
  children: ReactNode;
  snapPoints?: (string | number)[];
};

export const Sheet = forwardRef<BottomSheet, SheetProps>(
  ({ children, snapPoints = ["50%", "90%"], ...props }, ref) => {
    const memoizedSnapPoints = useMemo(() => snapPoints, [snapPoints]);

    const renderBackdrop = useCallback(
      (backdropProps: any) => (
        <BottomSheetBackdrop
          {...backdropProps}
          disappearsOnIndex={-1}
          appearsOnIndex={0}
          opacity={0.5}
        />
      ),
      []
    );

    return (
      <BottomSheet
        ref={ref}
        index={-1}
        snapPoints={memoizedSnapPoints}
        enablePanDownToClose
        backdropComponent={renderBackdrop}
        backgroundStyle={{ backgroundColor: "rgb(30, 30, 30)" }}
        handleIndicatorStyle={{ backgroundColor: "rgb(100, 100, 100)" }}
        {...props}
      >
        <BottomSheetView className="flex-1 px-4 pb-8">
          {children}
        </BottomSheetView>
      </BottomSheet>
    );
  }
);

Sheet.displayName = "Sheet";

type SheetHeaderProps = ViewProps & {
  children: ReactNode;
};

export function SheetHeader({ children, className, ...props }: SheetHeaderProps) {
  return (
    <View className={cn("mb-4", className)} {...props}>
      {children}
    </View>
  );
}

type SheetTitleProps = {
  children: ReactNode;
  className?: string;
};

export function SheetTitle({ children, className }: SheetTitleProps) {
  return (
    <Text className={cn("text-lg font-semibold text-foreground", className)}>
      {children}
    </Text>
  );
}

type SheetCloseProps = {
  onPress: () => void;
  children?: ReactNode;
  className?: string;
};

export function SheetClose({ onPress, children, className }: SheetCloseProps) {
  return (
    <Pressable onPress={onPress} className={cn("", className)}>
      {children ?? <Text className="text-primary font-medium">Close</Text>}
    </Pressable>
  );
}
