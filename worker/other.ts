// ===== "其他" 类别数据：维基百科（简介 + 图）为主 =====
// 游戏/艺术/建筑等非影书音作品没有豆瓣条目，走维基多语言。
//
// 2026-09-30 迭代，三条链路一起改造（实测 sort.logicc.top 复现的错配）：
// ① 取图主链从 pageimages（对非自由封面**恒空**）切到 pageprops.page_image
//    （infobox 封面文件名，非自由文件也有值，需再打一次 imageinfo 换 URL），
//    保留 images→imageinfo 直取做补充；
// ② 消歧页用 pageprops.disambiguation **机械剔除**，替代正则猜「可以指」；
// ③ 详情/搜索从「opensearch 首条直进」改为「标题分隔符变体 + gsrsearch 评分
//    择优」：年份硬过滤（用户给了年份就优先摘述带该年份的条目）→ 限定词/
//    类型词/封面/深度打分消歧（修「动物森友会」命中系列页、「Inside」命中
//    消歧页、「Journey」命中乐团这类错配）。

const UA =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

export interface OtherWork {
  id: string;
  title: string;
  subtitle?: string;
  year?: number;
  poster_url?: string;
  content_intro?: string;
  content_source?: string;
  detail_url?: string;
}

interface WikiPage {
  title?: string;
  extract?: string;
  description?: string;
  missing?: boolean;
  /** pageprops：page_image = infobox 封面文件名（非自由封面也有值）；
   *  disambiguation = 消歧页权威标记（值为空串）。 */
  pageprops?: Record<string, string>;
  /** pageprops.page_image 换出的 URL（fillPageImageUrls 填入） */
  fileUrl?: string;
  /** 正文图片文件名（只有带 prop=images 的查询才会带这个字段） */
  images?: Array<{ title?: string }>;
  thumbnail?: { source?: string };
  original?: { source?: string };
  url?: string;
}

/** 「其他」类作品类型词（游戏/影视/绘画/建筑…）：只判断「像不像一件作品」，
 *  具体类型细分交给 declareType + TYPE_WORDS；消歧由年份/限定词/评分承担。 */
export const OTHER_TYPE_WORDS =
  /(电子游戏|電子遊戲|电子游艺|電子遊藝|電動遊戲|视频游戏|視頻遊戲|游戏|遊戲|电玩|電玩|游戏机|遊戲機|电影|電影|影片|剧情片|劇情片|动画片|動畫片|电视剧|電視劇|纪录片|紀錄片|小说|小說|长篇|長篇|短篇|专辑|專輯|唱片|歌曲|单曲|單曲|画作|畫作|绘画|繪畫|油画|油畫|素描|建築|建筑|雕塑|漫畫|漫画|歌剧|歌劇|动漫|動漫|摄影|攝影)/i;

/** gsrsearch 类型后缀：「其他」维度九成是游戏，先用游戏词收窄；
 *  艺术/建筑条目靠「纯标题轮」兜住（见 resolveOtherPages）。 */
export const OTHER_HINT: Record<"zh" | "en", string> = { zh: "电子游戏", en: "video game" };

const YEAR_RE = /\b(?:1[5-9]|20)\d{2}\b/;

/** 单条作品解析期间的上游健康记账，取代 2026-10-02 前的模块级 `wikiDegraded`
 *  全局布尔（迭代 8/20 移除）。两处缺陷叠在一起才造成线上误判：
 *  ① **作用域错**：全局 ≠ 逐条，Cloudflare 同一 isolate 内并发批次共享这一份，
 *     `resolvePostersBatch` 默认 concurrency=8 ⇒ 一条超时把它并发跑的 8 条
 *     全染成降级。2026-10-02 线上实测：确实不存在的「日常幻想」单发得 absent、
 *     同批得 throttled、下一轮同批又得 absent——**分类随批次大小改变**。
 *  ② **语义错**：旧标记只有置位没有复位、且只记失败不记成功，
 *     「上游曾经失败过」被当成了「这一次我什么都没问到」。
 *  现在改成显式传参的探针：`ok` 是「上游对我有反应」的次数（**成功/4xx 都算**），
 *  `failed` 是「这次没问到」的次数（429/5xx/超时/连接重置）。 */
export interface WikiProbe {
  ok: number;
  failed: number;
}
export function newWikiProbe(): WikiProbe {
  return { ok: 0, failed: 0 };
}

/** 单条作品的判决：只要上游**有过一次答复**就是「确实没有」而非「暂时取不到」。
 *  刻意用「至少一次成功」而不是「最后一次成功」：一条 other 的兜底链有 5 档串行，
 *  若第 1 档成功、第 5 档超时，这一条其实已经用掉了前 4 档的答复 ⇒ 应判 absent。
 *  反过来「以最后一次为准」等于「上游慢比上游快更不可信」，方向反了。 */
export function wikiProbeVerdict(probe: WikiProbe): "absent" | "throttled" {
  return probe.ok > 0 ? "absent" : "throttled";
}

