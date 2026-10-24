import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/** rankMode 显式传参绊线（T-20261014-09）。
 *
 * 旧写法：SetupView 把选择写进 localStorage，useSorting.startRanking() 再读出来——
 * 隐私模式下写读双双失效时，无声回退 classic，与用户点的 quick/precise 分叉。
 * 新契约：SetupView 传 `active.value`，startRanking(mode) 接参并校验白名单。
 * localStorage 只剩 SetupView 的记忆功能，不再是起跑真相源。 */

function read(rel: string): string {
  return readFileSync(new URL(rel, import.meta.url), "utf8");
}

describe("rankMode 显式传参", () => {
  it("useSorting.startRanking 接 mode 参数并校验白名单", () => {
    const code = read("./lib/useSorting.ts");
    expect(code).toMatch(/function startRanking\(mode: RankingMode\)/);
    expect(code).toMatch(/RANKING_MODES\.includes\(mode\) \? mode : "classic"/);
  });

  it("useSorting 起跑不再读 localStorage 的 rank-mode（隐式耦合已断）", () => {
    const code = read("./lib/useSorting.ts");
    expect(code).not.toContain("art-rank:rank-mode");
  });

  it("SetupView 把校验过的 active.value 传给起跑", () => {
    const code = read("./views/SetupView.tsx");
    expect(code).toMatch(/startRanking\(active\.value\)/);
  });

  it("RANKING_MODES 对外导出，校验只有一处真相源", () => {
    const code = read("./lib/ranking.ts");
    expect(code).toMatch(/export const RANKING_MODES/);
  });

  it("大清单选 adaptive 时给出可靠度提示（T-20261024-05 批五，PLAN §9 未决 5 的 UI 护栏）", () => {
    const adaptive = read("./lib/adaptiveRanking.ts");
    expect(adaptive).toContain("export const ADAPTIVE_RELIABLE_ITEM_LIMIT = 20;");
    const code = read("./views/SetupView.tsx");
    expect(code).toContain("ADAPTIVE_RELIABLE_ITEM_LIMIT");
    // 条件三要素：adaptive 选中 + 已选件数超限；提示文案指向 quick/classic 替代
    expect(code).toMatch(
      /rankMode === "adaptive" && selected\.length > ADAPTIVE_RELIABLE_ITEM_LIMIT/,
    );
    expect(code).toMatch(/实测 20 件内可靠/);
    expect(code).toMatch(/「经典」或「简易」/);
  });
});
