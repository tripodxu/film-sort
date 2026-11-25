/** 分享输出区（只读输入框 + 二维码）当前展示的是哪一类链接。 */
export type ShareLinkKind = "compare" | "share";

export interface ShareOutputLabels {
  /** 只读输入框的无障碍名称 */
  inputLabel: string;
  /** 二维码图片的替代文本 */
  qrAlt: string;
}

type Translate = (zh: string, en: string) => string;

/**
 * 「比较链接」（/api/share 返回的 compareUrl，对方进来直接 PK）与「分享链接」
 * （带有效期的只读页面 url）用途不同。两者共用同一个输出区时，标签与二维码必须跟着
 * 实际链接类型走，否则用户会把分享链接当比较链接发出去。
 */
export function shareOutputLabels(kind: ShareLinkKind, t: Translate): ShareOutputLabels {
  return kind === "share"
    ? { inputLabel: t("分享链接", "Share link"), qrAlt: t("分享二维码", "Share QR code") }
    : {
        inputLabel: t("比较链接", "Comparison link"),
        qrAlt: t("比较二维码", "Comparison QR code"),
      };
}

/**
 * 从 /api/share 响应里取「比较链接」。compareUrl 优先；缺失时只允许把
 * /share/<code> 形状改写成 /encounter?payload=<code>——改写不生效（正则不匹配）
 * 时必须返回 undefined 走失败分支，绝不能把分享页 URL 原样当比较链接复制出去。
 */
export function compareLinkOf(data: { url?: string; compareUrl?: string }): string | undefined {
  if (data.compareUrl) return data.compareUrl;
  if (!data.url) return undefined;
  const rewritten = data.url.replace(/\/share\/([0-9a-f]{8,12})$/, "/encounter?payload=$1");
  return rewritten === data.url ? undefined : rewritten;
}
