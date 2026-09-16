import { useState, useEffect, useRef, useMemo } from "react";
import { createRankingState, chooseSide, deferWork, deserializeRankingState, getCurrentComparison, getRankingProgress, getRankingResult, serializeRankingState, skipWork, undoLastAction, type RankingState } from "./ranking";
import { getCollectionsByKind, mediaLabels, type Artwork, type MediaCollection, type MediaKind } from "../data/media";
import { mergeRanking, type ArtisticProfile, type RankingExport } from "./profile";
import { track, type Locale } from "./utils";

const DRAFT_KEY = "art-rank:draft:v2";
const kinds = Object.keys(mediaLabels) as MediaKind[];

export type Draft = { collection: MediaCollection; ranking: string; profileName: string };

function stored(key: string) { try { return localStorage.getItem(key); } catch { return null; } }

export function loadDraft(): Draft | null {
  try {
    const data = JSON.parse(stored(DRAFT_KEY) ?? "") as Draft;
    const state = deserializeRankingState(data.ranking);
    if (state.completed || !kinds.includes(data.collection.kind) || !Array.isArray(data.collection.works) || data.collection.works.length > 300 ||
      !state.sourceIds.every((id) => data.collection.works.some((work) => work.id === id && typeof work.title === "string"))) return null;
    getCurrentComparison(state);
    return data;
  } catch { return null; }
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
  const [cloudCollections, setCloudCollections] = useState<Array<MediaCollection & { remoteId: number }>>([]);
  const [doubanLimit, setDoubanLimit] = useState(50);
  const [search, setSearch] = useState("");
  const [colCount, setColCount] = useState<number>(() => { try { return Number(localStorage.getItem("art-rank:cols")) || 3; } catch { return 3; } });
  const [busy, setBusy] = useState(false);
  const rankingSnapshots = useRef<string[]>([]);

  const comparison = ranking ? getCurrentComparison(ranking) : null;
  const progress = ranking ? getRankingProgress(ranking) : null;
  const worksById = useMemo(() => new Map(collection?.works.map((work) => [work.id, work]) ?? []), [collection]);
  const collections = getCollectionsByKind(kind).filter((item) => [item.title, item.description, ...item.works.map((work) => work.title)].join(" ").toLowerCase().includes(search.toLowerCase()));

  function chooseKindFn(next: MediaKind) {
    const d = depsRef.current;
    setKind(next); setSource("builtin"); setSearch(""); setCustomText(""); setCustomWorks([]);
    d.navigateTo("source");
  }

  async function searchWorks(query: string): Promise<Artwork[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    try {
      if (kind === "other") {
        const response = await fetch(`/api/other/list?key=${encodeURIComponent(trimmed)}`, { signal: AbortSignal.timeout(15000) });
        const data = await response.json() as { data?: Array<{ title?: string; subtitle?: string; year?: number; poster_url?: string }> };
        return (data.data ?? []).slice(0, 6).map((item) => ({
          id: `search-${Math.random().toString(36).slice(2, 10)}`, title: item.title ?? "", subtitle: item.subtitle, year: item.year,
          posterUrls: item.poster_url ? [item.poster_url] : undefined,
        })).filter((work) => work.title);
      }
      const apiType = kind === "film" ? "movie" : kind;
      const response = await fetch(`/api/${apiType}/list?key=${encodeURIComponent(trimmed)}&page=1`, { signal: AbortSignal.timeout(15000) });
      const data = await response.json() as { data?: Array<{ title?: string; year?: string; rating?: string; author?: string; artist?: string; cover?: string; actors?: string[] }> };
      return (data.data ?? []).slice(0, 6).map((item) => ({
        id: `search-${Math.random().toString(36).slice(2, 10)}`, title: item.title ?? "",
        creator: item.author || item.artist || (Array.isArray(item.actors) ? item.actors.slice(0, 2).join("/") : undefined),
        year: item.year ? Number(item.year) || undefined : undefined, posterUrls: item.cover ? [item.cover] : undefined,
      })).filter((work) => work.title);
    } catch { return []; }
  }

  function addCustomWork(work: Artwork) {
    setCustomWorks((cur) => cur.some((w) => w.title === work.title && w.year === work.year) ? cur : [...cur, work]);
  }
  function removeCustomWork(id: string) { setCustomWorks((cur) => cur.filter((w) => w.id !== id)); }

  function openCollectionFn(next: MediaCollection) {
    const d = depsRef.current;
    setKind(next.kind); setCollection(next); setSelected(next.works.map((work) => work.id)); setTopN(next.topN); setRanking(null);
    d.navigateTo("setup");
  }

  function loadCustomWorksFn() {
    const d = depsRef.current;
    if (customWorks.length < 2) { d.setNotice(d.t("至少添加 2 件作品再开始。", "Add at least 2 works first.")); return; }
    const next: MediaCollection = { id: `custom-${kind}-${crypto.randomUUID()}`, kind, source: "custom", title: `我的${mediaLabels[kind].label}清单`, description: "", topN: Math.min(10, customWorks.length), works: customWorks };
    openCollectionFn(next);
    void saveCollectionCloudFn(next);
  }

  function applyImportedWorks(works: Array<Artwork & { type?: string; poster_url?: string }>) {
    const d = depsRef.current;
    const normalized = works.map((w) => ({ id: w.id || `imp-${Math.random().toString(36).slice(2, 10)}`, title: w.title, creator: w.creator, year: w.year, posterUrls: w.posterUrls ?? (w.poster_url ? [w.poster_url] : undefined) })) as Array<Artwork & { type?: string }>;
    const matching = normalized.filter((w) => !w.type || w.type === kind);
    const others = normalized.length - matching.length;
    setCustomWorks((cur) => { const seen = new Set(cur.map((w) => w.title)); return [...cur, ...matching.filter((w) => !seen.has(w.title))]; });
    d.setNotice(others > 0
      ? d.t(`已加入 ${matching.length} 件${d.label(kind)}作品；另有 ${others} 件其他媒介，切换媒介后可重新导入。`, `Added ${matching.length} ${d.label(kind)} works; ${others} other media — switch and re-import.`)
      : d.t(`已加入 ${matching.length} 件作品。`, `Added ${matching.length} works.`));
  }

  async function importDoulist(rawUrl: string) {
    const d = depsRef.current;
    if (!d.accountToken) { d.setNotice(d.t("请先登录后再导入。", "Sign in to import.")); return; }
    const target = rawUrl.trim(); if (!target) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/import/douban-list?url=${encodeURIComponent(target)}`, { headers: { authorization: `Bearer ${d.accountToken}` }, signal: AbortSignal.timeout(120000) });
      const data = await response.json() as { works?: Array<Artwork & { type?: string; poster_url?: string }>; msg?: string; error?: string };
      if (!response.ok || !data.works) { d.setNotice(d.t("豆瓣导入失败：" + (data.msg ?? data.error ?? "未知错误"), "Douban import failed: " + (data.msg ?? data.error ?? ""))); return; }
      applyImportedWorks(data.works);
      d.setNotice(d.t(`已导入 ${data.works.length} 件作品。`, `Imported ${data.works.length} works.`));
    } catch { d.setNotice(d.t("豆瓣导入失败，可能限流，请稍后重试。", "Douban import failed (may be rate limited). Please retry.")); }
    finally { setBusy(false); }
  }

  async function importNeteasePlaylist(rawUrl: string) {
    const d = depsRef.current;
    if (!d.accountToken) { d.setNotice(d.t("请先登录后再导入。", "Sign in to import.")); return; }
    const target = rawUrl.trim(); if (!target) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/import/netease?url=${encodeURIComponent(target)}`, { headers: { authorization: `Bearer ${d.accountToken}` }, signal: AbortSignal.timeout(60000) });
      const data = await response.json() as { works?: Array<Artwork & { poster_url?: string }>; msg?: string; error?: string };
      if (!response.ok || !data.works) { d.setNotice(d.t("歌单导入失败：" + (data.msg ?? data.error ?? "未知错误"), "Playlist import failed: " + (data.msg ?? data.error ?? ""))); return; }
      applyImportedWorks(data.works.map((w) => ({ ...w, type: "music" })));
    } catch { d.setNotice(d.t("歌单导入失败，请稍后重试。", "Playlist import failed. Please retry.")); }
    finally { setBusy(false); }
  }

  async function saveCollectionCloudFn(collectionToSave: MediaCollection) {
    const token = depsRef.current.accountToken;
    if (!token) return;
    try {
      const response = await fetch("/api/account/collections", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}` }, body: JSON.stringify({ kind: collectionToSave.kind, title: collectionToSave.title, description: collectionToSave.description, items: collectionToSave.works }) });
      if (response.ok) void loadCloudCollectionsFn();
    } catch { /* */ }
  }

  async function loadCloudCollectionsFn() {
    const token = depsRef.current.accountToken;
    if (!token) { setCloudCollections([]); return; }
    try {
      const response = await fetch("/api/account/collections", { headers: { authorization: `Bearer ${token}` } });
      const data = response.ok ? await response.json() as { collections?: Array<{ id: number; kind: MediaKind; title: string; description: string; items: MediaCollection["works"] }> } : null;
      setCloudCollections((data?.collections ?? []).map((item) => ({ remoteId: item.id, id: `cloud-${item.id}`, kind: item.kind, source: "custom", title: item.title, description: item.description, topN: Math.min(10, item.items.length), works: item.items })));
    } catch { setCloudCollections([]); }
  }

  async function deleteCloudCollection(item: MediaCollection & { remoteId: number }) {
    const d = depsRef.current;
    if (!d.accountToken) return;
    try {
      const response = await fetch(`/api/account/collections/${item.remoteId}`, { method: "DELETE", headers: { authorization: `Bearer ${d.accountToken}` } });
      if (!response.ok) throw new Error();
      setCloudCollections((current) => current.filter((entry) => entry.remoteId !== item.remoteId));
      d.setNotice(d.t("云端清单已移除。", "Cloud list removed."));
    } catch { d.setNotice(d.t("无法移除云端清单，请稍后重试。", "Could not remove the cloud list. Please retry.")); }
  }

  function changeCols(n: number) { setColCount(n); try { localStorage.setItem("art-rank:cols", String(n)); } catch {} }

  async function loadDouban() {
    const d = depsRef.current;
    setBusy(true); d.setNotice("");
    try {
      const isBook = kind === "book"; const isMusic = kind === "music";
      const endpoint = isBook ? `/api/douban/books/top250?limit=${doubanLimit}` : isMusic ? `/api/douban/music/top250?limit=${doubanLimit}` : `/api/douban/top250?limit=${doubanLimit}`;
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(60000) });
      const data = await response.json() as { works?: Array<{ id: string; title: string; year?: number; poster_url?: string }> };
      if (!response.ok || !data.works || data.works.length < 2) throw new Error();
      const title = isBook ? `豆瓣读书 Top ${doubanLimit}` : isMusic ? `豆瓣音乐 Top ${doubanLimit}` : `豆瓣 Top ${doubanLimit}`;
      openCollectionFn({ id: `douban-${isBook ? 'book-' : isMusic ? 'music-' : ''}top${doubanLimit}`, kind, source: "douban", title, description: "", topN: 10, works: data.works.map((work) => ({ ...work, posterUrls: work.poster_url ? [work.poster_url] : [] })) });
    } catch { d.setNotice(d.t("豆瓣暂时无法访问，可以重试或选择内置榜单。", "Douban is unavailable. Retry or choose a built-in collection.")); }
    finally { setBusy(false); }
  }

  function startRanking() {
    const d = depsRef.current;
    if (!collection || selected.length < 2) return;
    const works = collection.works.filter((work) => selected.includes(work.id));
    const next = createRankingState(works.map((work) => work.id), { topN, seed: seed.trim() || crypto.randomUUID() });
    rankingSnapshots.current = []; setCollection({ ...collection, works }); setRanking(next); d.navigateTo("sorting"); d.setNotice("");
    track("sorting_started", { mode: kind, item_count: works.length, top_k: next.topN });
  }

  function act(action: "left" | "right" | "undo" | "skip-left" | "skip-right" | "defer-left" | "defer-right") {
    const d = depsRef.current;
    if (!ranking || !collection || (ranking.completed && action !== "undo")) return;
    let next: RankingState;
    if (action === "undo") {
      if (rankingSnapshots.current.length > 0) { const prev = rankingSnapshots.current.pop()!; next = deserializeRankingState(prev); }
      else { next = undoLastAction(ranking); }
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
      const result: RankingExport = {
        version: 1, profileId: crypto.randomUUID(), profileName: d.profileName.trim() || d.t("我的艺术人格", "My artistic profile"), kind: collection.kind,
        collectionTitle: collection.title, createdAt: new Date().toISOString(),
        items: getRankingResult(next).map((id, index) => ({ ...worksById.get(id)!, rank: index + 1 })),
      };
      d.persist(mergeRanking(d.getProfile(), result)); d.setActiveKind(result.kind); setDraft(null);
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* */ }
      d.navigateTo(d.getPeer() && collection.id.startsWith("peer-") ? "compare" : "profile");
      track("ranking_completed", { mode: kind, item_count: next.sourceIds.length, top_k: next.topN, comparison_count: next.comparisonCount });
    }
  }

  function resume() {
    const d = depsRef.current;
    if (!draft) return;
    try { rankingSnapshots.current = []; setCollection(draft.collection); setKind(draft.collection.kind); setRanking(deserializeRankingState(draft.ranking)); d.setProfileName(draft.profileName); d.navigateTo("sorting"); }
    catch { d.setNotice(d.t("草稿无法读取。", "The draft could not be restored.")); }
  }

  // Save draft on ranking change — only while an uncompleted ranking is on screen.
  // Dependency discipline: this effect setDraft()s itself, so its dep array must only
  // contain values that actually change with ranking progress; never make it deps-less.
  useEffect(() => {
    const d = depsRef.current;
    if (view !== "sorting" || !ranking || !collection || ranking.completed) return;
    const next = { collection, ranking: serializeRankingState(ranking), profileName };
    setDraft(next);
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(next)); } catch { d.setNotice(d.t("进度无法写入浏览器存储。", "Progress could not be saved in this browser.")); }
  }, [ranking, collection, view, profileName]);

  // Load cloud collections on token change (login, logout)
  useEffect(() => { void loadCloudCollectionsFn(); }, [accountToken]);

  return {
    kind, setKind, source, setSource, collection, setCollection,
    selected, setSelected, ranking, setRanking, draft, setDraft,
    topN, setTopN, seed, setSeed, customText, setCustomText,
    customItem, setCustomItem, customWorks, setCustomWorks,
    cloudCollections, doubanLimit, setDoubanLimit, search, setSearch,
    colCount, busy, setBusy, comparison, progress, worksById, collections,
    chooseKind: chooseKindFn, searchWorks, addCustomWork, removeCustomWork,
    loadCustomWorks: loadCustomWorksFn, openCollection: openCollectionFn,
    applyImportedWorks, importDoulist, importNeteasePlaylist,
    saveCollectionCloud: saveCollectionCloudFn, loadCloudCollections: loadCloudCollectionsFn,
    deleteCloudCollection, changeCols, loadDouban, startRanking, act, resume,
  };
}
