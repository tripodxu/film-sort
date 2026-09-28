// gallery 主题（PLAN-ui-modernization P3）的榜单卡片墙（L3 条件渲染）。
// 海报正面 / 批注背面，hover（桌面）或点按（触屏）3D 翻转；
// reduced-motion 下由 CSS 降级为「平铺展开」（正反面上下铺开，无 3D 变换）。
// 交互语义与既有榜单行一致：桌面点击 = 作品详情；批注入口在背面。
import { useMemo, useState } from "react";
import { StickyNote } from "lucide-react";
import { Poster } from "./Poster";
import { hasNote, noteKey } from "../lib/notes";
import type { MediaKind } from "../data/media";
import type { RankedArtwork } from "../lib/profile";

const NOTE_EXCERPT_CHARS = 60;

export function GalleryWall({
  items,
  kind,
  t,
  notes,
  openNoteModal,
  openArtworkDetail,
}: {
  items: readonly RankedArtwork[];
  kind: MediaKind;
  t: (zh: string, en: string) => string;
  notes: Record<string, string>;
  openNoteModal: (
    key: string,
    title: string,
    kind: MediaKind,
    posterUrls?: readonly string[],
  ) => void;
  openArtworkDetail: (work: RankedArtwork, kind: MediaKind) => void;
}) {
  // 触屏（hover:none）点按 = 翻面；桌面点击 = 详情（与旧榜单行同语义）。
  // matchMedia 结果在会话内不会变，读到内存即可。
  const hoverNone = useMemo(
    () =>
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(hover: none)").matches,
    [],
  );
  const [flippedId, setFlippedId] = useState<string | null>(null);

  return (
    <ol className="gl-wall">
      {items.map((work) => {
        const noteText = notes[noteKey("work", kind, work.id)] ?? "";
        const flipped = flippedId === work.id;
        return (
          <li key={work.id} className={`gl-card${flipped ? " flipped" : ""}`}>
            <div
              className="gl-card-inner"
              role="button"
              tabIndex={0}
              aria-label={`${work.rank}. ${work.title}`}
              onClick={() => {
                if (hoverNone) setFlippedId(flipped ? null : work.id);
                else openArtworkDetail(work, kind);
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  openArtworkDetail(work, kind);
                }
              }}
            >
              <div className="gl-card-face gl-card-front">
                <Poster work={work} kind={kind} />
                <span className="gl-card-rank">{String(work.rank).padStart(2, "0")}</span>
                <span className="gl-card-caption">{work.title}</span>
              </div>
              <div className="gl-card-face gl-card-back">
                <span className="gl-card-rank">{String(work.rank).padStart(2, "0")}</span>
                <strong>{work.title}</strong>
                <small>
                  {work.creator} {work.year}
                </small>
                <p className="gl-card-note">
                  {noteText
                    ? noteText.length > NOTE_EXCERPT_CHARS
                      ? `${noteText.slice(0, NOTE_EXCERPT_CHARS)}…`
                      : noteText
                    : t("还没有批注。", "No note yet.")}
                </p>
                <div className="gl-card-actions">
                  <button
                    className="rank-pill"
                    onClick={(e) => {
                      e.stopPropagation();
                      openNoteModal(
                        noteKey("work", kind, work.id),
                        work.title,
                        kind,
                        work.posterUrls,
                      );
                    }}
                  >
                    <StickyNote size={11} />
                    {hasNote(notes, noteKey("work", kind, work.id))
                      ? t("批注", "Note")
                      : t("添加批注", "Add note")}
                  </button>
                  <button
                    className="rank-pill"
                    onClick={(e) => {
                      e.stopPropagation();
                      openArtworkDetail(work, kind);
                    }}
                  >
                    {t("详情", "Detail")}
                  </button>
                </div>
              </div>
            </div>
          </li>
        );
      })}
    </ol>
  );
}