async function wikiJson(
  lang: "zh" | "en",
  params: URLSearchParams,
  timeoutMs: number,
  probe: WikiProbe,
): Promise<Record<string, WikiPage> | null> {
  try {
    const r = await fetch(`https://${lang}.wikipedia.org/w/api.php?${params}`, {
      headers: { "user-agent": UA, accept: "application/json" },
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!r.ok) {
      // 429/5xx 是「再试一次可能就好了」；4xx（如无此条目）则是明确答复，
      // 记 ok 而不是 failed——维基对不存在的条目返 200+missing，4xx 极少见，
      // 但真出现时它同样是「上游对我有反应」，不能算成故障。
      if (r.status === 429 || r.status >= 500) probe.failed++;
      else probe.ok++;
      return null;
    }
    const d = (await r.json()) as { query?: { pages?: Record<string, WikiPage> } };
    probe.ok++;
    return d.query?.pages ?? null;
  } catch {
    // 超时/连接被重置：这次没问到，记 failed。
    probe.failed++;
    return null;
  }
}

/** 标题分隔符变体：用户写「底特律 变人」而条目名是「底特律：变人」。
 *  实测只有「空格」是维基 redirect，半角冒号与「空格+全角」组合都不是，
 *  必须自己拼变体一并发给 titles 一起解析。 */
function titleVariants(base: string): string[] {
  return [
    ...new Set([
      base,
      base.replace(/\s+/g, "："),
      base.replace(/\s+/g, ":"),
      base.replace(/\s+/g, ""),
    ]),
  ].slice(0, 4);
}

/** 繁体→简体常用字对照（部分表，覆盖标题/摘要高频字）。
 *  zh 维基条目名是繁体、用户输入多为简体，不转换时「标题命中」这条最强消歧信号
 *  永远不亮——实测动物森友会：作品页（集合啦！動物森友會）、角色页（傑克
 *  (動物森友會)）、系列页（動物森友會系列）同分，谁排前全看 gsrsearch 排序抖动，
 *  同一请求先后返回正确页与角色页。只收高频字，未覆盖的字原样保留，
 *  比对仍可降级成 includes。 */
const T2S_SOURCE =
  "動动,會会,遊游,戲戏,薩萨,爾尔,達达,傳传,說说,國国,淚泪,環环,麗丽,紀纪,話话,變变,隻只,雙双,風风," +
  "電电,視视,訊讯,記记,備备,檔档,櫃柜,擊击,數数,斷断,機机,權权,極极,標标,樓楼,樹树,橫横,歡欢,殺杀," +
  "殼壳,毀毁,氣气,決决,沒没,澤泽,濃浓,瀏浏,煉炼,煙烟,熱热,燈灯,牆墙,環环,療疗,癮瘾,發发,盡尽,監监," +
  "竊窃,競竞,筆笔,節节,簡简,籃篮,籠笼,類类,糧粮,紀纪,約约,級级,紅红,紙纸,紛紛,細细,終终,組组,結结," +
  "絕绝,給给,絡络,經经,維维,綠绿,網网,綿绵,縣县,罰罚,羅罗,聯联,職职,襲袭,計计,認认,語语,課课,調调," +
  "談谈,請请,識识,議议,貢贡,賞赏,賤贱,贊赞,趕赶,輪轮,辦办,辭辞,農农,適适,遷迁,鉛铅,銀银,鋪铺,鋼钢," +
  "鑽钻,隱隐,難难,霧雾,靈灵,靜静,額额,願愿,顯显,餘余,駛驶,騰腾,麵面,藝艺,藥药,補补,裝装,見见,覺觉," +
  "訂订,討讨,訓训,託托,設设,許许,評评,詞词,試试,詩诗,話话,詳详,豈岂,貓猫,貝贝,責责,貫贯,資资,賽赛," +
  "贈赠,躍跃,軍军,軟软,輸输,遲迟,釣钓,無无,獸兽,獻献,現现,畫画,異异,當当,萬万,與与,專专,業业,東东," +
  "絲丝,丟丢,兩两,嚴严,喪丧,個个,豐丰,臨临,為为,舉举,義义,烏乌,樂乐,喬乔,習习,鄉乡,書书,買买,亂乱," +
  "虧亏,雲云,亞亚,產产,親亲,億亿,勵励,區区,醫医,華华,協协,單单,賣卖,衛卫,卻却,廠厂,廳厅,歷历,壓压," +
  "壘垒,奧奥,奪夺,妝妆,婦妇,媽媽,嬰婴,嬸婶,學学,寧宁,寶寶,審审,寫写,寬宽,賓宾,對对,尋寻,導导,將将," +
  "嘗尝,嘯啸,園园,圓圆,圖图,團团,壽寿,夢梦,墳坟,墜坠,墊垫,壩坝,奮奋,獎奖,寵宠,巔巅,巖岩,鞏巩,幹干," +
  "幾几,廣广,廟庙,龐庞,棄弃,弒弑,彌弥,彎弯,彙汇,從从,態态,慶庆,憂忧,慮虑,戰战,擔担,據据,擁拥,擬拟," +
  "攝摄,敵敌,鮮鲜,鹽盐,壯壮,觸触,謝谢,謠谣,護护,讀读,變变,財财,貨货,販贩,貪贪,貧贫,窮穷,礦矿,碼码," +
  "確确,礎础,積积,種种,島岛,裡里,這这,們们,來来,時时,後后,驗验,傳传,傷伤,價价,兇凶,沖冲,準准,劃划," +
  "櫻樱,歲岁,殘残,攤摊,樣样,檢检,隻只,問问,詢询,頂顶,讓让,齊齐,齡龄,齒齿,體体,鬱郁,眾众,償偿,優优," +
  "儲储,鏡镜,鑰钥,鐵铁,銷销,錄录,錯错,鍵键,鎖锁,陣阵,陸陆,雜杂,雞鸡,雖虽,韻韵,顛颠,飄飘,饑饥,駕驾," +
  "騎骑,驅驱,驚惊,鬧闹,鳥鸟,鳳凤,鴨鸭,鵝鹅,黃黄,黨党,輩辈,萊莱,蓮莲,蕭萧,薦荐,蘇苏,蘊蕴,襯衬,規规," +
  "覽览,觀观,訪访,診诊,誕诞,誠诚,諜谍,謎谜,講讲,嫻娴,嬋婵,嬌娇,孃娘,孫孙,孿孪,層层,嶽岳,帥帅,廚厨," +
  "廟庙,廢废,廬庐,彈弹,徑径,復复,徵征,應应,憐怜,攔拦,曬晒,榮荣,構构,槍枪,橋桥,歸归,涼凉,淺浅,潤润," +
  "湯汤,灑洒,燒烧,爺爺,犧牺,獄狱,獵猎,瑪玛,睜睁,祿禄,禍祸,禪禅,範范,築筑,簾帘,籌筹,繫系,聲声,聳耸," +
  "膽胆,臉脸,臘腊,舊旧,艙舱,蓋盖,蘭兰,蠔蚝,龍龙,馬马,鴻鸿,鷹鹰,鶴鹤,灣湾,濤涛,濕湿,崗岗,巒峦,劍剑," +
  "勝胜,敗败,滅灭,藍蓝,醜丑,豔艳,晝昼,蟲虫,螞蚂,蟻蚁,蠅蝇,豬猪,葉叶,鎮镇,關关,開开,閉闭,錢钱," +
  "貴贵,聽听,聞闻,鐘钟,髮发,乾干,穀谷,儘尽,蹺跷,軋轧,輟辍,逕径,蹟迹,娛娱,媧娲,嫗妪,屢屡,嶇岖," +
  "幟帜,徑径,挾挟,捲卷,掄抡,搖摇,撐撑,搗捣,摺折,斃毙,曠旷,楓枫,櫸榉,歟欤,殮殓,氈毡,滄沧,潛潜," +
  "潑泼,瀆渎,烴烃,煙烟,煢茕,瘂哑,矓眬,磣碜,禱祷,稟禀,筍笋,篋箧,簀箦,糴籴,紐纽,繩绳,纜缆,罈坛," +
  "荊荆,蜆蚬,蝟猬,諒谅,賒赒,趙赵,躊踌,輅辂,鈣钙,錶表,鑼锣,陞升,隸隶,韁缰,頦颏,颼飕,餞饯,馭驭," +
  "驛驿,髖髋,鮫鲛,鰨鲽,黷黩,齷龌,醃腌,錠锭,鑿凿,陝陕,頷颔,餃饺,馱驮,驟骤,驢驴,髒脏,鮑鲍,鯉鲤," +
  "鰻鳗,鱷鳄,鷗鸥,鹹咸,麩麸,黴霉,齣出,傖伧,唄呗,嗩唢,囀啭,壺壶,奐奂,嫵妩,崑崙,怛怛,慄栗,懟怼," +
  "攄抒,斕斓,櫥橱,氳氲,瀝沥,燦灿,爍烁,瑋玮,瓊琼,疊叠,癡痴,瞞瞒,磧碛,禿秃,稈秆,紮扎,緝缉,纔才," +
  "縱纵,纖纤,腎肾,臢臜,荳豆,蔔卜,薜薜,蟄蛰,襪袜,訝讶,諮谘,譚谭,軀躯,輦辇,遲迟,邁迈,鑾銮,隱隐," +
  "雜杂,韻韵,壩坝,幫帮,瑩莹,瓏珑,癱瘫,皚皑,眥眦,矚瞩,磯矶,禳禳,秈籼,籲吁,糰团,絛绦,綏绥,綰绾," +
  "緲缈,緹缇,縐绉,繚缭,纏缠,羈羁,羶膻,耬耧,聒聒,臠脔,興兴,舉举,萊莱,葷荤,藍蓝,蘇苏,蘭兰,蜆蚬," +
  "蝟猬,蟯蛲,蠱蛊,衊蔑,覦觎,覬觊,覷觑,觴觞,訕讪,訣诀,詘诎,誅诛,誨诲,誦诵,諂谄,諳谙,諺谚," +
  "諼谖,謄誊,讒谗,讜谠,貲赀,賄贿,賑赈,賚赉,贍赡,轂毂,轅辕,轆辘,週周,遞递,遙遥,酈郦,鍘铡," +
  "鎇镅,鏨錾,鑌镔,陘陉,隕陨,霤溜,靨靥,韃鞑,頎颀,頫俯,顙颡,颮飑,颺飏,餒馁,饁馌,騖骛,髏髅,鮞鲕," +
  "鰌鳅,鰾鳔,鷯鹩,黌黉,壘垒,壚垆,壠垅,壞坏,壯壮,壺壶,壽寿,夢梦,夾夹,奪夺,奧奥,奩奁,奮奋," +
  "婦妇,嬤嬷,孫孙,學学,寧宁,寶寶,寬宽,對对,尋寻,導导,將将,嘗尝,嘯啸,國国,園园,圓圆,圖图,團团," +
  "墳坟,墜坠,墊垫,獎奖,寵宠,巔巅,巖岩,鞏巩,幾几,廣广,廟庙,龐庞,棄弃,弒弑,彌弥,彎弯,彙汇,從从," +
  "態态,慶庆,慮虑,擔担,據据,擁拥,擬拟,攝摄,敵敌,鮮鲜,鹽盐,觸触,謝谢,謠谣,護护,讀读,變变,財财," +
  "貨货,販贩,貧贫,窮穷,礦矿,碼码,確确,礎础,積积,種种,島岛,裡里,這这,們们,來来,時时,後后,驗验," +
  "傳传,傷伤,價价,衝冲,準准,劃划,櫻樱,歲岁,殘残,攤摊,樣样,檢检,問问,詢询,頂顶,讓让,齊齐,體体," +
  "鬱郁,眾众,償偿,優优,儲储,鏡镜,鑰钥,鐵铁,銷销,錄录,錯错,鍵键,鎖锁,陣阵,陸陆,雜杂,雞鸡,雖虽," +
  "韻韵,顛颠,飄飘,饑饥,駕驾,騎骑,驅驱,驚惊,鬧闹,鳥鸟,鳳凤,鴨鸭,鵝鹅,黃黄,黨党,輩辈,蓮莲,蕭萧," +
  "薦荐,蘊蕴,襯衬,規规,覽览,觀观,訪访,診诊,誕诞,誠诚,諜谍,謎谜,講讲,嫻娴,嬋婵,嬌娇,孃娘," +
  "孿孪,層层,嶽岳,帥帅,廚厨,廟庙,廢废,廬庐,彈弹,徑径,復复,徵征,應应,憐怜,攔拦,曬晒,榮荣,構构," +
  "槍枪,橋桥,歸归,涼凉,淺浅,潤润,湯汤,灑洒,燒烧,爺爺,犧牺,獄狱,獵猎,瑪玛,睜睁,祿禄,禍祸,禪禅," +
  "範范,築筑,簾帘,籌筹,繫系,聲声,聳耸,膽胆,臉脸,臘腊,舊旧,艙舱,蓋盖,蘭兰,蠔蚝,龍龙,馬马,鴻鸿," +
  "鷹鹰,鶴鹤,灣湾,濤涛,濕湿,崗岗,巒峦,劍剑,勝胜,敗败,滅灭,藍蓝,醜丑,豔艳,晝昼,蟲虫,螞蚂,蟻蚁," +
  "蠅蝇,豬猪,葉叶,鎮镇,關关,開开,閉闭,錢钱,髮发,乾干,穀谷,儘尽,";

const T2S_MAP = new Map<string, string>();
for (const pair of T2S_SOURCE.split(",")) {
  if (pair.length === 2) T2S_MAP.set(pair.charAt(0), pair.charAt(1));
}

/** 繁体→简体（部分表，见 T2S_SOURCE） */
export function toSimplified(value: string): string {
  let out = "";
  for (const ch of value) out += T2S_MAP.get(ch) ?? ch;
  return out;
}

/** 压缩标题：先归一到简体，再去分隔符/括号/标点。
 *  简体归一是标题比对的前提——用户简体输入 vs 繁体条目名（动物森友会 →
 *  動物森友會）不做转换则 includes 判定永不成立。 */
function compactTitle(value: string): string {
  return toSimplified(value)
    .replace(/[\s：:·・、，,。.．!！?？"'“”‘’()（）[\]【】{}_-]/g, "")
    .toLowerCase();
}

function isDisambiguation(page: WikiPage): boolean {
  return (page.pageprops ?? {}).disambiguation !== undefined;
}

/** 消歧页自列的候选条目名（`X可以指：A、B等` / `以下条目` 语式）。
 *  用户给的标题本身是消歧页时，正确作品往往是其中某个**完全不同名**的条目
 *  （Journey→風之旅人），标题闸门只能靠这份名单放行。
 *  **只信「条目名就是用户标题」的那张消歧页**——搜索结果里混进的旁支消歧页
 *  （搜「日常幻想」会带回「性幻想」）会注入一串毫不相干的别名。
 *  @param pages 本轮拿到的全部页面（精确标题轮 + 搜索轮）
 *  @param compactBase 用户标题的 compact 形态
 *  @returns 已 compact 过的小写候选名数组 */
function disambiguationAliases(pages: readonly WikiPage[], compactBase: string): string[] {
  const aliasPattern =
    /可以指[：:]|可指[：:]|以下條目|以下条目|以下为|是以下|指下列|消歧義頁|消歧义页/g;
  const out = new Set<string>();
  for (const page of pages) {
    if (!isDisambiguation(page)) continue;
    if (compactTitle(page.title ?? "") !== compactBase) continue;
    const text = `${page.extract ?? ""}\n${page.description ?? ""}`;
    // 按语式切成若干段（「...、B等事物。」），段内再按行/顿号/逗号/斜杠切。
    // **必须按行切**：线上「Journey」消歧页就是每行一项（实录
    // `Journey可以指：\n旅行者合唱團，美國搖滾樂團\n風之旅人，2012年电子游戏`），
    // 不切行会把上一项粘在候选名前面，别名永远等于「风之旅人」——线上于是
    // 让道奇Journey 冒充作品页。
    for (const part of text.split(aliasPattern).slice(1)) {
      const tail = part.split(/[。．]/, 1)[0];
      for (const name of tail.split(/[\n、，,／/｜|]/)) {
        // 去掉「等事物」「等」这类收尾、「（2012年遊戲）」这类括号限定，
        // 以及行尾的「，2012年电子游戏」这类**描述**——候选名是条目的名字，
        // 描述不属于名字。剥离后仍要留下至少 2 个字符。
        const cleaned = name
          .replace(/[，,、;；]\s*(?:\d{4}年.*|是.*)$/u, "")
          .replace(/(等(事物|作品|內容|内容)?|等。?)$/u, "")
          .replace(/[（(【[][^）)】\]]*[）)】\]]/g, "")
          .trim();
        if (cleaned.length >= 2 && cleaned.length <= 40) out.add(compactTitle(cleaned));
      }
    }
  }
  return [...out].filter(Boolean);
}

/** 「类型词轮」救援：条目名与用户标题零重合，但**它自己声明就是这个题材**。
 *  resolveOtherPages 除纯标题轮外还会跑 `${query} 电子游戏` 一轮；维基搜索
 *  把某个页面返给「Journey 电子游戏」已是一次独立证据，再要求它的摘要里
 *  真的写着「電子遊戲」，两条合起来足以放行到 tier 1——而只写「電視劇」的
 *  《西遊記》同分落选（Journey 实测：靠这一条压过 1996 电视剧）。
 *  这条只认**题材词本身**，不放宽到 OTHER_TYPE_WORDS 那种「任意类型词」：
 *  否则「看理想 电子游戏」轮里混进来的电影《日常幻想指南》会被放回来。 */
function hintTopicConfirmed(page: WikiPage, lang: "zh" | "en"): boolean {
  const text = `${page.extract ?? ""} ${page.description ?? ""}`;
  return lang === "zh"
    ? /電子遊戲|电子游戏|電視遊戲|电子遊戲|電玩遊戲/.test(text)
    : /\bvideo\s?games?\b/i.test(text);
}
/** 这个文件名像不像「作品封面本身」。
 *
 *  2026-10-02 实测逼出来的这把尺：zh 维基「纪念碑谷 (游戏)」的
 *  `pageprops.page_image` 就是 `Monument_Valley_icon_unrounded.jpg`——app 图标。
 *  真正的游戏截图 `File:Monument Valley screenshot.jpg` 就在同一页 images 里排第 7。
 *  旧代码把 `SKIP` 正则只用在 images 分支，而 page_image 直取完全无检查，
 *  于是**优先级最高的那条取图路径毫无防护**（见 resolveOtherCover 与 wikiPageImageAny）。
 *
 *  为什么不用文件尺寸判：**实测 `Animal_Crossing_New_Horizons.png` 只有 248×402**，
 *  比那个 316×316 的 icon 还窄；正确封面出 `thumbnail_unscaled`（原图小于
 *  桶宽 500）也是常态。任何「太窄太小 ⇒ 不是封面」的规则都会误杀当前的正确封面。
 *  ⇒ 唯一站得住的判据是**文件名**：这些词在维基里专指应用图标、界面图标、
 *  系列 logo、维基自身的 UI 素材，作品图一个都不带。
 *
 *  刻意不收的三个词（旧 SKIP 有、本尺没有）：
 *  · `disambig` —— 那是 `pageprops.disambiguation` 的键名，不是文件名特征
 *  · `commons` —— `Monument Valley, Utah, USA (23611451292).jpg` 来自 Commons 且完全正确
 *  · `question` —— 只命中 `File:Question book-icon.svg` 一类，icon 已覆盖
 *
 *  两处被离线黑线逼出来（或推翻）的取舍：
 *  ① 分隔符类必须含 `.` `,` `:` `;` `&` —— 否则「Monument Valley 3
 *     logotype.svg」因为 logotype 后面跟的是扩展名点而逃过判定，
 *     而它恰恰是本轮要抓的那类 Series logo。
 *  ② `icon` 两侧必须是分隔符（`Monument Valley icon unrounded` 命中，
 *     `Iconic` / `Iconf` / `Monica` 不命中）。代价：`Icon Man.jpg`
 *     （Albert Watson 1968 摄影系列）会被误判。选多数，因为 Commons 上
 *     「作品名 + icon 修饰词」远比「封面恰好叫 Icon …」常见，且两类错代价
 *     不对称——误判 artifact 只是少一张候选封面，误判 artwork 是把 app
 *     图标当封面发给用户。
 *  ③ 已知漏网：2010 年代那套 `Crystal Clear app package games.svg` /
 *     `Future film2.svg` / `Symbol support vote.svg` 条目模板图标。故意不收
 *     它们的模板名（commons 上没有作品封面叫这个，加词只会让正则更长而不
 *     改变任何真实结果）——兜底在调用点：`articleImageNames` 按
 *     /\.(jpe?g|png)$/i 过滤，svg 一律进不到「选封面」这一步。
 *     （同页的 `Star full.svg` 是个例外，由 star full/empty/half 命中。） */
const ARTIFACT_FILE_RE =
  /(^|[\s_\-()[\].,:;&])(?:icon|logo|logotype|wordmark|banner|avatar|flag|placeholder|mascot)(?=$|[\s_\-)\].,:;&])|edit[-_ ]|(?:^|[\s_])star (?:full|empty|half)/i;

