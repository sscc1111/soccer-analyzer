import { View, Text, ScrollView, ActivityIndicator, Pressable } from "react-native";
import { useLocalSearchParams } from "expo-router";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Tabs,
  TabsList,
  TabsTrigger,
  TabsContent,
} from "../../../components/ui";
import { useStats, useMatch } from "../../../lib/hooks";
import { metricKeys, type MetricKey } from "@soccer/shared";

type MetricDisplay = {
  key: MetricKey;
  label: string;
  format: (value: unknown) => string;
  unit?: string;
};

const MATCH_METRICS: MetricDisplay[] = [
  {
    key: metricKeys.matchEventsCountByLabel,
    label: "Events by Type",
    format: (v) => {
      if (!v || typeof v !== "object") return "N/A";
      const counts = v as Record<string, number>;
      return Object.entries(counts)
        .map(([k, c]) => `${k}: ${c}`)
        .join(", ");
    },
  },
  {
    key: metricKeys.matchTopMoments,
    label: "Top Moments",
    format: (v) => {
      if (!Array.isArray(v)) return "N/A";
      return `${v.length} highlights`;
    },
  },
  // Team Possession (Phase 3.3)
  {
    key: metricKeys.teamPossessionPercent,
    label: "Possession",
    format: (v) => {
      if (!v || typeof v !== "object") return "N/A";
      const poss = v as { home?: number; away?: number };
      return `Home ${poss.home ?? 0}% - Away ${poss.away ?? 0}%`;
    },
  },
];

const PLAYER_METRICS: MetricDisplay[] = [
  // Distance (Phase 4)
  {
    key: metricKeys.playerDistanceMeters,
    label: "Distance Covered",
    format: (v) => {
      if (typeof v !== "number") return "N/A";
      if (v >= 1000) return `${(v / 1000).toFixed(2)} km`;
      return `${v.toFixed(0)} m`;
    },
  },
  // Passes (Phase 3.1 + Phase 4 additions)
  {
    key: metricKeys.playerPassesAttempted,
    label: "Passes Attempted",
    format: (v) => String(v ?? 0),
  },
  {
    key: metricKeys.playerPassesCompleted,
    label: "Passes Completed",
    format: (v) => String(v ?? 0),
  },
  {
    key: metricKeys.playerPassesIncomplete,
    label: "Passes Incomplete",
    format: (v) => String(v ?? 0),
  },
  {
    key: metricKeys.playerPassesIntercepted,
    label: "Passes Intercepted",
    format: (v) => String(v ?? 0),
  },
  {
    key: metricKeys.playerPassesSuccessRate,
    label: "Pass Success Rate",
    format: (v) => (typeof v === "number" ? `${v}%` : "N/A"),
  },
  // Carry (Phase 3.2 + Phase 4 additions)
  {
    key: metricKeys.playerCarryCount,
    label: "Carries",
    format: (v) => String(v ?? 0),
  },
  {
    key: metricKeys.playerCarryMeters,
    label: "Carry Distance",
    format: (v) => {
      if (typeof v !== "number") return "N/A";
      return `${v.toFixed(1)} m`;
    },
  },
  {
    key: metricKeys.playerCarryIndex,
    label: "Carry Index",
    format: (v) => (typeof v === "number" ? v.toFixed(1) : "N/A"),
  },
  {
    key: metricKeys.playerCarryProgressIndex,
    label: "Carry Progress",
    format: (v) => (typeof v === "number" ? v.toFixed(1) : "N/A"),
  },
  // Possession (Phase 3.3)
  {
    key: metricKeys.playerPossessionTimeSec,
    label: "Possession Time",
    format: (v) => {
      if (typeof v !== "number") return "N/A";
      const mins = Math.floor(v / 60);
      const secs = Math.floor(v % 60);
      return mins > 0 ? `${mins}m ${secs}s` : `${secs}s`;
    },
  },
  {
    key: metricKeys.playerPossessionCount,
    label: "Possessions",
    format: (v) => String(v ?? 0),
  },
  // Turnovers (Phase 3.4)
  {
    key: metricKeys.playerTurnoversLost,
    label: "Turnovers Lost",
    format: (v) => String(v ?? 0),
  },
  {
    key: metricKeys.playerTurnoversWon,
    label: "Turnovers Won",
    format: (v) => String(v ?? 0),
  },
  // Existing metrics
  {
    key: metricKeys.playerInvolvementCount,
    label: "Involvement",
    format: (v) => String(v ?? 0),
    unit: "events",
  },
  {
    key: metricKeys.playerPeakSpeedIndex,
    label: "Peak Speed Index",
    format: (v) => (typeof v === "number" ? v.toFixed(1) : "N/A"),
  },
  {
    key: metricKeys.playerSprintCount,
    label: "Sprint Count",
    format: (v) => String(v ?? 0),
  },
  {
    key: metricKeys.playerOnScreenTimeSec,
    label: "On Screen Time",
    format: (v) => {
      if (typeof v !== "number") return "N/A";
      const mins = Math.floor(v / 60);
      const secs = Math.floor(v % 60);
      return `${mins}:${secs.toString().padStart(2, "0")}`;
    },
  },
];

