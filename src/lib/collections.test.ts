import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { importCollection } from "./collections";

describe("importCollection", () => {
  it("imports simple text list", () => {
    const result = importCollection("film", "龙猫\n千与千寻\n风之谷");
    expect(result.kind).toBe("film");
    expect(result.works).toHaveLength(3);
    expect(result.works[0].title).toBe("龙猫");
  });

  it("imports comma-separated list", () => {
    const result = importCollection("book", "百年孤独, 活着, 1984");
    expect(result.works).toHaveLength(3);
  });

  it("imports Chinese punctuation separated list", () => {
    const result = importCollection("music", "七里香、范特西、寓言");
    expect(result.works).toHaveLength(3);
  });

  it("imports JSON array of strings", () => {
    const result = importCollection("film", '["龙猫", "千与千寻"]');
    expect(result.works).toHaveLength(2);
    expect(result.works[0].title).toBe("龙猫");
  });

  it("imports JSON array of objects", () => {
    const json = JSON.stringify([
      { title: "Kind of Blue", creator: "Miles Davis", year: 1959 },
      { title: "Blue", creator: "Joni Mitchell", year: 1971 },
    ]);
    const result = importCollection("music", json);
    expect(result.works).toHaveLength(2);
    expect(result.works[0].creator).toBe("Miles Davis");
    expect(result.works[0].year).toBe(1959);
  });

  it("imports JSON with works key", () => {
    const json = JSON.stringify({ works: [{ title: "A" }, { title: "B" }] });
    const result = importCollection("film", json);
    expect(result.works).toHaveLength(2);
  });

  it("deduplicates by normalized title", () => {
    const result = importCollection("film", "龙猫\n龙猫\n千与千寻\n千与千寻");
    expect(result.works).toHaveLength(2);
  });

  it("rejects fewer than 2 works", () => {
    expect(() => importCollection("film", "龙猫")).toThrow();
  });

  it("rejects more than 1000 works", () => {
    const list = Array.from({ length: 1001 }, (_, i) => `作品${i}`).join("\n");
    expect(() => importCollection("film", list)).toThrow(/2 to 1000/);
  });

  it("rejects empty titles", () => {
    expect(() => importCollection("film", "\n\n")).toThrow();
  });

  it("assigns auto-generated IDs", () => {
    const result = importCollection("book", "书A\n书B\n书C");
    expect(result.works[0].id).toMatch(/^custom-/);
  });

  it("preserves poster URLs from JSON", () => {
    const json = JSON.stringify([
      { title: "A", posterUrls: ["https://example.com/a.jpg"] },
      { title: "B" },
    ]);
    const result = importCollection("film", json);
    expect(result.works[0].posterUrls).toEqual(["https://example.com/a.jpg"]);
    expect(result.works[1].posterUrls).toEqual([]);
  });

  it("filters non-HTTPS poster URLs", () => {
    const json = JSON.stringify([
      { title: "A", posterUrls: ["http://insecure.com/a.jpg", "https://secure.com/b.jpg"] },
      { title: "B" },
    ]);
    const result = importCollection("film", json);
    expect(result.works[0].posterUrls).toEqual(["https://secure.com/b.jpg"]);
  });

  it("generates kind-appropriate title", () => {
    const film = importCollection("film", "A\nB");
    const book = importCollection("book", "A\nB");
    expect(film.title).toContain("电影");
    expect(book.title).toContain("书籍");
  });

  it("sets topN to min(10, works.length)", () => {
    const small = importCollection("film", "A\nB\nC");
    expect(small.topN).toBe(3);
    const large = importCollection(
      "film",
      Array.from({ length: 20 }, (_, i) => `作品${i}`).join("\n"),
    );
    expect(large.topN).toBe(10);
  });
});

/**
 * 「保存清单」的最小件数必须与服务端同口径（P0 修复）。
 *
 * 服务端 validateCollectionBody 与 DB CHECK（0021）都要求 ≥2；前端曾只判「非空」，
 * 于是 1 件清单被静默 400，用户却看到「已保存」提示。这里锁死前端闸门与文案。
 */
describe("保存清单的最小件数闸门", () => {
  const code = readFileSync(new URL("./useSorting.ts", import.meta.url), "utf8");

  it("saveCustomWorks 在 >=2 件之前就返回，且提示不能是「清单为空」", () => {
    expect(code).toMatch(/const kept = customWorks\.filter\(\(w\) => !customDeselected/);
    expect(code).toMatch(/if \(kept\.length < 2\) \{/);
    expect(code).toMatch(/至少需要 2 件作品才能保存清单/);
  });

  it("去重后不足 2 件也拦下（同名同作者合并后不能落库）", () => {
    expect(code).toMatch(/if \(items\.length < 2\) \{/);
  });

  it("saveWithoutSorting 仍允许单件榜单（不进云端清单，只进画像）", () => {
    // 画像榜单的下限是 1，与云端清单不同；两处闸门不能一起改。
    expect(code).toMatch(/请至少选择 1 件作品/);
  });
});