export type ArtworkFileVerdict = "artwork" | "artifact";

/** 纯函数，便于离线穷举（见 worker/other.test.ts 的黑线用例）。 */
export function classifyArtworkFile(name: string): ArtworkFileVerdict {
  return ARTIFACT_FILE_RE.test(name) ? "artifact" : "artwork";
}

/** pageprops.page_image 是文件名（无 File: 前缀），imageinfo 才能换 URL */
function normFile(value: string): string {
  return value
    .replace(/^File:/i, "")
    .replace(/_/g, " ")
    .trim()
    .toLowerCase();
}

/**
 * 维基缩略图的**合法桶宽白名单**——取自官方 `$wgThumbnailSteps`
 * （`https://w.wiki/GHai` → MediaWiki:Common thumbnail sizes，2026-10-02 抓取），
 * 值为 `20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840`。
 *
 * 为什么必须是白名单而不是随便写个宽度：桶外宽度上游直接 **400**
 * `Use thumbnail sizes listed on https://w.wiki/GHai`，经 `/api/image` 代理后
 * 呈现为 502，表现为「封面随机消失」。2026-10-02 实测：桶内 11 档全部 200
 * （20px=0.7KB … 960px=505.2KB / 1280px=957.4KB / 3840px=9011.6KB），
 * 桶外 23 档全部失败。
 *
 * 语义要点（官方原文）：`iiurlwidth` 是**向上**取桶——
 * 「the thumbnail with smallest step that has larger value than requested」。
 * 所以旧代码的 `iiurlwidth:"600"` 拿到的其实是 **960px**，
 * 这就是蒙娜丽莎封面 505.2KB 的全部来历。
 */
const THUMB_BUCKETS = [20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840] as const;

/**
 * 要「不超过 maxWidth 宽」时取哪一档（保守向下取，绝不白拿大一倍）。
 *
 * 注意是**向下**取：官方 `iiurlwidth` 语义是向上（`600` → 960），
 * 那正是 505KB 蒙娜丽莎封面的来历。向下取保证「要 500 就不会拿到 960」。
 * 非有限输入（NaN / ±Infinity）一律退到最小桶，绝不静默放大。
 */
export function pickThumbBucket(maxWidth: number): number {
  const limit = Number.isFinite(maxWidth) ? maxWidth : 0;
  let best: number = THUMB_BUCKETS[0];
  for (const bucket of THUMB_BUCKETS) {
    if (bucket > limit) break;
    if (bucket > best) best = bucket;
  }
  return best;
}

/**
 * 「其他」维度的显示尺寸上限。
 *
 * 取 500 而不是旧值 600：旧值因为 `iiurlwidth` 向上取桶，落到 960px。
 * 500 是同时站得住两端的一档——
 * - 清单贴纸卡 `.collection-row .poster` 实际 369–557px（2/3/4 列 × 1120px 容器，
 *   见 `src/views/SourceView.tsx:653` 与 `src/lib/useSorting.ts:119-125`），
 *   500 对 369px 是 1.35×，1x 屏够用；
 * - 榜单行 `.poster-small` 只有 26–50px，960 对它是 25× 过量。
 * 蒙娜丽莎由 505.2KB（960px）降到 114.6KB（500px），4.4×。
 *
 * 弹窗大图（`.poster-large` 整宽）会偏糊，这是**已知且刻意接受**的代价：
 * 原图 URL 仍在候选里（`thumbnail → original` 回落顺序未变），要彻底解决得让
 * 前端把显示宽度上报服务端，见 `docs/PLAN-THUMBNAIL-SIZING.md` §5 的「不做」清单。
 */
const OTHER_THUMB_MAX_WIDTH = 500;

/** 批量把 pageprops.page_image 换成 URL（一次 imageinfo 顶 50 个文件），
 *  结果写回 page.fileUrl。media.ts 的维基评分链也要用，故导出。 */
export async function wikiFileThumbUrls(
  lang: "zh" | "en",
  files: readonly string[],
  probe: WikiProbe,
): Promise<Map<string, string>> {
  const out = new Map<string, string>();
  if (!files.length) return out;
  const asked = new Map<string, string>();
  const titles: string[] = [];
  for (const raw of files) {
    const name = raw.trim();
    if (!name) continue;
    const title = name.startsWith("File:") ? name : `File:${name}`;
    asked.set(normFile(name), name);
    titles.push(title);
  }
  for (let index = 0; index < titles.length; index += 50) {
    const q = new URLSearchParams({
      action: "query",
      titles: titles.slice(index, index + 50).join("|"),
      prop: "imageinfo",
      iiprop: "url",
      iiurlwidth: String(pickThumbBucket(OTHER_THUMB_MAX_WIDTH)),
      format: "json",
    });
    const pages = await wikiJson(lang, q, 8000, probe);
    for (const page of Object.values(pages ?? {})) {
      const infos = (page as WikiPage & { imageinfo?: Array<{ url?: string; thumburl?: string }> })
        .imageinfo;
      const url = infos?.[0]?.thumburl ?? infos?.[0]?.url;
      const title = (page.title ?? "").trim();
      const original = title ? asked.get(normFile(title)) : undefined;
      if (url && original) out.set(original, url.replace(/^http:/, "https:"));
    }
  }
  return out;
}

/** 单个封面文件名换 URL（wikiPageImageAny 用） */
async function wikiFileThumbUrl(
  lang: "zh" | "en",
  file: string,
  probe: WikiProbe,
): Promise<string | null> {
  const map = await wikiFileThumbUrls(lang, [file], probe);
  return map.get(file) ?? null;
}

/** 给候选页批量补 pageprops.page_image 的 URL（一次 imageinfo，不逐个打） */
async function fillPageImageUrls(
  lang: "zh" | "en",
  pages: WikiPage[],
  probe: WikiProbe,
): Promise<void> {
  const files = pages
    .map((page) => page.pageprops?.page_image ?? "")
    .filter((value): value is string => !!value.trim());
  if (!files.length) return;
  const map = await wikiFileThumbUrls(lang, files, probe);
  for (const page of pages) {
    const file = page.pageprops?.page_image ?? "";
    const url = file ? map.get(file) : undefined;
    if (url) page.fileUrl = url;
  }
}

