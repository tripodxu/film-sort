import { useEffect, useRef, useState } from "react";
import { Check, Palette } from "lucide-react";
import { THEMES, applyTheme, readTheme, type ThemeId } from "../lib/theme";

// 顶栏主题切换器：调色板按钮 + 下拉菜单，复用 .rank-menu 玻璃面板样式
export function ThemeSwitcher({ zh }: { zh: boolean }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<ThemeId>(() => readTheme());
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function pick(id: ThemeId) {
    setTheme(id);
    applyTheme(id);
    setOpen(false);
  }

  return <div className="theme-switcher" ref={ref}>
    <button className="icon-button" aria-label={zh ? "主题" : "Theme"} aria-haspopup="menu" aria-expanded={open} title={zh ? "主题" : "Theme"} onClick={() => setOpen(!open)}>
      <Palette size={18} />
      <span className="tooltip" role="tooltip">{zh ? "主题" : "Theme"}</span>
    </button>
    {open && <div className="rank-menu theme-menu" role="menu">
      {THEMES.map((item) => <button key={item.id} role="menuitemradio" aria-checked={theme === item.id} className={theme === item.id ? "active" : ""} onClick={() => pick(item.id)}>
        <span className={`theme-dot theme-${item.id}`} />
        <span className="theme-name">{zh ? item.zh : item.en}</span>
        {theme === item.id && <Check size={14} className="theme-check" />}
      </button>)}
    </div>}
  </div>;
}
