import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createDocument, type VectorDocument } from "@maker/core-vector";
import { CloudProjectsPanel } from "../components/CloudProjectsPanel";
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

const EMPTY_DOC: VectorDocument = createDocument();

describe("CloudProjectsPanel", () => {
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
        <CloudProjectsPanel document={EMPTY_DOC} onLoadDocument={vi.fn()} />
      </AuthProvider>,
    );
    expect(await screen.findByText(/Log in to save and load projects/)).toBeInTheDocument();
  });

  it("lists saved projects once signed in", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        projects: [
          {
            id: "p1",
            name: "My Design",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );

    render(
      <AuthProvider>
        <CloudProjectsPanel document={EMPTY_DOC} onLoadDocument={vi.fn()} />
      </AuthProvider>,
    );
    expect(await screen.findByText("My Design")).toBeInTheDocument();
  });

  it("saves the current document under the entered name", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { projects: [] }));
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { project: { id: "p1" } }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        projects: [
          {
            id: "p1",
            name: "New Project",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );

    render(
      <AuthProvider>
        <CloudProjectsPanel document={EMPTY_DOC} onLoadDocument={vi.fn()} />
      </AuthProvider>,
    );
    const nameInput = await screen.findByPlaceholderText("Project name");
    fireEvent.change(nameInput, { target: { value: "New Project" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const [url, init] = fetchMock.mock.calls[2]!;
    expect(String(url)).toContain("/projects");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      userId: SIGNED_IN_USER.id,
      name: "New Project",
      data: EMPTY_DOC,
    });
    expect(await screen.findByText("New Project")).toBeInTheDocument();
  });

  it("loads a project and calls onLoadDocument with its data", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    const projectData: VectorDocument = { layers: [], objects: [] };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        projects: [
          {
            id: "p1",
            name: "My Design",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { project: { data: projectData } }));

    const onLoadDocument = vi.fn();
    render(
      <AuthProvider>
        <CloudProjectsPanel document={EMPTY_DOC} onLoadDocument={onLoadDocument} />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Load" }));

    await waitFor(() => expect(onLoadDocument).toHaveBeenCalledWith(projectData));
  });

  it("deletes a project and refreshes the list", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        projects: [
          {
            id: "p1",
            name: "My Design",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { projects: [] }));

    render(
      <AuthProvider>
        <CloudProjectsPanel document={EMPTY_DOC} onLoadDocument={vi.fn()} />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Delete" }));

    await waitFor(() => expect(screen.getByText(/No saved projects yet/)).toBeInTheDocument());
  });

  it("creates a share link and displays the token", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        projects: [
          {
            id: "p1",
            name: "My Design",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: "share-token-123" }));

    render(
      <AuthProvider>
        <CloudProjectsPanel document={EMPTY_DOC} onLoadDocument={vi.fn()} />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Share" }));

    expect(await screen.findByText(/share-token-123/)).toBeInTheDocument();
  });

  it("revokes a share link and hides the share UI", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        projects: [
          {
            id: "p1",
            name: "My Design",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { token: "share-token-123" }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));

    render(
      <AuthProvider>
        <CloudProjectsPanel document={EMPTY_DOC} onLoadDocument={vi.fn()} />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Share" }));
    expect(await screen.findByText(/share-token-123/)).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Revoke" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const [url, init] = fetchMock.mock.calls[3]!;
    expect(String(url)).toContain("/projects/p1/share");
    expect(init?.method).toBe("DELETE");
    expect(JSON.parse(String(init?.body))).toEqual({ userId: SIGNED_IN_USER.id });
    await waitFor(() => expect(screen.queryByText(/share-token-123/)).not.toBeInTheDocument());
  });

  it("publishes a saved project's data straight to the community library", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    const projectData: VectorDocument = { layers: [], objects: [] };
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        projects: [
          {
            id: "p1",
            name: "My Design",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { project: { data: projectData } }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(201, { listing: { id: "l1", status: "pending" } }),
    );

    render(
      <AuthProvider>
        <CloudProjectsPanel document={EMPTY_DOC} onLoadDocument={vi.fn()} />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Publish to Library" }));

    const titleInput = await screen.findByPlaceholderText("Title");
    expect(titleInput).toHaveValue("My Design");
    fireEvent.change(screen.getByPlaceholderText("Tags (comma separated)"), {
      target: { value: "keychain, fox" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Publish" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(4));
    const [loadUrl] = fetchMock.mock.calls[2]!;
    expect(String(loadUrl)).toContain(`/projects/p1?userId=${SIGNED_IN_USER.id}`);
    const [listingUrl, listingInit] = fetchMock.mock.calls[3]!;
    expect(String(listingUrl)).toContain("/listings");
    expect(listingInit?.method).toBe("POST");
    expect(JSON.parse(String(listingInit?.body))).toMatchObject({
      userId: SIGNED_IN_USER.id,
      title: "My Design",
      tags: ["keychain", "fox"],
      data: projectData,
    });
    expect(await screen.findByText(/awaiting moderation/)).toBeInTheDocument();
  });
});
