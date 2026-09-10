import { useEffect, useState } from "react";
import { ChevronRight, Heart, MessageCircle, Play, Send } from "lucide-react";
import { Poster } from "../components/Poster";
import { heading } from "./helpers";
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
      {heading(
        t("广场", "PLAZA"),
        t("文化广场", "Culture Plaza"),
        t("发现他人的品味，找到灵感。", "Discover others' tastes, find inspiration."),
      )}

      {/* Filter bar */}
      <div className="plaza-filters">
        <div className="plaza-filter-kinds">
          {FILTER_KINDS.map((item) => (
            <button
              key={item.value}
              className={`button ${kindFilter === item.value ? "primary" : "secondary"}`}
              onClick={() => { setKindFilter(item.value); setPosts([]); }}
              style={{ minHeight: 34, paddingInline: 12, fontSize: 13 }}
            >
              {t(item.zh, item.en)}
            </button>
          ))}
        </div>
        <div style={{ display: "flex", gap: 4, alignItems: "center" }}>
          {SORT_OPTIONS.map((item) => (
            <button
              key={item.value}
              className={`button ${sort === item.value ? "primary" : "secondary"}`}
              onClick={() => handleSortChange(item.value as "newest" | "hottest")}
              style={{ minHeight: 34, paddingInline: 12, fontSize: 13 }}
            >
              {t(item.zh, item.en)}
            </button>
          ))}
          <span style={{ width: 1, height: 18, background: "var(--line)", margin: "0 4px" }} />
          {[2, 3, 4].map((n) => (
            <button
              key={n}
              onClick={() => changeCols(n)}
              style={{ width: 28, height: 28, borderRadius: 6, border: colCount === n ? "1px solid var(--accent)" : "1px solid var(--line)", background: colCount === n ? "rgba(216,248,106,.1)" : "transparent", color: colCount === n ? "var(--accent)" : "var(--muted)", fontSize: 11, fontWeight: 600, cursor: "pointer", display: "flex", alignItems: "center", justifyContent: "center" }}
            >
              {n}
            </button>
          ))}
        </div>
      </div>

      {/* Loading skeleton */}
      {initialLoading && (
        <div className="plaza-grid" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>
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
        <div className="plaza-grid" style={{ gridTemplateColumns: `repeat(${colCount}, minmax(0, 1fr))` }}>
          {posts.map((post) => (
            <div key={post.id} className="plaza-sticker" onClick={() => navigateTo(`plazaPost:${post.id}`)}>
              <div className="plaza-sticker-posters">
                {post.items.slice(0, 3).map((work, idx) => (
                  <div key={work.id} className="plaza-sticker-poster">
                    <span className="plaza-sticker-medal">{idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉"}</span>
                    <Poster work={work} kind={post.kind as MediaKind} />
                  </div>
                ))}
              </div>
              <div className="plaza-sticker-info">
                <h3 className="plaza-sticker-title">{post.collection_title}</h3>
                <div className="plaza-sticker-meta">
                  <span className="plaza-sticker-author">{post.nickname || t("匿名用户", "Anonymous")}</span>
                  <span className={`plaza-sticker-kind kind-${post.kind}`}>{label(post.kind as MediaKind)}</span>
                  <span className="plaza-sticker-count">{post.item_count} {t("件", "works")}</span>
                </div>
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
            style={{ minWidth: 160 }}
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
