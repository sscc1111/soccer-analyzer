/**
 * フォーメーション変更追跡モジュール
 *
 * 試合中のフォーメーション変化を時系列で追跡し、
 * 戦術的な切り替えや柔軟性を分析する
 */

/**
 * フォーメーション追跡用のイベント型
 * 内部用に定義（外部型への依存を避ける）
 */
export interface MatchEvent {
  /** イベントタイムスタンプ（秒） */
  timestamp: number;
  /** イベントタイプ */
  type: string;
  /** イベント詳細（オプション） */
  metadata?: {
    playerPositions?: Array<{ x: number; y: number }>;
    [key: string]: unknown;
  };
}

/**
 * 特定時点でのフォーメーション状態
 */
export interface FormationState {
  /** フォーメーション形式 (例: "4-3-3", "4-4-2") */
  formation: string;
  /** タイムスタンプ（秒） */
  timestamp: number;
  /** フォーメーション判定の信頼度 (0-1) */
  confidence: number;
  /** ゲームフェーズ */
  phase: 'attacking' | 'defending' | 'transition' | 'set_piece';
}

/**
 * フォーメーション変更イベント
 */
export interface FormationChange {
  /** 変更前のフォーメーション */
  fromFormation: string;
  /** 変更後のフォーメーション */
  toFormation: string;
  /** 変更が発生したタイムスタンプ（秒） */
  timestamp: number;
  /** 変更のトリガー要因 */
  trigger: 'tactical_switch' | 'substitution' | 'game_state' | 'opponent_pressure';
  /** 変更判定の信頼度 (0-1) */
  confidence: number;
}

/**
 * 試合全体のフォーメーションタイムライン
 */
export interface FormationTimeline {
  /** 時系列のフォーメーション状態 */
  states: FormationState[];
  /** 検出されたフォーメーション変更 */
  changes: FormationChange[];
  /** 試合を通じて最も使用されたフォーメーション */
  dominantFormation: string;
  /** フォーメーションの変動性 (0-1) - 高いほど柔軟/不安定 */
  formationVariability: number;
}

/**
 * プレイヤーの位置情報（オプション）
 */
export interface PlayerPosition {
  playerId: string;
  x: number; // 0-100 (フィールドの横幅%)
  y: number; // 0-100 (フィールドの縦幅%)
  timestamp: number;
}

/**
 * イベントと選手位置情報からフォーメーション変更を追跡
 *
 * @param events - 試合イベントの配列
 * @param playerPositions - 選手位置情報（オプション）
 * @param interval - 分析間隔（秒、デフォルト: 300秒 = 5分）
 * @returns フォーメーションタイムライン
 */
export function trackFormationChanges(
  events: MatchEvent[],
  playerPositions?: PlayerPosition[][],
  interval: number = 300
): FormationTimeline {
  // 空配列の早期リターン - 不要な処理を防止
  if (events.length === 0) {
    return {
      states: [],
      changes: [],
      dominantFormation: "4-4-2", // デフォルトフォーメーション
      formationVariability: 0,
    };
  }

  // イベントを時系列でソート
  const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

  // 試合の開始時刻と終了時刻を取得
  const startTime = sortedEvents[0]?.timestamp ?? 0;
  const endTime = sortedEvents[sortedEvents.length - 1]?.timestamp ?? 0;

  const states: FormationState[] = [];
  const changes: FormationChange[] = [];

  // 初期フォーメーションを推定（デフォルト: 4-4-2）
  let currentFormation = inferInitialFormation(sortedEvents);

  // 時間間隔ごとにフォーメーションを分析
  for (let time = startTime; time <= endTime; time += interval) {
    const windowEnd = Math.min(time + interval, endTime);
    const windowEvents = sortedEvents.filter(
      e => e.timestamp >= time && e.timestamp < windowEnd
    );

    // この時間帯のフォーメーションを推定
    const detectedFormation = detectFormation(
      windowEvents,
      playerPositions,
      time
    );

    // フェーズを判定
    const phase = determinePhase(windowEvents);

    // フォーメーション状態を記録
    states.push({
      formation: detectedFormation.formation,
      timestamp: time,
      confidence: detectedFormation.confidence,
      phase,
    });

    // フォーメーション変更を検出
    if (states.length > 1 && currentFormation !== detectedFormation.formation) {
      const prevState = states[states.length - 2];
      const currentState = states[states.length - 1];

      const trigger = detectFormationTrigger(
        prevState,
        currentState,
        windowEvents
      );

      changes.push({
        fromFormation: currentFormation,
        toFormation: detectedFormation.formation,
        timestamp: time,
        trigger,
        confidence: detectedFormation.confidence,
      });

      currentFormation = detectedFormation.formation;
    }
  }

  // 支配的なフォーメーションを計算
  const dominantFormation = calculateDominantFormation(states);

  // フォーメーションの変動性を計算
  const formationVariability = calculateFormationVariability(states);

  return {
    states,
    changes,
    dominantFormation,
    formationVariability,
  };
}

