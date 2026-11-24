import { useRef, useState } from "react";
import { FileUp } from "lucide-react";
import { Modal } from "./Modal";
import {
  importThemePackage,
  THEME_PACKAGE_LIMIT,
  type ThemeImportError,
} from "../lib/themeRegistry";

const ERROR_TEXT: Record<ThemeImportError, { zh: string; en: string }> = {
  empty: { zh: "内容为空，请粘贴或选择主题包。", en: "Empty input — paste or pick a theme file." },
  too_large: {
    zh: `包过大（上限 ${Math.round(THEME_PACKAGE_LIMIT / 1024)}KB）。`,
    en: `Package too large (max ${Math.round(THEME_PACKAGE_LIMIT / 1024)}KB).`,
  },
  meta_missing: {
    zh: "缺少元数据注释（/*! art-rank-theme {...} */）。",
    en: "Missing the /*! art-rank-theme {...} */ metadata comment.",
  },
  meta_invalid: {
    zh: "元数据 JSON 不合法或 id 格式错误。",
    en: "Metadata JSON invalid or bad id.",
  },
  id_conflict: {
    zh: "id 与内置主题冲突，请换一个 id。",
    en: "id conflicts with a built-in theme.",
  },
  block_missing: {
    zh: '找不到 [data-theme="id"]{...} 声明块。',
    en: 'The [data-theme="id"]{...} block was not found.',
  },
  var_unknown: {
    zh: "包含未知变量（只允许站内 :root 变量）。",
    en: "Unknown variable (built-in :root vars only).",
  },
  var_required_missing: {
    zh: "缺少必需变量：",
    en: "Missing required variables: ",
  },
  value_invalid: {
    zh: "存在非法值（字符/括号/重复声明）。",
    en: "Invalid value (chars/parens/duplicate).",
  },
  quota_exceeded: {
    zh: "存储配额已满，请先删除不用的主题。",
    en: "Storage quota full — remove a theme first.",
  },
};

const THEME_TEMPLATE = `/*! art-rank-theme {"id":"my-theme","name":{"zh":"我的主题","en":"My Theme"},"dot":"#d8f86a"} */
[data-theme="my-theme"]{
  --bg:#0b0d10;--text:#eef2f6;--accent:#d8f86a;--accent-2:#c9ff74;--accent-ink:#17200d;
  --ok:#4ade80;--warn:#facc15;--danger:#f87171;--danger-2:#fca5a5;--indigo:#818cf8;--pink:#f472b6;
  --film:#d8f86a;--book:#efaa97;--music:#97bfc5;--other:#c7c2ee;
  --scrim:rgba(0,0,0,.63);--toast-bg:#e0f7a9;--toast-bg-2:#d7fb9d;--toast-ink:#233113;--toast-border:#769052;
}`;

/**
 * 自定义主题导入：粘贴 CSS 文本或选择 .css 文件 → 校验 → 落库注入。
 * 校验失败时展示具体原因（含缺失变量清单），不产生任何副作用。
 */
