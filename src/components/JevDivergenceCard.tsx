// 相遇页「预测分歧」洞察卡（优化冲刺 Phase 6）。
// 用「我的」品味档案让 Jev 预测对方榜单的排名（复用 /api/ai/jev-rank：
// profileContext=我的榜单概要，works=对方合并榜单），与对方真实排名求偏差 Top3。
// 交互对齐 AiInsightCard 先例：点击才发请求（不预取）、自持 busy/失败态、
// 数据签名变化即视为过期（切维度/换画像后显示引导文案而非旧结果）。
import { useMemo, useState } from "react";
import { Settings2, Sparkles, TrendingDown, TrendingUp } from "lucide-react";
import { Poster } from "./Poster";
import {
  jevFailureText,
  readTypesafeConfig,
  requestJevRanking,
  type JevRankResult,
} from "../lib/typesafe";
import { topDivergences, type DivergenceEntry } from "../lib/jevDivergence";
import type { RankedArtwork } from "../lib/profile";
import type { MediaKind } from "../data/media";
import { track } from "../lib/utils";

export function JevDivergenceCard({
  kind,
  collectionTitle,
  works,
  profileContext,
  openArtworkDetail,
  openAiConfig,
  locale,
  t,
}: {
  kind: MediaKind;
  /** 对方合并榜单标题（发送给 Jev 的 collectionTitle 语境）。 */
  collectionTitle: string;
  /** 对方合并榜单作品（已按名次排序；actualRank = 数组位次 + 1）。 */
  works: readonly RankedArtwork[];
  /** 我的品味档案概要（buildTasteContext 产物）。 */
  profileContext: string;
  openArtworkDetail: (work: RankedArtwork, kind: MediaKind) => void;
  openAiConfig: () => void;
  locale: "zh" | "en";
  t: (zh: string, en: string) => string;
}) {
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<JevRankResult | null>(null);
  // 结果绑定数据签名：维度/画像/对方榜单任一变化 → 旧结果不再展示（防止张冠李戴）。
  const dataKey = useMemo(
    () => `${kind}|${collectionTitle}|${profileContext.length}|${works.map((w) => w.id).join(",")}`,
    [kind, collectionTitle, profileContext, works],
  );
  const [shownKey, setShownKey] = useState<string | null>(null);
  const stale = shownKey !== null && shownKey !== dataKey;
  const entries: Array<DivergenceEntry<RankedArtwork>> | null =
    result?.ok && !stale && shownKey === dataKey ? topDivergences(works, result.order, 3) : null;
  const hasConfig = !!readTypesafeConfig();
  const tooFew = works.length < 4; // 榜单太短时偏差没有信息量

  async function predict() {
    if (busy || tooFew) return;
    setBusy(true);
    const outcome = await requestJevRanking(
      {
        kind,
        collectionTitle,
        works: works.map((w) => ({
          id: w.id,
          title: w.title,
          ...(w.creator ? { creator: w.creator } : {}),
          ...(w.year ? { year: w.year } : {}),
        })),
        profileContext,
        locale,
      },
      readTypesafeConfig() ?? { apiKey: "" },
    );
    setResult(outcome);
    setShownKey(dataKey);
    setBusy(false);
    if (outcome.ok) {
      track("jev_predict_divergence", {
        kind,
        works: works.length,
        input_tokens: outcome.inputTokens,
      });
    }
  }

  return (
    <div className="comparison-ai" aria-live="polite">
      <div style={{ minWidth: 0, flex: 1 }}>
        <span className="eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Sparkles size={13} /> {t("预测分歧 · JEV", "PREDICTED DIVERGENCE · JEV")}
        </span>
        {busy ? (
          <p>
            {t(
              "Jev 正在按你的品味预测对方的排名…",
              "Jev is predicting their ranking from your taste…",
            )}
          </p>
        ) : entries && entries.length > 0 ? (
          <div style={{ marginTop: 8, display: "grid", gap: 6 }}>
            {entries.map((entry) => (
              <button
                key={entry.item.id}
                className="comparison-row"
                onClick={() => openArtworkDetail(entry.item, kind)}
              >
                <span className="comparison-poster">
                  <Poster work={entry.item} kind={kind} />
                </span>
                <strong>{entry.item.title}</strong>
                <span style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
                  {t("对方", "Them")} #{entry.actualRank}
                </span>
                <span style={{ whiteSpace: "nowrap", flexShrink: 0 }}>
                  {t("预测", "Predicted")} #{entry.predictedRank}
                </span>
                <b
                  style={{
                    color: entry.shift > 0 ? "var(--accent-2)" : "var(--indigo)",
                    whiteSpace: "nowrap",
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 3,
                    flexShrink: 0,
                  }}
                  title={
                    entry.shift > 0
                      ? t(
                          "对方把它排得远比你的品味预测更高",
                          "They ranked it far above what your taste predicts",
                        )
                      : t(
                          "对方把它排得远比你的品味预测更低",
                          "They ranked it far below what your taste predicts",
                        )
                  }
                >
                  {entry.shift > 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}
                  {entry.shift > 0 ? "+" : ""}
                  {entry.shift}
                </b>
              </button>
            ))}
            <p className="mini-note" style={{ margin: 0 }}>
              {t(
                "「+」= 对方排得比按你品味的预测更高，「−」= 更低。点行看作品详情。",
                '"+" = they ranked it above your taste\'s prediction, "−" = below. Click a row for details.',
              )}
            </p>
          </div>
        ) : (
          <>
            <p>
              {result && !result.ok ? (
                <>
                  {jevFailureText(result, t)}
                  {!hasConfig && " "}
                  <button className="text-button" style={{ fontSize: 12 }} onClick={openAiConfig}>
                    {t("去配置", "Configure")}
                  </button>
                </>
              ) : entries && entries.length === 0 ? (
                t(
                  "Jev 的预测与对方的真实排名完全一致——没有出乎意料的作品。",
                  "Jev's prediction matches their actual ranking — no surprises.",
                )
              ) : stale ? (
                t("比较对象或榜单已变化，请重新预测。", "The comparison changed — predict again.")
              ) : tooFew ? (
                t(
                  "对方这份榜单太短（少于 4 件），偏差没有参考价值。",
                  "This list is too short (fewer than 4 works) to measure divergence.",
                )
              ) : (
                t(
                  "用你的品味档案预测对方的排名，找出「对方最出乎你意料的作品」偏差 Top 3。",
                  "Predict their ranking from your taste profile and surface the top 3 surprises.",
                )
              )}
            </p>
            {!busy && !tooFew && (
              <p className="mini-note" style={{ margin: "4px 0 0" }}>
                {t(
                  "将把对方榜单标题与你的榜单概要发送至 Jev（TypeSafe）服务。",
                  "Their list titles and your taste summary are sent to the Jev (TypeSafe) service.",
                )}
              </p>
            )}
          </>
        )}
      </div>
      <div
        style={{
          display: "flex",
          gap: 8,
          alignItems: "center",
          flexWrap: "wrap",
          alignSelf: "flex-start",
        }}
      >
        {result && !result.ok && !hasConfig && (
          <button
            className="icon-button"
            title={t("AI 设置", "AI settings")}
            onClick={openAiConfig}
          >
            <Settings2 size={16} />
          </button>
        )}
        <button
          className="button secondary"
          disabled={busy || tooFew}
          onClick={() => void predict()}
        >
          <Sparkles size={14} />
          {busy
            ? t("预测中…", "Predicting…")
            : entries && !stale
              ? t("重新预测", "Re-predict")
              : t("预测分歧", "Predict divergence")}
        </button>
      </div>
    </div>
  );
}
