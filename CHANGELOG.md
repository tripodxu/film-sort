# Changelog

## 2026-10-05 · 回归审查修复：懒加载失败兜底与迟到响应守卫（1 高 + 4 中）

**背景**：对最近 30 次提交（`5faea92..HEAD`，两条主线：worker 封面链十次迭代 + 前端拆包/消歧交互）做整体回归审查。
审查结论：**无「前修复被后重构撤销」类回归，八条硬规则无新增违规，门禁 5/5**；另查出 5 个真实缺陷（1 高 + 4 中），本轮全部修掉。五个缺陷的共性是都活在「不常走的路径」上——没有绊线就一定会复发。

**改了什么**

- **[高] 界外三处 Suspense 各包一层静默 ErrorBoundary**（`src/App.tsx`：顶栏 SettingsMenu、AiConfigDialog、RankingDetail）。此前全站唯一的 ErrorBoundary 只包住 `<main>` 里的路由树；这三处 lazy chunk 加载失败（发版换代后旧 hash 404 / 弱网）会让 React 卸掉整棵根 → **白屏整站**。现在失败退化为「当没渲染/没点开」，失败半径止步于该组件。
- **[中] `openArtworkDetail` 加迟到响应守卫**（硬规则 7 漏网）：详情链超时最长 30s，此前三处无条件 `setDetailWork`——开着 A 关掉再开 B，A 的迟到响应会把弹窗整个换成 A（还会把已关闭的弹窗重新打开）。现在落结果前比对「当前弹窗仍是这一部」，并保住等待期间经 CoverChoice 换过的封面。
- **[中] FocusTrap 焦点只在挂载时取一次**（`src/components/FocusTrap.tsx`）：`onEscape` 改走 ref 桥接、监听 effect 依赖清空。此前依赖 `[onEscape]`（App 传内联箭头，每次渲染换新身份）→ 详情数据到达那一刻，用户焦点被确定性弹回关闭按钮。
- **[中] CoverChoice 候选取图按 ref 记账**（`src/components/CoverChoice.tsx`）：此前实现与自己的注释相反（`covers` 实际写进了依赖数组），每张候选图到达都重跑 effect、把在途候选再发一遍——一个候选最多被请求 3 次，白烧与主链路共享的 `other` 限流桶（20 次/10min）。现改为 `requestedRef` 记账，依赖收回 `[memo, year]`。
- **[中] OrbScene/特效 chunk 失败有兜底**（`src/components/OrbScene.tsx` + `DeferredOrb.tsx`）：`createOrbEffectById` 包 try/catch，失败退回 CSS 兜底背景（不再 unhandled rejection + 透明空洞）；DeferredOrb 加 `SilentChunkBoundary` 静默边界，`aria-hidden` 装饰组件的失败不再沿 HomeView 冒泡到路由级边界、把整个首页换成报错页。附带修掉卸载竞态：cleanup 递增 `mountToken`，在途挂载的迟到结果自行 dispose。

**测试**：`src/ui-fixes.test.ts` 新增 describe「懒加载失败与迟到响应守卫（回归审查 2026-10）」6 例绊线。

**验证**：门禁 5/5（本地），两批共 +10 用例（701 ⇒ **711 passed / 9 skipped (720)**）。
**线上验证 2026-10-05 ✅（HTTP 层）**：push 触发自动部署后线上冒烟 5/5——主包哈希与本地 dbeae79 构建逐字节同（`index-Bsgh-aaO.js`）、`english` 超长线上 400 `invalid_english`（该字符串仅存在于本批 ⇒ 新代码确认在跑）、正常请求 200 不误伤、新 chunk `immutable` 头在位、HTML 仍 `must-revalidate`。**浏览器行为项留红**（无驱动浏览器，连续第四次）：焦点手感与旧标签页跨部署不白屏需要真浏览器。
审查同时确认的「没回归」清单：八次封面链迭代的关键机制在 HEAD 全部在位且互相叠加；posterKey 换代边界干净（movie/book/music 逐字节同键，仅 other 换代）；资产缓存 matcher 收得准；fetchBounded/allowedImage/storedItem 白名单无新增绕过。worker 侧另有 3 个结构性风险（`otherDetail` 第一档短路使消歧救援变死代码、`ARTIFACT_FILE_RE` 误杀「标题即敏感词」作品、other 链上游请求量翻倍）**本轮未修**，建议先补线上观测，见台账同日条目。

**低危清单（同日顺手清掉的五项，全部零行为或纯收紧）**

- `ARTIFACT_FILE_RE` 的 `edit[-_ ]` 补词首边界（`worker/other.ts`）：无边界版本会把
  `Credit roll.jpg` 这类正文文件名里的子串 `edit ` 也判成 artifact，正文里合法存在的
  文件名被误杀、整链从「有图」退化成「无图」。词首是分隔符的维基 UI 素材照判，
  附 4 例黑线用例（`worker/other.test.ts`）。
- `computePosters` other 分支的死三元（`worker/media.ts`）：该分支没有任何
  `noteThrottle` 调用（豆瓣不在 other 回退链里），`throttled` 恒 false——直接返回
  `wikiProbeVerdict(probe)`，并留注释防止抄回。
- `shared/posterKey.ts` 注释里的代数示例过期（写 `|2`、实际已是 `"4"`）：改成
  「以 `OTHER_POSTER_GENERATION` 为准」的不随换代漂移写法。
- `GET /api/other/candidates` 的 `english` 参数补 120 字符上限（`worker/index.ts`）：
  与 `name` 同口径，400 发生在限流/回源之前；附路由级用例（`worker/coverChoice.test.ts`，
  刻意不写「合法放行」用例——那条路会真回源维基）。
- `detailFields` 的未知对象值序列化成 JSON（`src/lib/detailFields.ts`）：此前
  `String({a:1})` 印出 `[object Object]`；数组里的对象元素同样处理，附 2 例用例。

**审查出但刻意不修的**：《2012》/《1984》类「标题即年份」作品被年份否决刀误伤——修它要动
评分语义且没有干净的离线测试缝（做有区分度的夹具得反推整套评分词表），按「动闸门先观测」
的纪律挪入台账观测清单，与三个结构性风险同批处理。


## 2026-10-02 · 迭代 11/20：作品详情弹窗接上焦点陷阱 + 字段翻译层

**改了什么**

- **弹窗接上 `FocusTrap`**（`src/components/ArtworkDetail.tsx`）。`role="dialog" aria-modal="true"`
  是写给读屏软件的一行**声明**，声明不产生行为——焦点仍在触发按钮上、Tab 会走到弹窗背后、
  **Esc 无效**。仓里 `FocusTrap` 早已实现 Esc / Tab 循环 / 首焦点三件事，而这里是全站**唯一**
  没接的模态。零新组件、零新 CSS。
