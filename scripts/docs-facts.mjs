#!/usr/bin/env node
/**
 * docs-facts —— 文档事实门禁（2026-11-03）
 *
 * 只检查「代码里有唯一真相」且历史上反复写错的事实：
 *   - PBKDF2 迭代上限
 *   - migration 数量与最新编号
 *   - 内置主题数量
 *   - 已删除功能（奖牌 emoji / jellyBounce）不得在文档里复活
 *   - PITFALLS 编号不得重复
 *   - 已删除的行号式事实不得回归
 *
 * 不检查 commit / 行数这类每次提交都会变的数字——那会让门禁自我失效；
 * 这类数字在文档里统一标注「以 git / wc -l 为准」。
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const root = process.cwd();
const read = (path) => readFileSync(join(root, path), "utf8");
const failures = [];
const check = (ok, message) => {
  if (!ok) failures.push(message);
};

function walk(dir) {
  return readdirSync(join(root, dir), { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? walk(join(dir, entry.name))
      : /\.(ts|tsx)$/.test(entry.name)
        ? [join(dir, entry.name)]
        : [],
  );
}

// 1. PBKDF2：workerd 上限 100,000
const account = read("worker/account.ts");
check(
  /const PBKDF2_ITERATIONS = 100_000;/.test(account),
  "worker/account.ts: PBKDF2_ITERATIONS 必须为 100_000",
);
const readme = read("README.md");
check(!/60\s*万次迭代/.test(readme), "README.md: 不得再写 PBKDF2 60 万次");
check(/10\s*万次迭代/.test(readme), "README.md: 必须写明 PBKDF2 10 万次");

// 2. migration：最新 0029，关键文档不得残留 29 / 0028
const migrations = readdirSync(join(root, "migrations"))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const latest = migrations.at(-1) ?? "";
check(/^0029_/.test(latest), `migrations: 最新应为 0029，实际 ${latest}`);
for (const file of [
  "README.md",
  "MEMORY.md",
  "docs/ARCHITECTURE.md",
  "docs/CLOUDFLARE.md",
  "docs/agents/MAP.md",
]) {
  const text = read(file);
  check(!/29 个迁移|共 29 个文件|0001[–.…→ ]+0028/.test(text), `${file}: 仍残留 29 / 0028`);
  check(text.includes("0029"), `${file}: 应提及最新 migration 0029`);
}

// 3. 内置主题：12 套
const themeSource = read("src/lib/theme.ts");
const themeCount = (themeSource.match(/\{ id: "/g) ?? []).length;
check(themeCount === 12, `src/lib/theme.ts: THEMES 应为 12，实际 ${themeCount}`);

// 4. 已删除功能不得在文档里复活
check(!walk("src").some((file) => /🥇|🥈|🥉/.test(read(file))), "src/: 不应再出现奖牌 emoji");
for (const file of ["README.md", "docs/USAGE.md"]) {
  check(!/🥇|🥈|🥉/.test(read(file)), `${file}: 代码已无奖牌 emoji，文档不得再声称`);
}
check(!/jellyBounce/.test(read("src/styles.css")), "src/styles.css: 不应复活 jellyBounce");
check(!/果冻悬停/.test(readme), "README.md: 代码已无果冻动画");

// 5. PITFALLS 编号不得重复
const pitfalls = read("docs/agents/PITFALLS.md");
const ids = [...pitfalls.matchAll(/^\s*-\s*\*\*(4\.\d+[a-z]?)\s/gm)].map((match) => match[1]);
const duplicates = ids.filter((id, index) => ids.indexOf(id) !== index);
check(duplicates.length === 0, `PITFALLS: 编号重复 ${[...new Set(duplicates)].join(", ")}`);

// 6. 已删除的行号式事实不得回归
for (const file of ["docs/agents/MAP.md", "docs/agents/CONVENTIONS.md", "docs/agents/ROLES.md"]) {
  check(!/约 1880 行|1909 行/.test(read(file)), `${file}: 仍残留旧的路由/样式行号`);
}
const scaleDocs = ["AGENTS.md", "README.md", "MEMORY.md", "docs/agents/MAP.md"];
check(!scaleDocs.some((file) => /37,868|683 条/.test(read(file))), "规模数字仍残留 37,868 / 683");

if (failures.length) {
  console.error("✘ 文档事实校验失败：");
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}
console.log(`✓ 文档事实校验通过（${migrations.length} 个 migration，${themeCount} 套主题）`);
