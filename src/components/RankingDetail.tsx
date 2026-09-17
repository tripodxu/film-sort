import type { ReactNode } from "react";
import { useEffect, useMemo, useRef, useState } from "react";
import { Poster, prefetchPosters } from "./Poster";
import { ExpandableNote } from "./ExpandableNote";
import type { RankedArtwork } from "../lib/profile";
import type { MediaKind } from "../data/media";

/**
 * 统一的榜单详情渲染组件。
 * 分享查看页（/share/:code）、比较界面的榜单详情弹窗、广场帖子详情共用同一实现，
 * 保证三处的标题区、批注展示、排名列表与交互（点击海报查看作品详情）完全一致。
 */
// 首屏只渲染 30 首，滚动到底再追加 30 首，避免一次性挂载 150 个 Poster
// （每个 Poster 都会去解析海报，全量渲染等于一次性发起整份榜单的请求）。
const PAGE_SIZE = 30;

export function RankingDetail({
  kind,
  collectionTitle,
  items,
  notes = {},
  kindLabel,
  eyebrow,
  headerExtra,
  onNoteView,
  onArtworkClick,
  highlightId,
  showRankingNote = true,
}: {
  kind: MediaKind;
  collectionTitle: string;
  items: readonly RankedArtwork[];
  /** 批注数据（key 形如 `work:${kind}:${workId}` / `ranking:${kind}:${collectionTitle}`） */
  notes?: Record<string, string>;
  /** 媒介显示名（用于默认眉标） */
  kindLabel?: (kind: MediaKind) => string;
  /** 自定义眉标文本（如「对方索引 / 电影」）；缺省时用 `${媒介} / TOP N` */
  eyebrow?: string;
  /** 标题行右侧附加内容（如弹窗关闭按钮、按此榜单排序按钮） */
  headerExtra?: ReactNode;
  onNoteView?: (title: string, text: string, posterUrls?: readonly string[]) => void;
  onArtworkClick?: (work: RankedArtwork, kind: MediaKind) => void;
  /** 高亮某个作品行（比较界面跳转定位用） */
  highlightId?: string;
  showRankingNote?: boolean;
}) {
  const rankingNote = notes[`ranking:${kind}:${collectionTitle}`]?.trim();
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  const hitIndex = useMemo(
    () => (highlightId ? items.findIndex((work) => work.id === highlightId) : -1),
    [highlightId, items],
  );

  // 切换榜单（比较界面会连续渲染多份榜单）时回到首屏，不沿用上一份的展开进度。
  // 依赖刻意不含 items：父组件每次渲染都可能给出新的数组引用，否则会不断复位。
  useEffect(() => { setVisibleCount(PAGE_SIZE); }, [collectionTitle, kind]);

  // 高亮行必须渲染，否则比较界面的「定位到该作品」会指向一个未挂载的条目。
  const visibleEnd = Math.max(visibleCount, hitIndex + 1);
  const hasMore = visibleEnd < items.length;

  // 每次展开都重建 observer：observe() 会对已进入视口的哨兵立即回调一次，
  // 因此首屏渲染后会自动续载到填满视口，之后再由滚动触发。
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) {
        setVisibleCount((previous) => Math.min(previous + PAGE_SIZE, items.length));
      }
    }, { rootMargin: "300px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, visibleEnd, items.length]);

  // 已露出的一页提前入队，让 /api/posters/batch 一次把整页取回来。
  useEffect(() => {
    const start = Math.max(0, visibleEnd - PAGE_SIZE);
    prefetchPosters(items.slice(start, visibleEnd).map((work) => ({ work, kind })));
  }, [items, kind, visibleEnd]);

  return (
    <>
      <div className="section-heading">
        <div>
          <span className="eyebrow">{eyebrow ?? `${kindLabel ? kindLabel(kind) : kind} / TOP ${items.length}`}</span>
          <h2>{collectionTitle}</h2>
          {showRankingNote && rankingNote && (
            <ExpandableNote
              text={rankingNote}
              maxLength={30}
              onView={onNoteView ? (text) => onNoteView(collectionTitle, text) : undefined}
              style={{ marginBottom: 8 }}
            />
          )}
        </div>
        {headerExtra}
      </div>
      <ol className="ranking-list">
        {items.map((work, idx) => {
          if (idx >= visibleEnd) return null;
          const rank = work.rank || idx + 1;
          const isHit = highlightId === work.id;
          const workNote = notes[`work:${kind}:${work.id}`]?.trim();
          return (
            <li key={work.id} style={isHit ? { background: "color-mix(in srgb,var(--accent) 8%,transparent)", borderLeft: "3px solid var(--accent)", paddingLeft: 14 } : undefined}>
              <span className="row-number" style={isHit ? { color: "var(--accent)" } : undefined}>
                {rank <= 3 ? (rank === 1 ? "🥇" : rank === 2 ? "🥈" : "🥉") : String(rank).padStart(2, "0")}
              </span>
              <div
                className="ranking-card-poster"
                style={onArtworkClick ? { cursor: "pointer" } : undefined}
                onClick={() => onArtworkClick?.(work, kind)}
                role={onArtworkClick ? "button" : undefined}
                tabIndex={onArtworkClick ? 0 : undefined}
                onKeyDown={(e) => { if (onArtworkClick && (e.key === "Enter" || e.key === " ")) { e.preventDefault(); onArtworkClick(work, kind); } }}
              >
                <Poster work={work} kind={kind} />
              </div>
              <div>
                <strong>{work.title}</strong>
                <small>{work.creator} {work.year}</small>
                {workNote && (
                  <ExpandableNote
                    text={workNote}
                    maxLength={30}
                    onView={onNoteView ? (text) => onNoteView(work.title, text, work.posterUrls) : undefined}
                  />
                )}
              </div>
            </li>
          );
        })}
      </ol>
      {hasMore && (
        <div ref={sentinelRef} style={{ textAlign: "center", marginTop: 16 }}>
          <button className="button secondary" onClick={() => setVisibleCount(items.length)}>
            显示剩余 {items.length - visibleEnd} 件作品
          </button>
        </div>
      )}
    </>
  );
}
