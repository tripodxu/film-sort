import type {
  FilmList,
  FilmListKind,
  FilmListStatus,
  LocalizedText,
  Movie,
} from "../types";

const TMDB_IMAGE_BASE = "https://image.tmdb.org/t/p/w500";

type MovieSeed = readonly [
  zh: string,
  en: string,
  year?: number,
  posterPath?: string,
  tmdbId?: number,
];

interface FilmListSeed {
  readonly id: string;
  readonly name: LocalizedText;
  readonly tagline: LocalizedText;
  readonly recommendation: LocalizedText;
  readonly kind: FilmListKind;
  readonly status: FilmListStatus;
  readonly tags: readonly LocalizedText[];
  readonly topK: number;
  readonly movies: readonly MovieSeed[];
}

const bi = (zh: string, en: string): LocalizedText => ({ zh, en });

const slugify = (value: string): string =>
  value
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "");

const makeMovie = (listId: string, seed: MovieSeed): Movie => {
  const [zh, en, year, posterPath, tmdbId] = seed;
  return {
    id: `${listId}-${slugify(en)}`,
    title: bi(zh, en),
    ...(year ? { year } : {}),
    ...(posterPath ? { posterUrl: `${TMDB_IMAGE_BASE}${posterPath}` } : {}),
    ...(tmdbId ? { tmdbId } : {}),
  };
};

const makeList = (seed: FilmListSeed): FilmList => {
  const movies = seed.movies.map((movie) => makeMovie(seed.id, movie));
  if (movies.length < 2) {
    throw new Error(`Built-in film list "${seed.id}" needs at least two movies.`);
  }

  return {
    ...seed,
    movies,
    featuredMovieId: movies[0].id,
    ...(movies[0].posterUrl ? { posterUrl: movies[0].posterUrl } : {}),
  };
};

