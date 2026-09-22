// 发信通道：luckycola customMail —— API 契约与配置键 1:1 照抄 scripts/mail_sender.py（temp_mail 工作区）。
// 环境变量覆盖名与 mail_sender.py 完全一致：MAIL_COLA_KEY / MAIL_SMTP_EMAIL / MAIL_SMTP_CODE / MAIL_SMTP_TYPE。

export interface MailerEnv {
  MAIL_COLA_KEY?: string;
  MAIL_SMTP_EMAIL?: string;
  MAIL_SMTP_CODE?: string;
  MAIL_SMTP_TYPE?: string;
}

const API_URL = "https://luckycola.com.cn/tools/customMail"; // 文档建议优先 https

/** 下发验证码邮件（注册 / 修改密码共用）。通道未配置时走开发兜底：验证码仅写日志。 */
export async function sendVerificationCode(
  env: MailerEnv,
  to: string,
  code: string,
  purpose: "register" | "reset",
): Promise<boolean> {
  const action = purpose === "register" ? "完成注册" : "修改密码";
  const subject = `ART/RANK ${action}验证码`;
  const content =
    `<div style="font-family:sans-serif;max-width:420px;margin:0 auto">` +
    `<h3 style="margin-bottom:8px">ART/RANK · ${action}</h3>` +
    `<p>你正在${action}，验证码 10 分钟内有效：</p>` +
    `<p style="font-size:30px;letter-spacing:8px;font-weight:700;color:#2563eb">${code}</p>` +
    `<p style="color:#888;font-size:12px">若非本人操作，请忽略本邮件。</p></div>`;

  const { MAIL_COLA_KEY, MAIL_SMTP_EMAIL, MAIL_SMTP_CODE } = env;
  const smtpCodeType = env.MAIL_SMTP_TYPE ?? "163";
  if (!MAIL_COLA_KEY || !MAIL_SMTP_EMAIL || !MAIL_SMTP_CODE) {
    // 开发兜底：本地联调不被通道配置卡住；生产未配置时也只暴露到日志，不返回给调用方。
    console.warn(`[mailer:dev] 发信通道未配置，验证码（${purpose} ${to}）：${code}`);
    return true;
  }
  try {
    const response = await fetch(API_URL, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        ColaKey: MAIL_COLA_KEY,
        tomail: to,
        fromTitle: "ART/RANK",
        subject,
        content,
        isTextContent: false,
        smtpCode: MAIL_SMTP_CODE,
        smtpEmail: MAIL_SMTP_EMAIL,
        smtpCodeType,
      }),
    });
    if (!response.ok) return false;
    const body = (await response.json().catch(() => ({}))) as { code?: number; status?: number };
    // luckycola 成功形状兼容：code 0/200；无显式状态码时以 HTTP 200 为准。
    if (typeof body.code === "number") return body.code === 0 || body.code === 200;
    if (typeof body.status === "number") return body.status === 0 || body.status === 200;
    return true;
  } catch {
    return false;
  }
}
