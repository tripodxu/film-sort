import { useEffect, useState } from "react";
import { Heart, MessageCircle, Play, Trash2, Send } from "lucide-react";
import { Poster } from "../components/Poster";
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

  // Parse notes from post
  const parsedNotes: Record<string, string> = (() => {
    if (!post?.notes) return {};
    try {
      const raw = typeof post.notes === "string" ? JSON.parse(post.notes) : post.notes;
      return raw && typeof raw === "object" ? raw : {};
    } catch { return {}; }
  })();
  const rankingNoteKey = post ? `ranking:${post.kind}:${post.collection_title}` : "";
  const hasNotes = Object.keys(parsedNotes).length > 0;
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
      setLiked(Boolean(data.post.liked_by_me));
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

  function compareWithMe() {
    if (!post || !post.items.length) return;
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
        items: post.items.map((item, idx) => ({ ...item, rank: idx + 1 })),
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

  const isAuthor = accountToken && (typeof post.is_author === "boolean" ? post.is_author : !!profile && post.nickname === accountNickname);

  return (
    <>
      {heading(
        t("帖子详情", "POST DETAIL"),
        post.collection_title,
        `${post.nickname || t("匿名用户", "Anonymous")} / ${label(post.kind as MediaKind)} / ${post.item_count} ${t("件作品", "works")}`,
      )}
      {post.description && <p style={{ fontSize: 14, color: "var(--muted)", marginBottom: 16, lineHeight: 1.7 }}>{post.description}</p>}

      {/* Full ranking list */}
      <div className="plaza-post-detail">
        <ol className="ranking-list">
          {post.items.map((work: RankedArtwork, idx: number) => (
            <li key={work.id}>
              <span className="row-number">
                {idx < 3
                  ? idx === 0 ? "🥇" : idx === 1 ? "🥈" : "🥉"
                  : String(idx + 1).padStart(2, "0")}
              </span>
              <div
                className="ranking-card-poster"
                style={{ cursor: "pointer" }}
                onClick={() => openArtworkDetail(work, post.kind as MediaKind)}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); openArtworkDetail(work, post.kind as MediaKind); } }}
              >
                <Poster work={work} kind={post.kind as MediaKind} />
              </div>
              <div>
                <strong>{work.title}</strong>
                <small>{work.creator} {work.year}</small>
                {parsedNotes[`work:${post.kind}:${work.id}`] && <ExpandableNote text={parsedNotes[`work:${post.kind}:${work.id}`]} onView={openNoteView ? (text) => openNoteView(work.title, text, work.posterUrls) : undefined} />}
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Ranking-level note */}
      {parsedNotes[rankingNoteKey] && (
        <div style={{ margin: "16px 0", padding: "12px 16px", borderRadius: 10, background: "rgba(121,217,174,.05)", borderLeft: "2px solid rgba(216,248,106,.2)" }}>
          <ExpandableNote text={parsedNotes[rankingNoteKey]} onView={openNoteView ? (text) => openNoteView(post!.collection_title, text) : undefined} style={{ margin: 0 }} />
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
        <button className="button primary" onClick={useForSorting} style={{ minHeight: 38, fontSize: 13 }}>
          <Play size={15} />
          {t("用此榜单排序", "Sort with this")}
        </button>
        <button className="button secondary" onClick={compareWithMe} style={{ minHeight: 38, fontSize: 13 }}>
          {t("与我比较", "Compare with me")}
        </button>
      </div>

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
    </>
  );
}
