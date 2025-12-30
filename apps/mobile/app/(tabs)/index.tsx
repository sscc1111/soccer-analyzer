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
            {match.date ? new Date(match.date).toLocaleDateString() : "No date"}
          </Text>
          {match.analysis?.lastRunAt && (
            <Text className="text-muted-foreground text-xs mt-1">
              Last analyzed: {new Date(match.analysis.lastRunAt).toLocaleString()}
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
