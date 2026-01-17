/**
 * Tactical Patterns Usage Examples
 *
 * This file demonstrates how to use the tactical pattern detection module
 * in different scenarios.
 */

import type { PassEventDoc, ShotEventDoc, TurnoverEventDoc } from "@soccer/shared";
import {
  analyzeTeamTacticalPatterns,
  generateTacticalSummary,
  detectCounterAttacks,
  classifyAttackZone,
  classifyFieldThird,
} from "./tacticalPatterns";

/**
 * Example 1: Complete team tactical analysis
 *
 * This is the main use case integrated in 10_generateTacticalInsights.ts
 */
export function exampleFullTeamAnalysis(
  passEvents: PassEventDoc[],
  shotEvents: ShotEventDoc[],
  turnoverEvents: TurnoverEventDoc[]
): void {
  // Analyze home team
  const homePatterns = analyzeTeamTacticalPatterns("home", passEvents, shotEvents, turnoverEvents);

  console.log("Home Team Analysis:");
  console.log("==================");
  console.log(`Attack Zone Distribution: Left ${homePatterns.attack.zoneDistribution.left}%, Center ${homePatterns.attack.zoneDistribution.center}%, Right ${homePatterns.attack.zoneDistribution.right}%`);
  console.log(`Dominant Pattern: ${homePatterns.attack.dominantPattern}`);
  console.log(`Build-Up Speed: ${homePatterns.attack.buildUpSpeed}`);
  console.log(`Counter-Attacks: ${homePatterns.attack.counterAttacks.length}`);
  console.log(`Pass Completion: ${homePatterns.attack.passCompletionRate}%`);
  console.log();
  console.log(`Press Height: ${homePatterns.defense.pressHeight}`);
  console.log(`Press Intensity: ${homePatterns.defense.pressIntensity}/100`);
  console.log(`Recovery Zone: ${homePatterns.defense.recoveryZone}`);
  console.log(`Turnovers in Attacking Third: ${homePatterns.defense.turnoversInAttackingThird}`);

  // Generate summary
  const summary = generateTacticalSummary(homePatterns, "ホーム");
  console.log();
  console.log("Summary:", summary);
}

/**
 * Example 2: Counter-attack detection
 *
 * Identify fast transitions from defense to attack
 */
export function exampleCounterAttackDetection(
  turnoverEvents: TurnoverEventDoc[],
  shotEvents: ShotEventDoc[]
): void {
  const counterAttacks = detectCounterAttacks(turnoverEvents, shotEvents);

  console.log(`Found ${counterAttacks.length} counter-attacks:`);
  console.log();

  counterAttacks.forEach((ca, index) => {
    console.log(`Counter-Attack #${index + 1}:`);
    console.log(`  Team: ${ca.team}`);
    console.log(`  Duration: ${ca.duration.toFixed(1)}s`);
    console.log(`  Distance: ${ca.distanceTraveled?.toFixed(1)}m`);
    console.log(`  Result: ${ca.shotResult}`);
    console.log(`  Turnover at: (${ca.turnoverPosition?.x.toFixed(2)}, ${ca.turnoverPosition?.y.toFixed(2)})`);
    console.log(`  Shot at: (${ca.shotPosition?.x.toFixed(2)}, ${ca.shotPosition?.y.toFixed(2)})`);
    console.log();
  });
}

/**
 * Example 3: Single event zone classification
 *
 * Classify individual events by position
 */
export function exampleEventClassification(): void {
  // Example positions
  const positions = [
    { x: 0.8, y: 0.2, description: "Shot from left wing" },
    { x: 0.85, y: 0.5, description: "Shot from center" },
    { x: 0.9, y: 0.8, description: "Shot from right wing" },
    { x: 0.25, y: 0.5, description: "Turnover in defensive third" },
    { x: 0.75, y: 0.5, description: "Turnover in attacking third" },
  ];

  console.log("Event Classification Examples:");
  console.log("==============================");

  positions.forEach((pos) => {
    const attackZone = classifyAttackZone(pos);
    const fieldThird = classifyFieldThird(pos, "home");

    console.log(`${pos.description}:`);
    console.log(`  Position: (${pos.x}, ${pos.y})`);
    console.log(`  Attack Zone: ${attackZone}`);
    console.log(`  Field Third: ${fieldThird}`);
    console.log();
  });
}

/**
 * Example 4: Team comparison
 *
 * Compare tactical patterns between two teams
 */
export function exampleTeamComparison(
  passEvents: PassEventDoc[],
  shotEvents: ShotEventDoc[],
  turnoverEvents: TurnoverEventDoc[]
): void {
  const homePatterns = analyzeTeamTacticalPatterns("home", passEvents, shotEvents, turnoverEvents);
  const awayPatterns = analyzeTeamTacticalPatterns("away", passEvents, shotEvents, turnoverEvents);

  console.log("Tactical Comparison:");
  console.log("===================");
  console.log();

  console.log("Attack Patterns:");
  console.log(`  Home: ${homePatterns.attack.dominantPattern} (${homePatterns.attack.buildUpSpeed})`);
  console.log(`  Away: ${awayPatterns.attack.dominantPattern} (${awayPatterns.attack.buildUpSpeed})`);
  console.log();

  console.log("Pass Completion:");
  console.log(`  Home: ${homePatterns.attack.passCompletionRate}%`);
  console.log(`  Away: ${awayPatterns.attack.passCompletionRate}%`);
  console.log();

  console.log("Counter-Attacks:");
  console.log(`  Home: ${homePatterns.attack.counterAttacks.length}`);
  console.log(`  Away: ${awayPatterns.attack.counterAttacks.length}`);
  console.log();

  console.log("Pressing:");
  console.log(`  Home: ${homePatterns.defense.pressHeight} (intensity: ${homePatterns.defense.pressIntensity}/100)`);
  console.log(`  Away: ${awayPatterns.defense.pressHeight} (intensity: ${awayPatterns.defense.pressIntensity}/100)`);
  console.log();

  console.log("Recovery Zones:");
  console.log(`  Home: ${homePatterns.defense.recoveryZone}`);
  console.log(`  Away: ${awayPatterns.defense.recoveryZone}`);
}

