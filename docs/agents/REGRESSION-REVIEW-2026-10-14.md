# 回归复核 · 2026-10-14 全量审查清账 T-01～T-10

> 范围：`git log --since=7.days` 共 18 commits（9 条代码 + 9 条 `docs(ledger)`），全部落在 2026-10-14 单日合并上线。
> 结论：**存在 1 个 P0（数据丢失）+ 2 个 P1（行为退化），必须在下一批前修**；其余为 P2 遗留。
> 基线门禁：`npm run gates` 5/5 全绿（tsc ✅ / eslint 0 problems / prettier ✅ / vitest 749 passed + 9 skipped / build ✅）。**门禁全绿不覆盖下列任何一条**——它们都是测试断言不到的分支。

> **修复状态**：P0、P1-1、P1-2、P2-2 已在本批次修完（详见文末「六、本次修复记录」），复跑门禁 `751 passed / 9 skipped` 5/5 全绿；**2026-10-17 已线上实机验证 P0 / P1-1 / P2-2 查询路径**（详见「七、线上验证记录」）。其余 P2 仍为遗留。

---

## 一、P0（必须修）✅ 已修：草稿防抖在「离开 sorting」时被丢弃而非落盘

**位置**：`src/lib/useSorting.ts:866-877`，关键行 **870**（提交 `aeaa038` / T-04）。

`useEffect` 的守卫条件把两条分支写反了：

```ts
if (view !== "sorting" || !ranking || !collection || ranking.completed) {
  if (view !== "sorting" || !ranking || ranking.completed) pendingDraft.current = null; // 行 870：直接丢弃
  else flushPendingDraft();                                                          // 行 871：不可达
  ...clearTimeout...
  return;
}
```

行 871 的 else 要求 `view === "sorting" && ranking && !collection`，与外层 if 的条件互斥，**永不可达**。所以 commit message 里承诺的「切页 flush」从来没有发生：用户做完美后 500ms 内点导航/返回，挂起的那次取舍既不写 localStorage 也不 `setDraft`，而 `resume()` 读的正是 `draft` state。

同一 effect 的 cleanup（行 884-889）只 `clearTimeout` 不 flush → 组件卸载同样丢一次。

**实际修法**（`0efaaf3`）：同一 effect 改成三分支互斥判断 —— ①`!ranking || !collection || ranking.completed` → 丢弃 pendingDraft + clearTimer；②`view !== "sorting"` → **同步** `flushPendingDraft()`；③否则挂起 pendingDraft + 500ms 定时器。cleanup **只** clearTimer 不动 pendingDraft：依赖每次取舍都会重跑，在 cleanup 里 flush 等于取消防抖本身。`pagehide` 兜底改为复用 `flushPendingDraft()`（既写盘也 `setDraft`，顺带修 bfcache 返回后草稿陈旧的 P2-7）。

---

## 二、P1

### P1-1 ✅ 已修 导出海报超时被并发池放大成分钟级卡死

**位置**：`src/lib/exportPng.ts:224-233`（提交 `d38ee84` / T-08）。

`mapPool` 限并发后，「远端图全挂」的最坏耗时从改动前约 10s 变成数分钟：

- 解析池 limit=6，80 件、每请求 `AbortSignal.timeout(15000)` ⇒ 最坏 `ceil(80/6)×15s ≈ 210s`；
- 解码池 limit=12，而 `resolvePosterUrls` 每件最多返回 4 个候选（`src/lib/exportPng.ts:214` `slice(0, 4)`）⇒ 最多约 320 张图、每张 `loadImage` 10s 超时 ⇒ 最坏 `ceil(320/12)×10s ≈ 270s` 卡在 busy。

改动前是 `Promise.all` 全开，总超时约 10s。触发条件就是本机已记录的「连接黑洞」故障模式（CHANGELOG 2026-10-05 F1 同族）。**限并发本身是对的**（避免瞬时打爆），错在没有整体 deadline。

**修法**：给整个导出流程加总 deadline，或单图超时降到 3–5s，或每件只解前 1–2 个候选。

### P1-2 ✅ 已修 出站超时不再覆盖 body 读取

**位置**：`worker/outbound.ts:118` 的 `finally clearTimeout`（`fetchBounded` 一返回 Response 就清），配合 `worker/media.ts:706`、`worker/media.ts:777`、`worker/media.ts:1464`。

