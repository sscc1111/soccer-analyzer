import { View, Text, ActivityIndicator, Pressable } from "react-native";
import { router } from "expo-router";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "./ui";
import { getContrastingTextColor } from "../lib/utils/colorContrast";
import type { MatchSummaryDoc, KeyMoment, PlayerHighlight } from "@soccer/shared";

type MatchSummaryViewProps = {
  summary: MatchSummaryDoc | null;
  loading?: boolean;
  error?: Error | null;
  matchId?: string;
  homeColor?: string;
  awayColor?: string;
};

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function KeyMomentCard({ moment, matchId }: { moment: KeyMoment; matchId?: string }) {
  const getTypeColor = (type?: string) => {
    switch (type) {
      case "goal":
        return "success";
      case "chance":
        return "warning";
      case "save":
        return "default";
      case "foul":
        return "destructive";
      default:
        return "secondary";
    }
  };

  const hasVideo = !!moment.clipId && !!matchId;

  const handlePress = () => {
    if (hasVideo) {
      router.push(`/match/${matchId}/clip/${moment.clipId}`);
    }
  };

  const CardWrapper = hasVideo ? Pressable : View;

  return (
    <CardWrapper onPress={hasVideo ? handlePress : undefined}>
      <Card className={`mb-2 ${hasVideo ? "border-primary/50" : ""}`}>
        <CardContent className="py-3">
          <View className="flex-row items-start gap-3">
            <View className="items-center">
              <Text className="text-primary font-bold text-sm">
                {formatTime(moment.timestamp)}
              </Text>
              {moment.type && (
                <Badge variant={getTypeColor(moment.type)} className="mt-1">
                  {moment.type}
                </Badge>
              )}
            </View>
            <View className="flex-1">
              <Text className="text-foreground">{moment.description}</Text>
              {moment.importance >= 8 && (
                <Text className="text-warning text-xs mt-1">★ 重要なシーン</Text>
              )}
            </View>
            {hasVideo && (
              <View className="bg-primary/20 rounded-full w-8 h-8 items-center justify-center">
                <Text className="text-primary">▶</Text>
              </View>
            )}
          </View>
        </CardContent>
      </Card>
    </CardWrapper>
  );
}

function PlayerHighlightCard({
  highlight,
  color,
}: {
  highlight: PlayerHighlight;
  color: string;
}) {
  const textColor = getContrastingTextColor(color);

  return (
    <View className="flex-row items-center gap-3 py-2">
      <View
        className="w-10 h-10 rounded-full items-center justify-center"
        style={{ backgroundColor: color }}
      >
        <Text style={{ color: textColor, fontWeight: "bold" }}>
          {highlight.jerseyNumber ?? "?"}
        </Text>
      </View>
      <View className="flex-1">
        <Text className="text-foreground font-medium">{highlight.player}</Text>
        <Text className="text-muted-foreground text-sm">{highlight.achievement}</Text>
        {highlight.metric && (
          <Text className="text-primary text-xs">
            {highlight.metric.name}: {highlight.metric.value}
          </Text>
        )}
      </View>
    </View>
  );
}

