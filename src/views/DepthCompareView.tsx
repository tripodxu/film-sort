import { useMemo, useState } from "react";
import { ConfidenceBadge } from "../components/ConfidenceBadge";
import { MetricExplainer } from "../components/MetricExplainer";
import { mediaLabels, type MediaKind } from "../data/media";
import { computeCompareMetrics, type CompareMetrics } from "../lib/compareMetrics";
import { compareProfiles, type DimensionComparison } from "../lib/profile";
import type { DepthCompareViewProps } from "./types";

type T = (zh: string, en: string) => string;

interface KindRow {
  kind: MediaKind;
  result: DimensionComparison;
  metrics: CompareMetrics;
}

/**
 * 置信度口径（本页自有，compareMetrics 不接收这个参数，也不因此改动 S1 模块）：
 * - 有 bootstrap 区间时按区间宽度反推：宽度 10 分 → 85、20 分 → 70、40 分 → 40；
 * - 没有区间（有效序对不足 4 对，bootstrapTau 返回 null）时退化为样本量口径：
 *   每个非并列序对 8 分、上限 40，也就是最多只敢标「低置信」。
 */
function confidenceLevel(metrics: CompareMetrics): number {
  const interval = metrics.tauCI;
  if (interval) {
    return Math.min(100, Math.max(0, Math.round(100 - (interval.high - interval.low) * 1.5)));
  }
  return Math.min(40, metrics.nonTiedPairs * 8);
}

function confidenceLabel(level: number, t: T): string {
  if (level >= 80) return t("高置信", "high");
  if (level >= 50) return t("中等", "medium");
  return t("低置信", "low");
}

function confidenceHint(metrics: CompareMetrics, t: T): string {
  const rule = t(
    "区间越窄分越高；没有区间时按样本量算，上限 40。",
    "A narrower interval scores higher; without one the sample-size rule caps at 40.",
  );
  const sample =
    t("有效序对", "non-tied pairs") +
    " " +
    metrics.nonTiedPairs +
    " · " +
    t("剔除并列", "tied dropped") +
    " " +
    metrics.tiedPairs;
  return rule + " " + sample;
}

const formatScore = (value: number | null | undefined): string =>
  value === null || value === undefined ? "--" : String(value);

const formatPct = (value: number | null | undefined): string =>
  value === null || value === undefined ? "--" : value + "%";

const formatInterval = (metrics: CompareMetrics, t: T): string => {
  const interval = metrics.tauCI;
  if (!interval) return t("样本不足", "n/a");
  return interval.low + "–" + interval.high;
};

/**
 * 深度比较页（S3 新增，走 /depth）：只读的「第二种读法」。
 * 旧相遇页 src/views/CompareView.tsx（/encounter）不引用本文件，两页并存；
 * 新指标只在本页展示，避免同一页出现两套互相矛盾的数字。
 */
