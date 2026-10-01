# PITFALLS — 踩坑档案

> **开工前扫一眼你所在分类的条目，能省掉大量调试时间。** 每条都来自真实事故。
> **发现新坑请补进来**（按分类追加到对应小节末尾），这是文档体系里最需要持续生长的一份。

---

## §1 平台类（Cloudflare Workers / workerd）

| # | 现象 | 根因 | 对策 |
|---|------|------|------|
| 1.1 | 注册 / 改密 / 重置密码**全线崩溃** | PBKDF2 600k 迭代 —— workerd（含 `nodejs_compat` 的 `node:crypto`）拒绝 >100k | 硬上限 **100,000**；哈希格式自带 iterations 便于将来上调 |
| 1.2 | 依赖在 Node 上正常、线上一挂 | 本地 Node ≠ workerd 运行时 | **平台能力必须在目标运行时实测**，不能按 Node.js 假设写代码 |
| 1.3 | `esbuild` classic JSX 报 React 未定义；`react-dom/server` 在 workerd 解析到 Node 构建 | 双运行时差异 | 显式 `import React`；用 `server.browser` entry（React Email 集成时的解法） |
| 1.4 | `D1` bind 不接受 `undefined` | D1 绑定类型限制 | 可选字段统一转 `null` |
| 1.5 | 邮件发送报 `code_-14` / `invalid-key` | **PS 管道 stdin 把 CR 混进 secret**，密钥被污染 | 密钥用干净的 Buffer 重新设置（5 个 secret 全部重设才解决） |
| 1.6 | 后台管理看板登录失效 | 内联脚本里的模板字符串转义错误 | 服务端渲染内联脚本时对模板字面量做转义；看板图表已自托管摆脱外部 CDN |
| 1.7 | 部署更新不生效 | Service Worker 导航缓存单键污染 | SW 只缓存 SPA 壳；导航请求 network-first |

---

## §2 网络类（外部平台 / 反爬 / CSP）

**⚠️ 四类故障现象高度相似（都表现为"功能全挂"），但解法完全不同。排查时先分清是哪一类：**

| 类别 | 现象 | 解法 |
|------|------|------|
| **网络不通** | 全部超时 / ECONNREFUSED | 换出口（CF 被封 → Deno Deploy 走 GCP 出口可达） |
| **被反爬** | 418 / 302 跳到安全页 | 走代理；改 UA / 节流 / 退避；豆瓣图片**必然 418**，一律走图片代理 |
| **被 CSP 拦** | **浏览器静默失败**，表现为降级到失败的 Worker 端点 | 同步 CSP `connect-src` / `img-src` —— 极易误判为上游故障 |
| **被限流 / 风控返空** | HTTP 200 但 body 为空 | 分层降级（开放接口 → weapi 加密通道）+ 分片 + 退避 |

具体事故：

