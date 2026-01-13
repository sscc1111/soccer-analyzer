import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Pressable,
} from "react-native";
import { useLocalSearchParams, router, Stack } from "expo-router";
import { Card, CardContent, Button, Badge } from "../../../components/ui";
import { TacticalView } from "../../../components/TacticalView";
import { useMatch } from "../../../lib/hooks";
import { useLivePositions } from "../../../lib/hooks/useLivePositions";
import type { GameFormat } from "@soccer/shared";

type ViewMode = "live" | "replay";

/**
 * Tactical View Screen
 *
 * Shows a 2D bird's-eye view of the pitch with:
 * - All player positions (color-coded by team)
 * - Ball position
 * - Off-screen players shown with dashed borders
 * - Jersey numbers
 */
export default function TacticalViewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { match, loading: matchLoading, error: matchError } = useMatch(id);
  const { positions, ball, loading: positionsLoading, error: positionsError } = useLivePositions(id);

  const [viewMode, setViewMode] = useState<ViewMode>("live");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);

  const gameFormat = (match?.settings?.gameFormat as GameFormat) ?? "eleven";
  const homeColor = match?.settings?.teamColors?.home ?? "#ef4444";
  const awayColor = match?.settings?.teamColors?.away ?? "#3b82f6";

  if (matchLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="rgb(99, 102, 241)" />
      </View>
    );
  }

  if (matchError) {
    return (
      <View className="flex-1 bg-background items-center justify-center p-4">
        <Text className="text-destructive text-lg font-semibold mb-2">
          エラーが発生しました
        </Text>
        <Text className="text-muted-foreground text-center">
          {matchError.message}
        </Text>
      </View>
    );
  }

  if (!match) {
    return (
      <View className="flex-1 bg-background items-center justify-center p-4">
        <Text className="text-muted-foreground text-center">
          試合が見つかりません
        </Text>
      </View>
    );
  }

  const handlePlayerTap = (playerId: string) => {
    setSelectedPlayerId(playerId === selectedPlayerId ? null : playerId);
  };

  const selectedPlayer = positions.find((p) => p.trackId === selectedPlayerId);

  const homeCount = positions.filter((p) => p.teamId === "home").length;
  const awayCount = positions.filter((p) => p.teamId === "away").length;
  const predictedCount = positions.filter((p) => p.isPredicted).length;

  return (
    <>
      <Stack.Screen
        options={{
          headerShown: true,
          title: "タクティカルビュー",
          headerBackTitle: "戻る",
        }}
      />

      <ScrollView className="flex-1 bg-background">
        <View className="p-4">
          {/* Header */}
          <View className="mb-4">
            <Text className="text-xl font-semibold text-foreground">
              {match?.title ?? "試合"}
            </Text>
            <Text className="text-muted-foreground text-sm">
              リアルタイム選手配置
            </Text>
          </View>

          {/* Mode Toggle */}
          <View className="flex-row gap-2 mb-4">
            <Pressable
              onPress={() => setViewMode("live")}
              className={`flex-1 py-2 px-4 rounded-lg ${
                viewMode === "live" ? "bg-primary" : "bg-muted"
              }`}
            >
              <Text
                className={`text-center font-medium ${
                  viewMode === "live"
                    ? "text-primary-foreground"
                    : "text-foreground"
                }`}
              >
                ライブ
              </Text>
            </Pressable>
            <Pressable
              onPress={() => setViewMode("replay")}
              className={`flex-1 py-2 px-4 rounded-lg ${
                viewMode === "replay" ? "bg-primary" : "bg-muted"
              }`}
            >
              <Text
                className={`text-center font-medium ${
                  viewMode === "replay"
                    ? "text-primary-foreground"
                    : "text-foreground"
                }`}
              >
                リプレイ
              </Text>
            </Pressable>
          </View>

          {/* Stats Bar */}
          <View className="flex-row gap-2 mb-4">
            <Card className="flex-1">
              <CardContent className="py-2">
                <View className="flex-row items-center gap-2">
                  <View
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: homeColor }}
                  />
                  <Text className="text-foreground font-medium">
                    ホーム: {homeCount}
                  </Text>
                </View>
              </CardContent>
            </Card>
            <Card className="flex-1">
              <CardContent className="py-2">
                <View className="flex-row items-center gap-2">
                  <View
                    className="w-3 h-3 rounded-full"
                    style={{ backgroundColor: awayColor }}
                  />
                  <Text className="text-foreground font-medium">
                    アウェイ: {awayCount}
                  </Text>
                </View>
              </CardContent>
            </Card>
            {predictedCount > 0 && (
              <Card className="flex-1">
                <CardContent className="py-2">
                  <Text className="text-muted-foreground text-sm">
                    予測: {predictedCount}
                  </Text>
                </CardContent>
              </Card>
            )}
          </View>

          {/* Tactical View */}
          <Card className="mb-4 overflow-hidden">
            <CardContent className="p-0">
              {positionsError ? (
                <View className="h-64 items-center justify-center p-4">
                  <Text className="text-destructive text-sm font-semibold mb-1">
                    位置データの読み込みに失敗しました
                  </Text>
                  <Text className="text-muted-foreground text-xs text-center">
                    {positionsError.message}
                  </Text>
                </View>
              ) : positionsLoading ? (
                <View className="h-64 items-center justify-center">
                  <ActivityIndicator size="large" color="rgb(99, 102, 241)" />
                  <Text className="text-muted-foreground mt-2">
                    位置データを読み込み中...
                  </Text>
                </View>
              ) : positions.length === 0 ? (
                <View className="h-64 items-center justify-center">
                  <Text className="text-muted-foreground text-center">
                    位置データがありません
                  </Text>
                  <Text className="text-muted-foreground text-sm text-center mt-1">
                    分析完了後にデータが表示されます
                  </Text>
                </View>
              ) : (
                <TacticalView
                  gameFormat={gameFormat}
                  players={positions.map((p) => ({
                    id: p.trackId,
                    x: p.position.x,
                    y: p.position.y,
                    team: p.teamId,
                    jerseyNumber: p.jerseyNumber,
                    isPredicted: p.isPredicted,
                    confidence: p.confidence,
                  }))}
                  ball={
                    ball
                      ? {
                          x: ball.x,
                          y: ball.y,
                          visible: ball.visible,
                        }
                      : undefined
                  }
                  homeColor={homeColor}
                  awayColor={awayColor}
                  showJerseyNumbers
                  onPlayerTap={handlePlayerTap}
                />
              )}
            </CardContent>
          </Card>

          {/* Selected Player Info */}
          {selectedPlayer && (
            <Card className="mb-4">
              <CardContent className="py-3">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-3">
                    <View
                      className="w-10 h-10 rounded-full items-center justify-center"
                      style={{
                        backgroundColor:
                          selectedPlayer.teamId === "home"
                            ? homeColor
                            : selectedPlayer.teamId === "away"
                            ? awayColor
                            : "#888888",
                      }}
                    >
                      <Text className="text-white font-bold">
                        {selectedPlayer.jerseyNumber ?? "?"}
                      </Text>
                    </View>
                    <View>
                      <Text className="text-foreground font-medium">
                        {selectedPlayer.teamId === "home"
                          ? "ホーム"
                          : selectedPlayer.teamId === "away"
                          ? "アウェイ"
                          : "不明"}
                        {selectedPlayer.jerseyNumber
                          ? ` #${selectedPlayer.jerseyNumber}`
                          : ""}
                      </Text>
                      <Text className="text-muted-foreground text-xs">
                        位置: ({selectedPlayer.position.x.toFixed(1)},{" "}
                        {selectedPlayer.position.y.toFixed(1)}) m
                      </Text>
                    </View>
                  </View>
                  {selectedPlayer.isPredicted && (
                    <Badge variant="secondary">予測位置</Badge>
                  )}
                </View>
              </CardContent>
            </Card>
          )}

          {/* Legend */}
          <Card className="mb-4">
            <CardContent className="py-3">
              <Text className="text-foreground font-medium mb-2">凡例</Text>
              <View className="gap-2">
                <View className="flex-row items-center gap-2">
                  <View
                    className="w-6 h-6 rounded-full"
                    style={{ backgroundColor: homeColor }}
                  />
                  <Text className="text-muted-foreground text-sm">
                    ホームチーム (画面内)
                  </Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <View
                    className="w-6 h-6 rounded-full"
                    style={{ backgroundColor: awayColor }}
                  />
                  <Text className="text-muted-foreground text-sm">
                    アウェイチーム (画面内)
                  </Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <View
                    className="w-6 h-6 rounded-full border-2 border-dashed border-white"
                    style={{ backgroundColor: homeColor, opacity: 0.5 }}
                  />
                  <Text className="text-muted-foreground text-sm">
                    予測位置 (画面外)
                  </Text>
                </View>
                <View className="flex-row items-center gap-2">
                  <View className="w-4 h-4 rounded-full bg-white border border-black" />
                  <Text className="text-muted-foreground text-sm">ボール</Text>
                </View>
              </View>
            </CardContent>
          </Card>

          {/* Actions */}
          <View className="gap-3">
            <Button
              variant="outline"
              onPress={() => router.push(`/match/${id}/clips`)}
            >
              クリップを見る
            </Button>
            <Button
              variant="outline"
              onPress={() => router.push(`/match/${id}/stats`)}
            >
              スタッツを見る
            </Button>
          </View>
        </View>
      </ScrollView>
    </>
  );
}
