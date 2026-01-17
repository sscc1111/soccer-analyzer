import { View, Text, ActivityIndicator } from "react-native";
import { useState, useEffect, useRef } from "react";
import { Card, CardContent } from "./ui/card";
import { Progress } from "./ui/progress";
import { ANALYSIS_STEP_INFO, type AnalysisProgress as AnalysisProgressType, type AnalysisStep } from "@soccer/shared";

type Props = {
  progress: AnalysisProgressType | undefined;
  status: "idle" | "queued" | "running" | "partial" | "done" | "error";
  errorMessage?: string;
};

// エラー表示までの遅延（ミリ秒）- 一時的なエラーを無視するため
const ERROR_DISPLAY_DELAY_MS = 3000;

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
 * Pipeline step definitions
 * The component detects which pipeline is being used based on the current step
 */
const PIPELINE_STEPS = {
  // Hybrid 4-call pipeline (default)
  hybrid: [
    "extract_meta",
    "segment_and_events",
    "scenes_and_players",
    "label_clips_hybrid",
    "summary_and_tactics",
  ] as AnalysisStep[],
  // Consolidated 2-call pipeline
  consolidated: [
    "extract_meta",
    "comprehensive_analysis",
    "summary_and_tactics",
  ] as AnalysisStep[],
};

/**
 * Detect which pipeline is being used based on current step
 */
function detectPipeline(currentStep: AnalysisStep): AnalysisStep[] {
  // Check if current step belongs to consolidated pipeline
  if (currentStep === "comprehensive_analysis") {
    return PIPELINE_STEPS.consolidated;
  }
  // Check if current step belongs to hybrid pipeline
  if (["segment_and_events", "scenes_and_players", "label_clips_hybrid"].includes(currentStep)) {
    return PIPELINE_STEPS.hybrid;
  }
  // Default to hybrid pipeline
  return PIPELINE_STEPS.hybrid;
}

/**
 * Get list of completed steps based on current step
 */
function getCompletedSteps(currentStep: AnalysisStep, pipelineSteps: AnalysisStep[]): AnalysisStep[] {
  const currentIndex = pipelineSteps.indexOf(currentStep);
  if (currentIndex <= 0) return [];
  return pipelineSteps.slice(0, currentIndex);
}

/**
 * Analysis progress card component
 * Shows detailed step-by-step progress during analysis
 */
export function AnalysisProgress({ progress, status, errorMessage }: Props) {
  // エラー表示のデバウンス：一時的なエラーを無視して安定したエラーのみ表示
  const [showError, setShowError] = useState(false);
  const errorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (status === "error") {
      // エラー状態が一定時間続いた場合のみ表示
      errorTimerRef.current = setTimeout(() => {
        setShowError(true);
      }, ERROR_DISPLAY_DELAY_MS);
    } else {
      // エラー以外の状態になったらタイマーをクリアしてエラー表示をリセット
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current);
        errorTimerRef.current = null;
      }
      setShowError(false);
    }

    return () => {
      if (errorTimerRef.current) {
        clearTimeout(errorTimerRef.current);
      }
    };
  }, [status]);

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

  // エラー状態でも、デバウンス中は「分析中」として表示
  if (status === "error" && showError) {
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

  // エラー状態だがデバウンス中の場合は「処理中」として表示
  if (status === "error" && !showError) {
    return (
      <Card className="mb-4">
        <CardContent>
          <View className="flex-row items-center">
            <ActivityIndicator size="small" className="mr-2" />
            <Text className="text-foreground">処理中...</Text>
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

  // Detect pipeline and get completed steps
  const pipelineSteps = detectPipeline(progress.currentStep);
  const completedSteps = getCompletedSteps(progress.currentStep, pipelineSteps);

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
          {pipelineSteps.map((step) => (
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
