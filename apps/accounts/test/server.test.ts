import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { Server } from "node:http";
import type { Pool } from "pg";
import { createServer } from "../src/server.js";
import { requireTestPool, resetTestDb, setupTestDb } from "./testDb.js";

describe("accounts server", () => {
  let pool: Pool;
  let server: Server;
  let baseUrl: string;

  beforeAll(async () => {
    pool = requireTestPool();
    await setupTestDb(pool);
    server = createServer(pool);
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") {
      throw new Error("Expected server to bind to a numeric port");
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    server.close();
    await pool.end();
  });

  beforeEach(async () => {
    await resetTestDb(pool);
  });

  async function signup(email: string, password: string) {
    return fetch(`${baseUrl}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
  }

  it("signs up a new user and returns a usable session token", async () => {
    const response = await signup("ada@example.com", "hunter22222");
    expect(response.status).toBe(201);
    expect(response.headers.get("access-control-allow-origin")).toBe("*");
    const body = await response.json();
    expect(body.user.email).toBe("ada@example.com");
    expect(body.user.role).toBe("user");
    expect(typeof body.token).toBe("string");

    const me = await fetch(`${baseUrl}/me`, {
      headers: { Authorization: `Bearer ${body.token}` },
    });
    expect(me.status).toBe(200);
    expect((await me.json()).user.id).toBe(body.user.id);
  });

  it("promotes a user to moderator based on MODERATOR_EMAILS on signup, login, and /me", async () => {
    const originalModeratorEmails = process.env.MODERATOR_EMAILS;
    process.env.MODERATOR_EMAILS = "ada@example.com";
    try {
      const signupResponse = await signup("ada@example.com", "hunter22222");
      const signupBody = await signupResponse.json();
      expect(signupBody.user.role).toBe("moderator");

      const login = await fetch(`${baseUrl}/login`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: "ada@example.com", password: "hunter22222" }),
      });
      expect((await login.json()).user.role).toBe("moderator");

      const me = await fetch(`${baseUrl}/me`, {
        headers: { Authorization: `Bearer ${signupBody.token}` },
      });
      expect((await me.json()).user.role).toBe("moderator");
    } finally {
      if (originalModeratorEmails === undefined) {
        delete process.env.MODERATOR_EMAILS;
      } else {
        process.env.MODERATOR_EMAILS = originalModeratorEmails;
      }
    }
  });

  it("rejects signup with a duplicate email with 409", async () => {
    await signup("ada@example.com", "hunter22222");
    const response = await signup("ada@example.com", "different99");
    expect(response.status).toBe(409);
  });

  it("rejects signup with a short password with 400", async () => {
    const response = await signup("ada@example.com", "short");
    expect(response.status).toBe(400);
  });

  it("logs in with correct credentials and rejects wrong ones", async () => {
    await signup("ada@example.com", "hunter22222");

    const ok = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "hunter22222" }),
    });
    expect(ok.status).toBe(200);

    const bad = await fetch(`${baseUrl}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: "ada@example.com", password: "wrong-password" }),
    });
    expect(bad.status).toBe(401);
  });

  it("rejects /me without a bearer token", async () => {
    const response = await fetch(`${baseUrl}/me`);
    expect(response.status).toBe(401);
  });

  it("rejects /me with an invalid bearer token", async () => {
    const response = await fetch(`${baseUrl}/me`, {
      headers: { Authorization: "Bearer not-a-real-token" },
    });
    expect(response.status).toBe(401);
  });

  it("logs out and invalidates the session token", async () => {
    const signupResponse = await signup("ada@example.com", "hunter22222");
    const { token } = await signupResponse.json();

    const logout = await fetch(`${baseUrl}/logout`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    });
    expect(logout.status).toBe(204);

    const me = await fetch(`${baseUrl}/me`, { headers: { Authorization: `Bearer ${token}` } });
    expect(me.status).toBe(401);
  });

  it("reports a user's role for a sibling service to verify", async () => {
    const signupResponse = await signup("ada@example.com", "hunter22222");
    const { user } = await signupResponse.json();

    const response = await fetch(`${baseUrl}/users/${user.id}/role`);
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ role: "user" });
  });

  it("returns 404 for the role of an unknown user id", async () => {
    const response = await fetch(`${baseUrl}/users/00000000-0000-0000-0000-000000000000/role`);
    expect(response.status).toBe(404);
  });

  describe("POST /users/:id/role", () => {
    async function promoteToModerator(email: string) {
      const originalModeratorEmails = process.env.MODERATOR_EMAILS;
      process.env.MODERATOR_EMAILS = email;
      try {
        const signupResponse = await signup(email, "hunter22222");
        return await signupResponse.json();
      } finally {
        if (originalModeratorEmails === undefined) {
          delete process.env.MODERATOR_EMAILS;
        } else {
          process.env.MODERATOR_EMAILS = originalModeratorEmails;
        }
      }
    }

    it("lets an existing moderator promote another user to moderator", async () => {
      const moderator = await promoteToModerator("mod@example.com");
      const targetSignup = await (await signup("target@example.com", "hunter22222")).json();

      const response = await fetch(`${baseUrl}/users/${targetSignup.user.id}/role`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${moderator.token}`,
        },
        body: JSON.stringify({ role: "moderator" }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).user.role).toBe("moderator");

      const roleCheck = await fetch(`${baseUrl}/users/${targetSignup.user.id}/role`);
      expect((await roleCheck.json()).role).toBe("moderator");
    });

    it("lets an existing moderator demote another moderator back to user", async () => {
      const moderator = await promoteToModerator("mod@example.com");
      const otherModerator = await promoteToModerator("other-mod@example.com");

      const response = await fetch(`${baseUrl}/users/${otherModerator.user.id}/role`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${moderator.token}`,
        },
        body: JSON.stringify({ role: "user" }),
      });
      expect(response.status).toBe(200);
      expect((await response.json()).user.role).toBe("user");
    });

    it("rejects a non-moderator caller with 403", async () => {
      const caller = await (await signup("caller@example.com", "hunter22222")).json();
      const target = await (await signup("target@example.com", "hunter22222")).json();

      const response = await fetch(`${baseUrl}/users/${target.user.id}/role`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${caller.token}`,
        },
        body: JSON.stringify({ role: "moderator" }),
      });
      expect(response.status).toBe(403);

      const roleCheck = await fetch(`${baseUrl}/users/${target.user.id}/role`);
      expect((await roleCheck.json()).role).toBe("user");
    });

    it("rejects a request with no bearer token with 401", async () => {
      const target = await (await signup("target@example.com", "hunter22222")).json();
      const response = await fetch(`${baseUrl}/users/${target.user.id}/role`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role: "moderator" }),
      });
      expect(response.status).toBe(401);
    });

    it("rejects an invalid role value with 400", async () => {
      const moderator = await promoteToModerator("mod@example.com");
      const target = await (await signup("target@example.com", "hunter22222")).json();

      const response = await fetch(`${baseUrl}/users/${target.user.id}/role`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${moderator.token}`,
        },
        body: JSON.stringify({ role: "admin" }),
      });
      expect(response.status).toBe(400);
    });

    it("returns 404 for an unknown target user id", async () => {
      const moderator = await promoteToModerator("mod@example.com");
      const response = await fetch(`${baseUrl}/users/00000000-0000-0000-0000-000000000000/role`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${moderator.token}`,
        },
        body: JSON.stringify({ role: "moderator" }),
      });
      expect(response.status).toBe(404);
    });
  });

  it("rejects a request body that isn't valid JSON with 400", async () => {
    const response = await fetch(`${baseUrl}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: "not json",
    });
    expect(response.status).toBe(400);
  });

  it("answers CORS preflight requests", async () => {
    const response = await fetch(`${baseUrl}/signup`, { method: "OPTIONS" });
    expect(response.status).toBe(204);
    expect(response.headers.get("access-control-allow-methods")).toContain("POST");
  });

  it("returns 404 for unknown routes", async () => {
    const response = await fetch(`${baseUrl}/nope`);
    expect(response.status).toBe(404);
  });
});
