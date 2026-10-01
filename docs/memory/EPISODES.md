# EPISODES — 战役复盘（可复用的作战经验，最新在最上面）

> **格式：最新记录在最上面。** 这里存的是「下一次遇到同类任务该怎么打」，不是流水账。
> 每个条目固定结构：**任务 / 打法 / 踩到的坑 / 可复用资产 / 结论**。
> 新 agent 接手同类任务前，**只读对应的这一节就够了**，不必重读 git 历史。

---

## E-20260923 · 邮件验证码体系与 secret 污染根因

**任务**：注册/改密切到邮件验证码通道，并保证 Cloudflare 上真能发信。
**打法**：双出口邮件（Resend 主 + luckycola 兜底，诊断信息带 provider 原文）；React Email 模板服务端 `renderToStaticMarkup`；验证码 60s 冷却 / 10min TTL / 5 次尝试 / SHA-256 存储 / 改密后吊销会话；migration 0023。
**踩到的坑**：
- **secret 绝不经 shell 管道传递** —— PS 管道 stdin 的 CR 污染让 5 个邮件 secret 全部变成 invalid-key（code_-14），经干净 Buffer 重设后才通。现象是「配置明明设了却鉴权失败」，极易误判为服务商问题。
- 验证码 submit 匹配不到行时 D1 attempts=0，所有失败一个样 —— 错误要按 code_not_requested / code_expired / code_locked / invalid_code 分开（带剩余次数），否则无法排查。
- 双运行时陷阱：esbuild classic JSX 需显式 `import React`；workerd 把 `react-dom/server` 解析到 Node build（要用 server.browser 入口）。
**可复用资产**：mailer v3 双出口 + provider 诊断、React Email 模板、验证码错误判别与输入归一化（邮箱小写 / code 去空白）。
**结论**：**外部凭证一律用干净途径写入，不借道管道**；失败原因必须细分到「为什么失败」，别让所有错误共用一个 internal_error。

## E-20260930 · 「其他」维度封面/详情错配修复（pageprops.page_image + 年份消歧）

**任务**：T-20260930-02。用户清单（动物森友会 2020 / Inside 2016 / Journey 2012）线上三类错配——动物森友会命中系列页配图大角鸮照片、Inside 命中消歧页（year=1999）、Journey 命中 2012 Dodge Journey 汽车。延续 T-07 / E-20260929 的遗留风险。
**打法**：先用真实 API 把三条候选链的返回逐条测清（pageimages / pageprops.page_image / images 文件列表 / opensearch / gsrsearch / 精确标题 redirect 行为），再据此重写选页与取图链，然后用 fetch 桩录像级 fixture 离线回归（DNS 污染导致线上复测做不了）。
**踩到的坑**：
- **pageimages 对非自由封面恒空**（政策性只索引自由图），而 `pageprops.page_image`（infobox 封面文件名）**非自由文件也有值** —— 之前整条链都建立在 pageimages 上，等于把游戏封面全漏了。
- **文件列表 `files[0]` 兜底必然错配**：无关配图按字母序排在前（大角鸮、拉斐尔《卡斯蒂廖内像》）；曾误判为命中 series/franchise 首页词的高频图，实测纯巧合 → 规则改为「infobox 封面 or 文件名关键词命中，否则 null」。
- **opensearch 有盲区**：zh("动物森友会") 只回 6 个简体错页、zh("Journey") 把乐团 EP 排前 → 换 gsrsearch 自评分。
- **`(video game)` 不是标题**：en `Journey (video game)` redirect 到乐团页，正确标题形如 `Journey (2012 video game)`。
- **年份是消歧最硬信号**：用户清单自带年份（「标题 - 品类 (年)」），给了年份就优先摘述命中年份的条目；`pageprops.disambiguation` 可机械剔除消歧页，不用正则猜「可以指」。
**可复用资产**：`resolveOtherCover` / `wikiFileThumbUrls` / `OTHER_TYPE_WORDS` / `wikiTitlePages`（`worker/other.ts`）、`wikiPagePoster` / `wikiIsDisambiguation`（`worker/media.ts`）、`worker/other.test.ts` 的 `installFetch` 路由桩。
**结论**：**维基取图先问「封面是自由文件吗」**——不是就走 pageprops.page_image；**选页先问「用户给了年份吗」**——给了就把年份当硬过滤；兜底链每加一段前先验证该段对目标品类实际返回什么。

## E-20260929 · 「其他」维度取图管线攻坚（维基）

