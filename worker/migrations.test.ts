import { describe, expect, it } from "vitest";
import { readdirSync, readFileSync } from "node:fs";

/**
 * 迁移幂等绊线（D2 / T-20261014-07）。
 *
 * `npm run deploy` 跑 `wrangler d1 migrations apply --remote`：已成功的文件会被
 * 记录不再重放，但**失败重试会重放整个文件**。无守卫的 CREATE 在重试时直接
 * `already exists` 炸掉，0011（7 条语句）这类多语句文件尤其危险。
 * 本文件锁死：CREATE TABLE/INDEX 必须带 IF NOT EXISTS；ADD COLUMN / DROP
 * 只能出现在下面的已知清单里（SQLite 没有 ADD COLUMN IF NOT EXISTS，
 * 单语句文件靠"全成或全败"保证重试安全，新增必须先评审）。
 */

function migrationFiles(): string[] {
  const dir = new URL("../migrations/", import.meta.url);
  return readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();
}

function stripped(name: string): string[] {
  const raw = readFileSync(new URL(`../migrations/${name}`, import.meta.url), "utf8");
  return raw
    .replace(/--[^\n]*$/gm, "")
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);
}

describe("migrations 幂等（D2 / T-20261014-07）", () => {
  it("迁移编号前缀唯一（0008 是历史双支，唯一例外，禁止再增）", () => {
    // 为什么不一刀切重命名 0008：D1 的 `d1_migrations` 以**文件名**记账，
    // 已应用到线上的迁移改名后会被当成新迁移重放；0008_disabled_at 是
    // `ALTER TABLE ADD COLUMN`，重放必然 duplicate column，`npm run deploy`
    // 从此永久卡住。因此历史双支只能保留并在此登记，新迁移必须取下一个空号。
    const KNOWN_DUPLICATES = new Map<string, string[]>([
      ["0008", ["0008_disabled_at.sql", "0008_user_collections.sql"]],
    ]);
    const byPrefix = new Map<string, string[]>();
    for (const file of migrationFiles()) {
      const prefix = file.slice(0, 4);
      byPrefix.set(prefix, [...(byPrefix.get(prefix) ?? []), file].sort());
    }
    const duplicates = [...byPrefix.entries()]
      .filter(([, files]) => files.length > 1)
      .sort(([a], [b]) => a.localeCompare(b));
    expect(
      duplicates,
      `重复迁移编号（新迁移必须取下一个空号）：${JSON.stringify(duplicates)}`,
    ).toEqual([...KNOWN_DUPLICATES.entries()]);
  });

  it("CREATE TABLE / CREATE INDEX 全部带 IF NOT EXISTS", () => {
    const bad: string[] = [];
    for (const file of migrationFiles()) {
      stripped(file).forEach((line, index) => {
        if (/^CREATE\s+(UNIQUE\s+)?(TABLE|INDEX)\b/i.test(line) && !/IF NOT EXISTS/i.test(line))
          bad.push(`${file}:${index + 1}: ${line}`);
      });
    }
    expect(bad, `无守卫的 CREATE（失败重试会炸）：\n${bad.join("\n")}`).toEqual([]);
  });

  it("ADD COLUMN / DROP TABLE 只出现在已知清单（新增必须评审）", () => {
    // SQLite 没有 ADD COLUMN IF NOT EXISTS：这些文件必须是单语句（全成或全败），
    // 靠 wrangler「成功才记录、失败重放整个文件」语义保证安全。0021 是唯一的
    // 多语句例外：CREATE/INSERT 自带 IF NOT EXISTS / OR IGNORE，DROP 后紧跟
    // RENAME（同一文件内成对出现），重放语义在注释里写明。
    const allowed = new Map<string, number>([
      ["0006_nickname.sql", 1],
      ["0008_disabled_at.sql", 1],
      ["0010_notes_column.sql", 1],
      ["0012_plaza_description.sql", 1],
      ["0013_shared_links_notes.sql", 1],
      ["0014_comment_replies.sql", 1],
      ["0021_user_collections_limit_1000.sql", 1],
    ]);
    const found = new Map<string, number>();
    for (const file of migrationFiles()) {
      const count = stripped(file).filter((line) =>
        /^(ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN|DROP\s+TABLE)\b/i.test(line),
      ).length;
      if (count) found.set(file, count);
    }
    expect(
      [...found.entries()],
      `ADD COLUMN / DROP 清单变化（新增=必须评审幂等）：${JSON.stringify([...found])}`,
    ).toEqual([...allowed.entries()]);
  });

  it("ADD COLUMN 文件必须是单语句（失败重试靠「全成或全败」）", () => {
    // 0021 是唯一的多语句例外（CREATE/INSERT 自带 IF NOT EXISTS / OR IGNORE，
    // DROP 后紧跟 RENAME 成对出现）。其余 ADD COLUMN 文件一旦混入第二条语句：
    // 前半条成功、后半条失败 → 重放整个文件时前半条 duplicate column，
    // `wrangler d1 migrations apply` 从此永久卡住。
    const MULTI_STATEMENT_EXCEPTIONS = new Set(["0021_user_collections_limit_1000.sql"]);
    const offenders: string[] = [];
    for (const file of migrationFiles()) {
      if (MULTI_STATEMENT_EXCEPTIONS.has(file)) continue;
      const statements = stripped(file);
      if (
        statements.length > 1 &&
        statements.some((line) => /^ALTER\s+TABLE\s+\S+\s+ADD\s+COLUMN\b/i.test(line))
      )
        offenders.push(`${file}: ${statements.length} 条语句`);
    }
    expect(
      offenders,
      `ADD COLUMN 文件混入了多条语句（重试会 duplicate column）：\n${offenders.join("\n")}`,
    ).toEqual([]);
  });
});
