import { MessageCircle, Send } from "lucide-react";
import { parseDbTime } from "../../lib/dbTime";
import type { PlazaComment } from "../types";

export interface PlazaCommentsTreeProps {
  comments: PlazaComment[];
  accountToken: string;
  accountNickname: string;
  replyTo: number | null;
  setReplyTo: (id: number | null) => void;
  replyText: string;
  setReplyText: (text: string) => void;
  commentText: string;
  setCommentText: (text: string) => void;
  commentBusy: boolean;
  onAddComment: (parentId?: number) => Promise<void>;
  onDeleteComment: (commentId: number) => Promise<void>;
  t: (zh: string, en: string) => string;
}

export function PlazaCommentsTree({
  comments,
  accountToken,
  accountNickname,
  replyTo,
  setReplyTo,
  replyText,
  setReplyText,
  commentText,
  setCommentText,
  commentBusy,
  onAddComment,
  onDeleteComment,
  t,
}: PlazaCommentsTreeProps) {
  const roots = comments.filter((c) => !c.parent_id);
  const repliesOf = (parentId: number) => comments.filter((c) => c.parent_id === parentId);

  const renderComment = (comment: PlazaComment, depth: number) => {
    const canDelete =
      Boolean(accountToken) && (comment.is_author ?? comment.nickname === accountNickname);
    return (
      <div
        key={comment.id}
        className="comment-item"
        style={
          depth > 0
            ? {
                // 深度封顶：第 3 层起不再递进缩进（移动端深楼挤爆，ROADMAP §二 D）
                marginLeft: depth < 3 ? 24 : 0,
                borderLeft: "2px solid var(--line)",
                paddingLeft: 12,
              }
            : undefined
        }
      >
        <div className="comment-item-header">
          <span className="comment-author">{comment.nickname || t("匿名用户", "Anonymous")}</span>
          <span className="comment-time">{parseDbTime(comment.created_at).toLocaleString()}</span>
        </div>
        <p className="comment-content">{comment.content}</p>
        <div style={{ display: "flex", gap: 8, marginTop: 4 }}>
          {accountToken && (
            <button
              className="text-button"
              onClick={() => {
                setReplyTo(replyTo === comment.id ? null : comment.id);
                setReplyText("");
              }}
              style={{ fontSize: 11, color: "var(--accent)" }}
            >
              {replyTo === comment.id ? t("取消回复", "Cancel reply") : t("回复", "Reply")}
            </button>
          )}
          {canDelete && (
            <button
              className="text-button"
              onClick={() => void onDeleteComment(comment.id)}
              style={{ fontSize: 11, color: "var(--muted)" }}
            >
              {t("删除", "Delete")}
            </button>
          )}
        </div>
        {replyTo === comment.id && (
          <div style={{ marginTop: 8, display: "flex", gap: 8 }}>
            <input
              type="text"
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              placeholder={t("写下你的回复…", "Write your reply…")}
              maxLength={500}
              style={{ fontSize: 12, padding: "6px 10px", minHeight: 36, flex: 1 }}
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") void onAddComment(comment.id);
                if (e.key === "Escape") {
                  setReplyTo(null);
                  setReplyText("");
                }
              }}
            />
            <button
              className="button primary"
              disabled={commentBusy || !replyText.trim()}
              onClick={() => void onAddComment(comment.id)}
              style={{ minHeight: 36, fontSize: 12, paddingInline: 12 }}
            >
              {t("回复", "Reply")}
            </button>
          </div>
        )}
        {repliesOf(comment.id).map((reply) => renderComment(reply, depth + 1))}
      </div>
    );
  };

  return (
    <section
      className="plaza-post-comments"
      style={{ marginTop: 24, paddingTop: 20, borderTop: "1px solid var(--line)" }}
    >
      <h3
        style={{
          fontSize: 14,
          fontWeight: 600,
          marginBottom: 16,
          color: "var(--muted)",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <MessageCircle size={15} />
        {t("评论", "Comments")} ({comments.length})
      </h3>

      {comments.length === 0 && (
        <p
          className="empty-state"
          style={{ fontSize: 13, color: "var(--muted)", marginBottom: 16 }}
        >
          {t("暂无评论，来说点什么吧。", "No comments yet. Be the first to share your thoughts.")}
        </p>
      )}

      {roots.map((comment) => renderComment(comment, 0))}

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
            onClick={() => void onAddComment()}
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
  );
}
