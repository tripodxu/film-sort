import { useState, useEffect, useRef, useCallback } from "react";
import { parseProfile, LIBRARY_KEY, mergeProfiles, type ArtisticProfile } from "./profile";
import { readNotes, writeNotes } from "./notes";
import { stored } from "./utils";

const PEER_KEY = "art-rank:peer:v2";
const DRAFT_KEY = "art-rank:draft:v2";

/** Dependencies that useAuth needs from the outside — passed as callbacks to avoid stale closures. */
export interface AuthDeps {
  /** Current profile (may be null for guests). */
  getProfile: () => ArtisticProfile | null;
  /** Current profile snapshot, refreshed each render — needed for the auto-sync effect dependency array. */
  profile: ArtisticProfile | null;
  /** Current notes map. */
  getNotes: () => Record<string, string>;
  /** Build a named copy of the current profile. */
  namedProfile: () => ArtisticProfile | null;
  /** Persist a profile to React state + localStorage. */
  persist: (p: ArtisticProfile) => void;
  /** Update notes in React state. */
  setNotes: (n: Record<string, string>) => void;
  /** Update profile in React state. */
  setProfile: (p: ArtisticProfile | null) => void;
  /** Update peer in React state. */
  setPeer: (p: ArtisticProfile | null) => void;
  /** Update draft in React state. */
  setDraft: (d: unknown) => void;
  /** Show a toast notice. */
  setNotice: (n: string) => void;
  /** i18n helper. */
  t: (zh: string, en: string) => string;
}

