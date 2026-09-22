// 发信通道 v3（2026-09-22）：Resend 主通道（全球可达）+ luckycola customMail 兜底（CN 出口）。
//
// 定罪记录：luckycola 对 Cloudflare 海外出口返回业务拒绝 code:-14（同 key 同 payload 本机 CN IP 恒通；
// 编码/UA/文案/收件人变量已逐一实验排除）——纯 CF 架构下它只能作兜底，不能作主通道。
// luckycola 契约与配置键仍 1:1 照抄 scripts/mail_sender.py（temp_mail 工作区）。
//
// 环境变量：
//   RESEND_API_KEY            —— Resend API key（主通道）
//   MAIL_FROM                 —— 发件人显示（默认 "ART/RANK <onboarding@resend.dev>"；
//                                Resend 未验证域名前仅可用 onboarding@resend.dev 且只能发到账号自有邮箱）
//   MAIL_COLA_KEY / MAIL_SMTP_EMAIL / MAIL_SMTP_CODE / MAIL_SMTP_TYPE —— luckycola 兜底（同 mail_sender.py）

//   MAIL_FROM                 —— 发件人显示（默认 "ART-RANK <noreply@email.logicc.top>"，域名已验证）

export interface MailerEnv {
  RESEND_API_KEY?: string;
  MAIL_FROM?: string;
  MAIL_COLA_KEY?: string;
  MAIL_SMTP_EMAIL?: string;
  MAIL_SMTP_CODE?: string;
  MAIL_SMTP_TYPE?: string;
}

export interface SendResult {
  ok: boolean;
  reason?: string;
}

import { createElement } from "react";
// 显式 browser 入口：react-dom/server 默认导出条件在 workerd 下解析到 Node 版（node:stream → 崩）。
import { renderToStaticMarkup } from "react-dom/server.browser";
import { VerificationCodeEmail } from "./VerificationCodeEmail";

const RESEND_URL = "https://api.resend.com/emails";
const LUCKYCOLA_URLS = [
  "https://luckycola.com/tools/customMail",
  "https://luckycola.com.cn/tools/customMail",
];

function buildHtml(action: string, code: string): string {
  // React Email 模板（worker/VerificationCodeEmail.tsx）→ 静态标记；react-dom/server 在 Workers 运行时安全。
  return (
    "<!DOCTYPE html>" + renderToStaticMarkup(createElement(VerificationCodeEmail, { action, code }))
  );
}

/** Resend 主通道。 */
async function sendViaResend(
  apiKey: string,
  from: string,
  to: string,
  subject: string,
  html: string,
): Promise<SendResult> {
  try {
    const response = await fetch(RESEND_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ from, to: [to], subject, html }),
    });
    const raw = await response.text();
    let body: { id?: string; name?: string; message?: string } = {};
    try {
      body = JSON.parse(raw) as typeof body;
    } catch {
      return { ok: false, reason: `resend_bad_response_${response.status}` };
    }
    if (response.ok && body.id) return { ok: true };
    return {
      ok: false,
      reason: `resend_${body.name ?? `http_${response.status}`}:${(body.message ?? "").slice(0, 80)}`,
    };
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return { ok: false, reason: /time/i.test(msg) ? "resend_timeout" : "resend_fetch_error" };
  }
}

/** luckycola 兜底（双出口：.com 全球可解析 / .com.cn 仅 CN；契约同 mail_sender.py）。 */
async function sendViaLuckyCola(
  env: MailerEnv,
  to: string,
  subject: string,
  html: string,
): Promise<SendResult> {
  const { MAIL_COLA_KEY, MAIL_SMTP_EMAIL, MAIL_SMTP_CODE } = env;
  if (!MAIL_COLA_KEY || !MAIL_SMTP_EMAIL || !MAIL_SMTP_CODE)
    return { ok: false, reason: "luckycola_unconfigured" };
  const payload = JSON.stringify({
    ColaKey: MAIL_COLA_KEY,
    tomail: to,
    fromTitle: "ART/RANK",
    subject,
    content: html,
    isTextContent: false,
    smtpCode: MAIL_SMTP_CODE,
    smtpEmail: MAIL_SMTP_EMAIL,
    smtpCodeType: env.MAIL_SMTP_TYPE ?? "163",
  });
  let lastReason = "luckycola_unknown";
  for (const apiUrl of LUCKYCOLA_URLS) {
    try {
      const response = await fetch(apiUrl, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: payload,
      });
      const raw = await response.text();
      let body: { code?: number; status?: number } = {};
      try {
        body = JSON.parse(raw) as { code?: number; status?: number };
      } catch {
        lastReason = `luckycola_bad_response_${response.status}`;
        continue;
      }
      if (!response.ok) {
        lastReason = `luckycola_http_${response.status}`;
        continue;
      }
      // luckycola 成功形状（实测）：{ code: 0, msg, data }
      if (typeof body.code === "number") {
        if (body.code === 0 || body.code === 200) return { ok: true };
        lastReason = `luckycola_code_${body.code}`;
        continue;
      }
      if (typeof body.status === "number") {
        if (body.status === 0 || body.status === 200) return { ok: true };
        lastReason = `luckycola_status_${body.status}`;
        continue;
      }
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      lastReason = /time/i.test(msg) ? "luckycola_timeout" : "luckycola_fetch_error";
      continue;
    }
  }
  return { ok: false, reason: lastReason };
}

/** 下发验证码邮件（注册 / 修改密码共用）：Resend 优先，luckycola 兜底，全灭才失败。 */
export async function sendVerificationCode(
  env: MailerEnv,
  to: string,
  code: string,
  purpose: "register" | "reset",
): Promise<SendResult> {
  const action = purpose === "register" ? "完成注册" : "修改密码";
  const subject = `ART/RANK ${action}验证码`;
  const html = buildHtml(action, code);

  if (env.RESEND_API_KEY) {
    const result = await sendViaResend(
      env.RESEND_API_KEY,
      env.MAIL_FROM ?? "ART-RANK <noreply@email.logicc.top>",
      to,
      subject,
      html,
    );
    if (result.ok) return result;
    // Resend 失败不直接报死——落 luckycola 兜底；两边都死才返回失败（保留两边病因）。
    const fallback = await sendViaLuckyCola(env, to, subject, html);
    if (fallback.ok) return fallback;
    return { ok: false, reason: `${result.reason}+${fallback.reason}` };
  }

  const fallback = await sendViaLuckyCola(env, to, subject, html);
  if (fallback.ok) return fallback;
  if (fallback.reason === "luckycola_unconfigured") {
    // 双通道全未配置：开发兜底，验证码仅写日志。
    console.warn(`[mailer:dev] 发信通道未配置，验证码（${purpose} ${to}）：${code}`);
    return { ok: true, reason: "dev" };
  }
  return fallback;
}
