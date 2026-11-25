import { lazy, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, Github, Languages, UserRound, X } from "lucide-react";

import { mediaLabels, type MediaKind } from "./data/mediaKinds";
import {
  ACCOUNT_TOKEN_KEY,
  clearUserSessionStorage,
  DRAFT_KEY,
  GUIDE_DISMISSED_KEY,
  PLAZA_LINKS_KEY,
  RINGS_LAYOUT_KEY,
} from "./lib/storageKeys";
import type { ShareLinkKind } from "./lib/shareLink";
import {
  MAX_PROFILE_BYTES,
  mergeRanking,
  parseProfile,
  profileText,
  type ArtisticProfile,
  type RankingExport,
  type RankedArtwork,
} from "./lib/profile";
import { importCollection } from "./lib/collections";
import type { ExportLayout } from "./lib/exportPng";
import { Skeleton, SkeletonRows } from "./components/ui/Skeleton";
import { ErrorBoundary } from "./components/ErrorBoundary";
import { buildTasteContext } from "./lib/typesafe";
import { epochQuery } from "./lib/cacheBust";
import { ArtworkDetail, type ArtworkDetailInfo } from "./components/ArtworkDetail";
import { IconButton } from "./views/IconButton";
import { ThemeSwitcher } from "./components/ThemeSwitcher";
import { applyTheme, readTheme } from "./lib/theme";
import { HomeView } from "./views/HomeView";
import { applyLayout, readLayout } from "./lib/layout";
// 非首页的大视图按路由拆包(DeferredOrb 同款模式):大视图占主包大头,
// 首屏用不到的不进 index chunk。首页是落地视图,保持同步渲染。
const SortingView = lazy(() =>
  import("./views/SortingView").then((module) => ({ default: module.SortingView })),
);
const SourceView = lazy(() =>
  import("./views/SourceView").then((module) => ({ default: module.SourceView })),
);
const ProfileView = lazy(() =>
  import("./views/ProfileView").then((module) => ({ default: module.ProfileView })),
);
const CompareView = lazy(() =>
  import("./views/CompareView").then((module) => ({ default: module.CompareView })),
);
// S3 新增：深度比较页同样按路由拆包，且是独立文件（旧 CompareView 一行不改）。
const DepthCompareView = lazy(() =>
  import("./views/DepthCompareView").then((module) => ({ default: module.DepthCompareView })),
);
const ShareView = lazy(() =>
  import("./views/ShareView").then((module) => ({ default: module.ShareView })),
);
const PlazaPostView = lazy(() =>
  import("./views/PlazaPostView").then((module) => ({ default: module.PlazaPostView })),
);
// 弹窗与次级视图同样不进首屏:它们要等用户先点一下(齿轮/AI 设置/榜单海报)才会挂载,
// 同步 import 只会让它们连同各自的 lucide 图标白白占住主包(PLAN-ROUTE-EAGER §3.1)。
const AiConfigDialog = lazy(() =>
  import("./components/AiConfigDialog").then((module) => ({ default: module.AiConfigDialog })),
);
const SettingsMenu = lazy(() =>
  import("./components/SettingsMenu").then((module) => ({ default: module.SettingsMenu })),
);
const SetupView = lazy(() =>
  import("./views/SetupView").then((module) => ({ default: module.SetupView })),
);
const PlazaView = lazy(() =>
  import("./views/PlazaView").then((module) => ({ default: module.PlazaView })),
);
const CloudConflictModal = lazy(() =>
  import("./components/modals/CloudConflictModal").then((m) => ({
    default: m.CloudConflictModal,
  })),
);
const ShareExpiryModal = lazy(() =>
  import("./components/modals/ShareExpiryModal").then((m) => ({
    default: m.ShareExpiryModal,
  })),
);
const NoteEditModal = lazy(() =>
  import("./components/modals/NoteModals").then((m) => ({ default: m.NoteEditModal })),
);
const NoteViewModal = lazy(() =>
  import("./components/modals/NoteModals").then((m) => ({ default: m.NoteViewModal })),
);
const PeerRankPickModal = lazy(() =>
  import("./components/modals/PeerCompareModals").then((m) => ({
    default: m.PeerRankPickModal,
  })),
);
const CompareRankDetailModal = lazy(() =>
  import("./components/modals/PeerCompareModals").then((m) => ({
    default: m.CompareRankDetailModal,
  })),
);
const AccountModal = lazy(() =>
  import("./components/modals/AccountModal").then((m) => ({ default: m.AccountModal })),
);
const GuideModal = lazy(() =>
  import("./components/modals/GuideModal").then((m) => ({ default: m.GuideModal })),
);
const TechModal = lazy(() =>
  import("./components/modals/TechModal").then((m) => ({ default: m.TechModal })),
);

