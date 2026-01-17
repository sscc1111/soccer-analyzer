# Tactical Patterns Quick Start Guide

Get started with tactical pattern detection in 5 minutes.

## Installation

Already installed! The module is part of the analyzer service.

## Basic Usage

```typescript
import {
  analyzeTeamTacticalPatterns,
  generateTacticalSummary,
} from "@/lib/tacticalPatterns";

// Get events from Firestore
const passEvents = await getPassEvents(matchId);
const shotEvents = await getShotEvents(matchId);
const turnoverEvents = await getTurnoverEvents(matchId);

// Analyze home team
const patterns = analyzeTeamTacticalPatterns(
  "home",
  passEvents,
  shotEvents,
  turnoverEvents
);

// Generate summary
const summary = generateTacticalSummary(patterns, "ホーム");
console.log(summary);
// "【攻撃】ホームはサイド攻撃を重視、左サイド重視（55%）、速攻型のビルドアップ。
//  【守備】ハイプレス戦術を採用、高強度プレス（72/100）、敵陣でのボール奪取が12回。"
```

## Common Use Cases

### 1. Display Attack Patterns

```typescript
const patterns = analyzeTeamTacticalPatterns("home", passes, shots, turnovers);

// Zone distribution for visualization
const zones = patterns.attack.zoneDistribution;
// { left: 30, center: 45, right: 25 }

// Dominant pattern
const pattern = patterns.attack.dominantPattern;
// "central_penetration" | "side_attack" | "balanced"
```

### 2. Detect Counter-Attacks

```typescript
import { detectCounterAttacks } from "@/lib/tacticalPatterns";

const counterAttacks = detectCounterAttacks(turnoverEvents, shotEvents);

counterAttacks.forEach(ca => {
  console.log(`${ca.team} counter-attack: ${ca.duration}s, ${ca.distanceTraveled}m`);
  if (ca.shotResult === "goal") {
    console.log("  → GOAL!");
  }
});
```

### 3. Analyze Pressing Style

```typescript
const patterns = analyzeTeamTacticalPatterns("home", passes, shots, turnovers);

// Press classification
console.log(`Press Height: ${patterns.defense.pressHeight}`);
// "high" | "mid" | "low"

// Intensity score
console.log(`Press Intensity: ${patterns.defense.pressIntensity}/100`);

// Where they win the ball
console.log(`Recovery Zone: ${patterns.defense.recoveryZone}`);
// "attacking_third" | "middle_third" | "defensive_third"
```

### 4. Compare Teams

```typescript
const home = analyzeTeamTacticalPatterns("home", passes, shots, turnovers);
const away = analyzeTeamTacticalPatterns("away", passes, shots, turnovers);

console.log("Home vs Away:");
console.log(`Attack: ${home.attack.dominantPattern} vs ${away.attack.dominantPattern}`);
console.log(`Press: ${home.defense.pressHeight} vs ${away.defense.pressHeight}`);
console.log(`Intensity: ${home.defense.pressIntensity} vs ${away.defense.pressIntensity}`);
```

## Output Reference

### AttackPatternResult

```typescript
{
  zoneDistribution: { left: 30, center: 45, right: 25 },
  counterAttacks: CounterAttackEvent[],
  buildUpSpeed: "fast" | "moderate" | "slow",
  dominantPattern: "side_attack" | "central_penetration" | "balanced",
  averagePassesPerPossession: 5.2,
  passCompletionRate: 82
}
```

### DefensePatternResult

```typescript
{
  pressHeight: "high" | "mid" | "low",
  averageTurnoverPosition: { x: 0.75, y: 0.5 },
  pressIntensity: 68,  // 0-100
  recoveryZone: "attacking_third" | "middle_third" | "defensive_third",
  turnoversInAttackingThird: 15,
  turnoversInMiddleThird: 8,
  turnoversInDefensiveThird: 3
}
```

### CounterAttackEvent

```typescript
{
  turnoverTimestamp: 125.5,
  shotTimestamp: 131.2,
  team: "home",
  duration: 5.7,
  turnoverPosition: { x: 0.3, y: 0.5 },
  shotPosition: { x: 0.85, y: 0.5 },
  distanceTraveled: 42.3,
  shotResult: "goal"
}
```

