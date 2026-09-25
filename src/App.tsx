import { useEffect, useState, type ReactNode } from "react";
import {
  ArrowLeft,
  CloudDownload,
  CloudUpload,
  Github,
  Languages,
  UserRound,
  X,
} from "lucide-react";

import { mediaLabels, type MediaKind } from "./data/media";
import {
  compareDimensions,
  compareProfiles,
  compareRankings,
  LIBRARY_KEY,
  MAX_PROFILE_BYTES,
  RECOVERY_KEY,
  mergeDimensionRankings,
  mergeProfiles,
  mergeRanking,
  parseProfile,
  profileText,
  readProfile,
  renameRanking,
  deleteRanking,
  reorderRanking,
  toRankedItems,
  type ArtisticProfile,
  type RankingExport,
  type RankedArtwork,
} from "./lib/profile";
import { importCollection } from "./lib/collections";
import type { ExportLayout } from "./lib/exportPng";
import { FocusTrap } from "./components/FocusTrap";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { AiConfigDialog } from "./components/AiConfigDialog";
import { readNotes, writeNotes, setNote } from "./lib/notes";
import { buildProfileSyncBody } from "./lib/profileSync";
import { epochQuery } from "./lib/cacheBust";
import { Poster } from "./components/Poster";
import { RankingDetail } from "./components/RankingDetail";
import { ArtworkDetail, type ArtworkDetailInfo } from "./components/ArtworkDetail";
import { IconButton } from "./views/IconButton";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import { SettingsMenu } from "./components/SettingsMenu";
import { applyTheme, readTheme } from "./lib/theme";
import { HomeView } from "./views/HomeView";
import { applyLayout, readLayout } from "./lib/layout";
import { SourceView } from "./views/SourceView";
import { SetupView } from "./views/SetupView";
import { SortingView } from "./views/SortingView";
import { ProfileView } from "./views/ProfileView";
import { CompareView } from "./views/CompareView";
import { ShareView } from "./views/ShareView";
import { PlazaView } from "./views/PlazaView";
import { PlazaPostView } from "./views/PlazaPostView";

import { stored, track, decode, saveFile, type Locale } from "./lib/utils";
import { useRouter, type View } from "./lib/useRouter";
import { useAuth } from "./lib/useAuth";
import { useSorting } from "./lib/useSorting";

const DRAFT_KEY = "art-rank:draft:v2";
const PEER_KEY = "art-rank:peer:v2";
const kinds = Object.keys(mediaLabels) as MediaKind[];
const englishKinds = { film: "Films", book: "Books", music: "Music", other: "Other" };

