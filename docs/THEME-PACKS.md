# ART/RANK 主题包规范（Theme Packs）

> 版本：1（2026-09-25）。兼容此规范的主题包可以在应用内「一键导入、一键应用」。
> 本文档面向**人类开发者**和 **AI agent**：按此规范生成的主题包保证可导入。

## 1. 一个主题包是什么

一段 **CSS 文本**（通常 1–3KB），由两部分组成：

1. **元数据注释**（必须，且为第一个匹配项）——JSON 声明 id、名称、预览双色；
2. **变量声明块**——`[data-theme="<id>"]{ --var: value; ... }`，只允许站内白名单变量。

示例（可直接导入）：

```css
/*! art-rank-theme {"id":"forest","name":{"zh":"森野绿","en":"Forest"},"dot":["#0E1512","#5CC98D"]} */
[data-theme="forest"]{
  --bg:#0E1512;--text:#DDF2E4;--text-2:#9DBFA9;--text-3:#6E8F7B;--muted:#6E8F7B;
  --accent:#5CC98D;--accent-2:#8FE0B4;--accent-ink:#0E1512;
  --line:#1E2C25;--border-2:#2A3D33;--surface:#16211C;--surface-2:#1B2A22;--surface-3:#101A15;--surface-hover:#1E2C25;
  --film:#5CC98D;--book:#D9AE5F;--music:#6FA57C;--other:#7FA3C8;
  --scrim:rgba(4,10,7,.6);--toast-bg:#16211C;--toast-ink:#DDF2E4;
}
```

## 2. 元数据字段

| 字段 | 类型 | 约束 |
|---|---|---|
| `id` | string | `/^[a-z][a-z0-9-]{1,20}$/`；**不得与内置主题重名**（modern/retro/minimal/simple/classic/cyber/paper） |
| `name.zh` / `name.en` | string | ≤20 / ≤30 字符，显示在主题菜单 |
| `dot` | `[hex, hex]` | 菜单预览圆点的双色渐变（建议 `[背景色, 强调色]`） |

## 3. 变量规则（安全模型）

导入采用**重建式注入**：解析器只抽取「变量名在白名单内、值通过字符白名单」的声明，
再由应用用受控模板重新拼装 CSS。用户文本**永远不会原样进入 DOM**——所以：

- **变量名必须是站内 `:root` 变量**（77 个，见 §4）；未知 `--x` 直接拒绝；
- **值字符白名单**：`a-zA-Z0-9 ,.%()'"#/+-`。`;`、`{`、`}`、`@`、`<`、`>`、`\`、`url(` 全部拒绝；
- 括号必须平衡（`color-mix(...)`、`rgba(...)` 没问题）；
- 同一变量重复声明拒绝；
- **必需变量集（21 个）缺一拒绝**——半主题的渲染错乱比导入失败更糟：
  `--bg --text --text-2 --text-3 --muted --accent --accent-2 --accent-ink --line --border-2 --surface --surface-2 --surface-3 --surface-hover --film --book --music --other --scrim --toast-bg --toast-ink`
- 其余变量（圆角 `--r-*`、动画时长 `--dur-*`、字体栈 `--font-*`、字号 `--t-*` 等）**可选**，
  缺失时回退 modern 主题的值；
- 单包 ≤ 16KB；每个浏览器最多累积 64KB 的自定义主题；
- 主题只存本浏览器（localStorage `art-rank:custom-themes`），**不经过服务器**。

## 4. 变量清单与语义

### 必需（21）

| 变量 | 语义 |
|---|---|
| `--bg` | 页面背景 |
| `--text` / `--text-2` / `--text-3` / `--muted` | 主文字 / 次级 / 三级 / 弱化 |
| `--accent` / `--accent-2` / `--accent-ink` | 强调色 / 强调亮色 / 强调色上的文字色 |
| `--line` / `--border-2` | 分隔线 / 控件边框 |
| `--surface` / `--surface-2` / `--surface-3` / `--surface-hover` | 面板层级 1–3 / 悬停 |
| `--film` / `--book` / `--music` / `--other` | 四个媒介维度色（电影/书籍/音乐/其他） |
| `--scrim` | 弹窗遮罩（rgba） |
| `--toast-bg` / `--toast-ink` | 提示条背景/文字 |

### 可选（常用）

| 变量 | 语义 |
|---|---|
| `--r-xs --r-sm --r-md --r-lg --r-pill` | 圆角代币（0 = 方角主题） |
| `--dur-1 --dur-2 --dur-3` | 动画时长（快/中/慢） |
| `--font-body --font-display --font-serif --font-mono` | 字体栈（**只能写系统字体名，不能 `url()`**） |
| `--ok --warn --danger --danger-2 --green --red --yellow --indigo --pink` | 语义色 |
| `--status-ok --status-warn --status-danger` | 状态点色 |
| `--surface-4 --surface-glow --shade-soft --shade-deep --glass --glass-2 --mask-opaque` | 表面/玻璃细节 |
| `--t-display --t-h1 --t-h2 --t-h3 --t-body --t-small --t-meta --t-micro` | 字号 |
| `--sp-1 … --sp-8` | 间距 |
| `--ls-mid --ls-wide` | 字距 |
| `--reader-dim --reader-poster-opacity` | 阅读弹窗 |

## 5. 配色可读性底线（强烈建议 agent 自查）

- `--text` 对 `--bg` ≥ 7:1；`--text-2` ≥ 4.5:1；`--muted` ≥ 3:1（小字辅助可接受）；
- `--accent-ink` 对 `--accent` ≥ 4.5:1（按钮文字在按钮底上）；
- 深色主题避免纯 `#000`/`#fff`；每个维度色对 `--bg` ≥ 3:1；
- 浅色主题**必须**重设 `--accent-ink`（黑底用的浅字色直接继承会看不见）。

## 6. 导入方式

应用内：顶栏「主题」按钮 → 菜单底部「导入主题包…」→ 粘贴 CSS 或选择 `.css` 文件 → 「校验并导入」。
校验失败会给出具体原因（缺哪个变量、哪个值非法）。导入成功即自动应用；菜单里自定义主题可随时删除
（删除后若正在使用会自动回退 modern）。刷新后仍然生效（存 localStorage）。

## 7. 给 AI agent 的生成指令模板

> 请为 ART/RANK 生成一个主题包。要求：
> 1. 输出一段 CSS，第一行是 `/*! art-rank-theme {"id":"<小写id>","name":{"zh":"<中文名>","en":"<English Name>"},"dot":["<bg色>","<强调色>"]} */`；
> 2. 紧随其后是 `[data-theme="<id>"]{ ... }` 块，**必须包含**全部 21 个必需变量（见 §3），只能使用 §4 列出的变量名；
> 3. 值里不要出现 `;{}@<>` 与 `url(`；字体栈只写系统字体名；
> 4. 风格要求：<在此描述，例如“深海军蓝底 + 琥珀强调，冷静专业”>；
> 5. 输出前自查 §5 的对比度底线。

生成结果粘贴到「导入主题包…」即可；不合规会被精确报错，按报错修正即可。

## 8. 边界（诚实声明）

- 变量包只能换**颜色 / 字体 / 圆角 / 时长 / 间距 / 字号**——像「复古纸感」的纸纹噪点、
  「纸上擂台」的撕线印章这类**结构性差异**不在变量包表达能力内（它们是内置结构主题）；
- 自定义主题不自动关闭玻璃 backdrop（变量层面无法表达）；如需方角/无玻璃，
  使用 `--r-*` 圆角代币即可获得 90% 的观感。
