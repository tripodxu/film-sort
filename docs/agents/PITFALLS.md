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
- **4.38 你自己新增的诊断端点，也是它所依赖的那个限流桶的消耗方** —— 给「其他」维度的作品详情弹窗挂上消歧 UI 后，每开一次弹窗就发 **1 次 `/api/other/candidates` + 最多 3 次 `/api/other/detail`**，而这三者**共用 `other` 桶 20 次/10min**（承 T-20261002-05 遗留风险④、T-20261002-03 遗留风险⑤）。**开 20 次弹窗就能让 `/api/other/detail` 自己开始 429——为了「帮用户」而加的功能，会把它要服务的功能打挂。** 修法是**会话内缓存**（判「不打扰」连请求都不发；判「要展示」连字段一起缓存），不是加配额（配额是全局的，救不了自己人）。任何「顺手加个诊断请求」的动作，都要先算一遍 `次数 × 每次的开销` 落在哪个桶上。
- **4.39 一条证明不了任何事的测试，比没有测试更糟** —— 给 `shouldOfferChoice` 写「判定只看 band 与两个计数、不看 `score`」这条用例时，我用了两个**只差 `score`** 的输入去构造反例——**而 `ChoiceInput` 里根本没有 `score` 字段**，两个输入字面完全相同，断言恒真且不测任何东西，还给人虚假的安全感（"这条用例在保护我"）。正确姿势是**结构性证明**：断言字段名用 `typeof … === "boolean"` 检查，并在类型层面保证 `score` 不存在。同类自检：`npx tsc` 下若把 `score` 加进 `ChoiceInput` 而用例仍绿，说明用例是摆设。
- **4.40 假 DB 会让整张表红成另一种含义** —— worker 测试的 fake D1 若不实现 `batch` 逐条 `await statement.run()`，`saveResolvedPosters` 走 `db.batch([...])` 时**一条都没写**，端点的「写后回读校验」就返 500 `write_verify_failed`。**排查时极易误判成端点逻辑错**（其实只是 fake 少实现了 `batch`）。配套：`worker/index.ts` 的 `route` **未导出**，测试只能走 `worker.fetch(request, env, ctx)`；`send` 助手的第三参里 `origin === null` 表示「刻意不带 Origin」。
- **4.41 诊断端点与取图链路一致，不能证明任何一方正确** —— 迭代 5 曾据「`/api/other/candidates` 稳定返回 `picked=风之旅人`，而 `/api/posters/batch` 在正确/错误封面之间交替」推出「判决对、出图错（并发字段填充会掉）」。**取证后结论撤回**：gsrsearch 8/8 逐字稳定、`隨興旅` 压根不在前 6 名、en 轮池子无漫画像、`imageinfo` 单查 6/6 稳定、线上重打 **6/6 全对**。那两条错图 D1 行是**迭代 3 修复已上线但该键尚未被重写**的时间窗产物（`updated_at` 停在 `00:54:11Z`）。教训是三层的：① **先下结论再找机制**——那个「并发字段填充会掉」的机制听起来完全合理，但不是真的；② **我的验证手段与结论互相掩护**——诊断端点与取图链路共用同一套评分和同一份别名，它俩一致本就在预期之内，一致性零信息量。判决必须用 `/api/posters/batch` 实取图来验；③ **「N 次里出现了错图」要先问那 N 次是不是同一个版本/同一份缓存状态**，否则把时间窗当成了随机故障。
- **4.42 逐条循环调 `/api/posters/batch` 极慢，应该一次批量发** —— 单条 `items` 也是一次维基真回源，逐条循环 + 25s 间隔测 8 次跑满 5 分钟还没完，被迫 kill。**一次 body 发完全部 items**，`{items:[…], retry:true}`，响应读 `j.results[j.keys[0]]`（结果是 map 不是数组，见 T-20261002-05 误判记录）。
- **4.43 量「传输量」之前，先确认你的探针没有自动解压** —— `Invoke-WebRequest` 会自动解 br，用它量 `/assets/index-*.js` 出来是 **407 KB**，我盯着这个数字推理出「线上根本没压缩，这才是『有点卡』的根因」——**结论完全错**，真实传输 **134 804 B**（br）。任何带宽/压缩相关的结论必须用 `node:https` 原样请求看 `content-encoding` 和落盘字节。配套两个同源坑：`curl.exe --compressed` 在本机不可用（`the installed libcurl version doesn't support this`），PowerShell 直传 `$r.Headers['etag']` 报 `The format of value 'System.String[]' is invalid.`（头部是多值数组，要先 `.Get(0)` 或 `($r.Headers['etag'])[0]`）。**工具报错极易被误读成线上异常，先分清是探针坏了还是服务坏了。**
- **4.44 守卫短路在前，断言就在后面空转** —— 测「无哈希文件不得被判成 immutable」时断言路径 `/assets/favicon.svg`，但假 `env.ASSETS` 没登记该路径 ⇒ 返 404 ⇒ 策略在 `if (status !== 200 && status !== 304) return response;` 处短路 ⇒ **被测函数一次都没被调用**，断言照样绿。**它保护的是一个它从没执行到的分支。**（4.39 是「断言恒真」，4.44 是「断言没执行」，两个方向都给人虚假的安全感。）识别方法：断言用的输入必须先确认走到了被测点；假 env / mock 要为**每个**断言路径提供响应。
- **4.45 一个接口把「上游全挂」和「确实没有」返回成同一个值，等于把判断成本转嫁给每个消费者** —— `/api/other/candidates` 在上游维基间歇性失败时返回 `{candidates:[], picked:null, confidence:{score:0,band:"weak",evidence:"none",poolSize:0}}`，与「维基真没这个条目」**逐字相同**，唯一线索是 `lang: null`（`worker/other.ts:1018`）。实测同一 URL 10 次出现 3 种结果（zh 3 / en 3 / 空 4）。消费者（`CoverChoice`）只能靠 `poolSize < 2` 静默不渲染，**用户看到的是无图，不知道是「没搜到」还是「系统挂了」**。诚实的数据接口必须**让失败可区分**（`502` + `fallback` 字段，或显式 `upstream_unavailable` 标记）——这比「多返回一个字段」贵，但比每个消费者各自猜便宜。
- **4.46 缓存头的收益看头的值，不看墙钟** —— 改 `cache-control` 后首访收益**是 0**（浏览器手上什么都没有），收益在第二次访问同一 URL 才兑现。拿「首页快了多少」当验收会得到 0 然后误判改动无效。验收要**断言头的值 + 产物指纹**（`index-<hash>.js` 哈希名与字节数是否逐字不变，后者证明「只改头、零首屏影响」），墙钟只用来量 RTT 波动范围。
- **4.47 红队先问「我到底破坏了没有」，再问「断言抓住没有」** —— 给「重试必须真的重试」这条绊线做红队时，我在 `const retry = retryForced || !firstBatchDispatched` 行尾**追加了一行 `// REDTEAM-PROBE` 注释**就开跑，**68 passed 绿得干干净净**——而绿是唯一正确的结果：代码一个字没动，注释不改变语义。真正做破坏是把 `retryForced || ` 那段**删掉**，此时 `toContain` 的目标字符串本身已不存在于源码 ⇒ 1 failed。**红队的对象是「断言想守住的那个语义」，不是「那个文件」**：改注释、换变量名、调格式都不会让断言红。判据：如果这次破坏失败了，是断言没抓住，还是我根本没破坏？配套：**断言目标的那个字符串必须整段出现在源码里**，所以破坏时要删的正是它本身，不能只删它的一部分。
- **4.48 源码扫描绊线必须剥注释，否则被你自己的注释喂绿** —— `src/ui-fixes.test.ts` 里 `batchRoute` 剥了注释、同 describe 的 `poster` 那几例忘剥。而 `Poster.tsx` 里我写的解释性注释**恰好包含** `const retryable = emptyState === "degraded"` 这类断言要匹配的字符串 ⇒ 我把那行代码删掉，断言仍然绿。修法：`const posterCode = stripComments(poster)`，该 describe 全部改扫 `posterCode`。这是 4.39（恒真断言）的近亲：**断言被注释喂绿和断言不存在，效果一样**。凡是要匹配「代码里那句话」的断言，一律扫 `source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\n]*\/\/.*$/gm, "")`。
- **4.49 模块级可变状态在并发批次里会互相污染，"降级标记"尤其致命** —— `worker/other.ts:59` 的 `let wikiDegraded = false` 是**模块级全局**，`resetWikiDegraded()`（`:62`）只在 `computePosters` 的 other 分支入口（`worker/media.ts:1709`）调一次，而一条 other 的兜底链要发**十几次** wiki 请求（otherDetail / resolveOtherCover / wikiEnTitle / wikiPageImageAny×2 / searchWikiPoster）。Cloudflare 同一 isolate 内的并发请求共享这份模块状态 ⇒ **一条请求超时就把它并发跑的所有条目一起染成降级**。实测后果：`worker/media.ts:1743` 的 `outcome: throttled || wikiWasDegraded() ? "throttled" : "absent"` 让**同一个确实不存在的条目，单发得 `absent`、同批得 `throttled`、下一轮同批又得 `absent`**（`日常幻想`/`故事FM`/`看理想` 三条 round1 = `absent/throttled/throttled`、round2 = 全 `absent`）。放大器是超时预算：`wikiJson` 上限 7000–9000 ms（`worker/other.ts:333,586,734,770,805`）vs 本机到 zh.wikipedia 单次 RTT 1595–2313 ms，批次一大必然有请求越线。**D1 佐证线上从未真被限流**（`poster_errors` 里含 `throttl`/`timeout`/`unavail` 的行数 = 0）。通则：**任何"本次调用是否降级"的标记都不该是模块级全局**，应该随单次调用传递或做成局部计数器；判据是「同一个输入在不同并发规模下，输出必须相同」。
- **4.50 探针的 key 匹配要先看清键的大小写与编码，否则 MISSING 会被当成服务端异常** —— `posterMediaKey` 产出的 `media_key` **全小写**，所以批次响应里 `故事FM` 的键是 `other|故事fm|故事fm||4`。我写 `j.keys.find(k => decodeURIComponent(k).includes(t))` 去匹配 `故事FM` ⇒ 永远找不到 ⇒ 报 `MISSING`，我一度以为是服务端把条目丢了。**两种「看起来像线上坏了」的现象同源：探针的键假设不对，和 4.43 的探针自动解压。** 配套：JS `fetch` 的 header 值必须是 ByteString，**中文不能直接放 header**（`TypeError: Cannot convert argument to a ByteString because the character at index 87 has a value of 33945`），中文查询串要 `encodeURIComponent`；`keys.length === 0` 时先打 `http` 状态与 `retry-after` 再判服务端（4.42 的批量姿势：一次 body 发完整批）。
- **4.51 不是所有 `/api/*` 都包 `data` 包装，别把记忆当事实** —— 我一直记着「`/api/*` 的响应是 `{"status":true,"msg":"ok","data":{...}}`」，于是探针一律写 `const d = (await r.json()).data ?? {}`。**batch 路由不走 `json()` 包装**，它 `return json({ results, keys, outcomes }, ...)` 之前那层——实测响应是**顶层** `{"results":{...},"keys":[...],"outcomes":{...}}`。`d.data ?? {}` 于是恒为 `{}` ⇒ 10 行全 `(no key)`，看起来像「线上整批失灵」。**推论：探针里的每个「我以为的结构」都要用一次 dump 亲自看过。** 我最终的写法是 `const d = j.data ?? j`（两种形状都吃），但更重要的是**第一次全红时先 `console.log(JSON.stringify(j).slice(0,200))`**，而不是先改被测代码。
- **4.52 `Response.body` 只能读一次，`r.json()` 调两次第二次永远失败** —— 隔离探针里我写了 `const d = (await r.json()).data ?? …; const j = await r.json().catch(()=>({}));` 想「兼容两种响应形状」。结果 `d` 和 `j` 不会有两个 body，第二次抛错被 `catch` 吞成 `{}` ⇒ `dd = {}.data ?? {} = {}` ⇒ **8 轮全部 `(no key)`**。而「8 轮全 no key」在视觉上与「服务端把 8 轮都判成空」完全一样。**兼容响应形状的唯一正确姿势是读一次、存变量、再对变量做兼容判断**（`const j = await r.json(); const d = j.data ?? j;`）。
- **4.53 验收脚本的键构造是被测系统的一部分，别自己重算** —— batch 响应自带 `keys` 数组，**直接用它**。我自己按 `other|${title}|${english}|${year}|4` 重算，结果蒙娜丽莎那条永远匹配不上：服务端给的真实键是 **`other|蒙娜丽莎|mona lisa||4`——year 段是空的**，因为 1503 被 `normalizeYear` 的范围检查丢掉了，而我探针里老老实实填了 1503。**任何「拼 key 再查表」的探针都自带一整套服务端没有的规范化假设。** 通则：被测接口既然给了键，就用它的键；要按标题回连，就在**收到的键**上做匹配，而不是构造一个「应该长这样」的键。
- **4.54 「造新键绕缓存」与「保持输入不变验确定性」是两种互斥的验收姿势** —— 为绕开 24 小时边缘缓存，我给每条 item 的 `english` 字段**加盐**（`a5r1journey`）。结果 `english` 正是维基消歧的最硬线索，`Journey` 的 `english="a5r1journey"` 让消歧彻底失效 ⇒ 匹配到 **`2012_Dodge_Journey_--_NHTSA_3.jpg`**（一部美国纪录片），我据此差点判定「代码改了选图逻辑」。**A5（同一输入逐字零回归）必须用与基线**完全相同**的输入**；加盐只适用于「验证判决链对缓存免疫」。判据：**这次验收要证明的是「换了输入会怎样」还是「同样的输入会不会不一样」？** 两者不能用同一个探针。
- **4.55 判红之前先分层测上游：本地客户端差异会冒充成线上回归** —— A7/A8 全红时我第一反应是改代码，先测了上游才发现三个客户端三种结论：**node `fetch` → zh.wikipedia 12/12 TimeoutError**（9000 ms 卡死；20000/30000/60000 三档预算都报 `TypeError` 而非 `TimeoutError`，10.2–10.7 s 挂掉），**`Invoke-WebRequest` 同目标 6/6 成功 1480–2535 ms**，**而 worker 侧 `/api/other/detail` 830 ms 就拿到封面**。所以「`throttled`」在那一刻是**真的**（维基对我这一侧慢），而「全批 no key」是**我自己 Node 链路的错**。**分层测量清单**：① 目标 URL 用另一个客户端（`Invoke-WebRequest`/`curl`）再打一次；② 拉长超时预算看是 `TimeoutError` 还是别的错（`TypeError` 通常是 TLS/代理层挂掉，不是服务端慢）；③ **必须包含一个走真实服务链路的观测**（打自己上线的诊断端点），它是「服务链路是否健康」的唯一权威。**测出「我这台机器连不上」和「服务挂了」是两件事，别把前者写成后者。**

