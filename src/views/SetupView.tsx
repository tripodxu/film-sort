import { Play, Save } from "lucide-react";
import { Poster } from "../components/Poster";
import { heading } from "./helpers";
import type { SetupViewProps } from "./types";

const RANK_MODES: Array<{
  value: "quick" | "classic" | "precise";
  zh: string;
  en: string;
  hint: [string, string];
}> = [
  {
    value: "quick",
    zh: "简易",
    en: "Quick",
    hint: [
      "每件作品约 1 次取舍，快速挖出 Top N（适合大清单）",
      "~1 choice per work; fastest way to surface a Top N",
    ],
  },
  {
    value: "classic",
    zh: "经典",
    en: "Classic",
    hint: [
      "二分定位 + 回环检测 + 复测校准（推荐）",
      "Binary insertion with loop detection and verification (recommended)",
    ],
  },
  {
    value: "precise",
    zh: "精确",
    en: "Precise",
    hint: [
      "更多复测与主动校准，给出校准一致率",
      "Extra verification rounds; reports a calibration accuracy",
    ],
  },
];

export function SetupView({
  collection,
  kind,
  t,
  label,
  selected,
  setSelected,
  topN,
  setTopN,
  seed,
  setSeed,
  setCollection,
  startRanking,
  saveWithoutSorting,
}: SetupViewProps) {
  const rankMode =
    (typeof window !== "undefined" && window.localStorage.getItem("art-rank:rank-mode")) ||
    "classic";
  const setRankMode = (mode: string) => {
    try {
      window.localStorage.setItem("art-rank:rank-mode", mode);
    } catch {
      /* 隐私模式 */
    }
  };
  const active = RANK_MODES.find((m) => m.value === rankMode) ?? RANK_MODES[1];
  const activeHint = t(active.hint[0], active.hint[1]);
  return (
    <>
      {heading(
        `${label(collection.kind)} / ${t("准备", "PREPARE")}`,
        collection.title,
        t(
          "选择参与比较的作品，设定你想留下的 Top N。",
          "Choose the works and set the Top N you want to keep.",
        ),
      )}
      <div className="setup-layout">
        <section className="settings">
          <label htmlFor="rank-mode">{t("排序模式", "Ranking mode")}</label>
          <div
            className="segmented"
            id="rank-mode"
            role="group"
            aria-label={t("排序模式", "Ranking mode")}
          >
            {RANK_MODES.map((m) => (
              <button
                key={m.value}
                className={rankMode === m.value ? "active" : ""}
                onClick={() => setRankMode(m.value)}
              >
                {t(m.zh, m.en)}
              </button>
            ))}
          </div>
          <p style={{ fontSize: 11, color: "var(--muted)", margin: "4px 0 12px", lineHeight: 1.5 }}>
            {activeHint}
          </p>
          <label htmlFor="top-n">
            Top N <strong>{topN}</strong>
          </label>
          <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
            <input
              id="top-n"
              type="range"
              min={1}
              max={Math.max(1, selected.length)}
              value={Math.min(topN, selected.length) || 1}
              onChange={(event) => setTopN(Number(event.target.value))}
              style={{ flex: 1 }}
            />
            <input
              type="number"
              min={1}
              max={selected.length || 1}
              value={topN}
              onChange={(event) => {
                const v = Number(event.target.value);
                if (v >= 1) setTopN(v);
              }}
              style={{ width: 64, minHeight: 36, textAlign: "center", padding: "4px 6px" }}
            />
          </div>
          <label htmlFor="seed">{t("顺序口令（可选）", "Order seed (optional)")}</label>
          <input
            id="seed"
            maxLength={80}
            value={seed}
            onChange={(event) => setSeed(event.target.value)}
          />
          <label htmlFor="collection-name">{t("榜单名称", "Collection name")}</label>
          <input
            id="collection-name"
            maxLength={160}
            value={collection.title}
            onChange={(event) => setCollection({ ...collection, title: event.target.value })}
          />
          <button
            className="button primary"
            disabled={selected.length < 2 || !collection.title.trim()}
            onClick={startRanking}
          >
            <Play size={16} />
            {t("开始相遇", "Start encounter")}
          </button>
          <button
            className="button secondary"
            disabled={selected.length < 1 || !collection.title.trim()}
            onClick={saveWithoutSorting}
          >
            <Save size={16} />
            {t("仅保存不排序", "Save without sorting")}
          </button>
        </section>
        <section className="candidate-list">
          <div className="section-heading">
            <h2>{t("已看 / 已读 / 已听", "Experienced works")}</h2>
            <label className="check-all">
              <input
                type="checkbox"
                checked={selected.length === collection.works.length}
                onChange={(event) =>
                  setSelected(event.target.checked ? collection.works.map((work) => work.id) : [])
                }
              />
              {selected.length} / {collection.works.length}
            </label>
          </div>
          <div className="candidate-scroll">
            {collection.works.map((work) => (
              <label className="candidate-row" key={work.id}>
                <input
                  type="checkbox"
                  checked={selected.includes(work.id)}
                  onChange={(event) =>
                    setSelected(
                      event.target.checked
                        ? [...selected, work.id]
                        : selected.filter((id) => id !== work.id),
                    )
                  }
                />
                <Poster work={work} kind={kind} />
                <div>
                  <strong>{work.title}</strong>
                  <small>
                    {work.creator} {work.year}
                  </small>
                </div>
              </label>
            ))}
          </div>
        </section>
      </div>
    </>
  );
}
