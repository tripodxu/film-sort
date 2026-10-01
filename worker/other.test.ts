import { afterEach, describe, expect, it, vi } from "vitest";
import {
  otherDetail,
  otherSearch,
  resolveOtherCover,
  toSimplified,
  wikiPageImageAny,
} from "./other";

// ===== 其他类别维基管线的离线回归测试 =====
// 用录像级 fixture 驱动 fetch 桩，验证三条链路的选页逻辑：
// ① 消歧页（pageprops.disambiguation）必须被机械剔除；
// ② 给了年份时优先摘述命中年份的条目（消歧最硬信号）；
// ③ pageprops.page_image（infobox 封面）优先于 pageimages（非自由封面恒空），
//    images→imageinfo 兜底只在文件名含标题关键词时采用，无命中不回落 files[0]
//    （蒙娜丽莎教训：文章内相关画作按字母序抢在主图前）。
// fixture 形状按 2026-09-30 线上实测的 zh api.php 响应录制。

interface Route {
  match: RegExp;
  body: Record<string, unknown>;
}

const UP = "https://upload.wikimedia.org/wikipedia/commons/thumb";

/** URLSearchParams 把空格编码成 +，decodeURIComponent 不解 +，一并还原 */
function decodeUrl(input: string): string {
  return decodeURIComponent(String(input)).replace(/\+/g, " ");
}

function installFetch(routes: Route[]): void {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: string) => {
      const url = decodeUrl(input);
      const route = routes.find((candidate) => candidate.match.test(url));
      const body = route ? route.body : { query: { pages: {} } };
      return new Response(JSON.stringify(body), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }),
  );
}

/** pageimages 自由图档（对非自由封面恒空，这里就是空） */
const noFreeImage = { images: undefined };

const ANIMAL_CROSSING = {
  query: {
    pages: {
      series: {
        title: "動物森友會系列",
        pageprops: { disambiguation: "" },
        extract: "動物森友會系列是任天堂的生活模擬遊戲系列。",
        ...noFreeImage,
      },
      first: {
        title: "動物森友會 (遊戲)",
        pageprops: { page_image: "Doubutsu_No_Mori_Boxart.jpg" },
        extract: "《動物森友會》是2001年任天堂開發的生活模擬遊戲。",
        ...noFreeImage,
      },
      horizon: {
        title: "集合啦！動物森友會",
        pageprops: { page_image: "Animal_Crossing_New_Horizons.png" },
        extract: "《集合啦！動物森友會》是2020年任天堂發售的生活模擬遊戲。",
        ...noFreeImage,
      },
    },
  },
};

