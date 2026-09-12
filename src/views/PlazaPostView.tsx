import { useEffect, useState } from "react";
import { ArrowDown, ArrowLeft, ArrowUp, GripVertical, Heart, MessageCircle, PenLine, Play, Plus, Trash2, Send } from "lucide-react";
import { Poster } from "../components/Poster";
import { RankingDetail } from "../components/RankingDetail";
import { ExpandableNote } from "../components/ExpandableNote";
import { heading } from "./helpers";
import type { PlazaPostViewProps, PlazaPost, PlazaComment } from "./types";
import type { MediaKind } from "../data/media";
import type { ArtisticProfile, RankedArtwork } from "../lib/profile";

export function PlazaPostView({ postId, t, label, navigateTo, accountToken, accountNickname, openCollection, profile, setNotice, setPeer, openArtworkDetail, openNoteView }: PlazaPostViewProps) {
  const [post, setPost] = useState<PlazaPost | null>(null);
  const [comments, setComments] = useState<PlazaComment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [liked, setLiked] = useState(false);
  const [likeCount, setLikeCount] = useState(0);
  const [commentText, setCommentText] = useState("");
  const [commentBusy, setCommentBusy] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [editItems, setEditItems] = useState<RankedArtwork[] | null>(null);
  const [editManual, setEditManual] = useState("");
  const [editHistory, setEditHistory] = useState<Array<{ id: number; action: string; detail: string | null; created_at: string }> | null>(null);

  // Parse notes from post
  const parsedNotes: Record<string, string> = (() => {
    if (!post?.notes) return {};
    try {
      const raw = typeof post.notes === "string" ? JSON.parse(post.notes) : post.notes;
      return raw && typeof raw === "object" ? raw : {};
    } catch { return {}; }
  })();
  const [replyTo, setReplyTo] = useState<number | null>(null);
  const [replyText, setReplyText] = useState("");

  useEffect(() => { void loadPost(); }, [postId]);

  async function loadPost() {
    setLoading(true);
    setError("");
    try {
      const response = await fetch(`/api/plaza/posts/${postId}`);
      if (!response.ok) throw new Error();
      const data = await response.json() as { post: PlazaPost; comments: PlazaComment[] };
      setPost(data.post);
      setComments(data.comments);
      setLikeCount(data.post.like_count);
      setLiked(!!data.post.liked_by_me);
    } catch {
      setError(t("无法加载帖子详情。", "Failed to load post details."));
    } finally {
      setLoading(false);
    }
  }

  async function handleLike() {
    if (!accountToken) {
      setNotice(t("请先登录。", "Please sign in first."));
      return;
    }
    try {
      const response = await fetch(`/api/plaza/posts/${postId}/like`, {
        method: "POST",
        headers: { authorization: `Bearer ${accountToken}` },
      });
      const data = await response.json() as { liked: boolean };
      setLiked(data.liked);
      setLikeCount((prev) => data.liked ? prev + 1 : Math.max(0, prev - 1));
    } catch {
      setNotice(t("操作失败，请重试。", "Action failed. Please retry."));
    }
  }

  async function handleAddComment(parentId?: number) {
    if (!accountToken) {
      setNotice(t("请先登录。", "Please sign in first."));
      return;
    }
    const content = parentId ? replyText.trim() : commentText.trim();
    if (!content) return;
    setCommentBusy(true);
    try {
      const response = await fetch(`/api/plaza/posts/${postId}/comments`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${accountToken}` },
        body: JSON.stringify({ content, parent_id: parentId || null }),
      });
      if (!response.ok) throw new Error();
      const data = await response.json() as { id: number };
      setComments((prev) => [...prev, {
        id: data.id,
        post_id: postId,
        user_id: 0,
        content,
        parent_id: parentId || null,
        created_at: new Date().toISOString(),
        nickname: accountNickname || t("我", "Me"),
      }]);
      if (parentId) { setReplyTo(null); setReplyText(""); }
      else setCommentText("");
    } catch {
      setNotice(t("评论发送失败，请重试。", "Failed to post comment. Please retry."));
    } finally {
      setCommentBusy(false);
    }
  }

  async function handleDeleteComment(commentId: number) {
    if (!accountToken) return;
    try {
      const response = await fetch(`/api/comments/${commentId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${accountToken}` },
      });
      if (!response.ok) throw new Error();
      setComments((prev) => prev.filter((c) => c.id !== commentId));
    } catch {
      setNotice(t("删除评论失败。", "Failed to delete comment."));
    }
  }

  async function handleDeletePost() {
    if (!accountToken || !post) return;
    try {
      const response = await fetch(`/api/plaza/posts/${postId}`, {
        method: "DELETE",
        headers: { authorization: `Bearer ${accountToken}` },
      });
      if (!response.ok) throw new Error();
      setNotice(t("帖子已删除。", "Post deleted."));
      navigateTo("plaza");
    } catch {
      setNotice(t("删除失败，请重试。", "Delete failed. Please retry."));
    }
  }

  function useForSorting() {
    if (!post) return;
    const works = post.items ?? post.top_items ?? [];
    if (!works.length) return;
    openCollection({
      id: `plaza-${post.id}`,
      kind: post.kind as MediaKind,
      source: "custom",
      title: post.collection_title,
      description: "",
      topN: works.length,
      works,
    });
  }

  function compareWithMe() {
    if (!post) return;
    if (isProfilePost) {
      if (!profileRankings.length) return;
      const profilePeer: ArtisticProfile = {
        version: 2,
        profileId: crypto.randomUUID(),
        profileName: post.nickname || t("匿名用户", "Anonymous"),
        updatedAt: post.updated_at,
        rankings: profileRankings.map((entry) => ({ ...entry, profileId: entry.profileId || crypto.randomUUID() })),
      };
      setPeer(profilePeer);
      try { localStorage.setItem("art-rank:peer:v2", JSON.stringify(profilePeer)); } catch {}
      navigateTo("compare");
      return;
    }
    const works = post.items ?? [];
    if (!works.length) return;
    const ranking: ArtisticProfile = {
      version: 2,
      profileId: crypto.randomUUID(),
      profileName: post.nickname || t("匿名用户", "Anonymous"),
      updatedAt: post.updated_at,
      rankings: [{
        version: 1,
        profileId: crypto.randomUUID(),
        profileName: post.nickname || t("匿名用户", "Anonymous"),
        kind: post.kind as MediaKind,
        collectionTitle: post.collection_title,
        createdAt: post.created_at,
        items: works.map((item, idx) => ({ ...item, rank: item.rank || idx + 1 })),
      }],
    };
    setPeer(ranking);
    try { localStorage.setItem("art-rank:peer:v2", JSON.stringify(ranking)); } catch {}
    navigateTo("compare");
  }

  if (loading) {
    return (
      <div className="empty-state" style={{ padding: 60 }}>
        <p>{t("正在加载…", "Loading…")}</p>
      </div>
    );
  }

  if (error || !post) {
    return (
      <div className="empty-state" style={{ padding: 60 }}>
        <p style={{ color: "var(--red)", marginBottom: 12 }}>{error || t("帖子不存在。", "Post not found.")}</p>
        <button className="button secondary" onClick={() => navigateTo("plaza")}>
          {t("返回广场", "Back to plaza")}
        </button>
      </div>
    );
  }

  const isProfilePost = post.post_type === "profile";
  const profileRankings = isProfilePost ? ((post.items ?? []) as unknown as ArtisticProfile["rankings"]) : [];
  // 服务端按 token 判定作者身份；旧数据兜底用昵称比对
  const isAuthor = !!(accountToken && (post.is_author || (profile && !post.is_author && post.nickname === accountNickname && post.is_author === undefined)));

  function openCollectionFromRanking(kind: MediaKind, title: string, works: RankedArtwork[], key: string) {
    openCollection({
      id: `plaza-${post!.id}-${key}`,
      kind,
      source: "custom",
      title,
      description: "",
      topN: works.length,
      works,
    });
  }

  function startEdit() {
    if (!post) return;
    setEditItems((post.items ?? []).map((w) => ({ ...w })));
    setEditManual("");
  }
  function moveEditItem(from: number, to: number) {
    setEditItems((cur) => {
      if (!cur || to < 0 || to >= cur.length || from === to) return cur;
      const next = [...cur];
      const [moved] = next.splice(from, 1);
      next.splice(to, 0, moved);
      return next;
    });
  }
  function addEditWork(title: string, creator?: string, year?: number) {
    const clean = title.trim();
    if (!clean) return;
    setEditItems((cur) => {
      if (!cur || cur.some((w) => w.title === clean)) return cur;
      return [...cur, { id: `pe-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`, title: clean, rank: cur.length + 1, ...(creator ? { creator } : {}), ...(year ? { year } : {}) }];
    });
  }
  function parseEditManual() {
    editManual.split(/\n+/).forEach((line) => {
      let s = line.trim();
      if (!s) return;
      let creator: string | undefined;
      let year: number | undefined;
      const yearMatch = s.match(/[（(](\d{4})[）)]\s*$/);
      if (yearMatch && yearMatch.index !== undefined) { year = Number(yearMatch[1]); s = s.slice(0, yearMatch.index).trim(); }
      const dashIdx = s.indexOf(" - ");
      if (dashIdx > 0) { creator = s.slice(dashIdx + 3).trim(); s = s.slice(0, dashIdx).trim(); }
      addEditWork(s, creator, year);
    });
    setEditManual("");
  }
  async function saveEdit() {
    if (!post || !editItems || !editItems.length) return;
    setCommentBusy(true);
    try {
      const before = (post.items ?? []).map((w) => w.title);
      const after = editItems.map((w) => w.title);
      const edits: Array<{ action: string; detail: string }> = [];
      for (const title of before) if (!after.includes(title)) edits.push({ action: "remove", detail: title });
      for (const title of after) if (!before.includes(title)) edits.push({ action: "add", detail: title });
      if (!edits.length && JSON.stringify(before) !== JSON.stringify(after)) edits.push({ action: "reorder", detail: t("调整作品顺序", "Reordered works") });
      const response = await fetch(`/api/plaza/posts/${postId}`, { method: "PUT", headers: { "content-type": "application/json", authorization: `Bearer ${accountToken}` }, body: JSON.stringify({ items: editItems, item_count: editItems.length, edits }) });
      if (!response.ok) throw new Error();
      setEditItems(null);
      setNotice(t("帖子已更新。", "Post updated."));
      await loadPost();
    } catch { setNotice(t("保存失败，请重试。", "Failed to save. Please retry.")); }
    finally { setCommentBusy(false); }
  }
  async function openEditHistory() {
    try {
      const response = await fetch(`/api/plaza/posts/${postId}/edits`, { headers: { authorization: `Bearer ${accountToken}` } });
      const data = await response.json() as { edits?: Array<{ id: number; action: string; detail: string | null; created_at: string }> };
      if (response.ok) setEditHistory(data.edits ?? []);
    } catch { setNotice(t("编辑历史加载失败。", "Failed to load edit history.")); }
  }

  return (
    <>
      {heading(
        t("帖子详情", "POST DETAIL"),
        post.collection_title,
        `${post.nickname || t("匿名用户", "Anonymous")} / ${isProfilePost ? t("画像", "Profile") : label(post.kind as MediaKind)} / ${post.item_count} ${t("件作品", "works")}`,
      )}
      {post.description && <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 16, lineHeight: 1.7 }}>{post.description}</p>}

      {/* Edit timestamp marker (public); full history is author-only */}
      {(post.edit_count ?? 0) > 0 && (
        <p className="mini-note" style={{ fontSize: 12, color: "var(--muted)", margin: "-8px 0 14px", display: "flex", gap: 10, alignItems: "center" }}>
          <span>✏️ {t("最后编辑于", "Last edited")} {post.last_edited_at ? new Date(post.last_edited_at).toLocaleString() : "-"}（{(post.edit_count ?? 0)} {t("次", "times")}）</span>
          {isAuthor && (
            <button className="text-button" onClick={() => { setEditHistory(editHistory ? null : []); void openEditHistory(); }} style={{ fontSize: 12 }}>
              {editHistory ? t("收起历史", "Hide history") : t("编辑历史", "Edit history")}
            </button>
          )}
        </p>
      )}
      {editHistory && isAuthor && (
        <div style={{ margin: "0 0 16px", padding: "12px 16px", border: "1px solid var(--line)", borderRadius: 10, fontSize: 12 }}>
          {editHistory.length ? editHistory.map((e) => (
            <div key={e.id} style={{ display: "flex", gap: 10, padding: "5px 0", borderBottom: "1px solid var(--line)" }}>
              <span className="badge badge-visit" style={{ flexShrink: 0 }}>{e.action}</span>
              <span style={{ flex: 1, minWidth: 0, overflowWrap: "anywhere" }}>{e.detail}</span>
              <span style={{ color: "var(--muted)", flexShrink: 0, whiteSpace: "nowrap" }}>{new Date(e.created_at).toLocaleString()}</span>
            </div>
          )) : <p style={{ color: "var(--muted)", margin: 0 }}>…</p>}
        </div>
      )}

      {/* Unified ranking detail (same component as share page & compare detail) */}
      {editItems !== null && isAuthor && !isProfilePost ? (
        <div className="plaza-post-detail">
          <div className="section-heading"><h2>{t("编辑榜单作品", "Edit works")}</h2><span>{t(`${editItems.length} 件`, `${editItems.length} works`)}</span></div>
          <ol className="ranking-list reorder-list">
            {editItems.map((work, idx) => (
              <li key={work.id} className="reorder-item">
                <span className="reorder-handle"><GripVertical size={16} /></span>
                <span className="row-number">{String(idx + 1).padStart(2, "0")}</span>
                <Poster work={work} kind={post.kind as MediaKind} />
                <div><strong>{work.title}</strong><small>{work.creator} {work.year}</small></div>
                <div style={{ display: "flex", gap: 2, marginLeft: "auto", flexShrink: 0 }}>
                  <button className="icon-button" title={t("上移", "Move up")} disabled={idx === 0} onClick={() => moveEditItem(idx, idx - 1)} style={{ width: 28, height: 28 }}><ArrowUp size={14} /></button>
                  <button className="icon-button" title={t("下移", "Move down")} disabled={idx === editItems.length - 1} onClick={() => moveEditItem(idx, idx + 1)} style={{ width: 28, height: 28 }}><ArrowDown size={14} /></button>
                  <button className="icon-button" title={t("移除", "Remove")} disabled={editItems.length <= 1} onClick={() => setEditItems((cur) => (cur ?? []).filter((_, i) => i !== idx))} style={{ width: 28, height: 28, color: "var(--red)", opacity: editItems.length <= 1 ? 0.3 : 1 }}><Trash2 size={14} /></button>
                </div>
              </li>
            ))}
          </ol>
          <div style={{ display: "grid", gap: 10, marginTop: 16, padding: 16, border: "1px solid var(--line)", borderRadius: 12 }}>
            <label style={{ fontSize: 12, color: "var(--muted)" }}>{t("添加作品（每行一件，支持「标题 - 创作者（年份）」）", "Add works (one per line: Title - Creator (Year))")}</label>
            <textarea value={editManual} onChange={(e) => setEditManual(e.target.value)} rows={3} style={{ minHeight: 70, fontSize: 13 }} />
            <div style={{ display: "flex", gap: 8 }}>
              <button className="button secondary" onClick={parseEditManual} style={{ minHeight: 34 }}><Plus size={14} />{t("加入榜单", "Add to list")}</button>
              <div style={{ flex: 1 }} />
              <button className="button secondary" onClick={() => { setEditItems(null); setEditHistory(null); }} style={{ minHeight: 34 }}>{t("取消", "Cancel")}</button>
              <button className="button primary" disabled={commentBusy} onClick={() => void saveEdit()} style={{ minHeight: 34 }}>{commentBusy ? t("保存中…", "Saving…") : t("保存", "Save")}</button>
            </div>
          </div>
        </div>
      ) : isProfilePost ? (
        <div className="plaza-post-detail">
          {profileRankings.map((entry, idx) => (
            <section key={`${entry.kind}-${idx}`} style={{ marginBottom: 36 }}>
              <RankingDetail
                kind={entry.kind}
                collectionTitle={entry.collectionTitle}
                items={entry.items}
                notes={parsedNotes}
                kindLabel={label}
                onNoteView={openNoteView}
                onArtworkClick={openArtworkDetail}
                headerExtra={(
                  <button
                    className="text-button"
                    onClick={() => openCollectionFromRanking(entry.kind, entry.collectionTitle, entry.items, `${entry.kind}-${idx}`)}
                    style={{ fontSize: 12, color: "var(--accent)", flexShrink: 0 }}
                  >
                    <Play size={12} />{t("用此榜单排序", "Sort with this")}
                  </button>
                )}
              />
            </section>
          ))}
        </div>
      ) : (
        <div className="plaza-post-detail">
          <RankingDetail
            kind={post.kind as MediaKind}
            collectionTitle={post.collection_title}
            items={post.items ?? []}
            notes={parsedNotes}
            kindLabel={label}
            onNoteView={openNoteView}
            onArtworkClick={openArtworkDetail}
          />
        </div>
      )}

      {/* Actions */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "24px 0" }}>
        <button
          className={`button ${liked ? "primary" : "secondary"}`}
          onClick={() => void handleLike()}
          style={{ minHeight: 38, fontSize: 13 }}
        >
          <Heart size={15} fill={liked ? "currentColor" : "none"} />
          {t("赞", "Like")} ({likeCount})
        </button>
        {!isProfilePost && (
          <button className="button primary" onClick={useForSorting} style={{ minHeight: 38, fontSize: 13 }}>
            <Play size={15} />
            {t("用此榜单排序", "Sort with this")}
          </button>
        )}
        <button className="button secondary" onClick={compareWithMe} style={{ minHeight: 38, fontSize: 13 }}>
          {isAuthor ? t("与曾经的我比较", "Compare with my past self") : t("与我比较", "Compare with me")}
        </button>
        {isAuthor && !isProfilePost && editItems === null && (
          <button className="button secondary" onClick={startEdit} style={{ minHeight: 38, fontSize: 13 }}>
            <PenLine size={15} />
            {t("编辑榜单", "Edit works")}
          </button>
        )}
      </div>

      {/* Profile-level note (profile posts) */}
      {isProfilePost && Object.entries(parsedNotes).filter(([key]) => key.startsWith("profile:")).map(([key, text]) => (
        <div key={key} style={{ margin: "0 0 16px", padding: "12px 16px", borderRadius: 10, background: "rgba(121,217,174,.05)", borderLeft: "2px solid rgba(216,248,106,.2)" }}>
          <ExpandableNote text={text} onView={openNoteView ? (t2) => openNoteView(post.collection_title, t2) : undefined} style={{ margin: 0 }} />
        </div>
      ))}

      {/* Author actions */}
      {isAuthor && (
        <div style={{ display: "flex", gap: 12, marginBottom: 24 }}>
          {!deleteConfirm ? (
            <button
              className="button secondary"
              onClick={() => setDeleteConfirm(true)}
              style={{ minHeight: 34, fontSize: 12, color: "var(--red)" }}
            >
              <Trash2 size={14} />
              {t("删除", "Delete")}
            </button>
          ) : (
            <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
              <span style={{ fontSize: 13, color: "var(--muted)" }}>{t("确认删除？", "Confirm delete?")}</span>
              <button
                className="button primary"
                onClick={() => void handleDeletePost()}
                style={{ minHeight: 34, fontSize: 12, background: "var(--red)" }}
              >
                {t("确认", "Confirm")}
              </button>
              <button
                className="button secondary"
                onClick={() => setDeleteConfirm(false)}
                style={{ minHeight: 34, fontSize: 12 }}
              >
                {t("取消", "Cancel")}
              </button>
            </div>
          )}
        </div>
      )}

      {/* Comment section */}
      <section className="plaza-post-comments" style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--line)" }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 16, color: "var(--muted)", display: "flex", alignItems: "center", gap: 8 }}>
          <MessageCircle size={15} />
          {t("评论", "Comments")} ({comments.length})
        </h3>

        {comments.length === 0 && (
          <p className="empty-state" style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}>
            {t("暂无评论，来说点什么吧。", "No comments yet. Be the first to share your thoughts.")}
          </p>
        )}

        {/* Comment list — threaded */}
        {(() => {
          const roots = comments.filter((c) => !c.parent_id);
          const repliesOf = (parentId: number) => comments.filter((c) => c.parent_id === parentId);
          const renderComment = (comment: PlazaComment, depth: number) => (
            <div key={comment.id} className="comment-item" style={depth > 0 ? { marginLeft: 24, borderLeft: "2px solid var(--line)", paddingLeft: 12 } : undefined}>
              <div className="comment-item-header">
                <span className="comment-author">{comment.nickname || t("匿名用户", "Anonymous")}</span>
                <span className="comment-time">{new Date(comment.created_at).toLocaleString()}</span>
              </div>
              <p className="comment-content">{comment.content}</p>
              <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
                {accountToken && (
                  <button className="text-button" onClick={() => { setReplyTo(replyTo === comment.id ? null : comment.id); setReplyText(""); }} style={{ fontSize: 11, color: "var(--accent)" }}>
                    {replyTo === comment.id ? t("取消回复", "Cancel reply") : t("回复", "Reply")}
                  </button>
                )}
                {accountToken && comment.nickname === accountNickname && (
                  <button className="text-button" onClick={() => void handleDeleteComment(comment.id)} style={{ fontSize: 11, color: "var(--muted)" }}>
                    {t("删除", "Delete")}
                  </button>
                )}
              </div>
              {replyTo === comment.id && (
                <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
                  <input type="text" value={replyText} onChange={(e) => setReplyText(e.target.value)} placeholder={t("写下你的回复…", "Write your reply…")} maxLength={500} style={{ fontSize: 12, padding: "6px 10px", minHeight: "auto", flex: 1 }} autoFocus onKeyDown={(e) => { if (e.key === "Enter") void handleAddComment(comment.id); if (e.key === "Escape") { setReplyTo(null); setReplyText(""); } }} />
                  <button className="button primary" disabled={commentBusy || !replyText.trim()} onClick={() => void handleAddComment(comment.id)} style={{ minHeight: 32, fontSize: 12, paddingInline: 12 }}>{t("回复", "Reply")}</button>
                </div>
              )}
              {repliesOf(comment.id).map((reply) => renderComment(reply, depth + 1))}
            </div>
          );
          return roots.map((comment) => renderComment(comment, 0));
        })()}

        {/* Add comment form */}
        {accountToken ? (
          <div className="comment-form">
            <textarea
              className="comment-textarea"
              value={commentText}
              onChange={(e) => setCommentText(e.target.value)}
              placeholder={t("写下你的评论…（最多500字）", "Write your comment… (max 500 chars)")}
              maxLength={500}
              rows={3}
              style={{ minHeight: 80 }}
            />
            <button
              className="button primary"
              disabled={commentBusy || !commentText.trim()}
              onClick={() => void handleAddComment()}
              style={{ alignSelf: "flex-end", minHeight: 36, fontSize: 13 }}
            >
              <Send size={14} />
              {commentBusy ? t("发送中…", "Sending…") : t("发表评论", "Post comment")}
            </button>
          </div>
        ) : (
          <p style={{ fontSize: 13, color: "var(--muted)", marginTop: 12 }}>
            {t("登录后即可评论。", "Sign in to comment.")}
          </p>
        )}
      </section>

      {/* Back */}
      <div style={{ marginTop: 32 }}>
        <button className="button secondary" onClick={() => navigateTo("plaza")} style={{ minHeight: 34 }}>
          <ArrowLeft size={15} />
          {t("返回广场", "Back to plaza")}
        </button>
      </div>
    </>
  );
}
