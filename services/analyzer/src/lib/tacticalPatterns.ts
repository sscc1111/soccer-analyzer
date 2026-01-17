/**
 * Tactical Pattern Detection
 *
 * Position-based tactical pattern detection for attack and defense analysis.
 * Implements Section 6.2 of ACCURACY_IMPROVEMENT_PLAN.md
 *
 * Features:
 * - Attack pattern detection (サイド攻撃 vs 中央突破, カウンター攻撃)
 * - Defense pattern detection (ハイプレス vs リトリート)
 * - Zone-based analysis
 * - Counter-attack identification
 */

import type { Point2D, TeamId, PassEventDoc, ShotEventDoc, TurnoverEventDoc } from "@soccer/shared";

/**
 * Attack zone classification based on Y-axis position
 */
export type AttackZone = "left" | "center" | "right";

/**
 * Press height classification based on turnover position
 */
export type PressHeight = "high" | "mid" | "low";

/**
 * Build-up speed classification
 */
export type BuildUpSpeed = "slow" | "moderate" | "fast";

/**
 * Dominant attack pattern
 */
export type AttackPattern = "side_attack" | "central_penetration" | "balanced";

/**
 * Recovery zone for defensive actions
 */
export type RecoveryZone = "attacking_third" | "middle_third" | "defensive_third";

/**
 * Counter-attack event
 */
export interface CounterAttackEvent {
  /** Turnover timestamp that started the counter */
  turnoverTimestamp: number;
  /** Shot timestamp that ended the counter */
  shotTimestamp: number;
  /** Team that executed the counter */
  team: TeamId;
  /** Duration in seconds */
  duration: number;
  /** Turnover position */
  turnoverPosition?: Point2D;
  /** Shot position */
  shotPosition?: Point2D;
  /** Distance traveled (meters) */
  distanceTraveled?: number;
  /** Shot result */
  shotResult?: string;
}

/**
 * Attack pattern analysis result
 */
export interface AttackPatternResult {
  /** Distribution of attacks by zone (percentages) */
  zoneDistribution: {
    left: number;
    center: number;
    right: number;
  };
  /** Detected counter-attacks */
  counterAttacks: CounterAttackEvent[];
  /** Average build-up speed */
  buildUpSpeed: BuildUpSpeed;
  /** Dominant attack pattern */
  dominantPattern: AttackPattern;
  /** Average passes per possession */
  averagePassesPerPossession: number;
  /** Pass completion rate */
  passCompletionRate: number;
}

/**
 * Defense pattern analysis result
 */
export interface DefensePatternResult {
  /** Pressing height classification */
  pressHeight: PressHeight;
  /** Average turnover position in field coordinates */
  averageTurnoverPosition: Point2D;
  /** Pressing intensity (0-100) */
  pressIntensity: number;
  /** Zone where most turnovers are won */
  recoveryZone: RecoveryZone;
  /** Turnovers won in attacking third */
  turnoversInAttackingThird: number;
  /** Turnovers won in middle third */
  turnoversInMiddleThird: number;
  /** Turnovers won in defensive third */
  turnoversInDefensiveThird: number;
}

/**
 * Team tactical patterns
 */
export interface TeamTacticalPatterns {
  team: TeamId;
  attack: AttackPatternResult;
  defense: DefensePatternResult;
}

/**
 * Classify attack zone based on Y-axis position
 *
 * @param position - Position in normalized coordinates (0-1)
 * @returns Attack zone classification
 */
export function classifyAttackZone(position: Point2D | undefined): AttackZone {
  if (!position) {
    return "center";
  }

  // Y-axis zones:
  // Left: 0 - 0.33
  // Center: 0.33 - 0.67
  // Right: 0.67 - 1.0
  if (position.y < 0.33) {
    return "left";
  } else if (position.y > 0.67) {
    return "right";
  } else {
    return "center";
  }
}

/**
 * Classify field third based on X-axis position for a given team
 *
 * @param position - Position in normalized coordinates (0-1)
 * @param team - Team (determines attack direction)
 * @returns Field third classification
 */
export function classifyFieldThird(position: Point2D | undefined, team: TeamId): RecoveryZone {
  if (!position) {
    return "middle_third";
  }

  // For home team (attacks left to right):
  // - Defensive third: x < 0.33
  // - Middle third: 0.33 <= x <= 0.67
  // - Attacking third: x > 0.67
  //
  // For away team (attacks right to left): inverse
  const threshold1 = 0.33;
  const threshold2 = 0.67;

  if (team === "home") {
    if (position.x < threshold1) {
      return "defensive_third";
    } else if (position.x > threshold2) {
      return "attacking_third";
    } else {
      return "middle_third";
    }
  } else {
    // Away team
    if (position.x > threshold2) {
      return "defensive_third";
    } else if (position.x < threshold1) {
      return "attacking_third";
    } else {
      return "middle_third";
    }
  }
}

