export type Locale = "zh" | "en";

export type MediaKind = "film" | "book" | "music" | "other";
export type MediaSource = "builtin" | "custom" | "douban";

export interface Artwork {
  readonly id: string;
  readonly title: string;
  readonly subtitle?: string;
  readonly creator?: string;
  readonly year?: number;
  readonly posterUrls?: readonly string[];
  readonly tags?: readonly string[];
}

export interface MediaCollection {
  readonly id: string;
  readonly kind: MediaKind;
  readonly source: MediaSource;
  readonly title: string;
  readonly titleEn?: string;
  readonly description: string;
  readonly descriptionEn?: string;
  readonly topN: number;
  readonly works: readonly Artwork[];
}

export const mediaLabels: Record<
  MediaKind,
  { label: string; description: string; symbol: string }
> = {
  film: { label: "电影", description: "镜头、人物与记忆", symbol: "01" },
  book: { label: "书籍", description: "句子、思想与世界", symbol: "02" },
  music: { label: "音乐", description: "旋律、歌词与身体", symbol: "03" },
  other: { label: "其他", description: "任何值得留下的作品", symbol: "04" },
};

export const englishKinds: Record<MediaKind, string> = {
  film: "Films",
  book: "Books",
  music: "Music",
  other: "Other",
};