/** 这一页的 infobox 封面文件名是不是「像作品封面」。 */
function isArtworkPageImage(page: WikiPage): boolean {
  const file = page.pageprops?.page_image ?? "";
  return !!file && classifyArtworkFile(file) === "artwork";
}

/** 页面正文里的图片文件名（prop=images 才带这个字段）。 */
function articleImageNames(page: WikiPage): string[] {
  return ((page as WikiPage & { images?: Array<{ title?: string }> }).images ?? [])
    .map((image) => image.title ?? "")
    .filter(
      (name) =>
        name.startsWith("File:") &&
        /\.(jpe?g|png)$/i.test(name) &&
        classifyArtworkFile(name) === "artwork",
    );
}

/** 单独给这几页补 prop=images（wikiTitlePages/wikiSearchOnce 都不带这个 prop，
 *  因为其它调用点不需要——2026-10-02 实测 gsrsearch 加它每轮 +2746 B、
 *  一条 other 最坏跑 4 轮 ⇒ +11 KB）。只在 infobox 封面被判掉后才发，
 *  实测 titles 两页 +1969 B。 */
async function fillArticleImageNames(
  lang: "zh" | "en",
  pages: readonly OtherCandidate[],
  probe: WikiProbe,
): Promise<void> {
  const titles = pages.map((entry) => (entry.page.title ?? "").trim()).filter(Boolean);
  if (!titles.length) return;
  const q = new URLSearchParams({
    action: "query",
    titles: [...new Set(titles)].join("|"),
    prop: "images",
    imlimit: "50",
    redirects: "1",
    format: "json",
  });
  const listed = await wikiJson(lang, q, 8000, probe);
  if (!listed) return;
  for (const entry of pages) {
    const title = (entry.page.title ?? "").trim();
    // api 用 titles 查回来时 key 可能是 pageid，也可能是归一后的标题
    const found =
      Object.values(listed).find((page) => (page.title ?? "").trim() === title) ?? listed[title];
    if (!found) continue;
    const names = ((found as WikiPage & { images?: Array<{ title?: string }> }).images ?? []).map(
      (image) => image.title ?? "",
    );
    if (!names.length) continue;
    const page = entry.page as WikiPage & { images?: Array<{ title?: string }> };
    // 存回 api 的形状（{title}），不是裸字符串：`articleImageNames` /
    // `wikiPageImageAny` 都按对象读，写成字符串时它们静默全空——而且
    // TypeScript 不报错，因为两边各自 cast 成自己那一套类型。
    page.images = [...(page.images ?? []), ...names.map((name) => ({ title: name }))];
  }
}

/** 文件名里带这些词 = 大概率在讲「这件作品本身」，而不是风景照/人物照/
 *  截图之外的花絮。与语言无关，所以不需要先花一次 langlinks 换英文标题。
 *  实测锚点：File:Monument Valley screenshot.jpg（纪念碑谷 (游戏) 里唯一的
 *  作品图，而同页还有 Ken wong - game developers conference cropped.jpg
 *  这类人物花絮）。 */
const ARTWORK_NAME_HINT_RE =
  /\b(screenshot|cover|box ?art|boxart|poster|key ?art|title ?screen|game ?play|capture|gameplay)\b/i;

/** 这个正文图文件名像不像在讲用户要的那件作品。沿用 wikiPageImageAny 的
 *  归一口径（剥分隔符 + 小写 + 去空格），不发明第二套相似度。 */
function articleNameMatchesWork(fileName: string, works: readonly string[]): boolean {
  const name = fileName.slice(5);
  // ① 作品词命中：与语言无关，一次请求都不用多发。实测纪念碑谷那一页
  //    唯一的作品图就靠这条捞到（中文条目 + 英文文件名 + 没有英文对应标题
  //    可查时，这是唯一可判的信号）。
  if (ARTWORK_NAME_HINT_RE.test(name)) return true;
  const compact = name
    .replace(/[\s_]/g, "")
    .replace(/[\s：:·・（）()]/g, "")
    .toLowerCase();
  return works
    .map((work) =>
      work
        .trim()
        .replace(/[\s_]/g, "")
        .replace(/[\s：:·・（）()]/g, "")
        .toLowerCase(),
    )
    .filter(Boolean)
    .some((work) => compact.includes(work));
}

/** 「以用户标题开头 + 描述性后缀」= 另一件作品，不是作品本体。
 *  中文维基的本地化正名是**把原名裹在末尾**（「集合啦！動物森友會」），
 *  而「日常幻想指南」讲的是日常幻想、本身不是日常幻想——2021 年电影，
 *  用户清单里的 日常幻想 是 2021 年展览。实测这一条靠「包含关系 +1」的
 *  弱吻合分压过所有候选，把用户绑到那部电影的条目上（签名照就是这么来的）。 */
const DIFFERENT_WORK_TAIL =
  /^(指南|电影|電影|电视剧|電視劇|游戏|遊戲|专辑|專輯|小说|小說|传记|傳記|传|傳|记|記|列传|列傳|全传|外传|前传|后传|系列|列表|年表|大事记|film|game|novel|album|book|manga|series|discography|bibliography)$/i;

/** 条目名与用户标题的吻合档位。**tier 0 是硬淘汰**（标题零重合 = 不是这件
 *  作品），tier 1/2 是吻合强度，供排序用。分档规则与 scoreOtherPage 里的
 *  标题加分（剥括号后相等 +4 / 前后缀 +3 / 互相包含 +1）一一对应，
 *  不另发明一套相似度，避免两处口径漂移。
 *  额外硬淘汰一类「蹭词」：以原名开头 + 描述性后缀（日常幻想→日常幻想指南）。
 *  线上实测三张错图的来源全部落在 tier 0：
 *   日常幻想→日常幻想指南（2021 电影）/ 故事FM→我們的故事 (專輯)（萧煌奇专辑）
 *   / 看理想→勇者斗恶龙 (游戏)。旧算法里它们靠「+2 命中类型词 +1.5 有
 *   infobox 封面 +1 摘要够长」堆 4.5 分夺冠，而正确的页面因标题不同拿 0 分。
 *
 *  `aliases` 是**消歧页自列的候选名**（`X可以指：A、B等`）。用户写「Journey」
 *  时正确条目是《風之旅人》，与 "Journey" 零字重合，只有靠这条兜住；反过来
 *  「日常幻想指南」不会出现在「日常幻想」的消歧页里，「我們的故事 (專輯)」
 *  也不在「故事FM」的候选里——所以放行别名不会把已修的三张错图放回来。 */
export function titleMatchTier(
  baseCompact: string,
  pageTitle: string,
  aliases: readonly string[] = [],
): 0 | 1 | 2 {
  const compact = compactTitle(pageTitle);
  if (!baseCompact || !compact) return 0;
  if (compact === baseCompact) return 2;
  // 剥括号限定词后完全一致：「纪念碑谷 (游戏)」「Journey (video game)」
  const bare = compactTitle(pageTitle.replace(/[（(【[][^）)】\]]*[）)】\]]/g, ""));
  if (bare === baseCompact) return 2;
  // 「用户标题 + 描述性限定词」= 作品页带题材限定：「Inside (遊戲)」。
  // 必须先排掉「原名 + 描述性词」那一类：日常幻想指南**不是**日常幻想的作品，
  // 它是一本讲日常幻想的指南，两者只差一个尾词，混进作品页会让线上取到
  // 该文内曾俊贤的签名照。
  if (bare.startsWith(baseCompact) || bare.endsWith(baseCompact)) {
    if (isDescriptiveSuffix(bare, baseCompact)) return 0;
    if (isAlternateNamePrefix(bare, baseCompact)) return 0;
    return 2;
  }
  if (compact.includes(baseCompact)) {
    // 以原名开头且后缀是描述性词 → 另一件作品（中文本地化名常把原名裹在末尾，
    // 但「日常幻想指南」是日常幻想的**指南**，讲的是前者，本身不是后者）
    if (isDescriptiveSuffix(compact, baseCompact)) return 0;
    return 1;
  }
  // 「原名 + 题材限定」（集合啦！動物森友會 ⊃ 动物森友会）与「用户标题 ⊃ 条目名」
  // （底特律 变人 ⊃ 底特律）都算弱吻合
  if (compact.length >= 2 && baseCompact.includes(compact)) return 1;
  // 消歧页列出的同名候选：只放行到 tier 1（弱吻合），仍需年份/类型/封面佐证
  if (aliases.some((alias) => alias && compact === alias)) return 1;
  return 0;
}

/** candidate 是不是「用户作品 + 描述性后缀」的蹭词页（日常幻想→日常幻想指南）。
 *  只在 candidate 以 base 开头时才判——「底特律 变人」⊃「底特律」方向相反，
 *  那是用户标题更长，不适用。 */
function isDescriptiveSuffix(candidate: string, base: string): boolean {
  if (!candidate.startsWith(base)) return false;
  const tail = candidate.slice(base.length);
  return tail.length <= 8 && DIFFERENT_WORK_TAIL.test(tail);
}

/** 标题末尾的 base 是不是**英文原名注脚**，前面另有一个中文名
 *  （「隨興旅 -That's Journey-」之于 Journey）。`isDescriptiveSuffix` 的镜像：
 *  它只审 base **之后**的尾词，于是「原名裹在末尾」这一侧完全没设防——
 *  compact.endsWith 成立就直接判了 tier 2。
 *  2026-10-02 线上实测的代价：Journey 2012 的封面取成了 2019 年连载的日本漫画
 *  《隨興旅》的 logo。它拿到 tier2（剥括号后以原名结尾 +3）、摘要够长（+1）、
 *  有 pageimages 缩略图（+1）、带类型词（+2）= 7 分，压过真正命中的 tier1
 *  《风之旅人》（5.5）。**tier 优先于分数**，1.5 分翻不了档，而真封面
 *  `Journey_PSN_Cover.png` 在 page_image 里，要等 infobox 那一步才轮得到。
 *  判据是「**括号外的拉丁注脚**」而不是「前缀里有没有原名」（实测前缀
 *  `隨兴旅thats` 里并没有第二个 journey）：
 *   · `隨興旅 -That's Journey-` / `That's Journey -隨興旅` → 前缀含拉丁字母 → 降档
 *   · `集合啦！動物森友會` → 前缀「集合啦」全中文，是本地化包装词 → 仍 tier2
 *   · `西遊記 (Journey to the West)` → 拉丁注脚在**括号内**，已被上面那层
 *     「剥括号后完全一致」判成 tier2，不走这条
 * 真正的外国作品注脚一律带括号或连字符，且括号形态已被先行覆盖，故此判据
 * 不会误杀中文本地化名。 */
