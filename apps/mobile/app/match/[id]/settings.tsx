import { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
  Switch,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Button,
  Badge,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogContent,
  DialogFooter,
} from "../../../components/ui";
import { PageHeader } from "../../../components/PageHeader";
import { toast } from "../../../components/ui/toast";
import { useMatch, updateMatch, useDefaultSettings } from "../../../lib/hooks";
import type { MatchSettings, GameFormat, ProcessingMode } from "@soccer/shared";
import {
  validateMatchSettings,
  findDuplicateJerseyNumbers,
  DEFAULT_FIELD_SIZES,
  DEFAULT_MATCH_DURATIONS,
  PROCESSING_MODE_INFO,
  FORMATIONS_BY_FORMAT,
  GAME_FORMAT_INFO,
  estimateProcessingTime,
  formatEstimatedTime,
} from "@soccer/shared";

const ATTACK_DIRECTIONS = [
  { value: "LTR", label: "Left to Right" },
  { value: "RTL", label: "Right to Left" },
] as const;

const CAMERA_POSITIONS = [
  { value: "sideline", label: "Sideline" },
  { value: "goalLine", label: "Goal Line" },
  { value: "corner", label: "Corner" },
  { value: "other", label: "Other" },
] as const;

const ZOOM_HINTS = [
  { value: "near", label: "Near (Close-up)" },
  { value: "mid", label: "Mid (Half field)" },
  { value: "far", label: "Far (Full field)" },
] as const;

/** All game formats for selection */
const GAME_FORMATS = Object.keys(GAME_FORMAT_INFO) as GameFormat[];

const PROCESSING_MODES: ProcessingMode[] = ["quick", "standard", "detailed"];

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | null;
  onChange: (color: string) => void;
}) {
  const colors = [
    "#ef4444", // red
    "#f97316", // orange
    "#eab308", // yellow
    "#22c55e", // green
    "#3b82f6", // blue
    "#8b5cf6", // purple
    "#ec4899", // pink
    "#ffffff", // white
    "#000000", // black
  ];

  return (
    <View className="mb-4">
      <Text className="text-foreground mb-2">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {colors.map((color) => (
          <Pressable
            key={color}
            onPress={() => onChange(color)}
            className={`w-10 h-10 rounded-full border-2 ${
              value === color ? "border-primary" : "border-transparent"
            }`}
            style={{ backgroundColor: color }}
          />
        ))}
      </View>
    </View>
  );
}

function OptionSelector<T extends string>({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: readonly { value: T; label: string }[];
  value: T | null;
  onChange: (value: T) => void;
}) {
  return (
    <View className="mb-4">
      <Text className="text-foreground mb-2">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {options.map((opt) => (
          <Pressable
            key={opt.value}
            onPress={() => onChange(opt.value)}
            className={`px-4 py-2 rounded-lg ${
              value === opt.value ? "bg-primary" : "bg-muted"
            }`}
          >
            <Text
              className={`font-medium ${
                value === opt.value ? "text-primary-foreground" : "text-foreground"
              }`}
            >
              {opt.label}
            </Text>
          </Pressable>
        ))}
      </View>
    </View>
  );
}

function RosterEditor({
  roster,
  onChange,
}: {
  roster: { jerseyNo: number; name?: string }[];
  onChange: (roster: { jerseyNo: number; name?: string }[]) => void;
}) {
  const addPlayer = () => {
    const nextNo = roster.length > 0 ? Math.max(...roster.map((p) => p.jerseyNo)) + 1 : 1;
    onChange([...roster, { jerseyNo: nextNo }]);
  };

  const updatePlayer = (index: number, updates: Partial<{ jerseyNo: number; name: string }>) => {
    const updated = [...roster];
    updated[index] = { ...updated[index], ...updates };
    onChange(updated);
  };

  const removePlayer = (index: number) => {
    onChange(roster.filter((_, i) => i !== index));
  };

  return (
    <View>
      {roster.map((player, idx) => (
        <View key={idx} className="flex-row items-center gap-2 mb-2">
          <TextInput
            className="w-16 bg-muted border border-border rounded-md px-3 py-2 text-foreground text-center"
            placeholder="#"
            placeholderTextColor="rgb(170, 170, 170)"
            value={String(player.jerseyNo)}
            onChangeText={(text) =>
              updatePlayer(idx, { jerseyNo: parseInt(text) || 0 })
            }
            keyboardType="number-pad"
          />
          <TextInput
            className="flex-1 bg-muted border border-border rounded-md px-3 py-2 text-foreground"
            placeholder="Name (optional)"
            placeholderTextColor="rgb(170, 170, 170)"
            value={player.name ?? ""}
            onChangeText={(text) => updatePlayer(idx, { name: text })}
          />
          <Pressable onPress={() => removePlayer(idx)} className="p-2">
            <Text className="text-destructive text-lg">X</Text>
          </Pressable>
        </View>
      ))}
      <Button variant="outline" onPress={addPlayer} className="mt-2">
        + Add Player
      </Button>
    </View>
  );
}