改前 `signal: AbortSignal.timeout()` 会随 body 流继续生效，改后**超时只管到响应头**：维基 200 头已回、body 慢速或挂起时不再受调用方 7–9s 约束，只能等平台上限；批量 8 并发放大。

注意：`worker/outbound.ts` 最近一次改动是 `6e50a28`（不在七日窗口内），本提交 `05698f8` 把维基 4 站点全部改走这个出口，**放大了暴露面**而非引入了 bug。

**修法**：让 `readBounded*` 接收 signal 或独立超时，或把 `clearTimeout` 推迟到 body 读完。

---

## 三、P2（遗留，不阻塞上线）

| # | 位置 | 问题 |
|---|------|------|
| P2-1 | `worker/media.ts` 1457-1465 | probe 在读 body 之前就记 `ok`，随后 `body_too_large` 抛错却已记成成功，记账与事实不一致 |
| P2-2 ✅已修 | `migrations/0014_comment_replies.sql` | 该文件是 ADD COLUMN + CREATE INDEX **两条语句**，违反 `worker/migrations.test.ts:44-58` 宣称的「ADD COLUMN 文件必须单语句」不变量。ALTER 成功、INDEX 失败后重放整个文件 → duplicate column，`wrangler d1 migrations apply` 永久卡住。**本次只给 INDEX 加了守卫**，等于把不变量又破了一次 |
| P2-3 | `worker/other.ts:83-97` | `wikipediaPolicy` 白名单只有 zh/en 主机、maxRedirects=2。若维基跳到 `zh.m.wikipedia.org` / `api.wikimedia.org`，`fetchBounded` 抛 `disallowed_host`，`queryWikiImages`/`wikiJson` 的 catch **静默返回空**，该维度全站取图变空，只在图消失时暴露 |
| P2-4 | `src/components/FocusTrap.tsx:54-62` | 弹窗关闭不恢复焦点（无 `previouslyFocused.focus()`），键盘/读屏用户关闭后焦点落回 body —— 12 处弹窗全中 |
| P2-5 | `src/components/FocusTrap.tsx:25-51` | 监听挂 document 且不判「是否最上层弹窗」，两个 trap 同时挂载会互抢焦点。当前尚不可达，接入面扩大后风险累积 |
| P2-6 | `src/lib/useRouter.ts:100-108` | `main.focus()` 在首挂载和任意换页都抢焦；弹窗开着时换路由会把焦点从弹窗夺走 |
| P2-7 | `src/lib/useSorting.ts:892-915` | `pagehide` 只写 localStorage 不 `setDraft`，bfcache 返回后内存 draft 仍少最后几次取舍，而 `resume()` 读的是 draft state |
| P2-8 | `src/lib/useSorting.ts:748-749` | 50 份快照仍是 `serializeRankingState` 全量序列化，N≈1000 时仍可能数十 MB |
| P2-9 | `src/views/SetupView.tsx:7-35` | 自带一份 `RANK_MODES` 字面量，与 `src/lib/ranking.ts:11` 的 `RANKING_MODES` 构成双份真相源；后续加模式会漏 |
| P2-10 | `src/App.tsx:1758-1762 / 2058-2062`、`src/views/SourceView.tsx:1351-1366` | 三处弹窗接了 FocusTrap 但仍缺 `aria-labelledby`（其余 9 处已补） |
| P2-11 | `src/styles.css`（`.theme-dot.theme-simple`，2026-10-24 时点约 L565） | 仍硬编码旧色 `#2f6fed`，而 `--accent` 已改 `#2b64d8` —— 主题选择器色点与实际主题色不一致（违反「散落 hex 归零」） |
| P2-12 | `migrations/0011/0019/0020/0023` + `0008` 重号 | `IF NOT EXISTS` 会掩盖 schema drift：同名但列不同的旧表被静默跳过且仍标记为已应用，缺列只在线上以 `no such column` 暴露；`0008_disabled_at.sql` 与 `0008_user_collections.sql` 前缀重复，部署顺序取决于 wrangler 排序，测试不查重号 |
| P2-13 | `worker/posterBatchStats.test.ts:132-146` | 两条「无共享状态」用例只 `toMatch` 正则字符串（`const results...= {}`），改名即误报，且挡不住换个名字的模块级状态 |

---

## 四、已核查、明确无回归的部分

