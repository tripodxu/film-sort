/**
 * 浏览器 localStorage 持久化键名与会话清理的唯一真相。
 */
export const LIBRARY_KEY = "art-rank:library:v2";
export const RECOVERY_KEY = `${LIBRARY_KEY}:recovery`;
export const DRAFT_KEY = "art-rank:draft:v2";
export const PEER_KEY = "art-rank:peer:v2";
export const NOTES_KEY = "art-rank:notes";
export const PLAZA_LINKS_KEY = "art-rank:plaza-links";
export const ACCOUNT_TOKEN_KEY = "art-rank:account-token";
export const SESSION_KEY = "art-rank:session:v1";
export const PROFILE_PREFIX = "art-rank:profile:";
export const COLS_KEY = "art-rank:cols";
export const IMPORT_CAP_KEY = "art-rank:import-cap";
export const PLAZA_COLS_KEY = "art-rank:plaza-cols";
export const COMPARE_LEVEL_KEY = "art-rank:compare-level";
export const RINGS_LAYOUT_KEY = "art-rank:rings-layout";
export const GUIDE_DISMISSED_KEY = "art-rank:guide-dismissed";
export const RANK_MODE_KEY = "art-rank:rank-mode";
export const LAYOUT_KEY = "art-rank:layout";
export const THEME_KEY = "art-rank:theme";
export const CUSTOM_THEME_KEY = "art-rank:custom-themes";
export const ORB_EFFECT_KEY = "art-rank:orb-effect";

export const STORAGE_KEYS = {
  library: LIBRARY_KEY,
  recovery: RECOVERY_KEY,
  draft: DRAFT_KEY,
  peer: PEER_KEY,
  notes: NOTES_KEY,
  plazaLinks: PLAZA_LINKS_KEY,
  accountToken: ACCOUNT_TOKEN_KEY,
  session: SESSION_KEY,
  profilePrefix: PROFILE_PREFIX,
  cols: COLS_KEY,
  importCap: IMPORT_CAP_KEY,
  plazaCols: PLAZA_COLS_KEY,
  compareLevel: COMPARE_LEVEL_KEY,
  ringsLayout: RINGS_LAYOUT_KEY,
  guideDismissed: GUIDE_DISMISSED_KEY,
  rankMode: RANK_MODE_KEY,
  layout: LAYOUT_KEY,
  theme: THEME_KEY,
  customThemes: CUSTOM_THEME_KEY,
  orbEffect: ORB_EFFECT_KEY,
} as const;

export function stored(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function clearUserSessionStorage(options?: { keepAccountToken?: boolean }): void {
  try {
    if (!options?.keepAccountToken) localStorage.removeItem(ACCOUNT_TOKEN_KEY);
    localStorage.removeItem(LIBRARY_KEY);
    localStorage.removeItem(RECOVERY_KEY);
    localStorage.removeItem(DRAFT_KEY);
    localStorage.removeItem(PEER_KEY);
    localStorage.removeItem(NOTES_KEY);
    localStorage.removeItem(PLAZA_LINKS_KEY);
  } catch {
    /* Ignore storage access errors under private browsing / disabled storage. */
  }
}
