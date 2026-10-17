import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/** S1 增量模块的对外契约绊线（T-20261017-01）。
 *
 * 三个模块在 S1 阶段零引用：任何既有文件都不 import 它们，因此不进构建产物。
 * 这里锁定的是「接入时不会踩空」的最小契约面：导出名、冷却默认值、以及
 * compareMetrics 必须用 import type 引 MatchedItem（类型导入会被完全擦除，
 * 一旦写成运行时 import，profile.ts 就会被拖进依赖图）。 */

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

/** 扫描前剥注释：否则文末说明里的旧字段名会把自己的绊线喂绿（PITFALLS 4.48）。 */
function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

describe("preferenceModel 增量模块契约", () => {
  const code = read("./preferenceModel.ts");

  it("导出接入所需的能力值、观测与名次区间 API", () => {
    expect(code).toMatch(/export function createPreferenceModel/);
    expect(code).toMatch(/export function recordObservation/);
    expect(code).toMatch(/export function recordObservations/);
    expect(code).toMatch(/export function expectedWinProbability/);
    expect(code).toMatch(/export function getRankIntervals/);
    expect(code).toMatch(/export function getRankInterval/);
    expect(code).toMatch(/export function getPreferenceOrder/);
    expect(code).toMatch(/export interface RankInterval\b/);
  });

  it("保持不可变更新（返回新 state，不改入参）", () => {
    expect(code).toMatch(/ratings: \{ \.\.\.state\.ratings,/);
  });
});

describe("adaptiveQueue 增量模块契约", () => {
  const code = read("./adaptiveQueue.ts");

  it("冷却默认值与 ranking.ts 的旧常量一致", () => {
    expect(code).toMatch(/export const ADAPTIVE_PAIR_COOLDOWN = 3/);
    expect(code).toMatch(/export const ADAPTIVE_WORK_COOLDOWN = 4/);
  });

  it("暴露选对函数与可注入的序对键", () => {
    expect(code).toMatch(/export function selectAdaptivePair/);
    expect(code).toMatch(/export function adaptivePairKey/);
    expect(code).toMatch(/export function expectedInformation/);
  });

  it("不引入任何随机源，保证可复现", () => {
    expect(code).not.toMatch(/Math\.random/);
  });
});

describe("compareMetrics 增量模块契约", () => {
  const code = read("./compareMetrics.ts");

  it("只用类型导入引 profile.ts，不产生运行时依赖", () => {
    expect(code).toMatch(/import type \{ MatchedItem \} from "\.\/profile"/);
    expect(code).not.toMatch(/^import \{[^}]*\} from "\.\/profile"/m);
  });

  it("新指标与旧字段并存，不删除旧口径", () => {
    expect(code).toMatch(/export function computeCompareMetrics/);
    expect(code).toMatch(/export function orderStats/);
    expect(code).toMatch(/export function bootstrapTau/);
    expect(code).toMatch(/export function shrinkConsensus/);
    expect(stripComments(code)).not.toMatch(/kendallTau/);
  });

  it("自带可复现的伪随机源用于 bootstrap", () => {
    expect(code).toMatch(/function mulberry32/);
    expect(code).not.toMatch(/Math\.random/);
  });
});