const activeSeeds: readonly FilmListSeed[] = [
  {
    id: "douban-top50",
    name: bi("豆瓣高分片单", "Douban All-Time Favorites"),
    tagline: bi("公认佳作，也会排出只属于你的答案", "Acclaimed classics, reordered by your own taste"),
    recommendation: bi("第一次整理电影审美，从这些熟悉的佳作开始", "A welcoming first list packed with familiar essentials"),
    kind: "category",
    status: "active",
    tags: [bi("高分", "Top rated"), bi("经典", "Classics"), bi("入门", "Starter")],
    topK: 10,
    movies: [
      ["肖申克的救赎", "The Shawshank Redemption", 1994, "/q6y0Go1tsGEsmtFryDOJo3dEmqu.jpg", 278],
      ["霸王别姬", "Farewell My Concubine", 1993],
      ["阿甘正传", "Forrest Gump", 1994],
      ["这个杀手不太冷", "Leon: The Professional", 1994],
      ["泰坦尼克号", "Titanic", 1997],
      ["千与千寻", "Spirited Away", 2001],
      ["美丽人生", "Life Is Beautiful", 1997],
      ["星际穿越", "Interstellar", 2014],
      ["盗梦空间", "Inception", 2010],
      ["辛德勒的名单", "Schindler's List", 1993],
      ["楚门的世界", "The Truman Show", 1998],
      ["忠犬八公的故事", "Hachi: A Dog's Tale", 2009],
      ["海上钢琴师", "The Legend of 1900", 1998],
      ["三傻大闹宝莱坞", "3 Idiots", 2009],
      ["机器人总动员", "WALL-E", 2008],
      ["放牛班的春天", "The Chorus", 2004],
    ],
  },
  {
    id: "nolan",
    name: bi("诺兰作品序列", "Christopher Nolan Ranked"),
    tagline: bi("时间、梦境与执念，你更偏爱哪一种震撼", "Time, dreams and obsession: choose your kind of spectacle"),
    recommendation: bi("适合喜欢烧脑叙事与大银幕奇观的观众", "For fans of intricate stories and large-format spectacle"),
    kind: "director",
    status: "active",
    tags: [bi("导演", "Director"), bi("科幻", "Sci-fi"), bi("烧脑", "Mind-bending")],
    topK: 8,
    movies: [
      ["星际穿越", "Interstellar", 2014, "/gEU2QniE6E77NI6lCU6MxlNBvIx.jpg", 157336],
      ["盗梦空间", "Inception", 2010],
      ["黑暗骑士", "The Dark Knight", 2008],
      ["致命魔术", "The Prestige", 2006],
      ["敦刻尔克", "Dunkirk", 2017],
      ["奥本海默", "Oppenheimer", 2023],
      ["记忆碎片", "Memento", 2000],
      ["蝙蝠侠：侠影之谜", "Batman Begins", 2005],
      ["黑暗骑士崛起", "The Dark Knight Rises", 2012],
      ["信条", "Tenet", 2020],
      ["失眠症", "Insomnia", 2002],
      ["追随", "Following", 1998],
    ],
  },
  {
    id: "miyazaki",
    name: bi("宫崎骏动画手记", "Hayao Miyazaki Favorites"),
    tagline: bi("风、飞行与成长，重返那些温柔又坚定的世界", "Wind, flight and growing up in worlds both gentle and brave"),
    recommendation: bi("适合想在童年记忆与成年感悟之间做选择的人", "For choosing between childhood wonder and grown-up resonance"),
    kind: "director",
    status: "active",
    tags: [bi("动画", "Animation"), bi("吉卜力", "Ghibli"), bi("治愈", "Heartwarming")],
    topK: 8,
    movies: [
      ["千与千寻", "Spirited Away", 2001, "/39wmItIWsg5sZMyRUHLkWBcuVCM.jpg", 129],
      ["龙猫", "My Neighbor Totoro", 1988],
      ["天空之城", "Castle in the Sky", 1986],
      ["幽灵公主", "Princess Mononoke", 1997],
      ["哈尔的移动城堡", "Howl's Moving Castle", 2004],
      ["魔女宅急便", "Kiki's Delivery Service", 1989],
      ["风之谷", "Nausicaa of the Valley of the Wind", 1984],
      ["红猪", "Porco Rosso", 1992],
      ["起风了", "The Wind Rises", 2013],
      ["悬崖上的金鱼姬", "Ponyo", 2008],
      ["你想活出怎样的人生", "The Boy and the Heron", 2023],
    ],
  },
  {
    id: "shinkai",
    name: bi("新海诚动画电影榜", "Makoto Shinkai Ranked"),
    tagline: bi("错过、相遇与遥远距离里的微光", "Longing, encounters and light across impossible distances"),
    recommendation: bi("适合偏爱青春情绪、城市风景与绚丽天空的观众", "For lovers of youthful longing, cityscapes and luminous skies"),
    kind: "director",
    status: "active",
    tags: [bi("动画", "Animation"), bi("青春", "Youth"), bi("爱情", "Romance")],
    topK: 6,
    movies: [
      ["你的名字。", "Your Name.", 2016, "/q719jXXEzOoYaps6babgKnONONX.jpg", 372058],
      ["天气之子", "Weathering with You", 2019],
      ["铃芽之旅", "Suzume", 2022],
      ["秒速5厘米", "5 Centimeters per Second", 2007],
      ["言叶之庭", "The Garden of Words", 2013],
      ["追逐繁星的孩子", "Children Who Chase Lost Voices", 2011],
      ["云之彼端，约定的地方", "The Place Promised in Our Early Days", 2004],
      ["星之声", "Voices of a Distant Star", 2002],
      ["她和她的猫", "She and Her Cat", 1999],
    ],
  },
  {
    id: "chinese-highscore",
    name: bi("华语高分片单", "Chinese-Language Essentials"),
    tagline: bi("跨越地域与年代，排出你的华语电影坐标", "Map your Chinese-language cinema across eras and regions"),
    recommendation: bi("适合想重新确认自己最珍视的华语作品", "For revisiting the Chinese-language films you value most"),
    kind: "category",
    status: "active",
    tags: [bi("华语", "Chinese-language"), bi("经典", "Classics"), bi("剧情", "Drama")],
    topK: 10,
    movies: [
      ["霸王别姬", "Farewell My Concubine", 1993],
      ["活着", "To Live", 1994],
      ["无间道", "Infernal Affairs", 2002],
      ["大话西游之大圣娶亲", "A Chinese Odyssey Part Two: Cinderella", 1995],
      ["鬼子来了", "Devils on the Doorstep", 2000],
      ["饮食男女", "Eat Drink Man Woman", 1994],
      ["让子弹飞", "Let the Bullets Fly", 2010],
      ["一一", "Yi Yi", 2000],
      ["牯岭街少年杀人事件", "A Brighter Summer Day", 1991],
      ["甜蜜蜜", "Comrades: Almost a Love Story", 1996],
      ["阳光灿烂的日子", "In the Heat of the Sun", 1994],
      ["我不是药神", "Dying to Survive", 2018],
    ],
  },
  {
    id: "wong-kar-wai",
    name: bi("王家卫电影榜", "Wong Kar-wai Ranked"),
    tagline: bi("在时间、欲望与擦肩而过之间作选择", "Choose among time, desire and all the near misses"),
    recommendation: bi("适合迷恋都市夜色、暧昧与独白的人", "For anyone drawn to neon nights, longing and inner monologues"),
    kind: "director",
    status: "active",
    tags: [bi("导演", "Director"), bi("香港", "Hong Kong"), bi("爱情", "Romance")],
    topK: 6,
    movies: [
      ["花样年华", "In the Mood for Love", 2000, "/iYypPT4bhqXfq1b6EnmxvRt6b2Y.jpg", 843],
      ["重庆森林", "Chungking Express", 1994],
      ["春光乍泄", "Happy Together", 1997],
      ["阿飞正传", "Days of Being Wild", 1990],
      ["东邪西毒", "Ashes of Time", 1994],
      ["堕落天使", "Fallen Angels", 1995],
      ["旺角卡门", "As Tears Go By", 1988],
      ["2046", "2046", 2004],
      ["一代宗师", "The Grandmaster", 2013],
      ["蓝莓之夜", "My Blueberry Nights", 2007],
    ],
  },
  {
    id: "disney-animation",
    name: bi("迪士尼动画长片榜", "Disney Animation Favorites"),
    tagline: bi("童话、冒险与歌声，哪一部真正陪你长大", "Fairy tales, adventures and songs that grew up with you"),
    recommendation: bi("适合家庭观影，也适合检验童年滤镜", "Great for family movie night or testing childhood nostalgia"),
    kind: "category",
    status: "active",
    tags: [bi("动画", "Animation"), bi("迪士尼", "Disney"), bi("合家欢", "Family")],
    topK: 8,
    movies: [
      ["疯狂动物城", "Zootopia", 2016, "/hlK0e0wAQ3VLuJcsfIYPvb4JVud.jpg", 269149],
      ["狮子王", "The Lion King", 1994],
      ["美女与野兽", "Beauty and the Beast", 1991],
      ["阿拉丁", "Aladdin", 1992],
      ["花木兰", "Mulan", 1998],
      ["冰雪奇缘", "Frozen", 2013],
      ["海洋奇缘", "Moana", 2016],
      ["魔法满屋", "Encanto", 2021],
      ["小美人鱼", "The Little Mermaid", 1989],
      ["星际宝贝", "Lilo & Stitch", 2002],
      ["超能陆战队", "Big Hero 6", 2014],
      ["无敌破坏王", "Wreck-It Ralph", 2012],
    ],
  },
  {
    id: "couple-debate",
    name: bi("两个人的观影名单", "The Great Movie-Date Debate"),
    tagline: bi("一起看过的故事，也许从来没有同一个第一名", "You shared the movies, but perhaps never the same number one"),
    recommendation: bi("适合情侣或好友各排一次，再交换结果", "Rank separately with a partner or friend, then compare"),
    kind: "category",
    status: "active",
    tags: [bi("双人", "For two"), bi("爱情", "Romance"), bi("话题", "Conversation")],
    topK: 8,
    movies: [
      ["泰坦尼克号", "Titanic", 1997, "/9xjZS2rlVxm8SFx8kPC3aIGCOYQ.jpg", 597],
      ["爱在黎明破晓前", "Before Sunrise", 1995],
      ["怦然心动", "Flipped", 2010],
      ["时空恋旅人", "About Time", 2013],
      ["恋恋笔记本", "The Notebook", 2004],
      ["爱乐之城", "La La Land", 2016],
      ["花样年华", "In the Mood for Love", 2000],
      ["罗马假日", "Roman Holiday", 1953],
      ["暖暖内含光", "Eternal Sunshine of the Spotless Mind", 2004],
      ["婚姻故事", "Marriage Story", 2019],
      ["过去的生活", "Past Lives", 2023],
      ["初恋这件小事", "A Little Thing Called Love", 2010],
    ],
  },
  {
    id: "spielberg",
    name: bi("斯皮尔伯格电影榜", "Steven Spielberg Ranked"),
    tagline: bi("童真、历史与奇观，一位大师的多面银幕", "Wonder, history and spectacle from a many-sided master"),
    recommendation: bi("适合在商业大片与严肃历史之间寻找偏爱", "For weighing blockbuster wonder against historical drama"),
    kind: "director",
    status: "active",
    tags: [bi("导演", "Director"), bi("冒险", "Adventure"), bi("经典", "Classics")],
    topK: 8,
    movies: [
      ["辛德勒的名单", "Schindler's List", 1993, "/sF1U4EUQS8YHUYjNl3pMGNIQyr0.jpg", 424],
      ["拯救大兵瑞恩", "Saving Private Ryan", 1998],
      ["侏罗纪公园", "Jurassic Park", 1993],
      ["E.T.外星人", "E.T. the Extra-Terrestrial", 1982],
      ["大白鲨", "Jaws", 1975],
      ["夺宝奇兵", "Raiders of the Lost Ark", 1981],
      ["猫鼠游戏", "Catch Me If You Can", 2002],
      ["人工智能", "A.I. Artificial Intelligence", 2001],
      ["少数派报告", "Minority Report", 2002],
      ["慕尼黑", "Munich", 2005],
      ["紫色", "The Color Purple", 1985],
      ["西区故事", "West Side Story", 2021],
    ],
  },
] as const;

