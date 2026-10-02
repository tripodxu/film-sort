import { describe, expect, it } from "vitest";
import { detailFields, splitDetailFields } from "./detailFields";

/** 中英双语字典，按调用点的 (zh, en) 约定。 */
const t = (_zh: string, _en: string) => _zh;

/**
 * 以下四份 fixture 是 2026-10-02 线上四个 detail 端点的**实录**（.tmp/dl11.mjs），
 * 只删掉与本断言无关的值。抄实测形状而不是抄想象形状——
 * 形状不对的 fixture 会让断言变成空跑。
 */
const OTHER = {
  id: "wiki-zh-%E9%A3%8E%E4%B9%8B%E6%97%85%E4%BA%BA",
  title: "风之旅人",
  year: 2013,
  poster_url: "https://upload.wikimedia.org/wikipedia/zh/8/89/Journey_PSN_Cover.png",
  content_intro: "《风之旅人》是一款艺术风格的动作冒险游戏。",
  content_source: "zh.wikipedia.org",
  detail_url: "https://zh.wikipedia.org/wiki/%E9%A3%8E%E4%B9%8B%E6%97%85%E4%BA%BA",
};

const MOVIE = {
  title: "爱在",
  pic: "https://example.com/poster.jpg",
  rating: 8.1,
  year: 2025,
  type: "剧情/爱情",
  country: "中国大陆",
  duration: "短片",
  actors: ["徐凯鑫", "叶皓然", "张楚萱"],
  content_intro: "一部短片。",
  content_source: "douban",
};

const BOOK = {
  title: "西游记",
  rating: 9.2,
  author: "吴承恩/黄肃秋 注释",
  press: "人民文学出版社",
  date: "2004-8",
  content_intro: "《西游记》是中国古典小说。",
  content_source: "douban",
  author_intro: "吴承恩，明代文学家。".repeat(20), // 实测 389 字符量级
  作者: "吴承恩",
  译者: "黄肃秋 注释",
  校注: "黄肃秋",
  出版社: "人民文学出版社",
  ISBN: "9787020049294",
  页数: "912",
};

/** music：抽取的响应不一定带评分，所以这里没有 rating 字段。 */
const MUSIC = {
  title: "Yesterday",
  matchedTitle: "Yesterday",
  artist: "Anastasia Kushnir",
  album: "最新热歌慢摇2",
  content_intro: "流行歌曲。",
  content_source: "netease",
};

const labels = (data: Record<string, unknown>) => detailFields(data, t).map((f) => f.label);

describe("detailFields · 内部键永不显示", () => {
  it("other：id / poster_url / detail_url 三条全部消失（线上曾把 150 字符裸 URL 印给人看）", () => {
    const out = labels(OTHER);
    expect(out).not.toContain("id");
    expect(out).not.toContain("poster_url");
    expect(out).not.toContain("detail_url");
  });

  it("movie：pic / rating / content_intro / content_source 不进表格（已由海报/评分/简介单独呈现）", () => {
    const out = labels(MOVIE);
    for (const key of ["title", "pic", "rating", "content_intro", "content_source"]) {
      expect(out).not.toContain(key);
    }
  });

  it("music：matchedTitle 是兜底链的中间产物，不显示", () => {
    expect(labels(MUSIC)).not.toContain("matchedTitle");
    expect(labels(MUSIC)).toEqual(["演唱", "专辑"]);
  });

  it("title 任何一类都不显示（已经在弹窗标题里）", () => {
    for (const data of [OTHER, MOVIE, BOOK, MUSIC]) {
      expect(labels(data as Record<string, unknown>)).not.toContain("title");
    }
  });
});

