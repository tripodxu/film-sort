# 优化路线图

基于全量代码审查的优化建议，按优先级和实施顺序排列。

---

## 1. 架构优化

### 1.1 App.tsx 单体组件拆分

**现状**：`App.tsx` 约 700 行，包含 6 个视图、40+ 个 useState、所有业务逻辑和 JSX 渲染。

**目标结构**：

```
src/
├── App.tsx                    # 路由 + 全局状态 + 布局壳
├── views/
│   ├── HomeView.tsx           # 首页（光球 + 媒介选择 + 品味年轮）
│   ├── SourceView.tsx         # 清单来源选择（内置/自定义/豆瓣）
│   ├── SetupView.tsx          # 排序配置（Top N、候选筛选）
│   ├── SortingView.tsx        # 1v1 取舍界面
│   ├── ProfileView.tsx        # 文化索引（榜单列表 + 导出）
│   └── CompareView.tsx        # 相遇比较（指标 + 共同作品 + AI）
├── components/
│   ├── GuideModal.tsx         # 使用说明弹窗
│   ├── TechModal.tsx          # 技术说明弹窗
│   ├── AccountDialog.tsx      # 登录/同步/冲突弹窗
│   └── ...existing
└── hooks/
    ├── useProfile.ts          # 画像读写 + 云端同步 + 冲突处理
    └── useAccount.ts          # 认证状态（登录/注册/OAuth/登出）
```

**收益**：
- 每次只重新渲染当前视图组件，减少不必要的 re-render
- 代码可读性和可维护性显著提升
- 新开发者可以在单个文件中理解某个视图的完整逻辑

**风险**：
- 需要仔细处理跨视图共享状态（profile、peer、locale 等）
- 弹窗组件仍需访问全局状态，考虑 Context 或 prop drilling

### 1.2 状态管理精简

**现状**：40+ 个 `useState` 平铺在 App 组件顶层，部分状态仅在特定视图使用。

**建议**：

| 状态组 | 包含状态 | 优化方式 |
|--------|----------|----------|
| 排序状态 | `ranking`, `collection`, `selected`, `draft`, `topN`, `seed` | 组合为 `useReducer` 或独立 hook |
| 比较状态 | `compareMode`, `compareActiveKind`, `manualOwn*`, `compareSortBy`, `compareRankDetail`, `peerRankPickOpen` | 下沉到 CompareView |
| 账号状态 | `accountToken`, `accountEmail`, `accountNickname`, `authMode`, `authError`, `syncStatus`, `cloudConflict` | 组合为 `useAccount` hook |
| UI 状态 | `notice`, `busy`, `search`, `colCount`, `editingNickname`, `showGuide`, `showTech` | 大部分可下沉到子组件 |

---

## 2. 性能优化

### 2.1 Bundle 按需加载

**现状**：主包 353 KB（gzip 115 KB），Three.js 522 KB 已做 lazy load。QRCode 和 fflate 已完成动态 import。

| 优化项 | 当前大小 | 方案 | 预估收益 | 状态 |
|--------|----------|------|----------|------|
| QRCode 库 | ~15 KB gzipped | 仅在点击「分享」时 `import("qrcode")` | 首屏 -15 KB | ✅ 已完成 |
| fflate | ~8 KB gzipped | 仅在分享链接解析/生成时动态 import | 首屏 -8 KB | ✅ 已完成 |
| lucide-react | ~20 KB gzipped | 确认 tree-shaking 生效；未使用的图标不打包 | -5~10 KB |
| catalog.ts | ~20-50 KB | 电影目录数据改为动态 import 或从 API 加载 | 首屏 -20~50 KB |

**实施**：

```typescript
// QRCode 按需加载示例
const [qrModule, setQrModule] = useState<typeof import("qrcode") | null>(null);

async function generateQR(url: string) {
  if (!qrModule) {
    const mod = await import("qrcode");
    setQrModule(mod);
  }
  return qrModule.toDataURL(url, { width: 240, margin: 2 });
}
```

### 2.2 排序撤销性能

**现状**：`undoLastAction` 从头重放整个决策日志，时间复杂度 O(n)，300 作品的榜单撤销需要重放约 30 次比较。

