import { Download, Globe, GripVertical, ArrowDown, ArrowUp, Plus, Share2, StickyNote, Undo2, Users } from "lucide-react";
import { Poster } from "../components/Poster";
import { heading } from "./helpers";
import { undoLastAction } from "../lib/ranking";
import { noteKey, hasNote } from "../lib/notes";
import type { ProfileViewProps } from "./types";
import type { RankedArtwork } from "../lib/profile";
import { useRef, useState } from "react";

export function ProfileView({ profile, activeRanking, locale, t, label, format, setFormat, exportLayout, setExportLayout, exportProfile, share, shareUrl, qrUrl, profileName, setProfileName, namedProfile, persist, navigateTo, peer, editingRankIdx, setEditingRankIdx, editingRankTitle, setEditingRankTitle, renameRank, openCollection, shareSingleRanking, generateShareLink, setActiveKind, ranking, setRanking, collection, notes, openNoteModal, accountToken, publishToPlaza, reorderMode, reorderItems, startReorder, saveReorder, cancelReorder, moveItem, busy }: ProfileViewProps) {
  const profileRankIdx = profile.rankings.indexOf(activeRanking);
  const isRenamingProfile = editingRankIdx === profileRankIdx;
  const isReordering = reorderMode === profileRankIdx;
  const [publishDesc, setPublishDesc] = useState("");
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishBurst, setPublishBurst] = useState(false);
  const [exporting, setExporting] = useState(false);

  function handlePublish() {
    publishToPlaza(activeRanking, publishDesc);
    setShowPublishModal(false);
    setPublishDesc("");
    setPublishBurst(true);
    setTimeout(() => setPublishBurst(false), 1200);
  }

  return <>
    {heading(t("我的文化索引", "MY CULTURE INDEX"), profile.profileName, `${profile.rankings.length} ${t("个领域", "media")} / ${profile.rankings.reduce((count, entry) => count + entry.items.length, 0)} ${t("件作品", "works")}`)}
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8, gap: 8, alignItems: "center" }}>
      <button className="button secondary" title={t("批注此画像", "Annotate this profile")} onClick={() => openNoteModal(noteKey("profile", profile.profileId), profile.profileName, "film")} style={{ fontSize: 12, gap: 5, padding: "5px 12px", borderRadius: 999, color: hasNote(notes, noteKey("profile", profile.profileId)) ? "var(--accent)" : "var(--muted)", borderColor: hasNote(notes, noteKey("profile", profile.profileId)) ? "var(--accent)" : "var(--line)" }}><StickyNote size={14} />{hasNote(notes, noteKey("profile", profile.profileId)) ? t("画像批注", "Profile note") : t("添加画像批注", "Add profile note")}</button>
      <button className="button secondary" title={t("分享链接", "Share link")} disabled={busy} onClick={() => void generateShareLink()} style={{ fontSize: 12, gap: 5, padding: "5px 12px", borderRadius: 999 }}><Share2 size={14} />{busy ? t("生成中…", "Generating…") : t("分享链接", "Share link")}</button>
    </div>
    {format === "png" && <div className="export-layout-switch"><span>{t("PNG 版式", "PNG layout")}</span><div className="segmented"><button className={exportLayout === "editorial" ? "active" : ""} onClick={() => setExportLayout("editorial")}>{t("编辑", "Editorial")}</button><button className={exportLayout === "collage" ? "active" : ""} onClick={() => setExportLayout("collage")}>{t("拼贴", "Collage")}</button><button className={exportLayout === "minimal" ? "active" : ""} onClick={() => setExportLayout("minimal")}>{t("极简", "Minimal")}</button></div></div>}
    <div className="profile-dimensions">{profile.rankings.map((entry, idx) => { const key = `${entry.kind}-${idx}`; return <button className={`profile-dimension medium-${entry.kind} ${activeRanking === entry ? "active" : ""}`} key={key} onClick={() => setActiveKind(key)}><Poster work={entry.items[0]} kind={entry.kind} /><span>{label(entry.kind)}</span><strong>{entry.collectionTitle}</strong><small>TOP {entry.items.length}</small></button>; })}</div>
    <div className="profile-layout">
      <section>
        <div className="section-heading">
          {isRenamingProfile
            ? <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input type="text" value={editingRankTitle} onChange={(e) => setEditingRankTitle(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") renameRank(profileRankIdx); if (e.key === "Escape") setEditingRankIdx(null); }} style={{ fontSize: 18, fontWeight: 600, padding: "4px 8px", minHeight: "auto", flex: 1 }} autoFocus />
                <button className="text-button" onClick={() => renameRank(profileRankIdx)} style={{ color: "var(--accent)", fontSize: 14 }}>✓</button>
              </div>
            : <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
                {activeRanking.collectionTitle}
                <button className="button secondary" title={t("批注此榜单", "Annotate this list")} onClick={() => openNoteModal(noteKey("ranking", activeRanking.kind, activeRanking.collectionTitle), activeRanking.collectionTitle, activeRanking.kind, [activeRanking.items[0]?.posterUrls?.[0] ?? ""])} style={{ fontSize: 11, gap: 4, padding: "3px 10px", borderRadius: 999, minHeight: "auto", color: hasNote(notes, noteKey("ranking", activeRanking.kind, activeRanking.collectionTitle)) ? "var(--accent)" : "var(--muted)", borderColor: hasNote(notes, noteKey("ranking", activeRanking.kind, activeRanking.collectionTitle)) ? "var(--accent)" : "var(--line)" }}>
                  <StickyNote size={12} />{hasNote(notes, noteKey("ranking", activeRanking.kind, activeRanking.collectionTitle)) ? t("批注", "Note") : t("添加批注", "Add note")}
                </button>
              </h2>
          }
          <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
            <span>{new Date(activeRanking.createdAt).toLocaleDateString(locale === "zh" ? "zh-CN" : "en-US")}</span>
            <button className="text-button" onClick={() => { setEditingRankIdx(profileRankIdx); setEditingRankTitle(activeRanking.collectionTitle); }} style={{ fontSize: 12, color: "var(--muted)" }}>{t("改名", "Rename")}</button>
            <button className="text-button" onClick={() => { const works = activeRanking.items.map(item => ({ id: item.id, title: item.title, subtitle: item.subtitle, creator: item.creator, year: item.year, posterUrls: item.posterUrls })); openCollection({ id: `rerank-${activeRanking.profileId}`, kind: activeRanking.kind, source: "custom", title: activeRanking.collectionTitle, description: "", topN: activeRanking.items.length, works }); }} style={{ fontSize: 12, color: "var(--accent)" }}>{t("重新排序", "Re-rank")}</button>
            <button className="text-button" onClick={() => void shareSingleRanking(activeRanking)} style={{ fontSize: 12, color: "var(--accent)" }}>{t("比较链接", "Compare link")}</button>
            <button className="text-button" onClick={() => void generateShareLink(activeRanking)} style={{ fontSize: 12, color: "var(--accent)" }}>{t("分享链接", "Share link")}</button>
            {accountToken && <button className="text-button" onClick={() => setShowPublishModal(true)} style={{ fontSize: 12, color: "var(--accent)", position: "relative" }}><Globe size={12} style={{ verticalAlign: "middle", marginRight: 3 }} />{t("发布到广场", "Publish to plaza")}{publishBurst && <span className="publish-burst">{Array.from({ length: 12 }).map((_, i) => { const colors = ["var(--accent)", "#4ade80", "#818cf8", "#f472b6", "#facc15"]; return <span key={i} className="publish-particle" style={{ "--angle": i * 30 + "deg", "--delay": i * 0.03 + "s", "--color": colors[i % 5] } as any} />; })}</span>}</button>}
            {!isReordering && <button className="text-button" onClick={() => startReorder(profileRankIdx)} style={{ fontSize: 12, color: "var(--accent)" }}>{t("手动调整", "Manual order")}</button>}
          </div>
        </div>

        {isReordering ? (
          <ReorderList
            items={reorderItems}
            kind={activeRanking.kind}
            t={t}
            moveItem={moveItem}
            onSave={saveReorder}
            onCancel={cancelReorder}
            notes={notes}
            openNoteModal={openNoteModal}
          />
        ) : (
          <ol className="ranking-list">
            {activeRanking.items.map((work) => (
              <li key={work.id}>
                <span className="row-number">{work.rank <= 3 ? (work.rank === 1 ? "🥇" : work.rank === 2 ? "🥈" : "🥉") : String(work.rank).padStart(2, "0")}</span>
                <Poster work={work} kind={activeRanking.kind} />
                <div><strong>{work.title}</strong><small>{work.creator} {work.year}</small></div>
                {work.rank <= 3 && <span style={{ fontSize: work.rank === 1 ? 20 : 16 }}>{work.rank === 1 ? "🥇" : work.rank === 2 ? "🥈" : "🥉"}</span>}
                <button className="icon-button" title={t("批注", "Note")} onClick={(e) => { e.stopPropagation(); openNoteModal(noteKey("work", activeRanking.kind, work.id), work.title, activeRanking.kind, work.posterUrls); }} style={{ width: 28, height: 28, marginLeft: "auto", color: hasNote(notes, noteKey("work", activeRanking.kind, work.id)) ? "var(--accent)" : "var(--muted)", opacity: hasNote(notes, noteKey("work", activeRanking.kind, work.id)) ? 1 : 0.4 }}><StickyNote size={14} /></button>
              </li>
            ))}
          </ol>
        )}
      </section>

      <aside className="export-tools">
        <label htmlFor="profile-name">{t("画像名称", "Profile name")}</label>
        <input id="profile-name" value={profileName} maxLength={80} onChange={(event) => { setProfileName(event.target.value); }} onBlur={() => { const next = namedProfile(); if (next) persist(next); }} />
        <label htmlFor="export-format">{t("导出格式", "Export format")}</label>
        <select id="export-format" value={format} onChange={(event) => setFormat(event.target.value as typeof format)}>{["json", "png", "txt", "csv", "md"].map((item) => <option key={item} value={item}>{item.toUpperCase()}</option>)}</select>
        <button className="button primary" disabled={exporting} onClick={async () => { setExporting(true); try { await exportProfile(); } finally { setExporting(false); } }}><Download size={16} />{exporting ? t("导出中…", "Exporting…") : t("导出全部维度", "Export all media")}</button>
        <button className="button secondary" onClick={share}><Share2 size={16} />{t("复制比较链接", "Copy comparison link")}</button>
        {shareUrl && <div className="share-output"><input aria-label={t("比较链接", "Comparison link")} readOnly value={shareUrl} onFocus={(event) => event.target.select()} />{qrUrl && <img src={qrUrl} alt={t("比较二维码", "Comparison QR code")} />}</div>}
        <button className="button quiet" onClick={() => navigateTo("home")}><Plus size={16} />{t("添加另一个维度", "Add another medium")}</button>
        <button className="button quiet" onClick={() => navigateTo("compare")}><Users size={16} />{peer ? t("继续与好友比较", "Continue comparison") : t("与他人比较", "Compare with someone")}</button>
        {ranking?.completed && collection?.kind === activeRanking.kind && <button className="button quiet" onClick={() => { setRanking(undoLastAction(ranking)); navigateTo("sorting"); }}><Undo2 size={16} />{t("返回最后一次取舍", "Revisit last choice")}</button>}
      </aside>
    </div>

    {/* Publish to Plaza Modal */}
    {showPublishModal && (
      <div className="modal-backdrop" onClick={() => setShowPublishModal(false)}>
        <section className="note-modal" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setShowPublishModal(false); }}>
          <div className="note-modal-content">
            <span className="eyebrow">PLAZA</span>
            <h2>{t("发布到广场", "Publish to Plaza")}</h2>
            <p style={{ fontSize: 13, color: "var(--muted)", marginBottom: 12, lineHeight: 1.7 }}>
              {t(`将「${activeRanking.collectionTitle}」发布到文化广场，其他用户可以看到、点赞、留言和使用你的榜单排序。`, `Publish "${activeRanking.collectionTitle}" to the Culture Plaza. Others can see, like, comment, and sort with your ranking.`)}
            </p>
            <textarea className="note-textarea" value={publishDesc} onChange={(e) => setPublishDesc(e.target.value)} placeholder={t("添加描述，让其他人了解你的榜单…（可选）\n\n例如：这是我看过的最好的华语电影 Top 10", "Add a description to help others understand your ranking… (optional)\n\nFor example: My top 10 Chinese films of all time")} rows={5} autoFocus />
            <div className="guide-modal-footer">
              <button className="button secondary" onClick={() => { setShowPublishModal(false); setPublishDesc(""); }}>{t("取消", "Cancel")}</button>
              <button className="button primary" onClick={handlePublish} style={{ position: "relative" }}>
                <Globe size={14} style={{ marginRight: 4 }} />
                {t("发布", "Publish")}
                {publishBurst && <span className="publish-burst">{Array.from({ length: 12 }).map((_, i) => { const colors = ["var(--accent)", "#4ade80", "#818cf8", "#f472b6", "#facc15"]; return <span key={i} className="publish-particle" style={{ "--angle": i * 30 + "deg", "--delay": i * 0.03 + "s", "--color": colors[i % 5] } as any} />; })}</span>}
              </button>
            </div>
          </div>
        </section>
      </div>
    )}
  </>;
}

