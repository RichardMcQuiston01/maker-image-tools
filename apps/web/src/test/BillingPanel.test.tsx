import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { BillingPanel } from "../components/BillingPanel";
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
  createdAt: "2026-01-01T00:00:00Z",
};

describe("BillingPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a login hint when signed out", async () => {
    render(
      <AuthProvider>
        <BillingPanel />
      </AuthProvider>,
    );
    expect(await screen.findByText(/Log in to view your plan/)).toBeInTheDocument();
  });

  it("shows the current plan and an upgrade button once signed in", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { planTier: "free", status: "none", currentPeriodEnd: null }),
    );

    render(
      <AuthProvider>
        <BillingPanel />
      </AuthProvider>,
    );

    expect(await screen.findByText(/Current plan: free \(none\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upgrade to Pro" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Upgrade to Studio" })).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[1]![0])).toContain(
      `/subscription?userId=${SIGNED_IN_USER.id}`,
    );
  });

  it("shows a manage-billing button for an active pro subscriber", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        planTier: "pro",
        status: "active",
        currentPeriodEnd: "2026-02-01T00:00:00Z",
      }),
    );

    render(
      <AuthProvider>
        <BillingPanel />
      </AuthProvider>,
    );

    expect(await screen.findByRole("button", { name: "Manage Billing" })).toBeInTheDocument();
  });

  it("shows a manage-billing button for an active studio subscriber too", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        planTier: "studio",
        status: "active",
        currentPeriodEnd: "2026-02-01T00:00:00Z",
      }),
    );

    render(
      <AuthProvider>
        <BillingPanel />
      </AuthProvider>,
    );

    expect(await screen.findByRole("button", { name: "Manage Billing" })).toBeInTheDocument();
  });

  it("requests a checkout session and redirects on upgrade", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { planTier: "free", status: "none", currentPeriodEnd: null }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { url: "https://checkout.stripe.com/pay/fake" }),
    );

    render(
      <AuthProvider>
        <BillingPanel />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Upgrade to Pro" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const [url, init] = fetchMock.mock.calls[2]!;
    expect(String(url)).toContain("/checkout-session");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      userId: SIGNED_IN_USER.id,
      email: SIGNED_IN_USER.email,
      planTier: "pro",
    });
  });

  it("requests a checkout session for studio when that tier is chosen", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { planTier: "free", status: "none", currentPeriodEnd: null }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { url: "https://checkout.stripe.com/pay/fake" }),
    );

    render(
      <AuthProvider>
        <BillingPanel />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Upgrade to Studio" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const [url, init] = fetchMock.mock.calls[2]!;
    expect(String(url)).toContain("/checkout-session");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      userId: SIGNED_IN_USER.id,
      email: SIGNED_IN_USER.email,
      planTier: "studio",
    });
  });

  it("shows an error when the subscription request fails", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));

    render(
      <AuthProvider>
        <BillingPanel />
      </AuthProvider>,
    );
    expect(await screen.findByRole("alert")).toHaveTextContent(
      "Billing service responded with 500",
    );
  });
});