**方案 A — 快照法**（推荐）：
- 每次决策后保存完整 `RankingState` 到数组
- 撤销时直接回退到上一个快照
- 内存开销：每个快照约 2-5 KB，300 作品约 150 KB

**方案 B — 增量 diff**：
- 每步只记录 `activeInsertion` 的 `low/high` 变化和 `rankedIds` 的变更
- 撤销时反向应用 diff
- 内存开销更低，但实现更复杂

### 2.3 海报加载优化

**现状**：每个 `Poster` 组件独立请求 `/api/posters`，`requests` Map 缓存在内存中，页面刷新后丢失。

**建议**：
- 将海报 URL 缓存到 `sessionStorage`，跨组件和页面刷新共享
- 或使用 IndexedDB 做持久化缓存（适合反复访问的场景）
- 批量预取：在榜单选择页预取当前页面所有海报的 URL

```typescript
// sessionStorage 缓存示例
const POSTER_CACHE_KEY = "art-rank:poster-cache";

function getCachedPosters(key: string): string[] | null {
  try {
    const cache = JSON.parse(sessionStorage.getItem(POSTER_CACHE_KEY) ?? "{}");
    return cache[key] ?? null;
  } catch { return null; }
}

function setCachedPosters(key: string, urls: string[]) {
  try {
    const cache = JSON.parse(sessionStorage.getItem(POSTER_CACHE_KEY) ?? "{}");
    cache[key] = urls;
    sessionStorage.setItem(POSTER_CACHE_KEY, JSON.stringify(cache));
  } catch { /* Ignore quota errors */ }
}
```

### 2.4 首屏渲染

**建议**：
- 首页 3D 光球（OrbScene）已做 lazy load，但 CSS 中 `.orb-scene-fallback` 的背景色应与光球初始帧一致，避免闪烁
- 考虑给首页加 `Suspense` fallback 的骨架屏

---

## 3. 后端优化

### 3.1 D1 查询合并

**现状**：`getDashboard` 函数发起 10 个独立 SQL 查询（`Promise.all`），每个查询一次 D1 round-trip。

**建议**：用 CTE 合并概览查询：

```sql
WITH overview AS (
  SELECT
    COUNT(CASE WHEN event_name = 'visit' THEN 1 END) AS total_visits,
    COUNT(CASE WHEN event_name = 'visit' AND created_at >= datetime('now', '-7 days') THEN 1 END) AS visits_7d,
    COUNT(CASE WHEN event_name = 'ranking_completed' THEN 1 END) AS total_completed,
    -- ...
  FROM analytics_events
),
daily AS (
  SELECT strftime('%Y-%m-%d', created_at) AS date,
    COUNT(CASE WHEN event_name = 'visit' THEN 1 END) AS visits,
    COUNT(CASE WHEN event_name = 'ranking_completed' THEN 1 END) AS completions
  FROM analytics_events
  WHERE created_at >= datetime('now', '-14 days')
  GROUP BY date ORDER BY date DESC LIMIT 14
)
SELECT * FROM overview;
```

可将 10 次 round-trip 减少到 3-4 次。

### 3.2 API 日志批量写入

**现状**：每次 API 调用都执行 `INSERT INTO api_logs`，高频场景下 D1 写入成为瓶颈。

**建议**：

```typescript
// 内存队列 + 定时 flush
const logQueue: Array<[string, string, number, number, string, string?]> = [];
let logFlushTimer: number | undefined;

function enqueueLog(path: string, method: string, status: number, duration: number, source: string, error?: string) {
  logQueue.push([path, method, status, duration, source, error]);
  if (logQueue.length >= 50) void flushLogs();
  else if (logFlushTimer === undefined) logFlushTimer = setTimeout(() => void flushLogs(), 5000);
}

async function flushLogs() {
  if (logFlushTimer !== undefined) { clearTimeout(logFlushTimer); logFlushTimer = undefined; }
  const batch = logQueue.splice(0);
  if (!batch.length || !env.DB) return;
  // D1 batch API 或逐条插入
}
```

### 3.3 缓存策略改进

