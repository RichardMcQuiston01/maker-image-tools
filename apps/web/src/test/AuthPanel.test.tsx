import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthPanel } from "../components/AuthPanel";
import { AuthProvider } from "../hooks/AuthContext";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("AuthPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("renders signed-out with a login form by default", async () => {
    render(
      <AuthProvider>
        <AuthPanel />
      </AuthProvider>,
    );

    expect(await screen.findByPlaceholderText("Email")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
    const googleLink = screen.getByRole("link", { name: "Continue with Google" });
    expect(googleLink).toHaveAttribute("href", expect.stringContaining("/oauth/google/start"));
    const githubLink = screen.getByRole("link", { name: "Continue with GitHub" });
    expect(githubLink).toHaveAttribute("href", expect.stringContaining("/oauth/github/start"));
    const discordLink = screen.getByRole("link", { name: "Continue with Discord" });
    expect(discordLink).toHaveAttribute("href", expect.stringContaining("/oauth/discord/start"));
  });

  it("logs in and persists the session token, then shows the signed-in view", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        user: {
          id: "u1",
          email: "ada@example.com",
          planTier: "free",
          hasPassword: true,
          createdAt: "2026-01-01T00:00:00Z",
        },
        token: "test-token",
      }),
    );

    render(
      <AuthProvider>
        <AuthPanel />
      </AuthProvider>,
    );

    fireEvent.change(await screen.findByPlaceholderText("Email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "hunter22222" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByText("ada@example.com")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log out" })).toBeInTheDocument();
    expect(window.localStorage.getItem("maker.accounts.token")).toBe("test-token");

    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/login");
    expect(init?.method).toBe("POST");
  });

  it("shows an error message when login is rejected", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(401, { error: "Invalid email or password" }));

    render(
      <AuthProvider>
        <AuthPanel />
      </AuthProvider>,
    );

    fireEvent.change(await screen.findByPlaceholderText("Email"), {
      target: { value: "ada@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "wrong-password" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Log in" }));

    expect(await screen.findByRole("alert")).toHaveTextContent("Invalid email or password");
  });

  it("switches to signup mode and calls the signup endpoint", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, {
        user: {
          id: "u2",
          email: "grace@example.com",
          planTier: "free",
          hasPassword: true,
          createdAt: "2026-01-01T00:00:00Z",
        },
        token: "signup-token",
      }),
    );

    render(
      <AuthProvider>
        <AuthPanel />
      </AuthProvider>,
    );

    fireEvent.click(await screen.findByRole("button", { name: /Need an account/ }));
    fireEvent.change(screen.getByPlaceholderText("Email"), {
      target: { value: "grace@example.com" },
    });
    fireEvent.change(screen.getByPlaceholderText("Password"), {
      target: { value: "hunter22222" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Sign up" }));

    expect(await screen.findByText("grace@example.com")).toBeInTheDocument();
    const [url] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/signup");
  });

  it("re-validates a stored token against /me on mount and logs out on demand", async () => {
    window.localStorage.setItem("maker.accounts.token", "stored-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        user: {
          id: "u1",
          email: "ada@example.com",
          planTier: "free",
          hasPassword: true,
          createdAt: "2026-01-01T00:00:00Z",
        },
      }),
    );
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    render(
      <AuthProvider>
        <AuthPanel />
      </AuthProvider>,
    );

    expect(await screen.findByText("ada@example.com")).toBeInTheDocument();
    expect(fetchMock.mock.calls[0]![0]).toContain("/me");

    fireEvent.click(screen.getByRole("button", { name: "Log out" }));

    await waitFor(() => {
      expect(window.localStorage.getItem("maker.accounts.token")).toBeNull();
    });
    expect(await screen.findByPlaceholderText("Email")).toBeInTheDocument();
  });

  it("clears a stored token that /me rejects", async () => {
    window.localStorage.setItem("maker.accounts.token", "expired-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 401 }));

    render(
      <AuthProvider>
        <AuthPanel />
      </AuthProvider>,
    );

    expect(await screen.findByPlaceholderText("Email")).toBeInTheDocument();
    expect(window.localStorage.getItem("maker.accounts.token")).toBeNull();
  });

  describe("Set a password (OAuth-only accounts)", () => {
    const OAUTH_ONLY_USER = {
      id: "u3",
      email: "oauth-only@example.com",
      planTier: "free",
      hasPassword: false,
      createdAt: "2026-01-01T00:00:00Z",
    };

    function signInAsOAuthOnly(fetchMock: ReturnType<typeof vi.mocked<typeof fetch>>) {
      window.localStorage.setItem("maker.accounts.token", "oauth-only-token");
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: OAUTH_ONLY_USER }));
    }

    it("shows the set-password form for a signed-in OAuth-only user", async () => {
      const fetchMock = vi.mocked(fetch);
      signInAsOAuthOnly(fetchMock);

      render(
        <AuthProvider>
          <AuthPanel />
        </AuthProvider>,
      );

      expect(await screen.findByPlaceholderText("New password")).toBeInTheDocument();
    });

    it("does not show the set-password form for a user who already has one", async () => {
      const fetchMock = vi.mocked(fetch);
      window.localStorage.setItem("maker.accounts.token", "test-token");
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          user: { ...OAUTH_ONLY_USER, hasPassword: true },
        }),
      );

      render(
        <AuthProvider>
          <AuthPanel />
        </AuthProvider>,
      );

      expect(await screen.findByText("oauth-only@example.com")).toBeInTheDocument();
      expect(screen.queryByPlaceholderText("New password")).not.toBeInTheDocument();
    });

    it("sets a password and refreshes the shared user state", async () => {
      const fetchMock = vi.mocked(fetch);
      signInAsOAuthOnly(fetchMock);
      fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: { ...OAUTH_ONLY_USER } }));
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, { user: { ...OAUTH_ONLY_USER, hasPassword: true } }),
      );

      render(
        <AuthProvider>
          <AuthPanel />
        </AuthProvider>,
      );

      fireEvent.change(await screen.findByPlaceholderText("New password"), {
        target: { value: "hunter22222" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Set password" }));

      expect(await screen.findByText(/Password set/)).toBeInTheDocument();

      const setCall = fetchMock.mock.calls.find(([url]) => String(url).includes("/me/password"));
      expect(setCall).toBeDefined();
      const [, init] = setCall!;
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).Authorization).toBe(
        "Bearer oauth-only-token",
      );
      expect(JSON.parse(String(init?.body))).toEqual({ password: "hunter22222" });
    });

    it("shows an error when setting the password fails", async () => {
      const fetchMock = vi.mocked(fetch);
      signInAsOAuthOnly(fetchMock);
      fetchMock.mockResolvedValueOnce(jsonResponse(409, { error: "already has a password" }));

      render(
        <AuthProvider>
          <AuthPanel />
        </AuthProvider>,
      );

      fireEvent.change(await screen.findByPlaceholderText("New password"), {
        target: { value: "hunter22222" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Set password" }));

      expect(await screen.findByText(/Setting a password failed with 409/)).toBeInTheDocument();
    });
  });

  describe("Connect another provider (signed-in session)", () => {
    it("shows connect links carrying the current session as a linkToken", async () => {
      window.localStorage.setItem("maker.accounts.token", "session-token");
      const fetchMock = vi.mocked(fetch);
      fetchMock.mockResolvedValueOnce(
        jsonResponse(200, {
          user: {
            id: "u1",
            email: "ada@example.com",
            planTier: "free",
            hasPassword: true,
            createdAt: "2026-01-01T00:00:00Z",
          },
        }),
      );

      render(
        <AuthProvider>
          <AuthPanel />
        </AuthProvider>,
      );

      const googleLink = await screen.findByRole("link", { name: "Connect Google" });
      expect(googleLink).toHaveAttribute(
        "href",
        expect.stringContaining("/oauth/google/start?linkToken=session-token"),
      );
      const githubLink = screen.getByRole("link", { name: "Connect GitHub" });
      expect(githubLink).toHaveAttribute(
        "href",
        expect.stringContaining("/oauth/github/start?linkToken=session-token"),
      );
      const discordLink = screen.getByRole("link", { name: "Connect Discord" });
      expect(discordLink).toHaveAttribute(
        "href",
        expect.stringContaining("/oauth/discord/start?linkToken=session-token"),
      );
    });
  });
});
