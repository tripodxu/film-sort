import { useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, CloudDownload, CloudUpload, Download, Github, Languages, Link, Pause, Play, Plus, Share2, Sparkles, StickyNote, Undo2, Upload, UserRound, Users, X } from "lucide-react";

import { createRankingState, chooseSide, deferWork, deserializeRankingState, getCurrentComparison, getRankingProgress, getRankingResult, serializeRankingState, skipWork, undoLastAction, type RankingState } from "./lib/ranking";
import { getCollectionsByKind, mediaLabels, type MediaCollection, type MediaKind } from "./data/media";
import { compareDimensions, compareProfiles, compareRankings, LIBRARY_KEY, MAX_PROFILE_BYTES, mergeDimensionRankings, mergeProfiles, mergeRanking, parseProfile, profileText, readProfile, renameRanking, deleteRanking, reorderRanking, type ArtisticProfile, type RankingExport, type RankedArtwork } from "./lib/profile";
import { importCollection } from "./lib/collections";
import { ExpandableNote } from "./components/ExpandableNote";
import { readNotes, writeNotes, setNote, type NoteScope } from "./lib/notes";
import { Poster } from "./components/Poster";
import { IconButton } from "./views/IconButton";
import { HomeView } from "./views/HomeView";
import { SourceView } from "./views/SourceView";
import { SetupView } from "./views/SetupView";
import { SortingView } from "./views/SortingView";
import { ProfileView } from "./views/ProfileView";
import { CompareView } from "./views/CompareView";
import { ShareView } from "./views/ShareView";
import { PlazaView } from "./views/PlazaView";
import { PlazaPostView } from "./views/PlazaPostView";

type View = "home" | "source" | "setup" | "sorting" | "profile" | "compare" | "share" | "plaza" | "plazaPost";
const VIEW_PATH: Record<View, string> = { home: "/", source: "/catalog/source", setup: "/catalog/setup", sorting: "/catalog/sorting", profile: "/myself", compare: "/encounter", share: "/share", plaza: "/plaza", plazaPost: "/plaza/0" };
function pathToView(p: string): View | null { const clean = p.replace(/\/+$/, "") || "/"; if (clean.startsWith("/share")) return "share"; if (/^\/plaza\/\d+/.test(clean)) return "plazaPost"; if (clean === "/plaza") return "plaza"; return (Object.entries(VIEW_PATH) as [View, string][]).find(([, v]) => clean === v)?.[0] ?? null; }
type Locale = "zh" | "en";
type Draft = { collection: MediaCollection; ranking: string; profileName: string };
const DRAFT_KEY = "art-rank:draft:v2";
const PEER_KEY = "art-rank:peer:v2";
const kinds = Object.keys(mediaLabels) as MediaKind[];
const englishKinds = { film: "Films", book: "Books", music: "Music", other: "Other" };

