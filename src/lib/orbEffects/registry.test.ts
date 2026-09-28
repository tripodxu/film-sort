// orbEffects 注册表单测（PLAN-ui-modernization P2：按主题推荐默认）。
// 浏览器依赖（localStorage）用 in-memory stub（同 aiInsight.test.ts 约定）；
// WebGL/渲染行为属部署后浏览器 smoke（ORB-EFFECTS §6 验收清单）。
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  createOrbEffectById,
  listOrbEffects,
  notifyOrbEffectChanged,
  ORB_EFFECT_KEY,
  readOrbEffectId,
  writeOrbEffectId,
} from "./registry";
import { THEME_KEY } from "../theme";

let store: Map<string, string>;
let throwing: boolean;

const localStorageStub = {
  getItem: (key: string): string | null => {
    if (throwing) throw new Error("storage disabled");
    return store.get(key) ?? null;
  },
  setItem: (key: string, value: string): void => {
    if (throwing) throw new Error("storage disabled");
    store.set(key, value);
  },
  removeItem: (key: string): void => {
    if (throwing) throw new Error("storage disabled");
    store.delete(key);
  },
};

/** 事件派发依赖 window（仅 notifyOrbEffectChanged 用）——node 环境最小桩。 */
const windowStub = {
  dispatchEvent: () => true,
};

beforeEach(() => {
  store = new Map();
  throwing = false;
  vi.stubGlobal("localStorage", localStorageStub);
  vi.stubGlobal("window", windowStub);
});

describe("orb 特效注册表", () => {
  /** aurora 主题调色板（与 styles.css [data-theme=aurora] 一致）。 */
  const palette = {
    accent: "#45E3B0",
    accent2: "#8B7CFF",
    film: "#45E3B0",
    book: "#8B7CFF",
    music: "#5FC9F8",
    other: "#F09CC8",
    bg: "#070B16",
  };

  it("枚举含 ribbon 且 id 一经发布不改（用户选择按 id 持久化）", () => {
    const ids = listOrbEffects().map((e) => e.id);
    expect(ids).toEqual(["plasma", "halo", "blackhole", "ribbon"]);
    const ribbon = listOrbEffects().find((e) => e.id === "ribbon");
    expect(ribbon?.name.zh).toBe("极光绸带");
  });

  it("无持久化选择时回退默认 plasma", () => {
    expect(readOrbEffectId()).toBe("plasma");
  });

  it("无持久化 + aurora 主题 → 推荐 ribbon（P2 主题推荐默认）", () => {
    store.set(THEME_KEY, "aurora");
    expect(readOrbEffectId()).toBe("ribbon");
  });

  it("无持久化 + 其余主题（含新系列 editorial/gallery）一律 plasma", () => {
    for (const theme of ["modern", "retro", "cyber", "editorial", "editorial-dark", "gallery"]) {
      store.set(THEME_KEY, theme);
      expect(readOrbEffectId()).toBe("plasma");
    }
  });

  it("有持久化选择时优先——推荐只兜底（aurora 也不例外）", () => {
    store.set(THEME_KEY, "aurora");
    store.set(ORB_EFFECT_KEY, "halo");
    expect(readOrbEffectId()).toBe("halo");
    store.set(ORB_EFFECT_KEY, "plasma");
    expect(readOrbEffectId()).toBe("plasma");
  });

  it("无效持久化 id 回退：aurora → ribbon，其余 → plasma", () => {
    store.set(ORB_EFFECT_KEY, "not-registered");
    store.set(THEME_KEY, "aurora");
    expect(readOrbEffectId()).toBe("ribbon");
    store.set(THEME_KEY, "modern");
    expect(readOrbEffectId()).toBe("plasma");
  });

  it("localStorage 抛错（隐私模式）不炸，走推荐/默认", () => {
    throwing = true;
    expect(readOrbEffectId()).toBe("plasma");
    store.set(THEME_KEY, "aurora"); // throwing 时读不到，仍回退默认
    expect(readOrbEffectId()).toBe("plasma");
  });

  it("writeOrbEffectId 只接受已注册 id 并可 roundtrip", () => {
    expect(writeOrbEffectId("ribbon")).toBe(true);
    expect(readOrbEffectId()).toBe("ribbon");
    expect(writeOrbEffectId("nope")).toBe(false);
    expect(readOrbEffectId()).toBe("ribbon");
  });

  it("createOrbEffectById 返回四成员契约实例（ORB-EFFECTS §4）", () => {
    // ribbon 无 CanvasTexture/shader 依赖，node 环境可完整走一遍契约；
    // plasma（CanvasTexture）与渲染行为属浏览器 smoke。
    const scene = { add: () => {}, remove: () => {}, clear: () => {} };
    const host = { scene, camera: null, renderer: null, host: null, reducedMotion: false };
    const instance = createOrbEffectById("ribbon", host as never, palette);
    expect(typeof instance.update).toBe("function");
    expect(typeof instance.resize).toBe("function");
    expect(typeof instance.applyPalette).toBe("function");
    expect(typeof instance.dispose).toBe("function");
    // reduced-motion 路径（宿主冻结时钟恒 0.8）也必须静止而不消失
    const frozenHost = { ...host, reducedMotion: true };
    const frozen = createOrbEffectById("ribbon", frozenHost as never, palette);
    expect(() => frozen.update(0.8, { x: 0, y: 0 })).not.toThrow();
    expect(() => frozen.resize(375, 700)).not.toThrow();
    expect(() => frozen.applyPalette(palette)).not.toThrow();
    expect(() => frozen.dispose()).not.toThrow();
    expect(() => instance.resize(1300, 900)).not.toThrow();
    expect(() => instance.update(1.2, { x: 0.1, y: -0.1 })).not.toThrow();
    expect(() => instance.applyPalette(palette)).not.toThrow();
    expect(() => instance.dispose()).not.toThrow();
  });

  it("notifyOrbEffectChanged 派发事件（宿主据此重挂实例）", () => {
    let fired = 0;
    const listeningWindow = {
      ...windowStub,
      dispatchEvent: (event: Event) => {
        if (event.type === "art-rank:orb-effect-changed") fired += 1;
        return true;
      },
    };
    vi.stubGlobal("window", listeningWindow);
    notifyOrbEffectChanged();
    expect(fired).toBe(1);
  });
});
