import { useEffect, useMemo, type CSSProperties } from "react";
import { ArrowLeftRight, ArrowRight, Link, Play, Plus, Share2, X } from "lucide-react";
import { Poster } from "../components/Poster";
import { AiInsightCard } from "../components/AiInsightCard";
import { buildCompareData } from "../lib/aiInsight";
import { heading, fileInput } from "./helpers";
import type { CompareViewProps } from "./types";

export function CompareView({
  kinds,
  profile,
  peer,
  locale,
  compareActiveKind,
  setCompareActiveKind,
  compareMode,
  setCompareMode,
  manualOwnSelections,
  setManualOwnSelections,
  manualPeerSelections,
  setManualPeerSelections,
  compareRankings,
  mergeDimensionRankings,
  compareDimensions,
  compareProfiles,
  navigateTo,
  setPeer,
  openAiConfig,
  label,
  t,
  setCompareSortBy,
  compareSortBy,
  setCompareRankDetail,
  shareSingleRanking,
  exportProfile,
  setFormat,
  busy,
  namedProfile,
  setNotice,
  createFromPeer,
  setPeerRankPickOpen,
  openArtworkDetail,
  peerUrl,
  setPeerUrl,
  peerUrlBusy,
  importPeerFromUrl,
  importProfile,
  setActiveKind,
  notes,
  peerNotes,
  openShareModal,
}: CompareViewProps) {
  const sharedKinds = kinds.filter(
    (item) =>
      profile?.rankings.some((entry) => entry.kind === item) &&
      peer?.rankings.some((entry) => entry.kind === item),
  );
  const compareKind = sharedKinds.includes(compareActiveKind) ? compareActiveKind : sharedKinds[0];
  const ownRankings = profile?.rankings.filter((entry) => entry.kind === compareKind) ?? [];
  const peerRankings = peer?.rankings.filter((entry) => entry.kind === compareKind) ?? [];
  // 手动模式下默认全选（首次进入或维度切换时）
  useEffect(() => {
    if (manualOwnSelections.size === 0 && ownRankings.length > 0) {
      setManualOwnSelections(new Set(ownRankings.map((_, i) => i)));
    }
    if (manualPeerSelections.size === 0 && peerRankings.length > 0) {
      setManualPeerSelections(new Set(peerRankings.map((_, i) => i)));
    }
  }, [compareKind, ownRankings.length, peerRankings.length]);
  const selectedOwn =
    compareMode === "manual"
      ? ownRankings.filter((_, i) => manualOwnSelections.has(i))
      : ownRankings;
  const selectedPeer =
    compareMode === "manual"
      ? peerRankings.filter((_, i) => manualPeerSelections.has(i))
      : peerRankings;
  const result = (() => {
    if (compareMode === "manual") {
      if (selectedOwn.length === 0 || selectedPeer.length === 0) return null;
      if (selectedOwn.length === 1 && selectedPeer.length === 1)
        return compareRankings(selectedOwn[0], selectedPeer[0]);
      const ownMerged = mergeDimensionRankings(selectedOwn);
      const peerMerged = mergeDimensionRankings(selectedPeer);
      return ownMerged && peerMerged ? compareDimensions(ownMerged, peerMerged) : null;
    }
    const ownMerged = mergeDimensionRankings(ownRankings);
    const peerMerged = mergeDimensionRankings(peerRankings);
    return ownMerged && peerMerged ? compareDimensions(ownMerged, peerMerged) : null;
  })();
  const crossProfile = profile && peer ? compareProfiles(profile, peer) : null;
  // AI 比较解读的数据：当前维度指标 + 跨媒介共识（§6.5 compare 规格）。
  const aiLocale = locale === "en" ? ("en" as const) : ("zh" as const);
  const aiCompareData = useMemo(
    () =>
      profile && peer && result
        ? buildCompareData({
            ownName: profile.profileName,
            peerName: peer.profileName,
            kind: compareKind,
            result,
            crossAgreement: crossProfile?.crossMediumAgreement ?? null,
          })
        : null,
    [profile, peer, result, compareKind, crossProfile],
  );
  return (
    <>
      {heading(
        t("相遇", "ENCOUNTER"),
        t("看看你们的选择在哪里重合", "See where your choices meet"),
        peer
          ? t("两份索引的交集与分歧", "Overlap and divergence of two indexes")
          : t(
              "分享你的索引，或导入对方的来比较。",
              "Share your index or import theirs to compare.",
            ),
      )}
      {peer && (
        <div style={{ display: "flex", justifyContent: "flex-end", marginBottom: 12, gap: 8 }}>
          <button
            className="text-button"
            onClick={() => {
              setPeer(null);
              navigateTo("compare");
              setCompareActiveKind("film");
              setCompareMode("auto");
              setManualOwnSelections(new Set());
              setManualPeerSelections(new Set());
            }}
            style={{ fontSize: 12, color: "var(--muted)" }}
          >
            <X size={14} style={{ verticalAlign: "middle", marginRight: 4 }} />
            {t("退出比较", "Exit comparison")}
          </button>
        </div>
      )}
      {peer && profile && (
        <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontSize: 11, color: "var(--muted)" }}>{t("比较模式", "Mode")}:</span>
            <div className="segmented" style={{ marginBottom: 0 }}>
              <button
                role="tab"
                aria-selected={compareMode === "auto"}
                className={compareMode === "auto" ? "active" : ""}
                onClick={() => setCompareMode("auto")}
              >
                {t("自动合并", "Auto merge")}
              </button>
              <button
                role="tab"
                aria-selected={compareMode === "manual"}
                className={compareMode === "manual" ? "active" : ""}
                onClick={() => setCompareMode("manual")}
              >
                {t("指定榜单", "Pick lists")}
              </button>
            </div>
            {compareMode === "manual" &&
              (selectedOwn.length === 0 || selectedPeer.length === 0) && (
                <div className="empty-state" style={{ marginBottom: 12 }}>
                  <p style={{ fontSize: 12, color: "var(--muted)" }}>
                    {t("请至少各选一个榜单", "Select at least one list from each side")}
                  </p>
                </div>
              )}
          </div>
        </div>
      )}
      <div className="comparison-inputs">
        <section>
          <span className="eyebrow">01 / {t("我的索引", "MY INDEX")}</span>
          <h2>{profile?.profileName ?? t("尚未创建", "Not created")}</h2>
          {profile ? (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {profile.rankings.map((entry, idx) => {
                const kindIdx = profile.rankings
                  .filter((r) => r.kind === entry.kind)
                  .indexOf(entry);
                const showCheck = compareMode === "manual" && entry.kind === compareKind;
                return (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13,
                      opacity: showCheck && !manualOwnSelections.has(kindIdx) ? 0.4 : 1,
                    }}
                  >
                    {showCheck && (
                      <input
                        type="checkbox"
                        checked={manualOwnSelections.has(kindIdx)}
                        onChange={() => {
                          const next = new Set(manualOwnSelections);
                          next.has(kindIdx) ? next.delete(kindIdx) : next.add(kindIdx);
                          setManualOwnSelections(next);
                        }}
                        style={{ flexShrink: 0 }}
                      />
                    )}
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
                    {(profile?.rankings.includes(entry) && profile.rankings.length === 1) ||
                    (peer?.rankings.includes(entry) && peer.rankings.length === 1) ? (
                      <>
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            minWidth: 0,
                          }}
                        >
                          {entry.collectionTitle}
                        </span>
                        <div style={{ flex: 1 }} />
                        <div
                          className="ranking-card-top3"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCompareRankDetail({
                              side: profile?.rankings.includes(entry) ? "own" : "peer",
                              collectionTitle: entry.collectionTitle,
                              ranking: entry,
                            });
                          }}
                        >
                          {entry.items.slice(0, 3).map((item, i) => (
                            <div className="ranking-card-top3-item" key={item.id}>
                              <span className="ranking-card-top3-medal">
                                {i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"}
                              </span>
                              <Poster work={item} kind={entry.kind} />
                              <span className="ranking-card-top3-name">{item.title}</span>
                            </div>
                          ))}
                        </div>
                        <div style={{ flex: 1 }} />
                        <span style={{ color: "var(--muted)", fontSize: 11, flexShrink: 0 }}>
                          TOP {entry.items.length}
                        </span>
                      </>
                    ) : (
                      <>
                        <div
                          className="ranking-card-poster"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCompareRankDetail({
                              side: profile?.rankings.includes(entry) ? "own" : "peer",
                              collectionTitle: entry.collectionTitle,
                              ranking: entry,
                            });
                          }}
                        >
                          <Poster work={entry.items[0]} kind={entry.kind} />
                        </div>
                        <span
                          style={{
                            flex: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {entry.collectionTitle}
                        </span>
                        <span style={{ color: "var(--muted)", fontSize: 11, flexShrink: 0 }}>
                          TOP {entry.items.length}
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            fileInput("own", t("导入我的索引", "Import my index"), importProfile)
          )}
        </section>
        <section>
          <span className="eyebrow">02 / {t("对方索引", "THEIR INDEX")}</span>
          <h2>{peer?.profileName ?? t("等待导入", "Awaiting import")}</h2>
          {peer ? (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 4 }}>
              {peer.rankings.map((entry, idx) => {
                const kindIdx = peer.rankings.filter((r) => r.kind === entry.kind).indexOf(entry);
                const showCheck = compareMode === "manual" && entry.kind === compareKind;
                return (
                  <div
                    key={idx}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 8,
                      fontSize: 13,
                      opacity: showCheck && !manualPeerSelections.has(kindIdx) ? 0.4 : 1,
                    }}
                  >
                    {showCheck && (
                      <input
                        type="checkbox"
                        checked={manualPeerSelections.has(kindIdx)}
                        onChange={() => {
                          const next = new Set(manualPeerSelections);
                          next.has(kindIdx) ? next.delete(kindIdx) : next.add(kindIdx);
                          setManualPeerSelections(next);
                        }}
                        style={{ flexShrink: 0 }}
                      />
                    )}
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
                    {(profile?.rankings.includes(entry) && profile.rankings.length === 1) ||
                    (peer?.rankings.includes(entry) && peer.rankings.length === 1) ? (
                      <>
                        <span
                          style={{
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                            minWidth: 0,
                          }}
                        >
                          {entry.collectionTitle}
                        </span>
                        <div style={{ flex: 1 }} />
                        <div
                          className="ranking-card-top3"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCompareRankDetail({
                              side: profile?.rankings.includes(entry) ? "own" : "peer",
                              collectionTitle: entry.collectionTitle,
                              ranking: entry,
                            });
                          }}
                        >
                          {entry.items.slice(0, 3).map((item, i) => (
                            <div className="ranking-card-top3-item" key={item.id}>
                              <span className="ranking-card-top3-medal">
                                {i === 0 ? "🥇" : i === 1 ? "🥈" : "🥉"}
                              </span>
                              <Poster work={item} kind={entry.kind} />
                              <span className="ranking-card-top3-name">{item.title}</span>
                            </div>
                          ))}
                        </div>
                        <div style={{ flex: 1 }} />
                        <span style={{ color: "var(--muted)", fontSize: 11, flexShrink: 0 }}>
                          TOP {entry.items.length}
                        </span>
                      </>
                    ) : (
                      <>
                        <div
                          className="ranking-card-poster"
                          onClick={(e) => {
                            e.stopPropagation();
                            setCompareRankDetail({
                              side: profile?.rankings.includes(entry) ? "own" : "peer",
                              collectionTitle: entry.collectionTitle,
                              ranking: entry,
                            });
                          }}
                        >
                          <Poster work={entry.items[0]} kind={entry.kind} />
                        </div>
                        <span
                          style={{
                            flex: 1,
                            overflow: "hidden",
                            textOverflow: "ellipsis",
                            whiteSpace: "nowrap",
                          }}
                        >
                          {entry.collectionTitle}
                        </span>
                        <span style={{ color: "var(--muted)", fontSize: 11, flexShrink: 0 }}>
                          TOP {entry.items.length}
                        </span>
                      </>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div style={{ marginTop: 8, display: "flex", flexDirection: "column", gap: 8 }}>
              <div style={{ display: "flex", gap: 6 }}>
                <input
                  type="url"
                  placeholder={t(
                    "粘贴比较链接、分享链接或 JSON 地址…",
                    "Paste compare link, share link, or JSON URL…",
                  )}
                  value={peerUrl}
                  onChange={(e) => setPeerUrl(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void importPeerFromUrl();
                  }}
                  style={{ flex: 1, minHeight: 38, fontSize: 13 }}
                />
                <button
                  className="button secondary"
                  disabled={!peerUrl.trim() || peerUrlBusy}
                  onClick={() => void importPeerFromUrl()}
                  style={{ minHeight: 38, padding: "0 12px" }}
                >
                  {peerUrlBusy ? "…" : t("导入", "Import")}
                </button>
              </div>
              {fileInput("peer", t("或上传 JSON 文件", "or upload JSON"), importProfile)}
            </div>
          )}
        </section>
      </div>
      {!peer && profile && (
        <div className="empty-state">
          <p style={{ marginBottom: 12 }}>
            {t(
              "分享你的索引链接，或导入对方的来比较。",
              "Share your index link, or import theirs to compare.",
            )}
          </p>
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap", justifyContent: "center" }}>
            <button
              className="button secondary"
              onClick={() => {
                setFormat("json");
                void exportProfile();
              }}
            >
              {t("导出索引文件", "Export index file")}
            </button>
            <button
              className="button secondary"
              disabled={busy}
              onClick={() => {
                const next = namedProfile();
                if (!next) return;
                void fetch("/api/share", {
                  method: "POST",
                  headers: { "content-type": "application/json" },
                  body: JSON.stringify({
                    profile: next,
                    ...(notes && Object.keys(notes).length > 0 ? { notes } : {}),
                  }),
                })
                  .then(async (r) => {
                    const d = (await r.json()) as { compareUrl?: string; error?: string };
                    if (r.ok && d.compareUrl) {
                      navigator.clipboard?.writeText(d.compareUrl);
                      setNotice(
                        t(
                          "比较链接已复制，对方打开即可进入比较。",
                          "Compare link copied. The other person can compare when they open it.",
                        ),
                      );
                    } else {
                      setNotice(
                        t(
                          "生成链接失败，请导出文件。",
                          "Failed to create link. Export file instead.",
                        ),
                      );
                    }
                  })
                  .catch(() =>
                    setNotice(
                      t(
                        "生成链接失败，请导出文件。",
                        "Failed to create link. Export file instead.",
                      ),
                    ),
                  );
              }}
            >
              <Link size={14} />
              {t("比较链接", "Compare link")}
            </button>
            {openShareModal && (
              <button className="button secondary" disabled={busy} onClick={() => openShareModal()}>
                <Share2 size={14} />
                {t("分享链接", "Share link")}
              </button>
            )}
          </div>
        </div>
      )}
      {peer && !profile && (
        <div className="empty-state">
          <h2>{t("先建立你的艺术人格画像", "Create your own artistic profile")}</h2>
          <p style={{ marginBottom: 16, color: "var(--muted)", fontSize: 13 }}>
            {t(
              "选择对方的一个榜单，用其中的作品创建你自己的排序。",
              "Pick one of their rankings to create your own.",
            )}
          </p>
          <button className="button primary" onClick={() => setPeerRankPickOpen(true)}>
            <Play size={16} />
            {t("选择对方榜单", "Pick their ranking")}
          </button>
        </div>
      )}
      {peer && profile && !sharedKinds.length && (
        <div className="empty-state">
          <h2>{t("还没有共同的媒介维度", "No shared media yet")}</h2>
          <div className="action-row">
            {peer.rankings.map((entry) => (
              <button
                className="button primary"
                key={entry.kind}
                onClick={() => createFromPeer(entry.kind)}
              >
                <Plus size={16} />
                {label(entry.kind)}
              </button>
            ))}
          </div>
        </div>
      )}
      {result && (
        <>
          <div className="segmented" role="tablist" aria-label={t("比较维度", "Comparison medium")}>
            {sharedKinds.map((item) => (
              <button
                role="tab"
                aria-selected={compareKind === item}
                className={compareKind === item ? "active" : ""}
                key={item}
                onClick={() => setCompareActiveKind(item)}
              >
                {label(item)}
              </button>
            ))}
          </div>
          {crossProfile && (
            <div className="comparison-summary">
              <span>{t("跨媒介共识", "Across your profile")}</span>
              <strong>
                {crossProfile.crossMediumAgreement === null
                  ? "--"
                  : `${crossProfile.crossMediumAgreement}%`}
              </strong>
              <small>
                {t(
                  `${crossProfile.sharedKinds.length} 个共同维度 / ${crossProfile.sharedWorks} 件共同作品`,
                  `${crossProfile.sharedKinds.length} shared media / ${crossProfile.sharedWorks} shared works`,
                )}
              </small>
            </div>
          )}
          <AiInsightCard
            scene="compare"
            data={aiCompareData}
            locale={aiLocale}
            eyebrow={t("AI 观察", "AI OBSERVATION")}
            intro={t(
              "让模型基于比较指标把共同偏好与分歧整理成一段可读的文化侧写。",
              "Ask the model to turn the comparison metrics into a readable cultural note.",
            )}
            onOpenConfig={openAiConfig}
            t={t}
          />
          <div className="consensus-hero">
            <div
              className="consensus-dial"
              style={{ "--metric-pct": `${result.consensusScore}%` } as CSSProperties}
            >
              <strong>{result.consensusScore}</strong>
              <span>/100</span>
            </div>
            <div className="consensus-copy">
              <span className="eyebrow">{t("综合共识评分", "CONSENSUS SCORE")}</span>
              <h3>
                {result.consensusScore >= 85
                  ? t("高度共鸣", "Deep resonance")
                  : result.consensusScore >= 70
                    ? t("相当一致", "Strong agreement")
                    : result.consensusScore >= 50
                      ? t("同中有异", "Kindred but distinct")
                      : result.consensusScore >= 30
                        ? t("品味迥异", "Divergent tastes")
                        : t("几乎相反", "Near-opposite")}
              </h3>
              <p>
                {t(
                  "由顺序一致、重合度、加权偏好、名次距离与年代偏好加权合成。",
                  "Weighted blend of order agreement, overlap, weighted preference, rank distance and era affinity.",
                )}
              </p>
            </div>
          </div>
          <div className="metrics metrics-wide">
            <div>
              <span>
                {t("作品重合度", "Work overlap")}
                <i
                  className="metric-help"
                  tabIndex={0}
                  data-tip={t("共同作品 ÷ 双方去重总数", "Shared works ÷ union of both lists")}
                >
                  ?
                </i>
              </span>
              <strong>
                {result.overlap}
                <small>%</small>
              </strong>
            </div>
            <div>
              <span>
                {t("顺序一致率", "Order agreement")}
                <i
                  className="metric-help"
                  tabIndex={0}
                  data-tip={t(
                    "共同作品中，双方相对先后次序一致的比例（并列名次不计）",
                    "Share of comparable pairs ranked in the same order (ties excluded)",
                  )}
                >
                  ?
                </i>
              </span>
              <strong>{result.orderAgreement === null ? "--" : `${result.orderAgreement}%`}</strong>
            </div>
            <div>
              <span>
                {t("加权偏好一致", "Weighted agreement")}
                <i
                  className="metric-help"
                  tabIndex={0}
                  data-tip={t(
                    "越靠前的共同作品权重越高",
                    "Shared works weighted by rank (top ranks matter more)",
                  )}
                >
                  ?
                </i>
              </span>
              <strong>
                {result.weightedTopAgreement}
                <small>%</small>
              </strong>
            </div>
            <details className="metrics-more">
              <summary>{t("更多指标", "More metrics")}</summary>
              <div className="metrics-more-grid">
                <div>
                  <span>
                    {t("Kendall τ", "Kendall tau")}
                    <i
                      className="metric-help"
                      tabIndex={0}
                      data-tip={t(
                        "秩相关（含并列），50=无关，100=完全一致",
                        "Rank correlation with ties; 50=noise, 100=identical",
                      )}
                    >
                      ?
                    </i>
                  </span>
                  <strong>{result.kendallTau === null ? "--" : result.kendallTau}</strong>
                </div>
                <div>
                  <span>
                    {t("Spearman 一致", "Spearman")}
                    <i
                      className="metric-help"
                      tabIndex={0}
                      data-tip={t("名次差的平方和换算", "Derived from squared rank differences")}
                    >
                      ?
                    </i>
                  </span>
                  <strong>
                    {result.spearmanLikeAgreement === null ? "--" : result.spearmanLikeAgreement}
                  </strong>
                </div>
                <div>
                  <span>
                    {t("前五重合", "Top-5 overlap")}
                    <i
                      className="metric-help"
                      tabIndex={0}
                      data-tip={t(
                        "双方前五名作品的 Jaccard 相似度",
                        "Jaccard similarity of both Top-5 sets",
                      )}
                    >
                      ?
                    </i>
                  </span>
                  <strong>
                    {result.topJaccard}
                    <small>%</small>
                  </strong>
                </div>
                <div>
                  <span>
                    {t("年代偏好", "Era affinity")}
                    <i
                      className="metric-help"
                      tabIndex={0}
                      data-tip={t(
                        "双方榜单年代中位数越接近分越高",
                        "Closer median release years score higher",
                      )}
                    >
                      ?
                    </i>
                  </span>
                  <strong>{result.eraAffinity === null ? "--" : result.eraAffinity}</strong>
                </div>
                <div>
                  <span>
                    {t("名次距离", "Rank distance")}
                    <i
                      className="metric-help"
                      tabIndex={0}
                      data-tip={t(
                        "共同作品的平均名次差，越低越一致",
                        "Average rank gap of shared works; lower is closer",
                      )}
                    >
                      ?
                    </i>
                  </span>
                  <strong>
                    {result.rankDistance}
                    <small>%</small>
                  </strong>
                </div>
                <div>
                  <span>
                    {t("冠军一致", "Same champion")}
                    <i
                      className="metric-help"
                      tabIndex={0}
                      data-tip={t(
                        "双方的第 1 名是否为同一作品",
                        "Whether both #1 picks are the same work",
                      )}
                    >
                      ?
                    </i>
                  </span>
                  <strong>
                    {result.championAgreement === null
                      ? "--"
                      : result.championAgreement
                        ? "YES"
                        : "NO"}
                  </strong>
                </div>
                <div>
                  <span>
                    {t("Top 3 共识", "Top 3 consensus")}
                    <i
                      className="metric-help"
                      tabIndex={0}
                      data-tip={t("同时进入双方前三的作品数", "Works in both Top-3 lists")}
                    >
                      ?
                    </i>
                  </span>
                  <strong>{result.top3Agreement}</strong>
                </div>
              </div>
            </details>
          </div>
          <div className="comparison-signal">
            <span>{t("共同偏好", "Common ground")}</span>
            <strong>{result.commonPreference}</strong>
            <span>{t("分歧轴", "Main divergence")}</span>
            <strong>{result.divergence}</strong>
          </div>
          <div className="comparison-lists">
            <section>
              <h2>{t("共同作品", "Shared works")}</h2>
              {result.shared.length ? (
                <div className="comparison-table">
                  <div className="table-header">
                    <span>{t("作品", "Work")}</span>
                    <span className="col-me">
                      {t("我", "Me")}
                      <button
                        className="sort-swap"
                        onClick={() => setCompareSortBy(compareSortBy === "own" ? "peer" : "own")}
                        title={
                          compareSortBy === "own"
                            ? t("按对方排序", "Sort by theirs")
                            : t("按我的排序", "Sort by mine")
                        }
                      >
                        <ArrowLeftRight size={12} />
                      </button>
                    </span>
                    <span>{t("对方", "Them")}</span>
                  </div>
                  {[...result.shared]
                    .sort((a, b) =>
                      compareSortBy === "own" ? a.ownRank - b.ownRank : a.peerRank - b.peerRank,
                    )
                    .map((item) => {
                      const ownSrc = item.ownSources;
                      const peerSrc = item.peerSources;
                      const bestOwn = ownSrc.length
                        ? ownSrc.reduce((a, b) => (a.rank < b.rank ? a : b))
                        : null;
                      const bestPeer = peerSrc.length
                        ? peerSrc.reduce((a, b) => (a.rank < b.rank ? a : b))
                        : null;
                      return (
                        <button
                          className="comparison-row"
                          key={`${item.title}-${item.ownRank}`}
                          onClick={() =>
                            item.ownItem && openArtworkDetail(item.ownItem, compareKind)
                          }
                        >
                          <span className="comparison-poster">
                            <Poster
                              work={item.ownItem ?? { id: item.title, title: item.title }}
                              kind={compareKind}
                            />
                          </span>
                          <strong>{item.title}</strong>
                          <span
                            className="rank-clickable"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (bestOwn) {
                                const ranking =
                                  profile?.rankings.find(
                                    (r) => r.collectionTitle === bestOwn.collectionTitle,
                                  ) ?? null;
                                setCompareRankDetail({
                                  side: "own",
                                  collectionTitle: bestOwn.collectionTitle,
                                  ranking,
                                  highlightId: item.ownItem?.id,
                                });
                              }
                            }}
                          >
                            #{item.ownRank}
                            {bestOwn && ownSrc.length > 0 && (
                              <span
                                className="rank-source"
                                title={ownSrc
                                  .map((s) => `${s.collectionTitle} #${s.rank}`)
                                  .join(", ")}
                              >
                                {bestOwn.collectionTitle}
                                {ownSrc.length > 1 ? ` +${ownSrc.length - 1}` : ""}
                              </span>
                            )}
                          </span>
                          <span
                            className="rank-clickable"
                            onClick={(e) => {
                              e.stopPropagation();
                              if (bestPeer) {
                                const ranking =
                                  peer?.rankings.find(
                                    (r) => r.collectionTitle === bestPeer.collectionTitle,
                                  ) ?? null;
                                setCompareRankDetail({
                                  side: "peer",
                                  collectionTitle: bestPeer.collectionTitle,
                                  ranking,
                                  highlightId: item.peerItem?.id,
                                });
                              }
                            }}
                          >
                            #{item.peerRank}
                            {bestPeer && peerSrc.length > 0 && (
                              <span
                                className="rank-source"
                                title={peerSrc
                                  .map((s) => `${s.collectionTitle} #${s.rank}`)
                                  .join(", ")}
                              >
                                {bestPeer.collectionTitle}
                                {peerSrc.length > 1 ? ` +${peerSrc.length - 1}` : ""}
                              </span>
                            )}
                          </span>
                        </button>
                      );
                    })}
                </div>
              ) : (
                <p className="empty-state">
                  {t("本次榜单没有共同作品。", "These rankings have no common works.")}
                </p>
              )}
            </section>
            <section>
              <h2>{t("最大分歧", "Largest rank differences")}</h2>
              {result.disagreements.map((item) => (
                <button
                  className="difference-row"
                  key={`${item.title}-${item.ownRank}`}
                  onClick={() => item.ownItem && openArtworkDetail(item.ownItem, compareKind)}
                >
                  <strong>{item.title}</strong>
                  <span>
                    #{item.ownRank} / #{item.peerRank}
                  </span>
                  <b>{item.difference}</b>
                </button>
              ))}
              {!result.disagreements.length && (
                <p className="empty-state">
                  {t("没有可展示的名次分歧。", "No rank differences to display.")}
                </p>
              )}
            </section>
          </div>
          <div className="action-row">
            <button className="button secondary" onClick={() => setPeerRankPickOpen(true)}>
              <Play size={16} />
              {t("用对方的作品重新排序", "Rank their selection")}
            </button>
            <button className="button quiet" onClick={() => navigateTo("profile")}>
              <ArrowRight size={16} />
              {t("我的完整画像", "My complete profile")}
            </button>
          </div>
        </>
      )}
    </>
  );
}
