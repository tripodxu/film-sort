// React 显式引入：wrangler 的 esbuild 对 worker TSX 走 classic runtime（React.createElement），
// 与 tsc 的 react-jsx 自动 runtime 双兼容。
import React from "react";
import {
  Body,
  Column,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Row,
  Section,
  Text,
} from "@react-email/components";

// 验证码邮件模板（React Email）——「夜间档案馆」印刷语言的纸上表达：
// 纸白底 + 墨色正文 + 双线分区 + mono 验证码铭牌 + 衬线报名。全部内联样式，邮件客户端安全。

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

export function VerificationCodeEmail({ action, code, minutes = 10 }: VerificationCodeEmailProps) {
  return (
    <Html lang="zh-CN">
      <Head />
      <Body style={{ margin: 0, background: paper, fontFamily: serif, color: ink }}>
        <Container style={{ maxWidth: 520, margin: "0 auto", padding: "36px 24px" }}>
          {/* 报名区：衬线叠印 + 柠檬斜线 */}
          <Section style={{ paddingBottom: 18 }}>
            <Row>
              <Column>
                <Heading
                  as="h1"
                  style={{
                    margin: 0,
                    fontFamily: serif,
                    fontSize: 30,
                    lineHeight: 1,
                    letterSpacing: 1,
                  }}
                >
                  ART
                  <span style={{ color: accent, fontStyle: "italic", padding: "0 4px" }}>/</span>
                  RANK
                </Heading>
              </Column>
              <Column align="right" style={{ verticalAlign: "bottom" }}>
                <Text
                  style={{
                    margin: 0,
                    fontFamily: mono,
                    fontSize: 10,
                    letterSpacing: 2,
                    color: inkSoft,
                    textTransform: "uppercase",
                  }}
                >
                  Personal culture index
                </Text>
              </Column>
            </Row>
          </Section>

          {/* 双线分区（印刷语言） */}
          <Hr style={{ border: "none", borderTop: `3px double ${hairline}`, margin: "0 0 22px" }} />

          <Text
            style={{
              margin: "0 0 6px",
              fontFamily: mono,
              fontSize: 10,
              letterSpacing: 3,
              color: inkSoft,
              textTransform: "uppercase",
            }}
          >
            Verification code · 验证码
          </Text>
          <Heading
            as="h2"
            style={{ margin: "0 0 18px", fontFamily: serif, fontSize: 20, fontWeight: 700 }}
          >
            你正在{action}
          </Heading>

          {/* 验证码铭牌 */}
          <Section
            style={{
              background: plate,
              border: `2px solid ${ink}`,
              borderRadius: 2,
              padding: "22px 0",
              textAlign: "center",
              margin: "0 0 18px",
            }}
          >
            <Text
              style={{
                margin: 0,
                fontFamily: mono,
                fontSize: 38,
                fontWeight: 700,
                letterSpacing: 12,
                color: ink,
                fontVariantNumeric: "tabular-nums",
              }}
            >
              {code}
            </Text>
          </Section>

          <Text style={{ margin: "0 0 4px", fontSize: 14, lineHeight: 1.9, color: ink }}>
            该验证码 <strong style={{ fontFamily: mono }}>{minutes} 分钟</strong>
            内有效，输入后即可{action}。
          </Text>
          <Text style={{ margin: 0, fontSize: 12, lineHeight: 1.9, color: inkSoft }}>
            若非本人操作，请忽略本邮件；验证码不要转发给任何人。
          </Text>

          <Hr
            style={{ border: "none", borderTop: `1px solid ${hairline}`, margin: "26px 0 14px" }}
          />
          <Text
            style={{
              margin: 0,
              fontFamily: mono,
              fontSize: 10,
              letterSpacing: 1,
              color: inkSoft,
            }}
          >
            ART/RANK · 自动发送，请勿回复
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

export default VerificationCodeEmail;