/**
 * Calculate Euclidean distance between two points (meters)
 *
 * @param pos1 - First position (normalized 0-1)
 * @param pos2 - Second position (normalized 0-1)
 * @returns Distance in meters
 */
function calculateDistance(pos1: Point2D | undefined, pos2: Point2D | undefined): number {
  if (!pos1 || !pos2) {
    return 0;
  }

  // Field dimensions: 105m x 68m
  const fieldLength = 105;
  const fieldWidth = 68;

  const dx = (pos2.x - pos1.x) * fieldLength;
  const dy = (pos2.y - pos1.y) * fieldWidth;

  return Math.sqrt(dx * dx + dy * dy);
}

/**
 * Detect counter-attacks
 *
 * Counter-attack criteria:
 * - Turnover (won) → Shot within 10 seconds
 * - Minimum distance traveled: 20 meters
 * - Shot should be in attacking third
 *
 * @param turnoverEvents - All turnover events
 * @param shotEvents - All shot events
 * @returns List of detected counter-attacks
 */
export function detectCounterAttacks(
  turnoverEvents: TurnoverEventDoc[],
  shotEvents: ShotEventDoc[]
): CounterAttackEvent[] {
  const counterAttacks: CounterAttackEvent[] = [];

  // Only consider turnovers won
  const turnoversWon = turnoverEvents.filter((t) => t.turnoverType === "won");

  for (const turnover of turnoversWon) {
    const turnoverTime = turnover.timestamp;
    const team = turnover.player.teamId;

    // Find shots by the same team within 10 seconds
    const potentialCounterShots = shotEvents.filter(
      (shot) =>
        shot.team === team &&
        shot.timestamp >= turnoverTime &&
        shot.timestamp - turnoverTime <= 10
    );

    for (const shot of potentialCounterShots) {
      const duration = shot.timestamp - turnoverTime;
      const turnoverPos = turnover.player.position;
      const shotPos = shot.position;

      // Calculate distance traveled
      const distance = calculateDistance(turnoverPos, shotPos);

      // Counter-attack should involve significant distance (>20m)
      if (distance >= 20) {
        // Shot should be in attacking third
        const shotThird = classifyFieldThird(shotPos, team);
        if (shotThird === "attacking_third") {
          counterAttacks.push({
            turnoverTimestamp: turnoverTime,
            shotTimestamp: shot.timestamp,
            team,
            duration,
            turnoverPosition: turnoverPos,
            shotPosition: shotPos,
            distanceTraveled: distance,
            shotResult: shot.result,
          });

          // Only count the first shot as part of this counter-attack
          break;
        }
      }
    }
  }

  return counterAttacks;
}

/**
 * Detect attack patterns for a team
 *
 * @param passEvents - Pass events for the team
 * @param shotEvents - Shot events for the team
 * @param counterAttacks - Detected counter-attacks for the team
 * @returns Attack pattern analysis
 */
export function detectAttackPatterns(
  passEvents: PassEventDoc[],
  shotEvents: ShotEventDoc[],
  counterAttacks: CounterAttackEvent[]
): AttackPatternResult {
  // Count events by zone
  let leftCount = 0;
  let centerCount = 0;
  let rightCount = 0;

  // Analyze pass positions
  for (const pass of passEvents) {
    const zone = classifyAttackZone(pass.kicker.position);
    if (zone === "left") leftCount++;
    else if (zone === "center") centerCount++;
    else rightCount++;
  }

  // Analyze shot positions (weighted more heavily)
  const shotWeight = 3;
  for (const shot of shotEvents) {
    const zone = classifyAttackZone(shot.position);
    if (zone === "left") leftCount += shotWeight;
    else if (zone === "center") centerCount += shotWeight;
    else rightCount += shotWeight;
  }

  // Calculate percentages
  const total = leftCount + centerCount + rightCount;
  const zoneDistribution = total > 0
    ? {
        left: Math.round((leftCount / total) * 100),
        center: Math.round((centerCount / total) * 100),
        right: Math.round((rightCount / total) * 100),
      }
    : { left: 33, center: 34, right: 33 };

  // Determine dominant pattern
  let dominantPattern: AttackPattern = "balanced";
  const maxZone = Math.max(zoneDistribution.left, zoneDistribution.center, zoneDistribution.right);
  const isBalanced = maxZone < 45; // Less than 45% in any zone

  if (!isBalanced) {
    if (zoneDistribution.center === maxZone) {
      dominantPattern = "central_penetration";
    } else {
      dominantPattern = "side_attack";
    }
  }

  // Calculate build-up speed based on passes per possession
  // Fast: < 3 passes per shot
  // Moderate: 3-6 passes per shot
  // Slow: > 6 passes per shot
  const passesPerShot = shotEvents.length > 0 ? passEvents.length / shotEvents.length : 10;
  let buildUpSpeed: BuildUpSpeed = "moderate";
  if (passesPerShot < 3) {
    buildUpSpeed = "fast";
  } else if (passesPerShot > 6) {
    buildUpSpeed = "slow";
  }

  // Calculate pass completion rate
  const completedPasses = passEvents.filter((p) => p.outcome === "complete").length;
  const passCompletionRate = passEvents.length > 0
    ? Math.round((completedPasses / passEvents.length) * 100)
    : 0;

  // Average passes per possession (approximation)
  // Use pass chains as proxy for possessions
  const averagePassesPerPossession = passesPerShot;

  return {
    zoneDistribution,
    counterAttacks,
    buildUpSpeed,
    dominantPattern,
    averagePassesPerPossession,
    passCompletionRate,
  };
}