function isAlternateNamePrefix(candidate: string, base: string): boolean {
  if (!candidate.endsWith(base) || !LATIN.test(base)) return false;
  const head = candidate.slice(0, candidate.length - base.length);
  return head.length > 0 && LATIN.test(head);
}

/** 拉丁字母（罗马字/英文），用于区分「中文本地化包装词」与「英文原名注脚」 */
const LATIN = /[a-z]/;

/** 摘要讲的到底是不是**用户要的那件作品**。条目名把原名裹在末尾、或在括号里
 *  蹭到原名时（傑克 (動物森友會)、集合啦！動物森友會、道奇Journey），标题层
 *  分不出「这件作品的本地化名」和「恰好同名的另一个东西」，只能看摘要。
 *  维基首句惯例两种写法：
 *   ① 作品本体 —— `《集合啦！動物森友會》是2020年…` / `《動物森友會 (遊戲)》
 *      是2001年…`：剥括号后的条目名领起首句（引号只在最前面）。
 *   ② 讲别的东西 —— `傑克是2020年遊戲《集合啦！動物森友會》的貓咪角色。`：
 *      领起首句的是「傑克」，别作的名字在句中。
 * 判据：剥括号后的条目名是否领起首句——在句首是本人，在句中是讲别人。
 * 首句缺失时无从判断，保守放行。
 * 注意这条**管不了道奇Journey**：它的首句确实以「道奇Journey」领起（自述
 * 是那台车），标题与首句都自洽，纯文本相似度永远分不出「本作」和「同名
 * 的车」——那种形状交给 declaresWorkTopic。 */
