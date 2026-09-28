# ROLES — 角色分工与最小上下文包

> 多 agent 并行时按角色切分。**每个角色只需要读自己的「最小上下文包」**，不要读别人的。
> 角色之间靠 `TASK-LEDGER.md` 协调；文件边界冲突的仲裁规则见 `HANDOFF.md` §4。

---

## 通用（所有角色必读，2 个文件）

1. `AGENTS.md` —— 入口、门禁、硬规则
2. 自己在 `docs/agents/TASK-LEDGER.md` 里的条目

---

## R1 · 前端交互 Agent

**负责**：`src/views/**`、`src/components/**`、`src/App.tsx`、`src/lib/use*`

**最小上下文**：
- `docs/agents/MAP.md` §2.2
- `src/lib/useRouter.ts` + 你要改的那个 `src/views/*.tsx`
- `docs/agents/CONVENTIONS.md` §2（React Hook 约定）

**必守**：大视图 `React.lazy`；手势/判定抽纯函数；拖动走 ref 不进 state；Hook 依赖数组完整。

**不要碰**：`src/styles.css` 的 token 定义（那是 R2 的地盘）；`worker/**`。

---

## R2 · 视觉 / 主题 Agent

**负责**：`src/styles.css`、`src/lib/theme*.ts`、`src/lib/layout.ts`、`src/lib/orbEffects/**`、`scripts/ui-*.mjs`

**最小上下文**：
- `docs/agents/MAP.md` §2.3
- `docs/agents/PITFALLS.md` §4（视觉类 17 条）
- `docs/memory/EPISODES.md` E-20260922（完整战役复盘）
- `docs/THEME-PACKS.md` / `docs/ORB-EFFECTS.md`（改扩展点时）

**必守**：新色必须 token 化；批量归一化用 `ui-normalize.mjs`（dry-run 优先）；对比度用工具判；改前后跑截图比对；**构建期间禁止截图**。

**与其他角色的边界**：改结构（DOM/类名）会影响 R1，改前在台账里声明。

---

## R3 · Worker / API Agent

**负责**：`worker/**`（路由与业务模块）、`docs/API.md`

**最小上下文**：
- `docs/agents/MAP.md` §2.4（+ 若涉及外部平台则 §2.6）
- `worker/index.ts` 的路由链（约 1822 行起）+ 目标模块
- `docs/agents/CONVENTIONS.md` §3
- `docs/agents/PITFALLS.md` §1（平台类）+ §2（网络类）

**必守**：`fetchBounded` 出站；`payloadGuard` 校验；`rateWindow` 限流；错误可区分；凭据不落盘；`undefined` 转 `null`。

**不要碰**：前端视图；数据库 migration（那是 R4）。

---

## R4 · 数据 / Migration Agent

**负责**：`migrations/**`、`shared/**`、D1 查询与写入路径

**最小上下文**：
- `docs/agents/MAP.md` §2.5
- `docs/ARCHITECTURE.md` 的 Schema 节
- `docs/agents/PITFALLS.md` §3（数据类 10 条）
- `shared/storedItem.ts`（落库白名单唯一出口）

**必守**：迁移**幂等可重复应用**；字段白名单只改 `shared/storedItem.ts`；单行 512KB 约束；读侧永不删数据。

**串行要求**：migration 严格串行，禁止跳号。

---

## R5 · 测试 / 契约 Agent

**负责**：`*.test.ts`、`scripts/**`、安全与形状契约

**最小上下文**：
- `docs/agents/CONVENTIONS.md` §4
- 目标模块的源码 + 就近的 `.test.ts`
- `vitest.config.ts`

**必守**：契约类测试优先（出站安全、payload 形状、写入完整性）；纯函数优先；外部依赖 mock fetch；视觉回归走截图工具而非单测。

**特权**：可以为任何角色补 tripwire 断言（锁死已修缺陷防复发）。

---

## 角色 × 文档 速查矩阵

| | `MAP.md` | `PITFALLS.md` | `CONVENTIONS.md` | `EPISODES.md` | `DECISIONS.md` |
|---|---|---|---|---|---|
| R1 前端 | §2.2 | §4（流程+交互） | §2 | — | 按需检索 |
| R2 视觉 | §2.3 | **§4 全读** | §6 | **E-20260922** | 按需检索 |
| R3 Worker | §2.4 + §2.6 | **§1 + §2** | §3 | E-20260916 / E-20260913 | 按需检索 |
| R4 数据 | §2.5 | **§3** | §3（Worker 部分） | — | 按需检索 |
| R5 测试 | §2.10 | §5（排查顺序） | §4 | 按需 | 按需检索 |

---

## 何时需要新增角色

若一个任务同时跨 ≥3 个角色，说明任务太大 —— 先按 `HANDOFF.md` §6 的**串行接力**拆成多段（结构 → 逻辑 → 测试 → 文档），每段只落在一个角色里。
