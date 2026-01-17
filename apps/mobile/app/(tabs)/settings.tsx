import { useState, useEffect, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
  Switch,
} from "react-native";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
} from "../../components/ui";
import { PageHeader } from "../../components/PageHeader";
import { toast } from "../../components/ui/toast";
import { useDefaultSettings, useNotifications, useNotificationStatus } from "../../lib/hooks";
import type { DefaultSettings, NotificationSettings } from "../../lib/hooks";
import {
  validateDefaultSettings,
  findDuplicateJerseyNumbers,
  FORMATIONS_BY_FORMAT,
  GAME_FORMAT_INFO,
  type GameFormat,
} from "@soccer/shared";

const COLORS = [
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

function ColorPicker({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string | undefined;
  onChange: (color: string) => void;
}) {
  return (
    <View className="mb-4">
      <Text className="text-foreground mb-2">{label}</Text>
      <View className="flex-row flex-wrap gap-2">
        {COLORS.map((color) => (
          <Pressable
            key={color}
            onPress={() => onChange(color)}
            className={`w-10 h-10 rounded-full border-2 ${
              value === color ? "border-primary" : "border-muted"
            }`}
            style={{ backgroundColor: color }}
          />
        ))}
      </View>
    </View>
  );
}

function NotificationToggle({
  label,
  description,
  value,
  onToggle,
  disabled,
}: {
  label: string;
  description?: string;
  value: boolean;
  onToggle: (value: boolean) => void;
  disabled?: boolean;
}) {
  return (
    <View className="flex-row items-center justify-between py-3 border-b border-border">
      <View className="flex-1 mr-4">
        <Text className={`text-foreground ${disabled ? "opacity-50" : ""}`}>
          {label}
        </Text>
        {description && (
          <Text
            className={`text-muted-foreground text-xs mt-1 ${
              disabled ? "opacity-50" : ""
            }`}
          >
            {description}
          </Text>
        )}
      </View>
      <Switch
        value={value}
        onValueChange={onToggle}
        disabled={disabled}
        trackColor={{ false: "#3f3f46", true: "#6366f1" }}
        thumbColor={value ? "#ffffff" : "#a1a1aa"}
      />
    </View>
  );
}

function NotificationSettingsSection() {
  const { settings, updateSettings, register, isRegistering } = useNotifications();
  const { isGranted, isChecking: checkingStatus } = useNotificationStatus();

  const handleToggle = async (key: keyof NotificationSettings, value: boolean) => {
    await updateSettings({ [key]: value });
  };

  const handleRequestPermission = async () => {
    const token = await register();
    if (token) {
      toast({ title: "通知を有効にしました", variant: "success" });
    } else {
      toast({
        title: "通知の許可が必要です",
        message: "設定アプリから通知を許可してください",
        variant: "warning",
      });
    }
  };

  if (checkingStatus) {
    return (
      <Card className="mb-4">
        <CardHeader>
          <CardTitle>通知設定</CardTitle>
        </CardHeader>
        <CardContent>
          <ActivityIndicator size="small" color="rgb(99, 102, 241)" />
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="mb-4">
      <CardHeader>
        <CardTitle>通知設定</CardTitle>
      </CardHeader>
      <CardContent>
        {!isGranted ? (
          <View>
            <Text className="text-muted-foreground mb-3">
              通知を有効にすると、分析の完了やエラーをお知らせします。
            </Text>
            <Button
              onPress={handleRequestPermission}
              disabled={isRegistering}
            >
              {isRegistering ? (
                <ActivityIndicator size="small" color="white" />
              ) : (
                "通知を有効にする"
              )}
            </Button>
          </View>
        ) : (
          <View>
            <NotificationToggle
              label="通知を有効にする"
              value={settings.enabled}
              onToggle={(v) => handleToggle("enabled", v)}
            />
            <NotificationToggle
              label="分析完了時"
              description="試合の分析が完了したら通知"
              value={settings.onAnalysisComplete}
              onToggle={(v) => handleToggle("onAnalysisComplete", v)}
              disabled={!settings.enabled}
            />
            <NotificationToggle
              label="エラー発生時"
              description="分析中にエラーが発生したら通知"
              value={settings.onAnalysisError}
              onToggle={(v) => handleToggle("onAnalysisError", v)}
              disabled={!settings.enabled}
            />
            <NotificationToggle
              label="レビュー必要時"
              description="低信頼度のイベントがあれば通知"
              value={settings.onReviewNeeded}
              onToggle={(v) => handleToggle("onReviewNeeded", v)}
              disabled={!settings.enabled}
            />
          </View>
        )}
      </CardContent>
    </Card>
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
    const nextNo =
      roster.length > 0 ? Math.max(...roster.map((p) => p.jerseyNo)) + 1 : 1;
    onChange([...roster, { jerseyNo: nextNo }]);
  };

  const updatePlayer = (
    index: number,
    updates: Partial<{ jerseyNo: number; name: string }>
  ) => {
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

/** Default game format if not set */
const DEFAULT_GAME_FORMAT: GameFormat = "eleven";

export default function AppSettingsScreen() {
  const { settings, loading, updateSettings } = useDefaultSettings();

  const [gameFormat, setGameFormat] = useState<GameFormat>(DEFAULT_GAME_FORMAT);
  const [teamColors, setTeamColors] = useState<DefaultSettings["teamColors"]>(
    {}
  );
  const [formation, setFormation] = useState<string | undefined>();
  const [roster, setRoster] = useState<{ jerseyNo: number; name?: string }[]>(
    []
  );
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  // Get available formations based on selected game format
  const availableFormations = useMemo(
    () => FORMATIONS_BY_FORMAT[gameFormat],
    [gameFormat]
  );

  useEffect(() => {
    if (!loading) {
      setGameFormat(settings.gameFormat ?? DEFAULT_GAME_FORMAT);
      setTeamColors(settings.teamColors ?? {});
      setFormation(settings.formation?.shape);
      setRoster(settings.roster ?? []);
    }
  }, [settings, loading]);

  // Reset formation if it's no longer valid for the selected game format
  useEffect(() => {
    if (formation && !availableFormations.includes(formation)) {
      setFormation(availableFormations[0]);
      markChanged();
    }
  }, [gameFormat, availableFormations]);

  const handleSave = async () => {
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

    const settingsToSave = {
      gameFormat,
      teamColors,
      formation: formation ? { shape: formation } : undefined,
      roster,
    };

    // Validate settings before saving
    const validationResult = validateDefaultSettings(settingsToSave);
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
      await updateSettings(settingsToSave);
      toast({ title: "Settings saved", variant: "success" });
      setHasChanges(false);
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

  const markChanged = () => {
    if (!hasChanges) setHasChanges(true);
  };

  if (loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="rgb(99, 102, 241)" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <PageHeader
        title="Team Settings"
        subtitle="Default settings applied to new matches."
      />
      <ScrollView>
        <View className="p-4">

        {/* Game Format */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>試合形式</CardTitle>
          </CardHeader>
          <CardContent>
            <Text className="text-muted-foreground mb-3">
              Select the game format for your team. This affects available formations.
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {(Object.keys(GAME_FORMAT_INFO) as GameFormat[]).map((format) => (
                <Pressable
                  key={format}
                  onPress={() => {
                    setGameFormat(format);
                    markChanged();
                  }}
                  className={`px-4 py-2 rounded-lg ${
                    gameFormat === format ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <Text
                    className={`font-medium ${
                      gameFormat === format
                        ? "text-primary-foreground"
                        : "text-foreground"
                    }`}
                  >
                    {GAME_FORMAT_INFO[format].labelJa}
                  </Text>
                </Pressable>
              ))}
            </View>
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
              value={teamColors?.home}
              onChange={(c) => {
                setTeamColors((prev) => ({ ...prev, home: c }));
                markChanged();
              }}
            />
            <ColorPicker
              label="Opponent (Away)"
              value={teamColors?.away}
              onChange={(c) => {
                setTeamColors((prev) => ({ ...prev, away: c }));
                markChanged();
              }}
            />
          </CardContent>
        </Card>

        {/* Formation */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>Default Formation</CardTitle>
          </CardHeader>
          <CardContent>
            <Text className="text-muted-foreground mb-3">
              Available formations for {GAME_FORMAT_INFO[gameFormat].labelJa}
            </Text>
            <View className="flex-row flex-wrap gap-2">
              {availableFormations.map((f) => (
                <Pressable
                  key={f}
                  onPress={() => {
                    setFormation(f);
                    markChanged();
                  }}
                  className={`px-4 py-2 rounded-lg ${
                    formation === f ? "bg-primary" : "bg-muted"
                  }`}
                >
                  <Text
                    className={`font-medium ${
                      formation === f
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
              Register your team's players. These will be applied to new
              matches.
            </Text>
            <RosterEditor
              roster={roster}
              onChange={(r) => {
                setRoster(r);
                markChanged();
              }}
            />
          </CardContent>
        </Card>

        {/* Notification Settings */}
        <NotificationSettingsSection />

        {/* Save Button */}
        {hasChanges && (
          <Button onPress={handleSave} disabled={saving} className="mb-4">
            {saving ? (
              <ActivityIndicator size="small" color="white" />
            ) : (
              "Save Changes"
            )}
          </Button>
        )}

        {/* App Info */}
        <Card className="mb-4">
          <CardHeader>
            <CardTitle>About</CardTitle>
          </CardHeader>
          <CardContent>
            <View className="flex-row justify-between mb-2">
              <Text className="text-muted-foreground">App Version</Text>
              <Text className="text-foreground">0.0.1</Text>
            </View>
            <View className="flex-row justify-between">
              <Text className="text-muted-foreground">Pipeline Version</Text>
              <Text className="text-foreground">v1</Text>
            </View>
          </CardContent>
        </Card>

        {/* Help */}
        <Card>
          <CardHeader>
            <CardTitle>Help & Tips</CardTitle>
          </CardHeader>
          <CardContent>
            <Text className="text-muted-foreground">
              For best results, record matches from the sideline at mid-field
              height. Ensure good lighting and stable camera position.
            </Text>
          </CardContent>
        </Card>
        </View>
      </ScrollView>
    </View>
  );
}