**任务**：让「其他」维度（无豆瓣 / 网易云源）的封面从「上线以来就没有」到可用，且不能取错图。
**打法**：多段兜底链逐步补齐（otherDetail 简繁变体与百科词条图 → en-langlinks 二段 → 条目主图直取，含 en wiki 非自由封面），再把主图直取**重排到最前** —— 用最强信号替代不可靠打分。
**踩到的坑**：
- **维基标题变体（空格 / 全角冒号差异）不是重定向** —— 查不到 ≠ 不存在，按变体逐一查；条目名比较前先剥分隔符，否则全角冒号页名漏配。
- 兜底链补段前先看清旧段是否已废弃：`2d68678` 移除的百度百科调用与 `4a570ee` 新增的词条图兜底不是同一段。
**可复用资产**：`worker/other.ts` 的 `wikiPageImageAny` 标题变体查询、`computePosters` other 分支直走 `searchWikiPoster`。
**结论**：**没有类型词表的维度，不要依赖标题打分，改用条目自身的最强信号（主图）**；兜底链段序按可靠性排，不按实现顺序排。

## E-20260928 · 五项优化冲刺（滑动 / OG / 相似度 / 拆包 / AI 代判）

**任务**：一天内交付 5 个独立优化项，互不依赖。
**打法**：写成 `docs/PLAN-OPTIMIZATION-SPRINT.md` 的 8 个 Phase，**每个 Phase 独立提交 → 推送 → 自动部署 → 到 sort.logicc.top 线上验证 → 再进下一个**。状态标记 ⬜/🔄/✅/⏸ 全程可见。
**踩到的坑**：
- `setPointerCapture` 未守卫，非活跃 pointer 事件打断滑动链 → 加 `isActive` 判定。
- 默认画像名在 OG 标题里被拼接两次 → 组装 OG 时先判断是否已含前缀。
**可复用资产**：`src/lib/swipe.ts`（纯函数判定，可单测）、`worker/og.ts`（纯函数注入，可单测）、`src/lib/similarity.ts`、`React.lazy` 拆包模式（对齐 `DeferredOrb`）。
**结论**：**小步独立提交 + 每步线上验证**是本项目唯一可靠的推进节奏；Phase 之间解耦，随时可暂停回滚。

---

## E-20260922 · UI 全站焕新（46 commits，功能零变更）

**任务**：九视图 + 八界面 + 壳层视觉全量改造，同时不能坏功能。
**打法**：
1. 先建工具链（截图 / 比对 / 对比度扫描 / 字面量归一化），再动视觉。
2. 先 Token 化，再改观感 —— 顺序反了会返工。
3. 「北极星两屏」先做样板的 CSS，评审通过后再铺开（**结构性改动优先于表面打磨**）。
4. 每完成一组改动加「tripwire」回归断言（最终 26 条 tripwire / 303 项断言）锁死已修项。
5. 收尾产出：release checklist、回滚方案、债务清单、设备 QA 清单、B1 re-anchor 记录。

**踩到的坑（每一条都值得记住）**：
- **构建期间禁止截图**：`dist` 重建导致 ENOENT，一次杀掉 204/270 张截图 → 服务端 handler 必须包 try/catch。
- **单张截图异常会杀死整轮长跑**：warm 轮跑到 114 张崩了且堆栈被输出过滤吞掉 → 必须做 per-shot 异常守卫。
- **Chrome profile 并发锁竞争**导致 exit-21 交替出现 → `--profile` 命名空间隔离。
- **百分比差异会骗人**：bento grid 的 mode delta 只有 0.0014%，实际是 `display:block` 把 `grid-template-columns` 空化了 → 判定要用「构造边界 + 位移签名」，不能只看 pct。
- **PS 5.1 的 UTF8 BOM** 会让 manifest 解析失败 → 解析要 BOM 容忍。
- **CSS `overflow-x` 会隐式生成 `overflow-y`**，把下拉菜单裁掉（"点击设置什么都看不见"）。
- **`:last-child` 会误伤**：移动端隐藏第 4 个导航项时，匿名用户的「广场」因为是最后一个而被隐藏 → 改用 `:nth-child(4)`。
- **`:focus-visible` 改 border-radius** 会造成焦点态形变。
- **lint 假报错**：`.tmp` chrome profile 目录要加进 ignore，且**gate 习惯：永远检查 exit code**。

**可复用资产**：`scripts/ui-shot.mjs`、`ui-diff.mjs`、`ui-contrast.mjs`、`ui-audit.mjs`、`ui-normalize.mjs`、`ui-shots*.json`、`docs/ui-baseline.json`、`docs/ui-contrast.json`。
**结论**：视觉工程化 = **工具先行 + 基线冻结 + tripwire 锁死 + 构建期禁跑**。

---

## E-20260916 · 音乐试听 / 海报的「出口封禁」突围战

**任务**：音乐试听与海报在 Cloudflare 出口上全线失败。
**排查链**（每一步都是一次误判）：
1. 以为上游挂了 → 实测是 CF Worker 出口被封。
2. 换 gdstudio → 也被封。
3. 换网易云出口 → 也被封。
4. 最终 Deno Deploy（GCP 出口）可达 ✅。
5. 上线后仍全部失败 → **CSP `connect-src` 缺 Deno 域名，浏览器静默拦截**（表现为降级到失败的 Worker 端点）。