function stored(key: string) { try { return localStorage.getItem(key); } catch { return null; } }
function loadPeer() { try { return parseProfile(JSON.parse(stored(PEER_KEY) ?? "")); } catch { return null; } }
function loadDraft(): Draft | null {
  try {
    const data = JSON.parse(stored(DRAFT_KEY) ?? "") as Draft;
    const state = deserializeRankingState(data.ranking);
    if (state.completed || !kinds.includes(data.collection.kind) || !Array.isArray(data.collection.works) || data.collection.works.length > 300 ||
      !state.sourceIds.every((id) => data.collection.works.some((work) => work.id === id && typeof work.title === "string"))) return null;
    getCurrentComparison(state);
    return data;
  } catch { return null; }
}
function track(event: string, payload: Record<string, string | number>) {
  try {
    const id = stored("art-rank:session:v1") ?? crypto.randomUUID();
    localStorage.setItem("art-rank:session:v1", id);
    void fetch("/api/events", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ event_name: event, session_id: id, payload }) }).catch(() => undefined);
  } catch { /* Local privacy settings must not interrupt sorting. */ }
}
async function encode(profile: ArtisticProfile) {
  const { compressSync, strToU8 } = await import("fflate");
  return btoa(Array.from(compressSync(strToU8(JSON.stringify(profile))), (byte) => String.fromCharCode(byte)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
async function decode(payload: string) {
  const { decompressSync, strFromU8 } = await import("fflate");
  if (payload.length > 100000) throw new Error("Link too large");
  const binary = atob(payload.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - payload.length % 4) % 4));
  const data = decompressSync(Uint8Array.from(binary, (char) => char.charCodeAt(0)), { out: new Uint8Array(MAX_PROFILE_BYTES + 1) });
  if (data.length > MAX_PROFILE_BYTES) throw new Error("Profile too large");
  return parseProfile(JSON.parse(strFromU8(data)));
}
function saveFile(content: BlobPart, name: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a"); link.href = url; link.download = name; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function crossProfileSummary(own: ArtisticProfile, peer: ArtisticProfile): string {
  return own.rankings.map((ranking) => {
    const other = peer.rankings.find((entry) => entry.kind === ranking.kind);
    if (!other) return `${ranking.kind}: only one side has a list`;
    return `${ranking.kind}: mine=${ranking.items.slice(0, 5).map((item) => item.title).join(", ")}; theirs=${other.items.slice(0, 5).map((item) => item.title).join(", ")}`;
  }).join("\n").slice(0, 2200);
}

export default function App() {
  const [locale, setLocale] = useState<Locale>(() => new URLSearchParams(location.search).get("lang") === "en" ? "en" : "zh");
  const t = (zh: string, en: string) => locale === "zh" ? zh : en;
  const label = (kind: MediaKind) => locale === "zh" ? mediaLabels[kind].label : englishKinds[kind];
  const [view, setView] = useState<View>("home");
  const [kind, setKind] = useState<MediaKind>("film");
  const [source, setSource] = useState<"builtin" | "custom" | "douban">("builtin");
  const [collection, setCollection] = useState<MediaCollection | null>(null);
  const [selected, setSelected] = useState<string[]>([]);
  const [ranking, setRanking] = useState<RankingState | null>(null);
  const [draft, setDraft] = useState(loadDraft);
  const [profile, setProfile] = useState<ArtisticProfile | null>(() => { try { return readProfile(localStorage); } catch { return null; } });
  const [peer, setPeer] = useState<ArtisticProfile | null>(loadPeer);
  const [profileName, setProfileName] = useState(() => { try { return readProfile(localStorage)?.profileName ?? "我的艺术人格"; } catch { return "我的艺术人格"; } });
  const [activeKind, setActiveKind] = useState<string>("film");
  const [compareActiveKind, setCompareActiveKind] = useState<MediaKind>("film");
  const [compareMode, setCompareMode] = useState<"auto" | "manual">("auto");
  const [manualOwnSelections, setManualOwnSelections] = useState<Set<number>>(new Set());
  const [manualPeerSelections, setManualPeerSelections] = useState<Set<number>>(new Set());
  const [compareRankDetail, setCompareRankDetail] = useState<{ side: "own" | "peer"; collectionTitle: string; ranking: RankingExport | null; highlightId?: string } | null>(null);
  const [compareSortBy, setCompareSortBy] = useState<"own" | "peer">("own");
  const [peerRankPickOpen, setPeerRankPickOpen] = useState(false);
  const [topN, setTopN] = useState(10);
  const [seed, setSeed] = useState("");
  const [customText, setCustomText] = useState("");
  const [customItem, setCustomItem] = useState("");
  const [cloudCollections, setCloudCollections] = useState<Array<MediaCollection & { remoteId: number }>>([]);
  const [aiInsight, setAiInsight] = useState("");
  const [aiBusy, setAiBusy] = useState(false);
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [colCount, setColCount] = useState<number>(() => { try { return Number(localStorage.getItem("art-rank:cols")) || 3; } catch { return 3; } });
  const [busy, setBusy] = useState(false);
  const [doubanLimit, setDoubanLimit] = useState(50);
  const [format, setFormat] = useState<"json" | "txt" | "md" | "csv" | "png">("json");
  const [exportLayout, setExportLayout] = useState<"editorial" | "collage" | "minimal">("editorial");
  const [shareUrl, setShareUrl] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [accountOpen, setAccountOpen] = useState(new URLSearchParams(location.search).has("account"));
  const [accountEnabled, setAccountEnabled] = useState(false);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountNickname, setAccountNickname] = useState("");
  const [accountToken, setAccountToken] = useState(() => { try { return localStorage.getItem("art-rank:account-token") ?? ""; } catch { return ""; } });
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authNickname, setAuthNickname] = useState("");
  const [authError, setAuthError] = useState("");
  const [needNickname, setNeedNickname] = useState(false);
  const [editingNickname, setEditingNickname] = useState(false);
  const [editNicknameValue, setEditNicknameValue] = useState("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [cloudConflict, setCloudConflict] = useState<ArtisticProfile | null>(null);
  const [editingRankIdx, setEditingRankIdx] = useState<number | null>(null);
  const [editingRankTitle, setEditingRankTitle] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>(readNotes);
  const [noteModal, setNoteModal] = useState<{ key: string; title: string; kind: MediaKind; posterUrls?: readonly string[] } | null>(null);
  const [noteDraft, setNoteDraft] = useState("");
  const [ringsLayout, setRingsLayout] = useState<"row" | "col">(() => { try { return (localStorage.getItem("art-rank:rings-layout") as "row" | "col") || "row"; } catch { return "row"; } });
  const [detailWork, setDetailWork] = useState<{ work: RankedArtwork; kind: MediaKind; data: Record<string, unknown> | null; loading: boolean } | null>(null);
  const [peerUrl, setPeerUrl] = useState("");
  const [peerUrlBusy, setPeerUrlBusy] = useState(false);
  const [sharePeer, setSharePeer] = useState<ArtisticProfile | null>(null);
  const [showGuide, setShowGuide] = useState(() => { try { return !localStorage.getItem("art-rank:guide-dismissed"); } catch { return true; } });
  const [showTech, setShowTech] = useState(false);
  const [plazaPostId, setPlazaPostId] = useState<number>(0);
  const [reorderMode, setReorderMode] = useState<number | null>(null);
  const [reorderItems, setReorderItems] = useState<RankedArtwork[]>([]);
  const syncTimer = useRef<number | null>(null);
  const syncing = useRef(false);

  const comparison = ranking ? getCurrentComparison(ranking) : null;
  const progress = ranking ? getRankingProgress(ranking) : null;
  const worksById = useMemo(() => new Map(collection?.works.map((work) => [work.id, work]) ?? []), [collection]);
  const collections = getCollectionsByKind(kind).filter((item) => [item.title, item.description, ...item.works.map((work) => work.title)].join(" ").toLowerCase().includes(search.toLowerCase()));
  const activeRanking = profile?.rankings.find((entry, idx) => `${entry.kind}-${idx}` === activeKind) ?? profile?.rankings[0];

  function navigateTo(nextViewOrPlaza: View | string) {
    const nextView = (typeof nextViewOrPlaza === "string" && nextViewOrPlaza.startsWith("plazaPost:"))
      ? "plazaPost" as View
      : nextViewOrPlaza as View;
    if (nextView === "plazaPost" && typeof nextViewOrPlaza === "string") {
      const id = Number(nextViewOrPlaza.split(":")[1]) || 0;
      setPlazaPostId(id);
      setView("plazaPost");
      const lang = new URLSearchParams(location.search).get("lang");
      const qs = lang ? `?lang=${lang}` : "";
      history.pushState({ view: "plazaPost" }, "", `/plaza/${id}${qs}`);
      return;
    }
    setView(nextView);
    const lang = new URLSearchParams(location.search).get("lang");
    const qs = lang ? `?lang=${lang}` : "";
    history.pushState({ view: nextView }, "", VIEW_PATH[nextView] + qs);
  }
  function openNoteModal(key: string, title: string, kind: MediaKind, posterUrls?: readonly string[]) {
    setNoteModal({ key, title, kind, posterUrls });
    setNoteDraft(notes[key] ?? "");
  }
  function saveNote() {
    if (!noteModal) return;
    const next = setNote(notes, noteModal.key, noteDraft);
    setNotes(next);
    writeNotes(next);
    setNoteModal(null);
  }
  function persist(next: ArtisticProfile) {
    setProfile(next); setProfileName(next.profileName); setShareUrl(""); setQrUrl("");
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(next)); writeNotes(notes); }
    catch { setNotice(t("浏览器无法保存，请及时导出画像。", "Browser storage is unavailable. Export your profile to keep it.")); }
  }
  function acceptPeer(next: ArtisticProfile) {
    setPeer(next); setActiveKind(next.rankings[0].kind); setCompareActiveKind(next.rankings[0].kind); navigateTo("compare");
    try { localStorage.setItem(PEER_KEY, JSON.stringify(next)); } catch { /* Keep the in-memory copy. */ }
  }
  useEffect(() => {
    track("visit", { lang: locale, app_version: "2.0.0" });
    const payload = new URLSearchParams(location.hash.slice(1)).get("profile") ?? new URLSearchParams(location.search).get("payload");
    if (payload) {
      if (/^[0-9a-f]{8}$/i.test(payload)) {
        // Short code — fetch from server
        fetch(`/api/share/${payload}`).then(async (r) => { if (!r.ok) throw new Error(); const d = await r.json() as { profile: unknown }; acceptPeer(parseProfile(d.profile)); }).catch(() => setNotice(t("比较链接无效或已过期。", "Compare link is invalid or expired.")));
      } else {
        // Base64-encoded profile
        decode(payload).then(acceptPeer).catch(() => setNotice(t("比较链接无效或过大，请导入 JSON 文件。", "Invalid or oversized link. Import the JSON file instead.")));
      }
    }
    void fetch("/api/auth/config").then((response) => response.json()).then((data: { enabled?: boolean }) => setAccountEnabled(Boolean(data.enabled))).catch(() => undefined);

    // Handle OAuth callback
    const params = new URLSearchParams(location.search);
    const oauthToken = params.get("oauth_token");
    const oauthEmail = params.get("oauth_email");
    const oauthName = params.get("oauth_name");
    const oauthError = params.get("account");
    if (oauthToken && oauthEmail) {
      setAccountToken(oauthToken);
      setAccountEmail(decodeURIComponent(oauthEmail));
      const name = oauthName ? decodeURIComponent(oauthName) : "";
      setAccountNickname(name);
      try { localStorage.setItem("art-rank:account-token", oauthToken); } catch {}
      history.replaceState(null, "", location.pathname);
      if (!name || name === decodeURIComponent(oauthEmail).split("@")[0]) {
        setNeedNickname(true);
        setAccountOpen(true);
      }
      setNotice(t("登录成功！", "Signed in!"));
      // Restore notes from cloud after OAuth login
      setTimeout(async () => {
        try {
          const r = await fetch("/api/account/profile", { headers: { authorization: `Bearer ${oauthToken}` } });
          if (!r.ok) return;
          const d = await r.json() as { notes?: Record<string, string> };
          if (d.notes && typeof d.notes === "object") {
            const localNotes = readNotes();
            const merged = { ...localNotes, ...d.notes };
            setNotes(merged);
            writeNotes(merged);
          }
        } catch {}
      }, 100);
    } else if (oauthError === "error") {
      setNotice(t("登录失败：" + (params.get("msg") ?? "未知错误"), "Sign in failed: " + (params.get("msg") ?? "Unknown error")));
      history.replaceState(null, "", location.pathname);
    }

    // Handle /share/:code path — fetch shared profile
    if (location.pathname.startsWith("/share/")) {
      const code = location.pathname.split("/share/")[1]?.replace(/\/+$/, "");
      if (code) {
        if (/^[0-9a-f]{8}$/i.test(code)) {
          // Short code — fetch from server
          fetch(`/api/share/${code}`).then(async (r) => {
            if (!r.ok) throw new Error();
            const d = await r.json() as { profile: unknown; notes?: Record<string, string> };
            setSharePeer(parseProfile(d.profile));
            if (d.notes && typeof d.notes === "object") {
              const merged = { ...readNotes(), ...d.notes };
              setNotes(merged);
            }
            setView("share");
          }).catch(() => setNotice(t("分享链接无效或已过期。", "Share link is invalid or expired.")));
        } else {
          // Base64 payload in path
          decode(code).then((p) => {
            setSharePeer(p);
            setView("share");
          }).catch(() => setNotice(t("分享链接无效或过大。", "Share link is invalid or too large.")));
        }
      }
    }

    // Restore view from URL path (after peer/profile handlers which take priority)
    const initialView = pathToView(location.pathname);
    if (initialView) {
      setView(initialView);
      if (initialView === "plazaPost") {
        const match = location.pathname.match(/^\/plaza\/(\d+)/);
        if (match) setPlazaPostId(Number(match[1]));
      }
    }

    // Restore session
    const savedToken = oauthToken || accountToken;
    if (savedToken) {
      void fetch("/api/account/profile", { headers: { authorization: `Bearer ${savedToken}` } })
        .then((r) => r.ok ? r.json() : null)
        .then((data: { email?: string; nickname?: string; profile?: unknown; notes?: Record<string, string> } | null) => {
          if (data?.email) {
            setAccountEmail(data.email);
            setAccountNickname(data.nickname ?? data.email.split("@")[0]);
            // Restore notes from cloud on session restore
            if (data.notes && typeof data.notes === "object") {
              const localNotes = readNotes();
              const merged = { ...localNotes, ...data.notes };
              setNotes(merged);
              writeNotes(merged);
            }
          }
          else if (!oauthToken) { setAccountToken(""); try { localStorage.removeItem("art-rank:account-token"); } catch {} }
        }).catch(() => {});
    }
  }, []);
  useEffect(() => { document.documentElement.lang = locale === "zh" ? "zh-CN" : "en"; }, [locale]);
  useEffect(() => { window.scrollTo(0, 0); }, [view]);
  useEffect(() => {
    function onPopState() {
      const v = pathToView(location.pathname);
      if (v) {
        setView(v);
        if (v === "plazaPost") {
          const match = location.pathname.match(/^\/plaza\/(\d+)/);
          if (match) setPlazaPostId(Number(match[1]));
        }
      } else setView("home");
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);
  useEffect(() => { setEditingRankIdx(null); setEditingRankTitle(""); setReorderMode(null); setReorderItems([]); }, [view]);
  useEffect(() => { if (!notice) return; const timer = setTimeout(() => setNotice(""), 4000); return () => clearTimeout(timer); }, [notice]);
  useEffect(() => {
    if (view !== "sorting" || !ranking || !collection) return;
    const next = { collection, ranking: serializeRankingState(ranking), profileName };
    setDraft(next);
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(next)); } catch { setNotice(t("进度无法写入浏览器存储。", "Progress could not be saved in this browser.")); }
  }, [ranking, collection, view, profileName]);
  useEffect(() => {
    if (!accountToken || !profile) return;
    if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => { void syncProfile(false); }, 900);
    return () => { if (syncTimer.current !== null) window.clearTimeout(syncTimer.current); };
  }, [profile, accountToken]);
  useEffect(() => {
    const flush = () => { if (accountToken && profile) void syncProfile(true); };
    const online = () => { if (accountToken && profile) void syncProfile(false); };
    const visibility = () => { if (document.visibilityState === "hidden") flush(); };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    return () => { window.removeEventListener("pagehide", flush); document.removeEventListener("visibilitychange", visibility); window.removeEventListener("online", online); };
  }, [accountToken, profile]);
  useEffect(() => { void loadCloudCollections(); }, [accountToken]);
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (view !== "sorting" || !comparison || event.repeat || accountOpen || (event.target instanceof HTMLElement && event.target.closest("input,textarea,select,[contenteditable=true]"))) return;
      const key = event.key.toLowerCase();
      if (["a", "1", "arrowleft", "d", "2", "arrowright"].includes(key)) {
        event.preventDefault(); act(["a", "1", "arrowleft"].includes(key) ? "left" : "right");
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  });

  function chooseKind(next: MediaKind) { setKind(next); setSource("builtin"); setSearch(""); setCustomText(""); navigateTo("source"); }
  function addCustomItem() {
    const value = customItem.trim(); if (!value) return;
    setCustomText((current) => current.trim() ? `${current.trim()}\n${value}` : value); setCustomItem("");
  }
  async function saveCollectionCloud(collectionToSave: MediaCollection) {
    if (!accountToken) return;
    try {
      const response = await fetch("/api/account/collections", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accountToken}` }, body: JSON.stringify({ kind: collectionToSave.kind, title: collectionToSave.title, description: collectionToSave.description, items: collectionToSave.works }) });
      if (response.ok) void loadCloudCollections();
    } catch { /* Local collection remains usable. */ }
  }
  async function loadCloudCollections() {
    if (!accountToken) { setCloudCollections([]); return; }
    try {
      const response = await fetch("/api/account/collections", { headers: { authorization: `Bearer ${accountToken}` } });
      const data = response.ok ? await response.json() as { collections?: Array<{ id: number; kind: MediaKind; title: string; description: string; items: MediaCollection["works"] }> } : null;
      setCloudCollections((data?.collections ?? []).map((item) => ({ remoteId: item.id, id: `cloud-${item.id}`, kind: item.kind, source: "custom", title: item.title, description: item.description, topN: Math.min(10, item.items.length), works: item.items })));
    } catch { setCloudCollections([]); }
  }
  async function deleteCloudCollection(item: MediaCollection & { remoteId: number }) {
    if (!accountToken) return;
    try {
      const response = await fetch(`/api/account/collections/${item.remoteId}`, { method: "DELETE", headers: { authorization: `Bearer ${accountToken}` } });
      if (!response.ok) throw new Error();
      setCloudCollections((current) => current.filter((entry) => entry.remoteId !== item.remoteId));
      setNotice(t("云端清单已移除。", "Cloud list removed."));
    } catch { setNotice(t("无法移除云端清单，请稍后重试。", "Could not remove the cloud list. Please retry.")); }
  }
  function changeCols(n: number) { setColCount(n); try { localStorage.setItem("art-rank:cols", String(n)); } catch {} }
  function renameRank(idx: number) {
    if (!profile || !editingRankTitle.trim()) return;
    const next = renameRanking(profile, idx, editingRankTitle.trim());
    persist(next); setEditingRankIdx(null); setEditingRankTitle("");
  }
  function deleteRank(idx: number) {
    if (!profile) return;
    const next = deleteRanking(profile, idx);
    if (next) persist(next);
    else { setProfile(null); try { localStorage.removeItem(LIBRARY_KEY); } catch {} }
    setEditingRankIdx(null);
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
    setProfile(null); setDraft(null); setPeer(null);
    try { localStorage.removeItem(LIBRARY_KEY); localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(PEER_KEY); } catch {}
    setNotice(t("本地数据已清除。", "Local data cleared."));
  }
  function openCollection(next: MediaCollection) {
    setKind(next.kind); setCollection(next); setSelected(next.works.map((work) => work.id)); setTopN(next.topN); setRanking(null); navigateTo("setup");
  }
  async function loadDouban() {
    setBusy(true); setNotice("");
    try {
      const isBook = kind === "book";
      const isMusic = kind === "music";
      const endpoint = isBook ? `/api/douban/books/top250?limit=${doubanLimit}` : isMusic ? `/api/douban/music/top250?limit=${doubanLimit}` : `/api/douban/top250?limit=${doubanLimit}`;
      const response = await fetch(endpoint, { signal: AbortSignal.timeout(60000) });
      const data = await response.json() as { works?: Array<{ id: string; title: string; year?: number; poster_url?: string }> };
      if (!response.ok || !data.works || data.works.length < 2) throw new Error();
      const title = isBook ? `豆瓣读书 Top ${doubanLimit}` : isMusic ? `豆瓣音乐 Top ${doubanLimit}` : `豆瓣 Top ${doubanLimit}`;
      openCollection({ id: `douban-${isBook ? 'book-' : isMusic ? 'music-' : ''}top${doubanLimit}`, kind: kind, source: "douban", title, description: "", topN: 10, works: data.works.map((work) => ({ ...work, posterUrls: work.poster_url ? [work.poster_url] : [] })) });
    } catch { setNotice(t("豆瓣暂时无法访问，可以重试或选择内置榜单。", "Douban is unavailable. Retry or choose a built-in collection.")); }
    finally { setBusy(false); }
  }
  function startRanking() {
    if (!collection || selected.length < 2) return;
    const works = collection.works.filter((work) => selected.includes(work.id));
    const next = createRankingState(works.map((work) => work.id), { topN, seed: seed.trim() || crypto.randomUUID() });
    setCollection({ ...collection, works }); setRanking(next); navigateTo("sorting"); setNotice("");
    track("sorting_started", { mode: kind, item_count: works.length, top_k: next.topN });
  }
  function act(action: "left" | "right" | "undo" | "skip-left" | "skip-right" | "defer-left" | "defer-right") {
    if (!ranking || !collection || (ranking.completed && action !== "undo")) return;
    let next: RankingState;
    if (action === "undo") next = undoLastAction(ranking);
    else if (action === "skip-left") next = skipWork(ranking, comparison!.leftId);
    else if (action === "skip-right") next = skipWork(ranking, comparison!.rightId);
    else if (action === "defer-left") next = deferWork(ranking, comparison!.leftId);
    else if (action === "defer-right") next = deferWork(ranking, comparison!.rightId);
    else next = chooseSide(ranking, action);
    setRanking(next);
    if (next.completed) {
      const result: RankingExport = {
        version: 1, profileId: crypto.randomUUID(), profileName: profileName.trim() || t("我的艺术人格", "My artistic profile"), kind: collection.kind,
        collectionTitle: collection.title, createdAt: new Date().toISOString(),
        items: getRankingResult(next).map((id, index) => ({ ...worksById.get(id)!, rank: index + 1 })),
      };
      persist(mergeRanking(profile, result)); setActiveKind(result.kind); setDraft(null);
      try { localStorage.removeItem(DRAFT_KEY); } catch { /* Progress already exists in memory. */ }
      navigateTo(peer && collection.id.startsWith("peer-") ? "compare" : "profile");
      track("ranking_completed", { mode: kind, item_count: next.sourceIds.length, top_k: next.topN, comparison_count: next.comparisonCount });
    }
  }
  function resume() {
    if (!draft) return;
    try { setCollection(draft.collection); setKind(draft.collection.kind); setRanking(deserializeRankingState(draft.ranking)); setProfileName(draft.profileName); navigateTo("sorting"); }
    catch { setNotice(t("草稿无法读取。", "The draft could not be restored.")); }
  }
  async function openArtworkDetail(work: RankedArtwork, detailKind: MediaKind) {
    setDetailWork({ work, kind: detailKind, data: null, loading: true });
    if (detailKind === "other") { setDetailWork({ work, kind: detailKind, data: null, loading: false }); return; }
    try {
      const apiType = detailKind === "film" ? "movie" : detailKind;
      const response = await fetch(`/api/${apiType}/detail?name=${encodeURIComponent(work.title)}`, { signal: AbortSignal.timeout(20000) });
      const payload = await response.json() as { data?: Record<string, unknown> | null };
      setDetailWork({ work, kind: detailKind, data: payload.data ?? null, loading: false });
    } catch { setDetailWork({ work, kind: detailKind, data: null, loading: false }); }
  }
  async function requestInsight() {
    if (!profile || !peer || !crossProfileSummary(profile, peer)) return;
    setAiBusy(true);
    try {
      const response = await fetch("/api/insights", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ summary: crossProfileSummary(profile, peer) }) });
      const data = await response.json() as { insight?: string };
      if (response.ok && data.insight) setAiInsight(data.insight); else setNotice(t("AI 解读暂不可用。", "AI insights are not available."));
    } catch { setNotice(t("AI 解读暂不可用。", "AI insights are not available.")); }
    finally { setAiBusy(false); }
  }
  async function importProfile(file: File, target: "own" | "peer") {
    try {
      if (file.size > MAX_PROFILE_BYTES) throw new Error();
      const imported = parseProfile(JSON.parse(await file.text()));
      if (target === "peer") acceptPeer(imported);
      else {
        let next = profile;
        for (const item of imported.rankings) next = mergeRanking(next, { ...item, profileName: imported.profileName });
        if (next) persist(next);
        setActiveKind(imported.rankings[0].kind); navigateTo(peer ? "compare" : "profile");
      }
      setNotice("");
    } catch { setNotice(t("文件格式不正确，请使用有效的画像 JSON（最大 512 KB）。", "Invalid profile JSON (maximum 512 KB).")); }
  }
  function namedProfile(): ArtisticProfile | null {
    if (!profile) return null;
    const name = profileName.trim() || t("我的艺术人格", "My artistic profile");
    return { ...profile, profileName: name, rankings: profile.rankings.map((entry) => ({ ...entry, profileName: name })) };
  }
  async function exportProfile() {
    const next = namedProfile(); if (!next) return;
    persist(next);
    if (format === "png") {
      await exportProfilePng(next);
    } else saveFile(format === "json" ? JSON.stringify({ ...next, notes }, null, 2) : profileText(next, format, notes), `art-profile.${format}`, format === "json" ? "application/json" : "text/plain;charset=utf-8");
  }
  async function exportProfilePng(next: ArtisticProfile) {
    await document.fonts.ready;
    const canvas = document.createElement("canvas"); const width = 1200; const margin = 72;
    const imageCache = new Map<string, HTMLImageElement>();
    const imageUrl = (url: string) => { try { const parsed = new URL(url, location.origin); return parsed.hostname.endsWith("doubanio.com") ? `/api/image?url=${encodeURIComponent(parsed.toString())}` : parsed.toString(); } catch { return url; } };
    const loadImage = async (work: { posterUrls?: readonly string[] }) => {
      const source = work.posterUrls?.[0]; if (!source) return null; const cached = imageCache.get(source); if (cached) return cached;
      return await new Promise<HTMLImageElement | null>((resolve) => { const image = new Image(); image.crossOrigin = "anonymous"; image.onload = () => { imageCache.set(source, image); resolve(image); }; image.onerror = () => resolve(null); image.src = imageUrl(source); });
    };
    const allItems = next.rankings.flatMap((entry) => entry.items);
    await Promise.all(allItems.map((item) => loadImage(item)));
    const rowHeight = exportLayout === "collage" ? 300 : 84;
    const contentHeight = exportLayout === "minimal" ? next.rankings.reduce((sum, entry) => sum + 80 + entry.items.length * 44, 0) : next.rankings.reduce((sum, entry) => sum + 100 + Math.ceil(entry.items.length / (exportLayout === "collage" ? 5 : 1)) * rowHeight, 0);
    canvas.width = width; canvas.height = Math.max(720, 280 + contentHeight);
    const ctx = canvas.getContext("2d"); if (!ctx) return;
    ctx.fillStyle = "#050806"; ctx.fillRect(0, 0, width, canvas.height);
    ctx.fillStyle = "#79d9ae"; ctx.font = "600 24px Arial"; ctx.fillText("ART/RANK", margin, 76);
    ctx.fillStyle = "#eef4ed"; ctx.font = "600 52px Arial"; ctx.fillText(next.profileName, margin, 150, width - margin * 2);
    ctx.fillStyle = "#8ca296"; ctx.font = "16px Arial"; ctx.fillText(`${t("个人文化索引", "PERSONAL CULTURE INDEX")}  /  ${new Date().toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US")}`, margin, 192);
    const drawImage = (image: HTMLImageElement | null, x: number, y: number, w: number, h: number) => { ctx.save(); ctx.beginPath(); ctx.rect(x, y, w, h); ctx.clip(); if (image) { const scale = Math.max(w / image.width, h / image.height); const dw = image.width * scale; const dh = image.height * scale; ctx.drawImage(image, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); } else { ctx.fillStyle = "#1f3029"; ctx.fillRect(x, y, w, h); ctx.fillStyle = "#79d9ae"; ctx.font = "14px Arial"; ctx.fillText("NO COVER", x + 12, y + h / 2); } ctx.restore(); };
    let cursor = 250;
    for (const entry of next.rankings) {
      ctx.fillStyle = "#79d9ae"; ctx.font = "600 14px Arial"; ctx.fillText(label(entry.kind).toUpperCase(), margin, cursor); ctx.fillStyle = "#d8e2d9"; ctx.font = "22px Arial"; ctx.fillText(entry.collectionTitle, margin + 100, cursor);
      cursor += 28;
      if (exportLayout === "minimal") {
        entry.items.forEach((item) => { ctx.fillStyle = item.rank === 1 ? "#d8f86a" : "#dce7df"; ctx.font = `${item.rank === 1 ? "600" : "400"} 20px Arial`; ctx.fillText(`${String(item.rank).padStart(2, "0")}  ${item.title}`, margin, cursor); cursor += 44; });
      } else if (exportLayout === "collage") {
        const tileW = 188; const tileH = 248; const gap = 18;
        entry.items.forEach((item, index) => { const col = index % 5; const row = Math.floor(index / 5); const x = margin + col * (tileW + gap); const y = cursor + row * (tileH + 50); const image = imageCache.get(item.posterUrls?.[0] ?? "") ?? null; drawImage(image, x, y, tileW, tileH); ctx.fillStyle = "#dce7df"; ctx.font = "14px Arial"; ctx.fillText(`${String(item.rank).padStart(2, "0")}  ${item.title}`.slice(0, 24), x, y + tileH + 24); }); cursor += Math.ceil(entry.items.length / 5) * (tileH + 50) + 28;
      } else {
        entry.items.forEach((item) => { const y = cursor; drawImage(imageCache.get(item.posterUrls?.[0] ?? "") ?? null, margin, y - 17, 44, 64); ctx.fillStyle = item.rank === 1 ? "#d8f86a" : "#dce7df"; ctx.font = `${item.rank === 1 ? "600" : "400"} 20px Arial`; ctx.fillText(`${String(item.rank).padStart(2, "0")}  ${item.title}`, margin + 62, y + 18, width - margin * 2 - 62); cursor += 84; }); cursor += 22;
      }
    }
    ctx.fillStyle = "#43584b"; ctx.font = "13px Arial"; ctx.fillText(t("偏好没有标准答案", "PREFERENCE HAS NO ANSWER KEY"), margin, canvas.height - 34);
    await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    canvas.toBlob((blob) => { if (blob) saveFile(blob, `art-profile-${exportLayout}.png`, "image/png"); });
  }
  async function shareSingleRanking(ranking: RankingExport) {
    const name = profileName.trim() || t("我的艺术人格", "My artistic profile");
    const singleProfile: ArtisticProfile = { version: 2, profileId: crypto.randomUUID(), profileName: name, updatedAt: new Date().toISOString(), rankings: [{ ...ranking, profileName: name }] };
    try { parseProfile(singleProfile); } catch { setNotice(t("数据格式错误。", "Invalid profile data.")); return; }
    const hasAnyNotes = Object.keys(notes).length > 0;
    const shareData: Record<string, unknown> = { profile: singleProfile };
    if (hasAnyNotes) shareData.notes = notes;
    setBusy(true);
    try {
      const response = await fetch("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(shareData) });
      const data = await response.json() as { url?: string; error?: string };
      if (response.ok && data.url) {
        try { await navigator.clipboard.writeText(data.url); setNotice(t("榜单链接已复制。", "Ranking link copied.")); }
        catch { setNotice(t("链接已生成：" + data.url, "Link ready: " + data.url)); }
      } else { setNotice(t("生成链接失败，请导出 JSON 分享。", "Failed to create link. Export the JSON instead.")); }
    } catch { setNotice(t("生成链接失败，请导出 JSON 分享。", "Failed to create link. Export the JSON instead.")); }
    finally { setBusy(false); }
  }
  async function publishToPlaza(ranking: RankingExport, description?: string) {
    if (!accountToken) { setNotice(t("请先登录。", "Please sign in first.")); return; }
    const rankingNotes: Record<string, string> = {};
    for (const [key, val] of Object.entries(notes)) {
      if (key.startsWith(`work:${ranking.kind}:`) || key === `ranking:${ranking.kind}:${ranking.collectionTitle}`) rankingNotes[key] = val;
    }
    setBusy(true);
    try {
      const response = await fetch("/api/plaza/posts", { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${accountToken}` }, body: JSON.stringify({ post_type: "ranking", kind: ranking.kind, collection_title: ranking.collectionTitle, description: description?.trim() || null, items: ranking.items, notes: Object.keys(rankingNotes).length > 0 ? rankingNotes : null, item_count: ranking.items.length }) });
      const data = await response.json() as { id?: number; error?: string };
      if (response.ok && data.id) setNotice(t("已发布到广场！", "Published to plaza!"));
      else setNotice(t("发布失败。", "Publish failed."));
    } catch { setNotice(t("发布失败，请重试。", "Publish failed, please retry.")); }
    finally { setBusy(false); }
  }
  async function share() {
    const next = namedProfile(); if (!next) return;
    try { parseProfile(next); } catch { setNotice(t("数据格式错误。", "Invalid profile data.")); return; }
    persist(next);
    const hasAnyNotes = Object.keys(notes).length > 0;
    const shareData: Record<string, unknown> = { profile: next };
    if (hasAnyNotes) shareData.notes = notes;
    setBusy(true);
    try {
      const response = await fetch("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(shareData) });
      const data = await response.json() as { url?: string; compareUrl?: string; error?: string };
      if (response.ok && data.compareUrl) {
        setShareUrl(data.compareUrl);
        try { const QRCode = await import("qrcode"); setQrUrl(await QRCode.default.toDataURL(data.compareUrl, { width: 240, margin: 2, errorCorrectionLevel: "L" })); } catch { setQrUrl(""); }
        try { await navigator.clipboard.writeText(data.compareUrl); setNotice(t("比较链接已复制。", "Comparison link copied.")); }
        catch { setNotice(t("链接已生成，可在下方选中复制。", "Link ready. Select and copy it below.")); }
      } else {
        setNotice(t("生成链接失败，请导出 JSON 分享。", "Failed to create link. Export the JSON instead."));
      }
    } catch { setNotice(t("生成链接失败，请导出 JSON 分享。", "Failed to create link. Export the JSON instead.")); }
    finally { setBusy(false); }
  }
  async function generateShareLink(ranking?: RankingExport) {
    const profileData = ranking
      ? { version: 2 as const, profileId: crypto.randomUUID(), profileName: profileName.trim() || t("我的艺术人格", "My artistic profile"), updatedAt: new Date().toISOString(), rankings: [{ ...ranking, profileName: profileName.trim() || t("我的艺术人格", "My artistic profile") }] }
      : namedProfile();
    if (!profileData) return;
    try { parseProfile(profileData); } catch { setNotice(t("数据格式错误。", "Invalid profile data.")); return; }
    const shareData: Record<string, unknown> = { profile: profileData };
    if (Object.keys(notes).length > 0) shareData.notes = notes;
    setBusy(true);
    try {
      const response = await fetch("/api/share", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(shareData) });
      const data = await response.json() as { url?: string; error?: string };
      if (response.ok && data.url) {
        try { await navigator.clipboard.writeText(data.url); setNotice(t("分享链接已复制，打开即可查看榜单。", "Share link copied. Open it to view the ranking.")); }
        catch { setNotice(t("链接已生成：" + data.url, "Link ready: " + data.url)); }
      } else { setNotice(t("生成链接失败。", "Failed to create link.")); }
    } catch { setNotice(t("生成链接失败。", "Failed to create link.")); }
    finally { setBusy(false); }
  }
  async function accountLoad(autoApply: boolean) {
    if (!accountToken) return;
    setBusy(true);
    try {
      const response = await fetch("/api/account/profile", { headers: { authorization: `Bearer ${accountToken}` } });
      if (!response.ok) throw new Error();
      const data = await response.json() as { email: string; nickname?: string; profile: unknown; notes?: Record<string, string> };
      if (data.email) setAccountEmail(data.email);
      if (data.nickname) setAccountNickname(data.nickname);
      if (data.profile) {
        const parsed = parseProfile(data.profile);
        if (autoApply && !profile) { persist(parsed); setNotice(t("已从云端恢复画像。", "Profile restored from cloud.")); }
        else if (!autoApply) { persist(parsed); setNotice(t("已从云端同步画像。", "Profile synced from cloud.")); }
      }
      if (data.notes && typeof data.notes === "object") {
        const merged = { ...notes, ...data.notes };
        setNotes(merged);
        writeNotes(merged);
      }
    } catch { if (!autoApply) setNotice(t("读取失败，请重新登录。", "Failed to load. Please sign in again.")); }
    finally { setBusy(false); }
  }
  async function accountSave() {
    if (!accountToken) { setNotice(t("请先登录。", "Please sign in first.")); return; }
    const next = namedProfile(); if (!next) return;
    setBusy(true);
    try {
      const hasAnyNotes = Object.keys(notes).length > 0;
      const response = await fetch("/api/account/profile", { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${accountToken}` }, body: JSON.stringify({ profile: next, ...(hasAnyNotes ? { notes } : {}) }) });
      if (!response.ok) throw new Error();
      persist(next); setSyncStatus("saved"); setNotice(t("画像已保存到云端。", "Profile saved to cloud."));
    } catch { setNotice(t("同步失败，本地画像仍然保留。", "Sync failed. Your local profile is still available.")); }
    finally { setBusy(false); }
  }
  async function syncProfile(keepalive: boolean) {
    if (!accountToken || !profile || syncing.current) return;
    const next = namedProfile(); if (!next) return;
    syncing.current = true;
    setSyncStatus("saving");
    try {
      const hasAnyNotes = Object.keys(notes).length > 0;
      const ok = (await fetch("/api/account/profile", { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${accountToken}` }, body: JSON.stringify({ profile: next, ...(hasAnyNotes ? { notes } : {}) }), keepalive })).ok;
      setSyncStatus(ok ? "saved" : "error");
    } catch { setSyncStatus("error"); }
    finally { syncing.current = false; }
  }
  async function accountAuth(mode: "login" | "register") {
    setAuthError(""); setBusy(true);
    try {
      if (mode === "register" && !authNickname.trim()) { setAuthError(t("请填写昵称", "Please enter a nickname")); setBusy(false); return; }
      const response = await fetch(`/api/account/${mode}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email: authEmail, password: authPassword, nickname: authNickname || undefined }) });
      const data = await response.json() as { token?: string; email?: string; nickname?: string; error?: string; msg?: string };
      if (!response.ok || !data.token) { setAuthError(data.msg ?? data.error ?? t("操作失败", "Failed")); return; }
      setAccountToken(data.token); setAccountEmail(data.email ?? authEmail); setAccountNickname(data.nickname ?? ""); setAuthEmail(""); setAuthPassword(""); setAuthNickname("");
      try { localStorage.setItem("art-rank:account-token", data.token); } catch {}
      setNotice(t("登录成功！", "Signed in!"));
      // Auto-load cloud profile + notes after login, detect conflicts
      const freshToken = data.token;
      setTimeout(async () => {
        try {
          const r = await fetch("/api/account/profile", { headers: { authorization: `Bearer ${freshToken}` } });
          if (!r.ok) return;
          const d = await r.json() as { nickname?: string; profile: unknown; notes?: Record<string, string> };
          if (d.nickname) setAccountNickname(d.nickname);
          // Restore notes from cloud
          if (d.notes && typeof d.notes === "object") {
            const localNotes = readNotes();
            const merged = { ...localNotes, ...d.notes };
            setNotes(merged);
            writeNotes(merged);
          }
          if (d.profile) {
            const cloudParsed = parseProfile(d.profile);
            if (profile) { setCloudConflict(cloudParsed); } // both local & cloud → show conflict dialog
            else { persist(cloudParsed); setNotice(t("已从云端恢复画像和批注。", "Profile and notes restored from cloud.")); }
          }
        } catch {}
      }, 100);
    } catch { setAuthError(t("网络错误", "Network error")); }
    finally { setBusy(false); }
  }
  async function saveNickname() {
    const name = editingNickname ? editNicknameValue.trim() : authNickname.trim();
    if (!name || !accountToken) return;
    setBusy(true);
    try {
      const response = await fetch("/api/account/nickname", { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${accountToken}` }, body: JSON.stringify({ nickname: name }) });
      if (response.ok) { setAccountNickname(name); setNeedNickname(false); setEditingNickname(false); setAuthNickname(""); setEditNicknameValue(""); setNotice(t("昵称已更新！", "Nickname updated!")); }
    } catch {}
    finally { setBusy(false); }
  }
  async function accountLogout() {
    if (accountToken) {
      // 先同步画像和批注到云端
      const next = namedProfile();
      if (next) {
        try {
          const hasAnyNotes = Object.keys(notes).length > 0;
          await fetch("/api/account/profile", { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${accountToken}` }, body: JSON.stringify({ profile: next, ...(hasAnyNotes ? { notes } : {}) }), keepalive: true });
        } catch { /* best-effort */ }
      }
      void fetch("/api/account/logout", { method: "POST", headers: { authorization: `Bearer ${accountToken}` } }).catch(() => {});
    }
    // 清除本地数据
    setAccountToken(""); setAccountEmail(""); setAccountNickname(""); setEditingNickname(false); setSyncStatus("idle"); setCloudConflict(null);
    setProfile(null); setNotes({}); setPeer(null); setDraft(null);
    try { localStorage.removeItem("art-rank:account-token"); localStorage.removeItem(LIBRARY_KEY); localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(PEER_KEY); localStorage.removeItem("art-rank:notes"); } catch {}
  }
  function createFromPeer(nextKind: MediaKind) {
    const entry = peer?.rankings.find((item) => item.kind === nextKind);
    if (!entry || entry.items.length < 2) { chooseKind(nextKind); return; }
    openCollection({ id: `peer-${entry.profileId}`, kind: nextKind, source: "custom", title: entry.collectionTitle, description: "", topN: entry.items.length, works: entry.items });
  }
  async function importPeerFromUrl() {
    const url = peerUrl.trim(); if (!url) return;
    setPeerUrlBusy(true);
    try {
      const parsed = new URL(url, location.origin);
      const payload = parsed.searchParams.get("payload") ?? new URLSearchParams(parsed.hash.slice(1)).get("profile");
      if (payload) {
        // Check if it's a short code (8 hex chars) or base64-encoded profile
        if (/^[0-9a-f]{8}$/i.test(payload)) {
          const r = await fetch(`/api/share/${payload}`); if (!r.ok) throw new Error();
          const d = await r.json() as { profile: unknown }; acceptPeer(parseProfile(d.profile));
        } else { acceptPeer(await decode(payload)); }
        setPeerUrl(""); return;
      }
      const r = await fetch(url); if (!r.ok) throw new Error();
      acceptPeer(parseProfile(await r.json())); setPeerUrl("");
    } catch { setNotice(t("链接无效或无法读取，请检查 URL。", "Invalid or unreachable URL.")); }
    finally { setPeerUrlBusy(false); }
  }


  let content: ReactNode;
  if (view === "home") content = <HomeView locale={locale} t={t} accountEmail={accountEmail} setAccountOpen={setAccountOpen} setShowGuide={setShowGuide} kind={kind} chooseKind={chooseKind} navigateTo={navigateTo} draft={draft} resume={resume} profile={profile} label={label} setRingsLayout={setRingsLayout} ringsLayout={ringsLayout} clearAllData={clearAllData} editingRankIdx={editingRankIdx} setEditingRankIdx={setEditingRankIdx} editingRankTitle={editingRankTitle} setEditingRankTitle={setEditingRankTitle} renameRank={renameRank} deleteRank={deleteRank} setActiveKind={setActiveKind} openCollection={openCollection} importProfile={importProfile} />;
  else if (view === "source") content = <SourceView kind={kind} t={t} label={label} source={source} setSource={setSource} setNotice={setNotice} search={search} setSearch={setSearch} colCount={colCount} changeCols={changeCols} collections={collections} openCollection={openCollection} customItem={customItem} setCustomItem={setCustomItem} addCustomItem={addCustomItem} customText={customText} setCustomText={setCustomText} importCollection={importCollection} saveCollectionCloud={saveCollectionCloud} cloudCollections={cloudCollections} loadCloudCollections={loadCloudCollections} deleteCloudCollection={deleteCloudCollection} doubanLimit={doubanLimit} setDoubanLimit={setDoubanLimit} busy={busy} loadDouban={loadDouban} />;
  else if (view === "setup" && collection) content = <SetupView collection={collection} kind={kind} t={t} label={label} selected={selected} setSelected={setSelected} topN={topN} setTopN={setTopN} seed={seed} setSeed={setSeed} setCollection={setCollection} startRanking={startRanking} />;
  else if (view === "sorting" && collection && ranking && comparison && progress) content = <SortingView collection={collection} ranking={ranking} comparison={comparison} progress={progress} label={label} kind={kind} t={t} worksById={worksById} act={act} />;
  else if (view === "profile" && profile && activeRanking) content = <ProfileView profile={profile} activeRanking={activeRanking} locale={locale} t={t} label={label} format={format} setFormat={setFormat} exportLayout={exportLayout} setExportLayout={setExportLayout} exportProfile={exportProfile} share={share} shareUrl={shareUrl} qrUrl={qrUrl} profileName={profileName} setProfileName={setProfileName} namedProfile={namedProfile} persist={persist} navigateTo={navigateTo} peer={peer} editingRankIdx={editingRankIdx} setEditingRankIdx={setEditingRankIdx} editingRankTitle={editingRankTitle} setEditingRankTitle={setEditingRankTitle} renameRank={renameRank} openCollection={openCollection} shareSingleRanking={shareSingleRanking} generateShareLink={generateShareLink} setActiveKind={setActiveKind} ranking={ranking} setRanking={setRanking} collection={collection} notes={notes} openNoteModal={openNoteModal} accountToken={accountToken} publishToPlaza={publishToPlaza} reorderMode={reorderMode} reorderItems={reorderItems} startReorder={startReorder} saveReorder={saveReorder} cancelReorder={cancelReorder} moveItem={moveItem} />;
  else if (view === "compare") content = <CompareView kinds={kinds} profile={profile} peer={peer} compareActiveKind={compareActiveKind} setCompareActiveKind={setCompareActiveKind} compareMode={compareMode} setCompareMode={setCompareMode} manualOwnSelections={manualOwnSelections} setManualOwnSelections={setManualOwnSelections} manualPeerSelections={manualPeerSelections} setManualPeerSelections={setManualPeerSelections} compareRankings={compareRankings} mergeDimensionRankings={mergeDimensionRankings} compareDimensions={compareDimensions} compareProfiles={compareProfiles} navigateTo={navigateTo} setPeer={setPeer} setAiInsight={setAiInsight} label={label} t={t} setCompareSortBy={setCompareSortBy} compareSortBy={compareSortBy} setCompareRankDetail={setCompareRankDetail} shareSingleRanking={shareSingleRanking} exportProfile={exportProfile} setFormat={setFormat} busy={busy} namedProfile={namedProfile} setNotice={setNotice} requestInsight={requestInsight} aiBusy={aiBusy} aiInsight={aiInsight} createFromPeer={createFromPeer} setPeerRankPickOpen={setPeerRankPickOpen} openArtworkDetail={openArtworkDetail} peerUrl={peerUrl} setPeerUrl={setPeerUrl} peerUrlBusy={peerUrlBusy} importPeerFromUrl={importPeerFromUrl} importProfile={importProfile} setActiveKind={setActiveKind} notes={notes} generateShareLink={generateShareLink} />;
  else if (view === "share" && sharePeer) content = <ShareView peer={sharePeer} t={t} label={label} navigateTo={(v) => { if (v === "compare") acceptPeer(sharePeer); else navigateTo(v as View); }} openCollection={openCollection} profile={profile} notes={notes} openArtworkDetail={openArtworkDetail} />;
  else if (view === "share" && !sharePeer) content = <div className="empty-state"><p style={{ marginBottom: 12 }}>{t("正在加载分享内容…", "Loading shared content…")}</p><button className="button secondary" onClick={() => navigateTo("home")}>{t("返回首页", "Back home")}</button></div>;
  else if (view === "plaza") content = <PlazaView t={t} label={label} navigateTo={navigateTo} accountToken={accountToken} openCollection={openCollection} profile={profile} />;
  else if (view === "plazaPost") content = <PlazaPostView postId={plazaPostId} t={t} label={label} navigateTo={navigateTo} accountToken={accountToken} accountNickname={accountNickname} openCollection={openCollection} profile={profile} setNotice={setNotice} setPeer={setPeer} openArtworkDetail={openArtworkDetail} />;
  else content = <div className="empty-state"><button className="button primary" onClick={() => navigateTo("home")}>{t("返回首页", "Back home")}</button></div>;
  return <div className="app-shell"><header className="topbar"><button className="wordmark" onClick={() => navigateTo("home")}>ART<span>/</span>RANK</button><nav aria-label={t("主导航", "Main navigation")}><button className={view === "home" || view === "source" || view === "setup" || view === "sorting" ? "active" : ""} onClick={() => navigateTo("home")}>{t("清单", "Catalog")}</button><button className={view === "compare" ? "active" : ""} onClick={() => navigateTo("compare")}>{t("相遇", "Encounter")}</button><button className={view === "plaza" || view === "plazaPost" ? "active" : ""} onClick={() => navigateTo("plaza")}>{t("广场", "Plaza")}</button>{profile && <button className={view === "profile" ? "active" : ""} onClick={() => navigateTo("profile")}>{t("我的文化索引", "My Index")}</button>}</nav><div className="header-tools"><IconButton title={locale === "zh" ? "English" : "中文"} onClick={() => { const next = locale === "zh" ? "en" : "zh"; setLocale(next); const url = new URL(location.href); url.searchParams.set("lang", next); history.replaceState(null, "", url); }}><Languages size={18} /></IconButton><a className="icon-button" href="https://github.com/tripodxu/film-sort" target="_blank" rel="noopener noreferrer" title="GitHub"><Github size={18} /><span className="tooltip" role="tooltip">GitHub</span></a><IconButton title={accountEmail ? t("同步 / 退出", "Sync / Sign out") : t("登录 / 同步", "Sign in / Sync")} onClick={() => setAccountOpen(true)}><UserRound size={18} />{accountToken && <span style={{ position: "absolute", top: 4, right: 4, width: 7, height: 7, borderRadius: "50%", background: syncStatus === "saving" ? "var(--yellow)" : syncStatus === "saved" ? "var(--green)" : syncStatus === "error" ? "var(--red)" : "var(--muted)", border: "1.5px solid var(--bg)", zIndex: 1 }} />}</IconButton></div></header>
    <main className={`main view-${view}`}>{view !== "home" && <button className="back-link" onClick={() => navigateTo(view === "setup" ? "source" : "home")}><ArrowLeft size={15} />{t("回到上一层", "Back")}</button>}{content}</main><footer><span>ART/RANK</span><span>{t("偏好没有标准答案", "Preference has no answer key")}</span></footer>
    {notice && <div className="toast" role="status"><span>{notice}</span><IconButton title={t("关闭提示", "Dismiss")} onClick={() => setNotice("")}><X size={16} /></IconButton></div>}
    {cloudConflict && <div className="modal-backdrop" onClick={() => setCloudConflict(null)}><section className="account-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setCloudConflict(null); }}><div className="section-heading"><h2>{t("数据冲突", "Data conflict")}</h2><IconButton title={t("关闭", "Close")} onClick={() => setCloudConflict(null)}><X size={18} /></IconButton></div><p style={{ marginBottom: 16, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>{t("本地有游客数据，云端也有数据。请选择如何处理：", "You have local guest data and cloud data. Choose how to proceed:")}</p><div style={{ display: "flex", flexDirection: "column", gap: 8 }}><button className="button primary" onClick={() => { if (profile && cloudConflict) { const merged = mergeProfiles(cloudConflict, profile); persist(merged); setSyncStatus("saving"); fetch("/api/account/profile", { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${accountToken}` }, body: JSON.stringify({ profile: merged }) }).then((r) => { setSyncStatus(r.ok ? "saved" : "error"); if (r.ok) setNotice(t("已增量合并到云端。", "Merged to cloud.")); }).catch(() => setSyncStatus("error")); } setCloudConflict(null); }}><CloudUpload size={16} />{t("增量合并到云端", "Merge to cloud")}</button><button className="button secondary" onClick={() => { persist(cloudConflict); setCloudConflict(null); setNotice(t("已使用云端数据。", "Cloud data applied.")); }}><CloudDownload size={16} />{t("使用云端数据", "Use cloud data")}</button><button className="button quiet" onClick={() => setCloudConflict(null)}>{t("取消，各自保留", "Cancel, keep both")}</button></div></section></div>}
    {detailWork && <ArtworkDetailModal detail={detailWork} label={label} t={t} onClose={() => setDetailWork(null)} />}
    {noteModal && <div className="modal-backdrop" onClick={() => setNoteModal(null)}><section className="note-modal" role="dialog" aria-modal="true" aria-labelledby="note-heading" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setNoteModal(null); }}><div className="note-modal-bg" style={{ backgroundImage: noteModal.posterUrls?.[0] ? `url(/api/image?url=${encodeURIComponent(noteModal.posterUrls[0])})` : undefined }} /><div className="note-modal-content"><span className="eyebrow">NOTE</span><h2 id="note-heading">{noteModal.title}</h2><textarea className="note-textarea" value={noteDraft} onChange={(e) => setNoteDraft(e.target.value)} placeholder={t("写下你对这部作品的看法、感想、回忆…\n\n例如：这部电影让我想起了某个夏天，导演的镜头语言非常独特…", "Write your thoughts, feelings, memories about this work…\n\nFor example: This film reminds me of a summer long ago. The director's cinematography is truly unique…")} autoFocus rows={8} /><div className="guide-modal-footer"><button className="button quiet" onClick={() => { const next = setNote(notes, noteModal.key, ""); setNotes(next); writeNotes(next); setNoteDraft(""); setNotice(t("批注已清除。", "Note cleared.")); }}>{t("清除", "Clear")}</button><div style={{ flex: 1 }} /><button className="button secondary" onClick={() => setNoteModal(null)}>{t("取消", "Cancel")}</button><button className="button primary" onClick={saveNote}>{t("保存", "Save")}</button></div></div></section></div>}
    {peerRankPickOpen && peer && <div className="modal-backdrop" onClick={() => setPeerRankPickOpen(false)}><section className="account-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setPeerRankPickOpen(false); }}><div className="section-heading"><h2>{t("选择对方榜单", "Pick their ranking")}</h2><IconButton title={t("关闭", "Close")} onClick={() => setPeerRankPickOpen(false)}><X size={18} /></IconButton></div><p style={{ marginBottom: 16, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>{t("选择一个榜单，用其中的作品进行排序。", "Pick a ranking to sort its works.")}</p><div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{peer.rankings.map((entry, idx) => <button key={idx} className="button secondary" style={{ justifyContent: "flex-start", gap: 12 }} onClick={() => { setPeerRankPickOpen(false); const existingTitles = profile?.rankings.filter((r) => r.kind === entry.kind).map((r) => r.collectionTitle) ?? []; let title = entry.collectionTitle; if (existingTitles.includes(title)) { let n = 2; while (existingTitles.includes(`${title} (${n})`)) n++; title = `${title} (${n})`; } openCollection({ id: `peer-${entry.profileId}-${entry.kind}-${idx}`, kind: entry.kind, source: "custom", title, description: "", topN: entry.items.length, works: entry.items }); }}><span style={{ color: "var(--accent)", fontSize: 11, fontWeight: 600, width: 28, flexShrink: 0 }}>{label(entry.kind)}</span><Poster work={entry.items[0]} kind={entry.kind} /><span style={{ flex: 1, textAlign: "left", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{entry.collectionTitle}</span><small style={{ color: "var(--muted)", flexShrink: 0 }}>TOP {entry.items.length}</small></button>)}</div></section></div>}
    {compareRankDetail && <div className="modal-backdrop" onClick={() => setCompareRankDetail(null)}><section className="rank-detail-dialog" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setCompareRankDetail(null); }}><div className="section-heading"><div><span className="eyebrow">{compareRankDetail.side === "own" ? t("我的索引", "MY INDEX") : t("对方索引", "THEIR INDEX")} / {label(compareActiveKind)}</span><h2>{compareRankDetail.collectionTitle}</h2>{notes[`ranking:${compareRankDetail.ranking?.kind}:${compareRankDetail.collectionTitle}`] && <ExpandableNote text={notes[`ranking:${compareRankDetail.ranking?.kind}:${compareRankDetail.collectionTitle}`]} onExpand={() => { setCompareRankDetail(null); openNoteModal(`ranking:${compareRankDetail.ranking!.kind}:${compareRankDetail.collectionTitle}`, compareRankDetail.collectionTitle, compareRankDetail.ranking!.kind); }} />}</div><IconButton title={t("关闭", "Close")} onClick={() => setCompareRankDetail(null)}><X size={18} /></IconButton></div>{compareRankDetail.ranking ? <ol className="ranking-list">{compareRankDetail.ranking.items.map((work) => { const isHit = compareRankDetail.highlightId === work.id; const workNote = notes[`work:${compareRankDetail.ranking!.kind}:${work.id}`]; return <li key={work.id} style={isHit ? { background: "rgba(216,248,106,.08)", borderLeft: "3px solid var(--accent)", paddingLeft: 14 } : {}}><span className="row-number" style={isHit ? { color: "var(--accent)" } : {}}>{work.rank <= 3 ? (work.rank === 1 ? "🥇" : work.rank === 2 ? "🥈" : "🥉") : String(work.rank).padStart(2, "0")}</span><div className="ranking-card-poster" style={{ cursor: "pointer" }} onClick={() => { setCompareRankDetail(null); void openArtworkDetail(work, compareRankDetail.ranking!.kind); }}><Poster work={work} kind={compareRankDetail.ranking!.kind} /></div><div><strong>{work.title}</strong><small>{work.creator} {work.year}</small>{workNote && <ExpandableNote text={workNote} onExpand={() => { setCompareRankDetail(null); openNoteModal(`work:${compareRankDetail.ranking!.kind}:${work.id}`, work.title, compareRankDetail.ranking!.kind, work.posterUrls); }} />}</div></li>; })}</ol> : <p className="empty-state">{t("无法找到该榜单数据", "Ranking data not found")}</p>}</section></div>}
    {accountOpen && <div className="modal-backdrop" onClick={() => setAccountOpen(false)}><section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-heading" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setAccountOpen(false); }}><div className="section-heading"><h2 id="account-heading">{t("账号与同步", "Account & sync")}</h2><IconButton title={t("关闭", "Close")} onClick={() => setAccountOpen(false)}><X size={18} /></IconButton></div>
      {accountEmail && needNickname ? <>
        <p style={{ marginBottom: 12 }}>{t("请设置你的昵称", "Please set your nickname")}</p>
        <input type="text" placeholder={t("昵称", "Nickname")} value={authNickname} onChange={(e) => setAuthNickname(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void saveNickname(); }} style={{ marginBottom: 12 }} autoFocus />
        <button className="button primary" disabled={busy || !authNickname.trim()} onClick={() => void saveNickname()}>{t("确认昵称", "Set nickname")}</button>
      </> : accountEmail ? <>
        <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
          {editingNickname ? <div style={{ display: "flex", gap: 4, alignItems: "center", flex: 1 }}><input type="text" value={editNicknameValue} onChange={(e) => setEditNicknameValue(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void saveNickname(); if (e.key === "Escape") setEditingNickname(false); }} style={{ fontSize: 14, padding: "4px 8px", minHeight: "auto", flex: 1 }} autoFocus /><button className="text-button" onClick={() => void saveNickname()} style={{ color: "var(--accent)", fontSize: 13, padding: "4px 8px" }}>✓</button></div> : <><p style={{ fontWeight: 600, margin: 0 }}>{accountNickname || accountEmail}</p><button onClick={() => { setEditingNickname(true); setEditNicknameValue(accountNickname); }} style={{ fontSize: 10, color: "var(--muted)", background: "none", border: "1px solid var(--line)", borderRadius: 4, padding: "1px 6px", cursor: "pointer" }}>{t("改名", "Edit")}</button></>}
        </div>
        <p style={{ marginBottom: 16, fontSize: 12, color: "var(--muted)", display: "flex", alignItems: "center", gap: 6 }}>{accountEmail}<span title={syncStatus === "saving" ? t("同步中", "Syncing") : syncStatus === "saved" ? t("已同步", "Synced") : syncStatus === "error" ? t("同步失败", "Sync failed") : t("待机", "Idle")} style={{ display: "inline-block", width: 8, height: 8, borderRadius: "50%", background: syncStatus === "saving" ? "var(--yellow)" : syncStatus === "saved" ? "var(--green)" : syncStatus === "error" ? "var(--red)" : "var(--muted)", flexShrink: 0 }} /></p>
        <button className="button primary" disabled={busy || !profile} onClick={accountSave} style={{ marginBottom: 8 }}><CloudUpload size={16} />{t("同步到云端", "Sync to cloud")}</button>
        <button className="button secondary" disabled={busy} onClick={() => void accountLoad(false)} style={{ marginBottom: 8 }}><CloudDownload size={16} />{t("从云端恢复画像", "Restore from cloud")}</button>
        <button className="button quiet" onClick={accountLogout}>{t("退出登录", "Sign out")}</button>
      </> : <>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          <a className="button secondary" href="/api/account/oauth/google" style={{ textAlign: "center", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24"><path fill="#4285F4" d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"/><path fill="#34A853" d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"/><path fill="#FBBC05" d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"/><path fill="#EA4335" d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"/></svg>
            {t("使用 Google 登录", "Sign in with Google")}
          </a>
          <a className="button secondary" href="/api/account/oauth/github" style={{ textAlign: "center", textDecoration: "none", display: "flex", alignItems: "center", justifyContent: "center", gap: 8 }}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z"/></svg>
            {t("使用 GitHub 登录", "Sign in with GitHub")}
          </a>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
          <span style={{ fontSize: 11, color: "var(--muted)" }}>{t("或使用邮箱", "or use email")}</span>
          <div style={{ flex: 1, height: 1, background: "var(--border)" }} />
        </div>
        <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
          <button className={`button ${authMode === "login" ? "primary" : "secondary"}`} onClick={() => { setAuthMode("login"); setAuthError(""); }} style={{ flex: 1 }}>{t("登录", "Sign in")}</button>
          <button className={`button ${authMode === "register" ? "primary" : "secondary"}`} onClick={() => { setAuthMode("register"); setAuthError(""); }} style={{ flex: 1 }}>{t("注册", "Register")}</button>
        </div>
        {authError && <p style={{ color: "#f87171", fontSize: 13, marginBottom: 8 }}>{authError}</p>}
        {authMode === "register" && <input type="text" placeholder={t("昵称（必填）", "Nickname (required)")} value={authNickname} onChange={(e) => setAuthNickname(e.target.value)} style={{ marginBottom: 8 }} />}
        <input type="email" placeholder={t("邮箱", "Email")} value={authEmail} onChange={(e) => setAuthEmail(e.target.value)} style={{ marginBottom: 8 }} />
        <input type="password" placeholder={t("密码（至少6位）", "Password (6+ chars)")} value={authPassword} onChange={(e) => setAuthPassword(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void accountAuth(authMode); }} style={{ marginBottom: 12 }} />
        <button className="button primary" disabled={busy} onClick={() => void accountAuth(authMode)}>{authMode === "login" ? t("登录", "Sign in") : t("注册", "Register")}</button>
      </>}
      {!accountEmail && <button className="button quiet" onClick={() => setAccountOpen(false)}><UserRound size={16} />{t("继续使用游客模式", "Continue as guest")}</button>}
    </section></div>}
    {showGuide && <div className="modal-backdrop" onClick={() => setShowGuide(false)}><section className="guide-modal account-dialog" role="dialog" aria-modal="true" aria-labelledby="guide-heading" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setShowGuide(false); }}><span className="eyebrow">ART/RANK {t("使用说明", "GUIDE")}</span><h2 id="guide-heading">{t("欢迎来到 ART/RANK", "Welcome to ART/RANK")}</h2><p className="guide-subtitle">{t("在两件作品之间做出选择，找到你真正想留下的那一个。以下是快速上手指南：", "Choose between two works and reveal what stays with you. Here's a quick guide:")}</p><div className="guide-steps"><div className="guide-step"><span className="guide-step-num">1</span><div className="guide-step-body"><strong>{t("选择媒介维度", "Choose a medium")}</strong><p>{t("电影、书籍、音乐或其他——每个维度可以创建多个独立榜单。", "Film, Books, Music, or Other — each medium can have multiple independent lists.")}</p></div></div><div className="guide-step"><span className="guide-step-num">2</span><div className="guide-step-body"><strong>{t("选择作品来源", "Pick your works")}</strong><p>{t("从精选榜单中挑选，粘贴自己的清单，或从豆瓣 Top250 导入。", "Pick from curated lists, paste your own collection, or import from Douban Top250.")}</p></div></div><div className="guide-step"><span className="guide-step-num">3</span><div className="guide-step-body"><strong>{t("1v1 取舍排序", "Sort by choosing")}</strong><p>{t("每次看到两件作品，点击你更想留下的那个。支持键盘快捷键 A/D 或 ←/→。", "Each time you see two works, tap the one you'd keep. Keyboard: A/D or ←/→.")}</p></div></div><div className="guide-step"><span className="guide-step-num">4</span><div className="guide-step-body"><strong>{t("查看文化索引", "View your index")}</strong><p>{t("排序完成后自动保存，可导出为 JSON/TXT/Markdown/CSV/PNG。", "Results save automatically. Export as JSON, TXT, Markdown, CSV, or PNG.")}</p></div></div><div className="guide-step"><span className="guide-step-num">5</span><div className="guide-step-body"><strong>{t("与朋友比较", "Compare with friends")}</strong><p>{t("生成比较链接或二维码发给对方，看看你们的品味在哪里重合。", "Generate a compare link or QR code and see where your tastes overlap.")}</p></div></div></div><div className="guide-modal-footer"><button className="button secondary" onClick={() => { setShowGuide(false); setShowTech(true); }}>{t("技术说明", "Technical details")}</button><div style={{ flex: 1 }} /><button className="button quiet" onClick={() => { try { localStorage.setItem("art-rank:guide-dismissed", "1"); } catch {} setShowGuide(false); }}>{t("不再显示", "Don't show again")}</button><button className="button primary" onClick={() => setShowGuide(false)}>{t("知道了", "Got it")}</button></div></section></div>}
    {showTech && <div className="modal-backdrop" onClick={() => setShowTech(false)}><section className="tech-modal account-dialog" role="dialog" aria-modal="true" aria-labelledby="tech-heading" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setShowTech(false); }}><span className="eyebrow">ART/RANK TECHNICAL</span><h2 id="tech-heading">{t("技术说明", "Technical Details")}</h2><p className="guide-subtitle">{t("ART/RANK 背后的核心算法和数据流。", "The core algorithms and data flow behind ART/RANK.")}</p><div className="tech-sections"><details open><summary>{t("排序算法", "Sorting Algorithm")}</summary><div className="tech-body"><p>{t("排序引擎使用", "The sorting engine uses ")}<strong>{t("主动式二分插入排序", "Active Binary Insertion Sort")}</strong>{t("，核心思路是：每次取出一个候选作品，与已排序列表的中位数比较，根据结果缩小搜索范围，直到确定精确插入位置。", ". The core idea: each candidate work is compared with the median of the sorted list, narrowing the search range until the exact insertion position is found.")}</p><p>{t("时间复杂度 O(n log n)。对于 n 件作品取 Top N，每个候选最多需要 ⌈log₂(N+1)⌉ 次比较。", "Time complexity O(n log n). For n works with Top N, each candidate needs at most ⌈log₂(N+1)⌉ comparisons.")}</p><p><strong>{t("冷却机制", "Cooldown")}</strong>：{t("同一对作品至少间隔 3 次比较，同一作品至少间隔 4 次比较，防止顺序偏差和比较疲劳。", "Same pair at least 3 comparisons apart, same work at least 4 apart — prevents order bias and comparison fatigue.")}</p><p><strong>{t("偏好回环检测", "Preference Loop Detection")}</strong>：{t("当检测到 A→B→C→A 的偏好循环时，系统安排复测。首次标记为「观察中」，多次方向一致后标记为「持久张力」——尊重用户的真实品味矛盾，而非强行纠正。", "When detecting A→B→C→A preference loops, the system schedules rechecks. First marked 'observed', then 'persistent tension' if consistently confirmed — respecting genuine taste contradictions.")}</p><p><strong>{t("验证阶段", "Verification Phase")}</strong>：{t("主排序完成后，自动复测少量相邻作品对和循环边，确保结果稳定。复测数量约为 Top N 的 1/3。", "After main sorting, a few adjacent pairs and loop edges are rechecked. Verification count ≈ Top N / 3.")}</p><p><strong>{t("撤销", "Undo")}</strong>：{t("通过重放决策日志（去掉最后一条）重建完整状态，保证撤销后排序一致性。", "Rebuilds state by replaying the decision log minus the last entry, guaranteeing consistency after undo.")}</p></div></details><details><summary>{t("比较算法", "Comparison Algorithm")}</summary><div className="tech-body"><p>{t("两人比较时，系统首先将同维度的多个榜单", "When comparing two profiles, the system first ")}<strong>{t("合并", "merges")}</strong>{t("：同一作品出现在多个榜单中时取最高名次。匹配依据是标题 + 年份 + 创作者的规范化比较。", " multiple lists per dimension: same work across lists takes the best rank. Matching is based on normalized title + year + creator.")}</p><p><strong>{t("贪心匹配", "Greedy Matching")}</strong>：{t("生成所有候选对的匹配评分（70-90 分），按评分降序、排名差升序排列，贪心选择不冲突的最优匹配。", " — generates match scores (70-90) for all candidate pairs, sorted by score descending then rank-diff ascending, greedily selecting non-conflicting optimal matches.")}</p><p><strong>{t("比较指标", "Comparison Metrics")}</strong>：</p><ul><li><strong>{t("作品重合度", "Work Overlap")}</strong>：{t("共同作品数 / 并集作品数", "shared works / union count")}</li><li><strong>{t("加权偏好一致", "Weighted Agreement")}</strong>：{t("基于 1/rank 权重的一致性（高排名作品权重更大）", "consistency weighted by 1/rank (higher-ranked works matter more)")}</li><li><strong>{t("顺序一致率", "Order Agreement")}</strong>：{t("序对一致数 / 总序对数", "concordant pairs / total pairs")}</li><li><strong>{t("Top 3 共识", "Top 3 Consensus")}</strong>：{t("双方前三名中的共同作品数", "shared works in both top 3")}</li><li><strong>{t("名次距离", "Rank Distance")}</strong>：{t("平均名次差 / 最大名次", "avg rank difference / max rank")}</li><li><strong>{t("斯皮尔曼相关", "Spearman-like")}</strong>：{t("基于排名差平方的秩相关系数", "rank correlation based on squared rank differences")}</li></ul></div></details><details><summary>{t("海报与详情 API", "Poster & Detail API")}</summary><div className="tech-body"><p><strong>{t("海报解析策略（按优先级）", "Poster resolution (by priority)")}</strong>：</p><ul><li><strong>{t("电影", "Film")}</strong>：{t("豆瓣 suggest API → search.douban.com 搜索 → Top250 索引 → IMDb 备用", "Douban suggest API → search.douban.com → Top250 index → IMDb fallback")}</li><li><strong>{t("书籍", "Book")}</strong>：{t("豆瓣 suggest API（pic 字段）→ search.douban.com 搜索 → Top250 索引", "Douban suggest API (pic field) → search.douban.com → Top250 index")}</li><li><strong>{t("音乐", "Music")}</strong>：{t("search.douban.com 搜索 → Top250 索引（无 suggest API）", "search.douban.com → Top250 index (no suggest API)")}</li></ul><p>{t("每个来源返回的 URL 会生成多个 CDN 镜像变体（img1-img9.doubanio.com），前端按顺序尝试加载。", "Each source URL generates multiple CDN mirror variants (img1-img9.doubanio.com), tried in sequence by the frontend.")}</p><p><strong>{t("详情获取策略", "Detail fetching")}</strong>：{t("优先从 Wikipedia（中英文）获取简介，辅以类型限定词减少歧义；然后尝试创作者组合搜索；最后用百度百科兜底。元数据（评分、导演、出版社等）从豆瓣搜索结果解析。", "Prioritizes Wikipedia (zh/en) for content intros with type disambiguation; then creator+title combo search; Baidu Baike as fallback. Metadata (ratings, director, publisher) parsed from Douban search results.")}</p><p><strong>{t("防限流机制", "Rate Limit Protection")}</strong>：{t("4 个 Edge UA 轮换；同域名请求间隔 800ms；403/418 自动重试 2 次（指数退避）；限流后递增冷却期 5s→10s→15s。", "4 Edge UAs rotated; 800ms min delay per domain; auto-retry 2x on 403/418 with exponential backoff; escalating cooldown 5s→10s→15s after rate limit.")}</p></div></details><details><summary>{t("数据存储", "Data Storage")}</summary><div className="tech-body"><p><strong>{t("游客模式", "Guest mode")}</strong>：{t("所有数据存储在浏览器 localStorage，不离开设备。", "All data in browser localStorage, never leaves the device.")}</p><p><strong>{t("登录用户", "Signed-in users")}</strong>：{t("画像和云端清单存储在 Cloudflare D1（SQLite），Token 有效期 30 天。画像变更自动防抖同步，切到后台或关闭页面时使用 keepalive 确保最后保存。", "Profiles and cloud lists stored in Cloudflare D1 (SQLite), 30-day token. Profile changes auto-debounced, with keepalive sync on page hide/close.")}</p><p><strong>{t("分享链接", "Share links")}</strong>：{t("使用 fflate 压缩 + Base64URL 编码到 URL；配置 D1 后支持 8 位短码。", "Compressed with fflate + Base64URL encoded in URL; 8-char short codes supported with D1.")}</p></div></details></div><div className="guide-modal-footer"><a className="button secondary" href="https://github.com/tripodxu/film-sort" target="_blank" rel="noopener noreferrer" style={{ textDecoration: "none" }}>GitHub</a><div style={{ flex: 1 }} /><button className="button primary" onClick={() => setShowTech(false)}>{t("关闭", "Close")}</button></div></section></div>}
  </div>;
}

