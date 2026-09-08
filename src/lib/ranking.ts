export const RANKING_STATE_VERSION = 2 as const;

const PAIR_COOLDOWN = 3;
const WORK_COOLDOWN = 4;
const MAX_BASELINE_VERIFICATIONS = 4;

export interface RankingOptions { seed?: string; topN?: number }
export interface ActiveInsertion { candidateId: string; low: number; high: number; presentationIndex: number }
export interface VerificationTask { leftId: string; rightId: string; reason: "stability" | "cycle"; cycleKey?: string; expectedWinnerId?: string }
export interface ActiveVerification { task: VerificationTask; presentationIndex: number }
export interface PairEvidence { key: string; leftId: string; rightId: string; preferredId: string; comparisonIndex: number; phase: "ranking" | "verification" }
export interface PreferenceEdge { winnerId: string; loserId: string; count: number }
export interface CycleEvent { key: string; memberIds: readonly string[]; observations: number; consistentConfirmations: number; conflictingConfirmations: number; status: "observed" | "persistent"; tensionRounds: number }
export interface PreferenceTension { level: number; status: "none" | "mild" | "elevated"; cycleCount: number }
export interface RankingDecision { kind: "choose" | "skip" | "defer"; candidateId: string; opponentId: string; presentationIndex: number; preferredId?: string; targetId?: string; phase: "ranking" | "verification" }

/** JSON-only state that is safe to persist in a draft or sync to the account. */
export interface RankingState {
  version: typeof RANKING_STATE_VERSION;
  seed: string; topN: number; sourceIds: readonly string[]; shuffledIds: readonly string[];
  rankedIds: readonly string[]; pendingIds: readonly string[]; deferredIds: readonly string[];
  skippedIds: readonly string[]; outsideTopIds: readonly string[]; activeInsertion: ActiveInsertion | null;
  phase: "ranking" | "verification" | "complete"; verificationQueue: readonly VerificationTask[];
  activeVerification: ActiveVerification | null; pairEvidence: readonly PairEvidence[]; recentPairKeys: readonly string[];
  preferenceEdges: readonly PreferenceEdge[]; cycleEvents: readonly CycleEvent[]; cycleStatus: "none" | "observed" | "persistent"; preferenceTension: PreferenceTension;
  comparisonCount: number; estimatedTotalComparisons: number; processedCount: number; nextPresentationIndex: number;
  completed: boolean; decisionLog: readonly RankingDecision[];
}

export interface RankingComparison {
  leftId: string; rightId: string; candidateId: string; opponentId: string; candidateOnLeft: boolean;
  presentationIndex: number; phase: "ranking" | "verification"; verificationReason?: VerificationTask["reason"];
}
export interface RankingProgress {
  comparisonCount: number; estimatedTotal: number; estimatedRemaining: number; processed: number; total: number;
  fraction: number; phase: RankingState["phase"]; verificationRemaining: number;
}

interface LegacyRankingDecision { kind: "choose" | "skip" | "defer"; candidateId: string; opponentId: string; presentationIndex: number; preferredId?: string }
interface LegacyRankingState {
  version: 1; seed: string; topN: number; sourceIds: readonly string[]; shuffledIds: readonly string[]; rankedIds: readonly string[];
  pendingIds: readonly string[]; deferredIds: readonly string[]; skippedIds: readonly string[]; outsideTopIds: readonly string[];
  activeInsertion: ActiveInsertion | null; comparisonCount: number; estimatedTotalComparisons: number; processedCount: number;
  nextPresentationIndex: number; completed: boolean; decisionLog: readonly LegacyRankingDecision[];
}

