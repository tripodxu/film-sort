import { activeFilmLists, candidateFilmLists } from "./catalog";

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
  readonly description: string;
  readonly topN: number;
  readonly works: readonly Artwork[];
}

function slug(value: string): string {
  return value.toLocaleLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-|-$/g, "");
}

type WorkSeed = readonly [title: string, creator: string, year: number];

function makeWorks(prefix: string, seeds: readonly WorkSeed[]): Artwork[] {
  return seeds.map(([title, creator], index) => ({
    id: `${prefix}-${index}-${slug(title)}`,
    title,
    creator,
  }));
}

function fromFilms(): MediaCollection[] {
  return [...activeFilmLists, ...candidateFilmLists].map((list) => ({
    id: `film-${list.id}`,
    kind: "film" as const,
    source: "builtin" as const,
    title: list.name.zh,
    description: list.tagline.zh,
    topN: Math.min(list.topK, list.movies.length),
    works: list.movies.map((movie) => ({
      id: movie.id,
      title: movie.title.zh,
      subtitle: movie.title.en,
      year: movie.year,
      posterUrls: movie.posterUrl ? [movie.posterUrl] : undefined,
    })),
  }));
}

const bookCollections: readonly MediaCollection[] = [
  {
    id: "book-modern-classics",
    kind: "book",
    source: "builtin",
    title: "现代文学入口",
    description: "在记忆、时代与个人命运之间选择一本最想留下的书。",
    topN: 8,
    works: makeWorks("book-classic", [
      ["百年孤独", "加西亚·马尔克斯", 1967], ["1984", "乔治·奥威尔", 1949], ["挪威的森林", "村上春树", 1987],
      ["活着", "余华", 1992], ["月亮与六便士", "毛姆", 1919], ["局外人", "加缪", 1942],
      ["人类简史", "尤瓦尔·赫拉利", 2011], ["悉达多", "赫尔曼·黑塞", 1922], ["解忧杂货店", "东野圭吾", 2012],
      ["小王子", "圣埃克苏佩里", 1943],
    ]),
  },
  {
    id: "book-ideas",
    kind: "book",
    source: "builtin",
    title: "思想与生活",
    description: "给那些改变过你看世界方式的书排出自己的坐标。",
    topN: 6,
    works: makeWorks("book-ideas", [
      ["被讨厌的勇气", "岸见一郎 / 古贺史健", 2013], ["沉思录", "马可·奥勒留", 180], ["禅与摩托车维修艺术", "罗伯特·波西格", 1974],
      ["乡土中国", "费孝通", 1947], ["枪炮、病菌与钢铁", "贾雷德·戴蒙德", 1997], ["自私的基因", "理查德·道金斯", 1976],
      ["置身事内", "兰小欢", 2021], ["心流", "米哈里·契克森米哈赖", 1990],
    ]),
  },
];

const musicCollections: readonly MediaCollection[] = [
  {
    id: "music-albums",
    kind: "music",
    source: "builtin",
    title: "华语专辑审美",
    description: "从旋律、歌词和青春记忆里，找出真正属于你的声音。",
    topN: 8,
    works: makeWorks("music-album", [
      ["七里香", "周杰伦", 2004], ["范特西", "周杰伦", 2001], ["寓言", "王菲", 2000], ["认了吧", "陈奕迅", 2007],
      ["我去2000年", "朴树", 2000], ["万能青年旅店", "万能青年旅店", 2010], ["华丽的冒险", "陈绮贞", 2005],
      ["生命因你而火热", "新裤子", 2016], ["生如夏花", "朴树", 2003], ["苏格拉没有底", "许嵩", 2011],
    ]),
  },
  {
    id: "music-listening",
    kind: "music",
    source: "builtin",
    title: "世界耳机清单",
    description: "从爵士、摇滚到电子，排出最想反复播放的声音。",
    topN: 6,
    works: makeWorks("music-world", [
      ["Kind of Blue", "Miles Davis", 1959], ["Blue", "Joni Mitchell", 1971], ["Discovery", "Daft Punk", 2001],
      ["OK Computer", "Radiohead", 1997], ["Rumours", "Fleetwood Mac", 1977], ["To Pimp a Butterfly", "Kendrick Lamar", 2015],
      ["The Miseducation of Lauryn Hill", "Lauryn Hill", 1998], ["In Rainbows", "Radiohead", 2007],
    ]),
  },
];

const otherCollections: readonly MediaCollection[] = [
  {
    id: "other-cultural-works",
    kind: "other",
    source: "builtin",
    title: "我的文化坐标",
    description: "把展览、游戏、播客或任何想留下的作品放在同一张榜单里。",
    topN: 8,
    works: makeWorks("other-cultural", [
      ["纪念碑谷", "游戏", 2014], ["动物森友会", "游戏", 2020], ["Inside", "游戏", 2016], ["Journey", "游戏", 2012],
      ["Liminal Space", "摄影系列", 2022], ["日常幻想", "展览", 2021], ["故事FM", "播客", 2017], ["看理想", "播客", 2016],
    ]),
  },
];

export const mediaCollections: readonly MediaCollection[] = [
  ...fromFilms(),
  ...bookCollections,
  ...musicCollections,
  ...otherCollections,
];

export const getCollectionsByKind = (kind: MediaKind): readonly MediaCollection[] =>
  mediaCollections.filter((collection) => collection.kind === kind && collection.source === "builtin");

export const getCollectionById = (id: string): MediaCollection | undefined =>
  mediaCollections.find((collection) => collection.id === id);

export const mediaLabels: Record<MediaKind, { label: string; description: string; symbol: string }> = {
  film: { label: "电影", description: "镜头、人物与记忆", symbol: "01" },
  book: { label: "书籍", description: "句子、思想与世界", symbol: "02" },
  music: { label: "音乐", description: "旋律、歌词与身体", symbol: "03" },
  other: { label: "其他", description: "任何值得留下的作品", symbol: "04" },
};
