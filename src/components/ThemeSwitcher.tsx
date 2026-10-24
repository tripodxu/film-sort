import { useEffect, useRef, useState } from "react";
import { Check, Palette, Plus, Trash2 } from "lucide-react";
import { THEMES, applyTheme, readTheme } from "../lib/theme";
import { LAYOUTS, applyLayout, readLayout, type LayoutId } from "../lib/layout";
import { deleteCustomTheme, listCustomThemes, type CustomThemeMeta } from "../lib/themeRegistry";
import {
  listOrbEffects,
  readOrbEffectId,
  writeOrbEffectId,
  notifyOrbEffectChanged,
} from "../lib/orbEffects/registry";
import { ThemeImportDialog } from "./ThemeImportDialog";

// 顶栏主题切换器：调色板按钮 + 下拉菜单，复用 .rank-menu 玻璃面板样式
// P5c：菜单内并入布局模式组（同款 menu-item，mono 方格缩略图标，§5.1）
// 插拔主题：内置 THEMES 之外枚举 themeRegistry 导入的自定义主题（可删除），
// 菜单底部提供「导入主题包」入口。
// P4（PLAN-ui-modernization）：内置主题分「经典 / 新系列」两组展示（11 个平铺太长）。
// T-20261024-01：四个分组（经典/新系列/开场特效/布局）改套 settings-menu 同款
// 「分组标签 + settings-chip-grid 双列网格」，单列 ~27 行收纳到 ~16 行；
// 组名、NEW_SERIES 集合、所有 role/aria 与行为不变，布局组补了组名标签。

/** 新系列（组件级差异主题，PLAN-ui-modernization）；其余内置主题归经典组。 */
const NEW_SERIES: ReadonlySet<string> = new Set([
  "editorial",
  "editorial-dark",
  "aurora",
  "gallery",
  "atlas",
]);

export function ThemeSwitcher({ zh, onNotice }: { zh: boolean; onNotice?: (m: string) => void }) {
  const [open, setOpen] = useState(false);
  const [theme, setTheme] = useState<string>(() => readTheme());
  const [layout, setLayout] = useState<LayoutId>(() => readLayout());
  const [customs, setCustoms] = useState<CustomThemeMeta[]>(() => listCustomThemes());
  const [orbEffect, setOrbEffect] = useState<string>(() => readOrbEffectId());
  const [importOpen, setImportOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    // 菜单打开期间才需要监听外部点击（此前写反成关闭期挂载=永不生效）；
    // T-20261024-01：同一生命周期补 Escape 关闭（键盘可达性）
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const t = (zhText: string, en: string) => (zh ? zhText : en);

  function refreshCustoms() {
    setCustoms(listCustomThemes());
  }

  function pick(id: string) {
    setTheme(id);
    applyTheme(id);
    // 主题推荐默认（P2）：无持久化 orb 选择时勾选跟随主题推荐（aurora→极光绸带）
    setOrbEffect(readOrbEffectId());
    setOpen(false);
  }

  function pickLayout(id: LayoutId) {
    setLayout(id);
    applyLayout(id);
    setOpen(false);
  }

  function pickOrbEffect(id: string) {
    if (writeOrbEffectId(id)) {
      setOrbEffect(id);
      notifyOrbEffectChanged();
    }
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

  // T-20261024-01：内置主题/开场特效/布局统一走 chip（settings-chip 双列网格），
  // role="menuitemradio" / aria-checked 与旧行按钮一致，仅外观收纳。
  const chip = (
    id: string,
    dot: React.ReactNode,
    label: string,
    active: boolean,
    onPick: () => void,
  ) => (
    <button
      key={id}
      role="menuitemradio"
      aria-checked={active}
      className={active ? "settings-chip active" : "settings-chip"}
      onClick={onPick}
    >
      {dot}
      <span className="theme-name">{label}</span>
      {active && <Check size={13} className="theme-check" />}
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
        <div className="rank-menu theme-menu theme-menu-grid" role="menu">
          <div className="settings-group-label">{t("经典", "Classic")}</div>
          <div className="settings-chip-grid" role="group" aria-label={t("经典", "Classic")}>
            {THEMES.filter((item) => !NEW_SERIES.has(item.id)).map((item) =>
              chip(
                item.id,
                <span className={`theme-dot theme-${item.id}`} />,
                zh ? item.zh : item.en,
                theme === item.id,
                () => pick(item.id),
              ),
            )}
          </div>
          <div className="rank-menu-sep" role="separator" />
          <div className="settings-group-label">{t("新系列", "New Series")}</div>
          <div className="settings-chip-grid" role="group" aria-label={t("新系列", "New Series")}>
            {THEMES.filter((item) => NEW_SERIES.has(item.id)).map((item) =>
              chip(
                item.id,
                <span className={`theme-dot theme-${item.id}`} />,
                zh ? item.zh : item.en,
                theme === item.id,
                () => pick(item.id),
              ),
            )}
          </div>
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
                tabIndex={0}
                aria-label={t(`删除主题 ${item.name.zh}`, `Remove theme ${item.name.en}`)}
                title={t("删除此主题", "Remove this theme")}
                className="custom-theme-delete"
                onClick={(event) => {
                  event.stopPropagation();
                  removeCustom(item.id);
                }}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    event.stopPropagation();
                    removeCustom(item.id);
                  }
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
          <div className="settings-group-label">{t("开场特效", "Intro effect")}</div>
          <div
            className="settings-chip-grid"
            role="group"
            aria-label={t("开场特效", "Intro effect")}
          >
            {listOrbEffects().map((effect) =>
              chip(
                effect.id,
                <span
                  className="theme-dot"
                  style={{ background: "var(--accent)" }}
                  aria-hidden="true"
                />,
                zh ? effect.name.zh : effect.name.en,
                orbEffect === effect.id,
                () => pickOrbEffect(effect.id),
              ),
            )}
          </div>
          <div className="rank-menu-sep" role="separator" />
          <div className="settings-group-label">{t("布局", "Layout")}</div>
          <div className="settings-chip-grid" role="group" aria-label={t("布局", "Layout")}>
            {LAYOUTS.map((item) =>
              chip(
                item.id,
                <span className={`layout-dot layout-${item.id}`} aria-hidden="true" />,
                zh ? item.zh : item.en,
                layout === item.id,
                () => pickLayout(item.id),
              ),
            )}
          </div>
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
