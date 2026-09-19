import { useCallback, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { ACCOUNTS_URL } from "../lib/accountsUrl";

type Mode = "login" | "signup" | "request-reset";

/**
 * Owns its own "does this account have a password" state, seeded once from
 * `initiallyHasPassword` (see the `key={user.id}` on the caller, which resets
 * this per signed-in user). Deliberately doesn't just check the shared
 * `user.hasPassword` on every render - `refreshUser()` below updates that
 * shared value on success, which would otherwise unmount this component
 * (via the caller's own `!user.hasPassword` check) before its "done" message
 * ever got a chance to show.
 */
function SetPasswordForm({ initiallyHasPassword }: { initiallyHasPassword: boolean }) {
  const { token, refreshUser } = useAuth();
  const [hasPassword, setHasPassword] = useState(initiallyHasPassword);
  const [newPassword, setNewPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  const handleSetPassword = useCallback(async () => {
    if (!token || !newPassword) return;
    try {
      setBusy(true);
      setError(null);
      const response = await fetch(`${ACCOUNTS_URL}/me/password`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
        body: JSON.stringify({ password: newPassword }),
      });
      if (!response.ok) {
        throw new Error(`Setting a password failed with ${response.status}`);
      }
      setHasPassword(true);
      setDone(true);
      setNewPassword("");
      void refreshUser();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to set a password");
    } finally {
      setBusy(false);
    }
  }, [token, newPassword, refreshUser]);

  if (hasPassword) {
    return done ? (
      <p className="auth-panel__hint">Password set - you can now log in with it too.</p>
    ) : null;
  }

  return (
    <div className="auth-panel__set-password">
      <p className="auth-panel__hint">
        You signed up via an OAuth provider. Set a password to also be able to log in directly.
      </p>
      {error && (
        <p role="alert" className="auth-panel__error">
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
      <button
        type="button"
        disabled={busy || !newPassword}
        onClick={() => void handleSetPassword()}
      >
        Set password
      </button>
    </div>
  );
}

/**
 * Links for attaching another OAuth provider to the signed-in account, via
 * `/oauth/:provider/start?linkToken=<session token>` - @maker/accounts
 * validates the session server-side and links the resulting identity to that
 * caller instead of running the ordinary login flow. The round trip lands
 * back on `OAuthCallbackPanel` exactly like a login would (same success/error
 * query params), so no special-casing is needed there.
 */
function ConnectProviderLinks({ token }: { token: string }) {
  return (
    <div className="auth-panel__oauth auth-panel__oauth--connect">
      <p className="auth-panel__hint">Connect another sign-in method:</p>
      <a href={`${ACCOUNTS_URL}/oauth/google/start?linkToken=${encodeURIComponent(token)}`}>
        Connect Google
      </a>
      <a href={`${ACCOUNTS_URL}/oauth/github/start?linkToken=${encodeURIComponent(token)}`}>
        Connect GitHub
      </a>
      <a href={`${ACCOUNTS_URL}/oauth/discord/start?linkToken=${encodeURIComponent(token)}`}>
        Connect Discord
      </a>
    </div>
  );
}

/**
 * The "Forgot password?" flow - a bare email field posted to
 * `POST /password-reset/request`, which always responds the same way
 * whether or not the email is registered (see server.ts), so this only ever
 * shows the same generic "link was sent" confirmation rather than revealing
 * whether an account exists.
 */
function ForgotPasswordForm({ onBackToLogin }: { onBackToLogin: () => void }) {
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sent, setSent] = useState(false);

  const handleSubmit = useCallback(async () => {
    if (!email) return;
    try {
      setBusy(true);
      setError(null);
      const response = await fetch(`${ACCOUNTS_URL}/password-reset/request`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
      if (!response.ok) {
        throw new Error(`Request failed with ${response.status}`);
      }
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to request a password reset");
    } finally {
      setBusy(false);
    }
  }, [email]);

  if (sent) {
    return (
      <div className="auth-panel">
        <p className="auth-panel__hint">
          If an account exists for that email, a password reset link was sent.
        </p>
        <button type="button" className="auth-panel__switch" onClick={onBackToLogin}>
          Back to log in
        </button>
      </div>
    );
  }

  return (
    <div className="auth-panel">
      <input
        type="email"
        placeholder="Email"
        value={email}
        disabled={busy}
        onChange={(event) => setEmail(event.target.value)}
      />
      <button type="button" disabled={busy || !email} onClick={() => void handleSubmit()}>
        Send reset link
      </button>
      <button type="button" className="auth-panel__switch" disabled={busy} onClick={onBackToLogin}>
        Back to log in
      </button>
      {error && (
        <p role="alert" className="auth-panel__error">
          {error}
        </p>
      )}
    </div>
  );
}

export function AuthPanel() {
  const { status, user, token, error, signup, login, logout } = useAuth();
  const [mode, setMode] = useState<Mode>("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const busy = status === "working" || status === "loading";

  const handleSubmit = useCallback(() => {
    if (!email || !password) return;
    void (mode === "signup" ? signup(email, password) : login(email, password));
  }, [mode, email, password, signup, login]);

  const handleLogout = useCallback(() => {
    void logout();
    setMode("login");
    setEmail("");
    setPassword("");
  }, [logout]);

  if (status === "signed-in" && user) {
    return (
      <div className="auth-panel auth-panel--signed-in">
        <span className="auth-panel__user">{user.email}</span>
        <button type="button" onClick={handleLogout}>
          Log out
        </button>
        <SetPasswordForm key={user.id} initiallyHasPassword={user.hasPassword} />
        {token && <ConnectProviderLinks token={token} />}
      </div>
    );
  }

  // Checked after signed-in, not before: a sign-in can happen from outside
  // this component too (e.g. ResetPasswordPanel adopting a session after a
  // successful password reset) without this component's own `mode` ever
  // changing - the signed-in view must win over a stale "request-reset" mode
  // left over from before that happened.
  if (mode === "request-reset") {
    return <ForgotPasswordForm onBackToLogin={() => setMode("login")} />;
  }

  return (
    <div className="auth-panel">
      <input
        type="email"
        placeholder="Email"
        value={email}
        disabled={busy}
        onChange={(event) => setEmail(event.target.value)}
      />
      <input
        type="password"
        placeholder="Password"
        value={password}
        disabled={busy}
        onChange={(event) => setPassword(event.target.value)}
      />
      <button type="button" disabled={busy || !email || !password} onClick={handleSubmit}>
        {mode === "signup" ? "Sign up" : "Log in"}
      </button>
      <button
        type="button"
        className="auth-panel__switch"
        disabled={busy}
        onClick={() => setMode(mode === "signup" ? "login" : "signup")}
      >
        {mode === "signup" ? "Have an account? Log in" : "Need an account? Sign up"}
      </button>
      {mode === "login" && (
        <button
          type="button"
          className="auth-panel__switch"
          disabled={busy}
          onClick={() => setMode("request-reset")}
        >
          Forgot password?
        </button>
      )}
      {error && (
        <p role="alert" className="auth-panel__error">
          {error}
        </p>
      )}
      <div className="auth-panel__oauth">
        <a href={`${ACCOUNTS_URL}/oauth/google/start`}>Continue with Google</a>
        <a href={`${ACCOUNTS_URL}/oauth/github/start`}>Continue with GitHub</a>
        <a href={`${ACCOUNTS_URL}/oauth/discord/start`}>Continue with Discord</a>
      </div>
    </div>
  );
}
