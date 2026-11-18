import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from "react";
import { englishKinds, mediaLabels, type Locale, type MediaKind } from "../data/mediaKinds";
import { useRouter, type View } from "../lib/useRouter";

export interface AppEnvValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (zh: string, en: string) => string;
  label: (kind: MediaKind) => string;
  notice: string;
  hasNotice: boolean;
  setNotice: (notice: string) => void;
  dismissNotice: () => void;
  view: View;
  setView: (next: View) => void;
  navigateTo: (nextViewOrPlaza: string) => void;
  plazaPostId: number;
}

const AppEnvContext = createContext<AppEnvValue | null>(null);

export function AppEnvProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() =>
    new URLSearchParams(location.search).get("lang") === "en" ? "en" : "zh",
  );
  // toast 队列：后到的通知排在后面，避免互相顶掉（最多保留 5 条）
  const [noticeQueue, setNoticeQueue] = useState<string[]>([]);
  const notice = noticeQueue[0] ?? "";
  const setNotice = useCallback((n: string) => {
    if (!n) {
      setNoticeQueue([]);
      return;
    }
    setNoticeQueue((q) => [...q, n].slice(-5));
  }, []);
  const dismissNotice = useCallback(() => {
    setNoticeQueue((q) => q.slice(1));
  }, []);
  useEffect(() => {
    if (!noticeQueue.length) return;
    const timer = setTimeout(() => setNoticeQueue((q) => q.slice(1)), 4000);
    return () => clearTimeout(timer);
  }, [noticeQueue]);

  const { view, setView, plazaPostId, navigateTo } = useRouter();

  const t = useCallback((zh: string, en: string) => (locale === "zh" ? zh : en), [locale]);
  const label = useCallback(
    (kind: MediaKind) => (locale === "zh" ? mediaLabels[kind].label : englishKinds[kind]),
    [locale],
  );

  const value = useMemo<AppEnvValue>(
    () => ({
      locale,
      setLocale,
      t,
      label,
      notice,
      hasNotice: noticeQueue.length > 0,
      setNotice,
      dismissNotice,
      view,
      setView,
      navigateTo,
      plazaPostId,
    }),
    [
      locale,
      t,
      label,
      notice,
      noticeQueue.length,
      setNotice,
      dismissNotice,
      view,
      setView,
      navigateTo,
      plazaPostId,
    ],
  );

  return <AppEnvContext.Provider value={value}>{children}</AppEnvContext.Provider>;
}

export function useAppEnv(): AppEnvValue {
  const ctx = useContext(AppEnvContext);
  if (!ctx) throw new Error("useAppEnv must be used inside AppEnvProvider");
  return ctx;
}