/**
 * フォーメーション変更のトリガーを検出
 *
 * @param prevState - 前の状態
 * @param currentState - 現在の状態
 * @param events - この時間帯のイベント
 * @returns トリガーの種類
 */
export function detectFormationTrigger(
  prevState: FormationState,
  currentState: FormationState,
  events: MatchEvent[]
): FormationChange['trigger'] {
  // 交代イベントをチェック
  const hasSubstitution = events.some(
    e => e.type === 'substitution'
  );
  if (hasSubstitution) {
    return 'substitution';
  }

  // ゴールイベントをチェック（ゲーム状態の変化）
  const hasGoal = events.some(
    e => e.type === 'goal'
  );
  if (hasGoal) {
    return 'game_state';
  }

  // ターンオーバーやタックルが多い = 相手のプレッシャー
  const turnoverCount = events.filter(
    e => e.type === 'turnover' || e.type === 'tackle'
  ).length;
  if (turnoverCount > 5) {
    return 'opponent_pressure';
  }

  // それ以外は戦術的な切り替え
  return 'tactical_switch';
}

/**
 * フォーメーションタイムラインから変動性を計算
 *
 * @param timeline - フォーメーションの状態配列
 * @returns 変動性スコア (0-1)
 */
export function calculateFormationVariability(
  states: FormationState[]
): number {
  if (states.length <= 1) {
    return 0;
  }

  // ユニークなフォーメーションの数
  const uniqueFormations = new Set(states.map(s => s.formation));
  const uniqueCount = uniqueFormations.size;

  // フォーメーション変更の回数
  let changeCount = 0;
  for (let i = 1; i < states.length; i++) {
    if (states[i].formation !== states[i - 1].formation) {
      changeCount++;
    }
  }

  // 変動性を計算
  // - ユニークなフォーメーションの割合 (0-1)
  // - 変更頻度の割合 (0-1)
  // P1修正: 明示的なゼロ除算防御（states.length >= 2 は保証されているが防御的に）
  const divisorDiversity = Math.max(1, Math.min(5, states.length));
  const divisorFrequency = Math.max(1, states.length - 1);
  const diversityScore = (uniqueCount - 1) / divisorDiversity;
  const changeFrequency = changeCount / divisorFrequency;

  // 両方のスコアを組み合わせ
  const variability = (diversityScore * 0.4 + changeFrequency * 0.6);

  return Math.min(1, variability);
}

/**
 * 初期フォーメーションを推定
 */
function inferInitialFormation(events: MatchEvent[]): string {
  // スターティングメンバーやポジション情報から推定
  // 現時点では一般的な4-4-2をデフォルトとする

  // kickoff イベントの近くで player_position などがあれば利用
  const earlyEvents = events.slice(0, Math.min(10, events.length));

  // TODO: より高度な推定ロジック
  // - metadata.position などからディフェンダー、ミッドフィルダー、フォワードの数を数える

  return '4-4-2';
}

/**
 * 特定時間帯のイベントからフォーメーションを検出
 */
function detectFormation(
  events: MatchEvent[],
  playerPositions: PlayerPosition[][] | undefined,
  timestamp: number
): { formation: string; confidence: number } {
  // 選手位置情報が利用可能な場合
  if (playerPositions && playerPositions.length > 0) {
    return detectFormationFromPositions(playerPositions, timestamp);
  }

  // イベントベースの推定
  return detectFormationFromEvents(events);
}

