import {
  createServer as createHttpServer,
  type IncomingMessage,
  type ServerResponse,
} from "node:http";
import { join } from "node:path";
import { classifyMaterial } from "./classify.js";
import { loadDepthModel, type DepthModel } from "./depth.js";
import {
  generateImage,
  InvalidDimensionError,
  type GenerateImageOptions,
} from "./generate-image.js";
import { GeminiApiError, GeminiConfigError } from "./gemini-client.js";
import { suggestColorPalette, type SuggestColorPaletteOptions } from "./segment.js";
import { decodeRgbaImage, encodeDepthMap } from "./wire-image.js";

/**
 * Maps an error from a Gemini-backed route to an HTTP status: a missing/bad
 * API key is a server misconfiguration (500), an upstream Gemini failure is
 * a bad gateway (502), everything else falls through to the caller's own
 * status mapping.
 */
function geminiErrorStatus(err: unknown): number | undefined {
  if (err instanceof GeminiConfigError) return 500;
  if (err instanceof GeminiApiError) return 502;
  return undefined;
}

const MAX_BODY_BYTES = 64 * 1024 * 1024;
const DEPTH_MODEL_PATH = join(process.cwd(), "models", "midas-v21-small.onnx");

// Loading the ONNX session takes real time, so it's created once, lazily, on
// the first /depth-map request rather than on every server start (which
// would also slow down tests that never exercise this route).
let depthModelPromise: Promise<DepthModel> | null = null;
function getDepthModel(): Promise<DepthModel> {
  if (!depthModelPromise) {
    depthModelPromise = loadDepthModel(DEPTH_MODEL_PATH);
  }
  return depthModelPromise;
}

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

    // Only /suggest-palette takes a query parameter today; every other route matches on the
    // full req.url exactly as before, which pathname equals whenever there's no query string.
    const [pathname = "", queryString = ""] = (req.url ?? "").split("?", 2);

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
          const status =
            geminiErrorStatus(err) ?? (message === "Request body too large" ? 413 : 500);
          sendJson(res, status, { error: message });
        });
      return;
    }

    if (req.method === "POST" && req.url === "/depth-map") {
      readBody(req)
        .then(async (body) => {
          if (body.length === 0) {
            sendJson(res, 400, { error: "Request body is empty" });
            return;
          }
          const image = decodeRgbaImage(body);
          const model = await getDepthModel();
          const depth = await model.estimateDepth(image);
          const encoded = encodeDepthMap(depth);
          res.writeHead(200, { "Content-Type": "application/octet-stream" });
          res.end(Buffer.from(encoded));
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "Internal error";
          const status =
            message === "Request body too large"
              ? 413
              : message.includes("header") || message.includes("too short")
                ? 400
                : 500;
          sendJson(res, status, { error: message });
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
          const status =
            err instanceof InvalidDimensionError
              ? 400
              : (geminiErrorStatus(err) ?? (message === "Request body too large" ? 413 : 500));
          sendJson(res, status, { error: message });
        });
      return;
    }

    if (req.method === "POST" && pathname === "/suggest-palette") {
      readBody(req)
        .then(async (image) => {
          if (image.length === 0) {
            sendJson(res, 400, { error: "Request body is empty" });
            return;
          }
          const options: SuggestColorPaletteOptions = {};
          const colorCountRaw = new URLSearchParams(queryString).get("colorCount");
          if (colorCountRaw !== null) {
            const colorCount = Number(colorCountRaw);
            if (!Number.isFinite(colorCount)) {
              sendJson(res, 400, { error: '"colorCount" must be a number' });
              return;
            }
            options.colorCount = colorCount;
          }
          const result = await suggestColorPalette(image, options);
          sendJson(res, 200, result);
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : "Internal error";
          const status =
            geminiErrorStatus(err) ?? (message === "Request body too large" ? 413 : 500);
          sendJson(res, status, { error: message });
        });
      return;
    }

    sendJson(res, 404, { error: "Not found" });
  });
}
