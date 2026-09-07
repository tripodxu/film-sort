import { lazy, Suspense, useEffect, useMemo, useState, type ReactNode } from "react";
import { ArrowLeft, ArrowRight, BookOpen, Check, ChevronRight, CloudDownload, CloudUpload, Download, Film, Languages, Library, LogIn, Music2, Pause, Play, Plus, Search, Share2, SkipForward, Undo2, Upload, UserRound, Users, X } from "lucide-react";
import { compressSync, decompressSync, strFromU8, strToU8 } from "fflate";
import QRCode from "qrcode";
import { createRankingState, chooseSide, deferWork, deserializeRankingState, getCurrentComparison, getRankingProgress, getRankingResult, serializeRankingState, skipWork, undoLastAction, type RankingState } from "./lib/ranking";
import { getCollectionsByKind, mediaLabels, type MediaCollection, type MediaKind } from "./data/media";
import { compareRankings, LIBRARY_KEY, MAX_PROFILE_BYTES, mergeRanking, parseProfile, profileText, readProfile, renameRanking, deleteRanking, type ArtisticProfile, type RankingExport } from "./lib/profile";
import { importCollection } from "./lib/collections";
import { Poster } from "./components/Poster";

const OrbScene = lazy(() => import("./components/OrbScene").then((module) => ({ default: module.OrbScene })));

