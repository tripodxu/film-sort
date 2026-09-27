/**
 * TypeSafe AI(Jev,System One 决策模型)客户端。
 *
 * 只做「决策」不做生成:把用户品味上下文 + 清单作品组装成一次 systemone
 * 调用(每件作品一个 Noul 问题,模型并行评估、互不污染),返回带 0–1
 * 校准概率的排序。上游地址固定 api.typesafe.ai(非用户可控 URL,允许走
 * fetchBounded 精确白名单);用户的 apiKey 由前端透传,本模块不落盘。
 */
import { OutboundError, fetchBounded, readBoundedJson } from "./outbound";

const SYSTEMONE_URL = "https://api.typesafe.ai/v1/systemone";
const MAX_RESPONSE_BYTES = 1024 * 1024;
const CONTROL_RE = /[\u0000-\u001f\u007f]/; // 与 ai.ts validateUserConfig 同口径

export type JevKind = "film" | "book" | "music" | "other";
const KIND_LABELS: Record<JevKind, string> = {
  film: "电影",
  book: "书籍",
  music: "音乐",
  other: "其他",
};

export interface JevWorkInput {
  title: string;
  creator?: string;
  year?: number;
}
export interface JevRankInput {
  kind: JevKind;
  collectionTitle: string;
  works: JevWorkInput[];
  profileContext?: string;
  locale?: "zh" | "en";
}
export interface JevRankResult {
  model: string;
  order: number[];
  scores: number[];
  inputTokens: number;
}

export function validateJevConfig(raw: unknown): { apiKey: string } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const cfg = raw as Record<string, unknown>;
  if (typeof cfg.apiKey !== "string") return null;
  const apiKey = cfg.apiKey;
  if (apiKey.length < 8 || apiKey.length > 256 || CONTROL_RE.test(apiKey)) return null;
  return { apiKey };
}

const clean = (value: string, max: number) => value.replace(/\s+/g, " ").trim().slice(0, max);

export function buildJevState(input: JevRankInput): string {
  const zh = (input.locale ?? "zh") === "zh";
  const label = KIND_LABELS[input.kind];
  const lines: string[] = [];
  if (input.profileContext) lines.push(`【用户品味档案】\n${clean(input.profileContext, 4096)}`);
  lines.push(
    zh
      ? `【当前清单】「${clean(input.collectionTitle, 160)}」(${label},共 ${input.works.length} 件)`
      : `【List】"${clean(input.collectionTitle, 160)}" (${label}, ${input.works.length} works)`,
    zh ? "清单内全部作品如下(与顺序无关):" : "All works in this list (order is irrelevant):",
  );
  input.works.forEach((work, index) => {
    const title = clean(work.title, 160);
    const meta = [
      work.year ? String(work.year) : "",
      work.creator ? (zh ? `创作者:${clean(work.creator, 120)}` : `by ${clean(work.creator, 120)}`) : "",
    ]
      .filter(Boolean)
      .join(zh ? "," : ", ");
    const item = zh
      ? `${index + 1}. 《${title}》${meta ? `(${meta})` : ""}`
      : `${index + 1}. "${title}"${meta ? ` (${meta})` : ""}`;
    lines.push(item);
  });
  return lines.join("\n");
}

export function buildJevQuestions(
  input: JevRankInput,
): Record<string, { type: "noul"; instructions: string }> {
  const zh = (input.locale ?? "zh") === "zh";
  const kindLabel = KIND_LABELS[input.kind];
  const questions: Record<string, { type: "noul"; instructions: string }> = {};
  input.works.forEach((work, index) => {
    const title = clean(work.title, 160);
    const meta = [
      work.year ? String(work.year) : "",
      work.creator ? clean(work.creator, 120) : "",
    ]
      .filter(Boolean)
      .join(", ");
    questions[`w${index}`] = {
      type: "noul",
      instructions: zh
        ? `这位用户会有多喜欢这部${kindLabel}(0 = 完全不会保留,1 = 一定会排在最前)?《${title}》${meta ? `(${meta})` : ""}`
        : `How much would this user enjoy this work (0 = would not keep it, 1 = would rank it at the very top)? "${title}"${meta ? ` (${meta})` : ""}`,
    };
  });
  return questions;
}
