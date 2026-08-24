export interface GenerateImageOptions {
  width?: number;
  height?: number;
}

export interface GeneratedImage {
  width: number;
  height: number;
  /** Raw RGBA pixel bytes, width*height*4 long. */
  data: Uint8ClampedArray;
  /** Human-readable disclosure of how the image was produced (notably: stub-mode). */
  notes: string;
}

const DEFAULT_SIZE = 512;
const MAX_DIMENSION = 2048;

/** Thrown for a caller-supplied width/height that's not a finite positive integer within MAX_DIMENSION. */
export class InvalidDimensionError extends Error {}

function validateDimension(name: "width" | "height", value: number): void {
  if (!Number.isInteger(value) || value <= 0) {
    throw new InvalidDimensionError(`"${name}" must be a positive integer`);
  }
  if (value > MAX_DIMENSION) {
    throw new InvalidDimensionError(`"${name}" must be at most ${MAX_DIMENSION}`);
  }
}

/** Simple deterministic string hash (FNV-1a), used only to vary the stub's placeholder pattern per prompt. */
function hashString(input: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = l - c / 2;
  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

/**
 * Stub image generator. ROADMAP.md 5B-3 calls for a diffusion model or
 * hosted API; neither is available in this environment (a real diffusion
 * model is far too large/slow to vendor and run here, unlike 5B-2's depth
 * model, and a hosted API needs real credentials this session doesn't
 * have). This placeholder renders a deterministic gradient derived from a
 * hash of the prompt — never a plausible-looking fake photo — so the
 * request/response contract stays stable for a real provider to be
 * dropped in later without touching the server or client integration.
 */
export async function generateImage(
  prompt: string,
  options?: GenerateImageOptions,
): Promise<GeneratedImage> {
  const width = options?.width ?? DEFAULT_SIZE;
  const height = options?.height ?? DEFAULT_SIZE;
  validateDimension("width", width);
  validateDimension("height", height);
  const hash = hashString(prompt);
  const hue1 = hash % 360;
  const hue2 = (hash >>> 8) % 360;

  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) {
    const t = height <= 1 ? 0 : y / (height - 1);
    const hue = (((hue1 + (hue2 - hue1) * t) % 360) + 360) % 360;
    const [r, g, b] = hslToRgb(hue, 0.55, 0.55);
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = 255;
    }
  }

  return {
    width,
    height,
    data,
    notes:
      "Stub generator: no diffusion model or hosted API is wired up yet. This is a deterministic " +
      "placeholder gradient derived from the prompt, not a real generated image. Replace " +
      "generateImage() with a call to a hosted image-generation API to enable real output.",
  };
}
