# CONVENTIONS — 编码 / 提交 / 测试 / 文档约定

> 这些约定大多来自 git 历史中的**真实教训**，不是凭空定的风格偏好。违反过的都在括号里标了来源。
> 工具链配置：`eslint.config.js` / `.prettierrc.json` / `vitest.config.ts` / `tsconfig.*.json`。

---

## 1. 工具链事实

| 项 | 值 |
|----|----|
| Node | **22**（`.nvmrc` = 22，`package.json` engines `>=22`，CI 用 22） |
| 格式化 | Prettier：`printWidth 100` / 双引号 / 分号 / `trailingComma: all`（JSON 类为 `none`） |
| Lint | 只开两类规则：`react-hooks/recommended`（error）+ `@typescript-eslint/no-unused-vars`（warn，`_`/`caughtErrors` 豁免） |
| 类型检查 | `tsc -b`（三份 tsconfig：app / worker / node） |
| 测试 | Vitest，`environment: node`，匹配 `src/**`、`worker/**`、`shared/**` 下的 `*.test.ts` |
| 门禁顺序 | `check` → `lint` → `format:check` → `test -- --run` → `build`（CI 与本地一致） |

**ESLint 只开两类的原因**（写在 `eslint.config.js` 注释里）：一次性全仓开火会产生成百上千条告警，把真正的信号淹掉。后续**按目录逐步收紧**，不要一次性放开。

---

## 2. 前端约定

- **React 19 + Hooks**。历史上有过两处 Hook 违规（`604d331` 修复：`useMemo` 写在 map 回调里等），以及一次 Hook 提取引入的三处回归（`f62affa`：草稿无限写循环 / 自动同步无限 PUT / 登出保存竞态）——**这三处本来都能被 `react-hooks/recommended` 拦下**，所以该规则是 error 级。
- **大视图必须懒加载**：`SourceView` / `ProfileView` / `CompareView` / `ShareView` / `PlazaPostView` 用 `React.lazy` + `Suspense`（对齐 `DeferredOrb` 模式）。新增大视图照此办理。
- **全局状态集中在 `src/App.tsx`**，但已被 `useAuth` / `useSorting` / `useRouter` 分流；改状态前先确认归属，不要往 `App.tsx` 里堆新逻辑。
- **Three.js 光球不在关键路径**：首屏用 `DeferredOrb`，不要把它拉回同步渲染。
- **手势 / 判定逻辑抽成纯函数**（`src/lib/swipe.ts` 的 `decideSwipe`），便于单测；DOM 事件层只做转发。
- **拖动类交互直接写 `transform`（走 ref）**，不要进 React state，避免每帧重渲染。

---

## 3. Worker 约定

- **`worker/index.ts` 只做路由与编排**，业务逻辑放独立模块。路由表是一条 `if (url.pathname === ...)` 链（约 1822 行起），新增分支时保持风格一致。
- **请求体校验走 `worker/payloadGuard.ts`**，不要手写 `if (body.xxx)`。
- **限流走 `worker/rateWindow.ts`**（Map 有上界 + 惰性清扫，见 `9f36ae9`）。
- **所有对外 fetch 走 `worker/outbound.ts` 的 `fetchBounded`**：精确 host 白名单 + `redirect: 'manual'` 逐跳复核 + 响应字节上限。
- **错误要可区分**，不要统一吞成「失败」：网络失败 ≠ 上游限流 ≠ 上游风控返空 ≠ 参数错误。（`7f9550d` / `98430e7` 的教训：把 gdApi 网络失败当成预算耗尽，导致音乐服务假死。）
- **生产环境缺配置必须 fail-closed**，不允许静默降级到开发兜底（邮件是典型例子）。
- **用户凭据**（AI key、Jev key、第三方 Cookie）**不落盘**：key 只透传，Cookie 走 AES-GCM 加密的保险库。
- **`D1` bind 不接受 `undefined`**：可选字段统一转 `null`（`a1070fa`）。

---

## 4. 测试约定

