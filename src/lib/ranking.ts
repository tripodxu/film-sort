export const RANKING_STATE_VERSION = 1 as const;

export interface RankingOptions {
  seed?: string;
  topN?: number;
}

export interface ActiveInsertion {
  candidateId: string;
  low: number;
  high: number;
  presentationIndex: number;
}

export interface RankingDecision {
  kind: "choose" | "skip" | "defer";
  candidateId: string;
  opponentId: string;
  presentationIndex: number;
  preferredId?: string;
}

/**
 * JSON-only state. It can be persisted directly and passed through a React
 * reducer without retaining class instances, callbacks, or random generators.
 */
export interface RankingState {
  version: typeof RANKING_STATE_VERSION;
  seed: string;
  topN: number;
  sourceIds: readonly string[];
  shuffledIds: readonly string[];
  rankedIds: readonly string[];
  pendingIds: readonly string[];
  deferredIds: readonly string[];
  skippedIds: readonly string[];
  outsideTopIds: readonly string[];
  activeInsertion: ActiveInsertion | null;
  comparisonCount: number;
  estimatedTotalComparisons: number;
  processedCount: number;
  nextPresentationIndex: number;
  completed: boolean;
  decisionLog: readonly RankingDecision[];
}

export interface RankingComparison {
  leftId: string;
  rightId: string;
  candidateId: string;
  opponentId: string;
  candidateOnLeft: boolean;
  presentationIndex: number;
}