- **新增字段翻译层 `src/lib/detailFields.ts`**（纯函数）：旧实现 `Object.entries(detail.data)`
  把「后端返回了什么」当成了「界面该显示什么」，线上实测的代价是——
  `other` 类印出 **44 字符的 percent-encoded 内部键**和 **150 字符的裸图片 URL**，
  `book` 类把 **389 字符的作者生平**挤进表格行，`music` 类印纯内部字段 `matchedTitle`，
  `movie` 类在中文界面下是一片 `year: 2025`。
  新层做三件事：9 个内部键永不显示（每键一条理由）、11 个已知键译成中英文标签、
  超过 80 字符的长文本单独成段（复用既有 `.detail-synopsis`，`styles.css` 零改动）；
  未知键**保底照印**，所以最坏结果是「没翻译」而不是「看不到」。
- **`<audio>` 补可访问名称**（`aria-label={t("歌曲试听", "Audio preview")}`）。

**界面差异**：`other` 4 行 → **1 行**；`music` 3 行 → **2 行**；`book` 8 行（含 389 字符生平）
→ 3 行翻译 + 12 行保底 + 生平独立成段；`movie` 5 行全变成中文标签。

**验证**：门禁 5/5（lint 29 problems = 基线、vitest **701 passed / 9 skipped (710)**，+27），
红队 ×4 全红，线上 Version `bcbd52d4-5054-42df-a8fb-885bcd046597`，四类响应键覆盖线上实测通过。

**未验**：弹窗的 Esc / 焦点行为与英文界面渲染**留红未标 ✅**——本机无可驱动浏览器
（`%LOCALAPPDATA%\ms-playwright` 只有残留目录无可执行文件）。主包 +1325 B，
超出计划里 1 KB 的预算 325 B，经复核判定接受（压回只能删真实字段）。

## 2026-10-02 · 迭代 10/20：封面文件名判别（infobox 指向 app 图标时改用正文作品图）

**改了什么**

- **新增 `classifyArtworkFile(name)`**（`worker/other.ts`，纯函数）：判一个维基文件名
  「像不像作品封面本身」。判据**只能是文件名**——实测 `Animal_Crossing_New_Horizons.png`
  只有 248×402，比那个 316×316 的 icon 更窄，任何宽高规则都会误杀**当前正确**的封面。
  收窄到 `icon|logo|logotype|wordmark|banner|avatar|flag|placeholder|mascot|edit|star full`，
  且刻意不收旧 `SKIP` 的 `commons`（`Monument Valley, Utah, USA (…).jpg` 来自 Commons 但完全正确）。
- **四处 `page_image` 直取收口到同一把尺**，且**都不 `return null`**——它们后面本来就有下一档：
  `toWork`（真正生效的那处）、`resolveOtherCover`、`wikiPageImageAny`、`media.ts` 的 `wikiPagePoster`。
- **补上原本空着的那一档**：实测 `纪念碑谷 (游戏)` 的 `thumbnail`/`original`/`pageimages`
  **三者全空**（app 图标是非自由文件），只做「不采用图标」会把错图换成没图。新增
  `fillArticleImageNames`——**只在判定为 artifact 之后**单独发一次 `prop=images` 查询，
  从同页正文图里找文件名含作品词的候选（`Monument Valley screenshot.jpg`）。
  代价实测 +1969 B / 1–3 页；其它条目零多付。

**修好的现象**：`纪念碑谷` + `year=2014` 原本拿到 `Monument_Valley_icon_unrounded.jpg`（app 图标），
现在拿到 `Monument_Valley_screenshot.jpg`。

**顺手改掉的**：`year` 并**不**参与选图，它只是换了一道分支（`otherDetail(title, year)`）。
条目本来就选对了（band `exact`），错的只是那张图——所以这轮一个字的权重和档位都没动。

**验证**：`tsc -b` 0 · lint 29 problems（= 基线）· vitest **674 passed / 9 skipped**（+14）·
红队 ×4 全红 · 线上 Version `28126578-420f-4547-a179-4c182edb5ee3` · 零迁移 ·
主包 **逐字节不变**（410498 B，纯服务端改动）。四个对照 other 封面三轮逐字稳定。

**诚实记账**：原键 `other|纪念碑谷|monument valley|2014|4` 仍受 24h 边缘缓存保护，
今天还返图标 —— 证据取自换输入形态（`纪念碑谷(游戏)`）的新键，**加盐会破坏维基消歧**。

## 2026-10-02 · 迭代 9/20：消歧记忆（一次「让用户选」升级成「记住这个名字指哪部作品」）

**改了什么**

- **新建 `src/lib/coverMemory.ts`**（纯函数，零迁移）：把用户裁决过的事实记进 `sessionStorage`
  （`art-rank:cover-choice`，上限 100 条，**先写再淘汰**）。双键设计——精确键
  `posterMediaKey(title, english, "other", year)` 与名字键 `other-name|<title>`，
  于是「这一件我裁决过」与「同名的那几件」都能取到同一张图。`validRow` 用维基域名白名单校验
  sessionStorage（它是非可信输入）。
- **`Poster.tsx` 收口处接入**（29 处 `<Poster>` 调用点**一行不改**）：候选顺序变为
  **记忆(精确) → 作品自带 → 解析结果 → 记忆(同名继承)**。继承是**非破坏**的——只在候选全空时补位，
  所以结构上不可能把一张判对的封面换成猜的。`memorySuppliesCover` 让**裁决过的那一件不必再问上游**
  （省一次维基回源，而 other 桶只有 20/10min）。
- **接线修正**：`CoverChoice.onPicked` 签名 `(url)` → `(url, wikiTitle)`，记忆改由 `ArtworkDetail` 写。
  组件手里的键是自己拼的，与服务端 `posterMediaKey` 不同源——**写入口必须归属持有完整对象的那一层**。
- **文案跟着机制改**：旧句「已保存，之后都用你选的这一张。」在页内其实是假话（只 patch 一个对象），
  改为「这一页里所有《X》都用这一张」/「on this page now uses this cover」。

**为什么**

「消歧」原本被实现成「往一个 state 对象上打补丁」，补丁只活在被补丁的对象上：榜单、画廊、对比视图
各持自己的 `work` 拷贝，**一个都不更新**，而 UI 的注释与文案都承诺了「所有渲染过的地方同时生效」。
修法不是逐处通知（29 处），而是**记事实 + 唯一收口处读**。

**验证**

- 五道门禁 ✅：`tsc -b` exit 0 / `lint` 0 errors·29 warnings（= 基线）/ `format:check` / `vitest`
  **660 passed·9 skipped**（+24）/ `build` 410.40 kB（gzip 137.05，+1.32 raw）
- 红队 ×5 **全红**（含一个自曝的**空变异**：把 `if (x) A else B` 改写成 `if (!x) B else A` 是同一个函数，
  跑完才发现——详见 PITFALLS 4.57）
- 线上 ✅ Version `13a3eece`，**零迁移**；`worker/` 与 `shared/` **零改动**；
  A5 五个 other 封面三轮逐字稳定 5/5；写端点三闸顺序实测 403 → 401 与上一轮一致
