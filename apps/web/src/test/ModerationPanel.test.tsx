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
  hasPassword: true,
  emailVerified: true,
  createdAt: "2026-01-01T00:00:00Z",
};

const REGULAR_USER = {
  id: "22222222-2222-2222-2222-222222222222",
  email: "grace@example.com",
  planTier: "free",
  role: "user",
  hasPassword: true,
  emailVerified: true,
  createdAt: "2026-01-01T00:00:00Z",
};

function renderPanel() {
  return render(
    <AuthProvider>
      <ModerationPanel />
    </AuthProvider>,
  );
}

/**
 * Mounting as a moderator fires two independent fetches in the same effect
 * (pending listings, pending presets) whose relative order isn't meaningful
 * to assert on - route mocked responses by URL instead of call index.
 */
function mockModerationFetches(
  fetchMock: ReturnType<typeof vi.mocked<typeof fetch>>,
  {
    user,
    listings = [],
    presets = [],
  }: {
    user: typeof MODERATOR_USER | typeof REGULAR_USER;
    listings?: unknown[];
    presets?: unknown[];
  },
) {
  fetchMock.mockImplementation(async (input) => {
    const url = String(input);
    if (url.includes("/me")) return jsonResponse(200, { user });
    if (url.includes("/listings/pending")) return jsonResponse(200, { listings });
    if (url.includes("/presets/pending")) return jsonResponse(200, { presets });
    if (url.includes("/approve") || url.includes("/reject")) {
      return jsonResponse(200, { listing: { status: "approved" }, preset: { status: "approved" } });
    }
    throw new Error(`unexpected fetch in test: ${url}`);
  });
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

  it("shows a login hint for a signed-in non-moderator and never fetches pending queues", async () => {
    window.localStorage.setItem("maker.accounts.token", "test-token");
    const fetchMock = vi.mocked(fetch);
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { user: REGULAR_USER }));

    renderPanel();

    expect(await screen.findByText(/Log in as a moderator/)).toBeInTheDocument();
    expect(fetchMock).toHaveBeenCalledTimes(1); // only the /me call
  });

  it("lists pending listings and pending presets for a signed-in moderator", async () => {
    const fetchMock = vi.mocked(fetch);
    mockModerationFetches(fetchMock, {
      user: MODERATOR_USER,
      listings: [
        {
          id: "l1",
          userId: REGULAR_USER.id,
          title: "Fox Keychain",
          description: "A cute little fox",
          tags: ["keychain"],
        },
      ],
      presets: [
        {
          id: "p1",
          material: "Baltic birch plywood 3mm",
          machineType: "diode-laser",
          operation: "cut",
          speed: 300,
          power: 950,
          notes: null,
        },
      ],
    });
    window.localStorage.setItem("maker.accounts.token", "test-token");

    renderPanel();

    expect(await screen.findByText("Fox Keychain")).toBeInTheDocument();
    expect(await screen.findByText(/Baltic birch plywood 3mm/)).toBeInTheDocument();
    expect(screen.getByText(/speed 300, power 950/)).toBeInTheDocument();
  });

  it("approves a listing and removes only it from the community library queue", async () => {
    const fetchMock = vi.mocked(fetch);
    mockModerationFetches(fetchMock, {
      user: MODERATOR_USER,
      listings: [
        { id: "l1", userId: REGULAR_USER.id, title: "Fox Keychain", description: null, tags: [] },
      ],
    });
    window.localStorage.setItem("maker.accounts.token", "test-token");

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() => expect(screen.queryByText("Fox Keychain")).not.toBeInTheDocument());
    const approveCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/listings/l1/approve"),
    );
    expect(approveCall).toBeDefined();
    const [, init] = approveCall!;
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ reviewerId: MODERATOR_USER.id });
  });

  it("rejects a listing and removes it from the queue", async () => {
    const fetchMock = vi.mocked(fetch);
    mockModerationFetches(fetchMock, {
      user: MODERATOR_USER,
      listings: [
        { id: "l1", userId: REGULAR_USER.id, title: "Fox Keychain", description: null, tags: [] },
      ],
    });
    window.localStorage.setItem("maker.accounts.token", "test-token");

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));

    await waitFor(() => expect(screen.queryByText("Fox Keychain")).not.toBeInTheDocument());
    const rejectCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/listings/l1/reject"),
    );
    expect(rejectCall).toBeDefined();
  });

  it("approves a preset and removes only it from the material presets queue", async () => {
    const fetchMock = vi.mocked(fetch);
    mockModerationFetches(fetchMock, {
      user: MODERATOR_USER,
      presets: [
        {
          id: "p1",
          material: "Baltic birch plywood 3mm",
          machineType: "diode-laser",
          operation: "cut",
          speed: 300,
          power: 950,
          notes: null,
        },
      ],
    });
    window.localStorage.setItem("maker.accounts.token", "test-token");

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Approve" }));

    await waitFor(() =>
      expect(screen.queryByText(/Baltic birch plywood 3mm/)).not.toBeInTheDocument(),
    );
    const approveCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/presets/p1/approve"),
    );
    expect(approveCall).toBeDefined();
    const [, init] = approveCall!;
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({ reviewerId: MODERATOR_USER.id });
  });

  it("rejects a preset and removes it from the queue", async () => {
    const fetchMock = vi.mocked(fetch);
    mockModerationFetches(fetchMock, {
      user: MODERATOR_USER,
      presets: [
        {
          id: "p1",
          material: "Baltic birch plywood 3mm",
          machineType: "diode-laser",
          operation: "cut",
          speed: 300,
          power: 950,
          notes: null,
        },
      ],
    });
    window.localStorage.setItem("maker.accounts.token", "test-token");

    renderPanel();
    fireEvent.click(await screen.findByRole("button", { name: "Reject" }));

    await waitFor(() =>
      expect(screen.queryByText(/Baltic birch plywood 3mm/)).not.toBeInTheDocument(),
    );
    const rejectCall = fetchMock.mock.calls.find(([url]) =>
      String(url).includes("/presets/p1/reject"),
    );
    expect(rejectCall).toBeDefined();
  });

  it("shows an empty-queue hint for both sections when nothing is pending", async () => {
    const fetchMock = vi.mocked(fetch);
    mockModerationFetches(fetchMock, { user: MODERATOR_USER });
    window.localStorage.setItem("maker.accounts.token", "test-token");

    renderPanel();

    expect(await screen.findAllByText(/Nothing pending review/)).toHaveLength(2);
  });

  describe("Moderator Access", () => {
    const TARGET_ID = "33333333-3333-3333-3333-333333333333";

    function mockRoleFetches(
      fetchMock: ReturnType<typeof vi.mocked<typeof fetch>>,
      roleResponse: Response,
    ) {
      fetchMock.mockImplementation(async (input) => {
        const url = String(input);
        if (url.includes("/me")) return jsonResponse(200, { user: MODERATOR_USER });
        if (url.includes("/listings/pending")) return jsonResponse(200, { listings: [] });
        if (url.includes("/presets/pending")) return jsonResponse(200, { presets: [] });
        if (url.includes(`/users/${TARGET_ID}/role`)) return roleResponse;
        throw new Error(`unexpected fetch in test: ${url}`);
      });
    }

    it("grants moderator access to a target user id", async () => {
      const fetchMock = vi.mocked(fetch);
      mockRoleFetches(fetchMock, jsonResponse(200, { user: { id: TARGET_ID, role: "moderator" } }));
      window.localStorage.setItem("maker.accounts.token", "test-token");

      renderPanel();
      fireEvent.change(await screen.findByPlaceholderText("User ID"), {
        target: { value: TARGET_ID },
      });
      fireEvent.click(screen.getByRole("button", { name: "Grant moderator" }));

      expect(
        await screen.findByText(new RegExp(`${TARGET_ID} is now "moderator"`)),
      ).toBeInTheDocument();
      const roleCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes(`/users/${TARGET_ID}/role`),
      );
      expect(roleCall).toBeDefined();
      const [, init] = roleCall!;
      expect(init?.method).toBe("POST");
      expect((init?.headers as Record<string, string>).Authorization).toBe("Bearer test-token");
      expect(JSON.parse(String(init?.body))).toEqual({ role: "moderator" });
    });

    it("revokes moderator access from a target user id", async () => {
      const fetchMock = vi.mocked(fetch);
      mockRoleFetches(fetchMock, jsonResponse(200, { user: { id: TARGET_ID, role: "user" } }));
      window.localStorage.setItem("maker.accounts.token", "test-token");

      renderPanel();
      fireEvent.change(await screen.findByPlaceholderText("User ID"), {
        target: { value: TARGET_ID },
      });
      fireEvent.click(screen.getByRole("button", { name: "Revoke moderator" }));

      expect(await screen.findByText(new RegExp(`${TARGET_ID} is now "user"`))).toBeInTheDocument();
      const roleCall = fetchMock.mock.calls.find(([url]) =>
        String(url).includes(`/users/${TARGET_ID}/role`),
      );
      expect(JSON.parse(String(roleCall![1]?.body))).toEqual({ role: "user" });
    });

    it("shows an error when the target user id isn't found", async () => {
      const fetchMock = vi.mocked(fetch);
      mockRoleFetches(fetchMock, jsonResponse(404, { error: "Not found" }));
      window.localStorage.setItem("maker.accounts.token", "test-token");

      renderPanel();
      fireEvent.change(await screen.findByPlaceholderText("User ID"), {
        target: { value: TARGET_ID },
      });
      fireEvent.click(screen.getByRole("button", { name: "Grant moderator" }));

      expect(await screen.findByText(/Role update failed with 404/)).toBeInTheDocument();
    });
  });
});