/**
 * 選手位置情報からフォーメーションを検出
 */
function detectFormationFromPositions(
  playerPositions: PlayerPosition[][],
  timestamp: number
): { formation: string; confidence: number } {
  // タイムスタンプに最も近い位置情報を探す
  // P0修正: 空配列の場合のNaN比較を防止
  const relevantPositions = playerPositions.find(
    positions => {
      if (!positions || positions.length === 0) return false;
      const firstTimestamp = positions[0]?.timestamp;
      if (typeof firstTimestamp !== 'number' || !isFinite(firstTimestamp)) return false;
      return Math.abs(firstTimestamp - timestamp) < 30;
    }
  );

  if (!relevantPositions || relevantPositions.length < 10) {
    return { formation: '4-4-2', confidence: 0.3 };
  }

  // Y座標でグループ化してラインを検出
  const sortedByY = [...relevantPositions]
    .filter(p => p.playerId !== 'GK') // GKを除外
    .sort((a, b) => a.y - b.y);

  // K-meansクラスタリング的な簡易ライン検出
  const lines = groupIntoLines(sortedByY);

  if (lines.length === 3) {
    const defenders = lines[0].length;
    const midfielders = lines[1].length;
    const forwards = lines[2].length;
    return {
      formation: `${defenders}-${midfielders}-${forwards}`,
      confidence: 0.8,
    };
  }

  if (lines.length === 4) {
    const defenders = lines[0].length;
    const dmf = lines[1].length;
    const midfielders = lines[2].length;
    const forwards = lines[3].length;
    return {
      formation: `${defenders}-${dmf}-${midfielders}-${forwards}`,
      confidence: 0.75,
    };
  }

  return { formation: '4-4-2', confidence: 0.4 };
}

/**
 * 選手をY座標でラインにグループ化
 */
function groupIntoLines(
  positions: PlayerPosition[],
  threshold: number = 15
): PlayerPosition[][] {
  if (positions.length === 0) return [];

  const lines: PlayerPosition[][] = [];
  let currentLine: PlayerPosition[] = [positions[0]];

  for (let i = 1; i < positions.length; i++) {
    const prevY = positions[i - 1].y;
    const currentY = positions[i].y;

    if (Math.abs(currentY - prevY) < threshold) {
      currentLine.push(positions[i]);
    } else {
      lines.push(currentLine);
      currentLine = [positions[i]];
    }
  }

  lines.push(currentLine);
  return lines;
}

/**
 * イベントからフォーメーションを推定
 */
function detectFormationFromEvents(
  events: MatchEvent[]
): { formation: string; confidence: number } {
  // イベントメタデータから選手のポジション情報を抽出
  const positionCounts = {
    defenders: 0,
    midfielders: 0,
    forwards: 0,
  };

  for (const event of events) {
    // Type-safe access to metadata.position using index signature
    const positionValue = event.metadata?.["position"];
    const position = typeof positionValue === "string" ? positionValue : undefined;
    if (!position) continue;

    if (position.includes('DF') || position.includes('CB') || position.includes('LB') || position.includes('RB')) {
      positionCounts.defenders++;
    } else if (position.includes('MF') || position.includes('CM') || position.includes('DM') || position.includes('AM')) {
      positionCounts.midfielders++;
    } else if (position.includes('FW') || position.includes('ST') || position.includes('CF')) {
      positionCounts.forwards++;
    }
  }

  // 最頻値からフォーメーションを推定
  const total = positionCounts.defenders + positionCounts.midfielders + positionCounts.forwards;

  if (total >= 5) {
    const defenders = Math.round((positionCounts.defenders / total) * 11) || 4;
    const midfielders = Math.round((positionCounts.midfielders / total) * 11) || 4;
    const forwards = Math.round((positionCounts.forwards / total) * 11) || 2;

    // 合計を11に調整
    const sum = defenders + midfielders + forwards;
    const diff = 10 - sum; // GK除く

    if (diff !== 0) {
      // 中盤で調整
      return {
        formation: `${defenders}-${midfielders + diff}-${forwards}`,
        confidence: 0.5,
      };
    }

    return {
      formation: `${defenders}-${midfielders}-${forwards}`,
      confidence: 0.6,
    };
  }

  // デフォルト
  return { formation: '4-4-2', confidence: 0.3 };
}

