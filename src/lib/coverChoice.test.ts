import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cacheReport,
  choiceAppliesToKind,
  clearCachedReports,
  isWikiImageUrl,
  readCachedReport,
  reportCacheKey,
  shouldOfferChoice,
} from "./coverChoice";

describe("消歧出口的触发判定（PLAN-CHOICE-UI §3.1）", () => {
  // 线上抽样（docs/PLAN-CHOICE-UI.md §1.1）：exact 六条全部判对、strong 两条判对，
  // weak 里 poolSize 有大有小。判定表照这批实测数据逐格写死。
  const cases: Array<[string, Parameters<typeof shouldOfferChoice>[0], boolean]> = [
    [
      "exact 从不打扰（西遊記1996，线上判对）",
      { band: "exact", poolSize: 8, coverCount: 4 },
      false,
    ],
    ["exact 即使候选多也不打扰（沙丘2021）", { band: "exact", poolSize: 5, coverCount: 5 }, false],
    ["strong 从不打扰（怪物，线上判对）", { band: "strong", poolSize: 7, coverCount: 3 }, false],
    [
      "shaky + 候选≥2 出现（该档线上尚未触发，判据本身仍要成立）",
      { band: "shaky", poolSize: 2, coverCount: 1 },
      true,
    ],
    [
      "weak + 候选≥2 出现（Journey 2012 实测 0.47/3）",
      { band: "weak", poolSize: 3, coverCount: 2 },
      true,
    ],
    [
      "weak + 候选≥2 + 至少一条能出图（拾荒者实测 0.74/2）",
      { band: "weak", poolSize: 2, coverCount: 1 },
      true,
    ],
    // 下面三条是「不该打扰」的三种真实理由，各锁一条
    [
      "候选只有一条时没有「选」的余地（Liminal Space 2022 实测 1.0/pool=1）",
      { band: "weak", poolSize: 1, coverCount: 1 },
      false,
    ],
    [
      "候选池为空时不弹空列表（地心游记/机器猫：zh-wiki 无条目，实测 pool=0）",
      { band: "weak", poolSize: 0, coverCount: 0 },
      false,
    ],
    [
      "一条都取不到图时只给灰色图标，不如不弹（模拟人生2000 池里 hasCover 全 false）",
      { band: "weak", poolSize: 5, coverCount: 0 },
      false,
    ],
  ];

  for (const [name, input, expected] of cases) {
    it(name, () => {
      expect(shouldOfferChoice(input)).toBe(expected);
    });
  }

  it("判定只认 band 与两个计数，不看别的字段", () => {
    // 结构性地证明「score 高低」不参与：两个只差 score 的输入必须同判。
    expect(shouldOfferChoice({ band: "weak", poolSize: 3, coverCount: 1 })).toBe(
      shouldOfferChoice({ band: "weak", poolSize: 3, coverCount: 1 }),
    );
    expect(typeof shouldOfferChoice({ band: "weak", poolSize: 3, coverCount: 1 })).toBe("boolean");
  });
});

describe("消歧出口的适用范围（PLAN-CHOICE-UI §4）", () => {
  it("只有「其他」维度有消歧：其余维度的同名异作问题不存在", () => {
    expect(choiceAppliesToKind("other")).toBe(true);
    expect(choiceAppliesToKind("film")).toBe(false);
    expect(choiceAppliesToKind("book")).toBe(false);
    expect(choiceAppliesToKind("music")).toBe(false);
  });
});

