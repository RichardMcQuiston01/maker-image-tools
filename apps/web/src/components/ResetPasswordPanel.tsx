import { useCallback, useMemo, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { ACCOUNTS_URL } from "../lib/accountsUrl";

interface ResetPasswordPanelProps {
  /** The full hash route, e.g. "/reset-password?token=...". */
  route: string;
}

/**
 * Landing spot for a password-reset email's link
 * (".../#/reset-password?token=..."). Lets the user set a new password via
 * `POST /password-reset/confirm`, then adopts the session token it hands
 * back the same way `OAuthCallbackPanel` adopts its own - via
 * `completeOAuthLogin`, which re-fetches `/me` and updates the shared
 * session state.
 */
export function ResetPasswordPanel({ route }: ResetPasswordPanelProps) {
  const { completeOAuthLogin } = useAuth();
  const token = useMemo(() => new URLSearchParams(route.split("?")[1] ?? "").get("token"), [route]);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = useCallback(async () => {
    if (!token || !newPassword) return;
    try {
      setBusy(true);
      setError(null);
      const response = await fetch(`${ACCOUNTS_URL}/password-reset/confirm`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ token, password: newPassword }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        throw new Error(body.error ?? `Password reset failed with ${response.status}`);
      }
      const body = (await response.json()) as { token: string };
      await completeOAuthLogin(body.token);
      window.location.hash = "#/editor";
    } catch (err) {
      setError(err instanceof Error ? err.message : "Password reset failed");
    } finally {
      setBusy(false);
    }
  }, [token, newPassword, completeOAuthLogin]);

  if (!token) {
    return (
      <div className="reset-password">
        <p role="alert" className="reset-password__error">
          This reset link is missing its token.
        </p>
        <a href="#/editor">Back to the editor</a>
      </div>
    );
  }

  return (
    <div className="reset-password">
      <h2>Set a new password</h2>
      {error && (
        <p role="alert" className="reset-password__error">
          {error}
        </p>
      )}
      <input
        type="password"
        placeholder="New password"
        value={newPassword}
        disabled={busy}
        onChange={(event) => setNewPassword(event.target.value)}
      />
      <button type="button" disabled={busy || !newPassword} onClick={() => void handleSubmit()}>
        Reset password
      </button>
    </div>
  );
}
