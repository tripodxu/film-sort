/**
 * 扫码连接弹窗（豆瓣 / 网易云共用外壳）。
 *
 * 抽取前：SourceView 里两个弹窗近乎逐行重复（约 360 行，只有文案与回调不同），
 * 任何一处改动都要改两遍，且已经出现漂移——网易云有「扫码者头像/昵称」，豆瓣没有。
 * 这里把「结构 + 状态机呈现 + 风控降级卡」收成一份，差异全部走 props。
 *
 * 状态机（`QrState`）与倒计时仍由调用方持有：轮询、风控重试、Cookie 降级都绑着
 * 各自的接口，搬进来只会让组件同时认识两个后端。
 */
import { CheckCircle2, Clock, KeyRound, RotateCcw, X } from "lucide-react";
import { FocusTrap } from "./FocusTrap";
import { IconButton } from "../views/IconButton";

export type QrState = "waiting" | "scanned" | "confirmed" | "expired" | "risk";

/** 风控降级（Cookie 直连）卡：两家文案与后端不同，结构完全一致。 */
export interface QrFallbackProps {
  blocked: boolean;
  cookieOpen: boolean;
  cookieText: string;
  cookieBusy: boolean;
  /** 卡片标题，如「扫码没成功？用 Cookie 直连」 */
  title: string;
  placeholder: string;
  onTextChange: (value: string) => void;
  onOpenCookie: () => void;
  onConnectCookie: () => void;
  /** 「← 再试一次扫码」：关掉降级卡并重新发码 */
  onRetryQr: () => void;
  onOpenHelp: () => void;
}

export interface QrConnectModalProps {
  t: (zh: string, en: string) => string;
  /** 眉标：DOUBAN / NETEASE */
  eyebrow: string;
  /** 弹窗标题（已翻译），同时作为 aria-labelledby 的目标 */
  title: string;
  headingId: string;
  /** 二维码的替代文本 */
  qrAlt: string;
  qrImage: string;
  state: QrState;
  error: string;
  /** 剩余秒数 */
  left: number;
  /** 已自动换码次数（上限 2，用两个点表示） */
  refreshed: number;
  /** 已扫码用户的头像/昵称（仅网易云有） */
  scanned?: { nickname?: string; avatarUrl?: string } | null;
  /** waiting 态引导文案（各 App 入口不同） */
  hintWaiting: string;
  /** confirmed 态文案（校验中 / 加载歌单） */
  hintConfirmed: string;
  onClose: () => void;
  /** 「重新生成」：过期后手动换码 */
  onRefresh: () => void;
  fallback: QrFallbackProps;
  /** 未触发风控时底部的隐私说明 */
  note: string;
}

export function QrConnectModal({
  t,
  eyebrow,
  title,
  headingId,
  qrAlt,
  qrImage,
  state,
  error,
  left,
  refreshed,
  scanned,
  hintWaiting,
  hintConfirmed,
  onClose,
  onRefresh,
  fallback,
  note,
}: QrConnectModalProps) {
  const hint =
    state === "waiting"
      ? hintWaiting
      : state === "scanned"
        ? t("已扫码 ✓ 请在手机上点「确认登录」", "Scanned ✓ confirm on your phone")
        : state === "confirmed"
          ? hintConfirmed
          : error || t("二维码已过期", "QR code expired");

  return (
    <FocusTrap onEscape={onClose}>
      <div className="modal-backdrop" onClick={onClose}>
        <section
          className="account-dialog qr-connect-dialog"
          role="dialog"
          aria-modal="true"
          aria-labelledby={headingId}
          onClick={(event) => event.stopPropagation()}
          onKeyDown={(event) => {
            if (event.key === "Escape") onClose();
          }}
        >
          <div className="section-heading">
            <div>
              <span className="eyebrow">{eyebrow}</span>
              <h2 id={headingId}>{title}</h2>
            </div>
            <IconButton title={t("关闭", "Close")} onClick={onClose}>
              <X size={18} />
            </IconButton>
          </div>

          <div className="qr-body">
            <div className="qr-stage">
              <div className="qr-box">
                {qrImage ? (
                  <img src={qrImage} alt={qrAlt} className="qr-image" />
                ) : (
                  <div className="loading qr-image">{t("正在生成二维码…", "Generating QR…")}</div>
                )}
                {state === "confirmed" && (
                  <div className="qr-mask ok">
                    <CheckCircle2 size={44} />
                    <span>{t("连接成功", "Connected")}</span>
                  </div>
                )}
                {state === "expired" && (
                  <div className="qr-mask">
                    <RotateCcw size={40} />
                    <button className="button secondary" onClick={() => void onRefresh()}>
                      {t("重新生成", "Regenerate")}
                    </button>
                  </div>
                )}
              </div>
              <div className="qr-side">
                <div className="qr-timer" style={{ opacity: state === "waiting" ? 1 : 0.45 }}>
                  <Clock size={13} />
                  {state === "waiting"
                    ? `${t("剩余", "left")} ${Math.floor(left / 60)}:${String(left % 60).padStart(2, "0")}`
                    : t("已就绪", "ready")}
                </div>
                <div
                  className="qr-refresh-dots"
                  title={t(
                    "二维码有效期倒计时，归零自动换码（最多 2 次）",
                    "Countdown; auto-refresh up to 2 times",
                  )}
                >
                  <span className={refreshed >= 1 ? "on" : ""}></span>
                  <span className={refreshed >= 2 ? "on" : ""}></span>
                </div>
                {scanned?.nickname && (
                  <div className="qr-scanned-as">
                    <img
                      src={`/api/image?url=${encodeURIComponent(scanned.avatarUrl ?? "")}`}
                      alt=""
                      referrerPolicy="no-referrer"
                      onError={(event) => {
                        (event.target as HTMLImageElement).style.display = "none";
                      }}
                    />
                    {scanned.nickname}
                  </div>
                )}
              </div>
            </div>

            <p className="qr-hint" data-state={state}>
              {hint}
            </p>

            {fallback.blocked && (
              <div className="qr-fallback">
                <strong>{fallback.title}</strong>
                {fallback.cookieOpen ? (
                  <>
                    <textarea
                      value={fallback.cookieText}
                      onChange={(event) => fallback.onTextChange(event.target.value)}
                      placeholder={fallback.placeholder}
                    />
                    <div className="inline-input">
                      <button
                        className="button primary"
                        disabled={fallback.cookieBusy || !fallback.cookieText.trim()}
                        onClick={() => void fallback.onConnectCookie()}
                      >
                        {fallback.cookieBusy ? t("连接中…", "Connecting…") : t("连接", "Connect")}
                      </button>
                      <button className="text-button" onClick={fallback.onRetryQr}>
                        {t("← 再试一次扫码", "← Try QR again")}
                      </button>
                    </div>
                  </>
                ) : (
                  <button className="button secondary" onClick={fallback.onOpenCookie}>
                    <KeyRound size={15} />
                    {t("粘贴 Cookie 连接", "Paste cookie")}
                  </button>
                )}
                <button className="text-button qr-help-link" onClick={fallback.onOpenHelp}>
                  {t("如何获取 Cookie？看图文说明 →", "How to get the cookie? See guide →")}
                </button>
              </div>
            )}

            {!fallback.blocked && <p className="mini-note qr-note">{note}</p>}
          </div>
        </section>
      </div>
    </FocusTrap>
  );
}