const IMAGE_INFO = {
  query: {
    pages: {
      horizon: {
        title: "File:Animal Crossing New Horizons.png",
        imageinfo: [{ thumburl: `${UP}/6/6b/600px-Animal_Crossing_New_Horizons.png` }],
      },
      first: {
        title: "File:Doubutsu no Mori boxart.jpg",
        imageinfo: [{ thumburl: `${UP}/7/7e/600px-Doubutsu.jpg` }],
      },
    },
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("other wiki pipeline", () => {
  it("动物森友会：封面由年份摘到 2020 正作（而非系列页/2001 首作）", async () => {
    installFetch([
      { match: /titles=动物森友会/, body: ANIMAL_CROSSING },
      { match: /gsrsearch=动物森友会/, body: ANIMAL_CROSSING },
      { match: /titles=File:Animal_Crossing_New_Horizons\.png/, body: IMAGE_INFO },
    ]);
    expect(await resolveOtherCover("动物森友会", "", 2020)).toBe(
      `${UP}/6/6b/600px-Animal_Crossing_New_Horizons.png`,
    );
  });

  it("Inside：消歧页被剔除，封面与详情落到 2016 游戏页", async () => {
    const game = {
      title: "Inside (遊戲)",
      pageprops: { page_image: "INSIDE_Cover.jpg" },
      extract: "《Inside》是2016年由Playdead開發的電子遊戲。",
    };
    installFetch([
      {
        match: /titles=Inside/,
        body: {
          query: {
            pages: {
              disambig: {
                title: "Inside",
                pageprops: { disambiguation: "" },
                extract: "Inside可以指：專輯、遊戲等事物。",
                ...noFreeImage,
              },
            },
          },
        },
      },
      {
        match: /gsrsearch=Inside/,
        body: {
          query: {
            pages: {
              disambig: {
                title: "Inside",
                pageprops: { disambiguation: "" },
                extract: "Inside可以指：專輯、遊戲等事物。",
                ...noFreeImage,
              },
              game,
            },
          },
        },
      },
      {
        match: /titles=File:INSIDE_Cover\.jpg/,
        body: {
          query: {
            pages: {
              file: {
                title: "File:INSIDE Cover.jpg",
                imageinfo: [{ thumburl: `${UP}/1/1a/600px-INSIDE_Cover.jpg` }],
              },
            },
          },
        },
      },
    ]);
    expect(await resolveOtherCover("Inside", "", 2016)).toBe(`${UP}/1/1a/600px-INSIDE_Cover.jpg`);
    const detail = await otherDetail("Inside", 2016);
    expect(detail?.title).toBe("Inside (遊戲)");
    expect(detail?.year).toBe(2016);
    expect(detail?.poster_url).toBe(`${UP}/1/1a/600px-INSIDE_Cover.jpg`);
    expect(detail?.content_intro).toContain("2016");
  });

  it("Journey：封面由 2012 摘到风之旅人（跨过乐团页）", async () => {
    const journeyPages = {
      query: {
        pages: {
          disambig: {
            title: "Journey",
            pageprops: { disambiguation: "" },
            extract: "Journey可以指：旅行者合唱團、风之旅人等。",
            ...noFreeImage,
          },
          band: {
            title: "旅行者合唱團",
            extract: "旅行者合唱團是1973年成立的美國搖滾樂團。",
            ...noFreeImage,
          },
          game: {
            title: "風之旅人",
            pageprops: { page_image: "Journey_PSN_Cover.png" },
            extract: "《風之旅人》是thatgamecompany開發的2012年電子遊戲。",
          },
        },
      },
    };
    installFetch([
      { match: /gsrsearch=Journey/, body: journeyPages },
      {
        match: /titles=File:Journey_PSN_Cover\.png/,
        body: {
          query: {
            pages: {
              file: {
                title: "File:Journey PSN Cover.png",
                imageinfo: [{ thumburl: `${UP}/2/2b/600px-Journey_PSN_Cover.png` }],
              },
            },
          },
        },
      },
    ]);
    expect(await resolveOtherCover("Journey", "", 2012)).toBe(
      `${UP}/2/2b/600px-Journey_PSN_Cover.png`,
    );
  });

  it("Journey：精确标题命中消歧页时，详情改用搜索结果", async () => {
    installFetch([
      {
        match: /titles=Journey/,
        body: {
          query: {
            pages: {
              disambig: {
                title: "Journey",
                pageprops: { disambiguation: "" },
                extract: "Journey可以指：旅行者合唱團、风之旅人等。",
                ...noFreeImage,
              },
            },
          },
        },
      },
      {
        match: /gsrsearch=Journey/,
        body: {
          query: {
            pages: {
              disambig: {
                title: "Journey",
                pageprops: { disambiguation: "" },
                extract: "Journey可以指：旅行者合唱團、风之旅人等。",
                ...noFreeImage,
              },
              band: {
                title: "旅行者合唱團",
                extract: "旅行者合唱團是1973年成立的美國搖滾樂團。",
                ...noFreeImage,
              },
              game: {
                title: "風之旅人",
                pageprops: { page_image: "Journey_PSN_Cover.png" },
                extract: "《風之旅人》是thatgamecompany開發的2012年電子遊戲。",
              },
            },
          },
        },
      },
      {
        match: /titles=File:Journey_PSN_Cover\.png/,
        body: {
          query: {
            pages: {
              file: {
                title: "File:Journey PSN Cover.png",
                imageinfo: [{ thumburl: `${UP}/2/2b/600px-Journey_PSN_Cover.png` }],
              },
            },
          },
        },
      },
    ]);
    const detail = await otherDetail("Journey", 2012);
    expect(detail?.title).toBe("風之旅人");
    expect(detail?.year).toBe(2012);
    expect(detail?.poster_url).toBe(`${UP}/2/2b/600px-Journey_PSN_Cover.png`);
  });

  it("Journey：摘要提到 2012 的同名异作（西遊記）不能压过风之旅人", async () => {
    installFetch([
      {
        match: /titles=Journey/,
        body: {
          query: {
            pages: {
              disambig: {
                title: "Journey",
                pageprops: { disambiguation: "" },
                extract: "Journey可以指：旅行者合唱團、风之旅人等。",
                ...noFreeImage,
              },
            },
          },
        },
      },
      {
        match: /gsrsearch=Journey/,
        body: {
          query: {
            pages: {
              // 线上实测：zh gsrsearch("Journey") 会把《西遊記》排得很前，
              // 且它的 extract 里出现过 2012（重播），条目本体是 1996 电视剧
              tv: {
                title: "西遊記 (無綫1996年電視劇)",
                pageprops: { page_image: "Journey_to_the_West_I.png" },
                extract:
                  "《西遊記》是香港電視廣播有限公司古裝神話電視劇，共三十集。1996年11月首播，2012年凌晨重播。",
              },
              game: {
                title: "風之旅人",
                pageprops: { page_image: "Journey_PSN_Cover.png" },
                extract: "《風之旅人》是thatgamecompany開發的2012年電子遊戲。",
              },
            },
          },
        },
      },
      {
        match: /titles=File:Journey_PSN_Cover\.png/,
        body: {
          query: {
            pages: {
              file: {
                title: "File:Journey PSN Cover.png",
                imageinfo: [{ thumburl: `${UP}/2/2b/600px-Journey_PSN_Cover.png` }],
              },
            },
          },
        },
      },
    ]);
    const detail = await otherDetail("Journey", 2012);
    expect(detail?.title).toBe("風之旅人");
    expect(detail?.year).toBe(2012);
  });

  it("Journey：纯标题轮被同名异作占据时，类型词轮仍必须跑（风之旅人才能进候选）", async () => {
    // 线上实测：zh gsrsearch("Journey") 首位《西遊記》且带封面——若因「已见封面」
    // 跳过「Journey 电子游戏」轮，风之旅人永远不在候选集里（2026-09-30 回归教训）
    installFetch([
      { match: /titles=Journey/, body: { query: { pages: {} } } },
      {
        match: /gsrsearch=Journey&/,
        body: {
          query: {
            pages: {
              tv: {
                title: "西遊記 (無綫1996年電視劇)",
                pageprops: { page_image: "Journey_to_the_West_I.png" },
                extract:
                  "《西遊記》是香港電視廣播有限公司古裝神話電視劇，共三十集。1996年11月首播，2012年凌晨重播。",
              },
            },
          },
        },
      },
      {
        match: /gsrsearch=Journey\s/,
        body: {
          query: {
            pages: {
              game: {
                title: "風之旅人",
                pageprops: { page_image: "Journey_PSN_Cover.png" },
                extract: "《風之旅人》是thatgamecompany開發的2012年電子遊戲。",
              },
            },
          },
        },
      },
      {
        match: /titles=File:Journey_PSN_Cover\.png/,
        body: {
          query: {
            pages: {
              file: {
                title: "File:Journey PSN Cover.png",
                imageinfo: [{ thumburl: `${UP}/2/2b/600px-Journey_PSN_Cover.png` }],
              },
            },
          },
        },
      },
    ]);
    const detail = await otherDetail("Journey", 2012);
    expect(detail?.title).toBe("風之旅人");
    expect(detail?.year).toBe(2012);
    expect(detail?.poster_url).toBe(`${UP}/2/2b/600px-Journey_PSN_Cover.png`);
  });

  it("otherSearch 用 infobox 封面文件名补齐各候选的海报", async () => {
    installFetch([
      { match: /gsrsearch=动物森友会/, body: ANIMAL_CROSSING },
      { match: /titles=File:/, body: IMAGE_INFO },
    ]);
    const works = await otherSearch("动物森友会");
    expect(works.map((work) => work.title)).toEqual(["動物森友會 (遊戲)", "集合啦！動物森友會"]);
    expect(works.map((work) => work.poster_url)).toEqual([
      `${UP}/7/7e/600px-Doubutsu.jpg`,
      `${UP}/6/6b/600px-Animal_Crossing_New_Horizons.png`,
    ]);
  });

  it("纪念碑谷：2014 游戏页的 infobox 封面（而非真实地貌照片）", async () => {
    installFetch([
      {
        match: /gsrsearch=纪念碑谷/,
        body: {
          query: {
            pages: {
              valley: {
                title: "紀念碑谷",
                extract: "紀念碑谷是位於美國亞利桑那州的荒漠地貌。",
                ...noFreeImage,
              },
              game: {
                title: "紀念碑谷 (遊戲)",
                pageprops: { page_image: "Monument_Valley_icon_unrounded.jpg" },
                extract: "《紀念碑谷》是2014年由ustwo開發的益智遊戲。",
              },
            },
          },
        },
      },
      {
        match: /titles=File:Monument_Valley_icon_unrounded\.jpg/,
        body: {
          query: {
            pages: {
              file: {
                title: "File:Monument Valley icon unrounded.jpg",
                imageinfo: [{ thumburl: `${UP}/4/4c/600px-Monument_Valley_icon_unrounded.jpg` }],
              },
            },
          },
        },
      },
    ]);
    expect(await resolveOtherCover("纪念碑谷", "", 2014)).toBe(
      `${UP}/4/4c/600px-Monument_Valley_icon_unrounded.jpg`,
    );
  });

  it("wikiPageImageAny：infobox 封面文件名优先于 images 列表", async () => {
    installFetch([
      {
        match: /titles=蒙娜丽莎/,
        body: {
          query: {
            pages: {
              painting: {
                title: "蒙娜麗莎",
                pageprops: { page_image: "Mona_Lisa.jpg" },
                images: [
                  { title: "File:Baldassare_Castiglione.jpg" },
                  { title: "File:Mona_Lisa,_by_Leonardo_da_Vinci.jpg" },
                ],
              },
            },
          },
        },
      },
      {
        match: /titles=File:Mona_Lisa\.jpg/,
        body: {
          query: {
            pages: {
              file: {
                title: "File:Mona Lisa.jpg",
                imageinfo: [{ thumburl: `${UP}/8/8a/600px-Mona_Lisa.jpg` }],
              },
            },
          },
        },
      },
    ]);
    expect(await wikiPageImageAny("zh", "蒙娜丽莎", ["Mona Lisa"])).toBe(
      `${UP}/8/8a/600px-Mona_Lisa.jpg`,
    );
  });

  it("wikiPageImageAny：文件名命中标题关键词时才用（跨过 files[0]）", async () => {
    installFetch([
      {
        match: /titles=底特律/,
        body: {
          query: {
            pages: {
              city: {
                title: "底特律",
                pageprops: {},
                images: [
                  { title: "File:Detroit_Skyline.jpg" },
                  { title: "File:Detroit_Become_Human_Cover.jpg" },
                ],
              },
            },
          },
        },
      },
      {
        match: /titles=File:Detroit_Become_Human_Cover\.jpg/,
        body: {
          query: {
            pages: {
              file: {
                title: "File:Detroit Become Human Cover.jpg",
                imageinfo: [{ thumburl: `${UP}/3/34/600px-Detroit_Become_Human_Cover.jpg` }],
              },
            },
          },
        },
      },
    ]);
    // files[0] 是天际线照片，必须被跳过
    expect(await wikiPageImageAny("zh", "底特律 变人", ["Detroit: Become Human"])).toBe(
      `${UP}/3/34/600px-Detroit_Become_Human_Cover.jpg`,
    );
  });

  it("wikiPageImageAny：没有含标题的文件时返回 null（不回落 files[0]）", async () => {
    installFetch([
      {
        match: /titles=纪念碑谷/,
        body: {
          query: {
            pages: {
              valley: {
                title: "紀念碑谷",
                pageprops: {},
                images: [
                  { title: "File:Monument_Valley_Arizona.jpg" },
                  { title: "File:Monument_Valley_3_logotype.svg" },
                ],
              },
            },
          },
        },
      },
    ]);
    expect(await wikiPageImageAny("zh", "纪念碑谷", ["Monument Valley"])).toBeNull();
  });

  // ===== 繁简失配回归（2026-09-30 线上翻车的根因） =====
  // zh 维基条目名是繁体、用户输入简体，不归一时「标题命中」信号永不亮，
  // 作品页/角色页/系列页同分，谁排前全看 gsrsearch 抖动。

  describe("简繁归一", () => {
    it("toSimplified 覆盖标题高频字", () => {
      expect(toSimplified("動物森友會")).toBe("动物森友会");
      expect(toSimplified("薩爾達傳說 王國之淚")).toBe("萨尔达传说 王国之泪");
      expect(toSimplified("蒙娜麗莎")).toBe("蒙娜丽莎");
      expect(toSimplified("隻狼：暗影雙死")).toBe("只狼：暗影双死");
      expect(toSimplified("底特律：變人")).toBe("底特律：变人");
      expect(toSimplified("紀念碑谷")).toBe("纪念碑谷");
      expect(toSimplified("艾爾登法環")).toBe("艾尔登法环");
      expect(toSimplified("Inside")).toBe("Inside");
    });

    it("标题分级：作品页(结尾命中)压过角色页(括号里包含)", async () => {
      const pages = {
        query: {
          pages: {
            jack: {
              title: "傑克 (動物森友會)",
              pageprops: { page_image: "Jack_cat_animal_crossing.png" },
              extract: "傑克是2020年遊戲《集合啦！動物森友會》的貓咪角色。",
              ...noFreeImage,
            },
            horizon: {
              title: "集合啦！動物森友會",
              pageprops: { page_image: "Animal_Crossing_New_Horizons.png" },
              extract: "《集合啦！動物森友會》是2020年任天堂發售的生活模擬遊戲。",
              ...noFreeImage,
            },
          },
        },
      };
      installFetch([
        { match: /gsrsearch=动物森友会/, body: pages },
        {
          match: /titles=File:Animal_Crossing_New_Horizons\.png/,
          body: {
            query: {
              pages: {
                file: {
                  title: "File:Animal Crossing New Horizons.png",
                  imageinfo: [{ thumburl: `${UP}/6/6b/600px-Animal_Crossing_New_Horizons.png` }],
                },
              },
            },
          },
        },
      ]);
      const detail = await otherDetail("动物森友会", 2020);
      expect(detail?.title).toBe("集合啦！動物森友會");
      expect(detail?.poster_url).toBe(`${UP}/6/6b/600px-Animal_Crossing_New_Horizons.png`);
    });
  });
});