/**
 * Calculate press height based on average turnover X position
 *
 * High press: Average turnover in attacking third (team-relative)
 * Mid press: Average turnover in middle third
 * Low press: Average turnover in defensive third
 *
 * @param turnoverEvents - Turnover events (won by the team)
 * @param team - Team
 * @returns Press height classification
 */
export function calculatePressHeight(turnoverEvents: TurnoverEventDoc[], team: TeamId): PressHeight {
  const turnoversWon = turnoverEvents.filter((t) => t.turnoverType === "won");

  if (turnoversWon.length === 0) {
    return "mid";
  }

  // Calculate average X position (team-relative)
  let totalX = 0;
  let count = 0;

  for (const turnover of turnoversWon) {
    const pos = turnover.player.position;
    if (pos) {
      // Convert to team-relative coordinate (0 = own goal, 1 = opponent goal)
      const teamRelativeX = team === "home" ? pos.x : 1 - pos.x;
      totalX += teamRelativeX;
      count++;
    }
  }

  if (count === 0) {
    return "mid";
  }

  const avgX = totalX / count;

  // High press: > 0.67 (attacking third)
  // Mid press: 0.33 - 0.67 (middle third)
  // Low press: < 0.33 (defensive third)
  if (avgX > 0.67) {
    return "high";
  } else if (avgX < 0.33) {
    return "low";
  } else {
    return "mid";
  }
}

/**
 * Detect defensive patterns for a team
 *
 * @param turnoverEvents - All turnover events
 * @param team - Team to analyze
 * @returns Defense pattern analysis
 */
export function detectDefensivePatterns(
  turnoverEvents: TurnoverEventDoc[],
  team: TeamId
): DefensePatternResult {
  // Only analyze turnovers won by this team
  const turnoversWon = turnoverEvents.filter(
    (t) => t.player.teamId === team && t.turnoverType === "won"
  );

  // Calculate average turnover position
  let totalX = 0;
  let totalY = 0;
  let count = 0;

  for (const turnover of turnoversWon) {
    const pos = turnover.player.position;
    if (pos) {
      totalX += pos.x;
      totalY += pos.y;
      count++;
    }
  }

  const averageTurnoverPosition: Point2D = count > 0
    ? { x: totalX / count, y: totalY / count }
    : { x: 0.5, y: 0.5 };

  // Calculate press height
  const pressHeight = calculatePressHeight(turnoverEvents, team);

  // Count turnovers by third
  let turnoversInAttackingThird = 0;
  let turnoversInMiddleThird = 0;
  let turnoversInDefensiveThird = 0;

  for (const turnover of turnoversWon) {
    const third = classifyFieldThird(turnover.player.position, team);
    if (third === "attacking_third") {
      turnoversInAttackingThird++;
    } else if (third === "middle_third") {
      turnoversInMiddleThird++;
    } else {
      turnoversInDefensiveThird++;
    }
  }

  // Determine recovery zone (where most turnovers happen)
  let recoveryZone: RecoveryZone = "middle_third";
  const maxTurnovers = Math.max(
    turnoversInAttackingThird,
    turnoversInMiddleThird,
    turnoversInDefensiveThird
  );

  if (maxTurnovers === turnoversInAttackingThird && turnoversInAttackingThird > 0) {
    recoveryZone = "attacking_third";
  } else if (maxTurnovers === turnoversInDefensiveThird && turnoversInDefensiveThird > 0) {
    recoveryZone = "defensive_third";
  }

  // Calculate press intensity (0-100)
  // Based on:
  // - Percentage of turnovers in attacking third (50% weight)
  // - Total turnovers per minute (50% weight - normalized to 0-10 range)
  const totalTurnovers = turnoversWon.length;
  const attackingThirdPercentage = totalTurnovers > 0
    ? (turnoversInAttackingThird / totalTurnovers) * 100
    : 0;

  // Assume average match has ~15-20 turnovers won per team
  // High intensity: 25+, Low intensity: <10
  const turnoverIntensity = Math.min(100, (totalTurnovers / 25) * 100);

  const pressIntensity = Math.round(
    attackingThirdPercentage * 0.5 + turnoverIntensity * 0.5
  );

  return {
    pressHeight,
    averageTurnoverPosition,
    pressIntensity,
    recoveryZone,
    turnoversInAttackingThird,
    turnoversInMiddleThird,
    turnoversInDefensiveThird,
  };
}

