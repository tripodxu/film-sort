import { useEffect, useState } from "react";
import { ChevronRight, Heart, MessageCircle, Play, Eye, Send } from "lucide-react";
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

      {/* Post cards - sticker card style like curated collections */}
      <div className="collection-list" style={{ gridTemplateColumns: `repeat(${typeof window !== 'undefined' && window.innerWidth > 800 ? 2 : 1}, minmax(0, 1fr))` }}>
        {posts.map((post, index) => (
          <button key={post.id} className="collection-row" onClick={() => navigateTo(`plazaPost:${post.id}`)}>
            <span className="row-number">{String(index + 1).padStart(2, "0")}</span>
            {post.items[0] && <Poster work={post.items[0]} kind={post.kind as MediaKind} />}
            <div>
              <h3>{post.collection_title}</h3>
              <small>
                {post.nickname || t("匿名用户", "Anonymous")} · {label(post.kind as MediaKind)} · {post.item_count} {t("件", "")}
                {" "}<Heart size={10} style={{ verticalAlign: "middle", marginLeft: 4 }} /> {post.like_count}
                {" "}<MessageCircle size={10} style={{ verticalAlign: "middle", marginLeft: 4 }} /> {post.comment_count}
              </small>
            </div>
            <ChevronRight size={18} />
          </button>
        ))}
        {!loading && !error && posts.length === 0 && <p className="empty-state">{t("广场还没有内容，快来发布第一个吧！", "The plaza is empty. Be the first to post!")}</p>}
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