- **门禁基线全绿**：`npm run gates` 5/5（tsc / eslint 0 problems / prettier / vitest 749 passed 9 skipped / build，index chunk 415.88KB、three 530.82KB）。
- `similarity.ts:42` 对方重复键只计首次，shared 不超过并集，**Jaccard ≤ 100%** 的修法正确；`ranking.ts` 仍是排序结果唯一产出方。
- `rankMode` 显式传参调用点齐全（`src/App.tsx:1297` → `src/views/SetupView.tsx:154` `startRanking(active.value)`），`src/views/types.ts:88` 签名一致；隐私模式回落 classic 的老行为保持；quick + topN=1 逻辑零改动。
- 快捷键防穿透覆盖 App 内全部 9 处弹窗状态（含 detailWork/guide/tech）并有 `target.closest([role=dialog])` 兜底；键位仅 a/1/←/d/2/→ 且 `view!=='sorting'` 不触发，无误吞全局快捷键。
- 撤销栈 50 截断方向正确：`>=50` 时 `shift()` 丢最旧再 push，保留最近 50 步；与防抖无交互错乱（undo 只改 ranking，防抖照常 flush 一次）。
- `tallyBatchOutcomes`（`worker/media.ts:1877-1889`）口径与旧逻辑等价（`outcome==="found"` ⇔ `urls.length>0`），无除零（`worker/index.ts:2200` 空 items 提前返回、`worker/index.ts:592` 占比有 total 守卫），无额外查询、性能无退化。
- 维基 4 站点确已收敛到同一出口，`worker/other.ts` 全文件零裸 fetch；redirect 逐跳复核与字节上限未被削弱；1MB 上限对现有 exintro/≤20 页查询绰绰有余。
- `IF NOT EXISTS` 本身不破坏已有 D1 schema 与部署顺序（已应用文件不会被重放）。
- d5d03b5 CSS：`--dur-stagger:60ms` 已在 `:root` 定义；`@media(prefers-reduced-motion:reduce)` 带 `!important`（`src/styles.css:41`），故其后的 home-rise 入场动画（`src/styles.css:56-59`）在 reduced-motion 下仍被清零。paper 主题 `--text-3/--muted` 只改 `[data-theme=paper]`，`src/themeRegistry.test.ts:18,33` 的 `paper-demo` 仍是 8B8175，门禁已验证无冲突。
- 9c25d3c：README 的 SW 缓存版本 `art-rank-v3` 与 `public/sw.js:1` 一致；`STATIC_ASSETS = ["/", "/index.html"]` 未含新图标，但图标走 cache-first 运行时缓存，无 404 风险。
- 20fd3de 巨量 diff 经 `git diff -w` 确认绝大部分是 prettier 换行/缩进，真实行为变更仅约 90 行；FocusTrap 监听有 `removeEventListener`，路由切换不泄漏；`role=status` 只在 toast/LazySpot/assist-marker，排序进度是 `role=progressbar` + `aria-valuetext`（非 live region），不会逐次点击刷屏。

---

## 五、建议的下一步（P0/P1 已完成）

1. ~~修 P0~~ ✅ 已修（见第六节）。**仍缺一条浏览器侧回归用例**：做取舍 → 立即切 view → `draft` 应含最后一次取舍（仓库无 jsdom/RTL，只能手测）。
2. ~~修两条 P1~~ ✅ 已修：导出加 25s 总预算；出站超时不再在返回 Response 时撤销（新增回归用例钉住）。
3. ~~0014 单语句不变量~~ ✅ 已修：索引拆到 `migrations/0027_comment_replies_index.sql`，并新增 `migrations.test.ts` 断言。
4. **上线前必做**：确认 `migrations/0027_comment_replies_index.sql` 已进版本库（新迁移必须幂等可重复应用）；线上实机验证导出超时降级与留言树两条路径。
5. 硬规则 2（C2）**未做完**：全仓仍有裸 fetch（2026-10-14 时点约 21 处：media 7、netease 4、douban 2、doubanlist 2、gdstudio 2、import 2、account 2；计数口径 `grep -rnE "(^|[^A-Za-z.])fetch\(" worker/*.ts | grep -v test`）；`outboundCoverage.test.ts` 只锁部分文件的计数，新增文件里的裸 fetch 完全不在绊线内。

---


---

## 六、本次修复记录（同一工作树，未提交）

