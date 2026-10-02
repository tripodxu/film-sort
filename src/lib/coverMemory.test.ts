import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { posterMediaKey } from "../../shared/posterKey";
import {
  clearCoverMemory,
  coverMemoryKey,
  coverNameKey,
  memorySuppliesCover,
  mergeCoverRecall,
  recallCoverChoice,
  rememberCoverChoice,
} from "./coverMemory";

const WIKI = "https://upload.wikimedia.org/wikipedia/commons/2/2a/500px-Journey.jpg";

describe("消歧记忆（PLAN-COVER-MEMORY）", () => {
  const store = new Map<string, string>();
  // vitest 跑在 node 环境（environment: "node"），没有 sessionStorage。
  // 照抄 coverChoice.test.ts 的手写桩，不引 jsdom（PITFALLS 4.12）。
  beforeEach(() => {
    store.clear();
    vi.stubGlobal("sessionStorage", {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
    });
    clearCoverMemory();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  const choice = (over: Partial<Parameters<typeof rememberCoverChoice>[0]> = {}) => ({
    title: "Journey",
    english: "Journey",
    year: 2012,
    url: WIKI,
    wikiTitle: "Journey (2012 video game)",
    ...over,
  });

  it("精确往返：裁决过的那一件自己能取回那张图", () => {
    rememberCoverChoice(choice());
    const hit = recallCoverChoice(coverMemoryKey("Journey", "Journey", 2012), "Journey");
    expect(hit?.url).toBe(WIKI);
    expect(hit?.exact).toBe(true);
  });

  it("同名继承：同一页里另一件同名作品（不同年份）取到同一张图", () => {
    rememberCoverChoice(choice());
    const other = recallCoverChoice(coverMemoryKey("Journey", "Journey", 2009), "Journey");
    expect(other?.url).toBe(WIKI);
    expect(other?.exact).toBe(false);
  });

  it("不同名不继承：裁决 Journey 之后查日常幻想是空的", () => {
    rememberCoverChoice(choice());
    expect(recallCoverChoice(coverMemoryKey("日常幻想", "日常幻想", 2020), "日常幻想")).toBeNull();
  });

  it("精确行优先于同名行：用户改选过的这一件用他自己那次的裁决", () => {
    const other = "https://upload.wikimedia.org/wikipedia/commons/1/1b/500px-Dodge.jpg";
    rememberCoverChoice(choice());
    rememberCoverChoice(choice({ year: 2009, url: other, wikiTitle: "Journey (2009 film)" }));
    // 两件各自的那次裁决都还在：名字行被覆盖**不影响**精确行。
    expect(recallCoverChoice(coverMemoryKey("Journey", "Journey", 2012), "Journey")?.url).toBe(
      WIKI,
    );
    const hit2009 = recallCoverChoice(coverMemoryKey("Journey", "Journey", 2009), "Journey");
    expect(hit2009?.url).toBe(other);
    expect(hit2009?.exact).toBe(true);
  });

  it("同名行记的是**最近那一次**裁决（用户改主意以最后一次为准）", () => {
    const other = "https://upload.wikimedia.org/wikipedia/commons/1/1b/500px-Dodge.jpg";
    rememberCoverChoice(choice());
    rememberCoverChoice(choice({ year: 2009, url: other, wikiTitle: "Journey (2009 film)" }));
    // 第三个从未被裁决过的同名作品继承的是**最后那次**，不是第一次：
    // 同一个名字，用户刚改过主意，按旧的来才是违反用户意图。
    const third = recallCoverChoice(coverMemoryKey("Journey", "Journey", 2016), "Journey");
    expect(third?.url).toBe(other);
    expect(third?.exact).toBe(false);
  });

  it("空 wikiTitle 仍然记：裁决本身有效，条目未知不影响传播", () => {
    rememberCoverChoice(choice({ wikiTitle: "" }));
    const hit = recallCoverChoice(coverMemoryKey("Journey", "Journey", 2009), "Journey");
    expect(hit?.url).toBe(WIKI);
    expect(hit?.wikiTitle).toBe("");
  });

  it("坏数据一律当作没记过（宁可多渲染一次，也不渲染一个坏地址）", () => {
    const bad: string[] = [
      "{ 不是 json",
      "[]",
      "null",
      JSON.stringify({ [coverNameKey("Journey")]: { url: 42 } }),
      JSON.stringify({ [coverNameKey("Journey")]: { wikiTitle: "x" } }),
      // 地址不在维基图域：sessionStorage 不能当可信输入（也可能是旧版本写下的）。
      JSON.stringify({ [coverNameKey("Journey")]: { url: "https://evil.example/x.jpg" } }),
    ];
    for (const raw of bad) {
      clearCoverMemory();
      store.set("art-rank:cover-choice", raw);
      expect(recallCoverChoice(coverMemoryKey("Journey", "Journey", 2012), "Journey")).toBeNull();
    }
  });

  it("空地址不入记忆：没有封面就没有可继承的东西", () => {
    rememberCoverChoice(choice({ url: "" }));
    expect(recallCoverChoice(coverMemoryKey("Journey", "Journey", 2012), "Journey")).toBeNull();
  });

  it("clearCoverMemory 之后记忆确实没了", () => {
    rememberCoverChoice(choice());
    clearCoverMemory();
    expect(recallCoverChoice(coverMemoryKey("Journey", "Journey", 2012), "Journey")).toBeNull();
  });

  it("键与服务端同口径：与 posterMediaKey(…, 'other', …) 逐字相等", () => {
    expect(coverMemoryKey("Journey", "Journey", 2012)).toBe(
      posterMediaKey("Journey", "Journey", "other", 2012),
    );
    // 大小写与全角差异要被归一，否则读不到自己刚写的记忆。
    expect(coverMemoryKey("Journey", "Journey", 2012)).toBe(
      coverMemoryKey(" Journey ", "JOURNEY", 2012),
    );
    // posterKeyYear 的 1800–2200 口径在两端同时生效：1503 被丢。
    expect(coverMemoryKey("蒙娜丽莎", "Mona Lisa", 1503)).toBe(
      coverMemoryKey("蒙娜丽莎", "Mona Lisa", undefined),
    );
  });

  it("两行并存：名字行的键与精确行不可能相撞", () => {
    expect(coverNameKey("other|名字")).toMatch(/^other-name\|/);
    expect(coverNameKey("Journey")).not.toBe(coverMemoryKey("Journey", "Journey", 2012));
    rememberCoverChoice(choice());
    // 两条都在表里，精确行的裁决没有被名字行覆盖。
    const raw = JSON.parse(store.get("art-rank:cover-choice") ?? "{}") as Record<string, unknown>;
    expect(Object.keys(raw)).toContain(coverMemoryKey("Journey", "Journey", 2012));
    expect(Object.keys(raw)).toContain(coverNameKey("Journey"));
  });

  it("刷新后记忆仍在（真的落到了 sessionStorage，不是只活在内存副本里）", async () => {
    rememberCoverChoice(choice());
    // 模拟一次刷新：整份模块重新求值（内存副本归零），底层存储不动。
    // clearCoverMemory 不能用——它连底层存储一起删了，那样测的是删除不是持久化。
    vi.resetModules();
    const reloaded = await import("./coverMemory");
    const hit = reloaded.recallCoverChoice(
      reloaded.coverMemoryKey("Journey", "Journey", 2009),
      "Journey",
    );
    expect(hit?.url).toBe(WIKI);
  });

  it("存过一次之后底层存储确实被写过（内存副本会掩盖「压根没写」）", () => {
    rememberCoverChoice(choice());
    expect(store.get("art-rank:cover-choice")).toContain("500px-Journey.jpg");
  });

  it("上界：条目多到触顶时淘汰最旧的一半，最新的仍在", () => {
    // 一次裁决写两行，所以 60 次裁决 = 120 行 > COVER_MEMORY_MAX(100)。
    for (let i = 0; i < 60; i += 1) {
      rememberCoverChoice(choice({ title: `作品${i}`, english: `作品${i}`, year: 2000 + i }));
    }
    const raw = JSON.parse(store.get("art-rank:cover-choice") ?? "{}") as Record<string, unknown>;
    expect(Object.keys(raw).length).toBeLessThanOrEqual(100);
    // 最新那条一定还在（淘汰只砍最旧的一半）。
    expect(recallCoverChoice(coverMemoryKey("作品59", "作品59", 2059), "作品59")).not.toBeNull();
    // 最旧那条已被淘汰：它没有别的同名作品可以继承。
    expect(recallCoverChoice(coverMemoryKey("作品0", "作品0", 2000), "作品0")).toBeNull();
  });
});

describe("记忆能不能替这一格省掉一次上游回源", () => {
  const WIKI = "https://upload.wikimedia.org/wikipedia/commons/2/2a/500px-Journey.jpg";
  it("只有用户对**这一件本人**裁决过才省：继承来的那张不省", () => {
    // 精确：用户已经亲口回答过这个问题，再问上游只会把用户的裁决挤到第二位。
    expect(memorySuppliesCover({ url: WIKI, wikiTitle: "t", exact: true })).toBe(true);
    // 继承：只保证这一格不空，这一件自己将来仍可能解析出别的封面，
    // 为一个已经有东西显示的格子白烧一次维基回源不值得。
    expect(memorySuppliesCover({ url: WIKI, wikiTitle: "t", exact: false })).toBe(false);
    expect(memorySuppliesCover(null)).toBe(false);
  });
});

describe("继承是非破坏的：只填空格，绝不覆盖已有的封面", () => {
  const WIKI = "https://upload.wikimedia.org/wikipedia/commons/2/2a/500px-Journey.jpg";
  const OWN = "https://upload.wikimedia.org/wikipedia/commons/3/3c/500px-Monument.jpg";
  const row = (exact: boolean) => ({ url: WIKI, wikiTitle: "t", exact });

  it("精确裁决排在最前（用户亲自选的那张优先于作品自带与解析结果）", () => {
    expect(mergeCoverRecall([OWN], row(true))).toEqual([WIKI, OWN]);
    expect(mergeCoverRecall([], row(true))).toEqual([WIKI]);
  });
  it("精确裁决不产生重复项", () => {
    expect(mergeCoverRecall([WIKI, OWN], row(true))).toEqual([WIKI, OWN]);
  });

  it("同名继承只在**一个候选都没有**时补位：已有的封面一律不动", () => {
    // 这一件自己已经判对（有封面），用户的同名裁决不许把它换成猜的那张。
    expect(mergeCoverRecall([OWN], row(false))).toEqual([OWN]);
    // 但迭代 7 的空格子（absent / throttled，urls 为空）能被填上。
    expect(mergeCoverRecall([], row(false))).toEqual([WIKI]);
    // 反过来这条把 merge 的两个分支钉死：精确行的图**必须**压过已有候选，
    // 否则「用户亲自选的那张」会被同名继承的分支降级掉。
    // （只写「同名继承不覆盖」是不够的——那个反例两个分支都成立，
    //  所以当初反转 merge 里的分支顺序时测试仍是绿的。）
    expect(mergeCoverRecall([OWN], row(true))).toEqual([WIKI, OWN]);
  });

  it("没有记忆时原样返回（不改动调用方的顺序与内容）", () => {
    expect(mergeCoverRecall([OWN, WIKI], null)).toEqual([OWN, WIKI]);
    expect(mergeCoverRecall([], null)).toEqual([]);
  });
});
