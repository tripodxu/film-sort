// gallery 主题（PLAN-ui-modernization P3）的画像页 Bento 网格（L3 条件渲染）。
// 铁律：仅 gallery 家族渲染（ProfileView/ShareView 按主题家族分支），
// classic 路径 DOM 一字节不变；数据全部来自 galleryStats 现场聚合，零数据层改动。
import {
  GALLERY_KINDS,
  decadeSlices,
  decadeSpan,
  kindCounts,
  profileStats,
} from "../lib/galleryStats";
import type { MediaKind } from "../data/media";
import type { ArtisticProfile, RankedArtwork, RankingExport } from "../lib/profile";
import { Poster } from "./Poster";

interface GalleryBentoProps {
  profile: Pick<ArtisticProfile, "rankings">;
  activeRanking: RankingExport;
  label: (kind: MediaKind) => string;
  t: (zh: string, en: string) => string;
  openArtworkDetail: (work: RankedArtwork, kind: MediaKind) => void;
  /** 画像页 = true（含榜单入口格）；分享页缩略版 = false（无切换语义）。 */
  entries?: boolean;
  onOpenEntry?: (key: string) => void;
}

/** 媒介色 token 名与 MediaKind 同名（--film/--book/--music/--other），直接拼接。 */
const kindColor = (kind: MediaKind) => `var(--${kind})`;

function decadeText(decade: number | null, t: GalleryBentoProps["t"]): string {
  return decade === null ? t("无年份", "Undated") : t(`${decade} 年代`, `${decade}s`);
}

/** 手写 SVG 维度雷达：四媒介固定轴，值 = 各媒介作品数占最大值的比例。 */
function GalleryRadar({
  profile,
  label,
  t,
}: {
  profile: Pick<ArtisticProfile, "rankings">;
  label: GalleryBentoProps["label"];
  t: GalleryBentoProps["t"];
}) {
  const counts = kindCounts(profile);
  const max = Math.max(1, ...counts.map((c) => c.count));
  const cx = 130;
  const cy = 92;
  const R = 58;
  const point = (index: number, radius: number) => {
    const angle = (index * Math.PI) / 2;
    return `${(cx + radius * Math.sin(angle)).toFixed(1)},${(cy - radius * Math.cos(angle)).toFixed(1)}`;
  };
  const vertices = counts.map((c, i) => point(i, (c.count / max) * R));
  const ringFractions = [0.25, 0.5, 0.75, 1];
  // 标签位：上（居中）、右（左对齐）、下（居中）、左（右对齐）
  const labelPos = [
    { x: cx, y: cy - R - 10, anchor: "middle" as const },
    { x: cx + R + 8, y: cy + 4, anchor: "start" as const },
    { x: cx, y: cy + R + 16, anchor: "middle" as const },
    { x: cx - R - 8, y: cy + 4, anchor: "end" as const },
  ];
  return (
    <svg
      className="gl-radar"
      viewBox="0 0 260 190"
      role="img"
      aria-label={t(
        `维度雷达：${counts.map((c) => `${label(c.kind)} ${c.count}`).join("、")}`,
        `Dimension radar: ${counts.map((c) => `${label(c.kind)} ${c.count}`).join(", ")}`,
      )}
    >
      {ringFractions.map((f) => (
        <polygon
          key={f}
          points={[0, 1, 2, 3].map((i) => point(i, f * R)).join(" ")}
          fill="none"
          stroke={f === 1 ? "var(--border-2)" : "var(--line)"}
          strokeWidth="1"
        />
      ))}
      {[0, 1, 2, 3].map((i) => (
        <line
          key={i}
          x1={cx}
          y1={cy}
          x2={point(i, R).split(",")[0]}
          y2={point(i, R).split(",")[1]}
          stroke="var(--line)"
          strokeWidth="1"
        />
      ))}
      <polygon
        points={vertices.join(" ")}
        fill="color-mix(in srgb,var(--accent) 16%,transparent)"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      {vertices.map((v, i) => (
        <circle key={i} cx={v.split(",")[0]} cy={v.split(",")[1]} r="2.5" fill="var(--accent)" />
      ))}
      {counts.map((c, i) => (
        <text
          key={c.kind}
          x={labelPos[i].x}
          y={labelPos[i].y}
          textAnchor={labelPos[i].anchor}
          className="gl-radar-label"
        >
          {label(c.kind)}
          <tspan fill={kindColor(c.kind)} className="gl-radar-count">
            {" "}
            {c.count}
          </tspan>
        </text>
      ))}
    </svg>
  );
}