- **2.1 音乐试听全链失败**：CF Worker 出口、gdstudio、网易云出口全部被封 → 最终走 Deno Deploy。上线后仍然全挂 → 是 CSP `connect-src` 缺 Deno 域名，**浏览器静默拦截**。
- **2.2 网易云歌单导入恒空**：旧 `api/playlist/detail` 已要求登录（code 20001）→ 换 v6 + v3 两步链 → CF 出口下又被匿名风控静默返空 → 加 weapi 加密通道 → 单发可通但连发被限流 → 分片 100→300 + 退避 + 节流。
- **2.3 限流误报**：`gdApi` 网络失败被当作预算耗尽 → 移除保守预算计数器，改**连续失败冷却**，并区分错误类型。
- **2.4 豆瓣改版**：mine 页 2026 版已无 `item-root`，豆列 `.doulist-item` 版式也变过 → 解析器要**兼容新旧版式**。
- **2.5 维基消歧**：龙猫（原名后缀污染）、活着（书→电影）、范特西（→美国偶像）、Joker（→市镇/物理学家）。启发式打分的边际收益递减很快 —— 若要动这块，直接看 `docs/ROADMAP.md` 的 Jev Phase 2，别再堆规则。
- **2.6 描述上游超时**：音乐详情曾 ~20s → 百度直连熔断 + 双路并行 + anysearch 提为首选传输 → ~4s。
- **2.7 维基标题变体不是重定向**：空格 / 全角冒号造成的标题差异，维基**不会**自动重定向 —— 查不到 ≠ 不存在，要按变体逐一查（`d3c5e4e`）；条目名比较前先剥分隔符，否则全角冒号页名漏配（`7334442`）；没有类型词表的维度（other）取图改用条目主图直取，不靠标题打分（`82d7581`）。
- **2.8 维基 `pageimages` 对非自由封面恒空**：游戏/动漫等商品化封面的 infobox 图是**非自由文件**，pageimages 默认只索引自由图 → 恒空。但 `prop=pageprops` 的 `page_image`（文件名）**非自由文件也有值**（实测 Inside(游戏)=INSIDE_Cover.jpg、風之旅人=Journey_PSN_Cover.png），再补一次 `imageinfo&iiurlwidth` 就出 URL —— 别信「拿不到封面」。
- **2.9 文件列表兜底必然错配**：文章 `images` 里第一个文件常是无关配图（动物森友会→大角鸮照片、蒙娜丽莎→拉斐尔《卡斯蒂廖内像》）。曾误判为命中 series/franchise 首页词的高频图，实测只是**文件名字母序巧合**。规则：要么 `pageprops.page_image`，要么文件名关键词命中，**不许 files[0] 兜底**（无命中就返回 null）。
- **2.10 opensearch 有盲区 + `(video game)` 不是标题**：zh opensearch("动物森友会") 只回 6 个简体错页、opensearch("Journey") 把乐团 EP 排在游戏页前 → 用 `generator=search`（gsrsearch）+ `prop=pageprops` 自行评分。另外 en 标题形如 `Journey (video game)` 是 **redirect 到乐团页**，正确标题形如 `Journey (2012 video game)`，拼 `(${hint})` 与 `(${year} ${hint})` 两种都试。年份（用户清单「标题 - 品类 (年)」）是消歧最硬信号，给年份就优先摘述命中年份的条目。
- **2.11 `pageprops.disambiguation` 是机械消歧标记**：正常作品页无此 key，消歧页有 → 直接剔除，不要用 `/(可以指|可指|消歧義)/` 猜 extract。
- **2.12 Node `fetch` 不吃环境变量代理**：vitest 里 `fetch` 绕过系统代理（DNS 污染时全超时），DNS 污染的域名（如 wikipedia）连 `Resolve-DnsName` 都返回假 IP —— 探测用 pwsh `Invoke-WebRequest`（走 .NET 代理栈）或桩掉 fetch 跑录像级 fixture，别在 vitest 里做外网探测。
- **2.13 zh 维基繁简失配让标题评分整条失效**：条目名是繁体（動物森友會 / 薩爾達傳說 王國之淚）、用户输入简体，`compactTitle`/`wikiKey` 只去标点+lowercase 不做简繁归一 →「页标题含用户词」这条最强消歧信号**永不亮**，作品页与角色页/系列页同分，谁排前全看 gsrsearch 排序抖动（线上同一请求两次不同结果）。对策：标题比较前先过繁简表（`toSimplified()`）；`variant=zh-cn` 能把 extract 转简体但**标题仍是繁体**，别指望它。
- **2.14 多轮检索不许「本轮有图就短路下一轮」**：正确条目常常只在类型词轮出现（风旅人只在 `gsrsearch=Journey 电子游戏` 命中，纯标题轮首位是带图的《西遊記》），一旦 `if (hasImage) break;` 就永远选不到它。同页去重可以，**跳轮不行**。
- **2.15 年份信号别用 extract 首个 4 位年份**：2020 正作《集合啦！動物森友會》摘要首年是 **2018 公布年**，角色页「傑克 (動物森友會)」首年是 2020（首次登场）→ 用「摘要首年 == 用户年份」会把角色页顶成冠军。对策：比「**条目名**自带年份 vs 用户年份」（≠ 则 −4；西遊記 (無綫1996年電視劇) 这类同名异作一压一个准）；正则用 `/(?:1[5-9]|20)\d{2}/`，**别加 `\b`**——中文旁汉字时 `\b` 永不成立。
- **2.16 封面链与详情链必须同源**：同一作品详情对、封面错（蒙娜丽莎→Stray 游戏封面、塞尔达→林克 E3 照片），根因是封面走「评分择优」、详情走「精确标题直查」，两套选页逻辑精度不同。对策：封面第一档直接调 `otherDetail(title, year)`，同页同图；评分择优链退为兜底。
- **2.17 修好解析器但线上效果不变 → 先查 D1 记号里有没有代次**：`poster_urls` 行无 TTL，且 batch/单条 route 对「已存在的 key」直接复用不再解析（`saveResolvedPosters` 虽是 UPSERT，但调用点过滤 `!known?.get(key)?.length`），历史错图行永久短路新代码（运维教训原文「调取图逻辑后必须双清」）。没有 CF 凭证执行 remote SQL 时，正解是**换键作废**而不是删行：D1 键带一段解析器代数（`shared/posterKey.ts` 的 `OTHER_POSTER_GENERATION`，读侧永不删数据），代数 +1 旧行即成孤儿。注意只给出过事的维度带代数——一次推平常=全站海报重新回源，豆瓣侧大概率 418。附带收益：客户端兜底键原先手抄竖线拼接公式，改调共享实现 + 一条源码扫描测试盯「不许再手抄」。
- **2.18 年份过滤要收进共享键函数**：`normalizeYear` 只放行 1800–2200，《蒙娜丽莎》1503 在 API 层被丢弃，而前端兜底键仍拼 1503 → 两端键差一段，命中不了服务端行。键的每一段（含年份口径）都必须两端同源，不能只在服务端归一。
- **2.19 部署后首几个请求会抖动，复测别拿一次结果下结论**：两次部署（e044093 / 4dcd622）后都出现过冷启动第一次请求摘错页（西遊記重播年、济南景点列表页、404），同一参数即刻重试即恢复正确。isolate 冷启动叠加上游 gsrsearch 排序抖动的复合现象——**线上复测同一参数至少跑 2～3 次**，全部一致才算验收；单次异常先重试再立案。
- **2.20 白名单类事实必须查官方出处，抽样反推一定会漏** —— MediaWiki 合法缩略图宽度是 `$wgThumbnailSteps` = `20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840`（出处 `https://w.wiki/GHai`）。我曾只测 `[60..1200]` 区间，据此写下「只有 6 个桶」的桶表，把 `20/40/1280/1920/3840` 五档全漏在测试范围外，直到逐档实测才纠正。配套三条：① **桶外宽度上游返 400**，body 原文 `Use thumbnail sizes listed on https://w.wiki/GHai`——502 只是自家 `/api/image` 代理 catch 后的呈现，别当偶发故障；② `iiurlwidth` 是**向上**取桶（官方原文：smallest step that has larger value than requested），所以旧的 `"600"` 实际拿到 **960px**；③ `iiurlwidth` **不放大**——原图窄于请求宽度时直返原图（带 `utm_content=thumbnail_unscaled`），所以下调桶宽只会让大图变小、对小原图无副作用。
- **2.21 24h 边缘缓存连部署都清不掉：验证新代码必须用没缓存过的 key** —— `worker/media.ts:45` `POSTER_CACHE_TTL_MS = 24 * 60 * 60 * 1000`，成功的**错的**结果与 miss 同 TTL。本轮实测：代数 bump 后 Journey 2012 在线上返错图 manga logo，我清掉 D1 全部 16 行 gen4 行、再单删 `other|journey|journey|2012|4`，**线上仍返错图**——一度让我以为新代码没生效。而 `year=2014`/`2015`（从未缓存过的键）立刻返回正确封面。**教训：清 D1 ≠ 清缓存**；要判定「线上跑的是不是新代码」，换一个**从未被请求过的维度/年份组合**当探针，比反复 purge 可靠得多（对应 §2.17 的 D1 短路与本条的边缘缓存是两层叠加）。
- **2.22 别把 `!important` 整宽当 bug 改** —— `src/styles.css:62-64` 把 `.collection-row .poster` / `.poster-small` 强制成 `width:100%!important;height:auto!important`，单卡实际宽 369–557px（容器 1120px ÷ 列数 2/3/4，`colCount` 存在 localStorage `art-rank:cols`）。`src/styles.css:56` 的注释「Collection Sticker Cards (source view only)」说明这是**设计**（贴纸卡要整宽无裁剪）。若只按「小缩略图却拉全尺寸原图」的表象去拆，会砸掉 source view 的既有版式——**动之前先找设计注释**。

