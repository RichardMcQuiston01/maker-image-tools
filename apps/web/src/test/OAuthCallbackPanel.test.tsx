import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { OAuthCallbackPanel } from "../components/OAuthCallbackPanel";
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
  createdAt: "2026-01-01T00:00:00Z",
};

function renderPanel(route: string) {
  return render(
    <AuthProvider>
      <OAuthCallbackPanel route={route} />
    </AuthProvider>,
  );
}

describe("OAuthCallbackPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    window.location.hash = "";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("adopts a token from the URL and redirects to the editor", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));

    renderPanel("/oauth-callback?token=fake-oauth-token");

    await vi.waitFor(() => expect(window.location.hash).toBe("#/editor"));
    expect(window.localStorage.getItem("maker.accounts.token")).toBe("fake-oauth-token");
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/me");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer fake-oauth-token");
  });

  it("shows the provider's error and does not redirect when there's no token", async () => {
    renderPanel("/oauth-callback?error=access_denied");

    expect(await screen.findByText(/Sign-in failed: access_denied/)).toBeInTheDocument();
    expect(window.location.hash).not.toBe("#/editor");
    expect(screen.getByRole("link", { name: "Back to the editor" })).toBeInTheDocument();
  });

  it("shows a generic failure message when neither a token nor an error is present", async () => {
    renderPanel("/oauth-callback");

    expect(
      await screen.findByText(/Sign-in failed: OAuth sign-in did not return a token/),
    ).toBeInTheDocument();
  });

  it("shows a pending message while a token is being adopted", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockImplementationOnce(() => new Promise(() => {})); // never resolves during this test

    renderPanel("/oauth-callback?token=fake-oauth-token");

    expect(await screen.findByText(/Signing you in/)).toBeInTheDocument();
  });
});
