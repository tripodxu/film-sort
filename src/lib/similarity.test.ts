import { describe, expect, it } from "vitest";
import { rankingSimilarity } from "./similarity";

const w = (title: string, year?: number, creator?: string) => ({ title, year, creator });

describe("rankingSimilarity", () => {
  it("完全一致 → 重合 100 / 顺序 100 / 满分", () => {
    const list = [w("A", 2001), w("B", 2002), w("C", 2003)];
    expect(rankingSimilarity(list, list)).toEqual({
      sharedCount: 3,
      jaccard: 100,
      orderAgreement: 100,
      score: 100,
    });
  });
  it("部分重合:Jaccard 口径,顺序相反时一致度 0", () => {
    const mine = [w("A"), w("B"), w("C"), w("D")];
    const theirs = [w("C"), w("B")]; // 我的顺序 B<C,他们的 C<B → 0
    const result = rankingSimilarity(mine, theirs);
    expect(result.sharedCount).toBe(2);
    expect(result.jaccard).toBe(50); // 共同2 / 并集{A,B,C,D}=4
    expect(result.orderAgreement).toBe(0);
  });
  it("顺序完全一致 → 100", () => {
    const mine = [w("A"), w("B"), w("C"), w("D"), w("E")];
    const theirs = [w("X"), w("B"), w("C"), w("D")];
    expect(rankingSimilarity(mine, theirs).orderAgreement).toBe(100);
  });
  it("无共同 → 全 null", () => {
    const result = rankingSimilarity([w("A")], [w("X")]);
    expect(result).toEqual({ sharedCount: 0, jaccard: null, orderAgreement: null, score: null });
  });
  it("单件共同:有重合无顺序,score = jaccard", () => {
    const result = rankingSimilarity([w("A"), w("B")], [w("A"), w("X")]);
    expect(result.sharedCount).toBe(1);
    expect(result.orderAgreement).toBeNull();
    expect(result.score).toBe(result.jaccard);
  });
  it("年份/创作者不同视为不同作品(workIdentity 口径)", () => {
    const result = rankingSimilarity([w("A", 2001, "X")], [w("A", 2002, "X")]);
    expect(result.sharedCount).toBe(0);
  });
  it("大小写/空白归一化后可匹配", () => {
    const result = rankingSimilarity([w("amélie  ")], [w("Amélie")]);
    expect(result.sharedCount).toBe(1);
  });
  it("重复键只计首次名次", () => {
    const result = rankingSimilarity([w("A"), w("A"), w("B")], [w("A")]);
    expect(result.sharedCount).toBe(1);
    expect(result.jaccard).toBe(50); // 共同1 / 并集2
  });
});
