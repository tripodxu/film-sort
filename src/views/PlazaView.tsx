import { useEffect, useState } from "react";
import { Heart, MessageCircle, Play, Eye, Send } from "lucide-react";
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
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [kindFilter, setKindFilter] = useState("");
  const [sort, setSort] = useState<"newest" | "hottest">("newest");

  useEffect(() => { loadPosts(1, kindFilter); }, [kindFilter]);

  async function loadPosts(p: number, kind: string) {
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

  function handleLoadMore() {
    void loadPosts(page + 1, kindFilter);
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
        <div className="plaza-filter-sort">
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
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="empty-state" style={{ padding: 40 }}>
          <p style={{ color: "var(--red)", marginBottom: 12 }}>{error}</p>
          <button className="button secondary" onClick={() => void loadPosts(1, kindFilter)}>
            {t("重试", "Retry")}
          </button>
        </div>
      )}

      {/* Empty state */}
      {!loading && !error && posts.length === 0 && (
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
      <div className="plaza-cards">
        {posts.map((post) => (
          <div key={post.id} className="plaza-card">
            <div className="plaza-card-posters">
              {post.items.slice(0, 3).map((work, idx) => (
                <div key={work.id} className="plaza-card-poster-item">
                  <span className="plaza-card-medal">
                    {idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉"}
                  </span>
                  <Poster work={work} kind={post.kind as MediaKind} />
                </div>
              ))}
            </div>
            <div className="plaza-card-body">
              <h3 className="plaza-card-title">{post.collection_title}</h3>
              <div className="plaza-card-meta">
                <span className="plaza-card-author">{post.nickname || t("匿名用户", "Anonymous")}</span>
                <span className="plaza-card-kind">{label(post.kind as MediaKind)}</span>
                <span className="plaza-card-stat">
                  <Heart size={12} /> {post.like_count}
                </span>
                <span className="plaza-card-stat">
                  <MessageCircle size={12} /> {post.comment_count}
                </span>
              </div>
              <div className="plaza-card-actions">
                <button
                  className="button secondary"
                  onClick={() => navigateTo(`plazaPost:${post.id}`)}
                  style={{ minHeight: 34, paddingInline: 12, fontSize: 12 }}
                >
                  <Eye size={14} />
                  {t("查看详情", "View detail")}
                </button>
                <button
                  className="button primary"
                  onClick={() => useForSorting(post)}
                  style={{ minHeight: 34, paddingInline: 12, fontSize: 12 }}
                >
                  <Play size={14} />
                  {t("用此榜单排序", "Sort with this")}
                </button>
              </div>
            </div>
          </div>
        ))}
      </div>

      {/* Load more */}
      {hasMore && !error && (
        <div style={{ textAlign: "center", margin: "24px 0" }}>
          <button
            className="button secondary"
            disabled={loading}
            onClick={handleLoadMore}
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