const candidateSeeds: readonly FilmListSeed[] = [
  {
    id: "tarantino",
    name: bi("昆汀电影榜", "Quentin Tarantino Ranked"),
    tagline: bi("对白、暴力与黑色幽默的高浓度对决", "Dialogue, violence and pitch-black humor collide"),
    recommendation: bi("适合喜欢类型混搭与强烈作者风格的观众", "For fans of genre collisions and unmistakable style"),
    kind: "director", status: "candidate", topK: 6,
    tags: [bi("导演", "Director"), bi("犯罪", "Crime"), bi("黑色幽默", "Dark comedy")],
    movies: [
      ["低俗小说", "Pulp Fiction", 1994, "/d5iIlFn5s0ImszYzBPb8JPIfbXD.jpg", 680],
      ["无耻混蛋", "Inglourious Basterds", 2009], ["被解救的姜戈", "Django Unchained", 2012],
      ["杀死比尔", "Kill Bill: Vol. 1", 2003], ["落水狗", "Reservoir Dogs", 1992],
      ["八恶人", "The Hateful Eight", 2015], ["好莱坞往事", "Once Upon a Time in Hollywood", 2019],
      ["危险关系", "Jackie Brown", 1997], ["金刚不坏", "Death Proof", 2007],
    ],
  },
  {
    id: "denis-villeneuve",
    name: bi("丹尼斯·维伦纽瓦电影榜", "Denis Villeneuve Ranked"),
    tagline: bi("在宏大世界与幽暗人心之间沉浸", "Immense worlds meet the darkest corners of the mind"),
    recommendation: bi("适合偏爱氛围、尺度与慢燃张力的人", "For viewers who love atmosphere, scale and slow-burn tension"),
    kind: "director", status: "candidate", topK: 6,
    tags: [bi("导演", "Director"), bi("科幻", "Sci-fi"), bi("悬疑", "Mystery")],
    movies: [
      ["降临", "Arrival", 2016, "/x2FJsf1ElAgr63Y3PNPtJrcmpoe.jpg", 329865],
      ["沙丘", "Dune", 2021], ["沙丘2", "Dune: Part Two", 2024], ["银翼杀手2049", "Blade Runner 2049", 2017],
      ["囚徒", "Prisoners", 2013], ["边境杀手", "Sicario", 2015], ["焦土之城", "Incendies", 2010],
      ["宿敌", "Enemy", 2013], ["理工学院", "Polytechnique", 2009],
    ],
  },
  {
    id: "david-fincher",
    name: bi("大卫·芬奇电影榜", "David Fincher Ranked"),
    tagline: bi("精密、冷峻，以及失控边缘的人性", "Precision, chill and human nature at the edge of control"),
    recommendation: bi("适合喜欢心理暗流与严密叙事的观众", "For lovers of psychological undercurrents and exacting craft"),
    kind: "director", status: "candidate", topK: 6,
    tags: [bi("导演", "Director"), bi("惊悚", "Thriller"), bi("犯罪", "Crime")],
    movies: [
      ["搏击俱乐部", "Fight Club", 1999, "/pB8BM7pdSp6B6Ih7QZ4DrQ3PmJK.jpg", 550],
      ["七宗罪", "Se7en", 1995], ["社交网络", "The Social Network", 2010], ["消失的爱人", "Gone Girl", 2014],
      ["十二宫", "Zodiac", 2007], ["本杰明·巴顿奇事", "The Curious Case of Benjamin Button", 2008],
      ["龙纹身的女孩", "The Girl with the Dragon Tattoo", 2011], ["心理游戏", "The Game", 1997],
      ["杀手", "The Killer", 2023], ["战栗空间", "Panic Room", 2002],
    ],
  },
  {
    id: "bong-joon-ho",
    name: bi("奉俊昊电影榜", "Bong Joon-ho Ranked"),
    tagline: bi("阶级寓言与类型快感总在同一镜头相遇", "Class allegory and genre thrills share every frame"),
    recommendation: bi("适合想在笑声、惊惧与社会观察间做选择", "For choosing among humor, dread and social observation"),
    kind: "director", status: "candidate", topK: 6,
    tags: [bi("导演", "Director"), bi("韩国", "Korean cinema"), bi("社会", "Social")],
    movies: [
      ["寄生虫", "Parasite", 2019, "/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg", 496243],
      ["杀人回忆", "Memories of Murder", 2003], ["汉江怪物", "The Host", 2006], ["母亲", "Mother", 2009],
      ["雪国列车", "Snowpiercer", 2013], ["玉子", "Okja", 2017], ["绑架门口狗", "Barking Dogs Never Bite", 2000],
      ["米奇17号", "Mickey 17", 2025],
    ],
  },
  {
    id: "hirokazu-koreeda",
    name: bi("是枝裕和电影榜", "Hirokazu Kore-eda Ranked"),
    tagline: bi("家人并非答案，而是一连串温柔的问题", "Family is not an answer, but a series of tender questions"),
    recommendation: bi("适合偏爱日常细节与克制情感的观众", "For viewers moved by everyday detail and quiet emotion"),
    kind: "director", status: "candidate", topK: 6,
    tags: [bi("导演", "Director"), bi("日本", "Japanese cinema"), bi("家庭", "Family")],
    movies: [
      ["小偷家族", "Shoplifters", 2018], ["无人知晓", "Nobody Knows", 2004], ["步履不停", "Still Walking", 2008],
      ["如父如子", "Like Father, Like Son", 2013], ["海街日记", "Our Little Sister", 2015],
      ["比海更深", "After the Storm", 2016], ["第三度嫌疑人", "The Third Murder", 2017],
      ["怪物", "Monster", 2023], ["下一站，天国", "After Life", 1998],
    ],
  },
  {
    id: "ang-lee",
    name: bi("李安电影榜", "Ang Lee Ranked"),
    tagline: bi("东西方、传统与欲望之间的细腻摆荡", "A delicate balance of East and West, tradition and desire"),
    recommendation: bi("适合欣赏文化碰撞与复杂情感的人", "For admirers of cultural tension and emotional complexity"),
    kind: "director", status: "candidate", topK: 6,
    tags: [bi("导演", "Director"), bi("华语", "Chinese-language"), bi("剧情", "Drama")],
    movies: [
      ["卧虎藏龙", "Crouching Tiger, Hidden Dragon", 2000], ["少年派的奇幻漂流", "Life of Pi", 2012],
      ["断背山", "Brokeback Mountain", 2005], ["饮食男女", "Eat Drink Man Woman", 1994],
      ["喜宴", "The Wedding Banquet", 1993], ["推手", "Pushing Hands", 1991], ["理智与情感", "Sense and Sensibility", 1995],
      ["色，戒", "Lust, Caution", 2007], ["冰风暴", "The Ice Storm", 1997],
    ],
  },
  {
    id: "zhang-yimou",
    name: bi("张艺谋电影榜", "Zhang Yimou Ranked"),
    tagline: bi("浓烈色彩背后，是时代与个体的拉扯", "Behind the saturated colors, individuals wrestle with history"),
    recommendation: bi("适合比较早期现实主义与后期视觉奇观", "For contrasting early realism with later visual spectacle"),
    kind: "director", status: "candidate", topK: 8,
    tags: [bi("导演", "Director"), bi("华语", "Chinese-language"), bi("史诗", "Epic")],
    movies: [
      ["活着", "To Live", 1994], ["红高粱", "Red Sorghum", 1988], ["大红灯笼高高挂", "Raise the Red Lantern", 1991],
      ["秋菊打官司", "The Story of Qiu Ju", 1992], ["一个都不能少", "Not One Less", 1999],
      ["我的父亲母亲", "The Road Home", 1999], ["英雄", "Hero", 2002], ["十面埋伏", "House of Flying Daggers", 2004],
      ["归来", "Coming Home", 2014], ["影", "Shadow", 2018],
    ],
  },
  {
    id: "leonardo-dicaprio",
    name: bi("莱昂纳多·迪卡普里奥电影榜", "Leonardo DiCaprio Ranked"),
    tagline: bi("从少年偶像到执念深重的银幕冒险家", "From teen idol to the screen's most driven adventurer"),
    recommendation: bi("适合在商业巨制与作者电影间选出最爱", "For choosing between blockbusters and auteur collaborations"),
    kind: "actor", status: "candidate", topK: 8,
    tags: [bi("演员", "Actor"), bi("好莱坞", "Hollywood"), bi("剧情", "Drama")],
    movies: [
      ["华尔街之狼", "The Wolf of Wall Street", 2013, "/34m2tygAYBGqA9MXKhRDtzYd4MR.jpg", 106646],
      ["泰坦尼克号", "Titanic", 1997], ["盗梦空间", "Inception", 2010], ["禁闭岛", "Shutter Island", 2010],
      ["猫鼠游戏", "Catch Me If You Can", 2002], ["无间行者", "The Departed", 2006], ["荒野猎人", "The Revenant", 2015],
      ["血钻", "Blood Diamond", 2006], ["了不起的盖茨比", "The Great Gatsby", 2013], ["花月杀手", "Killers of the Flower Moon", 2023],
    ],
  },
  {
    id: "tom-hanks",
    name: bi("汤姆·汉克斯电影榜", "Tom Hanks Ranked"),
    tagline: bi("普通人的善意，也能撑起最辽阔的故事", "Ordinary decency can carry the grandest stories"),
    recommendation: bi("适合偏爱温暖、坚韧与经典叙事的观众", "For fans of warmth, resilience and classic storytelling"),
    kind: "actor", status: "candidate", topK: 8,
    tags: [bi("演员", "Actor"), bi("经典", "Classics"), bi("温暖", "Heartwarming")],
    movies: [
      ["阿甘正传", "Forrest Gump", 1994, "/arw2vcBveWOVZr6pxd9XTd1TdQa.jpg", 13],
      ["拯救大兵瑞恩", "Saving Private Ryan", 1998], ["荒岛余生", "Cast Away", 2000], ["绿里奇迹", "The Green Mile", 1999],
      ["猫鼠游戏", "Catch Me If You Can", 2002], ["费城故事", "Philadelphia", 1993], ["萨利机长", "Sully", 2016],
      ["幸福终点站", "The Terminal", 2004], ["西雅图未眠夜", "Sleepless in Seattle", 1993], ["玩具总动员", "Toy Story", 1995],
    ],
  },
  {
    id: "cate-blanchett",
    name: bi("凯特·布兰切特电影榜", "Cate Blanchett Ranked"),
    tagline: bi("优雅、锋利，也可以随时变成危险的谜", "Elegant, incisive and always capable of becoming a mystery"),
    recommendation: bi("适合欣赏角色跨度与精密表演的观众", "For admirers of range and finely calibrated performances"),
    kind: "actor", status: "candidate", topK: 6,
    tags: [bi("演员", "Actor"), bi("表演", "Performance"), bi("剧情", "Drama")],
    movies: [
      ["卡罗尔", "Carol", 2015], ["塔尔", "Tar", 2022], ["蓝色茉莉", "Blue Jasmine", 2013], ["伊丽莎白", "Elizabeth", 1998],
      ["飞行家", "The Aviator", 2004], ["本杰明·巴顿奇事", "The Curious Case of Benjamin Button", 2008],
      ["丑闻笔记", "Notes on a Scandal", 2006], ["玉面情魔", "Nightmare Alley", 2021], ["指环王：护戒使者", "The Lord of the Rings: The Fellowship of the Ring", 2001],
    ],
  },
  {
    id: "denzel-washington",
    name: bi("丹泽尔·华盛顿电影榜", "Denzel Washington Ranked"),
    tagline: bi("正义、权力与魅力同时压上银幕", "Justice, power and charisma command the screen"),
    recommendation: bi("适合喜欢强势角色与道德困境的观众", "For fans of commanding characters and moral dilemmas"),
    kind: "actor", status: "candidate", topK: 6,
    tags: [bi("演员", "Actor"), bi("犯罪", "Crime"), bi("剧情", "Drama")],
    movies: [
      ["训练日", "Training Day", 2001, "/bUeiwBQdupBLQthMCHKV7zv56uv.jpg", 2034],
      ["马尔科姆·X", "Malcolm X", 1992], ["怒火救援", "Man on Fire", 2004], ["美国黑帮", "American Gangster", 2007],
      ["藩篱", "Fences", 2016], ["迫在眉梢", "John Q", 2002], ["费城故事", "Philadelphia", 1993],
      ["局内人", "Inside Man", 2006], ["伸冤人", "The Equalizer", 2014],
    ],
  },
  {
    id: "tony-leung",
    name: bi("梁朝伟电影榜", "Tony Leung Chiu-wai Ranked"),
    tagline: bi("沉默的眼神里，藏着江湖与都市的万千心事", "A quiet gaze carries a world of cities, longing and jianghu"),
    recommendation: bi("适合香港电影爱好者与表演细节控", "For Hong Kong cinema devotees and performance connoisseurs"),
    kind: "actor", status: "candidate", topK: 8,
    tags: [bi("演员", "Actor"), bi("香港", "Hong Kong"), bi("经典", "Classics")],
    movies: [
      ["无间道", "Infernal Affairs", 2002], ["花样年华", "In the Mood for Love", 2000], ["重庆森林", "Chungking Express", 1994],
      ["春光乍泄", "Happy Together", 1997], ["色，戒", "Lust, Caution", 2007], ["悲情城市", "A City of Sadness", 1989],
      ["一代宗师", "The Grandmaster", 2013], ["东邪西毒", "Ashes of Time", 1994], ["暗花", "The Longest Nite", 1998],
      ["尚气与十环传奇", "Shang-Chi and the Legend of the Ten Rings", 2021],
    ],
  },
  {
    id: "maggie-cheung",
    name: bi("张曼玉电影榜", "Maggie Cheung Ranked"),
    tagline: bi("灵动与疏离，在不同年代留下同样耀眼的身影", "Vibrance and distance illuminate every era"),
    recommendation: bi("适合重温香港黄金时代与跨国作者电影", "For revisiting Hong Kong's golden age and global auteurs"),
    kind: "actor", status: "candidate", topK: 8,
    tags: [bi("演员", "Actor"), bi("香港", "Hong Kong"), bi("女性", "Women in film")],
    movies: [
      ["花样年华", "In the Mood for Love", 2000, "/iYypPT4bhqXfq1b6EnmxvRt6b2Y.jpg", 843],
      ["甜蜜蜜", "Comrades: Almost a Love Story", 1996], ["阮玲玉", "Center Stage", 1991], ["阿飞正传", "Days of Being Wild", 1990],
      ["新龙门客栈", "New Dragon Gate Inn", 1992], ["青蛇", "Green Snake", 1993], ["清洁", "Clean", 2004],
      ["错过又如何", "2046", 2004], ["警察故事", "Police Story", 1985],
    ],
  },
  {
    id: "song-kang-ho",
    name: bi("宋康昊电影榜", "Song Kang-ho Ranked"),
    tagline: bi("荒诞、愤怒与普通人的尊严都写在脸上", "Absurdity, anger and ordinary dignity in one unforgettable face"),
    recommendation: bi("适合借一位演员串起韩国电影二十年", "Trace two decades of Korean cinema through one great actor"),
    kind: "actor", status: "candidate", topK: 8,
    tags: [bi("演员", "Actor"), bi("韩国", "Korean cinema"), bi("剧情", "Drama")],
    movies: [
      ["寄生虫", "Parasite", 2019, "/7IiTTgloJzvGI1TAYymCfbfl3vT.jpg", 496243],
      ["杀人回忆", "Memories of Murder", 2003], ["辩护人", "The Attorney", 2013], ["出租车司机", "A Taxi Driver", 2017],
      ["汉江怪物", "The Host", 2006], ["共同警备区", "Joint Security Area", 2000], ["密阳", "Secret Sunshine", 2007],
      ["蝙蝠：血色情欲", "Thirst", 2009], ["观相", "The Face Reader", 2013],
    ],
  },
  {
    id: "zhou-xun",
    name: bi("周迅电影榜", "Zhou Xun Ranked"),
    tagline: bi("敏感、倔强与灵气，穿过华语银幕的不同面貌", "Sensitivity, defiance and spirit across Chinese-language cinema"),
    recommendation: bi("适合关注女性角色与华语作者电影的观众", "For viewers drawn to layered women and Chinese-language auteurs"),
    kind: "actor", status: "candidate", topK: 6,
    tags: [bi("演员", "Actor"), bi("华语", "Chinese-language"), bi("女性", "Women in film")],
    movies: [
      ["苏州河", "Suzhou River", 2000], ["李米的猜想", "The Equation of Love and Death", 2008], ["风声", "The Message", 2009],
      ["如果·爱", "Perhaps Love", 2005], ["画皮", "Painted Skin", 2008], ["香港有个荷里活", "Hollywood Hong Kong", 2001],
      ["明月几时有", "Our Time Will Come", 2017], ["你好，之华", "Last Letter", 2018], ["第十一回", "The Eleventh Chapter", 2019],
    ],
  },
  {
    id: "classic-scifi",
    name: bi("科幻经典电影榜", "Science-Fiction Classics"),
    tagline: bi("从星海到意识边界，选择最打动你的未来", "From deep space to the edge of consciousness, choose your future"),
    recommendation: bi("适合检验你偏爱思想实验还是视觉奇观", "Discover whether you favor thought experiments or spectacle"),
    kind: "genre", status: "candidate", topK: 8,
    tags: [bi("类型", "Genre"), bi("科幻", "Sci-fi"), bi("经典", "Classics")],
    movies: [
      ["2001太空漫游", "2001: A Space Odyssey", 1968, "/ve72VxNqjGM69Uky4WTo2bK6rfq.jpg", 62],
      ["银翼杀手", "Blade Runner", 1982], ["异形", "Alien", 1979], ["黑客帝国", "The Matrix", 1999],
      ["星球大战", "Star Wars", 1977], ["终结者2：审判日", "Terminator 2: Judgment Day", 1991], ["回到未来", "Back to the Future", 1985],
      ["降临", "Arrival", 2016], ["星际穿越", "Interstellar", 2014], ["她", "Her", 2013],
    ],
  },
  {
    id: "courtroom",
    name: bi("法庭电影辩论席", "Great Courtroom Dramas"),
    tagline: bi("证词、偏见与正义，谁能说服你", "Testimony, prejudice and justice: what will persuade you?"),
    recommendation: bi("适合喜欢密集对白、推理与道德抉择的人", "For fans of sharp dialogue, reasoning and moral choice"),
    kind: "genre", status: "candidate", topK: 6,
    tags: [bi("类型", "Genre"), bi("法庭", "Courtroom"), bi("剧情", "Drama")],
    movies: [
      ["十二怒汉", "12 Angry Men", 1957, "/ow3wq89wM8qd5X7hWKxiRfsFf9C.jpg", 389],
      ["杀死一只知更鸟", "To Kill a Mockingbird", 1962], ["控方证人", "Witness for the Prosecution", 1957],
      ["好人寥寥", "A Few Good Men", 1992], ["费城故事", "Philadelphia", 1993], ["纽伦堡的审判", "Judgment at Nuremberg", 1961],
      ["芝加哥七君子审判", "The Trial of the Chicago 7", 2020], ["坠落的审判", "Anatomy of a Fall", 2023],
      ["辩护人", "The Attorney", 2013],
    ],
  },
  {
    id: "heist-crime",
    name: bi("劫案与犯罪电影榜", "Heist & Crime Favorites"),
    tagline: bi("计划永远周密，人心永远是变数", "The plan is flawless; people are always the variable"),
    recommendation: bi("适合偏爱智斗、团队与灰色人物的观众", "For lovers of schemes, crews and morally gray characters"),
    kind: "genre", status: "candidate", topK: 8,
    tags: [bi("类型", "Genre"), bi("犯罪", "Crime"), bi("劫案", "Heist")],
    movies: [
      ["十一罗汉", "Ocean's Eleven", 2001, "/hQQCdZrsHtZyR6NbKH2YyCqd2fR.jpg", 161],
      ["盗火线", "Heat", 1995], ["落水狗", "Reservoir Dogs", 1992], ["局内人", "Inside Man", 2006],
      ["城中大盗", "The Town", 2010], ["偷天换日", "The Italian Job", 2003], ["极盗车神", "Baby Driver", 2017],
      ["骗中骗", "The Sting", 1973], ["黄金三镖客", "The Good, the Bad and the Ugly", 1966],
    ],
  },
  {
    id: "coming-of-age",
    name: bi("成长电影青春册", "Coming-of-Age Favorites"),
    tagline: bi("长大不是答案，而是那些终于敢做的选择", "Growing up is not an answer, but the choices you finally make"),
    recommendation: bi("适合寻找最像自己青春的那一部电影", "Find the film that feels most like your own youth"),
    kind: "genre", status: "candidate", topK: 8,
    tags: [bi("类型", "Genre"), bi("成长", "Coming of age"), bi("青春", "Youth")],
    movies: [
      ["伯德小姐", "Lady Bird", 2017, "/gl66K7zRdtNYGrxyS2YDUP5ASZd.jpg", 391713],
      ["伴我同行", "Stand by Me", 1986], ["四百击", "The 400 Blows", 1959], ["怦然心动", "Flipped", 2010],
      ["少年时代", "Boyhood", 2014], ["月光男孩", "Moonlight", 2016], ["壁花少年", "The Perks of Being a Wallflower", 2012],
      ["成长教育", "An Education", 2009], ["阳光灿烂的日子", "In the Heat of the Sun", 1994], ["小妇人", "Little Women", 2019],
    ],
  },
  {
    id: "horror",
    name: bi("恐怖电影胆量榜", "Horror Essentials"),
    tagline: bi("真正留下阴影的，未必是最响的尖叫", "The deepest shadow rarely comes from the loudest scream"),
    recommendation: bi("适合比较心理恐惧、怪物与超自然惊吓", "Compare psychological dread, monsters and the supernatural"),
    kind: "genre", status: "candidate", topK: 8,
    tags: [bi("类型", "Genre"), bi("恐怖", "Horror"), bi("惊悚", "Thriller")],
    movies: [
      ["闪灵", "The Shining", 1980, "/xazWoLealQwEgqZ89MLZklLZD3k.jpg", 694],
      ["驱魔人", "The Exorcist", 1973], ["惊魂记", "Psycho", 1960], ["异形", "Alien", 1979], ["沉默的羔羊", "The Silence of the Lambs", 1991],
      ["逃出绝命镇", "Get Out", 2017], ["遗传厄运", "Hereditary", 2018], ["午夜凶铃", "Ring", 1998],
      ["咒怨", "Ju-On: The Grudge", 2002], ["女巫", "The Witch", 2015],
    ],
  },
  {
    id: "world-animation",
    name: bi("世界动画电影榜", "Animation Around the World"),
    tagline: bi("不同笔触与技术，都能抵达同一种想象力", "Different hands and techniques reach the same boundless imagination"),
    recommendation: bi("适合走出单一厂牌，发现动画的更多可能", "Step beyond one studio and explore animation's full range"),
    kind: "genre", status: "candidate", topK: 8,
    tags: [bi("类型", "Genre"), bi("动画", "Animation"), bi("世界", "World cinema")],
    movies: [
      ["蜘蛛侠：平行宇宙", "Spider-Man: Into the Spider-Verse", 2018, "/iiZZdoQBEYBv6id8su7ImL0oCbD.jpg", 324857],
      ["千与千寻", "Spirited Away", 2001], ["机器人总动员", "WALL-E", 2008], ["玩具总动员", "Toy Story", 1995],
      ["我失去了身体", "I Lost My Body", 2019], ["凯尔经的秘密", "The Secret of Kells", 2009],
      ["与巴什尔跳华尔兹", "Waltz with Bashir", 2008], ["玛丽和马克思", "Mary and Max", 2009],
      ["养家之人", "The Breadwinner", 2017], ["红辣椒", "Paprika", 2006],
    ],
  },
  {
    id: "musical",
    name: bi("歌舞电影旋律榜", "Movie Musical Favorites"),
    tagline: bi("当对白不够用，就让旋律替人物回答", "When dialogue falls short, let the music answer"),
    recommendation: bi("适合在经典歌舞与现代音乐电影间选边", "Choose between golden-age musicals and modern reinventions"),
    kind: "genre", status: "candidate", topK: 8,
    tags: [bi("类型", "Genre"), bi("歌舞", "Musical"), bi("音乐", "Music")],
    movies: [
      ["爱乐之城", "La La Land", 2016, "/uDO8zWDhfWwoFdKS4fzkUJt0Rf0.jpg", 313369],
      ["雨中曲", "Singin' in the Rain", 1952], ["音乐之声", "The Sound of Music", 1965], ["芝加哥", "Chicago", 2002],
      ["红磨坊", "Moulin Rouge!", 2001], ["西区故事", "West Side Story", 1961], ["卡巴莱", "Cabaret", 1972],
      ["火箭人", "Rocketman", 2019], ["吉屋出租", "Rent", 2005], ["悲惨世界", "Les Miserables", 2012],
    ],
  },
  {
    id: "sports",
    name: bi("体育电影热血榜", "Great Sports Movies"),
    tagline: bi("比分会结束，拼到最后的人仍留在记忆里", "The score ends; the ones who fought on remain"),
    recommendation: bi("适合比较赛场激情、人物成长与真实传奇", "Compare competition, character growth and true-life legends"),
    kind: "genre", status: "candidate", topK: 8,
    tags: [bi("类型", "Genre"), bi("体育", "Sports"), bi("励志", "Inspiring")],
    movies: [
      ["洛奇", "Rocky", 1976, "/cqxg1CihGR5ge0i1wYXr4Rdeppu.jpg", 1366],
      ["愤怒的公牛", "Raging Bull", 1980], ["百万美元宝贝", "Million Dollar Baby", 2004], ["点球成金", "Moneyball", 2011],
      ["极速车王", "Ford v Ferrari", 2019], ["光荣之路", "Glory Road", 2006], ["卡特教练", "Coach Carter", 2005],
      ["弱点", "The Blind Side", 2009], ["我，花样女王", "I, Tonya", 2017], ["摔跤吧！爸爸", "Dangal", 2016],
    ],
  },
] as const;

