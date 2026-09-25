import { useEffect, useRef, useState } from "react";
import { Check, Palette, Plus, Trash2 } from "lucide-react";
import { THEMES, applyTheme, readTheme } from "../lib/theme";
import { LAYOUTS, applyLayout, readLayout, type LayoutId } from "../lib/layout";
import { deleteCustomTheme, listCustomThemes, type CustomThemeMeta } from "../lib/themeRegistry";
import { ThemeImportDialog } from "./ThemeImportDialog";

// 顶栏主题切换器：调色板按钮 + 下拉菜单，复用 .rank-menu 玻璃面板样式
// P5c：菜单内并入布局模式组（同款 menu-item，mono 方格缩略图标，§5.1）
// 插拔主题：内置 THEMES 之外枚举 themeRegistry 导入的自定义主题（可删除），
// 菜单底部提供「导入主题包」入口。
export function ThemeSwitcher({ zh, onNotice }: { zh: boolean; onNotice?: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<string>(() => readTheme());
  const [layout, setLayout] = useState<LayoutId>(() => readLayout());
  const [customs, setCustoms] = useState<CustomThemeMeta[]>(() => listCustomThemes());
  const [importOpen, setImportOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const t = (zhText: string, en: string) => (zh ? zhText : en);

  function refreshCustoms() {
    setCustoms(listCustomThemes());
  }

  function pick(id: string) {
    setTheme(id);
    applyTheme(id);
    setOpen(false);
  }

  function pickLayout(id: LayoutId) {
    setLayout(id);
    applyLayout(id);
    setOpen(false);
  }

  function removeCustom(id: string) {
    const wasActive = theme === id;
    deleteCustomTheme(id);
    refreshCustoms();
    if (wasActive) {
      setTheme("modern");
      applyTheme("modern");
    }
    onNotice?.(t("自定义主题已删除。", "Custom theme removed."));
  }

  const themeButton = (id: string, dot: React.ReactNode, label: string) => (
    <button
      key={id}
      role="menuitemradio"
      aria-checked={theme === id}
      className={theme === id ? "active" : ""}
      onClick={() => pick(id)}
    >
      {dot}
      <span className="theme-name">{label}</span>
      {theme === id && <Check size={14} className="theme-check" />}
    </button>
  );

  return (
    <div className="theme-switcher" ref={ref}>
      <button
        className="icon-button"
        aria-label={t("主题", "Theme")}
        aria-haspopup="menu"
        aria-expanded={open}
        title={t("主题", "Theme")}
        onClick={() => {
          setOpen(!open);
          refreshCustoms();
        }}
      >
        <Palette size={18} />
        <span className="tooltip" role="tooltip">
          {t("主题", "Theme")}
        </span>
      </button>
      {open && (
        <div className="rank-menu theme-menu" role="menu">
          {THEMES.map((item) =>
            themeButton(
              item.id,
              <span className={`theme-dot theme-${item.id}`} />,
              zh ? item.zh : item.en,
            ),
          )}
          {customs.length > 0 && <div className="rank-menu-sep" role="separator" />}
          {customs.map((item) => (
            <button
              key={item.id}
              role="menuitemradio"
              aria-checked={theme === item.id}
              className={theme === item.id ? "active" : ""}
              onClick={() => pick(item.id)}
            >
              <span
                className="theme-dot"
                style={{
                  background: `linear-gradient(135deg,${item.dot[0]} 50%,${item.dot[1]} 50%)`,
                }}
              />
              <span className="theme-name">{zh ? item.name.zh : item.name.en}</span>
              {theme === item.id && <Check size={14} className="theme-check" />}
              <span
                role="button"
                aria-label={t(`删除主题 ${item.name.zh}`, `Remove theme ${item.name.en}`)}
                title={t("删除此主题", "Remove this theme")}
                className="custom-theme-delete"
                onClick={(event) => {
                  event.stopPropagation();
                  removeCustom(item.id);
                }}
              >
                <Trash2 size={13} />
              </span>
            </button>
          ))}
          <div className="rank-menu-sep" role="separator" />
          <button
            role="menuitem"
            onClick={() => {
              setImportOpen(true);
              setOpen(false);
            }}
          >
            <Plus size={14} />
            <span className="theme-name">{t("导入主题包…", "Import theme…")}</span>
          </button>
          <div className="rank-menu-sep" role="separator" />
          {LAYOUTS.map((item) => (
            <button
              key={item.id}
              role="menuitemradio"
              aria-checked={layout === item.id}
              className={layout === item.id ? "active" : ""}
              onClick={() => pickLayout(item.id)}
            >
              <span className={`layout-dot layout-${item.id}`} aria-hidden="true" />
              <span className="theme-name">{zh ? item.zh : item.en}</span>
              {layout === item.id && <Check size={14} className="theme-check" />}
            </button>
          ))}
        </div>
      )}
      {importOpen && (
        <ThemeImportDialog
          t={t}
          onClose={() => setImportOpen(false)}
          onImported={(id, name) => {
            refreshCustoms();
            pick(id);
            onNotice?.(t(`已应用主题「${name}」。`, `Theme "${name}" applied.`));
          }}
        />
      )}
    </div>
  );
}
