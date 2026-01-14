import { useState, useCallback } from "react";
import {
  View,
  Text,
  FlatList,
  Pressable,
  ActivityIndicator,
  Image,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Card, CardContent, Badge } from "../../../components/ui";
import { useClips, useMatch } from "../../../lib/hooks";
import type { ClipDoc, EventLabel } from "@soccer/shared";

const FILTER_LABELS: (EventLabel | "all")[] = [
  "all",
  "shot",
  "chance",
  "setPiece",
  "dribble",
  "defense",
  "other",
];

function getConfidenceVariant(confidence: number) {
  if (confidence >= 0.8) return "success";
  if (confidence >= 0.5) return "warning";
  return "destructive";
}

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function ClipCard({
  clip,
  matchId,
}: {
  clip: ClipDoc;
  matchId: string;
}) {
  const label = clip.gemini?.label ?? "unknown";
  const confidence = clip.gemini?.confidence ?? 0;
  const title = clip.gemini?.title ?? `Clip ${formatTime(clip.t0)}`;

  return (
    <Pressable
      onPress={() => router.push(`/match/${matchId}/clip/${clip.clipId}`)}
      className="mb-3"
    >
      <Card>
        <CardContent className="p-0">
          <View className="flex-row">
            {/* Thumbnail */}
            <View className="w-28 h-20 bg-muted rounded-l-xl overflow-hidden">
              {clip.media.thumbPath ? (
                <Image
                  source={{ uri: clip.media.thumbPath }}
                  className="w-full h-full"
                  resizeMode="cover"
                />
              ) : (
                <View className="w-full h-full items-center justify-center">
                  <Text className="text-muted-foreground text-xs">No thumb</Text>
                </View>
              )}
              {/* Time overlay */}
              <View className="absolute bottom-1 left-1 bg-black/70 px-1 rounded">
                <Text className="text-white text-xs">
                  {formatTime(clip.t0)} - {formatTime(clip.t1)}
                </Text>
              </View>
            </View>

            {/* Info */}
            <View className="flex-1 p-3">
              <View className="flex-row items-center gap-2 mb-1">
                <Badge variant="secondary">{label}</Badge>
                <Badge variant={getConfidenceVariant(confidence)}>
                  {Math.round(confidence * 100)}%
                </Badge>
              </View>
              <Text className="text-foreground font-medium" numberOfLines={1}>
                {title}
              </Text>
              {clip.gemini?.summary && (
                <Text
                  className="text-muted-foreground text-xs mt-1"
                  numberOfLines={2}
                >
                  {clip.gemini.summary}
                </Text>
              )}
            </View>
          </View>
        </CardContent>
      </Card>
    </Pressable>
  );
}

export default function ClipsListScreen() {
  const { id, filter: initialFilter } = useLocalSearchParams<{
    id: string;
    filter?: string;
  }>();
  const [filter, setFilter] = useState<EventLabel | "all">(
    (initialFilter as EventLabel) || "all"
  );

  // Get match to access activeVersion
  const { match } = useMatch(id);
  const activeVersion = match?.analysis?.activeVersion;

  const { clips, loading, error } = useClips(id, {
    label: filter === "all" ? undefined : filter,
    version: activeVersion,
  });

  const renderItem = useCallback(
    ({ item }: { item: ClipDoc }) => <ClipCard clip={item} matchId={id} />,
    [id]
  );

  return (
    <View className="flex-1 bg-background">
      {/* Filter Tabs */}
      <View className="px-4 pt-4">
        <FlatList
          horizontal
          showsHorizontalScrollIndicator={false}
          data={FILTER_LABELS}
          keyExtractor={(item) => item}
          renderItem={({ item }) => (
            <Pressable
              onPress={() => setFilter(item)}
              className={`mr-2 px-4 py-2 rounded-full ${
                filter === item ? "bg-primary" : "bg-muted"
              }`}
            >
              <Text
                className={`text-sm font-medium capitalize ${
                  filter === item ? "text-primary-foreground" : "text-foreground"
                }`}
              >
                {item}
              </Text>
            </Pressable>
          )}
        />
      </View>

      {/* Clips List */}
      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="rgb(99, 102, 241)" />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center p-4">
          <Text className="text-destructive text-center">{error.message}</Text>
        </View>
      ) : clips.length === 0 ? (
        <View className="flex-1 items-center justify-center p-4">
          <Text className="text-muted-foreground text-lg mb-2">No clips found</Text>
          <Text className="text-muted-foreground text-sm text-center">
            {filter === "all"
              ? "Analysis may still be in progress."
              : `No ${filter} clips detected.`}
          </Text>
        </View>
      ) : (
        <FlatList
          data={clips}
          keyExtractor={(item) => item.clipId}
          renderItem={renderItem}
          contentContainerStyle={{ padding: 16 }}
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={5}
        />
      )}
    </View>
  );
}
