import { useState, useRef } from "react";
import {
  View,
  Text,
  ScrollView,
  Pressable,
  ActivityIndicator,
} from "react-native";
import { useLocalSearchParams, router } from "expo-router";
import { Video, ResizeMode } from "expo-av";
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
import {
  usePendingReviews,
  resolveReview,
  correctPassEvent,
  triggerStatsRecalculation,
} from "../../../lib/hooks/usePendingReviews";
import type {
  PendingReviewDoc,
  PassEventDoc,
  PassOutcome,
  TrackDoc,
} from "@soccer/shared";

/**
 * Phase 5.3: Event Correction UI
 *
 * Displays low-confidence pass events for user review.
 * Allows correction of kicker, receiver, and pass outcome.
 */

function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, "0")}`;
}

function getConfidenceVariant(confidence: number) {
  if (confidence >= 0.8) return "success";
  if (confidence >= 0.6) return "warning";
  return "destructive";
}

type CorrectionType = "kicker" | "receiver" | "outcome";

function EventReviewCard({
  review,
  event,
  onReview,
}: {
  review: PendingReviewDoc;
  event: PassEventDoc | null;
  onReview: (review: PendingReviewDoc, event: PassEventDoc | null) => void;
}) {
  if (!event) {
    return (
      <Card className="mb-3 opacity-50">
        <CardContent className="py-3">
          <Text className="text-muted-foreground">
            Event {review.eventId.slice(0, 8)}... - Data not available
          </Text>
        </CardContent>
      </Card>
    );
  }

  const confidence = event.confidence;
  const kickerConfidence = event.kicker.confidence;
  const receiverConfidence = event.receiver?.confidence ?? 0;
  const outcomeConfidence = event.outcomeConfidence;

  return (
    <Pressable onPress={() => onReview(review, event)} className="mb-3">
      <Card className="border-warning">
        <CardContent className="p-3">
          <View className="flex-row items-start justify-between mb-2">
            <View className="flex-1">
              <View className="flex-row items-center gap-2 mb-1">
                <Badge variant={getConfidenceVariant(confidence)}>
                  {Math.round(confidence * 100)}% overall
                </Badge>
                <Badge variant="warning">Needs Review</Badge>
              </View>
              <Text className="text-foreground text-xs">
                {formatTime(event.timestamp)}
              </Text>
            </View>
          </View>

          {/* Event Details */}
          <View className="gap-1 mt-2">
            <View className="flex-row items-center">
              <Text className="text-muted-foreground text-xs w-20">Kicker:</Text>
              <Text className="text-foreground text-xs">
                {event.kicker.trackId.slice(0, 8)}...
              </Text>
              <Badge
                variant={getConfidenceVariant(kickerConfidence)}
                className="ml-2"
              >
                {Math.round(kickerConfidence * 100)}%
              </Badge>
            </View>

            <View className="flex-row items-center">
              <Text className="text-muted-foreground text-xs w-20">Receiver:</Text>
              <Text className="text-foreground text-xs">
                {event.receiver?.trackId
                  ? `${event.receiver.trackId.slice(0, 8)}...`
                  : "None"}
              </Text>
              {event.receiver && (
                <Badge
                  variant={getConfidenceVariant(receiverConfidence)}
                  className="ml-2"
                >
                  {Math.round(receiverConfidence * 100)}%
                </Badge>
              )}
            </View>

            <View className="flex-row items-center">
              <Text className="text-muted-foreground text-xs w-20">Outcome:</Text>
              <Text className="text-foreground text-xs capitalize">
                {event.outcome}
              </Text>
              <Badge
                variant={getConfidenceVariant(outcomeConfidence)}
                className="ml-2"
              >
                {Math.round(outcomeConfidence * 100)}%
              </Badge>
            </View>
          </View>

          {/* Review Reason */}
          <View className="mt-2 pt-2 border-t border-border">
            <Text className="text-muted-foreground text-xs">
              Reason: {review.reason.replace(/_/g, " ")}
            </Text>
          </View>
        </CardContent>
      </Card>
    </Pressable>
  );
}

export default function EventReviewScreen() {
  const { id } = useLocalSearchParams<{ id: string }>();
  const { match, loading: matchLoading } = useMatch(id);
  const { reviews, loading, error, needsReviewCount } = usePendingReviews(id);
  const { tracks, mappings } = useTracks(id);

  const [selectedReview, setSelectedReview] = useState<PendingReviewDoc | null>(
    null
  );
  const [selectedEvent, setSelectedEvent] = useState<PassEventDoc | null>(null);
  const [correctionType, setCorrectionType] = useState<CorrectionType | null>(
    null
  );
  const [saving, setSaving] = useState(false);

  const sheetRef = useRef<BottomSheet>(null);

  const openReviewSheet = (review: PendingReviewDoc, event: PassEventDoc | null) => {
    setSelectedReview(review);
    setSelectedEvent(event);
    setCorrectionType(null);
    sheetRef.current?.snapToIndex(0);
  };

  const closeSheet = () => {
    sheetRef.current?.close();
    setSelectedReview(null);
    setSelectedEvent(null);
    setCorrectionType(null);
  };

  const getTrackLabel = (trackId: string): string => {
    const mapping = mappings.get(trackId);
    if (mapping?.jerseyNumber) {
      return `#${mapping.jerseyNumber}`;
    }
    return `Track ${trackId.slice(0, 8)}`;
  };

  const handleCorrectKicker = async (trackId: string) => {
    if (!selectedEvent || !id) return;

    setSaving(true);
    try {
      await correctPassEvent(id, selectedEvent.eventId, {
        kickerTrackId: trackId,
      });

      if (selectedReview) {
        await resolveReview(id, selectedReview.eventId, {
          selectedTrackId: trackId,
        });
      }

      toast({
        title: "Kicker corrected",
        message: "Event has been updated",
        variant: "success",
      });

      closeSheet();
    } catch (error: any) {
      console.error("Error correcting kicker:", error);
      toast({
        title: "Failed to save correction",
        message: error.message,
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCorrectReceiver = async (trackId: string | null) => {
    if (!selectedEvent || !id) return;

    setSaving(true);
    try {
      await correctPassEvent(id, selectedEvent.eventId, {
        receiverTrackId: trackId,
      });

      if (selectedReview) {
        await resolveReview(id, selectedReview.eventId, {
          selectedTrackId: trackId ?? undefined,
        });
      }

      toast({
        title: "Receiver corrected",
        message: "Event has been updated",
        variant: "success",
      });

      closeSheet();
    } catch (error: any) {
      console.error("Error correcting receiver:", error);
      toast({
        title: "Failed to save correction",
        message: error.message,
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleCorrectOutcome = async (outcome: PassOutcome) => {
    if (!selectedEvent || !id) return;

    setSaving(true);
    try {
      await correctPassEvent(id, selectedEvent.eventId, {
        outcome,
      });

      if (selectedReview) {
        await resolveReview(id, selectedReview.eventId, {
          correctedOutcome: outcome,
        });
      }

      toast({
        title: "Outcome corrected",
        message: "Event has been updated",
        variant: "success",
      });

      closeSheet();
    } catch (error: any) {
      console.error("Error correcting outcome:", error);
      toast({
        title: "Failed to save correction",
        message: error.message,
        variant: "error",
      });
    } finally {
      setSaving(false);
    }
  };

  const handleTriggerRecalculation = async () => {
    if (!id) return;

    try {
      await triggerStatsRecalculation(id);

      toast({
        title: "Recalculation triggered",
        message: "Stats will be updated with corrected events",
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
          Error loading reviews: {error.message}
        </Text>
        <Button onPress={() => router.back()}>Go Back</Button>
      </View>
    );
  }

  // Get available tracks for selection
  const availableTracks = tracks.filter((track) => {
    // Filter tracks that are active around the event time
    if (!selectedEvent) return true;
    return (
      track.startTime <= selectedEvent.timestamp &&
      track.endTime >= selectedEvent.timestamp
    );
  });

  return (
    <View className="flex-1 bg-background">
      <PageHeader
        title="Event Review"
        subtitle="Review and correct low-confidence events"
        showBackButton
      />
      <ScrollView className="flex-1">
        <View className="p-4">
          {/* Summary Card */}
          <Card className="mb-4">
            <CardContent className="py-3 flex-row items-center justify-between">
              <View>
                <Text className="text-muted-foreground text-xs">
                  Events Needing Review
                </Text>
                <Text className="text-foreground text-2xl font-bold">
                  {needsReviewCount}
                </Text>
              </View>
              {needsReviewCount === 0 && (
                <Badge variant="success">All Clear</Badge>
              )}
            </CardContent>
          </Card>

          {/* Recalculate Button */}
          {reviews.length === 0 && (
            <Card className="mb-4 border-primary">
              <CardContent className="py-3">
                <Text className="text-foreground font-medium mb-2">
                  Ready to recalculate
                </Text>
                <Text className="text-muted-foreground text-sm mb-3">
                  All events have been reviewed. Trigger recalculation to update stats.
                </Text>
                <Button onPress={handleTriggerRecalculation}>
                  Recalculate Stats
                </Button>
              </CardContent>
            </Card>
          )}

          {/* Review List */}
          {reviews.length === 0 ? (
            <Card>
              <CardContent className="py-8 items-center">
                <Text className="text-muted-foreground text-center">
                  No events need review at this time.
                </Text>
                <Text className="text-muted-foreground text-sm text-center mt-2">
                  Events with confidence below 60% will appear here.
                </Text>
              </CardContent>
            </Card>
          ) : (
            <View>
              {reviews.map(({ review, event }) => (
                <EventReviewCard
                  key={review.eventId}
                  review={review}
                  event={event}
                  onReview={openReviewSheet}
                />
              ))}
            </View>
          )}
        </View>
      </ScrollView>

      {/* Correction Sheet */}
      <Sheet ref={sheetRef}>
        <SheetHeader>
          <SheetTitle>
            {correctionType === null
              ? "Review Event"
              : correctionType === "kicker"
              ? "Select Kicker"
              : correctionType === "receiver"
              ? "Select Receiver"
              : "Select Outcome"}
          </SheetTitle>
        </SheetHeader>

        {selectedEvent && (
          <View className="mt-4">
            {correctionType === null ? (
              // Main correction menu
              <View>
                <Text className="text-muted-foreground mb-4">
                  What would you like to correct?
                </Text>

                {/* Video Preview (if clip path available) */}
                {/* Note: We'd need clip data to show video */}

                {/* Current Event Info */}
                <Card className="mb-4">
                  <CardContent className="py-3 gap-2">
                    <View className="flex-row justify-between">
                      <Text className="text-muted-foreground text-sm">Time:</Text>
                      <Text className="text-foreground text-sm">
                        {formatTime(selectedEvent.timestamp)}
                      </Text>
                    </View>
                    <View className="flex-row justify-between">
                      <Text className="text-muted-foreground text-sm">Kicker:</Text>
                      <Text className="text-foreground text-sm">
                        {getTrackLabel(selectedEvent.kicker.trackId)}
                      </Text>
                    </View>
                    <View className="flex-row justify-between">
                      <Text className="text-muted-foreground text-sm">Receiver:</Text>
                      <Text className="text-foreground text-sm">
                        {selectedEvent.receiver?.trackId
                          ? getTrackLabel(selectedEvent.receiver.trackId)
                          : "None"}
                      </Text>
                    </View>
                    <View className="flex-row justify-between">
                      <Text className="text-muted-foreground text-sm">Outcome:</Text>
                      <Text className="text-foreground text-sm capitalize">
                        {selectedEvent.outcome}
                      </Text>
                    </View>
                  </CardContent>
                </Card>

                {/* Correction Options */}
                <View className="gap-3">
                  <Button
                    variant="outline"
                    onPress={() => setCorrectionType("kicker")}
                  >
                    Correct Kicker
                  </Button>
                  <Button
                    variant="outline"
                    onPress={() => setCorrectionType("receiver")}
                  >
                    Correct Receiver
                  </Button>
                  <Button
                    variant="outline"
                    onPress={() => setCorrectionType("outcome")}
                  >
                    Correct Outcome
                  </Button>
                  <Button variant="outline" onPress={closeSheet}>
                    Cancel
                  </Button>
                </View>
              </View>
            ) : correctionType === "kicker" ? (
              // Kicker selection
              <View>
                <Text className="text-muted-foreground mb-3">
                  Select the player who kicked the ball:
                </Text>
                <ScrollView className="max-h-96">
                  {availableTracks.map((track) => {
                    const isSelected =
                      track.trackId === selectedEvent.kicker.trackId;
                    return (
                      <Pressable
                        key={track.trackId}
                        onPress={() => handleCorrectKicker(track.trackId)}
                        disabled={saving}
                      >
                        <View
                          className={`p-3 mb-2 rounded-lg border ${
                            isSelected
                              ? "border-primary bg-primary/10"
                              : "border-border bg-muted"
                          }`}
                        >
                          <Text
                            className={`font-medium ${
                              isSelected ? "text-primary" : "text-foreground"
                            }`}
                          >
                            {getTrackLabel(track.trackId)}
                          </Text>
                          <Text className="text-muted-foreground text-xs">
                            {track.frames.length} frames •{" "}
                            {Math.round(track.avgConfidence * 100)}% confidence
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Button
                  variant="outline"
                  onPress={() => setCorrectionType(null)}
                  disabled={saving}
                  className="mt-3"
                >
                  Back
                </Button>
              </View>
            ) : correctionType === "receiver" ? (
              // Receiver selection
              <View>
                <Text className="text-muted-foreground mb-3">
                  Select the player who received the ball (or None):
                </Text>
                <ScrollView className="max-h-96">
                  {/* None option */}
                  <Pressable
                    onPress={() => handleCorrectReceiver(null)}
                    disabled={saving}
                  >
                    <View className="p-3 mb-2 rounded-lg border border-border bg-muted">
                      <Text className="font-medium text-foreground">
                        None (incomplete)
                      </Text>
                    </View>
                  </Pressable>

                  {availableTracks.map((track) => {
                    const isSelected =
                      track.trackId === selectedEvent.receiver?.trackId;
                    return (
                      <Pressable
                        key={track.trackId}
                        onPress={() => handleCorrectReceiver(track.trackId)}
                        disabled={saving}
                      >
                        <View
                          className={`p-3 mb-2 rounded-lg border ${
                            isSelected
                              ? "border-primary bg-primary/10"
                              : "border-border bg-muted"
                          }`}
                        >
                          <Text
                            className={`font-medium ${
                              isSelected ? "text-primary" : "text-foreground"
                            }`}
                          >
                            {getTrackLabel(track.trackId)}
                          </Text>
                          <Text className="text-muted-foreground text-xs">
                            {track.frames.length} frames •{" "}
                            {Math.round(track.avgConfidence * 100)}% confidence
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
                </ScrollView>
                <Button
                  variant="outline"
                  onPress={() => setCorrectionType(null)}
                  disabled={saving}
                  className="mt-3"
                >
                  Back
                </Button>
              </View>
            ) : (
              // Outcome selection
              <View>
                <Text className="text-muted-foreground mb-3">
                  Select the pass outcome:
                </Text>
                <View className="gap-3">
                  <Pressable
                    onPress={() => handleCorrectOutcome("complete")}
                    disabled={saving}
                  >
                    <View className="p-4 rounded-lg border border-border bg-muted">
                      <Text className="font-medium text-foreground mb-1">
                        Complete
                      </Text>
                      <Text className="text-muted-foreground text-xs">
                        Pass successfully received by teammate
                      </Text>
                    </View>
                  </Pressable>

                  <Pressable
                    onPress={() => handleCorrectOutcome("incomplete")}
                    disabled={saving}
                  >
                    <View className="p-4 rounded-lg border border-border bg-muted">
                      <Text className="font-medium text-foreground mb-1">
                        Incomplete
                      </Text>
                      <Text className="text-muted-foreground text-xs">
                        Pass not received by any player
                      </Text>
                    </View>
                  </Pressable>

                  <Pressable
                    onPress={() => handleCorrectOutcome("intercepted")}
                    disabled={saving}
                  >
                    <View className="p-4 rounded-lg border border-border bg-muted">
                      <Text className="font-medium text-foreground mb-1">
                        Intercepted
                      </Text>
                      <Text className="text-muted-foreground text-xs">
                        Pass intercepted by opponent
                      </Text>
                    </View>
                  </Pressable>

                  <Button
                    variant="outline"
                    onPress={() => setCorrectionType(null)}
                    disabled={saving}
                  >
                    Back
                  </Button>
                </View>
              </View>
            )}

            {saving && (
              <View className="absolute inset-0 bg-background/80 items-center justify-center">
                <ActivityIndicator size="large" color="rgb(99, 102, 241)" />
              </View>
            )}
          </View>
        )}
      </Sheet>
    </View>
  );
}