- ❌ **A8 留红**：会话内继承只能在浏览器里验，需要 Playwright（已进台账 P1）

**已知限制**

同名不同作品仍会互相继承（用户为 `Journey` 选了 2012 版，另一件无封面的同名 `Journey` 会拿到这张图）——
缓解是「只在 `shouldOfferChoice` 本就开口时传播」+「继承只填空格」。根治要比较维基条目，
而 `wikiEntry` 从来没下发给前端。记忆只在本次会话有效，跨会话靠服务端 `poster_urls`。

---

## 2026-09-30 · 修复续二：错图不靠 SQL 双清也能作废（other 键带解析器代数）

上一条的「已知限制」说旧键错图必须 `DELETE FROM poster_urls WHERE media_key LIKE 'other|%'` 才能治，
但本机没有 `CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID`，remote SQL 只能等用户侧执行。于是把作废手段
收回代码里——**换键**而不是删行（读侧不许删数据，与 cachePurge 的代次失效同一思路）：

- **根因**：D1 `poster_urls` 行无 TTL，旧解析器写下的错图行会**永久**短路新代码。这不是 bug，
  是有意设计的持久缓存；错的是「解析器写错过之后没有办法作废」。线上实测（e044093 部署后）
  三个旧键仍返回大角鸮 / 2012 道奇 Journey / Stray 游戏封面，而同一作品的新键（english 非空值）
  全部正确——差别只在键不同，证明新解析器没问题。
- **改了哪些**：新增 `shared/posterKey.ts`——海报键的**唯一实现**（`posterKeySegment` /
  `mediaTypeForKind` / `posterKeyYear` / `posterMediaKey`），客户端（`src/components/Poster.tsx`
  的 `batchKey` 兜底与 `TYPE_BY_KIND`）与 Worker（`worker/media.ts` 转出给单条 route / 批量
  route / 读取挂载三处）共用；`other` 维度键尾部多一段 `OTHER_POSTER_GENERATION = "2"`，
  代数 +1 即旧行孤儿化。movie/book/music 保持裸键（没有同类事故，且一次推平常=全站海报重新
  回源，豆瓣侧大概率 418）。客户端兜底键原先手抄了一份竖线拼接公式，改为直接调共享函数，
  并补一条源码级测试盯「不许再手抄」。
- **为什么年份也要收进共享函数**：`normalizeYear` 只放行 1800–2200，《蒙娜丽莎》1503 在 API 层
  就被丢掉，而前端兜底键仍会拼上 1503 ——两端键差一段。`posterKeyYear` 用同一口径兜一次，
  服务端各路径本已归一（batch 走 normalizePosterItem、单条 route 自己校验），属无行为变化的对齐。
- **测试**：新增 `shared/posterKey.test.ts` ×8（三段/五段键形态、旧代数键取不到、年份同口径、
  前端不许手抄）+ `worker/posterStore.test.ts` +1（D1 里躺着旧代数错图行时，`loadPosterUrls`
  按当前键查不到、落库只写新键）；全量 514 passed·9 skipped（+9）
- **验证**：五道门禁 ✅（check/lint 0 errors/format:check/test 514·9/build 4.24s）｜ 线上 ✅
  （`4dcd622` 推送 + Cloudflare 自动部署后，cb 时间戳绕 CDN）：
  ① posters/batch **旧格式键**（english 留空，正是此前被 D1 错图短路的那批）全部改判正确——
  `other|动物森友会||2020|2` → Animal_Crossing_New_Horizons.png、`other|journey||2012|2` →
  Journey_PSN_Cover.png、`other|蒙娜丽莎|mona lisa||2` → Mona Lisa 960px、`other|inside||2016|2` →
  INSIDE_Cover.jpg；新格式键（english 非空）同样全对；单条 `GET /api/posters?q=…&type=other&year=2020`
  也走新键返回正确封面；② `/api/other/detail` 十件复测全对（动物森友会+2020、Inside+2016、蒙娜丽莎、
  塞尔达传说 王国之泪+2023、只狼+2019、黑神话 悟空+2024、艾尔登法环+2022、底特律 变人+2018、
  纪念碑谷+2014；Journey+2012 这次摘到 en 页 `Journey (2012 video game)` + Journey_Title_Poster.png，
  与 zh 页 Journey_PSN_Cover.png 同为该作封面，非错配）；③ 线上 JS bundle（index-D_X-wD8d.js）
  已含共享键实现（`normalize("NFKC")` 段 + `const …="2"` 代数 + `a>=1800&&a<=2200` 年份闸）
- **部署后首请求抖动**：刚部署完的头几个请求出现过一次异常（纪念碑谷+2014 → "List of sites in
  Jinan" 济南景点列表页、底特律 变人+2018 → 404），即刻原参重试三次全部恢复正确 → 判定为
  isolate 冷启动/上游 gsrsearch 抖动，非本批改动引入（详情链逻辑本批零改动）。**部署后复测
  请至少重试一次**再下结论
- **遗留**：孤儿行仍在表里（无害但占空间），有 CF 凭证时可择机 `DELETE ... WHERE media_key LIKE 'other|%'`
  清理；`other|%` 的行从此都带代数后缀

## 2026-09-30 · 修复续：「其他」维度三轮线上回归（同名异作 / 繁简失配 / 年份信号）

上面那条上线后逐轮线上复测，又暴露三个层层递进的缺陷，均单独推送 + 部署 + 回归：

