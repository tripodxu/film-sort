import { useEffect, useRef, useState } from "react";
import { Bot, Check, Eraser, Settings2 } from "lucide-react";
import { AiConfigDialog } from "./AiConfigDialog";
import { readAiConfig } from "../lib/aiInsight";
import { markCachePurged } from "../lib/cacheBust";

const CAPS = [100, 300, 500, 1000];

// 清缓存入口用短标签：菜单里的 2×2 块放不下长词，语义靠分组标题补足。
const CACHE_SCOPES: Array<{ scope: string; label: string; en: string }> = [
  { scope: "posters", label: "海报", en: "Posters" },
  { scope: "intro", label: "简介", en: "Intros" },
  { scope: "music", label: "歌曲", en: "Music" },
  { scope: "misc", label: "其他", en: "Other" },
];

/**
 * 顶栏全局设置：齿轮按钮 + 下拉菜单。
 * 三组内容（导入上限 / AI 服务 / 清缓存）用分隔线与 mono 眉标分层；
 * 导入上限与清缓存都是 2×2 chip 网格，避免菜单纵向拖长。
 */
export function SettingsMenu({
  zh,
  cap,
  onCap,
  onNotice,
}: {
  zh: boolean;
  cap: number;
  onCap: (n: number) => void;
  /** 清缓存等操作的结果提示（接 App 的 setNotice）。 */
  onNotice?: (message: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const [purging, setPurging] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  // setAiTick 触发本组件重渲染，让「我的：model」标签在弹窗保存/停用后反映最新配置。
  const [, setAiTick] = useState(0);
  const aiConfig = readAiConfig();

  useEffect(() => {
    if (open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const t = (zhText: string, en: string) => (zh ? zhText : en);

  async function purge(scope: string) {
    setPurging(scope);
    try {
      const response = await fetch("/api/cache/clear", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      if (!response.ok) throw new Error(String(response.status));
      markCachePurged();
      onNotice?.(t("缓存已清除，重新打开详情即生效。", "Cache cleared. Reopen details."));
    } catch {
      onNotice?.(t("清除失败，请稍后再试。", "Clearing failed. Try again later."));
    } finally {
      setPurging(null);
      setOpen(false);
    }
  }

  return (
    <div className="theme-switcher" ref={ref}>
      <button
        className="icon-button"
        aria-label={t("设置", "Settings")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("设置", "Settings")}
        onClick={() => setOpen(!open)}
      >
        <Settings2 size={18} />
        <span className="tooltip" role="tooltip">
          {t("设置", "Settings")}
        </span>
      </button>
      {open && (
        <div className="rank-menu theme-menu settings-menu" role="menu">
          <div className="settings-group-label">{t("单次导入上限", "Per-import cap")}</div>
          <div
            className="settings-chip-grid"
            role="radiogroup"
            aria-label={t("单次导入上限", "Per-import cap")}
          >
            {CAPS.map((n) => (
              <button
                key={n}
                role="menuitemradio"
                aria-checked={cap === n}
                className={`settings-chip${cap === n ? " active" : ""}`}
                onClick={() => {
                  onCap(n);
                  setOpen(false);
                }}
              >
                {n}
                {zh ? " 条" : ""}
              </button>
            ))}
          </div>
          <div className="rank-menu-sep" />
          <div className="settings-group-label">{t("AI 解读服务", "AI service")}</div>
          <button
            role="menuitem"
            className="settings-row"
            onClick={() => {
              setOpen(false);
              setAiOpen(true);
            }}
          >
            <Bot size={14} />
            <span className="theme-name">
              {aiConfig
                ? t("我的 API", "My API")
                : t("使用内置 / 配置我的 API", "Built-in / configure my API")}
            </span>
            {aiConfig && <span className="settings-badge">{aiConfig.model}</span>}
          </button>
          <div className="rank-menu-sep" />
          <div className="settings-group-label">{t("清除服务端缓存", "Clear server caches")}</div>
          <div className="settings-chip-grid">
            {CACHE_SCOPES.map(({ scope, label, en }) => (
              <button
                key={scope}
                role="menuitem"
                className={`settings-chip${purging === scope ? " busy" : ""}`}
                disabled={purging !== null}
                onClick={() => void purge(scope)}
              >
                {purging === scope ? (
                  <span className="settings-chip-spin" aria-hidden="true" />
                ) : (
                  <Eraser size={12} />
                )}
                {purging === scope ? t("清除中…", "…") : t(label, en)}
              </button>
            ))}
          </div>
          <div className="settings-hint">
            {t("清掉的缓存重新打开详情即回源取最新数据。", "Cleared data refetches on next open.")}
          </div>
        </div>
      )}
      {aiOpen && (
        <AiConfigDialog
          t={t}
          onClose={() => {
            setAiOpen(false);
            setAiTick((v) => v + 1);
          }}
          onSaved={() => setAiTick((v) => v + 1)}
        />
      )}
    </div>
  );
}
