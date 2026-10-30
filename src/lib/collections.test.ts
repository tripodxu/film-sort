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
 * 「保存清单」的两条下限不能混为一谈（2026-10-30 二次修复）。
 *
 * 本地画像榜单 = 1 件起（与 saveWithoutSorting 一致）；
 * 云端清单     = 2 件起（validateCollectionBody / DB CHECK 0021）。
 *
 * 历史事故有两层：① 前端只判「非空」就上传，1 件清单被服务端静默 400，用户却看到
 * 「已保存」；② 第一版修复直接把这整条路径的下限抬到 2，连本地画像也一起拦了，
 * 与 saveWithoutSorting 自相矛盾。这里锁死「本地照存、云端 <2 跳过并明说」的行为。
 */
describe("保存清单的下限：本地 1 件、云端 2 件", () => {
  const code = readFileSync(new URL("./useSorting.ts", import.meta.url), "utf8");
  const saveCustomWorks = code.slice(
    code.indexOf("function saveCustomWorksFn()"),
    code.indexOf("function clearCustomWorksFn()"),
  );

  it("空清单仍然先拦下", () => {
    expect(saveCustomWorks).toMatch(/if \(!kept\.length\) \{/);
    expect(saveCustomWorks).toMatch(/清单为空/);
  });

  it("不再因为 <2 件就在本地保存前 return（那会连本地榜单一起丢掉）", () => {
    expect(saveCustomWorks).not.toMatch(/if \(kept\.length < 2\) \{/);
    expect(saveCustomWorks).not.toMatch(/至少需要 2 件作品才能保存清单/);
  });

  it("云端上传被 items.length >= 2 守卫，1 件时提示「只保存在本地」", () => {
    expect(saveCustomWorks).toMatch(/const canSyncCloud = items\.length >= 2;/);
    expect(saveCustomWorks).toMatch(/if \(canSyncCloud\) \{\s*void saveCollectionCloudFn\(/);
    expect(saveCustomWorks).toMatch(/云端清单至少需要 2 件作品，本次只保存在本地/);
  });

  it("本地落库发生在云端分支之前（1 件清单也要进画像）", () => {
    const persistAt = saveCustomWorks.indexOf("d.persist(mergeRanking(");
    const cloudAt = saveCustomWorks.indexOf("void saveCollectionCloudFn(");
    expect(persistAt).toBeGreaterThan(-1);
    expect(cloudAt).toBeGreaterThan(persistAt);
  });

  it("saveWithoutSorting 仍允许单件榜单（它本来就不上传云端）", () => {
    expect(code).toMatch(/请至少选择 1 件作品/);
  });
});
