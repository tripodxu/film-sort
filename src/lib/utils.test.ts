import { describe, expect, it } from "vitest";
import { mapPool } from "./utils";

/** mapPool（T-20261014-08）：PNG 导出的海报解析/解码池。钉三条：
 *  ① 保序（先完成的后项不许顶掉先项的位置）；
 *  ② 并发上限（80 条海报不许打满连接池）；
 *  ③ 单项抛错收敛 null 且池不短路（缺图降级，不是整张图失败）。 */

const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("mapPool", () => {
  it("保序：乱序完成仍按输入位置落盘", async () => {
    const out = await mapPool([30, 10, 20], 3, async (ms) => {
      await new Promise((resolve) => setTimeout(resolve, ms));
      return ms;
    });
    expect(out).toEqual([30, 10, 20]);
  });

  it("限并发：inflight 永不超过 limit", async () => {
    let inflight = 0;
    let peak = 0;
    await mapPool(
      Array.from({ length: 20 }, (_, i) => i),
      6,
      async (i) => {
        inflight++;
        peak = Math.max(peak, inflight);
        await tick();
        inflight--;
        return i;
      },
    );
    expect(peak).toBeLessThanOrEqual(6);
    expect(peak).toBeGreaterThan(1);
  });

  it("单项抛错收敛 null，后续项照常执行", async () => {
    const seen: number[] = [];
    const out = await mapPool([1, 2, 3], 2, async (i) => {
      seen.push(i);
      if (i === 2) throw new Error("boom");
      return i * 10;
    });
    expect(out).toEqual([10, null, 30]);
    expect(seen).toEqual([1, 2, 3]);
  });

  it("空输入直接返回空数组（不启动 worker）", async () => {
    await expect(mapPool([], 6, async () => 1)).resolves.toEqual([]);
  });
});
