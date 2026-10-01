import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { OTHER_POSTER_GENERATION, posterKeyYear, posterMediaKey } from "./posterKey";

/**
 * 键推导的三条不变量：
 *  1. movie/book/music 保持 `type|title|english|year` 四段裸键（历史行要继续命中）；
 *  2. `other` 维度带解析器代数——D1 行无 TTL，旧解析器的错图只能靠换键作废；
 *  3. 年份口径与 posterStore.normalizeYear 一致（越界丢掉），否则客户端兜底键
 *     与服务端键会漂移（「存了但取不到」且不报错）。
 */

describe("posterMediaKey", () => {
  it("movie/music/book 维持四段裸键，历史缓存行继续命中", () => {
    expect(posterMediaKey("霸王别姬", "霸王别姬", "movie", 1993)).toBe(
      "movie|霸王别姬|霸王别姬|1993",
    );
    expect(posterMediaKey("童话", "", "music", undefined)).toBe("music|童话||");
    expect(posterMediaKey("Ｌéon", "LÉON", "movie")).toBe("movie|léon|léon|");
  });

  it("type 缺省按 movie 处理（与 sanitizePosterBatch 兜底一致）", () => {
    expect(posterMediaKey("霸王别姬", "x")).toBe("movie|霸王别姬|x|");
  });

  it("other 维度带解析器代数，旧代数键取不到同一行", () => {
    const current = posterMediaKey("Inside", "", "other", 2016);
    expect(current).toBe(`other|inside||2016|${OTHER_POSTER_GENERATION}`);
    // D1 里旧解析器写下的错图行正是这个四段键——换代数后永远匹配不上。
    expect(current).not.toBe("other|inside||2016");
    expect("other|inside||2016".startsWith(current)).toBe(false);
  });

  it("other 维度年份缺失/越界都退化成空段，与服务端 normalizeYear 同口径", () => {
    expect(posterMediaKey("蒙娜丽莎", "mona lisa", "other", undefined)).toBe(
      `other|蒙娜丽莎|mona lisa||${OTHER_POSTER_GENERATION}`,
    );
    // 1503 年在 API 层就被 normalizeYear 丢掉；客户端兜底键必须同步丢掉，
    // 否则两条路径一个带段一个不带段。
    expect(posterMediaKey("蒙娜丽莎", "mona lisa", "other", 1503)).toBe(
      `other|蒙娜丽莎|mona lisa||${OTHER_POSTER_GENERATION}`,
    );
  });

  it("代数变化即旧行作废：只改常量就能让全部 other 键换新", () => {
    expect(OTHER_POSTER_GENERATION).toMatch(/^\d+$/);
    expect(posterMediaKey("Inside", "", "other", 2016).split("|")).toHaveLength(5);
    expect(posterMediaKey("Inside", "", "movie", 2016).split("|")).toHaveLength(4);
  });
});

describe("posterKeyYear", () => {
  it("只放行 1800–2200 的整数", () => {
    expect(posterKeyYear(2012)).toBe(2012);
    expect(posterKeyYear(1503)).toBeUndefined();
    expect(posterKeyYear(1800)).toBe(1800);
    expect(posterKeyYear(2200)).toBe(2200);
    expect(posterKeyYear(2201)).toBeUndefined();
    expect(posterKeyYear(2012.5)).toBeUndefined();
    expect(posterKeyYear(undefined)).toBeUndefined();
  });
});

/**
 * 键这条不变量没有运行期信号：两端各写各的公式不会报错，只会表现成
 * 「海报时有时无」。所以除了共享实现，还要有一条测试盯着前端不许再手抄。
 */
describe("前端兜底键与 shared 实现同源", () => {
  const source = readFileSync(new URL("../src/components/Poster.tsx", import.meta.url), "utf8");

  it("Poster.tsx 从 shared/posterKey 导入键函数", () => {
    expect(source).toContain('from "../../shared/posterKey"');
  });

  it("不再手抄键公式（NFKC 归一 / 竖线拼接都应只在 shared 出现）", () => {
    expect(source).not.toMatch(/normalize\("NFKC"\)/);
    expect(source).not.toMatch(/join\("\|"\)/);
  });
});
