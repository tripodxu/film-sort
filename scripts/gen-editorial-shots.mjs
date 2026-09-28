// 一次性生成器：为 PLAN-ui-modernization P1 生成 editorial 截图 manifest
// （含合法排序草稿 seed：classic 模式二分插入进行中，10 部电影已排名 3 部）
// 产物 scripts/ui-shots-editorial.json 已入库存档；本文件保留作溯源——
// 后续主题（aurora/gallery）加截图时照此模式扩展，跑完可再评估去留。
import { readFileSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const fixtures = JSON.parse(
  readFileSync(join(ROOT, "scripts/ui-fixtures.json"), "utf8").replace(/^\uFEFF/, ""),
);
const filmItems = fixtures["demo-profile"].rankings.find((r) => r.kind === "film").items;
const works = filmItems.map((it) => ({
  id: it.id,
  title: it.title,
  creator: it.creator,
  year: it.year,
}));
const ids = works.map((w) => w.id);
const ranked = [ids[2], ids[6], ids[0]];
const state = {
  version: 2,
  mode: "classic",
  seed: "ed-shot-seed",
  topN: 10,
  sourceIds: ids,
  shuffledIds: [...ids].reverse(),
  rankedIds: ranked,
  pendingIds: ids.filter((id) => !ranked.includes(id)),
  deferredIds: [],
  skippedIds: [],
  outsideTopIds: [],
  activeInsertion: { candidateId: ids[4], low: 0, high: 3, presentationIndex: 0, stage: "bisect" },
  phase: "ranking",
  verificationQueue: [],
  activeVerification: null,
  pairEvidence: [],
  recentPairKeys: [],
  preferenceEdges: [],
  cycleEvents: [],
  cycleStatus: "none",
  preferenceTension: { level: 0, status: "none", cycleCount: 0 },
  comparisonCount: 4,
  estimatedTotalComparisons: 22,
  processedCount: 3,
  nextPresentationIndex: 1,
  completed: false,
  calibration: { checked: 0, consistent: 0 },
  decisionLog: [],
};
const draft = {
  collection: {
    id: "shot-film",
    kind: "film",
    source: "custom",
    title: "2025 年度观影",
    description: "",
    topN: 10,
    works,
  },
  ranking: JSON.stringify(state),
  profileName: "夜航西飞",
};
const draftLs = { "art-rank:draft:v2": JSON.stringify(draft) };

const W = 1300;
const H = 900;
const shot = (name, path, extra) => [
  { name, path, width: W, height: H, fixture: "demo-profile", ...extra },
];
const editorial = [
  ...shot("ed-editorial-home", "/", { theme: "editorial" }),
  ...shot("ed-editorial-profile", "/myself", { theme: "editorial" }),
  ...shot("ed-editorial-dark-home", "/", { theme: "editorial-dark" }),
  ...shot("ed-editorial-dark-profile", "/myself", { theme: "editorial-dark" }),
  {
    name: "ed-editorial-home-540",
    path: "/",
    width: 540,
    height: 960,
    fixture: "demo-profile",
    theme: "editorial",
  },
  {
    name: "ed-editorial-dark-home-540",
    path: "/",
    width: 540,
    height: 960,
    fixture: "demo-profile",
    theme: "editorial-dark",
  },
  // 排序页：seed 草稿 + 挂载后点「继续上次进度」→ /sorting（duel 去卡片化 + 回合水印）
  ...shot("ed-editorial-sorting", "/", {
    theme: "editorial",
    ls: draftLs,
    click: ".home-actions .button.quiet",
  }),
  {
    name: "ed-editorial-sorting-540",
    path: "/",
    width: 540,
    height: 960,
    fixture: "demo-profile",
    theme: "editorial",
    ls: draftLs,
    click: ".home-actions .button.quiet",
  },
];
writeFileSync(
  join(ROOT, "scripts/ui-shots-editorial.json"),
  JSON.stringify(editorial, null, 2) + "\n",
);

// themes 归档补 paper（旧 7 主题齐）+ editorial 双主题桌面截图
const themes = JSON.parse(
  readFileSync(join(ROOT, "scripts/ui-shots-themes.json"), "utf8").replace(/^\uFEFF/, ""),
);
const has = (name) => themes.some((s) => s.name === name);
for (const t of ["paper", "editorial", "editorial-dark"]) {
  if (!has(`th-${t}-home`))
    themes.push({
      name: `th-${t}-home`,
      path: "/",
      width: W,
      height: H,
      fixture: "demo-profile",
      theme: t,
    });
  if (!has(`th-${t}-profile`))
    themes.push({
      name: `th-${t}-profile`,
      path: "/myself",
      width: W,
      height: H,
      fixture: "demo-profile",
      theme: t,
    });
}
writeFileSync(join(ROOT, "scripts/ui-shots-themes.json"), JSON.stringify(themes, null, 2) + "\n");
console.log("editorial shots:", editorial.length, "| themes shots:", themes.length);
