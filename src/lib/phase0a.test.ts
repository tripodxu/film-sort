import { describe, expect, it } from "vitest";
import { Group, type Points } from "three";
import {
  choosePreferred,
  createRankingState,
  deserializeRankingState,
  getCurrentComparison,
  getRankingProgress,
  serializeRankingState,
} from "./ranking";
import { resolveRankingTabKey } from "./useSorting";
import { createBlackholeEffect } from "./orbEffects/blackhole";
import type { OrbHost } from "./orbEffects/types";
import type { ArtisticProfile } from "./profile";

describe("Phase 0a 前端核心状态与算法缺陷回归", () => {
  it("precise 模式初始 estimatedTotalComparisons 恒为整数，序列化往返完全相等", () => {
    for (const count of [3, 4, 5, 7, 11]) {
      const state = createRankingState(
        Array.from({ length: count }, (_, i) => `w-${i}`),
        { seed: "s1", topN: 2, mode: "precise" },
      );
      expect(Number.isInteger(state.estimatedTotalComparisons)).toBe(true);
      expect(deserializeRankingState(serializeRankingState(state))).toEqual(state);
    }
  });

  it("adaptive 模式在 25% 预算处进度条不抢跑 99%", () => {
    const ids = Array.from({ length: 12 }, (_, i) => `item-${i}`);
    let state = createRankingState(ids, { seed: "p0a", topN: 5, mode: "adaptive" });
    // 12 件预算为 48 步；走完前 12 步（25% 预算）时所有作品基本已出场一次
    for (let step = 0; step < 12; step += 1) {
      const pair = getCurrentComparison(state);
      if (!pair) break;
      state = choosePreferred(state, pair.leftId);
    }
    const progress = getRankingProgress(state);
    expect(progress.fraction).toBeGreaterThan(0.15);
    expect(progress.fraction).toBeLessThan(0.5);
  });

  it("resolveRankingTabKey 精确定位跨维度新增榜单的槽位键", () => {
    const mockProfile: ArtisticProfile = {
      version: 2,
      profileId: "p-1",
      profileName: "测试画像",
      updatedAt: "2026-11-18T00:00:00.000Z",
      rankings: [
        {
          version: 1,
          profileId: "p-1",
          profileName: "测试画像",
          kind: "film",
          collectionTitle: "华语十佳",
          createdAt: "2026-11-18T00:00:00.000Z",
          items: [{ id: "f1", title: "霸王别姬", rank: 1 }],
        },
        {
          version: 1,
          profileId: "p-1",
          profileName: "测试画像",
          kind: "music",
          collectionTitle: "年度歌单 A",
          createdAt: "2026-11-18T00:00:00.000Z",
          items: [{ id: "m1", title: "晴天", rank: 1 }],
        },
        {
          version: 1,
          profileId: "p-1",
          profileName: "测试画像",
          kind: "music",
          collectionTitle: "年度歌单 B",
          createdAt: "2026-11-18T00:00:00.000Z",
          items: [{ id: "m2", title: "夜曲", rank: 1 }],
        },
      ],
    };
    expect(resolveRankingTabKey(mockProfile, "music", "年度歌单 B")).toBe("music-2");
    expect(resolveRankingTabKey(mockProfile, "music", "不存在标题")).toBe("music-1");
    expect(resolveRankingTabKey(mockProfile, "book")).toBe("book");
  });

  it("blackhole 光球特效更新时保持三维星尘轨道半径，不被 RGB 颜色值覆盖", () => {
    const scene = new Group();
    const effect = createBlackholeEffect({ scene, reducedMotion: false } as unknown as OrbHost, {
      accent: "#d8f86a",
      accent2: "#c9ff74",
      film: "#d8f86a",
      book: "#efaa97",
      music: "#97bfc5",
      other: "#c7c2ee",
      bg: "#080a0a",
    });
    effect.update(1.5, { x: 0, y: 0 });
    const group = scene.children[0] as Group;
    const dust = group.children[group.children.length - 1] as Points;
    const pos = dust.geometry.getAttribute("position").array as Float32Array;
    let hasNegativeCoord = false;
    let maxRadius = 0;
    for (let i = 0; i < pos.length; i += 3) {
      if (pos[i] < -0.2 || pos[i + 1] < -0.2 || pos[i + 2] < -0.2) hasNegativeCoord = true;
      const r = Math.hypot(pos[i], pos[i + 1], pos[i + 2]);
      if (r > maxRadius) maxRadius = r;
    }
    // 修复前颜色分量恒在 [0, 1.5] 正区间；修复后轨道覆盖负半轴且外圈半径 > 2.5
    expect(hasNegativeCoord).toBe(true);
    expect(maxRadius).toBeGreaterThan(2.5);
    effect.dispose();
  });
});