function hashString(value: string): number {
  let hash = 0x811c9dc5;
  for (let index = 0; index < value.length; index += 1) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 0x01000193); }
  return hash >>> 0;
}
function createSeededRandom(seed: string): () => number {
  let state = hashString(seed) || 0x6d2b79f5;
  return () => { state = (state + 0x6d2b79f5) >>> 0; let value = state; value = Math.imul(value ^ (value >>> 15), value | 1); value ^= value + Math.imul(value ^ (value >>> 7), value | 61); return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000; };
}
function seededShuffle(ids: readonly string[], seed: string): string[] {
  const shuffled = [...ids]; const random = createSeededRandom(seed);
  for (let index = shuffled.length - 1; index > 0; index -= 1) { const swapIndex = Math.floor(random() * (index + 1)); [shuffled[index], shuffled[swapIndex]] = [shuffled[swapIndex], shuffled[index]]; }
  return shuffled;
}
function estimateTotalComparisons(itemCount: number, topN: number): number {
  let total = 0; for (let candidateIndex = 1; candidateIndex < itemCount; candidateIndex += 1) total += Math.ceil(Math.log2(Math.min(candidateIndex, topN) + 1)); return total;
}
function estimateVerificationCount(itemCount: number, topN: number): number { return itemCount < 2 || topN < 2 ? 0 : Math.min(MAX_BASELINE_VERIFICATIONS, Math.max(1, Math.ceil(topN / 3))); }
function pairKey(leftId: string, rightId: string): string { return leftId < rightId ? `${leftId}\u0000${rightId}` : `${rightId}\u0000${leftId}`; }
function cycleKey(ids: readonly string[]): string { return [...new Set(ids)].sort().join("\u0000"); }
function uniqueIds(ids: readonly string[]): string[] {
  const unique: string[] = []; const seen = new Set<string>();
  for (const id of ids) { if (typeof id !== "string" || id.length === 0) throw new TypeError("Ranking item IDs must be non-empty strings"); if (!seen.has(id)) { seen.add(id); unique.push(id); } }
  return unique;
}
function candidateIsOnLeft(state: RankingState, presentationIndex: number, candidateId: string, opponentId: string): boolean {
  const key = [state.seed.length, state.seed, presentationIndex, candidateId.length, candidateId, opponentId.length, opponentId].join(":");
  return (hashString(key) & 1) === 0;
}
function appendDecision(state: RankingState, decision: RankingDecision): RankingState { return { ...state, decisionLog: [...state.decisionLog, decision] }; }
function updateCycleStatus(events: readonly CycleEvent[]): RankingState["cycleStatus"] { return events.some((event) => event.status === "persistent") ? "persistent" : events.length ? "observed" : "none"; }
function updateCycleTension(events: readonly CycleEvent[]): PreferenceTension {
  const maxRounds = events.reduce((max, event) => Math.max(max, event.tensionRounds), 0);
  const persistentCycles = events.filter((event) => event.status === "persistent").length;
  return maxRounds >= 3 ? { level: maxRounds, status: "elevated", cycleCount: persistentCycles } : maxRounds >= 1 ? { level: maxRounds, status: "mild", cycleCount: persistentCycles } : { level: 0, status: "none", cycleCount: 0 };
}
function findPath(edges: readonly PreferenceEdge[], startId: string, targetId: string): string[] | null {
  const queue: string[][] = [[startId]]; const visited = new Set([startId]);
  while (queue.length) { const path = queue.shift()!; const node = path[path.length - 1]; if (node === targetId) return path; for (const edge of edges) { if (edge.winnerId !== node || visited.has(edge.loserId)) continue; visited.add(edge.loserId); queue.push([...path, edge.loserId]); } }
  return null;
}
function taskKey(task: VerificationTask): string { return `${pairKey(task.leftId, task.rightId)}:${task.reason}:${task.cycleKey ?? ""}`; }
function enqueueTask(tasks: readonly VerificationTask[], task: VerificationTask): VerificationTask[] { return tasks.some((entry) => taskKey(entry) === taskKey(task)) ? [...tasks] : [...tasks, task]; }
function recentlyPresentedPairKeys(state: RankingState): Set<string> {
  // Choices, skips, and deferrals all count as seeing a pair. This prevents a
  // paused insertion from resurfacing the same two works immediately.
  return new Set([
    ...state.recentPairKeys,
    ...state.decisionLog.slice(-PAIR_COOLDOWN).map((decision) => pairKey(decision.candidateId, decision.opponentId)),
  ]);
}
function recentlyPresentedWorkIds(state: RankingState): Set<string> {
  // All decision types (choose, skip, defer) count as seeing a work.
  const recent = new Set<string>();
  for (const decision of state.decisionLog.slice(-WORK_COOLDOWN)) { recent.add(decision.candidateId); recent.add(decision.opponentId); }
  return recent;
}
function initialPairKey(state: RankingState, candidateId: string): string | null {
  if (!state.rankedIds.length) return null;
  const opponentId = state.rankedIds[Math.floor(state.rankedIds.length / 2)];
  return opponentId ? pairKey(candidateId, opponentId) : null;
}
function takeCandidateWithCooldown(state: RankingState, candidates: readonly string[]): [string | undefined, string[]] {
  const recent = recentlyPresentedPairKeys(state);
  const recentWorks = recentlyPresentedWorkIds(state);
  const rankedIds = state.rankedIds;
  const midpoint = rankedIds.length > 0 ? rankedIds[Math.floor(rankedIds.length / 2)] : undefined;
  const eligibleIndex = candidates.findIndex((candidateId) => {
    if (recentWorks.has(candidateId)) return false;
    if (midpoint !== undefined && recentWorks.has(midpoint)) return false;
    const key = initialPairKey(state, candidateId);
    return key === null || !recent.has(key);
  });
  const index = eligibleIndex >= 0 ? eligibleIndex : 0;
  return [candidates[index], candidates.filter((_, candidateIndex) => candidateIndex !== index)];
}