export function ThemeImportDialog({
  t,
  onClose,
  onImported,
}: {
  t: (zh: string, en: string) => string;
  onClose: () => void;
  /** (id, name) 导入成功，供父级刷新列表并应用。 */
  onImported: (id: string, name: string) => void;
}) {
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(false);
  const [copiedTpl, setCopiedTpl] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function runImport(source: string) {
    setBusy(true);
    setError(null);
    const result = importThemePackage(source);
    setBusy(false);
    if (result.ok) {
      onImported(result.theme.id, t(result.theme.name.zh, result.theme.name.en));
      onClose();
      return;
    }
    const text2 = ERROR_TEXT[result.error];
    const base = t(text2.zh, text2.en);
    setError(result.detail ? `${base} ${result.detail}` : base);
  }

  async function onFile(file: File | undefined) {
    if (!file) return;
    if (file.size > THEME_PACKAGE_LIMIT) {
      setError(
        t(
          `文件过大（上限 ${Math.round(THEME_PACKAGE_LIMIT / 1024)}KB）。`,
          `File too large (max ${Math.round(THEME_PACKAGE_LIMIT / 1024)}KB).`,
        ),
      );
      return;
    }
    try {
      runImport(await file.text());
    } catch {
      setError(t("文件读取失败，请重试。", "Could not read the file. Try again."));
      setBusy(false);
    }
  }

  const label = { fontSize: 12, color: "var(--muted)", marginBottom: 4 };

  return (
    <Modal
      t={t}
      headingId="theme-import-heading"
      eyebrow={t("主题", "Theme")}
      title={t("导入主题包", "Import theme")}
      panelStyle={{ width: "min(560px, 100%)" }}
      onClose={onClose}
    >
      <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7 }}>
        {t(
          "主题包是一段带元数据注释的 CSS：元数据声明 id/名称/预览色，声明块只允许站内变量（颜色/字体/圆角/时长）。导入只存本浏览器，随时可删。",
          "A theme package is CSS with a metadata comment: id/name/preview dot, plus a block of built-in variables only (colors/fonts/radii/durations). Stored in this browser; removable anytime.",
        )}
      </p>
      <div>
        <div style={label}>{t("主题包内容（CSS）", "Package content (CSS)")}</div>
        <textarea
          value={text}
          onChange={(event) => setText(event.target.value)}
          placeholder={
            '/*! art-rank-theme {"id":"my-theme",...} */\n[data-theme="my-theme"]{--bg:...;--accent:...}'
          }
          spellCheck={false}
          style={{ minHeight: 160, fontSize: 12, fontFamily: "var(--font-mono)" }}
        />
      </div>
      {error && (
        <p
          style={{
            fontSize: 12,
            margin: 0,
            color: "var(--danger)",
            lineHeight: 1.6,
            overflowWrap: "anywhere",
          }}
        >
          {error}
        </p>
      )}
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button
          className="button secondary"
          disabled={busy || !text.trim()}
          onClick={() => runImport(text)}
        >
          <FileUp size={14} />
          {busy ? t("导入中…", "Importing…") : t("校验并导入", "Validate & import")}
        </button>
        <button className="button secondary" onClick={() => fileRef.current?.click()}>
          {t("选择 .css 文件", "Pick a .css file")}
        </button>
        <button
          className="button secondary"
          type="button"
          onClick={() => {
            setText(THEME_TEMPLATE);
            setError(null);
          }}
        >
          {t("填入示例模板", "Fill template")}
        </button>
        <button
          className="button quiet"
          type="button"
          onClick={() => {
            navigator.clipboard
              ?.writeText(THEME_TEMPLATE)
              .then(() => {
                setCopiedTpl(true);
                window.setTimeout(() => setCopiedTpl(false), 1500);
              })
              .catch(() => {});
          }}
        >
          {copiedTpl ? t("已复制模板", "Copied") : t("复制模板", "Copy template")}
        </button>
        <input
          ref={fileRef}
          type="file"
          accept=".css,text/css"
          hidden
          onChange={(event) => {
            void onFile(event.target.files?.[0]);
            event.target.value = "";
          }}
        />
      </div>
      <details style={{ fontSize: 12, color: "var(--muted)", lineHeight: 1.7 }}>
        <summary style={{ cursor: "pointer", color: "var(--text-2)" }}>
          {t("查看支持覆写的 CSS 变量清单", "Supported CSS variables")}
        </summary>
        <p style={{ margin: "6px 0 0", fontFamily: "var(--font-mono)", fontSize: 11 }}>
          --bg, --text, --accent, --accent-2, --accent-ink, --ok, --warn, --danger, --danger-2,
          --indigo, --pink, --film, --book, --music, --other, --scrim, --toast-bg, --toast-bg-2,
          --toast-ink, --toast-border, --font-body, --font-display, --font-serif, --font-mono
        </p>
      </details>
      <div className="guide-modal-footer">
        <div style={{ flex: 1 }} />
        <button className="button secondary" onClick={onClose}>
          {t("取消", "Cancel")}
        </button>
      </div>
    </Modal>
  );
}
