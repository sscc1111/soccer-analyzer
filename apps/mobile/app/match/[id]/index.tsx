import { View, Text, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../../../components/ui";
import { AnalysisProgress } from "../../../components/AnalysisProgress";
import { useMatch, useStats, useEvents, usePendingReviews } from "../../../lib/hooks";
import type { EventLabel } from "@soccer/shared";

const EVENT_LABELS: EventLabel[] = ["shot", "chance", "setPiece", "dribble", "defense", "other"];

function getStatusVariant(status?: string) {
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

function SummaryCard({
  title,
  value,
  subtitle,
}: {
  title: string;
  value: string | number;
  subtitle?: string;
}) {
  return (
    <Card className="flex-1 min-w-[140px]">
      <CardContent className="pt-3 pb-3">
        <Text className="text-muted-foreground text-xs">{title}</Text>
        <Text className="text-foreground text-2xl font-bold">{value}</Text>
        {subtitle && (
          <Text className="text-muted-foreground text-xs">{subtitle}</Text>
        )}
      </CardContent>
    </Card>
  );
}

function EventCountCard({
  label,
  count,
  onPress,
}: {
  label: EventLabel;
  count: number;
  onPress: () => void;
}) {
  return (
    <Pressable onPress={onPress} className="mr-2 mb-2">
      <Card className="px-4 py-2">
        <Text className="text-foreground font-medium capitalize">{label}</Text>
        <Text className="text-primary text-xl font-bold">{count}</Text>
      </Card>
    </Pressable>
  );
}

export default function MatchDashboardScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { match, loading: matchLoading, error: matchError } = useMatch(id);
  const { matchStats, loading: statsLoading } = useStats(id);
  const { events } = useEvents(id);
  const { needsReviewCount } = usePendingReviews(id);

  if (matchLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="rgb(99, 102, 241)" />
      </View>
    );
  }

  if (matchError || !match) {
    return (
      <View className="flex-1 bg-background items-center justify-center p-4">
        <Text className="text-destructive text-center mb-4">
          {matchError?.message || "Match not found"}
        </Text>
        <Button onPress={() => router.back()}>Go Back</Button>
      </View>
    );
  }

  const status = match.analysis?.status ?? "idle";
  const eventCounts = matchStats?.metrics["match.events.countByLabel"] as
    | Record<string, number>
    | undefined;
  const topMoments = matchStats?.metrics["match.events.topMoments"] as
    | Array<{ label: string; title: string; clipId: string | null }>
    | undefined;

  const totalEvents = events.length;
  const avgConfidence =
    events.length > 0
      ? Math.round(
          (events.reduce((acc, e) => acc + e.confidence, 0) / events.length) * 100
        )
      : 0;

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="p-4">
        {/* Header */}
        <View className="flex-row items-center justify-between mb-4">
          <View className="flex-1">
            <Text className="text-2xl font-semibold text-foreground">
              {match.title || "Untitled Match"}
            </Text>
            <Text className="text-muted-foreground">
              {match.date ? new Date(match.date).toLocaleDateString() : "No date"}
            </Text>
          </View>
          <Badge variant={getStatusVariant(status)}>{status}</Badge>
        </View>

        {/* Analysis Progress */}
        <AnalysisProgress
          progress={match.analysis?.progress}
          status={status}
          errorMessage={match.analysis?.errorMessage}
        />

        {/* Summary Cards */}
        <View className="flex-row gap-3 mb-4">
          <SummaryCard title="Total Events" value={totalEvents} />
          <SummaryCard
            title="Avg Confidence"
            value={`${avgConfidence}%`}
            subtitle={avgConfidence < 70 ? "Low - tag players to improve" : undefined}
          />
        </View>

        {/* Quick Actions */}
        <View className="gap-3 mb-6">
          <View className="flex-row gap-3">
            <Button
              className="flex-1"
              onPress={() => router.push(`/match/${id}/clips`)}
            >
              View Clips
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onPress={() => router.push(`/match/${id}/stats`)}
            >
              View Stats
            </Button>
          </View>
          <View className="flex-row gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onPress={() => router.push(`/match/${id}/tracks`)}
            >
              Player Tracks
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onPress={() => router.push(`/match/${id}/tactical`)}
            >
              Tactical View
            </Button>
          </View>
          <Button
            variant="outline"
            className="w-full"
            onPress={() => router.push(`/match/${id}/settings`)}
          >
            Settings
          </Button>
          {needsReviewCount > 0 && (
            <Card className="border-warning">
              <CardContent className="py-3 flex-row items-center justify-between">
                <View>
                  <Text className="text-foreground font-medium">
                    Events Need Review
                  </Text>
                  <Text className="text-muted-foreground text-sm">
                    {needsReviewCount} low-confidence events detected
                  </Text>
                </View>
                <Button
                  variant="outline"
                  onPress={() => router.push(`/match/${id}/review`)}
                >
                  Review
                </Button>
              </CardContent>
            </Card>
          )}
        </View>

        {/* Tabs */}
        <Tabs defaultValue="events">
          <TabsList>
            <TabsTrigger value="events">Events</TabsTrigger>
            <TabsTrigger value="highlights">Highlights</TabsTrigger>
          </TabsList>

          <TabsContent value="events">
            <Text className="text-foreground font-medium mb-3">Event Breakdown</Text>
            {statsLoading ? (
              <ActivityIndicator size="small" color="rgb(99, 102, 241)" />
            ) : eventCounts ? (
              <View className="flex-row flex-wrap">
                {EVENT_LABELS.map((label) => (
                  <EventCountCard
                    key={label}
                    label={label}
                    count={eventCounts[label] ?? 0}
                    onPress={() =>
                      router.push(`/match/${id}/clips?filter=${label}`)
                    }
                  />
                ))}
              </View>
            ) : (
              <Text className="text-muted-foreground">No event data yet</Text>
            )}
          </TabsContent>

          <TabsContent value="highlights">
            <Text className="text-foreground font-medium mb-3">Top Moments</Text>
            {topMoments && topMoments.length > 0 ? (
              <View>
                {topMoments.slice(0, 5).map((moment, idx) => (
                  <Pressable
                    key={moment.clipId || `moment-${idx}`}
                    onPress={() => {
                      // Only navigate if clipId exists and is not empty
                      if (moment.clipId) {
                        router.push(`/match/${id}/clip/${moment.clipId}`);
                      }
                    }}
                    disabled={!moment.clipId}
                  >
                    <Card className={`mb-2 ${!moment.clipId ? "opacity-60" : ""}`}>
                      <CardContent className="py-3 flex-row items-center">
                        <Text className="text-primary font-bold mr-3">
                          #{idx + 1}
                        </Text>
                        <View className="flex-1">
                          <Text className="text-foreground">{moment.title}</Text>
                          <View className="flex-row items-center">
                            <Text className="text-muted-foreground text-xs capitalize">
                              {moment.label}
                            </Text>
                            {!moment.clipId && (
                              <Text className="text-muted-foreground text-xs ml-2">
                                (no clip)
                              </Text>
                            )}
                          </View>
                        </View>
                      </CardContent>
                    </Card>
                  </Pressable>
                ))}
              </View>
            ) : (
              <Text className="text-muted-foreground">
                Complete analysis to see highlights
              </Text>
            )}
          </TabsContent>
        </Tabs>

        {/* Improve Accuracy CTA */}
        {status === "done" && avgConfidence < 80 && (
          <Card className="mt-6 border-primary">
            <CardHeader>
              <CardTitle>Improve Accuracy</CardTitle>
            </CardHeader>
            <CardContent>
              <Text className="text-muted-foreground mb-3">
                Tag players in clips and adjust settings to improve analysis accuracy.
              </Text>
              <Button
                variant="outline"
                onPress={() => router.push(`/match/${id}/settings`)}
              >
                Open Settings
              </Button>
            </CardContent>
          </Card>
        )}
      </View>
    </ScrollView>
  );
}
