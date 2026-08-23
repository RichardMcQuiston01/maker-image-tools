import { createServer } from "./server.js";

const DEFAULT_PORT = 8787;

function resolvePort(): number {
  const raw = process.env.PORT?.trim();
  if (!raw) {
    return DEFAULT_PORT;
  }
  const parsed = Number(raw);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
    throw new Error(`Invalid PORT env var "${process.env.PORT}" (expected an integer 0-65535)`);
  }
  return parsed;
}

const port = resolvePort();

createServer().listen(port, () => {
  console.log(`@maker/ai-inference listening on http://localhost:${port}`);
});
