import { useState, useEffect } from "react";
import { flushSync } from "react-dom";

export type View =
  | "home"
  | "source"
  | "setup"
  | "sorting"
  | "profile"
  | "compare"
  | "depth"
  | "share"
  | "plaza"
  | "plazaPost";

const VIEW_PATH: Record<View, string> = {
  home: "/",
  source: "/catalog/source",
  setup: "/catalog/setup",
  sorting: "/catalog/sorting",
  profile: "/myself",
  compare: "/encounter",
  // S3 新增：深度比较页（只增不改，旧 /encounter 完全不动）。
  depth: "/depth",
  share: "/share",
  plaza: "/plaza",
  plazaPost: "/plaza/0",
};

const VIEW_TITLE: Record<View, string> = {
  home: "ART/RANK · 我的艺术人格",
  source: "选择来源 · ART/RANK",
  setup: "配置排序 · ART/RANK",
  sorting: "1v1 排序中 · ART/RANK",
  profile: "我的文化索引 · ART/RANK",
  compare: "相遇比较 · ART/RANK",
  depth: "深度比较 · ART/RANK",
  share: "分享榜单 · ART/RANK",
  plaza: "广场 · ART/RANK",
  plazaPost: "广场帖子 · ART/RANK",
};
export function pathToView(p: string): View | null {
  const clean = p.replace(/\/+$/, "") || "/";
  if (clean.startsWith("/share")) return "share";
  if (/^\/plaza\/\d+/.test(clean)) return "plazaPost";
  if (clean === "/plaza") return "plaza";
  return (Object.entries(VIEW_PATH) as [View, string][]).find(([, v]) => clean === v)?.[0] ?? null;
}

/**
 * 视图切换用 View Transitions API 做跨视图过渡（现代浏览器的原生能力，
 * 纯增量：不支持时退回瞬间切换，视觉零回归）。过渡的样式只在 `.view-`
 * 作用域里定义，`:root` 的 `::view-transition-old/new(*)` 只做极薄的交叉溶解，
 * 不碰任何布局。`prefers-reduced-motion` 由 styles.css 头部的全局规则熔断。
 * 失败不外抛：View Transition 只是装饰，导航本身必须照旧完成。
 */
function withViewTransition(render: () => void) {
  // 过渡样式只写在 `:root:not([data-theme])` 下（现代主题）。其他主题直接
  // 同步切换，避免原生交叉溶解盖掉它们自己的换页效果。
  if (typeof document === "undefined" || document.documentElement.hasAttribute("data-theme")) {
    render();
    return;
  }
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (typeof doc.startViewTransition !== "function") {
    render();
    return;
  }
  try {
    // React 的 setState 是异步提交的：不在回调里同步刷新的话，浏览器拍到的
    // “新”快照仍是旧界面，过渡会变成一次无变化的空转。
    doc.startViewTransition(() => {
      flushSync(render);
    });
  } catch {
    render();
  }
}

export function useRouter() {
  const [view, setView] = useState<View>("home");
  const [plazaPostId, setPlazaPostId] = useState<number>(0);

  function navigateTo(nextViewOrPlaza: View | string) {
    const nextView =
      typeof nextViewOrPlaza === "string" && nextViewOrPlaza.startsWith("plazaPost:")
        ? ("plazaPost" as View)
        : (nextViewOrPlaza as View);
    if (nextView === "plazaPost" && typeof nextViewOrPlaza === "string") {
      const id = Number(nextViewOrPlaza.split(":")[1]) || 0;
      setPlazaPostId(id);
      withViewTransition(() => setView("plazaPost"));
      const lang = new URLSearchParams(location.search).get("lang");
      const qs = lang ? `?lang=${lang}` : "";
      history.pushState({ view: "plazaPost" }, "", `/plaza/${id}${qs}`);
      return;
    }
    withViewTransition(() => setView(nextView));
    const lang = new URLSearchParams(location.search).get("lang");
    const qs = lang ? `?lang=${lang}` : "";
    history.pushState({ view: nextView }, "", VIEW_PATH[nextView] + qs);
  }

  useEffect(() => {
    const initialView = pathToView(location.pathname);
    if (initialView) {
      setView(initialView);
      if (initialView === "plazaPost") {
        const match = location.pathname.match(/^\/plaza\/(\d+)/);
        if (match) setPlazaPostId(Number(match[1]));
      }
    }
  }, []);

  useEffect(() => {
    function onPopState() {
      const v = pathToView(location.pathname);
      if (v) {
        withViewTransition(() => setView(v));
        if (v === "plazaPost") {
          const match = location.pathname.match(/^\/plaza\/(\d+)/);
          if (match) setPlazaPostId(Number(match[1]));
        }
      } else withViewTransition(() => setView("home"));
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    // 换页回顶不用 smooth（眩晕且与全局 scroll-behavior 叠加），标题与主区焦点同步更新供读屏播报。
    window.scrollTo({ top: 0, behavior: "auto" });
    try {
      document.title = VIEW_TITLE[view] ?? VIEW_TITLE.home;
      const main = document.querySelector("main");
      if (main instanceof HTMLElement) {
        if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
        main.focus({ preventScroll: true });
      }
    } catch {
      /* 非浏览器环境（单测）忽略 */
    }
  }, [view]);

  return { view, setView, navigateTo, plazaPostId };
}
