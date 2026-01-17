import { useState } from "react";
import {
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  Pressable,
  Switch,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Card, CardContent, Button, Badge, Tabs, TabsList, TabsTrigger, TabsContent } from "../../../components/ui";
import { PageHeader } from "../../../components/PageHeader";
import { TacticalView } from "../../../components/TacticalView";
import { TacticalInsights } from "../../../components/TacticalInsights";
import { MatchSummaryView } from "../../../components/MatchSummaryView";
import { useMatch, useTacticalAnalysis, useMatchSummary } from "../../../lib/hooks";
import { useLivePositions } from "../../../lib/hooks/useLivePositions";
import { useMatchEvents, type EventFilter } from "../../../lib/hooks/useMatchEvents";
import { getContrastingTextColor } from "../../../lib/utils/colorContrast";
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
  const { analysis: tacticalAnalysis, loading: analysisLoading, error: analysisError } = useTacticalAnalysis(id);
  const { summary: matchSummary, loading: summaryLoading, error: summaryError } = useMatchSummary(id);
  const {
    filteredEvents,
    loading: eventsLoading,
    error: eventsError,
    filter: eventFilter,
    setFilter: setEventFilter,
  } = useMatchEvents(id, { types: ["shot"] }); // Default to showing only shots

  const [viewMode, setViewMode] = useState<ViewMode>("live");
  const [selectedPlayerId, setSelectedPlayerId] = useState<string | null>(null);
  const [showEvents, setShowEvents] = useState<boolean>(true);

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
    <View className="flex-1 bg-background">
      <PageHeader
        title="タクティカルビュー"
        subtitle={match?.title ?? "試合"}
        showBackButton
      />

      <ScrollView className="flex-1">
        <View className="p-4">
          {/* Main Tabs */}
          <Tabs defaultValue="positions" className="mb-4">
            <TabsList>
              <TabsTrigger value="positions">ポジション</TabsTrigger>
              <TabsTrigger value="analysis">戦術分析</TabsTrigger>
              <TabsTrigger value="summary">サマリー</TabsTrigger>
            </TabsList>

            {/* Positions Tab */}
            <TabsContent value="positions">
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

          {/* Event Controls (Phase 8) */}
          <Card className="mb-4">
            <CardContent className="py-3">
              <View className="flex-row items-center justify-between mb-3">
                <Text className="text-foreground font-medium">イベント表示</Text>
                <Switch
                  value={showEvents}
                  onValueChange={setShowEvents}
                  trackColor={{ false: "#767577", true: "#81b0ff" }}
                  thumbColor={showEvents ? "#4F46E5" : "#f4f3f4"}
                />
              </View>

              {showEvents && (
                <View className="gap-2">
                  <Text className="text-muted-foreground text-xs mb-1">表示するイベント</Text>
                  <View className="flex-row flex-wrap gap-2">
                    <Pressable
                      onPress={() => setEventFilter({
                        ...eventFilter,
                        types: eventFilter.types?.includes("shot")
                          ? eventFilter.types.filter((t) => t !== "shot")
                          : [...(eventFilter.types ?? []), "shot"],
                      })}
                      className={`py-1 px-3 rounded-full ${
                        eventFilter.types?.includes("shot") ? "bg-primary" : "bg-muted"
                      }`}
                    >
                      <Text
                        className={`text-sm ${
                          eventFilter.types?.includes("shot")
                            ? "text-primary-foreground"
                            : "text-foreground"
                        }`}
                      >
                        ⚽ シュート
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setEventFilter({
                        ...eventFilter,
                        types: eventFilter.types?.includes("pass")
                          ? eventFilter.types.filter((t) => t !== "pass")
                          : [...(eventFilter.types ?? []), "pass"],
                      })}
                      className={`py-1 px-3 rounded-full ${
                        eventFilter.types?.includes("pass") ? "bg-primary" : "bg-muted"
                      }`}
                    >
                      <Text
                        className={`text-sm ${
                          eventFilter.types?.includes("pass")
                            ? "text-primary-foreground"
                            : "text-foreground"
                        }`}
                      >
                        → パス
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setEventFilter({
                        ...eventFilter,
                        types: eventFilter.types?.includes("turnover")
                          ? eventFilter.types.filter((t) => t !== "turnover")
                          : [...(eventFilter.types ?? []), "turnover"],
                      })}
                      className={`py-1 px-3 rounded-full ${
                        eventFilter.types?.includes("turnover") ? "bg-primary" : "bg-muted"
                      }`}
                    >
                      <Text
                        className={`text-sm ${
                          eventFilter.types?.includes("turnover")
                            ? "text-primary-foreground"
                            : "text-foreground"
                        }`}
                      >
                        ⚠ ターンオーバー
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => setEventFilter({
                        ...eventFilter,
                        types: eventFilter.types?.includes("setPiece")
                          ? eventFilter.types.filter((t) => t !== "setPiece")
                          : [...(eventFilter.types ?? []), "setPiece"],
                      })}
                      className={`py-1 px-3 rounded-full ${
                        eventFilter.types?.includes("setPiece") ? "bg-primary" : "bg-muted"
                      }`}
                    >
                      <Text
                        className={`text-sm ${
                          eventFilter.types?.includes("setPiece")
                            ? "text-primary-foreground"
                            : "text-foreground"
                        }`}
                      >
                        🚩 セットプレー
                      </Text>
                    </Pressable>
                  </View>
                  <Text className="text-muted-foreground text-xs mt-1">
                    表示中: {filteredEvents.length}件
                  </Text>
                </View>
              )}
            </CardContent>
          </Card>

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
                  events={filteredEvents}
                  showEvents={showEvents}
                />
              )}
            </CardContent>
          </Card>

          {/* Selected Player Info */}
          {selectedPlayer && (() => {
            const playerColor =
              selectedPlayer.teamId === "home"
                ? homeColor
                : selectedPlayer.teamId === "away"
                ? awayColor
                : "#888888";
            return (
            <Card className="mb-4">
              <CardContent className="py-3">
                <View className="flex-row items-center justify-between">
                  <View className="flex-row items-center gap-3">
                    <View
                      className="w-10 h-10 rounded-full items-center justify-center"
                      style={{ backgroundColor: playerColor }}
                    >
                      <Text style={{ color: getContrastingTextColor(playerColor), fontWeight: "bold" }}>
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
            );
          })()}

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

                {/* Event Legend (Phase 8) */}
                {showEvents && (
                  <>
                    <View className="h-px bg-border my-1" />
                    <Text className="text-foreground font-medium text-sm mb-1">イベント</Text>
                    <View className="flex-row items-center gap-2">
                      <View
                        className="w-5 h-5 rounded-full items-center justify-center"
                        style={{ backgroundColor: "#FFD700", borderWidth: 2, borderColor: "#FFA000" }}
                      >
                        <Text style={{ fontSize: 10 }}>⚽</Text>
                      </View>
                      <Text className="text-muted-foreground text-sm">ゴール</Text>
                    </View>
                    <View className="flex-row items-center gap-2">
                      <View
                        className="w-4 h-4 rounded-full"
                        style={{ backgroundColor: homeColor }}
                      />
                      <Text className="text-muted-foreground text-sm">シュート</Text>
                    </View>
                    <View className="flex-row items-center gap-2">
                      <View
                        className="w-4 h-4 rounded-full items-center justify-center"
                        style={{ backgroundColor: "rgba(76, 175, 80, 0.7)" }}
                      >
                        <Text style={{ fontSize: 8, color: "#fff" }}>→</Text>
                      </View>
                      <Text className="text-muted-foreground text-sm">パス (成功)</Text>
                    </View>
                    <View className="flex-row items-center gap-2">
                      <View
                        className="w-4 h-4 rounded-full items-center justify-center"
                        style={{ backgroundColor: "rgba(244, 67, 54, 0.8)" }}
                      >
                        <Text style={{ fontSize: 8, color: "#fff" }}>×</Text>
                      </View>
                      <Text className="text-muted-foreground text-sm">ターンオーバー (ロスト)</Text>
                    </View>
                    <View className="flex-row items-center gap-2">
                      <View
                        className="w-4 h-4 rounded items-center justify-center"
                        style={{ backgroundColor: "rgba(156, 39, 176, 0.8)" }}
                      >
                        <Text style={{ fontSize: 8 }}>🚩</Text>
                      </View>
                      <Text className="text-muted-foreground text-sm">セットプレー</Text>
                    </View>
                  </>
                )}
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
            </TabsContent>

            {/* Tactical Analysis Tab */}
            <TabsContent value="analysis">
              <TacticalInsights
                analysis={tacticalAnalysis}
                loading={analysisLoading}
                error={analysisError}
                homeColor={homeColor}
                awayColor={awayColor}
              />
            </TabsContent>

            {/* Match Summary Tab */}
            <TabsContent value="summary">
              <MatchSummaryView
                summary={matchSummary}
                loading={summaryLoading}
                error={summaryError}
                matchId={id}
                homeColor={homeColor}
                awayColor={awayColor}
              />
            </TabsContent>
          </Tabs>
        </View>
      </ScrollView>
    </View>
  );
}
