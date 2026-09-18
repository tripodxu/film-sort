import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

/**
 * 静态护栏：让「第 6 条写入路径」无法悄悄出现。
 *
 * 512KB 故障之所以反复复发，是因为编码出口不唯一——5 处各自 `JSON.stringify`，
 * 漏掉任何一处都没有任何信号。现在可落库字符串只能由 `shared/storedItem.ts`
 * 的 `encode*` 产出；本测试扫描 worker 目录，一旦在编码器之外又出现针对载荷的
 * `JSON.stringify(…)` 就直接变红并打印文件行号。
 *
 * 模式刻意收窄（只匹配载荷变量名），避免把响应体/日志/挑战赛数据的正常序列化误报。
 */

const WORKER_DIR = fileURLToPath(new URL(".", import.meta.url));
const ENCODER_MODULE = join("..", "shared", "storedItem.ts");

/**
 * 载荷变量 + 载荷属性：body/collection/parsed/post 的 items/profile/rankings/collection。
 * 刻意**不**匹配裸标识符（如挑战赛的 `JSON.stringify(items)`）或 notes 之类的旁路字段——
 * 收窄到「会写进 user_profiles_v2 / plaza_posts / user_collections / shared_links 的那个载荷」。
 */
const PAYLOAD_STRINGIFY =
  /JSON\.stringify\(\s*(?:body|collection|parsed|post)\s*\.\s*(?:items|profile|rankings|collection)\b/;

/** 五条写入路径必须经由同一个编码出口。 */
const WRITE_PATHS = [
  { file: "account.ts", why: "PUT /api/account/profile" },
  { file: "account.ts", why: "POST /api/account/collections" },
  { file: "plaza.ts", why: "POST /api/plaza/posts" },
  { file: "plaza.ts", why: "PUT /api/plaza/posts/:id" },
  { file: "index.ts", why: "POST /api/share" },
];

function workerSources(): Array<{ file: string; source: string }> {
  return readdirSync(WORKER_DIR)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".test.ts"))
    .map((name) => ({ file: name, source: readFileSync(join(WORKER_DIR, name), "utf8") }));
}

/** 返回 `文件:行号` 形式的命中列表。 */
function scanPayloadStringify(file: string, source: string): string[] {
  const offenders: string[] = [];
  source.split(/\r?\n/).forEach((line, index) => {
    // 注释行不算：编码器与路由的注释会提到这些变量名。
    const code = line.replace(/\/\/.*$/, "").replace(/^\s*\*.*$/, "");
    if (PAYLOAD_STRINGIFY.test(code)) offenders.push(`${file}:${index + 1}`);
  });
  return offenders;
}

describe("载荷编码出口唯一", () => {
  it("编码器模块存在", () => {
    expect(() => readFileSync(join(WORKER_DIR, ENCODER_MODULE), "utf8")).not.toThrow();
  });

  it("worker 里不再出现针对载荷的 JSON.stringify（除编码器之外）", () => {
    const offenders = workerSources().flatMap(({ file, source }) =>
      scanPayloadStringify(file, source),
    );
    expect(
      offenders,
      `载荷必须经由 shared/storedItem.ts 的编码器落库，命中的位置：\n${offenders.join("\n")}`,
    ).toEqual([]);
  });

  it("守卫本身有效：把 JSON.stringify(body.items) 加回路由就必须变红", () => {
    // 这条测试保证护栏不会被误调宽到「永远通过」——它必须能真的抓到回归。
    expect(
      scanPayloadStringify("fixture.ts", "    const itemsJson = JSON.stringify(body.items);"),
    ).toEqual(["fixture.ts:1"]);
    expect(
      scanPayloadStringify("fixture.ts", "const profileStr = JSON.stringify(body.profile);"),
    ).toEqual(["fixture.ts:1"]);
    expect(
      scanPayloadStringify("fixture.ts", "// JSON.stringify(body.items) 已在白名单里"),
    ).toEqual([]);
    // 旁路字段不该被误报，否则守卫会因为噪音被调宽。
    expect(
      scanPayloadStringify("fixture.ts", "const notesJson = JSON.stringify(body.notes);"),
    ).toEqual([]);
    expect(scanPayloadStringify("fixture.ts", "const s = JSON.stringify(items);")).toEqual([]);
  });

  it("五条写入路径都引用了唯一编码器", () => {
    const missing: string[] = [];
    for (const { file, why } of WRITE_PATHS) {
      const source = readFileSync(join(WORKER_DIR, file), "utf8");
      const importsEncoder = /from\s+["'][^"']*shared\/storedItem["']/.test(source);
      const usesEncoder = /encodeStored(Works|Rankings|Profile)\(/.test(source);
      if (!importsEncoder || !usesEncoder) missing.push(`${why}（${file}）`);
    }
    expect(
      missing,
      `以下写入路径没有走 shared/storedItem.ts 的编码器：\n${missing.join("\n")}`,
    ).toEqual([]);
  });
});