function getConfidenceColor(conf: number) {
  if (conf >= 0.8) return "text-success";
  if (conf >= 0.5) return "text-warning";
  return "text-destructive";
}

function getConfidenceLabel(conf: number) {
  if (conf >= 0.8) return "High";
  if (conf >= 0.5) return "Medium";
  return "Low";
}

function MetricCard({
  metric,
  value,
  confidence,
  explanation,
}: {
  metric: MetricDisplay;
  value: unknown;
  confidence?: number;
  explanation?: string;
}) {
  const conf = confidence ?? 0;

  return (
    <Card className="mb-3">
      <CardContent className="py-3">
        <View className="flex-row items-center justify-between mb-1">
          <Text className="text-muted-foreground text-sm">{metric.label}</Text>
          <View className="flex-row items-center gap-1">
            <View
              className={`w-2 h-2 rounded-full ${
                conf >= 0.8
                  ? "bg-success"
                  : conf >= 0.5
                  ? "bg-warning"
                  : "bg-destructive"
              }`}
            />
            <Text className={`text-xs ${getConfidenceColor(conf)}`}>
              {getConfidenceLabel(conf)}
            </Text>
          </View>
        </View>
        <Text className="text-foreground text-xl font-semibold">
          {metric.format(value)}
          {metric.unit && (
            <Text className="text-muted-foreground text-sm"> {metric.unit}</Text>
          )}
        </Text>
        {explanation && (
          <Text className="text-muted-foreground text-xs mt-1">
            {explanation}
          </Text>
        )}
      </CardContent>
    </Card>
  );
}

function HeatmapCard({ zones }: { zones: Record<string, number> | null }) {
  if (!zones) {
    return (
      <Card className="mb-3">
        <CardContent className="py-3">
          <Text className="text-muted-foreground">
            Heatmap data not available
          </Text>
        </CardContent>
      </Card>
    );
  }

  // Simple 3x3 grid visualization
  const grid = [
    ["topLeft", "topCenter", "topRight"],
    ["midLeft", "midCenter", "midRight"],
    ["bottomLeft", "bottomCenter", "bottomRight"],
  ];

  const maxValue = Math.max(...Object.values(zones), 1);

  return (
    <Card className="mb-3">
      <CardHeader>
        <CardTitle>Position Heatmap</CardTitle>
      </CardHeader>
      <CardContent>
        <View className="aspect-[3/2] bg-success/20 rounded-lg overflow-hidden">
          {grid.map((row, rowIdx) => (
            <View key={rowIdx} className="flex-1 flex-row">
              {row.map((zone) => {
                const value = zones[zone] ?? 0;
                const intensity = value / maxValue;
                return (
                  <View
                    key={zone}
                    className="flex-1 items-center justify-center border border-success/30"
                    style={{
                      backgroundColor: `rgba(34, 197, 94, ${intensity * 0.8})`,
                    }}
                  >
                    {value > 0 && (
                      <Text className="text-foreground text-xs font-bold">
                        {Math.round(value)}
                      </Text>
                    )}
                  </View>
                );
              })}
            </View>
          ))}
        </View>
        <Text className="text-muted-foreground text-xs mt-2 text-center">
          Zone intensity based on detected appearances
        </Text>
      </CardContent>
    </Card>
  );
}