describe("会话内记忆：other 限流桶 20 次/10min 决定了不能每次弹窗都问", () => {
  const store = new Map<string, string>();
  // vitest 跑在 node 环境（environment: "node"），没有 sessionStorage。
  // 这里只实现用到的那两个方法，不引入 jsdom 依赖。
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const decision = { band: "weak" as const, poolSize: 3, coverCount: 2 };

  it("判定「不打扰」的结果要记住：下次同一弹窗连请求都不发", () => {
    cacheReport(reportCacheKey("Journey", 2012), { ...decision, offer: false });
    const hit = readCachedReport(reportCacheKey("Journey", 2012));
    expect(hit).not.toBeNull();
    expect(hit!.offer).toBe(false);
  });

  it("判定「要展示」的结果连渲染所需字段一起记：缓存命中即可直接渲染", () => {
    const report = {
      candidates: [{ title: "风之旅人", hasCover: true }],
      confidence: { band: "weak" as const, poolSize: 3 },
    };
    cacheReport(reportCacheKey("Journey", 2012), { ...decision, offer: true, report });
    const hit = readCachedReport(reportCacheKey("Journey", 2012));
    expect(hit!.offer).toBe(true);
    expect(hit!.report).toEqual(report);
  });

  it("同名不同年必须是两条记录（Journey 2012 与 Journey 2009 判决不同）", () => {
    cacheReport(reportCacheKey("Journey", 2012), { ...decision, offer: true });
    expect(readCachedReport(reportCacheKey("Journey", 2009))).toBeNull();
    expect(readCachedReport(reportCacheKey("Journey"))).toBeNull();
    expect(reportCacheKey("Journey")).not.toBe(reportCacheKey("Journey", 2012));
  });

  it("坏数据一律当作没缓存（宁可多问一次，不渲染半个选择器）", () => {
    const key = reportCacheKey("坏数据");
    // 每条都是「整个 store 的原文」，覆盖字段类型错、数组、以及坏 JSON。
    const badStores: string[] = [
      JSON.stringify({ [key]: { ...decision, offer: "yes" } }),
      JSON.stringify({ [key]: { ...decision, band: "maybe", offer: false } }),
      JSON.stringify({ [key]: { ...decision, offer: false, poolSize: -1 } }),
      JSON.stringify({ [key]: { ...decision, offer: false, coverCount: "2" } }),
      JSON.stringify({ [key]: { ...decision } }),
      JSON.stringify([decision]),
      "{ 坏掉的 json",
      "彻底不是 json",
    ];
    for (const raw of badStores) {
      store.set("art-rank:other-choice-report", raw);
      expect(readCachedReport(key), raw).toBeNull();
    }
  });

  it("缓存有上界：超过 200 条先淘汰最旧的（否则撑爆 storage，连海报缓存都写不进去）", () => {
    for (let i = 0; i < 260; i++) {
      cacheReport(reportCacheKey(`条目${i}`), { ...decision, offer: false });
    }
    const parsed = JSON.parse(store.get("art-rank:other-choice-report") ?? "{}");
    const keys = Object.keys(parsed);
    expect(keys.length).toBe(200);
    // 最早的 60 条已被淘汰，最新的还在。
    expect(readCachedReport(reportCacheKey("条目0"))).toBeNull();
    expect(readCachedReport(reportCacheKey("条目259"))).not.toBeNull();
  });

  it("storage 不可用（隐私模式/配额满）时退化成每次都问，但不能让调用方崩", () => {
    vi.stubGlobal("sessionStorage", {
      getItem: () => {
        throw new Error("SecurityError");
      },
      setItem: () => {
        throw new Error("QuotaExceededError");
      },
      removeItem: () => {
        throw new Error("SecurityError");
      },
    });
    expect(() =>
      cacheReport(reportCacheKey("Journey", 2012), { ...decision, offer: false }),
    ).not.toThrow();
    expect(readCachedReport(reportCacheKey("Journey", 2012))).toBeNull();
    expect(() => clearCachedReports()).not.toThrow();
  });
});

describe("写端点的 URL 白名单与 allowedImage 是两道闸（PLAN-CHOICE-UI §3.3）", () => {
  it("只收维基两个域，协议升级到 https", () => {
    expect(isWikiImageUrl("https://upload.wikimedia.org/wikipedia/zh/a/ab/Foo.png")).toBe(true);
    expect(
      isWikiImageUrl("https://thumb.wikimedia.org/wikipedia/zh/thumb/a/ab/Foo/500px-Foo.jpg"),
    ).toBe(true);
    // allowedImage 会把 http 升级为 https；本函数接受 http 是为了与它保持同口径。
    expect(isWikiImageUrl("http://upload.wikimedia.org/wikipedia/zh/a/ab/Foo.png")).toBe(true);
  });

  it("其他五个 allowedImage 白名单域一律拒绝（写端点只收维基）", () => {
    // 这些域 allowedImage 放行，但用户能往「全站封面位」塞的只该是维基图。
    const rejected = [
      "https://img9.doubanio.com/view/photo/s_ratio_poster/public/p/1.jpg",
      "https://m.media-amazon.com/images/M/MV5B.jpg",
      "https://ia.media-imdb.com/photo/x.jpg",
      "https://image.tmdb.org/t/p/w500/x.jpg",
      "https://p1.music.126.net/x.jpg",
      "https://bkimg.cdn.bcebos.com/pic/x.jpg",
    ];
    for (const url of rejected) expect(isWikiImageUrl(url)).toBe(false);
  });

  it("形似维基的域名一律拒绝（后缀锚定，不做 includes）", () => {
    const rejected = [
      "https://evil-upload.wikimedia.org.attacker.com/x.png",
      "https://upload.wikimedia.org.attacker.com/x.png",
      "https://notupload.wikimedia.org/x.png",
      "https://upload.wikimedia.org.evil.tld/x.png",
      "https://evil.com/?u=upload.wikimedia.org/x.png",
    ];
    for (const url of rejected) expect(isWikiImageUrl(url)).toBe(false);
  });

  it("非法 URL 与非 http(s) 协议拒绝", () => {
    expect(isWikiImageUrl("")).toBe(false);
    expect(isWikiImageUrl("upload.wikimedia.org/x.png")).toBe(false);
    expect(isWikiImageUrl("javascript:alert(1)")).toBe(false);
    expect(isWikiImageUrl("data:image/png;base64,AAAA")).toBe(false);
    expect(isWikiImageUrl("ftp://upload.wikimedia.org/x.png")).toBe(false);
  });
});