- **4.56 需要「与服务端同源的键」时，写入口归属「持有完整对象的那一层」，不是「恰好手里有那几个字段的函数」** —— 我把 `rememberCoverChoice({title, english, year, …})` 直接放进 `CoverChoice.pick()`，组件里那几个字段都有，看起来天经地义。但 `CoverChoice` 的键是自己拼的 `title|year`，服务端 `posterMediaKey(title, english, "other", year)` 里还有 `english` 归一化与 `|4` 后缀 ⇒ **键不同源**。症状极具欺骗性：页内一切正常（同一个 `title` 恰好对得上），刷新全丢，**零报错**。改法：写入口搬到 `ArtworkDetail`（它持有完整 `work`），并把 `onPicked` 签名改成 `(url, wikiTitle)` 让它把另一半事实交上来。**判据：当一个键的正确性依赖「另一个文件的算法」时，写和读必须同处一个文件**（本轮把 `recalledCover` / `rememberPickedCover` 并排放在 `Poster.tsx`），这样算法漂移只会有一个地方需要跟着改。推论：**存哪儿是消费者的决定，不是生产者的** —— `CoverChoice` 手里有 `wikiTitle` 却不该存它。
- **4.57 红队全绿有两种原因，排查顺序不能反：先问「变异有没有语义」，再问「断言够不够强」** —— 我把 `mergeCoverRecall` 里 `if (x) A; else B;` 改写成 `if (!x) B; else A;`，测试全绿。我第一反应是「断言不够强」⇒ 去加测试；加了**还是绿**，才回头发现这是**同一个函数**，变异本身没改行为。加测试这条路上多绕了一圈。**有效的红队变异必须改变可观测行为**。本轮的正确变异是「让精确行的图和继承行的图**不是同一张**」（用两张不同的 url），以及「让精确行退化成按继承处理」。配套：写红队时先写下「**这个变异会让哪个具体输入产生哪个具体不同输出**」，写不出来就别跑。
- **4.58 上界淘汰写在 `setItem` 之前 ⇒ 整份持久化只活在内存副本里** —— `persist()` 写成 `if (keys.length < COVER_MEMORY_MAX) return; sessionStorage.setItem(...)`。页内一切正常（`memo` 缓存命中），刷新全丢，**零信号**——比崩溃难查得多，因为它完全符合「内存里有就够用」的直觉。正确顺序是**先写、再淘汰**（`setItem` 永远执行，满了才删最旧的一半）。通则：**任何「只在容量允许时才落盘」的写法都要逐字读一遍，确认 `return` 不在写操作之前**；对称地，`vi.resetModules()` + 重新 `import` 才能验「刷新后还在」，用 `clearCoverMemory()` 验的是删除不是持久化。
- **4.59 lint 的 baseline warning 数是一张网，别拖到收尾** —— 我提取了 `writeRows` 辅助函数却忘了改调用处，`npm run lint` 从 29 变 30（`no-unused-vars`），当场没管。基线（本仓 0 errors / 29 warnings）的作用不是「不炸就行」而是**差分告警**：任何一次新增 warning 都应当场处理，否则收尾时它已经混在 30 条里，分不清是哪一轮引入的。同类：`npm run format:check` 报 4 files 未格式化也是当场跑 `npm run format`，不要攒到最后。
- **4.60 「测试全绿」和「线上没变化」可以同时成立，只要两者量的不是同一段代码** —— 计划点名三处 `page_image` 直取，实测发现带 year 的 other 请求在 `worker/media.ts:1727` 第一档就被 `otherDetail` 的返回值截住，**`resolveOtherCover` 压根没跑**。于是我改的那三处一个都没生效，而 `worker/other.test.ts` 69 条**全绿**。核对办法：`.tmp/which10.mjs` 花**一次线上请求**确认「主路径上真正跑的是哪一行」，比读一百行源码便宜。通则：**修复前先定位调用链上第一个会 return 的地方**，它上面的修改全是空转。
- **4.61 填进去的形状和读出来的形状不一致，最强的静态检查也看不见** —— `fillArticleImageNames` 把 `page.images` 写成**裸字符串数组**，而 `articleImageNames` / `wikiPageImageAny` 按 **`{title}` 对象**读。两边各自 `as WikiPage & { images?: Array<{title?: string}> }` cast 成自己那套类型 ⇒ **`tsc` 零报错、69 条测试全绿、线上静默取不到图**。这是 4.51 的反面：**4.51 是「我以为的结构没 dump 看过」，这里是「结构对了但形状转述时变了」**。判据：新写的测试必须**让被测的填充器真的跑一次**——原先那条用例把 `images` 直接挂在 fixture 上，恰好绕过了出问题的那一层，于是它测的不是被测代码。配套：补一条专门走填充路径的用例，并在回填处留注释写明「存回 api 的形状 `{title}`，不是裸字符串」——这个不变量离代码太远，注释是唯一的绑定。
- **4.62 判「这不是作品封面」时，别用尺寸，用文件名** —— 直觉是「icon 封面是正方形」。实测 `Animal_Crossing_New_Horizons.png` 只有 **248×402**，比 `Monument_Valley_icon_unrounded.jpg` 的 316×316 **更窄**；且正确封面出 `utm_content=thumbnail_unscaled` 是常态 ⇒ **任何宽高规则都会误杀当前正确的封面**。文件名侧则干净：`icon|logo|logotype|wordmark|banner|avatar|flag|placeholder|mascot|edit|symbol|star full` 在四个样本页里命中全部非作品图、**零个作品图**（含 `Monument Valley, Utah, USA (23611451292).jpg` 这类来自 Commons 但完全正确的文件）。**但要把「判掉」和「回退」分开验证**：实测 `纪念碑谷 (游戏)` 的 `thumbnail`/`original`/`pageimages` **三者全空**（app 图标是非自由文件），只做「不采用」会把「错图」换成「没图」。⇒ **「回退到下一档」必须验证那一档真有东西。**
- **4.63 fixture 的路由顺序有语义，命中第一个匹配** —— `worker/other.test.ts` 的 `installFetch` 用 `routes.find(...)`，而 `/titles=纪念碑谷/` 会**前缀匹配**吃掉 `titles=纪念碑谷 (游戏)&prop=images` 那次请求（该请求的 `titles` 是归一后的页面名）。结果：填充器收到一个没有 `images` 的页面，**看起来像修复没生效**。本轮因此白查三轮。同族 4.51：**fixture 与真实响应的偏差会以「代码没修好」的形态出现**。配套：`installFetch` 的路由按「越具体越靠前」排，并在大 fixture 上留注释写明为什么这条必须在前。


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
| 诊断端点只读、只发给前端看，加它不花钱 | 它与主链路共用 `other` 桶 20/10min，20 次弹窗就能让 `/api/other/detail` 自己 429（4.38） |
| 这条用例测了「判定不看 score」 | 两个输入字面相同、`ChoiceInput` 里根本没有 `score`，断言恒真（4.39） |
| 端点返 500 `write_verify_failed`，逻辑写错了 | fake D1 的 `batch` 没逐条 `run`，`saveResolvedPosters` 一条都没写（4.40） |
| 判决层没问题，诊断端点也说对了，图就该对 | 它俩共用同一套评分与别名，一致性零信息量；判决要用 batch 实取图验（4.41） |
| 逐条循环调 batch 更直观 | 单条也是一次真回源，8 次跑 5 分钟没完，要一次发完整批（4.42） |
| 线上没压缩，这就是卡的原因 | `Invoke-WebRequest` 自动解 br，量出 407 KB 其实是 br 后的 134 804 B（4.43） |
| `curl --compressed` 报错 = 线上不支持压缩 | 本机 libcurl 版本太老；PowerShell 传 ETag 报多值数组格式错（4.43） |
| 断言绿了说明「无哈希文件不被冻」这条被覆盖了 | 假 ASSETS 没登记该路径 ⇒ 404 短路 ⇒ 被测函数没被调用（4.44） |
| 空候选池 = 系统没搜到这个作品 | 也可能是上游维基间歇性全挂，两者响应逐字相同（4.45） |
| 改完 cache-control 首页快了多少 = 收益 | 首访收益是 0，收益在第二次访问；验收看头的值和产物指纹（4.46） |
| 在代码里加个 REDTEAM 注释再跑测试，绿了说明断言不够狠 | 注释不改语义，绿是唯一正确结果；要删的是断言目标字符串本身（4.47） |
| 源码扫描断言绿的，那行代码删了应该也会红 | 断言匹配到了我自己的解释性注释；必须剥注释后再扫（4.48） |
| 这个不存在的条目被判成 `throttled`，说明上游在限流我 | `wikiDegraded` 是模块级全局，被同 isolate 的并发条目共享；同一条目单发 `absent`/同批 `throttled`（4.49） |
| 批次响应里找不到我那条 = 服务端把它丢了 | `media_key` 全小写（`故事FM` → `故事fm`），探针的大小写/编码假设不对（4.50） |
| 探针里 `j.data` 取不到东西 = 服务端响应结构变了 | batch 路由**不包** `data`，是顶层 `{results,keys,outcomes}`；第一次全红先 dump 原始响应（4.51） |
| 「兼容两种响应形状」写成读两次 body | `r.json()` 第二次永远失败，`catch` 吞成 `{}` ⇒ 全批 `(no key)`（4.52） |
| 探针拼的 key 匹配不上 = 服务端漏了这一条 | 服务端给的 `keys` 里 year 段可能是空的（`normalizeYear` 丢弃）；用返回的键，别重算（4.53） |
| 同一输入两次请求拿到不同图 = 代码不确定 / 回归 | 我给 `english` 加盐绕缓存，破坏了消歧 ⇒ 匹配到另一部作品；验确定性必须用完全相同的输入（4.54） |
| `throttled` 全批出现 = 我的判据算错了 | 先分层测上游：node fetch 12/12 超时而 `Invoke-WebRequest` 6/6 通、worker 侧 830 ms 通 ⇒ 是本地链路差异冒充线上回归（4.55） |
| 「刷新后记得的东西丢了」且页内一直正常 | 写入口拿不到与服务端同源的键（组件自己拼 `title\|year`），或上界淘汰的 `return` 挡在 `setItem` 之前（4.56 / 4.58） |
| 红队变异跑完测试还是绿的 | 先确认变异**改变行为**（4.57）。`if (x) A else B` → `if (!x) B else A` 是同一个函数，加断言也救不回来 |
| 线上 bundle 里搜得到新代码 ⇒ 功能成立 | 搜得到只证明「发上去的等于我审过的」，不证明运行时行为；浏览器行为必须浏览器里验（迭代 7/9 两次留红） |
| 测试全绿 ⇒ 改动生效了 | 两者可能量的不是同一段代码：修复点没在主路径上（4.60） |
| `tsc` 过了 + 测试全绿 ⇒ 形状对得上 | 填的形状和读的形状可以各自 cast 到自己那套类型，运行期静默全空（4.61） |
| icon 封面是正方形 ⇒ 用宽高判 | 正确封面 248×402 比 316×316 的 icon 更窄；`thumbnail_unscaled` 对正确封面是常态（4.62） |
| 「判掉图标」⇒ 下一档总有东西 | 该页 `thumbnail`/`original`/`pageimages` 三者全空，「不采用」会把错图换成没图（4.62） |
| 线上没变化 = 修复没生效 | 先排 fixture 路由顺序：`/titles=X/` 会前缀吃掉 `titles=X (…)&prop=images`（4.63） |
