import { useRef, useState, type ReactNode } from "react";
import { ArrowDown, ArrowUp, GripVertical, Trash2 } from "lucide-react";
import type { MediaKind } from "../data/mediaKinds";
import type { RankedArtwork } from "../lib/profile";
import { Poster } from "./Poster";

export interface ParsedWorkLine {
  title: string;
  creator?: string;
  year?: number;
}

/** 解析多行手动输入（支持 `作品名 - 创作者 (年份)`）。 */
export function parseManualWorkLines(raw: string): ParsedWorkLine[] {
  const result: ParsedWorkLine[] = [];
  for (const line of raw.split(/\n+/)) {
    let s = line.trim();
    if (!s) continue;
    let creator: string | undefined;
    let year: number | undefined;
    const yearMatch = s.match(/[（(](\d{4})[）)]\s*$/);
    if (yearMatch && yearMatch.index !== undefined) {
      year = Number(yearMatch[1]);
      s = s.slice(0, yearMatch.index).trim();
    }
    const dashIdx = s.indexOf(" - ");
    if (dashIdx > 0) {
      creator = s.slice(dashIdx + 3).trim();
      s = s.slice(0, dashIdx).trim();
    }
    if (s) result.push({ title: s, creator, year });
  }
  return result;
}

export interface SortableWorkListProps {
  items: RankedArtwork[];
  kind: MediaKind;
  t: (zh: string, en: string) => string;
  onMove: (from: number, to: number) => void;
  onRemove?: (idx: number) => void;
  minItems?: number;
  renderExtra?: (work: RankedArtwork, idx: number) => ReactNode;
}

export function SortableWorkList({
  items,
  kind,
  t,
  onMove,
  onRemove,
  minItems = 1,
  renderExtra,
}: SortableWorkListProps) {
  const dragIndex = useRef<number | null>(null);
  const [dropIdx, setDropIdx] = useState<number | null>(null);

  function handleDragStart(e: React.DragEvent, idx: number) {
    dragIndex.current = idx;
    e.dataTransfer.effectAllowed = "move";
    e.dataTransfer.setData("text/plain", String(idx));
    (e.currentTarget as HTMLElement).classList.add("dragging");
  }

  function handleDragEnd(e: React.DragEvent) {
    (e.currentTarget as HTMLElement).classList.remove("dragging");
    setDropIdx(null);
    dragIndex.current = null;
  }

  function handleDragOver(e: React.DragEvent, idx: number) {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    const target = idx <= (dragIndex.current ?? -1) ? idx : idx + 1;
    setDropIdx(target);
  }

  function handleDrop(e: React.DragEvent, idx: number) {
    e.preventDefault();
    const from = dragIndex.current;
    if (from === null) return;
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
    const to = e.clientY < midY ? idx : idx + 1;
    onMove(from, to === from ? from : to > from ? to - 1 : to);
    setDropIdx(null);
    dragIndex.current = null;
  }

  return (
    <ol className="ranking-list reorder-list">
      {items.map((work, idx) => (
        <li
          key={work.id}
          className={`reorder-item ${dropIdx === idx ? "drop-before" : ""} ${dropIdx === items.length && idx === items.length - 1 ? "drop-after" : ""}`}
          draggable
          onDragStart={(e) => handleDragStart(e, idx)}
          onDragEnd={handleDragEnd}
          onDragOver={(e) => handleDragOver(e, idx)}
          onDrop={(e) => handleDrop(e, idx)}
        >
          <span className="reorder-handle" title={t("拖拽排序", "Drag to reorder")}>
            <GripVertical size={16} />
          </span>
          <span className="row-number">{String(idx + 1).padStart(2, "0")}</span>
          <span className="ranking-card-poster">
            <Poster work={work} kind={kind} />
          </span>
          <div>
            <strong>{work.title}</strong>
            <small>
              {work.creator} {work.year}
            </small>
          </div>
          <div style={{ display: "flex", gap: 2, marginLeft: "auto", flexShrink: 0 }}>
            <button
              className="icon-button hit-expand icon-button-sm"
              aria-label={t("上移", "Move up")}
              title={t("上移", "Move up")}
              disabled={idx === 0}
              onClick={() => onMove(idx, idx - 1)}
            >
              <ArrowUp size={14} />
            </button>
            <button
              className="icon-button hit-expand icon-button-sm"
              aria-label={t("下移", "Move down")}
              title={t("下移", "Move down")}
              disabled={idx === items.length - 1}
              onClick={() => onMove(idx, idx + 1)}
            >
              <ArrowDown size={14} />
            </button>
            {onRemove && (
              <button
                className="icon-button hit-expand icon-button-sm"
                aria-label={t("移除", "Remove")}
                title={t("移除", "Remove")}
                disabled={items.length <= minItems}
                onClick={() => onRemove(idx)}
                style={{
                  color: "var(--red)",
                  opacity: items.length <= minItems ? 0.3 : 1,
                }}
              >
                <Trash2 size={14} />
              </button>
            )}
            {renderExtra?.(work, idx)}
          </div>
        </li>
      ))}
    </ol>
  );
}