function recordPreference(state: RankingState, preferredId: string, otherId: string, phase: "ranking" | "verification"): RankingState {
  const evidence: PairEvidence = { key: pairKey(preferredId, otherId), leftId: preferredId, rightId: otherId, preferredId, comparisonIndex: state.comparisonCount, phase };
  const existing = state.preferenceEdges.find((edge) => edge.winnerId === preferredId && edge.loserId === otherId);
  const preferenceEdges = existing ? state.preferenceEdges.map((edge) => edge === existing ? { ...edge, count: edge.count + 1 } : edge) : [...state.preferenceEdges, { winnerId: preferredId, loserId: otherId, count: 1 }];
  let cycleEvents = state.cycleEvents; let verificationQueue = state.verificationQueue;
  const path = findPath(state.preferenceEdges, otherId, preferredId);
  if (phase === "ranking" && path && path.length >= 3) {
    const members = [preferredId, ...path.slice(0, -1)]; const key = cycleKey(members); const existingEvent = cycleEvents.find((event) => event.key === key);
    const nextEvent: CycleEvent = existingEvent ? { ...existingEvent, observations: existingEvent.observations + 1 } : { key, memberIds: [...new Set(members)].sort(), observations: 1, consistentConfirmations: 0, conflictingConfirmations: 0, status: "observed", tensionRounds: 0 };
    cycleEvents = existingEvent ? cycleEvents.map((event) => event.key === key ? nextEvent : event) : [...cycleEvents, nextEvent];
    const cyclePath = [preferredId, ...path];
    for (let index = 0; index < cyclePath.length - 1; index += 1) { const winnerId = cyclePath[index]; const loserId = cyclePath[index + 1]; verificationQueue = enqueueTask(verificationQueue, { leftId: winnerId, rightId: loserId, reason: "cycle", cycleKey: key, expectedWinnerId: winnerId }); }
  }
  const pairEvidence = [...state.pairEvidence, evidence];
  return { ...state, pairEvidence, recentPairKeys: pairEvidence.slice(-PAIR_COOLDOWN).map((entry) => entry.key), preferenceEdges, verificationQueue, cycleEvents, cycleStatus: updateCycleStatus(cycleEvents), preferenceTension: updateCycleTension(cycleEvents) };
}
function recordCycleConfirmation(state: RankingState, task: VerificationTask, preferredId: string): RankingState {
  if (!task.cycleKey) return state;
  const cycleEvents = state.cycleEvents.map((event) => {
    if (event.key !== task.cycleKey) return event;
    const consistent = preferredId === task.expectedWinnerId; const consistentConfirmations = event.consistentConfirmations + (consistent ? 1 : 0); const conflictingConfirmations = event.conflictingConfirmations + (consistent ? 0 : 1);
    const tensionRounds = consistent ? event.tensionRounds + 1 : 0;
    return { ...event, consistentConfirmations, conflictingConfirmations, tensionRounds, status: consistentConfirmations >= event.memberIds.length && conflictingConfirmations === 0 ? "persistent" as const : "observed" as const };
  });
  return { ...state, cycleEvents, cycleStatus: updateCycleStatus(cycleEvents), preferenceTension: updateCycleTension(cycleEvents) };
}
function lastPairIndex(state: RankingState, key: string): number { for (let index = state.pairEvidence.length - 1; index >= 0; index -= 1) if (state.pairEvidence[index].key === key) return state.pairEvidence[index].comparisonIndex; return -Infinity; }

