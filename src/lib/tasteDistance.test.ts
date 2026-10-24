import { describe, expect, it } from "vitest";
import { computeTasteDistance } from "./tasteDistance";

/** 辅助：n 件作品，own 顺序 = 0..n-1，peer 顺序由给定排列给出（值 = ownRank）。 */
const pairsFromPeerOrder = (peerOrder: number[]) =>
  peerOrder.map((ownRank, index) => ({ ownRank, peerRank: index + 1 }));

describe("tasteDistance（Plackett-Luce 似然品味距离，T-20261024-05 批四）", () => {
  it("少于两件不计算", () => {
    expect(computeTasteDistance([])).toBeNull();
    expect(computeTasteDistance([{ ownRank: 1, peerRank: 2 }])).toBeNull();
  });

  it("完全一致的排序得到高分（似然比归一后恒近 100），且分数在 (0, 100] 内", () => {
    const result = computeTasteDistance(pairsFromPeerOrder([1, 2, 3, 4, 5, 6]))!;
    expect(result.symmetric).toBeGreaterThan(95);
    expect(result.symmetric).toBeLessThanOrEqual(100);
    expect(result.peerUnderMine).toBe(result.mineUnderPeer); // 同序双向对称
  });

  it("完全倒置显著低于一致（错得越远扣得越多）", () => {
    const identical = computeTasteDistance(pairsFromPeerOrder([1, 2, 3, 4, 5, 6]))!;
    const reversed = computeTasteDistance(pairsFromPeerOrder([6, 5, 4, 3, 2, 1]))!;
    expect(reversed.symmetric).toBeLessThan(identical.symmetric - 25);
    expect(reversed.symmetric).toBeGreaterThan(0);
  });

  it("轻微分歧落在一致与倒置之间：只交换相邻两件 > 只交换首尾两件", () => {
    const identical = computeTasteDistance(pairsFromPeerOrder([1, 2, 3, 4, 5, 6]))!;
    const nearMiss = computeTasteDistance(pairsFromPeerOrder([1, 3, 2, 4, 5, 6]))!;
    const farMiss = computeTasteDistance(pairsFromPeerOrder([6, 2, 3, 4, 5, 1]))!;
    expect(nearMiss.symmetric).toBeLessThan(identical.symmetric);
    expect(nearMiss.symmetric).toBeGreaterThan(farMiss.symmetric);
    expect(farMiss.symmetric).toBeLessThan(identical.symmetric);
  });

  it("把第 1 名排到第 3 比排到第 6 扣分更多（对名次距离敏感）", () => {
    const nearSwap = computeTasteDistance(pairsFromPeerOrder([3, 2, 1, 4, 5, 6]))!; // 1↔3
    const farSwap = computeTasteDistance(pairsFromPeerOrder([6, 2, 3, 4, 5, 1]))!; // 1↔6
    expect(nearSwap.symmetric).toBeGreaterThan(farSwap.symmetric);
  });

  it("交换双方视角：两个方向值互换、symmetric 不变", () => {
    const pairs = pairsFromPeerOrder([2, 4, 1, 3, 5]);
    const swapped = pairs.map((pair) => ({ ownRank: pair.peerRank, peerRank: pair.ownRank }));
    const a = computeTasteDistance(pairs)!;
    const b = computeTasteDistance(swapped)!;
    expect(a.peerUnderMine).toBe(b.mineUnderPeer);
    expect(a.mineUnderPeer).toBe(b.peerUnderMine);
    expect(a.symmetric).toBe(b.symmetric);
  });

  it("并列名次按下标稳定破序，结果确定且有限", () => {
    const tied = [
      { ownRank: 1, peerRank: 1 },
      { ownRank: 1, peerRank: 2 },
      { ownRank: 1, peerRank: 3 },
      { ownRank: 2, peerRank: 4 },
    ];
    const first = computeTasteDistance(tied)!;
    const second = computeTasteDistance(tied)!;
    expect(first).toEqual(second);
    expect(Number.isFinite(first.symmetric)).toBe(true);
    expect(first.symmetric).toBeGreaterThan(0);
    expect(first.pairCount).toBe(4);
  });

  it("大清单可算且与件数无关（n=120 完全一致仍近 100）", () => {
    const n = 120;
    const identical = computeTasteDistance(
      pairsFromPeerOrder(Array.from({ length: n }, (_, i) => i + 1)),
    )!;
    const noisy = computeTasteDistance(
      pairsFromPeerOrder(Array.from({ length: n }, (_, i) => (i + 7) % n)),
    )!;
    expect(identical.symmetric).toBeGreaterThan(95);
    expect(identical.symmetric).toBeGreaterThan(noisy.symmetric);
  });
});
