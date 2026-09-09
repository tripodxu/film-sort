import { describe, it, expect } from "vitest";
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

  it("rejects more than 300 works", () => {
    const list = Array.from({ length: 301 }, (_, i) => `作品${i}`).join("\n");
    expect(() => importCollection("film", list)).toThrow();
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
    const large = importCollection("film", Array.from({ length: 20 }, (_, i) => `作品${i}`).join("\n"));
    expect(large.topN).toBe(10);
  });
});
