/**
 * 「填入示例模板 / 复制模板」使用的主题包。
 * 它必须能原样通过 parseThemePackage —— 由 themeTemplate.test.ts 守着；
 * 模板一旦不合法，用户照着模板改出来的主题就 100% 导入失败。
 *
 * 注意：声明块内不能写注释——解析器按分号切分声明，注释会被当成变量名。
 */
export const THEME_TEMPLATE_ID = "my-theme";

export const THEME_TEMPLATE = `/*! art-rank-theme {"id":"my-theme","name":{"zh":"我的主题","en":"My Theme"},"dot":["#0b0d10","#d8f86a"]} */
/* 用法：改 id 时要同时改下方 [data-theme="..."]；带 (必需) 的 21 个变量不能删，其余可删。 */
[data-theme="my-theme"]{
  --bg:#0b0d10;
  --surface:#11151b;
  --surface-2:#161b23;
  --surface-3:#1a2029;
  --surface-4:#202833;
  --surface-hover:#1d242e;
  --line:#1f2630;
  --border-2:#2c3542;
  --scrim:rgba(0,0,0,.63);
  --text:#eef2f6;
  --text-2:#c8d0da;
  --text-3:#98a4b3;
  --text-4:#5f6b7a;
  --text-hi:#ffffff;
  --muted:#98a4b3;
  --accent:#d8f86a;
  --accent-2:#c9ff74;
  --accent-ink:#17200d;
  --film:#d8f86a;
  --book:#efaa97;
  --music:#97bfc5;
  --other:#c7c2ee;
  --ok:#4ade80;
  --warn:#facc15;
  --danger:#f87171;
  --danger-2:#fca5a5;
  --toast-bg:#e0f7a9;
  --toast-bg-2:#d7fb9d;
  --toast-ink:#233113;
  --toast-border:#769052;
}
`;
