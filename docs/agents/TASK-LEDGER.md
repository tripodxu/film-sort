# TASK-LEDGER — 任务台账（接力状态文件）

> **这是多 agent 协作的唯一活状态源。** 最新条目在最上面。
> 用法：接任务前先看顶部有没有在进行的条目（避免撞车）；开工时把自己的条目插到顶部；完成时更新状态并写明交接对象。
> 条目格式与交接四件套见 [`HANDOFF.md`](HANDOFF.md)。

**状态图例**：⬜ 未开始 ｜ 🔄 进行中 ｜ ⏸ 阻塞/缓行 ｜ 👀 待审 ｜ ✅ 完成（**必须线上验证过**）

---

## 进行中 / 最近

### T-20260928-02 · UI 现代化（多主题增量，PLAN-ui-modernization v3）
- **状态**：⏸ 缓行（P0 已提交 `1357b12`；用户指示只跑 P0，P1 草稿存 `stash@{0}`）｜ **负责人**：本 agent
- **任务类型**：§2.3（视觉/主题）+ §2.2（前端视图）
- **最小上下文**：`docs/PLAN-ui-modernization.md` + `src/styles.css` + `src/lib/theme.ts` + `docs/agents/CONVENTIONS.md` §6
- **改了什么**：（P0 ✅）`src/lib/useTheme.ts`（L3 条件渲染 + themeFamily）+ `src/lib/auraColor.ts`（海报取色，margin 守卫）+ `--ease-settle`/`--dur-stagger` 代币；各配单测（4+7 例）
- **为什么**：用户拍板三方向全做、增量多主题、不改老 UI、组件级差异；后指示只做 P0
- **验证状态**：单测 ✅（398 passed）｜ 五道门禁 ✅ ｜ 线上 ⬜（无视觉变化）
- **遗留风险**：`stash@{0}` 的 P1 草稿含 TEMP-DEBUG 描边（styles.css 末尾 lime/red 规则），恢复时**先删调试残留**；移动端 ed-stack 定位问题未解决（详见 .workbuddy/memory/2026-09-28.md）
- **下一步（给接手者）**：若重启 P1：`git stash pop` → 清调试残留 → 修移动端 ed-stack → 按矩阵 §2.1 验收

### T-20260928-01 · 文档体系重建（记忆 + 多 agent 协同文档）
- **状态**：✅ 完成 ｜ **负责人**：文档 agent
- **任务类型**：文档（不涉业务代码）
- **最小上下文**：`AGENTS.md` + 515 条 git log
- **改了什么**：新建 `AGENTS.md`、根 `MEMORY.md`、`docs/memory/{TIMELINE,DECISIONS,EPISODES}.md`、`docs/agents/{MAP,HANDOFF,CONVENTIONS,PITFALLS,ROLES,TASK-LEDGER}.md`；修改 `README.md` 增加分层导航与 Agent 索引
- **为什么**：单次会话可读上下文有限，39,600 行代码 + 515 条 commit 无法每次全量阅读；需要「任务 → 文件」路由让 agent 只读相关部分
- **验证状态**：单测 n/a ｜ 本地 n/a ｜ 线上 n/a（纯文档）
- **遗留风险**：文件行号会漂移，路由表以符号名/路由字符串为准；`docs/agents/MAP.md` 中的行数统计为 2026-09-28 快照
- **下一步（给接手者）**：首个使用新文档体系的 agent 请顺手补 `MAP.md`（若发现路由缺失）与 `PITFALLS.md`（若踩到新坑）

---

## 待办队列（按优先级）

### ⬜ 优化冲刺 Phase 6 · 相遇页「预测分歧」洞察（Jev）
- **任务类型**：§2.1（排序/比较）+ §2.7（AI）
- **最小上下文**：`src/views/CompareView.tsx` + `worker/typesafe.ts` + `docs/PLAN-OPTIMIZATION-SPRINT.md` Phase 6
- **要点**：复用 `/api/ai/jev-rank` 加 predict 模式；比较页新增「对方最出乎你意料的作品」—— 用我的榜单预测对方排名，与真实排名求偏差 Top3
- **依赖**：需用户配置 Jev key 才能端到端验证

