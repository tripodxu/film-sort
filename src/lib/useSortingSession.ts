import { useEffect, useMemo, useRef, useState } from "react";
import {
  chooseSide,
  createRankingState,
  deferWork,
  deserializeRankingState,
  getCurrentComparison,
  getRankingProgress,
  getRankingResult,
  RANKING_MODES,
  serializeRankingState,
  skipWork,
  undoLastAction,
  type RankingMode,
  type RankingState,
} from "./ranking";
import { getCollectionsByKind } from "../data/media";
import {
  mediaLabels,
  type Artwork,
  type Locale,
  type MediaCollection,
  type MediaKind,
} from "../data/mediaKinds";
import { mergeRanking, toRankedItems, type ArtisticProfile, type RankingExport } from "./profile";
import { DRAFT_KEY, stored } from "./storageKeys";
import {
  buildTasteContext,
  jevFailureText,
  readTypesafeConfig,
  requestJevRanking,
} from "./typesafe";
import { track } from "./utils";

/** 草稿体积闸门：读侧超过此值直接丢弃，写侧必须同闸门，否则会「看似保存、实际读不回」。 */
const DRAFT_MAX_WORKS = 1000;
const kinds = Object.keys(mediaLabels) as MediaKind[];

export type Draft = { collection: MediaCollection; ranking: string; profileName: string };

export function loadDraft(): Draft | null {
  try {
    const data = JSON.parse(stored(DRAFT_KEY) ?? "") as Draft;
    const state = deserializeRankingState(data.ranking);
    if (
      state.completed ||
      !kinds.includes(data.collection.kind) ||
      !Array.isArray(data.collection.works) ||
      data.collection.works.length > DRAFT_MAX_WORKS ||
      !state.sourceIds.every((id) =>
        data.collection.works.some((work) => work.id === id && typeof work.title === "string"),
      )
    )
      return null;
    getCurrentComparison(state);
    return data;
  } catch {
    return null;
  }
}

export function resolveRankingTabKey(
  profile: ArtisticProfile | null,
  kind: MediaKind,
  collectionTitle?: string,
): string {
  if (!profile) return kind;
  if (collectionTitle) {
    const exactIdx = profile.rankings.findIndex(
      (r) => r.kind === kind && r.collectionTitle === collectionTitle,
    );
    if (exactIdx >= 0) return `${kind}-${exactIdx}`;
  }
  const kindIdx = profile.rankings.findIndex((r) => r.kind === kind);
  return kindIdx >= 0 ? `${kind}-${kindIdx}` : kind;
}

export interface SortingSessionDeps {
  accountToken: string;
  profileName: string;
  view: string;
  getProfile: () => ArtisticProfile | null;
  getPeer: () => ArtisticProfile | null;
  getNotes: () => Record<string, string>;
  persist: (p: ArtisticProfile) => void;
  setActiveKind: (k: string) => void;
  setProfileName: (n: string) => void;
  setNotice: (n: string) => void;
  navigateTo: (v: string) => void;
  setView: (v: string) => void;
  t: (zh: string, en: string) => string;
  label: (kind: MediaKind) => string;
  locale: Locale;
}

