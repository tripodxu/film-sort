import { useEffect, useState } from "react";
import { ChevronRight, Globe, Heart, MessageCircle, Play, Send } from "lucide-react";
import { Poster } from "../components/Poster";
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

export function PlazaView({ t, label, navigateTo, accountToken, openCollection, profile }: PlazaViewProps) {
  const [posts, setPosts] = useState<PlazaPost[]>([]);
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [initialLoading, setInitialLoading] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [sort, setSort] = useState<"newest" | "hottest">("newest");
  const [colCount, setColCount] = useState<number>(() => { try { return Number(localStorage.getItem("art-rank:plaza-cols")) || 2; } catch { return 2; } });

  useEffect(() => { void loadPosts(1, kindFilter); }, [kindFilter]);

  async function loadPosts(p: number, kind: string) {
    if (p === 1) setInitialLoading(true);
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/plaza/posts?page=${p}&limit=20&kind=${kind}`);
      if (!response.ok) throw new Error();
      const data = await response.json() as { posts: PlazaPost[]; total: number };
      const sorted = sortPosts(data.posts, sort);
      if (p === 1) setPosts(sorted);
      else setPosts((prev) => [...prev, ...sorted]);
      setTotal(data.total);
      setPage(p);
    } catch {
      setError(t("无法加载广场内容，请稍后重试。", "Failed to load plaza. Please try again."));
    } finally {
      setLoading(false);
      setInitialLoading(false);
    }
  }

  function sortPosts(items: PlazaPost[], sortBy: string): PlazaPost[] {
    const copy = [...items];
    if (sortBy === "hottest") copy.sort((a, b) => b.like_count - a.like_count);
    else copy.sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime());
    return copy;
  }

  function handleSortChange(next: "newest" | "hottest") {
    setSort(next);
    setPosts((prev) => sortPosts(prev, next));
  }

  function changeCols(n: number) {
    setColCount(n);
    try { localStorage.setItem("art-rank:plaza-cols", String(n)); } catch {}
  }

  function useForSorting(post: PlazaPost) {
    openCollection({
      id: `plaza-${post.id}`,
      kind: post.kind as MediaKind,
      source: "custom",
      title: post.collection_title,
      description: "",
      topN: post.items.length,
      works: post.items,
    });
  }

  const hasMore = posts.length < total;

  return (
    <>
      <div className="plaza-header">
        <div className="plaza-header-tab">
          <Globe size={14} />
          <span>{t("广场", "PLAZA")}</span>
        </div>
        <h1>{t("文化广场", "Culture Plaza")}</h1>
        <p>{t("发现他人的品味，找到灵感。在这里浏览、点赞、留言，或用他人的榜单开始你自己的排序。", "Discover others' tastes, find inspiration. Browse, like, comment, or start your own ranking from theirs.")}</p>
      </div>

      {/* Ability selector */}
      <div className="plaza-abilities">
        {FILTER_KINDS.map((item) => (
          <button
            key={item.value}
            className={`plaza-ability ${kindFilter === item.value ? "active" : ""}`}
            role="tab"
            aria-selected={kindFilter === item.value}
            aria-label={t(item.zh, item.en)}
            onClick={() => { setKindFilter(item.value); setPosts([]); }}
          >
            <span className="plaza-ability-label">{t(item.zh, item.en)}</span>
          </button>
        ))}
      </div>

      {/* Toolbar */}
      <div className="plaza-toolbar">
        <div className="plaza-toolbar-left">
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
        <div className="plaza-toolbar-right">
          {[2, 3, 4].map((n) => (
            <button
              key={n}
              className={`plaza-toolbar-btn ${colCount === n ? "active" : ""}`}
              onClick={() => changeCols(n)}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Loading skeleton */}
      {initialLoading && (
        <div className="plaza-grid" style={{ "--plaza-cols": colCount } as React.CSSProperties}>
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="plaza-sticker plaza-skeleton">
              <div className="plaza-skeleton-posters">
                <div className="plaza-skeleton-img" /><div className="plaza-skeleton-img" /><div className="plaza-skeleton-img" />
              </div>
              <div className="plaza-skeleton-info">
                <div className="plaza-skeleton-line" style={{ width: "70%" }} />
                <div className="plaza-skeleton-line" style={{ width: "50%" }} />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Error state */}
      {error && (
        <div className="empty-state" style={{ padding: 40 }}>
          <p style={{ color: "var(--red)", marginBottom: 12 }}>{error}</p>
          <button className="button secondary" onClick={() => void loadPosts(1, kindFilter)}>
            {t("重试", "Retry")}
          </button>
        </div>
      )}

      {/* Empty state — only after initial load completes */}
      {!initialLoading && !loading && !error && posts.length === 0 && (
        <div className="empty-state" style={{ padding: 40 }}>
          <p style={{ marginBottom: 12 }}>{t("广场还没有内容，快来发布第一个吧！", "The plaza is empty. Be the first to post!")}</p>
          {accountToken && (
            <button className="button primary" onClick={() => navigateTo("profile")}>
              {t("去发布", "Go post")}
            </button>
          )}
        </div>
      )}

      {/* Post cards */}
      {!initialLoading && posts.length > 0 && (
        <div className="plaza-grid" style={{ "--plaza-cols": colCount } as React.CSSProperties}>
          {posts.map((post) => (
            <div key={post.id} className={`plaza-sticker ${colCount >= 4 ? "plaza-sticker-compact" : ""}`} onClick={() => navigateTo(`plazaPost:${post.id}`)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); navigateTo(`plazaPost:${post.id}`); } }}>
              <div className="plaza-sticker-posters">
                {colCount >= 4 ? (
                  post.items[0] && <div className="plaza-sticker-poster"><Poster work={post.items[0]} kind={post.kind as MediaKind} /></div>
                ) : post.items.slice(0, 3).map((work, idx) => (
                  <div key={work.id} className="plaza-sticker-poster">
                    <span className="plaza-sticker-medal" aria-hidden="true">{idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉"}</span>
                    <Poster work={work} kind={post.kind as MediaKind} />
                  </div>
                ))}
              </div>
              <div className="plaza-sticker-info">
                <h3 className="plaza-sticker-title">{post.collection_title}</h3>
                {post.notes && (() => { try { const n = typeof post.notes === "string" ? JSON.parse(post.notes) : post.notes; return Object.keys(n).length > 0 ? <span style={{ fontSize: 10, color: "var(--accent)", opacity: 0.7 }}>📝 {Object.keys(n).length}{t("条批注", " notes")}</span> : null; } catch { return null; } })()}
                <div className="plaza-sticker-meta">
                  <span className="plaza-sticker-author">{post.nickname || t("匿名用户", "Anonymous")}</span>
                  <span className={`plaza-sticker-kind kind-${post.kind}`}>{label(post.kind as MediaKind)}</span>
                  <span className="plaza-sticker-count">{post.item_count} {t("件", "works")}</span>
                </div>
                {post.description && <p className="plaza-sticker-desc">{post.description}</p>}
                <div className="plaza-sticker-stats">
                  <span><Heart size={12} /> {post.like_count}</span>
                  <span><MessageCircle size={12} /> {post.comment_count}</span>
                </div>
              </div>
              <div className="plaza-sticker-actions">
                <button className="plaza-sticker-btn" onClick={(e) => { e.stopPropagation(); useForSorting(post); }} title={t("用此榜单排序", "Sort with this")}><Play size={14} /></button>
                <ChevronRight size={16} className="plaza-sticker-arrow" />
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Load more */}
      {hasMore && !error && (
        <div style={{ textAlign: "center", margin: "24px 0" }}>
          <button
            className="button secondary"
            disabled={loading}
            onClick={() => void loadPosts(page + 1, kindFilter)}
            style={{ minWidth: 160, borderRadius: 999, paddingInline: 28 }}
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
        <button className="button secondary" onClick={() => navigateTo("home")} style={{ minHeight: 34 }}>
          {t("返回首页", "Back home")}
        </button>
      </div>
    </>
  );
}