- **根因四（省请求短路，191ec5f）**：`resolveOtherPages` 原有 `if (search !== query && hasImage) break;`——纯标题轮（gsrsearch=Journey）只要见到带 `pageprops.page_image` 的页就跳过「Journey 电子游戏」类型词轮，而风旅人只在类型词轮出现（线上 `/api/other/list?key=Journey 电子游戏` 首位即风旅人）。结果年份择优根本选不到正确页，Journey 详情仍返回《西遊記 (無綫1996年電視劇)》。**修法**：删短路，两轮都跑（同页仍去重）
- **根因五（封面与详情两张皮，eb11566）**：同作品详情对、封面错（蒙娜丽莎→Stray 游戏封面、塞尔达→林克 E3 照片）——封面链（评分择优）与详情链（精确标题直查）精度不同。**修法**：`computePosters` other 第一档改走 `otherDetail(title, year)`，封面与详情弹窗同一页同一图；`toWork` 海报改 `thumbnail ?? original ?? fileUrl`（original 优先会返回 Commons 数十 MB 全尺寸扫描件）
- **根因六（zh 繁简失配 + 年份信号取错，8e9d2f6 + e044093）**：zh 维基条目名是繁体（動物森友會/薩爾達傳說 王國之淚）、用户简体输入，`compactTitle` 只去标点+小写不转简繁 →「页标题含用户词」这条最强消歧信号**永不亮**，作品页与角色页/系列页同分，谁排前全看 gsrsearch 排序抖动（线上同一请求先对后错）。**修法**：`compactTitle`/`wikiKey` 先过 `T2S_SOURCE` 繁简表归一，`scoreOtherPage` 标题改三级（剥括号后：裸标题 equal +4 / startsWith|endsWith +3 / 整体包含 +1）。动物森友会 2020 仍摘到角色页「傑克 (動物森友會)」（猫图）→ 真正原因是年份信号取错：摘要首年对作品页和角色页都不可靠（2020 正作首年=2018 公布年、角色页首年=2020）。**修法**：删「摘要首年≠用户年份 −2」，改「**条目名**自带年份 ≠ 用户年份 −4」（标题年份才是本体年份：西遊記 (無綫1996年電視劇)；正则 `/(?:1[5-9]|20)\d{2}/` 不带 `\b`——中文旁汉字时 `\b` 永不成立）
- **验证（e044093 部署后，cb 时间戳绕 CDN 3600s）**：`/api/other/detail` 十件全对——动物森友会→集合啦！動物森友會 + Animal_Crossing_New_Horizons.png、Inside→Inside (游戏) + INSIDE_Cover.jpg、Journey→风之旅人 + Journey_PSN_Cover.png、蒙娜丽莎、塞尔达传说 王国之泪、只狼、黑神话 悟空、底特律 变人、纪念碑谷、艾尔登法环；posters/batch 未缓存新键也全对
- **测试**：worker/other.test.ts 增至 ×13（新增：类型词轮不可跳过、繁简失配下作品页压过角色页、动物森友会 2020→集合啦！動物森友會）
- **已知限制**：D1 `poster_urls` 侧表无 TTL，**旧键**仍会短路新代码返回旧错图（`other|动物森友会||2020`→大角鸮、`other|journey||2012`→道奇汽车、`other|蒙娜丽莎|mona lisa|`→Stray 封面），须 `DELETE FROM poster_urls WHERE media_key LIKE 'other|%'` + 清海报缓存；另：本机到 wikipedia 全系域名 DNS 污染，复测只能走线上端点，本机无 `CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID` 无法执行 remote SQL，双清须用户侧做

## 2026-09-30 · 修复：「其他」维度封面/详情错配（游戏品类）

用户清单条目（动物森友会 2020 / Inside 2016 / Journey 2012）线上复现三类错配，逐一定诊修复。

- **根因一（取图链）**：`pageimages` 的默认 free 档对商品化封面**政策性恒空**（动物森友会/Inside/Journey 的 pageimage 全空），旧链只能靠 `images→imageinfo` 在文章文件列表里翻；翻取时又以 `files[0]` 兜底，动物森友会因此命中文章配图**大角鸮照片**、蒙娜丽莎命中**同页拉斐尔像**、Journey 命中**2012 Dodge Journey 汽车**。而 infobox 封面文件名一直躺在 `pageprops.page_image` 里——**非自由封面也有值**，实测 Inside(游戏)=INSIDE_Cover.jpg、風之旅人=Journey_PSN_Cover.png、集合啦！動物森友會=Animal_Crossing_New_Horizons.png，只需补一次 imageinfo 换 URL
- **根因二（消歧）**：`otherDetail`/`otherSearch` 全靠 opensearch 首条直进——动物森友会命中系列页、Inside 命中消歧页（year=1999）。改为「gsrsearch 评分择优 + `pageprops.disambiguation` 机械剔除消歧页 + 标题分隔符变体精确直查」；**年份是消歧最硬信号**（用户清单格式「标题 - 游戏 (年)」）：给了年份就优先摘述命中年份的条目，动物森友会由此越过系列页/2001 首作落到 2020 正作（年份信号历经三版迭代，终态=「**条目名**自带年份 vs 用户年份」，见下条）
- **根因三（opensearch 盲区）**：zh opensearch("动物森友会") 只回 6 个简体错页、opensearch("Journey") 把 Journey(EP專輯) 排在游戏页前——换成 gsrsearch + 评分（页标题含用户词 +3/条目名带限定词 +3/类型词 +2/infobox 封面 +1.5/深度 +1/系列消歧语式 -3/年份命中 +2）
- **改了哪些**：`worker/other.ts` 重写取图与选页链（新增 `resolveOtherCover`、`wikiFileThumbUrls`、`OTHER_TYPE_WORDS`；`otherDetail`/`otherSearch`/`wikiPageImageAny` 补 pageprops/消歧剔除/变体/评分择优；`wikiPageImageAny` 删 `files[0]` 兜底）；`worker/media.ts` other 分支以 `resolveOtherCover` 打头、`searchWikiPoster` 的 exact/gsrsearch 加 `pageprops` 并把选图扩到 page_image、消歧页剔除；`worker/index.ts` `/api/other/detail` 与 `/api/artwork/detail?kind=other` 接收 `year`；`src/App.tsx` other 详情请求带上 `work.year`
- **顺手订正（2026-09-28 台账的误判）**：`files[0]` 兜底与 `SKIP` 曾被认为命中 series/franchise 首页词的高频图，实测只是**文件名字母序巧合**
- **测试**：新增 `worker/other.test.ts`（×13，fetch 桩录像级 fixture，离线；含三轮线上回归补的用例：类型词轮不可跳过、繁简失配下作品页压过角色页、动物森友会 2020→集合啦！動物森友會）：年份摘页、消歧页剔除、同名异作跨过（西遊記 extract 含 2012）、详情改走搜索、候选海报补齐、infobox 封面优先、文件名关键词匹配/无命中返回 null
- **已知限制**：线上复测（部署后）新链在**未缓存键**上全部正确——`风之旅人|Journey|2012`→Journey_PSN_Cover.png、`纪念碑谷|Monument Valley|2014`→Monument_Valley_icon_unrounded.jpg（游戏 infobox 封面，非真实地貌照片）、`/api/other/detail?name=动物森友会&year=2020`→集合啦！動物森友會；但 D1 里的**旧键**（`other|动物森友会||2020` 大角鸮照、`other|journey||2012` 道奇汽车）会短路新代码，须双清 poster_urls（`DELETE ... WHERE media_key LIKE 'other|%'`）+ 清海报缓存。另：zh gsrsearch("Journey") 会把《西遊記》排很前（其 extract 含 2012 重播）→ 先加严为「条目自身首个年份≠用户年份就降权 + pickBest 三档择优」，e044093 改为「条目名自带年份」信号，详见上一条

## 2026-09-30 · 优化冲刺 Phase 7 · 文化年度报告（Wrapped 年鉴卡）

「我的文化索引」侧栏新增「年度年鉴 PNG」——印刷年鉴风格的可导出统计海报：