---

## §3 数据类（D1 / 状态 / 并发）

| # | 现象 | 根因 | 对策 |
|---|------|------|------|
| 3.1 | 保存后刷新**整份画像消失** | 读写两侧校验口径不一致，读侧因校验失败**删了数据** | 口径收敛到一处；**读侧永不删数据** |
| 3.2 | 云端读取 / 广场发布失败（512KB） | 海报 URL 数组塞进画像，150 首歌就超限（**连修三次**：`51dfc8d` `58da68a` `4ce1f15`） | 海报走 `poster_urls` 侧表；落库白名单唯一出口 `shared/storedItem.ts` |
| 3.3 | 旧 localStorage 残留仍超标 | persist 未全量清洗 | persist 函数**全量清洗** posterUrls |
| 3.4 | 删帖 500 | `plaza_post_edits` 外键引用未清 | 删除前先清引用（作者/管理员/重置/删号四处路径都要） |
| 3.5 | 云端同步互相覆盖 | 并发响应无代际 | **水合门 + 会话代际**，旧代际响应丢弃 |
| 3.6 | AI 代判覆盖用户真实选择 | 异步响应迟到 | **键控守卫**：键已变更就丢弃响应 |
| 3.7 | 远程 migration 失败 | 非幂等迁移（0017 索引、source 列） | 迁移必须**幂等可重复应用** |
| 3.8 | 广场发布拦截了 >20 首的榜单 | 复用错了上限（ranking 上限应是 300） | 上限常量按语义区分，别复用 |
| 3.9 | 验证码全部失败（`attempts=0`） | **SQLite `=` 大小写敏感** + 复制粘贴的空白 | 邮箱统一 lowercase；验证码 strip 空白；错误要区分 `code_not_requested` / `code_expired` / `code_locked` / `invalid_code`（带剩余次数） |
| 3.10 | 批注丢失 | `cleanString` 对 object 返回 `null` | 序列化前先判类型 |

