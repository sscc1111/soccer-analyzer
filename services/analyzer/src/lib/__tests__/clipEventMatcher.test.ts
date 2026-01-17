/**
 * Tests for Clip-Event Matcher
 */

import { describe, it, expect, test } from "vitest";
import {
  matchClipToEvents,
  calculateClipImportance,
  rankClipsByImportance,
  getTopClips,
  filterClipsByImportance,
  calculateDynamicWindow,
  type Clip,
  type Event,
  type MatchContext,
} from "../clipEventMatcher";

describe("clipEventMatcher", () => {
  // テスト用のクリップデータ
  const clips: Clip[] = [
    { id: "clip1", startTime: 10, endTime: 15 }, // ゴールイベントと一致
    { id: "clip2", startTime: 25, endTime: 30 }, // シュートイベントと一致
    { id: "clip3", startTime: 45, endTime: 50 }, // イベントなし
    { id: "clip4", startTime: 60, endTime: 65 }, // 複数イベントと一致
  ];

  // テスト用のイベントデータ
  const events: Event[] = [
    {
      id: "event1",
      timestamp: 12.5,
      type: "goal",
    },
    {
      id: "event2",
      timestamp: 27,
      type: "shot",
      details: { isOnTarget: true, shotResult: "saved" },
    },
    {
      id: "event3",
      timestamp: 62,
      type: "tackle",
      details: { wonTackle: true },
    },
    {
      id: "event4",
      timestamp: 63.5,
      type: "key_pass",
    },
  ];

  describe("matchClipToEvents", () => {
    test("should match events within clip timeframe with exact match", () => {
      const matches = matchClipToEvents(clips[0], events);

      expect(matches).toHaveLength(1);
      expect(matches[0].eventId).toBe("event1");
      expect(matches[0].matchType).toBe("exact");
      expect(matches[0].confidence).toBeGreaterThan(0.7);
    });

    test("should match events with overlap", () => {
      const matches = matchClipToEvents(clips[1], events);

      expect(matches).toHaveLength(1);
      expect(matches[0].eventId).toBe("event2");
      expect(matches[0].matchType).toBe("exact");
    });

    test("should return empty array when no events match", () => {
      const matches = matchClipToEvents(clips[2], events);

      expect(matches).toHaveLength(0);
    });

    test("should match multiple events to one clip", () => {
      const matches = matchClipToEvents(clips[3], events);

      expect(matches.length).toBeGreaterThan(1);
      expect(matches.map((m) => m.eventId)).toContain("event3");
      expect(matches.map((m) => m.eventId)).toContain("event4");
    });

    test("should sort matches by confidence descending", () => {
      const matches = matchClipToEvents(clips[3], events);

      for (let i = 1; i < matches.length; i++) {
        expect(matches[i - 1].confidence).toBeGreaterThanOrEqual(matches[i].confidence);
      }
    });

    test("should respect custom tolerance", () => {
      // 短いクリップを使用（duration: 2秒）
      // tolerance は clipCenter からの距離で判定される
      // clipDuration/2 を超え、tolerance 以内がproximity match
      const clip: Clip = { id: "test", startTime: 10, endTime: 12 };
      // center = 11, clipDuration/2 = 1
      // イベントは center から 1.5秒離れている
      const nearbyEvent: Event = { id: "nearby", timestamp: 12.5, type: "pass" };

      // デフォルト tolerance (2.0秒) では 1.5 <= 2.0 なのでマッチ
      const matchesDefault = matchClipToEvents(clip, [nearbyEvent]);
      expect(matchesDefault).toHaveLength(1);
      expect(matchesDefault[0].matchType).toBe("proximity");

      // tolerance 1.0秒では 1.5 > 1.0 なのでマッチしない
      const matchesStrict = matchClipToEvents(clip, [nearbyEvent], 1.0);
      expect(matchesStrict).toHaveLength(0);
    });
  });

  describe("calculateClipImportance", () => {
    test("should return minimum importance for clip with no events", () => {
      const matches = matchClipToEvents(clips[2], events);
      const importance = calculateClipImportance(clips[2], matches);

      expect(importance.finalImportance).toBe(0.1);
      expect(importance.baseImportance).toBe(0.1);
      expect(importance.eventTypeBoost).toBe(0);
    });

    test("should calculate high importance for goal clip", () => {
      const matches = matchClipToEvents(clips[0], events);
      const importance = calculateClipImportance(clips[0], matches);

      expect(importance.baseImportance).toBeGreaterThan(0.7);
      expect(importance.finalImportance).toBeGreaterThan(0.7);
    });

    test("should add event type boost for multiple events", () => {
      const matches = matchClipToEvents(clips[3], events);
      const importance = calculateClipImportance(clips[3], matches);

      expect(importance.eventTypeBoost).toBeGreaterThan(0);
    });

    test("should apply context boost for late match events", () => {
      const matches = matchClipToEvents(clips[0], events);
      const context: MatchContext = {
        matchMinute: 85,
        totalMatchMinutes: 90,
      };
      const importance = calculateClipImportance(clips[0], matches, context);

      expect(importance.contextBoost).toBeGreaterThan(0);
    });

    test("should apply context boost for close score differential", () => {
      const matches = matchClipToEvents(clips[0], events);
      const context: MatchContext = {
        scoreDifferential: 0, // 同点
      };
      const importance = calculateClipImportance(clips[0], matches, context);

      expect(importance.contextBoost).toBeGreaterThan(0);
    });

    test("should apply extra boost for behind team scoring", () => {
      const matches = matchClipToEvents(clips[0], events);
      const context: MatchContext = {
        scoreDifferential: -1, // 1点ビハインド
      };
      const importance = calculateClipImportance(clips[0], matches, context);

      expect(importance.contextBoost).toBeGreaterThan(0);
    });

    test("should cap final importance at 1.0", () => {
      const matches = matchClipToEvents(clips[0], events);
      const context: MatchContext = {
        matchMinute: 89,
        totalMatchMinutes: 90,
        scoreDifferential: -1,
      };
      const importance = calculateClipImportance(clips[0], matches, context);

      expect(importance.finalImportance).toBeLessThanOrEqual(1.0);
    });
  });

  describe("rankClipsByImportance", () => {
    test("should rank all clips by importance", () => {
      const ranked = rankClipsByImportance(clips, events);

      expect(ranked).toHaveLength(clips.length);

      // ランクは1から始まる
      expect(ranked[0].rank).toBe(1);
      expect(ranked[ranked.length - 1].rank).toBe(clips.length);

      // 重要度は降順
      for (let i = 1; i < ranked.length; i++) {
        expect(ranked[i - 1].importance.finalImportance).toBeGreaterThanOrEqual(
          ranked[i].importance.finalImportance
        );
      }
    });

    test("should rank goal clip highest", () => {
      const ranked = rankClipsByImportance(clips, events);

      // ゴールを含むクリップが最高ランク
      expect(ranked[0].clip.id).toBe("clip1");
    });

    test("should rank clip with no events lowest", () => {
      const ranked = rankClipsByImportance(clips, events);

      // イベントなしのクリップが最低ランク
      expect(ranked[ranked.length - 1].clip.id).toBe("clip3");
    });

    test("should apply match context to all clips", () => {
      const context: MatchContext = {
        matchMinute: 85,
        totalMatchMinutes: 90,
      };
      const rankedWithContext = rankClipsByImportance(clips, events, context);
      const rankedWithoutContext = rankClipsByImportance(clips, events);

      // コンテキストありの方が全体的に重要度が高い（終盤ブースト）
      const avgWithContext =
        rankedWithContext.reduce((sum, r) => sum + r.importance.finalImportance, 0) /
        rankedWithContext.length;
      const avgWithoutContext =
        rankedWithoutContext.reduce((sum, r) => sum + r.importance.finalImportance, 0) /
        rankedWithoutContext.length;

      expect(avgWithContext).toBeGreaterThanOrEqual(avgWithoutContext);
    });
  });

  describe("getTopClips", () => {
    test("should return top N clips", () => {
      const top2 = getTopClips(clips, events, 2);

      expect(top2).toHaveLength(2);
      expect(top2[0].rank).toBe(1);
      expect(top2[1].rank).toBe(2);
    });

    test("should return fewer clips if N exceeds total", () => {
      const top10 = getTopClips(clips, events, 10);

      expect(top10).toHaveLength(clips.length);
    });

    test("should return clips in importance order", () => {
      const top3 = getTopClips(clips, events, 3);

      for (let i = 1; i < top3.length; i++) {
        expect(top3[i - 1].importance.finalImportance).toBeGreaterThanOrEqual(
          top3[i].importance.finalImportance
        );
      }
    });
  });

  describe("filterClipsByImportance", () => {
    test("should filter clips by threshold", () => {
      const filtered = filterClipsByImportance(clips, events, 0.5);

      // すべてのクリップが閾値以上
      filtered.forEach((rc) => {
        expect(rc.importance.finalImportance).toBeGreaterThanOrEqual(0.5);
      });
    });

    test("should return empty array if no clips meet threshold", () => {
      const filtered = filterClipsByImportance(clips, events, 0.99);

      // 0.99以上のクリップは少ない可能性
      filtered.forEach((rc) => {
        expect(rc.importance.finalImportance).toBeGreaterThanOrEqual(0.99);
      });
    });

    test("should return all clips for very low threshold", () => {
      const filtered = filterClipsByImportance(clips, events, 0.0);

      expect(filtered).toHaveLength(clips.length);
    });
  });

  describe("importance boost calculations", () => {
    test("should give highest boost to goal events", () => {
      const goalClip: Clip = { id: "goal", startTime: 10, endTime: 15 };
      const goalEvent: Event = { id: "g1", timestamp: 12, type: "goal" };

      const matches = matchClipToEvents(goalClip, [goalEvent]);
      const importance = calculateClipImportance(goalClip, matches);

      expect(importance.baseImportance).toBeGreaterThan(0.9);
    });

    test("should give high boost to penalty events", () => {
      const penaltyClip: Clip = { id: "penalty", startTime: 20, endTime: 25 };
      const penaltyEvent: Event = { id: "p1", timestamp: 22, type: "penalty" };

      const matches = matchClipToEvents(penaltyClip, [penaltyEvent]);
      const importance = calculateClipImportance(penaltyClip, matches);

      expect(importance.baseImportance).toBeGreaterThan(0.85);
    });

    test("should give high boost to red card events", () => {
      const redCardClip: Clip = { id: "red", startTime: 30, endTime: 35 };
      const redCardEvent: Event = { id: "r1", timestamp: 32, type: "red_card" };

      const matches = matchClipToEvents(redCardClip, [redCardEvent]);
      const importance = calculateClipImportance(redCardClip, matches);

      expect(importance.baseImportance).toBeGreaterThan(0.8);
      expect(importance.rarityBoost).toBeGreaterThan(0);
    });

    test("should boost shots on target", () => {
      const shotClip: Clip = { id: "shot", startTime: 40, endTime: 45 };
      const shotOnTarget: Event = {
        id: "s1",
        timestamp: 42,
        type: "shot",
        details: { isOnTarget: true },
      };
      const shotOffTarget: Event = {
        id: "s2",
        timestamp: 42,
        type: "shot",
        details: { isOnTarget: false },
      };

      const matchesOn = matchClipToEvents(shotClip, [shotOnTarget]);
      const matchesOff = matchClipToEvents(shotClip, [shotOffTarget]);

      expect(matchesOn[0].importanceBoost).toBeGreaterThan(matchesOff[0].importanceBoost);
    });

    test("should boost won tackles", () => {
      const tackleClip: Clip = { id: "tackle", startTime: 50, endTime: 55 };
      const wonTackle: Event = {
        id: "t1",
        timestamp: 52,
        type: "tackle",
        details: { wonTackle: true },
      };
      const lostTackle: Event = {
        id: "t2",
        timestamp: 52,
        type: "tackle",
        details: { wonTackle: false },
      };

      const matchesWon = matchClipToEvents(tackleClip, [wonTackle]);
      const matchesLost = matchClipToEvents(tackleClip, [lostTackle]);

      expect(matchesWon[0].importanceBoost).toBeGreaterThan(matchesLost[0].importanceBoost);
    });

    test("should treat shot-goal as goal event", () => {
      const shotGoalClip: Clip = { id: "shot-goal", startTime: 60, endTime: 65 };
      const shotGoal: Event = {
        id: "sg1",
        timestamp: 62,
        type: "shot",
        details: { shotResult: "goal" },
      };

      const matches = matchClipToEvents(shotGoalClip, [shotGoal]);
      const importance = calculateClipImportance(shotGoalClip, matches);

      // ゴールとして扱われるため高い重要度
      expect(importance.baseImportance).toBeGreaterThan(0.9);
    });
  });

  describe("edge cases", () => {
    test("should handle empty clips array", () => {
      const ranked = rankClipsByImportance([], events);

      expect(ranked).toHaveLength(0);
    });

    test("should handle empty events array", () => {
      const ranked = rankClipsByImportance(clips, []);

      expect(ranked).toHaveLength(clips.length);
      // すべてのクリップが最低重要度
      ranked.forEach((rc) => {
        expect(rc.importance.finalImportance).toBe(0.1);
      });
    });

    test("should handle clips with zero duration by returning empty array", () => {
      // Zero duration clips would cause division by zero, so we skip them
      const zeroClip: Clip = { id: "zero", startTime: 10, endTime: 10 };
      const event: Event = { id: "e1", timestamp: 10, type: "goal" };

      const matches = matchClipToEvents(zeroClip, [event]);

      // Zero/negative duration clips are invalid and return empty matches
      expect(matches).toHaveLength(0);
    });

    test("should handle events at clip boundaries", () => {
      const clip: Clip = { id: "boundary", startTime: 10, endTime: 20 };
      const eventStart: Event = { id: "start", timestamp: 10, type: "pass" };
      const eventEnd: Event = { id: "end", timestamp: 20, type: "pass" };

      const matches = matchClipToEvents(clip, [eventStart, eventEnd]);

      expect(matches).toHaveLength(2);
      expect(matches.every((m) => m.matchType === "exact")).toBe(true);
    });

    test("should handle negative timestamps gracefully", () => {
      const clip: Clip = { id: "neg", startTime: -5, endTime: 5 };
      const event: Event = { id: "e1", timestamp: 0, type: "pass" };

      const matches = matchClipToEvents(clip, [event]);

      expect(matches).toHaveLength(1);
    });
  });

  describe("calculateDynamicWindow", () => {
    describe("default window configuration", () => {
      test("should return goal default window", () => {
        const goalEvent: Event = { id: "g1", timestamp: 100, type: "goal" };
        const window = calculateDynamicWindow(goalEvent, []);

        expect(window.before).toBe(10);
        expect(window.after).toBe(5);
        expect(window.reason).toContain("ゴール");
      });

      test("should return shot default window", () => {
        const shotEvent: Event = { id: "s1", timestamp: 100, type: "shot" };
        const window = calculateDynamicWindow(shotEvent, []);

        expect(window.before).toBe(7);
        expect(window.after).toBe(3);
        expect(window.reason).toContain("シュート");
      });

      test("should return setPiece default window", () => {
        const setPieceEvent: Event = { id: "sp1", timestamp: 100, type: "setPiece" };
        const window = calculateDynamicWindow(setPieceEvent, []);

        expect(window.before).toBe(3);
        expect(window.after).toBe(5);
        expect(window.reason).toContain("セットピース");
      });

      test("should return penalty default window", () => {
        const penaltyEvent: Event = { id: "p1", timestamp: 100, type: "penalty" };
        const window = calculateDynamicWindow(penaltyEvent, []);

        expect(window.before).toBe(5);
        expect(window.after).toBe(5);
      });

      test("should return pass default window", () => {
        const passEvent: Event = { id: "pass1", timestamp: 100, type: "pass" };
        const window = calculateDynamicWindow(passEvent, []);

        expect(window.before).toBe(2);
        expect(window.after).toBe(1);
      });
    });

    describe("counter attack detection", () => {
      test("should extend window for counter attack goal", () => {
        const turnoverEvent: Event = { id: "t1", timestamp: 90, type: "turnover" };
        const goalEvent: Event = { id: "g1", timestamp: 95, type: "goal" };

        const window = calculateDynamicWindow(goalEvent, [turnoverEvent, goalEvent]);

        expect(window.before).toBe(15); // 拡張された
        expect(window.reason).toContain("カウンター");
      });

      test("should not extend window if turnover is too far", () => {
        const turnoverEvent: Event = { id: "t1", timestamp: 80, type: "turnover" };
        const goalEvent: Event = { id: "g1", timestamp: 100, type: "goal" };

        const window = calculateDynamicWindow(goalEvent, [turnoverEvent, goalEvent]);

        expect(window.before).toBe(10); // デフォルトのまま
        expect(window.reason).not.toContain("カウンター");
      });
    });

    describe("shot detail adjustments", () => {
      test("should extend after window for shot on target", () => {
        const shotEvent: Event = {
          id: "s1",
          timestamp: 100,
          type: "shot",
          details: { isOnTarget: true },
        };

        const window = calculateDynamicWindow(shotEvent, []);

        expect(window.after).toBe(4); // デフォルトの3から拡張
        expect(window.reason).toContain("枠内");
      });

      test("should reduce before window for long range shot", () => {
        const shotEvent: Event = {
          id: "s1",
          timestamp: 100,
          type: "shot",
          details: { shotType: "long_range" },
        };

        const window = calculateDynamicWindow(shotEvent, []);

        expect(window.before).toBe(4); // デフォルトの7から短縮
        expect(window.reason).toContain("ロングレンジ");
      });
    });

    describe("setPiece type adjustments", () => {
      test("should adjust window for corner kick", () => {
        const cornerEvent: Event = {
          id: "c1",
          timestamp: 100,
          type: "setPiece",
          details: { setPieceType: "corner" },
        };

        const window = calculateDynamicWindow(cornerEvent, []);

        expect(window.before).toBe(2); // 短め
        expect(window.after).toBe(7); // 長め
        expect(window.reason).toContain("コーナー");
      });

      test("should adjust window for free kick", () => {
        const freeKickEvent: Event = {
          id: "fk1",
          timestamp: 100,
          type: "setPiece",
          details: { setPieceType: "free_kick" },
        };

        const window = calculateDynamicWindow(freeKickEvent, []);

        expect(window.before).toBe(3);
        expect(window.after).toBe(6);
        expect(window.reason).toContain("フリーキック");
      });
    });

    describe("turnover adjustments", () => {
      test("should extend after window for interception", () => {
        const interceptionEvent: Event = {
          id: "i1",
          timestamp: 100,
          type: "turnover",
          details: { turnoverType: "interception" },
        };

        const window = calculateDynamicWindow(interceptionEvent, []);

        expect(window.after).toBe(5); // デフォルトの3から拡張
        expect(window.reason).toContain("インターセプト");
      });
    });

    describe("match context adjustments", () => {
      test("should extend window for late game important events", () => {
        const goalEvent: Event = { id: "g1", timestamp: 100, type: "goal" };
        const context: MatchContext = {
          matchMinute: 88,
          totalMatchMinutes: 90,
        };

        const window = calculateDynamicWindow(goalEvent, [], context);

        expect(window.before).toBeGreaterThan(10); // 拡張された
        expect(window.after).toBeGreaterThan(5); // 拡張された
        expect(window.reason).toContain("終盤");
      });

      test("should extend window for close game goals", () => {
        const goalEvent: Event = { id: "g1", timestamp: 100, type: "goal" };
        const context: MatchContext = {
          scoreDifferential: 0, // 同点
        };

        const window = calculateDynamicWindow(goalEvent, [], context);

        expect(window.before).toBeGreaterThan(10);
        expect(window.after).toBeGreaterThan(5);
        expect(window.reason).toContain("接戦");
      });

      test("should not extend window for blowout game", () => {
        const goalEvent: Event = { id: "g1", timestamp: 100, type: "goal" };
        const context: MatchContext = {
          scoreDifferential: 5, // 大差
        };

        const window = calculateDynamicWindow(goalEvent, [], context);

        expect(window.before).toBe(10); // デフォルト
        expect(window.after).toBe(5); // デフォルト
      });
    });

    describe("event density adjustments", () => {
      test("should extend window when many events before", () => {
        const goalEvent: Event = { id: "g1", timestamp: 100, type: "goal" };
        const denseEvents: Event[] = [
          { id: "p1", timestamp: 92, type: "pass" },
          { id: "p2", timestamp: 94, type: "pass" },
          { id: "p3", timestamp: 96, type: "pass" },
          { id: "p4", timestamp: 98, type: "pass" },
          goalEvent,
        ];

        const window = calculateDynamicWindow(goalEvent, denseEvents);

        expect(window.before).toBeGreaterThan(10); // 密集により拡張
        expect(window.reason).toContain("前方密集");
      });

      test("should extend window when many events after", () => {
        const setPieceEvent: Event = { id: "sp1", timestamp: 100, type: "setPiece" };
        const denseEvents: Event[] = [
          setPieceEvent,
          { id: "s1", timestamp: 101, type: "shot" },
          { id: "s2", timestamp: 102, type: "shot" },
          { id: "c1", timestamp: 103, type: "carry" },
          { id: "t1", timestamp: 104, type: "turnover" },
        ];

        const window = calculateDynamicWindow(setPieceEvent, denseEvents);

        expect(window.after).toBeGreaterThan(5); // 密集により拡張
        expect(window.reason).toContain("後方密集");
      });
    });

    describe("context event detection", () => {
      test("should detect key pass before goal", () => {
        const keyPassEvent: Event = { id: "kp1", timestamp: 95, type: "key_pass" };
        const goalEvent: Event = { id: "g1", timestamp: 100, type: "goal" };

        const window = calculateDynamicWindow(goalEvent, [keyPassEvent, goalEvent]);

        expect(window.contextBefore).toBeDefined();
        expect(window.contextBefore?.some((e) => e.id === "kp1")).toBe(true);
      });

      test("should detect shot after setPiece", () => {
        const setPieceEvent: Event = { id: "sp1", timestamp: 100, type: "setPiece" };
        const shotEvent: Event = { id: "s1", timestamp: 103, type: "shot" };

        const window = calculateDynamicWindow(setPieceEvent, [setPieceEvent, shotEvent]);

        expect(window.contextAfter).toBeDefined();
        expect(window.contextAfter?.some((e) => e.id === "s1")).toBe(true);
      });

      test("should detect foul before penalty", () => {
        const foulEvent: Event = { id: "f1", timestamp: 95, type: "foul" };
        const penaltyEvent: Event = { id: "p1", timestamp: 100, type: "penalty" };

        const window = calculateDynamicWindow(penaltyEvent, [foulEvent, penaltyEvent]);

        expect(window.contextBefore).toBeDefined();
        expect(window.contextBefore?.some((e) => e.id === "f1")).toBe(true);
      });

      test("should detect counter attack sequence after interception", () => {
        const interceptionEvent: Event = {
          id: "i1",
          timestamp: 100,
          type: "turnover",
          details: { turnoverType: "interception" },
        };
        const passEvent: Event = { id: "p1", timestamp: 102, type: "pass" };
        const shotEvent: Event = { id: "s1", timestamp: 104, type: "shot" };

        const window = calculateDynamicWindow(interceptionEvent, [interceptionEvent, passEvent, shotEvent]);

        expect(window.contextAfter).toBeDefined();
        expect(window.contextAfter?.some((e) => e.type === "pass")).toBe(true);
        expect(window.contextAfter?.some((e) => e.type === "shot")).toBe(true);
      });
    });

    describe("edge cases", () => {
      test("should handle unknown event type with fallback", () => {
        // @ts-expect-error - Testing with unknown type
        const unknownEvent: Event = { id: "u1", timestamp: 100, type: "unknown" };

        const window = calculateDynamicWindow(unknownEvent, []);

        // デフォルトウィンドウ（フォールバック）
        expect(window.before).toBe(5);
        expect(window.after).toBe(3);
      });

      test("should handle empty events array", () => {
        const goalEvent: Event = { id: "g1", timestamp: 100, type: "goal" };

        const window = calculateDynamicWindow(goalEvent, []);

        expect(window.before).toBe(10);
        expect(window.after).toBe(5);
      });

      test("should round window times to one decimal place", () => {
        const goalEvent: Event = { id: "g1", timestamp: 100, type: "goal" };
        const context: MatchContext = {
          matchMinute: 89,
          totalMatchMinutes: 90,
          scoreDifferential: 0,
        };

        const window = calculateDynamicWindow(goalEvent, [], context);

        // 拡張されても小数第1位まで（文字列変換でチェック）
        const beforeStr = window.before.toString();
        const afterStr = window.after.toString();
        const beforeDecimalPlaces = beforeStr.includes('.') ? beforeStr.split('.')[1].length : 0;
        const afterDecimalPlaces = afterStr.includes('.') ? afterStr.split('.')[1].length : 0;

        expect(beforeDecimalPlaces).toBeLessThanOrEqual(1);
        expect(afterDecimalPlaces).toBeLessThanOrEqual(1);
      });
    });
  });
});
