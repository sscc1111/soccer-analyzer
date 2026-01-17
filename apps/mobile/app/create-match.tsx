import { useState } from "react";
import { View, Text, TextInput, ScrollView, Pressable, ActivityIndicator } from "react-native";
import { router } from "expo-router";
import { Button, Card, CardContent, Badge } from "../components/ui";
import { toast } from "../components/ui/toast";
import { createMatch, getDefaultSettings } from "../lib/hooks";
import { getAnonymousUserId } from "../lib/auth/anonymousId";
import type { MatchSettings, ProcessingMode, VideoConfiguration } from "@soccer/shared";
import { PROCESSING_MODE_INFO } from "@soccer/shared";

const PROCESSING_MODES: ProcessingMode[] = ["quick", "standard", "detailed"];
const VIDEO_CONFIGURATIONS: VideoConfiguration[] = ["single", "split"];

export default function CreateMatchScreen() {
  const [title, setTitle] = useState("");
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [processingMode, setProcessingMode] = useState<ProcessingMode>("standard");
  const [videoConfiguration, setVideoConfiguration] = useState<VideoConfiguration>("single");
  const [isCreating, setIsCreating] = useState(false);

  const handleCreateMatch = async () => {
    if (!title.trim()) {
      toast({ title: "Title is required", variant: "warning" });
      return;
    }

    setIsCreating(true);

    try {
      const ownerUid = await getAnonymousUserId();
      const defaults = await getDefaultSettings();

      // Build initial settings from defaults
      const initialSettings: MatchSettings = {
        processingMode,
        videoConfiguration,
      };

      // Apply game format from defaults
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

      // P1修正: videosUploadedをvideoConfigurationに基づいて初期化
      // これによりUIが正しい初期状態を表示できる
      const videosUploaded =
        videoConfiguration === "split"
          ? { firstHalf: false, secondHalf: false }
          : { single: false };

      // Create match document
      const matchId = await createMatch({
        ownerUid,
        title: title.trim(),
        date: date || null,
        analysis: { status: "idle" },
        settings: Object.keys(initialSettings).length > 0 ? initialSettings : undefined,
        videosUploaded,
        videoCount: 0,
      });

      toast({ title: "Match created!", variant: "success" });

      // Navigate to match detail page
      setTimeout(() => {
        router.replace(`/match/${matchId}`);
      }, 300);
    } catch (err: any) {
      console.error("Failed to create match:", err);
      toast({ title: "Failed to create match", message: err.message, variant: "error" });
      setIsCreating(false);
    }
  };

  return (
    <View className="flex-1 bg-background">
      {/* Header */}
      <View className="p-4 border-b border-border">
        <Text className="text-2xl font-semibold text-foreground">Create Match</Text>
        <Text className="text-muted-foreground text-sm mt-1">
          Set up match details and upload videos later
        </Text>
      </View>

      <ScrollView className="flex-1">
        <View className="p-4">
          {/* Basic Information */}
          <Card className="mb-4">
            <CardContent className="pt-4">
              <Text className="text-foreground mb-2 font-medium">Match Details</Text>

              <Text className="text-foreground text-sm mb-2">Title *</Text>
              <TextInput
                className="bg-muted border border-border rounded-md px-3 py-2 text-foreground mb-4"
                placeholder="e.g., vs Blue Eagles"
                placeholderTextColor="rgb(170, 170, 170)"
                value={title}
                onChangeText={setTitle}
                editable={!isCreating}
              />

              <Text className="text-foreground text-sm mb-2">Date</Text>
              <TextInput
                className="bg-muted border border-border rounded-md px-3 py-2 text-foreground"
                placeholder="YYYY-MM-DD"
                placeholderTextColor="rgb(170, 170, 170)"
                value={date}
                onChangeText={setDate}
                editable={!isCreating}
              />
            </CardContent>
          </Card>

          {/* Video Configuration */}
          <Card className="mb-4">
            <CardContent className="pt-4">
              <Text className="text-foreground mb-2 font-medium">Video Configuration</Text>
              <Text className="text-muted-foreground text-sm mb-3">
                Choose how you will upload match videos
              </Text>

              <View className="gap-2">
                {VIDEO_CONFIGURATIONS.map((config) => (
                  <Pressable
                    key={config}
                    onPress={() => setVideoConfiguration(config)}
                    disabled={isCreating}
                    className={`p-3 rounded-lg border ${
                      videoConfiguration === config
                        ? "bg-primary/10 border-primary"
                        : "bg-muted border-transparent"
                    }`}
                  >
                    <View className="flex-row items-center justify-between mb-1">
                      <Text
                        className={`font-semibold ${
                          videoConfiguration === config ? "text-primary" : "text-foreground"
                        }`}
                      >
                        {config === "single" ? "Single Video" : "Split Videos"}
                      </Text>
                      {videoConfiguration === config && <Badge variant="default">Selected</Badge>}
                    </View>

                    <Text className="text-muted-foreground text-xs">
                      {config === "single"
                        ? "One video containing the entire match"
                        : "Separate videos for first and second half"}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </CardContent>
          </Card>

          {/* Processing Mode */}
          <Card className="mb-4">
            <CardContent className="pt-4">
              <Text className="text-foreground mb-2 font-medium">Processing Mode</Text>
              <Text className="text-muted-foreground text-sm mb-3">
                Choose default analysis quality. You can change this later.
              </Text>

              <View className="gap-2">
                {PROCESSING_MODES.map((mode) => {
                  const modeInfo = PROCESSING_MODE_INFO[mode];

                  return (
                    <Pressable
                      key={mode}
                      onPress={() => setProcessingMode(mode)}
                      disabled={isCreating}
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
                        {processingMode === mode && <Badge variant="default">Selected</Badge>}
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
                      </View>
                    </Pressable>
                  );
                })}
              </View>
            </CardContent>
          </Card>

          {/* Info Card */}
          <Card className="mb-4 border-primary/50">
            <CardContent className="py-3">
              <Text className="text-foreground text-sm mb-1 font-medium">Next Steps</Text>
              <Text className="text-muted-foreground text-xs">
                After creating the match, you can upload videos and configure additional settings like team colors, formation, and player roster.
              </Text>
            </CardContent>
          </Card>

          {/* Actions */}
          <View className="flex-row gap-3 mb-8">
            <Button
              variant="outline"
              onPress={() => router.back()}
              className="flex-1"
              disabled={isCreating}
            >
              Cancel
            </Button>
            <Button
              onPress={handleCreateMatch}
              className="flex-1"
              disabled={isCreating || !title.trim()}
            >
              {isCreating ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                "Create Match"
              )}
            </Button>
          </View>
        </View>
      </ScrollView>
    </View>
  );
}