---

## §4 视觉 / 前端类

**⚠️ 流程类**：

- **4.1 构建期间禁止截图** —— `dist` 重建导致 ENOENT，一次杀掉 204/270 张截图。服务端 handler 必须包 try/catch。
- **4.2 单张截图异常会杀死整轮长跑** —— warm 轮跑到 114 张崩了，且堆栈被输出过滤吞掉 → 必须做 **per-shot 异常守卫**。
- **4.3 Chrome profile 并发锁竞争** 导致 exit-21 交替出现（非确定性）→ `--profile` 命名空间隔离。
- **4.4 百分比差异会骗人** —— bento grid 的 mode delta 只有 0.0014%，实际是 `display:block` 把 `grid-template-columns` 空化了。判定要用「构造边界 + 位移签名」，不能只看 pct。
- **4.5 PS 5.1 的 UTF8 BOM** 会让 manifest 解析失败 → 解析要 BOM 容忍。
- **4.6 lint 假报错**：`.tmp` chrome profile 目录要进 ignore。**gate 习惯：永远检查 exit code。**

**CSS 类**：

- **4.7 `overflow-x` 会隐式生成 `overflow-y`**，把下拉菜单裁掉（"点击设置什么都看不见"）。
- **4.8 `:last-child` 会误伤** —— 移动端隐藏第 4 个导航项时，匿名用户的「广场」因为是最后一个而被隐藏 → 用 `:nth-child(4)`。
- **4.9 `:focus-visible` 改 `border-radius`** 会造成焦点态形变。
- **4.10 子元素缺 `min-width: 0`** 导致手机端横向溢出（比较页 top3 区块用了 `flex-shrink: 0` 阻止收缩）。
- **4.11 通用选择器误伤** —— `.custom-suggestion > div { flex: 1 }` 拉伸了海报（海报也是 div）→ 加 `:not(.poster)`。
- **4.12 `display: grid` 必须显式声明**（`display:block` base 会空化 `grid-template-columns`）。
- **4.13 `setPointerCapture` 要守卫** —— 非活跃 pointer 事件会打断滑动链。
- **4.18 媒体查询不加特异性** —— `@media` 内的 `.x{...}`（0,1,0）压不过媒体查询外的 `.x:nth-child(N){...}`（0,2,0），与代码顺序无关。editorial 移动端轮播曾因此泄漏桌面绝对定位（倾斜/推右 127px 巨间隙/错位）→ 用「后代前缀 + `:nth-child(n)`」抬到 (0,3,0)，hover 扩散覆写抬到 (0,4,0) 同分后来者胜。
- **4.19 后置的同名基座规则会吞掉前置覆写** —— 基座 `.orb-hero-inner` 的 `grid-template-columns` 写在移动端媒体查询**之后**（L846），同名类 (0,1,0) 后来者胜，`.ed-hero-inner` 的单列覆写整个成死代码（实测 mobile 跑双轨 + 48px column-gap，轮播容器 438 = 486−48）。媒体查询内的结构覆写要么双类 `.a.a{}` 抬到 (0,2,0)，要么加后代前缀。**症状是「覆写在但没生效」，dump 盒模型（`getBoundingClientRect` + `scrollWidth`）一比就见分晓**。
  **主题块变体（P3 gallery 实测预防）**：新主题块追加在文件末尾，其 `[data-theme=x] .ranking-list>li{display:grid}`（0,2,1）会反过来压过**前面**的历史修复 `.ranking-list.reorder-list>li{display:flex}`（0,2,1）——手动重排行第 5 个子元素折进 92px 名次列。凡在文件尾部加主题块，先 grep 它触碰的类有没有「特异性相同的后置修复」，有就必须更高特异性把修复要回来（gallery 用 0,3,1 重排守卫 + 绊线）。
