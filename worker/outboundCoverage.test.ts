import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";

/**
 * 出站收敛绊线（硬规则 C2 / T-20261014-06）。
 *
 * 背景：`worker/outbound.ts` 的 `fetchBounded`（精确 host 白名单 + 逐跳 redirect
 * 复核 + 超时 + 响应字节上限）是唯一允许的出站出口，但历史上有 ~20 处裸 `fetch`
 * 散落在各模块（无字节上限、无 host 白名单、默认跟随任意跳转）。
 *
 * 本文件锁两件事：
 * 1. 已收敛的维基 4 站点不许回退（other.ts wikiJson + media.ts 三处，经由
 *    `wikipediaPolicy` + `fetchBounded` + `readBoundedJson`）。
 * 2. 剩余裸 fetch **只许减少不许增加**：逐文件精确计数并写明每处去留理由；
 *    新增一处裸 fetch 就会红，修法是把它收进 fetchBounded 然后把本文件的
 *    期望数减一（残留清单见各断言注释）。
 */

function load(relativePath: string): string {
  const raw = readFileSync(new URL(relativePath, import.meta.url), "utf8");
  return stripComments(raw);
}

/** 字符串感知的注释剥离：只有字符串字面量之外的 // 与 块注释 才视为注释，
 * 且被删内容按行数保留换行——行号与真实文件一致。
 * （旧实现是纯正则：accept 头与「星斜杠星」字符串会被当成注释开头，把后续
 * 数十行真实代码吞进「幽灵注释」，计数随无关行数增删漂移——2026-10-25
 * 安全修复批在 media.ts 插入常量后触发，机制修正。
 * 已知局限：正则字面量里出现引号时可能误判，本仓源码无此形态。） */
function stripComments(code: string): string {
  let out = "";
  let i = 0;
  let str: string | null = null; // 当前所在字符串的引号字符
  while (i < code.length) {
    const ch = code[i];
    if (str) {
      out += ch;
      if (ch === "\\") {
        out += code[i + 1] ?? "";
        i += 2;
        continue;
      }
      if (ch === str) str = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      str = ch;
      out += ch;
      i += 1;
      continue;
    }
    if (ch === "/" && code[i + 1] === "/") {
      const nl = code.indexOf("\n", i);
      const end = nl === -1 ? code.length : nl;
      out += "\n".repeat((code.slice(i, end).match(/\n/g) ?? []).length);
      i = end;
      continue;
    }
    if (ch === "/" && code[i + 1] === "*") {
      const close = code.indexOf("*/", i + 2);
      const end = close === -1 ? code.length : close + 2;
      out += "\n".repeat((code.slice(i, end).match(/\n/g) ?? []).length);
      i = end;
      continue;
    }
    out += ch;
    i += 1;
  }
  return out;
}

/** 返回源码中裸 `fetch(` 调用的行号（1-based）。排除项：
 *  - `fetchBounded(` / `fetchImpl(`（合法出口与注入点）；
 *  - `fetchValidated(`（media.ts 的逐跳域复核出口，M3 修复引入，同属合法出口）；
 *  - `async fetch(`（Worker 入口方法定义，index.ts:3401）；
 *  - `*.test.ts`（测试桩，根本不扫描）。 */
