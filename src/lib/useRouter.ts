import { useState, useEffect, useRef } from "react";

export type View =
  "home" | "source" | "setup" | "sorting" | "profile" | "compare" | "share" | "plaza" | "plazaPost";

const VIEW_PATH: Record<View, string> = {
  home: "/",
  source: "/catalog/source",
  setup: "/catalog/setup",
  sorting: "/catalog/sorting",
  profile: "/myself",
  compare: "/encounter",
  share: "/share",
  plaza: "/plaza",
  plazaPost: "/plaza/0",
};

export function pathToView(p: string): View | null {
  const clean = p.replace(/\/+$/, "") || "/";
  if (clean.startsWith("/share")) return "share";
  if (/^\/plaza\/\d+/.test(clean)) return "plazaPost";
  if (clean === "/plaza") return "plaza";
  return (Object.entries(VIEW_PATH) as [View, string][]).find(([, v]) => clean === v)?.[0] ?? null;
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
      setView("plazaPost");
      const lang = new URLSearchParams(location.search).get("lang");
      const qs = lang ? `?lang=${lang}` : "";
      history.pushState({ view: "plazaPost" }, "", `/plaza/${id}${qs}`);
      return;
    }
    setView(nextView);
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
        setView(v);
        if (v === "plazaPost") {
          const match = location.pathname.match(/^\/plaza\/(\d+)/);
          if (match) setPlazaPostId(Number(match[1]));
        }
      } else setView("home");
    }
    window.addEventListener("popstate", onPopState);
    return () => window.removeEventListener("popstate", onPopState);
  }, []);

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: "smooth" });
  }, [view]);

  return { view, setView, navigateTo, plazaPostId };
}
