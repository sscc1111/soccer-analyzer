import React, { useMemo } from "react";
import { View, Text, Dimensions } from "react-native";

/**
 * Standard field dimensions in meters
 */
const FIELD = {
  eleven: { length: 105, width: 68 },
  eight: { length: 68, width: 50 },
  five: { length: 40, width: 20 },
} as const;

type GameFormat = "eleven" | "eight" | "five";

type PlayerMarker = {
  id: string;
  /** Field X position in meters (0 = center) */
  x: number;
  /** Field Y position in meters (0 = center) */
  y: number;
  /** Team identifier */
  team: "home" | "away" | "unknown";
  /** Jersey number if known */
  jerseyNumber?: number;
  /** Whether this is a predicted position (player off-screen) */
  isPredicted?: boolean;
  /** Confidence (0-1), affects opacity for predicted positions */
  confidence?: number;
};

type BallPosition = {
  x: number;
  y: number;
  visible: boolean;
};

type Props = {
  /** Game format determines field size */
  gameFormat?: GameFormat;
  /** Player positions */
  players?: PlayerMarker[];
  /** Ball position */
  ball?: BallPosition;
  /** Home team color */
  homeColor?: string;
  /** Away team color */
  awayColor?: string;
  /** Container height */
  height?: number;
  /** Show jersey numbers */
  showJerseyNumbers?: boolean;
  /** Callback when player is tapped */
  onPlayerTap?: (playerId: string) => void;
};

/**
 * Tactical View Component
 *
 * Renders a 2D top-down view of the soccer pitch with player and ball positions.
 * Positions are in field coordinates (meters from center).
 *
 * @example
 * ```tsx
 * <TacticalView
 *   gameFormat="eleven"
 *   players={[
 *     { id: "1", x: -30, y: 0, team: "home", jerseyNumber: 10 },
 *     { id: "2", x: 30, y: 10, team: "away", jerseyNumber: 9 },
 *   ]}
 *   ball={{ x: 0, y: 0, visible: true }}
 *   homeColor="#ef4444"
 *   awayColor="#3b82f6"
 * />
 * ```
 */
export function TacticalView({
  gameFormat = "eleven",
  players = [],
  ball,
  homeColor = "#ef4444",
  awayColor = "#3b82f6",
  height: containerHeight,
  showJerseyNumbers = true,
  onPlayerTap,
}: Props) {
  const field = FIELD[gameFormat];
  const screenWidth = Dimensions.get("window").width - 32; // padding
  const aspectRatio = field.width / field.length;
  const height = containerHeight || screenWidth * aspectRatio;

  // Calculate scale factors
  const scaleX = screenWidth / field.length;
  const scaleY = height / field.width;

  /**
   * Convert field coordinates (meters) to screen coordinates (pixels)
   */
  const fieldToScreen = useMemo(() => {
    return (fieldX: number, fieldY: number) => ({
      x: (fieldX + field.length / 2) * scaleX,
      y: (field.width / 2 - fieldY) * scaleY,
    });
  }, [field, scaleX, scaleY]);

  return (
    <View
      className="bg-green-600 rounded-lg overflow-hidden"
      style={{ width: screenWidth, height }}
    >
      {/* Field markings */}
      <FieldMarkings
        field={field}
        fieldToScreen={fieldToScreen}
        screenWidth={screenWidth}
        height={height}
      />

      {/* Players */}
      {players.map((player) => {
        const pos = fieldToScreen(player.x, player.y);
        const color =
          player.team === "home"
            ? homeColor
            : player.team === "away"
            ? awayColor
            : "#888888";
        const opacity = player.isPredicted ? (player.confidence ?? 0.5) : 1;

        return (
          <View
            key={player.id}
            style={{
              position: "absolute",
              left: pos.x - 12,
              top: pos.y - 12,
              width: 24,
              height: 24,
              borderRadius: 12,
              backgroundColor: color,
              opacity,
              borderWidth: player.isPredicted ? 2 : 0,
              borderColor: "#ffffff",
              borderStyle: player.isPredicted ? "dashed" : "solid",
              justifyContent: "center",
              alignItems: "center",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.3,
              shadowRadius: 2,
            }}
            onTouchEnd={() => onPlayerTap?.(player.id)}
          >
            {showJerseyNumbers && player.jerseyNumber !== undefined && (
              <Text
                style={{
                  color: "#ffffff",
                  fontSize: 10,
                  fontWeight: "bold",
                }}
              >
                {player.jerseyNumber}
              </Text>
            )}
          </View>
        );
      })}

      {/* Ball */}
      {ball && ball.visible && (() => {
        const ballPos = fieldToScreen(ball.x, ball.y);
        return (
          <View
            style={{
              position: "absolute",
              left: ballPos.x - 6,
              top: ballPos.y - 6,
              width: 12,
              height: 12,
              borderRadius: 6,
              backgroundColor: "#ffffff",
              borderWidth: 1,
              borderColor: "#000000",
              shadowColor: "#000",
              shadowOffset: { width: 0, height: 1 },
              shadowOpacity: 0.5,
              shadowRadius: 2,
            }}
          />
        );
      })()}
    </View>
  );
}