function scheduleNextVerification(state: RankingState): RankingState {
  if (state.activeVerification) return state;
  if (state.verificationQueue.length === 0) return { ...state, phase: "complete", completed: true };
  const recent = recentlyPresentedPairKeys(state);
  const recentWorks = recentlyPresentedWorkIds(state);
  const eligibleIndex = state.verificationQueue.findIndex((task) => { const key = pairKey(task.leftId, task.rightId); return !recent.has(key) && !recentWorks.has(task.leftId) && !recentWorks.has(task.rightId) && state.comparisonCount - lastPairIndex(state, key) >= PAIR_COOLDOWN; });
  const alternateIndex = state.verificationQueue.findIndex((task) => !recent.has(pairKey(task.leftId, task.rightId)));
  const index = eligibleIndex >= 0 ? eligibleIndex : alternateIndex >= 0 ? alternateIndex : 0; const task = state.verificationQueue[index];
  return { ...state, verificationQueue: state.verificationQueue.filter((_, taskIndex) => taskIndex !== index), activeVerification: { task, presentationIndex: state.nextPresentationIndex }, nextPresentationIndex: state.nextPresentationIndex + 1, phase: "verification", completed: false };
}
function startVerification(state: RankingState): RankingState {
  let verificationQueue = state.verificationQueue; const baselineCount = estimateVerificationCount(state.sourceIds.length, state.topN);
  for (let index = 0; index < baselineCount; index += 1) { const leftId = state.rankedIds[index]; const rightId = state.rankedIds[index + 1]; if (leftId && rightId) verificationQueue = enqueueTask(verificationQueue, { leftId, rightId, reason: "stability", expectedWinnerId: leftId }); }
  return scheduleNextVerification({ ...state, activeInsertion: null, activeVerification: null, verificationQueue, phase: "verification", completed: false });
}
function scheduleNextCandidate(state: RankingState): RankingState {
  if (state.activeInsertion || state.phase !== "ranking") return state;
  let candidateId: string | undefined; let pendingIds = [...state.pendingIds]; let deferredIds = [...state.deferredIds];
  if (pendingIds.length) [candidateId, pendingIds] = takeCandidateWithCooldown(state, pendingIds);
  else if (deferredIds.length) [candidateId, deferredIds] = takeCandidateWithCooldown(state, deferredIds);
  if (candidateId === undefined) return startVerification({ ...state, pendingIds, deferredIds });
  return { ...state, pendingIds, deferredIds, activeInsertion: { candidateId, low: 0, high: state.rankedIds.length, presentationIndex: state.nextPresentationIndex }, nextPresentationIndex: state.nextPresentationIndex + 1, completed: false };
}

export function createRankingState(ids: readonly string[], options: RankingOptions = {}): RankingState {
  const sourceIds = uniqueIds(ids); const requestedTopN = options.topN ?? sourceIds.length;
  if (!Number.isInteger(requestedTopN) || requestedTopN <= 0) { if (!(sourceIds.length === 0 && options.topN === undefined)) throw new RangeError("topN must be a positive integer"); }
  const topN = Math.min(requestedTopN, sourceIds.length); const seed = options.seed ?? "film-sort"; const shuffledIds = seededShuffle(sourceIds, seed); const hasFirstItem = shuffledIds.length > 0; const completed = shuffledIds.length <= 1;
  const initial: RankingState = { version: RANKING_STATE_VERSION, seed, topN, sourceIds, shuffledIds, rankedIds: hasFirstItem ? [shuffledIds[0]] : [], pendingIds: shuffledIds.slice(1), deferredIds: [], skippedIds: [], outsideTopIds: [], activeInsertion: null, phase: completed ? "complete" : "ranking", verificationQueue: [], activeVerification: null, pairEvidence: [], recentPairKeys: [], preferenceEdges: [], cycleEvents: [], cycleStatus: "none", preferenceTension: { level: 0, status: "none", cycleCount: 0 }, comparisonCount: 0, estimatedTotalComparisons: estimateTotalComparisons(sourceIds.length, topN) + estimateVerificationCount(sourceIds.length, topN), processedCount: hasFirstItem ? 1 : 0, nextPresentationIndex: 0, completed, decisionLog: [] };
  return initial.completed ? initial : scheduleNextCandidate(initial);
}

