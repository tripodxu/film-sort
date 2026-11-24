import { useRef } from "react";
import { Check, CloudDownload, CloudUpload, UserRound } from "lucide-react";
import type { ArtisticProfile } from "../../lib/profile";
import { Modal } from "../Modal";

export interface AccountModalProps {
  t: (zh: string, en: string) => string;
  profile: ArtisticProfile | null;
  accountEmail: string;
  accountNickname: string;
  needNickname: boolean;
  editingNickname: boolean;
  setEditingNickname: (val: boolean) => void;
  editNicknameValue: string;
  setEditNicknameValue: (val: string) => void;
  authMode: "login" | "register" | "reset";
  setAuthMode: (mode: "login" | "register" | "reset") => void;
  authEmail: string;
  setAuthEmail: (val: string) => void;
  authPassword: string;
  setAuthPassword: (val: string) => void;
  authNickname: string;
  setAuthNickname: (val: string) => void;
  authCode: string;
  setAuthCode: (val: string) => void;
  authError: string;
  setAuthError: (val: string) => void;
  authBusy: boolean;
  codeCooldown: number;
  syncStatus: "idle" | "saving" | "saved" | "error";
  saveNickname: () => Promise<void>;
  accountSave: () => void;
  accountLoad: (silent: boolean) => Promise<void>;
  accountLogout: () => void;
  sendAuthCode: () => Promise<void>;
  accountAuth: (mode: "login" | "register" | "reset") => Promise<void>;
  onClose: () => void;
}