### ⬜ 优化冲刺 Phase 7 · 文化年度报告（Wrapped）
- **任务类型**：§2.2 + §2.3
- **最小上下文**：`src/lib/exportPng.ts` + `src/lib/ranking.ts` + `src/views/ProfileView.tsx`
- **要点**：可导出 PNG 的年度年鉴卡：总取舍次数（decisionLog）、榜单/作品数、最纠结一对（回环数据）、媒介占比；印刷年鉴风格

### ⬜ 优化冲刺 Phase 8 · PWA 离线
- **任务类型**：§2.2 + §2.9
- **最小上下文**：`public/sw.js` + `public/manifest.json` + `docs/memory/PITFALLS` §1.7
- **要点**：app shell 缓存，主链路（清单→排序→画像）离线可用。**沿用 SW 导航缓存教训**：network-first 导航、cache-first 静态

### ⬜ Jev Phase 2 · 维基消歧改用 Choice
- **任务类型**：§2.6 + §2.7
- **最小上下文**：`worker/media.ts` + `worker/typesafe.ts` + `docs/ROADMAP.md` Phase 2 + `docs/memory/EPISODES.md` E-20260908
- **要点**：把手写打分（限定标题/类型声明/年份守卫）换成一条 Choice 问题；现有规则**保留为降级路径**；改动面较大，独立一批提交
- **⚠️ 警告**：不要继续堆启发式规则（十余次迭代已证明边际收益递减）

### ⬜ Jev Phase 3 · 广场内容护栏（Noul）
- **任务类型**：§2.7 + §2.4
- **最小上下文**：`worker/plaza.ts` + `worker/typesafe.ts` + `docs/ROADMAP.md` Phase 3
- **要点**：发布前同步检查（70ms 延迟预算）：Noul 判不当内容 + Choice 判灌水；失败必须放行或明确提示，**主链路不依赖**

### ⬜ P2 打磨待办池（2026-09-27 全量审查遗留）
- **最小上下文**：`docs/ROADMAP.md` 的 P2 待办池章节
- **要点**：逐条处理，每条独立提交 + 线上验证

---

## 已归档（近期完成，供回溯）

| 编号 | 任务 | 完成日 | commit |
|------|------|--------|--------|
| P5 | Jev 辅助模式（AI 代判，置信 ≥0.8） | 2026-09-28 | `50e46df` |
| P4 | 路由拆包（index 1072→964 KB） | 2026-09-28 | `82b5b2d` |
| P3 | 广场品味相似度徽章 | 2026-09-28 | `bcdaabb` |
| P2 | 分享/广场 OG 卡片 | 2026-09-28 | `dca3ab0` |
| P1 | 移动端滑动选择 | 2026-09-28 | `8017364` |
| — | Jev Phase 1（AI 快排） | 2026-09-27 | `50e46df` 前序 |
| — | UI 全站焕新「夜间档案馆」 | 2026-09-22 | 46 commits |
| — | P0/P1 安全加固 + 插件系统 | 2026-09-25 | 23 commits |

更早的历史见 [`docs/memory/TIMELINE.md`](../memory/TIMELINE.md)。

---

## 使用规则

1. **先登记再动手** —— 避免两人改同一文件。
2. **完成即更新** —— 状态、验证层次、遗留风险、交接对象，四件齐全才算交班。
3. **线上验证过才标 ✅** —— 只有单测/本地通过标 🔄。
4. **新条目插到「进行中 / 最近」顶部** —— 本文件最新在最上面。
5. **完成的条目下沉到「已归档」** —— 保持「进行中」区不超过 5 条。
