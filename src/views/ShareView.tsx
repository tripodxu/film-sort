import { ArrowLeft, Play, Share2 } from "lucide-react";
import { RankingDetail } from "../components/RankingDetail";
import { ExpandableNote } from "../components/ExpandableNote";
import { heading } from "./helpers";
import type { ShareViewProps } from "./types";

export function ShareView({ peer, t, label, navigateTo, openCollection, profile, notes, peerNotes, openArtworkDetail, openNoteView }: ShareViewProps) {
  // 对方分享的批注：优先 peerNotes（由 /share/:code 拉取写入），兼容旧的 notes 传参
  const viewNotes = peerNotes && Object.keys(peerNotes).length > 0 ? peerNotes : (notes ?? {});
  const multiRanking = peer.rankings.length > 1;
  return (
    <>
      {heading(
        t("分享榜单", "SHARED RANKING"),
        peer.profileName,
        `${peer.rankings.length} ${t("个领域", "media")} / ${peer.rankings.reduce((c, e) => c + e.items.length, 0)} ${t("件作品", "works")}`,
      )}

      {peer.rankings.map((entry, idx) => (
        <section key={`${entry.kind}-${idx}`} className="share-section" style={{ marginBottom: 40 }}>
          <div className="profile-layout">
            <div>
              <RankingDetail
                kind={entry.kind}
                collectionTitle={entry.collectionTitle}
                items={entry.items}
                notes={viewNotes}
                kindLabel={label}
                onNoteView={openNoteView}
                onArtworkClick={openArtworkDetail}
                headerExtra={
                  multiRanking && (
                    <button
                      className="text-button"
                      onClick={() => openCollection({
                        id: `peer-${entry.profileId}-${entry.kind}-${idx}`,
                        kind: entry.kind,
                        source: "custom",
                        title: entry.collectionTitle,
                        description: "",
                        topN: entry.items.length,
                        works: entry.items,
                      })}
                      style={{ fontSize: 12, color: "var(--accent)", flexShrink: 0 }}
                    >
                      <Play size={12} />{t("用此榜单排序", "Sort with this")}
                    </button>
                  )
                }
              />
            </div>
          </div>
        </section>
      ))}

      {/* Profile-level notes */}
      {viewNotes[`profile:${peer.profileId}`] && (
        <div style={{ margin: "16px 0", padding: "12px 16px", borderRadius: 8, background: "rgba(121,217,174,.06)", border: "1px solid var(--line)" }}>
          <ExpandableNote text={viewNotes[`profile:${peer.profileId}`]} maxLength={30} onView={openNoteView ? (text) => openNoteView(peer.profileName, text) : undefined} style={{ margin: 0 }} />
        </div>
      )}

      {/* Action buttons */}
      <div style={{ display: "flex", gap: 12, flexWrap: "wrap", margin: "24px 0" }}>
        {!multiRanking && (
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
        )}
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
        <button
          className="button secondary"
          onClick={async () => {
            try { await navigator.clipboard.writeText(location.href); } catch { /* selection fallback below */ }
          }}
          title={t("复制当前分享链接，方便转发给其他人", "Copy this share link to forward it")}
        >
          <Share2 size={15} />
          {t("复制分享链接", "Copy share link")}
        </button>
      </div>

      {/* How to create your own share link */}
      {!profile && (
        <div style={{ margin: "24px 0", padding: "20px 24px", borderRadius: 14, border: "1px solid var(--line)", background: "rgba(20,27,25,.4)" }}>
          <h3 style={{ fontSize: 14, fontWeight: 600, color: "#eef4ed", marginBottom: 8, display: "flex", alignItems: "center", gap: 8 }}><Share2 size={15} />{t("如何创建自己的分享链接？", "How to create your own share link?")}</h3>
          <ol style={{ fontSize: 13, color: "var(--muted)", lineHeight: 2, paddingLeft: 20, margin: 0 }}>
            <li>{t("选择一个媒介维度，完成排序", "Choose a medium and complete a ranking")}</li>
            <li>{t("在「我的文化索引」页面，点击「分享此榜单」或「复制比较链接」", "In 'My Culture Index', click 'Share this list' or 'Copy compare link'")}</li>
            <li>{t("将链接发给朋友，对方打开即可查看你的榜单", "Send the link to a friend — they can view your ranking when they open it")}</li>
          </ol>
          <button className="button primary" onClick={() => navigateTo("home")} style={{ marginTop: 14, minHeight: 38 }}>
            <Play size={15} />
            {t("开始创建我的榜单", "Start creating my ranking")}
          </button>
        </div>
      )}

      {/* Back button */}
      <div style={{ marginTop: 16 }}>
        <button className="button secondary" onClick={() => navigateTo("home")} style={{ minHeight: 34 }}>
          <ArrowLeft size={15} />
          {t("返回首页", "Back home")}
        </button>
      </div>
    </>
  );
}