export interface RankingProgress {
  comparisonCount: number;
  estimatedTotal: number;
  estimatedRemaining: number;
  processed: number;
  total: number;
  fraction: number;
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function createSeededRandom(seed: string): () => number {
  let state = hashString(seed) || 0x6d2b79f5;

  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function seededShuffle(ids: readonly string[], seed: string): string[] {
  const shuffled = [...ids];
  const random = createSeededRandom(seed);

  for (let index = shuffled.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [shuffled[index], shuffled[swapIndex]] = [
      shuffled[swapIndex],
      shuffled[index],
    ];
  }

  return shuffled;
}

function estimateTotalComparisons(itemCount: number, topN: number): number {
  let total = 0;
  for (let candidateIndex = 1; candidateIndex < itemCount; candidateIndex += 1) {
    const rankedLength = Math.min(candidateIndex, topN);
    total += Math.ceil(Math.log2(rankedLength + 1));
  }
  return total;
}

function scheduleNextCandidate(state: RankingState): RankingState {
  if (state.activeInsertion) return state;

  let candidateId: string | undefined;
  let pendingIds = state.pendingIds;
  let deferredIds = state.deferredIds;

  if (pendingIds.length > 0) {
    [candidateId, ...pendingIds] = pendingIds;
  } else if (deferredIds.length > 0) {
    [candidateId, ...deferredIds] = deferredIds;
  }

  if (candidateId === undefined) {
    return { ...state, completed: true };
  }

  return {
    ...state,
    pendingIds,
    deferredIds,
    activeInsertion: {
      candidateId,
      low: 0,
      high: state.rankedIds.length,
      presentationIndex: state.nextPresentationIndex,
    },
    nextPresentationIndex: state.nextPresentationIndex + 1,
    completed: false,
  };
}

function uniqueIds(ids: readonly string[]): string[] {
  const unique: string[] = [];
  const seen = new Set<string>();

  for (const id of ids) {
    if (typeof id !== "string" || id.length === 0) {
      throw new TypeError("Ranking item IDs must be non-empty strings");
    }
    if (!seen.has(id)) {
      seen.add(id);
      unique.push(id);
    }
  }

  return unique;
}

export function createRankingState(
  ids: readonly string[],
  options: RankingOptions = {},
): RankingState {
  const sourceIds = uniqueIds(ids);
  const requestedTopN = options.topN ?? sourceIds.length;

  if (!Number.isInteger(requestedTopN) || requestedTopN <= 0) {
    if (!(sourceIds.length === 0 && options.topN === undefined)) {
      throw new RangeError("topN must be a positive integer");
    }
  }

  const topN = Math.min(requestedTopN, sourceIds.length);
  const seed = options.seed ?? "film-sort";
  const shuffledIds = seededShuffle(sourceIds, seed);
  const hasFirstItem = shuffledIds.length > 0;

  const initial: RankingState = {
    version: RANKING_STATE_VERSION,
    seed,
    topN,
    sourceIds,
    shuffledIds,
    rankedIds: hasFirstItem ? [shuffledIds[0]] : [],
    pendingIds: shuffledIds.slice(1),
    deferredIds: [],
    skippedIds: [],
    outsideTopIds: [],
    activeInsertion: null,
    comparisonCount: 0,
    estimatedTotalComparisons: estimateTotalComparisons(
      sourceIds.length,
      topN,
    ),
    processedCount: hasFirstItem ? 1 : 0,
    nextPresentationIndex: 0,
    completed: shuffledIds.length <= 1,
    decisionLog: [],
  };

  return initial.completed ? initial : scheduleNextCandidate(initial);
}

function candidateIsOnLeft(
  state: RankingState,
  active: ActiveInsertion,
  opponentId: string,
): boolean {
  const key = [
    state.seed.length,
    state.seed,
    active.presentationIndex,
    active.candidateId.length,
    active.candidateId,
    opponentId.length,
    opponentId,
  ].join(":");
  return (hashString(key) & 1) === 0;
}

export function getCurrentComparison(
  state: RankingState,
): RankingComparison | null {
  const active = state.activeInsertion;
  if (!active || state.completed || active.low >= active.high) return null;

  const opponentIndex = Math.floor((active.low + active.high) / 2);
  const opponentId = state.rankedIds[opponentIndex];
  if (opponentId === undefined) {
    throw new Error("Ranking state has an invalid insertion range");
  }

  const candidateOnLeft = candidateIsOnLeft(state, active, opponentId);
  return {
    leftId: candidateOnLeft ? active.candidateId : opponentId,
    rightId: candidateOnLeft ? opponentId : active.candidateId,
    candidateId: active.candidateId,
    opponentId,
    candidateOnLeft,
    presentationIndex: active.presentationIndex,
  };
}

function appendDecision(
  state: RankingState,
  decision: RankingDecision,
): RankingState {
  return { ...state, decisionLog: [...state.decisionLog, decision] };
}

function finishInsertion(
  state: RankingState,
  insertionIndex: number,
): RankingState {
  const active = state.activeInsertion;
  if (!active) throw new Error("There is no candidate to insert");

  const expanded = [...state.rankedIds];
  expanded.splice(insertionIndex, 0, active.candidateId);
  const outsideTopIds = [
    ...state.outsideTopIds,
    ...expanded.slice(state.topN),
  ];

  return scheduleNextCandidate({
    ...state,
    rankedIds: expanded.slice(0, state.topN),
    outsideTopIds,
    activeInsertion: null,
    processedCount: state.processedCount + 1,
  });
}

export function choosePreferred(
  state: RankingState,
  preferredId: string,
): RankingState {
  const comparison = getCurrentComparison(state);
  if (!comparison || !state.activeInsertion) {
    throw new Error("There is no active comparison");
  }
  if (preferredId !== comparison.leftId && preferredId !== comparison.rightId) {
    throw new RangeError("The preferred item must be in the active comparison");
  }

  const active = state.activeInsertion;
  const opponentIndex = Math.floor((active.low + active.high) / 2);
  const candidateWon = preferredId === active.candidateId;
  const low = candidateWon ? active.low : opponentIndex + 1;
  const high = candidateWon ? opponentIndex : active.high;
  const decision: RankingDecision = {
    kind: "choose",
    candidateId: comparison.candidateId,
    opponentId: comparison.opponentId,
    presentationIndex: comparison.presentationIndex,
    preferredId,
  };

  let next: RankingState = {
    ...state,
    comparisonCount: state.comparisonCount + 1,
    activeInsertion: { ...active, low, high },
  };

  if (low >= high) {
    next = finishInsertion(next, low);
  } else {
    next = {
      ...next,
      activeInsertion: {
        ...next.activeInsertion!,
        presentationIndex: next.nextPresentationIndex,
      },
      nextPresentationIndex: next.nextPresentationIndex + 1,
    };
  }

  return appendDecision(next, decision);
}

export function chooseSide(
  state: RankingState,
  side: "left" | "right",
): RankingState {
  const comparison = getCurrentComparison(state);
  if (!comparison) throw new Error("There is no active comparison");
  return choosePreferred(
    state,
    side === "left" ? comparison.leftId : comparison.rightId,
  );
}

export function skipCurrent(state: RankingState): RankingState {
  const comparison = getCurrentComparison(state);
  if (!comparison || !state.activeInsertion) {
    throw new Error("There is no active candidate to skip");
  }

  const decision: RankingDecision = {
    kind: "skip",
    candidateId: comparison.candidateId,
    opponentId: comparison.opponentId,
    presentationIndex: comparison.presentationIndex,
  };
  const next = scheduleNextCandidate({
    ...state,
    skippedIds: [...state.skippedIds, comparison.candidateId],
    activeInsertion: null,
    processedCount: state.processedCount + 1,
  });

  return appendDecision(next, decision);
}

export function deferCurrent(state: RankingState): RankingState {
  const comparison = getCurrentComparison(state);
  if (!comparison || !state.activeInsertion) {
    throw new Error("There is no active candidate to defer");
  }

  const decision: RankingDecision = {
    kind: "defer",
    candidateId: comparison.candidateId,
    opponentId: comparison.opponentId,
    presentationIndex: comparison.presentationIndex,
  };
  const next = scheduleNextCandidate({
    ...state,
    deferredIds: [...state.deferredIds, comparison.candidateId],
    activeInsertion: null,
  });

  return appendDecision(next, decision);
}

function replayDecision(
  state: RankingState,
  decision: RankingDecision,
): RankingState {
  const comparison = getCurrentComparison(state);
  if (
    !comparison ||
    comparison.candidateId !== decision.candidateId ||
    comparison.opponentId !== decision.opponentId
  ) {
    throw new Error("Decision log cannot be replayed against this ranking");
  }

  switch (decision.kind) {
    case "choose":
      if (decision.preferredId === undefined) {
        throw new Error("A choose decision is missing its preferred item");
      }
      return choosePreferred(state, decision.preferredId);
    case "skip":
      return skipCurrent(state);
    case "defer":
      return deferCurrent(state);
  }
}

export function undoLastAction(state: RankingState): RankingState {
  if (state.decisionLog.length === 0) return state;

  const decisions = state.decisionLog.slice(0, -1);
  let restored = createRankingState(state.sourceIds, {
    seed: state.seed,
    topN: state.topN || undefined,
  });

  for (const decision of decisions) {
    restored = replayDecision(restored, decision);
  }

  return restored;
}

export function getRankingResult(state: RankingState): string[] {
  return [...state.rankedIds];
}

export function getRankingProgress(state: RankingState): RankingProgress {
  const estimatedRemaining = state.completed
    ? 0
    : Math.max(
        state.estimatedTotalComparisons - state.comparisonCount,
        0,
      );
  const comparisonFraction =
    state.estimatedTotalComparisons === 0
      ? 0
      : state.comparisonCount / state.estimatedTotalComparisons;
  const processedFraction =
    state.sourceIds.length === 0
      ? 1
      : state.processedCount / state.sourceIds.length;

  return {
    comparisonCount: state.comparisonCount,
    estimatedTotal: state.estimatedTotalComparisons,
    estimatedRemaining,
    processed: state.processedCount,
    total: state.sourceIds.length,
    fraction: state.completed
      ? 1
      : Math.min(Math.max(comparisonFraction, processedFraction), 0.99),
  };
}

export function serializeRankingState(state: RankingState): string {
  return JSON.stringify(state);
}

function isStringArray(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.every((entry) => typeof entry === "string")
  );
}

function isRankingDecision(value: unknown): value is RankingDecision {
  if (typeof value !== "object" || value === null) return false;
  const decision = value as Partial<RankingDecision>;
  return (
    (decision.kind === "choose" ||
      decision.kind === "skip" ||
      decision.kind === "defer") &&
    typeof decision.candidateId === "string" &&
    typeof decision.opponentId === "string" &&
    Number.isInteger(decision.presentationIndex) &&
    (decision.preferredId === undefined ||
      typeof decision.preferredId === "string")
  );
}

function isActiveInsertion(value: unknown): value is ActiveInsertion | null {
  if (value === null) return true;
  if (typeof value !== "object") return false;
  const active = value as Partial<ActiveInsertion>;
  return (
    typeof active.candidateId === "string" &&
    Number.isInteger(active.low) &&
    Number.isInteger(active.high) &&
    Number.isInteger(active.presentationIndex)
  );
}

function isRankingState(value: unknown): value is RankingState {
  if (typeof value !== "object" || value === null) return false;
  const state = value as Partial<RankingState>;
  return (
    state.version === RANKING_STATE_VERSION &&
    typeof state.seed === "string" &&
    Number.isInteger(state.topN) &&
    isStringArray(state.sourceIds) &&
    isStringArray(state.shuffledIds) &&
    isStringArray(state.rankedIds) &&
    isStringArray(state.pendingIds) &&
    isStringArray(state.deferredIds) &&
    isStringArray(state.skippedIds) &&
    isStringArray(state.outsideTopIds) &&
    isActiveInsertion(state.activeInsertion) &&
    Number.isInteger(state.comparisonCount) &&
    Number.isInteger(state.estimatedTotalComparisons) &&
    Number.isInteger(state.processedCount) &&
    Number.isInteger(state.nextPresentationIndex) &&
    typeof state.completed === "boolean" &&
    Array.isArray(state.decisionLog) &&
    state.decisionLog.every(isRankingDecision)
  );
}

export function deserializeRankingState(serialized: string): RankingState {
  const parsed: unknown = JSON.parse(serialized);
  if (!isRankingState(parsed)) {
    throw new TypeError("Stored ranking state is invalid or unsupported");
  }
  return parsed;
}
