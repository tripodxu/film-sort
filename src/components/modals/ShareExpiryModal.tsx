import type { Locale } from "../../data/mediaKinds";
import type { RankingExport } from "../../lib/profile";
import { Modal } from "../Modal";

export interface ShareExpiryModalProps {
  t: (zh: string, en: string) => string;
  locale: Locale;
  busy: boolean;
  shareModal: { ranking?: RankingExport };
  onClose: () => void;
  onSelectDays: (ranking: RankingExport | undefined, days: number) => void;
}

export function ShareExpiryModal({
  t,
  locale,
  busy,
  shareModal,
  onClose,
  onSelectDays,
}: ShareExpiryModalProps) {
  return (
    <Modal
      t={t}
      headingId="share-expiry-heading"
      eyebrow="SHARE"
      title={t("分享链接有效期", "Share link expiry")}
      onClose={onClose}
    >
      <p style={{ fontSize: 13, color: "var(--muted)", lineHeight: 1.7, margin: 0 }}>
        {t(
          "选择链接有效期，到期后他人将无法再打开该链接。生成后链接自动复制。",
          "Pick how long the link stays valid — it stops working after expiry. The link is copied automatically.",
        )}
      </p>
      <div className="u-col">
        {[7, 30, 90, 365].map((days) => (
          <button
            key={days}
            className="button secondary u-row-between"
            disabled={busy}
            onClick={() => {
              const picked = shareModal;
              onClose();
              onSelectDays(picked?.ranking, days);
            }}
          >
            <span>{days === 365 ? t("一年", "1 year") : `${days} ${t("天", "days")}`}</span>
            <small>
              {new Date(Date.now() + days * 86400000).toLocaleDateString(
                locale === "zh" ? "zh-CN" : "en-US",
              )}
            </small>
          </button>
        ))}
      </div>
    </Modal>
  );
}