/**
 * イベントから現在のゲームフェーズを判定
 */
function determinePhase(
  events: MatchEvent[]
): FormationState['phase'] {
  if (events.length === 0) return 'transition';

  // セットプレイイベントをチェック
  const hasSetPiece = events.some(
    e => e.type === 'free_kick' ||
         e.type === 'corner_kick' ||
         e.type === 'throw_in' ||
         e.type === 'penalty'
  );
  if (hasSetPiece) {
    return 'set_piece';
  }

  // 攻撃的なイベントが多いか
  const attackingEvents = events.filter(
    e => e.type === 'shot' ||
         e.type === 'pass' ||
         e.type === 'dribble' ||
         e.type === 'cross'
  ).length;

  // 守備的なイベントが多いか
  const defendingEvents = events.filter(
    e => e.type === 'tackle' ||
         e.type === 'interception' ||
         e.type === 'clearance' ||
         e.type === 'block'
  ).length;

  if (attackingEvents > defendingEvents * 1.5) {
    return 'attacking';
  }

  if (defendingEvents > attackingEvents * 1.5) {
    return 'defending';
  }

  return 'transition';
}

/**
 * 最も使用時間が長いフォーメーションを計算
 */
function calculateDominantFormation(states: FormationState[]): string {
  if (states.length === 0) return '4-4-2';

  const formationDurations = new Map<string, number>();

  for (let i = 0; i < states.length - 1; i++) {
    const formation = states[i].formation;
    const duration = states[i + 1].timestamp - states[i].timestamp;

    formationDurations.set(
      formation,
      (formationDurations.get(formation) || 0) + duration
    );
  }

  // 最後の状態も追加（残り時間を推定）
  const lastFormation = states[states.length - 1].formation;
  formationDurations.set(
    lastFormation,
    (formationDurations.get(lastFormation) || 0) + 300 // 5分と仮定
  );

  // 最長のフォーメーションを返す
  let maxDuration = 0;
  let dominant = '4-4-2';

  for (const [formation, duration] of formationDurations.entries()) {
    if (duration > maxDuration) {
      maxDuration = duration;
      dominant = formation;
    }
  }

  return dominant;
}

/**
 * ハーフごとのフォーメーション比較結果
 */
export interface FormationHalfComparison {
  /** 前半のフォーメーションタイムライン */
  firstHalf: FormationTimeline;
  /** 後半のフォーメーションタイムライン */
  secondHalf: FormationTimeline;
  /** ハーフ間の比較結果 */
  comparison: {
    /** フォーメーションが変更されたか */
    formationChanged: boolean;
    /** 前半の支配的フォーメーション */
    firstHalfDominant: string;
    /** 後半の支配的フォーメーション */
    secondHalfDominant: string;
    /** 変動性の変化（後半 - 前半） */
    variabilityChange: number;
  };
}

/**
 * ハーフごとのフォーメーション分析
 *
 * 試合を前半と後半に分割し、それぞれのフォーメーション変化を追跡・比較する。
 * ハーフタイムでの戦術変更を検出するのに有用。
 *
 * @param events - 試合イベントの配列
 * @param halfDurationMinutes - 1ハーフの時間（分、デフォルト: 45分）
 * @param playerPositions - 選手位置情報（オプション）
 * @param interval - 分析間隔（秒、デフォルト: 300秒 = 5分）
 * @returns ハーフごとの分析結果と比較
 */
