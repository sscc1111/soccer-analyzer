import { View, Text, FlatList, Pressable, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { Button, Card, CardHeader, CardTitle, CardContent, Badge } from "../../components/ui";
import { useMatches } from "../../lib/hooks";
import type { MatchDoc } from "@soccer/shared";

function getAnalysisStatusColor(status?: string) {
  switch (status) {
    case "done":
      return "success";
    case "running":
    case "queued":
    // P1修正: 分割アップロード対応の新ステータス
    case "partial":           // 片方の動画のみ解析完了
      return "warning";
    case "error":
      return "destructive";
    default:
      return "secondary";
  }
}

type VideoStatusInfo = {
  label: string;
  variant: "secondary" | "warning" | "success" | "destructive";
};

function getVideoStatus(match: MatchDoc): VideoStatusInfo {
  const config = match.settings?.videoConfiguration ?? "single";
  const uploaded = match.videosUploaded ?? {};
  const hasLegacyVideo = !!match.video?.storagePath;

  // Legacy video takes precedence (backward compatibility)
  if (hasLegacyVideo) {
    return { label: "Video Ready", variant: "success" };
  }

  // Check based on video configuration
  if (config === "single") {
    if (uploaded.single) {
      return { label: "Video Ready", variant: "success" };
    }
    return { label: "No Video", variant: "secondary" };
  }

  // Split configuration
  const hasFirst = uploaded.firstHalf ?? false;
  const hasSecond = uploaded.secondHalf ?? false;

  if (hasFirst && hasSecond) {
    return { label: "Videos Ready", variant: "success" };
  }
  if (hasFirst) {
    return { label: "1st Half Only", variant: "warning" };
  }
  if (hasSecond) {
    return { label: "2nd Half Only", variant: "warning" };
  }
  return { label: "No Video", variant: "secondary" };
}

function formatDate(dateStr: string | null | undefined): string {
  if (!dateStr) return "No date";
  try {
    const date = new Date(dateStr);
    return date.toLocaleDateString("ja-JP", {
      year: "numeric",
      month: "short",
      day: "numeric",
    });
  } catch {
    return "Invalid date";
  }
}

function formatRelativeTime(dateStr: string): string {
  try {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);
    const diffHours = Math.floor(diffMs / 3600000);
    const diffDays = Math.floor(diffMs / 86400000);

    if (diffMins < 1) return "Just now";
    if (diffMins < 60) return `${diffMins}m ago`;
    if (diffHours < 24) return `${diffHours}h ago`;
    if (diffDays < 7) return `${diffDays}d ago`;
    return date.toLocaleDateString("ja-JP", { month: "short", day: "numeric" });
  } catch {
    return dateStr;
  }
}

function MatchCard({ match }: { match: MatchDoc }) {
  const analysisStatus = match.analysis?.status ?? "idle";
  const videoStatus = getVideoStatus(match);

  // Determine which status to show prominently
  // Priority: error > running/queued > video status > done/idle
  const showAnalysisFirst =
    analysisStatus === "error" ||
    analysisStatus === "running" ||
    analysisStatus === "queued";

  return (
    <Pressable onPress={() => router.push(`/match/${match.matchId}`)}>
      <Card className="mb-3">
        <CardHeader>
          <View className="flex-row items-center justify-between">
            <CardTitle className="flex-1 mr-2">{match.title || "Untitled Match"}</CardTitle>
            <View className="flex-row gap-1">
              {showAnalysisFirst ? (
                <>
                  <Badge variant={getAnalysisStatusColor(analysisStatus)}>{analysisStatus}</Badge>
                  {videoStatus.variant !== "success" && (
                    <Badge variant={videoStatus.variant}>{videoStatus.label}</Badge>
                  )}
                </>
              ) : (
                <>
                  <Badge variant={videoStatus.variant}>{videoStatus.label}</Badge>
                  {analysisStatus === "done" && (
                    <Badge variant="success">Analyzed</Badge>
                  )}
                </>
              )}
            </View>
          </View>
        </CardHeader>
        <CardContent>
          <Text className="text-muted-foreground text-sm">
            {formatDate(match.date)}
          </Text>
          {match.analysis?.lastRunAt && (
            <Text className="text-muted-foreground text-xs mt-1">
              Analyzed: {formatRelativeTime(match.analysis.lastRunAt)}
            </Text>
          )}
        </CardContent>
      </Card>
    </Pressable>
  );
}

function EmptyState() {
  return (
    <View className="flex-1 items-center justify-center py-12">
      <Text className="text-muted-foreground text-lg mb-2">No matches yet</Text>
      <Text className="text-muted-foreground text-sm text-center px-8">
        Create a match to get started. You can configure settings and upload videos afterward.
      </Text>
    </View>
  );
}

export default function MatchesScreen() {
  const { matches, loading, error } = useMatches();

  return (
    <View className="flex-1 bg-background">
      <View className="p-4 border-b border-border">
        <View className="flex-row items-center justify-between">
          <Text className="text-2xl font-semibold text-foreground">Matches</Text>
          <Button onPress={() => router.push("/create-match")}>
            + New
          </Button>
        </View>
      </View>

      {loading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="rgb(99, 102, 241)" />
        </View>
      ) : error ? (
        <View className="flex-1 items-center justify-center p-4">
          <Text className="text-destructive text-center">
            Error loading matches: {error.message}
          </Text>
        </View>
      ) : matches.length === 0 ? (
        <EmptyState />
      ) : (
        <FlatList
          data={matches}
          keyExtractor={(item) => item.matchId}
          renderItem={({ item }) => <MatchCard match={item} />}
          contentContainerStyle={{ padding: 16 }}
        />
      )}
    </View>
  );
}
