import { useCallback, useEffect, useState } from "react";
import { ACCOUNTS_URL } from "../lib/accountsUrl";

export interface AuthUser {
  id: string;
  email: string;
  planTier: string;
  createdAt: string;
}

export type AuthStatus = "loading" | "signed-out" | "signed-in" | "working";

export interface UseAuthResult {
  status: AuthStatus;
  user: AuthUser | null;
  error: string | null;
  signup: (email: string, password: string) => Promise<void>;
  login: (email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
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

/**
 * Talks to the `@maker/accounts` service. Sessions are bearer tokens (not
 * cookies), so the token is persisted in localStorage and re-validated
 * against `/me` on load - matching the accounts service's documented client
 * contract (see apps/accounts/README.md).
 */
export function useAuth(): UseAuthResult {
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

  return { status, user, error, signup, login, logout };
}
