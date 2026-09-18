import { useEffect, useRef, useState } from "react";
import { Check, Settings2 } from "lucide-react";

// 顶栏全局设置：齿轮按钮 + 下拉，目前含「单次导入上限」（localStorage 持久化，供分批导入引擎读取）
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
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="theme-switcher" ref={ref}>
      <button
        className="icon-button"
        aria-label={zh ? "设置" : "Settings"}
        aria-haspopup="menu"
        aria-expanded={open}
        title={zh ? "设置" : "Settings"}
        onClick={() => setOpen(!open)}
      >
        <Settings2 size={18} />
        <span className="tooltip" role="tooltip">
          {zh ? "设置" : "Settings"}
        </span>
      </button>
      {open && (
        <div className="rank-menu theme-menu" role="menu">
          <div className="settings-group-label">{zh ? "单次导入上限" : "Per-import cap"}</div>
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
          <div className="settings-hint">
            {zh
              ? "超出上限时，再次点击导入可继续抓取后续部分。"
              : "If a list exceeds the cap, import again to fetch the next batch."}
          </div>
        </div>
      )}
    </div>
  );
}
