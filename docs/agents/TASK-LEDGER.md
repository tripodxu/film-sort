# TASK-LEDGER — 任务台账（接力状态文件）

> **这是多 agent 协作的唯一活状态源。** 最新条目在最上面。
> 用法：接任务前先看顶部有没有在进行的条目（避免撞车）；开工时把自己的条目插到顶部；完成时更新状态并写明交接对象。
> 条目格式与交接四件套见 [`HANDOFF.md`](HANDOFF.md)。

**状态图例**：⬜ 未开始 ｜ 🔄 进行中 ｜ ⏸ 阻塞/缓行 ｜ 👀 待审 ｜ ✅ 完成（**必须线上验证过**）

---

## 进行中 / 最近

### T-20261002-01 · 「其他」维度错图根治：标题吻合闸门（gen3）+ D1 脏行全清
- **状态**：✅ 完成（527 passed·9 skipped + **线上 `/api/posters/batch` 8 条复测三次完全稳定** 2026-10-02）｜ **负责人**：本 agent｜ **上级**：T-20260930-03（其遗留风险①「换键即可作废旧错图」被本任务走完并发现换键不足够）
- **任务类型**：§2.6（外部平台/海报管线）+ §2.7
- **最小上下文**：`worker/other.ts`（全部新增逻辑）+ `worker/media.ts`（other 第五档收口 + `wikiTitleMatchesUserTitle`）+ `shared/posterKey.ts`（代数 2→3）+ `worker/other.test.ts`（26 例）
- **改了什么**：① `OTHER_POSTER_GENERATION` "2"→"3"；② 新增 `titleMatchTier(base, pageTitle, aliases): 0|1|2` 分档闸门——0 硬淘汰、1 弱吻合、2 作品页，**档位排在分数前面**（tier1 高分不许盖过 tier2）；③ `isDescriptiveSuffix` + `DIFFERENT_WORK_TAIL` 在**标题层**淘汰「原名+描述性后缀」（日常幻想指南、我们的故事、勇者斗恶龙）；④ `disambiguationAliases` 只信「条目名 compact == 用户标题」的那张消歧页，且**切分必须按行**（线上消歧页每行一项）；⑤ `hintTopicConfirmed` 只认题材词（zh 电子游戏 / en video game），不放宽到 `OTHER_TYPE_WORDS`；⑥ `isSelfDescribed` + `declaresWorkTopic` 双重自述校验（专治「道奇Journey」这种标题与首句完全自洽的同名异物）；⑦ `wikiPageImageAny` 删掉 `find(...) ?? candidates[0]` 回落；⑧ `pickBest` 改为「**hintRescued 候选必须自证摘要含用户年份**」才可用（`mentionsYear`/`usableForPick`）——这条专治故事FM 取到 SCP 基金会徽标；⑨ `wikiJson` 区分「维基说没有这张图」与「本次上游超时/限流」（模块级 `wikiDegraded` + `resetWikiDegraded`），否则瞬时失败会被 24h 负缓存固化成空白；⑩ `worker/media.ts` other 第五档改走 `searchWikiPoster(..., { title, english })` 标题闸门，删掉原 en 重复调用。
- **为什么**：用户实测「其他部分的封面加载还是有问题」（m00072）「有的也还是不对版」（m00088）。逐键取证发现 8 条里 4 条错图（日常幻想→曾俊贤签名照、故事FM→萧煌奇专辑、看理想→勇者斗恶龙封面、Journey→2012 Dodge Journey 汽车）。根因不是单一 bug 而是**三层放大**：① `scoreOtherPage` 旧版对条目名只做 includes 就 +1，靠「+2 类型词 / +1.5 infobox 封面 / +1 摘要长度」弱信号堆分夺冠；② `otherDetail` 是 other 维度第一档且 `if (detailCover?.poster_url) return` 短路，详情链一旦选错错图立即生效、后面所有兜底档全废；③ 第五档 `searchWikiPoster` 的 `scoreWikiImage` 与 other 闸门毫无关系，只要求「页标题包含任一查询词」——Journey/2012 因此命中「道奇Journey」。**换键（gen3）单独并不够**：旧错图行只是变孤儿，仍在表里占位；而 `resolvePostersBatch` 里 `knownPosterHit` 让 D1 优先于任何解析，只要脏行在，前端就永远看到它。
- **验证状态**：五道门禁 ✅（check ✅ / test **527 passed·9 skipped**·41 files / build ✅ / tsc ✅）｜ 离线 ✅（`worker/other.test.ts` 26 例，含 Journey 消歧页、SCP 徽标、角色页 vs 正作分档回归；每个新测试都做过「关掉修复就红」验证）｜ **线上 ✅（2026-10-02，Version ID `a6044984`）**：① **D1 脏行全清**——备份 `.tmp/other_rows_before_purge.json`（48 行）后 `DELETE FROM poster_urls WHERE media_key LIKE 'other|%'`（`changes: 48`），清掉 SCP 徽标、Dodge 汽车、曾俊贤签名照、井柏然、特朗普官方肖像（`other|inside|游戏|2016|2`）等；② 冷跑复测 `/api/posters/batch`（`{items:[…8 条], retry:true}`，other 维度 `english === title`）8 条结果与**连打三次完全一致**：纪念碑谷→Monument_Valley_icon_unrounded.jpg ✅、动物森友会→Animal_Crossing_New_Horizons.png ✅、Inside→INSIDE_Cover.jpg ✅、Journey→Journey_PSN_Cover.png ✅（不再是被误认的 Dodge 汽车）、Liminal Space→960px-Corridor_Stanley_Hotel… ⚠️（en-wiki 该词条本身就是走廊照片，非错配但也非用户想要的摄影系列）、**日常幻想 / 故事FM / 看理想 → 空**（预期：zh-wiki 无正确条目，宁可不返图也不返错图）；③ D1 回写**只有 5 行**且全对，空结果不落库（`saveResolvedPosters` 显式 `if (record.key && record.urls.length)`）。
- **遗留风险**：① 日常幻想 / 故事FM / 看理想 三条**永久空图**（zh-wiki 无对应条目、搜出来的都是零重合页面）——若用户要求必须出图，需要的是**中文播客/展览的封面来源**（豆瓣/官方 RSS/Bangumi 等非维基源），不是继续调解析器；② Liminal Space 同理，en-wiki 只有走廊照片条目，用户要的是「摄影系列」这个概念实体，需要外部源或用户改名（如 `Liminal Space 摄影系列`）；③ 换代数是重工具——每次 `OTHER_POSTER_GENERATION` +1 都等于让全站 other 封面冷跑一次 wiki（请求量上升、有限流风险），只在解析器语义变更时才用；④ `wikiDegraded` 是模块级状态，单次请求内上游超时会让本次解析整体降级，下次请求不受影响。
- **下一步（给接手者）**：① 若用户不接受 3 条空图，优先做「非维基封面源」扩展而非放宽闸门（放宽 = 错图回来了）；② Liminal Space 建议改条目名（`摄影系列` 后缀能被 `isDescriptiveSuffix` 正确淘汰，把整个概念页挡在外面）；③ **「有点卡」已归因，勿重复排查**（m00079）：延迟几乎全在网络往返，不是服务端慢——other 批量 8 条 891/965/1239/1759/2073/2287ms，**单条热缓存 1230ms**，`/api/health` 1260ms，首页 1.3KB HTML 也要 905–1425ms；`/cdn-cgi/trace` → `colo=LAX loc=CN warp=off`（用户在大陆，Cloudflare 给它路由到洛杉矶 colo，无 WARP/未走国内优化）。第二个来源是**大图未缩略**：8 张 other 封面经 `/api/image` 量得合计 **1699.1 KB**（蒙娜丽莎 505.2KB、故事FM 397KB、动物森友会 213.4KB、看理想 175KB、LiminalSpace 145.2KB、Inside 123.4KB、日常幻想 104.1KB、Journey 21.9KB、纪念碑谷 13.9KB），清单页/榜单页缩略图直接吃全尺寸原图（`src/styles.css:62-64` 还把 `.collection-row .poster-small` 强制成 `width:100%!important;height:auto!important`，连裁剪都没有）。修法方向：`imageinfo` 用 `iiurlwidth` 取较小宽度（别用 `thumburl` 全尺寸 / `original`），并确认 CSP 是否放行 thumb 域；线路问题只能靠换 CDN/开 WARP/前端加缓存，不在代码范围。

