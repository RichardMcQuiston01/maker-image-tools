/**
 * Wire format shared between the /depth-map request and response bodies, and
 * between this backend and any client (e.g. apps/web) that calls it: an
 * 8-byte header (uint32 width, uint32 height, little-endian) followed by raw
 * pixel bytes (RGBA for a request image, one float32 per pixel for a depth
 * map). Chosen over JSON so large images/depth maps don't pay JSON's
 * per-number text-encoding overhead.
 *
 * This module has no dependency on onnxruntime-node or node:http, and is
 * exported as a separate subpath (`@maker/ai-inference/wire`) specifically
 * so a browser client can import it without pulling in server-only code.
 */

const HEADER_BYTES = 8;

export interface RgbaImage {
  width: number;
  height: number;
  data: Uint8ClampedArray;
}

export interface DepthMap {
  /** Row-major depth values in [0, 1] (1 = nearest to camera), one per pixel of the source image. */
  values: Float32Array;
  width: number;
  height: number;
}

export function encodeRgbaImage(image: RgbaImage): Uint8Array {
  const out = new Uint8Array(HEADER_BYTES + image.data.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, image.width, true);
  view.setUint32(4, image.height, true);
  out.set(
    new Uint8Array(image.data.buffer, image.data.byteOffset, image.data.byteLength),
    HEADER_BYTES,
  );
  return out;
}

export function decodeRgbaImage(buffer: Uint8Array): RgbaImage {
  const { width, height } = readHeader(buffer, 4);
  const data = new Uint8ClampedArray(
    buffer.buffer,
    buffer.byteOffset + HEADER_BYTES,
    width * height * 4,
  );
  return { width, height, data };
}

export function encodeDepthMap(depth: DepthMap): Uint8Array {
  const out = new Uint8Array(HEADER_BYTES + depth.values.byteLength);
  const view = new DataView(out.buffer);
  view.setUint32(0, depth.width, true);
  view.setUint32(4, depth.height, true);
  out.set(
    new Uint8Array(depth.values.buffer, depth.values.byteOffset, depth.values.byteLength),
    HEADER_BYTES,
  );
  return out;
}

export function decodeDepthMap(buffer: Uint8Array): DepthMap {
  const { width, height } = readHeader(buffer, 4);
  const values = new Float32Array(
    buffer.buffer.slice(
      buffer.byteOffset + HEADER_BYTES,
      buffer.byteOffset + HEADER_BYTES + width * height * 4,
    ),
  );
  return { width, height, values };
}

function readHeader(buffer: Uint8Array, bytesPerPixel: number): { width: number; height: number } {
  if (buffer.length < HEADER_BYTES) {
    throw new Error("Payload too short: missing width/height header");
  }
  const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  const width = view.getUint32(0, true);
  const height = view.getUint32(4, true);
  const expected = HEADER_BYTES + width * height * bytesPerPixel;
  if (buffer.length !== expected) {
    throw new Error(
      `Payload length ${buffer.length} does not match its header (expected ${expected} bytes for ${width}x${height})`,
    );
  }
  return { width, height };
}
