import { createServer, type Server } from "node:http";

/**
 * A tiny local HTTP server standing in for a real OAuth provider (Google or
 * GitHub) - there's no way to register a real OAuth app or reach a real
 * provider's servers from this sandbox, so this is what `GOOGLE_TOKEN_URL`/
 * `GOOGLE_USERINFO_URL` (or their GitHub equivalents) get pointed at in
 * tests instead. Unlike the SDK-level fakes elsewhere in this repo
 * (`fakeStripe.ts`, `fakeS3.ts`), these providers are plain REST over HTTP
 * with no SDK to intercept, so a real (if tiny) HTTP server is the
 * simplest way to exercise the real token-exchange/userinfo-fetch code
 * paths end to end.
 */
export interface FakeOAuthProviderOptions {
  accessToken?: string;
  tokenResponseStatus?: number;
  /** Google-shaped `GET /userinfo` response. */
  userInfo?: { sub: string; email: string };
  /** GitHub-shaped `GET /user` response. */
  githubUser?: { id: number; email: string | null };
  /** GitHub-shaped `GET /user/emails` response, used when `githubUser.email` is null. */
  githubEmails?: Array<{ email: string; primary: boolean; verified: boolean }>;
}

export interface FakeOAuthProvider {
  baseUrl: string;
  /** Each `/token` request's parsed form body, in call order. */
  tokenRequests: URLSearchParams[];
  close(): Promise<void>;
}

export async function startFakeOAuthProvider(
  options: FakeOAuthProviderOptions = {},
): Promise<FakeOAuthProvider> {
  const accessToken = options.accessToken ?? "fake-access-token";
  const tokenRequests: URLSearchParams[] = [];

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "POST" && url.pathname === "/token") {
      const chunks: Buffer[] = [];
      req.on("data", (chunk: Buffer) => chunks.push(chunk));
      req.on("end", () => {
        tokenRequests.push(new URLSearchParams(Buffer.concat(chunks).toString("utf-8")));
        if (options.tokenResponseStatus && options.tokenResponseStatus !== 200) {
          res.writeHead(options.tokenResponseStatus).end();
          return;
        }
        res.writeHead(200, { "Content-Type": "application/json" });
        res.end(JSON.stringify({ access_token: accessToken }));
      });
      return;
    }

    if (req.method === "GET" && url.pathname === "/userinfo") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(options.userInfo ?? { sub: "fake-sub", email: "fake@example.com" }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/user") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(options.githubUser ?? { id: 123, email: "fake@example.com" }));
      return;
    }

    if (req.method === "GET" && url.pathname === "/user/emails") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(options.githubEmails ?? []));
      return;
    }

    res.writeHead(404).end();
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to determine fake OAuth provider port");
  }

  return {
    baseUrl: `http://localhost:${address.port}`,
    tokenRequests,
    close() {
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}
