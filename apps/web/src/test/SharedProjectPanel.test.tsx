import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import type { VectorDocument } from "@maker/core-vector";
import { SharedProjectPanel } from "../components/SharedProjectPanel";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

describe("SharedProjectPanel", () => {
  beforeEach(() => {
    window.location.hash = "";
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("loads the shared project and opens it into the editor on demand", async () => {
    const projectData: VectorDocument = { layers: [], objects: [] };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { project: { id: "p1", name: "Shared Fox", data: projectData } }),
    );

    const onLoadDocument = vi.fn();
    render(<SharedProjectPanel route="/shared/abc123" onLoadDocument={onLoadDocument} />);

    expect(await screen.findByText("Shared Fox")).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/shared/abc123");

    fireEvent.click(screen.getByRole("button", { name: "Open in editor" }));

    expect(onLoadDocument).toHaveBeenCalledWith(projectData);
    expect(window.location.hash).toBe("#/editor");
  });

  it("shows a thumbnail image when the shared project has one", async () => {
    const projectData: VectorDocument = { layers: [], objects: [] };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        project: { id: "p1", name: "Shared Fox", data: projectData, hasThumbnail: true },
      }),
    );

    render(<SharedProjectPanel route="/shared/abc123" onLoadDocument={vi.fn()} />);

    const image = await screen.findByRole("img");
    expect(image).toHaveClass("shared-project__thumbnail");
    expect(image).toHaveAttribute("src", "http://localhost:8790/shared/abc123/thumbnail");
  });

  it("shows no thumbnail image when the shared project has none", async () => {
    const projectData: VectorDocument = { layers: [], objects: [] };
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        project: { id: "p1", name: "Shared Fox", data: projectData, hasThumbnail: false },
      }),
    );

    render(<SharedProjectPanel route="/shared/abc123" onLoadDocument={vi.fn()} />);

    await screen.findByText("Shared Fox");
    expect(screen.queryByRole("img")).not.toBeInTheDocument();
  });

  it("shows a clear message for an invalid or revoked token", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 404 }));

    render(<SharedProjectPanel route="/shared/revoked-token" onLoadDocument={vi.fn()} />);

    expect(await screen.findByText(/invalid or has been revoked/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to the editor" })).toBeInTheDocument();
  });

  it("shows a generic error for an unexpected service failure", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(new Response(null, { status: 500 }));

    render(<SharedProjectPanel route="/shared/abc123" onLoadDocument={vi.fn()} />);

    expect(
      await screen.findByText(/Cloud projects service responded with 500/),
    ).toBeInTheDocument();
  });
});
