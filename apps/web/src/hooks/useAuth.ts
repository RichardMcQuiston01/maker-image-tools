import { useContext } from "react";
import { AuthContext, type UseAuthResult } from "./AuthContext";

export type { AuthUser, AuthStatus, UseAuthResult } from "./AuthContext";

/**
 * Talks to the `@maker/accounts` service via the shared session held by the
 * nearest `AuthProvider` - sessions are bearer tokens (not cookies), so the
 * token is persisted in localStorage and re-validated against `/me` once,
 * on the provider's mount (see apps/accounts/README.md for the contract).
 */
export function useAuth(): UseAuthResult {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error("useAuth must be used within an <AuthProvider>");
  }
  return context;
}
