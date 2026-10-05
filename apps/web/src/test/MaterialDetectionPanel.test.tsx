import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { MaterialDetectionPanel } from "../components/MaterialDetectionPanel";
import { AuthProvider } from "../hooks/AuthContext";

// @maker/core-image's exportImageData needs a real browser Canvas 2D
// context, which jsdom doesn't provide (see that package's own io.ts) - so
// it's mocked here the same way every other test in this repo that touches
// it would have to be, to exercise the rest of the panel's fetch/auth flow.
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

function renderPanel(image: ImageData | null = FAKE_IMAGE) {
  return render(
    <AuthProvider>
      <MaterialDetectionPanel image={image} />
    </AuthProvider>,
  );
}

describe("MaterialDetectionPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("disables Detect Material and shows a hint when signed out", async () => {
    renderPanel();

    expect(await screen.findByText("Sign in to use AI material detection.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Detect Material" })).toBeDisabled();
  });

  it("sends the bearer token and renders the classification when signed in", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        material: "birch plywood",
        confidence: 0.92,
        notes: "likely 1/4in plywood",
        matchedPresets: [],
      }),
    );

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Detect Material" }));

    expect(await screen.findByText("birch plywood")).toBeInTheDocument();
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toContain("/classify-material");
    expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
  });

  it("shows the server's error message when detection fails (e.g. quota exceeded)", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(
      jsonResponse(402, {
        error: "Free tier is limited to 20 AI requests per month (used 20 already)",
      }),
    );

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Detect Material" }));

    expect(
      await screen.findByText(/Free tier is limited to 20 AI requests per month/),
    ).toBeInTheDocument();
  });
});