| 项 | 改动 |
| --- | --- |
| P0 | `src/lib/useSorting.ts` 防抖 effect 重写：完成/清空 → 丢弃挂起项并清定时器；`view !== "sorting"` → **同步 flush**（原来两条分支条件互斥，flush 分支永不可达）；cleanup 只清定时器、不动 `pendingDraft`（依赖每次取舍都会重跑，若在 cleanup 里 flush 等于取消防抖）。`pagehide` 改为复用 `flushPendingDraft()`，bfcache 返回后内存 draft 不再陈旧 |
| P1-1 | `src/lib/exportPng.ts` 解析与解码两段共用 `POSTER_PHASE_BUDGET_MS = 25000` 总预算，`budgetOr(cap) = max(1, min(cap, 剩余预算))`；预算耗尽后不再发起解析请求，直接按缺图降级。最坏耗时从「并发数 × 超时」的 ~210s / ~270s 收敛到 25s |
| P1-2 | `worker/outbound.ts` 的 `finally` 改为 `if (!handedOff?.body) clearTimeout(timer)`：有 body 时定时器存活至 timeoutMs，让超时继续覆盖 `readBounded*`（恢复 `AbortSignal.timeout` 原生语义）；无 body（HEAD/204/304）与抛错路径仍立即清理。**未重建 Response，`response.url` / `redirected` 等属性不受影响** |
| P2-2 | `migrations/0014_comment_replies.sql` 退回单语句（只留 ADD COLUMN），`CREATE INDEX` 移到新迁移 `migrations/0027_comment_replies_index.sql`（`IF NOT EXISTS`，幂等；已应用 0014 的环境不会被重放）；`worker/migrations.test.ts` 新增断言「ADD COLUMN 文件必须单语句」，0021 为唯一登记在案的例外 |
| 测试 | `worker/outbound.test.ts` 新增回归用例：响应头已回、body 永不出数时读 body 必须在 timeoutMs 内失败（钉住 P1-2）。`npm run gates` → **751 passed / 9 skipped，5/5 全绿** |

未修（仍为遗留 P2）：FocusTrap 不还原焦点 / 不判最上层、`useRouter` 换页抢焦、`SetupView` 双份 `RANK_MODES`、三处弹窗缺 `aria-labelledby`、50 份全量快照体积、`.theme-dot.theme-simple` 旧色、`media.ts` probe 记账时机、`IF NOT EXISTS` 掩盖 schema drift、`0008` 重号、`posterBatchStats.test.ts` 弱断言、全仓 21 处裸 fetch（硬规则 2 未做完）。

---

## 七、线上验证记录（2026-10-17，提交 `0efaaf3`～`0f0cace`）

浏览器实机 https://sort.logicc.top，仓库不带 jsdom/RTL，P0 只能手测——已手测并通过：

| 项 | 做法 | 结果 |
| --- | --- | --- |
| 部署一致性 | 首页引用的 `assets/index-_oHYYUO0.js` 与本地 `dist` 同名 | ✅ 推送后构建已生效，非旧包 |
| P0 切页 flush | 新海诚 9 件清单、简易模式做 4 次取舍后**立刻**点顶部「清单」离开，再点「继续上次进度」 | ✅ 显示 **4 次取舍**（改动前该次会被丢弃） |
| P0 pagehide 兜底 | 再做第 5 次取舍后直接整页刷新，再续 | ✅ 仍为 **5 次取舍** |
| P1-1 导出预算 | 部署产物 `assets/exportPng-BL8ttgqi.js` 内搜 `25e3` | ✅ 命中 1 次，总预算 25000 已上线 |
| P1-1 导出实跑 | Top 6 完成后导出 PNG（并用 CDP `Network.emulateNetworkConditions` 打 300s 延迟） | ✅ **4.8s** 出图，2400×1980，TOP1 海报在位，无 busy 卡死 |
| P2-2 评论查询 | `/api/plaza/posts?limit=20` → 4 条；逐条 `/api/plaza/posts/{id}/comments` | ✅ 全部 200，无 5xx（线上暂无评论数据，回复树渲染未能实测） |

未覆盖：远端 D1 里 `idx_plaza_comments_parent` 是否已由 0027 建上——本机 wrangler 与 `node_modules` 版本不匹配，`wrangler d1 execute DB --remote` 报 `Unknown argument: ...\wrangler-dist\cli.js`，需在有凭据的环境复查一次 `PRAGMA index_list('plaza_comments')`。

复核人：本次会话（全量审查清账批次）。相关台账见 [TASK-LEDGER.md](TASK-LEDGER.md)（T-20261014-01～10），当日提要见 [TIMELINE.md](../memory/TIMELINE.md)。