- **4.20 「被引用的 token 从未定义」会静默变 none** —— `--ev-1/2/3` 自 `7fb1d5c`（P1b-3 阴影两级收敛）起被 ~20 处 `box-shadow:var(--ev-2)` 引用，但 `:root`×2、主题块、index.html、dist 全无定义 → 全部解析为 `box-shadow:none`，且**当时的 zero-diff 基线就是在这个「无投影」状态下产出的**。教训：① 引用前先 `grep -c '\-\-ev-1:'` 确认定义存在（绊线：全文仅 1 处定义）；② 给某个新主题补定义前，先想清楚旧主题基线是否依赖「未定义 = none」的现状——要补就全局补并**重立基线**，只在新主题块内补则用绊线看守数量。

**构建 / 产物体积类**（⚠️ 都栽在「看起来已经优化过了」的地方）：

- **4.21 `lazy()` 只推迟渲染，不推迟依赖** —— chunk 图按**静态 import**算，不按运行时。`DeferredOrb` 已有 `lazy(() => import("./OrbScene"))` + `requestIdleCallback` + `prefersLiteMode` 三重省流，注释还写明 three 约 522KB 原始/128KB gzip 占落地页 ~45%，实测主包里 `WebGLRenderer`=38 —— 三重防护全部失效。根因是首屏常驻组件（`ThemeSwitcher.tsx`）静态 import 纯数据注册表 `registry.ts`，注册表再静态 import 四个特效模块 → 静态 `from "three"`。**凡「元数据 + 实现」共处一个模块而首屏只用元数据，必复发**；修法是把元数据与 loader 拆两层（`EFFECT_META` 纯字面量 + `orbEffectLoaders.ts` 的 loader 表），loader 里的动态 import **必须写字面量**（`await import("./plasma")`，写变量 vite 扫不到、chunk 拆不出来）。async 化后 `OrbScene` 必须补 `mountToken` 竞态守卫，否则快速切主题/切特效会泄漏半初始化实例。
- **4.22 性能注释不是证据，构建产物指纹才是** —— 查「某重依赖进没进首屏」用 `[regex]::Matches((Get-Content dist\assets\index-*.js -Raw),'WebGLRenderer')`。主包 `index-*.js` 963.7 → 440.31 KB（gzip 202.49 → 145.21 KB），指纹 `WebGLRenderer`/`THREE.`/`ShaderMaterial`/`DataTexture` 全部归零才算数。**注意 `REVISION` 常量被 terser 内联，计数恒为 0，别拿它当探针**。配套纪律：给这类不变量加源码扫描绊线（`src/ui-fixes.test.ts` 的「首屏依赖图绊线」），并且**必须做「把故障改回去，测试要变红」的验证** —— 否则测试可能因为桩没生效而永远绿。
- **4.23 部署切换瞬间会抓到旧 asset 名并 404** —— `Invoke-WebRequest https://<host>/` 可能拿到上一版的 `/assets/index-XXXX.js`（此时已 404），HTML 本身 200。加 cache-buster 重取或重跑即可。HTML 的 `cache-control: public, must-revalidate, max-age=0` 对哈希资源名是**正确**配置（来自 `env.ASSETS` 透传，`worker/index.ts:1723-1733` `serveAssets`），别误改成 `no-store`；判断依据是「带 cache-buster 重取后连续 3 次都指向新 asset 名」。
- **4.24 单测环境跑不了浏览器专属模块** —— `plasma` 依赖 `CanvasTexture`，在 node/vitest 下 `document is not defined`。断言「loader 表与元数据对齐」别去真的 `createOrbEffectById()`，改用源码正则 `[...source.matchAll(/^\s{2}(\w+):\s*async \(\)/gm)]` + 运行时读 `ORB_EFFECT_LOADER_IDS` 双重比对。

