import { useState, useEffect } from "react";
import { View, Text, ActivityIndicator, Pressable, ScrollView } from "react-native";
import { router, useLocalSearchParams } from "expo-router";
import * as ImagePicker from "expo-image-picker";
import { Button, Card, CardContent, Progress, Badge } from "../../../components/ui";
import { toast } from "../../../components/ui/toast";
import { useMatch, useVideos, createVideoDoc, updateVideoDoc, deleteVideoDoc } from "../../../lib/hooks";
import { uploadVideoToMatch, deleteVideoFromStorage, type UploadProgress } from "../../../lib/firebase/storage";
import type { VideoType, VideoConfiguration, VideosUploadedStatus } from "@soccer/shared";

type UploadState = "idle" | "selecting" | "uploading" | "done" | "error";

// P1修正: 動画フォーマット検証
const SUPPORTED_VIDEO_FORMATS = ["mp4", "mov", "m4v", "avi", "webm"];
const MAX_VIDEO_SIZE_MB = 2000; // 2GB (警告用、ブロックはしない)

function validateVideoFormat(uri: string): { valid: boolean; extension: string } {
  const extension = uri.split(".").pop()?.toLowerCase() ?? "";
  return {
    valid: SUPPORTED_VIDEO_FORMATS.includes(extension),
    extension,
  };
}

type VideoOption = {
  type: VideoType;
  label: string;
  description: string;
  uploaded: boolean;
};