// 挂载在 <Suspense> 之外的三处(顶栏齿轮 / AI 设置 / 榜单海报)没有现成 fallback,
// 首次点击会白屏一瞬。复用已有的 .route-loading,不新增 CSS。
function LazySpot() {
  return (
    <div className="route-loading" role="status" aria-live="polite">
      <span className="sr-only">加载中…</span>
    </div>
  );
}

import { track, decode, saveFile } from "./lib/utils";
import type { View } from "./lib/useRouter";
import { useAuth } from "./lib/useAuth";
import { resolveRankingTabKey, useSorting } from "./lib/useSorting";
import { AppEnvProvider, useAppEnv } from "./contexts/AppEnvContext";
import { useProfileStore } from "./lib/useProfileStore";
import { usePeerCompare } from "./lib/usePeerCompare";

const kinds = Object.keys(mediaLabels) as MediaKind[];

export default function App() {
  return (
    <AppEnvProvider>
      <AppShell />
    </AppEnvProvider>
  );
}

function AppShell() {
  const {
    locale,
    setLocale,
    t,
    label,
    notice,
    hasNotice,
    setNotice,
    dismissNotice,
    view,
    setView,
    navigateTo,
    plazaPostId,
  } = useAppEnv();
  const [shareUrl, setShareUrl] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  // 输出区当前是「比较链接」还是「分享链接」：标签与二维码必须跟着实际链接类型走。
  const [shareLinkKind, setShareLinkKind] = useState<ShareLinkKind>("compare");
  // 两类链接共用输出区：后发请求的代际更大，先发但迟到的响应一律丢弃，绝不覆盖用户最后一次选择。
  const shareGenRef = useRef(0);
  const profileStore = useProfileStore({
    t,
    setNotice,
    onPersist: () => {
      setShareUrl("");
      setQrUrl("");
      setShareLinkKind("compare");
    },
  });
  const {
    profile,
    setProfile,
    profileName,
    setProfileName,
    setActiveKind,
    activeRanking,
    editingRankIdx,
    setEditingRankIdx,
    editingRankTitle,
    setEditingRankTitle,
    notes,
    setNotes,
    noteModal,
    setNoteModal,
    noteDraft,
    setNoteDraft,
    noteViewModal,
    setNoteViewModal,
    reorderMode,
    setReorderMode,
    reorderItems,
    setReorderItems,
    openNoteModal,
    openNoteView,
    saveNote,
    persist,
    renameRank,
    deleteRank,
    updateRankingWorks,
    startReorder,
    saveReorder,
    cancelReorder,
    moveItem,
  } = profileStore;
  const sortingRef = useRef<ReturnType<typeof useSorting> | null>(null);
  const peerStore = usePeerCompare({
    t,
    setNotice,
    setActiveKind,
    navigateTo: (v) => navigateTo(v),
    chooseKind: (k) => sortingRef.current?.chooseKind(k),
    openCollection: (c) => sortingRef.current?.openCollection(c),
  });
  const {
    peer,
    setPeer,
    peerNotes,
    setPeerNotes,
    compareActiveKind,
    setCompareActiveKind,
    compareMode,
    setCompareMode,
    manualOwnSelections,
    setManualOwnSelections,
    manualPeerSelections,
    setManualPeerSelections,
    compareRankDetail,
    setCompareRankDetail,
    compareSortBy,
    setCompareSortBy,
    peerRankPickOpen,
    setPeerRankPickOpen,
    peerUrl,
    setPeerUrl,
    peerUrlBusy,
    acceptPeer,
    createFromPeer,
    importPeerFromUrl,
  } = peerStore;
  const [aiConfigOpen, setAiConfigOpen] = useState(false);
  const [format, setFormat] = useState<"json" | "txt" | "md" | "csv" | "png">("json");
  const [exportLayout, setExportLayout] = useState<ExportLayout>("editorial");
  const [shareModal, setShareModal] = useState<{ ranking?: RankingExport } | null>(null);
  const [shareExpires, setShareExpires] = useState("");
  const [ringsLayout, setRingsLayout] = useState<"row" | "col">(() => {
    try {
      return (localStorage.getItem(RINGS_LAYOUT_KEY) as "row" | "col") || "row";
    } catch {
      return "row";
    }
  });
  const [detailWork, setDetailWork] = useState<ArtworkDetailInfo | null>(null);
  const [sharePeer, setSharePeer] = useState<ArtisticProfile | null>(null);
  // 分享内容加载失败的页内反馈：fetch 挂起（DNS 污染/代理中断会把连接黑洞掉，
  // 既不 resolve 也不 reject）时，「正在加载」占位必须能变成明确的错误态，
  // 否则访问者面对的是无限加载。2026-10-05 线上实测真实发生。
  const [shareError, setShareError] = useState(false);
  // P5c：布局模式兜底（双点位之一——main.tsx 预挂载为主，此 effect 兜底）
  useEffect(() => {
    applyLayout(readLayout());
  }, []);

  const [showGuide, setShowGuide] = useState(() => {
    try {
      return !localStorage.getItem(GUIDE_DISMISSED_KEY);
    } catch {
      return true;
    }
  });
  const [showTech, setShowTech] = useState(false);
  const [showScrollTop, setShowScrollTop] = useState(false);

  const auth = useAuth({
    getProfile: () => profile,
    profile,
    notes,
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
    busy: authBusy,
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
    importDoulist,
    importNeteasePlaylist,
    saveCollectionCloud,
    loadCloudCollections,
    deleteCloudCollection,
    changeCols,
    loadDouban,
    startRanking,
    act,
    rewindLastChoice,
    resume,
    saveWithoutSorting,
    startJevRanking,
    jevBusy,
  } = sorting;
  sortingRef.current = sorting;
  const busy = sortingBusy;

  // Wire auth's setDraft to sorting's setDraft (breaks circular dependency).
  // In an effect, not render: setDraft is a stable state setter, so this binds once.
  useEffect(() => {
    auth.updateSetDraft(setDraft as (d: unknown) => void);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- auth 身份随登录态变化；rebind 幂等，按 setDraft 变化触发即可
  }, [setDraft]);

  // Jev 辅助模式的品味上下文:画像变化时重建一次,排序中的每对预测共用
  const tasteContext = useMemo(
    () => (profile ? buildTasteContext(profile.rankings) : undefined),
    [profile],
  );
  useEffect(() => {
    track("visit", { lang: locale, app_version: "2.0.0" });
    const payload =
      new URLSearchParams(location.hash.slice(1)).get("profile") ??
      new URLSearchParams(location.search).get("payload");
    if (payload) {
      if (/^[0-9a-f]{8,12}$/i.test(payload)) {
        // Short code — fetch from server（同 share 页：黑洞网络下不许无限挂起）
        fetch(`/api/share/${payload}`, { signal: AbortSignal.timeout(15000) })
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
            localStorage.setItem(ACCOUNT_TOKEN_KEY, data.token);
          } catch {}
          const name = data.nickname ?? "";
          if (!name || name === data.email.split("@")[0]) {
            setNeedNickname(true);
            setAccountOpen(true);
          }
          setNotice(t("登录成功！", "Signed in!"));
          // 云端画像与批注恢复统一交由 useAuth 内按 accountToken 触发的水合门处理，
          // 避免此处无代际守卫的重复请求覆盖冲突选择或登出状态。
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
          // 15s 超时：连接被黑洞（DNS 污染/断网）时 fetch 可能永远挂起，
          // 没有它用户就永远停在「正在加载」。
          fetch(`/api/share/${code}`, { signal: AbortSignal.timeout(15000) })
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
            .catch(() => {
              setShareError(true);
              setNotice(t("分享链接无效或已过期。", "Share link is invalid or expired."));
            });
        } else {
          // Base64 payload in path
          decode(code)
            .then((p) => {
              setSharePeer(p);
              setView("share");
            })
            .catch(() => {
              setShareError(true);
              setNotice(t("分享链接无效或过大。", "Share link is invalid or too large."));
            });
        }
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 仅挂载时消费一次 URL 参数（分享导入等），处理的是挂载时快照
  }, []);
  useEffect(() => {
    document.documentElement.lang = locale === "zh" ? "zh-CN" : "en";
  }, [locale]);
  useEffect(() => {
    applyTheme(readTheme());
  }, []);
  useEffect(() => {
    // aurora 悬浮胶囊的滚动态（PLAN-ui-modernization P2）：仅切 class，
    // 非 aurora 主题无对应 CSS——旧主题渲染不受影响（zero-diff 铁律）。
    const topbar = document.querySelector<HTMLElement>(".topbar");
    const onScroll = () => {
      setShowScrollTop(window.scrollY > 400);
      topbar?.classList.toggle("scrolled", window.scrollY > 8);
    };
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);
  useEffect(() => {
    setEditingRankIdx(null);
    setEditingRankTitle("");
    setReorderMode(null);
    setReorderItems([]);
  }, [view, setEditingRankIdx, setEditingRankTitle, setReorderMode, setReorderItems]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      // 排序快捷键不得穿透任何弹窗：弹窗打开时 A/D/←/→ 必须留给弹窗本身
      // （此前仅防 accountOpen，note/guide/详情等打开时仍会误触发 act 改榜）。
      const modalOpen =
        accountOpen ||
        aiConfigOpen ||
        peerRankPickOpen ||
        compareRankDetail !== null ||
        shareModal !== null ||
        noteModal !== null ||
        noteViewModal !== null ||
        detailWork !== null ||
        showGuide ||
        showTech ||
        cloudConflict !== null;
      if (
        view !== "sorting" ||
        !comparison ||
        event.repeat ||
        modalOpen ||
        (event.target instanceof HTMLElement &&
          (event.target.closest("[role=dialog]") ||
            event.target.closest("input,textarea,select,[contenteditable=true]")))
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
  }, [
    view,
    comparison,
    accountOpen,
    aiConfigOpen,
    peerRankPickOpen,
    compareRankDetail,
    shareModal,
    noteModal,
    noteViewModal,
    detailWork,
    showGuide,
    showTech,
    cloudConflict,
    act,
  ]);

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
  function clearAllData() {
    setProfile(null);
    setDraft(null);
    setPeer(null);
    setPeerNotes({});
    setNotes({});
    // 备份键也要一起清掉，否则读取端会把「已清除」的画像从备份里再恢复回来。
    // notes 与登出清理集合对齐（REVIEW §6）。
    clearUserSessionStorage({ keepAccountToken: true });
    setNotice(t("本地数据已清除。", "Local data cleared."));
  }
  async function openArtworkDetail(work: RankedArtwork, detailKind: MediaKind) {
    setDetailWork({ work, kind: detailKind, data: null, loading: true });
    // 迟到响应守卫（硬规则 7）：详情链最长 20-30s，期间用户可能已经关掉弹窗
    // 或换开了另一部作品。响应回来时只有「当前弹窗仍是这一部」才落结果——
    // 绝不顶掉后来那份，也不把已关闭的弹窗重新打开。
    const applyIfCurrent = (data: Record<string, unknown> | null, resolved: RankedArtwork) => {
      setDetailWork((current) => {
        if (!current || current.kind !== detailKind || current.work.id !== work.id) return current;
        // 等待期间用户经 CoverChoice 换过的封面也是用户动作，不许被响应冲掉。
        const posterUrls = current.work.posterUrls?.length
          ? current.work.posterUrls
          : resolved.posterUrls;
        return { work: { ...resolved, posterUrls }, kind: detailKind, data, loading: false };
      });
    };
    try {
      if (detailKind === "other") {
        // 维基 zh→en→百科兜底链实测冷缓存可超 25s：20s 会把本可成功的详情掐成
        // 「暂时没有更多资料」，表现为「其他维度没有详情」。
        // 带年份：消歧最硬信号（清单格式「标题 - 游戏 (年)」），精确页是系列页/
        // 同名概念页时服务端按年份重新择优。
        const extra = new URLSearchParams();
        if (work.year) extra.set("year", String(work.year));
        const response = await fetch(
          `/api/other/detail?name=${encodeURIComponent(work.title)}${extra.size ? `&${extra}` : ""}${epochQuery("&")}`,
          { signal: AbortSignal.timeout(30000) },
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
        applyIfCurrent(data, merged);
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
      applyIfCurrent(payload.data ?? null, work);
    } catch {
      applyIfCurrent(null, work);
    }
  }
  async function exportWrapped() {
    const next = namedProfile();
    if (!next) return;
    persist(next);
    setBusy(true);
    try {
      // PNG 导出模块按需加载，不进首屏关键路径。
      const [{ renderWrappedPng, wrappedFileName }, { readDraftLike, draftInsight }] =
        await Promise.all([import("./lib/exportPng"), import("./lib/wrapped")]);
      // 取舍次数与最纠结一对只在进行中草稿里：id→标题映射用草稿自带的 collection
      let insight: ReturnType<typeof draftInsight> = null;
      const draftLike = readDraftLike(localStorage);
      if (draftLike) {
        const idTitles = new Map<string, string>();
        try {
          const raw = JSON.parse(localStorage.getItem(DRAFT_KEY) ?? "") as {
            collection?: { works?: Array<{ id?: unknown; title?: unknown }> };
          };
          for (const work of raw.collection?.works ?? []) {
            if (typeof work?.id === "string" && typeof work?.title === "string")
              idTitles.set(work.id, work.title);
          }
        } catch {
          /* 草稿形状不对时只损失张力节，年鉴卡其余部分照常 */
        }
        insight = draftInsight(draftLike, (id) => idTitles.get(id));
      }
      const blob = await renderWrappedPng({ profile: next, locale, label, t, draft: insight });
      saveFile(blob, wrappedFileName(next.profileName), "image/png");
    } catch {
      setNotice(t("导出失败，请重试。", "Export failed, please retry."));
    } finally {
      setBusy(false);
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
        const first = imported.rankings[0];
        setActiveKind(resolveRankingTabKey(next, first.kind, first.collectionTitle));
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
          const links = JSON.parse(localStorage.getItem(PLAZA_LINKS_KEY) ?? "{}");
          links[`${ranking.kind}|${ranking.collectionTitle}`] = data.id;
          localStorage.setItem(PLAZA_LINKS_KEY, JSON.stringify(links));
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
          const links = JSON.parse(localStorage.getItem(PLAZA_LINKS_KEY) ?? "{}");
          links[`profile|${next.profileId}`] = data.id;
          localStorage.setItem(PLAZA_LINKS_KEY, JSON.stringify(links));
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
    const generation = ++shareGenRef.current;
    setBusy(true);
    try {
      const response = await fetch("/api/share", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(shareData),
      });
      const data = (await response.json()) as { url?: string; compareUrl?: string; error?: string };
      if (generation !== shareGenRef.current) return;
      if (response.ok && data.compareUrl) {
        setShareLinkKind("compare");
        setShareUrl(data.compareUrl);
        setQrUrl(await makeQr(data.compareUrl));
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
  /** 二维码只是辅助，生成失败时留空（文本框仍可选中复制）。 */
  async function makeQr(url: string): Promise<string> {
    try {
      const QRCode = await import("qrcode");
      return await QRCode.default.toDataURL(url, {
        width: 240,
        margin: 2,
        errorCorrectionLevel: "L",
      });
    } catch {
      return "";
    }
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
    if (!profileData) {
      setNotice(t("请先完成至少一份榜单再分享。", "Finish at least one ranking before sharing."));
      return;
    }
    try {
      parseProfile(profileData);
    } catch {
      setNotice(t("数据格式错误。", "Invalid profile data."));
      return;
    }
    const shareData: Record<string, unknown> = { profile: profileData, expires_days: expiresDays };
    if (Object.keys(notes).length > 0) shareData.notes = notes;
    const generation = ++shareGenRef.current;
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
      if (generation !== shareGenRef.current) return;
      if (response.ok && data.url) {
        const days = data.expires_days ?? expiresDays;
        // 分享链接不是比较链接：先换标签并换成它自己的二维码，避免文本与二维码指向不同页面。
        setShareLinkKind("share");
        setShareUrl(data.url);
        setQrUrl(await makeQr(data.url));
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
        startJevRanking={startJevRanking}
        jevBusy={jevBusy}
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
        locale={locale}
        tasteContext={tasteContext}
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
        exportWrapped={exportWrapped}
        share={share}
        shareUrl={shareUrl}
        qrUrl={qrUrl}
        shareLinkKind={shareLinkKind}
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
        rewindLastChoice={rewindLastChoice}
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
  else if (view === "depth")
    content = <DepthCompareView profile={profile} peer={peer} t={t} navigateTo={navigateTo} />;
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
        {shareError ? (
          <>
            <p className="u-mb">
              {t(
                "分享内容加载失败：链接无效、已过期，或网络暂时不可用。",
                "Couldn't load this share: the link is invalid, expired, or the network is unreachable.",
              )}
            </p>
            <button className="button secondary" onClick={() => location.reload()}>
              {t("重试", "Retry")}
            </button>{" "}
          </>
        ) : (
          <p className="u-mb">{t("正在加载分享内容…", "Loading shared content…")}</p>
        )}
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
      <div className="empty-state empty-state-standalone">
        <p className="u-mb">
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
          <button className={view === "depth" ? "active" : ""} onClick={() => navigateTo("depth")}>
            {t("深度", "Depth")}
          </button>
          <button
            className={view === "plaza" || view === "plazaPost" ? "active" : ""}
            onClick={() => navigateTo("plaza")}
          >
            {t("广场", "Plaza")}
          </button>
          {profile && (
            <button
              className={view === "profile" ? "active nav-profile-only" : "nav-profile-only"}
              onClick={() => navigateTo("profile")}
            >
              {t("我的文化索引", "My Index")}
            </button>
          )}
        </nav>
        <div className="header-tools">
          {/* 拆包 chunk 加载失败（发版换代旧 hash 404 / 弱网）不许白屏整站：
              main 里的路由树有 ErrorBoundary，这三处挂在边界之外，各包一层静默
              边界——失败就当没渲染/没点开，绝不拖垮页面其余部分。 */}
          <ErrorBoundary fallback={null}>
            <Suspense fallback={null}>
              <SettingsMenu
                zh={locale === "zh"}
                cap={importCap}
                onCap={setImportCap}
                onNotice={setNotice}
              />
            </Suspense>
          </ErrorBoundary>
          <ThemeSwitcher zh={locale === "zh"} onNotice={setNotice} />
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
        {/* 滚动进度条（CSS scroll-driven）：现代层专属，全页面生效 */}
        <div className="md-progress" aria-hidden="true" />
        {view !== "home" && (
          <button
            className="back-link"
            onClick={() => navigateTo(view === "setup" ? "source" : "home")}
          >
            <ArrowLeft size={15} />
            {t("回到上一层", "Back")}
          </button>
        )}
        <ErrorBoundary>
          <Suspense
            fallback={
              <div
                className="route-loading"
                aria-label="Loading"
                style={{ display: "grid", gap: 16 }}
              >
                <Skeleton variant="line" width="32%" />
                <SkeletonRows rows={4} />
              </div>
            }
          >
            {content}
          </Suspense>
        </ErrorBoundary>
      </main>
      <footer>
        <span>ART/RANK</span>
        <span>{t("偏好没有标准答案", "Preference has no answer key")}</span>
      </footer>
      {(hasNotice || notice) && (
        <div className="toast" role="status" aria-live="polite">
          <span>{notice}</span>
          <IconButton title={t("关闭提示", "Dismiss")} onClick={dismissNotice}>
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
      {aiConfigOpen && (
        <ErrorBoundary fallback={null}>
          <Suspense fallback={<LazySpot />}>
            <AiConfigDialog t={t} onClose={() => setAiConfigOpen(false)} />
          </Suspense>
        </ErrorBoundary>
      )}
      {cloudConflict && (
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <CloudConflictModal
              t={t}
              cloudConflict={cloudConflict}
              profile={profile}
              notes={notes}
              accountToken={accountToken}
              persist={persist}
              setNotes={setNotes}
              setSyncStatus={setSyncStatus}
              setNotice={setNotice}
              onClose={() => setCloudConflict(null)}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {detailWork && (
        <ArtworkDetail
          detail={detailWork}
          label={label}
          t={t}
          onClose={() => setDetailWork(null)}
          onCoverChange={(url) =>
            setDetailWork((current) =>
              current ? { ...current, work: { ...current.work, posterUrls: [url] } } : current,
            )
          }
        />
      )}
      {shareModal && (
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <ShareExpiryModal
              t={t}
              locale={locale}
              busy={busy}
              shareModal={shareModal}
              onClose={() => setShareModal(null)}
              onSelectDays={(ranking, days) => {
                void generateShareLink(ranking, days);
              }}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {noteModal && (
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <NoteEditModal
              t={t}
              noteModal={noteModal}
              noteDraft={noteDraft}
              setNoteDraft={setNoteDraft}
              notes={notes}
              setNotes={setNotes}
              setNotice={setNotice}
              onSave={saveNote}
              onClose={() => setNoteModal(null)}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {noteViewModal && (
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <NoteViewModal
              t={t}
              noteViewModal={noteViewModal}
              onClose={() => setNoteViewModal(null)}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {peerRankPickOpen && peer && (
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <PeerRankPickModal
              t={t}
              label={label}
              peer={peer}
              profile={profile}
              openCollection={openCollection}
              onClose={() => setPeerRankPickOpen(false)}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {compareRankDetail && (
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <CompareRankDetailModal
              t={t}
              label={label}
              compareRankDetail={compareRankDetail}
              notes={notes}
              peerNotes={peerNotes}
              openNoteView={openNoteView}
              openArtworkDetail={openArtworkDetail}
              onClose={() => setCompareRankDetail(null)}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {accountOpen && (
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <AccountModal
              t={t}
              profile={profile}
              accountEmail={accountEmail}
              accountNickname={accountNickname}
              needNickname={needNickname}
              editingNickname={editingNickname}
              setEditingNickname={setEditingNickname}
              editNicknameValue={editNicknameValue}
              setEditNicknameValue={setEditNicknameValue}
              authMode={authMode}
              setAuthMode={setAuthMode}
              authEmail={authEmail}
              setAuthEmail={setAuthEmail}
              authPassword={authPassword}
              setAuthPassword={setAuthPassword}
              authNickname={authNickname}
              setAuthNickname={setAuthNickname}
              authCode={authCode}
              setAuthCode={setAuthCode}
              authError={authError}
              setAuthError={setAuthError}
              authBusy={authBusy}
              codeCooldown={codeCooldown}
              syncStatus={syncStatus}
              saveNickname={saveNickname}
              accountSave={accountSave}
              accountLoad={accountLoad}
              accountLogout={accountLogout}
              sendAuthCode={sendAuthCode}
              accountAuth={accountAuth}
              onClose={() => setAccountOpen(false)}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {showGuide && (
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <GuideModal
              t={t}
              onClose={() => setShowGuide(false)}
              onOpenTech={() => setShowTech(true)}
            />
          </Suspense>
        </ErrorBoundary>
      )}
      {showTech && (
        <ErrorBoundary fallback={null}>
          <Suspense fallback={null}>
            <TechModal t={t} onClose={() => setShowTech(false)} />
          </Suspense>
        </ErrorBoundary>
      )}
    </div>
  );
}
