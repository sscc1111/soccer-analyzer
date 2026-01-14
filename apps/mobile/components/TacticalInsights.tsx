import { View, Text, ActivityIndicator } from "react-native";
import { Card, CardHeader, CardTitle, CardContent, Badge } from "./ui";
import type { TacticalAnalysisDoc } from "@soccer/shared";

type TacticalInsightsProps = {
  analysis: TacticalAnalysisDoc | null;
  loading?: boolean;
  error?: Error | null;
  homeColor?: string;
  awayColor?: string;
};

function TempoBar({ value, max = 20, color }: { value: number; max?: number; color: string }) {
  const percentage = Math.min((value / max) * 100, 100);
  return (
    <View className="h-2 bg-muted rounded-full overflow-hidden">
      <View
        className="h-full rounded-full"
        style={{ width: `${percentage}%`, backgroundColor: color }}
      />
    </View>
  );
}

function PressingIntensityIndicator({ value }: { value: number }) {
  const getLabel = (v: number) => {
    if (v >= 70) return { label: "高", variant: "destructive" as const };
    if (v >= 40) return { label: "中", variant: "warning" as const };
    return { label: "低", variant: "secondary" as const };
  };
  const { label, variant } = getLabel(value);
  return <Badge variant={variant}>{label} ({value}%)</Badge>;
}

function BuildUpStyleBadge({ style }: { style: "short" | "long" | "mixed" }) {
  const labels = {
    short: "ショートパス",
    long: "ロングパス",
    mixed: "ミックス",
  };
  return <Badge variant="outline">{labels[style]}</Badge>;
}

export function TacticalInsights({
  analysis,
  loading,
  error,
  homeColor = "#ef4444",
  awayColor = "#3b82f6",
}: TacticalInsightsProps) {
  if (loading) {
    return (
      <View className="items-center justify-center py-8">
        <ActivityIndicator size="large" color="rgb(99, 102, 241)" />
        <Text className="text-muted-foreground mt-2">戦術分析を読み込み中...</Text>
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

  if (!analysis) {
    return (
      <View className="items-center justify-center py-8">
        <Text className="text-muted-foreground">戦術分析データがありません</Text>
        <Text className="text-muted-foreground text-sm mt-1">
          分析完了後にデータが表示されます
        </Text>
      </View>
    );
  }

  return (
    <View className="gap-4">
      {/* Formations */}
      <Card>
        <CardHeader>
          <CardTitle>フォーメーション</CardTitle>
        </CardHeader>
        <CardContent>
          <View className="flex-row justify-around">
            <View className="items-center">
              <View
                className="w-12 h-12 rounded-full items-center justify-center mb-2"
                style={{ backgroundColor: homeColor }}
              >
                <Text className="text-white font-bold text-lg">H</Text>
              </View>
              <Text className="text-foreground font-bold text-xl">
                {analysis.formation.home}
              </Text>
              <Text className="text-muted-foreground text-sm">ホーム</Text>
            </View>
            <View className="items-center">
              <View
                className="w-12 h-12 rounded-full items-center justify-center mb-2"
                style={{ backgroundColor: awayColor }}
              >
                <Text className="text-white font-bold text-lg">A</Text>
              </View>
              <Text className="text-foreground font-bold text-xl">
                {analysis.formation.away}
              </Text>
              <Text className="text-muted-foreground text-sm">アウェイ</Text>
            </View>
          </View>
        </CardContent>
      </Card>

      {/* Tempo */}
      <Card>
        <CardHeader>
          <CardTitle>テンポ (パス/分)</CardTitle>
        </CardHeader>
        <CardContent>
          <View className="gap-3">
            <View>
              <View className="flex-row justify-between mb-1">
                <Text className="text-muted-foreground text-sm">ホーム</Text>
                <Text className="text-foreground font-medium">
                  {analysis.tempo.home.toFixed(1)}
                </Text>
              </View>
              <TempoBar value={analysis.tempo.home} color={homeColor} />
            </View>
            <View>
              <View className="flex-row justify-between mb-1">
                <Text className="text-muted-foreground text-sm">アウェイ</Text>
                <Text className="text-foreground font-medium">
                  {analysis.tempo.away.toFixed(1)}
                </Text>
              </View>
              <TempoBar value={analysis.tempo.away} color={awayColor} />
            </View>
          </View>
        </CardContent>
      </Card>

      {/* Pressing & Build-up */}
      {(analysis.pressingIntensity || analysis.buildUpStyle) && (
        <Card>
          <CardHeader>
            <CardTitle>プレス強度 & ビルドアップ</CardTitle>
          </CardHeader>
          <CardContent>
            <View className="gap-4">
              {analysis.pressingIntensity && (
                <View className="gap-2">
                  <Text className="text-muted-foreground text-sm font-medium">
                    プレス強度
                  </Text>
                  <View className="flex-row gap-4">
                    <View className="flex-row items-center gap-2">
                      <View
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: homeColor }}
                      />
                      <PressingIntensityIndicator value={analysis.pressingIntensity.home} />
                    </View>
                    <View className="flex-row items-center gap-2">
                      <View
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: awayColor }}
                      />
                      <PressingIntensityIndicator value={analysis.pressingIntensity.away} />
                    </View>
                  </View>
                </View>
              )}
              {analysis.buildUpStyle && (
                <View className="gap-2">
                  <Text className="text-muted-foreground text-sm font-medium">
                    ビルドアップスタイル
                  </Text>
                  <View className="flex-row gap-4">
                    <View className="flex-row items-center gap-2">
                      <View
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: homeColor }}
                      />
                      <BuildUpStyleBadge style={analysis.buildUpStyle.home} />
                    </View>
                    <View className="flex-row items-center gap-2">
                      <View
                        className="w-3 h-3 rounded-full"
                        style={{ backgroundColor: awayColor }}
                      />
                      <BuildUpStyleBadge style={analysis.buildUpStyle.away} />
                    </View>
                  </View>
                </View>
              )}
            </View>
          </CardContent>
        </Card>
      )}

      {/* Attack Patterns */}
      {analysis.attackPatterns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>攻撃パターン</CardTitle>
          </CardHeader>
          <CardContent>
            <View className="flex-row flex-wrap gap-2">
              {analysis.attackPatterns.map((pattern, idx) => (
                <Badge key={idx} variant="default">
                  {pattern}
                </Badge>
              ))}
            </View>
          </CardContent>
        </Card>
      )}

      {/* Defensive Patterns */}
      {analysis.defensivePatterns.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>守備パターン</CardTitle>
          </CardHeader>
          <CardContent>
            <View className="flex-row flex-wrap gap-2">
              {analysis.defensivePatterns.map((pattern, idx) => (
                <Badge key={idx} variant="secondary">
                  {pattern}
                </Badge>
              ))}
            </View>
          </CardContent>
        </Card>
      )}

      {/* Key Insights */}
      {analysis.keyInsights.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>キーインサイト</CardTitle>
          </CardHeader>
          <CardContent>
            <View className="gap-2">
              {analysis.keyInsights.map((insight, idx) => (
                <View key={idx} className="flex-row">
                  <Text className="text-primary mr-2">•</Text>
                  <Text className="text-foreground flex-1">{insight}</Text>
                </View>
              ))}
            </View>
          </CardContent>
        </Card>
      )}
    </View>
  );
}
