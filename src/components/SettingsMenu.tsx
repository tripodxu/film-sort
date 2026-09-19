import { useEffect, useRef, useState } from "react";
import { Bot, Check, Settings2 } from "lucide-react";
import { AiConfigDialog } from "./AiConfigDialog";
import { readAiConfig } from "../lib/aiInsight";

// 顶栏全局设置：齿轮按钮 + 下拉，含「单次导入上限」与「AI 解读服务」
const CAPS = [100, 300, 500, 1000];

export function SettingsMenu({
  zh,
  cap,
  onCap,
}: {
  zh: boolean;
  cap: number;
  onCap: (n: number) => void;
}) {
  const [open, setOpen] = useState(false);
  const [aiOpen, setAiOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  // setAiTick 触发本组件重渲染，让「我的：model」标签在弹窗保存/停用后反映最新配置。
  const [, setAiTick] = useState(0);
  const aiConfig = readAiConfig();

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const t = (zhText: string, en: string) => (zh ? zhText : en);

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
        <div className="rank-menu theme-menu" role="menu">
          <div className="settings-group-label">{t("单次导入上限", "Per-import cap")}</div>
          {CAPS.map((n) => (
            <button
              key={n}
              role="menuitemradio"
              aria-checked={cap === n}
              className={cap === n ? "active" : ""}
              onClick={() => {
                onCap(n);
                setOpen(false);
              }}
            >
              <span className="theme-name">
                {n}
                {zh ? " 条" : ""}
              </span>
              {cap === n && <Check size={14} className="theme-check" />}
            </button>
          ))}
          <div className="settings-group-label" style={{ marginTop: 8 }}>
            {t("AI 解读服务", "AI service")}
          </div>
          <button
            role="menuitem"
            onClick={() => {
              setOpen(false);
              setAiOpen(true);
            }}
          >
            <span className="theme-name" style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <Bot size={14} />
              {aiConfig
                ? t(`我的：${aiConfig.model}`, `Mine: ${aiConfig.model}`)
                : t("使用内置 / 配置我的 API", "Built-in / configure my API")}
            </span>
          </button>
          <div className="settings-hint">
            {t(
              "榜单 / 画像 / 比较的 AI 点评通道。",
              "AI channel for ranking/profile/compare commentary.",
            )}
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
