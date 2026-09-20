import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { RefreshCw, Settings2, Sparkles } from "lucide-react";
import {
  cacheKeyOf,
  peekInsight,
  readAiConfig,
  readAiLength,
  requestInsight,
  writeAiLength,
  type AiInsightResult,
  type AiLength,
  type AiLocale,
  type AiScene,
} from "../lib/aiInsight";

const LENGTHS: Array<{ value: AiLength; zh: string; en: string }> = [
  { value: "brief", zh: "简短", en: "Brief" },
  { value: "standard", zh: "标准", en: "Standard" },
  { value: "deep", zh: "深入", en: "Deep" },
];

/**
 * 通用 AI 点评卡：自持 busy/result 状态 + 会话内缓存。
 * 点击「生成」才发起请求（不预取）；失败按原因分类，429 显示等待时长。
 */
export function AiInsightCard({
  scene,
  data,
  locale,
  eyebrow,
  intro,
  compact = false,
  onOpenConfig,
  t,
}: {
  scene: AiScene;
  data: unknown;
  locale: AiLocale;
  eyebrow: string;
  /** 未生成时的引导文案（第二人称） */
  intro: string;
  /** 榜单行内嵌时用更小的尺寸 */
  compact?: boolean;
  onOpenConfig: () => void;
  t: (zh: string, en: string) => string;
}) {
  const [length, setLength] = useState<AiLength>(() => readAiLength());
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<AiInsightResult | null>(null);
  /** 进行中请求的控制器：取消按钮/重复生成时掐断。 */
  const abortRef = useRef<AbortController | null>(null);
  const cardRef = useRef<HTMLDivElement | null>(null);
  const [copied, setCopied] = useState(false);
  // 配置徽标：localStorage 不是响应式的，配置弹窗保存/停用后通过自定义事件通知刷新。
  const [hasCustom, setHasCustom] = useState(() => !!readAiConfig());
  useEffect(() => {
    const refresh = () => setHasCustom(!!readAiConfig());
    window.addEventListener("art-rank:ai-config-changed", refresh);
    return () => window.removeEventListener("art-rank:ai-config-changed", refresh);
  }, []);

  const generate = useCallback(
    async (force: boolean) => {
      // 连点/切换时掐断上一次未完成的请求。
      abortRef.current?.abort();
      const ac = new AbortController();
      abortRef.current = ac;
      setBusy(true);
      const outcome = await requestInsight(scene, data, {
        locale,
        length,
        config: readAiConfig(),
        force,
        signal: ac.signal,
      });
      if (ac.signal.aborted) {
        setBusy(false);
        return;
      }
      setResult(outcome);
      setBusy(false);
      // 生成完成后把结果带入视口（卡片可能在长榜单折叠区深处）。
      cardRef.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
    },
    [scene, data, locale, length],
  );

  // 缓存命中同步展示。effect 依赖用 data 的**内容签名**（cacheFullKey）而不是引用：
  // CompareView 每次渲染都会重建 data 对象（compareDimensions 无 memo），按引用比较
  // 会让父组件一次无关重渲染就把刚拿到的结果/失败提示清回引导文案。签名变化
  // （数据/长度/语言切换）才查缓存并替换属于旧数据的展示。
  const cacheFullKey = useMemo(
    () => cacheKeyOf(scene, data, locale, length),
    [scene, data, locale, length],
  );
  const lastKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastKey.current === cacheFullKey) return;
    lastKey.current = cacheFullKey;
    setResult(peekInsight(cacheFullKey));
  }, [cacheFullKey]);

  function errorText(): string {
    if (!result || result.ok) return "";
    if (result.error === "rate_limited") {
      const seconds = result.retryAfter && result.retryAfter > 0 ? result.retryAfter : 60;
      const wait = seconds >= 120 ? `${Math.ceil(seconds / 60)} 分钟` : `${seconds} 秒`;
      return t(`操作太频繁，请 ${wait}后再试`, `Too many requests — retry in ${wait}`);
    }
    if (result.error === "ai_not_configured")
      return t(
        "服务端未配置 AI。点右侧设置填入自己的 API 即可使用。",
        "No built-in AI configured. Add your own API in settings.",
      );
    if (result.error === "upstream_auth_failed")
      return t(
        "API Key 无效或无权限，请检查设置。",
        "API key invalid or unauthorized — check settings.",
      );
    if (result.error === "upstream_not_found")
      return t(
        "接口地址不正确或协议不匹配，请检查 Base URL 与协议。",
        "Endpoint not found — check the Base URL and protocol.",
      );
    if (result.error === "upstream_rate_limited")
      return t("AI 服务限流，请稍后再试。", "The AI service is rate-limited — retry later.");
    if (result.error === "unavailable")
      return t("网络异常或服务无响应，请稍后再试。", "Network error or no response — retry later.");
    return result.msg ?? t("生成失败，请稍后再试。", "Generation failed — retry later.");
  }

  const waitingHint =
    result &&
    !result.ok &&
    (result.error === "ai_not_configured" ||
      result.error === "upstream_auth_failed" ||
      result.error === "upstream_not_found");

  return (
    <div
      ref={cardRef}
      className="comparison-ai"
      style={compact ? { padding: "12px 14px" } : undefined}
      aria-live="polite"
    >
      <div style={{ minWidth: 0, flex: 1 }}>
        <span className="eyebrow" style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
          <Sparkles size={13} /> {eyebrow}
        </span>
        {busy ? (
          <>
            <p>{t("正在生成 AI 点评…", "Generating AI commentary…")}</p>
            <div style={{ display: "flex", gap: 6, marginTop: 8, alignItems: "center" }}>
              {[1, 2, 3].map((i) => (
                <div
                  key={i}
                  style={{
                    width: 60,
                    height: 8,
                    borderRadius: 4,
                    background: "var(--line)",
                    animation: `plaza-pulse 1.5s ease-in-out ${i * 0.2}s infinite`,
                  }}
                />
              ))}
              <button
                className="text-button"
                style={{ fontSize: 11, color: "var(--muted)" }}
                onClick={() => {
                  abortRef.current?.abort();
                }}
              >
                {t("取消", "Cancel")}
              </button>
            </div>
          </>
        ) : result && result.ok ? (
          <>
            <p style={{ whiteSpace: "pre-wrap", lineHeight: 1.8 }}>{result.insight}</p>
            <div
              style={{
                display: "flex",
                gap: 8,
                alignItems: "center",
                flexWrap: "wrap",
                marginTop: 8,
                fontSize: 11,
                color: "var(--muted)",
              }}
            >
              <span className="badge badge-visit" style={{ fontSize: 10 }}>
                {result.source === "custom"
                  ? t(`我的 · ${result.model || "model"}`, `Mine · ${result.model || "model"}`)
                  : t(`内置 · ${result.model || "model"}`, `Built-in · ${result.model || "model"}`)}
              </span>
              {result.promptVersion === "override" && (
                <span title={t("提示词为管理员覆盖版本", "Administrator-overridden prompt")}>
                  ✏️ override
                </span>
              )}
              <button
                className="text-button"
                style={{ fontSize: 11 }}
                onClick={() => {
                  navigator.clipboard
                    ?.writeText(result.insight)
                    .then(() => {
                      setCopied(true);
                      setTimeout(() => setCopied(false), 1500);
                    })
                    .catch(() => {});
                }}
              >
                {copied ? t("已复制", "Copied") : t("复制", "Copy")}
              </button>
              <span>
                {t("将把榜单标题发送至 AI 服务。", "Ranking titles are sent to the AI service.")}
              </span>
            </div>
          </>
        ) : (
          <>
            <p>{result && !result.ok ? errorText() : intro}</p>
            {!waitingHint && (
              <p className="mini-note" style={{ margin: "4px 0 0" }}>
                {t(
                  "将把榜单标题等数据发送至 AI 服务（内置或你配置的服务）。",
                  "Ranking titles etc. are sent to the AI service (built-in or yours).",
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
        <div
          className="segmented"
          style={{ marginBottom: 0, fontSize: 11 }}
          role="group"
          aria-label={t("点评长度", "Commentary length")}
        >
          {LENGTHS.map((option) => (
            <button
              key={option.value}
              className={length === option.value ? "active" : ""}
              onClick={() => {
                setLength(option.value);
                writeAiLength(option.value);
              }}
              title={t(
                `约${option.zh === "简短" ? "120" : option.zh === "标准" ? "250" : "500"}字`,
                `~${option.value === "brief" ? "120" : option.value === "standard" ? "250" : "500"} words`,
              )}
            >
              {t(option.zh, option.en)}
            </button>
          ))}
        </div>
        <button className="button secondary" disabled={busy} onClick={() => void generate(true)}>
          <RefreshCw size={14} />
          {busy
            ? t("生成中…", "Generating…")
            : result && result.ok
              ? t("重新生成", "Regenerate")
              : t("生成点评", "Generate")}
        </button>
        <button className="icon-button" title={t("AI 设置", "AI settings")} onClick={onOpenConfig}>
          <Settings2 size={16} />
          {hasCustom && (
            <span
              className="sync-dot"
              data-status="saved"
              style={{
                position: "absolute",
                top: 4,
                right: 4,
                width: 7,
                height: 7,
                borderRadius: "50%",
                border: "1.5px solid var(--bg)",
              }}
            />
          )}
        </button>
      </div>
    </div>
  );
}
