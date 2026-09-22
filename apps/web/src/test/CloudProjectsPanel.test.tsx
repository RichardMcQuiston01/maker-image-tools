import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createDocument, type VectorDocument } from "@maker/core-vector";
import { CloudProjectsPanel } from "../components/CloudProjectsPanel";
import { AuthProvider } from "../hooks/AuthContext";
import { renderThumbnail } from "../lib/renderThumbnail";

vi.mock("../lib/renderThumbnail", () => ({
  renderThumbnail: vi.fn(),
}));

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

/** jsdom doesn't implement EventSource - a minimal fake standing in for the live-updates stream,
 * with an `emit` helper tests use to simulate a server-sent message. */
class FakeEventSource {
  static instances: FakeEventSource[] = [];
  url: string;
  onmessage: ((event: { data: string }) => void) | null = null;
  closed = false;

  constructor(url: string) {
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(data: unknown) {
    this.onmessage?.({ data: JSON.stringify(data) });
  }
}

describe("CloudProjectsPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
    vi.stubGlobal("EventSource", FakeEventSource);
    FakeEventSource.instances = [];
    vi.mocked(renderThumbnail).mockReset().mockResolvedValue(undefined);
    // jsdom doesn't implement these - ProjectThumbnail's blob-URL display
    // needs them, and a stub here is harmless for every other test (none
    // of them render a project with hasThumbnail: true, so ProjectThumbnail
    // never mounts and these are simply never called).
    URL.createObjectURL ??= vi.fn(() => "blob:fake-thumbnail-url");
    URL.revokeObjectURL ??= vi.fn();
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
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      name: "New Project",
      data: EMPTY_DOC,
    });
    expect(await screen.findByText("New Project")).toBeInTheDocument();
  });

  it("uploads a rendered thumbnail after saving", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { projects: [] }));
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { project: { id: "p1" } }));
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { projects: [] }));
    const thumbnailBlob = new Blob(["fake-png"], { type: "image/png" });
    vi.mocked(renderThumbnail).mockResolvedValueOnce(thumbnailBlob);

    render(
      <AuthProvider>
        <CloudProjectsPanel document={EMPTY_DOC} onLoadDocument={vi.fn()} />
      </AuthProvider>,
    );
    const nameInput = await screen.findByPlaceholderText("Project name");
    fireEvent.change(nameInput, { target: { value: "New Project" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(5));
    const [url, init] = fetchMock.mock.calls[3]!;
    expect(String(url)).toBe("http://localhost:8790/projects/p1/thumbnail");
    expect(init?.method).toBe("PUT");
    expect((init?.headers as Record<string, string>)["Content-Type"]).toBe("image/png");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
    expect(init?.body).toBe(thumbnailBlob);
  });

  it("doesn't fail the save if the thumbnail upload fails", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { projects: [] }));
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { project: { id: "p1" } }));
    fetchMock.mockRejectedValueOnce(new Error("network down"));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        projects: [
          {
            id: "p1",
            name: "New Project",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            hasThumbnail: false,
          },
        ],
      }),
    );
    vi.mocked(renderThumbnail).mockResolvedValueOnce(new Blob(["fake-png"], { type: "image/png" }));

    render(
      <AuthProvider>
        <CloudProjectsPanel document={EMPTY_DOC} onLoadDocument={vi.fn()} />
      </AuthProvider>,
    );
    const nameInput = await screen.findByPlaceholderText("Project name");
    fireEvent.change(nameInput, { target: { value: "New Project" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("New Project")).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("shows a thumbnail image for a project that has one", async () => {
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
            hasThumbnail: true,
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(
      new Response(new Blob(["fake-png"], { type: "image/png" }), { status: 200 }),
    );

    render(
      <AuthProvider>
        <CloudProjectsPanel document={EMPTY_DOC} onLoadDocument={vi.fn()} />
      </AuthProvider>,
    );

    const image = await screen.findByRole("img");
    expect(image).toHaveClass("cloud-projects-panel__thumbnail");
    await waitFor(() =>
      expect(String(fetchMock.mock.calls[2]![0])).toBe(
        "http://localhost:8790/projects/p1/thumbnail",
      ),
    );
  });

  it("shows the server's quota error message when saving fails with 402", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { projects: [] }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(402, { error: "Plan limit reached: at most 10 projects allowed" }),
    );

    render(
      <AuthProvider>
        <CloudProjectsPanel document={EMPTY_DOC} onLoadDocument={vi.fn()} />
      </AuthProvider>,
    );
    const nameInput = await screen.findByPlaceholderText("Project name");
    fireEvent.change(nameInput, { target: { value: "New Project" } });
    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    expect(
      await screen.findByText("Plan limit reached: at most 10 projects allowed"),
    ).toBeInTheDocument();
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
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
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
    const [loadUrl, loadInit] = fetchMock.mock.calls[2]!;
    expect(String(loadUrl)).toContain("/projects/p1");
    expect((loadInit?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
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

  it("hides Share/Delete for a project shared as a collaborator", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        projects: [
          {
            id: "p1",
            name: "Shared With Me",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            role: "collaborator",
          },
        ],
      }),
    );

    render(
      <AuthProvider>
        <CloudProjectsPanel document={EMPTY_DOC} onLoadDocument={vi.fn()} />
      </AuthProvider>,
    );
    await screen.findByText("Shared With Me");

    expect(screen.getByText("Shared with you")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Load" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Share" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Delete" })).not.toBeInTheDocument();
  });

  it("lists, adds, and removes collaborators for an owned project", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        projects: [
          {
            id: "p1",
            name: "Mine",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            role: "owner",
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { collaborators: [] }));

    render(
      <AuthProvider>
        <CloudProjectsPanel document={EMPTY_DOC} onLoadDocument={vi.fn()} />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Collaborators" }));
    expect(await screen.findByText("No collaborators yet.")).toBeInTheDocument();

    const COLLABORATOR_ID = "22222222-2222-2222-2222-222222222222";
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { id: COLLABORATOR_ID }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        collaborators: [{ userId: COLLABORATOR_ID, addedAt: "2026-01-02T00:00:00Z" }],
      }),
    );

    fireEvent.change(screen.getByPlaceholderText("Collaborator's email"), {
      target: { value: "bob@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));

    expect(await screen.findByText(COLLABORATOR_ID)).toBeInTheDocument();
    const lookupCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/users/by-email"),
    );
    expect(String(lookupCall![0])).toContain("email=bob%40example.com");
    expect((lookupCall![1]?.headers as Record<string, string>).Authorization).toBe(
      "Bearer test-token",
    );

    fetchMock.mockResolvedValueOnce(new Response(null, { status: 204 }));
    fireEvent.click(screen.getByRole("button", { name: "Remove" }));
    await waitFor(() => expect(screen.queryByText(COLLABORATOR_ID)).not.toBeInTheDocument());
  });

  it("shows an error when inviting an email with no matching account", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        projects: [
          {
            id: "p1",
            name: "Mine",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
            role: "owner",
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { collaborators: [] }));
    fetchMock.mockResolvedValueOnce(jsonResponse(404, { error: "Not found" }));

    render(
      <AuthProvider>
        <CloudProjectsPanel document={EMPTY_DOC} onLoadDocument={vi.fn()} />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Collaborators" }));
    await screen.findByText("No collaborators yet.");
    fireEvent.change(screen.getByPlaceholderText("Collaborator's email"), {
      target: { value: "nobody@example.com" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Invite" }));

    expect(
      await screen.findByText('No account with email "nobody@example.com"'),
    ).toBeInTheDocument();
  });

  it("shows a live-update banner when the loaded project changes elsewhere, and Reload re-fetches it", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        projects: [
          {
            id: "p1",
            name: "Mine",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { project: { data: { layers: [] } } }));

    const onLoadDocument = vi.fn();
    render(
      <AuthProvider>
        <CloudProjectsPanel document={EMPTY_DOC} onLoadDocument={onLoadDocument} />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Load" }));
    await waitFor(() => expect(onLoadDocument).toHaveBeenCalledTimes(1));

    const source = FakeEventSource.instances.at(-1)!;
    expect(source.url).toContain("/projects/p1/live?token=test-token");
    source.emit({ type: "project", project: { data: {} } }); // initial state - not a change
    source.emit({ type: "project", project: { data: { layers: ["x"] } } }); // a real change

    expect(await screen.findByText(/updated by a collaborator/)).toBeInTheDocument();

    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { project: { data: { layers: ["reloaded"] } } }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Reload" }));

    await waitFor(() => expect(onLoadDocument).toHaveBeenCalledTimes(2));
    expect(onLoadDocument).toHaveBeenLastCalledWith({ layers: ["reloaded"] });
    expect(screen.queryByText(/updated by a collaborator/)).not.toBeInTheDocument();
  });

  it("shows a dismissible notice when the loaded project is deleted elsewhere", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        projects: [
          {
            id: "p1",
            name: "Mine",
            createdAt: "2026-01-01T00:00:00Z",
            updatedAt: "2026-01-01T00:00:00Z",
          },
        ],
      }),
    );
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { project: { data: { layers: [] } } }));

    render(
      <AuthProvider>
        <CloudProjectsPanel document={EMPTY_DOC} onLoadDocument={vi.fn()} />
      </AuthProvider>,
    );
    fireEvent.click(await screen.findByRole("button", { name: "Load" }));
    await waitFor(() => expect(FakeEventSource.instances).toHaveLength(1));

    const source = FakeEventSource.instances.at(-1)!;
    source.emit({ type: "project", project: { data: {} } }); // initial state
    source.emit({ type: "deleted" });

    expect(await screen.findByText(/This project was deleted/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reload" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByText(/This project was deleted/)).not.toBeInTheDocument();
  });
});