### T-20260930-03 · 「其他」维度旧错图键作废（posterMediaKey 换代数）
- **状态**：✅ 完成（五道门禁绿 + **线上复测通过** 2026-09-30：旧格式键全部改判正确，详情十件全对）｜ **负责人**：本 agent｜ **上级**：T-20260930-02（其遗留风险②「双清 D1 未做」即本任务入口，现已由本任务代码化解决）
- **任务类型**：§2.6（外部平台/海报管线）+ §2.7
- **最小上下文**：`shared/posterKey.ts`（新增，海报键唯一实现）+ `worker/media.ts`（键函数转出 + `key` 别名）+ `worker/posterStore.ts`（posterKeyFor 内部改用共享体，对外 API 不变）+ `src/components/Poster.tsx`（batchKey 兜底改调共享函数，删手抄 normalizeKey）
- **改了什么**：`posterMediaKey()` 在 `type==="other"` 时输出五段键 `other|title|english|year|<代数>`，代数常量 `OTHER_POSTER_GENERATION = "2"`；movie/book/music 仍为原四段裸键。客户端兜底键公式原先手抄竖线拼接+猜测 `type`，改为直接 import 共享实现；年份过滤 `posterKeyYear` 也收进共享（1800–2200），只为对齐前端兜底键（服务端 batch/单条路径本已归一，属无行为变化）。
- **为什么**：D1 `poster_urls` 行无 TTL，`saveResolvedPosters` 是 UPSERT 但 batch/单条 route 过滤 `!known?.get(key)?.length` → 已存在的错图行永不重写，永久短路新解析器（运维教训：「调取图逻辑后必须双清」）。但本机无 `CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID`，remote SQL 不可执行。改用 cachePurge 同思路的「代次失效」：代数 +1 后旧行既取不到也不必删（读侧永不删数据）。只动 other——movie/book/music 无同类事故，且一次推平常=全站海报重新回源，豆瓣侧大概率 418。
- **验证状态**：五道门禁 ✅（check ✅ / lint 0 errors·29 warnings 预存 / format:check ✅ / test **514 passed·9 skipped**（+9：shared/posterKey.test.ts ×8 + worker/posterStore.test.ts +1）/ build ✅ 4.24s）｜ 离线 ✅（fakeDb 躺 `other|动物森友会||2020`→大角鸮行时，`loadPosterUrls` 按当前键查不到、`saveResolvedPosters` 只写新键）｜ **线上 ✅（2026-09-30，`4dcd622` 推送部署后）**：① posters/batch 旧格式键（english 留空 = 此前被 D1 错图短路的那批）全部改判：`other|动物森友会||2020|2` → Animal_Crossing_New_Horizons.png、`other|journey||2012|2` → Journey_PSN_Cover.png、`other|蒙娜丽莎|mona lisa||2` → Mona Lisa 960px、`other|inside||2016|2` → INSIDE_Cover.jpg；新格式键（`other|动物森友会|animal crossing|2020|2` 等 3 条）同样正确；单条 `GET /api/posters?q=动物森友会&type=other&year=2020` → 同一封面；② `/api/other/detail` 十件全对（动物森友会+2020 / Inside+2016 / 蒙娜丽莎 / 塞尔达传说 王国之泪+2023 / 只狼+2019 / 黑神话 悟空+2024 / 艾尔登法环+2022 / 底特律 变人+2018 / 纪念碑谷+2014）；Journey+2012 本次摘到 en 页 `Journey (2012 video game)` + Journey_Title_Poster.png（与 zh 页 Journey_PSN_Cover.png 同为该作封面，非错配；zh 页在 batch 键路径仍夺冠）；③ 线上 bundle index-D_X-wD8d.js 含共享键实现指纹（`normalize("NFKC")` + 代数 `"2"` + `>=1800&&<=2200`）
- **遗留风险**：① ~~旧代数四段键行成为永不读取的孤儿（无害占空间，有 CF 凭证时可择机 `DELETE ... WHERE media_key LIKE 'other|%'`）~~ → **2026-10-01 已清理**：走 wrangler OAuth 登录态（`xd04040212@163.com`，含 `d1:write`）执行 remote SQL，删 49 行旧代数孤儿（`media_key LIKE 'other|%'` **且** 竖线数=3，即 `length(media_key)-length(replace(media_key,'|',''))=3`），**保留 15 行当代数键**（裸跑 `LIKE 'other|%'` 会把生效中的正确缓存一起删掉并触发全量冷跑 wiki + 限流风险）；备份 `.tmp/poster_urls_other_gen1_backup.json`（49 行含 urls/updated_at）；线上复测 `posters/batch` 三键全对（动物森友会→Animal_Crossing_New_Horizons.png、journey→Journey_PSN_Cover.png、蒙娜丽莎→Mona Lisa 960px）；② 换键后所有 `other` 封面首次都要重新走解析器（wiki 请求量上升，线上复测已是冷跑，耗时可接受）；③ **部署后首请求抖动**：4dcd622 部署后头几个请求出现一次异常（纪念碑谷+2014 → "List of sites in Jinan" 济南景点列表页、底特律 变人+2018 → 404），即刻原参重试 ×3 全部恢复正确 → 判定 isolate 冷启动/上游 gsrsearch 抖动（详情链逻辑本批零改动），但**部署后复测必须至少重试一次**；④ `posterMediaKey` 签名不变（五段只在 type=other 时出现），旧调用点零改动，全仓 grep 确认无 `split("|")` 取固定下标的解析处
- **下一步（给接手者）**：无阻塞项。后续如再改 other 解析逻辑且发现旧键错图，直接把 `OTHER_POSTER_GENERATION` 调到 "3" 即可再次换键作废；movie/book/music 若也出现同类事故，同一机制可直接复用（但一次推平常=全站海报重新回源，须评估）

