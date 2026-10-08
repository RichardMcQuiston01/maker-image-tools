import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { MailerConfigError, sendMail } from "../src/mailer.js";
import { startFakeMailProvider, type FakeMailProvider } from "./fakeMailProvider.js";

const ENV_KEYS = ["MAIL_API_KEY", "MAIL_FROM_ADDRESS", "MAIL_API_URL"] as const;

describe("sendMail", () => {
  let provider: FakeMailProvider;
  const originalEnv: Record<string, string | undefined> = {};

  beforeEach(async () => {
    for (const key of ENV_KEYS) originalEnv[key] = process.env[key];
    provider = await startFakeMailProvider();
    process.env.MAIL_API_KEY = "fake-mail-api-key";
    process.env.MAIL_FROM_ADDRESS = "billing@example.com";
    process.env.MAIL_API_URL = provider.baseUrl;
  });

  afterEach(async () => {
    await provider.close();
    for (const key of ENV_KEYS) {
      if (originalEnv[key] === undefined) delete process.env[key];
      else process.env[key] = originalEnv[key];
    }
  });

  it("sends a plain-text email via the configured provider", async () => {
    await sendMail({ to: "user@example.com", subject: "Hello", text: "Hi there" });
    expect(provider.sent).toEqual([
      {
        from: "billing@example.com",
        to: "user@example.com",
        subject: "Hello",
        text: "Hi there",
      },
    ]);
  });

  it("throws when the provider responds with an error status", async () => {
    provider.failWithStatus = 500;
    await expect(sendMail({ to: "user@example.com", subject: "Hi", text: "Hi" })).rejects.toThrow(
      "responded with 500",
    );
  });

  it("throws MailerConfigError when MAIL_API_KEY is missing", async () => {
    delete process.env.MAIL_API_KEY;
    await expect(sendMail({ to: "user@example.com", subject: "Hi", text: "Hi" })).rejects.toThrow(
      MailerConfigError,
    );
  });

  it("throws MailerConfigError when MAIL_FROM_ADDRESS is missing", async () => {
    delete process.env.MAIL_FROM_ADDRESS;
    await expect(sendMail({ to: "user@example.com", subject: "Hi", text: "Hi" })).rejects.toThrow(
      MailerConfigError,
    );
  });
});
