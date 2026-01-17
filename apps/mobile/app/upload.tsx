import { useState } from "react";
import { View, Text, TextInput, ActivityIndicator, Pressable, ScrollView } from "react-native";
import { router } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Button, Card, CardContent, Progress, Badge } from "../components/ui";
import { PageHeader } from "../components/PageHeader";
import { toast } from "../components/ui/toast";
import { createMatch, updateMatch, getDefaultSettings } from "../lib/hooks";
import { uploadVideo, type UploadProgress } from "../lib/firebase/storage";
import { getAnonymousUserId } from "../lib/auth/anonymousId";
import type { MatchSettings, ProcessingMode } from "@soccer/shared";
import {
  PROCESSING_MODE_INFO,
  estimateProcessingTime,
  formatEstimatedTime,
} from "@soccer/shared";

type UploadState = "idle" | "selecting" | "uploading" | "done" | "error";

const PROCESSING_MODES: ProcessingMode[] = ["quick", "standard", "detailed"];

export default function UploadScreen() {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [processingMode, setProcessingMode] = useState<ProcessingMode>("standard");
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const handleSelectVideo = async () => {
    setUploadState("selecting");
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];
        setVideoUri(asset.uri);

        // Get video duration from asset metadata
        if (asset.duration) {
          setVideoDuration(Math.floor(asset.duration / 1000));
        }

        setUploadState("idle");
      } else {
        setUploadState("idle");
      }
    } catch (err) {
      setUploadState("error");
      setErrorMsg("Failed to select video");
    }
  };

  const handleUpload = async () => {
    if (!videoUri) {
      toast({ title: "No video selected", variant: "warning" });
      return;
    }

    setUploadState("uploading");
    setErrorMsg(null);

    try {
      // Get or generate anonymous user ID
      const ownerUid = await getAnonymousUserId();

      // Get default settings to apply to new match
      const defaults = await getDefaultSettings();

      // Build initial settings from defaults
      const initialSettings: MatchSettings = {
        processingMode,
      };
      // Apply game format from defaults (critical for 8-player format analysis)
      if (defaults.gameFormat) {
        initialSettings.gameFormat = defaults.gameFormat;
      }
      if (defaults.teamColors) {
        initialSettings.teamColors = defaults.teamColors;
      }
      if (defaults.formation?.shape || defaults.roster?.length) {
        initialSettings.formation = {
          shape: defaults.formation?.shape ?? null,
          assignments: defaults.roster?.map((r) => ({
            jerseyNo: r.jerseyNo,
            role: r.name,
          })),
        };
      }

      // Create match document first
      const matchId = await createMatch({
        ownerUid,
        title: title || "Untitled Match",
        date: date || null,
        analysis: { status: "idle" },
        settings: Object.keys(initialSettings).length > 0 ? initialSettings : undefined,
      });

      // Upload video
      const { storagePath } = await uploadVideo(matchId, videoUri, (p) => {
        setProgress(p);
      });

      // Update match with video info
      await updateMatch(matchId, {
        video: {
          storagePath,
          uploadedAt: new Date().toISOString(),
          durationSec: videoDuration ?? undefined,
        },
      });

      setUploadState("done");
      toast({ title: "作成完了!", variant: "success" });

      // Navigate to match dashboard
      setTimeout(() => {
        router.replace(`/match/${matchId}`);
      }, 500);
    } catch (err: any) {
      setUploadState("error");
      setErrorMsg(err.message || "Upload failed");
      toast({ title: "作成に失敗しました", message: err.message, variant: "error" });
    }
  };

  const handleRetry = () => {
    setUploadState("idle");
    setErrorMsg(null);
    setProgress(null);
  };

  return (
    <View className="flex-1 bg-background">
      <PageHeader title="試合を作成" showBackButton />

      <ScrollView className="flex-1">
        <View className="p-4">
          <Card className="mb-4">
            <CardContent className="pt-4">
              <Text className="text-foreground mb-2">試合タイトル</Text>
              <TextInput
                className="bg-muted border border-border rounded-md px-3 py-2 text-foreground mb-4"
                placeholder="例: vs ブルーイーグルス"
                placeholderTextColor="rgb(170, 170, 170)"
                value={title}
                onChangeText={setTitle}
                editable={uploadState === "idle"}
              />

              <Text className="text-foreground mb-2">試合日</Text>
              <TextInput
                className="bg-muted border border-border rounded-md px-3 py-2 text-foreground mb-4"
                placeholder="YYYY-MM-DD"
                placeholderTextColor="rgb(170, 170, 170)"
                value={date}
                onChangeText={setDate}
                editable={uploadState === "idle"}
              />
            </CardContent>
          </Card>

          <Card className="mb-4">
            <CardContent className="pt-4">
              <Text className="text-foreground mb-3">動画</Text>

              {!videoUri ? (
                <Button
                  variant="outline"
                  onPress={handleSelectVideo}
                  className="w-full"
                >
                  ライブラリから動画を選択
                </Button>
              ) : (
                <View>
                  <View className="flex-row items-center gap-2 mb-2">
                    <Text className="text-success text-sm">動画を選択済み</Text>
                    {videoDuration && (
                      <Badge variant="secondary">
                        {Math.floor(videoDuration / 60)}:{String(videoDuration % 60).padStart(2, "0")}
                      </Badge>
                    )}
                  </View>
                  <Text className="text-muted-foreground text-xs mb-3" numberOfLines={1}>
                    {videoUri.split("/").pop()}
                  </Text>
                  {uploadState === "idle" && (
                    <Button variant="outline" onPress={handleSelectVideo}>
                      動画を変更
                    </Button>
                  )}
                </View>
              )}
            </CardContent>
          </Card>

          {/* Processing Mode Selection */}
          {videoUri && (
            <Card className="mb-4">
              <CardContent className="pt-4">
                <Text className="text-foreground mb-2 font-medium">処理モード</Text>
                <Text className="text-muted-foreground text-sm mb-3">
                  分析品質を選択してください。後で設定から変更できます。
                </Text>

                <View className="gap-2">
                  {PROCESSING_MODES.map((mode) => {
                    const modeInfo = PROCESSING_MODE_INFO[mode];
                    const estimatedMinutes = videoDuration
                      ? estimateProcessingTime(videoDuration, mode)
                      : null;

                    return (
                      <Pressable
                        key={mode}
                        onPress={() => setProcessingMode(mode)}
                        className={`p-3 rounded-lg border ${
                          processingMode === mode
                            ? "bg-primary/10 border-primary"
                            : "bg-muted border-transparent"
                        }`}
                      >
                        <View className="flex-row items-center justify-between mb-1">
                          <Text
                            className={`font-semibold ${
                              processingMode === mode ? "text-primary" : "text-foreground"
                            }`}
                          >
                            {modeInfo.label}
                          </Text>
                          {processingMode === mode && (
                            <Badge variant="default">選択中</Badge>
                          )}
                        </View>

                        <Text className="text-muted-foreground text-xs mb-2">
                          {modeInfo.description}
                        </Text>

                        <View className="flex-row items-center gap-2 flex-wrap">
                          <View className="bg-background/50 px-2 py-0.5 rounded">
                            <Text className="text-xs text-muted-foreground">
                              {modeInfo.fps} FPS
                            </Text>
                          </View>
                          <View className="bg-background/50 px-2 py-0.5 rounded">
                            <Text className="text-xs text-muted-foreground">
                              {modeInfo.accuracy}
                            </Text>
                          </View>
                          {estimatedMinutes !== null && (
                            <View className="bg-background/50 px-2 py-0.5 rounded">
                              <Text className="text-xs font-medium text-primary">
                                {formatEstimatedTime(estimatedMinutes)}
                              </Text>
                            </View>
                          )}
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              </CardContent>
            </Card>
          )}

          {uploadState === "uploading" && progress && (
            <Card className="mb-4">
              <CardContent className="pt-4">
                <Text className="text-foreground mb-2">アップロード中...</Text>
                <Progress value={progress.progress} className="mb-2" />
                <Text className="text-muted-foreground text-sm">
                  {Math.round(progress.progress)}% ({Math.round(progress.bytesTransferred / 1024 / 1024)}MB / {Math.round(progress.totalBytes / 1024 / 1024)}MB)
                </Text>
              </CardContent>
            </Card>
          )}

          {uploadState === "error" && errorMsg && (
            <Card className="mb-4 border-destructive">
              <CardContent className="pt-4">
                <Text className="text-destructive mb-2">エラー</Text>
                <Text className="text-muted-foreground text-sm mb-3">{errorMsg}</Text>
                <Button variant="outline" onPress={handleRetry}>
                  再試行
                </Button>
              </CardContent>
            </Card>
          )}

          {uploadState === "done" && (
            <Card className="mb-4 border-success">
              <CardContent className="pt-4">
                <Text className="text-success">アップロード完了!</Text>
                <Text className="text-muted-foreground text-sm mt-1">
                  試合ダッシュボードに移動中...
                </Text>
              </CardContent>
            </Card>
          )}

          <View className="flex-row gap-3 mt-4 mb-8">
            <Button
              variant="outline"
              onPress={() => router.back()}
              className="flex-1"
            >
              キャンセル
            </Button>
            <Button
              onPress={handleUpload}
              className="flex-1"
              disabled={!videoUri || uploadState === "uploading" || uploadState === "done"}
            >
              {uploadState === "uploading" ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                "作成"
              )}
            </Button>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
