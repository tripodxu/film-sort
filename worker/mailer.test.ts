import { describe, expect, it, vi } from "vitest";
import { sendVerificationCode } from "./mailer";

describe("verification mailer", () => {
  it("fails closed when no provider is configured in production", async () => {
    const result = await sendVerificationCode(
      { ENVIRONMENT: "production" },
      "a@example.com",
      "123456",
      "register",
    );
    expect(result).toEqual({ ok: false, reason: "mailer_unconfigured" });
  });

  it("does not log the OTP when production is unconfigured", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    await sendVerificationCode(
      { ENVIRONMENT: "production" },
      "a@example.com",
      "123456",
      "reset",
    );
    expect(warn).not.toHaveBeenCalled();
  });
});