function bareFetchLines(code: string): number[] {
  const out: number[] = [];
  code.split("\n").forEach((line, index) => {
    if (!/(?<![.a-zA-Z_])fetch\s*\(/.test(line)) return;
    if (
      line.includes("fetchBounded(") ||
      line.includes("fetchImpl(") ||
      line.includes("fetchValidated(")
    )
      return;
    if (line.includes("async fetch(")) return;
    out.push(index + 1);
  });
  return out;
}

describe("出站收敛（C2 / T-20261014-06）", () => {
  it("维基 4 站点经由 wikipediaPolicy + fetchBounded，不许回退到裸 fetch", () => {
    const other = load("./other.ts");
    const media = load("./media.ts");
    // other.ts 唯一的出站就是维基：全文件零裸 fetch。
    expect(bareFetchLines(other)).toEqual([]);
    expect(other).toContain("export function wikipediaPolicy(");
    expect(other).toContain("fetchBounded(");
    expect(other).toContain("readBoundedJson(");
    // media.ts 三处维基调用与 wikiJson 同策略。
    expect(media).toContain("wikipediaPolicy,");
    expect(media.match(/wikipediaPolicy\(/g) ?? []).toHaveLength(3);
    expect(media.match(/readBoundedJson\(/g) ?? []).toHaveLength(3);
  });

  it("media.ts 残留裸 fetch 只许减少（当前 6 处 = 合法出口本体 2 + 待收敛 4）", () => {
    const media = load("./media.ts");
    const lines = bareFetchLines(media);
    // 构成（行号会漂移，只锁数量；收敛一处就把期望数减一）：
    //  合法出口本体 ×2 —— fetchValidated() 定义体内的两处 fetch（redirect:"manual"
    //   + 域后缀白名单的逐跳复核出口，2026-10-25 安全批 M3 引入；同 fetchBounded
    //   的地位：出口自身总要真的调 fetch）；
    //  ① fetchWithRetry 通用重试封装（调用方 URL 各异，需逐调用方拆策略）；
    //  ② api.anysearch.com MCP POST（固定 host，可收敛）；
    //  ③ baike.baidu.com openapi（固定 host，可收敛）；
    //  ④ baike.baidu.com/item 词条页（固定 host + 96KB 截断，可收敛）。
    // M3 批收敛了 3 处：upstream() 主体 + search.douban.com ×2 → 改走 fetchValidated。
    expect(lines, `media.ts 裸 fetch 数量变化：${lines.join(",")}`).toHaveLength(6);
  });

  it("douban/doubanlist/gdstudio/import/netease/account 残留只许减少", () => {
    const expectations: Array<[string, number, string]> = [
      ["./douban.ts", 2, "douban.com/mine Cookie 自检 ×2"],
      ["./doubanlist.ts", 2, "豆列/合集导入 ×2"],
      ["./gdstudio.ts", 2, "gd-proxy 代理取图 ×2"],
      ["./import.ts", 2, "网易云歌单/歌曲详情 ×2"],
      ["./netease.ts", 4, "网易云 QR/登录/请求封装 ×4"],
      // OAuth token/user 端点：URL 来自服务端 provider 配置（非用户输入），
      // 但仍是外部出站——收敛它需要按配置 host 动态组 policy，单独立项，不在此断言里放行新增。
      ["./account.ts", 2, "OAuth tokenUrl/userUrl ×2（待动态 host 策略）"],
    ];
    for (const [file, count, reason] of expectations) {
      const lines = bareFetchLines(load(file));
      expect(lines, `${file} 裸 fetch 数量变化（${reason}）：${lines.join(",")}`).toHaveLength(
        count,
      );
    }
  });

  it("index.ts 的 fetch 全是管理后台 HTML 里的同源相对请求（浏览器侧，非 Worker 出站）", () => {
    // 2026-10-30：看板 HTML/脚本迁到 worker/dashboardHtml.ts（workerd 拒绝入口模块
    // 的非函数具名导出），出站扫描跟着迁——两份都扫，防止任何一边新增绝对 URL 出站。
    const index = load("./index.ts");
    const dashboard = load("./dashboardHtml.ts");
    for (const [name, source] of [
      ["index.ts", index],
      ["dashboardHtml.ts", dashboard],
    ] as const) {
      const lines = bareFetchLines(source);
      if (lines.length === 0) continue;
      const strippedLines = source.split("\n");
      for (const n of lines) {
        // 注意：行号以注释剥离后的文本为准（bareFetchLines 的计数基准），此处
        // 必须用同一份 strippedLines 取行，用 raw 取行会因注释删除而错位。
        const line = strippedLines[n - 1];
        expect(line, `${name}:${n} 必须是同源 /api/admin 相对请求`).toContain("/api/admin");
      }
    }
    expect(bareFetchLines(dashboard).length).toBeGreaterThan(0);
    // 兜底：管理后台 HTML 里不许出现绝对 URL 出站。
    expect(index).not.toMatch(/fetch\(["'`]https?:/);
    expect(dashboard).not.toMatch(/fetch\(["'`]https?:/);
  });
});