/**
 * Field markings component
 */
function FieldMarkings({
  field,
  fieldToScreen,
  screenWidth,
  height,
}: {
  field: { length: number; width: number };
  fieldToScreen: (x: number, y: number) => { x: number; y: number };
  screenWidth: number;
  height: number;
}) {
  const centerCircleRadius = 9.15;
  const penaltyAreaWidth = 40.32;
  const penaltyAreaDepth = 16.5;
  const goalAreaWidth = 18.32;
  const goalAreaDepth = 5.5;

  return (
    <>
      {/* Outer boundary */}
      <View
        style={{
          position: "absolute",
          left: 2,
          top: 2,
          width: screenWidth - 4,
          height: height - 4,
          borderWidth: 2,
          borderColor: "rgba(255,255,255,0.8)",
        }}
      />

      {/* Center line */}
      <View
        style={{
          position: "absolute",
          left: screenWidth / 2 - 1,
          top: 0,
          width: 2,
          height: height,
          backgroundColor: "rgba(255,255,255,0.8)",
        }}
      />

      {/* Center circle */}
      <View
        style={{
          position: "absolute",
          left: screenWidth / 2 - (centerCircleRadius * 2 * (screenWidth / field.length)) / 2,
          top: height / 2 - (centerCircleRadius * 2 * (height / field.width)) / 2,
          width: centerCircleRadius * 2 * (screenWidth / field.length),
          height: centerCircleRadius * 2 * (height / field.width),
          borderWidth: 2,
          borderColor: "rgba(255,255,255,0.8)",
          borderRadius: 1000,
        }}
      />

      {/* Center spot */}
      <View
        style={{
          position: "absolute",
          left: screenWidth / 2 - 3,
          top: height / 2 - 3,
          width: 6,
          height: 6,
          borderRadius: 3,
          backgroundColor: "rgba(255,255,255,0.8)",
        }}
      />

      {/* Left penalty area */}
      <View
        style={{
          position: "absolute",
          left: 2,
          top: (height - penaltyAreaWidth * (height / field.width)) / 2,
          width: penaltyAreaDepth * (screenWidth / field.length),
          height: penaltyAreaWidth * (height / field.width),
          borderWidth: 2,
          borderColor: "rgba(255,255,255,0.8)",
          borderLeftWidth: 0,
        }}
      />

      {/* Right penalty area */}
      <View
        style={{
          position: "absolute",
          right: 2,
          top: (height - penaltyAreaWidth * (height / field.width)) / 2,
          width: penaltyAreaDepth * (screenWidth / field.length),
          height: penaltyAreaWidth * (height / field.width),
          borderWidth: 2,
          borderColor: "rgba(255,255,255,0.8)",
          borderRightWidth: 0,
        }}
      />

      {/* Left goal area */}
      <View
        style={{
          position: "absolute",
          left: 2,
          top: (height - goalAreaWidth * (height / field.width)) / 2,
          width: goalAreaDepth * (screenWidth / field.length),
          height: goalAreaWidth * (height / field.width),
          borderWidth: 2,
          borderColor: "rgba(255,255,255,0.8)",
          borderLeftWidth: 0,
        }}
      />

      {/* Right goal area */}
      <View
        style={{
          position: "absolute",
          right: 2,
          top: (height - goalAreaWidth * (height / field.width)) / 2,
          width: goalAreaDepth * (screenWidth / field.length),
          height: goalAreaWidth * (height / field.width),
          borderWidth: 2,
          borderColor: "rgba(255,255,255,0.8)",
          borderRightWidth: 0,
        }}
      />
    </>
  );
}

/**
 * Convert tracking data to TacticalView format
 */
export function convertToTacticalViewData(
  tracks: Array<{
    trackId: string;
    position: { x: number; y: number };
    teamId?: "home" | "away" | "unknown";
    jerseyNumber?: number;
    isPredicted?: boolean;
    confidence?: number;
  }>,
  ballPosition?: { x: number; y: number; visible: boolean }
): {
  players: PlayerMarker[];
  ball?: BallPosition;
} {
  return {
    players: tracks.map((track) => ({
      id: track.trackId,
      x: track.position.x,
      y: track.position.y,
      team: track.teamId ?? "unknown",
      jerseyNumber: track.jerseyNumber,
      isPredicted: track.isPredicted,
      confidence: track.confidence,
    })),
    ball: ballPosition,
  };
}
