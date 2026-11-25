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

/** 只有等待与已扫码状态需要轮询；confirmed/expired/risk 都是当前二维码的终态。 */
export function shouldPollQrState(qrOpen: boolean, qrKey: string, qrState: QrState): boolean {
  return qrOpen && !!qrKey && (qrState === "waiting" || qrState === "scanned");
}

/** 只有服务端明确返回 2xx 才允许前端宣称 Cookie 已删除。 */
export async function requestPlatformDisconnect(
  platform: PlatformKind,
  accountToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<boolean> {
  const prefix = platform === "netease" ? "/api/netease" : "/api/douban";
  try {
    const response = await fetchImpl(`${prefix}/disconnect`, {
      method: "POST",
      headers: authHeaders(accountToken),
      signal: AbortSignal.timeout(15000),
    });
    return response.ok;
  } catch {
    return false;
  }
}

export type PlatformAccountInfo = { nickname: string | null; avatarUrl: string | null };

export type PlatformStatusResult =
  { ok: true; connected: boolean; account: PlatformAccountInfo | null } | { ok: false };

const asText = (value: unknown): string | null => (typeof value === "string" ? value : null);
const normalizeAccount = (account: unknown): PlatformAccountInfo | null =>
  account && typeof account === "object"
    ? {
        nickname: asText((account as { nickname?: unknown }).nickname),
        avatarUrl: asText((account as { avatarUrl?: unknown }).avatarUrl),
      }
    : null;

/**
 * 查询平台连接状态。只有 2xx 且 connected 为布尔值才算「查到了」；
 * 超时、网络错误、非 2xx、畸形响应一律返回 ok:false，由调用方保持原状态——
 * 「无法确认」绝不能被当成「未连接」，否则一次网络抖动就会把已连接的平台显示成未连接。
 */
export async function requestPlatformStatus(
  platform: PlatformKind,
  accountToken: string,
  fetchImpl: typeof fetch = fetch,
): Promise<PlatformStatusResult> {
  const prefix = platform === "netease" ? "/api/netease" : "/api/douban";
  try {
    const response = await fetchImpl(`${prefix}/status`, {
      headers: authHeaders(accountToken),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) return { ok: false };
    const data = (await response.json()) as { connected?: unknown; account?: unknown };
    if (typeof data.connected !== "boolean") return { ok: false };
    return { ok: true, connected: data.connected, account: normalizeAccount(data.account) };
  } catch {
    return { ok: false };
  }
}

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
  const [accountInfo, setAccountInfo] = useState<PlatformAccountInfo | null>(null);
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
  const issueGenRef = useRef(0);
  // 每次状态请求的代际：新请求、断开、登出都会让在途的旧响应失效。
  const statusGenRef = useRef(0);
  // 上一次查询所属的「平台 + 账号」范围；范围变化时先清空，避免把 A 平台 / A 账号的连接态与昵称头像留给 B。
  const statusScopeRef = useRef<string | null>(null);

  const onConnectedRef = useRef(onConnected);
  onConnectedRef.current = onConnected;
  const onDisconnectedRef = useRef(onDisconnected);
  onDisconnectedRef.current = onDisconnected;

  async function checkStatus() {
    if (!accountToken) return;
    const generation = ++statusGenRef.current;
    const result = await requestPlatformStatus(platform, accountToken);
    // 期间已断开 / 登出 / 切换平台，或本次无法确认：一律不写状态。
    if (generation !== statusGenRef.current || !result.ok) return;
    setConnected(result.connected);
    setAccountInfo(result.account);
    if (isNe && result.connected) onConnectedRef.current?.();
  }

  useEffect(() => {
    const scope = accountToken ? `${platform}|auth` : "";
    if (!scope) {
      // 登出：清掉上一个账号的连接态与昵称头像，并让在途的状态响应失效。
      statusGenRef.current += 1;
      statusScopeRef.current = null;
      setConnected(false);
      setAccountInfo(null);
      return;
    }
    if (scope !== statusScopeRef.current) {
      statusScopeRef.current = scope;
      statusGenRef.current += 1;
      setConnected(false);
      setAccountInfo(null);
    }
    if (!active) return;
    void checkStatus();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- active/accountToken/platform changes trigger status refresh
  }, [active, accountToken, platform]);

  // 轮询扫码状态（风控码连续 3 次再判定失败，避免瞬时风控误报）
  useEffect(() => {
    if (!shouldPollQrState(qrOpen, qrKey, qrState)) return;
    let stopped = false;
    let riskHits = 0;
    let inFlight = false;
    const poll = async () => {
      // setInterval 不等待异步任务：慢响应时跳过本轮，避免同一二维码并发确认。
      if (inFlight) return;
      inFlight = true;
      try {
        const param = isNe
          ? `unikey=${encodeURIComponent(qrKey)}`
          : `code=${encodeURIComponent(qrKey)}`;
        const response = await fetch(`${prefix}/qr/poll?${param}`, {
          headers: authHeaders(accountToken),
          signal: AbortSignal.timeout(15000),
        });
        if (stopped) return;
        const data = (await response.json()) as {
          state?: string;
          error?: string;
          msg?: string;
          nickname?: string;
          avatarUrl?: string;
        };
        if (stopped) return;
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
          const confirmedGen = issueGenRef.current;
          // 进入 confirmed 会让上面的轮询副作用重跑（旧 cleanup 置 stopped），所以这里不能依赖 stopped，
          // 改用发码代际：关闭弹窗或重新发码都会递增代际，迟到的自动关闭一律丢弃。
          window.setTimeout(() => {
            if (issueGenRef.current === confirmedGen) setQrOpen(false);
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
      } finally {
        inFlight = false;
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
    const generation = ++issueGenRef.current;
    setQrImage("");
    setQrKey("");
    setQrState("waiting");
    setQrError("");
    setQrScanned(null);
    deadlineRef.current = 0;
    setQrLeft(0);
    try {
      const response = await fetch(`${prefix}/qr/issue`, {
        headers: authHeaders(accountToken),
        signal: AbortSignal.timeout(20000),
      });
      const data = (await response.json()) as {
        unikey?: string;
        qr_value?: string;
        code?: string;
        qr_image?: string;
        ttl?: number;
      };
      if (generation !== issueGenRef.current) return;
      if (isNe) {
        if (!data.unikey || !data.qr_value) throw new Error();
        const QRCode = await import("qrcode");
        const image = await QRCode.default.toDataURL(data.qr_value, { width: 300, margin: 1 });
        if (generation !== issueGenRef.current) return;
        setQrImage(image);
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
      if (generation === issueGenRef.current) setQrState("expired");
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
    // 关闭后迟到的发码响应不能重新写入旧二维码。
    issueGenRef.current += 1;
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

  // 倒计时进入 expired 后自动换码；risk 不在这里，避免风控时继续轰上游。
  useEffect(() => {
    if (!qrOpen || qrState !== "expired") return;
    void autoRefreshQr();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在过期标量与已刷新次数变化时触发；issueQr 自带代际守卫
  }, [qrOpen, qrState, qrRefreshed]);

  async function connectWithCookie() {
    const value = cookieText.trim();
    if (!value || cookieBusy) return;
    setCookieBusy(true);
    try {
      const response = await fetch(`${prefix}/cookie`, {
        method: "POST",
        headers: { ...authHeaders(accountToken), "content-type": "application/json" },
        body: JSON.stringify({ cookie: value }),
        // 没有超时时，黑洞网络下 cookieBusy 会永久为 true，提交按钮被锁死且无法取消。
        signal: AbortSignal.timeout(20000),
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
    const ok = await requestPlatformDisconnect(platform, accountToken);
    if (!ok) {
      setNotice(
        t(
          "断开失败，请稍后重试；当前连接尚未变更。",
          "Could not disconnect. Please retry; your connection is unchanged.",
        ),
      );
      return;
    }
    // 断开成功前就先让在途的状态响应失效，避免旧快照把 connected 写回 true。
    statusGenRef.current += 1;
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