## Utility Functions

### Classify Individual Events

```typescript
import { classifyAttackZone, classifyFieldThird } from "@/lib/tacticalPatterns";

// Get attack zone (Y-axis)
const zone = classifyAttackZone({ x: 0.8, y: 0.2 });
// "left" | "center" | "right"

// Get field third (X-axis, team-relative)
const third = classifyFieldThird({ x: 0.8, y: 0.5 }, "home");
// "attacking_third" | "middle_third" | "defensive_third"
```

## Integration Examples

### Save to Firestore

```typescript
const patterns = analyzeTeamTacticalPatterns("home", passes, shots, turnovers);

await db.collection("matches").doc(matchId)
  .collection("tactical").doc("patterns").set({
    team: "home",
    attack: patterns.attack,
    defense: patterns.defense,
    summary: generateTacticalSummary(patterns, "ホーム"),
    createdAt: new Date().toISOString()
  });
```

### Frontend API Response

```typescript
// API endpoint: GET /api/matches/:matchId/tactical-patterns
export async function GET(req: Request) {
  const { matchId } = req.params;

  const [passes, shots, turnovers] = await Promise.all([
    getPassEvents(matchId),
    getShotEvents(matchId),
    getTurnoverEvents(matchId)
  ]);

  const home = analyzeTeamTacticalPatterns("home", passes, shots, turnovers);
  const away = analyzeTeamTacticalPatterns("away", passes, shots, turnovers);

  return Response.json({
    home: {
      attack: home.attack,
      defense: home.defense,
      summary: generateTacticalSummary(home, "ホーム")
    },
    away: {
      attack: away.attack,
      defense: away.defense,
      summary: generateTacticalSummary(away, "アウェイ")
    }
  });
}
```

## Pattern Interpretation

### Attack Patterns

| Pattern | Meaning |
|---------|---------|
| `side_attack` | >45% of attacks from left or right zones |
| `central_penetration` | >45% of attacks through center |
| `balanced` | No single zone dominates (<45% each) |

### Build-Up Speed

| Speed | Criteria |
|-------|----------|
| `fast` | <3 passes per shot (direct play) |
| `moderate` | 3-6 passes per shot (balanced) |
| `slow` | >6 passes per shot (possession-based) |

### Press Height

| Height | Position | Meaning |
|--------|----------|---------|
| `high` | Attacking third | Aggressive pressing near opponent goal |
| `mid` | Middle third | Standard pressing in midfield |
| `low` | Defensive third | Deep defensive block |

### Press Intensity Scale

| Intensity | Description |
|-----------|-------------|
| 0-30 | Low intensity (retreat, compact defense) |
| 31-60 | Moderate intensity (balanced approach) |
| 61-100 | High intensity (aggressive pressing) |

## Tips

1. **Position Data Quality**: Results improve significantly with accurate position data
2. **Sample Size**: Need minimum ~10 events per team for reliable patterns
3. **Match Context**: Consider game state (score, time) when interpreting patterns
4. **Validation**: Cross-check with Gemini's video-based analysis
5. **Empty Data**: All functions handle missing data gracefully with defaults

## Troubleshooting

**Q: All zones show 33%?**
A: No pass or shot events - check event detection is working

**Q: Press intensity is 0?**
A: No turnovers won - team may not be pressing or detection failed

**Q: No counter-attacks detected?**
A: Check turnover-to-shot timing and distance constraints

**Q: Patterns seem incorrect?**
A: Verify position data quality - check if positions are {0,0} (dummy data)

## Full Documentation

- **API Reference**: `tacticalPatterns.README.md`
- **Examples**: `tacticalPatterns.example.ts`
- **Implementation**: `TACTICAL_PATTERNS_IMPLEMENTATION.md`
- **Tests**: `__tests__/tacticalPatterns.test.ts`

## Next Steps

1. Read full documentation for advanced usage
2. Check examples for specific use cases
3. Run tests to understand expected behavior
4. Integrate into your analysis pipeline
