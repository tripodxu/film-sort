import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { rankingRowKey } from "./rankingKey";

const read = (path: string) => readFileSync(path, "utf8");
/** 源码绊线一律先剥注释，否则解释性注释会把自己喂绿（PITFALLS 4.48）。 */
const stripComments = (code: string) =>
  code.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\n]*\/\/.*$/gm, "");

describe("rankingRowKey", () => {
  it("维度与标题进键：不同内容互不撞车", () => {
    expect(rankingRowKey({ kind: "film", collectionTitle: "2025 年度" }, 0)).not.toBe(
      rankingRowKey({ kind: "book", collectionTitle: "2025 年度" }, 0),
    );
    expect(rankingRowKey({ kind: "film", collectionTitle: "A" }, 0)).not.toBe(
      rankingRowKey({ kind: "film", collectionTitle: "B" }, 0),
    );
  });

  it("同维度同标题的重复项靠下标区分", () => {
    const entry = { kind: "music" as const, collectionTitle: "单曲循环" };
    expect(rankingRowKey(entry, 0)).not.toBe(rankingRowKey(entry, 1));
  });

  it("换画像时同一个位置不会复用上一份榜单的键", () => {
    const before = rankingRowKey({ kind: "film", collectionTitle: "旧画像" }, 2);
    const after = rankingRowKey({ kind: "film", collectionTitle: "新画像" }, 2);
    expect(before).not.toBe(after);
  });

  it("三处动态榜单列表都改用内容键，不再出现 key={idx}", () => {
    const app = stripComments(read("src/App.tsx"));
    const compare = stripComments(read("src/views/CompareView.tsx"));
    expect(app).not.toContain("key={idx}");
    expect(compare).not.toContain("key={idx}");
    expect(app).toContain("key={rankingRowKey(entry, idx)}");
    expect(compare.match(/key=\{rankingRowKey\(entry, idx\)\}/g) ?? []).toHaveLength(2);
  });
});