| 资源 | 当前 | 建议 |
|------|------|------|
| Top250 索引 | Worker 内存 Map（15 分钟） | 改用 Cloudflare Cache API，跨实例共享 |
| 海报 URL | 无服务端缓存 | `/api/posters` 响应加 `Cache-Control: public, max-age=86400` |
| AI insights | 无缓存 | 基于 summary hash 缓存 1 小时（`Cache API`） |
| 图片代理 | Edge Cache 24h | 已合理，无需变更 |

### 3.4 数据库清理

**现状**：D1 无自动清理策略，`analytics_events` 和 `api_logs` 无限增长。

**建议**：添加 Cloudflare Cron Trigger：

```typescript
// worker/index.ts - scheduled handler
export default {
  async scheduled(event: ScheduledEvent, env: Env) {
    await env.DB.prepare("DELETE FROM analytics_events WHERE created_at < datetime('now', '-90 days')").run();
    await env.DB.prepare("DELETE FROM api_logs WHERE created_at < datetime('now', '-90 days')").run();
    await env.DB.prepare("DELETE FROM poster_errors WHERE created_at < datetime('now', '-180 days')").run();
  }
}
```

```jsonc
// wrangler.jsonc
{
  "triggers": {
    "crons": ["0 3 * * 0"]  // 每周日凌晨 3 点
  }
}
```

---

## 4. 安全加固

### 4.1 Token 存储

**现状**：`accountToken` 存储在 `localStorage`，XSS 攻击可窃取。

**建议**：
- 改用 `HttpOnly` + `Secure` + `SameSite=Strict` Cookie
- Worker 端在登录响应中设置 `Set-Cookie`，前端不再手动管理 token
- 需要修改前后端的认证流程

**短期方案**（不改 Cookie）：
- 缩短 token 有效期（30 天 → 7 天）
- 添加 token 刷新机制
- 限制 `localStorage` 访问权限（CSP `script-src` 更严格）

### 4.2 CSP 加固

**现状**：

```
img-src 'self' data: https:
```

允许加载任意外部图片，可能被利用加载恶意图片触发 SSRF。

**建议**：

```
img-src 'self' data: https://img*.doubanio.com https://m.media-amazon.com https://ia.media-imdb.com https://image.tmdb.org https://cdn.jsdelivr.net
```

### 4.3 输入验证

**现状**：`share()` 和 `shareSingleRanking()` 直接把 profile JSON 发送到后端，无前端 schema 校验。

**建议**：发送前调用 `parseProfile()` 校验，避免发送畸形数据：

```typescript
async function shareSingleRanking(ranking: RankingExport) {
  const singleProfile = { ... };
  try { parseProfile(singleProfile); } catch { setNotice("数据格式错误"); return; }
  // ... fetch
}
```

---

## 5. 代码质量

### 5.1 测试覆盖

**现状**：仅有 `content-intro.test.ts` 一个测试文件。

**优先覆盖**：

| 模块 | 测试内容 | 优先级 |
|------|----------|--------|
| `lib/ranking.ts` | 创建状态、选择、撤销、跳过、暂放、验证阶段、回环检测、序列化/反序列化 | P0 |
| `lib/profile.ts` | 画像解析、合并、重命名、删除、比较指标计算、维度合并 | P0 |
| `lib/collections.ts` | TXT/JSON 导入、去重、边界条件（空输入、超长标题、300+ 作品） | P1 |
| `components/Poster.tsx` | 海报 URL 解析、降级策略 | P2 |

**建议添加覆盖率检查到 CI**：

```json
// vitest.config.ts
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      thresholds: { lines: 60, functions: 60 }
    }
  }
})
```

### 5.2 TypeScript 严格化

```jsonc
// tsconfig.app.json 建议开启
{
  "compilerOptions": {
    "noUncheckedIndexedAccess": true,   // Map.get() 返回 T | undefined
    "exactOptionalPropertyTypes": true,  // 区分 undefined 和缺失
    "noPropertyAccessFromIndexSignature": true  // 强制用 obj["key"] 访问索引签名
  }
}
```

**注意**：开启 `noUncheckedIndexedAccess` 需要大量类型断言修复，建议逐步开启。

### 5.3 CSS 可维护性

**现状**：`styles.css` 单文件 38 行（每行 2000+ 字符的压缩格式），不可读、不可 diff。