export function GalleryBento({
  profile,
  activeRanking,
  label,
  t,
  openArtworkDetail,
  entries = true,
  onOpenEntry,
}: GalleryBentoProps) {
  const stats = profileStats(profile);
  const top = activeRanking.items[0];
  const decades = GALLERY_KINDS.map((kind) => {
    const items = profile.rankings.filter((r) => r.kind === kind).flatMap((r) => r.items);
    return { kind, items, slices: decadeSlices(items) };
  }).filter((row) => row.items.length > 0);
  const spanText =
    stats.span.earliest !== null && stats.span.latest !== null
      ? `${stats.span.earliest}–${stats.span.latest}`
      : "—";

  return (
    <div className={`gl-bento${entries ? "" : " gl-bento--share"}`}>
      <div className="gl-cell gl-cell-hero">
        <span className="gl-cell-label">
          {t("榜首", "Top 1")} · {activeRanking.collectionTitle}
        </span>
        {top ? (
          <button
            className="gl-hero"
            onClick={() => openArtworkDetail(top, activeRanking.kind)}
            aria-label={`${t("查看详情", "Detail")}: ${top.title}`}
          >
            <span className="gl-hero-poster">
              <Poster work={top} kind={activeRanking.kind} large />
            </span>
            <span className="gl-hero-info">
              <span className="gl-hero-rank">01</span>
              <strong>{top.title}</strong>
              <small>
                {top.creator} {top.year ? `· ${top.year}` : ""}
              </small>
            </span>
          </button>
        ) : (
          <p className="gl-empty">{t("这份榜单还没有作品。", "This list is empty.")}</p>
        )}
        {activeRanking.items.length > 1 && (
          <ol className="gl-hero-next" aria-label={t("第 2 至 5 名", "Runners-up")}>
            {activeRanking.items.slice(1, 5).map((work) => (
              <li key={work.id}>
                <button onClick={() => openArtworkDetail(work, activeRanking.kind)}>
                  <span className="gl-hero-next-rank">{String(work.rank).padStart(2, "0")}</span>
                  <Poster work={work} kind={activeRanking.kind} />
                  <span className="gl-hero-next-title">{work.title}</span>
                  <span className="gl-entry-count">{work.year ?? ""}</span>
                </button>
              </li>
            ))}
          </ol>
        )}
      </div>

      <div className="gl-cell gl-cell-radar">
        <span className="gl-cell-label">{t("维度分布", "DIMENSIONS")}</span>
        <GalleryRadar profile={profile} label={label} t={t} />
      </div>

      <div className="gl-cell gl-cell-decades">
        <span className="gl-cell-label">{t("年代分布", "DECADES")}</span>
        {decades.length === 0 && (
          <p className="gl-empty">{t("还没有可统计的作品。", "No works to chart yet.")}</p>
        )}
        {decades.map((row) => {
          const span = decadeSpan(row.items);
          return (
            <div className="gl-decade-row" key={row.kind}>
              <span className="gl-decade-kind" style={{ color: kindColor(row.kind) }}>
                {label(row.kind)}
              </span>
              <div
                className="gl-decade-bar"
                role="img"
                aria-label={`${label(row.kind)}：${row.slices
                  .map((s) => `${decadeText(s.decade, t)} ${s.count}`)
                  .join("、")}`}
              >
                {row.slices.map((slice, i) => (
                  <span
                    key={String(slice.decade)}
                    title={`${decadeText(slice.decade, t)} · ${slice.count}`}
                    style={{
                      flexGrow: slice.count,
                      background:
                        slice.decade === null
                          ? "color-mix(in srgb,var(--text) 14%,transparent)"
                          : `color-mix(in srgb,${kindColor(row.kind)} ${40 + Math.min(i * 15, 45)}%,var(--bg))`,
                    }}
                  />
                ))}
              </div>
              <span className="gl-decade-span">
                {span.earliest !== null && span.latest !== null
                  ? `${span.earliest}–${span.latest}`
                  : "—"}
              </span>
            </div>
          );
        })}
      </div>

      <div className="gl-cell gl-cell-coords">
        <span className="gl-cell-label">{t("口味坐标", "TASTE STATS")}</span>
        <div className="gl-stats">
          <div className="gl-stat">
            <strong>{stats.works}</strong>
            <span>{t("件作品", "works")}</span>
          </div>
          <div className="gl-stat">
            <strong>{stats.creators}</strong>
            <span>{t("位创作者", "creators")}</span>
          </div>
          <div className="gl-stat">
            <strong>{stats.lists}</strong>
            <span>{t("份榜单", "lists")}</span>
          </div>
          <div className="gl-stat">
            <strong>{spanText}</strong>
            <span>{t("年代跨度", "year span")}</span>
          </div>
        </div>
      </div>

      {entries && onOpenEntry && (
        <div className="gl-cell gl-cell-entries">
          <span className="gl-cell-label">{t("榜单索引", "LISTS")}</span>
          <div className="gl-entries" role="tablist" aria-label={t("榜单切换", "Switch list")}>
            {profile.rankings.map((entry, idx) => {
              const key = `${entry.kind}-${idx}`;
              const active = entry === activeRanking;
              return (
                <button
                  key={key}
                  className={`gl-entry${active ? " active" : ""}`}
                  role="tab"
                  aria-selected={active}
                  onClick={() => onOpenEntry(key)}
                >
                  <i className="gl-entry-dot" style={{ background: kindColor(entry.kind) }} />
                  {entry.items[0] && (
                    <span className="gl-entry-poster">
                      <Poster work={entry.items[0]} kind={entry.kind} />
                    </span>
                  )}
                  <span className="gl-entry-title">{entry.collectionTitle}</span>
                  <span className="gl-entry-count">{entry.items.length}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
