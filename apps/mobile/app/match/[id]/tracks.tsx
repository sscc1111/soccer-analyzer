import { useState, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  TextInput,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams } from "expo-router";
import BottomSheet from "@gorhom/bottom-sheet";
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  Badge,
  Button,
  Sheet,
  SheetHeader,
  SheetTitle,
} from "../../../components/ui";
import { PageHeader } from "../../../components/PageHeader";
import { toast } from "../../../components/ui/toast";
import { useMatch, useTracks } from "../../../lib/hooks";
import { db } from "../../../lib/firebase/firestore";
import { doc, setDoc, updateDoc, serverTimestamp } from "firebase/firestore";
import type { TrackDoc, TrackPlayerMapping } from "@soccer/shared";

/**
 * Phase 5.2: Jersey Number Confirmation UI
 *
 * Allows users to view detected player tracks and confirm/assign jersey numbers.
 * Unconfirmed tracks (source !== 'manual') are highlighted for review.
 */
export default function TracksScreen() {
  const params = useLocalSearchParams<{ id: string }>();
  // Normalize id to string | null (useLocalSearchParams can return string | string[] | undefined)
  const id = Array.isArray(params.id) ? params.id[0] : params.id ?? null;

  const { match, loading: matchLoading } = useMatch(id);
  const {
    tracks,
    mappings,
    loading,
    error,
    confirmedCount,
    needsReviewCount,
    refetch,
  } = useTracks(id);

  const [saving, setSaving] = useState(false);
  const [selectedTrack, setSelectedTrack] = useState<TrackDoc | null>(null);
  const [jerseyInput, setJerseyInput] = useState("");

  const sheetRef = useRef<BottomSheet>(null);

  const openJerseySelector = (track: TrackDoc) => {
    setSelectedTrack(track);
    const mapping = mappings.get(track.trackId);
    setJerseyInput(mapping?.jerseyNumber?.toString() ?? "");
    sheetRef.current?.snapToIndex(0);
  };

  const saveJerseyNumber = async () => {
    if (!selectedTrack || !id) return;

    const jerseyNumber = parseInt(jerseyInput);
    if (isNaN(jerseyNumber) || jerseyNumber < 1 || jerseyNumber > 99) {
      toast({
        title: "Invalid jersey number",
        message: "Please enter a number between 1 and 99",
        variant: "warning",
      });
      return;
    }

    setSaving(true);
    try {
      const mappingRef = doc(db, "matches", id, "trackMappings", selectedTrack.trackId);
      const existingMapping = mappings.get(selectedTrack.trackId);

      const updatedMapping: TrackPlayerMapping = {
        trackId: selectedTrack.trackId,
        playerId: null, // Will be matched later if roster exists
        jerseyNumber,
        ocrConfidence: existingMapping?.ocrConfidence ?? 0,
        source: "manual", // Manual confirmation
        needsReview: false,
        ocrHistory: existingMapping?.ocrHistory ?? [],
      };

      await setDoc(mappingRef, updatedMapping);

      toast({
        title: "Jersey number saved",
        message: `Track assigned to #${jerseyNumber}`,
        variant: "success",
      });

      sheetRef.current?.close();
      setSelectedTrack(null);
      setJerseyInput("");
    } catch (error: any) {
      console.error("Error saving jersey number:", error);
      toast({
        title: "Failed to save",
        message: error.message,
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const triggerRecalculation = async () => {
    if (!id) return;

    try {
      // Update match to trigger stats recalculation
      const matchRef = doc(db, "matches", id);
      await updateDoc(matchRef, {
        "analysis.lastUpdated": serverTimestamp(),
        "analysis.needsRecalculation": true,
      });

      toast({
        title: "Recalculation triggered",
        message: "Stats will be updated with confirmed jersey numbers",
        variant: "success",
      });
    } catch (error: any) {
      console.error("Error triggering recalculation:", error);
      toast({
        title: "Failed to trigger recalculation",
        message: error.message,
        variant: "error",
      });
    }
  };

  if (matchLoading || loading) {
    return (
      <View className="flex-1 bg-background items-center justify-center">
        <ActivityIndicator size="large" color="rgb(99, 102, 241)" />
      </View>
    );
  }

  if (error) {
    return (
      <View className="flex-1 bg-background items-center justify-center p-4">
        <Text className="text-destructive text-center mb-4">
          Error loading tracks: {error.message}
        </Text>
        <Button onPress={refetch}>Retry</Button>
      </View>
    );
  }

  return (
    <View className="flex-1 bg-background">
      <PageHeader
        title="Player Tracks"
        subtitle="Confirm jersey numbers for detected players"
        showBackButton
      />
      <ScrollView className="flex-1">
        <View className="p-4">
          {/* Summary Cards */}
          <View className="flex-row gap-3 mb-4">
            <Card className="flex-1">
              <CardContent className="py-3">
                <Text className="text-muted-foreground text-xs">Total Tracks</Text>
                <Text className="text-foreground text-2xl font-bold">
                  {tracks.length}
                </Text>
              </CardContent>
            </Card>
            <Card className="flex-1">
              <CardContent className="py-3">
                <Text className="text-muted-foreground text-xs">Confirmed</Text>
                <Text className="text-success text-2xl font-bold">
                  {confirmedCount}
                </Text>
              </CardContent>
            </Card>
            <Card className="flex-1">
              <CardContent className="py-3">
                <Text className="text-muted-foreground text-xs">Needs Review</Text>
                <Text className="text-warning text-2xl font-bold">
                  {needsReviewCount}
                </Text>
              </CardContent>
            </Card>
          </View>

          {/* Recalculate Button */}
          {confirmedCount > 0 && (
            <Card className="mb-4 border-primary">
              <CardContent className="py-3 flex-row items-center justify-between">
                <View className="flex-1 mr-3">
                  <Text className="text-foreground font-medium">
                    Ready to recalculate stats
                  </Text>
                  <Text className="text-muted-foreground text-sm">
                    {confirmedCount} tracks confirmed
                  </Text>
                </View>
                <Button onPress={triggerRecalculation} className="px-4">
                  Recalculate
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Track List */}
          <Card>
            <CardHeader>
              <CardTitle>Detected Tracks</CardTitle>
            </CardHeader>
            <CardContent>
              {tracks.length === 0 ? (
                <Text className="text-muted-foreground text-center py-6">
                  No player tracks detected yet. Analysis may still be in progress.
                </Text>
              ) : (
                <View className="gap-3">
                  {tracks.map((track) => {
                    const mapping = mappings.get(track.trackId);
                    const isConfirmed = mapping?.source === "manual";
                    const needsReview = mapping?.needsReview ?? false;

                    return (
                      <Pressable
                        key={track.trackId}
                        onPress={() => openJerseySelector(track)}
                      >
                        <View
                          className={`p-3 rounded-lg border ${
                            isConfirmed
                              ? "border-success bg-success/5"
                              : needsReview
                              ? "border-warning bg-warning/5"
                              : "border-border bg-muted"
                          }`}
                        >
                          <View className="flex-row items-center justify-between">
                            <View className="flex-1">
                              <View className="flex-row items-center gap-2 mb-1">
                                <Text className="text-foreground font-medium">
                                  Track {track.trackId.slice(0, 8)}
                                </Text>
                                {needsReview && (
                                  <Badge variant="warning">Review</Badge>
                                )}
                                {isConfirmed && (
                                  <Badge variant="success">Confirmed</Badge>
                                )}
                              </View>

                              <Text className="text-muted-foreground text-sm">
                                {(track as any)._frameCount ?? track.frames?.length ?? 0} frames • {" "}
                                {Math.round((track.avgConfidence ?? 0) * 100)}% confidence
                              </Text>

                              <Text className="text-muted-foreground text-xs">
                                {((track.endTime ?? 0) - (track.startTime ?? 0)).toFixed(1)}s duration
                              </Text>
                            </View>

                            <View className="items-end">
                              {mapping?.jerseyNumber ? (
                                <View className="bg-primary rounded-full w-12 h-12 items-center justify-center">
                                  <Text className="text-primary-foreground text-xl font-bold">
                                    {mapping.jerseyNumber}
                                  </Text>
                                </View>
                              ) : (
                                <View className="bg-muted border border-border rounded-full w-12 h-12 items-center justify-center">
                                  <Text className="text-muted-foreground text-lg">?</Text>
                                </View>
                              )}
                            </View>
                          </View>
                        </View>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </CardContent>
          </Card>
        </View>
      </ScrollView>

      {/* Jersey Number Input Sheet */}
      <Sheet ref={sheetRef}>
        <SheetHeader>
          <SheetTitle>Assign Jersey Number</SheetTitle>
        </SheetHeader>

        {selectedTrack && (
          <View className="mt-4">
            <Text className="text-muted-foreground mb-2">
              Track: {selectedTrack.trackId.slice(0, 12)}...
            </Text>
            <Text className="text-muted-foreground text-sm mb-4">
              {(selectedTrack as any)._frameCount ?? selectedTrack.frames?.length ?? 0} frames • {" "}
              {((selectedTrack.endTime ?? 0) - (selectedTrack.startTime ?? 0)).toFixed(1)}s duration
            </Text>

            {/* Jersey Number Input */}
            <Text className="text-foreground mb-2 font-medium">
              Jersey Number
            </Text>
            <TextInput
              className="bg-muted border border-border rounded-md px-4 py-3 text-foreground text-lg mb-4"
              placeholder="Enter number (1-99)"
              placeholderTextColor="rgb(170, 170, 170)"
              value={jerseyInput}
              onChangeText={setJerseyInput}
              keyboardType="number-pad"
              maxLength={2}
              autoFocus
            />

            {/* Quick Number Buttons */}
            <Text className="text-muted-foreground text-sm mb-2">
              Quick select:
            </Text>
            <View className="flex-row flex-wrap gap-2 mb-4">
              {[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((num) => (
                <Pressable
                  key={num}
                  onPress={() => setJerseyInput(String(num))}
                  className="bg-muted border border-border rounded-lg px-4 py-2"
                >
                  <Text className="text-foreground font-medium">{num}</Text>
                </Pressable>
              ))}
            </View>

            {/* Action Buttons */}
            <View className="flex-row gap-3">
              <Button
                variant="outline"
                className="flex-1"
                onPress={() => {
                  sheetRef.current?.close();
                  setSelectedTrack(null);
                  setJerseyInput("");
                }}
              >
                Cancel
              </Button>
              <Button
                className="flex-1"
                onPress={saveJerseyNumber}
                disabled={saving || !jerseyInput}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="white" />
                ) : (
                  "Save"
                )}
              </Button>
            </View>
          </View>
        )}
      </Sheet>
    </View>
  );
}
