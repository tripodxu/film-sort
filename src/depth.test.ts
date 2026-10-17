import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * S3（深度比较页 /depth）的源码绊线。
 *
 * 这一批断言只服务一个目的：证明 S3 是**纯增量**——
 * 路由扩容没动旧成员、新页面是独立文件、旧相遇页一个符号都没被引用、
 * 新样式只追加在 styles.css 末尾且只用既有令牌。
 * 断言的写法与 src/rankmode.test.ts / src/lib/additiveModules.test.ts 保持一致。
 */
const read = (rel: string) => readFileSync(new URL(rel, import.meta.url), "utf8");

/** 源码扫描必须先剥注释，否则自己的注释会把断言喂绿（PITFALLS 4.48）。 */
const stripComments = (source: string) =>
  source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/.*$/gm, "$1");

/** 样式表只能剥块注释（CSS 没有行注释）；同样是为了不把自己的注释喂成绿。 */
const stripCssComments = (source: string) => source.replace(/\/\*[\s\S]*?\*\//g, "");

const ROUTER = read("./lib/useRouter.ts");
const APP = read("./App.tsx");
const COMPARE = read("./views/CompareView.tsx");
const DEPTH = read("./views/DepthCompareView.tsx");
const TYPES = read("./views/types.ts");
const CSS = read("./styles.css");

const S3_MARKER = "/* ===== Depth Compare（S3 新增";
const s3Css = CSS.slice(CSS.indexOf(S3_MARKER));

describe("S3 路由扩容：只增不改", () => {
  it("View 联合新增 depth，旧 9 个成员一个不少", () => {
    const source = stripComments(ROUTER);
    expect(source).toMatch(/export type View =/);
    for (const view of [
      "home",
      "source",
      "setup",
      "sorting",
      "profile",
      "compare",
      "depth",
      "share",
      "plaza",
      "plazaPost",
    ]) {
      expect(source).toContain('"' + view + '"');
    }
  });

  it("VIEW_PATH 与 VIEW_TITLE 两个 Record 都补了 depth 键", () => {
    expect(ROUTER).toMatch(/depth: "\/depth",/);
    expect(ROUTER).toMatch(/depth: "深度比较 · ART\/RANK",/);
  });

  it("旧相遇页路径没有被改写", () => {
    expect(ROUTER).toMatch(/compare: "\/encounter",/);
    expect(ROUTER).toMatch(/compare: "相遇比较 · ART\/RANK",/);
  });

  it("顶栏导航新增第 4 项，旧三项与「我的文化索引」都还在", () => {
    expect(APP).toContain('onClick={() => navigateTo("depth")}');
    for (const label of ["清单", "相遇", "广场", "我的文化索引"]) {
      expect(APP).toContain(label);
    }
  });

  it("新视图走 lazy 拆包，不占主包", () => {
    expect(APP).toMatch(/const DepthCompareView = lazy\(\(\) =>/);
    expect(APP).toContain('import("./views/DepthCompareView")');
    expect(APP).toMatch(/view === "depth"/);
  });
});

describe("S3 新页面独立性：旧 CompareView 一行不改", () => {
  it("CompareView.tsx 不引用任何 S3 新符号", () => {
    const source = stripComments(COMPARE);
    for (const symbol of [
      "DepthCompareView",
      "depth-view",
      "computeCompareMetrics",
      "compareMetrics",
      "confidence-badge",
      "metric-explainer",
    ]) {
      expect(source).not.toContain(symbol);
    }
  });

  it("新页面只读：没有任何写入/网络调用", () => {
    const source = stripComments(DEPTH);
    for (const forbidden of [
      "localStorage",
      "fetch(",
      "POST",
      "PUT",
      "DELETE",
      "navigator.sendBeacon",
    ]) {
      expect(source).not.toContain(forbidden);
    }
  });

  it("新指标确实接在 compareMetrics 上，并传入原始共识分做收缩", () => {
    expect(DEPTH).toMatch(/computeCompareMetrics\(entry\.result\.shared/);
    expect(DEPTH).toMatch(/rawConsensus: entry\.result\.consensusScore/);
  });

  it("新页面不引用 adaptive 专用的 RankIntervalBar（记录该偏差，勿误接）", () => {
    expect(stripComments(DEPTH)).not.toContain("RankIntervalBar");
  });

  it("新 props 只收 4 个字段，不与旧 CompareView 共享状态", () => {
    const source = stripComments(TYPES);
    expect(source).toMatch(/export interface DepthCompareViewProps \{/);
    const block = source.slice(source.indexOf("export interface DepthCompareViewProps {"));
    const body = block.slice(0, block.indexOf("}"));
    expect(body).toContain("profile:");
    expect(body).toContain("peer:");
    expect(body).toContain("navigateTo:");
    expect(body).toContain("t:");
    expect(body).not.toContain("setPeer:");
    expect(body).not.toContain("compareMode");
  });
});

describe("S3 样式：只追加、只用既有令牌", () => {
  it("追加块在文件末尾，且旧 adaptive 块仍在", () => {
    expect(s3Css.length).toBeGreaterThan(200);
    expect(CSS.indexOf("/* ===== Depth Compare（S3 新增")).toBeGreaterThan(
      CSS.indexOf(".adaptive-strip"),
    );
    expect(CSS).toContain(".adaptive-strip");
    expect(CSS).toContain(".rank-interval-band");
  });

  it("整个样式表没有 @layer（未分层旧 CSS 会整体压过分层规则）", () => {
    expect(stripCssComments(CSS)).not.toMatch(/@layer/);
  });

  it("S3 追加块里没有裸 hex 颜色、没有 !important", () => {
    const rules = stripCssComments(s3Css);
    expect(rules).not.toMatch(/#[0-9a-fA-F]{3,8}\b/);
    expect(rules).not.toContain("!important");
  });

  it("追加块引用的每个 var(--x) 都在样式表里定义过（PITFALLS 4.20）", () => {
    const names = [...stripCssComments(s3Css).matchAll(/var\((--[a-z0-9-]+)/g)].map(
      (match) => match[1],
    );
    expect(names.length).toBeGreaterThan(10);
    const missing = [...new Set(names)].filter((name) => !CSS.includes(name + ":"));
    expect(missing).toEqual([]);
  });
});

describe("S3 新组件契约", () => {
  it("ConfidenceBadge 三档阈值与类名前缀固定", () => {
    const source = stripComments(read("./components/ConfidenceBadge.tsx"));
    expect(source).toContain(">= HIGH_THRESHOLD");
    expect(source).toContain("const HIGH_THRESHOLD = 80;");
    expect(source).toContain("const MEDIUM_THRESHOLD = 50;");
    expect(source).toContain('"confidence-badge is-"');
  });

  it("MetricExplainer 默认收起且用 aria-expanded 标注状态", () => {
    const source = stripComments(read("./components/MetricExplainer.tsx"));
    expect(source).toContain("defaultOpen = false");
    expect(source).toContain("aria-expanded={open}");
    expect(source).toContain('className="metric-explainer-toggle"');
  });
});