function ReorderList({ items, kind, t, moveItem, onSave, onCancel, notes, openNoteModal }: {
  items: RankedArtwork[];
  kind: import("../data/media").MediaKind;
  t: (zh: string, en: string) => string;
  moveItem: (from: number, to: number) => void;
  onSave: () => void;
  onCancel: () => void;
  notes: Record<string, string>;
  openNoteModal: (key: string, title: string, kind: import("../data/media").MediaKind, posterUrls?: readonly string[]) => void;
}) {
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
    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
    const midY = rect.top + rect.height / 2;
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
    moveItem(from, to === from ? from : to > from ? to - 1 : to);
    setDropIdx(null);
    dragIndex.current = null;
  }

  return (
    <div>
      <ol className="ranking-list reorder-list">
        {items.map((work, idx) => (
          <li
            key={work.id}
            className={`reorder-item ${dropIdx === idx ? "drop-before" : ""} ${dropIdx === items.length && idx === items.length - 1 ? "drop-after" : ""}`}
            draggable="true"
            onDragStart={(e) => handleDragStart(e, idx)}
            onDragEnd={handleDragEnd}
            onDragOver={(e) => handleDragOver(e, idx)}
            onDrop={(e) => handleDrop(e, idx)}
          >
            <span className="reorder-handle" title={t("拖拽排序", "Drag to reorder")}>
              <GripVertical size={16} />
            </span>
            <span className="row-number">{String(idx + 1).padStart(2, "0")}</span>
            <Poster work={work} kind={kind} />
            <div><strong>{work.title}</strong><small>{work.creator} {work.year}</small></div>
            <div style={{ display: "flex", gap: 2, marginLeft: "auto", flexShrink: 0 }}>
              <button className="icon-button" title={t("上移", "Move up")} disabled={idx === 0} onClick={() => moveItem(idx, idx - 1)} style={{ width: 28, height: 28 }}><ArrowUp size={14} /></button>
              <button className="icon-button" title={t("下移", "Move down")} disabled={idx === items.length - 1} onClick={() => moveItem(idx, idx + 1)} style={{ width: 28, height: 28 }}><ArrowDown size={14} /></button>
              <button className="icon-button" title={t("批注", "Note")} onClick={(e) => { e.stopPropagation(); openNoteModal(noteKey("work", kind, work.id), work.title, kind, work.posterUrls); }} style={{ width: 28, height: 28, color: hasNote(notes, noteKey("work", kind, work.id)) ? "var(--accent)" : "var(--muted)", opacity: hasNote(notes, noteKey("work", kind, work.id)) ? 1 : 0.4 }}><StickyNote size={14} /></button>
            </div>
          </li>
        ))}
      </ol>
      <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
        <button className="button secondary" onClick={onCancel}>{t("取消", "Cancel")}</button>
        <button className="button primary" onClick={onSave}>{t("保存", "Save")}</button>
      </div>
    </div>
  );
}