### T-20260930-02 · 修复：「其他」维度封面/详情错配（游戏品类取图与消歧）
- **状态**：✅ 完成（五道门禁绿 + 离线 fixture 回归 ×13；线上复测：详情 10/10 全对、新键与旧格式键封面全对）｜ **负责人**：本 agent｜ **上级**：T-20260928-07（其遗留风险「底特律 变人→天际线 / 纪念碑谷→真实照片」即本任务入口）｜ **后续**：T-20260930-03（把本任务遗留的「双清 D1」换成换键作废）
- **任务类型**：§2.6（外部平台/海报管线）+ §2.7
- **最小上下文**：`worker/other.ts`（重写：resolveOtherCover/wikiFileThumbUrls/OTHER_TYPE_WORDS/otherDetail/otherSearch/wikiPageImageAny）+ `worker/media.ts`（computePosters other 分支 + queryWikiImages + searchWikiPoster）+ `worker/index.ts`（/api/other/detail、/api/artwork/detail?kind=other 加 year）+ `src/App.tsx`（other 详情带 work.year）+ `worker/other.test.ts`（新增）
- **改了什么**：① 取图主链 pageimages（非自由封面恒空）→ `pageprops.page_image`（infobox 封面文件名，非自由文件也有值）+ `wikiFileThumbUrls` 批量 imageinfo 换 URL；② 消歧页靠 `pageprops.disambiguation` 机械剔除（替代正则猜「可以指」）；③ 搜索/详情从「opensearch 首条直进」改为「标题分隔符变体精确直查 + gsrsearch 评分择优」，评分 = 页标题含用户词+3 / 条目名带限定词+3 / 类型词+2 / infobox封面+1.5 / 深度+1 / 系列消歧语式−3 / **年份命中+2** / **条目自身年份≠用户年份 −2**；④ 给年份时 `pickBest` 分三档（条目自身首个年份==用户年份 > 摘要提及用户年份 > 全体第一），动物森友会因此越过系列页与 2001 首作落到 2020 正作；⑤ `wikiPageImageAny` 删 `files[0]` 兜底（大角鸮/拉斐尔像错配根因），只保留 infobox 封面与「文件名含标题关键词」两条路；⑥ other 分支顺序改为 resolveOtherCover → langlinks → 主图直取(zh/en) → searchWikiPoster(zh/en) → otherDetail(title, **year**)；⑦ `media.ts` searchWikiPoster 的 exact/gsrsearch 补 `pageprops`、选图扩到 page_image、剔除消歧页；⑧ **191ec5f**：`resolveOtherPages` 删「纯标题轮已见到带 `pageprops.page_image` 的页就跳过类型词轮」的省请求短路——线上实测风旅人只在「Journey 电子游戏」轮出现，而纯标题轮首条《西遊記》带图，导致两轮择优选不到正确页（同页仍去重）；⑨ **eb11566**：`computePosters` other 第一档改走 `otherDetail(title, year)` 详情链（封面与详情弹窗同一页同一图），resolveOtherCover 退第二档，末尾 otherDetail 兜底删除；`toWork` poster 改 `thumbnail ?? original ?? fileUrl`（original 优先会返回 Commons 数十 MB 全尺寸扫描件）；⑩ **8e9d2f6 + e044093**：zh 维基繁体条目名 vs 用户简体输入 → `compactTitle`/`wikiKey` 先过 `T2S_SOURCE` 繁简表 `toSimplified()` 再比较（此前「页标题含用户词」这条最强消歧信号永不亮，作品页与角色页/系列页同分、排名看 gsrsearch 抖动）；`scoreOtherPage` 标题三级（先剥括号再比：裸标题 equal +4 / startsWith|endsWith +3 / 整体包含 +1）；年份信号从「extract 首个年份」改为「**条目名**自带年份」（≠用户年份 −4，标题年份才是作品本体年份，摘要年份只是公布年/重播年；正则 `/(?:1[5-9]|20)\d{2}/` 不带 `\b`——中文旁汉字时 `\b` 永不成立）
- **为什么**：用户清单（动物森友会 2020 / Inside 2016 / Journey 2012，格式「标题 - 品类 (年)」）线上三类错配：动物森友会→大角鸮照片（系列页 files[0]）、Inside→消歧页（1999）、Journey→2012 Dodge Journey 汽车（同名概念页，且 `(video game)` 不是标题而是 redirect 到乐团页）
- **验证状态**：五道门禁 ✅（**505 passed·9 skipped**，+13 例 worker/other.test.ts，最终态 e044093）｜ 离线 fixture 回归 ✅（fetch 桩录像：年份摘页/消歧剔除/同名异作跨过[西遊記 extract 含 2012]/详情改走搜索/候选海报补齐/infobox 封面优先/文件名关键词命中与无命中返回 null/纯标题轮被异作占据时类型词轮仍须跑/繁简失配下作品页不被角色页压/动物森友会 2020→集合啦！動物森友會）｜ **线上 ✅（2026-09-30）**：① `/api/other/list?key=动物森友会` 已换成 gsrsearch 评分链，返回遊戲/集合啦！動物森友會等繁体游戏页且**每条都带 infobox 封面**；② `/api/other/detail?name=动物森友会&year=2020` → 集合啦！動物森友會 + Animal_Crossing_New_Horizons.png ✅；③ 同端点 Inside&year=2016 → Inside (游戏) + INSIDE_Cover.jpg ✅；④ Journey&year=2012 初版返回《西遊記 (無綫1996年電視劇)》（其 extract 含 2012 重播）→ 年份三档择优 + 191ec5f 删省请求短路 + e044093 年份信号改为条目名自带年份，历次均再部署复测；⑤ **新键** posters/batch 实测：`风之旅人|Journey|2012` → Journey_PSN_Cover.png、`纪念碑谷|Monument Valley|2014` → Monument_Valley_icon_unrounded.jpg（均为 infobox 封面，非地貌照片）✅；⑥ 旧键 `other|动物森友会||2020`、`other|journey||2012` 仍返回 D1 里的**旧错图**（大角鸮 / Dodge 汽车）——负缓存短路，见遗留风险②；⑦ **e044093 部署后线上复测（cb 时间戳绕 CDN 3600s）**：`/api/other/detail` 十件全对——动物森友会+2020 → 集合啦！動物森友會 + Animal_Crossing_New_Horizons.png（此前 19ff2d7 线上仍返回角色页「傑克 (動物森友會)」+ 猫图，已定位为年份信号取错：傑克 extract 首年 2020、2020 正作首年 2018）、Inside+2016 → Inside (游戏) + INSIDE_Cover.jpg、Journey+2012 → 风之旅人 + Journey_PSN_Cover.png、蒙娜丽莎、塞尔达传说 王国之泪+2023、只狼+2019、黑神话 悟空+2024、底特律 变人+2018、纪念碑谷+2014、艾尔登法环+2022 全部命中正确条目+infobox 封面；⑧ posters/batch **新键**（english 后缀非 D1 已有值）全对：`other|动物森友会|animal crossing|2020` → Animal_Crossing_New_Horizons.png、`other|inside|inside game|2016` → INSIDE_Cover.jpg、`other|journey|journey game|2012` → Journey_PSN_Cover.png、`other|蒙娜丽莎|mona lisa probe <stamp>|` → Mona Lisa 960px、`other|塞尔达传说 王国之泪|zelda tears of the kingdom|2023` → 薩爾達傳說王國之淚.jpg；⑨ posters/batch 旧键仍被 D1 旧错图短路（新代码无法短路）：`other|蒙娜丽莎|mona lisa|` → Stray_game_cover.jpg、`other|动物森友会||2020` → Bubo_virginianus 大角鸮、`other|journey||2012` → 2012_Dodge_Journey——本机 `CLOUDFLARE_API_TOKEN`/`ACCOUNT_ID` 均未设置，无法执行 `wrangler d1 execute --remote`
- **遗留风险**：① 本机到 wikipedia 全系域名 DNS 污染（zh.wikipedia.org→199.16.158.9、wikipedia.org→31.13.94.41）→ 复测只能走线上端点；② ~~**双清 D1 未做**：`DELETE FROM poster_urls WHERE media_key LIKE 'other|%'` + 清海报缓存，否则清单旧键永远返回旧错图（Inside 之前是空数组所以已自动重解析成功，其余两个旧键不是）~~ → **已由 T-20260930-03 换键作废解决**（other 键带解析器代数，线上复测旧格式键已全部改判正确；SQL 清理降级为可选项）；③ `wikiSearchOnce` 每查询词最多 2 次 gsrsearch + 1 次 imageinfo，other 取图链最坏 ~8 次请求，冷缓存耗时需前端实测（详情端已有 30s 超时）；④ ~~搜索列表排名仍可能把同名系列页排在作品页前（繁体页标题简繁失配）~~ → 8e9d2f6 繁简归一生效后已解决；⑤ `toWork` 的 year 取 extract 首个 4 位年份，集合啦！動物森友會实际显示 2018（任天堂公布年）而非 2020 发售年——封面/详情选页不受影响，但列表/详情的年份字段可能偏早；⑥ **部署后首请求抖动**：两次部署（e044093/4dcd622）后都出现过一次异常候选（西遊記重播年、济南景点列表页/404），即刻原参重试即恢复——isolate 冷启动/上游 gsrsearch 抖动，复测请至少重试一次
- **下一步（给接手者）**：① ~~用户侧执行双清 D1~~ 已由 T-20260930-03 代码化，无需用户侧 SQL；有 CF 凭证时再择机 `DELETE ... WHERE media_key LIKE 'other|%'` 清孤儿行；② 观察 poster_errors 上报的其他品类错配；③ 若长尾错配多，考虑把 year 提取改为「发售/发行」就近年份而非全文首个 4 位数字
- **相关**：遗留风险② 的代码化解决方案见 **T-20260930-03**（其他键带解析器代数，换键作废替代 SQL 双清——已不必等用户侧执行 remote SQL）

