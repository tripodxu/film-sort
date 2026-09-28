import { describe, expect, it } from "vitest";
import { themeFamily } from "./useTheme";

describe("themeFamily 分类", () => {
  it("editorial 双主题归入同一家族（共享结构分支）", () => {
    expect(themeFamily("editorial")).toBe("editorial");
    expect(themeFamily("editorial-dark")).toBe("editorial");
  });

  it("aurora 与 gallery 各自独立", () => {
    expect(themeFamily("aurora")).toBe("aurora");
    expect(themeFamily("gallery")).toBe("gallery");
  });

  it("旧 7 内置主题全部 classic（= 现有渲染路径，一字节不变）", () => {
    for (const id of ["modern", "retro", "minimal", "simple", "classic", "cyber", "paper"]) {
      expect(themeFamily(id)).toBe("classic");
    }
  });

  it("自定义主题包 id 与未知 id 一律回退 classic", () => {
    expect(themeFamily("forest")).toBe("classic");
    expect(themeFamily("paper-demo")).toBe("classic");
    expect(themeFamily("")).toBe("classic");
    expect(themeFamily("EDITORIAL")).toBe("classic"); // 大小写敏感，id 规范是小写
  });
});
