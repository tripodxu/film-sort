/**
 * 比较页的一行榜单条目（ own / peer 两侧共用）。
 *
 * 抽取前：CompareView 把这段 ~100 行 JSX 抄了两遍，只有勾选用的是哪一份 Set 不同。
 * 于是同一个「打开榜单详情」的行为被写成 4 处（`Top3` 卡片的点击 / 键盘各一，
 * 缩略模式一处，再乘以两侧）：改彼忘此就是必然。这里收成一份，差异全走 props，
 * 「点哪里能打开详情」由 `onOpenDetail` 一处决定。
 */
import type { RankingExport } from "../lib/profile";
import { Poster } from "./Poster";

export interface RankingEntryRowProps {
  entry: RankingExport;
  /** 传函数而不是已翻译好的字符串：可访问名称与可见标签因此必然同源。 */
  label: (kind: RankingExport["kind"]) => string;
  showCheck: boolean;
  checked: boolean;
  onToggleCheck: () => void;
  /** 该侧只有一份榜单时展开成 Top3 卡片，否则只显示封面缩略 */
  expanded: boolean;
  onOpenDetail: () => void;
}

export function RankingEntryRow({
  entry,
  label,
  showCheck,
  checked,
  onToggleCheck,
  expanded,
  onOpenDetail,
}: RankingEntryRowProps) {
  const open = (event: { stopPropagation: () => void }) => {
    event.stopPropagation();
    onOpenDetail();
  };
  return (
    <div
      className="ranking-entry-row"
      // 未勾选的候选行整体压暗：唯一一处动态值，其余全部由 .ranking-entry-row 承载
      style={{ opacity: showCheck && !checked ? 0.4 : 1 }}
    >
      {showCheck && (
        <input
          type="checkbox"
          aria-label={`${label(entry.kind)} · ${entry.collectionTitle}`}
          checked={checked}
          onChange={onToggleCheck}
          className="u-shrink0"
        />
      )}
      <span className="ranking-entry-kind">{label(entry.kind)}</span>
      {expanded ? (
        <>
          <span className="u-ellipsis">{entry.collectionTitle}</span>
          <div className="u-spacer" />
          <div
            className="ranking-card-top3"
            onClick={open}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onOpenDetail();
              }
            }}
          >
            {entry.items.slice(0, 3).map((item, i) => (
              <div className="ranking-card-top3-item" key={item.id}>
                <span className="ranking-card-top3-medal">{String(i + 1).padStart(2, "0")}</span>
                <Poster work={item} kind={entry.kind} />
                <span className="ranking-card-top3-name">{item.title}</span>
              </div>
            ))}
          </div>
          <div className="u-spacer" />
          <span className="u-meta-sm u-shrink0">TOP {entry.items.length}</span>
        </>
      ) : (
        <>
          <div className="ranking-card-poster" onClick={open}>
            <Poster work={entry.items[0]} kind={entry.kind} />
          </div>
          <span className="u-spacer u-ellipsis">{entry.collectionTitle}</span>
          <span className="u-meta-sm u-shrink0">TOP {entry.items.length}</span>
        </>
      )}
    </div>
  );
}
