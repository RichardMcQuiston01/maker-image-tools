import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { ImageGenerationPanel } from "../components/ImageGenerationPanel";
import { AuthProvider } from "../hooks/AuthContext";

// jsdom has no ImageData constructor, but the panel builds a real `new
// ImageData(...)` from the generated result - mirrors the same minimal
// test-only polyfill used elsewhere in the workspace (only
// `.data`/`.width`/`.height` are ever read back off it).
if (typeof globalThis.ImageData === "undefined") {
  class ImageDataPolyfill {
    data: Uint8ClampedArray;
    width: number;
    height: number;
    constructor(data: Uint8ClampedArray, width: number, height: number) {
      this.data = data;
      this.width = width;
      this.height = height;
    }
  }
  globalThis.ImageData = ImageDataPolyfill as unknown as typeof ImageData;
}

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

function renderPanel(onProcessed = vi.fn()) {
  return render(
    <AuthProvider>
      <ImageGenerationPanel onProcessed={onProcessed} />
    </AuthProvider>,
  );
}

describe("ImageGenerationPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("disables Generate Image and shows a hint when signed out", async () => {
    renderPanel();
    fireEvent.change(await screen.findByPlaceholderText(/mountain landscape/), {
      target: { value: "a red bicycle" },
    });

    expect(screen.getByText("Sign in to use AI image generation.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Generate Image" })).toBeDisabled();
  });

  it("sends the bearer token and renders the generated image when signed in", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    // 2x2 RGBA image, base64-encoded.
    const dataBase64 = Buffer.from(new Uint8Array(2 * 2 * 4)).toString("base64");
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, { width: 2, height: 2, dataBase64, notes: "a lovely bicycle" }),
    );

    const onProcessed = vi.fn();
    renderPanel(onProcessed);
    fireEvent.change(await screen.findByPlaceholderText(/mountain landscape/), {
      target: { value: "a red bicycle" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate Image" }));

    await waitFor(() => expect(onProcessed).toHaveBeenCalled());
    expect(screen.getByText("a lovely bicycle")).toBeInTheDocument();

    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toContain("/generate-image");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
  });

  it("shows the server's error message when generation fails (e.g. quota exceeded)", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(402, {
        error: "Free tier is limited to 20 AI requests per month (used 20 already)",
      }),
    );

    renderPanel();
    fireEvent.change(await screen.findByPlaceholderText(/mountain landscape/), {
      target: { value: "a red bicycle" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Generate Image" }));

    expect(
      await screen.findByText(/Free tier is limited to 20 AI requests per month/),
    ).toBeInTheDocument();
  });
});
