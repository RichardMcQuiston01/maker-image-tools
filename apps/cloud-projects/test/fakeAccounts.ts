import { createServer, type Server } from "node:http";

/**
 * A tiny local HTTP server standing in for @maker/accounts's `GET /me` -
 * booting a real accounts service (with its own Postgres database) inside
 * this service's test suite just to answer one read-only lookup would be
 * heavy cross-package coupling for a service this repo already treats as a
 * separate deployable, so this mirrors `@maker/community-library`'s
 * `test/fakeAccounts.ts` (which fakes `GET /users/:id/role` the same way):
 * a plain REST endpoint with no SDK to intercept, faked at the HTTP
 * boundary.
 */
export interface FakeAccounts {
  baseUrl: string;
  close(): Promise<void>;
}

/** `sessions` maps a bearer token to the user id `GET /me` should report owning it. */
export async function startFakeAccounts(sessions: Record<string, string>): Promise<FakeAccounts> {
  const server: Server = createServer((req, res) => {
    if (req.method === "GET" && req.url === "/me") {
      const header = req.headers.authorization;
      const token = header?.startsWith("Bearer ") ? header.slice("Bearer ".length) : undefined;
      const userId = token ? sessions[token] : undefined;
      if (!userId) {
        res.writeHead(401, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ error: "Invalid or expired session" }));
        return;
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ user: { id: userId } }));
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
