import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { classifyMaterial } from "./classify.js";
import { generateImage, type GenerateImageOptions } from "./generate-image.js";

const MAX_BODY_BYTES = 10 * 1024 * 1024;

function setCorsHeaders(res: ServerResponse): void {
  // Wide open for local/dev use; a real deployment would restrict this to
  // the app's own origin.
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
}

async function readBody(req: IncomingMessage): Promise<Uint8Array> {
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req as AsyncIterable<Buffer>) {
    total += chunk.length;
    if (total > MAX_BODY_BYTES) {
      throw new Error("Request body too large");
    }
    chunks.push(chunk);
  }
  return new Uint8Array(Buffer.concat(chunks));
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  res.writeHead(status, { "Content-Type": "application/json" });
  res.end(JSON.stringify(body));
}

export function createServer() {
  return createHttpServer((req, res) => {
    setCorsHeaders(res);

    if (req.method === "OPTIONS") {
      res.writeHead(204);
      res.end();
      return;
    }

    if (req.method === "POST" && req.url === "/classify-material") {
      readBody(req)
        .then(async (image) => {
          if (image.length === 0) {
            sendJson(res, 400, { error: "Request body is empty" });
            return;
          }
          const result = await classifyMaterial(image);
          sendJson(res, 200, result);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "Internal error";
          sendJson(res, message === "Request body too large" ? 413 : 500, { error: message });
        });
      return;
    }

    if (req.method === "POST" && req.url === "/generate-image") {
      readBody(req)
        .then(async (body) => {
          if (body.length === 0) {
            sendJson(res, 400, { error: "Request body is empty" });
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(Buffer.from(body).toString("utf-8"));
          } catch {
            sendJson(res, 400, { error: "Request body is not valid JSON" });
            return;
          }
          const prompt = (parsed as { prompt?: unknown } | null)?.prompt;
          if (typeof prompt !== "string" || prompt.length === 0) {
            sendJson(res, 400, { error: '"prompt" must be a non-empty string' });
            return;
          }
          const rawWidth = (parsed as { width?: unknown }).width;
          const rawHeight = (parsed as { height?: unknown }).height;
          const options: GenerateImageOptions = {};
          if (typeof rawWidth === "number") options.width = rawWidth;
          if (typeof rawHeight === "number") options.height = rawHeight;

          const result = await generateImage(prompt, options);
          sendJson(res, 200, {
            width: result.width,
            height: result.height,
            dataBase64: Buffer.from(
              result.data.buffer,
              result.data.byteOffset,
              result.data.byteLength,
            ).toString("base64"),
            notes: result.notes,
          });
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "Internal error";
          sendJson(res, message === "Request body too large" ? 413 : 500, { error: message });
        });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  });
}
