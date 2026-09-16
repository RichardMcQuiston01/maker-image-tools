import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ModerationPanel } from "../components/ModerationPanel";
import { AuthProvider } from "../hooks/AuthContext";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

const MODERATOR_USER = {
  id: "11111111-1111-1111-1111-111111111111",
  email: "ada@example.com",
  planTier: "free",
  role: "moderator",
  createdAt: "2026-01-01T00:00:00Z",
};

const REGULAR_USER = {
  id: "22222222-2222-2222-2222-222222222222",
  email: "grace@example.com",
  planTier: "free",
  role: "user",
  createdAt: "2026-01-01T00:00:00Z",
};

function renderPanel() {
  return render(
    <AuthProvider>
      <ModerationPanel />
    </AuthProvider>,
  );
}

describe("ModerationPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("shows a login hint when signed out", async () => {
    renderPanel();
    expect(await screen.findByText(/Log in as a moderator/)).toBeInTheDocument();
  });

  it("shows a login hint for a signed-in non-moderator and never fetches pending listings", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: REGULAR_USER }));

    renderPanel();

    expect(await screen.findByText(/Log in as a moderator/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the /me call, no /listings/pending
  });

  it("lists pending listings for a signed-in moderator", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: MODERATOR_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        listings: [
          {
            id: "l1",
            userId: REGULAR_USER.id,
            title: "Fox Keychain",
            description: "A cute little fox",
            tags: ["keychain"],
          },
        ],
      }),
    );

    renderPanel();

    expect(await screen.findByText("Fox Keychain")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[1]![0])).toContain("/listings/pending");
  });

  it("approves a listing and removes it from the queue", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: MODERATOR_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        listings: [
          {
            id: "l1",
            userId: REGULAR_USER.id,
            title: "Fox Keychain",
            description: null,
            tags: [],
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { listing: { id: "l1", status: "approved" } }),
    );

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(screen.queryByText("Fox Keychain")).not.toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[2]!;
    expect(String(url)).toContain("/listings/l1/approve");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ reviewerId: MODERATOR_USER.id });
  });

  it("rejects a listing and removes it from the queue", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: MODERATOR_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        listings: [
          {
            id: "l1",
            userId: REGULAR_USER.id,
            title: "Fox Keychain",
            description: null,
            tags: [],
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { listing: { id: "l1", status: "rejected" } }),
    );

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));

    await waitFor(() => expect(screen.queryByText("Fox Keychain")).not.toBeInTheDocument());
    const [url] = fetchMock.mock.calls[2]!;
    expect(String(url)).toContain("/listings/l1/reject");
  });

  it("shows an empty-queue hint when nothing is pending", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: MODERATOR_USER }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { listings: [] }));

    renderPanel();

    expect(await screen.findByText(/Nothing pending review/)).toBeInTheDocument();
  });
});
