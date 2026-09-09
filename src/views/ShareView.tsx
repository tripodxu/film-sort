import { ArrowLeft, MessageCircle, ThumbsUp, Play } from "lucide-react";
import { Poster } from "../components/Poster";
import { heading } from "./helpers";
import type { ShareViewProps } from "./types";
import type { MediaKind } from "../data/media";

export function ShareView({ peer, t, label, navigateTo, openCollection, profile, notes, openArtworkDetail }: ShareViewProps) {
  return (
    <>
      {heading(
        t("分享榜单", "SHARED RANKING"),
        peer.profileName,
        `${peer.rankings.length} ${t("个领域", "media")} / ${peer.rankings.reduce((c, e) => c + e.items.length, 0)} ${t("件作品", "works")}`,
      )}

      {peer.rankings.map((entry, idx) => {
        const noteKey = `ranking:${entry.kind}:${entry.collectionTitle}`;
        const profileNoteKey = `profile:${peer.profileId}`;
        return (
          <section key={`${entry.kind}-${idx}`} className="share-section" style={{ marginBottom: 40 }}>
            {/* Poster grid for top items */}
            <div className="profile-layout">
              <div>
                <div className="section-heading">
                  <h2 style={{ display: "flex", alignItems: "center", gap: 10 }}>
                    <span style={{ color: "var(--accent)", fontSize: 12, fontWeight: 600 }}>{label(entry.kind)}</span>
                    {entry.collectionTitle}
                  </h2>
                  <span style={{ fontSize: 12, color: "var(--muted)" }}>
                    TOP {entry.items.length}
                  </span>
                </div>

                {/* Notes */}
                {notes[noteKey] && (
                  <p style={{ fontSize: 12, color: "var(--accent)", marginTop: 4, marginBottom: 8, opacity: 0.85 }}>
                    {notes[noteKey]}
                  </p>
                )}

                {/* Ranking list */}
                <ol className="ranking-list">
                  {entry.items.map((work) => {
                    const workNote = notes[`work:${entry.kind}:${work.id}`];
                    return (
                      <li key={work.id}>
                        <span className="row-number">
                          {work.rank <= 3
                            ? work.rank === 1 ? "🥇" : work.rank === 2 ? "🥈" : "🥉"
                            : String(work.rank).padStart(2, "0")}
                        </span>
                        <div
                          className="ranking-card-poster"
                          style={{ cursor: "pointer" }}
                          onClick={() => openArtworkDetail(work, entry.kind)}
                        >
                          <Poster work={work} kind={entry.kind} />
                        </div>
                        <div>
                          <strong>{work.title}</strong>
                          <small>{work.creator} {work.year}</small>
                          {workNote && (
                            <p style={{ fontSize: 12, color: "var(--accent)", marginTop: 4, lineHeight: 1.5, opacity: 0.85 }}>
                              {workNote}
                            </p>
                          )}
                        </div>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          </section>
        );
      })}

      {/* Profile-level notes */}
      {notes[`profile:${peer.profileId}`] && (
        <div style={{ margin: "16px 0", padding: "12px 16px", borderRadius: 8, background: "rgba(121,217,174,.06)", border: "1px solid var(--line)" }}>
          <p style={{ fontSize: 13, color: "var(--accent)", lineHeight: 1.6 }}>
            {notes[`profile:${peer.profileId}`]}
          </p>
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "24px 0" }}>
        <button
          className="button primary"
          onClick={() => {
            // Use this ranking to sort: pick the first ranking entry and open it as a collection
            const entry = peer.rankings[0];
            if (entry) {
              openCollection({
                id: `peer-${entry.profileId}`,
                kind: entry.kind,
                source: "custom",
                title: entry.collectionTitle,
                description: "",
                topN: entry.items.length,
                works: entry.items,
              });
            }
          }}
        >
          <Play size={15} />
          {t("用此榜单排序", "Sort with this ranking")}
        </button>
        <button
          className="button secondary"
          onClick={() => {
            // Compare with me: store peer and navigate to compare view
            try { localStorage.setItem("art-rank:peer:v2", JSON.stringify(peer)); } catch {}
            navigateTo("compare");
          }}
        >
          {t("与我比较", "Compare with me")}
        </button>
      </div>

      {/* Like / Comment counts (placeholder for plaza integration) */}
      <div style={{ display: "flex", gap: 20, alignItems: "center", margin: "16px 0", color: "var(--muted)", fontSize: 13 }}>
        <span style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
          <ThumbsUp size={14} /> {t("赞", "Like")}
        </span>
        <span style={{ display: "flex", alignItems: "center", gap: 5, cursor: "pointer" }}>
          <MessageCircle size={14} /> {t("评论", "Comment")}
        </span>
      </div>

      {/* Comment section placeholder */}
      <section style={{ marginTop: 24, padding: "20px 0", borderTop: "1px solid var(--line)" }}>
        <h3 style={{ fontSize: 14, fontWeight: 600, marginBottom: 12, color: "var(--muted)" }}>
          {t("评论", "Comments")}
        </h3>
        <p className="empty-state" style={{ fontSize: 13, color: "var(--muted)" }}>
          {t("评论功能即将上线，敬请期待。", "Comments coming soon. Stay tuned.")}
        </p>
      </section>

      {/* Back button */}
      <div style={{ marginTop: 24 }}>
        <button className="button secondary" onClick={() => navigateTo("home")}>
          <ArrowLeft size={15} />
          {t("返回首页", "Back home")}
        </button>
      </div>
    </>
  );
}