**踩到的坑**：
- **CSP 拦截在浏览器控制台之外是静默的**，现象与上游故障完全一致。改任何外部域必须同步：CSP、`allowedImage()` 白名单、图片代理白名单。
- **限流误报**：`gdApi` 网络失败被当作预算耗尽 → 移除保守预算计数器，改连续失败冷却，并区分错误类型。
- 豆瓣海报直连**必然 418** → 全部走代理。

**结论**：**跨平台抓取类功能的故障，先分清是"网络不通 / 被反爬 / 被 CSP 拦 / 被限流"哪一种**，四者的现象高度相似但解法完全不同。

---

## E-20260913 · 网易云导入链的分层降级

**任务**：网易云歌单导入恒空。
**根因链**：旧 `api/playlist/detail` 已要求登录（code 20001）→ 换 v6 detail + v3 song/detail 两步链 → CF 出口下 v6/v3 开放接口被匿名风控静默返回空 → 加 weapi 加密通道分层降级 → 单发可通但连发被限流 → 分片 100→300 + 退避重试 + 节流。

**结论**：**对风控型上游，要做"分层降级 + 分片 + 退避"三件套**，且每一步都要在真实出口（CF）上验证，本地能跑不代表线上能跑。

---

## E-20260908 · 维基消歧的十余次迭代

**任务**：给作品详情取准确的简介。
**迭代轨迹**：直接 titles → `generator=search` → `gsrwhat=title`（避免正文误命中）→ 两步搜索 → 加 media type hints → 类型词守卫 → 首句类型声明打分 → 限定标题（含年份，如「泰坦尼克号 (1997年电影)」）→ 消歧页硬拒 → `converttitles` 简繁转换 → 最终 `63393cb` 重构为三阶段。
**反复出现的失败**：龙猫（原名后缀污染）、活着（书→电影）、范特西（→美国偶像）、Joker（→法国市镇/物理学家）。

**结论**：**启发式消歧的边际收益递减很快** —— 这正是 ROADMAP 里 Jev Phase 2 想用一条 Choice 问题替换掉整套打分的原因。若接手此任务，直接看 Phase 2 方案，不要继续堆启发式规则。

---

## E-20260912 · 单日 58 commits 的四线并行

**任务**：一天内推进导入体系、广场、后台、安全审计四条主线。
**打法**：每条主线的 commit message 里带步骤编号（「广场优化步骤 3」「导入体系④」「看板增强步骤 2」），让 git log 本身就成为进度看板。
**结论**：**多线并行时，把进度写进 commit message**，事后回溯成本极低。

---

## E-20260909 · 广场从零到一 + 22 项优化路线图

**任务**：社区功能 + 系统性优化。
**打法**：先写 `OPTIMIZATION.md` 列出 7 大方向 22 项，每完成一项就提交一次 `docs:` 更新路线图状态（"标记 X 为已完成"）。
**结论**：**路线图作为活文档，与提交同步推进**；该文档现已归档到 `docs/archive/OPTIMIZATION.md`。

---

## 跨战役的通用教训（最高优先级，任何任务前都值得扫一遍）

1. **平台能力必须在目标运行时实测** —— PBKDF2 600k 在 workerd 上全线崩溃，Node 上完全正常。
2. **安全判定必须有唯一入口** —— 图片来源只看 `allowedImage()`，出站只看 `fetchBounded`，落库字段只看 `shared/storedItem.ts`。分散的判定无法审计。
3. **体积约束要在写入侧治理** —— D1 512KB 限制踩了三次，因为字段白名单分散；收敛到唯一出口后才根治。
4. **异步写状态必须有代际/键控守卫** —— 云同步覆盖、Jev 代判迟到响应，是同一类问题的两个实例。
5. **读侧永不删数据** —— 校验失败就删数据 = 静默数据丢失。
6. **静默失败要主动显形** —— CSP 拦截、上游风控返回空、swallowed stack，三者都会伪装成"功能坏了"。
7. **优化前先做事实核查** —— 直觉（qrcode 太重）常错，实测（五个千行视图）才准。
8. **文档必须对着代码校订** —— 2026-09-18 专门有过一次全量校订提交（`68bc9e6`），因为文档漂移是常态。
9. **未线上验证不标 ✅** —— 本项目铁律，`sort.logicc.top` 是最终裁判。
10. **Secrets 绝不借道 shell 管道** —— PS 管道 stdin 的 CR 污染让 5 个邮件 secret 全部 invalid-key，现象是「配置了却鉴权失败」，极难定位（E-20260923）。
