// 验证码邮件模板（纯 HTML + 严格转义，无 React/react-dom 运行时开销）——
// 「夜间档案馆」印刷语言的纸上表达：纸白底 + 墨色正文 + 双线分区 + mono 验证码铭牌 + 衬线报名。

const ink = "#1a1a17";
const inkSoft = "#57564f";
const hairline = "#d8d6cd";
const paper = "#f7f6f1";
const accent = "#c5e63a";
const plate = "#ffffff";

const serif = "Georgia, 'Songti SC', 'STSong', SimSun, serif";
const mono = "'SF Mono', Consolas, 'Courier New', monospace";

export interface VerificationCodeEmailProps {
  /** 中文动作名：完成注册 / 修改密码 */
  action: string;
  code: string;
  minutes?: number;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export function renderVerificationCodeEmailHtml({
  action,
  code,
  minutes = 10,
}: VerificationCodeEmailProps): string {
  const safeAction = escapeHtml(action);
  const safeCode = escapeHtml(code);
  const safeMinutes = escapeHtml(String(minutes));
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head><meta charset="utf-8" /></head>
<body style="margin:0;background:${paper};font-family:${serif};color:${ink};">
  <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="background:${paper};">
    <tr>
      <td align="center" style="padding:36px 24px;">
        <table role="presentation" width="100%" cellspacing="0" cellpadding="0" style="max-width:520px;margin:0 auto;">
          <tr>
            <td style="padding-bottom:18px;">
              <table role="presentation" width="100%" cellspacing="0" cellpadding="0">
                <tr>
                  <td>
                    <h1 style="margin:0;font-family:${serif};font-size:30px;line-height:1;letter-spacing:1px;">
                      ART<span style="color:${accent};font-style:italic;padding:0 4px;">/</span>RANK
                    </h1>
                  </td>
                  <td align="right" valign="bottom">
                    <p style="margin:0;font-family:${mono};font-size:10px;letter-spacing:2px;color:${inkSoft};text-transform:uppercase;">
                      Personal culture index
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <tr>
            <td>
              <hr style="border:none;border-top:3px double ${hairline};margin:0 0 22px;" />
              <p style="margin:0 0 6px;font-family:${mono};font-size:10px;letter-spacing:3px;color:${inkSoft};text-transform:uppercase;">
                Verification code · 验证码
              </p>
              <h2 style="margin:0 0 18px;font-family:${serif};font-size:20px;font-weight:700;">
                你正在${safeAction}
              </h2>
              <div style="background:${plate};border:2px solid ${ink};border-radius:2px;padding:22px 0;text-align:center;margin:0 0 18px;">
                <p style="margin:0;font-family:${mono};font-size:38px;font-weight:700;letter-spacing:12px;color:${ink};font-variant-numeric:tabular-nums;">
                  ${safeCode}
                </p>
              </div>
              <p style="margin:0 0 4px;font-size:14px;line-height:1.9;color:${ink};">
                该验证码 <strong style="font-family:${mono};">${safeMinutes} 分钟</strong>内有效，输入后即可${safeAction}。
              </p>
              <p style="margin:0;font-size:12px;line-height:1.9;color:${inkSoft};">
                若非本人操作，请忽略本邮件；验证码不要转发给任何人。
              </p>
              <hr style="border:none;border-top:1px solid ${hairline};margin:26px 0 14px;" />
              <p style="margin:0;font-family:${mono};font-size:10px;letter-spacing:1px;color:${inkSoft};">
                ART/RANK · 自动发送，请勿回复
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}
