import { useEffect, useRef, useState } from "react";
import type { QrState } from "../components/QrConnectModal";

export type PlatformKind = "netease" | "douban";

export interface PlatformConnectOptions {
  platform: PlatformKind;
  active: boolean;
  accountToken: string;
  t: (zh: string, en: string) => string;
  setNotice: (msg: string) => void;
  onConnected?: () => void;
  onDisconnected?: () => void;
}

const authHeaders = (token: string): Record<string, string> =>
  token ? { authorization: `Bearer ${token}` } : {};

/**
 * 网易云 / 豆瓣扫码与 Cookie 连接的共用状态机：
 * 统一处理状态查询、发码、无漂移倒计时、轮询、风控降级与断开连接。
 */
export function usePlatformConnect({
  platform,
  active,
  accountToken,
  t,
  setNotice,
  onConnected,
  onDisconnected,
}: PlatformConnectOptions) {
  const isNe = platform === "netease";
  const prefix = isNe ? "/api/netease" : "/api/douban";

  const [connected, setConnected] = useState(false);
  const [accountInfo, setAccountInfo] = useState<{
    nickname: string | null;
    avatarUrl: string | null;
  } | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrKey, setQrKey] = useState("");
  const [qrImage, setQrImage] = useState("");
  const [qrState, setQrState] = useState<QrState>("waiting");
  const [qrLeft, setQrLeft] = useState(0);
  const [qrError, setQrError] = useState("");
  const [qrScanned, setQrScanned] = useState<{
    nickname?: string;
    avatarUrl?: string;
  } | null>(null);
  const [qrRefreshed, setQrRefreshed] = useState(0);
  const [riskBlocked, setRiskBlocked] = useState(false);
  const [cookieOpen, setCookieOpen] = useState(false);
  const [cookieText, setCookieText] = useState("");
  const [cookieBusy, setCookieBusy] = useState(false);
  const deadlineRef = useRef(0);

  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;
  const onDisconnectedRef = useRef(onDisconnected);
  onDisconnectedRef.current = onDisconnected;

  async function checkStatus() {
    if (!accountToken) return;
    try {
      const response = await fetch(`${prefix}/status`, { headers: authHeaders(accountToken) });
      const data = (await response.json()) as {
        connected?: boolean;
        account?: { nickname: string | null; avatarUrl: string | null } | null;
      };
      const isConnected = !!data.connected;
      setConnected(isConnected);
      setAccountInfo(data.account ?? null);
      if (isNe && isConnected) onConnectedRef.current?.();
    } catch {
      setConnected(false);
    }
  }

  useEffect(() => {
    if (!active || !accountToken) return;
    void checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- active/accountToken/platform changes trigger status refresh
  }, [active, accountToken, platform]);

  // 轮询扫码状态（风控码连续 3 次再判定失败，避免瞬时风控误报）
  useEffect(() => {
    if (!qrOpen || !qrKey || qrState === "confirmed" || qrState === "expired") return;
    let stopped = false;
    let riskHits = 0;
    const poll = async () => {
      try {
        const param = isNe
          ? `unikey=${encodeURIComponent(qrKey)}`
          : `code=${encodeURIComponent(qrKey)}`;
        const response = await fetch(`${prefix}/qr/poll?${param}`, {
          headers: authHeaders(accountToken),
        });
        if (stopped) return;
        const data = (await response.json()) as {
          state?: string;
          error?: string;
          msg?: string;
          nickname?: string;
          avatarUrl?: string;
        };
        if (data.state === "scanned") {
          setQrState("scanned");
          if (isNe) {
            setQrScanned({
              nickname: data.nickname,
              avatarUrl: data.avatarUrl,
            });
          }
        } else if (data.state === "confirmed") {
          setQrState("confirmed");
          setConnected(true);
          setNotice(
            isNe
              ? t(
                  "网易云已连接！现在可以浏览你的全部歌单。",
                  "NetEase connected — your playlists are ready.",
                )
              : t(
                  "豆瓣连接成功，私有豆列现在可以导入了。",
                  "Douban connected — private doulists can now be imported.",
                ),
          );
          if (!isNe) void checkStatus();
          onConnectedRef.current?.();
          window.setTimeout(() => {
            if (!stopped) setQrOpen(false);
          }, 900);
        } else if (data.state === "expired") {
          setQrState("expired");
        } else if (data.state === "risk") {
          riskHits += 1;
          if (riskHits >= 3) {
            setQrState("risk");
            setRiskBlocked(true);
            setQrError(
              data.msg ??
                data.error ??
                t(
                  "检测到风控限制，请稍后再试或改用 Cookie。",
                  "Risk-control blocked — try again later or paste a cookie.",
                ),
            );
          }
        }
      } catch {
        /* 瞬时网络抖动，下一轮继续 */
      }
    };
    const timer = window.setInterval(() => void poll(), isNe ? 3000 : 2500);
    return () => {
      stopped = true;
      window.clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- t/setNotice/prefix are stable enough for polling lifecycle
  }, [qrOpen, qrKey, qrState, accountToken, platform]);

  // 无漂移倒计时：基于 deadlineRef
  useEffect(() => {
    if (!qrOpen || qrState !== "waiting" || !qrImage || deadlineRef.current <= 0) return;
    const tick = () => {
      const remain = Math.max(0, Math.ceil((deadlineRef.current - Date.now()) / 1000));
      setQrLeft(remain);
      if (remain <= 0) setQrState("expired");
    };
    tick();
    const timer = window.setInterval(tick, 1000);
    return () => window.clearInterval(timer);
  }, [qrOpen, qrState, qrImage]);

  async function issueQr() {
    setQrImage("");
    setQrKey("");
    setQrState("waiting");
    setQrError("");
    setQrScanned(null);
    deadlineRef.current = 0;
    setQrLeft(0);
    try {
      const response = await fetch(`${prefix}/qr/issue`, { headers: authHeaders(accountToken) });
      const data = (await response.json()) as {
        unikey?: string;
        qr_value?: string;
        code?: string;
        qr_image?: string;
        ttl?: number;
      };
      if (isNe) {
        if (!data.unikey || !data.qr_value) throw new Error();
        const QRCode = await import("qrcode");
        setQrImage(await QRCode.default.toDataURL(data.qr_value, { width: 300, margin: 1 }));
        setQrKey(data.unikey);
      } else {
        if (!data.code || !data.qr_image) throw new Error();
        setQrImage(data.qr_image);
        setQrKey(data.code);
      }
      const ttl = data.ttl ?? (isNe ? 150 : 120);
      deadlineRef.current = Date.now() + ttl * 1000;
      setQrLeft(ttl);
    } catch {
      setQrState("expired");
    }
  }

  async function openQr() {
    setQrOpen(true);
    setRiskBlocked(false);
    setCookieOpen(false);
    setQrRefreshed(0);
    await issueQr();
  }

  function closeQr() {
    setQrOpen(false);
    setQrKey("");
  }

  async function autoRefreshQr() {
    if (qrRefreshed >= 2) {
      setQrError(
        t(
          "二维码刷新次数已达上限，请关闭后稍候再试，或改用粘贴 Cookie 连接。",
          "Refresh limit reached — close and retry later, or connect with a pasted cookie.",
        ),
      );
      setQrState("expired");
      return;
    }
    setQrRefreshed((c) => c + 1);
    await issueQr();
  }

  async function connectWithCookie() {
    const value = cookieText.trim();
    if (!value || cookieBusy) return;
    setCookieBusy(true);
    try {
      const response = await fetch(`${prefix}/cookie`, {
        method: "POST",
        headers: { ...authHeaders(accountToken), "content-type": "application/json" },
        body: JSON.stringify({ cookie: value }),
      });
      const data = (await response.json()) as { ok?: boolean; msg?: string };
      if (response.ok && data.ok) {
        setConnected(true);
        setCookieOpen(false);
        setCookieText("");
        setNotice(
          isNe
            ? t(
                "Cookie 连接成功，可以浏览你的歌单了。",
                "Connected via cookie — your playlists are now available.",
              )
            : t(
                "豆瓣连接成功，私有豆列现在可以导入了。",
                "Douban connected — private doulists can now be imported.",
              ),
        );
        if (!isNe) void checkStatus();
        onConnectedRef.current?.();
      } else {
        setNotice(
          data.msg ??
            t("连接失败，请检查粘贴的 Cookie。", "Connection failed — check the pasted cookie."),
        );
      }
    } catch {
      setNotice(t("连接失败，请稍后重试。", "Connection failed, please retry."));
    } finally {
      setCookieBusy(false);
    }
  }

  async function disconnect() {
    try {
      await fetch(`${prefix}/disconnect`, { method: "POST", headers: authHeaders(accountToken) });
    } catch {}
    setConnected(false);
    setAccountInfo(null);
    onDisconnectedRef.current?.();
    setNotice(
      isNe
        ? t(
            "已断开网易云连接，加密 Cookie 已删除。",
            "NetEase disconnected. The encrypted cookie has been deleted.",
          )
        : t(
            "已断开豆瓣连接，加密 Cookie 已删除。",
            "Douban disconnected. The encrypted cookie has been deleted.",
          ),
    );
  }

  return {
    connected,
    setConnected,
    accountInfo,
    qrOpen,
    setQrOpen,
    qrImage,
    qrState,
    qrLeft,
    qrError,
    qrScanned,
    qrRefreshed,
    riskBlocked,
    setRiskBlocked,
    cookieOpen,
    setCookieOpen,
    cookieText,
    setCookieText,
    cookieBusy,
    openQr,
    closeQr,
    autoRefreshQr,
    connectWithCookie,
    disconnect,
    checkStatus,
  };
}