export function useSortingSession(deps: SortingSessionDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const { view, profileName } = deps;

  const [kind, setKind] = useState<MediaKind>("film");
  const [source, setSource] = useState<"builtin" | "custom" | "douban">("builtin");
  const [collection, setCollection] = useState<MediaCollection | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [ranking, setRanking] = useState<RankingState | null>(null);
  const [draft, setDraft] = useState(loadDraft);
  const [topN, setTopN] = useState(10);
  const [seed, setSeed] = useState("");
  const [jevBusy, setJevBusy] = useState(false);
  const [search, setSearch] = useState("");
  const rankingSnapshots = useRef<string[]>([]);

  const comparison = ranking ? getCurrentComparison(ranking) : null;
  const progress = ranking ? getRankingProgress(ranking) : null;
  const worksById = useMemo(
    () => new Map(collection?.works.map((work) => [work.id, work]) ?? []),
    [collection],
  );
  const collections = getCollectionsByKind(kind).filter((item) =>
    [item.title, item.description, ...item.works.map((work) => work.title)]
      .join(" ")
      .toLowerCase()
      .includes(search.toLowerCase()),
  );

  function openCollection(next: MediaCollection) {
    const d = depsRef.current;
    setKind(next.kind);
    setCollection(next);
    setSelected(next.works.map((work) => work.id));
    setTopN(next.topN);
    setRanking(null);
    d.navigateTo("setup");
  }

  /** 仅保存不排序（setup 页）：把当前选中的作品按清单顺序存为画像榜单，不进比较流程 */
  function saveWithoutSorting() {
    const d = depsRef.current;
    if (!collection) return;
    const kept = collection.works.filter((w) => selected.includes(w.id));
    if (kept.length < 1) {
      d.setNotice(d.t("请至少选择 1 件作品。", "Select at least 1 work."));
      return;
    }
    const items = toRankedItems(kept.map((w, i) => ({ ...w, rank: i + 1 })));
    const merged = kept.length - items.length;
    const result: RankingExport = {
      version: 1,
      profileId: d.getProfile()?.profileId ?? crypto.randomUUID(),
      profileName: d.profileName.trim() || d.t("我的艺术人格", "My artistic profile"),
      kind: collection.kind,
      collectionTitle: collection.title,
      createdAt: new Date().toISOString(),
      items,
    };
    const mergedProfile = mergeRanking(d.getProfile(), result);
    d.persist(mergedProfile);
    d.setActiveKind(resolveRankingTabKey(mergedProfile, collection.kind, result.collectionTitle));
    d.setNotice(
      merged > 0
        ? d.t(
            `已保存 ${items.length} 件作品为榜单（按清单顺序，未排序）；另有 ${merged} 件与前面的作品同名同作者，已自动合并。`,
            `Saved ${items.length} works (list order, unsorted); ${merged} duplicate(s) were merged.`,
          )
        : d.t(
            `已保存 ${items.length} 件作品为榜单（按清单顺序，未排序）。`,
            `Saved ${items.length} works as a list (list order, unsorted).`,
          ),
    );
    d.navigateTo("profile");
  }

  /** AI 快排(Jev):把选中作品交给决策模型预测完整顺序,直接成榜。 */
  async function startJevRanking() {
    const d = depsRef.current;
    if (!collection || selected.length < 2 || jevBusy) return;
    const config = readTypesafeConfig();
    const kept = collection.works.filter((work) => selected.includes(work.id));
    setJevBusy(true);
    track("jev_rank_started", { mode: kind, item_count: kept.length });
    try {
      const profile = d.getProfile();
      const result = await requestJevRanking(
        {
          kind: collection.kind,
          collectionTitle: collection.title,
          works: kept.map((work) => ({
            id: work.id,
            title: work.title,
            ...(work.creator ? { creator: work.creator } : {}),
            ...(work.year ? { year: work.year } : {}),
          })),
          ...(profile ? { profileContext: buildTasteContext(profile.rankings) } : {}),
          locale: d.locale === "en" ? "en" : "zh",
        },
        config,
      );
      if (!result.ok) {
        d.setNotice(jevFailureText(result, d.t));
        return;
      }
      const byIndex = new Map(kept.map((work, index) => [index, work]));
      const ordered = result.order
        .map((index) => byIndex.get(index))
        .filter((work): work is (typeof kept)[number] => Boolean(work));
      const items = toRankedItems(ordered.map((work, i) => ({ ...work, rank: i + 1 })));
      const resultExport: RankingExport = {
        version: 1,
        profileId: d.getProfile()?.profileId ?? crypto.randomUUID(),
        profileName: d.profileName.trim() || d.t("我的艺术人格", "My artistic profile"),
        kind: collection.kind,
        collectionTitle: collection.title,
        createdAt: new Date().toISOString(),
        items,
      };
      const mergedProfile = mergeRanking(d.getProfile(), resultExport);
      d.persist(mergedProfile);
      d.setActiveKind(
        resolveRankingTabKey(mergedProfile, collection.kind, resultExport.collectionTitle),
      );
      d.setNotice(
        d.t(
          `AI 快排完成:Jev 依据你的历史取舍预测了 ${items.length} 件作品的顺序(模型 ${result.model});可在榜单页「手动调整」。`,
          `AI quick rank done: Jev predicted the order of ${items.length} works from your history (model ${result.model}); "Reorder" anytime.`,
        ),
      );
      d.navigateTo("profile");
      track("jev_rank_completed", {
        mode: kind,
        item_count: items.length,
        model: result.model,
        input_tokens: result.inputTokens,
      });
    } catch {
      d.setNotice(d.t("AI 快排暂时不可用,请稍后再试。", "AI quick rank is unavailable right now."));
    } finally {
      setJevBusy(false);
    }
  }

  // 排序模式由调用方（SetupView 的 rankMode state）显式传入，不再经 localStorage 中转
  function startRanking(mode: RankingMode) {
    const d = depsRef.current;
    if (!collection || selected.length < 2) return;
    const works = collection.works.filter((work) => selected.includes(work.id));
    const rankMode: RankingMode = RANKING_MODES.includes(mode) ? mode : "classic";
    const next = createRankingState(
      works.map((work) => work.id),
      {
        topN,
        seed: seed.trim() || crypto.randomUUID(),
        mode: rankMode,
      },
    );
    rankingSnapshots.current = [];
    setCollection({ ...collection, works });
    setRanking(next);
    d.navigateTo("sorting");
    d.setNotice("");
    track("sorting_started", {
      mode: kind,
      item_count: works.length,
      top_k: next.topN,
      rank_mode: rankMode,
    });
  }

  function act(
    action: "left" | "right" | "undo" | "skip-left" | "skip-right" | "defer-left" | "defer-right",
  ) {
    const d = depsRef.current;
    if (!ranking || !collection || (ranking.completed && action !== "undo")) return;
    let next: RankingState;
    if (action === "undo") {
      if (rankingSnapshots.current.length > 0) {
        const prev = rankingSnapshots.current.pop()!;
        next = deserializeRankingState(prev);
      } else {
        next = undoLastAction(ranking);
      }
    } else {
      if (rankingSnapshots.current.length >= 50) rankingSnapshots.current.shift();
      rankingSnapshots.current.push(serializeRankingState(ranking));
      if (action === "skip-left") next = skipWork(ranking, comparison!.leftId);
      else if (action === "skip-right") next = skipWork(ranking, comparison!.rightId);
      else if (action === "defer-left") next = deferWork(ranking, comparison!.leftId);
      else if (action === "defer-right") next = deferWork(ranking, comparison!.rightId);
      else next = chooseSide(ranking, action);
    }
    setRanking(next);
    if (next.completed) {
      const items = toRankedItems(
        getRankingResult(next).flatMap((id, index) => {
          const work = worksById.get(id);
          return work ? [{ ...work, rank: index + 1 }] : [];
        }),
      );
      const result: RankingExport = {
        version: 1,
        profileId: crypto.randomUUID(),
        profileName: d.profileName.trim() || d.t("我的艺术人格", "My artistic profile"),
        kind: collection.kind,
        collectionTitle: collection.title,
        createdAt: new Date().toISOString(),
        items,
      };
      const mergedProfile = mergeRanking(d.getProfile(), result);
      d.persist(mergedProfile);
      d.setActiveKind(resolveRankingTabKey(mergedProfile, result.kind, result.collectionTitle));
      setDraft(null);
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* */
      }
      const merged = getRankingResult(next).length - items.length;
      const noticeParts: Array<{ zh: string; en: string }> = [];
      if (merged > 0)
        noticeParts.push({
          zh: `清单里有 ${merged} 件作品同名同作者，已自动合并。`,
          en: `${merged} duplicate(s) were merged.`,
        });
      if (next.mode === "precise" && next.calibration.checked > 0) {
        const pct = Math.round((100 * next.calibration.consistent) / next.calibration.checked);
        noticeParts.push({
          zh: `校准一致率 ${pct}%（${next.calibration.checked} 次复测）。`,
          en: `calibration accuracy ${pct}% over ${next.calibration.checked} rechecks.`,
        });
      }
      if (noticeParts.length > 0)
        d.setNotice(
          d.t(
            `排序完成：${noticeParts.map((p) => p.zh).join(" ")}`,
            `Ranking complete — ${noticeParts.map((p) => p.en).join(" ")}`,
          ),
        );
      d.navigateTo(d.getPeer() && collection.id.startsWith("peer-") ? "compare" : "profile");
      track("ranking_completed", {
        mode: kind,
        item_count: next.sourceIds.length,
        top_k: next.topN,
        comparison_count: next.comparisonCount,
      });
    }
  }

  /**
   * 回到「上一次取舍之前」。优先走快照栈（deserializeRankingState，毫秒级）；
   * 栈空时返回 false，让调用方退回 undoLastAction 重放。
   */
  function rewindLastChoice(): boolean {
    if (!ranking || rankingSnapshots.current.length === 0) return false;
    const previous = rankingSnapshots.current.pop();
    if (previous === undefined) return false;
    try {
      setRanking(deserializeRankingState(previous));
      return true;
    } catch {
      return false;
    }
  }

  function resume() {
    const d = depsRef.current;
    if (!draft) return;
    try {
      rankingSnapshots.current = [];
      setCollection(draft.collection);
      setKind(draft.collection.kind);
      setRanking(deserializeRankingState(draft.ranking));
      d.setProfileName(draft.profileName);
      d.navigateTo("sorting");
    } catch {
      d.setNotice(d.t("草稿无法读取。", "The draft could not be restored."));
    }
  }

  const draftSaveTimer = useRef<number | null>(null);
  const draftLimitNotified = useRef(false);
  const pendingDraft = useRef<{
    collection: MediaCollection;
    ranking: RankingState;
    profileName: string;
  } | null>(null);
  function flushPendingDraft() {
    const d = depsRef.current;
    const pending = pendingDraft.current;
    if (!pending) return;
    pendingDraft.current = null;
    if (draftSaveTimer.current !== null) {
      window.clearTimeout(draftSaveTimer.current);
      draftSaveTimer.current = null;
    }
    if (pending.collection.works.length > DRAFT_MAX_WORKS) {
      if (!draftLimitNotified.current) {
        draftLimitNotified.current = true;
        d.setNotice(
          d.t(
            "收藏超过 1000 件，本次进度不会保存为草稿；建议先完成当前排序。",
            "Collections over 1000 items are not saved as drafts; finish this ranking first.",
          ),
        );
      }
      return;
    }
    draftLimitNotified.current = false;
    const next = {
      collection: pending.collection,
      ranking: serializeRankingState(pending.ranking),
      profileName: pending.profileName,
    };
    setDraft(next);
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    } catch {
      d.setNotice(d.t("进度无法写入浏览器存储。", "Progress could not be saved in this browser."));
    }
  }
  useEffect(() => {
    const clearTimer = () => {
      if (draftSaveTimer.current !== null) {
        window.clearTimeout(draftSaveTimer.current);
        draftSaveTimer.current = null;
      }
    };
    if (!ranking || !collection || ranking.completed) {
      pendingDraft.current = null;
      clearTimer();
      return;
    }
    if (view !== "sorting") {
      flushPendingDraft();
      return;
    }
    pendingDraft.current = { collection, ranking, profileName };
    clearTimer();
    draftSaveTimer.current = window.setTimeout(() => {
      draftSaveTimer.current = null;
      flushPendingDraft();
    }, 500);
    return clearTimer;
  }, [ranking, collection, view, profileName]);

  useEffect(() => {
    const onHide = () => {
      flushPendingDraft();
    };
    window.addEventListener("pagehide", onHide);
    return () => window.removeEventListener("pagehide", onHide);
  }, []);

  return {
    kind,
    setKind,
    source,
    setSource,
    collection,
    setCollection,
    selected,
    setSelected,
    ranking,
    setRanking,
    draft,
    setDraft,
    topN,
    setTopN,
    seed,
    setSeed,
    search,
    setSearch,
    comparison,
    progress,
    worksById: worksById as Map<string, Artwork>,
    collections,
    openCollection,
    saveWithoutSorting,
    startJevRanking,
    jevBusy,
    startRanking,
    act,
    rewindLastChoice,
    resume,
  };
}
