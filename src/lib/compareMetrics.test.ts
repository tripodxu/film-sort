import { describe, expect, it } from "vitest";
import type { MatchedItem } from "./profile";
import { bootstrapTau, computeCompareMetrics, orderStats, shrinkConsensus } from "./compareMetrics";

function item(ownRank: number, peerRank: number): MatchedItem {
  return {
    ownKey: "k" + ownRank,
    peerKey: "k" + ownRank,
    title: "作品 " + ownRank,
    ownRank,
    peerRank,
    difference: ownRank - peerRank,
    matchScore: 90,
    ownSources: [],
    peerSources: [],
  };
}

function ordered(n: number): MatchedItem[] {
  return Array.from({ length: n }, (_, i) => item(i + 1, i + 1));
}

function reversed(n: number): MatchedItem[] {
  return Array.from({ length: n }, (_, i) => item(i + 1, n - i));
}

/** 一个无并列的错位排列，用于 bootstrap 的确定性检查。 */
function mixed(n: number): MatchedItem[] {
  return Array.from({ length: n }, (_, i) => item(i + 1, ((i * 3 + 1) % n) + 1));
}

describe("compareMetrics 榜单比较新增指标", () => {
  it("完全一致的榜单：tau 与两个新一致度都满分", () => {
    const stats = orderStats(ordered(5));
    expect(stats).toMatchObject({
      totalPairs: 10,
      nonTiedPairs: 10,
      tiedPairs: 0,
      concordant: 10,
      discordant: 0,
      tau: 1,
    });
    const metrics = computeCompareMetrics(ordered(5));
    expect(metrics.weightedTau).toBe(100);
    expect(metrics.decayedAgreement).toBe(100);
    expect(metrics.sharedCount).toBe(5);
  });

  it("完全反向的榜单：一致度归零", () => {
    const metrics = computeCompareMetrics(reversed(5));
    expect(metrics.tau).toBe(-1);
    expect(metrics.weightedTau).toBe(0);
    expect(metrics.decayedAgreement).toBe(0);
  });

  it("共同作品不足两件时不产出比较指标", () => {
    const empty = computeCompareMetrics([]);
    expect(empty.sharedCount).toBe(0);
    expect(empty.tau).toBeNull();
    expect(empty.weightedTau).toBeNull();
    expect(empty.decayedAgreement).toBeNull();
    expect(empty.tauCI).toBeNull();
    const single = computeCompareMetrics([item(1, 1)]);
    expect(single.totalPairs).toBe(0);
    expect(single.tau).toBeNull();
  });

  it("并列序对被剔除（与旧一致率口径一致）", () => {
    const stats = orderStats([item(1, 1), item(1, 1)]);
    expect(stats.totalPairs).toBe(1);
    expect(stats.tiedPairs).toBe(1);
    expect(stats.nonTiedPairs).toBe(0);
    expect(stats.tau).toBeNull();
  });

  it("rankDecay = 0 时退化为未加权 tau", () => {
    const shared = [item(1, 1), item(2, 2), item(3, 3), item(4, 5), item(5, 4)];
    const flat = computeCompareMetrics(shared, { rankDecay: 0 });
    expect(flat.tau).toBeCloseTo(0.8, 12);
    expect(flat.weightedTau).toBe(90);
  });

  it("头部加权高于未加权：头部一致、尾部相反的榜单得高分", () => {
    const shared = [item(1, 1), item(2, 2), item(3, 3), item(4, 5), item(5, 4)];
    const head = computeCompareMetrics(shared, { rankDecay: 1 });
    const flat = computeCompareMetrics(shared, { rankDecay: 0 });
    expect(head.weightedTau!).toBeGreaterThan(flat.weightedTau!);
  });

  it("位置折扣一致度：靠前序对权重更大", () => {
    const headConsistent = [item(1, 1), item(2, 2), item(3, 6), item(4, 5), item(5, 4)];
    const headInconsistent = [item(1, 3), item(2, 2), item(3, 1), item(4, 5), item(5, 4)];
    const a = computeCompareMetrics(headConsistent, { rankDecay: 0 });
    const b = computeCompareMetrics(headInconsistent, { rankDecay: 0 });
    expect(a.decayedAgreement!).toBeGreaterThan(b.decayedAgreement!);
  });

  it("bootstrap 对完全一致的榜单给出退化区间", () => {
    const ci = bootstrapTau(ordered(8), { bootstrapRounds: 60 });
    expect(ci).not.toBeNull();
    expect(ci!.low).toBe(100);
    expect(ci!.high).toBe(100);
    expect(bootstrapTau(reversed(8), { bootstrapRounds: 60 })!.high).toBe(0);
  });

  it("bootstrap 样本或轮数不足时返回 null", () => {
    expect(bootstrapTau(ordered(3), { bootstrapRounds: 60 })).toBeNull();
    expect(bootstrapTau(ordered(8), { bootstrapRounds: 10 })).toBeNull();
  });

  it("bootstrap 同种子可复现且区间包含在 0-100 内", () => {
    const options = { bootstrapRounds: 40 };
    const first = bootstrapTau(mixed(10), options);
    const second = bootstrapTau(mixed(10), options);
    expect(JSON.stringify(first)).toBe(JSON.stringify(second));
    expect(first!.low).toBeGreaterThanOrEqual(0);
    expect(first!.high).toBeLessThanOrEqual(100);
    expect(first!.low).toBeLessThanOrEqual(first!.high);
  });

  it("样本量收缩：小样本向先验收缩，大样本保留原分", () => {
    expect(shrinkConsensus(100, 0)).toBe(50);
    expect(shrinkConsensus(100, 6)).toBe(75);
    expect(shrinkConsensus(100, 54)).toBe(95);
    expect(shrinkConsensus(120, 60)).toBe(100);
    expect(shrinkConsensus(-20, 60)).toBe(0);
  });

  it("只有显式传入 rawConsensus 才输出收缩共识分", () => {
    const without = computeCompareMetrics(ordered(6));
    expect(without.consensusShrunk).toBeNull();
    const withRaw = computeCompareMetrics(ordered(6), { rawConsensus: 90 });
    expect(withRaw.consensusShrunk).toBe(70);
  });
});