- **数据边界（设计前已确认）**：decisionLog / cycleEvents 只存在于进行中排序草稿（art-rank:draft:v2 全量 RankingState 序列化），完成的画像里没有——年鉴主体用画像统计（复用 galleryStats：榜单/作品/创作者/年代跨度/媒介占比/年代分布），「取舍次数 + 最纠结一对」从草稿条件性附加（无草稿时省略该节，卡片不缺角）
- **新增 `lib/wrapped.ts`**：buildWrappedStats（媒介占比百分比/年代 Top6，×2 单测）+ draftInsight（最纠结一对 = cycleEvents observations 最高且 ≥2 的成员对，id→标题经草稿 collection.works 解析，解析不到宁缺毋错，×4 单测）+ readDraftLike（防御式解析，×2 单测）
- **新增 `renderWrappedPng`/`wrappedFileName`**（exportPng.ts）：主题感知调色板复用既有 samplePalette/resolveColor；版式 = 报名双线页眉 → 画像名大字 → 英雄数字带（榜单/作品/年代跨度）→ 媒介占比堆叠条（维度色）→ 年代分布条形 → 进行中节（取舍大数字 + 最纠结一对）→ 榜单速览（各榜 Top3）→ 页脚；2x 导出
- **入口**：画像页侧栏「年度年鉴 PNG」按钮（exportWrapped 按需加载两模块，不进首屏关键路径）
- **验证**：五道门禁绿（492 passed·9 skipped，+8 例）；本地静态服务烟测实锤——注入画像+含回环草稿，捕获生成的 blob（2400×2620 @2x）页面渲染逐节核对（英雄数字/堆叠条/年代条/最纠结一对 花样年华↔The Substance 反转 3 次/榜单速览/页脚全部正确）；线上验证随推送进行

## 2026-09-29 · 修复：catalog/setup 排序模式无法更改

用户报障。**根因**：排序三模式上线时（d47c444）引入——`SetupView` 的 `rankMode` 是每次渲染时直接读 localStorage 的普通变量，点击模式按钮的 `setRankMode` 只写 localStorage、不触发任何 React 状态更新，组件不重渲染，分段按钮高亮与提示文案永远停在原处。实际 localStorage 已写入、起跑时 `useSorting` 也能读到新值，但用户视觉上「点了没反应」。

**修复**：`rankMode` 改为 `useState`（惰性初始化读 localStorage，非法值回退 classic），点击同时 setState + 持久化，高亮/提示立即联动。

**验证**：五道门禁绿（484 passed·9 skipped）；本地实机：点击高亮立即切换 + localStorage 写入 + 提示文案联动，重进 setup 后按存储值恢复，开始相遇页头显示所选模式（端到端）。线上实机验证通过（sort.logicc.top，d0120b2）。

## 2026-09-28 · 修复两批：「其他」维度封面/详情 + AI 点评截断

用户报障两批，均已确诊修复：

### ① 「其他」维度的作品没有封面和详情
- **封面根因**：海报管线对 other 一直不解析（`TYPE_BY_KIND.other` 映射到 movie、`mediaTypeForKind("other")` 返回 null、`computePosters` 无 other 分支）——「其他」维度作品在所有界面只有图标兜底；更早还有正确性问题：old 映射把 other 当 movie 查豆瓣，会错误匹配到同名电影海报
- **修复（最终形态，五段链路）**：管线全面放行 type=other（posterStore/media/index 三处白名单 + `TYPE_BY_KIND.other="other"`）；`computePosters` other 分支取图链——① searchWikiPoster 评分匹配（free 档自由图：蒙娜丽莎实测教训——用户简体「蒙娜丽莎」vs 条目「蒙娜麗莎」会被逐字评分 -1 过滤，故 langlinks 英文标题补匹配 + wikiImageUrl 缩略档优先 [commons 原始扫描件数十 MB 列表位加载不动]）② zh 主图直取（pageimages 对非自由封面政策性恒空，走 images→imageinfo 拿本地托管文件——游戏封面唯一天然来源；标题变体空格/全角冒号一并解析，条目与文件选择均剥分隔符+按标题关键词优选，防「底特律 变人→底特律市」「蒙娜丽莎→拉斐尔卡斯蒂廖内像」错配）③ en 主图直取（先于 en 评分匹配：en free 档的「相关自由图」[塞尔达实测命中系列 logo] 会抢在 infobox 封面前）④ en searchWikiPoster ⑤ otherDetail 变体容错。曾试 `pilicense=any` 一步到位——实测该参数使 pageimages 查询整体失效，已还原。顺带移除已废弃的百度百科 openapi 调用（恒返回 errno 6，纯拖 8s 超时）。线上实测：蒙娜丽莎（正确原画 1280px 缩略）、艾尔登法环/辐射 4/塞尔达（非自由封面）、只狼均命中
- **详情根因**：`openArtworkDetail` 的 other 分支 20s 超时——维基 zh→en 兜底链冷缓存实测可超 25s，本可成功的详情被掐成「暂时没有更多资料」。放宽到 30s。线上实测：艾尔登法环详情 386 字简介 + 大图海报正常
- **测试**：posterStore 语义翻转（other → "other"）+ normalizePosterItem other 合法条目，×2 更新/新增
- **已知限制（记台账）**：① 取图长尾质量——同名概念/人物条目可能取到语义不符的图（无类型词表可依），经海报失败上报观察；② 负缓存 24h——管线灰度期解析失败的标题 24h 内不出图，可在设置「清除服务端缓存→海报」推进代次立即重试

### ② AI 点评截断（超出一定字数不显示）
- **根因**：`worker/ai.ts MAX_OUTPUT_CHARS=2000` 输出字符硬截断——deep 档 500 字 + 三段序号结构轻松超 2000 字符被拦腰斩（`maxTokens` 此前已按档位放宽，但字符顶没动）
- **修复**：`CallOptions.maxOutputChars`（默认 2000 保持其他调用方不变）；`/api/insights` 按档位放宽——字符 brief 2500 / standard 5000 / deep 9000，maxTokens 同步 brief 2000 / standard 3500 / deep 6000（推理模型 reasoning 段与正文共享预算）
- **测试**：`callAi` 默认 2000 + maxOutputChars 覆写生效，绊线 ×2

## 2026-09-28 · 优化冲刺 Phase 6 · 相遇页「预测分歧」洞察（Jev）

比较页新增「预测分歧 · JEV」卡——「对方最出乎你意料的作品」：

