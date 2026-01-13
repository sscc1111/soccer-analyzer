import { View, Text, ScrollView, Pressable } from "react-native";
import { useUploadQueue } from "../lib/hooks";
import { Card, CardContent, Badge, Button } from "./ui";

/**
 * Component to display upload queue status
 *
 * Shows all queued uploads with their status, and allows:
 * - Canceling pending/failed uploads
 * - Retrying failed uploads
 * - Manual queue processing
 *
 * @example
 * ```tsx
 * <UploadQueueStatus />
 * ```
 */
export function UploadQueueStatus() {
  const { queue, isProcessing, cancelUpload, retryUpload, processQueue } = useUploadQueue();

  if (queue.length === 0) {
    return null;
  }

  return (
    <Card className="mb-4">
      <CardContent className="pt-4">
        <View className="flex-row items-center justify-between mb-3">
          <Text className="text-foreground font-semibold">Upload Queue</Text>
          {isProcessing && (
            <Badge variant="secondary">Processing...</Badge>
          )}
        </View>

        <ScrollView className="max-h-60">
          {queue.map((item) => (
            <View
              key={item.id}
              className="p-3 bg-muted rounded-lg mb-2"
            >
              <View className="flex-row items-center justify-between mb-1">
                <Text className="text-foreground font-medium" numberOfLines={1}>
                  Match: {item.matchId}
                </Text>
                <Badge
                  variant={
                    item.status === "completed"
                      ? "default"
                      : item.status === "failed"
                      ? "destructive"
                      : item.status === "uploading"
                      ? "secondary"
                      : "outline"
                  }
                >
                  {item.status}
                </Badge>
              </View>

              <Text className="text-muted-foreground text-xs mb-2">
                Mode: {item.processingMode}
                {item.retryCount > 0 && ` • Retries: ${item.retryCount}`}
              </Text>

              {item.error && (
                <Text className="text-destructive text-xs mb-2">
                  Error: {item.error}
                </Text>
              )}

              <View className="flex-row gap-2">
                {item.status === "failed" && item.retryCount < 3 && (
                  <Pressable
                    onPress={() => retryUpload(item.id)}
                    className="bg-primary px-3 py-1.5 rounded"
                  >
                    <Text className="text-primary-foreground text-xs">Retry</Text>
                  </Pressable>
                )}

                {(item.status === "pending" || item.status === "failed") && (
                  <Pressable
                    onPress={() => cancelUpload(item.id)}
                    className="bg-destructive/10 px-3 py-1.5 rounded"
                  >
                    <Text className="text-destructive text-xs">Cancel</Text>
                  </Pressable>
                )}
              </View>
            </View>
          ))}
        </ScrollView>

        {!isProcessing && queue.some((item) => item.status === "pending") && (
          <Button
            variant="outline"
            onPress={processQueue}
            className="mt-2"
          >
            Process Queue Now
          </Button>
        )}
      </CardContent>
    </Card>
  );
}