export function AccountModal({
  t,
  profile,
  accountEmail,
  accountNickname,
  needNickname,
  editingNickname,
  setEditingNickname,
  editNicknameValue,
  setEditNicknameValue,
  authMode,
  setAuthMode,
  authEmail,
  setAuthEmail,
  authPassword,
  setAuthPassword,
  authNickname,
  setAuthNickname,
  authCode,
  setAuthCode,
  authError,
  setAuthError,
  authBusy,
  codeCooldown,
  syncStatus,
  saveNickname,
  accountSave,
  accountLoad,
  accountLogout,
  sendAuthCode,
  accountAuth,
  onClose,
}: AccountModalProps) {
  const nicknameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const codeRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  function submitAuth() {
    if (authMode === "register" && !authNickname.trim()) {
      setAuthError(t("请填写昵称。", "Please enter a nickname."));
      nicknameRef.current?.focus();
      return;
    }
    if (!authEmail.trim()) {
      setAuthError(t("请填写邮箱地址。", "Please enter your email address."));
      emailRef.current?.focus();
      return;
    }
    if (authMode !== "login" && !authCode.trim()) {
      setAuthError(t("请填写邮箱验证码。", "Please enter the verification code."));
      codeRef.current?.focus();
      return;
    }
    if (!authPassword) {
      setAuthError(t("请填写密码。", "Please enter your password."));
      passwordRef.current?.focus();
      return;
    }
    if (authMode !== "login" && authPassword.length < 8) {
      setAuthError(t("密码至少需要 8 位。", "Password must be at least 8 characters."));
      passwordRef.current?.focus();
      return;
    }
    void accountAuth(authMode);
  }

  return (
    <Modal
      t={t}
      headingId="account-heading"
      title={t("账号与同步", "Account & sync")}
      onClose={onClose}
    >
      {accountEmail && needNickname ? (
        <>
          <p className="u-mb">{t("请设置你的昵称", "Please set your nickname")}</p>
          <input
            type="text"
            placeholder={t("昵称", "Nickname")}
            value={authNickname}
            onChange={(e) => setAuthNickname(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") void saveNickname();
            }}
            style={{ marginBottom: 12 }}
            autoFocus
          />
          <button
            className="button primary"
            disabled={authBusy || !authNickname.trim()}
            onClick={() => void saveNickname()}
          >
            {t("确认昵称", "Set nickname")}
          </button>
        </>
      ) : accountEmail ? (
        <>
          <div style={{ display: "flex", gap: 8, alignItems: "center", marginBottom: 4 }}>
            {editingNickname ? (
              <div style={{ display: "flex", gap: 4, alignItems: "center", flex: 1 }}>
                <input
                  type="text"
                  value={editNicknameValue}
                  onChange={(e) => setEditNicknameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") void saveNickname();
                    if (e.key === "Escape") setEditingNickname(false);
                  }}
                  style={{ fontSize: 14, padding: "4px 8px", minHeight: "auto", flex: 1 }}
                  autoFocus
                />
                <button
                  className="text-button"
                  onClick={() => void saveNickname()}
                  aria-label={t("确认修改昵称", "Confirm nickname")}
                  style={{ color: "var(--accent)", padding: "4px 8px" }}
                >
                  <Check size={15} />
                </button>
              </div>
            ) : (
              <>
                <p style={{ fontWeight: 600, margin: 0 }}>{accountNickname || accountEmail}</p>
                <button
                  onClick={() => {
                    setEditingNickname(true);
                    setEditNicknameValue(accountNickname);
                  }}
                  style={{
                    fontSize: 10,
                    color: "var(--muted)",
                    background: "none",
                    border: "1px solid var(--line)",
                    borderRadius: 4,
                    padding: "1px 6px",
                    cursor: "pointer",
                  }}
                >
                  {t("改名", "Edit")}
                </button>
              </>
            )}
          </div>
          <p
            style={{
              marginBottom: 16,
              fontSize: 12,
              color: "var(--muted)",
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            {accountEmail}
            <span
              title={
                syncStatus === "saving"
                  ? t("同步中", "Syncing")
                  : syncStatus === "saved"
                    ? t("已同步", "Synced")
                    : syncStatus === "error"
                      ? t("同步失败", "Sync failed")
                      : t("待机", "Idle")
              }
              className="sync-dot"
              data-status={syncStatus}
              style={{
                display: "inline-block",
                width: 8,
                height: 8,
                borderRadius: "50%",
                flexShrink: 0,
              }}
            />
          </p>
          <button
            className="button primary"
            disabled={authBusy || !profile}
            onClick={accountSave}
            style={{ marginBottom: 8 }}
          >
            <CloudUpload size={16} />
            {t("同步到云端", "Sync to cloud")}
          </button>
          <button
            className="button secondary"
            disabled={authBusy}
            onClick={() => void accountLoad(false)}
            style={{ marginBottom: 8 }}
          >
            <CloudDownload size={16} />
            {t("从云端恢复画像", "Restore from cloud")}
          </button>
          <button className="button quiet" onClick={accountLogout}>
            {t("退出登录", "Sign out")}
          </button>
        </>
      ) : (
        <>
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
            <a
              className="button secondary"
              href="/api/account/oauth/google"
              style={{
                textAlign: "center",
                textDecoration: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              {t("使用 Google 登录", "Sign in with Google")}
            </a>
            <a
              className="button secondary"
              href="/api/account/oauth/github"
              style={{
                textAlign: "center",
                textDecoration: "none",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: 8,
              }}
            >
              <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                <path d="M12 0c-6.626 0-12 5.373-12 12 0 5.302 3.438 9.8 8.207 11.387.599.111.793-.261.793-.577v-2.234c-3.338.726-4.033-1.416-4.033-1.416-.546-1.387-1.333-1.756-1.333-1.756-1.089-.745.083-.729.083-.729 1.205.084 1.839 1.237 1.839 1.237 1.07 1.834 2.807 1.304 3.492.997.107-.775.418-1.305.762-1.604-2.665-.305-5.467-1.334-5.467-5.931 0-1.311.469-2.381 1.236-3.221-.124-.303-.535-1.524.117-3.176 0 0 1.008-.322 3.301 1.23.957-.266 1.983-.399 3.003-.404 1.02.005 2.047.138 3.006.404 2.291-1.552 3.297-1.23 3.297-1.23.653 1.653.242 2.874.118 3.176.77.84 1.235 1.911 1.235 3.221 0 4.609-2.807 5.624-5.479 5.921.43.372.823 1.102.823 2.222v3.293c0 .319.192.694.801.576 4.765-1.589 8.199-6.086 8.199-11.386 0-6.627-5.373-12-12-12z" />
              </svg>
              {t("使用 GitHub 登录", "Sign in with GitHub")}
            </a>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, margin: "8px 0" }}>
            <div className="u-divider" />
            <span style={{ fontSize: 11, color: "var(--muted)" }}>
              {t("或使用邮箱", "or use email")}
            </span>
            <div className="u-divider" />
          </div>
          <div style={{ display: "flex", gap: 8, marginBottom: 12 }}>
            <button
              className={`button ${authMode === "login" ? "primary" : "secondary"}`}
              onClick={() => {
                setAuthMode("login");
                setAuthError("");
              }}
              style={{ flex: 1 }}
            >
              {t("登录", "Sign in")}
            </button>
            <button
              className={`button ${authMode === "register" ? "primary" : "secondary"}`}
              onClick={() => {
                setAuthMode("register");
                setAuthError("");
              }}
              style={{ flex: 1 }}
            >
              {t("注册", "Register")}
            </button>
            <button
              className={`button ${authMode === "reset" ? "primary" : "secondary"}`}
              onClick={() => {
                setAuthMode("reset");
                setAuthError("");
              }}
              style={{ flex: 1 }}
            >
              {t("修改密码", "Change password")}
            </button>
          </div>
          {authError && (
            <p style={{ color: "#f87171", fontSize: 13, marginBottom: 8 }}>{authError}</p>
          )}
          {authMode === "register" && (
            <input
              ref={nicknameRef}
              type="text"
              placeholder={t("昵称（必填）", "Nickname (required)")}
              value={authNickname}
              onChange={(e) => setAuthNickname(e.target.value)}
              style={{ marginBottom: 8 }}
            />
          )}
          <input
            ref={emailRef}
            type="email"
            placeholder={t("邮箱", "Email")}
            value={authEmail}
            onChange={(e) => setAuthEmail(e.target.value)}
            style={{ marginBottom: 8 }}
          />
          {authMode !== "login" && (
            <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
              <input
                ref={codeRef}
                type="text"
                placeholder={t("邮箱验证码", "Email code")}
                value={authCode}
                onChange={(e) => setAuthCode(e.target.value)}
                style={{ flex: 1 }}
              />
              <button
                className="button secondary"
                disabled={authBusy || codeCooldown > 0}
                onClick={() => void sendAuthCode()}
                style={{ whiteSpace: "nowrap" }}
              >
                {codeCooldown > 0 ? `${codeCooldown}s` : t("获取验证码", "Get code")}
              </button>
            </div>
          )}
          <input
            ref={passwordRef}
            type="password"
            placeholder={
              authMode === "reset"
                ? t("新密码（至少8位）", "New password (8+ chars)")
                : t("密码（至少8位）", "Password (8+ chars)")
            }
            value={authPassword}
            onChange={(e) => setAuthPassword(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") submitAuth();
            }}
            style={{ marginBottom: 12 }}
          />
          <button className="button primary" disabled={authBusy} onClick={submitAuth}>
            {authMode === "login"
              ? t("登录", "Sign in")
              : authMode === "register"
                ? t("注册", "Register")
                : t("修改密码", "Change password")}
          </button>
        </>
      )}
      {!accountEmail && (
        <button className="button quiet" onClick={onClose}>
          <UserRound size={16} />
          {t("继续使用游客模式", "Continue as guest")}
        </button>
      )}
    </Modal>
  );
}