- **语义**：用「我的」品味档案让 Jev 预测「我」会怎么排对方的榜单，与对方真实排名求偏差——偏差最大 Top 3 即对方的意外之爱（+N，对方排得比按我品味的预测更高）与冷遇（−N，更低）
- **零 Worker 改动**：既有 `/api/ai/jev-rank` 本身就是「profileContext=谁的品味 → 预测 works 偏好序」，predict 模式即「我的档案 × 对方合并榜单」的调用语义（计划写「加 predict 模式」，实际为纯复用，无新端点、`docs/API.md` 不变）
- **新增**：`lib/jevDivergence.ts` 偏差 Top3 纯函数（×10 单测：位置换算/越界过滤/零偏差剔除/同分按对方名次）；`JevDivergenceCard`（对齐 AiInsightCard 交互：点击才请求不预取、失败按原因分类带「去配置」入口、数据签名变化即旧结果作废防张冠李戴、榜单 <4 件提示无参考价值）；CompareView 接入（对方合并榜单与比较结果同一 merge 口径，自动/指定/三档深度全兼容）
- **验证**：五道门禁绿（481 passed·9 skipped）；本地 stub smoke 实锤（倒序 stub → 偏差 +9/−9/+7 数学正确、同分排序正确、失败路径正确显示）；真实 TypeSafe key 端到端留用户日常复核（台账依赖项）
- **备注**：`npm run worker:dev` 本地起不来系历史遗留（`DASHBOARD_HTML` 字符串导出被本地 workerd 拒绝，线上部署不受影响），smoke 改走 .tmp 静态服务 + stub

## 2026-09-28 · UI 现代化 P4 · 收尾（本地部分完成，线上验证待推送）

`docs/PLAN-ui-modernization.md` P4 的本地可完成项：

- **主题菜单分组**：调色板菜单分「经典（7）/ 新系列（4）」两组（`ThemeSwitcher.tsx` + `NEW_SERIES` 集合），11 个主题平铺不再拖长菜单；自定义主题与开场特效/布局模式组不变
- **`--ev-1/2/3` 全局补齐（PITFALLS 4.20 清偿）**：`:root` 定义三级景深公式（`--shadow-tint:#000` + 1px 内高光 / 45px 卡片影 / 80px 弹层影），aurora 块内旧定义移除（只覆写 tint 色相），gallery 本就不定义——**旧主题自此长出阴影，属计划内重立基线**：`docs/ui-baseline.json`（ui-audit）已重生成；全主题 22 张截图重拍为新基线；P1-P3 各批 zero-diff 证据以各自 commit 为界；绊线改写为「:root 三级公式 + 全文唯一」语义
- **文档收口（7→11）**：README（功能清单 + 界面设计）、FEATURES §8（主题表重写 + 回归清单）、USAGE（三处主题表述 + 开场特效补极光绸带）、THEME-PACKS §8（gallery 入内置结构主题清单，P3 已做）
- **回归**：五道门禁绿（474 passed·9 skipped，绊线 +1：菜单分组/主题数）；全主题 22 张截图肉眼抽查（modern/retro 阴影柔和、无过重投影）
- **待线上**：sort.logicc.top 实机验证（P1/P2/P3 三批一起标 ✅）+ macOS 衬线段（Songti SC/STSong）实测——需推送触发 Cloudflare 自动部署

## 2026-09-28 · UI 现代化 P3 · gallery 画廊主题（本地验证完成，线上留 P4）

新增内置主题「画廊」（`docs/PLAN-ui-modernization.md` §2.3，8 个差异组件，L1 变量 + L2 结构覆写 + L3 条件渲染）：

- **画像页 Bento 网格（L3）**：`src/components/GalleryBento.tsx`——Top1 大卡（2×2，含 2-5 名跟进行）+ 手写 SVG 维度雷达（四媒介固定轴，值=各媒介作品数占比）+ 年代堆叠条（按维度分行、段色随年代由浅入深、右端跨度刻度）+ 口味坐标（作品/创作者/榜单/年代跨度）+ 榜单索引（承接维度页签切换职能）；`grid-template-areas` 编排，≤800px 单列堆叠；数据全部由 `src/lib/galleryStats.ts` 纯函数现场聚合（×10 单测），零数据层改动
- **榜单卡片墙（L3）**：`src/components/GalleryWall.tsx`——海报正面（名次徽章 + 渐变字幕）/ 批注背面（摘录 + 批注/详情入口），hover（桌面，`media(hover:hover)` 包裹防触屏粘滞）或点按（触屏）3D 翻转；CDP 探针实证 hover 时 transform=rotateY(180°)、`preserve-3d`/`perspective:1100px` 在位；reduced-motion 降级为正反面文档流平铺（探针实证 hover 后 transform 仍 none）
- **分享卡（L3）**：ShareView 在 gallery 家族渲染「Bento 缩略」分享卡（Top1+雷达+年代+坐标，无切换语义）于榜单区之上；画像页侧栏 `.share-output` 由 L2 改为「二维码与链接并排的展签格」
- **topbar 对称报刊亭（L2）**：`display:grid` 三列——Logo 居中、导航居左、工具居右（PITFALLS 4.12 显式声明纪律）
- **弹窗/菜单（L2）**：大圆角（`--r-lg=24`）+ 无边框纯阴影（`--shadow-tint` 显式 color-mix），与 editorial 直角两极
- **广场贴纸拍立得化（L2）**：白框 + 纵排 + 居中斜体衬线标题区 + 交替微旋转（±1.15°）+ hover 立起；CDP 探针实证 column/rotate/shadow；纯 CSS，DOM 不变
- **行式榜单配套 L2**：编辑器/重排/详情弹窗/分享页仍在用的 `.ranking-list` 收编为 hairline + mono 蓝名次（去 P0.7 墨块名次牌）；**重排行 flex 守卫**：gallery 的 (0,2,1) grid 声明位于文件后部，必须以 (0,3,1) 把 P6 的 flex 覆盖要回来（PITFALLS 4.19 同源纪律，有绊线）
- **铁律遵守**：`--ev-*` 不定义（PITFALLS 4.20 基线不破坏，阴影全部显式书写）；hex 只进变量块；旧 7 主题 14 张 + editorial 系 4 张 + aurora 2 张共 **20 张截图 stash 基线法 tol=0 zero-diff**
- **验证**：五道门禁绿（test 473 passed·9 skipped）；`ui-contrast` 全对 ≥4.5（gallery 最差 6.45:1），`docs/ui-contrast.json` 已重生成；gallery 截图肉眼签收（首页/画像桌面+移动/排序/广场，卡片墙翻转由探针截图实锤）+ 新增绊线 8 条（`src/ui-fixes.test.ts` P3 describe）
- **偏差记录**：① 矩阵「年代/来源分布」的「来源」无逐作品数据（Artwork 无 source 字段），落地为「年代分布（按维度分行）+ 跨度刻度」，来源分布不做；② PNG 导出未加「bento」版式（exportPng 为 canvas 绘制域，与本主题视觉域正交），「分享卡片重设计」以 ShareView Bento 缩略 + 侧栏 QR 入网格兑现；③ 广场贴纸的拍立得形态经 fetch 桩探针验证（广场需后端数据，静态截图无帖）
- **工具链**：`ui-contrast.mjs`/`ui-shots-themes.json` 加 gallery（现 22 条）；一次性探针 `.tmp/gl-flip-probe.mjs` 未入库（同 P2 先例）
- **遗留**：sort.logicc.top 线上实机验证按计划留 P4；ShareView 分享卡需真实分享链接在线上验证