export function getCurrentComparison(state: RankingState): RankingComparison | null {
  if (state.completed) return null;
  if (state.phase === "verification" && state.activeVerification) {
    const { task, presentationIndex } = state.activeVerification; const candidateOnLeft = candidateIsOnLeft(state, presentationIndex, task.leftId, task.rightId);
    return { leftId: candidateOnLeft ? task.leftId : task.rightId, rightId: candidateOnLeft ? task.rightId : task.leftId, candidateId: task.leftId, opponentId: task.rightId, candidateOnLeft, presentationIndex, phase: "verification", verificationReason: task.reason };
  }
  const active = state.activeInsertion; if (!active || state.phase !== "ranking" || active.low >= active.high) return null;
  const opponentIndex = Math.floor((active.low + active.high) / 2); const opponentId = state.rankedIds[opponentIndex]; if (opponentId === undefined) throw new Error("Ranking state has an invalid insertion range");
  const candidateOnLeft = candidateIsOnLeft(state, active.presentationIndex, active.candidateId, opponentId);
  return { leftId: candidateOnLeft ? active.candidateId : opponentId, rightId: candidateOnLeft ? opponentId : active.candidateId, candidateId: active.candidateId, opponentId, candidateOnLeft, presentationIndex: active.presentationIndex, phase: "ranking" };
}
function finishInsertion(state: RankingState, insertionIndex: number): RankingState {
  const active = state.activeInsertion; if (!active) throw new Error("There is no candidate to insert"); const expanded = [...state.rankedIds]; expanded.splice(insertionIndex, 0, active.candidateId);
  return scheduleNextCandidate({ ...state, rankedIds: expanded.slice(0, state.topN), outsideTopIds: [...state.outsideTopIds, ...expanded.slice(state.topN)], activeInsertion: null, processedCount: state.processedCount + 1 });
}
function completeVerification(state: RankingState, preferredId: string, decision: RankingDecision): RankingState {
  const active = state.activeVerification; if (!active) throw new Error("There is no active verification"); const otherId = preferredId === active.task.leftId ? active.task.rightId : active.task.leftId;
  let next = recordPreference({ ...state, comparisonCount: state.comparisonCount + 1, activeVerification: null }, preferredId, otherId, "verification"); next = recordCycleConfirmation(next, active.task, preferredId);
  return appendDecision(scheduleNextVerification(next), decision);
}
export function choosePreferred(state: RankingState, preferredId: string): RankingState {
  const comparison = getCurrentComparison(state); if (!comparison) throw new Error("There is no active comparison"); if (preferredId !== comparison.leftId && preferredId !== comparison.rightId) throw new RangeError("The preferred item must be in the active comparison");
  const decision: RankingDecision = { kind: "choose", candidateId: comparison.candidateId, opponentId: comparison.opponentId, presentationIndex: comparison.presentationIndex, preferredId, phase: comparison.phase };
  if (comparison.phase === "verification") return completeVerification(state, preferredId, decision);
  const active = state.activeInsertion; if (!active) throw new Error("There is no active insertion"); const opponentIndex = Math.floor((active.low + active.high) / 2); const candidateWon = preferredId === active.candidateId; const low = candidateWon ? active.low : opponentIndex + 1; const high = candidateWon ? opponentIndex : active.high; const otherId = candidateWon ? comparison.opponentId : comparison.candidateId;
  let next = recordPreference({ ...state, comparisonCount: state.comparisonCount + 1, activeInsertion: { ...active, low, high } }, preferredId, otherId, "ranking");
  if (low >= high) next = finishInsertion(next, low); else next = { ...next, activeInsertion: { ...next.activeInsertion!, presentationIndex: next.nextPresentationIndex }, nextPresentationIndex: next.nextPresentationIndex + 1 };
  return appendDecision(next, decision);
}
export function chooseSide(state: RankingState, side: "left" | "right"): RankingState { const comparison = getCurrentComparison(state); if (!comparison) throw new Error("There is no active comparison"); return choosePreferred(state, side === "left" ? comparison.leftId : comparison.rightId); }
function skipVerification(state: RankingState): RankingState { const comparison = getCurrentComparison(state); if (!comparison || !state.activeVerification) throw new Error("There is no active verification"); return appendDecision(scheduleNextVerification({ ...state, activeVerification: null }), { kind: "skip", candidateId: comparison.candidateId, opponentId: comparison.opponentId, presentationIndex: comparison.presentationIndex, targetId: comparison.candidateId, phase: "verification" }); }
export function skipCurrent(state: RankingState): RankingState {
  if (state.phase === "verification") return skipVerification(state); const comparison = getCurrentComparison(state); if (!comparison || !state.activeInsertion) throw new Error("There is no active candidate to skip");
  return appendDecision(scheduleNextCandidate({ ...state, skippedIds: [...state.skippedIds, comparison.candidateId], activeInsertion: null, processedCount: state.processedCount + 1 }), { kind: "skip", candidateId: comparison.candidateId, opponentId: comparison.opponentId, presentationIndex: comparison.presentationIndex, targetId: comparison.candidateId, phase: "ranking" });
}
function deferVerification(state: RankingState): RankingState { const comparison = getCurrentComparison(state); const active = state.activeVerification; if (!comparison || !active) throw new Error("There is no active verification"); return appendDecision(scheduleNextVerification({ ...state, activeVerification: null, verificationQueue: [...state.verificationQueue, active.task] }), { kind: "defer", candidateId: comparison.candidateId, opponentId: comparison.opponentId, presentationIndex: comparison.presentationIndex, targetId: comparison.candidateId, phase: "verification" }); }
export function deferCurrent(state: RankingState): RankingState {
  if (state.phase === "verification") return deferVerification(state); const comparison = getCurrentComparison(state); if (!comparison || !state.activeInsertion) throw new Error("There is no active candidate to defer");
  return appendDecision(scheduleNextCandidate({ ...state, deferredIds: [...state.deferredIds, comparison.candidateId], activeInsertion: null }), { kind: "defer", candidateId: comparison.candidateId, opponentId: comparison.opponentId, presentationIndex: comparison.presentationIndex, targetId: comparison.candidateId, phase: "ranking" });
}
function skipOrDeferOpponent(state: RankingState, kind: "skip" | "defer"): RankingState {
  const comparison = getCurrentComparison(state); if (!comparison || !state.activeInsertion) throw new Error("There is no active comparison"); const active = state.activeInsertion; const opponentIndex = state.rankedIds.indexOf(comparison.opponentId); if (opponentIndex === -1) throw new Error("Opponent not found in ranked list"); const newRankedIds = state.rankedIds.filter((_, index) => index !== opponentIndex); const newHigh = active.high - 1;
  let next: RankingState = { ...state, rankedIds: newRankedIds, [kind === "skip" ? "skippedIds" : "deferredIds"]: [...state[kind === "skip" ? "skippedIds" : "deferredIds"], comparison.opponentId], comparisonCount: state.comparisonCount + 1, activeInsertion: { ...active, high: newHigh } };
  if (active.low >= newHigh) next = finishInsertion(next, active.low); else next = { ...next, activeInsertion: { ...next.activeInsertion!, presentationIndex: next.nextPresentationIndex }, nextPresentationIndex: next.nextPresentationIndex + 1 };
  return appendDecision(next, { kind, candidateId: comparison.candidateId, opponentId: comparison.opponentId, presentationIndex: comparison.presentationIndex, targetId: comparison.opponentId, phase: "ranking" });
}
export function skipWork(state: RankingState, workId: string): RankingState { const comparison = getCurrentComparison(state); if (!comparison) throw new Error("There is no active comparison"); if (state.phase === "verification") return skipVerification(state); if (workId === comparison.candidateId) return skipCurrent(state); if (workId === comparison.opponentId) return skipOrDeferOpponent(state, "skip"); throw new RangeError("The work must be in the active comparison"); }
export function deferWork(state: RankingState, workId: string): RankingState { const comparison = getCurrentComparison(state); if (!comparison) throw new Error("There is no active comparison"); if (state.phase === "verification") return deferVerification(state); if (workId === comparison.candidateId) return deferCurrent(state); if (workId === comparison.opponentId) return skipOrDeferOpponent(state, "defer"); throw new RangeError("The work must be in the active comparison"); }
function replayDecision(state: RankingState, decision: RankingDecision): RankingState { const comparison = getCurrentComparison(state); if (!comparison || comparison.candidateId !== decision.candidateId || comparison.opponentId !== decision.opponentId || comparison.phase !== decision.phase) throw new Error("Decision log cannot be replayed against this ranking"); if (decision.kind === "choose") { if (!decision.preferredId) throw new Error("A choose decision is missing its preferred item"); return choosePreferred(state, decision.preferredId); } if (decision.phase === "verification") return decision.kind === "skip" ? skipCurrent(state) : deferCurrent(state); const targetId = decision.targetId ?? comparison.candidateId; return decision.kind === "skip" ? skipWork(state, targetId) : deferWork(state, targetId); }
export function undoLastAction(state: RankingState): RankingState { if (!state.decisionLog.length) return state; let restored = createRankingState(state.sourceIds, { seed: state.seed, topN: state.topN || undefined }); for (const decision of state.decisionLog.slice(0, -1)) restored = replayDecision(restored, decision); return restored; }
export function getRankingResult(state: RankingState): string[] { return [...state.rankedIds]; }
export function getRankingProgress(state: RankingState): RankingProgress { const estimatedRemaining = state.completed ? 0 : Math.max(state.estimatedTotalComparisons - state.comparisonCount, state.verificationQueue.length + (state.activeVerification ? 1 : 0), 0); const comparisonFraction = state.estimatedTotalComparisons === 0 ? 0 : state.comparisonCount / state.estimatedTotalComparisons; const processedFraction = state.sourceIds.length === 0 ? 1 : state.processedCount / state.sourceIds.length; return { comparisonCount: state.comparisonCount, estimatedTotal: state.estimatedTotalComparisons, estimatedRemaining, processed: state.processedCount, total: state.sourceIds.length, fraction: state.completed ? 1 : Math.min(Math.max(comparisonFraction, processedFraction), 0.99), phase: state.phase, verificationRemaining: state.verificationQueue.length + (state.activeVerification ? 1 : 0) }; }
export function serializeRankingState(state: RankingState): string { return JSON.stringify(state); }