export function DepthCompareView({ profile, peer, t, navigateTo }: DepthCompareViewProps) {
  const [activeKind, setActiveKind] = useState<MediaKind | null>(null);
  const comparison = useMemo(
    () => (profile && peer ? compareProfiles(profile, peer) : null),
    [profile, peer],
  );
  const rows = useMemo<KindRow[]>(() => {
    if (!comparison) return [];
    return comparison.comparisons.map((entry) => ({
      kind: entry.kind,
      result: entry.result,
      metrics: computeCompareMetrics(entry.result.shared, {
        rawConsensus: entry.result.consensusScore,
      }),
    }));
  }, [comparison]);

  const head = (
    <header className="depth-head">
      <p className="eyebrow">{t("深度比较", "DEPTH COMPARE")}</p>
      <h1>{t("同一份比较，第二种读法", "The same comparison, read twice")}</h1>
      <p className="depth-lede">
        {t(
          "本页只读：不改名次、不写数据。数字与相遇页同源，新指标都带样本量置信度。",
          "Read-only: no ranks change and nothing is written. Numbers come from the same merge as the encounter page, and every new metric carries a sample-size confidence.",
        )}
      </p>
    </header>
  );

  if (!profile || !peer || !comparison) {
    return (
      <section className="view depth-view">
        {head}
        <div className="empty-state">
          <h2>{t("还没有可比较的两份榜单", "Nothing to compare yet")}</h2>
          <p>
            {t(
              "先完成一次排序、或导入一份对照档案，再回来。",
              "Finish a ranking or import a peer profile first.",
            )}
          </p>
          <div className="action-row">
            <button className="button primary" onClick={() => navigateTo("compare")}>
              {t("去相遇页", "Go to encounter")}
            </button>
            <button className="button secondary" onClick={() => navigateTo("home")}>
              {t("回首页", "Back home")}
            </button>
          </div>
        </div>
      </section>
    );
  }

  if (rows.length === 0) {
    return (
      <section className="view depth-view">
        {head}
        <div className="empty-state">
          <h2>{t("两份榜单没有共同媒介", "No shared medium")}</h2>
          <p>
            {t(
              "深度比较按媒介逐项对照，至少需要同一类（电影/书籍/音乐）各有一份榜单。",
              "Depth compare works medium by medium: you need at least one shared medium.",
            )}
          </p>
          <div className="action-row">
            <button className="button secondary" onClick={() => navigateTo("compare")}>
              {t("去相遇页", "Go to encounter")}
            </button>
          </div>
        </div>
      </section>
    );
  }

  const active = rows.find((row) => row.kind === activeKind) ?? rows[0];
  const { result, metrics } = active;
  const level = confidenceLevel(metrics);
  const maxRank = Math.max(
    1,
    ...result.shared.map((item) => Math.max(item.ownRank, item.peerRank)),
  );
  const rankPercent = (rank: number) =>
    ((Math.min(rank, maxRank) - 1) / Math.max(1, maxRank - 1)) * 100;

  const legacy: Array<{ label: string; value: string }> = [
    {
      label: t("一致率（旧）", "order agreement (legacy)"),
      value: formatPct(result.orderAgreement),
    },
    { label: t("Kendall τ-b", "Kendall τ-b"), value: formatScore(result.kendallTau) },
    { label: t("Spearman 近似", "Spearman-like"), value: formatPct(result.spearmanLikeAgreement) },
    { label: t("名次距离", "rank distance"), value: formatScore(result.rankDistance) },
    {
      label: t("加权头部一致", "weighted top agreement"),
      value: formatPct(result.weightedTopAgreement),
    },
    {
      label: t("前三重合（件）", "top-3 overlap (works)"),
      value: formatScore(result.top3Agreement),
    },
    { label: t("前五重合（件）", "top-5 overlap (works)"), value: formatScore(result.top5Overlap) },
    { label: t("Top-5 Jaccard", "top-5 Jaccard"), value: formatPct(result.topJaccard) },
    {
      label: t("冠军一致", "champion match"),
      value:
        result.championAgreement === null
          ? "--"
          : result.championAgreement
            ? t("一致", "yes")
            : t("不同", "no"),
    },
    { label: t("时代亲和", "era affinity"), value: formatPct(result.eraAffinity) },
    { label: t("覆盖率", "coverage"), value: formatPct(result.coverage) },
    { label: t("重合度", "overlap"), value: formatPct(result.overlap) },
    { label: t("共识分（旧）", "consensus (legacy)"), value: formatScore(result.consensusScore) },
  ];

  return (
    <section className="view depth-view">
      {head}

      {rows.length > 1 && (
        <div className="segmented depth-kinds" role="group" aria-label={t("媒介", "Medium")}>
          {rows.map((row) => (
            <button
              key={row.kind}
              type="button"
              className={row.kind === active.kind ? "active" : ""}
              aria-pressed={row.kind === active.kind}
              onClick={() => setActiveKind(row.kind)}
            >
              {mediaLabels[row.kind].label}
            </button>
          ))}
        </div>
      )}

      <section className="depth-hero" aria-label={t("收缩共识分", "Shrunk consensus")}>
        <div className="depth-score">
          <span className="depth-score-value">{formatScore(metrics.consensusShrunk)}</span>
          <span className="depth-score-label">{t("收缩共识分", "shrunk consensus")}</span>
          <ConfidenceBadge
            level={level}
            label={confidenceLabel(level, t)}
            hint={confidenceHint(metrics, t)}
          />
        </div>
        <div className="depth-hero-copy">
          <p>
            {t("相遇页的原始共识分", "Raw consensus on the encounter page")}{" "}
            <strong>{result.consensusScore}</strong>
            {" · "}
            {t("共同作品", "shared works")} <strong>{metrics.sharedCount}</strong>
            {" → "}
            {t("收缩后", "shrunk")} <strong>{formatScore(metrics.consensusShrunk)}</strong>
          </p>
          <p className="depth-note">
            {t(
              "样本越少越向 50 分回归，避免三五件共同作品就报出 95 分。旧指标一个没删，仍可在相遇页核对。",
              "Smaller samples regress toward 50 so three shared works cannot claim 95. No legacy metric was removed; you can still check them on the encounter page.",
            )}
          </p>
        </div>
      </section>

      <section className="depth-section">
        <h2>{t("新指标（头部加权）", "New metrics (head-weighted)")}</h2>
        <div className="depth-metrics">
          <article className="depth-metric">
            <span className="depth-metric-label">{t("头部加权 τ", "head-weighted τ")}</span>
            <strong className="depth-metric-value">{formatScore(metrics.weightedTau)}</strong>
            <span className="depth-metric-note">
              {t("第 i 位权重 1/i：越靠前越算数", "Rank i weighs 1/i: the head decides more")}
            </span>
          </article>
          <article className="depth-metric">
            <span className="depth-metric-label">
              {t("位置折扣一致", "position-discounted agreement")}
            </span>
            <strong className="depth-metric-value">{formatScore(metrics.decayedAgreement)}</strong>
            <span className="depth-metric-note">
              {t("每往后一位乘 0.85，尾部不主导结论", "Each step down multiplies by 0.85")}
            </span>
          </article>
          <article className="depth-metric">
            <span className="depth-metric-label">{t("τ 置信区间", "τ confidence interval")}</span>
            <strong className="depth-metric-value">{formatInterval(metrics, t)}</strong>
            <span className="depth-metric-note">
              {metrics.tauCI
                ? t(
                    "bootstrap " +
                      metrics.tauCI.rounds +
                      " 轮 · " +
                      Math.round(metrics.tauCI.level * 100) +
                      "% 水平",
                    "bootstrap " +
                      metrics.tauCI.rounds +
                      " rounds · " +
                      Math.round(metrics.tauCI.level * 100) +
                      "% level",
                  )
                : t("有效序对不足，无法估区间", "too few non-tied pairs")}
            </span>
          </article>
          <article className="depth-metric">
            <span className="depth-metric-label">{t("序对账本", "pair ledger")}</span>
            <strong className="depth-metric-value">
              {metrics.nonTiedPairs} / {metrics.totalPairs}
            </strong>
            <span className="depth-metric-note">
              {t(
                "可用 / 全部序对，剔除并列 " + metrics.tiedPairs + " 对",
                "usable / all pairs, " + metrics.tiedPairs + " tied dropped",
              )}
            </span>
          </article>
        </div>

        <div className="depth-explainers">
          <MetricExplainer title={t("头部加权 τ 怎么读", "How to read head-weighted τ")}>
            <p>
              {t(
                "把共同作品两两配对：顺序一致记 +1、相反记 −1、并列的整对剔除，最后映射到 0–100（50 = 无关）。头部加权只是让靠前的配对说话更响——先看前几名吵不吵架。",
                "Pair up every shared work: concordant counts +1, discordant −1, tied pairs are dropped, and the result maps to 0–100 (50 = unrelated). Head weighting simply lets the top of the chart speak louder.",
              )}
            </p>
          </MetricExplainer>
          <MetricExplainer title={t("为什么要收缩共识分", "Why shrink the consensus")}>
            <p>
              {t(
                "共同作品只有 3 件时，两个人都排成一样的概率并不低，原始分会虚高。收缩按 (n·原始 + 6·50) / (n + 6) 计算：n 越小越靠近 50，n 足够大才敢报高分。",
                "With only three shared works, agreeing by accident is easy and the raw score inflates. Shrinking computes (n·raw + 6·50) / (n + 6): a small n lands near 50, and only a solid sample can claim a high score.",
              )}
            </p>
          </MetricExplainer>
          <MetricExplainer title={t("为什么要剔除并列序对", "Why tied pairs are dropped")}>
            <p>
              {t(
                "两边把同一件作品排在同一位时，谁高谁低没有信息量，留下只会把一致率整体拉低（同一份榜单自比也到不了 100%）。本页与相遇页共用同一口径，所以两页数字可以互相核对。",
                "When both sides put a work at the same rank there is nothing to learn, and keeping it drags agreement down (a chart compared with itself would not reach 100%). Both pages share the rule, so the numbers can be cross-checked.",
              )}
            </p>
          </MetricExplainer>
        </div>
      </section>

      <section className="depth-section">
        <h2>{t("分歧最大的作品", "Biggest disagreements")}</h2>
        {result.disagreements.length === 0 ? (
          <p className="depth-note">
            {t(
              "所有共同作品名次一致，或还没有共同作品。",
              "Every shared work sits at the same rank, or there is no overlap yet.",
            )}
          </p>
        ) : (
          <ol className="depth-rows">
            {result.disagreements.map((item) => (
              <li className="depth-row" key={item.ownKey + "|" + item.peerKey}>
                <span className="depth-row-title">{item.title}</span>
                <span className="depth-row-ranks">
                  {t("我方", "you")} <strong>{item.ownRank}</strong>
                  {" · "}
                  {t("对方", "peer")} <strong>{item.peerRank}</strong>
                </span>
                <span
                  className={
                    "depth-row-delta" + (item.ownRank < item.peerRank ? " is-own" : " is-peer")
                  }
                >
                  {t("差", "Δ")} {item.difference}
                </span>
                <span className="depth-rank-bar" aria-hidden="true">
                  <span className="depth-rank-track" />
                  <span
                    className="depth-rank-own"
                    style={{ left: rankPercent(item.ownRank) + "%" }}
                  />
                  <span
                    className="depth-rank-peer"
                    style={{ left: rankPercent(item.peerRank) + "%" }}
                  />
                </span>
              </li>
            ))}
          </ol>
        )}
        <p className="depth-note">
          {t(
            "差值 = 名次距离的绝对值（0 即并列）。横轴按本媒介最差名次缩放：实心点是你，空心点是对方。",
            "The delta is the absolute rank distance (0 means tied). The bar is scaled to the worst rank in this medium: the filled dot is you, the hollow one is your peer.",
          )}
        </p>
      </section>

      <section className="depth-section">
        <h2>{t("与相遇页同源的旧指标", "Legacy metrics from the same source")}</h2>
        <dl className="depth-legacy">
          {legacy.map((row) => (
            <div className="depth-legacy-row" key={row.label}>
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <p className="depth-note">
          {t(
            "这些数字与相遇页逐字一致，用来确认两页没有各算一套。",
            "These match the encounter page number for number, so the two pages cannot drift apart.",
          )}
        </p>
      </section>

      <section className="depth-cross">
        <span>
          {t("共同作品", "shared works")} <strong>{comparison.sharedWorks}</strong>
        </span>
        <span>
          {t("媒介覆盖", "medium coverage")} <strong>{comparison.mediumCoverage}%</strong>
        </span>
        <span>
          {t("跨媒介一致", "cross-medium agreement")}{" "}
          <strong>
            {comparison.crossMediumAgreement === null
              ? "--"
              : comparison.crossMediumAgreement + "%"}
          </strong>
        </span>
        <span>
          {t("总重合度", "total overlap")} <strong>{comparison.overlap}%</strong>
        </span>
      </section>

      <p className="depth-foot">
        {t(
          "本页不写入任何数据；名次与数字的唯一真相源仍是相遇页与排行榜本身。",
          "This page writes nothing; the encounter page and the charts themselves remain the single source of truth.",
        )}
      </p>
    </section>
  );
}