export function MatchSummaryView({
  summary,
  loading,
  error,
  matchId,
  homeColor = "#ef4444",
  awayColor = "#3b82f6",
}: MatchSummaryViewProps) {
  if (loading) {
    return (
      <View className="items-center justify-center py-8">
        <ActivityIndicator size="large" color="rgb(99, 102, 241)" />
        <Text className="text-muted-foreground mt-2">サマリーを読み込み中...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View className="items-center justify-center py-8">
        <Text className="text-destructive font-medium">読み込みエラー</Text>
        <Text className="text-muted-foreground text-sm mt-1">{error.message}</Text>
      </View>
    );
  }

  if (!summary) {
    return (
      <View className="items-center justify-center py-8">
        <Text className="text-muted-foreground">サマリーデータがありません</Text>
        <Text className="text-muted-foreground text-sm mt-1">
          分析完了後にデータが表示されます
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-4">
      {/* Headline & Score */}
      <Card>
        <CardContent className="py-4">
          <Text className="text-foreground text-xl font-bold text-center mb-2">
            {summary.headline}
          </Text>
          {summary.score && (
            <View className="flex-row justify-center items-center gap-4">
              <View className="items-center">
                <View
                  className="w-12 h-12 rounded-full items-center justify-center mb-1"
                  style={{ backgroundColor: homeColor }}
                >
                  <Text style={{ color: getContrastingTextColor(homeColor), fontWeight: "bold", fontSize: 20 }}>
                    {summary.score.home}
                  </Text>
                </View>
                <Text className="text-muted-foreground text-sm">ホーム</Text>
              </View>
              <Text className="text-foreground text-2xl font-bold">-</Text>
              <View className="items-center">
                <View
                  className="w-12 h-12 rounded-full items-center justify-center mb-1"
                  style={{ backgroundColor: awayColor }}
                >
                  <Text style={{ color: getContrastingTextColor(awayColor), fontWeight: "bold", fontSize: 20 }}>
                    {summary.score.away}
                  </Text>
                </View>
                <Text className="text-muted-foreground text-sm">アウェイ</Text>
              </View>
            </View>
          )}
        </CardContent>
      </Card>

      {/* MVP */}
      {summary.mvp && (
        <Card className="border-primary">
          <CardHeader>
            <CardTitle>🏆 MVP</CardTitle>
          </CardHeader>
          <CardContent>
            <PlayerHighlightCard
              highlight={summary.mvp}
              color={summary.mvp.team === "home" ? homeColor : awayColor}
            />
          </CardContent>
        </Card>
      )}

      {/* Narrative */}
      <Card>
        <CardHeader>
          <CardTitle>試合の流れ</CardTitle>
        </CardHeader>
        <CardContent>
          <View className="gap-4">
            {summary.narrative.firstHalf && (
              <View>
                <Text className="text-primary font-medium mb-1">前半</Text>
                <Text className="text-foreground">{summary.narrative.firstHalf}</Text>
              </View>
            )}
            {summary.narrative.secondHalf && (
              <View>
                <Text className="text-primary font-medium mb-1">後半</Text>
                <Text className="text-foreground">{summary.narrative.secondHalf}</Text>
              </View>
            )}
            {summary.narrative.overall && (
              <View>
                <Text className="text-primary font-medium mb-1">総括</Text>
                <Text className="text-foreground">{summary.narrative.overall}</Text>
              </View>
            )}
          </View>
        </CardContent>
      </Card>

      {/* Key Moments */}
      {summary.keyMoments.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>キーモーメント</CardTitle>
          </CardHeader>
          <CardContent>
            <View>
              {summary.keyMoments
                .slice()
                .sort((a, b) => a.timestamp - b.timestamp)
                .map((moment, idx) => (
                  <KeyMomentCard key={idx} moment={moment} matchId={matchId} />
                ))}
            </View>
          </CardContent>
        </Card>
      )}

      {/* Player Highlights */}
      {summary.playerHighlights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>選手ハイライト</CardTitle>
          </CardHeader>
          <CardContent>
            <View className="gap-1">
              {summary.playerHighlights.map((highlight, idx) => (
                <PlayerHighlightCard
                  key={idx}
                  highlight={highlight}
                  color={highlight.team === "home" ? homeColor : awayColor}
                />
              ))}
            </View>
          </CardContent>
        </Card>
      )}

      {/* Tags */}
      {summary.tags && summary.tags.length > 0 && (
        <View className="flex-row flex-wrap gap-2">
          {summary.tags.map((tag) => (
            <Badge key={tag} variant="outline">
              {tag}
            </Badge>
          ))}
        </View>
      )}
    </View>
  );
}