function loadPeer() {
  try {
    return parseProfile(JSON.parse(stored(PEER_KEY) ?? ""));
  } catch {
    return null;
  }
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() =>
    new URLSearchParams(location.search).get("lang") === "en" ? "en" : "zh",
  );
  const t = (zh: string, en: string) => (locale === "zh" ? zh : en);
  const label = (kind: MediaKind) =>
    locale === "zh" ? mediaLabels[kind].label : englishKinds[kind];
  const { view, setView, navigateTo, plazaPostId } = useRouter();
  const [profile, setProfile] = useState<ArtisticProfile | null>(() => {
    try {
      return readProfile(localStorage);
    } catch {
      return null;
    }
  });
  const [peer, setPeer] = useState<ArtisticProfile | null>(loadPeer);
  const [profileName, setProfileName] = useState(() => {
    try {
      return readProfile(localStorage)?.profileName ?? "我的艺术人格";
    } catch {
      return "我的艺术人格";
    }
  });
  const [activeKind, setActiveKind] = useState<string>("film");
  const [compareActiveKind, setCompareActiveKind] = useState<MediaKind>("film");
  const [compareMode, setCompareMode] = useState<"auto" | "manual">("auto");
  const [manualOwnSelections, setManualOwnSelections] = useState<Set<number>>(new Set());
  const [manualPeerSelections, setManualPeerSelections] = useState<Set<number>>(new Set());
  const [compareRankDetail, setCompareRankDetail] = useState<{
    side: "own" | "peer";
    collectionTitle: string;
    ranking: RankingExport | null;
    highlightId?: string;
  } | null>(null);
  const [compareSortBy, setCompareSortBy] = useState<"own" | "peer">("own");
  const [peerRankPickOpen, setPeerRankPickOpen] = useState(false);
  const [aiConfigOpen, setAiConfigOpen] = useState(false);
  // toast 队列：后到的通知排在后面，避免互相顶掉（最多保留 5 条）
  const [noticeQueue, setNoticeQueue] = useState<string[]>([]);
  const notice = noticeQueue[0] ?? "";
  const setNotice = (n: string) => {
    if (!n) {
      setNoticeQueue([]);
      return;
    }
    setNoticeQueue((q) => [...q, n].slice(-5));
  };
  const [format, setFormat] = useState<"json" | "txt" | "md" | "csv" | "png">("json");
  const [exportLayout, setExportLayout] = useState<ExportLayout>("editorial");
  const [shareUrl, setShareUrl] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [shareModal, setShareModal] = useState<{ ranking?: RankingExport } | null>(null);
  const [shareExpires, setShareExpires] = useState("");
  const [editingRankIdx, setEditingRankIdx] = useState<number | null>(null);
  const [editingRankTitle, setEditingRankTitle] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>(readNotes);
  const [peerNotes, setPeerNotes] = useState<Record<string, string>>({});
  const [noteModal, setNoteModal] = useState<{
    key: string;
    title: string;
    kind: MediaKind;
    posterUrls?: readonly string[];
  } | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [noteViewModal, setNoteViewModal] = useState<{
    title: string;
    text: string;
    posterUrls?: readonly string[];
  } | null>(null);
  const [ringsLayout, setRingsLayout] = useState<"row" | "col">(() => {
    try {
      return (localStorage.getItem("art-rank:rings-layout") as "row" | "col") || "row";
    } catch {
      return "row";
    }
  });
  const [detailWork, setDetailWork] = useState<ArtworkDetailInfo | null>(null);
  const [peerUrl, setPeerUrl] = useState("");
  const [peerUrlBusy, setPeerUrlBusy] = useState(false);
  const [sharePeer, setSharePeer] = useState<ArtisticProfile | null>(null);
  // P5c：布局模式兜底（双点位之一——main.tsx 预挂载为主，此 effect 兜底）
  useEffect(() => {
    applyLayout(readLayout());
  }, []);

  const [showGuide, setShowGuide] = useState(() => {
    try {
      return !localStorage.getItem("art-rank:guide-dismissed");
    } catch {
      return true;
    }
  });
  const [showTech, setShowTech] = useState(false);
  const [reorderMode, setReorderMode] = useState<number | null>(null);
  const [reorderItems, setReorderItems] = useState<RankedArtwork[]>([]);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const auth = useAuth({
    getProfile: () => profile,
    profile,
    getNotes: () => notes,
    namedProfile: () => {
      if (!profile) return null;
      const name = profileName.trim() || t("我的艺术人格", "My artistic profile");
      return {
        ...profile,
        profileName: name,
        rankings: profile.rankings.map((entry) => ({ ...entry, profileName: name })),
      };
    },
    // 复用下面唯一的 persist（含白名单清洗）：这里原本另写了一份 `JSON.stringify(next)`
    // 直存的实现，绕过了可落库形状，也让排序完成路径把 posterUrls 写进了 localStorage。
    persist,
    setNotes,
    setProfile,
    setPeer,
    setNotice,
    t,
  });
  const {
    accountOpen,
    setAccountOpen,
    accountEmail,
    setAccountEmail,
    accountNickname,
    setAccountNickname,
    accountToken,
    setAccountToken,
    authMode,
    setAuthMode,
    authEmail,
    setAuthEmail,
    authPassword,
    setAuthPassword,
    authNickname,
    setAuthNickname,
    authError,
    setAuthError,
    needNickname,
    setNeedNickname,
    editingNickname,
    setEditingNickname,
    editNicknameValue,
    setEditNicknameValue,
    syncStatus,
    setSyncStatus,
    cloudConflict,
    setCloudConflict,
    accountAuth,
    sendAuthCode,
    authCode,
    setAuthCode,
    codeCooldown,
    accountSave,
    accountLoad,
    saveNickname,
    accountLogout,
  } = auth;

  const sorting = useSorting({
    accountToken,
    profileName,
    view,
    getProfile: () => profile,
    getPeer: () => peer,
    getNotes: () => notes,
    // 同上：不再另写一份未清洗的 persist。
    persist,
    setActiveKind,
    setProfileName,
    setNotice,
    navigateTo,
    setView: setView as (v: string) => void,
    t,
    label,
    locale,
  });
  const {
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
    busy: sortingBusy,
    setBusy,
    comparison,
    progress,
    worksById,
    collections,
    chooseKind,
    searchWorks,
    addCustomWork,
    removeCustomWork,
    loadCustomWorks,
    saveCustomWorks,
    clearCustomWorks,
    openCollection,
    applyImportedWorks,
    importDoulist,
    importNeteasePlaylist,
    saveCollectionCloud,
    loadCloudCollections,
    deleteCloudCollection,
    changeCols,
    loadDouban,
    startRanking,
    act,
    resume,
    saveWithoutSorting,
  } = sorting;
  const busy = sortingBusy;

  // Wire auth's setDraft to sorting's setDraft (breaks circular dependency).
  // In an effect, not render: setDraft is a stable state setter, so this binds once.
  useEffect(() => {
    auth.updateSetDraft(setDraft as (d: unknown) => void);
  }, [setDraft]);

  const activeRanking =
    profile?.rankings.find((entry, idx) => `${entry.kind}-${idx}` === activeKind) ??
    profile?.rankings[0];

  function openNoteModal(
    key: string,
    title: string,
    kind: MediaKind,
    posterUrls?: readonly string[],
  ) {
    setNoteModal({ key, title, kind, posterUrls });
    setNoteDraft(notes[key] ?? "");
  }
  function openNoteView(title: string, text: string, posterUrls?: readonly string[]) {
    setNoteViewModal({ title, text, posterUrls });
  }
  function saveNote() {
    if (!noteModal) return;
    const next = setNote(notes, noteModal.key, noteDraft);
    setNotes(next);
    writeNotes(next);
    setNoteModal(null);
  }
  function persist(next: ArtisticProfile) {
    // 复用唯一可落库形状（shared/storedItem.ts，经 profile.ts 的 toRankedItems）：
    // posterUrls 与任何未知字段都由白名单挡住，不再依赖这里手写 destructure。
    const cleaned: ArtisticProfile = {
      ...next,
      rankings: next.rankings.map((r) => ({ ...r, items: toRankedItems(r.items) })),
    };
    setProfile(cleaned);
    setProfileName(cleaned.profileName);
    setShareUrl("");
    setQrUrl("");
    try {
      localStorage.setItem(LIBRARY_KEY, JSON.stringify(cleaned));
      writeNotes(notes);
    } catch (e) {
      console.error("[persist] localStorage write failed:", e);
      setNotice(
        t(
          "浏览器无法保存，请及时导出画像。",
          "Browser storage is unavailable. Export your profile to keep it.",
        ),
      );
    }
  }
  function acceptPeer(next: ArtisticProfile) {
    setPeer(next);
    setActiveKind(next.rankings[0].kind);
    setCompareActiveKind(next.rankings[0].kind);
    navigateTo("compare");
    try {
      localStorage.setItem(PEER_KEY, JSON.stringify(next));
    } catch {
      /* Keep the in-memory copy. */
    }
  }
  useEffect(() => {
    track("visit", { lang: locale, app_version: "2.0.0" });
    const payload =
      new URLSearchParams(location.hash.slice(1)).get("profile") ??
      new URLSearchParams(location.search).get("payload");
    if (payload) {
      if (/^[0-9a-f]{8,12}$/i.test(payload)) {
        // Short code — fetch from server
        fetch(`/api/share/${payload}`)
          .then(async (r) => {
            if (!r.ok) throw new Error();
            const d = (await r.json()) as { profile: unknown; notes?: Record<string, string> };
            acceptPeer(parseProfile(d.profile));
            if (d.notes && typeof d.notes === "object") setPeerNotes(d.notes);
          })
          .catch(() =>
            setNotice(t("比较链接无效或已过期。", "Compare link is invalid or expired.")),
          );
      } else {
        // Base64-encoded profile
        decode(payload)
          .then(acceptPeer)
          .catch(() =>
            setNotice(
              t(
                "比较链接无效或过大，请导入 JSON 文件。",
                "Invalid or oversized link. Import the JSON file instead.",
              ),
            ),
          );
      }
    }
    // Handle OAuth callback — the worker hands us a one-time exchange code; the session
    // token itself never appears in the URL or browser history.
    const params = new URLSearchParams(location.search);
    const oauthCode = params.get("oauth_code");
    const oauthError = params.get("account");
    if (oauthCode) {
      history.replaceState(null, "", location.pathname);
      void fetch("/api/account/oauth/exchange", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ code: oauthCode }),
      })
        .then(async (response) => {
          if (!response.ok) throw new Error();
          const data = (await response.json()) as {
            token: string;
            email: string;
            nickname?: string;
          };
          setAccountToken(data.token);
          setAccountEmail(data.email);
          setAccountNickname(data.nickname ?? "");
          try {
            localStorage.setItem("art-rank:account-token", data.token);
          } catch {}
          const name = data.nickname ?? "";
          if (!name || name === data.email.split("@")[0]) {
            setNeedNickname(true);
            setAccountOpen(true);
          }
          setNotice(t("登录成功！", "Signed in!"));
          // Restore notes from cloud after OAuth login
          try {
            const r = await fetch("/api/account/profile", {
              headers: { authorization: `Bearer ${data.token}` },
            });
            if (!r.ok) return;
            const d = (await r.json()) as { notes?: Record<string, string> };
            if (d.notes && typeof d.notes === "object") {
              const merged = { ...readNotes(), ...d.notes };
              setNotes(merged);
              writeNotes(merged);
            }
          } catch {}
        })
        .catch(() => setNotice(t("登录失败，请重试。", "Sign-in failed. Please retry.")));
    } else if (oauthError === "error") {
      setNotice(
        t(
          "登录失败：" + (params.get("msg") ?? "未知错误"),
          "Sign in failed: " + (params.get("msg") ?? "Unknown error"),
        ),
      );
      history.replaceState(null, "", location.pathname);
    }

    // Handle /share/:code path — fetch shared profile
    if (location.pathname.startsWith("/share/")) {
      const code = location.pathname.split("/share/")[1]?.replace(/\/+$/, "");
      if (code) {
        if (/^[0-9a-f]{8,12}$/i.test(code)) {
          // Short code — fetch from server. Notes belong to the peer and must stay in
          // peerNotes; merging them into own notes would pollute the viewer's data.
          fetch(`/api/share/${code}`)
            .then(async (r) => {
              if (!r.ok) throw new Error();
              const d = (await r.json()) as {
                profile: unknown;
                notes?: Record<string, string>;
                expires_at?: string;
              };
              setSharePeer(parseProfile(d.profile));
              setShareExpires(d.expires_at ?? "");
              setPeerNotes(d.notes && typeof d.notes === "object" ? d.notes : {});
              setView("share");
            })
            .catch(() =>
              setNotice(t("分享链接无效或已过期。", "Share link is invalid or expired.")),
            );
        } else {
          // Base64 payload in path
          decode(code)
            .then((p) => {
              setSharePeer(p);
              setView("share");
            })
            .catch(() =>
              setNotice(t("分享链接无效或过大。", "Share link is invalid or too large.")),
            );
        }
      }
    }
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);
  useEffect(() => {
    applyTheme(readTheme());
  }, []);
  useEffect(() => {
    const onScroll = () => setShowScrollTop(window.scrollY > 400);
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    setEditingRankIdx(null);
    setEditingRankTitle("");
    setReorderMode(null);
    setReorderItems([]);
  }, [view]);
  useEffect(() => {
    if (!noticeQueue.length) return;
    const timer = setTimeout(() => setNoticeQueue((q) => q.slice(1)), 4000);
    return () => clearTimeout(timer);
  }, [noticeQueue]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (
        view !== "sorting" ||
        !comparison ||
        event.repeat ||
        accountOpen ||
        (event.target instanceof HTMLElement &&
          event.target.closest("input,textarea,select,[contenteditable=true]"))
      )
        return;
      const key = event.key.toLowerCase();
      if (["a", "1", "arrowleft", "d", "2", "arrowright"].includes(key)) {
        event.preventDefault();
        act(["a", "1", "arrowleft"].includes(key) ? "left" : "right");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, [view, comparison, accountOpen, act]);

  function renameRank(idx: number) {
    if (!profile || !editingRankTitle.trim()) return;
    const next = renameRanking(profile, idx, editingRankTitle.trim());
    persist(next);
    setEditingRankIdx(null);
    setEditingRankTitle("");
  }
  function deleteRank(idx: number) {
    if (!profile) return;
    const next = deleteRanking(profile, idx);
    if (next) persist(next);
    else {
      setProfile(null);
      try {
        localStorage.removeItem(LIBRARY_KEY);
      } catch {}
    }
    setEditingRankIdx(null);
  }
  function updateRankingWorks(rankingIdx: number, works: RankedArtwork[]) {
    if (!profile || works.length < 1) return;
    const rankings = [...profile.rankings];
    if (rankingIdx < 0 || rankingIdx >= rankings.length) return;
    rankings[rankingIdx] = {
      ...rankings[rankingIdx],
      items: works.map((w, i) => ({ ...w, rank: i + 1 })),
    };
    persist({ ...profile, rankings, updatedAt: new Date().toISOString() });
    setNotice(t("榜单作品已更新。", "Ranking works updated."));
  }
  async function syncPlazaPost(postId: number, rankingIdx: number) {
    if (!accountToken || !profile) return;
    const ranking = profile.rankings[rankingIdx];
    if (!ranking) return;
    setBusy(true);
    try {
      const response = await fetch(`/api/plaza/posts/${postId}`, {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${accountToken}` },
        body: JSON.stringify({
          items: ranking.items,
          item_count: ranking.items.length,
          edits: [
            { action: "sync", detail: t("从文化索引同步榜单内容", "Synced from My Culture Index") },
          ],
        }),
      });
      if (response.ok) setNotice(t("广场帖子已同步更新。", "Plaza post synced."));
      else setNotice(t("同步失败，请稍后重试。", "Sync failed. Please retry."));
    } catch {
      setNotice(t("同步失败，请稍后重试。", "Sync failed. Please retry."));
    } finally {
      setBusy(false);
    }
  }
  function startReorder(rankingIdx: number) {
    if (!profile) return;
    setReorderMode(rankingIdx);
    setReorderItems([...profile.rankings[rankingIdx].items]);
  }
  function saveReorder() {
    if (!profile || reorderMode === null) return;
    const newOrderIds = reorderItems.map((item) => item.id);
    const next = reorderRanking(profile, reorderMode, newOrderIds);
    persist(next);
    setReorderMode(null);
    setReorderItems([]);
  }
  function cancelReorder() {
    setReorderMode(null);
    setReorderItems([]);
  }
  function moveItem(from: number, to: number) {
    setReorderItems((current) => {
      if (to < 0 || to >= current.length || from === to) return current;
      const next = [...current];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }
  function clearAllData() {
    setProfile(null);
    setDraft(null);
    setPeer(null);
    setPeerNotes({});
    setNotes({});
    // 备份键也要一起清掉，否则读取端会把「已清除」的画像从备份里再恢复回来。
    // notes 与登出清理集合对齐（REVIEW §6）。
    try {
      localStorage.removeItem(LIBRARY_KEY);
      localStorage.removeItem(RECOVERY_KEY);
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(PEER_KEY);
      localStorage.removeItem("art-rank:notes");
    } catch {}
    setNotice(t("本地数据已清除。", "Local data cleared."));
  }
  async function openArtworkDetail(work: RankedArtwork, detailKind: MediaKind) {
    setDetailWork({ work, kind: detailKind, data: null, loading: true });
    try {
      if (detailKind === "other") {
        const response = await fetch(
          `/api/other/detail?name=${encodeURIComponent(work.title)}${epochQuery("&")}`,
          { signal: AbortSignal.timeout(20000) },
        );
        const payload = (await response.json()) as {
          data?: (Record<string, unknown> & { poster_url?: string }) | null;
        };
        const data = payload.data ?? null;
        // 维基图片并入 work，让大图海报直接显示
        const merged =
          data?.poster_url && !work.posterUrls?.length
            ? { ...work, posterUrls: [String(data.poster_url)] }
            : work;
        setDetailWork({ work: merged, kind: detailKind, data, loading: false });
        return;
      }
      const apiType = detailKind === "film" ? "movie" : detailKind;
      const extra = new URLSearchParams();
      if (work.year) extra.set("year", String(work.year));
      if (work.creator) extra.set("creator", work.creator.split("/")[0].trim());
      const qs = extra.size ? `&${extra}` : "";
      const response = await fetch(
        `/api/${apiType}/detail?name=${encodeURIComponent(work.title)}${qs}${epochQuery("&")}`,
        { signal: AbortSignal.timeout(20000) },
      );
      const payload = (await response.json()) as { data?: Record<string, unknown> | null };
      setDetailWork({ work, kind: detailKind, data: payload.data ?? null, loading: false });
    } catch {
      setDetailWork({ work, kind: detailKind, data: null, loading: false });
    }
  }
  async function importProfile(file: File, target: "own" | "peer") {
    try {
      if (file.size > MAX_PROFILE_BYTES) throw new Error();
      const imported = parseProfile(JSON.parse(await file.text()));
      if (target === "peer") acceptPeer(imported);
      else {
        let next = profile;
        for (const item of imported.rankings)
          next = mergeRanking(next, { ...item, profileName: imported.profileName });
        if (next) persist(next);
        setActiveKind(imported.rankings[0].kind);
        navigateTo(peer ? "compare" : "profile");
      }
      setNotice("");
    } catch {
      setNotice(
        t(
          "文件格式不正确，请使用有效的画像 JSON（最大 512 KB）。",
          "Invalid profile JSON (maximum 512 KB).",
        ),
      );
    }
  }
  function namedProfile(): ArtisticProfile | null {
    if (!profile) return null;
    const name = profileName.trim() || t("我的艺术人格", "My artistic profile");
    return {
      ...profile,
      profileName: name,
      rankings: profile.rankings.map((entry) => ({ ...entry, profileName: name })),
    };
  }
  async function exportProfile() {
    const next = namedProfile();
    if (!next) return;
    persist(next);
    if (format === "png") {
      setBusy(true);
      try {
        // PNG 导出模块按需加载，不进首屏关键路径。
        const { renderProfilePng, pngFileName } = await import("./lib/exportPng");
        const blob = await renderProfilePng({
          profile: next,
          layout: exportLayout,
          locale,
          label,
          t,
        });
        saveFile(blob, pngFileName(next.profileName, exportLayout), "image/png");
      } catch {
        setNotice(t("导出失败，请重试。", "Export failed, please retry."));
      } finally {
        setBusy(false);
      }
    } else
      saveFile(
        format === "json"
          ? JSON.stringify({ ...next, notes }, null, 2)
          : profileText(next, format, notes),
        `art-profile.${format}`,
        format === "json" ? "application/json" : "text/plain;charset=utf-8",
      );
  }
  async function shareSingleRanking(ranking: RankingExport) {
    const name = profileName.trim() || t("我的艺术人格", "My artistic profile");
    const singleProfile: ArtisticProfile = {
      version: 2,
      profileId: crypto.randomUUID(),
      profileName: name,
      updatedAt: new Date().toISOString(),
      rankings: [{ ...ranking, profileName: name }],
    };
    try {
      parseProfile(singleProfile);
    } catch {
      setNotice(t("数据格式错误。", "Invalid profile data."));
      return;
    }
    // 只保留该榜单相关的批注
    const workIds = new Set(ranking.items.map((item) => item.id));
    const rankingNotes: Record<string, string> = {};
    for (const [key, val] of Object.entries(notes)) {
      if (!val?.trim()) continue;
      if (key === `ranking:${ranking.kind}:${ranking.collectionTitle}`) rankingNotes[key] = val;
      else if (key.startsWith(`work:${ranking.kind}:`)) {
        const workId = key.slice(`work:${ranking.kind}:`.length);
        if (workIds.has(workId)) rankingNotes[key] = val;
      }
    }
    const hasNotes = Object.keys(rankingNotes).length > 0;
    const shareData: Record<string, unknown> = { profile: singleProfile };
    if (hasNotes) shareData.notes = rankingNotes;
    setBusy(true);
    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(shareData),
      });
      const data = (await response.json()) as { url?: string; compareUrl?: string; error?: string };
      // 「比较链接」必须复制 /encounter?payload=<code>；compareUrl 缺失时用 code 兜底拼接
      const link =
        data.compareUrl ??
        (data.url
          ? data.url.replace(/\/share\/([0-9a-f]{8,12})$/, "/encounter?payload=$1")
          : undefined);
      if (response.ok && link) {
        try {
          await navigator.clipboard.writeText(link);
          setNotice(t("比较链接已复制，对方打开即可进入比较。", "Compare link copied."));
        } catch {
          setNotice(t("链接已生成：" + link, "Link ready: " + link));
        }
      } else {
        setNotice(
          t("生成链接失败，请导出 JSON 分享。", "Failed to create link. Export the JSON instead."),
        );
      }
    } catch {
      setNotice(
        t("生成链接失败，请导出 JSON 分享。", "Failed to create link. Export the JSON instead."),
      );
    } finally {
      setBusy(false);
    }
  }
  async function publishToPlaza(ranking: RankingExport, description?: string) {
    if (!accountToken) {
      setNotice(t("请先登录。", "Please sign in first."));
      return;
    }
    // 只保留该榜单相关的批注
    const workIds = new Set(ranking.items.map((item) => item.id));
    const rankingNotes: Record<string, string> = {};
    for (const [key, val] of Object.entries(notes)) {
      if (!val?.trim()) continue;
      if (key === `ranking:${ranking.kind}:${ranking.collectionTitle}`) rankingNotes[key] = val;
      else if (key.startsWith(`work:${ranking.kind}:`)) {
        const workId = key.slice(`work:${ranking.kind}:`.length);
        if (workIds.has(workId)) rankingNotes[key] = val;
      }
    }
    const hasNotes = Object.keys(rankingNotes).length > 0;
    setBusy(true);
    try {
      const response = await fetch("/api/plaza/posts", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accountToken}` },
        body: JSON.stringify({
          post_type: "ranking",
          kind: ranking.kind,
          collection_title: ranking.collectionTitle,
          description: description?.trim() || null,
          items: ranking.items,
          notes: hasNotes ? rankingNotes : null,
          item_count: ranking.items.length,
        }),
      });
      const data = (await response.json()) as { id?: number; error?: string };
      if (response.ok && data.id) {
        try {
          const links = JSON.parse(localStorage.getItem("art-rank:plaza-links") ?? "{}");
          links[`${ranking.kind}|${ranking.collectionTitle}`] = data.id;
          localStorage.setItem("art-rank:plaza-links", JSON.stringify(links));
        } catch {
          /* 关联记录失败不影响发布 */
        }
        setNotice(t("已发布到广场！", "Published to plaza!"));
      } else setNotice(t("发布失败。", "Publish failed."));
    } catch {
      setNotice(t("发布失败，请重试。", "Publish failed, please retry."));
    } finally {
      setBusy(false);
    }
  }
  async function publishProfileToPlaza(description?: string) {
    if (!accountToken) {
      setNotice(t("请先登录。", "Please sign in first."));
      return;
    }
    const next = namedProfile();
    if (!next) return;
    setBusy(true);
    try {
      const response = await fetch("/api/plaza/posts", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accountToken}` },
        body: JSON.stringify({
          post_type: "profile",
          kind: null,
          collection_title: next.profileName,
          description: description?.trim() || null,
          items: next.rankings,
          notes: Object.keys(notes).length > 0 ? notes : null,
          item_count: next.rankings.reduce((sum, r) => sum + r.items.length, 0),
        }),
      });
      const data = (await response.json()) as { id?: number; error?: string };
      if (response.ok && data.id) {
        try {
          const links = JSON.parse(localStorage.getItem("art-rank:plaza-links") ?? "{}");
          links[`profile|${next.profileId}`] = data.id;
          localStorage.setItem("art-rank:plaza-links", JSON.stringify(links));
        } catch {
          /* 关联记录失败不影响发布 */
        }
        setNotice(t("画像已发布到广场！", "Profile published to plaza!"));
      } else setNotice(t("发布失败。", "Publish failed."));
    } catch {
      setNotice(t("发布失败，请重试。", "Publish failed, please retry."));
    } finally {
      setBusy(false);
    }
  }
  async function share() {
    const next = namedProfile();
    if (!next) return;
    try {
      parseProfile(next);
    } catch {
      setNotice(t("数据格式错误。", "Invalid profile data."));
      return;
    }
    persist(next);
    const hasAnyNotes = Object.keys(notes).length > 0;
    const shareData: Record<string, unknown> = { profile: next };
    if (hasAnyNotes) shareData.notes = notes;
    setBusy(true);
    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(shareData),
      });
      const data = (await response.json()) as { url?: string; compareUrl?: string; error?: string };
      if (response.ok && data.compareUrl) {
        setShareUrl(data.compareUrl);
        try {
          const QRCode = await import("qrcode");
          setQrUrl(
            await QRCode.default.toDataURL(data.compareUrl, {
              width: 240,
              margin: 2,
              errorCorrectionLevel: "L",
            }),
          );
        } catch {
          setQrUrl("");
        }
        try {
          await navigator.clipboard.writeText(data.compareUrl);
          setNotice(t("比较链接已复制。", "Comparison link copied."));
        } catch {
          setNotice(t("链接已生成，可在下方选中复制。", "Link ready. Select and copy it below."));
        }
      } else {
        setNotice(
          t("生成链接失败，请导出 JSON 分享。", "Failed to create link. Export the JSON instead."),
        );
      }
    } catch {
      setNotice(
        t("生成链接失败，请导出 JSON 分享。", "Failed to create link. Export the JSON instead."),
      );
    } finally {
      setBusy(false);
    }
  }
  function openShareModal(ranking?: RankingExport) {
    setShareModal({ ranking });
  }
  async function generateShareLink(ranking?: RankingExport, expiresDays: number = 30) {
    const profileData = ranking
      ? {
          version: 2 as const,
          profileId: crypto.randomUUID(),
          profileName: profileName.trim() || t("我的艺术人格", "My artistic profile"),
          updatedAt: new Date().toISOString(),
          rankings: [
            {
              ...ranking,
              profileName: profileName.trim() || t("我的艺术人格", "My artistic profile"),
            },
          ],
        }
      : namedProfile();
    if (!profileData) return;
    try {
      parseProfile(profileData);
    } catch {
      setNotice(t("数据格式错误。", "Invalid profile data."));
      return;
    }
    const shareData: Record<string, unknown> = { profile: profileData, expires_days: expiresDays };
    if (Object.keys(notes).length > 0) shareData.notes = notes;
    setBusy(true);
    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(shareData),
      });
      const data = (await response.json()) as {
        url?: string;
        expires_days?: number;
        error?: string;
      };
      if (response.ok && data.url) {
        const days = data.expires_days ?? expiresDays;
        try {
          await navigator.clipboard.writeText(data.url);
          setNotice(
            t(`分享链接已复制，${days} 天后失效。`, `Share link copied. Expires in ${days} days.`),
          );
        } catch {
          setNotice(t("链接已生成：" + data.url, "Link ready: " + data.url));
        }
      } else {
        setNotice(t("生成链接失败。", "Failed to create link."));
      }
    } catch {
      setNotice(t("生成链接失败。", "Failed to create link."));
    } finally {
      setBusy(false);
    }
  }
  function createFromPeer(nextKind: MediaKind) {
    const entry = peer?.rankings.find((item) => item.kind === nextKind);
    if (!entry || entry.items.length < 2) {
      chooseKind(nextKind);
      return;
    }
    openCollection({
      id: `peer-${entry.profileId}`,
      kind: nextKind,
      source: "custom",
      title: entry.collectionTitle,
      description: "",
      topN: entry.items.length,
      works: entry.items,
    });
  }
  async function importPeerFromUrl() {
    const url = peerUrl.trim();
    if (!url) return;
    setPeerUrlBusy(true);
    try {
      const parsed = new URL(url, location.origin);
      // Handle /share/:code URLs
      const shareMatch = parsed.pathname.match(/^\/share\/([0-9a-f]{8,12})$/i);
      if (shareMatch) {
        const r = await fetch(`/api/share/${shareMatch[1]}`);
        if (!r.ok) throw new Error();
        const d = (await r.json()) as { profile: unknown; notes?: Record<string, string> };
        acceptPeer(parseProfile(d.profile));
        if (d.notes && typeof d.notes === "object") setPeerNotes(d.notes);
        setPeerUrl("");
        return;
      }
      // Handle /encounter?payload= URLs
      const payload =
        parsed.searchParams.get("payload") ??
        new URLSearchParams(parsed.hash.slice(1)).get("profile");
      if (payload) {
        if (/^[0-9a-f]{8,12}$/i.test(payload)) {
          const r = await fetch(`/api/share/${payload}`);
          if (!r.ok) throw new Error();
          const d = (await r.json()) as { profile: unknown };
          acceptPeer(parseProfile(d.profile));
        } else {
          acceptPeer(await decode(payload));
        }
        setPeerUrl("");
        return;
      }
      const r = await fetch(url);
      if (!r.ok) throw new Error();
      acceptPeer(parseProfile(await r.json()));
      setPeerUrl("");
    } catch {
      setNotice(t("链接无效或无法读取，请检查 URL。", "Invalid or unreachable URL."));
    } finally {
      setPeerUrlBusy(false);
    }
  }

  let content: ReactNode;
  if (view === "home")
    content = (
      <HomeView
        locale={locale}
        t={t}
        accountEmail={accountEmail}
        setAccountOpen={setAccountOpen}
        kind={kind}
        chooseKind={chooseKind}
        navigateTo={navigateTo}
        draft={draft}
        resume={resume}
        profile={profile}
        label={label}
        setRingsLayout={setRingsLayout}
        ringsLayout={ringsLayout}
        clearAllData={clearAllData}
        editingRankIdx={editingRankIdx}
        setEditingRankIdx={setEditingRankIdx}
        editingRankTitle={editingRankTitle}
        setEditingRankTitle={setEditingRankTitle}
        renameRank={renameRank}
        deleteRank={deleteRank}
        setActiveKind={setActiveKind}
        openCollection={openCollection}
        importProfile={importProfile}
      />
    );
  else if (view === "source")
    content = (
      <SourceView
        setAccountOpen={setAccountOpen}
        kind={kind}
        t={t}
        label={label}
        source={source}
        setSource={setSource}
        setNotice={setNotice}
        search={search}
        setSearch={setSearch}
        colCount={colCount}
        changeCols={changeCols}
        collections={collections}
        openCollection={openCollection}
        customItem={customItem}
        setCustomItem={setCustomItem}
        customWorks={customWorks}
        customDeselected={customDeselected}
        setCustomDeselected={setCustomDeselected}
        importProgress={importProgress}
        searchWorks={searchWorks}
        addCustomWork={addCustomWork}
        removeCustomWork={removeCustomWork}
        clearCustomWorks={clearCustomWorks}
        loadCustomWorks={loadCustomWorks}
        saveCustomWorks={saveCustomWorks}
        accountToken={accountToken}
        importDoulist={importDoulist}
        importNeteasePlaylist={importNeteasePlaylist}
        customText={customText}
        setCustomText={setCustomText}
        importCollection={importCollection}
        saveCollectionCloud={saveCollectionCloud}
        cloudCollections={cloudCollections}
        loadCloudCollections={loadCloudCollections}
        deleteCloudCollection={deleteCloudCollection}
        doubanLimit={doubanLimit}
        setDoubanLimit={setDoubanLimit}
        busy={busy}
        loadDouban={loadDouban}
      />
    );
  else if (view === "setup" && collection)
    content = (
      <SetupView
        collection={collection}
        kind={kind}
        t={t}
        label={label}
        selected={selected}
        setSelected={setSelected}
        topN={topN}
        setTopN={setTopN}
        seed={seed}
        setSeed={setSeed}
        setCollection={setCollection}
        startRanking={startRanking}
        saveWithoutSorting={saveWithoutSorting}
      />
    );
  else if (view === "sorting" && collection && ranking && comparison && progress)
    content = (
      <SortingView
        collection={collection}
        ranking={ranking}
        comparison={comparison}
        progress={progress}
        label={label}
        kind={kind}
        t={t}
        worksById={worksById}
        act={act}
      />
    );
  else if (view === "profile" && profile && activeRanking)
    content = (
      <ProfileView
        profile={profile}
        activeRanking={activeRanking}
        locale={locale}
        t={t}
        label={label}
        format={format}
        setFormat={setFormat}
        exportLayout={exportLayout}
        setExportLayout={setExportLayout}
        exportProfile={exportProfile}
        share={share}
        shareUrl={shareUrl}
        qrUrl={qrUrl}
        profileName={profileName}
        setProfileName={setProfileName}
        namedProfile={namedProfile}
        persist={persist}
        navigateTo={navigateTo}
        peer={peer}
        editingRankIdx={editingRankIdx}
        setEditingRankIdx={setEditingRankIdx}
        editingRankTitle={editingRankTitle}
        setEditingRankTitle={setEditingRankTitle}
        renameRank={renameRank}
        deleteRank={deleteRank}
        openAiConfig={() => setAiConfigOpen(true)}
        setNotice={setNotice}
        openCollection={openCollection}
        shareSingleRanking={shareSingleRanking}
        openShareModal={openShareModal}
        setActiveKind={setActiveKind}
        ranking={ranking}
        setRanking={setRanking}
        collection={collection}
        notes={notes}
        openNoteModal={openNoteModal}
        openArtworkDetail={openArtworkDetail}
        accountToken={accountToken}
        publishToPlaza={publishToPlaza}
        publishProfileToPlaza={publishProfileToPlaza}
        updateRankingWorks={updateRankingWorks}
        syncPlazaPost={syncPlazaPost}
        reorderMode={reorderMode}
        reorderItems={reorderItems}
        startReorder={startReorder}
        saveReorder={saveReorder}
        cancelReorder={cancelReorder}
        moveItem={moveItem}
        busy={busy}
      />
    );
  else if (view === "compare")
    content = (
      <CompareView
        kinds={kinds}
        profile={profile}
        peer={peer}
        locale={locale}
        compareActiveKind={compareActiveKind}
        setCompareActiveKind={setCompareActiveKind}
        compareMode={compareMode}
        setCompareMode={setCompareMode}
        manualOwnSelections={manualOwnSelections}
        setManualOwnSelections={setManualOwnSelections}
        manualPeerSelections={manualPeerSelections}
        setManualPeerSelections={setManualPeerSelections}
        compareRankings={compareRankings}
        mergeDimensionRankings={mergeDimensionRankings}
        compareDimensions={compareDimensions}
        compareProfiles={compareProfiles}
        navigateTo={navigateTo}
        setPeer={setPeer}
        openAiConfig={() => setAiConfigOpen(true)}
        label={label}
        t={t}
        setCompareSortBy={setCompareSortBy}
        compareSortBy={compareSortBy}
        setCompareRankDetail={setCompareRankDetail}
        shareSingleRanking={shareSingleRanking}
        exportProfile={exportProfile}
        setFormat={setFormat}
        busy={busy}
        namedProfile={namedProfile}
        setNotice={setNotice}
        createFromPeer={createFromPeer}
        setPeerRankPickOpen={setPeerRankPickOpen}
        openArtworkDetail={openArtworkDetail}
        peerUrl={peerUrl}
        setPeerUrl={setPeerUrl}
        peerUrlBusy={peerUrlBusy}
        importPeerFromUrl={importPeerFromUrl}
        importProfile={importProfile}
        setActiveKind={setActiveKind}
        notes={notes}
        peerNotes={peerNotes}
        openShareModal={openShareModal}
      />
    );
  else if (view === "share" && sharePeer)
    content = (
      <ShareView
        peer={sharePeer}
        t={t}
        label={label}
        navigateTo={(v) => {
          if (v === "compare") {
            acceptPeer(sharePeer);
          } else {
            navigateTo(v as View);
            setPeerNotes({});
          }
        }}
        openCollection={openCollection}
        profile={profile}
        notes={peerNotes}
        expiresAt={shareExpires}
        openArtworkDetail={openArtworkDetail}
        openNoteView={openNoteView}
      />
    );
  else if (view === "share" && !sharePeer)
    content = (
      <div className="empty-state">
        <p style={{ marginBottom: 12 }}>{t("正在加载分享内容…", "Loading shared content…")}</p>
        <button className="button secondary" onClick={() => navigateTo("home")}>
          {t("返回首页", "Back home")}
        </button>
      </div>
    );
  else if (view === "plaza")
    content = (
      <PlazaView
        t={t}
        label={label}
        navigateTo={navigateTo}
        accountToken={accountToken}
        openCollection={openCollection}
        profile={profile}
      />
    );
  else if (view === "plazaPost")
    content = (
      <PlazaPostView
        postId={plazaPostId}
        t={t}
        label={label}
        navigateTo={navigateTo}
        accountToken={accountToken}
        accountNickname={accountNickname}
        openCollection={openCollection}
        profile={profile}
        setNotice={setNotice}
        setPeer={setPeer}
        notes={notes}
        openArtworkDetail={openArtworkDetail}
        openNoteView={openNoteView}
      />
    );
  else
    content = (
      <div className="empty-state">
        <p style={{ marginBottom: 12 }}>
          {t(
            "此页面的内容还未创建（例如直接打开了配置或排序地址）。请从首页开始。",
            "This page has no content yet (e.g. opening a setup/sorting link directly). Start from the home page.",
          )}
        </p>
        <button className="button primary" onClick={() => navigateTo("home")}>
          {t("返回首页", "Back home")}
        </button>
      </div>
    );
  return (
    <div className="app-shell">
      <header className="topbar">
        <button className="wordmark" onClick={() => navigateTo("home")}>
          ART<span>/</span>RANK
        </button>
        <nav aria-label={t("主导航", "Main navigation")}>
          <button
            className={
              view === "home" || view === "source" || view === "setup" || view === "sorting"
                ? "active"
                : ""
            }
            onClick={() => navigateTo("home")}
          >
            {t("清单", "Catalog")}
          </button>
          <button
            className={view === "compare" ? "active" : ""}
            onClick={() => navigateTo("compare")}
          >
            {t("相遇", "Encounter")}
          </button>
          <button
            className={view === "plaza" || view === "plazaPost" ? "active" : ""}
            onClick={() => navigateTo("plaza")}
          >
            {t("广场", "Plaza")}
          </button>
          {profile && (
            <button
              className={view === "profile" ? "active" : ""}
              onClick={() => navigateTo("profile")}
            >
              {t("我的文化索引", "My Index")}
            </button>
          )}
        </nav>
        <div className="header-tools">
          <SettingsMenu
            zh={locale === "zh"}
            cap={importCap}
            onCap={setImportCap}
            onNotice={setNotice}
          />
          <ThemeSwitcher zh={locale === "zh"} />
          <IconButton title={t("使用说明", "Guide")} onClick={() => setShowGuide(true)}>
            ?
            <span className="tooltip" role="tooltip">
              {t("使用说明", "Guide")}
            </span>
          </IconButton>
          <IconButton
            title={locale === "zh" ? "English" : "中文"}
            onClick={() => {
              const next = locale === "zh" ? "en" : "zh";
              setLocale(next);
              const url = new URL(location.href);
              url.searchParams.set("lang", next);
              history.replaceState(null, "", url);
            }}
          >
            <Languages size={18} />
          </IconButton>
          <a
            className="icon-button"
            href="https://github.com/tripodxu/film-sort"
            target="_blank"
            rel="noopener noreferrer"
            title="GitHub"
          >
            <Github size={18} />
            <span className="tooltip" role="tooltip">
              GitHub
            </span>
          </a>
          <IconButton
            title={
              accountEmail
                ? t("同步 / 退出", "Sync / Sign out")
                : t("登录 / 同步", "Sign in / Sync")
            }
            onClick={() => setAccountOpen(true)}
          >
            <UserRound size={18} />
            {accountToken && (
              <span
                className="sync-dot"
                data-status={syncStatus}
                style={{
                  position: "absolute",
                  top: 4,
                  right: 4,
                  width: 7,
                  height: 7,
                  borderRadius: "50%",
                  border: "1.5px solid var(--bg)",
                  zIndex: 1,
                }}
              />
            )}
          </IconButton>
        </div>
      </header>
      <main className={`main view-${view}`}>
        {view !== "home" && (
          <button
            className="back-link"
            onClick={() => navigateTo(view === "setup" ? "source" : "home")}
          >
            <ArrowLeft size={15} />
            {t("回到上一层", "Back")}
          </button>
        )}
        <ErrorBoundary>{content}</ErrorBoundary>
      </main>
      <footer>
        <span>ART/RANK</span>
        <span>{t("偏好没有标准答案", "Preference has no answer key")}</span>
      </footer>
      {(noticeQueue.length > 0 || notice) && (
        <div className="toast" role="status" aria-live="polite">
          <span>{notice}</span>
          <IconButton
            title={t("关闭提示", "Dismiss")}
            onClick={() => setNoticeQueue((q) => q.slice(1))}
          >
            <X size={16} />
          </IconButton>
        </div>
      )}
      {showScrollTop && (
        <button
          className="scroll-top visible"
          onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
          aria-label={t("回到顶部", "Scroll to top")}
        >
          <ArrowLeft size={18} style={{ transform: "rotate(90deg)" }} />
        </button>
      )}
      {aiConfigOpen && <AiConfigDialog t={t} onClose={() => setAiConfigOpen(false)} />}
      {cloudConflict && (
        <div className="modal-backdrop" onClick={() => setCloudConflict(null)}>
          <section
            className="account-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") setCloudConflict(null);
            }}
          >
            <div className="section-heading">
              <h2>{t("数据冲突", "Data conflict")}</h2>
              <IconButton title={t("关闭", "Close")} onClick={() => setCloudConflict(null)}>
                <X size={18} />
              </IconButton>
            </div>
            <p style={{ marginBottom: 16, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
              {t(
                "本地有游客数据，云端也有数据。请选择如何处理：",
                "You have local guest data and cloud data. Choose how to proceed:",
              )}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              <button
                className="button primary"
                onClick={() => {
                  if (profile && cloudConflict) {
                    const merged = mergeProfiles(cloudConflict.profile, profile);
                    persist(merged);
                    setSyncStatus("saving");
                    // 增量合并必须同时提交合并后的批注映射，否则另一侧刚删除的批注
                    // 会在下次同步时复活（DATA-03）。
                    fetch("/api/account/profile", {
                      method: "PUT",
                      headers: {
                        "content-type": "application/json",
                        authorization: `Bearer ${accountToken}`,
                      },
                      body: JSON.stringify(buildProfileSyncBody(merged, notes, true)),
                    })
                      .then((r) => {
                        setSyncStatus(r.ok ? "saved" : "error");
                        if (r.ok) setNotice(t("已增量合并到云端。", "Merged to cloud."));
                      })
                      .catch(() => setSyncStatus("error"));
                  }
                  setCloudConflict(null);
                }}
              >
                <CloudUpload size={16} />
                {t("增量合并到云端", "Merge to cloud")}
              </button>
              <button
                className="button secondary"
                onClick={() => {
                  persist(cloudConflict.profile);
                  // 「使用云端数据」以云端为准：画像与批注一起原子替换（DATA-04）。
                  setNotes({ ...cloudConflict.notes });
                  writeNotes({ ...cloudConflict.notes });
                  setCloudConflict(null);
                  setNotice(t("已使用云端数据。", "Cloud data applied."));
                }}
              >
                <CloudDownload size={16} />
                {t("使用云端数据", "Use cloud data")}
              </button>
              <button className="button quiet" onClick={() => setCloudConflict(null)}>
                {t("取消，各自保留", "Cancel, keep both")}
              </button>
            </div>
          </section>
        </div>
      )}
      {detailWork && (
        <ArtworkDetail
          detail={detailWork}
          label={label}
          t={t}
          onClose={() => setDetailWork(null)}
        />
      )}
      {shareModal && (
        <div className="modal-backdrop" onClick={() => setShareModal(null)}>
          <section
            className="account-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="share-expiry-heading"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") setShareModal(null);
            }}
          >
            <div className="section-heading">
              <div>
                <span className="eyebrow">SHARE</span>
                <h2 id="share-expiry-heading">{t("分享链接有效期", "Share link expiry")}</h2>
              </div>
              <IconButton title={t("关闭", "Close")} onClick={() => setShareModal(null)}>
                <X size={18} />
              </IconButton>
            </div>
            <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, margin: 0 }}>
              {t(
                "选择链接有效期，到期后他人将无法再打开该链接。生成后链接自动复制。",
                "Pick how long the link stays valid — it stops working after expiry. The link is copied automatically.",
              )}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {[7, 30, 90, 365].map((days) => (
                <button
                  key={days}
                  className="button secondary"
                  disabled={busy}
                  style={{ justifyContent: "space-between" }}
                  onClick={() => {
                    const picked = shareModal;
                    setShareModal(null);
                    void generateShareLink(picked?.ranking, days);
                  }}
                >
                  <span>{days === 365 ? t("一年", "1 year") : `${days} ${t("天", "days")}`}</span>
                  <small>
                    {new Date(Date.now() + days * 86400000).toLocaleDateString(
                      locale === "zh" ? "zh-CN" : "en-US",
                    )}
                  </small>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
      {noteModal && (
        <div className="modal-backdrop note-backdrop" onClick={() => setNoteModal(null)}>
          <section
            className="note-reader"
            role="dialog"
            aria-modal="true"
            aria-labelledby="note-heading"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") setNoteModal(null);
            }}
          >
            <div
              className="note-reader-bg"
              style={{
                backgroundImage: noteModal.posterUrls?.[0]
                  ? `url(/api/image?url=${encodeURIComponent(noteModal.posterUrls[0])})`
                  : undefined,
              }}
            />
            <div className="note-reader-header">
              <span className="note-reader-eyebrow">NOTE</span>
              <h2 id="note-heading">{noteModal.title}</h2>
            </div>
            <textarea
              className="note-reader-body"
              value={noteDraft}
              onChange={(e) => setNoteDraft(e.target.value)}
              placeholder={t(
                "写下你对这部作品的看法、感想、回忆…",
                "Write your thoughts, feelings, memories about this work...",
              )}
              autoFocus
            />
            <div className="note-reader-footer">
              <button
                className="note-footer-btn"
                onClick={() => {
                  const next = setNote(notes, noteModal.key, "");
                  setNotes(next);
                  writeNotes(next);
                  setNoteDraft("");
                  setNotice(t("批注已清除。", "Note cleared."));
                }}
              >
                {t("清除", "Clear")}
              </button>
              {noteDraft.length > 0 && (
                <span className="note-char-count">
                  {noteDraft.length} {t("字", "chars")}
                </span>
              )}
              <div style={{ flex: 1 }} />
              <button className="note-footer-btn" onClick={() => setNoteModal(null)}>
                {t("取消", "Cancel")}
              </button>
              <button className="note-footer-btn note-footer-primary" onClick={saveNote}>
                {t("保存", "Save")}
              </button>
            </div>
          </section>
        </div>
      )}
      {noteViewModal && (
        <div className="modal-backdrop note-backdrop" onClick={() => setNoteViewModal(null)}>
          <section
            className="note-reader"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") setNoteViewModal(null);
            }}
          >
            <div
              className="note-reader-bg"
              style={{
                backgroundImage: noteViewModal.posterUrls?.[0]
                  ? `url(/api/image?url=${encodeURIComponent(noteViewModal.posterUrls[0])})`
                  : undefined,
              }}
            />
            <div className="note-reader-header">
              <span className="note-reader-eyebrow">NOTE</span>
              <h2>{noteViewModal.title}</h2>
            </div>
            <div className="note-reader-body note-reader-view">
              <p>{noteViewModal.text}</p>
            </div>
            <div className="note-reader-footer">
              <div style={{ flex: 1 }} />
              <button
                className="note-footer-btn note-footer-primary"
                onClick={() => setNoteViewModal(null)}
              >
                {t("关闭", "Close")}
              </button>
            </div>
          </section>
        </div>
      )}
      {peerRankPickOpen && peer && (
        <div className="modal-backdrop" onClick={() => setPeerRankPickOpen(false)}>
          <section
            className="account-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") setPeerRankPickOpen(false);
            }}
          >
            <div className="section-heading">
              <h2>{t("选择对方榜单", "Pick their ranking")}</h2>
              <IconButton title={t("关闭", "Close")} onClick={() => setPeerRankPickOpen(false)}>
                <X size={18} />
              </IconButton>
            </div>
            <p style={{ marginBottom: 16, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
              {t("选择一个榜单，用其中的作品进行排序。", "Pick a ranking to sort its works.")}
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
              {peer.rankings.map((entry, idx) => (
                <button
                  key={idx}
                  className="button secondary"
                  style={{ justifyContent: "flex-start", gap: 12 }}
                  onClick={() => {
                    setPeerRankPickOpen(false);
                    const existingTitles =
                      profile?.rankings
                        .filter((r) => r.kind === entry.kind)
                        .map((r) => r.collectionTitle) ?? [];
                    let title = entry.collectionTitle;
                    if (existingTitles.includes(title)) {
                      let n = 2;
                      while (existingTitles.includes(`${title} (${n})`)) n++;
                      title = `${title} (${n})`;
                    }
                    openCollection({
                      id: `peer-${entry.profileId}-${entry.kind}-${idx}`,
                      kind: entry.kind,
                      source: "custom",
                      title,
                      description: "",
                      topN: entry.items.length,
                      works: entry.items,
                    });
                  }}
                >
                  <span
                    style={{
                      color: "var(--accent)",
                      fontSize: 11,
                      fontWeight: 600,
                      width: 28,
                      flexShrink: 0,
                    }}
                  >
                    {label(entry.kind)}
                  </span>
                  <Poster work={entry.items[0]} kind={entry.kind} />
                  <span
                    style={{
                      flex: 1,
                      textAlign: "left",
                      overflow: "hidden",
                      textOverflow: "ellipsis",
                      whiteSpace: "nowrap",
                    }}
                  >
                    {entry.collectionTitle}
                  </span>
                  <small style={{ color: "var(--muted)", flexShrink: 0 }}>
                    TOP {entry.items.length}
                  </small>
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
      {compareRankDetail && (
        <div className="modal-backdrop" onClick={() => setCompareRankDetail(null)}>
          <section
            className="rank-detail-dialog"
            role="dialog"
            aria-modal="true"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") setCompareRankDetail(null);
            }}
          >
            {compareRankDetail.ranking ? (
              <RankingDetail
                kind={compareRankDetail.ranking.kind}
                collectionTitle={compareRankDetail.collectionTitle}
                items={compareRankDetail.ranking.items}
                notes={compareRankDetail.side === "peer" ? peerNotes : notes}
                kindLabel={label}
                eyebrow={`${compareRankDetail.side === "own" ? t("我的索引", "MY INDEX") : t("对方索引", "THEIR INDEX")} / ${label(compareRankDetail.ranking.kind)}`}
                headerExtra={
                  <IconButton title={t("关闭", "Close")} onClick={() => setCompareRankDetail(null)}>
                    <X size={18} />
                  </IconButton>
                }
                onNoteView={(title, text, posterUrls) => {
                  openNoteView(title, text, posterUrls);
                }}
                onArtworkClick={(work, kind) => {
                  void openArtworkDetail(work, kind);
                }}
                highlightId={compareRankDetail.highlightId}
              />
            ) : (
              <div className="section-heading">
                <h2>{compareRankDetail.collectionTitle}</h2>
                <IconButton title={t("关闭", "Close")} onClick={() => setCompareRankDetail(null)}>
                  <X size={18} />
                </IconButton>
              </div>
            )}
            {!compareRankDetail.ranking && (
              <p className="empty-state">{t("无法找到该榜单数据", "Ranking data not found")}</p>
            )}
          </section>
        </div>
      )}
      {accountOpen && (
        <div className="modal-backdrop" onClick={() => setAccountOpen(false)}>
          <section
            className="account-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="account-heading"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") setAccountOpen(false);
            }}
          >
            <div className="section-heading">
              <h2 id="account-heading">{t("账号与同步", "Account & sync")}</h2>
              <IconButton title={t("关闭", "Close")} onClick={() => setAccountOpen(false)}>
                <X size={18} />
              </IconButton>
            </div>
            {accountEmail && needNickname ? (
              <>
                <p style={{ marginBottom: 12 }}>
                  {t("请设置你的昵称", "Please set your nickname")}
                </p>
                <input
                  type="text"
                  placeholder={t("昵称", "Nickname")}
                  value={authNickname}
                  onChange={(e) => setAuthNickname(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveNickname();
                  }}
                  style={{ marginBottom: 12 }}
                  autoFocus
                />
                <button
                  className="button primary"
                  disabled={busy || !authNickname.trim()}
                  onClick={() => void saveNickname()}
                >
                  {t("确认昵称", "Set nickname")}
                </button>
              </>
            ) : accountEmail ? (
              <>
                <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
                  {editingNickname ? (
                    <div style={{ display: "flex", gap: 4, alignItems: "center", flex: 1 }}>
                      <input
                        type="text"
                        value={editNicknameValue}
                        onChange={(e) => setEditNicknameValue(e.target.value)}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") void saveNickname();
                          if (e.key === "Escape") setEditingNickname(false);
                        }}
                        style={{ fontSize: 14, padding: "4px 8px", minHeight: "auto", flex: 1 }}
                        autoFocus
                      />
                      <button
                        className="text-button"
                        onClick={() => void saveNickname()}
                        style={{ color: "var(--accent)", fontSize: 13, padding: "4px 8px" }}
                      >
                        ✓
                      </button>
                    </div>
                  ) : (
                    <>
                      <p style={{ fontWeight: 600, margin: 0 }}>
                        {accountNickname || accountEmail}
                      </p>
                      <button
                        onClick={() => {
                          setEditingNickname(true);
                          setEditNicknameValue(accountNickname);
                        }}
                        style={{
                          fontSize: 10,
                          color: "var(--muted)",
                          background: "none",
                          border: "1px solid var(--line)",
                          borderRadius: 4,
                          padding: "1px 6px",
                          cursor: "pointer",
                        }}
                      >
                        {t("改名", "Edit")}
                      </button>
                    </>
                  )}
                </div>
                <p
                  style={{
                    marginBottom: 16,
                    fontSize: 12,
                    color: "var(--muted)",
                    display: "flex",
                    alignItems: "center",
                    gap: 6,
                  }}
                >
                  {accountEmail}
                  <span
                    title={
                      syncStatus === "saving"
                        ? t("同步中", "Syncing")
                        : syncStatus === "saved"
                          ? t("已同步", "Synced")
                          : syncStatus === "error"
                            ? t("同步失败", "Sync failed")
                            : t("待机", "Idle")
                    }
                    className="sync-dot"
                    data-status={syncStatus}
                    style={{
                      display: "inline-block",
                      width: 8,
                      height: 8,
                      borderRadius: "50%",
                      flexShrink: 0,
                    }}
                  />
                </p>
                <button
                  className="button primary"
                  disabled={busy || !profile}
                  onClick={accountSave}
                  style={{ marginBottom: 8 }}
                >
                  <CloudUpload size={16} />
                  {t("同步到云端", "Sync to cloud")}
                </button>
                <button
                  className="button secondary"
                  disabled={busy}
                  onClick={() => void accountLoad(false)}
                  style={{ marginBottom: 8 }}
                >
                  <CloudDownload size={16} />
                  {t("从云端恢复画像", "Restore from cloud")}
                </button>
                <button className="button quiet" onClick={accountLogout}>
                  {t("退出登录", "Sign out")}
                </button>
              </>
            ) : (
              <>
                <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
                  <a
                    className="button secondary"
                    href="/api/account/oauth/google"
                    style={{
                      textAlign: "center",
                      textDecoration: "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24">
                      <path
                        fill="#4285F4"
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                      />
                      <path
                        fill="#34A853"
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                      />
                      <path
                        fill="#FBBC05"
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                      />
                      <path
                        fill="#EA4335"
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                      />
                    </svg>
                    {t("使用 Google 登录", "Sign in with Google")}
                  </a>
                  <a
                    className="button secondary"
                    href="/api/account/oauth/github"
                    style={{
                      textAlign: "center",
                      textDecoration: "none",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      gap: 8,
                    }}
                  >
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                      <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
                    </svg>
                    {t("使用 GitHub 登录", "Sign in with GitHub")}
                  </a>
                </div>
                <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
                  <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
                  <span style={{ fontSize: 11, color: "var(--muted)" }}>
                    {t("或使用邮箱", "or use email")}
                  </span>
                  <div style={{ flex: 1, height: 1, background: "var(--line)" }} />
                </div>
                <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
                  <button
                    className={`button ${authMode === "login" ? "primary" : "secondary"}`}
                    onClick={() => {
                      setAuthMode("login");
                      setAuthError("");
                    }}
                    style={{ flex: 1 }}
                  >
                    {t("登录", "Sign in")}
                  </button>
                  <button
                    className={`button ${authMode === "register" ? "primary" : "secondary"}`}
                    onClick={() => {
                      setAuthMode("register");
                      setAuthError("");
                    }}
                    style={{ flex: 1 }}
                  >
                    {t("注册", "Register")}
                  </button>
                  <button
                    className={`button ${authMode === "reset" ? "primary" : "secondary"}`}
                    onClick={() => {
                      setAuthMode("reset");
                      setAuthError("");
                    }}
                    style={{ flex: 1 }}
                  >
                    {t("修改密码", "Change password")}
                  </button>
                </div>
                {authError && (
                  <p style={{ color: "#f87171", fontSize: 13, marginBottom: 8 }}>{authError}</p>
                )}
                {authMode === "register" && (
                  <input
                    type="text"
                    placeholder={t("昵称（必填）", "Nickname (required)")}
                    value={authNickname}
                    onChange={(e) => setAuthNickname(e.target.value)}
                    style={{ marginBottom: 8 }}
                  />
                )}
                <input
                  type="email"
                  placeholder={t("邮箱", "Email")}
                  value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)}
                  style={{ marginBottom: 8 }}
                />
                {authMode !== "login" && (
                  <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                    <input
                      type="text"
                      placeholder={t("邮箱验证码", "Email code")}
                      value={authCode}
                      onChange={(e) => setAuthCode(e.target.value)}
                      style={{ flex: 1 }}
                    />
                    <button
                      className="button secondary"
                      disabled={busy || codeCooldown > 0}
                      onClick={() => void sendAuthCode()}
                      style={{ whiteSpace: "nowrap" }}
                    >
                      {codeCooldown > 0 ? `${codeCooldown}s` : t("获取验证码", "Get code")}
                    </button>
                  </div>
                )}
                <input
                  type="password"
                  placeholder={
                    authMode === "reset"
                      ? t("新密码（至少6位）", "New password (6+ chars)")
                      : t("密码（至少6位）", "Password (6+ chars)")
                  }
                  value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void accountAuth(authMode);
                  }}
                  style={{ marginBottom: 12 }}
                />
                <button
                  className="button primary"
                  disabled={busy}
                  onClick={() => void accountAuth(authMode)}
                >
                  {authMode === "login"
                    ? t("登录", "Sign in")
                    : authMode === "register"
                      ? t("注册", "Register")
                      : t("修改密码", "Change password")}
                </button>
              </>
            )}
            {!accountEmail && (
              <button className="button quiet" onClick={() => setAccountOpen(false)}>
                <UserRound size={16} />
                {t("继续使用游客模式", "Continue as guest")}
              </button>
            )}
          </section>
        </div>
      )}
      {showGuide && (
        <div className="modal-backdrop" onClick={() => setShowGuide(false)}>
          <FocusTrap onEscape={() => setShowGuide(false)}>
            <section
              className="guide-modal account-dialog"
              role="dialog"
              aria-modal="true"
              aria-labelledby="guide-heading"
              onClick={(event) => event.stopPropagation()}
            >
              <span className="eyebrow">ART/RANK {t("使用说明", "GUIDE")}</span>
              <h2 id="guide-heading">{t("欢迎来到 ART/RANK", "Welcome to ART/RANK")}</h2>
              <p className="guide-subtitle">
                {t(
                  "在两件作品之间做出选择，找到你真正想留下的那一个。以下是快速上手指南：",
                  "Choose between two works and reveal what stays with you. Here's a quick guide:",
                )}
              </p>
              <div className="guide-steps">
                <div className="guide-step">
                  <span className="guide-step-num">1</span>
                  <div className="guide-step-body">
                    <strong>{t("选择媒介维度", "Choose a medium")}</strong>
                    <p>
                      {t(
                        "电影、书籍、音乐或其他——每个维度可以创建多个独立榜单。",
                        "Film, Books, Music, or Other — each medium can have multiple independent lists.",
                      )}
                    </p>
                  </div>
                </div>
                <div className="guide-step">
                  <span className="guide-step-num">2</span>
                  <div className="guide-step-body">
                    <strong>{t("选择作品来源", "Pick your works")}</strong>
                    <p>
                      {t(
                        "从精选榜单中挑选，粘贴自己的清单，或从豆瓣 Top250 导入。",
                        "Pick from curated lists, paste your own collection, or import from Douban Top250.",
                      )}
                    </p>
                  </div>
                </div>
                <div className="guide-step">
                  <span className="guide-step-num">3</span>
                  <div className="guide-step-body">
                    <strong>{t("1v1 取舍排序", "Sort by choosing")}</strong>
                    <p>
                      {t(
                        "每次看到两件作品，点击你更想留下的那个。支持键盘快捷键 A/D 或 ←/→。",
                        "Each time you see two works, tap the one you'd keep. Keyboard: A/D or ←/→.",
                      )}
                    </p>
                  </div>
                </div>
                <div className="guide-step">
                  <span className="guide-step-num">4</span>
                  <div className="guide-step-body">
                    <strong>{t("查看文化索引", "View your index")}</strong>
                    <p>
                      {t(
                        "排序完成后自动保存，可导出为 JSON/TXT/Markdown/CSV/PNG。",
                        "Results save automatically. Export as JSON, TXT, Markdown, CSV, or PNG.",
                      )}
                    </p>
                  </div>
                </div>
                <div className="guide-step">
                  <span className="guide-step-num">5</span>
                  <div className="guide-step-body">
                    <strong>{t("与朋友比较", "Compare with friends")}</strong>
                    <p>
                      {t(
                        "生成比较链接或二维码发给对方，看看你们的品味在哪里重合。",
                        "Generate a compare link or QR code and see where your tastes overlap.",
                      )}
                    </p>
                  </div>
                </div>
              </div>
              <div className="guide-modal-footer">
                <button
                  className="button secondary"
                  onClick={() => {
                    setShowGuide(false);
                    setShowTech(true);
                  }}
                >
                  {t("技术说明", "Technical details")}
                </button>
                <div style={{ flex: 1 }} />
                <button
                  className="button quiet"
                  onClick={() => {
                    try {
                      localStorage.setItem("art-rank:guide-dismissed", "1");
                    } catch {}
                    setShowGuide(false);
                  }}
                >
                  {t("不再显示", "Don't show again")}
                </button>
                <button className="button primary" onClick={() => setShowGuide(false)}>
                  {t("知道了", "Got it")}
                </button>
              </div>
            </section>
          </FocusTrap>
        </div>
      )}
      {showTech && (
        <div className="modal-backdrop" onClick={() => setShowTech(false)}>
          <section
            className="tech-modal account-dialog"
            role="dialog"
            aria-modal="true"
            aria-labelledby="tech-heading"
            onClick={(event) => event.stopPropagation()}
            onKeyDown={(event) => {
              if (event.key === "Escape") setShowTech(false);
            }}
          >
            <span className="eyebrow">ART/RANK TECHNICAL</span>
            <h2 id="tech-heading">{t("技术说明", "Technical Details")}</h2>
            <p className="guide-subtitle">
              {t(
                "ART/RANK 背后的核心算法和数据流。",
                "The core algorithms and data flow behind ART/RANK.",
              )}
            </p>
            <div className="tech-sections">
              <details open>
                <summary>{t("排序算法", "Sorting Algorithm")}</summary>
                <div className="tech-body">
                  <p>
                    {t("排序引擎使用", "The sorting engine uses ")}
                    <strong>{t("主动式二分插入排序", "Active Binary Insertion Sort")}</strong>
                    {t(
                      "，核心思路是：每次取出一个候选作品，与已排序列表的中位数比较，根据结果缩小搜索范围，直到确定精确插入位置。",
                      ". The core idea: each candidate work is compared with the median of the sorted list, narrowing the search range until the exact insertion position is found.",
                    )}
                  </p>
                  <p>
                    {t(
                      "时间复杂度 O(n log n)。对于 n 件作品取 Top N，每个候选最多需要 ⌈log₂(N+1)⌉ 次比较。",
                      "Time complexity O(n log n). For n works with Top N, each candidate needs at most ⌈log₂(N+1)⌉ comparisons.",
                    )}
                  </p>
                  <p>
                    <strong>{t("冷却机制", "Cooldown")}</strong>：
                    {t(
                      "同一对作品至少间隔 3 次比较，同一作品至少间隔 4 次比较，防止顺序偏差和比较疲劳。",
                      "Same pair at least 3 comparisons apart, same work at least 4 apart — prevents order bias and comparison fatigue.",
                    )}
                  </p>
                  <p>
                    <strong>{t("偏好回环检测", "Preference Loop Detection")}</strong>：
                    {t(
                      "当检测到 A→B→C→A 的偏好循环时，系统安排复测。首次标记为「观察中」，多次方向一致后标记为「持久张力」——尊重用户的真实品味矛盾，而非强行纠正。",
                      "When detecting A→B→C→A preference loops, the system schedules rechecks. First marked 'observed', then 'persistent tension' if consistently confirmed — respecting genuine taste contradictions.",
                    )}
                  </p>
                  <p>
                    <strong>{t("验证阶段", "Verification Phase")}</strong>：
                    {t(
                      "主排序完成后，自动复测少量相邻作品对和循环边，确保结果稳定。复测数量约为 Top N 的 1/3。",
                      "After main sorting, a few adjacent pairs and loop edges are rechecked. Verification count ≈ Top N / 3.",
                    )}
                  </p>
                  <p>
                    <strong>{t("撤销", "Undo")}</strong>：
                    {t(
                      "通过重放决策日志（去掉最后一条）重建完整状态，保证撤销后排序一致性。",
                      "Rebuilds state by replaying the decision log minus the last entry, guaranteeing consistency after undo.",
                    )}
                  </p>
                </div>
              </details>
              <details>
                <summary>{t("比较算法", "Comparison Algorithm")}</summary>
                <div className="tech-body">
                  <p>
                    {t(
                      "两人比较时，系统首先将同维度的多个榜单",
                      "When comparing two profiles, the system first ",
                    )}
                    <strong>{t("合并", "merges")}</strong>
                    {t(
                      "：同一作品出现在多个榜单中时取最高名次。匹配依据是标题 + 年份 + 创作者的规范化比较。",
                      " multiple lists per dimension: same work across lists takes the best rank. Matching is based on normalized title + year + creator.",
                    )}
                  </p>
                  <p>
                    <strong>{t("贪心匹配", "Greedy Matching")}</strong>：
                    {t(
                      "生成所有候选对的匹配评分（70-90 分），按评分降序、排名差升序排列，贪心选择不冲突的最优匹配。",
                      " — generates match scores (70-90) for all candidate pairs, sorted by score descending then rank-diff ascending, greedily selecting non-conflicting optimal matches.",
                    )}
                  </p>
                  <p>
                    <strong>{t("比较指标", "Comparison Metrics")}</strong>：
                  </p>
                  <ul>
                    <li>
                      <strong>{t("作品重合度", "Work Overlap")}</strong>：
                      {t("共同作品数 / 并集作品数", "shared works / union count")}
                    </li>
                    <li>
                      <strong>{t("加权偏好一致", "Weighted Agreement")}</strong>：
                      {t(
                        "基于 1/rank 权重的一致性（高排名作品权重更大）",
                        "consistency weighted by 1/rank (higher-ranked works matter more)",
                      )}
                    </li>
                    <li>
                      <strong>{t("顺序一致率", "Order Agreement")}</strong>：
                      {t(
                        "剔除并列名次后的序对一致数 / 非并列总序对数（多榜单合并取最优名次会产生并列，并列无法判定先后，不计入）",
                        "concordant pairs / non-tied pairs (merged best ranks can tie; ties are excluded)",
                      )}
                    </li>
                    <li>
                      <strong>{t("Top 3 共识", "Top 3 Consensus")}</strong>：
                      {t("双方前三名中的共同作品数", "shared works in both top 3")}
                    </li>
                    <li>
                      <strong>{t("名次距离", "Rank Distance")}</strong>：
                      {t("平均名次差 / 最大名次", "avg rank difference / max rank")}
                    </li>
                    <li>
                      <strong>{t("斯皮尔曼相关", "Spearman-like")}</strong>：
                      {t(
                        "基于排名差平方的秩相关系数",
                        "rank correlation based on squared rank differences",
                      )}
                    </li>
                  </ul>
                </div>
              </details>
              <details>
                <summary>{t("海报与详情 API", "Poster & Detail API")}</summary>
                <div className="tech-body">
                  <p>
                    <strong>
                      {t("海报解析策略（按优先级）", "Poster resolution (by priority)")}
                    </strong>
                    ：
                  </p>
                  <ul>
                    <li>
                      <strong>{t("电影", "Film")}</strong>：
                      {t(
                        "豆瓣 suggest API → search.douban.com 搜索 → Top250 索引 → IMDb 备用",
                        "Douban suggest API → search.douban.com → Top250 index → IMDb fallback",
                      )}
                    </li>
                    <li>
                      <strong>{t("书籍", "Book")}</strong>：
                      {t(
                        "豆瓣 suggest API（pic 字段）→ search.douban.com 搜索 → Top250 索引",
                        "Douban suggest API (pic field) → search.douban.com → Top250 index",
                      )}
                    </li>
                    <li>
                      <strong>{t("音乐", "Music")}</strong>：
                      {t(
                        "网易云 CDN 封面直出优先 → search.douban.com 搜索 → Top250 索引（无 suggest API）",
                        "NetEase CDN cover first → search.douban.com → Top250 index (no suggest API)",
                      )}
                    </li>
                  </ul>
                  <p>
                    {t(
                      "以上都没命中时，所有类别统一按「维基百科 → 网易云 / gd-proxy」逐级兜底。",
                      "When none of the above hit, every medium falls back through Wikipedia → NetEase / gd-proxy.",
                    )}
                  </p>
                  <p>
                    {t(
                      "豆瓣返回的 URL 会展开成多个 CDN 镜像变体（img1/2/3/9.doubanio.com）并做 https 升级，前端按顺序尝试加载。",
                      "A Douban URL expands into several CDN mirror variants (img1/2/3/9.doubanio.com) with https upgrade; the frontend tries them in order.",
                    )}
                  </p>
                  <p>
                    <strong>{t("详情获取策略", "Detail fetching")}</strong>：
                    {t(
                      "优先从 Wikipedia（中英文）获取简介，辅以类型限定词减少歧义；然后尝试创作者组合搜索；最后用百度百科兜底。元数据（评分、导演、出版社等）从豆瓣搜索结果解析。",
                      "Prioritizes Wikipedia (zh/en) for content intros with type disambiguation; then creator+title combo search; Baidu Baike as fallback. Metadata (ratings, director, publisher) parsed from Douban search results.",
                    )}
                  </p>
                  <p>
                    <strong>{t("防限流机制", "Rate Limit Protection")}</strong>：
                    {t(
                      "4 个 Edge UA 轮换；同域名请求按域名串行并保持最小间隔（默认 800ms，search.douban.com 放宽到 200ms）；图片请求不参与节流；403/418 重试 2 次并递增冷却 5s→10s→15s。",
                      "4 Edge UAs rotated; per-domain serialized requests with a minimum gap (800ms default, 200ms for search.douban.com); image requests skip throttling; 2 retries on 403/418 with escalating cooldown 5s→10s→15s.",
                    )}
                  </p>
                </div>
              </details>
              <details>
                <summary>{t("数据存储", "Data Storage")}</summary>
                <div className="tech-body">
                  <p>
                    <strong>{t("游客模式", "Guest mode")}</strong>：
                    {t(
                      "所有数据存储在浏览器 localStorage，不离开设备。",
                      "All data in browser localStorage, never leaves the device.",
                    )}
                  </p>
                  <p>
                    <strong>{t("登录用户", "Signed-in users")}</strong>：
                    {t(
                      "画像和云端清单存储在 Cloudflare D1（SQLite），Token 有效期 30 天。画像变更自动防抖同步，切到后台或关闭页面时使用 keepalive 确保最后保存。",
                      "Profiles and cloud lists stored in Cloudflare D1 (SQLite), 30-day token. Profile changes auto-debounced, with keepalive sync on page hide/close.",
                    )}
                  </p>
                  <p>
                    <strong>{t("分享链接", "Share links")}</strong>：
                    {t(
                      "统一走服务端 12 位短码（需要 D1）。旧版把画像压缩后内联在 URL 里的链接仍可打开，由前端 fflate 解压读取。",
                      "Served as a 12-character server-side code (requires D1). Older links that inline a compressed profile in the URL still open, decoded client-side with fflate.",
                    )}
                  </p>
                </div>
              </details>
            </div>
            <div className="guide-modal-footer">
              <a
                className="button secondary"
                href="https://github.com/tripodxu/film-sort"
                target="_blank"
                rel="noopener noreferrer"
                style={{ textDecoration: "none" }}
              >
                GitHub
              </a>
              <div style={{ flex: 1 }} />
              <button className="button primary" onClick={() => setShowTech(false)}>
                {t("关闭", "Close")}
              </button>
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
