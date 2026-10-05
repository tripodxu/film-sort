import { afterEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import {
  classifyArtworkFile,
  newWikiProbe,
  otherCandidateReport,
  otherConfidence,
  otherDetail,
  otherSearch,
  pickThumbBucket,
  resolveOtherCover,
  titleMatchTier,
  toSimplified,
  wikiPageImageAny,
  wikiProbeVerdict,
  type OtherCandidate,
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

  // 2026-10-02 线上实录形状：纪念碑谷 (游戏) 的 infobox 里填的是 app 图标，
  // 真正的游戏截图在同一页正文里排第 7（旧代码取到 icon，本轮取到 screenshot）。
  const MONUMENT_VALLEY_GAME = {
    title: "纪念碑谷 (游戏)",
    pageprops: { page_image: "Monument_Valley_icon_unrounded.jpg" },
    extract: "《紀念碑谷》是2014年由ustwo開發的益智遊戲。",
    images: [
      { title: "File:Crystal Clear app package games.svg" },
      { title: "File:Future film2.svg" },
      { title: "File:Ken wong - game developers conference cropped.jpg" },
      { title: "File:MobiusJoshDif.jpg" },
      { title: "File:Monument Valley icon unrounded.jpg" },
      { title: "File:Monument Valley screenshot.jpg" },
      { title: "File:OOjs UI icon edit-ltr-progressive.svg" },
      { title: "File:Penrose-dreieck.svg" },
    ],
  };

  it("纪念碑谷：infobox 是 app 图标时改用正文里的游戏截图（而不是图标）", async () => {
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
              game: MONUMENT_VALLEY_GAME,
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
                imageinfo: [{ thumburl: `${UP}/1/1a/600px-Monument_Valley_icon_unrounded.jpg` }],
              },
            },
          },
        },
      },
      // 补 prop=images 的那次查询（page_image 被判 artifact 才发）。
      // 文件名里的空格在 URL 里编码成 +，installFetch 已解码，故这里用空格。
      { match: /prop=images/, body: { query: { pages: {} } } },
      {
        match: /titles=File:Monument Valley screenshot\.jpg/,
        body: {
          query: {
            pages: {
              file: {
                title: "File:Monument Valley screenshot.jpg",
                imageinfo: [{ thumburl: `${UP}/c/cd/600px-Monument_Valley_screenshot.jpg` }],
              },
            },
          },
        },
      },
    ]);
    // 红线：绝不能再是 icon_unrounded
    const cover = await resolveOtherCover("纪念碑谷", "", 2014);
    expect(cover).not.toContain("icon_unrounded");
    expect(cover).toBe(`${UP}/c/cd/600px-Monument_Valley_screenshot.jpg`);
  });

  it("纪念碑谷：infobox 是 app 图标时，详情退回缩略图而不是丢掉整条条目", async () => {
    // 红队 R2 逼出来的用例：「artifact ⇒ return null」看起来更干净，
    // 实际上会把**整个条目**从详情/搜索结果里抹掉——比拿错图更糟。
    // 钉住的行为：poster 换掉，但 title/extract 一字不少。
    installFetch([
      // 精确标题轮先命中（titles=），thumbnail 挂在这一轮返回的页面上
      {
        match: /titles=纪念碑谷/,
        body: {
          query: {
            pages: {
              game: {
                ...MONUMENT_VALLEY_GAME,
                thumbnail: { source: `${UP}/c/cd/500px-Monument_Valley_screenshot.jpg` },
              },
            },
          },
        },
      },
      { match: /gsrsearch=纪念碑谷/, body: { query: { pages: {} } } },
      {
        match: /titles=File:Monument_Valley_icon_unrounded\.jpg/,
        body: {
          query: {
            pages: {
              file: {
                title: "File:Monument Valley icon unrounded.jpg",
                imageinfo: [
                  {
                    thumburl: `${UP}/1/1a/600px-Monument_Valley_icon_unrounded.jpg`,
                    url: "https://upload.wikimedia.org/wikipedia/commons/1/1a/x.jpg",
                  },
                ],
              },
            },
          },
        },
      },
    ]);
    const detail = await otherDetail("纪念碑谷", 2014);
    expect(detail, "条目被整个丢掉了（不该发生）").not.toBeNull();
    expect(detail?.title).toBe("纪念碑谷 (游戏)");
    expect(detail?.content_intro).toContain("2014");
    expect(detail?.poster_url ?? "").not.toContain("icon_unrounded");
    expect(detail?.poster_url).toBe(`${UP}/c/cd/500px-Monument_Valley_screenshot.jpg`);
  });

  // 上一条把 images 直接挂在 gsrsearch 的返回上，于是**根本没走过
  // fillArticleImageNames**——2026-10-02 那天整个 worker/other.test.ts 全绿而
  // 线上取不到图，根因就在这儿：填 images 的那个函数写的是裸字符串，读它的
  // 两个函数按 {title} 对象读，TypeScript 因为两边各自 cast 而全程不报错。
  // 所以这条必须让 images **只从 prop=images 那次查询回来**，其余全空。
  it("fillArticleImageNames：正文图列表从 prop=images 查询回来后仍能选出游戏截图", async () => {
    const gameNoImages = {
      title: "纪念碑谷 (游戏)",
      pageprops: { page_image: "Monument_Valley_icon_unrounded.jpg" },
      extract: "《紀念碑谷》是2014年由ustwo開發的益智遊戲。",
    };
    installFetch([
      // 顺序要紧（installFetch 取第一个匹配的路由）：prop=images 的那次请求
      // titles 是归一后的页面名「纪念碑谷 (游戏)」，会被下面 /titles=纪念碑谷/
      // 前缀匹配吃掉，返回一个没有 images 的页面 ⇒ 看起来像修复没生效。
      // 2026-10-02 在本文件里因此白查三轮。
      {
        match: /prop=images/,
        body: {
          query: {
            pages: {
              "-7621": {
                pageid: 7621,
                ns: 0,
                title: "纪念碑谷 (游戏)",
                images: [
                  { title: "File:Ken wong - game developers conference cropped.jpg" },
                  { title: "File:Monument Valley icon unrounded.jpg" },
                  { title: "File:Monument Valley screenshot.jpg" },
                ],
              },
            },
          },
        },
      },
      {
        match: /titles=File:Monument Valley screenshot\.jpg/,
        body: {
          query: {
            pages: {
              file: {
                title: "File:Monument Valley screenshot.jpg",
                imageinfo: [{ thumburl: `${UP}/c/cd/500px-Monument_Valley_screenshot.jpg` }],
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
                imageinfo: [{ thumburl: `${UP}/1/1a/600px-Monument_Valley_icon_unrounded.jpg` }],
              },
            },
          },
        },
      },
      {
        match: /titles=纪念碑谷/,
        body: { query: { pages: { game: gameNoImages } } },
      },
      { match: /gsrsearch=纪念碑谷/, body: { query: { pages: {} } } },
    ]);
    const detail = await otherDetail("纪念碑谷", 2014);
    expect(detail?.poster_url ?? "").not.toContain("icon_unrounded");
    expect(detail?.poster_url, "prop=images 回填的正文图没被选上").toBe(
      `${UP}/c/cd/500px-Monument_Valley_screenshot.jpg`,
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

  it("wikiPageImageAny：infobox 封面是 app 图标时不返回（不拿图标当封面）", async () => {
    // iter10：page_image 直取这条「优先级最高」的取图路径此前毫无防护。
    // 判掉之后**不能 return null**——要继续走 images 分支，那里有真封面。
    installFetch([
      {
        match: /titles=纪念碑谷/,
        body: {
          query: {
            pages: {
              game: {
                title: "纪念碑谷 (游戏)",
                pageprops: { page_image: "Monument_Valley_icon_unrounded.jpg" },
                images: [
                  { title: "File:OOjs_UI_icon_edit-ltr-progressive.svg" },
                  { title: "File:Monument Valley screenshot.jpg" },
                ],
              },
            },
          },
        },
      },
      {
        match: /titles=File:Monument Valley screenshot\.jpg/,
        body: {
          query: {
            pages: {
              file: {
                title: "File:Monument Valley screenshot.jpg",
                imageinfo: [{ thumburl: `${UP}/c/cd/600px-Monument_Valley_screenshot.jpg` }],
              },
            },
          },
        },
      },
    ]);
    const got = await wikiPageImageAny("zh", "纪念碑谷", ["Monument Valley"]);
    expect(got).toBe(`${UP}/c/cd/600px-Monument_Valley_screenshot.jpg`);
  });

  // ===== 标题吻合闸门（2026-10-02 线上错图修复） =====
  // 旧算法只要求条目名「蹭到」用户标题的任一查询词，就让「有 infobox 封面 /
  // 摘要够长 / 命中类型词」这些弱信号堆分夺冠，线上留下三张错图。
  // 闸门之后：标题零重合的条目一律淘汰，除非（a）消歧页自己列了它的名字，
  // 或（b）它被「<用户标题> 电子游戏」这一轮返且自述确实是游戏。

  describe("标题吻合闸门", () => {
    /** 线上 gsrsearch 实录：搜「日常幻想」回来的候选池 */
    it("日常幻想：日常幻想指南（同前缀+描述性后缀）不能夺冠", async () => {
      const pages = {
        query: {
          pages: {
            guide: {
              title: "日常幻想指南",
              pageprops: {},
              extract:
                "《日常幻想指南》是2021年上映的中国大陆喜剧电影，由一部讲述性幻想题材的作品衍生。",
              images: [{ title: "File:Kenneth_Tsang_autograph.png" }],
            },
            // 正确项：条目名把原名裹在末尾（中文本地化常见），且真的没有封面
            real: {
              title: "日常幻想",
              extract: "日常幻想是一档关于性幻想的摄影系列，收录了摄影师本人的作品。",
            },
          },
        },
      };
      installFetch([
        { match: /gsrsearch=日常幻想/, body: pages },
        { match: /titles=日常幻想/, body: { query: { pages: { real: pages.query.pages.real } } } },
      ]);
      const detail = await otherDetail("日常幻想", 2021);
      // 宁可不返图也不返错图：签名照那张必须拿不到
      expect(detail?.poster_url ?? "").not.toContain("Kenneth_Tsang");
      expect(detail?.title).not.toBe("日常幻想指南");
    });

    /** 线上 gsrsearch 实录：搜「看理想」回来的是游戏与演员页 */
    it("看理想：勇者斗恶龙 (游戏) 不能夺冠", async () => {
      installFetch([
        {
          match: /gsrsearch=看理想/,
          body: {
            query: {
              pages: {
                game: {
                  title: "勇者斗恶龙 (游戏)",
                  pageprops: { page_image: "Doragon_Kuesuto_Boxart.png" },
                  extract: "《勇者斗恶龙》是1986年日本史克威尔艾尼克斯推出的角色扮演电子游戏。",
                },
                actor: {
                  title: "井柏然",
                  extract: "井柏然是中国内地男演员。",
                },
              },
            },
          },
        },
        { match: /titles=File:Doragon_Kuesuto_Boxart\.png/, body: IMAGE_INFO },
      ]);
      expect(await resolveOtherCover("看理想", "", 2016)).toBeNull();
    });

    /** 线上 gsrsearch 实录：搜「故事FM」回来的是同义专辑 */
    it("故事FM：我們的故事 (專輯) 不能夺冠", async () => {
      installFetch([
        {
          match: /gsrsearch=故事FM/,
          body: {
            query: {
              pages: {
                album: {
                  title: "我們的故事 (專輯)",
                  pageprops: { page_image: "Louis_Francois-Dantes_sur_son_rocher.jpg" },
                  extract: "《我們的故事》是蕭煌奇2006年發行的專輯。",
                },
              },
            },
          },
        },
        { match: /titles=File:Louis_Francois/, body: IMAGE_INFO },
      ]);
      expect(await resolveOtherCover("故事FM", "", 2017)).toBeNull();
    });

    it("Journey：消歧页自列的「風之旅人」要能穿过闸门（零字重合也放行）", async () => {
      // 线上 zh.wikipedia.org/wiki/Journey 的 extract 原样照抄（2026-10-02 抓）：
      // 每行一项，行尾带描述。「風之旅人」与用户标题零字重合，全靠这份名单放行。
      const pages = {
        query: {
          pages: {
            disambig: {
              title: "Journey",
              pageprops: { disambiguation: "" },
              extract: "Journey可以指：\n旅行者合唱團，美國搖滾樂團\n風之旅人，2012年电子游戏",
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
        { match: /titles=Journey/, body: pages },
        { match: /gsrsearch=Journey/, body: pages },
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
      expect(detail?.poster_url).toBe(`${UP}/2/2b/600px-Journey_PSN_Cover.png`);
    });

    it("故事FM：「故事FM 电子游戏」轮召回的 SCP基金会 不能当播客封面", async () => {
      // 线上 zh.wikipedia.org/wiki/故事FM 实录：**没有**该条目（missing），
      // extract 为空、无图。真正的救援全靠「故事FM 电子游戏」那一轮——但那一轮
      // 返的是 SCP基金会（带缩略图）、伊苏 失落的伊苏古国 序章、王国之心系列
      // 作品列表，标题与「故事FM」零重合。旧逻辑只按 tier+score 排，SCP 基金会
      // 靠「有缩略图 + 摘要够长」压过真条目，播客封面就成了 SCP 徽标。
      // 正确结果：宁可不返图，也不返一张错图。
      const hintPages = {
        query: {
          pages: {
            scp: {
              title: "SCP基金会",
              thumbnail: { source: `${UP}/e/ec/960px-SCP_Foundation_(emblem).svg.png` },
              extract:
                "SCP基金会是一个虚构的特工组织，作为同名互联网接龙小说创作项目中的主要要素。衍生作品如恐怖电子游戏《SCP：收容失效》。",
            },
            ys: {
              title: "伊苏 失落的伊苏古国 序章",
              pageprops: { page_image: "Ys_Ancient_Ys_Vanished_Cover.jpg" },
              extract:
                "《伊苏 失落的伊苏古国 序章》是日本Falcom动作角色扮演游戏系列伊苏的第一作，于1987年推出。",
            },
            kh: {
              title: "王国之心系列作品列表",
              pageprops: { page_image: "Kingdom_Hearts_media.jpg" },
              extract:
                "《王国之心》是由日本游戏开发商史克威尔艾尼克斯开发并发行的一系列动作角色扮演游戏。",
            },
          },
        },
      };
      const emptyExact = { query: { pages: { "-1": { title: "故事FM", missing: "" } } } };
      // 注意 installFetch 先 decodeUrl（%XX 与 + 都会还原）再匹配，所以这里写
      // 明文 + 空格，不要写百分号编码——否则所有路由都落空、测试会永远绿。
      installFetch([
        { match: /titles=故事FM/, body: emptyExact },
        { match: /gsrsearch=故事FM 电子游戏/, body: hintPages },
        { match: /gsrsearch=故事FM video game/, body: { query: { pages: {} } } },
        { match: /gsrsearch=故事FM/, body: { query: { pages: {} } } },
        { match: /titles=File:/, body: { query: { pages: {} } } },
      ]);
      // 三个候选都不提 2017 → hintRescued 的年份佐证不成立 → 一律不返图
      expect(await resolveOtherCover("故事FM", "故事FM", 2017)).toBeNull();
      // 无年份时更不能靠「有缩略图」这条弱信号夺冠
      expect(await resolveOtherCover("故事FM", "故事FM")).toBeNull();
    });

    it("Journey：道奇Journey（汽车）不能靠末尾命中冒充作品页", async () => {
      // 线上 gsrsearch("Journey 电子游戏") 实录：道奇Journey 条目名以原名结尾，
      // titleMatchTier 只能给到 tier2 —— 标题层分不出「本地化游戏名」和
      // 「同名的车」。它的首句以自己的名字领起（isSelfDescribed 判为本人），
      // 分不出车与游戏的是 declaresWorkTopic：首句里连一个作品类型词都没有。
      // 摘要与 pageprops 都按线上响应照抄（2009 车型 + 无 infobox 封面）。
      const pages = {
        query: {
          pages: {
            dodge: {
              title: "道奇Journey",
              pageprops: {},
              extract:
                "道奇Journey是克莱斯勒品牌旗下的一款中型SUV，2009年推出，2012年款为第二代车型。",
            },
            // 同轮还带回来的真实游戏页：只有它该赢
            game: {
              title: "風之旅人",
              pageprops: { page_image: "Journey_PSN_Cover.png" },
              extract: "《風之旅人》是thatgamecompany開發的2012年電子遊戲。",
            },
          },
        },
      };
      installFetch([
        { match: /gsrsearch=Journey 电子游戏/, body: pages },
        {
          match: /gsrsearch=Journey$/,
          body: {
            query: {
              pages: {
                dodge: pages.query.pages.dodge,
              },
            },
          },
        },
        {
          match: /titles=Journey/,
          body: {
            query: {
              pages: {
                disambig: {
                  title: "Journey",
                  pageprops: { disambiguation: "" },
                  extract: "Journey可以指：\n旅行者合唱團，美國搖滾樂團\n風之旅人，2012年电子游戏",
                  ...noFreeImage,
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
      // 那台车必须被挡掉，正确的是游戏页
      expect(detail?.title ?? "").not.toContain("道奇");
      expect(detail?.title).toBe("風之旅人");
    });

    it("Journey：resolveOtherCover 也必须吃消歧页别名，否则漫画像 logo 当游戏封面", async () => {
      // 2026-10-02 迭代 3 线上实录（缩略图代数 bump 让缓存作废后第一次真回源）：
      // 连续 8 次 /api/posters/batch 都返
      //   500px-Zatsu_Tabi_That's_Journey_Logo.webp
      // 《隨興旅 -That's Journey-》是 2006 年日本漫画，与 2012 年游戏无关。
      // 根因是 resolveOtherCover 调 resolveOtherPages 时没把「精确标题轮的消歧页
      // 自列名单」传进去（otherDetail 一直传了），于是：
      //   · 风之旅人 —— 与 "Journey" 零字重合，缺别名时 titleMatchTier 判 tier0
      //     直接淘汰（真实条目拿不到别名 = 全池最靠后）
      //   · 剩下同池的《隨興旅 -That's Journey-》与《道奇Journey》都是 tier2，
      //     漫画像摘要更长、有封面，靠 0.5 分之差夺冠
      // 这条用例同时锁住「必须传 coverAliases」与「漫画像不许赢」两件事。
      const manga = {
        title: "隨興旅 -That's Journey-",
        pageprops: { page_image: "Zatsu_Tabi_That's_Journey_Logo.webp" },
        extract:
          "《隨興旅》（日語：ザSpecified That's Journey!）是 succession 於 2006 年發行的日本漫畫作品。",
      };
      const dodge = {
        title: "道奇Journey",
        pageprops: {},
        extract:
          "道奇Journey（官方中文名：道奇酷威）是一款由道奇品牌在2009至2020车型年间生产销售中型跨界SUV。",
      };
      const game = {
        title: "风之旅人",
        pageprops: { page_image: "Journey_PSN_Cover.png" },
        extract: "《风之旅人》（英文版名：Journey）是一款冒险类独立游戏，由thatgamecompany开发。",
      };
      const disambig = {
        query: {
          pages: {
            disambig: {
              title: "Journey",
              pageprops: { disambiguation: "" },
              extract: "Journey可以指：\n旅行者合唱團，美國搖滾樂團\n風之旅人，2012年电子游戏",
              ...noFreeImage,
            },
          },
        },
      };
      installFetch([
        // 精确标题轮：只有消歧页（与 otherDetail 同形状）
        { match: /titles=Journey/, body: disambig },
        // 纯标题轮把漫画像带回来（它 endsWith("journey")，标题层分不出是漫画）
        { match: /gsrsearch=Journey$/, body: { query: { pages: { manga, dodge } } } },
        // 类型词轮把真正的游戏页带回来（它零字面重合，只能靠这条 + 别名）
        {
          match: /gsrsearch=Journey 电子游戏/,
          body: { query: { pages: { game } } },
        },
        {
          match: /titles=File:Journey_PSN_Cover\.png/,
          body: {
            query: {
              pages: {
                file: {
                  title: "File:Journey PSN Cover.png",
                  imageinfo: [{ thumburl: `${UP}/2/2b/500px-Journey_PSN_Cover.png` }],
                },
              },
            },
          },
        },
      ]);
      const cover = await resolveOtherCover("Journey", "Journey", 2012);
      // 必须是游戏封面；漫画像 logo 与汽车都不许赢
      expect(cover ?? "").toContain("Journey_PSN_Cover");
      expect(cover ?? "").not.toContain("Zatsu_Tabi");
      expect(cover ?? "").not.toContain("Dodge");
    });

    it("原名被埋在标题末尾的别名页必须降档（隨興旅 vs Journey）", () => {
      // 线上实录（2026-10-02）：zh 维基有《隨興旅 -That's Journey-》，
      // 石坂ケンタ 2019 年连载的日本漫画，**与游戏无关**。compact 以 journey
      // 结尾，endsWith 成立拿到 tier2；而正确的《风之旅人》靠消歧页别名只到
      // tier1 —— tier 优先于分数（7 vs 5.5），漫画 logo 直接压过游戏封面。
      // isDescriptiveSuffix 只看 base 之后的**尾词**，对这一侧没设防。
      expect(titleMatchTier("journey", "隨興旅 -That's Journey-")).toBe(0);
      // 前缀里不含原名时仍是 tier2：中文本地化名不能被误杀
      // （集合啦！動物森友會 ⊃ 动物森友会，前缀「集合啦」不含原名）
      expect(titleMatchTier("动物森友会", "集合啦！動物森友會")).toBe(2);
      expect(titleMatchTier("inside", "Inside (遊戲)")).toBe(2);
      // 纯括号本地化名照旧
      expect(titleMatchTier("纪念碑谷", "紀念碑谷 (遊戲)")).toBe(2);
    });

    it("闸门不能反过来放行同前缀蹭词页（日常幻想 vs 日常幻想指南）", () => {
      // 直接验证分档：同前缀 + 描述性后缀必须落在被淘汰的一侧
      expect(titleMatchTier("日常幻想", "日常幻想指南")).toBe(0);
      expect(titleMatchTier("故事fm", "我們的故事 (專輯)")).toBe(0);
      expect(titleMatchTier("看理想", "勇者斗恶龙 (游戏)")).toBe(0);
      // 正常作品页仍要放行
      expect(titleMatchTier("纪念碑谷", "紀念碑谷 (遊戲)")).toBe(2);
      // 正作包住原名（本地化名）算作品页；角色页只在括号里蹭到，弱一档
      expect(titleMatchTier("动物森友会", "集合啦！動物森友會")).toBe(2);
      expect(titleMatchTier("动物森友会", "傑克 (動物森友會)")).toBe(1);
      // 消歧页自列的别名放行到 tier 1 而不是 2（仍需年份佐证）。
      // 别名要和 disambiguationAliases 的输出口径一致：已过 compactTitle
      // （简繁归一 + 去分隔符 + 小写），不是原始条目名。
      expect(titleMatchTier("journey", "風之旅人", ["风之旅人"])).toBe(1);
    });
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

// ===== 迭代 2/20（PLAN-JEV-DISAMBIGUATION）：结构化置信度 =====
// 出发点是 2026-10-02 的「分数不是置信度」：道奇Journey 6.5 与 風之旅人 5.5
// 相差 1 分，这一分却直接决定了用户看到汽车还是看到游戏。所以除了判决之外，
// 必须额外能回答「有多确定」。这些用例锁死的就是那条「不确定」的信号线。

describe("otherConfidence（结构化置信度）", () => {
  /** compactTitle 会做繁→简归一，别名必须按归一后的形态给（见下面的用例）。 */
  const candidate = (
    title: string,
    extract: string,
    score: number,
    tier: 0 | 1 | 2,
    extra: Partial<OtherCandidate> = {},
  ): OtherCandidate => ({ page: { title, extract }, score, tier, ...extra });

  it("没有冠军：weak / 0 分 / pickedTitle=null（而不是伪造一个 0.5）", () => {
    const confidence = otherConfidence([], null, "2014");
    expect(confidence.band).toBe("weak");
    expect(confidence.score).toBe(0);
    expect(confidence.pickedTitle).toBeNull();
    expect(confidence.evidence).toBe("none");
  });

  it("有候选但没选出冠军：仍然 weak（池子里没有可用项 ≠ 有信心）", () => {
    // hintRescued 且摘要不提年份 → usableForPick 全淘汰 → 没有冠军
    const ranked = [candidate("SCP基金会", "一个虚构组织。", 6.5, 1, { hintRescued: true })];
    const confidence = otherConfidence(ranked, null, "2017");
    expect(confidence.band).toBe("weak");
    expect(confidence.poolSize).toBe(0);
  });

  it("exact：tier2 + 字面证据 + 有年份佐证 + 领先幅度够（纪念碑谷形状）", () => {
    const ranked = [
      candidate("紀念碑谷 (遊戲)", "《紀念碑谷》是一款2014年推出的益智解謎類遊戲。", 13.5, 2),
      candidate("紀念碑谷2", "《紀念碑谷2》是一款2017年推出的續作遊戲。", 9.5, 2),
    ];
    const confidence = otherConfidence(ranked, ranked[0], "2014");
    expect(confidence.band).toBe("exact");
    expect(confidence.evidence).toBe("literal");
    expect(confidence.margin).toBeGreaterThan(0.3);
    expect(confidence.pickedTitle).toBe("紀念碑谷 (遊戲)");
    expect(confidence.poolSize).toBe(2);
  });

  it("strong：同样字面证据但领先幅度不足（同档势均力敌，得让用户看一眼）", () => {
    // 两条都 tier2 分差 1 分 / span 12 → margin≈0.083，低于 exact 的 0.05 线之上但需区分：
    // 造一个分差 < 0.6 的场景：margin = 0.04 < 0.05 → strong
    const ranked = [
      candidate("紀念碑谷 (遊戲)", "《紀念碑谷》是一款2014年推出的益智解謎類遊戲。", 13.5, 2),
      candidate("紀念碑谷2", "《紀念碑谷2》是一款2014年推出的續作遊戲。", 13.1, 2),
    ];
    const confidence = otherConfidence(ranked, ranked[0], "2014");
    expect(confidence.band).toBe("strong");
    expect(confidence.margin).toBeLessThan(0.05);
  });

  it("shaky：靠消歧页别名救回来的（Journey → 風之旅人 是 alias 不是 literal）", () => {
    const ranked = [
      candidate("風之旅人", "《風之旅人》是一款2012年推出的冒險類獨立遊戲。", 5.5, 1),
      candidate("Thatgamecompany", "一家獨立遊戲工作室，作品包括 Journey。", 3.5, 1),
    ];
    // 别名比对走 compactTitle（含繁→简），所以传的是归一后的「风之旅人」
    const confidence = otherConfidence(ranked, ranked[0], "2012", ["风之旅人"]);
    expect(confidence.evidence).toBe("alias");
    expect(confidence.band).toBe("shaky");
    // alias 证据权重 0.6 → 0.45*0.6 + 0.35*margin + 0.2*1
    expect(confidence.score).toBeGreaterThan(0.4);
    expect(confidence.score).toBeLessThan(0.8);
  });

  it("别名给的是繁体原名时也算命中（compactTitle 两侧都归一，不该要求调用方手工转简）", () => {
    const ranked = [
      candidate("風之旅人", "《風之旅人》是一款2012年推出的冒險類獨立遊戲。", 5.5, 1),
    ];
    expect(otherConfidence(ranked, ranked[0], "2012", ["風之旅人"]).evidence).toBe("alias");
    expect(otherConfidence(ranked, ranked[0], "2012", ["风之旅人"]).evidence).toBe("alias");
  });

  it("hint：只靠类型词轮救回来、零字面证据的候选永远不是 shaky（最多 weak）", () => {
    const ranked = [
      candidate("SCP基金会", "《风之旅人》是一款2017年推出的冒險類獨立遊戲。", 9.5, 1, {
        hintRescued: true,
      }),
      candidate("SCP基金会2", "另一段够长的摘要文字凑长度。", 4.5, 1),
    ];
    const confidence = otherConfidence(ranked, ranked[0], "2017");
    expect(confidence.evidence).toBe("hint");
    expect(confidence.band).toBe("weak");
  });

  it("年份不佐证降档：tier2 字面证据但摘要没提用户年份 → 不给 exact", () => {
    const ranked = [
      candidate("紀念碑谷 (遊戲)", "《紀念碑谷》是一款益智解謎類遊戲。", 13.5, 2),
      candidate("紀念碑谷2", "《紀念碑谷2》是一款益智解謎類遊戲。", 3.5, 2),
    ];
    const confidence = otherConfidence(ranked, ranked[0], "2014");
    expect(confidence.evidence).toBe("literal");
    // 权重里年份项 0.2 直接丢掉
    expect(confidence.band).not.toBe("exact");
    expect(confidence.band).not.toBe("strong");
    expect(confidence.band).toBe("weak");
  });

  it("不给年份时不惩罚年份项（score 不因缺年份缩水）", () => {
    const ranked = [candidate("蒙娜丽莎", "《蒙娜丽莎》是一幅油画。", 11.5, 2)];
    const withYear = otherConfidence(ranked, ranked[0], undefined);
    const expectBand = withYear.band;
    expect(expectBand).toBe("exact");
    expect(withYear.score).toBeCloseTo(1, 5);
  });

  it("hintRescued 且不给年份 → 没有可用冠军，margin 记 0（不给年份就无法自证）", () => {
    // usableForPick 要求 hintRescued 自证年份；不给年份时 usable 为空 →
    // 报 weak，而不是「margin 满幅 = 很确信」这种把不确定说成确定的假信号。
    const ranked = [candidate("林更新", "中国内地男演员。", 5.5, 1, { hintRescued: true })];
    const confidence = otherConfidence(ranked, ranked[0], undefined);
    expect(confidence.band).toBe("weak");
    expect(confidence.evidence).toBe("none");
    expect(confidence.margin).toBe(0);
  });

  it("池里只有一条可用冠军 → margin 记满 1（无对手时不该装作不确定）", () => {
    const ranked = [candidate("蒙娜丽莎", "《蒙娜丽莎》是一幅油画。", 5.5, 2)];
    const confidence = otherConfidence(ranked, ranked[0], undefined);
    expect(confidence.margin).toBe(1);
    expect(confidence.band).toBe("exact");
  });
});

describe("otherCandidateReport（候选池诊断）", () => {
  it("纪念碑谷 2014：报告说 exact、冠军就是紀念碑谷 (遊戲)", async () => {
    installFetch([
      {
        match: /gsrsearch=纪念碑谷/,
        body: {
          query: {
            pages: {
              game: {
                title: "紀念碑谷 (遊戲)",
                pageprops: { page_image: "Monument_Valley_icon_unrounded.jpg" },
                extract: "《紀念碑谷》是一款2014年推出的空间解謎類手機遊戲。",
              },
              geo: {
                title: "紀念碑谷",
                pageprops: {},
                extract: "紀念碑谷是美國亞利桑那州的一處地質構造。",
              },
            },
          },
        },
      },
      { match: /titles=紀念碑谷/, body: { query: { pages: {} } } },
    ]);
    const report = await otherCandidateReport("纪念碑谷", "纪念碑谷", 2014);
    expect(report.picked).toBe("紀念碑谷 (遊戲)");
    expect(report.confidence.band).toBe("exact");
    expect(report.lang).toBe("zh");
    expect(report.candidates[0].title).toBe("紀念碑谷 (遊戲)");
    expect(report.candidates[0].hasCover).toBe(true);
    expect(report.candidates[0].year).toBe("2014");
  });

  it("线上实测：已修好的 Journey 报告 alias/shaky，不是被误判成 hint/weak", async () => {
    // 2026-10-02 线上 /api/other/candidates?name=Journey&year=2012 实录：
    // picked=风之旅人 但 evidence=hint/band=weak——判决是对的，诊断端点却说没信心。
    // 根因：風之旅人 同样带 hintRescued（它是被「Journey 电子游戏」轮返回来的，
    // 标题零重合），而 evidenceOf 先看 hintRescued 就返回 hint，从没查过别名表。
    // 修法：tier1 先查别名表再退到 hint。
    installFetch([
      {
        match: /gsrsearch=Journey 电子游戏/,
        body: {
          query: {
            pages: {
              // 消歧页与两款同名作品在**同一个搜索池**里返回：线上就是这样，
              // disambiguationAliases 要从同一批 pages 里读出「风之旅人」这份名单。
              disambig: {
                title: "Journey",
                pageprops: { disambiguation: "" },
                extract: "Journey可以指：\n旅行者合唱團，美國搖滾樂團\n風之旅人，2012年电子游戏",
              },
              game: {
                title: "風之旅人",
                pageprops: {},
                extract: "《風之旅人》（英文版名：Journey）是一款2012年推出的冒險類獨立遊戲。",
              },
              dodge: {
                title: "道奇Journey",
                pageprops: {},
                extract: "道奇Journey是克莱斯勒品牌旗下的一款中型SUV。",
              },
            },
          },
        },
      },
      { match: /gsrsearch=Journey$/, body: { query: { pages: {} } } },
    ]);
    const report = await otherCandidateReport("Journey", "journey", 2012);
    expect(report.picked).toBe("風之旅人");
    expect(report.confidence.evidence).toBe("alias");
    expect(report.confidence.band).toBe("shaky");
    // 道奇Journey 的 compact 自己就含「journey」——它被放进 tier1 是因为
    // declaresWorkTopic 降档（摘要说它是 SUV，不是作品），但它的证据来源仍是
    // 字面文本，不是我们从消歧页找回来的，所以是 literal 而非 hint。
    const dodge = report.candidates.find((entry) => entry.title === "道奇Journey");
    expect(dodge?.evidence).toBe("literal");
    expect(dodge?.tier).toBe(1);
  });

  it("空标题：返回空报告而不是去打维基", async () => {
    const report = await otherCandidateReport("", "");
    expect(report.candidates).toEqual([]);
    expect(report.picked).toBeNull();
    expect(report.confidence.band).toBe("weak");
    expect(report.lang).toBeNull();
  });
});

describe("上游降级信号（逐条记账 PLAN-WIKI-DEGRADED-SCOPE）", () => {
  /** 上游确实答复了「没有这个条目」——不是故障，该记 ok 不该记 failed。 */
  function installStatusFetch(status: number | "throw"): void {
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => {
        if (status === "throw") throw new Error("connection reset");
        return new Response("{}", { status, headers: { "content-type": "application/json" } });
      }),
    );
  }

  it("httpJson 200 但无结果：算 ok（上游明确答复没有图）⇒ absent", async () => {
    installFetch([{ match: /./, body: { query: { pages: {} } } }]);
    const probe = newWikiProbe();
    await resolveOtherCover("不存在的条目", "no such thing", 1999, probe);
    expect(probe.ok).toBeGreaterThan(0);
    expect(probe.failed).toBe(0);
    expect(wikiProbeVerdict(probe)).toBe("absent");
  });

  it("上游 429：记 failed ⇒ throttled，避免空结果被 24 小时负缓存固化", async () => {
    installStatusFetch(429);
    const probe = newWikiProbe();
    await resolveOtherCover("纪念碑谷", "纪念碑谷", 2014, probe);
    expect(probe.failed).toBeGreaterThan(0);
    expect(probe.ok).toBe(0);
    expect(wikiProbeVerdict(probe)).toBe("throttled");
  });

  it("上游 503：记 failed ⇒ throttled", async () => {
    installStatusFetch(503);
    const probe = newWikiProbe();
    await resolveOtherCover("纪念碑谷", "纪念碑谷", 2014, probe);
    expect(wikiProbeVerdict(probe)).toBe("throttled");
  });

  it("连接被重置（throw）：记 failed ⇒ throttled——线上 8 次连打有 4 次是这种", async () => {
    installStatusFetch("throw");
    const probe = newWikiProbe();
    await resolveOtherCover("纪念碑谷", "纪念碑谷", 2014, probe);
    expect(wikiProbeVerdict(probe)).toBe("throttled");
  });

  it("上游 404（明确答复）：算 ok ⇒ absent——不能把明确答复当故障", async () => {
    installStatusFetch(404);
    const probe = newWikiProbe();
    await resolveOtherCover("纪念碑谷", "纪念碑谷", 2014, probe);
    expect(probe.ok).toBeGreaterThan(0);
    expect(probe.failed).toBe(0);
    expect(wikiProbeVerdict(probe)).toBe("absent");
  });

  it("**本轮核心语义**：有过一次成功就抵消之前的全部失败 ⇒ absent", async () => {
    // 线上实测过「第 1 档成功、第 5 档超时」的长链；以「一次成功为准」才不会
    // 把已经用掉的答复作废。反向判据（以最后一次为准）在这里会得 throttled。
    expect(wikiProbeVerdict({ ok: 1, failed: 5 })).toBe("absent");
    expect(wikiProbeVerdict({ ok: 0, failed: 5 })).toBe("throttled");
  });

  it("一次都没问到 ⇒ throttled（哪怕只发了一次请求）", () => {
    expect(wikiProbeVerdict({ ok: 0, failed: 0 })).toBe("throttled");
    expect(wikiProbeVerdict({ ok: 0, failed: 1 })).toBe("throttled");
  });

  it("**并发不串味**：一条全失败 + 一条全成功，两个独立探针各判各的", async () => {
    // 这条是线上 F1（分类随批次大小改变）的离线版：两个 resolveOtherCover
    // 真的并发跑、各拿各的探针。旧的模块级全局在这里必然串味。
    // 两个坑都是我先写出来才发现的：
    // ① 路由**不能按调用次序**——两条链交错，「第 N 次调用」会让它们互相
    //    吃到对方的响应；
    // ② 路由**不能只靠中文标题**——en 轮的 query 走的是 english 参数，
    //    URL 里根本不含中文标题，于是「全失败」这一侧会混进 200 答复、
    //    探针被记成 ok。所以让 title == english（ASCII），
    //    这样**这条链发出去的每一个 URL 都带标记**。
    vi.stubGlobal(
      "fetch",
      vi.fn(async (input: string) => {
        const url = decodeURIComponent(String(input));
        if (url.includes("probe-fail-side")) return new Response("{}", { status: 503 });
        return new Response(JSON.stringify({ query: { pages: {} } }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }),
    );
    const probeA = newWikiProbe();
    const probeB = newWikiProbe();
    await Promise.all([
      resolveOtherCover("probe-fail-side", "probe-fail-side", 1999, probeA),
      resolveOtherCover("probe-ok-side", "probe-ok-side", 1999, probeB),
    ]);
    expect(probeA.failed).toBeGreaterThan(0);
    expect(probeA.ok).toBe(0);
    expect(wikiProbeVerdict(probeA)).toBe("throttled");
    expect(probeB.failed).toBe(0);
    expect(wikiProbeVerdict(probeB)).toBe("absent");
  });

  it("诊断端点不污染判决：otherCandidateReport 用完即弃自己的探针", async () => {
    installFetch([{ match: /./, body: { query: { pages: {} } } }]);
    await otherCandidateReport("纪念碑谷", "纪念碑谷", 2014);
    // 旧实现里这一行会把模块级 wikiDegraded 置位/复位，从而改变后面海报的
    // 判决；新实现下诊断与判决之间没有任何共享状态可污染。
    const probe = newWikiProbe();
    await resolveOtherCover("纪念碑谷", "纪念碑谷", 2014, probe);
    expect(wikiProbeVerdict(probe)).toBe("absent");
  });

  it("默认参数自给探针：不传也能跑（诊断端点 worker/index.ts 零改动）", async () => {
    installFetch([{ match: /./, body: { query: { pages: {} } } }]);
    await expect(resolveOtherCover("纪念碑谷", "纪念碑谷", 2014)).resolves.toBeNull();
    await expect(otherSearch("动物森友会")).resolves.toBeDefined();
  });
});

// ===== 上游降级信号：作用域回归（PLAN-WIKI-DEGRADED-SCOPE tripwire） =====
// 模块级 wikiDegraded 是本轮移除的对象：它在 Cloudflare 同一 isolate 内被并发
// 批次共享，导致「同一个确实不存在的条目，单发 absent / 同批 throttled」。
// 下面三条是防回归锁：这几个符号一旦复活，绊线必红。
describe("降级信号作用域（PLAN-WIKI-DEGRADED-SCOPE tripwire）", () => {
  const source = readFileSync(new URL("./other.ts", import.meta.url), "utf8");
  const mediaSource = readFileSync(new URL("./media.ts", import.meta.url), "utf8");
  // 先剥注释再扫：解释性注释里会引用旧名字（迁移说明），那是给人看的不是代码
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\n]*\/\/.*$/gm, "");
  const mediaCode = mediaSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\n]*\/\/.*$/gm, "");

  it("模块级 wikiDegraded 全局布尔不再存在", () => {
    expect(code).not.toMatch(/let\s+wikiDegraded\b/);
    expect(code).not.toMatch(/export function resetWikiDegraded/);
    expect(code).not.toMatch(/export function wikiWasDegraded/);
    expect(code).not.toMatch(/export function noteWikiDegraded/);
  });

  it("media.ts 不再读全局降级标记，改用逐条探针的判决", () => {
    expect(mediaCode).not.toMatch(/resetWikiDegraded|wikiWasDegraded|noteWikiDegraded/);
    expect(mediaCode).toMatch(/const probe = newWikiProbe\(\);/);
    expect(mediaCode).toMatch(/wikiProbeVerdict\(probe\)/);
  });

  it("判据方向是「有过一次答复 ⇒ absent」而不是「有过失败 ⇒ throttled」", () => {
    const verdict = source.match(
      /export function wikiProbeVerdict\(probe: WikiProbe\): "absent" \| "throttled" \{\s*return ([^;]+);/,
    );
    expect(verdict, "找不到 wikiProbeVerdict 的返回表达式").toBeTruthy();
    // 源码里用的是双引号，别在断言里写单引号（prettier 不会改字符串内容）
    expect(verdict![1].replace(/\s/g, "")).toBe('probe.ok>0?"absent":"throttled"');
  });

  it("**每一处维基请求都记账**（计划风险 R1：漏传 probe = 那一档的失败不算数）", () => {
    // wikiJson 的每一个调用点都必须把 probe 传下去。计数式断言：漏一处就少一个。
    // 基线 6 处（2026-10-02 迭代 10 从 5 增加到 6）：wikiFileThumbUrls /
    // wikiSearchOnce ×2 / wikiTitlePages / wikiEnTitle / wikiPageImageAny /
    // **fillArticleImageNames**（iter10 新增的「补 prop=images」查询——它是在
    // infobox 封面被判 artifact 后才发的那次，漏传 probe 的话，这次失败不计数，
    // 「上游超时」会被误判成「这一页没有别的图」）。
    // 硬编码 6 而不是「≥N」：将来有人**新增**一个 wikiJson 调用点却忘了传 probe 时，
    // 这条必须红。迭代 10 就是被它逼着显式记账的，不是顺手改的数字。
    const wikiJsonCalls = code.match(/await wikiJson\(/g) ?? [];
    const wikiJsonWithProbe = code.match(/await wikiJson\([^;]*?, probe\)/g) ?? [];
    expect(wikiJsonCalls).toHaveLength(6);
    expect(wikiJsonWithProbe).toHaveLength(wikiJsonCalls.length);
    // iter10 新增的那次查询必须记账，且只在 artifact 判定之后才发
    expect(code).toMatch(/prop: "images"/);
    expect(code).toMatch(/await wikiJson\(lang, q, 8000, probe\)/);
    // 判决链的四个出口必须接收调用方传进来的探针
    for (const call of [
      /resolveOtherCover\(title, english, year, probe\)/,
      /wikiEnTitle\(title, probe\)/,
      /wikiPageImageAny\("zh", title, prefer, probe\)/,
      /wikiPageImageAny\("en", enTitle, prefer, probe\)/,
    ]) {
      expect(mediaCode, `media.ts 的判决出口漏传 probe：${call}`).toMatch(call);
    }
    // 第 5 档自带 fetch，也必须记账（漏掉它 = 「前 4 档成功、第 5 档超时」被错判）
    expect(mediaCode).toMatch(/if \(probe\) \{[\s\S]*?probe\.ok\+\+;/);
    expect(mediaCode).toMatch(/probe\.failed\+\+;\s*else probe\.ok\+\+;/);
  });
});

// ===== 缩略图桶宽白名单（PLAN-THUMBNAIL-SIZING 迭代 3/20） =====
// 维基的缩略图只存在于固定桶宽，桶外一律 400 `Use thumbnail sizes listed on
// https://w.wiki/GHai`，经 /api/image 代理呈现为 502 →「封面随机消失」。
// 且官方语义是**向上**取桶：旧的 iiurlwidth:"600" 实际拿到 960px。
// 2026-10-02 经线上 /api/image 代理逐个实测 11 桶全部 200：
// 20px=0.7KB / 40px=1.4KB / 60px=2.5KB / 120px=7.2KB / 250px=26.6KB /
// 330px=46.5KB / 500px=114.6KB / 960px=505.2KB / 1280px=957.4KB /
// 1920px=2324.2KB / 3840px=9011.6KB。
const WIKI_BUCKETS = [20, 40, 60, 120, 250, 330, 500, 960, 1280, 1920, 3840];

describe("pickThumbBucket（维基缩略图桶宽）", () => {
  it("每个桶宽都能精确命中自己", () => {
    for (const bucket of WIKI_BUCKETS) {
      expect(pickThumbBucket(bucket)).toBe(bucket);
    }
  });

  it("非桶宽落在不超过它的最大桶（向下取，绝不向上白拿一档）", () => {
    expect(pickThumbBucket(1)).toBe(20);
    expect(pickThumbBucket(38)).toBe(20);
    expect(pickThumbBucket(119)).toBe(60);
    expect(pickThumbBucket(121)).toBe(120);
    expect(pickThumbBucket(200)).toBe(120);
    expect(pickThumbBucket(331)).toBe(330);
    expect(pickThumbBucket(501)).toBe(500);
    // 回归锁：旧的 600 因为向上取桶落到 960，这里必须仍是 500
    expect(pickThumbBucket(600)).toBe(500);
  });

  it("边界与非法输入不炸，也不静默放大", () => {
    expect(pickThumbBucket(0)).toBe(20);
    expect(pickThumbBucket(-5)).toBe(20);
    expect(pickThumbBucket(3840)).toBe(3840);
    expect(pickThumbBucket(99999)).toBe(3840);
    expect(pickThumbBucket(Number.NaN)).toBe(20);
    expect(pickThumbBucket(Number.POSITIVE_INFINITY)).toBe(20);
    expect(pickThumbBucket(Number.NEGATIVE_INFINITY)).toBe(20);
  });
});

describe("维基桶宽接线（PLAN-THUMBNAIL-SIZING tripwire）", () => {
  const source = readFileSync(new URL("./other.ts", import.meta.url), "utf8");

  it("桶表与官方 $wgThumbnailSteps 完全一致（含官方出处与抓取日期）", () => {
    const table = source.match(/const THUMB_BUCKETS = \[([^\]]+)\] as const;/);
    expect(table, "找不到 THUMB_BUCKETS 定义").toBeTruthy();
    const actual = table![1]
      .split(",")
      .map((part) => Number(part.trim()))
      .filter((n) => Number.isFinite(n));
    expect(actual).toEqual(WIKI_BUCKETS);
    expect(source).toContain("w.wiki/GHai");
    expect(source).toContain("$wgThumbnailSteps");
  });

  it("没有把上界偷偷改回 600（那会让 500 的论证失效）", () => {
    const width = source.match(/const OTHER_THUMB_MAX_WIDTH = (\d+);/);
    expect(width, "找不到 OTHER_THUMB_MAX_WIDTH 定义").toBeTruthy();
    expect(Number(width![1])).toBe(500);
  });

  it("不再出现字面量 iiurlwidth/pithumbsize（全部走 pickThumbBucket）", () => {
    // 注释里会引用旧字面量（"所以旧的 iiurlwidth:\"600\" 拿到的是 960px"），
    // 那是解释性文字不是代码，所以先剥掉注释再扫。
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\n]*\/\/.*$/gm, "");
    expect(code).not.toMatch(/iiurlwidth:\s*"/);
    expect(code).not.toMatch(/pithumbsize:\s*"/);
    const wired = code.match(/pickThumbBucket\(OTHER_THUMB_MAX_WIDTH\)/g) ?? [];
    // 三处：wikiFileThumbUrls 的 iiurlwidth + 两个 pithumbsize
    expect(wired).toHaveLength(3);
  });
});

// ===== 封面文件名判别（PLAN-COVER-ARTIFACT-FILTER 迭代 10/20） =====
// 旧代码把 SKIP 正则只用在 wikiPageImageAny 的 images 分支，而
// **优先级最高的 pageprops.page_image 直取完全无检查**——纪念碑谷 (游戏)
// 的 infobox 里填的就是 app 图标，于是被原样当封面发给用户。
// 下面五条是防回归锁：任何一条退回「无脑直取 page_image」，都必红。
describe("artifact 过滤的覆盖面（PLAN-COVER-ARTIFACT-FILTER tripwire）", () => {
  const source = readFileSync(new URL("./other.ts", import.meta.url), "utf8");
  const mediaSource = readFileSync(new URL("./media.ts", import.meta.url), "utf8");
  const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\n]*\/\/.*$/gm, "");
  const mediaCode = mediaSource.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[^\S\n]*\/\/.*$/gm, "");

  it("toWork：infobox 封面被判 artifact 时不采用（iter10 真正修 bug 的那处）", () => {
    // toWork 是 otherDetail 内部的取图口，media.ts:1727-1728 第一档就返回它，
    // **resolveOtherCover 根本没机会跑**。所以这一处漏判＝线上必然发错图。
    const toWork = code.match(/function toWork\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(toWork, "找不到 toWork 函数体").toBeTruthy();
    // 判据必须落在 infobox 分支上，而不是把整个 poster 判死
    expect(toWork).toMatch(
      /const infobox =\s*page\.fileUrl\s*&&\s*classifyArtworkFile\(pageImage\) === "artwork"\s*\?\s*page\.fileUrl\s*:\s*undefined;/,
    );
    // 兜底顺序：artwork 的 infobox → pageimages 缩略图 → original → **同页正文图**
    expect(toWork).toMatch(
      /let poster = \(infobox \?\? page\.thumbnail\?\.source \?\? page\.original\?\.source\)/,
    );
    // 第四档是 iter10 线上验收补的：那页既无 thumbnail 也无 original（app 图标
    // 是非自由文件 ⇒ pageimages 空），没有这一档就只是把「图标」换成「没有」。
    expect(toWork.replace(/\s+/g, " ")).toMatch(
      /if \(!poster\) \{ await fillArticleImageNames\(lang, \[\{ page, score: 0, tier: 0 \}\], probe\);/,
    );
    // 绝不接受「artifact 直接 return undefined/null」——那会把整条候选丢掉，
    // 比拿错图更糟（正确图就在同页 images 里）
    expect(toWork).not.toMatch(/classifyArtworkFile\([^)]*\)\s*!==\s*"artwork"[\s\S]*?return null/);
    // toWork 现在也发维基请求了，probe 必须由调用方传进来。
    // 三个调用点：otherSearch 的 Promise.all、otherDetail 的精确页、搜索页。
    // 用「去掉定义行后，剩下的 toWork( 调用必须都带 probe」来断言——
    // 别用 /await toWork\(/，它会漏掉 Promise.all 里那个，让「三处都传了」
    // 被误判成两处，测试自己撒谎（iter10 踩过）。
    const body = code.replace(
      /async function toWork\([\s\S]*?\n\): Promise<OtherWork \| null> \{/,
      "",
    );
    const toWorkCalls = body.match(/toWork\([^;]*?\)/g) ?? [];
    expect(toWorkCalls.length, "toWork 调用点数量").toBe(3);
    for (const call of toWorkCalls) {
      expect(call, `toWork 调用点漏传 probe：${call}`).toMatch(/, (?:detailProbe|probe)\)/);
    }
  });

  it("resolveOtherCover：page_image 直取那条路也装了判别（并继续往下走）", () => {
    expect(code).toMatch(
      /if \(file && entry\.page\.fileUrl && classifyArtworkFile\(file\) === "artwork"\)\s*return entry\.page\.fileUrl;/,
    );
    // 判掉之后不是 return null，而是付一次 prop=images 查询取同页正文图
    expect(code).toMatch(
      /if \(top\.some\(\(entry\) => !entry\.page\.fileUrl \|\| !isArtworkPageImage\(entry\.page\)\)\)/,
    );
    expect(code).toMatch(/await fillArticleImageNames\(lang, top, probe\);/);
    // 兜底只能落在已被 pickBest 确认的作品页上
    expect(code).toMatch(
      /for \(const name of articleNames\) \{\s*if \(!articleNameMatchesWork\(name, works\)\) continue;/,
    );
  });

  it("wikiPageImageAny：判掉 page_image 后**不 return null**，继续走 images 分支", () => {
    // 这是本轮最容易写错的地方：返回 null 会把纪念碑谷从「图标」变成「没图」，
    // 而真封面就在同页 images 里。断言必须钉住「没有 return null」。
    const fn = code.match(/export async function wikiPageImageAny\([\s\S]*?\n\}/)?.[0] ?? "";
    expect(fn, "找不到 wikiPageImageAny 函数体").toBeTruthy();
    const guarded = fn.indexOf('classifyArtworkFile(pageImage) === "artwork"');
    expect(guarded).toBeGreaterThan(-1);
    const after = fn.slice(guarded);
    expect(
      after.slice(0, after.indexOf("images")),
      "判掉 page_image 之后出现了 return null，真封面会被一起丢掉",
    ).not.toMatch(/return null/);
    // images 分支也改用同一把尺，不再维护第二套 SKIP 正则
    expect(code).not.toMatch(/const SKIP = \//);
  });

  it("media.ts 的评分链同样用这把尺（它是过滤器，不能因判 artifact 就丢候选）", () => {
    expect(mediaCode).toMatch(/classifyArtworkFile/);
    expect(mediaCode.replace(/\s+/g, " ")).toMatch(
      /const infobox = file && classifyArtworkFile\(file\) === "artwork" \? fileUrls\.get\(file\) : undefined;/,
    );
    expect(mediaCode).toMatch(/return infobox \?\? wikiImageUrl\(page\);/);
  });

  it("prop=images 只在 artifact 判定后发（page_image 正常的条目一次都不发）", () => {
    // 代价证据（计划 §1 F-11）：gsrsearch 加 prop=images 每轮 +2746 B，
    // 一条 other 最坏跑 4 轮 ⇒ +11 KB。所以它**不能**挂进常规查询。
    const wikiTitlePages = code.match(/async function wikiTitlePages\([\s\S]*?\n\}/)?.[0] ?? "";
    const wikiSearchOnce = code.match(/async function wikiSearchOnce\([\s\S]*?\n\}/)?.[0] ?? "";
    for (const [name, fn] of [
      ["wikiTitlePages", wikiTitlePages],
      ["wikiSearchOnce", wikiSearchOnce],
    ] as const) {
      expect(fn, `找不到 ${name} 函数体`).toBeTruthy();
      expect(fn, `${name} 把 prop=images 挂进了常规查询（会让每次查询 +2.7 KB）`).not.toMatch(
        /prop: "images"/,
      );
      expect(fn).toMatch(/prop: "extracts\|pageimages\|pageprops\|info"/);
    }
  });
});

// ===== 封面文件名判别（PLAN-COVER-ARTIFACT-FILTER） =====
// 判据只能是文件名，不能是宽高：2026-10-02 实测正确封面
// Animal_Crossing_New_Horizons.png 只有 248×402，比被误用的
// Monument_Valley_icon_unrounded.jpg（316×316）还窄；而正确封面带
// utm_content=thumbnail_unscaled 是常态，不构成「没缩放过」的证据。
describe("classifyArtworkFile（封面文件名判别）", () => {
  // 黑线：线上实录的**真封面**文件名一个都不能误判。列全 8 个，来源见计划 §1 F-6。
  const REAL_COVERS = [
    "Monument Valley screenshot.jpg",
    "Journey_PSN_Cover.png",
    "INSIDE_Cover.jpg",
    "Florence_Preview_Image.jpg",
    "500px-Mona_Lisa,_by_Leonardo_da_Vinci,_from_C2RMF_retouched.jpg",
    "Doubutsu_No_Mori_Boxart.jpg",
    "Monument Valley, Utah, USA (23611451292).jpg",
    "Animal_Crossing_New_Horizons.png",
  ];

  it("线上实录的 8 个真封面全部判为 artwork（误判=把真封面踢掉）", () => {
    for (const name of REAL_COVERS) {
      expect(classifyArtworkFile(name), name).toBe("artwork");
    }
  });

  it("线上实录的 artifact 全部判掉（app 图标 / 系列 logo / 维基 UI 素材）", () => {
    // 来源：纪念碑谷 (游戏) 与 紀念碑谷 两页 prop=images 的实测名
    for (const name of [
      "Monument_Valley_icon_unrounded.jpg",
      "OOjs UI icon edit-ltr-progressive.svg",
      "Zh conversion icon m.svg",
      "Star full.svg",
      "Monument Valley logo.svg",
      "Monument Valley 3 logotype.svg",
      "Pillars of Eternity logo.png",
      "Nier, logo.jpg",
      "Monument Valley icon unrounded.jpg",
    ]) {
      expect(classifyArtworkFile(name), name).toBe("artifact");
    }
  });

  it("已知漏网（诚实记账）：带模板名的 .svg 图标本尺按名抓不到，且有意不收", () => {
    // 纪念碑谷 (游戏) 那页 images 里剩下的三个 svg——Crystal Clear app package
    // games / Future film2 / Symbol support vote ——都是 2010 年代那套条目类型
    // 模板图标（32px 拼接图），文件名**不共享** icon/logo/star 之外的任何
    // 特征词，所以纯按文件名判必然漏。（同页的 `Star full.svg` 是例外，
    // 它由 star full/empty/half 那条词命中，所以归在上面的判掉用例里。）
    // 本轮刻意不加 `template`/`film2`/`support vote` 这类词：commons 上没有
    // 作品封面叫这个，加它只会让正则更长而不改变任何真实结果。
    // 真正的兜底在调用点，不在正则里：
    //  ① articleImageNames 按 /\.(jpe?g|png)$/i 过滤 —— **svg 一律进不来**，
    //     所以它们永远到不了「选封面」这一步（上面四个全是 svg）；
    //  ② page_image 侧实测两页都不是此类（一个是 app 图标已被 icon 词抓到，
    //     另一个空）。
    // 记在这里是为了将来有人翻到这批名字时知道这是**有意不收**。
    for (const name of [
      "Crystal Clear app package games.svg",
      "Future film2.svg",
      "Symbol support vote.svg",
    ]) {
      expect(classifyArtworkFile(name), name).toBe("artwork");
    }
  });

  it("分隔符含扩展名点与逗号：logotype.svg / logo.png 这类带后缀的也判掉", () => {
    // 踩坑记录：分隔符类里**漏了 `.` 和 `,`**，于是
    // 「Monument Valley 3 logotype.svg」因为 logotype 后面跟的是 `.`
    // 而逃过判定 —— 正是本轮要抓的那类 Series logo。
    // 补 `.` `,` `:` `;` `&` 后重跑本用例。
    expect(classifyArtworkFile("Monument Valley 3 logotype.svg")).toBe("artifact");
    expect(classifyArtworkFile("Pillars of Eternity logo.png")).toBe("artifact");
    expect(classifyArtworkFile("Nier, logo.jpg")).toBe("artifact");
  });

  it("「icon」只在词边界命中（不误伤 Iconic / Iconf 这类真标题）", () => {
    for (const name of ["Iconic.jpg", "Iconf.png", "Monica.png", "Icons_of_Hope.jpg"]) {
      expect(classifyArtworkFile(name), name).toBe("artwork");
    }
    // 「icon」按分隔符两侧成词判定。取舍：`Icon Man.jpg`（Albert Watson
    // 1968 摄影系列）会被判 artifact，而 `Monument Valley icon unrounded.jpg`
    // 这类「作品名 icon 修饰词」在 Commons 上远比前者常见。选多数。
    // 判错的代价不对称：误判 artifact ⇒ 少一张候选封面；
    // 误判 artwork ⇒ 把 app 图标当封面发给用户（这正是 iter10 要修的 bug）。
    expect(classifyArtworkFile("Icon Man.jpg")).toBe("artifact");
    expect(classifyArtworkFile("Monument Valley icon unrounded.jpg")).toBe("artifact");
  });

  it("「edit-」只命中编辑界面素材（不误伤 Edited / Editor）", () => {
    for (const name of ["Edited_Cover.jpg", "Editor's_Cut.jpg", "Edit.png"]) {
      expect(classifyArtworkFile(name), name).toBe("artwork");
    }
    expect(classifyArtworkFile("OOjs UI icon edit-ltr-progressive.svg")).toBe("artifact");
    expect(classifyArtworkFile("edit-marker.jpg")).toBe("artifact");
  });

  it("「edit」必须带词首边界（Credit roll 这类正文文件名里的子串不算）", () => {
    // 无边界的 `edit[-_ ]` 会把 "Credit " 里的子串也判成 artifact——
    // 正文里合法存在的文件名被误杀，整链从「有图」退化成「无图」。
    for (const name of ["Credit roll.jpg", "Credit_Roll.png", "Unedited take.jpg"]) {
      expect(classifyArtworkFile(name), name).toBe("artwork");
    }
    // 词首是分隔符的编辑素材照判（维基 UI 图标族）
    expect(classifyArtworkFile("Pencil_edit_small.jpg")).toBe("artifact");
    expect(classifyArtworkFile("Toolbar_edit-rtl.svg")).toBe("artifact");
  });
});