export function analyzeFormationByHalf(
  events: MatchEvent[],
  halfDurationMinutes: number = 45,
  playerPositions?: PlayerPosition[][],
  interval: number = 300
): FormationHalfComparison {
  // イベントを時系列でソート
  const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

  if (sortedEvents.length === 0) {
    // イベントが存在しない場合のデフォルト値
    const emptyTimeline: FormationTimeline = {
      states: [],
      changes: [],
      dominantFormation: '4-4-2',
      formationVariability: 0,
    };

    return {
      firstHalf: emptyTimeline,
      secondHalf: emptyTimeline,
      comparison: {
        formationChanged: false,
        firstHalfDominant: '4-4-2',
        secondHalfDominant: '4-4-2',
        variabilityChange: 0,
      },
    };
  }

  // ハーフタイムの境界を秒単位で計算
  const halfDurationSeconds = halfDurationMinutes * 60;
  const matchStart = sortedEvents[0].timestamp;

  // 前半と後半でイベントを分割
  const firstHalfEvents = sortedEvents.filter(
    e => e.timestamp < matchStart + halfDurationSeconds
  );
  const secondHalfEvents = sortedEvents.filter(
    e => e.timestamp >= matchStart + halfDurationSeconds
  );

  // 選手位置情報も分割（存在する場合）
  let firstHalfPositions: PlayerPosition[][] | undefined;
  let secondHalfPositions: PlayerPosition[][] | undefined;

  if (playerPositions && playerPositions.length > 0) {
    firstHalfPositions = playerPositions.filter(
      positions => positions.length > 0 && positions[0].timestamp < matchStart + halfDurationSeconds
    );
    secondHalfPositions = playerPositions.filter(
      positions => positions.length > 0 && positions[0].timestamp >= matchStart + halfDurationSeconds
    );
  }

  // 前半のフォーメーション追跡
  const firstHalf = firstHalfEvents.length > 0
    ? trackFormationChanges(firstHalfEvents, firstHalfPositions, interval)
    : {
        states: [],
        changes: [],
        dominantFormation: '4-4-2',
        formationVariability: 0,
      };

  // 後半のフォーメーション追跡
  const secondHalf = secondHalfEvents.length > 0
    ? trackFormationChanges(secondHalfEvents, secondHalfPositions, interval)
    : {
        states: [],
        changes: [],
        dominantFormation: '4-4-2',
        formationVariability: 0,
      };

  // ハーフ間の比較
  const formationChanged = firstHalf.dominantFormation !== secondHalf.dominantFormation;
  const variabilityChange = secondHalf.formationVariability - firstHalf.formationVariability;

  return {
    firstHalf,
    secondHalf,
    comparison: {
      formationChanged,
      firstHalfDominant: firstHalf.dominantFormation,
      secondHalfDominant: secondHalf.dominantFormation,
      variabilityChange,
    },
  };
}

/**
 * フェーズ別フォーメーション分析
 */
export interface FormationByPhase {
  /** 攻撃時のフォーメーションタイムライン */
  attacking: FormationTimeline;
  /** 守備時のフォーメーションタイムライン */
  defending: FormationTimeline;
  /** トランジション時のフォーメーションタイムライン */
  transition: FormationTimeline;
  /** セットプレイ時のフォーメーションタイムライン */
  setPiece: FormationTimeline;
  /** フェーズ間の比較結果 */
  comparison: {
    /** 攻守でフォーメーションが変化するか */
    hasPhaseVariation: boolean;
    /** 攻撃時の支配的フォーメーション */
    attackingDominant: string;
    /** 守備時の支配的フォーメーション */
    defendingDominant: string;
    /** トランジション時の支配的フォーメーション */
    transitionDominant: string;
    /** フェーズ変化の柔軟性 (0-1) */
    phaseAdaptability: number;
  };
}

/**
 * フェーズ別のフォーメーション分析
 *
 * 試合を攻撃・守備・トランジション・セットプレイの4つのフェーズに分割し、
 * それぞれのフォーメーション変化を追跡・比較する。
 * 攻撃時と守備時で異なるフォーメーションを使用するチームの戦術を検出する。
 *
 * @param events - 試合イベントの配列
 * @param playerPositions - 選手位置情報（オプション）
 * @param interval - 分析間隔（秒、デフォルト: 300秒 = 5分）
 * @returns フェーズごとの分析結果と比較
 */
