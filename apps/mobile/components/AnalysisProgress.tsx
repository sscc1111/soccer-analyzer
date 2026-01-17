import { View, Text, ActivityIndicator } from "react-native";
import { Card, CardContent } from "./ui/card";
import { Progress } from "./ui/progress";
import { ANALYSIS_STEP_INFO, type AnalysisProgress as AnalysisProgressType, type AnalysisStep } from "@soccer/shared";

type Props = {
  progress: AnalysisProgressType | undefined;
  status: "idle" | "queued" | "running" | "partial" | "done" | "error";
  errorMessage?: string;
};

/**
 * Format seconds into human-readable time
 */
function formatTime(seconds: number): string {
  if (seconds < 0) return "計算中...";
  if (seconds < 60) return `約${seconds}秒`;
  const minutes = Math.floor(seconds / 60);
  const remainingSec = seconds % 60;
  if (minutes < 60) {
    return remainingSec > 0 ? `約${minutes}分${remainingSec}秒` : `約${minutes}分`;
  }
  const hours = Math.floor(minutes / 60);
  const remainingMin = minutes % 60;
  return `約${hours}時間${remainingMin}分`;
}

/**
 * Step indicator showing completed/current/pending status
 */
function StepIndicator({ step, currentStep, completedSteps }: {
  step: AnalysisStep;
  currentStep: AnalysisStep;
  completedSteps: AnalysisStep[];
}) {
  const isCompleted = completedSteps.includes(step);
  const isCurrent = step === currentStep;
  const stepInfo = ANALYSIS_STEP_INFO[step];

  return (
    <View className="flex-row items-center py-1">
      <View
        className={`w-3 h-3 rounded-full mr-2 ${
          isCompleted
            ? "bg-green-500"
            : isCurrent
            ? "bg-primary"
            : "bg-muted-foreground/30"
        }`}
      />
      <Text
        className={`text-sm ${
          isCompleted
            ? "text-green-600"
            : isCurrent
            ? "text-primary font-medium"
            : "text-muted-foreground"
        }`}
      >
        {stepInfo.labelJa}
      </Text>
      {isCurrent && <ActivityIndicator size="small" className="ml-2" />}
    </View>
  );
}

/**
 * Get list of completed steps based on current step
 */
function getCompletedSteps(currentStep: AnalysisStep): AnalysisStep[] {
  const allSteps: AnalysisStep[] = [
    "extract_meta",
    "detect_shots",
    "extract_clips",
    "label_clips",
    "build_events",
    "detect_players",
    "classify_teams",
    "detect_ball",
    "detect_events",
    "compute_stats",
  ];
  const currentIndex = allSteps.indexOf(currentStep);
  if (currentIndex <= 0) return [];
  return allSteps.slice(0, currentIndex);
}

/**
 * Analysis progress card component
 * Shows detailed step-by-step progress during analysis
 */
export function AnalysisProgress({ progress, status, errorMessage }: Props) {
  if (status === "idle") {
    return null;
  }

  if (status === "queued") {
    return (
      <Card className="mb-4">
        <CardContent>
          <View className="flex-row items-center">
            <ActivityIndicator size="small" className="mr-2" />
            <Text className="text-foreground">分析待機中...</Text>
          </View>
        </CardContent>
      </Card>
    );
  }

  if (status === "error") {
    return (
      <Card className="mb-4 border-destructive">
        <CardContent>
          <Text className="text-destructive font-medium mb-1">エラーが発生しました</Text>
          {errorMessage && (
            <Text className="text-sm text-muted-foreground">{errorMessage}</Text>
          )}
        </CardContent>
      </Card>
    );
  }

  // P1修正: 片方の動画のみ分析完了時のステータス
  if (status === "partial") {
    return (
      <Card className="mb-4 border-warning">
        <CardContent>
          <View className="flex-row items-center">
            <View className="w-4 h-4 rounded-full bg-amber-500 mr-2" />
            <View className="flex-1">
              <Text className="text-foreground font-medium">一部分析完了</Text>
              <Text className="text-sm text-muted-foreground">
                残りの動画をアップロードすると全体の分析が開始されます
              </Text>
            </View>
          </View>
        </CardContent>
      </Card>
    );
  }

  if (status === "done") {
    return (
      <Card className="mb-4 border-green-500">
        <CardContent>
          <View className="flex-row items-center">
            <View className="w-4 h-4 rounded-full bg-green-500 mr-2" />
            <Text className="text-green-600 font-medium">分析完了</Text>
          </View>
        </CardContent>
      </Card>
    );
  }

  // Running status
  if (!progress) {
    return (
      <Card className="mb-4">
        <CardContent>
          <View className="flex-row items-center">
            <ActivityIndicator size="small" className="mr-2" />
            <Text className="text-foreground">分析を開始しています...</Text>
          </View>
        </CardContent>
      </Card>
    );
  }

  const completedSteps = getCompletedSteps(progress.currentStep);
  const visibleSteps: AnalysisStep[] = [
    "extract_meta",
    "detect_shots",
    "extract_clips",
    "label_clips",
    "build_events",
    "detect_players",
    "classify_teams",
    "detect_ball",
    "detect_events",
    "compute_stats",
  ];

  return (
    <Card className="mb-4">
      <CardContent>
        {/* Header with overall progress */}
        <View className="mb-3">
          <View className="flex-row justify-between items-center mb-2">
            <Text className="text-foreground font-medium">
              {ANALYSIS_STEP_INFO[progress.currentStep].labelJa}
            </Text>
            <Text className="text-muted-foreground text-sm">
              {progress.overallProgress}%
            </Text>
          </View>
          <Progress value={progress.overallProgress} />
        </View>

        {/* Estimated time remaining */}
        {progress.estimatedSecondsRemaining >= 0 && (
          <Text className="text-sm text-muted-foreground mb-3">
            残り時間: {formatTime(progress.estimatedSecondsRemaining)}
          </Text>
        )}

        {/* Step list */}
        <View className="border-t border-border pt-2">
          <Text className="text-xs text-muted-foreground mb-2">処理ステップ</Text>
          {visibleSteps.map((step) => (
            <StepIndicator
              key={step}
              step={step}
              currentStep={progress.currentStep}
              completedSteps={completedSteps}
            />
          ))}
        </View>
      </CardContent>
    </Card>
  );
}
