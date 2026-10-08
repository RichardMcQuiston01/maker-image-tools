import { createServer, type Server } from "node:http";

/**
 * A tiny local HTTP server standing in for a real email provider (Resend) -
 * same rationale as `fakeStripe.ts`: `mailer.ts`'s `sendMail` is plain REST
 * over HTTP with no SDK to intercept, and there's no way to reach a real
 * provider (or use a real API key) from this sandbox, so `MAIL_API_URL` gets
 * pointed at this instead in tests. Copied from `@maker/accounts`'s test
 * double of the same name.
 */
export interface FakeMailProvider {
  baseUrl: string;
  /** Each accepted send, in call order. */
  sent: Array<{ from: string; to: string; subject: string; text: string }>;
  /** When set, every send responds with this HTTP status instead of succeeding. */
  failWithStatus?: number;
  close(): Promise<void>;
}

export async function startFakeMailProvider(): Promise<FakeMailProvider> {
  const sent: FakeMailProvider["sent"] = [];
  const provider: FakeMailProvider = {
    baseUrl: "",
    sent,
    failWithStatus: undefined,
    close: async () => {},
  };

  const server: Server = createServer((req, res) => {
    if (req.method !== "POST") {
      res.writeHead(404).end();
      return;
    }
    const chunks: Buffer[] = [];
    req.on("data", (chunk: Buffer) => chunks.push(chunk));
    req.on("end", () => {
      if (provider.failWithStatus) {
        res.writeHead(provider.failWithStatus).end();
        return;
      }
      const body = JSON.parse(Buffer.concat(chunks).toString("utf-8")) as {
        from: string;
        to: string;
        subject: string;
        text: string;
      };
      sent.push(body);
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ id: `fake-email-${sent.length}` }));
    });
  });

  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Failed to determine fake mail provider port");
  }

  provider.baseUrl = `http://localhost:${address.port}`;
  provider.close = () => new Promise<void>((resolve) => server.close(() => resolve()));
  return provider;
}
