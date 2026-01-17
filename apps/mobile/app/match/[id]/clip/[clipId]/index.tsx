import { useState, useEffect, useRef, useMemo } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Video, ResizeMode } from "expo-av";
import { doc, onSnapshot, updateDoc } from "firebase/firestore";
import { db } from "../../../../../lib/firebase/firestore";
import { useStorageUrl } from "../../../../../lib/hooks";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  Dialog,
  DialogHeader,
  DialogTitle,
  DialogContent,
  DialogFooter,
} from "../../../../../components/ui";
import { PageHeader } from "../../../../../components/PageHeader";
import { toast } from "../../../../../components/ui/toast";
import type { ClipDoc, EventDoc, MatchDoc } from "@soccer/shared";

type Player = {
  id: string;
  jerseyNo: number;
  name: string;
};

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function getConfidenceVariant(confidence: number) {
  if (confidence >= 0.8) return "success";
  if (confidence >= 0.5) return "warning";
  return "destructive";
}

export default function ClipDetailScreen() {
  const { id: matchId, clipId } = useLocalSearchParams<{
    id: string;
    clipId: string;
  }>();

  const [match, setMatch] = useState<MatchDoc | null>(null);
  const [clip, setClip] = useState<ClipDoc | null>(null);
  const [event, setEvent] = useState<EventDoc | null>(null);
  const [loading, setLoading] = useState(true);
  const [tagDialogOpen, setTagDialogOpen] = useState(false);
  const [selectedPlayers, setSelectedPlayers] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const videoRef = useRef<Video>(null);

  // Get download URL for clip video
  const { url: videoUrl, loading: videoUrlLoading } = useStorageUrl(clip?.media?.clipPath);

  // Build player roster from match settings
  const players = useMemo<Player[]>(() => {
    const assignments = match?.settings?.formation?.assignments ?? [];
    if (assignments.length === 0) {
      // Default fallback for when no roster is configured
      return Array.from({ length: 11 }, (_, i) => ({
        id: `jersey:${i + 1}`,
        jerseyNo: i + 1,
        name: `#${i + 1}`,
      }));
    }
    return assignments.map((a) => ({
      id: `jersey:${a.jerseyNo}`,
      jerseyNo: a.jerseyNo,
      name: a.role || `#${a.jerseyNo}`,
    }));
  }, [match?.settings?.formation?.assignments]);

  useEffect(() => {
    if (!matchId || !clipId) return;

    // Subscribe to match (for roster)
    const matchRef = doc(db, "matches", matchId);
    const unsubMatch = onSnapshot(matchRef, (snap) => {
      if (snap.exists()) {
        setMatch({ matchId: snap.id, ...snap.data() } as MatchDoc);
      }
    });

    // Subscribe to clip
    const clipRef = doc(db, "matches", matchId, "clips", clipId);
    const unsubClip = onSnapshot(clipRef, (snap) => {
      if (snap.exists()) {
        setClip({ clipId: snap.id, ...snap.data() } as ClipDoc);
      }
      setLoading(false);
    });

    // Subscribe to event (same ID as clip for simplicity)
    const eventRef = doc(db, "matches", matchId, "events", clipId);
    const unsubEvent = onSnapshot(eventRef, (snap) => {
      if (snap.exists()) {
        setEvent({ eventId: snap.id, ...snap.data() } as EventDoc);
        // Set selected players from existing data
        const existingPlayers = (snap.data() as any).involved?.players ?? [];
        setSelectedPlayers(existingPlayers.map((p: any) => p.playerId));
      }
    });

    return () => {
      unsubMatch();
      unsubClip();
      unsubEvent();
    };
  }, [matchId, clipId]);

  const handleTagPlayers = async () => {
    if (!matchId || !clipId) return;

    setSaving(true);
    try {
      const eventRef = doc(db, "matches", matchId, "events", clipId);
      await updateDoc(eventRef, {
        "involved.players": selectedPlayers.map((playerId) => ({
          playerId,
          confidence: 1.0,
        })),
        source: "hybrid",
      });
      toast({ title: "Players tagged successfully", variant: "success" });
      setTagDialogOpen(false);
    } catch (err: any) {
      toast({ title: "Failed to tag players", variant: "error" });
    } finally {
      setSaving(false);
    }
  };

  const togglePlayer = (playerId: string) => {
    setSelectedPlayers((prev) =>
      prev.includes(playerId)
        ? prev.filter((id) => id !== playerId)
        : [...prev, playerId]
    );
  };

  if (loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="rgb(99, 102, 241)" />
      </View>
    );
  }

  if (!clip) {
    return (
      <View className="flex-1 bg-background items-center justify-center p-4">
        <Text className="text-destructive mb-4">Clip not found</Text>
        <Button onPress={() => router.back()}>Go Back</Button>
      </View>
    );
  }

  const label = clip.gemini?.label ?? "unknown";
  const confidence = clip.gemini?.confidence ?? 0;
  const title = clip.gemini?.title ?? `Clip ${formatTime(clip.t0)}`;
  const taggedPlayers = event?.involved?.players ?? [];

  return (
    <View className="flex-1 bg-background">
      <PageHeader
        title={title}
        subtitle={`${formatTime(clip.t0)} - ${formatTime(clip.t1)}`}
        showBackButton
      />
      <ScrollView className="flex-1">
        {/* Video Player */}
        <View className="aspect-video bg-black">
        {videoUrlLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="rgb(99, 102, 241)" />
            <Text className="text-muted-foreground mt-2">Loading video...</Text>
          </View>
        ) : videoUrl ? (
          <Video
            ref={videoRef}
            source={{ uri: videoUrl }}
            style={{ flex: 1 }}
            useNativeControls
            resizeMode={ResizeMode.CONTAIN}
            shouldPlay={false}
          />
        ) : (
          <View className="flex-1 items-center justify-center">
            <Text className="text-muted-foreground">Video not available</Text>
          </View>
        )}
      </View>

        <View className="p-4">
          {/* Header Info */}
          <View className="flex-row items-center gap-2 mb-4">
            <Badge variant="secondary">{label}</Badge>
            <Badge variant={getConfidenceVariant(confidence)}>
              {Math.round(confidence * 100)}% confidence
            </Badge>
          </View>

          {/* Summary */}
        {clip.gemini?.summary && (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Summary</CardTitle>
            </CardHeader>
            <CardContent>
              <Text className="text-foreground">{clip.gemini.summary}</Text>
            </CardContent>
          </Card>
        )}

        {/* Coach Tips */}
        {clip.gemini?.coachTips && clip.gemini.coachTips.length > 0 && (
          <Card className="mb-4">
            <CardHeader>
              <CardTitle>Coach Tips</CardTitle>
            </CardHeader>
            <CardContent>
              {clip.gemini.coachTips.map((tip, idx) => (
                <Text key={idx} className="text-foreground mb-1">
                  • {tip}
                </Text>
              ))}
            </CardContent>
          </Card>
        )}

        {/* Tags */}
        {clip.gemini?.tags && clip.gemini.tags.length > 0 && (
          <View className="flex-row flex-wrap gap-2 mb-4">
            {clip.gemini.tags.map((tag) => (
              <Badge key={tag} variant="outline">
                {tag}
              </Badge>
            ))}
          </View>
        )}

        {/* Player Tagging */}
        <Card className="mb-4">
          <CardHeader>
            <View className="flex-row items-center justify-between">
              <CardTitle>Involved Players</CardTitle>
              <Button
                variant="outline"
                onPress={() => setTagDialogOpen(true)}
              >
                Tag Players
              </Button>
            </View>
          </CardHeader>
          <CardContent>
            {taggedPlayers.length > 0 ? (
              <View className="flex-row flex-wrap gap-2">
                {taggedPlayers.map((p: any) => {
                  const player = players.find((pl) => pl.id === p.playerId);
                  return (
                    <Badge key={p.playerId} variant="default">
                      #{player?.jerseyNo ?? "?"} {player?.name ?? p.playerId}
                    </Badge>
                  );
                })}
              </View>
            ) : (
              <Text className="text-muted-foreground">
                No players tagged yet. Tag players to improve stats accuracy.
              </Text>
            )}
          </CardContent>
        </Card>
        </View>
      </ScrollView>

      {/* Player Tagging Dialog */}
      <Dialog open={tagDialogOpen} onOpenChange={setTagDialogOpen}>
        <DialogHeader>
          <DialogTitle>Tag Involved Players</DialogTitle>
        </DialogHeader>
        <DialogContent>
          <Text className="text-muted-foreground mb-4">
            Select the players involved in this play.
          </Text>
          <View className="gap-2">
            {players.map((player) => (
              <Pressable
                key={player.id}
                onPress={() => togglePlayer(player.id)}
                className={`p-3 rounded-lg border ${
                  selectedPlayers.includes(player.id)
                    ? "border-primary bg-primary/20"
                    : "border-border bg-muted"
                }`}
              >
                <Text
                  className={`font-medium ${
                    selectedPlayers.includes(player.id)
                      ? "text-primary"
                      : "text-foreground"
                  }`}
                >
                  #{player.jerseyNo} {player.name}
                </Text>
              </Pressable>
            ))}
          </View>
        </DialogContent>
        <DialogFooter>
          <Button variant="outline" onPress={() => setTagDialogOpen(false)}>
            Cancel
          </Button>
          <Button onPress={handleTagPlayers} disabled={saving}>
            {saving ? <ActivityIndicator size="small" color="white" /> : "Save"}
          </Button>
        </DialogFooter>
      </Dialog>
    </View>
  );
}