**打分 / 判决类**：

- **4.25 分数不是置信度** —— `scoreOtherPage` 产出 0–13.5 的连续加权分，`pickBest` 取最高分就无条件返回。「道奇Journey」6.5 与「風之旅人」5.5 差 1 分，这一分却直接决定用户看到汽车还是游戏。**把启发式加权分当离散判决用，本身就是 bug 的根**；评分只能当**排序**信号，判决必须先过「档位/证据」闸门，再由置信度决定要不要打扰用户。
- **4.26 证据要按「来路」分类，不是按「谁赢了」** —— `evidenceOf` 最初先判 `hintRescued`，导致已修好的 Journey（确实来自 `Journey 电子游戏` 轮，却同时在消歧页自列名单里）被误报成 `hint`；改成「零字面重合才算 hint」又把「道奇Journey」误判成 hint（它的 compact 自己就含 `journey`，只是被 `declaresWorkTopic` 降了档）。最终按来路三层判：tier2 → `literal`；tier1 但字面蹭到标题 → `literal`；tier1 零重合但在消歧页名单 → `alias`；tier1 零重合且只靠类型词轮 → `hint`。**推论：`candidate.evidence` 不能当「这是正确答案」用**（Journey 判 `weak` 时池里的道奇Journey 会显示 `literal`），得连 `picked` + `band` 一起看。
- **4.27 诊断端点自己先要能自证** —— 「判决对了但诊断说没信心」会立刻让新诊断端点白做。调试置信度类代码时，**必须同时看冠军和被淘汰者的 evidence**；只看冠军会以为分类错了，其实两者都可能是对的（在诚实报告「没把握」的口径下，池里存在证据更硬的候选是正常输出）。
- **4.28 档位闸门只审一侧，另一侧就是洞** —— `isDescriptiveSuffix` 审的是「用户标题 + 描述性尾缀」（日常幻想指南、勇者斗恶龙），但对**反向形状**「别名 + 用户标题」完全没设防：`隨興旅 -That's Journey-` 去掉标点后是 `隨兴旅thatsjourney`，`endsWith("journey")` 成立，于是被放成 tier2 作品页。它靠 3(剥括号后以原名结尾)+2(类型词)+1(摘要够长)+1(pageimages 缩略图)= **7 分**压过靠消歧页别名放行的 tier1《风之旅人》**5.5 分**——而 tier 优先于分数，真封面 `Journey_PSN_Cover.png`（在 `page_image` 里）根本没机会出场，只能退到漫画像唯一的 `pageimages` logo。**tier 闸门不是「有洞就调分」，是「两侧都要审」**：候选侧要审 `isAlternateNamePrefix`（判 **0 淘汰**而非降档——漫画与游戏是不同作品）。
- **4.29 淘汰判据要挑不会误杀合法本地化名的那一个** —— 同一现象试了三个判据：`head.includes(baseCompact)`（红，`expected 2 to be 1`，因为前缀是「隨兴旅thats」并没有第二个 journey）→ 「base 含拉丁字母时前缀也含拉丁字母」→ ✅ `集合啦！動物森友會`（前缀「集合啦」全中文）仍 tier2、`Inside (遊戲)`/`紀念碑谷 (遊戲)`（拉丁注脚在括号内，已被上层剥括号分支收走）不受影响。**判据的验证集必须是「长得像但合法」的对照项**，只测那个错例就上，等于把 bug 换个形状留着。
- **4.30 出图候选池也可能本身是错的** —— 漫画像的 `pageprops.page_image` **为空**，唯一能出的图是 `pageimages.thumbnail`（那个 logo）。所以「选错页」与「选对页但没图」在结果上同形（都返一张不像的图），排查时**先确认冠军页的出图字段，再谈排序对不对**；只看到 URL 不对就回头调 `pickBest` 是白费功夫。
- **4.31 台账里的候选在开工前必须重新核一遍** —— 台账 T-20261002-04 给下一轮留的头号候选是「摘 `fflate` 出主包」，开工 grep 才发现 `src/lib/utils.ts:28` **早就是** `await import("fflate")`，主包里那 5 处 `strFromU8` 是**调用点**不是库代码（库本体早已在 `browser-BTM47nOj.js`，5.09 KB）。**上一轮判断时成立 ≠ 现在还成立**：迭代之间隔着完整一轮部署与若干改动，候选会被做完、会被别人顺手做掉。**开工顺序应为：先核候选 → 再量体积 → 再定方案**，不是直接照着候选开干。
- **4.32 先量后写：`@license` 横幅是噪音不是体积** —— 主包 44 条 `@license` 横幅看着吓人，实测 **lucide-react 全量 = 16.14 KB raw / 3.58 KB gzip**，其中 icon-name 字面量只有 6.87 KB（40 个图标）。照着印象写计划会跑去优化一个 3.5 KB 的东西。可靠做法是 `npx vite build --sourcemap` + 解 VLQ mappings + 按 `sourceId` 归属**压缩后产物字节**。
- **4.33 sourcemap 字节归属只能当优先级排序器，不能当收益预测器** —— 归属结果只覆盖 414.71 KB 中的 **169.54 KB**（压缩后单行无映射），缺口近六成。**用它的排序决定「动谁」是真的，用它的数字承诺「省多少」是假的**；收益只认真 build 的输出。配套：批量替换实验（`Get-Content -Raw` + `.Replace()` + `[System.IO.File]::WriteAllText`）测出的收益与最终手改代码的误差 ≤0.25 KB，可作为计划预测的精度参考。
- **4.34 收益数字好看不等于代码对，tsc 是唯一裁判** —— 重排 `src/App.tsx` 的 import 块时误删了 `import { SortingView } from "./views/SortingView";`，build 的体积数字**依然漂亮**（402.60 KB / 134.34 gzip，完全符合预期），是 `npx tsc -b` 报 `src/App.tsx(1250,8): error TS2304: Cannot find name 'SortingView'` 抓到的——**否则会带着一个排序页直接崩的版本上线**。凡是大段 import 重排，`tsc` 必须排在体积测量之前看。
- **4.35 SPA fallback 要求 `Accept: text/html`，用 `Invoke-WebRequest` 探路由必假 404** —— `worker/index.ts:1726-1736` `serveAssets` 的回退分支判 `request.headers.get("accept")?.includes("text/html")`，而 `Invoke-WebRequest` 默认发 `*/*`，于是 `/catalog/setup` `/plaza` `/myself` `/encounter` `/share` 全部 404。**看起来像「lazy 化把路由搞坏了」的严重回归，实际只是探针不像浏览器。** 加上 `-Headers @{ Accept = "text/html,application/xhtml+xml" }` 后七个路由全 200。任何 SPA 路由的线上验证都必须带这个 header。
- **4.36 计划内部数字不一致，比计划本身的错更消耗时间** —— `docs/PLAN-ROUTE-EAGER.md` §3.1 表里列了 5 个模块，表头却写「六个」（第六个 `ArtworkDetail` 在正文被划掉），而 §0 与 §3.3 的收益数字是按 6 个算的。**验收时人是照着错误的数字去判的**，所以正文与表格必须一起改。`ArtworkDetail` 最终明确不做：它导出的 `ArtworkDetailInfo` 是类型（`import type` 会被擦除，技术上可 lazy），但被 `openArtworkDetail` 在多种视图里触发，会多出一条 chunk 依赖边，而实测归属只有 0.62 KB。
- **4.37 少做也要有硬依据** —— `HomeView` 实测再省 5.53 KB gzip（384.79 / 128.77），**不 lazy**：它是落地视图，lazy 化会让首屏多一次模块往返 + 一次 fallback 闪烁，而本项目用户抱怨的正是「有点卡」（m00079）——**闪烁比 5 KB 更容易被感知**。这条决定用源码扫描绊线锁死（`MUST_STAY_EAGER`），防止下一个人「顺手优化」掉。