export function useAuth(deps: Omit<AuthDeps, "setDraft"> & { setDraft?: (d: unknown) => void }) {
  const depsRef = useRef(deps);
  depsRef.current = deps;
  const { profile } = deps;
  // setDraft may be set lazily via updateSetDraft() to break circular dependency
  const setDraftRef = useRef<(d: unknown) => void>(() => {});
  if (deps.setDraft) setDraftRef.current = deps.setDraft;

  const [accountOpen, setAccountOpen] = useState(
    new URLSearchParams(location.search).has("account"),
  );
  const [accountEmail, setAccountEmail] = useState("");
  const [accountNickname, setAccountNickname] = useState("");
  const [accountToken, setAccountToken] = useState(() => stored("art-rank:account-token") ?? "");
  const [authMode, setAuthMode] = useState<"login" | "register">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authNickname, setAuthNickname] = useState("");
  const [authError, setAuthError] = useState("");
  const [needNickname, setNeedNickname] = useState(false);
  const [editingNickname, setEditingNickname] = useState(false);
  const [editNicknameValue, setEditNicknameValue] = useState("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [cloudConflict, setCloudConflict] = useState<ArtisticProfile | null>(null);
  const [busy, setBusy] = useState(false);

  const syncTimer = useRef<number | null>(null);
  const syncing = useRef(false);
  const syncPending = useRef(false);
  const syncKeepalivePending = useRef(false);

  const syncProfile = useCallback(async (keepalive: boolean) => {
    const d = depsRef.current;
    const token = stored("art-rank:account-token") ?? "";
    const profile = d.getProfile();
    if (!token || !profile) return;
    if (syncing.current) {
      syncPending.current = true;
      syncKeepalivePending.current ||= keepalive;
      return;
    }
    syncing.current = true;
    setSyncStatus("saving");
    try {
      do {
        syncPending.current = false;
        const currentKeepalive = syncKeepalivePending.current || keepalive;
        syncKeepalivePending.current = false;
        const next = d.namedProfile();
        if (!next) break;
        const hasAnyNotes = Object.keys(d.getNotes()).length > 0;
        const ok = (
          await fetch("/api/account/profile", {
            method: "PUT",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({
              profile: next,
              ...(hasAnyNotes ? { notes: d.getNotes() } : {}),
            }),
            keepalive: currentKeepalive,
          })
        ).ok;
        setSyncStatus(ok ? "saved" : "error");
        if (!ok) break;
      } while (syncPending.current);
    } catch {
      setSyncStatus("error");
    } finally {
      syncing.current = false;
    }
  }, []);

  const accountLoad = useCallback(async (autoApply: boolean) => {
    const d = depsRef.current;
    const token = stored("art-rank:account-token") ?? "";
    if (!token) return;
    setBusy(true);
    try {
      const response = await fetch("/api/account/profile", {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as {
        email: string;
        nickname?: string;
        profile: unknown;
        notes?: Record<string, string>;
      };
      if (data.email) setAccountEmail(data.email);
      if (data.nickname) setAccountNickname(data.nickname);
      if (data.profile) {
        const parsed = parseProfile(data.profile);
        if (autoApply && !d.getProfile()) {
          d.persist(parsed);
          d.setNotice(d.t("已从云端恢复画像。", "Profile restored from cloud."));
        } else if (!autoApply) {
          d.persist(parsed);
          d.setNotice(d.t("已从云端同步画像。", "Profile synced from cloud."));
        }
      }
      if (data.notes && typeof data.notes === "object") {
        const merged = { ...d.getNotes(), ...data.notes };
        d.setNotes(merged);
        writeNotes(merged);
      }
    } catch {
      if (!autoApply)
        d.setNotice(d.t("读取失败，请重新登录。", "Failed to load. Please sign in again."));
    } finally {
      setBusy(false);
    }
  }, []);

  const accountSave = useCallback(async () => {
    const d = depsRef.current;
    const token = stored("art-rank:account-token") ?? "";
    if (!token) {
      d.setNotice(d.t("请先登录。", "Please sign in first."));
      return;
    }
    const next = d.namedProfile();
    if (!next) return;
    setBusy(true);
    try {
      const hasAnyNotes = Object.keys(d.getNotes()).length > 0;
      const response = await fetch("/api/account/profile", {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ profile: next, ...(hasAnyNotes ? { notes: d.getNotes() } : {}) }),
      });
      if (!response.ok) throw new Error();
      d.persist(next);
      setSyncStatus("saved");
      d.setNotice(d.t("画像已保存到云端。", "Profile saved to cloud."));
    } catch {
      d.setNotice(
        d.t("同步失败，本地画像仍然保留。", "Sync failed. Your local profile is still available."),
      );
    } finally {
      setBusy(false);
    }
  }, []);

  const accountAuth = useCallback(
    async (mode: "login" | "register") => {
      const d = depsRef.current;
      setAuthError("");
      setBusy(true);
      try {
        if (mode === "register" && !authNickname.trim()) {
          setAuthError(d.t("请填写昵称", "Please enter a nickname"));
          setBusy(false);
          return;
        }
        const response = await fetch(`/api/account/${mode}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: authEmail,
            password: authPassword,
            nickname: authNickname || undefined,
          }),
        });
        const data = (await response.json()) as {
          token?: string;
          email?: string;
          nickname?: string;
          error?: string;
          msg?: string;
        };
        if (!response.ok || !data.token) {
          setAuthError(data.msg ?? data.error ?? d.t("操作失败", "Failed"));
          return;
        }
        setAccountToken(data.token);
        setAccountEmail(data.email ?? authEmail);
        setAccountNickname(data.nickname ?? "");
        setAuthEmail("");
        setAuthPassword("");
        setAuthNickname("");
        try {
          localStorage.setItem("art-rank:account-token", data.token);
        } catch {}
        d.setNotice(d.t("登录成功！", "Signed in!"));
        const freshToken = data.token;
        setTimeout(async () => {
          try {
            const r = await fetch("/api/account/profile", {
              headers: { authorization: `Bearer ${freshToken}` },
            });
            if (!r.ok) return;
            const dr = (await r.json()) as {
              nickname?: string;
              profile: unknown;
              notes?: Record<string, string>;
            };
            if (dr.nickname) setAccountNickname(dr.nickname);
            if (dr.notes && typeof dr.notes === "object") {
              const localNotes = readNotes();
              const merged = { ...localNotes, ...dr.notes };
              d.setNotes(merged);
              writeNotes(merged);
            }
            if (dr.profile) {
              const cloudParsed = parseProfile(dr.profile);
              if (d.getProfile()) {
                setCloudConflict(cloudParsed);
              } else {
                d.persist(cloudParsed);
                d.setNotice(
                  d.t("已从云端恢复画像和批注。", "Profile and notes restored from cloud."),
                );
              }
            }
          } catch {}
        }, 100);
      } catch {
        setAuthError(d.t("网络错误", "Network error"));
      } finally {
        setBusy(false);
      }
    },
    [authEmail, authPassword, authNickname],
  );

  const saveNickname = useCallback(async () => {
    const d = depsRef.current;
    const name = editingNickname ? editNicknameValue.trim() : authNickname.trim();
    const token = stored("art-rank:account-token") ?? "";
    if (!name || !token) return;
    setBusy(true);
    try {
      const response = await fetch("/api/account/nickname", {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ nickname: name }),
      });
      if (response.ok) {
        setAccountNickname(name);
        setNeedNickname(false);
        setEditingNickname(false);
        setAuthNickname("");
        setEditNicknameValue("");
        d.setNotice(d.t("昵称已更新！", "Nickname updated!"));
      }
    } catch {
    } finally {
      setBusy(false);
    }
  }, [editingNickname, editNicknameValue, authNickname]);

  const accountLogout = useCallback(async () => {
    const d = depsRef.current;
    const token = stored("art-rank:account-token") ?? "";
    if (token) {
      const next = d.namedProfile();
      if (next) {
        try {
          const hasAnyNotes = Object.keys(d.getNotes()).length > 0;
          // Await the save so the server records the final profile while the session
          // is still valid; the logout request below would otherwise race it.
          await fetch("/api/account/profile", {
            method: "PUT",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify({
              profile: next,
              ...(hasAnyNotes ? { notes: d.getNotes() } : {}),
            }),
            keepalive: true,
          });
        } catch {
          /* best-effort */
        }
      }
      void fetch("/api/account/logout", {
        method: "POST",
        headers: { authorization: `Bearer ${token}` },
      }).catch(() => {});
    }
    setAccountToken("");
    setAccountEmail("");
    setAccountNickname("");
    setEditingNickname(false);
    setSyncStatus("idle");
    setCloudConflict(null);
    d.setProfile(null);
    d.setNotes({});
    d.setPeer(null);
    setDraftRef.current(null);
    try {
      localStorage.removeItem("art-rank:account-token");
      localStorage.removeItem(LIBRARY_KEY);
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(PEER_KEY);
      localStorage.removeItem("art-rank:notes");
    } catch {}
  }, []);

  // Auto-sync debounced (900ms) — re-arms only when profile or token changes; a deps-less
  // effect would re-arm on every render (incl. its own syncStatus updates) and PUT forever.
  useEffect(() => {
    if (!accountToken || !profile) return;
    if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => {
      void syncProfile(false);
    }, 900);
    return () => {
      if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
    };
  }, [profile, accountToken, syncProfile]);

  // Sync on pagehide / visibilitychange / online
  useEffect(() => {
    const flush = () => {
      void syncProfile(true);
    };
    const online = () => {
      void syncProfile(false);
    };
    const visibility = () => {
      if (document.visibilityState === "hidden") flush();
    };
    window.addEventListener("pagehide", flush);
    document.addEventListener("visibilitychange", visibility);
    window.addEventListener("online", online);
    return () => {
      window.removeEventListener("pagehide", flush);
      document.removeEventListener("visibilitychange", visibility);
      window.removeEventListener("online", online);
    };
  }, [syncProfile]);

  // Restore session on mount
  useEffect(() => {
    const token = stored("art-rank:account-token") ?? "";
    if (!token) return;
    void fetch("/api/account/profile", { headers: { authorization: `Bearer ${token}` } })
      .then((r) => (r.ok ? r.json() : null))
      .then(
        (
          data: {
            email?: string;
            nickname?: string;
            profile?: unknown;
            notes?: Record<string, string>;
          } | null,
        ) => {
          if (data?.email) {
            setAccountEmail(data.email);
            setAccountNickname(data.nickname ?? data.email.split("@")[0]);
            if (data.notes && typeof data.notes === "object") {
              const localNotes = readNotes();
              const merged = { ...localNotes, ...data.notes };
              depsRef.current.setNotes(merged);
              writeNotes(merged);
            }
          } else {
            setAccountToken("");
            try {
              localStorage.removeItem("art-rank:account-token");
            } catch {}
          }
        },
      )
      .catch(() => {});
  }, []);

  return {
    // State
    accountOpen,
    setAccountOpen,
    accountEmail,
    setAccountEmail,
    accountNickname,
    setAccountNickname,
    accountToken,
    setAccountToken,
    authMode,
    setAuthMode,
    authEmail,
    setAuthEmail,
    authPassword,
    setAuthPassword,
    authNickname,
    setAuthNickname,
    authError,
    setAuthError,
    needNickname,
    setNeedNickname,
    editingNickname,
    setEditingNickname,
    editNicknameValue,
    setEditNicknameValue,
    syncStatus,
    setSyncStatus,
    cloudConflict,
    setCloudConflict,
    busy,
    setBusy,
    // Functions
    accountAuth,
    accountSave,
    accountLoad,
    syncProfile,
    saveNickname,
    accountLogout,
    /** Update the setDraft callback (used to break circular dependency with useSorting). */
    updateSetDraft: (fn: (d: unknown) => void) => {
      setDraftRef.current = fn;
    },
  };
}
