import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ResetPasswordPanel } from "../components/ResetPasswordPanel";
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
  createdAt: "2026-01-01T00:00:00Z",
};

function renderPanel(route: string) {
  return render(
    <AuthProvider>
      <ResetPasswordPanel route={route} />
    </AuthProvider>,
  );
}

describe("ResetPasswordPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = "";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("confirms the reset, adopts the returned session, and redirects to the editor", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { user: SIGNED_IN_USER, token: "fresh-session-token" }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));

    renderPanel("/reset-password?token=fake-reset-token");

    fireEvent.change(await screen.findByPlaceholderText("New password"), {
      target: { value: "brand-new-password1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    await vi.waitFor(() => expect(window.location.hash).toBe("#/editor"));
    expect(window.localStorage.getItem("maker.accounts.token")).toBe("fresh-session-token");

    const [confirmUrl, confirmInit] = fetchMock.mock.calls[0]!;
    expect(String(confirmUrl)).toContain("/password-reset/confirm");
    expect(JSON.parse(String(confirmInit?.body))).toEqual({
      token: "fake-reset-token",
      password: "brand-new-password1",
    });
  });

  it("shows an error when the reset is rejected", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(400, { error: "Invalid, expired, or already-used reset token" }),
    );

    renderPanel("/reset-password?token=stale-token");

    fireEvent.change(await screen.findByPlaceholderText("New password"), {
      target: { value: "brand-new-password1" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Reset password" }));

    expect(
      await screen.findByText(/Invalid, expired, or already-used reset token/),
    ).toBeInTheDocument();
    expect(window.location.hash).not.toBe("#/editor");
  });

  it("shows a hint instead of a form when the link has no token", async () => {
    renderPanel("/reset-password");

    expect(await screen.findByText(/missing its token/)).toBeInTheDocument();
    expect(screen.queryByPlaceholderText("New password")).not.toBeInTheDocument();
  });
});