export function analyzeFormationByPhase(
  events: MatchEvent[],
  playerPositions?: PlayerPosition[][],
  interval: number = 300
): FormationByPhase {
  // イベントを時系列でソート
  const sortedEvents = [...events].sort((a, b) => a.timestamp - b.timestamp);

  if (sortedEvents.length === 0) {
    // イベントが存在しない場合のデフォルト値
    const emptyTimeline: FormationTimeline = {
      states: [],
      changes: [],
      dominantFormation: '4-4-2',
      formationVariability: 0,
    };

    return {
      attacking: emptyTimeline,
      defending: emptyTimeline,
      transition: emptyTimeline,
      setPiece: emptyTimeline,
      comparison: {
        hasPhaseVariation: false,
        attackingDominant: '4-4-2',
        defendingDominant: '4-4-2',
        transitionDominant: '4-4-2',
        phaseAdaptability: 0,
      },
    };
  }

  // 全体のフォーメーション追跡を実行してフェーズ情報を取得
  const overallTimeline = trackFormationChanges(sortedEvents, playerPositions, interval);

  // フェーズごとにイベントと状態を分類
  const phaseEvents: Record<FormationState['phase'], MatchEvent[]> = {
    attacking: [],
    defending: [],
    transition: [],
    set_piece: [],
  };

  const phaseStates: Record<FormationState['phase'], FormationState[]> = {
    attacking: [],
    defending: [],
    transition: [],
    set_piece: [],
  };

  // 状態をフェーズごとに分類
  for (const state of overallTimeline.states) {
    phaseStates[state.phase].push(state);
  }

  // イベントをフェーズごとに分類（タイムスタンプで最も近い状態のフェーズを使用）
  for (const event of sortedEvents) {
    const closestState = overallTimeline.states.reduce((prev, curr) => {
      return Math.abs(curr.timestamp - event.timestamp) < Math.abs(prev.timestamp - event.timestamp)
        ? curr
        : prev;
    });
    phaseEvents[closestState.phase].push(event);
  }

  // 各フェーズでのフォーメーション追跡
  const attackingTimeline = phaseEvents.attacking.length > 0
    ? trackFormationChanges(phaseEvents.attacking, playerPositions, interval)
    : { states: [], changes: [], dominantFormation: '4-4-2', formationVariability: 0 };

  const defendingTimeline = phaseEvents.defending.length > 0
    ? trackFormationChanges(phaseEvents.defending, playerPositions, interval)
    : { states: [], changes: [], dominantFormation: '4-4-2', formationVariability: 0 };

  const transitionTimeline = phaseEvents.transition.length > 0
    ? trackFormationChanges(phaseEvents.transition, playerPositions, interval)
    : { states: [], changes: [], dominantFormation: '4-4-2', formationVariability: 0 };

  const setPieceTimeline = phaseEvents.set_piece.length > 0
    ? trackFormationChanges(phaseEvents.set_piece, playerPositions, interval)
    : { states: [], changes: [], dominantFormation: '4-4-2', formationVariability: 0 };

  // フェーズ間の比較
  const hasPhaseVariation = (
    attackingTimeline.dominantFormation !== defendingTimeline.dominantFormation ||
    attackingTimeline.dominantFormation !== transitionTimeline.dominantFormation
  );

  // フェーズ変化の柔軟性を計算
  // ユニークなフォーメーション数と各フェーズでの変動性から算出
  const uniqueFormations = new Set([
    attackingTimeline.dominantFormation,
    defendingTimeline.dominantFormation,
    transitionTimeline.dominantFormation,
  ]).size;

  const avgVariability = (
    attackingTimeline.formationVariability +
    defendingTimeline.formationVariability +
    transitionTimeline.formationVariability
  ) / 3;

  const phaseAdaptability = (uniqueFormations - 1) * 0.5 + avgVariability * 0.5;

  return {
    attacking: attackingTimeline,
    defending: defendingTimeline,
    transition: transitionTimeline,
    setPiece: setPieceTimeline,
    comparison: {
      hasPhaseVariation,
      attackingDominant: attackingTimeline.dominantFormation,
      defendingDominant: defendingTimeline.dominantFormation,
      transitionDominant: transitionTimeline.dominantFormation,
      phaseAdaptability: Math.min(1, phaseAdaptability),
    },
  };
}
