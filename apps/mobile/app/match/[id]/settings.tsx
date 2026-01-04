import { useState, useEffect } from "react";
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
import { toast } from "../../../components/ui/toast";
import { useMatch, updateMatch, useDefaultSettings } from "../../../lib/hooks";
import type { MatchSettings } from "@soccer/shared";

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

const FORMATIONS = [
  "4-4-2",
  "4-3-3",
  "3-5-2",
  "4-2-3-1",
  "5-3-2",
  "3-4-3",
] as const;

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
        formation: defaultSettings.formation,
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

    setSaving(true);
    try {
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
    <ScrollView className="flex-1 bg-background">
      <View className="p-4">
        <Text className="text-2xl font-semibold text-foreground mb-1">
          Match Settings
        </Text>
        <Text className="text-muted-foreground mb-4">
          Fine-tune settings for this specific match.
        </Text>

        {usingDefaults && (
          <View className="bg-muted/50 rounded-lg p-3 mb-4 flex-row items-center">
            <Badge variant="secondary" className="mr-2">Defaults</Badge>
            <Text className="text-muted-foreground text-sm flex-1">
              Using team defaults. Save to customize for this match.
            </Text>
          </View>
        )}

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
          </CardContent>
        </Card>

        {/* Formation */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Formation</CardTitle>
          </CardHeader>
          <CardContent>
            <Text className="text-foreground mb-2">Team Formation</Text>
            <View className="flex-row flex-wrap gap-2 mb-4">
              {FORMATIONS.map((f) => (
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
    </ScrollView>
  );
}
