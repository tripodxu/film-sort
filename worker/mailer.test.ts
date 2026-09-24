import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { sendVerificationCode } from "./mailer";

type MailerTestEnv = Omit<Parameters<typeof sendVerificationCode>[0], "ENVIRONMENT"> & {
  ENVIRONMENT?: "production" | "development" | "test" | "staging";
};

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  vi.stubGlobal("fetch", fetchMock);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("verification mailer", () => {
  it("fails closed when no provider is configured in production", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env: MailerTestEnv = { ENVIRONMENT: "production" };
    const result = await sendVerificationCode(env, "a@example.com", "123456", "register");

    expect(result).toEqual({ ok: false, reason: "mailer_unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("fails closed when ENVIRONMENT is omitted", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const result = await sendVerificationCode({}, "a@example.com", "123456", "register");

    expect(result).toEqual({ ok: false, reason: "mailer_unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it("fails closed when ENVIRONMENT is unknown", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const env: MailerTestEnv = { ENVIRONMENT: "staging" };
    const result = await sendVerificationCode(env, "a@example.com", "123456", "register");

    expect(result).toEqual({ ok: false, reason: "mailer_unconfigured" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it.each(["development", "test"] as const)(
    "uses the development fallback without network access in %s",
    async (environment) => {
      const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
      const env: MailerTestEnv = { ENVIRONMENT: environment };
      const result = await sendVerificationCode(env, "a@example.com", "123456", "reset");

      expect(result).toEqual({ ok: true, reason: "dev" });
      expect(fetchMock).not.toHaveBeenCalled();
      expect(warn).toHaveBeenCalledTimes(1);
    },
  );
});