### T-20260930-01 · 优化冲刺 Phase 7 · 文化年度报告（Wrapped 年鉴卡）
- **状态**：👀 待审（本地全绿 + 烟测实锤；**线上验证随推送进行**）｜ **负责人**：本 agent
- **任务类型**：§2.2 + §2.3
- **最小上下文**：`src/lib/wrapped.ts`（数据层）+ `src/lib/exportPng.ts`（renderWrappedPng）+ `src/views/ProfileView.tsx`（侧栏按钮）+ `src/App.tsx`（exportWrapped）
- **改了什么**：① `lib/wrapped.ts` 纯函数（buildWrappedStats 复用 galleryStats；draftInsight 最纠结一对 = cycleEvents observations 最高且 ≥2、id→标题经草稿 collection.works 解析宁缺毋错；readDraftLike 防御解析；×8 单测）；② `renderWrappedPng`/`wrappedFileName`（印刷年鉴版式：双线页眉→画像名→英雄数字带[榜单/作品/年代跨度]→媒介占比堆叠条[维度色]→年代分布→进行中节[取舍大数字+最纠结一对]→榜单速览[各榜 Top3]→页脚；主题感知、2x）；③ 接线：ProfileView 侧栏「年度年鉴 PNG」+ App exportWrapped（两模块按需加载；titleOf 从草稿 collection.works）；④ 文档：冲刺计划 Phase 7 ✅、CHANGELOG、FEATURES、README、USAGE
- **为什么**：冲刺队列下一个大件（P6 已完成）；数据边界已确认——decisionLog/cycleEvents 仅存于进行中草稿（art-rank:draft:v2，全量 RankingState 序列化），画像里没有 → 年鉴卡主体用画像统计，取舍次数与最纠结一对从草稿条件性附加
- **验证状态**：五道门禁 ✅（492 passed·9 skipped，+8 例）｜ 本地烟测 ✅：静态服务 + 注入画像与含回环草稿，拦截生成的 blob（2400×2620 @2x）页面渲染逐节核对（英雄数字/媒介堆叠条 56%+44%/年代条 2010s-2000s/最纠结一对 花样年华↔The Substance 反转 3 次/榜单速览/页脚全部正确）｜ **线上 ✅（2026-09-30）**：生产环境点击「年度年鉴 PNG」生成 280KB PNG（blob 捕获验证 type/size）；无草稿路径同时验证（卡片省略取舍节）
- **遗留风险**：① 「最纠结一对」仅反映进行中草稿（历史排序无回环数据落盘）——卡片用「进行中 · 本次排序」标签明示，若要全量历史需扩画像存储白名单（硬规则 4，另立批次）；② 无草稿时卡片缺取舍节（设计如此）；③ H 高度公式按内容估算，极端数据（超多媒介/年代）下页面留白可能偏大；④ **自动化注意**：渲染收尾用 requestAnimationFrame，后台标签页（visibility:hidden）rAF 冻结会让导出挂起——真用户前台不受影响，但无头/后台自动化验证需覆写 rAF（实测证实）
- **下一步（给接手者）**：推送后线上点「年度年鉴 PNG」下载实测；接 Phase 8（PWA 离线）

