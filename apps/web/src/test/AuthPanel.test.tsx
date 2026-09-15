import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { AuthPanel } from "../components/AuthPanel";

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
    render(<AuthPanel />);

    expect(await screen.findByPlaceholderText("Email")).toBeInTheDocument();
    expect(screen.getByPlaceholderText("Password")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Log in" })).toBeInTheDocument();
  });

  it("logs in and persists the session token, then shows the signed-in view", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        user: {
          id: "u1",
          email: "ada@example.com",
          planTier: "free",
          createdAt: "2026-01-01T00:00:00Z",
        },
        token: "test-token",
      }),
    );

    render(<AuthPanel />);

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

    render(<AuthPanel />);

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
          createdAt: "2026-01-01T00:00:00Z",
        },
        token: "signup-token",
      }),
    );

    render(<AuthPanel />);

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
          createdAt: "2026-01-01T00:00:00Z",
        },
      }),
    );
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    render(<AuthPanel />);

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

    render(<AuthPanel />);

    expect(await screen.findByPlaceholderText("Email")).toBeInTheDocument();
    expect(window.localStorage.getItem("maker.accounts.token")).toBeNull();
  });
});
