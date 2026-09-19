import { useEffect, useRef, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { ACCOUNTS_URL } from "../lib/accountsUrl";

interface EmailVerificationPanelProps {
  /** The full hash route, e.g. "/verify-email?token=...". */
  route: string;
}

/**
 * Landing spot for a verification email's link (".../#/verify-email?token=...").
 * Unlike ResetPasswordPanel there's no form to fill in - confirming a
 * verification token needs no further input, so this posts the token as
 * soon as it mounts, the same auto-processing pattern OAuthCallbackPanel
 * uses for its own token. Doesn't adopt a session (`POST /verify-email`
 * doesn't return one - the caller may not even be signed in on this
 * browser/device); if the caller happens to already be signed in here,
 * `refreshUser()` picks up the new `emailVerified` status so AuthPanel's
 * "verify your email" hint clears without a page reload.
 */
export function EmailVerificationPanel({ route }: EmailVerificationPanelProps) {
  const { refreshUser } = useAuth();
  const [status, setStatus] = useState<"pending" | "done" | "error">("pending");
  const [error, setError] = useState<string | null>(null);
  // Confirming a token isn't idempotent - a second attempt with the same
  // token fails with "already used" - so a real network request must only
  // ever fire once per token, even though React StrictMode's dev-only mount
  // -> cleanup -> mount cycle runs this effect's body twice (unlike
  // OAuthCallbackPanel's idempotent GET /me, there's no safe way to just let
  // a duplicate call happen here). This caches the in-flight/settled
  // confirmation by token so the second invocation reuses the same result
  // instead of firing its own request; each invocation still applies that
  // result to state only if it's the one still mounted when it resolves.
  const confirmationRef = useRef<{
    token: string;
    result: Promise<{ ok: boolean; body: { error?: string } }>;
  } | null>(null);

  useEffect(() => {
    const token = new URLSearchParams(route.split("?")[1] ?? "").get("token");
    if (!token) {
      setStatus("error");
      setError("This verification link is missing its token.");
      return;
    }

    if (confirmationRef.current?.token !== token) {
      confirmationRef.current = {
        token,
        result: fetch(`${ACCOUNTS_URL}/verify-email`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        })
          .then(async (response) => ({
            ok: response.ok,
            body: (await response.json().catch(() => ({}))) as { error?: string },
          }))
          .catch(() => ({ ok: false, body: {} }) as const),
      };
    }

    let cancelled = false;
    confirmationRef.current.result.then(({ ok, body }) => {
      if (cancelled) return;
      if (!ok) {
        setStatus("error");
        setError(body.error ?? "Email verification failed");
        return;
      }
      setStatus("done");
      void refreshUser();
    });
    return () => {
      cancelled = true;
    };
  }, [route, refreshUser]);

  if (status === "error") {
    return (
      <div className="email-verification">
        <p role="alert" className="email-verification__error">
          {error}
        </p>
        <a href="#/editor">Back to the editor</a>
      </div>
    );
  }

  if (status === "done") {
    return (
      <div className="email-verification">
        <p>Your email is verified.</p>
        <a href="#/editor">Back to the editor</a>
      </div>
    );
  }

  return <p className="email-verification__pending">Verifying your email…</p>;
}