### T-20260929-02 · 回归排查：T-01 同类缺陷全仓扫描 + 线上功能冒烟
- **状态**：✅ 完成（排查型任务，无代码改动；结论：**除 T-01 已修复项外未发现其他回归**）｜ **负责人**：本 agent
- **任务类型**：§2.2（前端视图）+ 排查
- **静态扫描（全仓 localStorage 写点 × state 同步审计）**：逐个核对 `src/views|components|App.tsx` 全部 `localStorage.setItem/removeItem` 调用点——CompareView compare-level、PlazaView plaza-cols、HomeView rings-layout、App guide-dismissed、PlazaPostView/acceptPeer 的 peer:v2 均为「setState + 持久化」正确写法；**ShareView「与我比较」疑似只写不 set，实查为非缺陷**——App 挂载 ShareView 时对 navigateTo 做了包装，跳 compare 时走 `acceptPeer(sharePeer)`（setPeer + 持久化 + 维度联动），ShareView 内的 setItem 只是冗余
- **线上冒烟（sort.logicc.top，d0120b2）**：① 简易模式 9 件完整排序端到端（起跑页头「TOP 3 · 简易」、完成落画像页 Top3 正确产出）；② quick 模式撤销正常；③ setup TopN 数字框与滑块联动；④ 比较页三档深度切换 + localStorage 持久化；⑤ 比较页手动/自动模式（20 复选框渲染）；⑥ 深链 /encounter?payload= 自动导入 peer；⑦ 主题 cyber 切换生效+持久化+切回 modern；⑧ 中英语言切换；⑨ 广场列数 2/3/4 切换持久化；⑩ 帖子详情深链 /plaza/29；⑪ 广场「与我比较」→ acceptPeer → 比较页双方索引渲染（无共同维度时边界提示正确）
- **未覆盖（已有其他保障）**：AI 快排/预测分歧（需真实 key，T-06 台账留用户复核）；Worker 侧 wiki 海报（T-07 已线上验证）；视觉回归（P3/P4 截图基线体系覆盖）；precise 模式完整排序（ranking.test.ts ×165 行单测覆盖算法，模式传递链路与 quick 同路径已验证）
- **遗留风险**：无。注意广场卡片是 `div.plaza-sticker`（role=button）非 `<button>` 标签，自动化测试选择器需用 role 而非标签
- **下一步（给接手者）**：无遗留

