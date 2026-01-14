import { View, Text, FlatList, Pressable, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { Button, Card, CardHeader, CardTitle, CardContent, Badge } from "../../components/ui";
import { useMatches } from "../../lib/hooks";
import type { MatchDoc } from "@soccer/shared";

function getStatusColor(status?: string) {
  switch (status) {
    case "done":
      return "success";
    case "running":
    case "queued":
      return "warning";
    case "error":
      return "destructive";
    default:
      return "secondary";
  }
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
  const status = match.analysis?.status ?? "idle";

  return (
    <Pressable onPress={() => router.push(`/match/${match.matchId}`)}>
      <Card className="mb-3">
        <CardHeader>
          <View className="flex-row items-center justify-between">
            <CardTitle>{match.title || "Untitled Match"}</CardTitle>
            <Badge variant={getStatusColor(status)}>{status}</Badge>
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
        Upload a match video to get started with analysis.
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
          <Button onPress={() => router.push("/upload")}>
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