- **就近放置**：`src/lib/ranking.test.ts` 与 `ranking.ts` 同目录。
- **契约优先**：安全与形状契约用单测锁死 —— `worker/outbound.test.ts`（出站）、`plazaPayload.test.ts`、`plazaIntegrity.test.ts`、`payloadGuard`、`typesafe.test.ts`（前后端各一份）、`mailer.test.ts`、`verification.test.ts`。
- **纯函数优先**：能抽成纯函数的判定就抽出来单测（swipe、og 注入、similarity、jev 解析都是这么做的）。
- **mock fetch** 用于外部依赖（参照 `worker/ai.test.ts`）。
- **视觉回归不是单测**：走 `scripts/ui-*.mjs` 的截图比对，见 §6。

---

## 5. 文档同步约定（改代码就要改文档）

| 改了什么 | 必须同步 |
|----------|----------|
| Worker 接口（增/改/删） | `docs/API.md` |
| 功能行为 | `README.md` + `docs/FEATURES.md`（功能回归基线）+ `docs/USAGE.md` + `CHANGELOG.md` |
| 架构 / 模块 / 表结构 | `docs/ARCHITECTURE.md` |
| 部署 / 环境变量 | `docs/CLOUDFLARE.md` |
| 主题 / 光球扩展点 | `docs/THEME-PACKS.md` / `docs/ORB-EFFECTS.md` |
| 非显然的设计取舍 | `docs/memory/DECISIONS.md` **顶部新增**（旧条目不删，标"已推翻"） |
| 踩到新坑 | `docs/agents/PITFALLS.md` 补充 |
| 阶段性完成 | `docs/agents/TASK-LEDGER.md` 更新状态 |

**过时文档的处理**：移入 `docs/archive/` 并加「已过时」横幅，**不直接删除**（`589ff2f` 的做法）。

**文档必须对着代码校订**：2026-09-18 专门有过一次全量校订提交（`68bc9e6`），因为文档漂移是常态。写文档时不要凭记忆，去读代码。

---

## 6. 视觉改动流程（改样式必读）

1. **先确认是否已 token 化**：`src/styles.css` 已全面令牌化（545 var / 194 color-mix）。新颜色必须提升为 token，**不要写裸 hex**。
2. **遵循既有档位**：圆角 5 档 / 间距 8px 阶梯（±6px 容差）/ 字号 ±1px 归档 / 阴影 2 级 / 玻璃两级制。
3. **大批量归一化用工具**：`scripts/ui-normalize.mjs`（**dry-run 优先**、幂等），不要手工改。
4. **对比度用工具判**：`scripts/ui-contrast.mjs` + `docs/ui-contrast.json`，目标 WCAG AA（`--text-3` 定案 78%）。
5. **改前后各跑一轮截图**：`scripts/ui-shot.mjs` → `scripts/ui-diff.mjs` 比对 `docs/ui-baseline.json`。
6. **⚠️ 构建期间禁止截图**：`dist` 重建会让 ENOENT 杀死整轮 capture（一次报废 204/270 张）。
7. **每修一个缺陷加一条 tripwire 断言**，锁死防止复发（历史累计 26 条 tripwire / 303 项断言）。

---

## 7. 提交约定

- **Conventional Commits + 中文描述**：`feat(scope): ...` / `fix(scope): ...` / `docs: ...` / `chore: ...` / `style: ...` / `refactor: ...` / `perf: ...` / `test: ...` / `ci: ...`。
- **同一提交可并列类型**：`feat(x): ... ; fix(y): ...`（历史常见写法）。
- **多线并行时把进度写进 message**：如「广场优化步骤 3」「导入体系④」「看板增强步骤 2」—— 让 `git log` 本身成为进度看板。
- **一个 Phase 一个提交**：优化冲刺的做法是每 Phase 独立提交 → 推送 → 自动部署 → 线上验证 → 再进下一个。
- **历史格式不统一**（`fix:` 与 `fix` 并存），**新提交统一带冒号**。
- **不要提交临时文件**：历史上有多次「移除误提交的临时文件」（`fa58e12`、`b62dd7e`、`7a479d6`、`a448a0f`）。临时产物先加 `.gitignore`。

---

## 8. 发布节奏（铁律）

```
本地改动 → 五道门禁全绿 → 提交 → 推送
  → Cloudflare 自动部署
  → 到 https://sort.logicc.top 线上实机验证
  → 验证通过才标 ✅
```

**未到线上验证不标 ✅。** 这是本项目最重要的一条纪律——无数次「本地是好的」在线上翻车（PBKDF2 就是最典型的例子）。

部署命令：`npm run deploy`（= build + `wrangler d1 migrations apply film-sort --remote` + `wrangler deploy`）。