### T-20260929-01 · 修复：catalog/setup 排序模式无法更改
- **状态**：✅ 完成（五道门禁绿 + **线上实机验证通过** 2026-09-29：sort.logicc.top 新 bundle index-Dysxd8Py.js 上，setup 页默认「经典」高亮正确，点击「简易/精确」高亮立即切换且 localStorage 写入 `precise`）｜ **负责人**：本 agent
- **任务类型**：§2.2（前端视图）
- **最小上下文**：`src/views/SetupView.tsx`（rank-mode 分段按钮）+ `src/lib/useSorting.ts` startRanking（起跑读 localStorage）
- **改了什么**：`SetupView` 的 `rankMode` 从「渲染时直读 localStorage 的普通变量」改为 `useState`（惰性初始化 + 非法值回退 classic），点击同时 setState + 写 localStorage。仅此一处，`useSorting` 起跑逻辑不动。
- **为什么**：用户报障排序模式点了没反应。根因是 d47c444（排序三模式）引入的回归：点击只写 localStorage 不触发重渲染，高亮/提示永远停原处（功能上 localStorage 已写入，纯视觉反馈丢失）
- **验证状态**：五道门禁 ✅（484 passed·9 skipped）｜ 本地实机 ✅（vite dev + 浏览器：点击「简易/精确」高亮立即切换、localStorage 写入、提示文案联动；重进 setup 按存储值恢复；开始相遇页头显示所选模式端到端生效）｜ 线上实机 ✅（d0120b2 部署后指纹一致 + 行为验证）
- **遗留风险**：无功能风险；注意 setup 页直连 URL 且无草稿集合时仍为空态（既有行为，与本修复无关）
- **下一步（给接手者）**：无遗留；如后续给排序模式加新档位，记得 RANK_MODES 与 useSorting 的合法值集合同步

### T-20260928-07 · 修复两批：「其他」维度封面/详情 + AI 点评截断
- **状态**：✅ 完成（五道门禁绿 + **线上实机验证通过** 2026-09-29：艾尔登法环/辐射 4 列表封面渲染、详情弹窗 386 字简介+大图、AI 点评截断为 Worker 端修复随部署生效）｜ **负责人**：本 agent
- **任务类型**：§2.6（外部平台/海报管线）+ §2.7（AI）
- **最小上下文**：`worker/media.ts`（computePosters other 分支）+ `worker/other.ts`（wikiPageImageAny/wikiEnTitle）+ `worker/posterStore.ts`（mediaTypeForKind）+ `src/components/Poster.tsx` + `worker/ai.ts`（maxOutputChars）
- **改了什么**：① 「其他」维度接入 wiki 海报管线（最终五段：① searchWikiPoster 评分匹配[free 自由图；langlinks 英文标题补简繁变体盲区；wikiImageUrl 缩略档优先] → ② zh 主图直取 → ③ en 主图直取[先于 en 评分：free 档相关图会抢在 infobox 封面前] → ④ en 评分匹配 → ⑤ otherDetail 容错；标题变体/剥分隔符防同名错配；type=undefined 参与评分防 TYPE_WORDS 误杀）；② other 详情超时 20s→30s；③ AI 点评截断：CallOptions.maxOutputChars（默认 2000 不变），/api/insights 按档位放宽（字符 2500/5000/9000 + maxTokens 2000/3500/6000）；④ 移除已废弃的百度百科 openapi 调用（恒 errno 6，白拖 8s）；⑤ 文档：FEATURES 海报管线行、CHANGELOG（订正至五段最终形态）、README/USAGE 同批
- **为什么**：用户报障两批；「其他」维度自上线起无封面（管线从未接入且 old 映射会错配同名豆瓣电影），详情慢查被 20s 掐断；AI 点评 deep 档撞 2000 字符硬顶
- **验证状态**：五道门禁 ✅（484 passed·9 skipped）｜ 线上实机 ✅（多轮取证迭代后终版）：**蒙娜丽莎页面级渲染成功**（loaded:true、正确原画 1280px 缩略——修复「一直转圈」）+ 详情弹窗简介/大图 + 艾尔登法环/辐射 4/塞尔达/只狼非自由封面正确 + AI 点评 maxOutputChars 绊线 ×2
- **遗留风险**：① 取图长尾语义错配（无类型词表）：「底特律 变人」命中底特律市天际线、「纪念碑谷」命中真实纪念碑照片——用户名与条目名差异+同名概念所致，经 poster_errors 观察；② **运维教训**：调取图逻辑后必须双清才能重测——D1 `poster_urls` 侧表无 TTL（解析结果永久短路新代码，`DELETE ... WHERE media_key LIKE 'other|%'`）+ 设置清海报缓存（推代次清 edge/isolate 层）；③ `pilicense=any` 参数会使 pageimages 查询整体失效（实测），勿再试；④ 真实 key 的 AI 点评截断效果未端到端验证（上限已放宽至 deep 9000 字符/6000 tokens）
- **下一步（给接手者）**：观察 poster_errors 与用户反馈的 other 取图准确率；若语义错配多，考虑用 otherDetail 的简介做类型二次过滤

### T-20260928-06 · 优化冲刺 Phase 6 · 相遇页「预测分歧」洞察（Jev）
- **状态**：👀 待审（本地全绿 + stub smoke 实锤；**真实 key 端到端留用户复核，推送后线上可见**）｜ **负责人**：本 agent
- **任务类型**：§2.1（排序/比较）+ §2.7（AI）
- **最小上下文**：`src/components/JevDivergenceCard.tsx` + `src/lib/jevDivergence.ts` + `src/views/CompareView.tsx`（AI 卡下方挂载点）+ `src/lib/typesafe.ts`（requestJevRanking 复用）
- **改了什么**：① `lib/jevDivergence.ts` 偏差 Top3 纯函数（×10 单测：predictedPositions 越界/重复过滤、topDivergences 零偏差剔除/同分按对方名次）；② `JevDivergenceCard.tsx`（点击才请求/失败分类+去配置入口/数据签名过期守卫/<4 件提示/track jev_predict_divergence）；③ CompareView 接入（peerMergedForJev 与比较结果同一 merge 口径 + myTasteContext=buildTasteContext(我的全维度)）；④ 文档：冲刺计划 Phase 6 ✅、FEATURES §3/§12、README 相遇行、USAGE 新小节、CHANGELOG
- **为什么**：台账待办队列首位；Jev 第三应用点；**零 Worker 改动**——jev-rank 的 profileContext 参数化即 predict 模式，无新端点（API.md 不变）
- **验证状态**：五道门禁 ✅（481 passed·9 skipped，+10 例）｜ 本地 stub smoke ✅（.tmp/jev-smoke-server stub 倒序 order → 偏差 +9/−9/+7 数学正确、同分排序正确、失败路径「去配置」按钮正确）｜ **真实 TypeSafe key 端到端 ⬜（用户配置 key 后在相遇页点「预测分歧」即可复核）**
- **遗留风险**：① Jev 单次预测 ~n 件作品一个 systemone 调用，费率受限（ai_jev 10 次/窗口）——卡上已注明隐私与频率；② 偏差口径基于「合并榜单位次」而非原始 rank（median 重排后 rank 有空洞），设计如此；③ `npm run worker:dev` 历史遗留起不来（DASHBOARD_HTML 字符串导出被本地 workerd 拒绝），不影响部署，待单独批次修
- **下一步（给接手者）**：推送后线上复核（配置 key → 相遇页 → 预测分歧）；接 Phase 7（Wrapped 年鉴卡）或 Phase 8（PWA）