function ArtworkDetailModal({ detail, label, t, onClose }: { detail: { work: RankedArtwork; kind: MediaKind; data: Record<string, unknown> | null; loading: boolean }; label: (kind: MediaKind) => string; t: (zh: string, en: string) => string; onClose: () => void }) {
  const [playUrl, setPlayUrl] = useState("");
  const [playBusy, setPlayBusy] = useState(false);
  async function playMusic() {
    setPlayBusy(true);
    try { const response = await fetch(`/api/music/play?q=${encodeURIComponent(detail.work.title)}`); const payload = await response.json() as { playUrl?: string }; if (response.ok && payload.playUrl) setPlayUrl(payload.playUrl); }
    finally { setPlayBusy(false); }
  }
  return <div className="modal-backdrop" onClick={onClose}><section className="detail-dialog" role="dialog" aria-modal="true" aria-labelledby="detail-heading" onClick={(event) => event.stopPropagation()}><div className="section-heading"><div><span className="eyebrow">{label(detail.kind)} / {t("作品详情", "WORK DETAIL")}</span><h2 id="detail-heading">{detail.work.title}</h2></div><IconButton title={t("关闭", "Close")} onClick={onClose}><X size={18} /></IconButton></div><div className="detail-body"><Poster work={detail.work} kind={detail.kind} large /><div className="detail-copy">{detail.loading ? <p className="empty-state">{t("正在读取作品信息…", "Loading work details…")}</p> : detail.data ? <><div className="detail-meta"><span>{detail.work.creator ?? ""}</span><span>{detail.work.year ?? ""}</span><span>{String(detail.data.rating ?? "")}</span></div>{detail.kind === "music" && <div className="music-preview"><button className="button secondary" disabled={playBusy} onClick={() => void playMusic()}><Play size={15} />{playBusy ? t("准备试听…", "Preparing…") : t("试听片段", "Preview")}</button>{playUrl && <audio controls autoPlay src={playUrl} />}</div>}{typeof detail.data.content_intro === "string" && detail.data.content_intro && <div className="detail-synopsis"><h3>{t("简介", "Synopsis")}</h3><p>{detail.data.content_intro}</p>{typeof detail.data.content_source === "string" && <span className="detail-source">— {detail.data.content_source}</span>}</div>}<dl>{Object.entries(detail.data).filter(([key, value]) => value && !["title", "pic", "rating", "imgs", "content_intro", "content_source"].includes(key)).slice(0, 8).map(([key, value]) => <div key={key}><dt>{key}</dt><dd>{Array.isArray(value) ? value.join("、") : String(value)}</dd></div>)}</dl></> : <p className="empty-state">{t("暂时没有更多资料，仍可保留这件作品。", "No additional details were found.")}</p>}</div></div></section></div>;
}
