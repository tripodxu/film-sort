# AGENTS.md — 所有 Agent 的唯一入口

> **读这个文件就够了。** 不要通读仓库（39,600 行代码 / 515 条 commit），按下面的路由表取用你需要的那一两个文件。
> 本文件是「目录」，不是「百科」。细节都在 `docs/` 下，需要时才打开。

---

## 1. 项目一句话

**ART/RANK** —— 用连续的 1v1 取舍，把看过的电影、读过的书、听过的音乐排出 Top N，产出一份可保存、可导出、可分享、可比较的「艺术人格画像」。

- 前端：React 19 + TypeScript + Vite（`src/`）
- 后端：Cloudflare Workers + D1（`worker/`、`migrations/`），**全站零自建服务器**
- 线上：https://sort.logicc.top ｜ 仓库：`git@github.com:tripodxu/film-sort.git`（私有）

---

## 2. 开工前必做（按顺序，五道门禁）

```bash
npm ci                 # 首次
npm run check          # tsc -b，类型必须过
npm run lint           # eslint
npm run format:check   # prettier（不过就 npm run format）
npm test -- --run      # vitest
npm run build          # 构建
```

改完代码**五道全绿才算完成**。改视觉的额外规则见 `docs/agents/CONVENTIONS.md`。

---

## 3. 分层阅读路由（核心：不要全量阅读）

### L0 — 必读（所有任务，约 5 分钟）

| 文件 | 什么时候读 |
|------|-----------|
| 本文件 `AGENTS.md` | 任何时候开工前 |
| [`MEMORY.md`](MEMORY.md) | 需要项目背景 / 硬约束 / 当前进度时 |
| 你认领任务的**台账条目**（[`docs/agents/TASK-LEDGER.md`](docs/agents/TASK-LEDGER.md)） | 接力任务必读 |

### L1 — 按任务类型读（**只读对应的一行**）

| 你的任务是… | 读这个 | 然后看这些文件 |
|-------------|--------|----------------|
| 改排序/比较算法 | [`docs/agents/MAP.md`](docs/agents/MAP.md) §2.1 | `src/lib/ranking.ts`、`src/views/SortingView.tsx` |
| 改前端视图 / 交互 | `MAP.md` §2.2 | 对应 `src/views/*.tsx` + `src/styles.css` |
| 改视觉 / 主题 / 响应式 | `MAP.md` §2.3 + [`docs/agents/PITFALLS.md`](docs/agents/PITFALLS.md) §4 | `src/styles.css`、`src/lib/theme.ts`、`scripts/ui-*.mjs` |
| 改 Worker 接口 / 新增 API | `MAP.md` §2.4 | `worker/index.ts` 路由表 + 对应 `worker/*.ts` + [`docs/API.md`](docs/API.md) |
| 改数据库 / migration | `MAP.md` §2.5 | `migrations/00XX_*.sql` + [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) 的 Schema 节 |
| 接外部平台（豆瓣/网易云/维基/音乐） | `MAP.md` §2.6 + `PITFALLS.md` §2 | 对应 `worker/*.ts` + [`docs/DOUBAN_API.md`](docs/DOUBAN_API.md) |
| 接 AI（点评 / Jev / TypeSafe） | `MAP.md` §2.7 | `worker/ai.ts`、`worker/typesafe.ts`、`src/lib/aiInsight.ts`、[`docs/ROADMAP.md`](docs/ROADMAP.md) |
| 写测试 / 修测试 | [`docs/agents/CONVENTIONS.md`](docs/agents/CONVENTIONS.md) §4 | 就近 `*.test.ts` |
| 改文档 | `CONVENTIONS.md` §5 | `README.md` + `docs/` |
| 排查线上故障 | [`PITFALLS.md`](docs/agents/PITFALLS.md) §5 排查顺序 | 按排查顺序走 |
| 多 agent 接力 / 交接给别人 | [`docs/agents/HANDOFF.md`](docs/agents/HANDOFF.md) | 交接四件套 |

### L2 — 按需深读（确认需要才打开，别默认读）

`docs/ARCHITECTURE.md`（架构与 Schema）· `docs/API.md`（全部端点）· `docs/FEATURES.md`（功能回归基线）· `docs/USAGE.md`（用户视角）· `docs/CLOUDFLARE.md`（部署）· `docs/THEME-PACKS.md` · `docs/ORB-EFFECTS.md` · `docs/PLAN-*.md`（在办计划）· `docs/ROADMAP.md` · `CHANGELOG.md`

### L3 — 历史记忆（需要背景时才查，不要通读）

`docs/memory/TIMELINE.md`（按日倒序演化）· `docs/memory/DECISIONS.md`（关键决策与理由）· `docs/memory/EPISODES.md`（战役复盘 + 10 条通用教训）· `docs/archive/**`（已过时，只读不引用）

---

## 4. 八条硬规则（违反必返工）

1. **PBKDF2 迭代 ≤ 100,000** —— workerd 拒绝更高值，600k 会让注册/改密/重置全线崩溃。
2. **对外 fetch 必须走 `worker/outbound.ts` 的 `fetchBounded`** —— host 白名单 + 逐跳 redirect 复核 + 字节上限。
3. **图片来源只由 `worker/media.ts` 的 `allowedImage()` 判定** —— 改外部图源时同步 CSP 与图片代理白名单。
4. **海报 URL 绝不写进 `items`** —— 走 `poster_urls` 侧表；落库字段白名单唯一出口是 `shared/storedItem.ts`。
5. **用户 API Key（AI/Jev）只存浏览器 localStorage**，Worker 不落盘。
6. **管理后台动态内容渲染前必须 HTML 转义**（存储型 XSS）。
7. **异步写状态必须有代际/键控守卫** —— 迟到响应一律丢弃，绝不覆盖用户真实选择。
8. **读侧永不因校验失败删数据。**

完整清单与原因：[`MEMORY.md`](MEMORY.md) §3、[`docs/agents/PITFALLS.md`](docs/agents/PITFALLS.md)。

---

## 5. 交付前自检

- [ ] 五道门禁全绿（`check` / `lint` / `format:check` / `test` / `build`）
- [ ] 若改了 Worker 接口：同步 `docs/API.md`
- [ ] 若改了功能：同步 `README.md` + `docs/FEATURES.md` + `docs/USAGE.md` + `CHANGELOG.md`
- [ ] 若改了 Schema：新增 `migrations/00XX_*.sql`，且**幂等可重复应用**
- [ ] 若改了视觉：跑 `scripts/ui-shot.mjs` 对比基线（构建期间禁止截图）
- [ ] **到 sort.logicc.top 线上实机验证后才标 ✅**（未线上验证不标完成）
- [ ] 更新 `docs/agents/TASK-LEDGER.md` 中你的条目（状态 / 交接给谁 / 遗留风险）

---

## 6. 多 Agent 协作

- **认领任务**：在 `docs/agents/TASK-LEDGER.md` 登记，避免两人改同一文件。
- **角色分工与最小上下文**：[`docs/agents/ROLES.md`](docs/agents/ROLES.md)
- **接力交接协议**：[`docs/agents/HANDOFF.md`](docs/agents/HANDOFF.md)（交接四件套：改了什么 / 为什么 / 验证到哪一步 / 下一步）
- **编码与提交约定**：[`docs/agents/CONVENTIONS.md`](docs/agents/CONVENTIONS.md)

**接力铁律**：交接内容写在**仓库里的文件**（台账 / PR 描述 / commit message），不要只留在对话里——下一个 agent 看不到你的对话。