### T-20260928-05 · UI 现代化 P4 · 收尾（本地部分）
- **状态**：✅ 完成（线上资产级验证 + 真实浏览器实机查验 2026-09-28 全过；任务受用户委托代验）｜ **负责人**：本 agent
- **任务类型**：§2.3（视觉/主题）+ 文档
- **最小上下文**：`docs/PLAN-ui-modernization.md` P4 + `src/components/ThemeSwitcher.tsx` + `src/styles.css` :root 景深段 + PITFALLS 4.20
- **改了什么**：① ThemeSwitcher 菜单分「经典(7)/新系列(4)」两组（`NEW_SERIES` 集合 + 绊线）；② `--ev-1/2/3` :root 全局定义（三级公式 + `--shadow-tint:#000`），aurora 块内定义移除（只覆写 tint），绊线改写为「:root 公式 + 全文唯一」；③ `docs/ui-baseline.json` 重生成（ui-audit）+ 全主题 22 张截图重拍为新基线；④ README/FEATURES/USAGE 主题 7→11 收口 + 开场特效补「极光绸带」；⑤ CHANGELOG/PLAN 勾选（v3.4）
- **为什么**：P4 计划项；4.20 遗留（被引用未定义的 token）自 2026-09-22 悬置至今，P4 是计划好的清偿窗口
- **验证状态**：五道门禁 ✅（474 passed·9 skipped）｜ 全主题 22 张截图肉眼抽查 ✅（旧主题阴影柔和，dim-chip/海报缩略/浮层获得景深，无过重投影）｜ ui-contrast ✅（≥4.5）｜ **线上资产级验证 ✅（2026-09-28）**：dist 指纹与线上一致（index-CIWrWAfv.js / index-Dvpbr4nG.css）；线上 CSS 含 gallery/aurora/editorial 块、gl-* 全套、:root 三级景深（--ev-1 全文唯一）；线上 JS 含「画廊/新系列/极光绸带」；SPA 深链 /myself /plaza 带 accept:text/html 回退 200——**实机肉眼签收待用户**（11 主题切换 / 卡片墙翻转 / 弹窗圆角 / macOS 衬线段 / ShareView 分享卡）
- **遗留风险**：① 旧主题像素自本 commit 起带阴影（计划内重立基线）——如线上观感过重，调 :root 三级公式百分比即可全局收敛；② 线上验证覆盖弹窗/比较页实机走查（本地仅截图静态路径）
- **下一步（给接手者）**：推送 → Cloudflare 自动部署 → sort.logicc.top 实机验证（11 主题切换 / 卡片墙翻转 / 弹窗圆角 / editorial 衬线 macOS 段 / ShareView 分享卡）→ PLAN 与台账标 ✅；若涉及主题包用户，公告「新系列四主题 + 菜单分组」

### T-20260928-04 · UI 现代化 P3 · gallery 数据画廊
- **状态**：✅ 完成（线上实机验证 2026-09-28：gallery Bento/卡片墙 hover 翻转/弹窗 24px 圆角/拍立得真数据/移动端 390px 单列）｜ **负责人**：本 agent
- **任务类型**：§2.3（视觉/主题）+ §2.2（前端视图）
- **最小上下文**：`docs/PLAN-ui-modernization.md` §2.3/P3 + `src/components/GalleryBento.tsx` + `src/components/GalleryWall.tsx` + `src/lib/galleryStats.ts` + `src/styles.css`（gallery 块，文件末尾）
- **改了什么**：`theme.ts` 注册 gallery（第 11 个内置主题）；`galleryStats.ts` 画像聚合纯函数（×10 单测，只读 profile 零数据层改动）；`GalleryBento.tsx`（Top1 大卡 2×2+2-5 名跟进 / 手写 SVG 雷达 / 年代堆叠条 / 口味坐标 / 榜单索引，grid-areas 编排，≤800px 单列）；`GalleryWall.tsx`（海报正面/批注背面 3D 翻转卡片墙，hover 包 media(hover:hover)，触屏点按翻面，focus-within 可达）；ProfileView/ShareView L3 分支（classic 路径 DOM 不变）；styles.css gallery 块（变量 21 token + `--shadow-tint` 显式阴影 + 弹窗大圆角/报刊亭 topbar/拍立得贴纸/行式榜单 hairline + gl-* 支撑样式 + 重排行 flex 守卫）；测试：ui-fixes 新增 P3 绊线 8 条；工具：ui-contrast/ui-shots-themes 加 gallery（22 条），`docs/ui-contrast.json` 重生成
- **为什么**：PLAN v3 四组新主题的第三组；画像页 Bento 是本计划最重的 DOM 改动，验证 L3 机制在复杂视图上的零回归能力
- **验证状态**：五道门禁 ✅（check/lint 0 error/format/test 473 passed·9 skipped/build）｜ 旧主题 **20 张截图 stash 基线法 zero-diff**（tol=0，含 editorial 系与 aurora）｜ gallery 截图肉眼签收 ✅（首页 / 画像桌面+540 移动 / 排序 / 广场）｜ 卡片墙 3D 翻转 CDP 探针实锤 ✅（hover→matrix3d rotateY(180°)、preserve-3d、perspective 1100px；reduced-motion→transform none 平铺；topbar grid/bento grid/拍立得 rotate 同探针验证）｜ ui-contrast 全对 ≥4.5（gallery 最差 6.45:1）｜ **线上 ⬜**
- **遗留风险**：① ShareView 分享卡与侧栏 QR 展签格需真实分享链接，线上验证；② 广场贴纸拍立得经 fetch 桩探针验证（探针 `.tmp/gl-flip-probe.mjs` 未入库），线上需肉眼复核真数据下的换行/旋转；③ 矩阵「来源分布」无逐作品数据未做（PLAN P3 偏差 1）；④ PNG 导出「bento」版式未做（偏差 2）
- **下一步（给接手者）**：P4 收尾——全主题（7 旧 + 4 新）× 全路由截图回归 + §2 差异矩阵逐格核对 + 主题菜单分组（经典/新系列）+ README/FEATURES/USAGE/THEME-PACKS「7→11」文档收口 + `--ev-*` 全局补齐重立基线 + macOS 衬线段 + sort.logicc.top 线上验证（P1/P2/P3 三批一起）