function isStringArray(value: unknown): value is string[] { return Array.isArray(value) && value.every((entry) => typeof entry === "string"); }
function isActiveInsertion(value: unknown): value is ActiveInsertion | null { if (value === null) return true; if (typeof value !== "object") return false; const active = value as Partial<ActiveInsertion>; return typeof active.candidateId === "string" && Number.isInteger(active.low) && Number.isInteger(active.high) && Number.isInteger(active.presentationIndex); }
function isLegacyDecision(value: unknown): value is LegacyRankingDecision { if (typeof value !== "object" || value === null) return false; const decision = value as Partial<LegacyRankingDecision>; return (decision.kind === "choose" || decision.kind === "skip" || decision.kind === "defer") && typeof decision.candidateId === "string" && typeof decision.opponentId === "string" && Number.isInteger(decision.presentationIndex) && (decision.preferredId === undefined || typeof decision.preferredId === "string"); }
function isDecision(value: unknown): value is RankingDecision { return isLegacyDecision(value) && ((value as Partial<RankingDecision>).phase === "ranking" || (value as Partial<RankingDecision>).phase === "verification"); }
function isTask(value: unknown): value is VerificationTask { if (typeof value !== "object" || value === null) return false; const task = value as Partial<VerificationTask>; return typeof task.leftId === "string" && typeof task.rightId === "string" && (task.reason === "stability" || task.reason === "cycle") && (task.cycleKey === undefined || typeof task.cycleKey === "string") && (task.expectedWinnerId === undefined || typeof task.expectedWinnerId === "string"); }
function isActiveVerification(value: unknown): value is ActiveVerification | null { if (value === null) return true; if (typeof value !== "object") return false; const active = value as Partial<ActiveVerification>; return isTask(active.task) && Number.isInteger(active.presentationIndex); }
function isEvidence(value: unknown): value is PairEvidence { if (typeof value !== "object" || value === null) return false; const evidence = value as Partial<PairEvidence>; return typeof evidence.key === "string" && typeof evidence.leftId === "string" && typeof evidence.rightId === "string" && typeof evidence.preferredId === "string" && Number.isInteger(evidence.comparisonIndex) && (evidence.phase === "ranking" || evidence.phase === "verification"); }
function isEdge(value: unknown): value is PreferenceEdge { if (typeof value !== "object" || value === null) return false; const edge = value as Partial<PreferenceEdge>; return typeof edge.winnerId === "string" && typeof edge.loserId === "string" && typeof edge.count === "number" && Number.isInteger(edge.count) && edge.count > 0; }
function isTension(value: unknown): value is PreferenceTension { if (typeof value !== "object" || value === null) return false; const t = value as Partial<PreferenceTension>; return typeof t.level === "number" && Number.isInteger(t.level) && (t.status === "none" || t.status === "mild" || t.status === "elevated") && typeof t.cycleCount === "number" && Number.isInteger(t.cycleCount); }
function isCycle(value: unknown): value is CycleEvent { if (typeof value !== "object" || value === null) return false; const event = value as Partial<CycleEvent>; return typeof event.key === "string" && isStringArray(event.memberIds) && Number.isInteger(event.observations) && Number.isInteger(event.consistentConfirmations) && Number.isInteger(event.conflictingConfirmations) && (event.status === "observed" || event.status === "persistent") && (event.tensionRounds === undefined || (Number.isInteger(event.tensionRounds) && (event.tensionRounds as number) >= 0)); }
function hasBaseShape(value: unknown): value is Record<string, unknown> & { version: number; decisionLog: readonly unknown[] } { if (typeof value !== "object" || value === null) return false; const state = value as Partial<RankingState> & { version?: unknown; decisionLog?: unknown }; return typeof state.version === "number" && typeof state.seed === "string" && Number.isInteger(state.topN) && isStringArray(state.sourceIds) && isStringArray(state.shuffledIds) && isStringArray(state.rankedIds) && isStringArray(state.pendingIds) && isStringArray(state.deferredIds) && isStringArray(state.skippedIds) && isStringArray(state.outsideTopIds) && isActiveInsertion(state.activeInsertion) && Number.isInteger(state.comparisonCount) && Number.isInteger(state.estimatedTotalComparisons) && Number.isInteger(state.processedCount) && Number.isInteger(state.nextPresentationIndex) && typeof state.completed === "boolean" && Array.isArray(state.decisionLog); }
function isRankingState(value: unknown): value is RankingState { if (!hasBaseShape(value)) return false; const state = value as Partial<RankingState>; const decisions = state.decisionLog ?? []; return state.version === RANKING_STATE_VERSION && (state.phase === "ranking" || state.phase === "verification" || state.phase === "complete") && Array.isArray(state.verificationQueue) && state.verificationQueue.every(isTask) && isActiveVerification(state.activeVerification) && Array.isArray(state.pairEvidence) && state.pairEvidence.every(isEvidence) && isStringArray(state.recentPairKeys) && Array.isArray(state.preferenceEdges) && state.preferenceEdges.every(isEdge) && Array.isArray(state.cycleEvents) && state.cycleEvents.every(isCycle) && (state.cycleStatus === "none" || state.cycleStatus === "observed" || state.cycleStatus === "persistent") && (state.preferenceTension === undefined || isTension(state.preferenceTension)) && decisions.every(isDecision); }
function isLegacyState(value: unknown): value is LegacyRankingState { if (!hasBaseShape(value) || value.version !== 1) return false; const decisions = value.decisionLog ?? []; return decisions.every(isLegacyDecision); }
function migrateLegacyState(legacy: LegacyRankingState): RankingState { const pairEvidence: PairEvidence[] = legacy.decisionLog.flatMap((decision, index) => decision.kind === "choose" && decision.preferredId ? [{ key: pairKey(decision.candidateId, decision.opponentId), leftId: decision.candidateId, rightId: decision.opponentId, preferredId: decision.preferredId, comparisonIndex: index + 1, phase: "ranking" as const }] : []); const preferenceEdges: PreferenceEdge[] = []; for (const evidence of pairEvidence) { const otherId = evidence.preferredId === evidence.leftId ? evidence.rightId : evidence.leftId; const found = preferenceEdges.find((edge) => edge.winnerId === evidence.preferredId && edge.loserId === otherId); if (found) found.count = (found.count ?? 0) + 1; else preferenceEdges.push({ winnerId: evidence.preferredId, loserId: otherId, count: 1 }); } return { ...legacy, version: RANKING_STATE_VERSION, phase: legacy.completed ? "complete" : "ranking", verificationQueue: [], activeVerification: null, pairEvidence, recentPairKeys: pairEvidence.slice(-PAIR_COOLDOWN).map((entry) => entry.key), preferenceEdges, cycleEvents: [], cycleStatus: "none", preferenceTension: { level: 0, status: "none", cycleCount: 0 }, estimatedTotalComparisons: Math.max(legacy.estimatedTotalComparisons, legacy.comparisonCount), decisionLog: legacy.decisionLog.map((decision) => ({ ...decision, phase: "ranking" as const })) }; }
export function deserializeRankingState(serialized: string): RankingState {
  const parsed: unknown = JSON.parse(serialized);
  if (isRankingState(parsed)) {
    const state = parsed as RankingState;
    if (!state.preferenceTension) return { ...state, preferenceTension: updateCycleTension(state.cycleEvents) };
    const patchedEvents = state.cycleEvents.map((event) => "tensionRounds" in event ? event : { ...event, tensionRounds: 0 }) as readonly CycleEvent[];
    return patchedEvents === state.cycleEvents ? state : { ...state, cycleEvents: patchedEvents, preferenceTension: updateCycleTension(patchedEvents) };
  }
  if (isLegacyState(parsed)) return migrateLegacyState(parsed);
  throw new TypeError("Stored ranking state is invalid or unsupported");
}
