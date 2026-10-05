import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { VectorizeColorsPanel } from "../components/VectorizeColorsPanel";
import { AuthProvider } from "../hooks/AuthContext";

// Same reasoning as MaterialDetectionPanel.test.tsx: exportImageData needs a
// real browser Canvas 2D context jsdom doesn't provide.
vi.mock("@maker/core-image", () => ({
  exportImageData: vi.fn().mockResolvedValue(new Blob(["fake-png"], { type: "image/png" })),
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

const FAKE_IMAGE = { width: 1, height: 1, data: new Uint8ClampedArray(4) } as ImageData;

function renderPanel(image: ImageData | null = FAKE_IMAGE, onAddColorLayers = vi.fn()) {
  return render(
    <AuthProvider>
      <VectorizeColorsPanel image={image} onAddColorLayers={onAddColorLayers} />
    </AuthProvider>,
  );
}

describe("VectorizeColorsPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("disables Suggest Palette with AI and shows a hint when signed out", async () => {
    renderPanel();

    expect(await screen.findByText("Sign in to use AI palette suggestions.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Suggest Palette with AI" })).toBeDisabled();
    // The fully-offline Vectorize Colors action stays available regardless of sign-in.
    expect(screen.getByRole("button", { name: "Vectorize Colors" })).toBeEnabled();
  });

  it("sends the bearer token and renders the suggested palette when signed in", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        palette: [
          [255, 0, 0],
          [0, 255, 0],
        ],
        notes: "two dominant colors",
      }),
    );

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Suggest Palette with AI" }));

    expect(await screen.findByText("two dominant colors")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toContain("/suggest-palette");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
  });

  it("shows the server's error message when palette suggestion fails (e.g. quota exceeded)", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(402, {
        error: "Free tier is limited to 20 AI requests per month (used 20 already)",
      }),
    );

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Suggest Palette with AI" }));

    expect(
      await screen.findByText(/Free tier is limited to 20 AI requests per month/),
    ).toBeInTheDocument();
  });
});
