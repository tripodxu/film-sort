import { describe, expect, it } from "vitest";
import { buildJevQuestions, buildJevState, validateJevConfig } from "./typesafe";

describe("validateJevConfig", () => {
  it("接受合法 key", () => {
    expect(validateJevConfig({ apiKey: "ts_abcdef123456" })).toEqual({
      apiKey: "ts_abcdef123456",
    });
  });
  it("拒绝过短/过长/含控制字符/非字符串 key", () => {
    expect(validateJevConfig({ apiKey: "short" })).toBeNull();
    expect(validateJevConfig({ apiKey: "x".repeat(257) })).toBeNull();
    expect(validateJevConfig({ apiKey: "bad\nkey123" })).toBeNull();
    expect(validateJevConfig({ apiKey: 123 })).toBeNull();
    expect(validateJevConfig(null)).toBeNull();
  });
});

const input = {
  kind: "film" as const,
  collectionTitle: "豆瓣高分片单",
  works: [
    { title: "盗梦空间", year: 2010, creator: "克里斯托弗·诺兰" },
    { title: "霸王别姬", year: 1993 },
  ],
};

describe("buildJevState / buildJevQuestions", () => {
  it("state 含品味档案、清单头与编号作品行", () => {
    const state = buildJevState({ ...input, profileContext: "[film] 片单A: A > B" });
    expect(state).toContain("【用户品味档案】");
    expect(state).toContain("[film] 片单A: A > B");
    expect(state).toContain("「豆瓣高分片单」");
    expect(state).toContain("1. 《盗梦空间》(2010,创作者:克里斯托弗·诺兰)");
    expect(state).toContain("2. 《霸王别姬》(1993)");
  });
  it("无品味档案时不输出该段;英文 locale 输出英文句式", () => {
    expect(buildJevState(input)).not.toContain("【用户品味档案】");
    const en = buildJevState({ ...input, locale: "en" });
    expect(en).toContain('1. "盗梦空间"');
  });
  it("每件作品一个 w{i} Noul 问题,含标题与评分说明", () => {
    const questions = buildJevQuestions(input);
    expect(Object.keys(questions)).toEqual(["w0", "w1"]);
    expect(questions.w0.type).toBe("noul");
    expect(questions.w0.instructions).toContain("盗梦空间");
    expect(questions.w0.instructions).toContain("0 = ");
  });
  it("state 文本把换行/多余空白压平,防注入排版", () => {
    const state = buildJevState({ ...input, works: [{ title: "a\n\nb  c" }] });
    expect(state).toContain("《a b c》");
  });
});
