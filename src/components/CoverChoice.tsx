import { useEffect, useRef, useState } from "react";
import { AlertCircle, Check } from "lucide-react";
import {
  cacheReport,
  isWikiImageUrl,
  readCachedReport,
  reportCacheKey,
  shouldOfferChoice,
  type ChoiceBand,
} from "../lib/coverChoice";

/**
 * 「让用户选」消歧出口（PLAN-CHOICE-UI）。
 *
 * 只在诊断端点说「我没把握」时才出现：band 为 shaky/weak、候选池 >=2、且至少一条能出图。
 * exact/strong 的条目**一个字都不打扰**——线上抽样 6 条 exact 全部判对。
 *
 * 候选缩略图不在诊断响应里（那个端点有 300s 边缘缓存，塞 8 张图会被缓存放大），
 * 而是渲染出来时按需调 /api/other/detail 取——取到即缓存，再展开零成本。
 */

interface CandidateView {
  title: string;
  year?: string;
  hasCover: boolean;
}

interface ReportView {
  candidates: CandidateView[];
  confidence: { band: ChoiceBand; poolSize: number };
}

/** 判据 + 渲染所需的最少字段；一份只有几十到几百字节，可以整份塞进 sessionStorage。 */
interface ReportMemo {
  report: ReportView;
  band: ChoiceBand;
  poolSize: number;
  coverCount: number;
}

const MAX_CANDIDATE_COVERS = 3;
/** 展示条数比取图条数多两条：多出来的那两条取不到图就显示灰底，仍能辨认出是不同作品。 */
const MAX_CANDIDATE_CHOICES = MAX_CANDIDATE_COVERS + 2;