/**
 * Analyze tactical patterns for a team
 *
 * @param team - Team to analyze
 * @param passEvents - All pass events
 * @param shotEvents - All shot events
 * @param turnoverEvents - All turnover events
 * @returns Complete tactical pattern analysis
 */
export function analyzeTeamTacticalPatterns(
  team: TeamId,
  passEvents: PassEventDoc[],
  shotEvents: ShotEventDoc[],
  turnoverEvents: TurnoverEventDoc[]
): TeamTacticalPatterns {
  // Filter events by team
  const teamPasses = passEvents.filter((p) => p.kicker.teamId === team);
  const teamShots = shotEvents.filter((s) => s.team === team);

  // Detect counter-attacks for this team
  const counterAttacks = detectCounterAttacks(turnoverEvents, shotEvents).filter(
    (ca) => ca.team === team
  );

  // Analyze attack patterns
  const attack = detectAttackPatterns(teamPasses, teamShots, counterAttacks);

  // Analyze defense patterns
  const defense = detectDefensivePatterns(turnoverEvents, team);

  return {
    team,
    attack,
    defense,
  };
}

/**
 * Generate tactical pattern summary text
 *
 * @param patterns - Team tactical patterns
 * @param teamName - Team name (e.g., "Home", "Away")
 * @returns Human-readable summary
 */
export function generateTacticalSummary(
  patterns: TeamTacticalPatterns,
  teamName: string
): string {
  const { attack, defense } = patterns;

  const attackSummary = [];

  // Attack pattern
  if (attack.dominantPattern === "side_attack") {
    attackSummary.push(`${teamName}はサイド攻撃を重視`);
  } else if (attack.dominantPattern === "central_penetration") {
    attackSummary.push(`${teamName}は中央突破を重視`);
  } else {
    attackSummary.push(`${teamName}はバランスの取れた攻撃`);
  }

  // Zone details
  if (attack.zoneDistribution.left > 40) {
    attackSummary.push(`左サイド重視（${attack.zoneDistribution.left}%）`);
  } else if (attack.zoneDistribution.right > 40) {
    attackSummary.push(`右サイド重視（${attack.zoneDistribution.right}%）`);
  }

  // Build-up speed
  if (attack.buildUpSpeed === "fast") {
    attackSummary.push("速攻型のビルドアップ");
  } else if (attack.buildUpSpeed === "slow") {
    attackSummary.push("ポゼッション重視のビルドアップ");
  }

  // Counter-attacks
  if (attack.counterAttacks.length > 3) {
    attackSummary.push(`カウンター攻撃が${attack.counterAttacks.length}回検出`);
  }

  // Defense summary
  const defenseSummary = [];

  // Press height
  if (defense.pressHeight === "high") {
    defenseSummary.push("ハイプレス戦術を採用");
  } else if (defense.pressHeight === "low") {
    defenseSummary.push("リトリート守備を採用");
  } else {
    defenseSummary.push("ミッドプレスを採用");
  }

  // Press intensity
  if (defense.pressIntensity > 70) {
    defenseSummary.push(`高強度プレス（${defense.pressIntensity}/100）`);
  } else if (defense.pressIntensity < 30) {
    defenseSummary.push(`低強度プレス（${defense.pressIntensity}/100）`);
  }

  // Recovery zone
  if (defense.recoveryZone === "attacking_third") {
    defenseSummary.push(`敵陣でのボール奪取が${defense.turnoversInAttackingThird}回`);
  }

  return `【攻撃】${attackSummary.join("、")}。【守備】${defenseSummary.join("、")}。`;
}
