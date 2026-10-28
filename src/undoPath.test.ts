import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import {
  createRankingState,
  chooseSide,
  undoLastAction,
  serializeRankingState,
  deserializeRankingState,
  getRankingResult,
} from "./lib/ranking";

/**
 * 「返回最后一次取舍」的路径契约（全仓审查 2026-10-27 · P0-1）。
 *
 * 事故形态：画像页的撤销按钮直接调 `undoLastAction`，它是从头 `createRankingState` +
 * 逐步 `replayDecision` 的全量重放，而 adaptive 模式下每一步都要重算 BT 模型。
 * 实测（n=300 / 1309 步）：重放撤销 **16.4 秒**，主线程同步阻塞，浏览器弹「页面无响应」。
 * 同期测得快照栈路径只需 **2 毫秒**，同一份状态。
 *
 * 另一个被实测推翻的假设：`findPath` 的 O(V×E) 不是主因——改成邻接表后耗时几乎没变。
 * 真正的成本在「每步重算模型」，所以任何形式的「从头重放」都救不回来，必须不重放。
 *
 * 契约：优先快照（`deserializeRankingState`），栈空才退回重放；重放保留为兜底，不许删。
 */
function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}
const strip = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\n]*\/\/.*$/gm, "");

describe("撤销路径（P0-1）", () => {
  it("画像页先走快照，栈空才退回全量重放", () => {
    const view = strip(read("./views/ProfileView.tsx"));
    expect(view).toContain("if (!rewindLastChoice()) setRanking(undoLastAction(ranking));");
  });

  it("rewindLastChoice 走反序列化快照，且完全不碰重放", () => {
    const hook = strip(read("./lib/useSorting.ts"));
    const body = hook.slice(hook.indexOf("function rewindLastChoice"));
    const fn = body.slice(0, body.indexOf("\n  function "));
    expect(fn).toContain("rankingSnapshots.current.pop()");
    expect(fn).toContain("deserializeRankingState(previous)");
    // 反向锁：谁把重放塞回这个函数，这条就红
    expect(fn).not.toContain("replayDecision");
    expect(fn).not.toContain("undoLastAction");
    expect(fn).not.toContain("createRankingState");
  });

  it("重放仍作为兜底保留（跳过 50 步上限时不至于没得撤）", () => {
    const lib = read("./lib/ranking.ts");
    expect(lib).toContain("export function undoLastAction(");
    const view = strip(read("./views/ProfileView.tsx"));
    expect(view).toContain("undoLastAction(ranking)");
  });

  it("快照栈上限仍是 50（单份可达数百 KB，500 份会爆内存）", () => {
    const hook = strip(read("./lib/useSorting.ts"));
    expect(hook).toContain(
      "if (rankingSnapshots.current.length >= 50) rankingSnapshots.current.shift();",
    );
  });
});

/**
 * 换路径必须换得「一模一样」。
 *
 * 上面几条锁的是「走了哪条路」，这一条锁的是「走完结果相同」——快照是序列化的历史状态，
 * 重放是重新算一遍；两者只要有一条不等，就说明快照丢了某个字段（新加的状态字段最容易漏）。
 */
describe("快照撤销 == 重放撤销（语义等价）", () => {
  const ids = (n: number) => Array.from({ length: n }, (_, i) => `item-${i}`);

  it("classic / adaptive 每一步的撤销结果都与 undoLastAction 逐字段一致", () => {
    for (const mode of ["classic", "adaptive"] as const) {
      let state = createRankingState(ids(12), { seed: "equiv-seed", topN: 4, mode });
      for (let i = 0; i < 20 && !state.completed; i++) {
        const snapshot = serializeRankingState(state);
        state = chooseSide(state, "left");
        const viaReplay = undoLastAction(state);
        const viaSnapshot = deserializeRankingState(snapshot);
        expect(getRankingResult(viaSnapshot)).toEqual(getRankingResult(viaReplay));
        expect(viaSnapshot.comparisonCount).toBe(viaReplay.comparisonCount);
        expect(viaSnapshot.processedCount).toBe(viaReplay.processedCount);
        expect(viaSnapshot.rankedIds).toEqual(viaReplay.rankedIds);
        // 决策日志与偏好边是撤销最容易被静默改写的地方
        expect(viaSnapshot.decisionLog.length).toBe(viaReplay.decisionLog.length);
        expect(viaSnapshot.preferenceEdges.length).toBe(viaReplay.preferenceEdges.length);
      }
    }
  });
});