## 2026-09-28 · UI 现代化 P2 · aurora 极光主题（本地验证完成，线上留 P4）

新增内置主题「极光」（`docs/PLAN-ui-modernization.md` §2.2，7 个差异组件，L1 变量 + L2 结构覆写）：

- **首页 orb 新特效「极光绸带」**（`src/lib/orbEffects/ribbon.ts`）：柔光基座（双层 additive 球）+ 4 条 CatmullRomCurve3 绸带（各挂一个维度色）+ 600 上升粒子；遵守 ORB-EFFECTS §4 契约（四成员齐全 / 粒子 ≤1200 / additive depthWrite:false / 不监听 window / reduced-motion 冻结）；注册表新增 `RECOMMENDED_BY_THEME`（aurora→ribbon，无持久化选择时生效，既有持久化逻辑不变）
- **表面体系 玻璃 2.0**：identity/home-actions/segmented 改「ev 投影 + accent-2 内高光 + accent 外柔光」三层；`.medium-item` 保持透明扁平（设计意图）
- **topbar 悬浮胶囊导航**：sticky 脱离子页面顶线 + 玻璃胶囊 + 滚动加深 + active 胶囊底；≤540px 降级纯文字链接（规避 4.7 overflow 裁切）
- **duel 卡**：胜出辉光脉冲（`:active` 触发，reduced-motion 跳过）+ 卡角加大到 `--r-lg`
- **按钮**：conic 渐变描边 hover 流转（`@property --au-angle` 注册角度后可动画）+ primary 柔光投影
- **弹窗/菜单**：`--ev-1/2` 重写 + scrim blur(14px) 更深景深
- **进度/维度条**：渐变流光填充 + 微光头部（reduced-motion 退化纯色）
- **回归实证**：旧 7 主题 14 张 + editorial 系 4 张截图 stash 基线法 tol=0 zero-diff；aurora 首页（桌面/移动）、duel 双卡 + 辉光脉冲（按住中段截图）、进度流光肉眼签收
- **§6 验收六项全过**（CDP 探针脚本化）：plasma↔ribbon 切换 4 轮 canvases 恒 1 无 contextlost；retro/minimal/paper 下 palette 色相跟随；reduced-motion 双截图逐字节一致且画面不消失；跨 700px 断点桌面右偏 0.68 / 移动居中；localStorage 持久化；移动端 0.88 缩放
- **偏差记录**：① `--ev-1/2/3` 自 `7fb1d5c` 起被引用但从未定义（旧主题阴影实际为 none，P1 基线即此状态）——只在 aurora 块内补定义守 zero-diff，全局补齐另立基线留 P4；② 工具链截图无 orb 系 `ui-shot.mjs` 显式 `--disable-webgl` 的环境限制（modern 基线同样无），ribbon 实渲染由 CDP 探针软渲 WebGL 确认
- **工具链**：`ui-contrast.mjs`/`ui-shots-themes.json` 加 aurora（现 20 条）；aurora 对比度全对 ≥4.5（最差 7.8:1）
- **遗留**：sort.logicc.top 线上实机验证按计划留 P4

## 2026-09-28 · UI 现代化 P1 · editorial / editorial-dark 双主题（本地验证完成，线上留 P4）

新增两组内置主题「刊物 / 刊物暗色」（`docs/PLAN-ui-modernization.md` §2.1，9 个差异组件，L1 变量 + L2 结构覆写 + L3 条件渲染三层机制）：

- **首页 hero（L3 DOM 重构）**：左文右图杂志封面式；3–4 张收藏海报错落堆叠（桌面绝对定位 ±6° 旋转 + hover 展开；移动端改 scroll-snap 单张轮播，零 JS）；eyebrow 改「第一期 · 你的私人文化索引」期号；orb 隐藏；空维度由 CSS 占位色块补齐（槽位↔维度一一对应）
- **标题体系**：h1 衬线（Georgia→Songti SC→SimSun 链）+ 字重 600；区块巨型序号装饰
- **topbar**：active 项序号前缀（01 排序 / 02 画像）+ 底部通栏细线；**按钮**全圆角 pill 实色；**弹窗/菜单**显式直角 + 2px 实线框、去玻璃 backdrop
- **duel 卡（排序页）**：去卡片化——海报铺底 + 衬线标题排印，「第 N 回合」巨型衬线水印（L3 注入）；**进度**改页码排印 + 发丝轨道尺规刻度；**榜单**行式排印去卡片；**画像维度条**坐标纸细网格
- **回归实证**：旧 7 主题 × home/profile 共 14 张截图 tol=0 zero-diff（P0 基线 vs P1 对比）；editorial 桌面 4 张修复前后 0 diff；移动端 home 双主题仅轮播右缘 48px 条带与标题细线端点变化（盒模型 dump 逐项核对）
- **修复两处特异性陷阱**（各配 `src/ui-fixes.test.ts` 绊线）：① 桌面 `.ed-stack-item:nth-child(N)` 定位泄漏到移动端轮播（媒体查询不加特异性，同名类 (0,1,0) 压不过 (0,2,0)）→ 后代前缀 + nth-child 抬到 (0,3,0)；② 移动端单列网格覆写被样式表后置的基座 `.orb-hero-inner` 规则后来者胜（死代码，mobile 实测双轨 + 48px column-gap）→ 双类选择器抬到 (0,2,0)
- **工具链**：`scripts/gen-editorial-shots.mjs`（一次性 manifest 生成器）、`scripts/ui-shots-themes.json` 补 paper/editorial/editorial-dark 归档、`scripts/ui-contrast.mjs` 支持 editorial
- **遗留**：macOS 衬线回退段（Songti SC/STSong）无设备未测；sort.logicc.top 线上实机验证按计划留 P4；`--r-*` 未归零（弹窗走显式 radius:0，见 PLAN §P1 偏差记录）

## 2026-09-28 · 优化冲刺 P1-P5（滑动选择 / OG 卡片 / 品味相似度 / 路由拆包 / Jev 辅助）

### P1 移动端滑动选择
- 对战页触摸滑动：往哪边甩就选哪边（与键盘 ←/A = 左同语义）；56px 阈值 + 垂直意图否决（artwork-info 内滚与页面滚动零干扰）；拖动跟随位移直接写 transform（reduced-motion 跳过）；鼠标不启用（桌面保留点击+键盘）；触屏提示语替换键盘提示；commit 时 vibrate(10)
- 纯判定逻辑 `lib/swipe.ts`（可单测）；线上合成触摸全链路验证

### P2 分享/广场 OG 卡片
- 爬虫不发 JS——worker 对 `/share/:code` 与 `/plaza/:id` 的 HTML 请求注入 og:/twitter: 元数据：share 链接出画像名+榜单/No.1；广场帖出标题+作者+件数+首位作品海报（服务端从海报侧表解析，豆瓣域走 `/api/image` 代理让爬虫可取）
- 用户可控文本全部 HTML 转义后再进 meta；任何 DB/解析异常降级为无 OG 的普通 SPA

