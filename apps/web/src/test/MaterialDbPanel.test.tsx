import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MaterialDbPanel } from "../components/MaterialDbPanel";
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

describe("MaterialDbPanel", () => {
  beforeEach(() => {
    window.localStorage.clear();
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("searches presets and shows results", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        presets: [
          {
            id: "1",
            material: "baltic birch plywood 3mm",
            machineType: "diode-laser",
            operation: "cut",
            speed: 300,
            power: 950,
            passes: 2,
            notes: null,
          },
        ],
      }),
    );

    render(
      <AuthProvider>
        <MaterialDbPanel onApplyPreset={vi.fn()} />
      </AuthProvider>,
    );
    fireEvent.change(screen.getByPlaceholderText("Material"), { target: { value: "birch" } });
    fireEvent.click(screen.getByRole("button", { name: "Search" }));

    expect(await screen.findByText(/baltic birch plywood 3mm/)).toBeInTheDocument();
    expect(String(fetchMock.mock.calls[0]![0])).toContain("material=birch");
  });

  it("applies a searched preset via the callback", async () => {
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(
      jsonResponse(200, {
        presets: [
          {
            id: "1",
            material: "baltic birch plywood 3mm",
            machineType: "diode-laser",
            operation: "cut",
            speed: 300,
            power: 950,
            passes: 2,
            notes: null,
          },
        ],
      }),
    );

    const onApplyPreset = vi.fn();
    render(
      <AuthProvider>
        <MaterialDbPanel onApplyPreset={onApplyPreset} />
      </AuthProvider>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Search" }));
    fireEvent.click(await screen.findByRole("button", { name: "Apply" }));

    expect(onApplyPreset).toHaveBeenCalledWith(300, 950, 2);
  });

  it("shows a login hint instead of the submit form when signed out", async () => {
    render(
      <AuthProvider>
        <MaterialDbPanel onApplyPreset={vi.fn()} />
      </AuthProvider>,
    );
    expect(await screen.findByText(/Log in to submit a preset/)).toBeInTheDocument();
  });

  it("submits a new preset when signed in", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: SIGNED_IN_USER }));
    fetchMock.mockResolvedValueOnce(jsonResponse(201, { preset: { id: "1", status: "pending" } }));

    const { container } = render(
      <AuthProvider>
        <MaterialDbPanel onApplyPreset={vi.fn()} />
      </AuthProvider>,
    );

    await screen.findByText("Submit a preset");
    const submitSection = container.querySelector<HTMLElement>(".material-db-panel__submit")!;
    fireEvent.change(within(submitSection).getByPlaceholderText("Material"), {
      target: { value: "Acrylic 3mm" },
    });
    fireEvent.change(within(submitSection).getByPlaceholderText("Machine type"), {
      target: { value: "co2-laser" },
    });
    fireEvent.change(within(submitSection).getByPlaceholderText("Operation"), {
      target: { value: "engrave" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Submit for review" }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    const [url, init] = fetchMock.mock.calls[1]!;
    expect(String(url)).toContain("/presets");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      userId: SIGNED_IN_USER.id,
      material: "Acrylic 3mm",
      machineType: "co2-laser",
      operation: "engrave",
    });
    expect(await screen.findByText(/awaiting moderation/)).toBeInTheDocument();
  });
});