**可访问性 / 交互类**：

- **4.14 emoji 要 `aria-hidden`**，图标统一收编 lucide 并带 `aria-label` / `aria-pressed`。
- **4.15 原生 `title` 悬停延迟且触屏不可用** → 改 `data-tip` 即时浮层。
- **4.16 `prefers-reduced-motion`** 不只是 CSS —— JS 行为（如 journey 平滑滚动）也要处理。
- **4.17 触屏 tooltip 粘滞** → `hover: none` 时隐藏。

---

## §5 故障排查顺序（线上挂了先按这个走）

```
1. 现象分层：全挂 / 部分挂 / 特定媒介挂 / 特定端挂？
   └ 特定媒介挂 → 大概率上游（§2）；特定端挂 → 大概率 CSS/CSP（§4/§2）
2. 是本地就有还是线上才有？
   └ 只有线上 → 优先怀疑平台差异（§1）与 CSP/缓存（§2/§1.7）
3. 打开浏览器控制台看有没有 CSP 报错（静默拦截的典型）
4. 查 Worker 日志：wrangler tail
5. 查数据侧：D1 里该行是否超 512KB、字段是否被清洗（§3）
6. 查 SW 缓存：强制刷新 / 检查缓存版本
7. 仍无解 → 查 docs/memory/EPISODES.md 看是否有同类战役复盘
```

