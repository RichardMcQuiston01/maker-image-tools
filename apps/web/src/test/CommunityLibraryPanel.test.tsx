import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createDocument, type VectorDocument } from "@maker/core-vector";
import { CommunityLibraryPanel } from "../components/CommunityLibraryPanel";
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

const OTHER_USER_ID = "22222222-2222-2222-2222-222222222222";

const EMPTY_DOC: VectorDocument = createDocument();

function renderPanel(onLoadDocument = vi.fn()) {
  return render(
    <AuthProvider>
      <CommunityLibraryPanel document={EMPTY_DOC} onLoadDocument={onLoadDocument} />
    </AuthProvider>,
  );
}

describe("CommunityLibraryPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searches listings and shows results while signed out", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        listings: [
          {
            id: "l1",
            userId: OTHER_USER_ID,
            title: "Fox Keychain",
            description: "A cute little fox",
            tags: ["keychain", "animal"],
            ratingAvg: 4.5,
            ratingCount: 2,
          },
        ],
      }),
    );

    renderPanel();
    fireEvent.change(screen.getByPlaceholderText("Search"), { target: { value: "fox" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText("Fox Keychain")).toBeInTheDocument();
    expect(screen.getByText(/4.5★ \(2\)/)).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toContain("q=fox");
    expect(String(fetchMock.mock.calls[0]![0])).toContain("sort=newest");
  });

  it("loads a listing and calls onLoadDocument with its data", async () => {
    const fetchMock = vi.mocked(fetch);
    const listingData: VectorDocument = { layers: [], objects: [] };
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        listings: [
          {
            id: "l1",
            userId: OTHER_USER_ID,
            title: "Fox Keychain",
            description: null,
            tags: [],
            ratingAvg: null,
            ratingCount: 0,
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { listing: { data: listingData } }));

    const onLoadDocument = vi.fn();
    renderPanel(onLoadDocument);
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Load" }));

    await waitFor(() => expect(onLoadDocument).toHaveBeenCalledWith(listingData));
  });

  it("does not show rating or delete controls when signed out", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        listings: [
          {
            id: "l1",
            userId: OTHER_USER_ID,
            title: "Fox Keychain",
            description: null,
            tags: [],
            ratingAvg: null,
            ratingCount: 0,
          },
        ],
      }),
    );

    renderPanel();
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    await screen.findByText("Fox Keychain");
    expect(screen.queryByRole("button", { name: "Rate" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
    expect(await screen.findByText(/Log in to publish a design/)).toBeInTheDocument();
  });

  it("rates a listing when signed in", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        listings: [
          {
            id: "l1",
            userId: OTHER_USER_ID,
            title: "Fox Keychain",
            description: null,
            tags: [],
            ratingAvg: null,
            ratingCount: 0,
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        rating: { id: "r1", listingId: "l1", userId: SIGNED_IN_USER.id, stars: 5 },
        listing: {
          id: "l1",
          userId: OTHER_USER_ID,
          title: "Fox Keychain",
          description: null,
          tags: [],
          ratingAvg: 5,
          ratingCount: 1,
        },
      }),
    );

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Rate" }));

    expect(await screen.findByText(/5.0★ \(1\)/)).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[2]!;
    expect(String(url)).toContain("/listings/l1/ratings");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      userId: SIGNED_IN_USER.id,
      stars: 5,
    });
  });

  it("includes a comment when submitting a rating with one entered", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        listings: [
          {
            id: "l1",
            userId: OTHER_USER_ID,
            title: "Fox Keychain",
            description: null,
            tags: [],
            ratingAvg: null,
            ratingCount: 0,
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        rating: {
          id: "r1",
          listingId: "l1",
          userId: SIGNED_IN_USER.id,
          stars: 4,
          comment: "Cuts cleanly!",
        },
        listing: {
          id: "l1",
          userId: OTHER_USER_ID,
          title: "Fox Keychain",
          description: null,
          tags: [],
          ratingAvg: 4,
          ratingCount: 1,
        },
      }),
    );

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Search" }));
    fireEvent.change(await screen.findByPlaceholderText("Comment (optional)"), {
      target: { value: "Cuts cleanly!" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Rate" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
    const [, init] = fetchMock.mock.calls[2]!;
    expect(JSON.parse(String(init?.body))).toMatchObject({
      userId: SIGNED_IN_USER.id,
      stars: 5,
      comment: "Cuts cleanly!",
    });
  });

  it("fetches and shows the individual reviews when toggled", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        listings: [
          {
            id: "l1",
            userId: OTHER_USER_ID,
            title: "Fox Keychain",
            description: null,
            tags: [],
            ratingAvg: 4.5,
            ratingCount: 2,
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        ratings: [
          {
            id: "r1",
            listingId: "l1",
            userId: OTHER_USER_ID,
            stars: 5,
            comment: "Great fit!",
            createdAt: "2026-01-02T00:00:00Z",
          },
          {
            id: "r2",
            listingId: "l1",
            userId: "33333333-3333-3333-3333-333333333333",
            stars: 4,
            comment: null,
            createdAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Show reviews (2)" }));

    expect(await screen.findByText("Great fit!")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[1]![0])).toContain("/listings/l1/ratings");
    expect(screen.getByRole("button", { name: "Hide reviews" })).toBeInTheDocument();
  });

  it("shows a delete button only for the signed-in user's own listing", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        listings: [
          {
            id: "mine",
            userId: SIGNED_IN_USER.id,
            title: "My Design",
            description: null,
            tags: [],
            ratingAvg: null,
            ratingCount: 0,
          },
          {
            id: "theirs",
            userId: OTHER_USER_ID,
            title: "Their Design",
            description: null,
            tags: [],
            ratingAvg: null,
            ratingCount: 0,
          },
        ],
      }),
    );

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Search" }));

    await screen.findByText("My Design");
    expect(screen.getAllByRole("button", { name: "Delete" })).toHaveLength(1);
  });

  it("deletes a listing and removes it from the results", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        listings: [
          {
            id: "mine",
            userId: SIGNED_IN_USER.id,
            title: "My Design",
            description: null,
            tags: [],
            ratingAvg: null,
            ratingCount: 0,
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.queryByText("My Design")).not.toBeInTheDocument());
    const [url, init] = fetchMock.mock.calls[2]!;
    expect(String(url)).toContain(`/listings/mine?userId=${SIGNED_IN_USER.id}`);
    expect(init?.method).toBe("DELETE");
  });

  it("publishes the current document when signed in", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { listing: { id: "l1", status: "pending" } }),
    );

    renderPanel();
    fireEvent.change(await screen.findByPlaceholderText("Title"), {
      target: { value: "Fox Keychain" },
    });
    fireEvent.change(screen.getByPlaceholderText("Tags (comma separated)"), {
      target: { value: "keychain, animal" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish for review" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toContain("/listings");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      userId: SIGNED_IN_USER.id,
      title: "Fox Keychain",
      tags: ["keychain", "animal"],
      data: EMPTY_DOC,
    });
    expect(await screen.findByText(/awaiting moderation/)).toBeInTheDocument();
  });
});