export default function SettingsScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { match, loading } = useMatch(id);
  const { settings: defaultSettings, loading: defaultsLoading } = useDefaultSettings();

  const [settings, setSettings] = useState<MatchSettings>({});
  const [roster, setRoster] = useState<{ jerseyNo: number; name?: string }[]>([]);
  const [saving, setSaving] = useState(false);
  const [confirmDialogOpen, setConfirmDialogOpen] = useState(false);
  const [relabelOnChange, setRelabelOnChange] = useState(false);
  const [usingDefaults, setUsingDefaults] = useState(false);

  // Get available formations based on selected game format
  const currentGameFormat = settings.gameFormat ?? defaultSettings.gameFormat ?? "eleven";
  const availableFormations = useMemo(
    () => FORMATIONS_BY_FORMAT[currentGameFormat],
    [currentGameFormat]
  );

  // Reset formation if it's no longer valid for the selected game format
  useEffect(() => {
    if (settings.formation?.shape && !availableFormations.includes(settings.formation.shape)) {
      setSettings((s) => ({
        ...s,
        formation: { ...s.formation, shape: availableFormations[0] },
      }));
    }
  }, [currentGameFormat, availableFormations]);

  // Load settings: match settings take priority, fallback to defaults
  useEffect(() => {
    if (loading || defaultsLoading) return;

    const hasMatchSettings = match?.settings && Object.keys(match.settings).length > 0;

    if (hasMatchSettings) {
      // Use match-specific settings
      setSettings(match.settings!);
      setRelabelOnChange(match.settings!.relabelOnChange ?? false);
      setUsingDefaults(false);

      if (match.settings!.formation?.assignments) {
        setRoster(
          match.settings!.formation.assignments.map((a) => ({
            jerseyNo: a.jerseyNo,
            name: a.role,
          }))
        );
      }
    } else {
      // Apply defaults from team settings
      setUsingDefaults(true);
      setSettings({
        teamColors: defaultSettings.teamColors,
        formation: {
          ...defaultSettings.formation,
          assignments: defaultSettings.roster?.map((r) => ({
            jerseyNo: r.jerseyNo,
            role: r.name,
          })),
        },
        processingMode: "standard", // Default processing mode
      });
      setRoster(defaultSettings.roster ?? []);
    }
  }, [match, loading, defaultSettings, defaultsLoading]);

  const handleSave = () => {
    // If settings changed significantly, show confirmation
    if (relabelOnChange && match?.analysis?.status === "done") {
      setConfirmDialogOpen(true);
    } else {
      saveSettings();
    }
  };

  const saveSettings = async () => {
    if (!id) return;

    // Check for duplicate jersey numbers
    const duplicates = findDuplicateJerseyNumbers(roster);
    if (duplicates.length > 0) {
      toast({
        title: "Duplicate jersey numbers",
        message: `Jersey numbers ${duplicates.join(", ")} are used more than once`,
        variant: "warning",
      });
      return;
    }

    const updatedSettings: MatchSettings = {
      ...settings,
      relabelOnChange,
      formation: {
        ...settings.formation,
        assignments: roster.map((r) => ({
          jerseyNo: r.jerseyNo,
          role: r.name,
        })),
      },
    };

    // Validate settings before saving
    const validationResult = validateMatchSettings(updatedSettings);
    if (!validationResult.success) {
      const firstError = validationResult.error.issues[0];
      toast({
        title: "Invalid settings",
        message: firstError.message,
        variant: "error",
      });
      return;
    }

    setSaving(true);
    try {
      await updateMatch(id, { settings: updatedSettings });
      toast({ title: "Settings saved", variant: "success" });
      setConfirmDialogOpen(false);
    } catch (err: any) {
      toast({
        title: "Failed to save",
        message: err.message,
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  if (loading || defaultsLoading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="rgb(99, 102, 241)" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <PageHeader
        title="Match Settings"
        subtitle="Fine-tune settings for this specific match."
        showBackButton
      />
      <ScrollView className="flex-1">
        <View className="p-4">
          {usingDefaults && (
          <View className="bg-muted/50 rounded-lg p-3 mb-4 flex-row items-center">
            <Badge variant="secondary" className="mr-2">Defaults</Badge>
            <Text className="text-muted-foreground text-sm flex-1">
              Using team defaults. Save to customize for this match.
            </Text>
          </View>
        )}

        {/* Game Format */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>試合形式</CardTitle>
          </CardHeader>
          <CardContent>
            <Text className="text-foreground mb-2">Number of players per team</Text>
            <View className="flex-row flex-wrap gap-2 mb-4">
              {GAME_FORMATS.map((format) => {
                const formatInfo = GAME_FORMAT_INFO[format];
                return (
                  <Pressable
                    key={format}
                    onPress={() => {
                      const defaults = DEFAULT_MATCH_DURATIONS[format];
                      const fieldDefaults = DEFAULT_FIELD_SIZES[format];
                      setSettings((s) => ({
                        ...s,
                        gameFormat: format,
                        matchDuration: defaults,
                        fieldSize: fieldDefaults,
                      }));
                    }}
                    className={`px-4 py-3 rounded-lg flex-1 min-w-[100px] ${
                      settings.gameFormat === format ? "bg-primary" : "bg-muted"
                    }`}
                  >
                    <Text
                      className={`font-medium text-center ${
                        settings.gameFormat === format
                          ? "text-primary-foreground"
                          : "text-foreground"
                      }`}
                    >
                      {formatInfo.labelJa}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {/* Match Duration */}
            <Text className="text-foreground mb-2 mt-4">Match Duration</Text>
            <View className="flex-row gap-4 mb-4">
              <View className="flex-1">
                <Text className="text-muted-foreground text-sm mb-1">Half duration (min)</Text>
                <TextInput
                  className="bg-muted border border-border rounded-md px-3 py-2 text-foreground"
                  value={String(settings.matchDuration?.halfDuration ?? "")}
                  onChangeText={(text) =>
                    setSettings((s) => ({
                      ...s,
                      matchDuration: {
                        ...s.matchDuration,
                        halfDuration: parseInt(text) || 0,
                        numberOfHalves: s.matchDuration?.numberOfHalves ?? 2,
                      },
                    }))
                  }
                  keyboardType="number-pad"
                  placeholder="45"
                  placeholderTextColor="rgb(170, 170, 170)"
                />
              </View>
              <View className="flex-1">
                <Text className="text-muted-foreground text-sm mb-1">Number of halves</Text>
                <TextInput
                  className="bg-muted border border-border rounded-md px-3 py-2 text-foreground"
                  value={String(settings.matchDuration?.numberOfHalves ?? "")}
                  onChangeText={(text) =>
                    setSettings((s) => ({
                      ...s,
                      matchDuration: {
                        ...s.matchDuration,
                        halfDuration: s.matchDuration?.halfDuration ?? 45,
                        numberOfHalves: parseInt(text) || 2,
                      },
                    }))
                  }
                  keyboardType="number-pad"
                  placeholder="2"
                  placeholderTextColor="rgb(170, 170, 170)"
                />
              </View>
            </View>

            {/* Field Size */}
            <Text className="text-foreground mb-2 mt-4">Field Size (meters)</Text>
            <View className="flex-row gap-4">
              <View className="flex-1">
                <Text className="text-muted-foreground text-sm mb-1">Length</Text>
                <TextInput
                  className="bg-muted border border-border rounded-md px-3 py-2 text-foreground"
                  value={String(settings.fieldSize?.length ?? "")}
                  onChangeText={(text) =>
                    setSettings((s) => ({
                      ...s,
                      fieldSize: {
                        ...s.fieldSize,
                        length: parseInt(text) || 0,
                        width: s.fieldSize?.width ?? 68,
                      },
                    }))
                  }
                  keyboardType="number-pad"
                  placeholder="105"
                  placeholderTextColor="rgb(170, 170, 170)"
                />
              </View>
              <View className="flex-1">
                <Text className="text-muted-foreground text-sm mb-1">Width</Text>
                <TextInput
                  className="bg-muted border border-border rounded-md px-3 py-2 text-foreground"
                  value={String(settings.fieldSize?.width ?? "")}
                  onChangeText={(text) =>
                    setSettings((s) => ({
                      ...s,
                      fieldSize: {
                        ...s.fieldSize,
                        length: s.fieldSize?.length ?? 105,
                        width: parseInt(text) || 0,
                      },
                    }))
                  }
                  keyboardType="number-pad"
                  placeholder="68"
                  placeholderTextColor="rgb(170, 170, 170)"
                />
              </View>
            </View>
          </CardContent>
        </Card>

        {/* Attack Direction */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Attack Direction</CardTitle>
          </CardHeader>
          <CardContent>
            <OptionSelector
              label="Which way is your team attacking?"
              options={ATTACK_DIRECTIONS}
              value={(settings.attackDirection as "LTR" | "RTL") ?? null}
              onChange={(v) =>
                setSettings((s) => ({ ...s, attackDirection: v }))
              }
            />
          </CardContent>
        </Card>

        {/* Team Colors */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Team Colors</CardTitle>
          </CardHeader>
          <CardContent>
            <ColorPicker
              label="Your Team (Home)"
              value={settings.teamColors?.home ?? null}
              onChange={(c) =>
                setSettings((s) => ({
                  ...s,
                  teamColors: { ...s.teamColors, home: c },
                }))
              }
            />
            <ColorPicker
              label="Opponent (Away)"
              value={settings.teamColors?.away ?? null}
              onChange={(c) =>
                setSettings((s) => ({
                  ...s,
                  teamColors: { ...s.teamColors, away: c },
                }))
              }
            />
          </CardContent>
        </Card>

        {/* Camera Position */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Camera Position</CardTitle>
          </CardHeader>
          <CardContent>
            <OptionSelector
              label="Where was the camera positioned?"
              options={CAMERA_POSITIONS}
              value={settings.camera?.position ?? null}
              onChange={(v) =>
                setSettings((s) => ({
                  ...s,
                  camera: { ...s.camera, position: v },
                }))
              }
            />
            <OptionSelector
              label="Zoom Level (how much of the field is visible?)"
              options={ZOOM_HINTS}
              value={(settings.camera?.zoomHint as "near" | "mid" | "far") ?? null}
              onChange={(v) =>
                setSettings((s) => ({
                  ...s,
                  camera: { ...s.camera, zoomHint: v },
                }))
              }
            />
          </CardContent>
        </Card>

        {/* Formation */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Formation</CardTitle>
          </CardHeader>
          <CardContent>
            <Text className="text-muted-foreground mb-3">
              Available formations for {GAME_FORMAT_INFO[currentGameFormat].labelJa}
            </Text>
            <View className="flex-row flex-wrap gap-2 mb-4">
              {availableFormations.map((f) => (
                <Pressable
                  key={f}
                  onPress={() =>
                    setSettings((s) => ({
                      ...s,
                      formation: { ...s.formation, shape: f },
                    }))
                  }
                  className={`px-4 py-2 rounded-lg ${
                    settings.formation?.shape === f ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <Text
                    className={`font-medium ${
                      settings.formation?.shape === f
                        ? "text-primary-foreground"
                        : "text-foreground"
                    }`}
                  >
                    {f}
                  </Text>
                </Pressable>
              ))}
            </View>
          </CardContent>
        </Card>

        {/* Roster */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Player Roster</CardTitle>
          </CardHeader>
          <CardContent>
            <Text className="text-muted-foreground mb-3">
              Add jersey numbers to enable player tracking.
            </Text>
            <RosterEditor roster={roster} onChange={setRoster} />
          </CardContent>
        </Card>

        {/* Processing Mode */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Processing Mode</CardTitle>
          </CardHeader>
          <CardContent>
            <Text className="text-muted-foreground mb-3">
              Choose between speed and accuracy for analysis.
            </Text>
            <View className="gap-3">
              {PROCESSING_MODES.map((mode) => {
                const modeInfo = PROCESSING_MODE_INFO[mode];
                const videoDuration = match?.video?.durationSec ?? 0;
                const estimatedMinutes = videoDuration > 0
                  ? estimateProcessingTime(videoDuration, mode)
                  : null;

                return (
                  <Pressable
                    key={mode}
                    onPress={() =>
                      setSettings((s) => ({ ...s, processingMode: mode }))
                    }
                    className={`p-4 rounded-lg border ${
                      settings.processingMode === mode
                        ? "bg-primary/10 border-primary"
                        : "bg-muted border-transparent"
                    }`}
                  >
                    <View className="flex-row items-center justify-between mb-2">
                      <Text
                        className={`text-lg font-semibold ${
                          settings.processingMode === mode
                            ? "text-primary"
                            : "text-foreground"
                        }`}
                      >
                        {modeInfo.label}
                      </Text>
                      {settings.processingMode === mode && (
                        <Badge variant="default">Selected</Badge>
                      )}
                    </View>

                    <Text className="text-muted-foreground text-sm mb-1">
                      {modeInfo.description}
                    </Text>

                    <View className="flex-row items-center gap-3 mt-2">
                      <View className="bg-background/50 px-2 py-1 rounded">
                        <Text className="text-xs text-muted-foreground">
                          {modeInfo.fps} FPS
                        </Text>
                      </View>
                      <View className="bg-background/50 px-2 py-1 rounded">
                        <Text className="text-xs text-muted-foreground">
                          {modeInfo.accuracy}
                        </Text>
                      </View>
                      {estimatedMinutes !== null && (
                        <View className="bg-background/50 px-2 py-1 rounded">
                          <Text className="text-xs text-muted-foreground">
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

        {/* Relabel Toggle */}
        <Card className="mb-4">
          <CardContent className="py-4">
            <View className="flex-row items-center justify-between">
              <View className="flex-1 mr-4">
                <Text className="text-foreground font-medium">
                  Re-analyze on save
                </Text>
                <Text className="text-muted-foreground text-sm">
                  Relabel clips with updated settings
                </Text>
              </View>
              <Switch
                value={relabelOnChange}
                onValueChange={setRelabelOnChange}
                trackColor={{ true: "rgb(99, 102, 241)" }}
              />
            </View>
          </CardContent>
        </Card>

        {/* Save Button */}
        <Button onPress={handleSave} disabled={saving} className="mb-8">
          {saving ? (
            <ActivityIndicator size="small" color="white" />
          ) : (
            "Save Settings"
          )}
        </Button>
        </View>
      </ScrollView>

      {/* Confirmation Dialog */}
      <Dialog open={confirmDialogOpen} onOpenChange={setConfirmDialogOpen}>
        <DialogHeader>
          <DialogTitle>Re-analyze Match?</DialogTitle>
          <DialogDescription>
            This will trigger a re-analysis of all clips with the updated
            settings. This may take several minutes and incur API costs.
          </DialogDescription>
        </DialogHeader>
        <DialogFooter>
          <Button
            variant="outline"
            onPress={() => setConfirmDialogOpen(false)}
          >
            Cancel
          </Button>
          <Button onPress={saveSettings} disabled={saving}>
            {saving ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              "Confirm & Save"
            )}
          </Button>
        </DialogFooter>
      </Dialog>
    </View>
  );
}