### P3 广场品味相似度
- `lib/similarity.ts`：Jaccard 重合 + 共同作品顺序一致度（workIdentity 匹配，与落库管线同口径）
- 卡片徽章「重合 N/3」（对方前三名在我同媒介榜单中的件数）；详情页「与你的品味重合 NN%」（共同 ≥3 件才显示，低于即噪声不渲染）

### P4 路由拆包
- SourceView/ProfileView/CompareView/ShareView/PlazaPostView 改 React.lazy + Suspense（DeferredOrb 同款）；index chunk 1072→964KB（gzip 307→279）

### P5 Jev 辅助模式（AI 代判）
- 排序中每对先经 `/api/ai/jev-pick`（Choice 二选一）预测：置信 ≥0.8 自动落位并标注「上一对由 Jev 代判 · 置信 NN%」（进决策日志可撤销）；低于阈值或复测阶段交还用户
- 开关在 AI 弹窗 Jev 区，默认关；键控竞态守卫丢弃迟到响应——绝不覆盖用户真实选择；品味上下文（既有榜单摘要）随请求带上

## 2026-09-27 · UI 全量打磨 + 移动端抢救 + Jev 集成 Phase 1（AI 快排）

### UI 打磨（全部线上验证）
- 移动端 Hero 抢救：identity 胶囊退出 v2 网格流（修复 ART/RANK 断行成 RA/NK、竖排书脊压眉标）；光球衬纸渐变；≤540px 竖排书脊转横排
- 顶栏收纳：≤540px 导航收 3 项（`:nth-child(4)`，修复匿名用户「广场」被 `:last-child` 误伤）、图标 27px、双语 320px 零溢出；设置/主题下拉改锚 topbar（修复 overflow-x 隐式裁剪下拉——「点击设置什么都看不见」）；触屏 tooltip 粘滞根治（hover:none 隐藏）；hero「继续上次进度」收编为同款 chip 并与主按钮左对齐
- 名次墨块竖排修复（36px 定宽遗留 × P0.7 padding 冲突）；重排行 5 子元素 flex 覆盖（(0,2,1) 特异性压 grid）；比较页移动端单列；广场工具栏换行；`:focus-visible` 不再改 border-radius
- 图标纪律：🗑/✓/📝/≡ 全部收编 lucide（Trash2/Check/StickyNote/Rows3/Columns3 + aria-pressed）；发布粒子色改 token

### Jev 集成 Phase 1（AI 快排）
- TypeSafe Jev（System One 决策模型）接入：准备页第三种成榜方式——单次 systemone 调用（state=品味档案+清单全文，questions=每件作品一个 Noul）对 ≤255 件打 0-1 分直接成榜
- key 用户自配（浏览器 localStorage，服务端不落盘）；worker REST 客户端走 fetchBounded 精确白名单；错误映射复用 AiError 族
- 三端点：`/api/ai/jev/test`（探活）、`/api/ai/jev-rank`（快排）、`/api/ai/jev-pick`（代判）；限流桶 ai_jev_test 5 / ai_jev 10 / ai_jev_pick 60（次/10 分钟）

## 2026-09-25 · P0/P1 安全加固 + 插件系统（主题包 / 开场特效 / 清缓存）

### 安全与数据完整性（全量回归 376 tests）
- 出站请求统一策略 `worker/outbound.ts`：精确 host 白名单、manual redirect 逐跳复核、响应字节上限（SSRF 修复）
- 扫码登录事务所有权绑定（migration 0024 `qr_transactions`）——凭证只写入发起账户
- 邮件生产缺配置 fail-closed；开发兜底需显式 `ENVIRONMENT`，验证码不再写日志
- 验证码 / OAuth exchange 条件一次性消费；注册/改密先变更后消费 + 失败补偿；Google 强制 `email_verified`
- 排序 quick 估算取整（撤销/草稿不再崩）；画像 ID/重排/合并不变量
- 批注「未提供=保留 / 显式空=清空」语义；云同步水合门 + 会话代际（防旧响应覆盖）
- Plaza：请求形状校验、post_type 不可变、条件点赞计数、评论子树删除与计数重算
- migration 0024/0025（qr_transactions + 运行时索引），本地演练可重复应用，已部署

### 插件系统
- **插拔主题包**：`docs/THEME-PACKS.md` 规范 + 导入弹窗（重建式安全注入）；内置第 7 主题「纸上擂台」
- **开场光球特效**：`docs/ORB-EFFECTS.md` 接口 + 注册表——等离子球 / 极光环场 / 呼吸黑洞（±5% 呼吸、事件视界遮挡、吸积星尘内旋），特效配色随主题联动
- **分类清缓存**：海报/文字/歌曲/其他，用户端设置菜单与管理端「缓存」页签（D1 分代失效）

### 修复
- 后台看板内联脚本模板转义错误致登录失效（2992c8c3 起）；看板图表自托管摆脱 jsdelivr
- SW 导航缓存单键污染（v3 只缓存 SPA 壳）；音乐简介百度百科泛义词条防线（歌手名守卫）；Node 22 统一（CI/engines/.nvmrc）

## 2026-09-22 · UI 全站焕新（夜间档案馆 / Nocturne Archive）

设计与工程全量改造，**功能零变更**（唯一功能新增：可选布局模式，用户自由开关）。

### 视觉
- 北极星两屏（Home/Profile）三轮迭代定稿：叠印报名、竖排书脊、目录巨号行、出血海报、名次满版墨块、CJK 首字下沉
- 九视图 + 八界面 + 壳层全量收编档案语言（hairline 秩序 / mono 编号 / 双线分区 / 纸感噪点）
- **六主题人格化**（非色彩差异 ≥2/主题）：现代·夜间档案馆 / 复古·旧式印刷所 / 极简·瑞士网格 / 简约·亲和蓝 / 古典·文学博物馆 / 赛博·终端 HUD

### 工程
- Token 体系 L1/L2 落地；散落 hex 归零；`--text-3` 对比度定案 74%→78%（WCAG AA）
- 圆角 21 值→五档；间距 8px 阶梯；字阶 ±1px 归档；阴影 36→2 两级；玻璃两级制（17 类退哑光）
- hover 浮起分级治理；对战卡四态规格；误触防护（内滚区守卫）；help 入口迁顶栏
- **可选布局模式**（`data-layout`，与主题正交）：archive（默认零变化）/ journey 胶片盘 / bento 档案格
- **回归绊线 24 条**（`src/ui-fixes.test.ts`）：全部已修事实测试级锁定

### 工具链（不进产物）
`ui-audit` 基线盘点 / `ui-shot` 批量截图（确定性种子、自证标签）/ `ui-diff` 纯 Node 像素比对 / `ui-contrast` WCAG 扫描 / `ui-normalize`+`ui-shadows` 归一化 codemod；B0/B1/b1r 三级快照基线。