function isSelfDescribed(pageTitle: string, extract: string): boolean {
  const firstSentence = extract.split(/[。．\n]/, 1)[0] ?? "";
  const bare = compactTitle(pageTitle.replace(/[（(【[][^）)】\]]*[）)】\]]/g, ""));
  if (!bare || !firstSentence.trim()) return true;
  // 剥掉首句领起的引号/书名号（作品本体的摘要以 `《X是…` 开头）
  const head = compactTitle(firstSentence.replace(/^[「『《（(【\[]+/, ""));
  return head.startsWith(bare);
}

/** 正文讲的到底是不是一件**作品**。专治「条目名只是**结尾**蹭到原名」那一档：
 *  `道奇Journey` 与 `集合啦！動物森友會` 在标题层是同一个形状（原名裹在末尾、
 *  前面还有别的东西），titleMatchTier 只能都给 tier 2，isSelfDescribed 也都为
 *  true——两者的标题与首句都自洽。但前者自述「克莱斯勒品牌旗下的一款中型
 *  SUV」，首句里连一个作品类型词都没有；后者自述「生活模擬遊戲」。作品页
 *  按首句惯例必然声明自己是什么，所以**首句无类型词**是同名的实物/概念页的
 *  可靠信号。首句缺失时无从判断，保守放行。 */
function declaresWorkTopic(extract: string): boolean {
  const firstSentence = extract.split(/[。．\n]/, 1)[0] ?? "";
  if (!firstSentence.trim()) return true;
  return OTHER_TYPE_WORDS.test(firstSentence);
}

/** 候选页评分（详情与封面共用）。标题吻合是**准入门槛**（tier 0 直接淘汰），
 *  档位优先于分数排序——否则 tier1 的弱吻合条目能靠弱信号盖过 tier2 作品页。
 *  +4 剥括号后标题相等 / +3 标题以用户标题开头或结尾 / +1 互相包含
 *  +3 条目名带作品限定词（(游戏)/(video game)）
 *  +2 摘要命中作品类型词 +1.5 有 infobox 封面文件 +1 有 pageimages 缩略图
 *  +1 摘要够长（内容深度） -3 系列页/消歧语式（命中同类条目时压下去）
 *  消歧页（pageprops.disambiguation）直接淘汰。
 *  @returns 淘汰时 null；否则同时给出档位，调用方据此排序。 */
function scoreOtherPage(
  page: WikiPage,
  compactBase: string,
  year?: string,
  aliases: readonly string[] = [],
  hintConfirmed = false,
  lang: "zh" | "en" = "zh",
): { score: number; tier: 0 | 1 | 2 } | null {
  const title = (page.title ?? "").trim();
  if (!title || page.missing || isDisambiguation(page)) return null;
  const extract = page.extract ?? "";
  const text = `${extract} ${page.description ?? ""}`.trim();
  let tier = titleMatchTier(compactBase, title, aliases);
  // 类型词轮救援：标题零重合，但维基把这个页面返给了「<用户标题> 电子游戏」
  // 这一轮，且它自己声明确实是游戏/電視劇。放行到 tier 1，仍需年份佐证。
  if (tier === 0) {
    if (!(hintConfirmed && hintTopicConfirmed(page, lang))) return null;
    tier = 1;
  }
  const bare = compactTitle(title.replace(/[（(【[][^）)】\]]*[）)】\]]/g, ""));
  // 「同名实体页」降档：这类条目与正作同为 tier 2，靠标题分不出来，只能看摘要。
  //   - 首句主语不是条目自己 → 讲的是原作里的角色/别作（「傑克 (動物森友會)」）
  //   - 首句连一个作品类型词都没有 → 讲的是同名的实物/概念（「道奇Journey」）
  // 两条都只在「原名裹在末尾/跟在别的东西后面」这一档生效——bare 完全等于
  // 用户标题的条目本来就是用户点名的那件，不该再被摘要质疑。
  if (tier === 2) {
    if (!isSelfDescribed(title, extract)) tier = 1;
    else if (bare !== compactBase && !declaresWorkTopic(extract)) tier = 1;
  }
  let score = 0;
  if (tier === 2) score += bare === compactBase ? 4 : 3;
  else score += 1;
  if (/[（(【\[]/.test(title) && OTHER_TYPE_WORDS.test(title)) score += 3;
  if (text && OTHER_TYPE_WORDS.test(text)) score += 2;
  if ((page.pageprops ?? {}).page_image) score += 1.5;
  if (page.thumbnail?.source ?? page.original?.source) score += 1;
  if (extract.length >= 80) score += 1;
  if (/(系列|以下条目|可以指|可指|消歧义|消歧義)/.test(`${title} ${extract}`)) score -= 3;
  if (year && text.includes(year)) score += 2;
  // 条目名自带年份且与用户年份不符 → 强降权。典型：西遊記 (無綫1996年電視劇)
  // 摘要有「2012年凌晨重播」，条目本体却是 1996 年电视剧——与风之旅人同分时
  // 全靠这一刀压下去（其余信号 6.5:5.5，差 1 分不够）。
  // 注意**不能**改用「摘要首个年份」：动物森友会 2020 正作的摘要首年是 2018
  // （公布年），而角色页「傑克 (動物森友會)」的首年才是 2020——按首年判会把
  // 正作压下去、让角色页夺冠（线上实测翻车）。
  // 年份正则不带 \b：中文标题里数字前后是汉字，\b 永远不成立。
  if (year) {
    const titleYear = (title.match(/(?:1[5-9]|20)\d{2}/) ?? [])[0];
    if (titleYear && titleYear !== year) score -= 4;
  }
  return { score, tier };
}

/** 一个候选条目及其评分/档位（tier：2 作品页 / 1 弱吻合，0 已在评分里淘汰）。 */
export interface OtherCandidate {
  page: WikiPage;
  score: number;
  tier: 0 | 1 | 2;
  /** tier1 且是被「<标题> 电子游戏」那一轮救回来的（标题本身零重合）。
   *  2026-10-02 线上实测：故事FM 在 zh 维基没有条目，纯标题轮只会召回
   *  「我們的故事 (專輯)」这类蹭词页，而「故事FM 电子游戏」这一轮召回的是
   *  SCP基金会 / 王国之心系列作品列表——它们 tier1 却带着封面，于是压过
   *  tier2 的真条目「故事FM」（本身无图），用户就看到了 SCP 的徽标。
   *  救回来的条目只能当兜底，绝不能因为「有封面」而排在真标题匹配前面。 */
  hintRescued?: boolean;
}

/** gsrsearch 候选 + pageprops 摘要/图片（generator=search 会顺带回
 *  系列页与消歧页，必须靠评分把作品条目顶上来） */
async function wikiSearchOnce(
  lang: "zh" | "en",
  query: string,
  probe: WikiProbe,
): Promise<WikiPage[]> {
  const q = new URLSearchParams({
    action: "query",
    generator: "search",
    gsrsearch: query,
    gsrnamespace: "0",
    gsrlimit: "6",
    prop: "extracts|pageimages|pageprops|info",
    piprop: "original|thumbnail",
    pithumbsize: String(pickThumbBucket(OTHER_THUMB_MAX_WIDTH)),
    exintro: "true",
    explaintext: "true",
    exlimit: "20",
    inprop: "url",
    redirects: "1",
    format: "json",
  });
  const pages = await wikiJson(lang, q, 9000, probe);
  return pages ? Object.values(pages) : [];
}

/** 评分择优：每个查询词跑「纯标题轮 + 作品类型词轮」，同页去重后按
 *  **档位优先、分数次之**排序。档位必须排在分数前面，否则 tier1 的高分条目
 *  （弱吻合 + 全套弱信号）能盖过 tier2 的作品页——那正是本次线上错图的形状。 */
async function resolveOtherPages(
  lang: "zh" | "en",
  baseTitle: string,
  queries: readonly string[],
  year?: string,
  /** 来自**精确标题轮**的消歧页别名。otherDetail 的消歧页只在那一轮出现，
   *  搜索轮自己看不到——Journey 实测就是因此选了 1996 电视剧（Journey 实测：
   *  gsrsearch 轮里没有消歧页，只有《西遊記》和《風之旅人》）。 */
  extraAliases: readonly string[] = [],
  probe: WikiProbe = newWikiProbe(),
): Promise<OtherCandidate[]> {
  const compactBase = compactTitle(baseTitle);
  const seen = new Set<string>();
  const scored: OtherCandidate[] = [];
  // 先把所有查询轮的页面收齐，再统一算别名与「谁来自类型词轮」：消歧页可能
  // 出现在最后一轮，边收边评会让「先被淘汰、后被别名救回」的条目永久出局
  // （Journey 实测：風之旅人 只在「Journey 电子游戏」轮出现，标题零重合）。
  const allPages: WikiPage[] = [];
  const hintTitles = new Set<string>();
  for (const query of queries) {
    for (const [search, isHint] of [
      [query, false],
      [`${query} ${OTHER_HINT[lang]}`, true],
    ] as const) {
      for (const page of await wikiSearchOnce(lang, search, probe)) {
        const title = (page.title ?? "").trim();
        if (!title || seen.has(title)) continue;
        seen.add(title);
        allPages.push(page);
        if (isHint) hintTitles.add(title);
      }
    }
  }
  const aliases = disambiguationAliases(allPages, compactBase);
  for (const alias of extraAliases) if (alias) aliases.push(alias);
  for (const page of allPages) {
    const title = (page.title ?? "").trim();
    // 标题本身零重合、只因出现在「<标题> 电子游戏」轮才被放行的条目。
    const hintRescued = hintTitles.has(title) && titleMatchTier(compactBase, title, aliases) === 0;
    const hit = scoreOtherPage(page, compactBase, year, aliases, hintTitles.has(title), lang);
    if (hit) scored.push({ page, score: hit.score, tier: hit.tier, hintRescued });
  }
  // 「纯靠类型词轮救回来」的条目排在同档的真标题匹配之后：它没有任何字面证据，
  // 只有维基在「<标题> 电子游戏」轮把它返了回来。线上实测不修这条排序的后果
  // 就是 故事FM 拿到 SCP基金会的徽标当播客封面（见 OtherCandidate.hintRescued）。
  return scored.sort(
    (a, b) =>
      b.tier - a.tier ||
      Number(Boolean(a.hintRescued)) - Number(Boolean(b.hintRescued)) ||
      b.score - a.score,
  );
}

/** 从候选页里挑最优。**只在最高档位内挑**——年份只是同档内的消歧信号。
 *  年份命中的候选若全在低档位，宁可降档也不跨档取（跨档取就是本次线上
 *  错图的成因：tier1「日常幻想指南」摘要带 2021、还有封面，于是压过
 *  tier2 里真正的作品页）。
 *  年份是用户清单格式「标题 - 游戏 (年)」里最硬的消歧信号——动物森友会实测：
 *  系列页/2001 首作都不带 2020，2020 正作带。
 *  只分「摘要提到用户年份」一档，不再按「条目自身首个年份 == 用户年份」细分：
 *  角色页「傑克 (動物森友會)」首年正是 2020，2020 正作「集合啦！動物森友會」
 *  首年却是 2018（公布年），按首年细档会把正作压下去、让角色页夺冠。 */
/** 候选的摘要/描述里是否提到用户年份——年份是清单格式里最硬的消歧信号
 *  （动物森友会实测：系列页与 2001 首作都不带 2020，2020 正作带）。 */
function mentionsYear(entry: OtherCandidate, year?: string): boolean {
  if (!year) return false;
  const text = `${entry.page.extract ?? ""} ${entry.page.description ?? ""}`;
  return text.includes(year);
}

/** 这条候选有没有资格参与择优。
 *  hintRescued 的条目标题与用户标题**零字重合**，只因为维基在「<标题> 电子游戏」
 *  轮把它返了回来才被放行到 tier 1——它一个字面证据都没有，光靠「有缩略图 /
 *  摘要够长」这类弱信号就能夺冠。2026-10-02 实测「故事FM 电子游戏」轮返的是
 *  SCP基金会（带缩略图），当封面就成了 SCP 徽标。
 *  所以额外要求它**自证是用户要的那一年**：風之旅人摘要写明 2012，而 SCP基金会 /
 *  伊苏序章 / 王国之心列表的摘要里都没有 2017。缺年份证据就宁可不返图。
 *  消歧页自列的别名（Journey → 風之旅人）走 titleMatchTier 的别名分支拿到
 *  tier 1 且不算 hintRescued，因此不受这条限制。 */
function usableForPick(entry: OtherCandidate, year?: string): boolean {
  return !entry.hintRescued || mentionsYear(entry, year);
}

/** 从候选页里挑最优。**只在最高档位内挑**——年份只是同档内的消歧信号。
 *  年份命中的候选若全在低档位，宁可降档也不跨档取（跨档取就是本次线上
 *  错图的成因：tier1「日常幻想指南」摘要带 2021、还有封面，于是压过
 *  tier2 里真正的作品页）。 */
function pickBest(candidates: OtherCandidate[], year?: string): OtherCandidate | null {
  const usable = candidates.filter((entry) => usableForPick(entry, year));
  if (!usable.length) return null;
  const topTier = usable[0].tier;
  const pool = usable.filter((entry) => entry.tier === topTier);
  if (!year) return pool[0];
  const mentions = pool.filter((entry) => mentionsYear(entry, year));
  return (mentions.length ? mentions : pool)[0];
}

/** 条目作品的主图：infobox 封面文件（pageprops.page_image）优先，其次
 *  pageimages 缩略图，再次 original，最后同页正文图。
 *
 *  2026-10-02：page_image 指名的文件**可能根本不是封面**——zh 维基
 *  「纪念碑谷 (游戏)」的 page_image 就是 `Monument_Valley_icon_unrounded.jpg`
 *  （app 图标）。该文件名判为 artifact 时不采用。
 *
 *  线上实测（iter10 A3 首轮验收）：那一页**既没有 thumbnail 也没有 original**
 *  （app 图标是非自由文件，pageimages 因此为空），也就是说「判掉之后往下落」
 *  这条梯子在这页上是空的 —— 结果是封面从「图标」变成「没有」，而真正的
 *  游戏截图就躺在同页 images 列表里。所以这里必须自己把那一档补上，
 *  否则「不采用图标」只是把一个错误换成了另一个错误。 */
async function toWork(
  page: WikiPage,
  lang: "zh" | "en",
  probe: WikiProbe = newWikiProbe(),
): Promise<OtherWork | null> {
  const title = (page.title ?? "").trim();
  const extract = (page.extract ?? "").trim();
  if (!title || !extract || page.missing || extract.length < 20) return null;
  // 消歧页（「X 可以指：…」）不是作品介绍，机械剔除
  if (isDisambiguation(page)) return null;
  const year = extract.match(YEAR_RE)?.[0];
  // 缩略图优先于 original：original 是 Commons 全尺寸扫描件（数十 MB）
  const pageImage = page.pageprops?.page_image ?? "";
  const infobox =
    page.fileUrl && classifyArtworkFile(pageImage) === "artwork" ? page.fileUrl : undefined;
  let poster = (infobox ?? page.thumbnail?.source ?? page.original?.source)?.replace(
    /^http:/,
    "https:",
  );
  if (!poster) {
    // 兜底档：infobox 被判掉（或压根没换到 URL）且 pageimages 为空 ⇒ 问同一页
    // 要 images 列表，找文件名对得上这件作品的图。只在这一档发，所以
    // page_image 正常的条目一次都不多付。
    //
    // 关键词只带本页标题：2026-10-02 线上实测中文条目正文里的文件名是英文的
    // （File:Monument Valley screenshot.jpg 挂在 zh 页面「纪念碑谷 (游戏)」里），
    // 所以**没有**在这里花钱查 langlinks 换英文标题——那条路会让每个 icon
    // 页多付一次请求，而 ARTWORK_NAME_HINT_RE（screenshot/cover/boxart…）
    // 与语言无关，是这一档够用的判据。
    await fillArticleImageNames(lang, [{ page, score: 0, tier: 0 }], probe);
    const works = [...new Set([title, ...titleVariants(title)])];
    for (const name of articleImageNames(page)) {
      if (!articleNameMatchesWork(name, works)) continue;
      const url = await wikiFileThumbUrl(lang, name, probe);
      if (url) {
        poster = url;
        break;
      }
    }
  }
  return {
    id: `wiki-${lang}-${encodeURIComponent(title)}`,
    title,
    ...(page.description ? { subtitle: page.description } : {}),
    ...(year ? { year: Number(year) } : {}),
    ...(poster ? { poster_url: poster } : {}),
    content_intro: extract,
    content_source: `${lang}wiki`,
    detail_url:
      page.url ??
      `https://${lang}.wikipedia.org/wiki/${encodeURIComponent(title.replace(/ /g, "_"))}`,
  };
}

/** 标题精确查询（含分隔符变体）拿候选页 */
async function wikiTitlePages(
  lang: "zh" | "en",
  titles: readonly string[],
  probe: WikiProbe = newWikiProbe(),
): Promise<WikiPage[] | null> {
  const q = new URLSearchParams({
    action: "query",
    titles: titles.join("|"),
    prop: "extracts|pageimages|pageprops|info",
    exintro: "true",
    explaintext: "true",
    pithumbsize: String(pickThumbBucket(OTHER_THUMB_MAX_WIDTH)),
    exlimit: "20",
    inprop: "url",
    redirects: "1",
    converttitles: "1",
    format: "json",
  });
  const pages = await wikiJson(lang, q, 9000, probe);
  return pages ? Object.values(pages) : null;
}

/** 其他类作品搜索：gsrsearch 评分择优（替代 opensearch——实测 opensearch
 *  对「动物森友会」只回 6 个简体错页，且会把 Journey(EP專輯) 这类同名
 *  音乐页排到游戏页前面）。 */
export async function otherSearch(
  query: string,
  probe: WikiProbe = newWikiProbe(),
): Promise<OtherWork[]> {
  const trimmed = query.trim().slice(0, 80);
  if (!trimmed) return [];
  for (const lang of ["zh", "en"] as const) {
    const scored = await resolveOtherPages(lang, trimmed, [trimmed], undefined, [], probe);
    if (!scored.length) continue;
    const pages = scored.slice(0, 6).map((entry) => entry.page);
    await fillPageImageUrls(lang, pages, probe);
    const works = (await Promise.all(pages.map((page) => toWork(page, lang, probe)))).filter(
      (work): work is OtherWork => !!work,
    );
    if (works.length) return works;
  }
  return [];
}

/** zh 条目的英文对应标题（langlinks）：en wiki 的封面链与 zh 不同，
 *  zh 查不到图时的第二机会。 */
export async function wikiEnTitle(
  title: string,
  probe: WikiProbe = newWikiProbe(),
): Promise<string | null> {
  const q = new URLSearchParams({
    action: "query",
    titles: title.trim().slice(0, 120),
    prop: "langlinks",
    lllang: "en",
    lllimit: "1",
    redirects: "1",
    converttitles: "1",
    format: "json",
  });
  const pages = await wikiJson("zh", q, 7000, probe);
  if (!pages) return null;
  for (const page of Object.values(pages)) {
    const langlinks = page as WikiPage & { langlinks?: Array<{ "*": string }> };
    const en = langlinks.langlinks?.[0]?.["*"];
    if (en) return en;
  }
  return null;
}

/** 条目主图直取（含非自由封面）：pageprops.page_image（infobox 封面）优先，
 *  其次 images→imageinfo 直取（游戏封面在 pageimages 里恒空）。
 *  文件名优先匹配用户标题/英文标题关键词——文章内相关画作按文件名字母序
 *  会抢在主图前（蒙娜丽莎实测命中拉斐尔《巴尔达萨雷·卡斯蒂廖内》），
 *  没有命中关键词就宁可返回 null，交给上层兜底（早期 files[0] 兜底把
 *  动物森友会命中成大角鸮照片）。 */
export async function wikiPageImageAny(
  lang: "zh" | "en",
  title: string,
  /** 文件名匹配的优先关键词（用户标题 + 英文标题——zh 简繁变体会让标题评分
   *  失败落到这里，而条目内文件名常是英文，如 Mona Lisa）。 */
  preferTitles: readonly string[] = [],
  probe: WikiProbe = newWikiProbe(),
): Promise<string | null> {
  const base = title.trim().slice(0, 120);
  if (!base) return null;
  const variants = titleVariants(base);
  const list = new URLSearchParams({
    action: "query",
    titles: variants.join("|"),
    prop: "images|pageprops",
    imlimit: "12",
    redirects: "1",
    converttitles: "1",
    format: "json",
  });
  const pages = await wikiJson(lang, list, 8000, probe);
  if (!pages) return null;
  const compactBase = compactTitle(base);
  const candidates = Object.values(pages).filter(
    (page) => !page.missing && (page.title ?? "").trim() && !isDisambiguation(page),
  );
  // 只认「页标题与原题真的吻合」的条目。比较时把页标题里的分隔符（空格/全角
  // 冒号/中点）一并剥掉——否则「底特律：变人」永远不 includes「底特律变人」。
  // 曾经这里是 `find(...) ?? candidates[0]`：只要精确标题那几条都没命中就回落到
  // 首个候选，等于把标题闸门整个绕过去——线上「日常幻想」就是这样取到
  // 日常幻想指南这篇文章里的签名照的。宁可返回 null，交给上层兜底。
  const page = candidates
    .map((entry) => ({ entry, tier: titleMatchTier(compactBase, entry.title ?? "") }))
    .filter((hit) => hit.tier > 0)
    .sort((a, b) => b.tier - a.tier)[0]?.entry;
  if (!page) return null;
  await fillPageImageUrls(lang, [page], probe);
  // infobox 封面名指向 app 图标时不采用（2026-10-02 实测：纪念碑谷 (游戏) 的
  // page_image 就是 icon），但**不就此返回 null**——往下还有同页 images 分支，
  // 真正的游戏截图就躺在那儿。
  const pageImage = page.pageprops?.page_image ?? "";
  if (page.fileUrl && classifyArtworkFile(pageImage) === "artwork") return page.fileUrl;
  const images = (page as WikiPage & { images?: Array<{ title?: string }> }).images ?? [];
  // 文件名含标题字词者优先：文章内相关画作按字母序会抢在主图前
  const prefers = [compactBase, ...preferTitles]
    .map((value) => value.replace(/[\s：:·・（）()]/g, "").toLowerCase())
    .filter(Boolean);
  const file = images
    .map((image) => image.title ?? "")
    .filter(
      (name) =>
        name.startsWith("File:") &&
        /\.(jpe?g|png)$/i.test(name) &&
        classifyArtworkFile(name) === "artwork",
    )
    .find((name) => {
      const compact = name.slice(5).replace(/[\s_]/g, "").toLowerCase();
      return prefers.some((prefer) => prefer && compact.includes(prefer));
    });
  if (!file) return null;
  return wikiFileThumbUrl(lang, file, probe);
}

/** 置信度分档。命名对应「证据有多硬」，不是「分数有多高」。 */
export type OtherConfidenceBand = "exact" | "strong" | "shaky" | "weak";

/** 冠军的字面证据强度（由弱到强）：
 *  - `literal` tier2 且条目名本身就贴着用户标题（纪念碑谷 (遊戲)）
 *  - `alias`   tier1，但候选是消歧页自列的同名候选（Journey → 風之旅人）
 *  - `hint`    tier1，且标题零字面重合，只靠「<标题> 电子游戏」轮救回来 */
export type OtherEvidenceKind = "literal" | "alias" | "hint" | "none";

export interface OtherConfidence {
  /** 0–1 综合置信度。 */
  score: number;
  band: OtherConfidenceBand;
  /** 冠军领先第二名的幅度（归一到 0–1）。差得越小越不自信。 */
  margin: number;
  evidence: OtherEvidenceKind;
  /** 冠军是哪个条目（null = 没选出冠军）。 */
  pickedTitle: string | null;
  /** 参与排序的可用候选数（usableForPick 之后）。 */
  poolSize: number;
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return value < 0 ? 0 : value > 1 ? 1 : value;
}

/** 冠军的字面证据强度，按「证据有多硬」排序：
 *  - `literal` tier2（条目名就是那件作品），或 tier1 但自己就蹭到了用户标题
 *            （道奇Journey、日常幻想指南——证据来自字面文本，只是不够精确）
 *  - `alias`   tier1 且标题**零字面重合**，但候选是消歧页自列的同名候选
 *            （Journey → 風之旅人）。这类候选在 resolveOtherPages 里同样带
 *              hintRescued 标记（它是被「<标题> 电子游戏」轮返回来的），所以
 *              必须先查别名表再看 hintRescued，否则线上实测会把「已修好的
 *              Journey」误报成 hint——判决对了但诊断说没信心，端点就白做了。
 *  - `hint`    tier1 且标题零重合、也不是消歧页自列的候选，只靠类型词轮活着
 *              （故事FM → SCP基金会徽标，就是这么来的）
 */
function evidenceOf(
  entry: OtherCandidate | null,
  aliases: readonly string[],
  compactBase: string,
): OtherEvidenceKind {
  if (!entry) return "none";
  // tier2 已经由 titleMatchTier 认定「条目名就是那件作品」，是最硬的证据。
  if (entry.tier === 2) return "literal";
  const compact = compactTitle(entry.page.title ?? "");
  // tier1 里有一类是**自己就蹭到了用户标题**的（道奇Journey 的 compact 含
  // 「journey」，日常幻想指南 含「日常幻想」）——它们的证据来源是字面文本，
  // 不是我们去找回来的，所以仍是 literal。区别只在于不够精确，压不进 tier2。
  if (compactBase !== "" && (compact.includes(compactBase) || compactBase.includes(compact)))
    return "literal";
  // 到这里说明标题零重合。能站住只有两种来路：消歧页自列的别名（Journey →
  // 風之旅人，维基权威地认为它是同名候选之一），或纯靠类型词轮凑数
  // （SCP基金会，一个字面证据都没有）。
  if (aliases.some((alias) => alias && compactTitle(alias) === compact)) return "alias";
  return entry.hintRescued ? "hint" : "alias";
}

/**
 * 结构化置信度：把 `pickBest` 的判决**额外**翻译成「有多确定」。
 *
 * 2026-10-02 的教训是「分数不是置信度」——「道奇Journey」6.5 与「風之旅人」5.5
 * 相差 1 分，这条 1 分却直接决定了用户看到汽车还是看到游戏。启发式加权分是连续量，
 * 把它当离散判决用是这个 bug 的根。所以这里不去改 `pickBest` 的判决（那条链路上
 * 已验证正确的项一个都不能动），而是把**已有的信号重排**成一个 0–1 的置信度，
 * 供调用方决定「要不要把选择权交出去」。
 *
 * 合成因子全部是既有信号，**不新增任何规则**：
 *  - 档位 tier 2 / 1（字面证据强度的主项）
 *  - 证据类型 literal > alias > hint
 *  - 领先幅度 margin（冠军 − 亚军，按满分跨度 12 归一；池里只有一条时算满）
 *  - 年份佐证（给了年份且冠军摘要命中）
 *
 * 分档：
 *  - `exact`  tier2 + 字面证据 + 有年份佐证（或无年份要求）→ 已验证正确的形状
 *  - `strong` tier2 + 字面证据，但同档内有多条势均力敌
 *  - `shaky`  靠别名/题材词救回来，或领先幅度很小
 *  - `weak`   没选出冠军，或冠军证据仅 `hint`
 */
export function otherConfidence(
  ranked: readonly OtherCandidate[],
  picked: OtherCandidate | null,
  year?: string,
  aliases: readonly string[] = [],
  /** 用户标题的 compact 形态，用于判「候选是否零字面重合」。 */
  compactBase = "",
): OtherConfidence {
  const usable = ranked.filter((entry) => usableForPick(entry, year));
  if (!picked || !usable.length) {
    return { score: 0, band: "weak", margin: 0, evidence: "none", pickedTitle: null, poolSize: 0 };
  }
  const evidence = evidenceOf(picked, aliases, compactBase);
  // 领先幅度：亚军取「冠军之外分数最高的那条」，池里只有冠军一条时视为满幅。
  const rivals = usable.filter((entry) => entry !== picked);
  const bestRival = rivals.reduce((max, entry) => Math.max(max, entry.score), -Infinity);
  const span = 12;
  const margin = rivals.length ? clamp01((picked.score - bestRival) / span) : 1;
  const yearBacked = year ? mentionsYear(picked, year) : true;
  // 权重：字面证据 0.45 / 领先幅度 0.35 / 年份佐证 0.20。
  const evidenceWeight = evidence === "literal" ? 1 : evidence === "alias" ? 0.6 : 0.25;
  const score = clamp01(0.45 * evidenceWeight + 0.35 * margin + 0.2 * (yearBacked ? 1 : 0));
  let band: OtherConfidenceBand;
  if (evidence === "literal" && picked.tier === 2 && yearBacked && margin >= 0.05) band = "exact";
  else if (evidence === "literal" && picked.tier === 2 && yearBacked) band = "strong";
  else if (evidence === "alias" && margin >= 0.1) band = "shaky";
  else band = "weak";
  return {
    score,
    band,
    margin,
    evidence,
    pickedTitle: (picked.page.title ?? "").trim() || null,
    poolSize: usable.length,
  };
}

export interface OtherCandidateView {
  title: string;
  year?: string;
  excerpt: string;
  score: number;
  tier: 0 | 1 | 2;
  evidence: OtherEvidenceKind;
  hasCover: boolean;
}
export interface OtherCandidateReport {
  candidates: OtherCandidateView[];
  picked: string | null;
  confidence: OtherConfidence;
  /** zh / en —— 冠军来自哪个语言轮的搜索池。 */
  lang: "zh" | "en" | null;
}

/** 把内部候选翻成对外形状（只给标题/首段/分数，不回原始 JSON）。 */
function toCandidateView(
  entry: OtherCandidate,
  aliases: readonly string[],
  compactBase: string,
): OtherCandidateView {
  const extract = (entry.page.extract ?? "").trim();
  return {
    title: (entry.page.title ?? "").trim(),
    ...(extract.match(/(?:1[5-9]|20)\d{2}/)
      ? { year: extract.match(/(?:1[5-9]|20)\d{2}/)![0] }
      : {}),
    excerpt: extract.slice(0, 160),
    score: entry.score,
    tier: entry.tier,
    evidence: evidenceOf(entry, aliases, compactBase),
    hasCover: Boolean(
      entry.page.pageprops?.page_image || entry.page.fileUrl || entry.page.thumbnail?.source,
    ),
  };
}

/**
 * 候选池诊断：把 other 维度「为什么是这个 / 为什么不敢给」摊开给调用方。
 *
 * 2026-10-02 的教训是规则这条路已经走到头（台账 T-20261002-01 遗留风险①：
 * 「日常幻想 / 故事FM / 看理想 三条永久空图」——zh-wiki 根本没有这些条目，
 * 搜出来的候选零重合，再加规则也没用）。所以本函数**不参与判决**，
 * 只回答两个问题：候选池里有什么、我们有多确定。
 *
 * 诊断链与 resolveOtherCover 同源（同样两语言 × 纯标题轮/类型词轮），
 * 因此这里的 pickedTitle 就是真会取到封面的那一条。
 */
export async function otherCandidateReport(
  title: string,
  english: string,
  year?: number,
): Promise<OtherCandidateReport> {
  const base = title.trim().slice(0, 120);
  const yearText = year && year >= 1500 && year <= 2100 ? String(year) : undefined;
  const empty: OtherCandidateReport = {
    candidates: [],
    picked: null,
    confidence: otherConfidence([], null, yearText),
    lang: null,
  };
  if (!base) return empty;
  const compactBase = compactTitle(base);
  // 诊断端点自带一个**用完即弃**的探针：它的上游健康不参与任何判决，
  // 也不许写进任何共享状态（迭代 8/20 之前它共享模块级 wikiDegraded，等于
  // 「用户点开一次让用户选弹窗就会改变后面海报的分类」）。
  const diagProbe = newWikiProbe();
  for (const lang of ["zh", "en"] as const) {
    const queries = (lang === "zh" ? [base, english] : [english, base])
      .map((value) => (value ?? "").trim())
      .filter(Boolean);
    if (!queries.length) continue;
    // 诊断端点必须与真链路同一份别名，否则「候选池报告」会描述一个
    // 真实判决里不存在的池子（迭代 3 线上实测踩过）。
    const diagExact = await wikiTitlePages(lang, titleVariants(base), diagProbe);
    const diagAliases = disambiguationAliases(diagExact ?? [], compactTitle(base));
    const ranked = await resolveOtherPages(lang, base, queries, yearText, diagAliases, diagProbe);
    const best = pickBest(ranked, yearText);
    if (!best) continue;
    // 别名由同一批候选反推：与评分时用的是同一份 allPages。
    const aliases = disambiguationAliases(
      ranked.map((entry) => entry.page),
      compactBase,
    );
    return {
      candidates: ranked
        .filter((entry) => usableForPick(entry, yearText))
        .slice(0, 8)
        .map((entry) => toCandidateView(entry, aliases, compactBase)),
      picked: (best.page.title ?? "").trim(),
      confidence: otherConfidence(ranked, best, yearText, aliases, compactBase),
      lang,
    };
  }
  return empty;
}

/** 其他类作品封面：gsrsearch 评分择优 + infobox 封面文件（pageprops.page_image）。
 *  覆盖「精确标题是系列页/消歧页/同名概念页」的场景——动物森友会实测 zh 精确
 *  标题落到「動物森友會系列」，而 2020 正作「集合啦！動物森友會」要靠搜索
 *  + 年份才能顶上来。 */
export async function resolveOtherCover(
  title: string,
  english: string,
  year?: number,
  probe: WikiProbe = newWikiProbe(),
): Promise<string | null> {
  const base = title.trim().slice(0, 120);
  if (!base) return null;
  const yearText = year && year >= 1500 && year <= 2100 ? String(year) : undefined;
  for (const lang of ["zh", "en"] as const) {
    const queries = (lang === "zh" ? [base, english] : [english, base])
      .map((value) => (value ?? "").trim())
      .filter(Boolean);
    if (!queries.length) continue;
    // 同页正文图要与「作品」对得上，判据的关键词就是这批查询词（去重去空）。
    const works = [...new Set([base, ...queries, ...titleVariants(base)])];
    // 别名只认「精确标题轮」那张消歧页自列的名单——搜索轮混进来的旁支消歧页
    // （搜「日常幻想」会带回「性幻想」）会注入一堆无关别名。2026-10-02 线上实测：
    // 不传这批别名时，Journey 搜索轮里《风之旅人》拿不到唯一证据被判 tier0，
    // 只剩 tier2 的《隨興旅 -That's Journey-》（2006 年漫画）与《道奇Journey》
    // 同池，靠 0.5 分之差把漫画 logo 当成了游戏封面。otherDetail 早就传了，
    // 这里是唯一一处漏掉的调用点。
    const coverExact = await wikiTitlePages(lang, titleVariants(base), probe);
    const coverAliases = disambiguationAliases(coverExact ?? [], compactTitle(base));
    const ranked = await resolveOtherPages(lang, base, queries, yearText, coverAliases, probe);
    const best = pickBest(ranked, yearText);
    if (!best) continue;
    // 补图范围：最优条目 + 它后面 2 名，**且不跨「有没有字面证据」这道界**
    // （hintRescued，见 pickBest 注释）。2026-10-02 实测 故事FM 命中的是 zh 维基
    // 那个零字面证据的真条目，封面只能往上层兜底档要，绝不能顺藤摸到 SCP 徽标。
    const start = ranked.indexOf(best);
    const sameEvidence = ranked
      .slice(start + 1, start + 3)
      .filter((entry) => Boolean(entry.hintRescued) === Boolean(best.hintRescued));
    const top = [best, ...sameEvidence];
    await fillPageImageUrls(
      lang,
      top.map((entry) => entry.page),
      probe,
    );
    // ① infobox 封面文件优先（评分最高的先试），但**文件名判为 artifact
    //    （app 图标 / 系列 logo / 界面素材）时不采用**。2026-10-02 实测：
    //    纪念碑谷 (游戏) 的 page_image 就是 Monument_Valley_icon_unrounded.jpg。
    for (const entry of top) {
      const file = entry.page.pageprops?.page_image ?? "";
      if (file && entry.page.fileUrl && classifyArtworkFile(file) === "artwork")
        return entry.page.fileUrl;
    }
    // ② 页级守卫：只有当整条链都拿不到「像封面」的 infobox 文件时，才付那次
    //    带 prop=images 的额外查询。page_image 正常的条目一次都不发。
    if (top.some((entry) => !entry.page.fileUrl || !isArtworkPageImage(entry.page))) {
      await fillArticleImageNames(lang, top, probe);
    }
    // ③ 同页正文里文件名含作品关键词的图——纪念碑谷 (游戏) 的 icon 被判掉后，
    //    真正的游戏截图（File:Monument Valley screenshot.jpg）靠这一档顶上来。
    const articleNames = top.flatMap((entry) => articleImageNames(entry.page));
    for (const name of articleNames) {
      if (!articleNameMatchesWork(name, works)) continue;
      const url = await wikiFileThumbUrl(lang, name, probe);
      if (url) return url;
    }
    // ④ 同页 images 里第一张非 artifact。**只能落在已被 pickBest 确认的作品页上**
    //    （top 的每一条都过了 tier/年份闸），所以「第一张」不会被地貌照片抢走。
    for (const name of articleNames) {
      const url = await wikiFileThumbUrl(lang, name, probe);
      if (url) return url;
    }
    // ⑤ 最后才退回 pageimages 缩略图。
    for (const entry of top) {
      const url = entry.page.thumbnail?.source ?? entry.page.original?.source;
      if (url) return url.replace(/^http:/, "https:");
    }
  }
  return null;
}

/** 其他类作品详情：标题变体精确直查 + 评分择优兜底。
 *  注：曾有百度百科 openapi 兜底，2026-09-28 实测已废弃（恒返回 errno 6），
 *  纯拖 8s 超时——已移除；简介与图均以维基为准。
 *  @param year 用户条目带的年份（清单格式「标题 - 游戏 (年)」）：消歧用，
 *    精确页不是该年份作品时按搜索/年份重择优。 */
export async function otherDetail(name: string, year?: number): Promise<OtherWork | null> {
  const base = name.trim().slice(0, 120);
  if (!base) return null;
  const yearText = year && year >= 1500 && year <= 2100 ? String(year) : undefined;
  const compactBase = compactTitle(base);
  // 详情链**不参与封面判决**（封面判决走 resolveOtherCover），所以它用自己
  // 的用完即弃探针：签名不变 ⇒ worker/index.ts 零改动，诊断与判决彻底解耦。
  const detailProbe = newWikiProbe();
  // 同档位内评分高者优先（tier 已由 scoreOtherPage 保证 ≥1）
  const byRank = (a: OtherCandidate, b: OtherCandidate) => b.tier - a.tier || b.score - a.score;
  for (const lang of ["zh", "en"] as const) {
    // ① 精确标题（含分隔符变体）直查
    const exactPages = await wikiTitlePages(lang, titleVariants(base), detailProbe);
    let exactRank: OtherCandidate | null = null;
    let exactWork: OtherWork | null = null;
    let exactAliases: string[] = [];
    if (exactPages?.length) {
      const scored: OtherCandidate[] = [];
      exactAliases = disambiguationAliases(exactPages, compactBase);
      for (const page of exactPages) {
        const hit = scoreOtherPage(page, compactBase, yearText, exactAliases);
        if (hit) scored.push({ page, score: hit.score, tier: hit.tier });
      }
      scored.sort(byRank);
      const best = pickBest(scored, yearText);
      if (best) {
        exactRank = best;
        await fillPageImageUrls(lang, [best.page], detailProbe);
        exactWork = await toWork(best.page, lang, detailProbe);
      }
    }
    // 够好就直接返回：作品页（tier 2）、评分 ≥6（有类型词/限定词/封面这类
    // 作品特征）；给了年份时还要求条目本身就说的是那一年（否则按「系列页/
    // 同类条目」继续往下择优）。
    const exactText = exactWork
      ? `${exactWork.content_intro ?? ""} ${exactWork.subtitle ?? ""}`
      : "";
    if (
      exactWork &&
      exactRank?.tier === 2 &&
      exactRank.score >= 6 &&
      (!yearText || exactText.includes(yearText))
    )
      return exactWork;
    // ② 精确页是系列页/同名概念页/无封面（评分不够）时，gsrsearch 评分择优
    const searched = await resolveOtherPages(
      lang,
      base,
      [base],
      yearText,
      exactAliases,
      detailProbe,
    );
    const searchBest = pickBest(searched, yearText);
    if (searchBest) {
      await fillPageImageUrls(lang, [searchBest.page], detailProbe);
      const searchWork = await toWork(searchBest.page, lang, detailProbe);
      if (
        searchWork &&
        (!exactRank ||
          searchBest.tier > exactRank.tier ||
          (searchBest.tier === exactRank.tier && searchBest.score > exactRank.score))
      )
        return searchWork;
    }
    if (exactWork) return exactWork;
  }
  return null;
}