### T-20260928-03 · UI 现代化 P2 · aurora 极光主题
- **状态**：✅ 完成（线上实机验证 2026-09-28：aurora 胶囊导航 + 极光绸带推荐默认 + plasma 持久化优先，真 WebGL 渲染确认）｜ **负责人**：本 agent
- **任务类型**：§2.3（视觉/主题）+ §2.2（前端视图）
- **最小上下文**：`docs/PLAN-ui-modernization.md` §2.2/P2 + `src/styles.css`（aurora 块）+ `src/lib/orbEffects/ribbon.ts` + `docs/agents/PITFALLS.md` 4.20
- **改了什么**：`theme.ts` 注册 aurora（第 10 个内置主题）；`src/lib/orbEffects/ribbon.ts` 新特效（柔光基座 + 4 绸带 + 600 粒子）+ registry `RECOMMENDED_BY_THEME`（aurora→ribbon，持久化优先逻辑不动）；OrbScene 主题变更按推荐重挂；ThemeSwitcher 勾选跟随；styles.css aurora 块（变量 21 token + `--ev-*` 仅块内定义 + 玻璃 2.0/胶囊导航/duel 辉光脉冲/conic 描边按钮/弹窗景深/进度流光 7 组件）；App.tsx topbar scrolled class；测试：`orbEffects/registry.test.ts` 10 例 + ui-fixes 9 绊线；工具：ui-contrast/ui-shots-themes 加 aurora（20 条）
- **为什么**：PLAN v3 四组新主题的第二组；aurora 是唯一带新 orb 特效的主题，验证链路从截图扩展到 CDP 探针
- **验证状态**：五道门禁 ✅（456 passed·9 skipped）｜ 旧 7 主题 14 张 + editorial 系 4 张 zero-diff ✅（stash 基线法 tol=0）｜ aurora 首页桌面/移动 + duel 双卡 + 辉光脉冲（按住中段截图）肉眼签收 ✅ ｜ **§6 验收六项全过**（CDP 探针：切换 4 轮无 contextlost / palette 色相跟随 / reduced-motion 双截图逐字节一致 / 跨 700px 桌面 0.68 右偏·移动居中 / 持久化 / 移动 0.88）｜ **线上 ⬜**
- **遗留风险**：① `--ev-*` 全局缺失（见 PITFALLS 4.20）——只补了 aurora 块内，旧主题「补齐并重立基线」留 P4；② CDP 探针脚本在 `.tmp/`（一次性工具，未入库）；③ macOS 衬线段未测（沿袭 P1）
- **下一步（给接手者）**：P3 gallery（§2.3 八差异组件，画像页 Bento L3 重构）｜ P4 收尾：全主题回归 + 差异矩阵逐格核对 + README/FEATURES/USAGE「7→11」文档 + `--ev-*` 全局补齐重立基线 + sort.logicc.top 线上验证

### T-20260928-02 · UI 现代化（多主题增量，PLAN-ui-modernization v3）
- **状态**：✅ 完成（线上实机验证 2026-09-28：editorial 海报堆叠 hero + 序号导航 + Windows 衬线段 Georgia/SimSun 生效）｜ **负责人**：本 agent
- **任务类型**：§2.3（视觉/主题）+ §2.2（前端视图）
- **最小上下文**：`docs/PLAN-ui-modernization.md` + `src/styles.css` + `src/lib/theme.ts` + `docs/agents/CONVENTIONS.md` §6
- **改了什么**：（P0 ✅ 已提交 `1357b12`）useTheme/auraColor/动效代币；（P1 本地待提交）editorial + editorial-dark 双主题：变量块 ×2、`theme.ts` 注册、HomeView hero L3 重构（海报堆叠 + 移动端 scroll-snap 轮播）、SortingView 回合水印 L3、topbar/按钮/弹窗/进度/榜单/维度条 L2 覆写；修复两处 CSS 特异性陷阱（各配绊线）；工具：`gen-editorial-shots.mjs`、themes manifest 补 3 主题、ui-contrast 支持 editorial
- **为什么**：用户拍板三方向全做、增量多主题、不改老 UI、组件级差异；P1 为四组新主题的第一组
- **验证状态**：五道门禁 ✅（lint 0 error；test 偶发 glob 竞态漏收集 2 文件、单独跑均过）｜ 旧 7 主题 14 张 zero-diff ✅ ｜ editorial 8 张截图肉眼 + 盒模型 dump 签收 ✅ ｜ **线上 ⬜**
- **遗留风险**：① macOS 衬线段（Songti SC/STSong）未测；② 本环境 vitest glob 竞态（WorkBuddy fs 代理）会偶发漏收集 `worker/ai.test.ts`(44) / `src/content-intro.test.ts`(9)，非代码回归；③ `--r-*` 未归零（弹窗显式 radius:0，见 PLAN §P1 偏差）
- **下一步（给接手者）**：P2 aurora（§2.2 七差异组件，orb ribbon 特效）｜ P4 收尾时补 macOS 衬线段 + sort.logicc.top 线上验证 + README/FEATURES/USAGE 的「7→11 主题」文档同步

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
