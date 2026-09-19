import { useCallback, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { ACCOUNTS_URL } from "../lib/accountsUrl";

type Mode = "login" | "signup";

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

export function AuthPanel() {
  const { status, user, error, signup, login, logout } = useAuth();
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