export function CoverChoice({
  title,
  english,
  year,
  onPicked,
  t,
}: {
  title: string;
  english?: string;
  /** 与 Work 同形：年份是数字，缺失时留 undefined。 */
  year?: number;
  /**
   * 用户选定了封面。第二个参数是他确认的**维基条目标题**——
   * 它是「这个名字指的是哪部作品」这个事实的一部分，
   * 调用方用它写消歧记忆（PLAN-COVER-MEMORY），组件自己不存。
   */
  onPicked: (url: string, wikiTitle: string) => void;
  t: (zh: string, en: string) => string;
}) {
  const key = reportCacheKey(title, year);
  // 会话内已经问过就复用：判定「要展示」的直接渲染（连请求都不发），
  // 判定「不打扰」的直接闭嘴（也一个请求都不发）。
  // other 限流桶只有 20 次 / 10 分钟且与 /api/other/detail 共用——
  // 每开一次弹窗就烧一次配额的话，20 次弹窗就能让主链路自己开始 429。
  const [memo, setMemo] = useState<ReportMemo | null>(() => {
    const hit = readCachedReport(key);
    if (!hit?.offer || !hit.report) return null;
    return hit.report as ReportMemo;
  });
  const [silentlySilent, setSilentlySilent] = useState(() => {
    const hit = readCachedReport(key);
    return hit !== null && !hit.offer;
  });
  const [failed, setFailed] = useState(false);
  const [covers, setCovers] = useState<Record<string, string>>({});
  // 已发起取图的候选标题记账。此前用 covers 当「已取过」判据且把它写进依赖
  // （与当时的注释相反）：每张图到达都重跑 effect、把在途候选再发一遍，
  // 一个候选最多被请求 3 次，白烧与主链路共享的 other 限流桶。
  const requestedRef = useRef<Set<string>>(new Set());
  const [chosen, setChosen] = useState("");
  const [saving, setSaving] = useState("");
  const [saveError, setSaveError] = useState("");

  useEffect(() => {
    if (memo || silentlySilent) return;
    let active = true;
    const extra = new URLSearchParams();
    if (year) extra.set("year", String(year));
    const qs = extra.size ? `&${extra}` : "";
    // 30s 而非 20s：真回源可能很慢（迭代 3 实测维基 zh→en→百科兜底链冷缓存能超 25s）。
    void fetch(`/api/other/candidates?name=${encodeURIComponent(title)}${qs}`, {
      signal: AbortSignal.timeout(30000),
    })
      .then((response) => (response.ok ? response.json() : null))
      .then((payload: { data?: ReportView } | null) => {
        if (!active) return;
        const data = payload?.data;
        if (!data) {
          setFailed(true);
          return;
        }
        const decision = {
          band: data.confidence.band,
          poolSize: data.confidence.poolSize,
          coverCount: data.candidates.filter((candidate) => candidate.hasCover).length,
        };
        if (!shouldOfferChoice(decision)) {
          cacheReport(key, { ...decision, offer: false });
          setSilentlySilent(true);
          return;
        }
        const next: ReportMemo = {
          ...decision,
          report: { ...data, ...decision },
        };
        cacheReport(key, { ...decision, offer: true, report: next.report });
        setMemo(next);
      })
      .catch(() => {
        if (active) setFailed(true);
      });
    return () => {
      active = false;
    };
  }, [title, year, key, memo, silentlySilent]);

  // 只给前三条带图的候选取图：每条是一次维基回源，而 other 桶只有 20 次 / 10min。
  useEffect(() => {
    if (!memo) return;
    // 新一份诊断报告 = 换了候选池，记账清零（year 变化同理，按新年份重取）。
    requestedRef.current = new Set();
    const need = memo.report.candidates
      .filter((candidate) => candidate.hasCover)
      .slice(0, MAX_CANDIDATE_COVERS)
      .map((candidate) => candidate.title)
      .filter((candidateTitle) => !requestedRef.current.has(candidateTitle));
    need.forEach((candidateTitle) => requestedRef.current.add(candidateTitle));
    if (!need.length) return;
    let active = true;
    void Promise.all(
      need.map(async (candidateTitle) => {
        const extra = new URLSearchParams();
        if (year) extra.set("year", String(year));
        const qs = extra.size ? `&${extra}` : "";
        try {
          const response = await fetch(
            `/api/other/detail?name=${encodeURIComponent(candidateTitle)}${qs}`,
            { signal: AbortSignal.timeout(30000) },
          );
          const payload = (await response.json()) as {
            data?: { poster_url?: string } | null;
          };
          const url = payload.data?.poster_url;
          if (active && url && isWikiImageUrl(url)) {
            setCovers((previous) => ({ ...previous, [candidateTitle]: url }));
          }
        } catch {
          /* 单条取图失败只少一张缩略图，不影响其余候选可选 */
        }
      }),
    );
    return () => {
      active = false;
    };
  }, [memo, year]);

  if (failed || silentlySilent || !memo) return null;

  async function pick(choice: { title: string; url: string }) {
    setChosen(choice.title);
    setSaveError("");
    // 视觉生效与写端点都在下面；**记忆由调用方在 ArtworkDetail 里记**
    // （它手里有完整的 work 对象，键与服务端那一把同源）。
    onPicked(choice.url, choice.title);
    const token = (() => {
      try {
        return localStorage.getItem("art-rank:account-token") ?? "";
      } catch {
        return "";
      }
    })();
    if (!token) {
      setSaveError(
        t("已在本页生效；登录后可以保存你的选择。", "Applied on this page — sign in to keep it."),
      );
      return;
    }
    setSaving(choice.title);
    try {
      const response = await fetch("/api/other/cover-choice", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${token}`,
        },
        body: JSON.stringify({
          title,
          // 键的 english 段与 Poster.tsx 的 batchKey 同口径：没有 subtitle 就用标题本身。
          english: english ?? title,
          year,
          wikiTitle: choice.title,
          url: choice.url,
        }),
      });
      setSaveError(
        response.ok
          ? t(
              `已保存，这一页里所有《${title}》都用这一张。`,
              `Saved — every "${title}" on this page now uses this cover.`,
            )
          : t("没能保存到云端，本页仍然生效。", "Couldn't save to cloud; still applied here."),
      );
    } catch {
      setSaveError(t("网络错误，本页仍然生效。", "Network error; still applied on this page."));
    } finally {
      setSaving("");
    }
  }

  return (
    <div className="cover-choice" aria-label={t("换一个封面", "Change cover")}>
      <p className="cover-choice-hint">
        <AlertCircle size={13} aria-hidden />
        {t(
          "这个名字可能指好几部作品，我们拿不准。换一张你认得的？",
          "This title may refer to several works — pick the right one.",
        )}
      </p>
      <div className="cover-choice-row" role="group">
        {memo.report.candidates
          .filter((candidate) => candidate.hasCover)
          .slice(0, MAX_CANDIDATE_CHOICES)
          .map((candidate) => {
            const url = covers[candidate.title];
            const active = chosen === candidate.title;
            return (
              <button
                key={candidate.title}
                type="button"
                className={`cover-choice-item${active ? " is-active" : ""}`}
                aria-pressed={active}
                disabled={!url || saving === candidate.title}
                onClick={() => void pick({ title: candidate.title, url })}
              >
                <span className="cover-choice-thumb" aria-hidden>
                  {url ? (
                    <img src={url} alt="" loading="lazy" referrerPolicy="no-referrer" />
                  ) : (
                    <span className="cover-choice-thumb-blank" />
                  )}
                  {active && (
                    <span className="cover-choice-check" aria-hidden>
                      <Check size={10} />
                    </span>
                  )}
                </span>
                <span className="cover-choice-name">{candidate.title}</span>
                {candidate.year && <span className="cover-choice-year">{candidate.year}</span>}
              </button>
            );
          })}
      </div>
      {saveError && <small className="cover-choice-msg">{saveError}</small>}
    </div>
  );
}
