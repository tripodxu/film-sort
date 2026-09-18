import { useState, useEffect, useRef, useMemo } from "react";
import {
  createRankingState,
  chooseSide,
  deferWork,
  deserializeRankingState,
  getCurrentComparison,
  getRankingProgress,
  getRankingResult,
  serializeRankingState,
  skipWork,
  undoLastAction,
  type RankingState,
} from "./ranking";
import {
  getCollectionsByKind,
  mediaLabels,
  type Artwork,
  type MediaCollection,
  type MediaKind,
} from "../data/media";
import {
  dedupeByTitle,
  mergeRanking,
  toRankedItems,
  workIdentity,
  type ArtisticProfile,
  type RankingExport,
} from "./profile";
import { track, type Locale } from "./utils";

const DRAFT_KEY = "art-rank:draft:v2";
const kinds = Object.keys(mediaLabels) as MediaKind[];

export type Draft = { collection: MediaCollection; ranking: string; profileName: string };

function stored(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function loadDraft(): Draft | null {
  try {
    const data = JSON.parse(stored(DRAFT_KEY) ?? "") as Draft;
    const state = deserializeRankingState(data.ranking);
    if (
      state.completed ||
      !kinds.includes(data.collection.kind) ||
      !Array.isArray(data.collection.works) ||
      data.collection.works.length > 1000 ||
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

export interface SortingDeps {
  /** Current values, refreshed each render — needed for effect dependency arrays. */
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

export function useSorting(deps: SortingDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const { view, profileName, accountToken } = deps;

  const [kind, setKind] = useState<MediaKind>("film");
  const [source, setSource] = useState<"builtin" | "custom" | "douban">("builtin");
  const [collection, setCollection] = useState<MediaCollection | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [ranking, setRanking] = useState<RankingState | null>(null);
  const [draft, setDraft] = useState(loadDraft);
  const [topN, setTopN] = useState(10);
  const [seed, setSeed] = useState("");
  const [customText, setCustomText] = useState("");
  const [customItem, setCustomItem] = useState("");
  const [customWorks, setCustomWorks] = useState<Artwork[]>([]);
  const [customDeselected, setCustomDeselected] = useState<string[]>([]);
  const [importProgress, setImportProgress] = useState<{
    done: number;
    total: number | null;
    label: string;
  } | null>(null);
  const [cloudCollections, setCloudCollections] = useState<
    Array<MediaCollection & { remoteId: number }>
  >([]);
  const [doubanLimit, setDoubanLimit] = useState(50);
  const [search, setSearch] = useState("");
  const [colCount, setColCount] = useState<number>(() => {
    try {
      return Number(localStorage.getItem("art-rank:cols")) || 3;
    } catch {
      return 3;
    }
  });
  const [importCap, setImportCapState] = useState<number>(() => {
    const v = Number(localStorage.getItem("art-rank:import-cap"));
    return v >= 50 && v <= 1000 ? v : 300;
  });
  function setImportCap(v: number) {
    setImportCapState(v);
    try {
      localStorage.setItem("art-rank:import-cap", String(v));
    } catch {
      /* */
    }
  }
  const [busy, setBusy] = useState(false);
  const rankingSnapshots = useRef<string[]>([]);
  const importingRef = useRef(false);

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

  function chooseKindFn(next: MediaKind) {
    const d = depsRef.current;
    setKind(next);
    setSource("builtin");
    setSearch("");
    setCustomText("");
    setCustomWorks([]);
    d.navigateTo("source");
  }

  async function searchWorks(query: string): Promise<Artwork[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    try {
      if (kind === "other") {
        const response = await fetch(`/api/other/list?key=${encodeURIComponent(trimmed)}`, {
          signal: AbortSignal.timeout(15000),
        });
        const data = (await response.json()) as {
          data?: Array<{ title?: string; subtitle?: string; year?: number; poster_url?: string }>;
        };
        return (data.data ?? [])
          .slice(0, 6)
          .map((item) => ({
            id: `search-${Math.random().toString(36).slice(2, 10)}`,
            title: item.title ?? "",
            subtitle: item.subtitle,
            year: item.year,
            posterUrls: item.poster_url ? [item.poster_url] : undefined,
          }))
          .filter((work) => work.title);
      }
      const apiType = kind === "film" ? "movie" : kind;
      const response = await fetch(
        `/api/${apiType}/list?key=${encodeURIComponent(trimmed)}&page=1`,
        { signal: AbortSignal.timeout(15000) },
      );
      const data = (await response.json()) as {
        data?: Array<{
          title?: string;
          year?: string;
          rating?: string;
          author?: string;
          artist?: string;
          cover?: string;
          actors?: string[];
        }>;
      };
      return (data.data ?? [])
        .slice(0, 6)
        .map((item) => ({
          id: `search-${Math.random().toString(36).slice(2, 10)}`,
          title: item.title ?? "",
          creator:
            item.author ||
            item.artist ||
            (Array.isArray(item.actors) ? item.actors.slice(0, 2).join("/") : undefined),
          year: item.year ? Number(item.year) || undefined : undefined,
          posterUrls: item.cover ? [item.cover] : undefined,
        }))
        .filter((work) => work.title);
    } catch {
      return [];
    }
  }

  function addCustomWork(work: Artwork) {
    setCustomWorks((cur) =>
      cur.some((w) => w.title === work.title && w.year === work.year) ? cur : [...cur, work],
    );
  }
  function removeCustomWork(id: string) {
    setCustomWorks((cur) => cur.filter((w) => w.id !== id));
  }

  function openCollectionFn(next: MediaCollection) {
    const d = depsRef.current;
    setKind(next.kind);
    setCollection(next);
    setSelected(next.works.map((work) => work.id));
    setTopN(next.topN);
    setRanking(null);
    d.navigateTo("setup");
  }

  function loadCustomWorksFn(works?: Artwork[]) {
    const d = depsRef.current;
    const list = works ?? customWorks;
    if (list.length < 2) {
      d.setNotice(d.t("至少添加 2 件作品再开始。", "Add at least 2 works first."));
      return;
    }
    const next: MediaCollection = {
      id: `custom-${kind}-${crypto.randomUUID()}`,
      kind,
      source: "custom",
      title: `我的${mediaLabels[kind].label}清单`,
      description: "",
      topN: Math.min(10, list.length),
      works: list,
    };
    openCollectionFn(next);
    void saveCollectionCloudFn(next);
  }

  /** 仅保存不排序：把当前清单（去掉取消勾选的）按现有顺序存为画像榜单，不进比较流程 */
  function saveCustomWorksFn() {
    const d = depsRef.current;
    const kept = customWorks.filter((w) => !customDeselected.includes(w.id));
    if (!kept.length) {
      d.setNotice(d.t("清单为空。", "The list is empty."));
      return;
    }
    // 唯一可落库形状：白名单投影 + 按 identity 去重 + 重排 rank。
    // 去重必须发生在写入侧，否则重复曲目会在下次读取时把整份画像带崩。
    const items = toRankedItems(kept.map((w, i) => ({ ...w, rank: i + 1 })));
    const merged = kept.length - items.length;
    const ranking: RankingExport = {
      version: 1,
      profileId: d.getProfile()?.profileId ?? crypto.randomUUID(),
      profileName: d.profileName.trim() || d.t("我的艺术人格", "My artistic profile"),
      kind,
      collectionTitle: `我的${mediaLabels[kind].label}清单`,
      createdAt: new Date().toISOString(),
      items,
    };
    d.persist(mergeRanking(d.getProfile(), ranking));
    d.setActiveKind(kind);
    void saveCollectionCloudFn({
      id: `custom-${kind}-${crypto.randomUUID()}`,
      kind,
      source: "custom",
      title: ranking.collectionTitle,
      description: "",
      topN: Math.min(10, kept.length),
      works: kept,
    });
    d.setNotice(
      merged > 0
        ? d.t(
            `已保存 ${items.length} 件作品为榜单（按导入顺序，未排序）；另有 ${merged} 件与前面的作品同名同作者，已自动合并。`,
            `Saved ${items.length} works (import order, unsorted); ${merged} duplicate(s) were merged.`,
          )
        : d.t(
            `已保存 ${items.length} 件作品为榜单（按导入顺序，未排序）。`,
            `Saved ${items.length} works as a list (import order, unsorted).`,
          ),
    );
    d.navigateTo("profile");
  }

  function clearCustomWorksFn() {
    setCustomWorks([]);
    setCustomDeselected([]);
  }

  /** 仅保存不排序（setup 页）：把当前选中的作品按清单顺序存为画像榜单，不进比较流程 */
  function saveWithoutSortingFn() {
    const d = depsRef.current;
    if (!collection) return;
    const kept = collection.works.filter((w) => selected.includes(w.id));
    if (kept.length < 1) {
      d.setNotice(d.t("请至少选择 1 件作品。", "Select at least 1 work."));
      return;
    }
    // 唯一可落库形状 + 按 identity 去重，见 saveCustomWorksFn 的说明。
    const items = toRankedItems(kept.map((w, i) => ({ ...w, rank: i + 1 })));
    const merged = kept.length - items.length;
    const ranking: RankingExport = {
      version: 1,
      profileId: d.getProfile()?.profileId ?? crypto.randomUUID(),
      profileName: d.profileName.trim() || d.t("我的艺术人格", "My artistic profile"),
      kind: collection.kind,
      collectionTitle: collection.title,
      createdAt: new Date().toISOString(),
      items,
    };
    d.persist(mergeRanking(d.getProfile(), ranking));
    d.setActiveKind(collection.kind);
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

  function applyImportedWorks(
    works: Array<Artwork & { type?: string; poster_url?: string }>,
    silent = false,
  ) {
    const d = depsRef.current;
    // 保留 subtitle：海报缓存键两侧都写作 `subtitle ?? title`，丢掉它会让
    // 客户端请求的键与服务端（导入时种子化 poster_urls）写下的键对不上。
    const normalized = works.map((w) => ({
      id: w.id || `imp-${Math.random().toString(36).slice(2, 10)}`,
      title: w.title,
      creator: w.creator,
      year: w.year,
      ...(w.subtitle ? { subtitle: w.subtitle } : {}),
      posterUrls: w.posterUrls ?? (w.poster_url ? [w.poster_url] : undefined),
    })) as Array<Artwork & { type?: string }>;
    const matching = normalized.filter((w) => !w.type || w.type === kind);
    const others = normalized.length - matching.length;
    // **批内去重**：原先的 seen 只由「已有清单」构建，从不把本批已接受的作品加进去，
    // 于是同一批导入里的同名曲目全部放行——150 首网易云歌单里出现两份「童话/光良」
    // 就是这么来的（网易云导入不带 year，identity 少了唯一区分维度）。
    // 口径与读写两侧共用 workIdentity，避免再次单侧漂移。
    const unique = dedupeByTitle(matching);
    setCustomWorks((cur) => {
      const seen = new Set(cur.map((w) => workIdentity(w.title, w.year, w.creator)));
      return [...cur, ...unique.filter((w) => !seen.has(workIdentity(w.title, w.year, w.creator)))];
    });
    if (silent) return unique.length;
    d.setNotice(
      others > 0
        ? d.t(
            `已加入 ${unique.length} 件${d.label(kind)}作品；另有 ${others} 件其他媒介，切换媒介后可重新导入。`,
            `Added ${unique.length} ${d.label(kind)} works; ${others} other media — switch and re-import.`,
          )
        : d.t(`已加入 ${unique.length} 件作品。`, `Added ${unique.length} works.`),
    );
    return unique.length;
  }

  /** 分批导入引擎：按 offset/nextOffset 游标循环拉取，边拉边入清单并更新进度，直到达上限/无更多/出错 */
  async function runBatchedImport(endpoint: string, label: string, forceType?: string) {
    const d = depsRef.current;
    if (!d.accountToken) {
      d.setNotice(d.t("请先登录后再导入。", "Sign in to import."));
      return;
    }
    if (importingRef.current) return; // 防重入
    const target = endpoint.trim();
    if (!target) return;
    importingRef.current = true;
    const cap = importCap;
    setBusy(true);
    let offset = 0,
      total: number | null = null,
      fetched = 0,
      batches = 0,
      failed = false;
    setImportProgress({ done: 0, total, label });
    try {
      for (;;) {
        const size = Math.min(300, cap - offset);
        if (size <= 0) break;
        const response = await fetch(
          `${target}${target.includes("?") ? "&" : "?"}offset=${offset}&limit=${size}`,
          {
            headers: { authorization: `Bearer ${d.accountToken}` },
            signal: AbortSignal.timeout(120000),
          },
        );
        const data = (await response.json()) as {
          works?: Array<Artwork & { type?: string; poster_url?: string }>;
          listTotal?: number | null;
          hasMore?: boolean;
          nextOffset?: number;
          msg?: string;
          error?: string;
        };
        if (!response.ok || !data.works) {
          const msg = data.msg ?? data.error ?? d.t("未知错误", "unknown error");
          d.setNotice(
            offset > 0
              ? d.t(`已抓取 ${offset} 件后中断：${msg}`, `Stopped after ${offset}: ${msg}`)
              : d.t(`导入失败：${msg}`, `Import failed: ${msg}`),
          );
          failed = true;
          break;
        }
        applyImportedWorks(
          data.works.map((w) => (forceType ? { ...w, type: forceType } : w)),
          true,
        );
        batches++;
        total = data.listTotal ?? total;
        offset = data.nextOffset ?? offset + data.works.length;
        fetched += data.works.length;
        setImportProgress({ done: offset, total, label });
        if (!data.hasMore || data.works.length === 0 || offset >= (total ?? Infinity)) break;
        if (batches > 20) break; // 安全阀
      }
      if (!failed)
        d.setNotice(
          fetched > 0
            ? d.t(
                `导入完成：抓取 ${fetched} 件作品${total && total > fetched ? `（清单全量 ${total} 件，可在右上角设置中提高单次导入上限）` : ""}。`,
                `Imported ${fetched} works${total && total > fetched ? ` (list has ${total} total — raise the per-import cap in settings)` : ""}.`,
              )
            : d.t("没有可导入的作品。", "No works to import."),
        );
    } catch {
      d.setNotice(
        d.t(
          "导入失败，可能限流，请稍后重试。",
          "Import failed (may be rate limited). Please retry.",
        ),
      );
    } finally {
      setImportProgress(null);
      setBusy(false);
      importingRef.current = false;
    }
  }

  function importDoulist(rawUrl: string) {
    const target = rawUrl.trim();
    if (!target) return;
    return runBatchedImport(
      `/api/import/douban-list?url=${encodeURIComponent(target)}`,
      "豆瓣清单",
    );
  }

  function importNeteasePlaylist(rawUrl: string) {
    const target = rawUrl.trim();
    if (!target) return;
    return runBatchedImport(
      `/api/import/netease?url=${encodeURIComponent(target)}`,
      "网易云歌单",
      "music",
    );
  }

  async function saveCollectionCloudFn(collectionToSave: MediaCollection) {
    const token = depsRef.current.accountToken;
    if (!token) return;
    try {
      // 云端清单也按同一口径去重后再上传：历史清单里可能已经存了重复曲目
      // （本轮事故的来源），顺手把库里那份也洗干净。
      const items = dedupeByTitle(collectionToSave.works);
      const response = await fetch("/api/account/collections", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({
          kind: collectionToSave.kind,
          title: collectionToSave.title,
          description: collectionToSave.description,
          items,
        }),
      });
      if (response.ok) void loadCloudCollectionsFn();
    } catch {
      /* */
    }
  }

  async function loadCloudCollectionsFn() {
    const token = depsRef.current.accountToken;
    if (!token) {
      setCloudCollections([]);
      return;
    }
    try {
      const response = await fetch("/api/account/collections", {
        headers: { authorization: `Bearer ${token}` },
      });
      const data = response.ok
        ? ((await response.json()) as {
            collections?: Array<{
              id: number;
              kind: MediaKind;
              title: string;
              description: string;
              items: MediaCollection["works"];
            }>;
          })
        : null;
      // 云端清单也要过一遍去重：历史清单里可能已经存了重复曲目（本轮事故的来源），
      // 载入时合并，避免用户点进来又保存一次同样的坏数据。
      setCloudCollections(
        (data?.collections ?? []).map((item) => {
          const works = dedupeByTitle(item.items ?? []);
          return {
            remoteId: item.id,
            id: `cloud-${item.id}`,
            kind: item.kind,
            source: "custom",
            title: item.title,
            description: item.description,
            topN: Math.min(10, works.length),
            works,
          };
        }),
      );
    } catch {
      setCloudCollections([]);
    }
  }

  async function deleteCloudCollection(item: MediaCollection & { remoteId: number }) {
    const d = depsRef.current;
    if (!d.accountToken) return;
    try {
      const response = await fetch(`/api/account/collections/${item.remoteId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${d.accountToken}` },
      });
      if (!response.ok) throw new Error();
      setCloudCollections((current) => current.filter((entry) => entry.remoteId !== item.remoteId));
      d.setNotice(d.t("云端清单已移除。", "Cloud list removed."));
    } catch {
      d.setNotice(
        d.t("无法移除云端清单，请稍后重试。", "Could not remove the cloud list. Please retry."),
      );
    }
  }

  function changeCols(n: number) {
    setColCount(n);
    try {
      localStorage.setItem("art-rank:cols", String(n));
    } catch {}
  }

  async function loadDouban() {
    const d = depsRef.current;
    setBusy(true);
    d.setNotice("");
    try {
      const isBook = kind === "book";
      const isMusic = kind === "music";
      const endpoint = isBook
        ? `/api/douban/books/top250?limit=${doubanLimit}`
        : isMusic
          ? `/api/douban/music/top250?limit=${doubanLimit}`
          : `/api/douban/top250?limit=${doubanLimit}`;
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(60000) });
      const data = (await response.json()) as {
        works?: Array<{ id: string; title: string; year?: number; poster_url?: string }>;
      };
      if (!response.ok || !data.works || data.works.length < 2) throw new Error();
      const title = isBook
        ? `豆瓣读书 Top ${doubanLimit}`
        : isMusic
          ? `豆瓣音乐 Top ${doubanLimit}`
          : `豆瓣 Top ${doubanLimit}`;
      openCollectionFn({
        id: `douban-${isBook ? "book-" : isMusic ? "music-" : ""}top${doubanLimit}`,
        kind,
        source: "douban",
        title,
        description: "",
        topN: 10,
        works: data.works.map((work) => ({
          ...work,
          posterUrls: work.poster_url ? [work.poster_url] : [],
        })),
      });
    } catch {
      d.setNotice(
        d.t(
          "豆瓣暂时无法访问，可以重试或选择内置榜单。",
          "Douban is unavailable. Retry or choose a built-in collection.",
        ),
      );
    } finally {
      setBusy(false);
    }
  }

  function startRanking() {
    const d = depsRef.current;
    if (!collection || selected.length < 2) return;
    const works = collection.works.filter((work) => selected.includes(work.id));
    const next = createRankingState(
      works.map((work) => work.id),
      { topN, seed: seed.trim() || crypto.randomUUID() },
    );
    rankingSnapshots.current = [];
    setCollection({ ...collection, works });
    setRanking(next);
    d.navigateTo("sorting");
    d.setNotice("");
    track("sorting_started", { mode: kind, item_count: works.length, top_k: next.topN });
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
      if (rankingSnapshots.current.length >= 500) rankingSnapshots.current.shift();
      rankingSnapshots.current.push(serializeRankingState(ranking));
      if (action === "skip-left") next = skipWork(ranking, comparison!.leftId);
      else if (action === "skip-right") next = skipWork(ranking, comparison!.rightId);
      else if (action === "defer-left") next = deferWork(ranking, comparison!.leftId);
      else if (action === "defer-right") next = deferWork(ranking, comparison!.rightId);
      else next = chooseSide(ranking, action);
    }
    setRanking(next);
    if (next.completed) {
      // 排序结果同样必须走唯一的写入端入口：这里以前直接把 `{...worksById.get(id)!}`
      // 塞进画像，既不做 identity 去重、也不做白名单投影——重复曲目会让整份画像
      // 在下次读取时被判为损坏，posterUrls 也会绕过清洗写进 localStorage。
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
      d.persist(mergeRanking(d.getProfile(), result));
      d.setActiveKind(result.kind);
      setDraft(null);
      try {
        localStorage.removeItem(DRAFT_KEY);
      } catch {
        /* */
      }
      const merged = getRankingResult(next).length - items.length;
      if (merged > 0)
        d.setNotice(
          d.t(
            `排序完成，但清单里有 ${merged} 件作品同名同作者，已自动合并。`,
            `Ranking saved — ${merged} duplicate(s) were merged.`,
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

  // Save draft on ranking change — only while an uncompleted ranking is on screen.
  // Dependency discipline: this effect setDraft()s itself, so its dep array must only
  // contain values that actually change with ranking progress; never make it deps-less.
  useEffect(() => {
    const d = depsRef.current;
    if (view !== "sorting" || !ranking || !collection || ranking.completed) return;
    const next = { collection, ranking: serializeRankingState(ranking), profileName };
    setDraft(next);
    try {
      localStorage.setItem(DRAFT_KEY, JSON.stringify(next));
    } catch {
      d.setNotice(d.t("进度无法写入浏览器存储。", "Progress could not be saved in this browser."));
    }
  }, [ranking, collection, view, profileName]);

  // Load cloud collections on token change (login, logout)
  useEffect(() => {
    void loadCloudCollectionsFn();
  }, [accountToken]);

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
    customText,
    setCustomText,
    customItem,
    setCustomItem,
    customWorks,
    setCustomWorks,
    customDeselected,
    setCustomDeselected,
    importProgress,
    importCap,
    setImportCap,
    cloudCollections,
    doubanLimit,
    setDoubanLimit,
    search,
    setSearch,
    colCount,
    busy,
    setBusy,
    comparison,
    progress,
    worksById,
    collections,
    chooseKind: chooseKindFn,
    searchWorks,
    addCustomWork,
    removeCustomWork,
    loadCustomWorks: loadCustomWorksFn,
    saveCustomWorks: saveCustomWorksFn,
    clearCustomWorks: clearCustomWorksFn,
    openCollection: openCollectionFn,
    applyImportedWorks,
    importDoulist,
    importNeteasePlaylist,
    saveCollectionCloud: saveCollectionCloudFn,
    loadCloudCollections: loadCloudCollectionsFn,
    deleteCloudCollection,
    changeCols,
    loadDouban,
    startRanking,
    act,
    resume,
    saveWithoutSorting: saveWithoutSortingFn,
  };
}
