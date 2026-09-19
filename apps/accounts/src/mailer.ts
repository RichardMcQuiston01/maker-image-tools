/** Thrown when MAIL_API_KEY or MAIL_FROM_ADDRESS is missing/blank - a deployment misconfiguration,
 * not a bad request. */
export class MailerConfigError extends Error {}

function envOrDefault(name: string, defaultValue: string): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value : defaultValue;
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value || value.trim().length === 0) {
    throw new MailerConfigError(
      `Missing ${name} environment variable. Set it to enable sending email (password reset, ` +
        "email verification).",
    );
  }
  return value;
}

/**
 * Resend's (https://resend.com) email-sending endpoint - a single `POST` with
 * a JSON body, no SDK needed. `MAIL_API_URL` overrides the default, the same
 * way `oauth.ts`'s provider URL env vars do, so tests can point this at a
 * local fake HTTP server instead (see `test/fakeMailProvider.ts`) rather than
 * reaching a real provider from this sandbox.
 */
function mailApiUrl(): string {
  return envOrDefault("MAIL_API_URL", "https://api.resend.com/emails");
}

export interface SendMailOptions {
  to: string;
  subject: string;
  text: string;
}

/**
 * Sends a plain-text email via the configured provider. Fails fast (like
 * every other external-service client in this repo - Stripe, S3, OAuth) if
 * `MAIL_API_KEY`/`MAIL_FROM_ADDRESS` aren't set, rather than silently
 * dropping the email.
 */
export async function sendMail({ to, subject, text }: SendMailOptions): Promise<void> {
  const apiKey = requireEnv("MAIL_API_KEY");
  const from = requireEnv("MAIL_FROM_ADDRESS");

  const response = await fetch(mailApiUrl(), {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ from, to, subject, text }),
  });
  if (!response.ok) {
    throw new Error(`Email send to "${to}" responded with ${response.status}`);
  }
}
