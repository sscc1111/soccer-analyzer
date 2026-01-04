import { useState, useEffect } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  TextInput,
  ActivityIndicator,
} from "react-native";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
} from "../../components/ui";
import { toast } from "../../components/ui/toast";
import { useDefaultSettings } from "../../lib/hooks";
import type { DefaultSettings } from "../../lib/hooks";

const FORMATIONS = [
  "4-4-2",
  "4-3-3",
  "3-5-2",
  "4-2-3-1",
  "5-3-2",
  "3-4-3",
] as const;

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

export default function AppSettingsScreen() {
  const { settings, loading, updateSettings } = useDefaultSettings();

  const [teamColors, setTeamColors] = useState<DefaultSettings["teamColors"]>(
    {}
  );
  const [formation, setFormation] = useState<string | undefined>();
  const [roster, setRoster] = useState<{ jerseyNo: number; name?: string }[]>(
    []
  );
  const [saving, setSaving] = useState(false);
  const [hasChanges, setHasChanges] = useState(false);

  useEffect(() => {
    if (!loading) {
      setTeamColors(settings.teamColors ?? {});
      setFormation(settings.formation?.shape);
      setRoster(settings.roster ?? []);
    }
  }, [settings, loading]);

  const handleSave = async () => {
    setSaving(true);
    try {
      await updateSettings({
        teamColors,
        formation: formation ? { shape: formation } : undefined,
        roster,
      });
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
    <ScrollView className="flex-1 bg-background">
      <View className="p-4">
        <Text className="text-2xl font-semibold text-foreground mb-1">
          Team Settings
        </Text>
        <Text className="text-muted-foreground mb-6">
          Default settings applied to new matches.
        </Text>

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
            <View className="flex-row flex-wrap gap-2">
              {FORMATIONS.map((f) => (
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
  );
}
