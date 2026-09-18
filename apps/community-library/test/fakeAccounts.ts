import { createServer, type Server } from "node:http";

/**
 * A tiny local HTTP server standing in for @maker/accounts's
 * `GET /users/:id/role` - booting a real accounts service (with its own
 * Postgres database) inside this service's test suite just to answer one
 * read-only lookup would be heavy cross-package coupling for a service
 * this repo already treats as a separate deployable, so this mirrors the
 * `fakeOAuthProvider.ts` pattern instead: a plain REST endpoint with no
 * SDK to intercept, faked at the HTTP boundary.
 */
export interface FakeAccounts {
  baseUrl: string;
  close(): Promise<void>;
}

export async function startFakeAccounts(moderatorIds: string[]): Promise<FakeAccounts> {
  const moderators = new Set(moderatorIds);

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const match = url.pathname.match(/^\/users\/([^/]+)\/role$/);
    if (req.method === "GET" && match) {
      const id = match[1]!;
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ role: moderators.has(id) ? "moderator" : "user" }));
      return;
    }
    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "Not found" }));
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Expected fake accounts server to bind to a numeric port");
  }

  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    close: () => new Promise((resolve) => server.close(() => resolve())),
  };
}
