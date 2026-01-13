import { View, Text, Pressable } from "react-native";
import { useNetworkState } from "../lib/hooks";

type Props = {
  /** Custom message to display when offline */
  message?: string;
  /** Whether to show retry button */
  showRetry?: boolean;
  /** Callback when retry is pressed */
  onRetry?: () => void;
};

/**
 * Banner component displayed when device is offline
 *
 * @example
 * ```tsx
 * // In your layout or screen
 * <OfflineBanner />
 * ```
 */
export function OfflineBanner({
  message = "オフラインです。接続を確認してください。",
  showRetry = true,
  onRetry,
}: Props) {
  const { isConnected, isChecking, checkConnection } = useNetworkState();

  // Don't show if connected or still checking
  if (isConnected || isChecking) {
    return null;
  }

  const handleRetry = async () => {
    const connected = await checkConnection();
    if (connected && onRetry) {
      onRetry();
    }
  };

  return (
    <View className="bg-destructive/90 px-4 py-3">
      <View className="flex-row items-center justify-between">
        <View className="flex-row items-center flex-1">
          <View className="w-2 h-2 rounded-full bg-white mr-2" />
          <Text className="text-white text-sm flex-1">{message}</Text>
        </View>
        {showRetry && (
          <Pressable
            onPress={handleRetry}
            className="ml-2 px-3 py-1 bg-white/20 rounded"
          >
            <Text className="text-white text-sm font-medium">再試行</Text>
          </Pressable>
        )}
      </View>
    </View>
  );
}

/**
 * Hook to conditionally render content based on network status
 *
 * @example
 * ```tsx
 * const { isOffline, OfflineView } = useOfflineState();
 *
 * if (isOffline) {
 *   return <OfflineView message="データを取得できません" />;
 * }
 * ```
 */
export function useOfflineState() {
  const { isConnected, checkConnection } = useNetworkState();

  const OfflineView = ({
    message,
    onRetry,
  }: {
    message?: string;
    onRetry?: () => void;
  }) => (
    <View className="flex-1 bg-background items-center justify-center p-4">
      <View className="w-16 h-16 rounded-full bg-muted items-center justify-center mb-4">
        <Text className="text-2xl">📶</Text>
      </View>
      <Text className="text-foreground text-lg font-medium mb-2">
        オフライン
      </Text>
      <Text className="text-muted-foreground text-center mb-4">
        {message || "インターネット接続を確認してください"}
      </Text>
      <Pressable
        onPress={async () => {
          const connected = await checkConnection();
          if (connected && onRetry) {
            onRetry();
          }
        }}
        className="px-6 py-3 bg-primary rounded-lg"
      >
        <Text className="text-primary-foreground font-medium">再試行</Text>
      </Pressable>
    </View>
  );

  return {
    isOffline: !isConnected,
    isOnline: isConnected,
    OfflineView,
    checkConnection,
  };
}
