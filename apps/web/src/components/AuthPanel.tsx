import { useCallback, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { ACCOUNTS_URL } from "../lib/accountsUrl";

type Mode = "login" | "signup";

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
