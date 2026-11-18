import { useRef, useState } from "react";
import {
  mediaLabels,
  type Artwork,
  type MediaCollection,
  type MediaKind,
} from "../data/mediaKinds";
import {
  dedupeByTitle,
  mergeRanking,
  toRankedItems,
  workIdentity,
  type ArtisticProfile,
  type RankingExport,
} from "./profile";
import { COLS_KEY, IMPORT_CAP_KEY } from "./storageKeys";

export interface CollectionImporterDeps {
  accountToken: string;
  profileName: string;
  getProfile: () => ArtisticProfile | null;
  persist: (p: ArtisticProfile) => void;
  setActiveKind: (k: string) => void;
  setNotice: (n: string) => void;
  navigateTo: (v: string) => void;
  t: (zh: string, en: string) => string;
  label: (kind: MediaKind) => string;
  kind: MediaKind;
  openCollection: (next: MediaCollection) => void;
  saveCollectionCloud: (c: MediaCollection) => Promise<void>;
  resolveRankingTabKey: (
    profile: ArtisticProfile | null,
    kind: MediaKind,
    collectionTitle?: string,
  ) => string;
}

export function useCollectionImporter(deps: CollectionImporterDeps) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const { kind } = deps;

  const [customText, setCustomText] = useState("");
  const [customItem, setCustomItem] = useState("");
  const [customWorks, setCustomWorks] = useState<Artwork[]>([]);
  const [customDeselected, setCustomDeselected] = useState<string[]>([]);
  const [importProgress, setImportProgress] = useState<{
    done: number;
    total: number | null;
    label: string;
  } | null>(null);
  const [doubanLimit, setDoubanLimit] = useState(50);
  const [colCount, setColCount] = useState<number>(() => {
    try {
      return Number(localStorage.getItem(COLS_KEY)) || 3;
    } catch {
      return 3;
    }
  });
  const [importCap, setImportCapState] = useState<number>(() => {
    const v = Number(localStorage.getItem(IMPORT_CAP_KEY));
    return v >= 50 && v <= 1000 ? v : 300;
  });
  function setImportCap(v: number) {
    setImportCapState(v);
    try {
      localStorage.setItem(IMPORT_CAP_KEY, String(v));
    } catch {
      /* */
    }
  }
  const [busy, setBusy] = useState(false);
  const importingRef = useRef(false);

  async function searchWorks(query: string): Promise<Artwork[]> {
    const trimmed = query.trim();
    if (!trimmed) return [];
    const curKind = depsRef.current.kind;
    try {
      if (curKind === "other") {
        const response = await fetch(`/api/other/list?key=${encodeURIComponent(trimmed)}`, {
          signal: AbortSignal.timeout(15000),
        });
        if (!response.ok) return [];
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
      const apiType = curKind === "film" ? "movie" : curKind;
      const response = await fetch(
        `/api/${apiType}/list?key=${encodeURIComponent(trimmed)}&page=1`,
        { signal: AbortSignal.timeout(15000) },
      );
      if (!response.ok) return [];
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

  function loadCustomWorks(works?: Artwork[]) {
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
    d.openCollection(next);
    void d.saveCollectionCloud(next);
  }

  /** 仅保存不排序：把当前清单（去掉取消勾选的）按现有顺序存为画像榜单，不进比较流程 */
  function saveCustomWorks() {
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
    if (!items.length) {
      d.setNotice(
        d.t(
          "去重后没有可保存的作品（同名同作者全部被合并），请检查清单。",
          "Nothing left to save: every work was merged as a duplicate.",
        ),
      );
      return;
    }
    const canSyncCloud = items.length >= 2;
    const ranking: RankingExport = {
      version: 1,
      profileId: d.getProfile()?.profileId ?? crypto.randomUUID(),
      profileName: d.profileName.trim() || d.t("我的艺术人格", "My artistic profile"),
      kind,
      collectionTitle: `我的${mediaLabels[kind].label}清单`,
      createdAt: new Date().toISOString(),
      items,
    };
    const mergedProfile = mergeRanking(d.getProfile(), ranking);
    d.persist(mergedProfile);
    d.setActiveKind(d.resolveRankingTabKey(mergedProfile, kind, ranking.collectionTitle));
    if (canSyncCloud) {
      void d.saveCollectionCloud({
        id: `custom-${kind}-${crypto.randomUUID()}`,
        kind,
        source: "custom",
        title: ranking.collectionTitle,
        description: "",
        topN: Math.min(10, kept.length),
        works: kept,
      });
    }
    const mergedNote =
      merged > 0
        ? d.t(
            `；另有 ${merged} 件与前面的作品同名同作者，已自动合并`,
            `; ${merged} duplicate(s) were merged`,
          )
        : "";
    const cloudNote = canSyncCloud
      ? d.t("。", ".")
      : d.t(
          "；云端清单至少需要 2 件作品，本次只保存在本地。",
          "; cloud lists need at least 2 works, so this one was saved locally only.",
        );
    d.setNotice(
      merged > 0 || !canSyncCloud
        ? d.t(
            `已保存 ${items.length} 件作品为榜单（按导入顺序，未排序）${mergedNote}${cloudNote}`,
            `Saved ${items.length} work(s) as a list (import order, unsorted)${mergedNote}${cloudNote}`,
          )
        : d.t(
            `已保存 ${items.length} 件作品为榜单（按导入顺序，未排序）。`,
            `Saved ${items.length} works as a list (import order, unsorted).`,
          ),
    );
    d.navigateTo("profile");
  }

  function clearCustomWorks() {
    setCustomWorks([]);
    setCustomDeselected([]);
  }

  function applyImportedWorks(
    works: Array<Artwork & { type?: string; poster_url?: string }>,
    silent = false,
  ) {
    const d = depsRef.current;
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
        const data = (await response.json().catch(() => null)) as {
          works?: Array<Artwork & { type?: string; poster_url?: string }>;
          listTotal?: number | null;
          hasMore?: boolean;
          nextOffset?: number;
          msg?: string;
          error?: string;
        } | null;
        if (!response.ok || !data?.works) {
          const msg = data?.msg ?? data?.error ?? d.t("未知错误", "unknown error");
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

  function changeCols(n: number) {
    setColCount(n);
    try {
      localStorage.setItem(COLS_KEY, String(n));
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
      const data = (await response.json().catch(() => null)) as {
        works?: Array<{ id: string; title: string; year?: number; poster_url?: string }>;
      } | null;
      if (!response.ok || !data?.works || data.works.length < 2) throw new Error();
      const title = isBook
        ? `豆瓣读书 Top ${doubanLimit}`
        : isMusic
          ? `豆瓣音乐 Top ${doubanLimit}`
          : `豆瓣 Top ${doubanLimit}`;
      d.openCollection({
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

  return {
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
    doubanLimit,
    setDoubanLimit,
    colCount,
    busy,
    setBusy,
    searchWorks,
    addCustomWork,
    removeCustomWork,
    loadCustomWorks,
    saveCustomWorks,
    clearCustomWorks,
    applyImportedWorks,
    importDoulist,
    importNeteasePlaylist,
    changeCols,
    loadDouban,
  };
}
