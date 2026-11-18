import { lazy, Suspense } from "react";
import { X } from "lucide-react";
import type { MediaCollection, MediaKind } from "../../data/mediaKinds";
import type { ArtisticProfile, RankedArtwork, RankingExport } from "../../lib/profile";
import { rankingRowKey } from "../../lib/rankingKey";
import { IconButton } from "../../views/IconButton";
import { ErrorBoundary } from "../ErrorBoundary";
import { Modal } from "../Modal";
import { Poster } from "../Poster";

const RankingDetail = lazy(() =>
  import("../RankingDetail").then((module) => ({ default: module.RankingDetail })),
);

function LazySpot() {
  return (
    <div className="u-loading-spot">
      <span className="u-spinner" aria-hidden="true" />
    </div>
  );
}

export interface PeerRankPickModalProps {
  t: (zh: string, en: string) => string;
  label: (kind: MediaKind) => string;
  peer: ArtisticProfile;
  profile: ArtisticProfile | null;
  openCollection: (collection: MediaCollection) => void;
  onClose: () => void;
}

export function PeerRankPickModal({
  t,
  label,
  peer,
  profile,
  openCollection,
  onClose,
}: PeerRankPickModalProps) {
  return (
    <Modal
      t={t}
      headingId="peer-pick-heading"
      title={t("选择对方榜单", "Pick their ranking")}
      onClose={onClose}
    >
      <p style={{ marginBottom: 16, fontSize: 13, color: "var(--muted)", lineHeight: 1.6 }}>
        {t("选择一个榜单，用其中的作品进行排序。", "Pick a ranking to sort its works.")}
      </p>
      <div className="u-col">
        {peer.rankings.map((entry, idx) => (
          <button
            key={rankingRowKey(entry, idx)}
            className="button secondary"
            style={{ justifyContent: "flex-start", gap: 12 }}
            onClick={() => {
              onClose();
              const existingTitles =
                profile?.rankings
                  .filter((r) => r.kind === entry.kind)
                  .map((r) => r.collectionTitle) ?? [];
              let title = entry.collectionTitle;
              if (existingTitles.includes(title)) {
                let n = 2;
                while (existingTitles.includes(`${title} (${n})`)) n++;
                title = `${title} (${n})`;
              }
              openCollection({
                id: `peer-${entry.profileId}-${entry.kind}-${idx}`,
                kind: entry.kind,
                source: "custom",
                title,
                description: "",
                topN: entry.items.length,
                works: entry.items,
              });
            }}
          >
            <span
              style={{
                color: "var(--accent)",
                fontSize: 11,
                fontWeight: 600,
                width: 28,
                flexShrink: 0,
              }}
            >
              {label(entry.kind)}
            </span>
            <Poster work={entry.items[0]} kind={entry.kind} />
            <span
              style={{
                flex: 1,
                textAlign: "left",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {entry.collectionTitle}
            </span>
            <small style={{ color: "var(--muted)", flexShrink: 0 }}>TOP {entry.items.length}</small>
          </button>
        ))}
      </div>
    </Modal>
  );
}

export interface CompareRankDetailModalProps {
  t: (zh: string, en: string) => string;
  label: (kind: MediaKind) => string;
  compareRankDetail: {
    side: "own" | "peer";
    collectionTitle: string;
    ranking: RankingExport | null;
    highlightId?: string;
  };
  notes: Record<string, string>;
  peerNotes: Record<string, string>;
  openNoteView: (title: string, text: string, posterUrls?: readonly string[]) => void;
  openArtworkDetail: (work: RankedArtwork, kind: MediaKind) => Promise<void>;
  onClose: () => void;
}

export function CompareRankDetailModal({
  t,
  label,
  compareRankDetail,
  notes,
  peerNotes,
  openNoteView,
  openArtworkDetail,
  onClose,
}: CompareRankDetailModalProps) {
  return (
    <Modal
      t={t}
      headingId="compare-rank-heading"
      panelClassName="rank-detail-dialog"
      onClose={onClose}
    >
      {compareRankDetail.ranking ? (
        <ErrorBoundary fallback={null}>
          <Suspense fallback={<LazySpot />}>
            <RankingDetail
              kind={compareRankDetail.ranking.kind}
              collectionTitle={compareRankDetail.collectionTitle}
              items={compareRankDetail.ranking.items}
              notes={compareRankDetail.side === "peer" ? peerNotes : notes}
              kindLabel={label}
              eyebrow={`${compareRankDetail.side === "own" ? t("我的索引", "MY INDEX") : t("对方索引", "THEIR INDEX")} / ${label(compareRankDetail.ranking.kind)}`}
              headerExtra={
                <IconButton title={t("关闭", "Close")} onClick={onClose}>
                  <X size={18} />
                </IconButton>
              }
              onNoteView={(title, text, posterUrls) => {
                openNoteView(title, text, posterUrls);
              }}
              onArtworkClick={(work, kind) => {
                void openArtworkDetail(work, kind);
              }}
              highlightId={compareRankDetail.highlightId}
            />
          </Suspense>
        </ErrorBoundary>
      ) : (
        <div className="section-heading">
          <h2 id="compare-rank-heading">{compareRankDetail.collectionTitle}</h2>
          <IconButton title={t("关闭", "Close")} onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
      )}
      {!compareRankDetail.ranking && (
        <p className="empty-state">{t("无法找到该榜单数据", "Ranking data not found")}</p>
      )}
    </Modal>
  );
}