export const activeFilmLists: readonly FilmList[] = activeSeeds.map(makeList);
export const candidateFilmLists: readonly FilmList[] = candidateSeeds.map(makeList);
export const allFilmLists: readonly FilmList[] = [...activeFilmLists, ...candidateFilmLists];

export const filmListsById: ReadonlyMap<string, FilmList> = new Map(
  allFilmLists.map((list) => [list.id, list]),
);

export const getFilmListById = (id: string): FilmList | undefined => filmListsById.get(id);

export const getMovieById = (listId: string, movieId: string): Movie | undefined =>
  getFilmListById(listId)?.movies.find((movie) => movie.id === movieId);

export const getFeaturedMovie = (list: FilmList): Movie => {
  const featured = list.movies.find((movie) => movie.id === list.featuredMovieId);
  return featured ?? list.movies[0];
};

export const getFilmListsByKind = (kind: FilmListKind): readonly FilmList[] =>
  allFilmLists.filter((list) => list.kind === kind);

export const searchFilmLists = (query: string): readonly FilmList[] => {
  const normalized = query.trim().toLocaleLowerCase();
  if (!normalized) return allFilmLists;

  return allFilmLists.filter((list) => {
    const searchable = [
      list.name.zh,
      list.name.en,
      list.tagline.zh,
      list.tagline.en,
      ...list.tags.flatMap((tag) => [tag.zh, tag.en]),
      ...list.movies.flatMap((movie) => [movie.title.zh, movie.title.en]),
    ];
    return searchable.some((value) => value.toLocaleLowerCase().includes(normalized));
  });
};

export const catalogStats = Object.freeze({
  totalLists: allFilmLists.length,
  activeLists: activeFilmLists.length,
  candidateLists: candidateFilmLists.length,
  totalMovieEntries: allFilmLists.reduce((sum, list) => sum + list.movies.length, 0),
});

