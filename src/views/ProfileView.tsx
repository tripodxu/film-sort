import { Download, Globe, GripVertical, ArrowDown, ArrowUp, Link, Plus, Share2, StickyNote, Undo2, Users, X } from "lucide-react";
import { Poster } from "../components/Poster";
import { IconButton } from "./IconButton";
import { heading } from "./helpers";
import { undoLastAction } from "../lib/ranking";
import { noteKey, hasNote } from "../lib/notes";
import type { ProfileViewProps } from "./types";
import type { RankedArtwork } from "../lib/profile";
import { useRef, useState } from "react";

export function ProfileView({ profile, activeRanking, locale, t, label, format, setFormat, exportLayout, setExportLayout, exportProfile, share, shareUrl, qrUrl, profileName, setProfileName, namedProfile, persist, navigateTo, peer, editingRankIdx, setEditingRankIdx, editingRankTitle, setEditingRankTitle, renameRank, openCollection, shareSingleRanking, openShareModal, setActiveKind, ranking, setRanking, collection, notes, openNoteModal, openArtworkDetail, accountToken, publishToPlaza, publishProfileToPlaza, updateRankingWorks, syncPlazaPost, reorderMode, reorderItems, startReorder, saveReorder, cancelReorder, moveItem, busy }: ProfileViewProps) {
  const profileRankIdx = profile.rankings.indexOf(activeRanking);
  const isRenamingProfile = editingRankIdx === profileRankIdx;
  const isReordering = reorderMode === profileRankIdx;
  const [publishDesc, setPublishDesc] = useState("");
  const [showPublishModal, setShowPublishModal] = useState(false);
  const [publishTarget, setPublishTarget] = useState<"ranking" | "profile">("ranking");
  const [publishBurst, setPublishBurst] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [editWorksOpen, setEditWorksOpen] = useState(false);
  const [plazaSyncPostId, setPlazaSyncPostId] = useState<number | null>(null);

  function handlePublish() {
    if (publishTarget === "profile") publishProfileToPlaza(publishDesc);
    else publishToPlaza(activeRanking, publishDesc);
    setShowPublishModal(false);
    setPublishDesc("");
    setPublishBurst(true);
    setTimeout(() => setPublishBurst(false), 1200);
  }

  function plazaLinkId() {
    try {
      const links = JSON.parse(localStorage.getItem("art-rank:plaza-links") ?? "{}");
      return links[`${activeRanking.kind}|${activeRanking.collectionTitle}`] ?? null;
    } catch { return null; }
  }

  function handleSaveWorks(items: RankedArtwork[]) {
    updateRankingWorks(profileRankIdx, items);
    setEditWorksOpen(false);
    const postId = plazaLinkId();
    if (postId) setPlazaSyncPostId(Number(postId));
  }

  return <>
    {heading(t("我的文化索引", "MY CULTURE INDEX"), profile.profileName, `${profile.rankings.length} ${t("个领域", "media")} / ${profile.rankings.reduce((count, entry) => count + entry.items.length, 0)} ${t("件作品", "works")}`)}
    <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 8, gap: 8, alignItems: "center" }}>
      <button className="button secondary" title={t("批注此画像", "Annotate this profile")} onClick={() => openNoteModal(noteKey("profile", profile.profileId), profile.profileName, "film")} style={{ fontSize: 12, gap: 5, padding: "5px 12px", borderRadius: 999, color: hasNote(notes, noteKey("profile", profile.profileId)) ? "var(--accent)" : "var(--muted)", borderColor: hasNote(notes, noteKey("profile", profile.profileId)) ? "var(--accent)" : "var(--line)" }}><StickyNote size={14} />{hasNote(notes, noteKey("profile", profile.profileId)) ? t("画像批注", "Profile note") : t("添加画像批注", "Add profile note")}</button>
      <button className="button secondary" title={t("分享链接", "Share link")} disabled={busy} onClick={() => openShareModal()} style={{ fontSize: 12, gap: 5, padding: "5px 12px", borderRadius: 999 }}><Share2 size={14} />{busy ? t("生成中…", "Generating…") : t("分享链接", "Share link")}</button>
      {accountToken && <button className="button secondary" title={t("将完整画像发布到广场", "Publish profile to plaza")} disabled={busy} onClick={() => { setPublishTarget("profile"); setShowPublishModal(true); }} style={{ fontSize: 12, gap: 5, padding: "5px 12px", borderRadius: 999 }}><Globe size={14} />{t("发布画像到广场", "Publish profile")}</button>}
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
            <button className="text-button" onClick={() => openShareModal(activeRanking)} style={{ fontSize: 12, color: "var(--accent)" }}>{t("分享链接", "Share link")}</button>
            {accountToken && <button className="text-button" onClick={() => { setPublishTarget("ranking"); setShowPublishModal(true); }} style={{ fontSize: 12, color: "var(--accent)", position: "relative" }}><Globe size={12} style={{ verticalAlign: "middle", marginRight: 3 }} />{t("发布到广场", "Publish to plaza")}{publishBurst && <span className="publish-burst">{Array.from({ length: 12 }).map((_, i) => { const colors = ["var(--accent)", "#4ade80", "#818cf8", "#f472b6", "#facc15"]; return <span key={i} className="publish-particle" style={{ "--angle": i * 30 + "deg", "--delay": i * 0.03 + "s", "--color": colors[i % 5] } as any} />; })}</span>}</button>}
            {!isReordering && <button className="text-button" onClick={() => setEditWorksOpen(true)} style={{ fontSize: 12, color: "var(--accent)" }}>{t("编辑作品", "Edit works")}</button>}
            {!isReordering && !editWorksOpen && <button className="text-button" onClick={() => startReorder(profileRankIdx)} style={{ fontSize: 12, color: "var(--accent)" }}>{t("手动调整", "Manual order")}</button>}
          </div>
        </div>

        {plazaSyncPostId !== null && !editWorksOpen && (
          <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "10px 14px", marginBottom: 14, borderRadius: 10, background: "rgba(216,248,106,.06)", border: "1px solid rgba(216,248,106,.25)", fontSize: 12, color: "var(--muted)" }}>
            <span>{t("该榜单已发布到广场，作品变更后可同步更新广场帖子。", "This list is on the Plaza. Sync your changes to the post.")}</span>
            <button className="text-button" disabled={busy} onClick={() => { syncPlazaPost(plazaSyncPostId, profileRankIdx); setPlazaSyncPostId(null); }} style={{ fontSize: 12, flexShrink: 0 }}>{t("同步到广场", "Sync to plaza")}</button>
            <button className="text-button" onClick={() => setPlazaSyncPostId(null)} style={{ fontSize: 12, color: "var(--muted)", flexShrink: 0 }}>{t("暂不", "Later")}</button>
          </div>
        )}

        {editWorksOpen ? (
          <WorkEditor
            ranking={activeRanking}
            t={t}
            onCancel={() => setEditWorksOpen(false)}
            onSave={handleSaveWorks}
          />
        ) : isReordering ? (
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
                <div className="ranking-card-poster" style={{ cursor: "pointer" }} onClick={() => openArtworkDetail(work, activeRanking.kind)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openArtworkDetail(work, activeRanking.kind); } }}>
                  <Poster work={work} kind={activeRanking.kind} />
                </div>
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
        <button className="button secondary" onClick={() => openShareModal()}><Link size={16} />{t("复制分享链接", "Copy share link")}</button>
        {shareUrl && <div className="share-output"><input aria-label={t("比较链接", "Comparison link")} readOnly value={shareUrl} onFocus={(event) => event.target.select()} />{qrUrl && <img src={qrUrl} alt={t("比较二维码", "Comparison QR code")} />}</div>}
        <button className="button quiet" onClick={() => navigateTo("home")}><Plus size={16} />{t("添加另一个维度", "Add another medium")}</button>
        <button className="button quiet" onClick={() => navigateTo("compare")}><Users size={16} />{peer ? t("继续与好友比较", "Continue comparison") : t("与他人比较", "Compare with someone")}</button>
        {ranking?.completed && collection?.kind === activeRanking.kind && <button className="button quiet" onClick={() => { setRanking(undoLastAction(ranking)); navigateTo("sorting"); }}><Undo2 size={16} />{t("返回最后一次取舍", "Revisit last choice")}</button>}
      </aside>
    </div>

    {/* Publish to Plaza Modal */}
    {showPublishModal && (
      <div className="modal-backdrop" onClick={() => setShowPublishModal(false)}>
        <section className="account-dialog publish-modal" role="dialog" aria-modal="true" aria-labelledby="publish-heading" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => { if (event.key === "Escape") setShowPublishModal(false); }}>
          <div className="section-heading">
            <div>
              <span className="eyebrow">PLAZA</span>
              <h2 id="publish-heading">{t("发布到广场", "Publish to Plaza")}</h2>
            </div>
            <IconButton title={t("关闭", "Close")} onClick={() => setShowPublishModal(false)}><X size={18} /></IconButton>
          </div>
          <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
            {publishTarget === "profile" ? t(`将画像「${profile.profileName}」（${profile.rankings.length} 个榜单）发布到文化广场，其他用户可以看到、点赞、留言和使用其中的榜单排序。`, `Publish profile "${profile.profileName}" (${profile.rankings.length} lists) to the Culture Plaza.`) : t(`将「${activeRanking.collectionTitle}」发布到文化广场，其他用户可以看到、点赞、留言和使用你的榜单排序。`, `Publish "${activeRanking.collectionTitle}" to the Culture Plaza. Others can see, like, comment, and sort with your ranking.`)}
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

function WorkEditor({ ranking, t, onCancel, onSave }: {
  ranking: { kind: import("../data/media").MediaKind; items: RankedArtwork[] };
  t: (zh: string, en: string) => string;
  onCancel: () => void;
  onSave: (items: RankedArtwork[]) => void;
}) {
  const [items, setItems] = useState<RankedArtwork[]>([...ranking.items]);
  const [manual, setManual] = useState("");
  const [searchKey, setSearchKey] = useState("");
  const [results, setResults] = useState<Array<{ title: string; creator?: string; year?: string; rating?: string }>>([]);
  const [searching, setSearching] = useState(false);
  const kind = ranking.kind;

  function addWork(title: string, creator?: string, year?: number) {
    const clean = title.trim();
    if (!clean) return;
    if (items.some((w) => w.title === clean)) return;
    setItems((cur) => [...cur, { id: `edit-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, title: clean, rank: cur.length + 1, ...(creator ? { creator } : {}), ...(year ? { year } : {}) }]);
  }

  function parseManual() {
    manual.split(/\n+/).forEach((line) => {
      let s = line.trim();
      if (!s) return;
      let creator: string | undefined;
      let year: number | undefined;
      const yearMatch = s.match(/[（(](\d{4})[）)]\s*$/);
      if (yearMatch && yearMatch.index !== undefined) { year = Number(yearMatch[1]); s = s.slice(0, yearMatch.index).trim(); }
      const dashIdx = s.indexOf(" - ");
      if (dashIdx > 0) { creator = s.slice(dashIdx + 3).trim(); s = s.slice(0, dashIdx).trim(); }
      addWork(s, creator, year);
    });
    setManual("");
  }

  async function runSearch() {
    const key = searchKey.trim();
    if (!key || kind === "other") return;
    setSearching(true);
    try {
      const apiType = kind === "film" ? "movie" : kind;
      const response = await fetch(`/api/${apiType}/list?key=${encodeURIComponent(key)}&page=1`, { signal: AbortSignal.timeout(20000) });
      const data = await response.json() as { data?: Array<{ title?: string; year?: string; rating?: string; author?: string; artist?: string; actors?: string[] }> };
      setResults((data.data ?? []).slice(0, 8).map((item) => ({
        title: item.title ?? "",
        year: item.year,
        rating: item.rating,
        creator: item.author || item.artist || (Array.isArray(item.actors) ? item.actors[0] : undefined),
      })).filter((item) => item.title));
    } catch { setResults([]); }
    finally { setSearching(false); }
  }

  return (
    <div>
      <div className="section-heading"><h2>{t("编辑作品", "Edit works")}</h2><span>{t(`${items.length} 件`, `${items.length} works`)}</span></div>
      <ol className="ranking-list">
        {items.map((work, idx) => (
          <li key={work.id}>
            <span className="row-number">{String(idx + 1).padStart(2, "0")}</span>
            <Poster work={work} kind={kind} />
            <div><strong>{work.title}</strong><small>{work.creator} {work.year}</small></div>
            <button className="icon-button" title={t("移除", "Remove")} disabled={items.length <= 1} onClick={() => setItems((cur) => cur.filter((_, i) => i !== idx))} style={{ width: 28, height: 28, marginLeft: "auto", color: "var(--red)", opacity: items.length <= 1 ? 0.3 : 1 }}><X size={14} /></button>
          </li>
        ))}
      </ol>
      <div style={{ display: "grid", gap: 14, marginTop: 18, padding: 16, border: "1px solid var(--line)", borderRadius: 12 }}>
        <div>
          <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>{t("手动添加（每行一件，支持「标题 - 创作者（年份）」格式）", "Add manually (one per line: Title - Creator (Year))")}</label>
          <textarea value={manual} onChange={(e) => setManual(e.target.value)} rows={3} placeholder={t("花样年华 - 王家卫（2000）", "In the Mood for Love - Wong Kar-wai (2000)")} style={{ minHeight: 70, fontSize: 13 }} />
          <button className="button secondary" onClick={parseManual} style={{ marginTop: 8, minHeight: 34 }}><Plus size={14} />{t("加入榜单", "Add to list")}</button>
        </div>
        {kind !== "other" && (
          <div>
            <label style={{ fontSize: 12, color: "var(--muted)", display: "block", marginBottom: 6 }}>{t("豆瓣搜索添加", "Search Douban to add")}</label>
            <div style={{ display: "flex", gap: 8 }}>
              <input value={searchKey} onChange={(e) => setSearchKey(e.target.value)} onKeyDown={(e) => { if (e.key === "Enter") void runSearch(); }} placeholder={t("输入关键词搜索", "Type keywords to search")} style={{ flex: 1 }} />
              <button className="button secondary" disabled={searching || !searchKey.trim()} onClick={() => void runSearch()} style={{ minHeight: 34, flexShrink: 0 }}>{searching ? t("搜索中…", "Searching…") : t("搜索", "Search")}</button>
            </div>
            {results.length > 0 && (
              <div style={{ marginTop: 10, display: "grid", gap: 6 }}>
                {results.map((item) => (
                  <div key={item.title + (item.year ?? "")} style={{ display: "flex", alignItems: "center", gap: 10, padding: "8px 10px", border: "1px solid var(--line)", borderRadius: 8, fontSize: 13 }}>
                    <div style={{ flex: 1, minWidth: 0 }}><strong>{item.title}</strong> {item.rating && <small>★{item.rating}</small>}<div className="mini-note">{item.creator} {item.year}</div></div>
                    <button className="text-button" onClick={() => { addWork(item.title, item.creator, item.year ? Number(item.year) : undefined); setResults((cur) => cur.filter((r) => r.title !== item.title)); }} style={{ fontSize: 12, flexShrink: 0 }}><Plus size={12} />{t("添加", "Add")}</button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 16, justifyContent: "flex-end" }}>
        <button className="button secondary" onClick={onCancel}>{t("取消", "Cancel")}</button>
        <button className="button primary" onClick={() => onSave(items)}>{t("保存", "Save")}</button>
      </div>
    </div>
  );
}
