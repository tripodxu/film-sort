import { useState } from "react";
import {
  ArrowRight,
  Bookmark,
  Check,
  ChevronDown,
  ChevronRight,
  Download,
  Library,
  Lock,
  Plus,
  Search,
  Trash2,
  Upload,
  X,
} from "lucide-react";
import { Poster } from "../components/Poster";
import { Modal } from "../components/Modal";
import { QrConnectModal } from "../components/QrConnectModal";
import { usePlatformConnect } from "../lib/usePlatformConnect";
import { IconButton } from "./IconButton";
import { heading } from "./helpers";
import { MAX_PROFILE_BYTES } from "../lib/profile";
import type { SourceViewProps } from "./types";

import type { Artwork } from "../data/mediaKinds";

interface NeteasePlaylistInfo {
  id: number;
  name: string;
  track_count: number;
  cover?: string;
  special?: boolean;
  subscribed?: boolean;
}
const AUTH = (token: string) => ({ authorization: `Bearer ${token}` });

export function SourceView({
  setAccountOpen,
  kind,
  t,
  label,
  source,
  setSource,
  setNotice,
  search,
  setSearch,
  colCount,
  changeCols,
  collections,
  openCollection,
  customItem,
  setCustomItem,
  customWorks,
  customDeselected,
  setCustomDeselected,
  importProgress,
  searchWorks,
  addCustomWork,
  removeCustomWork,
  clearCustomWorks,
  loadCustomWorks,
  saveCustomWorks,
  accountToken,
  importDoulist,
  importNeteasePlaylist,
  customText,
  setCustomText,
  importCollection,
  saveCollectionCloud,
  cloudCollections,
  loadCloudCollections,
  deleteCloudCollection,
  doubanLimit,
  setDoubanLimit,
  busy,
  loadDouban,
}: SourceViewProps) {
  const [suggestions, setSuggestions] = useState<Artwork[]>([]);
  const [searching, setSearching] = useState(false);
  const [searchFallback, setSearchFallback] = useState<string | null>(null);
  const [worksCollapsed, setWorksCollapsed] = useState(false);
  const [doulistUrl, setDoulistUrl] = useState("");
  const [neteaseUrl, setNeteaseUrl] = useState("");
  const [loadingMine, setLoadingMine] = useState(false);
  const [browseUid, setBrowseUid] = useState("");
  const [browsePlaylists, setBrowsePlaylists] = useState<NeteasePlaylistInfo[] | null>(null);
  const [browseBlocked, setBrowseBlocked] = useState(false);
  const [loadingBrowse, setLoadingBrowse] = useState(false);
  const [helpOpen, setHelpOpen] = useState(false);

  const ne = usePlatformConnect({
    platform: "netease",
    active: source === "custom" && kind === "music",
    accountToken,
    t,
    setNotice,
    onConnected: () => void loadMyPlaylists(),
    onDisconnected: () => setBrowsePlaylists(null),
  });
  const db = usePlatformConnect({
    platform: "douban",
    active: source === "custom" && kind !== "music" && kind !== "other",
    accountToken,
    t,
    setNotice,
  });

  const neteaseConnected = ne.connected;
  const accountInfo = ne.accountInfo;
  const { cookieOpen, setCookieOpen, cookieText, setCookieText, cookieBusy, connectWithCookie } =
    ne;
  const dbConnected = db.connected;
  const dbAccount = db.accountInfo;
  const {
    cookieOpen: dbCookieOpen,
    setCookieOpen: setDbCookieOpen,
    cookieText: dbCookieText,
    setCookieText: setDbCookieText,
    cookieBusy: dbCookieBusy,
    connectWithCookie: dbConnectWithCookie,
  } = db;
  const openQr = () => void ne.openQr();
  const openDbQr = () => void db.openQr();
  const disconnectNetease = () => void ne.disconnect();
  const disconnectDouban = () => void db.disconnect();

  async function loadMyPlaylists() {
    setLoadingMine(true);
    try {
      const response = await fetch("/api/import/netease/mine", { headers: AUTH(accountToken) });
      const data = (await response.json()) as {
        playlists?: NeteasePlaylistInfo[];
        uid?: number;
        blocked?: boolean;
        msg?: string;
      };
      if (!response.ok) {
        setNotice(data.msg ?? t("加载歌单失败。", "Failed to load playlists."));
        ne.setConnected(response.status !== 401 ? neteaseConnected : false);
        return;
      }
      // 与「按 UID 浏览」共用同一列表：连接后直接展示我的全部歌单（含收藏）
      setBrowsePlaylists(data.playlists ?? []);
      setBrowseBlocked(!!data.blocked);
      if (data.uid) setBrowseUid(String(data.uid));
    } catch {
      setNotice(t("加载歌单失败。", "Failed to load playlists."));
    } finally {
      setLoadingMine(false);
    }
  }

  // 按用户 ID 浏览任意用户的公开歌单（无需连接网易云）
  async function browseUserPlaylists(presetUid?: string) {
    const raw = (presetUid ?? browseUid).trim();
    // 支持直接粘贴个人主页链接（music.163.com/user/home?id=… 或 /user/playlist?id=…）
    const linkMatch = raw.match(/user\/(?:home|playlist)\?id=(\d{1,13})/);
    const uid = /^\d{1,13}$/.test(raw) ? raw : (linkMatch?.[1] ?? "");
    if (!uid) {
      setNotice(
        t(
          "请输入网易云用户 ID（个人主页 URL 里的纯数字），或直接粘贴主页链接",
          "Enter a numeric NetEase user ID (from their profile URL), or paste the profile link",
        ),
      );
      return;
    }
    if (presetUid) setBrowseUid(uid);
    setLoadingBrowse(true);
    setBrowseBlocked(false);
    try {
      const response = await fetch(`/api/netease/user-playlists?uid=${encodeURIComponent(uid)}`, {
        headers: AUTH(accountToken),
      });
      const data = (await response.json()) as {
        playlists?: NeteasePlaylistInfo[];
        blocked?: boolean;
        msg?: string;
        error?: string;
      };
      if (!response.ok) {
        setNotice(data.msg ?? data.error ?? t("加载失败。", "Failed to load."));
        setBrowsePlaylists(null);
        return;
      }
      setBrowsePlaylists(data.playlists ?? []);
      setBrowseBlocked(!!data.blocked);
    } catch {
      setNotice(t("加载失败，请稍后重试。", "Failed to load. Please retry."));
      setBrowsePlaylists(null);
    } finally {
      setLoadingBrowse(false);
    }
  }

  async function handleCustomSearch() {
    const query = customItem.trim();
    if (!query || searching) return;
    setSearching(true);
    setSearchFallback(null);
    let timer: number | undefined;
    try {
      const results = await Promise.race([
        searchWorks(query),
        new Promise<Artwork[]>((_, reject) => {
          timer = window.setTimeout(() => reject(new Error("search_timeout")), 8000);
        }),
      ]);
      if (results.length > 0) {
        setSuggestions(results);
      } else {
        setSearchFallback(query);
      }
    } catch {
      setSearchFallback(query);
    } finally {
      if (timer !== undefined) window.clearTimeout(timer);
      setSearching(false);
    }
  }

  function pickSuggestion(work: Artwork) {
    addCustomWork(work);
    setSuggestions([]);
    setCustomItem("");
  }

  return (
    <>
      {heading(
        `${label(kind)} / ${t("清单", "LIST")}`,
        t("先选一份清单", "Choose a list"),
        t(
          "从熟悉的作品开始，或者把自己的收藏带进来。",
          "Start with a familiar list, or bring your own collection.",
        ),
      )}
      <div className="segmented" role="tablist" aria-label={t("清单来源", "List source")}>
        {(
          [
            "builtin",
            "custom",
            ...(kind === "film" || kind === "book" || kind === "music" ? ["douban"] : []),
          ] as Array<"builtin" | "custom" | "douban">
        ).map((item) => (
          <button
            key={item}
            role="tab"
            aria-selected={source === item}
            className={source === item ? "active" : ""}
            onClick={() => {
              setSource(item);
              setNotice("");
            }}
          >
            {item === "builtin"
              ? t("精选清单", "Curated")
              : item === "custom"
                ? t("我的清单", "My list")
                : t("豆瓣精选", "Douban")}
          </button>
        ))}
      </div>
      {source === "builtin" && (
        <>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
            <label className="search-field" style={{ flex: 1, marginBottom: 0 }}>
              <Search size={17} />
              <input
                aria-label={t("搜索榜单", "Search collections")}
                placeholder={t("搜索榜单或作品", "Search collections or works")}
                value={search}
                onChange={(event) => setSearch(event.target.value)}
              />
            </label>
            <div style={{ display: "flex", gap: 4 }}>
              {[2, 3, 4].map((n) => (
                <button
                  key={n}
                  onClick={() => changeCols(n)}
                  style={{
                    width: 32,
                    height: 32,
                    borderRadius: 8,
                    border: colCount === n ? "1px solid var(--accent)" : "1px solid var(--line)",
                    background:
                      colCount === n
                        ? "color-mix(in srgb,var(--accent) 10%,transparent)"
                        : "transparent",
                    color: colCount === n ? "var(--accent)" : "var(--muted)",
                    fontSize: 12,
                    fontWeight: 600,
                    cursor: "pointer",
                  }}
                >
                  {n}
                </button>
              ))}
            </div>
          </div>
          <div
            className="collection-list"
            style={{ "--collection-cols": colCount } as React.CSSProperties}
          >
            {collections.map((item, index) => (
              <button key={item.id} className="collection-row" onClick={() => openCollection(item)}>
                <span className="row-number">{String(index + 1).padStart(2, "0")}</span>
                {item.works[0] && <Poster work={item.works[0]} kind={item.kind} />}
                <div>
                  <h3>{item.title}</h3>
                  <small>
                    {item.works.length} {t("件作品", "works")}
                  </small>
                </div>
                <ChevronRight size={18} />
              </button>
            ))}
            {!collections.length && (
              <p className="empty-state">{t("没有匹配的榜单。", "No matching collections.")}</p>
            )}
          </div>
        </>
      )}
      {source === "custom" && (
        <section className="import-form">
          {kind !== "other" && (
            <div className="external-import">
              <div className="external-import-head">
                <span className="eyebrow">
                  {accountToken
                    ? t("从外部导入", "IMPORT")
                    : t("从外部导入（登录后可用）", "IMPORT (SIGN-IN REQUIRED)")}
                </span>
                <button
                  className="help-dot"
                  title={t("使用说明", "How to use")}
                  onClick={() => setHelpOpen(true)}
                >
                  ?
                </button>
              </div>
              {!accountToken && (
                <div className="external-import-login">
                  <Lock size={13} />
                  {t(
                    "登录后即可导入豆瓣豆列 / 网易云歌单（含私有歌单与「我喜欢的音乐」）。",
                    "Sign in to import Douban lists and NetEase playlists (private ones included).",
                  )}
                  <button className="text-button" onClick={() => setAccountOpen?.(true)}>
                    {t("立即登录 →", "Sign in →")}
                  </button>
                </div>
              )}
              {accountToken && kind === "music" && (
                <>
                  <div className="inline-input">
                    <input
                      value={browseUid}
                      onChange={(event) => setBrowseUid(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void browseUserPlaylists();
                      }}
                      placeholder={t(
                        "输入网易云用户 ID 或主页链接，浏览 TA 的全部歌单（含收藏）",
                        "Enter a NetEase user ID or profile link to browse all playlists (including collected)",
                      )}
                    />
                    <button
                      className="button secondary"
                      disabled={loadingBrowse || !browseUid.trim()}
                      onClick={() => void browseUserPlaylists()}
                    >
                      <Search size={16} />
                      {loadingBrowse
                        ? t("查找中…", "Searching…")
                        : t("浏览歌单", "Browse playlists")}
                    </button>
                  </div>
                  {browsePlaylists !== null &&
                    (browseBlocked ? (
                      <p className="mini-note" style={{ margin: "4px 0" }}>
                        {t(
                          "网易云暂时限制了服务器匿名访问。展开下方「连接我的网易云账号」后重试。",
                          "NetEase is blocking anonymous server access right now. Connect your account below and retry.",
                        )}
                      </p>
                    ) : browsePlaylists.length ? (
                      <div className="netease-pl-wrap">
                        <div className="cloud-collections-heading">
                          <span className="eyebrow">{t("歌单列表", "PLAYLISTS")}</span>
                          <span style={{ fontSize: 12, color: "var(--muted)" }}>
                            {browsePlaylists.length} {t("个 · 点右侧导入", "— pick one to import")}
                          </span>
                        </div>
                        <div className="netease-pl-scroll">
                          {browsePlaylists.map((playlist) => (
                            <div key={playlist.id} className="custom-suggestion">
                              {playlist.cover && (
                                <img
                                  src={`/api/image?url=${encodeURIComponent(playlist.cover)}`}
                                  alt=""
                                  style={{
                                    width: 30,
                                    height: 30,
                                    borderRadius: 4,
                                    objectFit: "cover",
                                    flexShrink: 0,
                                  }}
                                  referrerPolicy="no-referrer"
                                />
                              )}
                              <div>
                                <strong>{playlist.name}</strong>
                                <small>
                                  {playlist.track_count} 首
                                  {playlist.special ? t(" · 我喜欢的音乐", " · Liked music") : ""}
                                  {playlist.subscribed ? t(" · 收藏的", " · collected") : ""}
                                </small>
                              </div>
                              <button
                                className="text-button"
                                disabled={busy}
                                onClick={() => void importNeteasePlaylist(String(playlist.id))}
                                style={{ fontSize: 12, flexShrink: 0 }}
                              >
                                {t("导入", "Import")}
                              </button>
                            </div>
                          ))}
                        </div>
                      </div>
                    ) : (
                      <p className="mini-note" style={{ margin: "4px 0" }}>
                        {t("该用户没有公开歌单。", "This user has no public playlists.")}
                      </p>
                    ))}
                  <div className="inline-input">
                    <input
                      value={neteaseUrl}
                      onChange={(event) => setNeteaseUrl(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") {
                          void importNeteasePlaylist(neteaseUrl);
                          setNeteaseUrl("");
                        }
                      }}
                      placeholder={t(
                        "或直接粘贴歌单链接/ID 导入",
                        "…or paste a playlist link/ID to import directly",
                      )}
                    />
                    <button
                      className="button secondary"
                      disabled={busy || !neteaseUrl.trim()}
                      onClick={() => {
                        void importNeteasePlaylist(neteaseUrl);
                        setNeteaseUrl("");
                      }}
                    >
                      <Download size={16} />
                      {busy ? t("导入中…", "Importing…") : t("导入歌单", "Import playlist")}
                    </button>
                  </div>
                  <details className="advanced-import">
                    <summary>
                      {t(
                        "连接我的网易云账号（扫码 / 粘贴 Cookie）· 解锁私有歌单",
                        "Connect my NetEase account (QR / cookie) · unlocks private playlists",
                      )}
                    </summary>
                    <div className="advanced-import-body">
                      <div className="inline-input">
                        <button
                          className="button secondary"
                          disabled={neteaseConnected === true}
                          onClick={() => void openQr()}
                        >
                          {neteaseConnected
                            ? accountInfo?.nickname
                              ? t(
                                  `已连接：${accountInfo.nickname} ✓`,
                                  `Connected: ${accountInfo.nickname} ✓`,
                                )
                              : t("已连接网易云 ✓", "NetEase connected ✓")
                            : t("扫码连接网易云", "Connect via QR code")}
                        </button>
                        {neteaseConnected && (
                          <button
                            className="text-button"
                            onClick={() => void disconnectNetease()}
                            style={{ color: "var(--muted)", fontSize: 11 }}
                          >
                            {t("断开连接", "Disconnect")}
                          </button>
                        )}
                      </div>
                      {!neteaseConnected && (
                        <div className="cookie-connect">
                          {cookieOpen ? (
                            <>
                              <textarea
                                value={cookieText}
                                onChange={(event) => setCookieText(event.target.value)}
                                placeholder={t(
                                  "粘贴浏览器里 music.163.com 的 Cookie（含 MUSIC_U=…），或只粘贴 MUSIC_U 值",
                                  "Paste the cookie of music.163.com from your browser (with MUSIC_U=...), or just the MUSIC_U value",
                                )}
                              />
                              <div className="inline-input">
                                <button
                                  className="button secondary"
                                  disabled={cookieBusy || !cookieText.trim()}
                                  onClick={() => void connectWithCookie()}
                                >
                                  {cookieBusy ? t("连接中…", "Connecting…") : t("连接", "Connect")}
                                </button>
                                <button
                                  className="text-button"
                                  onClick={() => setCookieOpen(false)}
                                >
                                  {t("取消", "Cancel")}
                                </button>
                              </div>
                            </>
                          ) : (
                            <button className="text-button" onClick={() => setCookieOpen(true)}>
                              {t(
                                "扫码被拒？粘贴 Cookie 连接 →",
                                "QR blocked? Connect with a pasted cookie →",
                              )}
                            </button>
                          )}
                        </div>
                      )}
                      {neteaseConnected && (
                        <button
                          className="button secondary"
                          disabled={loadingMine}
                          onClick={() => void loadMyPlaylists()}
                          style={{ alignSelf: "flex-start" }}
                        >
                          <Library size={14} />
                          {loadingMine
                            ? t("加载中…", "Loading…")
                            : t(
                                "浏览我的全部歌单（含收藏）",
                                "Browse all my playlists (incl. collected)",
                              )}
                        </button>
                      )}
                      <p className="mini-note" style={{ margin: 0 }}>
                        {t(
                          "Cookie 以 AES-GCM 加密存储，仅用于读取你的歌单，可随时断开删除。",
                          "Cookies are AES-GCM encrypted, used only to read your playlists, and removable anytime.",
                        )}
                      </p>
                    </div>
                  </details>
                </>
              )}
              {accountToken && kind !== "music" && (
                <div className="inline-input">
                  <input
                    value={doulistUrl}
                    onChange={(event) => setDoulistUrl(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Enter") {
                        void importDoulist(doulistUrl);
                        setDoulistUrl("");
                      }
                    }}
                    placeholder={t(
                      "粘贴豆瓣链接：豆列 / 书单片单(subject_collection) / 我的(mine)，自动识别",
                      "Paste a Douban link: doulist / subject_collection / mine — auto-detected",
                    )}
                  />
                  <button
                    className="button secondary"
                    disabled={busy || !doulistUrl.trim()}
                    onClick={() => {
                      void importDoulist(doulistUrl);
                      setDoulistUrl("");
                    }}
                  >
                    <Download size={16} />
                    {busy ? t("导入中…", "Importing…") : t("导入", "Import")}
                  </button>
                </div>
              )}
              {accountToken && (kind === "film" || kind === "book") && dbConnected && (
                <div className="db-quick">
                  <span className="eyebrow">{t("或一键导入我的豆瓣", "OR IMPORT MY DOUBAN")}</span>
                  <div className="inline-input">
                    <button
                      className="rank-pill"
                      disabled={busy}
                      onClick={() =>
                        void importDoulist(
                          `https://${kind === "book" ? "book" : "movie"}.douban.com/mine?status=wish`,
                        )
                      }
                    >
                      <Bookmark size={13} />
                      {kind === "book"
                        ? t("导入「想读」", "Import Want-to-read")
                        : t("导入「想看」", "Import Want-to-watch")}
                    </button>
                    <button
                      className="rank-pill"
                      disabled={busy}
                      onClick={() =>
                        void importDoulist(
                          `https://${kind === "book" ? "book" : "movie"}.douban.com/mine?status=collect`,
                        )
                      }
                    >
                      <Check size={13} />
                      {kind === "book"
                        ? t("导入「已读」", "Import Read")
                        : t("导入「已看」", "Import Watched")}
                    </button>
                  </div>
                </div>
              )}
              {accountToken && kind !== "music" && (
                <div className="inline-input">
                  <button
                    className="button secondary"
                    disabled={dbConnected === true}
                    onClick={() => void openDbQr()}
                  >
                    {dbConnected
                      ? dbAccount?.nickname
                        ? t(`已连接：${dbAccount.nickname} ✓`, `Connected: ${dbAccount.nickname} ✓`)
                        : t("已连接豆瓣 ✓", "Douban connected ✓")
                      : t("扫码连接豆瓣", "Connect Douban via QR")}
                  </button>
                  {dbConnected && (
                    <button
                      className="text-button"
                      onClick={() => void disconnectDouban()}
                      style={{ color: "var(--muted)", fontSize: 11 }}
                    >
                      {t("断开连接", "Disconnect")}
                    </button>
                  )}
                </div>
              )}
              {accountToken && kind !== "music" && !dbConnected && (
                <div className="cookie-connect">
                  {dbCookieOpen ? (
                    <>
                      <textarea
                        value={dbCookieText}
                        onChange={(event) => setDbCookieText(event.target.value)}
                        placeholder={t(
                          "粘贴浏览器里 douban.com 的 Cookie（含 dbcl2=…），或只粘贴 dbcl2 值",
                          "Paste the cookie of douban.com from your browser (with dbcl2=...), or just the dbcl2 value",
                        )}
                      />
                      <div className="inline-input">
                        <button
                          className="button secondary"
                          disabled={dbCookieBusy || !dbCookieText.trim()}
                          onClick={() => void dbConnectWithCookie()}
                        >
                          {dbCookieBusy ? t("连接中…", "Connecting…") : t("连接", "Connect")}
                        </button>
                        <button className="text-button" onClick={() => setDbCookieOpen(false)}>
                          {t("取消", "Cancel")}
                        </button>
                      </div>
                    </>
                  ) : (
                    <button className="text-button" onClick={() => setDbCookieOpen(true)}>
                      {t(
                        "导入私有豆列？先粘贴 Cookie 连接豆瓣 →",
                        "Private doulist? Connect Douban with a pasted cookie →",
                      )}
                    </button>
                  )}
                </div>
              )}
              {accountToken && (
                <p className="mini-note">
                  {kind === "music"
                    ? t(
                        "抓取整份歌单（歌名/歌手/专辑封面）。也可切换到电影/书籍导入豆瓣豆列。",
                        "Imports the full playlist (titles/artists/covers). Switch to Film/Book to import a Douban doulist.",
                      )
                    : t(
                        "支持三类链接：豆列(doulist)、豆瓣清单(subject_collection)、我的(mine 想看/已看)。mine 与私有豆列需先连接豆瓣。",
                        "Three link types: doulist, subject_collection, and your own mine (wish/collect) lists. Mine & private lists need Douban connected.",
                      )}
                </p>
              )}
            </div>
          )}
          <label htmlFor="custom-item">
            {t("搜索并添加作品（输入后回车）", "Search and add works (press Enter)")}
          </label>
          <div className="inline-input">
            <input
              id="custom-item"
              value={customItem}
              onChange={(event) => setCustomItem(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") void handleCustomSearch();
              }}
              placeholder={
                kind === "other"
                  ? t("输入名称搜索维基百科，选候选加入", "Search Wikipedia and pick a result")
                  : t("输入标题后回车搜索，选候选加入", "Type and press Enter to search")
              }
            />
            <button
              className="button secondary"
              disabled={searching || !customItem.trim()}
              onClick={() => void handleCustomSearch()}
            >
              {searching ? (
                t("搜索中…", "Searching…")
              ) : (
                <>
                  <Search size={16} />
                  {t("搜索", "Search")}
                </>
              )}
            </button>
          </div>
          {searchFallback && suggestions.length === 0 && (
            <div className="u-row-between" style={{ marginTop: 8, gap: 8, flexWrap: "wrap" }}>
              <span className="mini-note" style={{ margin: 0 }}>
                {t(
                  `未搜到「${searchFallback}」或搜索超时，可直接按名称加入。`,
                  `No matches or search timed out for "${searchFallback}" — add by title directly.`,
                )}
              </span>
              <button
                type="button"
                className="button secondary"
                style={{ minHeight: 34, paddingInline: 12, fontSize: 12 }}
                onClick={() => {
                  addCustomWork({ id: `manual-${Date.now()}`, title: searchFallback });
                  setSearchFallback(null);
                  setCustomItem("");
                }}
              >
                <Plus size={14} />
                {t(`直接按名称添加「${searchFallback}」`, `Add "${searchFallback}"`)}
              </button>
            </div>
          )}
          {suggestions.length > 0 && (
            <div className="custom-suggestions">
              <span className="eyebrow">{t("搜索候选 — 点选加入", "PICK A MATCH")}</span>
              {suggestions.map((work) => (
                <button
                  key={work.id}
                  className="custom-suggestion"
                  onClick={() => pickSuggestion(work)}
                >
                  <Poster work={work} kind={kind} />
                  <div>
                    <strong>{work.title}</strong>
                    <small>
                      {work.creator} {work.year}
                    </small>
                  </div>
                  <Plus size={15} />
                </button>
              ))}
              <button
                className="custom-suggestion custom-suggestion-fallback"
                onClick={() =>
                  pickSuggestion({ id: `manual-${Date.now()}`, title: customItem.trim() })
                }
              >
                <Library size={14} />
                {t("都不是？仅以标题加入", "None of these — add title only")}
              </button>
            </div>
          )}
          {importProgress && (
            <div className="import-progress">
              <div className="import-progress-bar">
                <span
                  style={{
                    width: importProgress.total
                      ? `${Math.min(100, (importProgress.done / importProgress.total) * 100)}%`
                      : "50%",
                  }}
                />
              </div>
              <span className="import-progress-text">
                {importProgress.label}{" "}
                {importProgress.total
                  ? `${importProgress.done} / ${importProgress.total}`
                  : `${importProgress.done} …`}
              </span>
            </div>
          )}
          {customWorks.length > 0 && (
            <div className="custom-added">
              <div className="cloud-collections-heading">
                <button
                  className="text-button"
                  onClick={() => setWorksCollapsed((v) => !v)}
                  style={{ gap: 6 }}
                >
                  <ChevronDown
                    size={14}
                    style={{
                      transform: worksCollapsed ? "rotate(-90deg)" : "none",
                      transition: "transform .15s",
                    }}
                  />
                  {t("已添加作品", "ADDED WORKS")}
                </button>
                <label className="check-all">
                  <input
                    type="checkbox"
                    checked={customDeselected.length === 0}
                    onChange={(event) =>
                      setCustomDeselected(event.target.checked ? [] : customWorks.map((w) => w.id))
                    }
                  />
                  {/* 计数写成单个模板串：JSX 的 `{n} / {m}` 会被 Prettier 改写成
                      ` /{" "}`，斜杠前的空格在渲染时丢失（464775b 引入的视觉回归） */}
                  {t("全选", "All")} ·{" "}
                  {`${customWorks.length - customDeselected.length} / ${customWorks.length}`}
                </label>
                <button
                  className="text-button"
                  onClick={clearCustomWorks}
                  style={{ fontSize: 11, color: "var(--muted)" }}
                >
                  {t("清空", "Clear")}
                </button>
              </div>
              {!worksCollapsed && (
                <div className="custom-added-grid custom-added-scroll">
                  {customWorks.map((work) => (
                    <div
                      key={work.id}
                      className={`custom-added-item${customDeselected.includes(work.id) ? " deselected" : ""}`}
                    >
                      <input
                        type="checkbox"
                        checked={!customDeselected.includes(work.id)}
                        onChange={(event) =>
                          setCustomDeselected(
                            event.target.checked
                              ? customDeselected.filter((id) => id !== work.id)
                              : [...customDeselected, work.id],
                          )
                        }
                      />
                      <Poster work={work} kind={kind} />
                      <span title={work.title}>{work.title}</span>
                      <IconButton
                        title={`${t("移除", "Remove")} ${work.title}`}
                        onClick={() => removeCustomWork(work.id)}
                      >
                        <X size={12} />
                      </IconButton>
                    </div>
                  ))}
                </div>
              )}
              <div className="custom-added-actions">
                <button
                  className="button secondary"
                  disabled={busy || customWorks.length - customDeselected.length < 1}
                  onClick={saveCustomWorks}
                >
                  <Check size={16} />
                  {t("仅保存，不排序", "Save only (no ranking)")}
                </button>
                <button
                  className="button primary"
                  disabled={busy || customWorks.length - customDeselected.length < 2}
                  onClick={() =>
                    loadCustomWorks(customWorks.filter((w) => !customDeselected.includes(w.id)))
                  }
                >
                  {customWorks.length - customDeselected.length < 2
                    ? t("至少添加 2 件作品", "Add at least 2 works")
                    : t("载入并开始排序", "Load and start ranking")}
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          )}
          <details className="advanced-import">
            <summary>
              {t("批量导入（TXT / JSON / 粘贴清单）", "Batch import (TXT / JSON / paste)")}
            </summary>
            <div className="advanced-import-body">
              <label htmlFor="custom-list">{t("批量清单", "Batch list")}</label>
              <textarea
                id="custom-list"
                value={customText}
                onChange={(event) => setCustomText(event.target.value)}
                placeholder={t(
                  "每行一件，也支持逗号、TXT 或 JSON",
                  "One work per line, commas, TXT, or JSON",
                )}
              />
              <div className="action-row">
                <label className="button secondary file-button">
                  <Upload size={16} />
                  {t("打开 TXT / JSON", "Open TXT / JSON")}
                  <input
                    type="file"
                    aria-label={t("导入作品清单", "Import collection")}
                    accept=".txt,.json,text/plain,application/json"
                    onChange={async (event) => {
                      const file = event.target.files?.[0];
                      if (file && file.size <= MAX_PROFILE_BYTES) setCustomText(await file.text());
                      else if (file) setNotice(t("文件超过 512 KB。", "File exceeds 512 KB."));
                      event.target.value = "";
                    }}
                  />
                </label>
                <button
                  className="button primary"
                  onClick={() => {
                    try {
                      const next = importCollection(kind, customText);
                      openCollection(next);
                      void saveCollectionCloud(next);
                    } catch {
                      setNotice(
                        t(
                          "请输入 2–300 件有效作品，或检查 JSON 格式。",
                          "Enter 2–300 valid works, or check the JSON format.",
                        ),
                      );
                    }
                  }}
                >
                  {t("载入并开始", "Load collection")}
                  <ArrowRight size={16} />
                </button>
              </div>
            </div>
          </details>
          {cloudCollections.filter((item) => item.kind === kind).length > 0 && (
            <div className="cloud-collections">
              <div className="cloud-collections-heading">
                <span className="eyebrow">{t("我的云端清单", "MY CLOUD LISTS")}</span>
                <button className="text-button" onClick={() => void loadCloudCollections()}>
                  {t("刷新", "Refresh")}
                </button>
              </div>
              {cloudCollections
                .filter((item) => item.kind === kind)
                .map((item) => (
                  <div className="cloud-collection-row" key={item.id}>
                    <button className="collection-row" onClick={() => openCollection(item)}>
                      <span className="row-number">☁</span>
                      <div>
                        <strong>{item.title}</strong>
                        <small>
                          {item.works.length} {t("件作品", "works")}
                        </small>
                      </div>
                      <ChevronRight size={16} />
                    </button>
                    <IconButton
                      title={`${t("删除云端清单", "Delete cloud list")} ${item.title}`}
                      onClick={() => void deleteCloudCollection(item)}
                    >
                      <Trash2 size={15} />
                    </IconButton>
                  </div>
                ))}
            </div>
          )}
        </section>
      )}
      {source === "douban" && (
        <section className="douban-source">
          <span className="eyebrow">
            {kind === "book"
              ? "DOUBAN / BOOKS"
              : kind === "music"
                ? "DOUBAN / MUSIC"
                : "DOUBAN / TOP 250"}
          </span>
          <h2>
            {kind === "book"
              ? t("豆瓣读书 Top250", "Douban Book Top250")
              : kind === "music"
                ? t("豆瓣音乐 Top250", "Douban Music Top250")
                : t("豆瓣电影 Top250", "Douban Film Top250")}
          </h2>
          <label htmlFor="douban-limit">{t("候选范围", "Candidate range")}</label>
          <select
            id="douban-limit"
            value={doubanLimit}
            onChange={(event) => setDoubanLimit(Number(event.target.value))}
          >
            {[25, 50, 100, 250].map((n) => (
              <option value={n} key={n}>
                Top {n}
              </option>
            ))}
          </select>
          <button className="button primary" disabled={busy} onClick={loadDouban}>
            <Download size={16} />
            {busy ? t("正在读取…", "Loading…") : t("读取榜单", "Load collection")}
          </button>
        </section>
      )}
      {db.qrOpen && (
        <QrConnectModal
          t={t}
          eyebrow="DOUBAN"
          title={t("扫码连接豆瓣", "Connect Douban via QR")}
          headingId="douban-qr-heading"
          qrAlt={t("豆瓣登录二维码", "Douban login QR code")}
          qrImage={db.qrImage}
          state={db.qrState}
          error={db.qrError}
          left={db.qrLeft}
          refreshed={db.qrRefreshed}
          hintWaiting={t(
            "打开豆瓣 App → 右上角扫一扫",
            "Open the Douban app → tap Scan (top-right)",
          )}
          hintConfirmed={t("连接成功！正在校验账号…", "Connected! Verifying your account…")}
          onClose={db.closeQr}
          onRefresh={() => void db.autoRefreshQr()}
          fallback={{
            blocked: db.riskBlocked,
            cookieOpen: db.cookieOpen,
            cookieText: db.cookieText,
            cookieBusy: db.cookieBusy,
            title: t("扫码没成功？用 Cookie 直连", "QR didn't work? Connect with your cookie"),
            placeholder: t(
              "粘贴浏览器里 douban.com 的 Cookie（含 dbcl2=…）",
              "Paste the cookie of douban.com (with dbcl2=...)",
            ),
            onTextChange: db.setCookieText,
            onOpenCookie: () => db.setCookieOpen(true),
            onConnectCookie: () => void db.connectWithCookie(),
            onRetryQr: () => {
              db.setCookieOpen(false);
              db.setRiskBlocked(false);
              void db.openQr();
            },
            onOpenHelp: () => setHelpOpen(true),
          }}
          note={t(
            "连接后可导入你的私有豆列；Cookie 以 AES-GCM 加密存储，可随时断开删除。",
            "Connecting enables private doulists. The cookie is AES-GCM encrypted and removable anytime.",
          )}
        />
      )}
      {ne.qrOpen && (
        <QrConnectModal
          t={t}
          eyebrow="NETEASE"
          title={t("扫码连接网易云音乐", "Connect NetEase via QR")}
          headingId="netease-qr-heading"
          qrAlt={t("网易云音乐登录二维码", "NetEase login QR code")}
          qrImage={ne.qrImage}
          state={ne.qrState}
          error={ne.qrError}
          left={ne.qrLeft}
          refreshed={ne.qrRefreshed}
          scanned={ne.qrScanned}
          hintWaiting={t(
            "打开网易云音乐 App → 左上角扫一扫",
            "Open the NetEase app → tap Scan (top-left)",
          )}
          hintConfirmed={t("连接成功！正在加载你的歌单…", "Connected! Loading your playlists…")}
          onClose={ne.closeQr}
          onRefresh={() => void ne.autoRefreshQr()}
          fallback={{
            blocked: ne.riskBlocked,
            cookieOpen: ne.cookieOpen,
            cookieText: ne.cookieText,
            cookieBusy: ne.cookieBusy,
            title: t(
              "被网易云风控拦住了？用 Cookie 直连（成功率 100%）",
              "Blocked by risk-control? Connect with your cookie (always works)",
            ),
            placeholder: t(
              "粘贴浏览器里 music.163.com 的 Cookie（含 MUSIC_U=…），或只粘贴 MUSIC_U 值",
              "Paste the cookie of music.163.com from your browser (with MUSIC_U=...), or just the MUSIC_U value",
            ),
            onTextChange: ne.setCookieText,
            onOpenCookie: () => ne.setCookieOpen(true),
            onConnectCookie: () => void ne.connectWithCookie(),
            onRetryQr: () => {
              ne.setCookieOpen(false);
              ne.setRiskBlocked(false);
              void ne.openQr();
            },
            onOpenHelp: () => setHelpOpen(true),
          }}
          note={t(
            "授权 Cookie 以 AES-GCM 加密存储，仅用于导入你的歌单，可随时断开删除。",
            "The authorized cookie is stored AES-GCM encrypted, used only to import your playlists, and can be disconnected anytime.",
          )}
        />
      )}
      {helpOpen && (
        <Modal
          t={t}
          headingId="ext-help-heading"
          eyebrow="HELP"
          title={t("外部导入使用说明", "How external import works")}
          panelStyle={{ width: "min(560px, 100%)" }}
          onClose={() => setHelpOpen(false)}
        >
          <ol className="help-steps">
            <li>
              <strong>{t("网易云 · 按用户浏览", "NetEase · browse by user")}</strong>
              {t(
                "输入任意用户的网易云 ID（个人主页 URL 里的数字）或粘贴主页链接，即可列出 TA 的全部歌单（含收藏的），点「导入」抓取整单歌曲。也可直接粘贴歌单链接/ID。",
                "Enter any user's NetEase ID (the number in their profile URL) or paste the profile link to list all their playlists (including collected), then Import to fetch the songs. You can also paste a playlist link/ID directly.",
              )}
            </li>
            <li>
              <strong>{t("连接账号（可选）", "Connect account · optional")}</strong>
              {t(
                "展开「连接我的网易云账号」可扫码或粘贴 Cookie：连接后能浏览自己的全部歌单（含私有与收藏），并导入他人看不到的私有歌单。若服务器匿名访问被网易云限制，连接后即可恢复。",
                "Expand Connect my NetEase account (QR or cookie): once connected you can browse your own full playlist list (private & collected included) and import private playlists. If anonymous server access is blocked, connecting restores it.",
              )}
            </li>
            <li>
              <strong>{t("扫码被拒怎么办", "If QR is blocked")}</strong>
              {t(
                "提示「网易云拒绝了本次登录」是网易云对当前网络环境的风控，与你的账号无关。可稍后再试、更换网络（如手机热点），或改用「粘贴 Cookie 连接」。",
                "A rejected QR is NetEase risk-control on this network, not your account. Wait a while, switch networks, or use Connect with a pasted cookie instead.",
              )}
            </li>
            <li>
              <strong>{t("如何获取 Cookie", "Getting the cookie")}</strong>
              {t(
                "电脑浏览器登录对应网站（music.163.com 或 douban.com）→ F12 开发者工具 → Network 标签 → 刷新页面点任意请求 → 在 Request Headers 的 cookie 里找到 MUSIC_U=…（网易云）或 dbcl2=…（豆瓣）→ 复制整段 cookie 或该值，粘贴后点「连接」。",
                "Log in to the site (music.163.com or douban.com) in a desktop browser → F12 → Network tab → reload → open any request → copy MUSIC_U=... (NetEase) or dbcl2=... (Douban) from the cookie header → paste and Connect.",
              )}
            </li>
            <li>
              <strong>{t("豆瓣豆列", "Douban doulist")}</strong>
              {t(
                "电影/书籍/其他媒介均可：粘贴豆列(doulist/…)、豆瓣清单(m.douban.com/subject_collection/…) 链接直接导入；连接豆瓣后还能一键导入自己的「想看/已看」「想读/已读」，或粘贴 mine?status=… 链接。",
                "Paste a doulist or subject_collection link to import directly. Once connected to Douban, one-tap import your own wish/collect lists (movie & book).",
              )}
            </li>
            <li>
              <strong>{t("隐私", "Privacy")}</strong>
              {t(
                "Cookie 以 AES-GCM 加密存储，仅用于读取你的歌单；点「断开连接」立即删除。",
                "Cookies are AES-GCM encrypted, used only to read your playlists, and deleted the moment you disconnect.",
              )}
            </li>
          </ol>
        </Modal>
      )}
    </>
  );
}
