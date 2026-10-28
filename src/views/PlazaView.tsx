import { useEffect, useRef, useState } from "react";
import {
  ChevronRight,
  Globe,
  Heart,
  MessageCircle,
  PenLine,
  Play,
  Search,
  Send,
  StickyNote,
} from "lucide-react";
import { Poster } from "../components/Poster";
import { EmptyState } from "../components/ui/EmptyState";
import { Skeleton } from "../components/ui/Skeleton";
import { rankingSimilarity } from "../lib/similarity";
import type { PlazaViewProps, PlazaPost } from "./types";
import type { MediaKind } from "../data/media";

const FILTER_KINDS: Array<{ value: string; zh: string; en: string }> = [
  { value: "", zh: "全部", en: "All" },
  { value: "film", zh: "电影", en: "Films" },
  { value: "book", zh: "书籍", en: "Books" },
  { value: "music", zh: "音乐", en: "Music" },
  { value: "other", zh: "其他", en: "Other" },
];

const SORT_OPTIONS: Array<{ value: string; zh: string; en: string }> = [
  { value: "newest", zh: "最新", en: "Newest" },
  { value: "hottest", zh: "最热", en: "Hottest" },
];

export function PlazaView({
  t,
  label,
  navigateTo,
  accountToken,
  openCollection,
  profile,
}: PlazaViewProps) {
  const [posts, setPosts] = useState<PlazaPost[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [sort, setSort] = useState<"newest" | "hottest">("newest");
  const [search, setSearch] = useState("");
  const [colCount, setColCount] = useState<number>(() => {
    try {
      return Number(localStorage.getItem("art-rank:plaza-cols")) || 2;
    } catch {
      return 2;
    }
  });

  useEffect(() => {
    void loadPosts(1, kindFilter, sort, search);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只随 kindFilter 重拉；sort/search 由各自事件处理器显式带参调用
  }, [kindFilter]);

  async function loadPosts(
    p: number,
    kind: string,
    sortKey: "newest" | "hottest" = "newest",
    q = "",
    append = false,
  ) {
    if (p === 1 && !append) setInitialLoading(true);
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(p), limit: "20", kind });
      if (sortKey === "hottest") params.set("sort", "hottest");
      if (q.trim()) params.set("q", q.trim());
      const response = await fetch(
        `/api/plaza/posts?${params}`,
        accountToken ? { headers: { authorization: `Bearer ${accountToken}` } } : undefined,
      );
      if (!response.ok) throw new Error();
      const data = (await response.json()) as { posts: PlazaPost[]; total: number };
      if (append) setPosts((prev) => [...prev, ...data.posts]);
      else setPosts(data.posts);
      setTotal(data.total);
      setPage(p);
    } catch {
      setError(t("无法加载广场内容，请稍后重试。", "Failed to load plaza. Please try again."));
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  }

  function handleSortChange(next: "newest" | "hottest") {
    setSort(next);
    void loadPosts(1, kindFilter, next, search);
  }

  function applySearch() {
    void loadPosts(1, kindFilter, sort, search);
  }

  function changeCols(n: number) {
    setColCount(n);
    try {
      localStorage.setItem("art-rank:plaza-cols", String(n));
    } catch {}
  }

  // 原名 useForSorting —— 但它内部没有任何 Hook，只是一个事件处理器。
  // `use` 前缀会让 lint 与读者都把它当自定义 Hook，而它实际是在 onClick 里
  // 被调用的（rules-of-hooks 因此报错）。这属于命名误导，改名为普通动词。
  function sortWithPost(post: PlazaPost) {
    const works = post.top_items?.length ? post.top_items : (post.items ?? []);
    openCollection({
      id: `plaza-${post.id}`,
      kind: post.kind as MediaKind,
      source: "custom",
      title: post.collection_title,
      description: "",
      topN: Math.max(works.length, 2),
      works: post.items && post.items.length ? post.items : works,
    });
  }

  const hasMore = posts.length < total;
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // 无限滚动：哨兵进入视口自动加载下一页（保留「加载更多」按钮兜底）
  useEffect(() => {
    if (!hasMore || loading || initialLoading) return;
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && !loading)
          void loadPosts(page + 1, kindFilter, sort, search, true);
      },
      { rootMargin: "400px" },
    );
    observer.observe(el);
    return () => observer.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 观察器随 loading/page 重建已足够；loadPosts 是渲染期函数身份
  }, [hasMore, loading, initialLoading, page, kindFilter, sort, search]);

  function formatPlazaTime(value: string): string {
    const diff = Date.now() - new Date(value).getTime();
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return t("刚刚", "just now");
    if (minutes < 60) return `${minutes} ${t("分钟前", "min ago")}`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `${hours} ${t("小时前", "h ago")}`;
    const days = Math.floor(hours / 24);
    if (days < 30) return `${days} ${t("天前", "d ago")}`;
    return new Date(value).toLocaleDateString();
  }

  return (
    <>
      <div className="plaza-header">
        <div className="plaza-header-tab">
          <Globe size={14} />
          <span>{t("广场", "PLAZA")}</span>
        </div>
        <h1>{t("文化广场", "Culture Plaza")}</h1>
        <p>
          {t(
            "发现他人的品味，找到灵感。在这里浏览、点赞、留言，或用他人的榜单开始你自己的排序。",
            "Discover others' tastes, find inspiration. Browse, like, comment, or start your own ranking from theirs.",
          )}
        </p>
      </div>

      {/* Ability selector */}
      <div className="plaza-abilities" role="tablist" aria-label={t("榜单维度", "Post medium")}>
        {FILTER_KINDS.map((item) => (
          <button
            key={item.value}
            className={`plaza-ability ${kindFilter === item.value ? "active" : ""}`}
            role="tab"
            aria-selected={kindFilter === item.value}
            aria-label={t(item.zh, item.en)}
            onClick={() => {
              setKindFilter(item.value);
              setPosts([]);
            }}
          >
            <span className="plaza-ability-label">{t(item.zh, item.en)}</span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="plaza-toolbar">
        <div className="plaza-toolbar-left">
          {/* S5：给这组 role=tab 补 tablist 父容器；display:contents 让包装层不参与布局（零视觉影响）。 */}
          <div
            role="tablist"
            aria-label={t("排序方式", "Sort order")}
            style={{ display: "contents" }}
          >
            {SORT_OPTIONS.map((item) => (
              <button
                key={item.value}
                className={`plaza-toolbar-btn ${sort === item.value ? "active" : ""}`}
                onClick={() => handleSortChange(item.value as "newest" | "hottest")}
                aria-label={t(item.zh, item.en)}
                role="tab"
                aria-selected={sort === item.value}
              >
                {t(item.zh, item.en)}
              </button>
            ))}
          </div>
          <label className="search-field" style={{ padding: 0, marginLeft: 8 }}>
            <Search size={14} />
            <input
              aria-label={t("搜索榜单或作者", "Search posts or authors")}
              placeholder={t("搜索榜单 / 作者", "Search title / author")}
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") applySearch();
              }}
              style={{ minHeight: 36, padding: "4px 8px", fontSize: 12 }}
            />
            {search && (
              <button
                className="text-button"
                onClick={applySearch}
                style={{ minHeight: 32, fontSize: 11, padding: "0 4px" }}
              >
                {t("搜索", "Search")}
              </button>
            )}
          </label>
        </div>
        <div className="plaza-toolbar-right">
          {[2, 3, 4].map((n) => (
            <button
              key={n}
              className={`plaza-toolbar-btn ${colCount === n ? "active" : ""}`}
              onClick={() => changeCols(n)}
              aria-label={t(`${n} 列`, `${n} columns`)}
              aria-pressed={colCount === n}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Loading skeleton —— 占位块的尺寸对齐真实卡片（海报 42×60），加载完成时不跳版 */}
      {initialLoading && (
        <div className="plaza-grid" style={{ "--plaza-cols": colCount } as React.CSSProperties}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="plaza-sticker">
              <div className="plaza-sticker-posters">
                <Skeleton variant="block" width={42} height={60} />
                <Skeleton variant="block" width={42} height={60} />
                <Skeleton variant="block" width={42} height={60} />
              </div>
              <div className="plaza-sticker-info">
                <Skeleton width="70%" />
                <Skeleton width="50%" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <EmptyState tone="error" live title={error}>
          <button
            className="button secondary"
            onClick={() => void loadPosts(1, kindFilter, sort, search)}
          >
            {t("重试", "Retry")}
          </button>
        </EmptyState>
      )}

      {/* Empty state — only after initial load completes */}
      {!initialLoading && !loading && !error && posts.length === 0 && (
        <EmptyState
          title={t(
            "广场还没有内容，快来发布第一个吧！",
            "The plaza is empty. Be the first to post!",
          )}
        >
          {accountToken && (
            <button className="button primary" onClick={() => navigateTo("profile")}>
              {t("去发布", "Go post")}
            </button>
          )}
        </EmptyState>
      )}

      {/* Post cards */}
      {!initialLoading && posts.length > 0 && (
        <div className="plaza-grid" style={{ "--plaza-cols": colCount } as React.CSSProperties}>
          {posts.map((post) => (
            <div
              key={post.id}
              className={`plaza-sticker ${colCount >= 4 ? "plaza-sticker-compact" : ""}`}
            >
              <div className="plaza-sticker-posters">
                {(post.top_items ?? post.items ?? []).slice(0, 3).map((work, idx) => (
                  <div key={work.id} className="plaza-sticker-poster">
                    <span className="plaza-sticker-medal">{String(idx + 1).padStart(2, "0")}</span>
                    <Poster work={work} kind={(post.kind ?? "other") as MediaKind} />
                  </div>
                ))}
              </div>
              <div className="plaza-sticker-info">
                <h3 className="plaza-sticker-title">
                  <button
                    className="plaza-sticker-link"
                    onClick={() => navigateTo(`plazaPost:${post.id}`)}
                  >
                    {post.collection_title}
                  </button>
                </h3>
                {(post.note_count ?? 0) > 0 && (
                  <span
                    style={{
                      fontSize: 10,
                      color: "var(--accent)",
                      opacity: 0.7,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 4,
                    }}
                  >
                    <StickyNote size={11} />
                    {post.note_count}
                    {t("条批注", " notes")}
                  </span>
                )}
                <div className="plaza-sticker-meta">
                  <span className="plaza-sticker-author">
                    {post.nickname || t("匿名用户", "Anonymous")}
                  </span>
                  <span className={`plaza-sticker-kind kind-${post.kind}`}>
                    {post.post_type === "profile"
                      ? t("画像", "Profile")
                      : label(post.kind as MediaKind)}
                  </span>
                  <span className="plaza-sticker-count">
                    {post.item_count} {t("件", "works")}
                  </span>
                  <time
                    className="plaza-sticker-time"
                    dateTime={post.created_at}
                    title={new Date(post.created_at).toLocaleString()}
                  >
                    {formatPlazaTime(post.created_at)}
                  </time>
                </div>
                {post.description && <p className="plaza-sticker-desc">{post.description}</p>}
                <div className="plaza-sticker-stats">
                  {(() => {
                    // 卡片徽章:对方前三名与我的同媒介榜单的重合件数
                    // (列表接口只给 top_items,全量计算在详情页)
                    if (!profile) return null;
                    const mine = profile.rankings.filter((r) => r.kind === post.kind);
                    if (mine.length === 0) return null;
                    const top = (post.top_items ?? post.items ?? []).slice(0, 3);
                    if (top.length === 0) return null;
                    const sim = rankingSimilarity(
                      mine.flatMap((r) => r.items),
                      top,
                    );
                    if (sim.sharedCount < 1) return null;
                    return (
                      <span className="plaza-sticker-match">
                        {t(
                          `重合 ${sim.sharedCount}/${top.length}`,
                          `Match ${sim.sharedCount}/${top.length}`,
                        )}
                      </span>
                    );
                  })()}
                  <span>
                    <Heart size={12} /> {post.like_count}
                  </span>
                  <span>
                    <MessageCircle size={12} /> {post.comment_count}
                  </span>
                </div>
              </div>
              <div className="plaza-sticker-actions">
                {post.is_author && (
                  <button
                    className="plaza-sticker-btn hit-expand"
                    onClick={(e) => {
                      e.stopPropagation();
                      navigateTo(`plazaPost:${post.id}`);
                    }}
                    title={t("管理我的帖子", "Manage my post")}
                  >
                    <PenLine size={14} />
                  </button>
                )}
                <button
                  className="plaza-sticker-btn hit-expand"
                  onClick={(e) => {
                    e.stopPropagation();
                    sortWithPost(post);
                  }}
                  title={t("用此榜单排序", "Sort with this")}
                >
                  <Play size={14} />
                </button>
                <ChevronRight size={16} className="plaza-sticker-arrow" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Infinite scroll sentinel (auto load next page) */}
      {hasMore && !error && <div ref={sentinelRef} aria-hidden="true" style={{ height: 1 }} />}

      {/* Load more */}
      {hasMore && !error && (
        <div style={{ textAlign: "center", margin: "24px 0" }}>
          <button
            className="button secondary"
            disabled={loading}
            onClick={() => void loadPosts(page + 1, kindFilter, sort, search, true)}
            style={{ minWidth: 160, borderRadius: "var(--r-pill)", paddingInline: 28 }}
          >
            {loading ? t("加载中…", "Loading…") : t("加载更多", "Load more")}
          </button>
        </div>
      )}

      {/* Publish button */}
      {accountToken && profile && (
        <div style={{ textAlign: "center", margin: "32px 0 16px" }}>
          <button
            className="button primary"
            onClick={() => navigateTo("profile")}
            style={{ minWidth: 180 }}
          >
            <Send size={15} />
            {t("发布到广场", "Publish to Plaza")}
          </button>
        </div>
      )}

      {/* Back */}
      <div style={{ marginTop: 8 }}>
        <button
          className="button secondary"
          onClick={() => navigateTo("home")}
          style={{ minHeight: 34 }}
        >
          {t("返回首页", "Back home")}
        </button>
      </div>
    </>
  );
}
