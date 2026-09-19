import { createContext, useCallback, useEffect, useState, type ReactNode } from "react";
import { ACCOUNTS_URL } from "../lib/accountsUrl";

export interface AuthUser {
  id: string;
  email: string;
  planTier: string;
  role: string;
  hasPassword: boolean;
  emailVerified: boolean;
  createdAt: string;
}

export type AuthStatus = "loading" | "signed-out" | "signed-in" | "working";

export interface UseAuthResult {
  status: AuthStatus;
  user: AuthUser | null;
  /** The current session's bearer token, for callers that need to hit @maker/accounts directly (e.g. role-management). Null when signed out. */
  token: string | null;
  error: string | null;
  signup: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Adopts a session token @maker/accounts' OAuth callback handed back in the URL. */
  completeOAuthLogin: (token: string) => Promise<void>;
  /** Re-fetches `/me` and updates `user` - for a caller that just changed something about the signed-in user server-side (e.g. setting a password) and needs the shared state to reflect it. No-op when signed out. */
  refreshUser: () => Promise<void>;
}

const TOKEN_STORAGE_KEY = "maker.accounts.token";

function readStoredToken(): string | null {
  try {
    return window.localStorage.getItem(TOKEN_STORAGE_KEY);
  } catch {
    return null;
  }
}

function writeStoredToken(token: string | null): void {
  try {
    if (token) {
      window.localStorage.setItem(TOKEN_STORAGE_KEY, token);
    } else {
      window.localStorage.removeItem(TOKEN_STORAGE_KEY);
    }
  } catch {
    // localStorage unavailable (e.g. disabled/full) - session still works for this page load
  }
}

async function parseErrorMessage(response: Response, fallback: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: string };
    return body.error ?? fallback;
  } catch {
    return fallback;
  }
}

export const AuthContext = createContext<UseAuthResult | null>(null);

/**
 * Owns the single shared session for the whole app - every `useAuth()` call
 * reads from this same state, so signing in from one panel (e.g. AuthPanel)
 * is immediately reflected in every other panel that depends on being
 * signed in (BillingPanel, CloudProjectsPanel, MaterialDbPanel, ...).
 */
export function AuthProvider({ children }: { children: ReactNode }) {
  const [token, setToken] = useState<string | null>(readStoredToken);
  const [status, setStatus] = useState<AuthStatus>(() =>
    readStoredToken() ? "loading" : "signed-out",
  );
  const [user, setUser] = useState<AuthUser | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Re-validates a token persisted from a previous page load against `/me`.
  // Runs once on mount only - a token set later by signup/login already comes
  // with its `user` from that response, so re-fetching here would be
  // redundant and could race with (and clobber) the freshly signed-in state.
  useEffect(() => {
    const storedToken = readStoredToken();
    if (!storedToken) {
      setStatus("signed-out");
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch(`${ACCOUNTS_URL}/me`, {
          headers: { Authorization: `Bearer ${storedToken}` },
        });
        if (cancelled) return;
        if (!response.ok) {
          writeStoredToken(null);
          setToken(null);
          setStatus("signed-out");
          return;
        }
        const body = (await response.json()) as { user: AuthUser };
        setUser(body.user);
        setStatus("signed-in");
      } catch {
        if (cancelled) return;
        setError(
          "Failed to reach the accounts service (is the @maker/accounts dev server running?)",
        );
        setStatus("signed-out");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const authenticate = useCallback(
    async (path: "/signup" | "/login", email: string, password: string) => {
      setStatus("working");
      setError(null);
      try {
        const response = await fetch(`${ACCOUNTS_URL}${path}`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email, password }),
        });
        if (!response.ok) {
          const fallback = path === "/signup" ? "Signup failed" : "Invalid email or password";
          throw new Error(await parseErrorMessage(response, fallback));
        }
        const body = (await response.json()) as { user: AuthUser; token: string };
        writeStoredToken(body.token);
        setToken(body.token);
        setUser(body.user);
        setStatus("signed-in");
      } catch (err) {
        setStatus("signed-out");
        setError(
          err instanceof Error
            ? `${err.message} (is the @maker/accounts dev server running?)`
            : "Authentication failed",
        );
      }
    },
    [],
  );

  const signup = useCallback(
    (email: string, password: string) => authenticate("/signup", email, password),
    [authenticate],
  );
  const login = useCallback(
    (email: string, password: string) => authenticate("/login", email, password),
    [authenticate],
  );

  const completeOAuthLogin = useCallback(async (oauthToken: string) => {
    setStatus("working");
    setError(null);
    try {
      const response = await fetch(`${ACCOUNTS_URL}/me`, {
        headers: { Authorization: `Bearer ${oauthToken}` },
      });
      if (!response.ok) {
        throw new Error(await parseErrorMessage(response, "OAuth sign-in failed"));
      }
      const body = (await response.json()) as { user: AuthUser };
      writeStoredToken(oauthToken);
      setToken(oauthToken);
      setUser(body.user);
      setStatus("signed-in");
    } catch (err) {
      setStatus("signed-out");
      setError(
        err instanceof Error
          ? `${err.message} (is the @maker/accounts dev server running?)`
          : "OAuth sign-in failed",
      );
    }
  }, []);

  const refreshUser = useCallback(async () => {
    if (!token) return;
    try {
      const response = await fetch(`${ACCOUNTS_URL}/me`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!response.ok) return;
      const body = (await response.json()) as { user: AuthUser };
      setUser(body.user);
    } catch {
      // best-effort; the caller's own success/error handling already covers the action that prompted this
    }
  }, [token]);

  const logout = useCallback(async () => {
    if (token) {
      try {
        await fetch(`${ACCOUNTS_URL}/logout`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {
        // best-effort; the local session is cleared regardless
      }
    }
    writeStoredToken(null);
    setToken(null);
    setUser(null);
    setStatus("signed-out");
  }, [token]);

  return (
    <AuthContext.Provider
      value={{ status, user, token, error, signup, login, logout, completeOAuthLogin, refreshUser }}
    >
      {children}
    </AuthContext.Provider>
  );
}