type View = "home" | "source" | "setup" | "sorting" | "profile" | "compare";
type Locale = "zh" | "en";
type Draft = { collection: MediaCollection; ranking: string; profileName: string };
const DRAFT_KEY = "art-rank:draft:v2";
const PEER_KEY = "art-rank:peer:v2";
const icons = { film: Film, book: BookOpen, music: Music2, other: Library };
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
function encode(profile: ArtisticProfile) {
  return btoa(Array.from(compressSync(strToU8(JSON.stringify(profile))), (byte) => String.fromCharCode(byte)).join("")).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/g, "");
}
function decode(payload: string) {
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
  const [topN, setTopN] = useState(10);
  const [seed, setSeed] = useState("");
  const [customText, setCustomText] = useState("");
  const [search, setSearch] = useState("");
  const [notice, setNotice] = useState("");
  const [colCount, setColCount] = useState<number>(() => { try { return Number(localStorage.getItem("art-rank:cols")) || 3; } catch { return 3; } });
  const [busy, setBusy] = useState(false);
  const [doubanLimit, setDoubanLimit] = useState(50);
  const [format, setFormat] = useState<"json" | "txt" | "md" | "csv" | "png">("json");
  const [shareUrl, setShareUrl] = useState("");
  const [qrUrl, setQrUrl] = useState("");
  const [accountOpen, setAccountOpen] = useState(new URLSearchParams(location.search).has("account"));
  const [accountEnabled, setAccountEnabled] = useState(false);
  const [accountEmail, setAccountEmail] = useState("");
  const [accountNickname, setAccountNickname] = useState("");
  const [cloudProfile, setCloudProfile] = useState<ArtisticProfile | null>(null);
  const [accountToken, setAccountToken] = useState(() => { try { return localStorage.getItem("art-rank:account-token") ?? ""; } catch { return ""; } });
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authNickname, setAuthNickname] = useState("");
  const [authError, setAuthError] = useState("");
  const [needNickname, setNeedNickname] = useState(false);
  const [editingRankIdx, setEditingRankIdx] = useState<number | null>(null);
  const [editingRankTitle, setEditingRankTitle] = useState("");
  const [ringsLayout, setRingsLayout] = useState<"row" | "col">(() => { try { return (localStorage.getItem("art-rank:rings-layout") as "row" | "col") || "row"; } catch { return "row"; } });

  const comparison = ranking ? getCurrentComparison(ranking) : null;
  const progress = ranking ? getRankingProgress(ranking) : null;
  const worksById = useMemo(() => new Map(collection?.works.map((work) => [work.id, work]) ?? []), [collection]);
  const collections = getCollectionsByKind(kind).filter((item) => [item.title, item.description, ...item.works.map((work) => work.title)].join(" ").toLowerCase().includes(search.toLowerCase()));
  const activeRanking = profile?.rankings.find((entry, idx) => `${entry.kind}-${idx}` === activeKind) ?? profile?.rankings[0];

  function persist(next: ArtisticProfile) {
    setProfile(next); setProfileName(next.profileName); setShareUrl(""); setQrUrl("");
    try { localStorage.setItem(LIBRARY_KEY, JSON.stringify(next)); }
    catch { setNotice(t("浏览器无法保存，请及时导出画像。", "Browser storage is unavailable. Export your profile to keep it.")); }
  }
  function acceptPeer(next: ArtisticProfile) {
    setPeer(next); setActiveKind(next.rankings[0].kind); setView("compare");
    try { localStorage.setItem(PEER_KEY, JSON.stringify(next)); } catch { /* Keep the in-memory copy. */ }
  }
  useEffect(() => {
    track("visit", { lang: locale, app_version: "2.0.0" });
    const payload = new URLSearchParams(location.hash.slice(1)).get("profile") ?? new URLSearchParams(location.search).get("payload");
    if (payload) try { acceptPeer(decode(payload)); } catch { setNotice(t("比较链接无效或过大，请导入 JSON 文件。", "Invalid or oversized link. Import the JSON file instead.")); }
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
    } else if (oauthError === "error") {
      setNotice(t("登录失败：" + (params.get("msg") ?? "未知错误"), "Sign in failed: " + (params.get("msg") ?? "Unknown error")));
      history.replaceState(null, "", location.pathname);
    }

    // Restore session
    const savedToken = oauthToken || accountToken;
    if (savedToken) {
      void fetch("/api/account/profile", { headers: { authorization: `Bearer ${savedToken}` } })
        .then((r) => r.ok ? r.json() : null)
        .then((data: { email?: string; nickname?: string; profile?: unknown } | null) => {
          if (data?.email) { setAccountEmail(data.email); setAccountNickname(data.nickname ?? data.email.split("@")[0]); if (data.profile) setCloudProfile(parseProfile(data.profile)); }
          else if (!oauthToken) { setAccountToken(""); try { localStorage.removeItem("art-rank:account-token"); } catch {} }
        }).catch(() => {});
    }
  }, []);
  useEffect(() => { document.documentElement.lang = locale === "zh" ? "zh-CN" : "en"; }, [locale]);
  useEffect(() => { window.scrollTo(0, 0); }, [view]);
  useEffect(() => { setEditingRankIdx(null); setEditingRankTitle(""); }, [view]);
  useEffect(() => {
    if (view !== "sorting" || !ranking || !collection) return;
    const next = { collection, ranking: serializeRankingState(ranking), profileName };
    setDraft(next);
    try { localStorage.setItem(DRAFT_KEY, JSON.stringify(next)); } catch { setNotice(t("进度无法写入浏览器存储。", "Progress could not be saved in this browser.")); }
  }, [ranking, collection, view, profileName]);
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

  function chooseKind(next: MediaKind) { setKind(next); setSource("builtin"); setSearch(""); setCustomText(""); setView("source"); }
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
  function clearAllData() {
    setProfile(null); setDraft(null); setPeer(null);
    try { localStorage.removeItem(LIBRARY_KEY); localStorage.removeItem(DRAFT_KEY); localStorage.removeItem(PEER_KEY); } catch {}
    setNotice(t("本地数据已清除。", "Local data cleared."));
  }
  function openCollection(next: MediaCollection) {
    setKind(next.kind); setCollection(next); setSelected(next.works.map((work) => work.id)); setTopN(Math.min(next.topN, next.works.length)); setRanking(null); setView("setup");
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
    const next = createRankingState(works.map((work) => work.id), { topN: Math.min(topN, works.length), seed: seed.trim() || crypto.randomUUID() });
    setCollection({ ...collection, works }); setRanking(next); setView("sorting"); setNotice("");
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
      setView("profile");
      track("ranking_completed", { mode: kind, item_count: next.sourceIds.length, top_k: next.topN, comparison_count: next.comparisonCount });
    }
  }
  function resume() {
    if (!draft) return;
    try { setCollection(draft.collection); setKind(draft.collection.kind); setRanking(deserializeRankingState(draft.ranking)); setProfileName(draft.profileName); setView("sorting"); }
    catch { setNotice(t("草稿无法读取。", "The draft could not be restored.")); }
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
        setActiveKind(imported.rankings[0].kind); setView(peer ? "compare" : "profile");
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
      await document.fonts.ready;
      const canvas = document.createElement("canvas"); canvas.width = 1200;
      const lines = next.rankings.flatMap((entry) => [label(entry.kind), ...entry.items.slice(0, 10).map((item) => `${String(item.rank).padStart(2, "0")}  ${item.title}`), ""]);
      canvas.height = 290 + lines.length * 58;
      const ctx = canvas.getContext("2d"); if (!ctx) return;
      ctx.fillStyle = "#111313"; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.fillStyle = "#d8f86a"; ctx.font = "bold 38px sans-serif"; ctx.fillText("ART/RANK", 70, 84);
      ctx.fillStyle = "#f2f3ee"; ctx.font = "bold 46px sans-serif"; ctx.fillText(next.profileName, 70, 167, 1060);
      lines.forEach((line, index) => { ctx.fillStyle = /^\d/.test(line) ? "#e0e4dc" : "#d8f86a"; ctx.font = "30px sans-serif"; ctx.fillText(line, 70, 260 + index * 58, 1060); });
      canvas.toBlob((blob) => { if (blob) saveFile(blob, "art-profile.png", "image/png"); });
    } else saveFile(format === "json" ? JSON.stringify(next, null, 2) : profileText(next, format), `art-profile.${format}`, format === "json" ? "application/json" : "text/plain;charset=utf-8");
  }
  async function share() {
    const next = namedProfile(); if (!next) return;
    persist(next);
    const url = `${location.origin}/#profile=${encode(next)}`;
    if (url.length > 14000) { setNotice(t("画像较大，请导出 JSON 分享。", "This profile is large. Share the JSON export instead.")); return; }
    setShareUrl(url);
    try { setQrUrl(await QRCode.toDataURL(url, { width: 240, margin: 2, errorCorrectionLevel: "L" })); } catch { setQrUrl(""); }
    try { await navigator.clipboard.writeText(url); setNotice(t("比较链接已复制。", "Comparison link copied.")); }
    catch { setNotice(t("链接已生成，可在下方选中复制。", "Link ready. Select and copy it below.")); }
  }
  async function accountLoad() {
    if (!accountToken) { setNotice(t("请先登录。", "Please sign in first.")); return; }
    setBusy(true);
    try {
      const response = await fetch("/api/account/profile", { headers: { authorization: `Bearer ${accountToken}` } });
      if (!response.ok) throw new Error();
      const data = await response.json() as { email: string; profile: unknown };
      setAccountEmail(data.email); setCloudProfile(data.profile ? parseProfile(data.profile) : null);
    } catch { setNotice(t("读取失败，请重新登录。", "Failed to load. Please sign in again.")); }
    finally { setBusy(false); }
  }
  async function accountSave() {
    if (!accountToken) { setNotice(t("请先登录。", "Please sign in first.")); return; }
    const next = namedProfile(); if (!next) return;
    setBusy(true);
    try {
      const response = await fetch("/api/account/profile", { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${accountToken}` }, body: JSON.stringify({ profile: next }) });
      if (!response.ok) throw new Error();
      persist(next); setCloudProfile(next); setNotice(t("画像已保存到账号。", "Profile saved to your account."));
    } catch { setNotice(t("同步失败，本地画像仍然保留。", "Sync failed. Your local profile is still available.")); }
    finally { setBusy(false); }
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
    } catch { setAuthError(t("网络错误", "Network error")); }
    finally { setBusy(false); }
  }
  async function saveNickname() {
    if (!authNickname.trim() || !accountToken) return;
    setBusy(true);
    try {
      const response = await fetch("/api/account/nickname", { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${accountToken}` }, body: JSON.stringify({ nickname: authNickname.trim() }) });
      if (response.ok) { setAccountNickname(authNickname.trim()); setNeedNickname(false); setAuthNickname(""); setNotice(t("昵称已设置！", "Nickname set!")); }
    } catch {}
    finally { setBusy(false); }
  }
  function accountLogout() {
    if (accountToken) void fetch("/api/account/logout", { method: "POST", headers: { authorization: `Bearer ${accountToken}` } }).catch(() => {});
    setAccountToken(""); setAccountEmail(""); setAccountNickname(""); setCloudProfile(null);
    try { localStorage.removeItem("art-rank:account-token"); } catch {}
  }
  function createFromPeer(nextKind: MediaKind) {
    const entry = peer?.rankings.find((item) => item.kind === nextKind);
    if (!entry || entry.items.length < 2) { chooseKind(nextKind); return; }
    openCollection({ id: `peer-${entry.profileId}`, kind: nextKind, source: "custom", title: entry.collectionTitle, description: "", topN: entry.items.length, works: entry.items });
  }

  const fileInput = (target: "own" | "peer", text: string) => <label className="button secondary file-button"><Upload size={16} />{text}<input aria-label={text} type="file" accept=".json,application/json" onChange={(event) => { const file = event.target.files?.[0]; if (file) void importProfile(file, target); event.target.value = ""; }} /></label>;
  const heading = (eyebrow: string, title: string, detail?: string) => <div className="page-heading"><span className="eyebrow">{eyebrow}</span><h1>{title}</h1>{detail && <p>{detail}</p>}</div>;
  let content: ReactNode;

  if (view === "home") content = <>
    <section className="orb-hero">
      <Suspense fallback={<div className="orb-scene orb-scene-fallback" aria-hidden="true" />}><OrbScene /></Suspense>
      <div className="orb-hero-inner">
        <div className="home-heading"><div><span className="eyebrow">YOUR PERSONAL CULTURE INDEX</span><h1>ART<span>/</span>RANK<small>{t("我的艺术人格", "My Artistic Profile")}</small></h1><p>{t("在两件作品之间，找到你真正想留下的那一个。", "Choose between two works and reveal what stays with you.")}</p></div></div>
        <div className="identity glass-capsule"><UserRound size={15} /><span>{accountEmail || t("本地游客", "Local guest")}</span><button className="text-button" onClick={() => setAccountOpen(true)}>{t("登录 / 同步", "Sign in / Sync")}<ArrowRight size={13} /></button></div>
        <div className="home-actions glass-capsule"><button className="button primary" onClick={() => chooseKind(kind)}><Play size={16} />{t("开始排序", "Start ranking")}</button><button className="button secondary" onClick={() => setView("compare")}><Users size={16} />{t("比较画像", "Compare profiles")}</button>{draft && <button className="button quiet" onClick={resume}><Play size={16} />{t("继续上次进度", "Resume ranking")}</button>}</div>
        <div className="orb-index" aria-hidden="true"><span>01</span><i /><span>∞</span></div>
      </div>
    </section>
    <section className="medium-section"><div className="section-heading"><h2>{t("选择一个维度", "Choose a medium")}</h2><span>01 / 04</span></div><div className="medium-grid">{kinds.map((item) => { const Icon = icons[item]; const saved = profile?.rankings.filter((entry) => entry.kind === item) ?? []; const latest = saved[0]; return <button className={`medium-item medium-${item}`} key={item} onClick={() => chooseKind(item)}><span className="medium-number">{mediaLabels[item].symbol}</span>{latest ? <Poster work={latest.items[0]} kind={item} /> : <Icon size={20} />}<strong>{label(item)}</strong><small>{saved.length > 0 ? `${saved.length}${t("个榜单", "lists")} / ${saved.reduce((s, r) => s + r.items.length, 0)}${t("件", "")}` : t(mediaLabels[item].description, "New ranking")}</small><ArrowRight size={16} /></button>; })}</div></section>
    <section className="profile-overview"><div className="section-heading"><h2>{t("品味年轮", "Taste Rings")}</h2><div style={{ display: "flex", gap: 12, alignItems: "center" }}>{profile && <button className="text-button" onClick={() => setView("profile")}>{t("查看画像", "View profile")}<ArrowRight size={15} /></button>}{profile && <div style={{ display: "flex", gap: 4 }}>{["row","col"].map(m => <button key={m} onClick={() => { setRingsLayout(m as "row"|"col"); try { localStorage.setItem("art-rank:rings-layout", m); } catch {} }} style={{ width: 24, height: 24, borderRadius: 6, border: ringsLayout === m ? "1px solid var(--accent)" : "1px solid var(--line)", background: ringsLayout === m ? "rgba(216,248,106,.1)" : "transparent", color: ringsLayout === m ? "var(--accent)" : "var(--muted)", fontSize: 10, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}>{m === "row" ? "≡" : "≡"}</button>)}</div>}{profile && <button className="button quiet" onClick={clearAllData} style={{ fontSize: 11, padding: "4px 10px", borderRadius: 8, border: "1px solid var(--line)", color: "var(--muted)" }}>🗑 {t("清除数据", "Clear")}</button>}</div></div>{profile ? <div style={{ display: "flex", flexDirection: ringsLayout === "row" ? "column" : "row", gap: 20, flexWrap: "wrap" }}>{kinds.map(kind => { const entries = profile.rankings.map((r, i) => ({ ...r, _idx: i })).filter(r => r.kind === kind); if (entries.length === 0) return null; return <div key={kind} style={{ flex: ringsLayout === "row" ? "none" : "1 1 250px", minWidth: ringsLayout === "row" ? "auto" : 200 }}><div style={{ fontSize: 11, color: "var(--accent)", fontWeight: 600, marginBottom: 8, textTransform: "uppercase", letterSpacing: ".5px" }}>{label(kind as MediaKind)}</div><div style={{ display: "flex", flexDirection: ringsLayout === "row" ? "row" : "column", gap: 10, flexWrap: "wrap" }}>{entries.map(entry => { const idx = entry._idx; const isActive = editingRankIdx === idx; return <div key={`${entry.kind}-${entry.collectionTitle}-${idx}`} className="coordinate" style={{ position: "relative", flex: ringsLayout === "row" ? "0 0 auto" : "none" }}><div style={{ display: "flex", gap: 5, position: "absolute", top: 5, right: 5, zIndex: 2 }}><button onClick={(e) => { e.stopPropagation(); setEditingRankIdx(idx); setEditingRankTitle(entry.collectionTitle); }} title={t("重命名", "Rename")} style={{ width: 10, height: 10, borderRadius: "50%", background: "#f5c542", border: "1px solid #d4a830", cursor: "pointer", padding: 0 }} /><button onClick={(e) => { e.stopPropagation(); deleteRank(idx); }} title={t("删除", "Delete")} style={{ width: 10, height: 10, borderRadius: "50%", background: "#ff5f57", border: "1px solid #e04842", cursor: "pointer", padding: 0 }} /></div><button onClick={() => { setActiveKind(`${entry.kind}-${idx}`); setView("profile"); }} style={{ display: "flex", gap: 12, alignItems: "center", flex: 1, background: "none", border: "none", color: "inherit", cursor: "pointer", padding: 0, textAlign: "left" }}><Poster work={entry.items[0]} kind={entry.kind} /><div>{isActive ? <div style={{ display: "flex", gap: 4, alignItems: "center" }}><input type="text" value={editingRankTitle} onChange={(e) => setEditingRankTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") renameRank(idx); if (e.key === "Escape") setEditingRankIdx(null); }} style={{ fontSize: 12, padding: "2px 6px", minHeight: "auto", width: "100%" }} autoFocus /><button className="text-button" onClick={(e) => { e.stopPropagation(); renameRank(idx); }} style={{ color: "var(--accent)", fontSize: 11, padding: "0 4px" }}>✓</button></div> : <h3>{entry.collectionTitle}</h3>}<small>{entry.items.length} {t("件作品", "works")}</small></div></button></div>; })}</div></div>; }).filter(Boolean)}</div> : <div className="empty-profile"><div className="sample-covers" aria-hidden="true">{getCollectionsByKind("film")[1]?.works.filter((work) => work.posterUrls?.length).slice(0, 3).map((work) => <Poster key={work.id} work={work} kind="film" />)}</div><div><h3>{t("还没有完成的画像", "No completed profile yet")}</h3><span>{t("电影 · 书籍 · 音乐 · 其他", "Films · Books · Music · Other")}</span></div>{fileInput("own", t("导入我的画像", "Import my profile"))}</div>}</section>
  </>;
  else if (view === "source") content = <>
    {heading(`COLLECTION / ${label(kind)}`, t("选择作品来源", "Choose a collection"))}
    <div className="segmented" role="tablist" aria-label={t("作品来源", "Collection source")}>{(["builtin", "custom", ...(kind === "film" || kind === "book" || kind === "music" ? ["douban"] : [])] as Array<"builtin" | "custom" | "douban">).map((item) => <button key={item} role="tab" aria-selected={source === item} className={source === item ? "active" : ""} onClick={() => { setSource(item); setNotice(""); }}>{item === "builtin" ? t("内置榜单", "Built-in") : item === "custom" ? t("自行导入", "Import") : t("豆瓣榜单", "Douban")}</button>)}</div>
    {source === "builtin" && <><div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}><label className="search-field" style={{ flex: 1, marginBottom: 0 }}><Search size={17} /><input aria-label={t("搜索榜单", "Search collections")} placeholder={t("搜索榜单或作品", "Search collections or works")} value={search} onChange={(event) => setSearch(event.target.value)} /></label><div style={{ display: "flex", gap: 4 }}>{[2,3,4].map(n => <button key={n} onClick={() => changeCols(n)} style={{ width: 32, height: 32, borderRadius: 8, border: colCount === n ? "1px solid var(--accent)" : "1px solid var(--line)", background: colCount === n ? "rgba(216,248,106,.1)" : "transparent", color: colCount === n ? "var(--accent)" : "var(--muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{n}</button>)}</div></div><div className="collection-list" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>{collections.map((item, index) => <button key={item.id} className="collection-row" onClick={() => openCollection(item)}><span className="row-number">{String(index + 1).padStart(2, "0")}</span>{item.works[0] && <Poster work={item.works[0]} kind={item.kind} />}<div><h3>{item.title}</h3><small>{item.works.length} {t("件作品", "works")}</small></div><ChevronRight size={18} /></button>)}{!collections.length && <p className="empty-state">{t("没有匹配的榜单。", "No matching collections.")}</p>}</div></>}
    {source === "custom" && <section className="import-form"><label htmlFor="custom-list">{t("作品清单", "Your collection")}</label><textarea id="custom-list" value={customText} onChange={(event) => setCustomText(event.target.value)} placeholder={t("作品名称", "Artwork titles")} /><div className="action-row"><label className="button secondary file-button"><Upload size={16} />{t("打开 TXT / JSON", "Open TXT / JSON")}<input type="file" aria-label={t("导入作品清单", "Import collection")} accept=".txt,.json,text/plain,application/json" onChange={async (event) => { const file = event.target.files?.[0]; if (file && file.size <= MAX_PROFILE_BYTES) setCustomText(await file.text()); else if (file) setNotice(t("文件超过 512 KB。", "File exceeds 512 KB.")); event.target.value = ""; }} /></label><button className="button primary" onClick={() => { try { openCollection(importCollection(kind, customText)); } catch { setNotice(t("请输入 2–300 件有效作品，或检查 JSON 格式。", "Enter 2–300 valid works, or check the JSON format.")); } }}>{t("载入清单", "Load collection")}<ArrowRight size={16} /></button></div></section>}
    {source === "douban" && <section className="douban-source"><span className="eyebrow">{kind === "book" ? "DOUBAN / BOOKS" : kind === "music" ? "DOUBAN / MUSIC" : "DOUBAN / TOP 250"}</span><h2>{kind === "book" ? t("豆瓣读书 Top250", "Douban Book Top250") : kind === "music" ? t("豆瓣音乐 Top250", "Douban Music Top250") : t("豆瓣电影 Top250", "Douban Film Top250")}</h2><label htmlFor="douban-limit">{t("候选范围", "Candidate range")}</label><select id="douban-limit" value={doubanLimit} onChange={(event) => setDoubanLimit(Number(event.target.value))}>{[25, 50, 100, 250].map((n) => <option value={n} key={n}>Top {n}</option>)}</select><button className="button primary" disabled={busy} onClick={loadDouban}><Download size={16} />{busy ? t("正在读取…", "Loading…") : t("读取榜单", "Load collection")}</button></section>}
  </>;
  else if (view === "setup" && collection) content = <>
    {heading(label(collection.kind), collection.title)}
    <div className="setup-layout"><section className="settings"><label htmlFor="top-n">Top N <strong>{Math.min(topN, selected.length)}</strong></label><input id="top-n" type="range" min={1} max={Math.max(1, selected.length)} value={Math.min(topN, selected.length) || 1} onChange={(event) => setTopN(Number(event.target.value))} /><label htmlFor="seed">{t("顺序口令（可选）", "Order seed (optional)")}</label><input id="seed" maxLength={80} value={seed} onChange={(event) => setSeed(event.target.value)} /><label htmlFor="collection-name">{t("榜单名称", "Collection name")}</label><input id="collection-name" maxLength={160} value={collection.title} onChange={(event) => setCollection({ ...collection, title: event.target.value })} /><button className="button primary" disabled={selected.length < 2 || !collection.title.trim()} onClick={startRanking}><Play size={16} />{t("开始 1v1 取舍", "Start 1v1 ranking")}</button></section><section className="candidate-list"><div className="section-heading"><h2>{t("已看 / 已读 / 已听", "Experienced works")}</h2><label className="check-all"><input type="checkbox" checked={selected.length === collection.works.length} onChange={(event) => setSelected(event.target.checked ? collection.works.map((work) => work.id) : [])} />{selected.length} / {collection.works.length}</label></div><div className="candidate-scroll">{collection.works.map((work) => <label className="candidate-row" key={work.id}><input type="checkbox" checked={selected.includes(work.id)} onChange={(event) => setSelected(event.target.checked ? [...selected, work.id] : selected.filter((id) => id !== work.id))} /><Poster work={work} kind={kind} /><div><strong>{work.title}</strong><small>{work.creator} {work.year}</small></div></label>)}</div></section></div>
  </>;
  else if (view === "sorting" && collection && ranking && comparison && progress) content = <>
    <div className="duel-heading"><div><span className="eyebrow">{label(kind)} / TOP {ranking.topN}</span><h1>{collection.title}</h1></div><div className="comparison-count"><strong>{progress.comparisonCount}</strong><span>{t("次取舍", "choices")}</span></div></div>
    <div className="progress-track" role="progressbar" aria-label={t("排序进度", "Ranking progress")} aria-valuenow={Math.round(progress.fraction * 100)} aria-valuemin={0} aria-valuemax={100}><span style={{ width: `${progress.fraction * 100}%` }} /></div><div className="progress-meta"><span>{progress.processed} / {progress.total}</span><span>{t("预计剩余", "Estimated remaining")} {progress.estimatedRemaining}</span></div>
    <div className="duel-grid">{(["left", "right"] as const).map((side, index) => { const workId = side === "left" ? comparison.leftId : comparison.rightId; const work = worksById.get(workId)!; return <div key={side} className="artwork-card"><button className="artwork-main" onClick={() => act(side)} aria-label={`${t("选择", "Choose")} ${work.title}`}><div className="artwork-top"><span>0{index + 1}</span><span>{label(kind)}</span></div><Poster key={work.id} work={work} kind={kind} large /><div className="artwork-info"><h2>{work.title}</h2><p>{work.creator || work.subtitle || label(kind)} {work.year}</p></div><ArrowRight className="choose-arrow" size={19} /></button><div className="artwork-card-tools"><IconButton title={`${t("略过", "Skip")} ${work.title}`} onClick={(event) => { event.stopPropagation(); act(side === "left" ? "skip-left" : "skip-right"); }}><SkipForward size={15} /></IconButton><IconButton title={`${t("暂放", "Defer")} ${work.title}`} disabled={ranking.pendingIds.length + ranking.deferredIds.length === 0} onClick={(event) => { event.stopPropagation(); act(side === "left" ? "defer-left" : "defer-right"); }}><Pause size={15} /></IconButton></div></div>; })}</div>
    <div className="duel-tools"><IconButton title={t("撤销", "Undo")} disabled={!ranking.decisionLog.length} onClick={() => act("undo")}><Undo2 size={19} /></IconButton></div>
  </>;
  else if (view === "profile" && profile && activeRanking) content = <>
    {heading("ARTISTIC PROFILE", profile.profileName, `${profile.rankings.length} ${t("个维度", "media")} / ${profile.rankings.reduce((count, entry) => count + entry.items.length, 0)} ${t("件作品", "works")}`)}
    <div className="profile-dimensions">{profile.rankings.map((entry, idx) => { const key = `${entry.kind}-${idx}`; return <button className={`profile-dimension medium-${entry.kind} ${activeRanking === entry ? "active" : ""}`} key={key} onClick={() => setActiveKind(key)}><Poster work={entry.items[0]} kind={entry.kind} /><span>{label(entry.kind)}</span><strong>{entry.collectionTitle}</strong><small>TOP {entry.items.length}</small></button>; })}</div>
    <div className="profile-layout"><section><div className="section-heading"><h2>{activeRanking.collectionTitle}</h2><div style={{ display: "flex", gap: 8, alignItems: "center" }}><span>{new Date(activeRanking.createdAt).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US")}</span><button className="text-button" onClick={() => { const works = activeRanking.items.map(item => ({ id: item.id, title: item.title, subtitle: item.subtitle, creator: item.creator, year: item.year, posterUrls: item.posterUrls })); openCollection({ id: `rerank-${activeRanking.profileId}`, kind: activeRanking.kind, source: "custom", title: activeRanking.collectionTitle, description: "", topN: activeRanking.items.length, works }); }} style={{ fontSize: 12, color: "var(--accent)" }}>{t("重新排序", "Re-rank")}</button></div></div><ol className="ranking-list">{activeRanking.items.map((work) => <li key={work.id}><span className="row-number">{String(work.rank).padStart(2, "0")}</span><Poster work={work} kind={activeRanking.kind} /><div><strong>{work.title}</strong><small>{work.creator} {work.year}</small></div>{work.rank === 1 && <Check size={17} />}</li>)}</ol></section><aside className="export-tools"><label htmlFor="profile-name">{t("画像名称", "Profile name")}</label><input id="profile-name" value={profileName} maxLength={80} onChange={(event) => { setProfileName(event.target.value); setShareUrl(""); setQrUrl(""); }} onBlur={() => { const next = namedProfile(); if (next) persist(next); }} /><label htmlFor="export-format">{t("导出格式", "Export format")}</label><select id="export-format" value={format} onChange={(event) => setFormat(event.target.value as typeof format)}>{["json", "png", "txt", "csv", "md"].map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select><button className="button primary" onClick={exportProfile}><Download size={16} />{t("导出全部维度", "Export all media")}</button><button className="button secondary" onClick={share}><Share2 size={16} />{t("复制比较链接", "Copy comparison link")}</button>{shareUrl && <div className="share-output"><input aria-label={t("比较链接", "Comparison link")} readOnly value={shareUrl} onFocus={(event) => event.target.select()} />{qrUrl && <img src={qrUrl} alt={t("比较二维码", "Comparison QR code")} />}</div>}<button className="button quiet" onClick={() => setView("home")}><Plus size={16} />{t("添加另一个维度", "Add another medium")}</button><button className="button quiet" onClick={() => setView("compare")}><Users size={16} />{peer ? t("继续与好友比较", "Continue comparison") : t("与他人比较", "Compare with someone")}</button>{ranking?.completed && collection?.kind === activeRanking.kind && <button className="button quiet" onClick={() => { setRanking(undoLastAction(ranking)); setView("sorting"); }}><Undo2 size={16} />{t("返回最后一次取舍", "Revisit last choice")}</button>}</aside></div>
  </>;
  else if (view === "compare") {
    const sharedKinds = kinds.filter((item) => profile?.rankings.some((entry) => entry.kind === item) && peer?.rankings.some((entry) => entry.kind === item));
    const activeKindValue = activeRanking?.kind as MediaKind | undefined;
    const compareKind = sharedKinds.includes(activeKindValue as MediaKind) ? activeKindValue! : sharedKinds[0];
    const ownRanking = profile?.rankings.find((entry) => entry.kind === compareKind);
    const peerRanking = peer?.rankings.find((entry) => entry.kind === compareKind);
    const result = ownRanking && peerRanking ? compareRankings(ownRanking, peerRanking) : null;
    content = <>{heading("PROFILE COMPARE", t("共同偏好，各自的顺序", "Shared works. Different rankings."))}<div className="comparison-inputs"><section><span className="eyebrow">01 / {t("我的画像", "MY PROFILE")}</span><h2>{profile?.profileName ?? t("尚未创建", "Not created")}</h2>{fileInput("own", t("导入我的画像", "Import my profile"))}</section><section><span className="eyebrow">02 / {t("对方画像", "THEIR PROFILE")}</span><h2>{peer?.profileName ?? t("等待导入", "Awaiting import")}</h2>{fileInput("peer", t("导入对方画像", "Import their profile"))}</section></div>
      {!peer && <div className="empty-state">{t("尚未选择对方的结果。", "No comparison profile selected.")}</div>}
      {peer && !profile && <div className="empty-state"><h2>{t("先建立你的艺术人格画像", "Create your own artistic profile")}</h2><div className="action-row">{peer.rankings.map((entry) => <button className="button primary" key={entry.kind} onClick={() => createFromPeer(entry.kind)}><Play size={16} />{label(entry.kind)}<ArrowRight size={16} /></button>)}</div></div>}
      {peer && profile && !sharedKinds.length && <div className="empty-state"><h2>{t("还没有共同的媒介维度", "No shared media yet")}</h2><div className="action-row">{peer.rankings.map((entry) => <button className="button primary" key={entry.kind} onClick={() => createFromPeer(entry.kind)}><Plus size={16} />{label(entry.kind)}</button>)}</div></div>}
      {result && <><div className="segmented" role="tablist" aria-label={t("比较维度", "Comparison medium")}>{sharedKinds.map((item) => <button role="tab" aria-selected={compareKind === item} className={compareKind === item ? "active" : ""} key={item} onClick={() => setActiveKind(item)}>{label(item)}</button>)}</div><div className="metrics"><div><span>{t("作品重合度", "Work overlap")}</span><strong>{result.overlap}<small>%</small></strong></div><div><span>{t("顺序一致率", "Order agreement")}</span><strong>{result.orderAgreement === null ? "--" : `${result.orderAgreement}%`}</strong></div><div><span>{t("Top 5 共同作品", "Shared in Top 5")}</span><strong>{result.top5Overlap}</strong></div></div><div className="comparison-lists"><section><h2>{t("共同作品", "Shared works")}</h2>{result.shared.length ? <div className="comparison-table"><div className="table-header"><span>{t("作品", "Work")}</span><span>{t("我", "Me")}</span><span>{t("对方", "Them")}</span></div>{result.shared.map((item) => <div key={`${item.title}-${item.ownRank}`}><strong>{item.title}</strong><span>#{item.ownRank}</span><span>#{item.peerRank}</span></div>)}</div> : <p className="empty-state">{t("本次榜单没有共同作品。", "These rankings have no shared works.")}</p>}</section><section><h2>{t("最大分歧", "Largest rank differences")}</h2>{result.disagreements.map((item) => <div className="difference-row" key={`${item.title}-${item.ownRank}`}><strong>{item.title}</strong><span>#{item.ownRank} / #{item.peerRank}</span><b>{item.difference}</b></div>)}{!result.disagreements.length && <p className="empty-state">{t("没有可展示的名次分歧。", "No rank differences to display.")}</p>}</section></div><div className="action-row"><button className="button secondary" onClick={() => createFromPeer(compareKind)}><Play size={16} />{t("用对方的作品重新排序", "Rank their selection")}</button><button className="button quiet" onClick={() => setView("profile")}><ArrowRight size={16} />{t("我的完整画像", "My complete profile")}</button></div></>}
    </>;
  } else content = <div className="empty-state"><button className="button primary" onClick={() => setView("home")}>{t("返回首页", "Back home")}</button></div>;

  return <div className="app-shell"><header className="topbar"><button className="wordmark" onClick={() => setView("home")}>ART<span>/</span>RANK</button><nav aria-label={t("主导航", "Main navigation")}><button className={view === "home" || view === "source" || view === "setup" || view === "sorting" ? "active" : ""} onClick={() => setView("home")}>{t("排序", "Rank")}</button><button className={view === "compare" ? "active" : ""} onClick={() => setView("compare")}>{t("比较", "Compare")}</button>{profile && <button className={view === "profile" ? "active" : ""} onClick={() => setView("profile")}>{t("画像", "Profile")}</button>}</nav><div className="header-tools"><IconButton title={locale === "zh" ? "English" : "中文"} onClick={() => { const next = locale === "zh" ? "en" : "zh"; setLocale(next); const url = new URL(location.href); url.searchParams.set("lang", next); history.replaceState(null, "", url); }}><Languages size={18} /></IconButton><IconButton title={t("登录 / 同步", "Sign in / Sync")} onClick={() => setAccountOpen(true)}><UserRound size={18} /></IconButton></div></header>
    <main className={`main view-${view}`}>{view !== "home" && <button className="back-link" onClick={() => setView(view === "setup" ? "source" : "home")}><ArrowLeft size={15} />{t("返回", "Back")}</button>}{content}</main><footer><span>ART/RANK</span><span>{t("偏好没有标准答案", "Preference has no answer key")}</span></footer>
    {notice && <div className="toast" role="status"><span>{notice}</span><IconButton title={t("关闭提示", "Dismiss")} onClick={() => setNotice("")}><X size={16} /></IconButton></div>}
    {accountOpen && <div className="modal-backdrop" onClick={() => setAccountOpen(false)}><section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="account-heading" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setAccountOpen(false); }}><div className="section-heading"><h2 id="account-heading">{t("账号与同步", "Account & sync")}</h2><IconButton title={t("关闭", "Close")} onClick={() => setAccountOpen(false)}><X size={18} /></IconButton></div>
      {accountEmail && needNickname ? <>
        <p style={{ marginBottom: 12 }}>{t("请设置你的昵称", "Please set your nickname")}</p>
        <input type="text" placeholder={t("昵称", "Nickname")} value={authNickname} onChange={(e) => setAuthNickname(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void saveNickname(); }} style={{ marginBottom: 12 }} autoFocus />
        <button className="button primary" disabled={busy || !authNickname.trim()} onClick={() => void saveNickname()}>{t("确认昵称", "Set nickname")}</button>
      </> : accountEmail ? <>
        {editingRankIdx === -1 ? <div style={{ display: "flex", gap: 4, alignItems: "center", marginBottom: 8 }}><input type="text" value={editingRankTitle} onChange={(e) => setEditingRankTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void saveNickname(); if (e.key === "Escape") setEditingRankIdx(null); }} style={{ fontSize: 14, padding: "4px 8px", minHeight: "auto" }} autoFocus /><button className="text-button" onClick={() => void saveNickname()} style={{ color: "var(--accent)", fontSize: 13, padding: "4px 8px" }}>✓</button></div> : <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}><p style={{ fontWeight: 600, margin: 0 }}>{accountNickname || accountEmail}</p><button onClick={() => { setEditingRankIdx(-1); setEditingRankTitle(accountNickname); }} style={{ fontSize: 10, color: "var(--muted)", background: "none", border: "1px solid var(--line)", borderRadius: 4, padding: "1px 6px", cursor: "pointer" }}>{t("改名", "Edit")}</button></div>}
        <p style={{ marginBottom: 12, fontSize: 12, color: "var(--muted)" }}>{accountEmail}</p>
        <button className="button secondary" disabled={busy} onClick={accountLoad}><CloudDownload size={16} />{t("从云端读取画像", "Load cloud profile")}</button>
        {cloudProfile && <button className="button secondary" onClick={() => { persist(cloudProfile); setAccountOpen(false); setView("profile"); }}>{t("使用云端画像", "Use cloud profile")}<Check size={16} /></button>}
        <button className="button secondary" disabled={busy || !profile} onClick={accountSave}><CloudUpload size={16} />{t("保存本地画像到云端", "Save to cloud")}</button>
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
      <button className="button quiet" onClick={() => setAccountOpen(false)}><UserRound size={16} />{t("继续使用游客模式", "Continue as guest")}</button>
    </section></div>}
  </div>;
}

function IconButton({ title, children, onClick, disabled = false }: { title: string; children: ReactNode; onClick: (event: React.MouseEvent) => void; disabled?: boolean }) {
  return <button className="icon-button" aria-label={title} title={title} onClick={onClick} disabled={disabled}>{children}<span className="tooltip" role="tooltip">{title}</span></button>;
}