export default function StatsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { match } = useMatch(id);
  const { matchStats, playerStats, loading, error } = useStats(id);

  if (loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="rgb(99, 102, 241)" />
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 bg-background items-center justify-center p-4">
        <Text className="text-destructive text-center">{error.message}</Text>
      </View>
    );
  }

  return (
    <ScrollView className="flex-1 bg-background">
      <View className="p-4">
        <Text className="text-2xl font-semibold text-foreground mb-1">
          Stats
        </Text>
        <Text className="text-muted-foreground mb-4">
          {match?.title ?? "Match"} Analysis
        </Text>

        {/* Confidence Warning */}
        {matchStats && (
          <Card className="mb-4 border-warning">
            <CardContent className="py-3 flex-row items-start">
              <Text className="text-warning mr-2">!</Text>
              <View className="flex-1">
                <Text className="text-foreground text-sm">
                  Confidence indicators show reliability of each stat.
                </Text>
                <Text className="text-muted-foreground text-xs mt-1">
                  Tag more players in clips to improve accuracy.
                </Text>
              </View>
            </CardContent>
          </Card>
        )}

        <Tabs defaultValue="match">
          <TabsList>
            <TabsTrigger value="match">Match</TabsTrigger>
            <TabsTrigger value="players">Players</TabsTrigger>
          </TabsList>

          <TabsContent value="match">
            {matchStats ? (
              <View>
                {MATCH_METRICS.map((metric) => (
                  <MetricCard
                    key={metric.key}
                    metric={metric}
                    value={matchStats.metrics[metric.key]}
                    confidence={matchStats.confidence[metric.key]}
                    explanation={matchStats.explanations?.[metric.key]}
                  />
                ))}
              </View>
            ) : (
              <Card>
                <CardContent className="py-6">
                  <Text className="text-muted-foreground text-center">
                    No match stats available yet.
                  </Text>
                  <Text className="text-muted-foreground text-center text-sm mt-1">
                    Stats will appear after analysis completes.
                  </Text>
                </CardContent>
              </Card>
            )}
          </TabsContent>

          <TabsContent value="players">
            {playerStats.length > 0 ? (
              <View>
                {playerStats.map((stat) => (
                  <View key={stat.statId}>
                    <Text className="text-foreground font-medium mb-2 mt-4">
                      Player {stat.playerId ?? "Unknown"}
                    </Text>

                    {PLAYER_METRICS.map((metric) => {
                      const value = stat.metrics[metric.key];
                      if (value === undefined) return null;
                      return (
                        <MetricCard
                          key={metric.key}
                          metric={metric}
                          value={value}
                          confidence={stat.confidence[metric.key]}
                          explanation={stat.explanations?.[metric.key]}
                        />
                      );
                    })}

                    {/* Heatmap for player */}
                    {stat.metrics[metricKeys.playerHeatmapZones] != null && (
                      <HeatmapCard
                        zones={
                          stat.metrics[metricKeys.playerHeatmapZones] as Record<
                            string,
                            number
                          >
                        }
                      />
                    )}
                  </View>
                ))}
              </View>
            ) : (
              <Card>
                <CardContent className="py-6">
                  <Text className="text-muted-foreground text-center">
                    No player stats available yet.
                  </Text>
                  <Text className="text-muted-foreground text-center text-sm mt-1">
                    Tag players in clips to generate player stats.
                  </Text>
                </CardContent>
              </Card>
            )}
          </TabsContent>
        </Tabs>
      </View>
    </ScrollView>
  );
}
