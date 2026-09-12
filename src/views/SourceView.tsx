import { useEffect, useState } from "react";
import { ArrowRight, ChevronRight, Download, Library, Lock, Plus, Search, Trash2, Upload, X } from "lucide-react";
import { Poster } from "../components/Poster";
import { IconButton } from "./IconButton";
import { heading } from "./helpers";
import { MAX_PROFILE_BYTES } from "../lib/profile";
import type { SourceViewProps } from "./types";

import type { Artwork } from "../data/media";

interface NeteasePlaylistInfo { id: number; name: string; track_count: number; cover?: string; special?: boolean }
type QrState = "waiting" | "scanned" | "confirmed" | "expired" | "risk";
const AUTH = (token: string) => ({ authorization: `Bearer ${token}` });

export function SourceView({ setAccountOpen, kind, t, label, source, setSource, setNotice, search, setSearch, colCount, changeCols, collections, openCollection, customItem, setCustomItem, customWorks, searchWorks, addCustomWork, removeCustomWork, clearCustomWorks, loadCustomWorks, accountToken, importDoulist, importNeteasePlaylist, customText, setCustomText, importCollection, saveCollectionCloud, cloudCollections, loadCloudCollections, deleteCloudCollection, doubanLimit, setDoubanLimit, busy, loadDouban }: SourceViewProps) {
  const [suggestions, setSuggestions] = useState<Artwork[]>([]);
  const [searching, setSearching] = useState(false);
  const [doulistUrl, setDoulistUrl] = useState("");
  const [neteaseUrl, setNeteaseUrl] = useState("");
  const [neteaseConnected, setNeteaseConnected] = useState<boolean | null>(null);
  const [myPlaylists, setMyPlaylists] = useState<NeteasePlaylistInfo[]>([]);
  const [loadingMine, setLoadingMine] = useState(false);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrImage, setQrImage] = useState("");
  const [qrUnikey, setQrUnikey] = useState("");
  const [qrState, setQrState] = useState<QrState>("waiting");
  const [qrError, setQrError] = useState("");
  const [helpOpen, setHelpOpen] = useState(false);
  const [cookieOpen, setCookieOpen] = useState(false);
  const [cookieText, setCookieText] = useState("");
  const [cookieBusy, setCookieBusy] = useState(false);

  // 网易云连接状态（音乐媒介 + 登录用户时检查）
  useEffect(() => {
    if (source !== "custom" || kind !== "music" || !accountToken) return;
    void (async () => {
      try {
        const response = await fetch("/api/netease/status", { headers: AUTH(accountToken) });
        const data = await response.json() as { connected?: boolean };
        const connected = !!data.connected;
        setNeteaseConnected(connected);
        if (connected) void loadMyPlaylists();
      } catch { setNeteaseConnected(false); }
    })();
  }, [source, kind, accountToken]);

  // 扫码轮询：每 3 秒一次；风控码（risk）需连续 3 次约 9 秒才判定失败，给瞬时误判留出冗余
  useEffect(() => {
    if (!qrOpen || !qrUnikey || qrState === "confirmed" || qrState === "expired") return;
    let riskHits = 0;
    const timer = setInterval(async () => {
      try {
        const response = await fetch(`/api/netease/qr/poll?unikey=${encodeURIComponent(qrUnikey)}`, { headers: AUTH(accountToken) });
        const data = await response.json() as { state?: QrState; error?: string };
        if (data.state === "risk") {
          riskHits += 1;
          if (riskHits >= 3) {
            if (data.error) { setQrError(data.error); setNotice(data.error); }
            setQrState("expired");
          } else if (data.error) {
            setQrError(`${data.error}（第 ${riskHits}/3 次，正在重试…）`);
          }
          return;
        }
        riskHits = 0;
        if (data.error) { setQrError(data.error); setNotice(data.error); }
        if (data.state) setQrState(data.state);
        if (data.state === "confirmed") {
          setNeteaseConnected(true);
          setTimeout(() => { setQrOpen(false); void loadMyPlaylists(); }, 900);
        }
      } catch { /* 下次轮询重试 */ }
    }, 3000);
    return () => clearInterval(timer);
  }, [qrOpen, qrUnikey, qrState, accountToken]);

  async function openQr() {
    setQrOpen(true); setQrImage(""); setQrUnikey(""); setQrState("waiting"); setQrError("");
    try {
      const response = await fetch("/api/netease/qr/issue", { headers: AUTH(accountToken) });
      const data = await response.json() as { unikey?: string; qr_value?: string };
      if (!data.unikey || !data.qr_value) throw new Error();
      const QRCode = await import("qrcode");
      setQrImage(await QRCode.default.toDataURL(data.qr_value, { width: 220, margin: 1 }));
      setQrUnikey(data.unikey);
    } catch { setQrState("expired"); }
  }

  async function loadMyPlaylists() {
    setLoadingMine(true);
    try {
      const response = await fetch("/api/import/netease/mine", { headers: AUTH(accountToken) });
      const data = await response.json() as { playlists?: NeteasePlaylistInfo[]; msg?: string };
      if (!response.ok) { setNotice(data.msg ?? t("加载歌单失败。", "Failed to load playlists.")); setNeteaseConnected(response.status !== 401 ? neteaseConnected : false); return; }
      setMyPlaylists(data.playlists ?? []);
    } catch { setNotice(t("加载歌单失败。", "Failed to load playlists.")); }
    finally { setLoadingMine(false); }
  }

  async function disconnectNetease() {
    try { await fetch("/api/netease/disconnect", { method: "POST", headers: AUTH(accountToken) }); } catch {}
    setNeteaseConnected(false);
    setMyPlaylists([]);
    setNotice(t("已断开网易云连接，加密 Cookie 已删除。", "NetEase disconnected. The encrypted cookie has been deleted."));
  }

  async function connectWithCookie() {
    const value = cookieText.trim();
    if (!value || cookieBusy) return;
    setCookieBusy(true);
    try {
      const response = await fetch("/api/netease/cookie", { method: "POST", headers: { ...AUTH(accountToken), "content-type": "application/json" }, body: JSON.stringify({ cookie: value }) });
      const data = await response.json() as { ok?: boolean; msg?: string };
      if (response.ok && data.ok) {
        setNeteaseConnected(true); setCookieOpen(false); setCookieText("");
        setNotice(t("Cookie 连接成功，可以浏览你的歌单了。", "Connected via cookie — your playlists are now available."));
        void loadMyPlaylists();
      } else setNotice(data.msg ?? t("连接失败，请检查粘贴的 Cookie。", "Connection failed — check the pasted cookie."));
    } catch { setNotice(t("连接失败，请稍后重试。", "Connection failed, please retry.")); }
    finally { setCookieBusy(false); }
  }

  async function handleCustomSearch() {
    const query = customItem.trim();
    if (!query) return;
    if (kind === "other") {
      addCustomWork({ id: `manual-${Date.now()}`, title: query });
      setCustomItem("");
      return;
    }
    setSearching(true);
    try {
      const results = await searchWorks(query);
      if (results.length > 0) setSuggestions(results);
      else { addCustomWork({ id: `manual-${Date.now()}`, title: query }); setCustomItem(""); }
    } finally { setSearching(false); }
  }

  function pickSuggestion(work: Artwork) {
    addCustomWork(work);
    setSuggestions([]);
    setCustomItem("");
  }

  return <>
    {heading(`${label(kind)} / ${t("清单", "LIST")}`, t("先选一份清单", "Choose a list"), t("从熟悉的作品开始，或者把自己的收藏带进来。", "Start with a familiar list, or bring your own collection."))}
    <div className="segmented" role="tablist" aria-label={t("清单来源", "List source")}>{(["builtin", "custom", ...(kind === "film" || kind === "book" || kind === "music" ? ["douban"] : [])] as Array<"builtin" | "custom" | "douban">).map((item) => <button key={item} role="tab" aria-selected={source === item} className={source === item ? "active" : ""} onClick={() => { setSource(item); setNotice(""); }}>{item === "builtin" ? t("精选清单", "Curated") : item === "custom" ? t("我的清单", "My list") : t("豆瓣精选", "Douban")}</button>)}</div>
    {source === "builtin" && <><div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}><label className="search-field" style={{ flex: 1, marginBottom: 0 }}><Search size={17} /><input aria-label={t("搜索榜单", "Search collections")} placeholder={t("搜索榜单或作品", "Search collections or works")} value={search} onChange={(event) => setSearch(event.target.value)} /></label><div style={{ display: "flex", gap: 4 }}>{[2,3,4].map(n => <button key={n} onClick={() => changeCols(n)} style={{ width: 32, height: 32, borderRadius: 8, border: colCount === n ? "1px solid var(--accent)" : "1px solid var(--line)", background: colCount === n ? "rgba(216,248,106,.1)" : "transparent", color: colCount === n ? "var(--accent)" : "var(--muted)", fontSize: 12, fontWeight: 600, cursor: "pointer" }}>{n}</button>)}</div></div><div className="collection-list" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>{collections.map((item, index) => <button key={item.id} className="collection-row" onClick={() => openCollection(item)}><span className="row-number">{String(index + 1).padStart(2, "0")}</span>{item.works[0] && <Poster work={item.works[0]} kind={item.kind} />}<div><h3>{item.title}</h3><small>{item.works.length} {t("件作品", "works")}</small></div><ChevronRight size={18} /></button>)}{!collections.length && <p className="empty-state">{t("没有匹配的榜单。", "No matching collections.")}</p>}</div></>}
    {source === "custom" && <section className="import-form">{kind !== "other" && <div className="external-import"><div className="external-import-head"><span className="eyebrow">{accountToken ? t("从外部导入", "IMPORT") : t("从外部导入（登录后可用）", "IMPORT (SIGN-IN REQUIRED)")}</span><button className="help-dot" title={t("使用说明", "How to use")} onClick={() => setHelpOpen(true)}>?</button></div>{!accountToken && <div className="external-import-login"><Lock size={13}/>{t("登录后即可导入豆瓣豆列 / 网易云歌单（含私有歌单与「我喜欢的音乐」）。", "Sign in to import Douban lists and NetEase playlists (private ones included).")}<button className="text-button" onClick={() => setAccountOpen?.(true)}>{t("立即登录 →", "Sign in →")}</button></div>}{accountToken && kind === "music" && <><div className="inline-input"><input value={neteaseUrl} onChange={(event) => setNeteaseUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { void importNeteasePlaylist(neteaseUrl); setNeteaseUrl(""); } }} placeholder={t("粘贴网易云歌单链接或 ID", "Paste a NetEase playlist link or ID")} /><button className="button secondary" disabled={busy || !neteaseUrl.trim()} onClick={() => { void importNeteasePlaylist(neteaseUrl); setNeteaseUrl(""); }}><Download size={16} />{busy ? t("导入中…", "Importing…") : t("导入歌单", "Import playlist")}</button></div><div className="inline-input"><button className="button secondary" disabled={neteaseConnected === true} onClick={() => void openQr()}>{neteaseConnected ? t("已连接网易云 ✓", "NetEase connected ✓") : t("扫码连接网易云", "Connect via QR code")}</button>{neteaseConnected && <button className="text-button" onClick={() => void disconnectNetease()} style={{ color: "var(--muted)", fontSize: 11 }}>{t("断开连接", "Disconnect")}</button>}</div>{!neteaseConnected && <div className="cookie-connect">{cookieOpen ? <><textarea value={cookieText} onChange={(event) => setCookieText(event.target.value)} placeholder={t("粘贴浏览器里 music.163.com 的 Cookie（含 MUSIC_U=…），或只粘贴 MUSIC_U 值", "Paste the cookie of music.163.com from your browser (with MUSIC_U=...), or just the MUSIC_U value")} /><div className="inline-input"><button className="button secondary" disabled={cookieBusy || !cookieText.trim()} onClick={() => void connectWithCookie()}>{cookieBusy ? t("连接中…", "Connecting…") : t("连接", "Connect")}</button><button className="text-button" onClick={() => setCookieOpen(false)}>{t("取消", "Cancel")}</button></div></> : <button className="text-button" onClick={() => setCookieOpen(true)}>{t("扫码被拒？粘贴 Cookie 连接 →", "QR blocked? Connect with a pasted cookie →")}</button>}</div>}{neteaseConnected && <div className="netease-mine"><button className="text-button" disabled={loadingMine} onClick={() => void loadMyPlaylists()} style={{ fontSize: 12 }}>{loadingMine ? t("加载中…", "Loading…") : t("浏览我的歌单 →", "Browse my playlists →")}</button>{myPlaylists.map((playlist) => <div key={playlist.id} className="custom-suggestion">{playlist.cover && <img src={`/api/image?url=${encodeURIComponent(playlist.cover)}`} alt="" style={{ width: 30, height: 30, borderRadius: 4, objectFit: "cover", flexShrink: 0 }} referrerPolicy="no-referrer" />}<div><strong>{playlist.name}</strong><small>{playlist.track_count} 首{playlist.special ? t(" · 我喜欢的音乐", " · Liked music") : ""}</small></div><button className="text-button" disabled={busy} onClick={() => void importNeteasePlaylist(String(playlist.id))} style={{ fontSize: 12, flexShrink: 0 }}>{t("导入", "Import")}</button></div>)}</div>}</>}{accountToken && kind !== "music" && <div className="inline-input"><input value={doulistUrl} onChange={(event) => setDoulistUrl(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") { void importDoulist(doulistUrl); setDoulistUrl(""); } }} placeholder={t("粘贴豆瓣豆列链接，如 douban.com/doulist/12345", "Paste a Douban doulist link, e.g. douban.com/doulist/12345")} /><button className="button secondary" disabled={busy || !doulistUrl.trim()} onClick={() => { void importDoulist(doulistUrl); setDoulistUrl(""); }}><Download size={16} />{busy ? t("导入中…", "Importing…") : t("导入豆列", "Import doulist")}</button></div>}{accountToken && <p className="mini-note">{kind === "music" ? t("抓取整份歌单（歌名/歌手/专辑封面）。也可切换到电影/书籍导入豆瓣豆列。", "Imports the full playlist (titles/artists/covers). Switch to Film/Book to import a Douban doulist.") : t("抓取整份豆列（标题/创作者/年份/评分/海报），自动加入当前媒介的作品；其他媒介可切换后重新导入。", "Imports the full doulist (title/creator/year/rating/poster) for the current medium; switch media and re-import for the rest.")}</p>}</div>}<label htmlFor="custom-item">{kind === "other" ? t("快速添加一件作品", "Add one work") : t("搜索并添加作品（输入后回车）", "Search and add works (press Enter)")}</label><div className="inline-input"><input id="custom-item" value={customItem} onChange={(event) => setCustomItem(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") void handleCustomSearch(); }} placeholder={kind === "other" ? t("输入标题后回车", "Type a title and press Enter") : t("输入标题后回车搜索，选候选加入", "Type and press Enter to search")} /><button className="button secondary" disabled={searching || !customItem.trim()} onClick={() => void handleCustomSearch()}>{searching ? t("搜索中…", "Searching…") : kind === "other" ? <><Plus size={16} />{t("加入清单", "Add")}</> : <><Search size={16} />{t("搜索", "Search")}</>}</button></div>{suggestions.length > 0 && <div className="custom-suggestions"><span className="eyebrow">{t("搜索候选 — 点选加入", "PICK A MATCH")}</span>{suggestions.map((work) => <button key={work.id} className="custom-suggestion" onClick={() => pickSuggestion(work)}><Poster work={work} kind={kind} /><div><strong>{work.title}</strong><small>{work.creator} {work.year}</small></div><Plus size={15} /></button>)}<button className="custom-suggestion custom-suggestion-fallback" onClick={() => pickSuggestion({ id: `manual-${Date.now()}`, title: customItem.trim() })}><Library size={14} />{t("都不是？仅以标题加入", "None of these — add title only")}</button></div>}{customWorks.length > 0 && <div className="custom-added"><div className="cloud-collections-heading"><span className="eyebrow">{t("已添加作品", "ADDED WORKS")}</span><span style={{ fontSize: 12, color: "var(--muted)" }}>{customWorks.length} {t("件", "")}</span><button className="text-button" onClick={clearCustomWorks} style={{ fontSize: 11, color: "var(--muted)" }}>{t("清空", "Clear")}</button></div><div className="custom-added-grid">{customWorks.map((work) => <div key={work.id} className="custom-added-item"><Poster work={work} kind={kind} /><span title={work.title}>{work.title}</span><IconButton title={`${t("移除", "Remove")} ${work.title}`} onClick={() => removeCustomWork(work.id)}><X size={12} /></IconButton></div>)}</div><button className="button primary" disabled={customWorks.length < 2} onClick={loadCustomWorks}>{customWorks.length < 2 ? t("至少添加 2 件作品", "Add at least 2 works") : t("载入并开始排序", "Load and start ranking")}<ArrowRight size={16} /></button></div>}<details className="advanced-import"><summary>{t("批量导入（TXT / JSON / 粘贴清单）", "Batch import (TXT / JSON / paste)")}</summary><div className="advanced-import-body"><label htmlFor="custom-list">{t("批量清单", "Batch list")}</label><textarea id="custom-list" value={customText} onChange={(event) => setCustomText(event.target.value)} placeholder={t("每行一件，也支持逗号、TXT 或 JSON", "One work per line, commas, TXT, or JSON")} /><div className="action-row"><label className="button secondary file-button"><Upload size={16} />{t("打开 TXT / JSON", "Open TXT / JSON")}<input type="file" aria-label={t("导入作品清单", "Import collection")} accept=".txt,.json,text/plain,application/json" onChange={async (event) => { const file = event.target.files?.[0]; if (file && file.size <= MAX_PROFILE_BYTES) setCustomText(await file.text()); else if (file) setNotice(t("文件超过 512 KB。", "File exceeds 512 KB.")); event.target.value = ""; }} /></label><button className="button primary" onClick={() => { try { const next = importCollection(kind, customText); openCollection(next); void saveCollectionCloud(next); } catch { setNotice(t("请输入 2–300 件有效作品，或检查 JSON 格式。", "Enter 2–300 valid works, or check the JSON format.")); } }}>{t("载入并开始", "Load collection")}<ArrowRight size={16} /></button></div></div></details>{cloudCollections.filter((item) => item.kind === kind).length > 0 && <div className="cloud-collections"><div className="cloud-collections-heading"><span className="eyebrow">{t("我的云端清单", "MY CLOUD LISTS")}</span><button className="text-button" onClick={() => void loadCloudCollections()}>{t("刷新", "Refresh")}</button></div>{cloudCollections.filter((item) => item.kind === kind).map((item) => <div className="cloud-collection-row" key={item.id}><button className="collection-row" onClick={() => openCollection(item)}><span className="row-number">☁</span><div><strong>{item.title}</strong><small>{item.works.length} {t("件作品", "works")}</small></div><ChevronRight size={16} /></button><IconButton title={`${t("删除云端清单", "Delete cloud list")} ${item.title}`} onClick={() => void deleteCloudCollection(item)}><Trash2 size={15} /></IconButton></div>)}</div>}</section>}
    {source === "douban" && <section className="douban-source"><span className="eyebrow">{kind === "book" ? "DOUBAN / BOOKS" : kind === "music" ? "DOUBAN / MUSIC" : "DOUBAN / TOP 250"}</span><h2>{kind === "book" ? t("豆瓣读书 Top250", "Douban Book Top250") : kind === "music" ? t("豆瓣音乐 Top250", "Douban Music Top250") : t("豆瓣电影 Top250", "Douban Film Top250")}</h2><label htmlFor="douban-limit">{t("候选范围", "Candidate range")}</label><select id="douban-limit" value={doubanLimit} onChange={(event) => setDoubanLimit(Number(event.target.value))}>{[25, 50, 100, 250].map((n) => <option value={n} key={n}>Top {n}</option>)}</select><button className="button primary" disabled={busy} onClick={loadDouban}><Download size={16} />{busy ? t("正在读取…", "Loading…") : t("读取榜单", "Load collection")}</button></section>}
      {qrOpen && <div className="modal-backdrop" onClick={() => { setQrOpen(false); setQrUnikey(""); }}><section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="netease-qr-heading" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") { setQrOpen(false); setQrUnikey(""); } }}><div className="section-heading"><div><span className="eyebrow">NETEASE</span><h2 id="netease-qr-heading">{t("扫码连接网易云音乐", "Connect NetEase via QR")}</h2></div><IconButton title={t("关闭", "Close")} onClick={() => { setQrOpen(false); setQrUnikey(""); }}><X size={18} /></IconButton></div><div style={{ display: "grid", placeItems: "center", gap: 12 }}>{qrImage ? <img src={qrImage} alt={t("网易云音乐登录二维码", "NetEase login QR code")} style={{ width: 220, height: 220, background: "#fff", padding: 10, borderRadius: 10 }} /> : <div className="loading" style={{ width: 220, height: 220 }}>{t("正在生成二维码…", "Generating QR…")}</div>}<p style={{ fontSize: 13, color: qrState === "confirmed" ? "var(--green)" : "var(--muted)", margin: 0, textAlign: "center" }}>{qrState === "waiting" ? t("请使用网易云音乐 App 扫码", "Scan with the NetEase Cloud Music app") : qrState === "scanned" ? t("已扫码，请在手机上确认登录", "Scanned — confirm on your phone") : qrState === "confirmed" ? t("连接成功！", "Connected!") : (qrError || t("二维码已过期", "QR code expired"))}</p>{qrState === "expired" && <button className="button secondary" onClick={() => void openQr()}>{t("重新生成二维码", "Regenerate QR")}</button>}<p className="mini-note" style={{ textAlign: "center", margin: 0 }}>{t("授权 Cookie 以 AES-GCM 加密存储，仅用于导入你的歌单，可随时断开删除。", "The authorized cookie is stored AES-GCM encrypted, used only to import your playlists, and can be disconnected anytime.")}</p></div></section></div>}
    {helpOpen && <div className="modal-backdrop" onClick={() => setHelpOpen(false)}><section className="account-dialog" role="dialog" aria-modal="true" aria-labelledby="ext-help-heading" style={{ width: "min(560px, 100%)" }} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setHelpOpen(false); }}><div className="section-heading"><div><span className="eyebrow">HELP</span><h2 id="ext-help-heading">{t("外部导入使用说明", "How external import works")}</h2></div><IconButton title={t("关闭", "Close")} onClick={() => setHelpOpen(false)}><X size={18} /></IconButton></div><ol className="help-steps"><li><strong>{t("公开歌单 · 无需连接", "Public playlist · no connect")}</strong>{t("直接粘贴网易云歌单链接（music.163.com/playlist?id=…）或纯 ID，点「导入歌单」即可。", "Paste a NetEase playlist link (music.163.com/playlist?id=...) or its ID, then Import — no sign-in to NetEase needed.")}</li><li><strong>{t("私有歌单 / 我喜欢的音乐 · 先连接", "Private playlists · connect first")}</strong>{t("点「扫码连接网易云」，用网易云音乐 App 扫码并在手机上确认。连接后即可「浏览我的歌单」一键导入。", "Tap Connect via QR, scan with the NetEase app and confirm on your phone. Then Browse my playlists shows everything you own.")}</li><li><strong>{t("扫码被拒怎么办", "If QR is blocked")}</strong>{t("提示「网易云拒绝了本次登录」是网易云对当前网络环境的风控，与你的账号无关。可稍后再试、更换网络（如手机热点），或改用「粘贴 Cookie 连接」。", "A rejected QR is NetEase risk-control on this network, not your account. Wait a while, switch networks, or use Connect with a pasted cookie instead.")}</li><li><strong>{t("如何获取 Cookie", "Getting the cookie")}</strong>{t("电脑浏览器登录 music.163.com → F12 开发者工具 → Network 标签 → 刷新页面点任意请求 → 在 Request Headers 的 cookie 里找到 MUSIC_U=… → 复制整段 cookie 或仅 MUSIC_U 值，粘贴后点「连接」。", "Log in to music.163.com in a desktop browser → F12 → Network tab → reload → open any request → copy MUSIC_U=... from the cookie request header (whole cookie works too) → paste and Connect.")}</li><li><strong>{t("豆瓣豆列", "Douban doulist")}</strong>{t("切换到电影/书籍/其他媒介，粘贴 douban.com/doulist/… 链接即可抓取整份豆列。", "Switch to Film/Book, paste a douban.com/doulist/... link to import the full list.")}</li><li><strong>{t("隐私", "Privacy")}</strong>{t("Cookie 以 AES-GCM 加密存储，仅用于读取你的歌单；点「断开连接」立即删除。", "Cookies are AES-GCM encrypted, used only to read your playlists, and deleted the moment you disconnect.")}</li></ol></section></div>}
  </>;
}
