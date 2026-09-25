import { useState, useEffect, useRef, useCallback } from "react";
import { parseProfile, LIBRARY_KEY, mergeProfiles, type ArtisticProfile } from "./profile";
import { readNotes, writeNotes } from "./notes";
import { buildProfileSyncBody, isCurrentGeneration } from "./profileSync";
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
  const [authMode, setAuthMode] = useState<"login" | "register" | "reset">("login");
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authNickname, setAuthNickname] = useState("");
  const [authCode, setAuthCode] = useState("");
  const [codeCooldown, setCodeCooldown] = useState(0);
  const [authError, setAuthError] = useState("");
  const [needNickname, setNeedNickname] = useState(false);
  const [editingNickname, setEditingNickname] = useState(false);
  const [editNicknameValue, setEditNicknameValue] = useState("");
  const [syncStatus, setSyncStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  /** 冲突携带云端画像 + 云端批注：「使用云端数据」时两者原子替换本地状态（DATA-04）。 */
  const [cloudConflict, setCloudConflict] = useState<{
    profile: ArtisticProfile;
    notes: Record<string, string>;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  /** 会话水合门：云端恢复完成前禁止自动 PUT，防止本地旧画像覆盖云端（DATA-04）。 */
  const [cloudHydrated, setCloudHydrated] = useState(false);

  const syncTimer = useRef<number | null>(null);
  const syncing = useRef(false);
  const syncPending = useRef(false);
  const syncKeepalivePending = useRef(false);
  /** 会话代际：登录/登出/手动加载都会自增；在途响应只有代际匹配才允许落地。 */
  const sessionGeneration = useRef(0);
  const activeSync = useRef<AbortController | null>(null);
  const activeHydration = useRef<AbortController | null>(null);

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
    const controller = new AbortController();
    activeSync.current = controller;
    try {
      do {
        if (controller.signal.aborted) break;
        syncPending.current = false;
        const currentKeepalive = syncKeepalivePending.current || keepalive;
        syncKeepalivePending.current = false;
        const next = d.namedProfile();
        if (!next) break;
        // 批注随每次同步显式携带（含空对象）：清空批注后自动同步才能把清空落到云端
        //（旧代码按 hasAnyNotes 省略字段，云端永远保留旧批注，findings DATA-03）。
        const ok = (
          await fetch("/api/account/profile", {
            method: "PUT",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify(buildProfileSyncBody(next, d.getNotes(), true)),
            keepalive: currentKeepalive,
            signal: controller.signal,
          })
        ).ok;
        setSyncStatus(ok ? "saved" : "error");
        if (!ok) break;
      } while (syncPending.current);
    } catch {
      // 登出触发的中止不是错误；其余失败保留 error 状态。
      if (!controller.signal.aborted) setSyncStatus("error");
    } finally {
      if (activeSync.current === controller) activeSync.current = null;
      syncing.current = false;
    }
  }, []);

  const accountLoad = useCallback(async (autoApply: boolean) => {
    const d = depsRef.current;
    const token = stored("art-rank:account-token") ?? "";
    if (!token) return;
    const generation = ++sessionGeneration.current;
    activeHydration.current?.abort();
    const controller = new AbortController();
    activeHydration.current = controller;
    setBusy(true);
    try {
      const response = await fetch("/api/account/profile", {
        headers: { authorization: `Bearer ${token}` },
        signal: controller.signal,
      });
      if (!response.ok) throw new Error();
      const data = (await response.json()) as {
        email: string;
        nickname?: string;
        profile: unknown;
        notes?: Record<string, string>;
      };
      // 代际失配：期间发生了登录/登出/更新的加载，旧响应不得落地（DATA-04）。
      if (!isCurrentGeneration(sessionGeneration.current, generation)) return;
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
      if (!autoApply && !controller.signal.aborted)
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
      // 显式保存表达完整的本地状态：批注始终携带（含空对象=清空云端批注）。
      const response = await fetch("/api/account/profile", {
        method: "PUT",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify(buildProfileSyncBody(next, d.getNotes(), true)),
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

  // 验证码下发（注册/修改密码共用）——60s 倒计时防连点
  useEffect(() => {
    if (codeCooldown <= 0) return;
    const timer = window.setTimeout(() => setCodeCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [codeCooldown]);

  const sendAuthCode = useCallback(async () => {
    const d = depsRef.current;
    setAuthError("");
    if (!authEmail.trim()) {
      setAuthError(d.t("请填写邮箱", "Please enter your email"));
      return;
    }
    if (codeCooldown > 0 || busy) return;
    setBusy(true);
    try {
      const purpose = authMode === "register" ? "register" : "reset";
      const response = await fetch("/api/account/send-code", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: authEmail, purpose }),
      });
      const data = (await response.json()) as { error?: string; msg?: string };
      if (!response.ok) {
        setAuthError(data.msg ?? data.error ?? d.t("发送失败", "Failed"));
        return;
      }
      setCodeCooldown(60);
      d.setNotice(d.t("验证码已发送，请查收邮箱。", "Verification code sent."));
    } catch {
      setAuthError(d.t("网络错误", "Network error"));
    } finally {
      setBusy(false);
    }
  }, [authEmail, authMode, codeCooldown, busy]);

  const accountAuth = useCallback(
    async (mode: "login" | "register" | "reset") => {
      const d = depsRef.current;
      setAuthError("");
      setBusy(true);
      try {
        if (mode === "register" && !authNickname.trim()) {
          setAuthError(d.t("请填写昵称", "Please enter a nickname"));
          setBusy(false);
          return;
        }
        if (mode !== "login" && !authCode.trim()) {
          setAuthError(d.t("请填写邮箱验证码", "Please enter the email code"));
          setBusy(false);
          return;
        }
        if (mode === "reset") {
          const response = await fetch("/api/account/change-password", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ email: authEmail, code: authCode, password: authPassword }),
          });
          const data = (await response.json()) as { error?: string; msg?: string };
          if (!response.ok) {
            setAuthError(data.msg ?? data.error ?? d.t("操作失败", "Failed"));
            return;
          }
          d.setNotice(d.t("密码已修改，请用新密码登录。", "Password changed. Sign in with it."));
          setAuthMode("login");
          setAuthCode("");
          setAuthPassword("");
          return;
        }
        const response = await fetch(`/api/account/${mode}`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            email: authEmail,
            password: authPassword,
            nickname: authNickname || undefined,
            ...(mode === "register" ? { code: authCode } : {}),
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
        setAuthCode("");
        try {
          localStorage.setItem("art-rank:account-token", data.token);
        } catch {}
        d.setNotice(d.t("登录成功！", "Signed in!"));
        // 云端画像/批注的水合由 accountToken 驱动的 effect 统一处理：
        // 登录、OAuth 回调与刷新恢复共用同一条带代际与中止的路径。
      } catch {
        setAuthError(d.t("网络错误", "Network error"));
      } finally {
        setBusy(false);
      }
    },
    [authEmail, authPassword, authNickname, authCode, authMode],
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
    // 先终结当前会话的所有在途请求与定时器，再做最终保存与本地清理，
    // 避免旧会话响应在登出后落地（DATA-04）。
    sessionGeneration.current += 1;
    if (syncTimer.current !== null) {
      window.clearTimeout(syncTimer.current);
      syncTimer.current = null;
    }
    activeSync.current?.abort();
    activeHydration.current?.abort();
    setCloudHydrated(false);
    if (token) {
      const next = d.namedProfile();
      if (next) {
        try {
          // Await the save so the server records the final profile while the session
          // is still valid; the logout request below would otherwise race it.
          await fetch("/api/account/profile", {
            method: "PUT",
            headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
            body: JSON.stringify(buildProfileSyncBody(next, d.getNotes(), true)),
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
      localStorage.removeItem(`${LIBRARY_KEY}:recovery`);
      localStorage.removeItem(DRAFT_KEY);
      localStorage.removeItem(PEER_KEY);
      localStorage.removeItem("art-rank:notes");
    } catch {}
  }, []);

  // Auto-sync debounced (900ms) — re-arms only when profile or token changes; a deps-less
  // effect would re-arm on every render (incl. its own syncStatus updates) and PUT forever.
  // 水合门：云端恢复完成前绝不自动 PUT（DATA-04）。
  useEffect(() => {
    if (!accountToken || !profile || !cloudHydrated) return;
    if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => {
      void syncProfile(false);
    }, 900);
    return () => {
      if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
    };
  }, [profile, accountToken, cloudHydrated, syncProfile]);

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

  // Session hydration, driven by accountToken so login, OAuth restore and page reload
  // share one path. Cloud profile/notes are fetched and reconciled BEFORE the auto-sync
  // effect may PUT (setCloudHydrated) — restoring blindly or syncing first is what let a
  // stale local profile overwrite cloud data (DATA-04). Different local+cloud profiles
  // raise the conflict dialog instead of silently overwriting either side.
  useEffect(() => {
    if (!accountToken) {
      setCloudHydrated(false);
      return;
    }
    const generation = ++sessionGeneration.current;
    activeHydration.current?.abort();
    const controller = new AbortController();
    activeHydration.current = controller;
    void fetch("/api/account/profile", {
      headers: { authorization: `Bearer ${accountToken}` },
      signal: controller.signal,
    })
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
          if (!isCurrentGeneration(sessionGeneration.current, generation)) return;
          if (data?.email) {
            const d = depsRef.current;
            setAccountEmail(data.email);
            setAccountNickname(data.nickname ?? data.email.split("@")[0]);
            const cloudNotes = data.notes && typeof data.notes === "object" ? data.notes : {};
            if (data.notes && typeof data.notes === "object") {
              const merged = { ...readNotes(), ...cloudNotes };
              d.setNotes(merged);
              writeNotes(merged);
            }
            if (data.profile) {
              const cloudParsed = parseProfile(data.profile);
              const local = d.getProfile();
              if (!local) {
                d.persist(cloudParsed);
                d.setNotice(
                  d.t("已从云端恢复画像和批注。", "Profile and notes restored from cloud."),
                );
              } else if (JSON.stringify(local) !== JSON.stringify(cloudParsed)) {
                setCloudConflict({ profile: cloudParsed, notes: cloudNotes });
              }
            }
          } else {
            setAccountToken("");
            try {
              localStorage.removeItem("art-rank:account-token");
            } catch {}
          }
          setCloudHydrated(true);
        },
      )
      .catch(() => {
        // 网络失败也放行水合门：自动同步自身会失败并呈现 error，不阻塞用户操作。
        if (isCurrentGeneration(sessionGeneration.current, generation)) setCloudHydrated(true);
      });
    return () => controller.abort();
  }, [accountToken]);

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
    sendAuthCode,
    authCode,
    setAuthCode,
    codeCooldown,
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
