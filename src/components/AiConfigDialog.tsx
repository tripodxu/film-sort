import { useState } from "react";
import { Check, Plug, RefreshCw, X } from "lucide-react";
import { IconButton } from "../views/IconButton";
import {
  clearAiConfig,
  fetchAiModels,
  readAiConfig,
  testAiConfig,
  writeAiConfig,
  type AiInsightFailure,
  type AiProtocol,
} from "../lib/aiInsight";

const PROTOCOL_OPTIONS: Array<{ value: AiProtocol; zh: string; en: string }> = [
  { value: "auto", zh: "自动探测", en: "Auto-detect" },
  { value: "chat", zh: "Chat Completions", en: "Chat Completions" },
  { value: "responses", zh: "Responses API", en: "Responses API" },
  { value: "anthropic", zh: "Anthropic Messages", en: "Anthropic Messages" },
  { value: "gemini", zh: "Gemini Native", en: "Gemini Native" },
];

/**
 * AI 服务配置弹窗：三参数（Base URL / API Key / Model）+ 可选协议。
 * 「获取模型列表」把 Model 升级为可搜索下拉；「测试连接」回显探测到的协议。
 * Key 只写入本浏览器 localStorage，请求经同源 Worker 转发，不进任何日志。
 */
export function AiConfigDialog({
  t,
  onClose,
  onSaved,
}: {
  t: (zh: string, en: string) => string;
  onClose: () => void;
  onSaved?: () => void;
}) {
  const existing = readAiConfig();
  const [baseUrl, setBaseUrl] = useState(existing?.baseUrl ?? "");
  const [apiKey, setApiKey] = useState(existing?.apiKey ?? "");
  const [model, setModel] = useState(existing?.model ?? "");
  const [protocol, setProtocol] = useState<AiProtocol>(existing?.protocol ?? "auto");
  const [showKey, setShowKey] = useState(false);
  const [models, setModels] = useState<string[]>([]);
  const [testBusy, setTestBusy] = useState(false);
  const [listBusy, setListBusy] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; text: string } | null>(null);

  const valid =
    baseUrl.trim().startsWith("https://") && apiKey.trim().length >= 8 && model.trim().length > 0;

  const config = () => ({
    baseUrl: baseUrl.trim(),
    apiKey: apiKey.trim(),
    model: model.trim(),
    ...(protocol !== "auto" ? { protocol } : {}),
  });

  const failureText = (failure: AiInsightFailure) =>
    failure.msg ?? t("操作失败，请检查配置", "Request failed — check the configuration");

  async function runTest() {
    if (!valid || testBusy) return;
    setTestBusy(true);
    setMessage(null);
    const result = await testAiConfig(config());
    setTestBusy(false);
    if (result.ok)
      setMessage({
        ok: true,
        text: t(
          `连接成功（协议：${result.protocol}，模型：${result.model}）`,
          `Connected (protocol: ${result.protocol}, model: ${result.model})`,
        ),
      });
    else setMessage({ ok: false, text: failureText(result) });
  }

  async function runList() {
    if (!valid || listBusy) return;
    setListBusy(true);
    setMessage(null);
    const result = await fetchAiModels(config());
    setListBusy(false);
    if (result.ok) {
      setModels(result.models);
      if (!result.models.includes(model.trim())) setMessage(null);
      setMessage({
        ok: true,
        text:
          t(
            `获取到 ${result.models.length} 个模型（协议：${result.protocol}）`,
            `${result.models.length} models (protocol: ${result.protocol})`,
          ) + (result.truncated ? t("，仅显示前 100 个", " — showing first 100") : ""),
      });
    } else setMessage({ ok: false, text: failureText(result) });
  }

  function save() {
    if (!valid) return;
    const stored = writeAiConfig(config());
    window.dispatchEvent(new CustomEvent("art-rank:ai-config-changed"));
    onSaved?.();
    onClose();
    if (!stored) {
      // 写不进存储（隐私模式）：仍然关闭弹窗，但本次配置不会跨刷新保留。
      console.warn("[ai] localStorage unavailable; config will not persist");
    }
  }

  const label = { fontSize: 12, color: "var(--muted)", marginBottom: 4 };

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <section
        className="account-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby="ai-config-heading"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key === "Escape") onClose();
        }}
        style={{ width: "min(560px, 100%)" }}
      >
        <div className="section-heading">
          <div>
            <span className="eyebrow">AI</span>
            <h2 id="ai-config-heading">{t("AI 解读服务", "AI service")}</h2>
          </div>
          <IconButton title={t("关闭", "Close")} onClick={onClose}>
            <X size={18} />
          </IconButton>
        </div>
        <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
          {t(
            "填入自己的 API 后，榜单/画像/比较的 AI 点评都会走你的服务；留空则使用服务端内置模型。Base URL 填到 /v1 这一级，例如 https://api.openai.com/v1 或 https://api.anthropic.com。",
            "With your own API, all AI commentary goes to your service; leave empty to use the built-in one. Base URL goes up to /v1, e.g. https://api.openai.com/v1 or https://api.anthropic.com.",
          )}
        </p>
        <div style={{ display: "grid", gap: 10, marginBottom: 10 }}>
          <div>
            <div style={label}>Base URL</div>
            <input
              value={baseUrl}
              onChange={(event) => setBaseUrl(event.target.value)}
              placeholder="https://api.openai.com/v1"
              spellCheck={false}
            />
          </div>
          <div>
            <div style={label}>API Key</div>
            <div style={{ display: "flex", gap: 6 }}>
              <input
                type={showKey ? "text" : "password"}
                value={apiKey}
                onChange={(event) => setApiKey(event.target.value)}
                placeholder="sk-…"
                spellCheck={false}
                style={{ flex: 1 }}
              />
              <button
                className="button secondary"
                onClick={() => setShowKey(!showKey)}
                style={{ minHeight: 36, paddingInline: 10, fontSize: 12 }}
              >
                {showKey ? t("隐藏", "Hide") : t("显示", "Show")}
              </button>
            </div>
          </div>
          <div>
            <div style={label}>
              Model{" "}
              {models.length > 0 && (
                <span style={{ color: "var(--accent)" }}>
                  · {t("可从列表选择或继续手输", "pick from the list or keep typing")}
                </span>
              )}
            </div>
            <input
              value={model}
              onChange={(event) => setModel(event.target.value)}
              placeholder="gpt-4o-mini"
              list="ai-model-options"
              spellCheck={false}
            />
            <datalist id="ai-model-options">
              {models.map((name) => (
                <option key={name} value={name} />
              ))}
            </datalist>
          </div>
          <div>
            <div style={label}>{t("协议（默认自动探测）", "Protocol (auto by default)")}</div>
            <select
              value={protocol}
              onChange={(event) => setProtocol(event.target.value as AiProtocol)}
            >
              {PROTOCOL_OPTIONS.map((option) => (
                <option key={option.value} value={option.value}>
                  {t(option.zh, option.en)}
                </option>
              ))}
            </select>
          </div>
        </div>
        {message && (
          <p
            style={{
              fontSize: 12,
              margin: "0 0 10px",
              color: message.ok ? "var(--green)" : "var(--red)",
              lineHeight: 1.6,
              overflowWrap: "anywhere",
            }}
          >
            {message.text}
          </p>
        )}
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
          <button
            className="button secondary"
            disabled={!valid || listBusy}
            onClick={() => void runList()}
          >
            <RefreshCw size={14} />
            {listBusy ? t("获取中…", "Loading…") : t("获取模型列表", "List models")}
          </button>
          <button
            className="button secondary"
            disabled={!valid || testBusy}
            onClick={() => void runTest()}
          >
            <Plug size={14} />
            {testBusy ? t("测试中…", "Testing…") : t("测试连接", "Test connection")}
          </button>
        </div>
        <p className="mini-note" style={{ margin: 0, lineHeight: 1.7 }}>
          {t(
            "Key 仅保存在本浏览器（不清除就一直有效）；AI 点评会把榜单标题发送给你配置的服务。如遇 404，请检查 Base URL 与协议是否匹配。",
            "The key stays in this browser only; AI commentary sends ranking titles to your configured service. On 404, check that the Base URL and protocol match.",
          )}
        </p>
        <div className="guide-modal-footer">
          {existing && (
            <button
              className="button quiet"
              onClick={() => {
                clearAiConfig();
                window.dispatchEvent(new CustomEvent("art-rank:ai-config-changed"));
                onSaved?.();
                onClose();
              }}
              title={t(
                "删除本浏览器保存的配置，AI 点评回到服务端内置通道",
                "Remove the saved config in this browser; commentary falls back to the built-in channel",
              )}
            >
              {t("停用我的 API（回到内置）", "Use built-in instead")}
            </button>
          )}
          <div style={{ flex: 1 }} />
          <button
            className="button secondary"
            onClick={() => {
              setBaseUrl("");
              setApiKey("");
              setModel("");
              setProtocol("auto");
              setModels([]);
              setMessage(null);
            }}
            title={t(
              "仅清空下方输入框，不影响已保存的配置",
              "Clears the form only — keeps the saved config",
            )}
          >
            {t("清空表单", "Reset")}
          </button>
          <button className="button secondary" onClick={onClose}>
            {t("取消", "Cancel")}
          </button>
          <button className="button primary" disabled={!valid} onClick={save}>
            <Check size={15} />
            {t("保存", "Save")}
          </button>
        </div>
      </section>
    </div>
  );
}
