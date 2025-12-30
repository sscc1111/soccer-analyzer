import { Modal, View, Text, Pressable, type ModalProps } from "react-native";
import { cn } from "../../lib/cn";

type DialogProps = Omit<ModalProps, "children"> & {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: React.ReactNode;
};

export function Dialog({ open, onOpenChange, children, ...props }: DialogProps) {
  return (
    <Modal
      visible={open}
      transparent
      animationType="fade"
      onRequestClose={() => onOpenChange(false)}
      {...props}
    >
      <Pressable
        className="flex-1 items-center justify-center bg-black/60"
        onPress={() => onOpenChange(false)}
      >
        <Pressable onPress={(e) => e.stopPropagation()}>
          <View className="mx-4 w-80 max-w-full rounded-xl bg-muted p-6">
            {children}
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

type DialogHeaderProps = {
  children: React.ReactNode;
  className?: string;
};

export function DialogHeader({ children, className }: DialogHeaderProps) {
  return <View className={cn("mb-4", className)}>{children}</View>;
}

type DialogTitleProps = {
  children: React.ReactNode;
  className?: string;
};

export function DialogTitle({ children, className }: DialogTitleProps) {
  return (
    <Text className={cn("text-lg font-semibold text-foreground", className)}>
      {children}
    </Text>
  );
}

type DialogDescriptionProps = {
  children: React.ReactNode;
  className?: string;
};

export function DialogDescription({ children, className }: DialogDescriptionProps) {
  return (
    <Text className={cn("text-sm text-muted-foreground mt-1", className)}>
      {children}
    </Text>
  );
}

type DialogContentProps = {
  children: React.ReactNode;
  className?: string;
};

export function DialogContent({ children, className }: DialogContentProps) {
  return <View className={cn("", className)}>{children}</View>;
}

type DialogFooterProps = {
  children: React.ReactNode;
  className?: string;
};

export function DialogFooter({ children, className }: DialogFooterProps) {
  return (
    <View className={cn("mt-6 flex-row justify-end gap-2", className)}>
      {children}
    </View>
  );
}