**建议**：
- 开发时维护未压缩版本，构建时通过 Vite 插件压缩
- 或迁移到 CSS Modules（`styles.module.css`），与现有 class 名兼容
- 或引入 Tailwind CSS（与现有的 `glass-capsule` 等自定义 class 共存）

---

## 6. 用户体验

### 6.1 排序进度预估改进

**现状**：`estimateTotalComparisons` 用理论公式 `Σ⌈log₂(min(i, N)+1)⌉`，实际偏差较大（用户可能跳过/暂放）。

**建议**：基于滚动平均：

```typescript
// 用最近 10 次比较的实际耗时推算
const recentDurations = decisionLog.slice(-10);
const avgComparisonsPerItem = comparisonCount / processedCount;
const remaining = sourceIds.length - processedCount;
const estimatedRemaining = Math.round(remaining * avgComparisonsPerItem);
```

### 6.2 PWA 离线支持

**建议**：
- 使用 `vite-plugin-pwa` 添加 Service Worker
- 缓存静态资源（JS/CSS/字体/图标）
- 排序中断后可离线恢复草稿
- 添加「安装到主屏幕」提示

### 6.3 无障碍改进

| 问题 | 修复 |
|------|------|
| 排序卡片缺少 ARIA 角色 | `<div role="group" aria-label="选择更偏好的作品">` |
| 进度条缺少 ARIA 属性 | 已有 `role="progressbar"`，补充 `aria-valuenow` 动态更新 |
| 弹窗缺少焦点陷阱 | 使用 Radix Dialog 或手动实现焦点捕获 |
| 海报图片 alt 文本 | 当前使用 `"海报"`，改为具体作品名称 |
| 颜色对比度 | `--muted` (#a1a8a2) 在深色背景上对比度偏低，建议提高到 #b8c0b8 |

### 6.4 国际化完善

**现状**：使用 `t(zh, en)` 函数内联翻译，缺少系统性。

**建议**：
- 提取所有翻译文本到 `locales/zh.json` 和 `locales/en.json`
- 使用 `i18next` 或简单的翻译文件 + hook
- 便于未来添加更多语言

---

## 7. 部署与运维

### 7.1 CI/CD

建议添加 GitHub Actions：

```yaml
# .github/workflows/ci.yml
name: CI
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: 20 }
      - run: npm ci
      - run: npm run check
      - run: npm test -- --run
      - run: npm run build
```

### 7.2 监控

- `/api/health` 添加外部监控（UptimeRobot / Cloudflare Notifications）
- 豆瓣接口错误率告警（基于 `poster_errors` 表的增长速率）
- Worker CPU 时间和内存使用监控（Cloudflare Dashboard → Observability）

### 7.3 环境管理

**建议**：
- 预览环境使用独立 D1 数据库（避免污染生产数据）
- 环境变量通过 `wrangler secret` 管理，不写入代码
- 添加 `.dev.vars` 到 `.gitignore`（如果尚未添加）

---

## 实施优先级

| 优先级 | 项目 | 工作量 | 收益 |
|--------|------|--------|------|
| **P0** | App.tsx 视图拆分 | 2-3 天 | 可维护性、性能、协作 |
| **P0** | 排序/画像核心测试 | 1-2 天 | 防回归、信心 |
| **P1** | Bundle 按需加载 | 0.5 天 | 首屏加载速度 | ✅ |
| **P1** | D1 查询合并 + 日志批量写 | 0.5 天 | 后端性能 | ✅ |
| **P1** | CSP 加固 + Token 安全 | 0.5 天 | 安全性 | ✅ CSP 已加固 |
| **P1** | CI/CD 流水线 | 0.5 天 | 开发效率 |
| **P2** | 海报缓存优化 | 0.5 天 | 加载体验 | ✅ |
| **P2** | TypeScript 严格化 | 1 天 | 代码质量 |
| **P2** | 数据库自动清理 | 0.5 天 | 运维 |
| **P2** | 无障碍改进 | 1 天 | 可访问性 |
| **P3** | PWA 离线支持 | 1-2 天 | 用户体验 |
| **P3** | CSS 模块化 | 1-2 天 | 可维护性 |
| **P3** | 国际化系统化 | 1 天 | 多语言支持 |
| **P3** | 排序撤销性能优化 | 0.5 天 | 大榜单体验 |