/**
 * Example 5: Generate insights for frontend display
 *
 * Create data structure suitable for UI visualization
 */
export function exampleFrontendData(
  passEvents: PassEventDoc[],
  shotEvents: ShotEventDoc[],
  turnoverEvents: TurnoverEventDoc[]
): {
  home: Record<string, unknown>;
  away: Record<string, unknown>;
} {
  const homePatterns = analyzeTeamTacticalPatterns("home", passEvents, shotEvents, turnoverEvents);
  const awayPatterns = analyzeTeamTacticalPatterns("away", passEvents, shotEvents, turnoverEvents);

  // Format for frontend
  return {
    home: {
      attack: {
        dominantPattern: homePatterns.attack.dominantPattern,
        zoneDistribution: homePatterns.attack.zoneDistribution,
        buildUpSpeed: homePatterns.attack.buildUpSpeed,
        counterAttacks: homePatterns.attack.counterAttacks.length,
        passCompletionRate: homePatterns.attack.passCompletionRate,
      },
      defense: {
        pressHeight: homePatterns.defense.pressHeight,
        pressIntensity: homePatterns.defense.pressIntensity,
        recoveryZone: homePatterns.defense.recoveryZone,
        turnoversDistribution: {
          attacking: homePatterns.defense.turnoversInAttackingThird,
          middle: homePatterns.defense.turnoversInMiddleThird,
          defensive: homePatterns.defense.turnoversInDefensiveThird,
        },
      },
      summary: generateTacticalSummary(homePatterns, "ホーム"),
    },
    away: {
      attack: {
        dominantPattern: awayPatterns.attack.dominantPattern,
        zoneDistribution: awayPatterns.attack.zoneDistribution,
        buildUpSpeed: awayPatterns.attack.buildUpSpeed,
        counterAttacks: awayPatterns.attack.counterAttacks.length,
        passCompletionRate: awayPatterns.attack.passCompletionRate,
      },
      defense: {
        pressHeight: awayPatterns.defense.pressHeight,
        pressIntensity: awayPatterns.defense.pressIntensity,
        recoveryZone: awayPatterns.defense.recoveryZone,
        turnoversDistribution: {
          attacking: awayPatterns.defense.turnoversInAttackingThird,
          middle: awayPatterns.defense.turnoversInMiddleThird,
          defensive: awayPatterns.defense.turnoversInDefensiveThird,
        },
      },
      summary: generateTacticalSummary(awayPatterns, "アウェイ"),
    },
  };
}

/**
 * Example 6: Validate Gemini analysis
 *
 * Compare code-based detection with Gemini's video analysis
 */
export function exampleValidateGemini(
  passEvents: PassEventDoc[],
  shotEvents: ShotEventDoc[],
  turnoverEvents: TurnoverEventDoc[],
  geminiAnalysis: {
    attackPatterns: string[];
    pressingIntensity: { home: number; away: number };
  }
): void {
  const homePatterns = analyzeTeamTacticalPatterns("home", passEvents, shotEvents, turnoverEvents);
  const awayPatterns = analyzeTeamTacticalPatterns("away", passEvents, shotEvents, turnoverEvents);

  console.log("Validation: Code-based vs Gemini Analysis");
  console.log("=========================================");
  console.log();

  // Compare pressing intensity
  console.log("Pressing Intensity:");
  console.log(`  Code (Home): ${homePatterns.defense.pressIntensity}/100`);
  console.log(`  Gemini (Home): ${geminiAnalysis.pressingIntensity.home}/100`);
  console.log(`  Difference: ${Math.abs(homePatterns.defense.pressIntensity - geminiAnalysis.pressingIntensity.home)}`);
  console.log();
  console.log(`  Code (Away): ${awayPatterns.defense.pressIntensity}/100`);
  console.log(`  Gemini (Away): ${geminiAnalysis.pressingIntensity.away}/100`);
  console.log(`  Difference: ${Math.abs(awayPatterns.defense.pressIntensity - geminiAnalysis.pressingIntensity.away)}`);
  console.log();

  // Compare attack patterns
  console.log("Attack Patterns:");
  console.log(`  Code: ${homePatterns.attack.dominantPattern}`);
  console.log(`  Gemini: ${geminiAnalysis.attackPatterns.join(", ")}`);

  // Consistency check
  const codeMatchesGemini = Math.abs(
    homePatterns.defense.pressIntensity - geminiAnalysis.pressingIntensity.home
  ) < 20;

  if (codeMatchesGemini) {
    console.log();
    console.log("✓ Analysis is consistent between code and Gemini");
  } else {
    console.log();
    console.log("⚠ Significant difference detected - manual review recommended");
  }
}