describe("detailFields · 已知键翻译与顺序", () => {
  it("movie 五个键全部走中文字典", () => {
    expect(labels(MOVIE)).toEqual(["主演", "类型", "地区", "片长", "年份"]);
  });

  it("英文界面下标签是英文词，不是裸键名", () => {
    const en = (zh: string, e: string) => e;
    expect(detailFields(MOVIE, en).map((f) => f.label)).toEqual([
      "Cast",
      "Genre",
      "Region",
      "Runtime",
      "Year",
    ]);
  });

  it("顺序按字典而不是响应插入序（把响应字段倒过来，输出不变）", () => {
    const reversed = Object.fromEntries(Object.entries(MOVIE).reverse());
    expect(detailFields(reversed, t).map((f) => f.label)).toEqual(labels(MOVIE));
  });

  it("book：已知键在前（作者/出版社/出版日期），未知中文键保底照印在后", () => {
    const out = labels(BOOK);
    expect(out.slice(0, 3)).toEqual(["作者", "出版社", "出版日期"]);
    expect(out).toContain("译者");
    expect(out).toContain("ISBN");
    expect(out.indexOf("作者")).toBeLessThan(out.indexOf("译者"));
  });

  it("author 与原始中文键 作者 标签撞车，但 key 不撞（React 重复 key 会错位复用 DOM）", () => {
    const fields = detailFields(BOOK, t);
    const author = fields.filter((f) => f.label === "作者");
    expect(author.length).toBe(2);
    expect(new Set(fields.map((f) => f.key)).size).toBe(fields.length);
  });

  it("数组值用「、」连接（沿用旧实现口径）", () => {
    const cast = detailFields(MOVIE, t).find((f) => f.label === "主演");
    expect(cast?.value).toBe("徐凯鑫、叶皓然、张楚萱");
  });
});

describe("detailFields · 长文本与空值", () => {
  it("author_intro（实测 389 字符量级）被标 long，不挤在表格行里", () => {
    const blocks = detailFields(BOOK, t).filter((f) => f.long);
    expect(blocks.map((f) => f.label)).toContain("author_intro");
    expect(blocks.every((f) => f.value.length > 80)).toBe(true);
  });

  it("短字段不带 long 标记", () => {
    expect(detailFields(MOVIE, t).filter((f) => f.long)).toEqual([]);
  });

  it("未知键同样会被判 long（阈值与键无关）", () => {
    const out = detailFields({ note: "x".repeat(200) }, t);
    expect(out[0].long).toBe(true);
  });

  it("空值跳过：空串 / null / undefined / 空数组都不出字段（String(null) 是 'null'，先判空再转）", () => {
    const out = detailFields(
      { type: "", country: null, duration: undefined, actors: [], year: 2020 },
      t,
    );
    expect(out.map((f) => f.label)).toEqual(["年份"]);
    expect(out.map((f) => f.value).join()).not.toMatch(/null|undefined/);
  });

  it("数组里的 null 也不算数（[null] 不是「有主演」）", () => {
    expect(detailFields({ actors: [null, undefined] }, t)).toEqual([]);
    expect(detailFields({ actors: ["", null, "徐凯鑫"] }, t)[0].value).toBe("徐凯鑫");
  });

  it("0 与 false 不被当成空值杀掉（它们是有意义的值，不是缺失）", () => {
    const out = detailFields({ year: 0, duration: false }, t);
    expect(out.map((f) => f.value).sort()).toEqual(["0", "false"]);
  });

  it("data 为 null / undefined / 空对象时返回空数组", () => {
    expect(detailFields(null, t)).toEqual([]);
    expect(detailFields(undefined, t)).toEqual([]);
    expect(detailFields({}, t)).toEqual([]);
  });
});

describe("splitDetailFields · 两拨分组", () => {
  it("短字段进 rows，长字段进 blocks，且两者拼回去等于原序列", () => {
    const fields = detailFields(BOOK, t);
    const { rows, blocks } = splitDetailFields(fields);
    expect(rows.every((f) => !f.long)).toBe(true);
    expect(blocks.every((f) => f.long)).toBe(true);
    expect([...rows, ...blocks]).toEqual(fields);
  });

  it("纯短文本时 blocks 为空", () => {
    const { rows, blocks } = splitDetailFields(detailFields(MOVIE, t));
    expect(blocks).toEqual([]);
    expect(rows.length).toBe(5);
  });
});

describe("detailFields · 相对旧实现的净收益（用线上实录值断言）", () => {
  it("other：8 行内部数据 → 只剩「年份」一行，且年份排在最前", () => {
    expect(labels(OTHER)).toEqual(["年份"]);
  });

  it("book：旧实现 8 行上限里塞了 389 字符作者生平；新实现把长文本挪出表格", () => {
    const { rows } = splitDetailFields(detailFields(BOOK, t));
    expect(rows.every((f) => f.value.length <= 80)).toBe(true);
    expect(rows.map((f) => f.label)).not.toContain("author_intro");
  });
});
