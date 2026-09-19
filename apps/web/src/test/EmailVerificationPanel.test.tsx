import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { StrictMode } from "react";
import { render, screen } from "@testing-library/react";
import { EmailVerificationPanel } from "../components/EmailVerificationPanel";
import { AuthProvider } from "../hooks/AuthContext";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const SIGNED_IN_USER = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "ada@example.com",
  planTier: "free",
  role: "user",
  hasPassword: true,
  emailVerified: false,
  createdAt: "2026-01-01T00:00:00Z",
};

function renderPanel(route: string) {
  return render(
    <AuthProvider>
      <EmailVerificationPanel route={route} />
    </AuthProvider>,
  );
}

describe("EmailVerificationPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = "";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("confirms the token and shows success", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { user: { ...SIGNED_IN_USER, emailVerified: true } }),
    );

    renderPanel("/verify-email?token=fake-verify-token");

    expect(await screen.findByText(/Your email is verified/)).toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/verify-email");
    expect(JSON.parse(String(init?.body))).toEqual({ token: "fake-verify-token" });
  });

  it("refreshes the signed-in user's state on success", async () => {
    window.localStorage.setItem("maker.accounts.token", "existing-session-token");
    const fetchMock = vi.mocked(fetch);
    // AuthProvider's mount-time /me re-validation.
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    // EmailVerificationPanel's confirm.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { user: { ...SIGNED_IN_USER, emailVerified: true } }),
    );
    // refreshUser()'s follow-up /me.
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { user: { ...SIGNED_IN_USER, emailVerified: true } }),
    );

    renderPanel("/verify-email?token=fake-verify-token");

    expect(await screen.findByText(/Your email is verified/)).toBeInTheDocument();
    await vi.waitFor(() => expect(fetchMock.mock.calls).toHaveLength(3));
    const [refreshUrl] = fetchMock.mock.calls[2]!;
    expect(String(refreshUrl)).toContain("/me");
  });

  it("shows an error when confirmation is rejected", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { error: "Invalid, expired, or already-used verification token" }),
    );

    renderPanel("/verify-email?token=stale-token");

    expect(
      await screen.findByText(/Invalid, expired, or already-used verification token/),
    ).toBeInTheDocument();
  });

  it("shows a hint when the link has no token", async () => {
    renderPanel("/verify-email");

    expect(await screen.findByText(/missing its token/)).toBeInTheDocument();
  });

  it("only confirms the token once under StrictMode's double effect invocation", async () => {
    // Regression test: caught live - confirming a token isn't idempotent (a
    // second attempt with the same token fails with "already used"), so
    // React StrictMode's dev-only double-invoke of the mount effect must not
    // actually fire the confirm request twice.
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { user: { ...SIGNED_IN_USER, emailVerified: true } }),
    );

    render(
      <StrictMode>
        <AuthProvider>
          <EmailVerificationPanel route="/verify-email?token=fake-verify-token" />
        </AuthProvider>
      </StrictMode>,
    );

    expect(await screen.findByText(/Your email is verified/)).toBeInTheDocument();
    expect(fetchMock.mock.calls).toHaveLength(1);
  });
});