---

## §6 排查时的常见误判（对照表）

| 你以为 | 实际可能是 |
|--------|-----------|
| 上游挂了 | CSP 静默拦截 |
| 被限流了 | 网络失败被错误归类 |
| 功能坏了 | 上游风控返回**空 body 但 HTTP 200** |
| 数据丢了 | 读侧校验失败把数据删了 |
| 样式没生效 | `display:block` 空化了 grid / 被通用选择器覆盖 |
| 部署没生效 | Service Worker 缓存 |
| 视觉没变化 | 差异小到百分比看不出来，但结构已经坏了 |
| 已经 lazy 了所以很轻 | 静态 import 链把它拉回首屏主包（4.21/4.22） |
| 部署没生效 | **部署切换瞬间**抓到了旧 asset 名且 404，先带 cache-buster 重取（4.23） |
| 部署后封面还不对 | D1 旧行 / 旧代数键仍在短路新解析器（§2.17），不是代码没上 |
| 候选 A 分最高所以它对 | 启发式分不是置信度，1 分之差就可能跨作品（4.25） |
| 这个候选 evidence 是 literal 所以是正确答案 | evidence 说的是**它自己的**证据来路，不是它是否被选中（4.26） |
| 诊断端点说 `weak`，那它就没用 | 判决层可能完全正确，正是诚实暴露了无把握区（4.27） |
| 上游偶发 502，缩略图请求不稳定 | 桶外宽度上游返 **400** + `Use thumbnail sizes listed on https://w.wiki/GHai`，502 是自家代理 catch（2.20） |
| 桶位只有 6 个，是我测出来的 | 白名单类事实要查 `$wgThumbnailSteps` 官方值，抽样区间外的 `20/40/1280/1920/3840` 全漏了（2.20） |
| 清了 D1 线上还是旧结果，所以新代码没上 | `POSTER_CACHE_TTL_MS` 24h 边缘缓存连部署都清不掉，用没缓存过的 key 当探针（2.21） |
| 这张封面拉全尺寸是 bug | `.collection-row` 的 `width:100%!important` 是贴纸卡设计，动之前先看 `src/styles.css:56` 的注释（2.22） |
| 只审了「标题 + 描述性尾缀」，闸门就够了 | 反向形状「别名 + 原名」是洞，且 tier 优先于分数，小分差也翻不了档（4.28） |
| 判据写了 `head.includes(base)` 就对了 | 它误杀不了真正的错例也会误杀合法本地化名，验证集必须含「长得像但合法」的对照项（4.29） |
| 选错页才会返错图 | 选对页也可能没图（`page_image` 空 → 只能退到 `pageimages`），先查冠军页的出图字段（4.30） |
| 台账里写着「下轮摘 fflate」，那就照着干 | `src/lib/utils.ts:28` 早已动态化，库本体早就不在主包里，候选已过期（4.31） |
| 44 条 `@license` 横幅说明 lucide 很重 | 全量只 3.58 KB gzip/icon 字面量 6.87 KB，先量再写（4.32） |
| sourcemap 归属算出来省 12 KB，那就能省 12 KB | 它只覆盖 169.54/414.71 KB，收益只认 build 输出（4.33） |
| build 体积达标了，代码就是对的 | 误删 `SortingView` 时体积照样漂亮，是 `tsc` 的 TS2304 抓到的（4.34） |
| `/catalog/setup` 404 = lazy 化把路由搞坏了 | SPA fallback 要求 `Accept: text/html`，`Invoke-WebRequest` 默认 `*/*` 必假 404（4.35） |
| 计划表里有 5 个模块，表头写 6 个没关系 | 验收时人是照着错误的数字去判的，正文与表格必须一起改（4.36） |
| HomeView 再省 5.53 KB，没理由不做 | 落地视图 lazy 化换一次首屏闪烁，闪烁比 5 KB 更被感知（4.37） |
