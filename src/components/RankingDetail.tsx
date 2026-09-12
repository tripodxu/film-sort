import type { ReactNode } from "react";
import { Poster } from "./Poster";
import { ExpandableNote } from "./ExpandableNote";
import type { RankedArtwork } from "../lib/profile";
import type { MediaKind } from "../data/media";

/**
 * 统一的榜单详情渲染组件。
 * 分享查看页（/share/:code）、比较界面的榜单详情弹窗、广场帖子详情共用同一实现，
 * 保证三处的标题区、批注展示、排名列表与交互（点击海报查看作品详情）完全一致。
 */
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
          const rank = work.rank || idx + 1;
          const isHit = highlightId === work.id;
          const workNote = notes[`work:${kind}:${work.id}`]?.trim();
          return (
            <li key={work.id} style={isHit ? { background: "rgba(216,248,106,.08)", borderLeft: "3px solid var(--accent)", paddingLeft: 14 } : undefined}>
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
    </>
  );
}