export default function UploadVideoScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { match, loading: matchLoading } = useMatch(id);
  const { videos } = useVideos(id);
  const [selectedType, setSelectedType] = useState<VideoType | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [videoDuration, setVideoDuration] = useState<number | null>(null);
  const [uploadState, setUploadState] = useState<UploadState>("idle");
  const [progress, setProgress] = useState<UploadProgress | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const videoConfiguration: VideoConfiguration =
    match?.settings?.videoConfiguration ?? "single";

  // Determine which video types are already uploaded
  const uploadedStatus: VideosUploadedStatus = match?.videosUploaded ?? {};

  const videoOptions: VideoOption[] =
    videoConfiguration === "split"
      ? [
          {
            type: "firstHalf",
            label: "First Half",
            description: "Upload video for the first half",
            uploaded: uploadedStatus.firstHalf ?? false,
          },
          {
            type: "secondHalf",
            label: "Second Half",
            description: "Upload video for the second half",
            uploaded: uploadedStatus.secondHalf ?? false,
          },
        ]
      : [
          {
            type: "single",
            label: "Full Match",
            description: "Upload single video containing entire match",
            uploaded: uploadedStatus.single ?? false,
          },
        ];

  const handleSelectVideo = async () => {
    if (!selectedType) {
      toast({ title: "Please select which video to upload", variant: "warning" });
      return;
    }

    setUploadState("selecting");
    try {
      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Videos,
        allowsEditing: false,
        quality: 1,
      });

      if (!result.canceled && result.assets[0]) {
        const asset = result.assets[0];

        // P1修正: 動画フォーマット検証
        const formatValidation = validateVideoFormat(asset.uri);
        if (!formatValidation.valid) {
          toast({
            title: "Unsupported video format",
            message: `The file format "${formatValidation.extension}" is not supported. Please use ${SUPPORTED_VIDEO_FORMATS.join(", ")}.`,
            variant: "error",
          });
          setUploadState("idle");
          return;
        }

        // P1修正: ファイルサイズ警告（ブロックはしない）
        if (asset.fileSize && asset.fileSize > MAX_VIDEO_SIZE_MB * 1024 * 1024) {
          toast({
            title: "Large video file",
            message: `This video is ${Math.round(asset.fileSize / 1024 / 1024)}MB. Large files may take longer to upload.`,
            variant: "warning",
          });
        }

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
    if (!videoUri || !selectedType) {
      toast({ title: "No video selected", variant: "warning" });
      return;
    }

    setUploadState("uploading");
    setErrorMsg(null);

    // P0修正: アップロード失敗時のクリーンアップ用に追跡
    let videoId: string | null = null;
    let uploadedStoragePath: string | null = null;

    try {
      // Create video document first
      videoId = await createVideoDoc(id, {
        type: selectedType,
        storagePath: "", // Will be updated after upload
        durationSec: videoDuration ?? undefined,
        analysis: { status: "idle" },
      });

      // Upload video to storage
      const { storagePath } = await uploadVideoToMatch(
        id,
        videoId,
        videoUri,
        selectedType,
        (p) => {
          setProgress(p);
        }
      );
      uploadedStoragePath = storagePath;

      // Update video document with storage path
      await updateVideoDoc(id, videoId, {
        storagePath,
      });

      // Note: match.videosUploaded と videoCount は onVideoDocCreated トリガーで自動更新されるため
      // ここでの更新は不要

      setUploadState("done");
      toast({ title: "Upload complete!", variant: "success" });

      // Navigate back to match detail
      setTimeout(() => {
        router.back();
      }, 500);
    } catch (err: any) {
      // P1修正: アップロード失敗時に孤立したvideoDocとストレージファイルをクリーンアップ
      // クリーンアップは並列実行（どちらか一方が失敗しても続行）
      const cleanupPromises: Promise<void>[] = [];

      if (videoId) {
        cleanupPromises.push(
          deleteVideoDoc(id, videoId)
            .then(() => console.log(`[upload-video] Cleaned up orphaned videoDoc: ${videoId}`))
            .catch((cleanupErr) => console.error(`[upload-video] Failed to cleanup videoDoc:`, cleanupErr))
        );
      }

      if (uploadedStoragePath) {
        cleanupPromises.push(
          deleteVideoFromStorage(uploadedStoragePath)
            .then(() => console.log(`[upload-video] Cleaned up orphaned storage file: ${uploadedStoragePath}`))
            .catch((cleanupErr) => console.error(`[upload-video] Failed to cleanup storage:`, cleanupErr))
        );
      }

      // クリーンアップ完了を待つ（ただしUIブロックは最小限に）
      if (cleanupPromises.length > 0) {
        await Promise.allSettled(cleanupPromises);
      }

      setUploadState("error");
      setErrorMsg(err.message || "Upload failed");
      toast({ title: "Upload failed", message: err.message, variant: "error" });
    }
  };

  const handleRetry = () => {
    setUploadState("idle");
    setErrorMsg(null);
    setProgress(null);
    setVideoUri(null);
    setVideoDuration(null);
  };

  if (matchLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="rgb(99, 102, 241)" />
      </View>
    );
  }

  if (!match) {
    return (
      <View className="flex-1 bg-background items-center justify-center p-4">
        <Text className="text-destructive text-center mb-4">Match not found</Text>
        <Button onPress={() => router.back()}>Go Back</Button>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      {/* Header */}
      <View className="p-4 border-b border-border">
        <Text className="text-2xl font-semibold text-foreground">Upload Video</Text>
        <Text className="text-muted-foreground text-sm mt-1">{match.title}</Text>
      </View>

      <ScrollView className="flex-1">
        <View className="p-4">
          {/* Video Type Selection */}
          <Card className="mb-4">
            <CardContent className="pt-4">
              <Text className="text-foreground mb-2 font-medium">Select Video Type</Text>
              <Text className="text-muted-foreground text-sm mb-3">
                {videoConfiguration === "split"
                  ? "Upload first half and second half separately"
                  : "Upload single video containing the entire match"}
              </Text>

              <View className="gap-2">
                {videoOptions.map((option) => (
                  <Pressable
                    key={option.type}
                    onPress={() => {
                      if (!option.uploaded) {
                        setSelectedType(option.type);
                        // Reset video selection when changing type
                        setVideoUri(null);
                        setVideoDuration(null);
                      }
                    }}
                    disabled={option.uploaded || uploadState === "uploading"}
                    className={`p-3 rounded-lg border ${
                      option.uploaded
                        ? "bg-muted/50 border-transparent opacity-60"
                        : selectedType === option.type
                        ? "bg-primary/10 border-primary"
                        : "bg-muted border-transparent"
                    }`}
                  >
                    <View className="flex-row items-center justify-between mb-1">
                      <Text
                        className={`font-semibold ${
                          option.uploaded
                            ? "text-muted-foreground"
                            : selectedType === option.type
                            ? "text-primary"
                            : "text-foreground"
                        }`}
                      >
                        {option.label}
                      </Text>
                      {option.uploaded ? (
                        <Badge variant="success">Uploaded</Badge>
                      ) : selectedType === option.type ? (
                        <Badge variant="default">Selected</Badge>
                      ) : null}
                    </View>

                    <Text className="text-muted-foreground text-xs">
                      {option.description}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </CardContent>
          </Card>

          {/* Video Selection */}
          {selectedType && (
            <Card className="mb-4">
              <CardContent className="pt-4">
                <Text className="text-foreground mb-3">Video File</Text>

                {!videoUri ? (
                  <Button
                    variant="outline"
                    onPress={handleSelectVideo}
                    className="w-full"
                    disabled={uploadState === "uploading" || uploadState === "selecting"}
                  >
                    {uploadState === "selecting" ? (
                      <View className="flex-row items-center gap-2">
                        <ActivityIndicator size="small" />
                        <Text>Opening Library...</Text>
                      </View>
                    ) : (
                      "Select Video from Library"
                    )}
                  </Button>
                ) : (
                  <View>
                    <View className="flex-row items-center gap-2 mb-2">
                      <Text className="text-success text-sm">Video selected</Text>
                      {videoDuration && (
                        <Badge variant="secondary">
                          {Math.floor(videoDuration / 60)}:
                          {String(videoDuration % 60).padStart(2, "0")}
                        </Badge>
                      )}
                    </View>
                    <Text className="text-muted-foreground text-xs mb-3" numberOfLines={1}>
                      {videoUri.split("/").pop()}
                    </Text>
                    {(uploadState === "idle" || uploadState === "selecting") && (
                      <Button
                        variant="outline"
                        onPress={handleSelectVideo}
                        disabled={uploadState === "selecting"}
                      >
                        {uploadState === "selecting" ? (
                          <View className="flex-row items-center gap-2">
                            <ActivityIndicator size="small" />
                            <Text>Opening Library...</Text>
                          </View>
                        ) : (
                          "Change Video"
                        )}
                      </Button>
                    )}
                  </View>
                )}
              </CardContent>
            </Card>
          )}

          {/* Upload Progress */}
          {uploadState === "uploading" && progress && (
            <Card className="mb-4">
              <CardContent className="pt-4">
                <Text className="text-foreground mb-2">Uploading...</Text>
                <Progress value={progress.progress} className="mb-2" />
                <Text className="text-muted-foreground text-sm">
                  {Math.round(progress.progress)}% (
                  {Math.round(progress.bytesTransferred / 1024 / 1024)}MB /{" "}
                  {Math.round(progress.totalBytes / 1024 / 1024)}MB)
                </Text>
              </CardContent>
            </Card>
          )}

          {/* Error */}
          {uploadState === "error" && errorMsg && (
            <Card className="mb-4 border-destructive">
              <CardContent className="pt-4">
                <Text className="text-destructive mb-2">Error</Text>
                <Text className="text-muted-foreground text-sm mb-3">{errorMsg}</Text>
                <Button variant="outline" onPress={handleRetry}>
                  Retry
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Success */}
          {uploadState === "done" && (
            <Card className="mb-4 border-success">
              <CardContent className="pt-4">
                <Text className="text-success">Upload Complete!</Text>
                <Text className="text-muted-foreground text-sm mt-1">
                  Returning to match dashboard...
                </Text>
              </CardContent>
            </Card>
          )}

          {/* Actions */}
          <View className="flex-row gap-3 mt-4 mb-8">
            <Button
              variant="outline"
              onPress={() => router.back()}
              className="flex-1"
              disabled={uploadState === "uploading"}
            >
              Cancel
            </Button>
            <Button
              onPress={handleUpload}
              className="flex-1"
              disabled={
                !videoUri ||
                !selectedType ||
                uploadState === "uploading" ||
                uploadState === "done"
              }
            >
              {uploadState === "uploading" ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                "Upload"
              )}
            </Button>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
