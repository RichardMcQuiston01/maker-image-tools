# @richardmcquiston01/ai-tools

In-browser AI image tools for laser, CNC and other maker-machine workflows: background removal, upscaling and subject-aware auto-crop. Everything runs client-side — no API keys and no server.

Part of [maker-image-tools](https://github.com/RichardMcQuiston01/maker-image-tools). Built on [`@richardmcquiston01/core-image`](https://www.npmjs.com/package/@richardmcquiston01/core-image).

## Install

```sh
npm i @richardmcquiston01/ai-tools
```

Requires an environment with `ImageData` (browser, or a polyfill in Node). ESM only.

## Usage

```ts
import {
  computeCropRegion,
  loadBackgroundRemovalModel,
  loadUpscaleModel,
} from "@richardmcquiston01/ai-tools";

// Background removal + auto-crop (U²-Net-P via onnxruntime-web).
// Pass a URL, ArrayBuffer or Uint8Array of the bundled `models/u2netp.onnx`.
const bg = await loadBackgroundRemovalModel("/models/u2netp.onnx", {
  wasmPaths: "/ort/", // where ort-wasm*.wasm is served from (bundlers like Vite need this)
  // executionProviders: ["wasm"], // the default; see the note below before adding "webgpu"
});
const cutout: ImageData = await bg.removeBackground(image);

const mask = await bg.computeSaliencyMask(image);
const region = computeCropRegion(mask, { threshold: 0.5, margin: 8 });

// Upscaling (ESRGAN-slim via TensorFlow.js).
const upscaler = await loadUpscaleModel(4);
const bigger: ImageData = await upscaler.upscale(image);
```

Background removal runs on WebAssembly by default. onnxruntime-web's WebGPU
provider can't run U²-Net-P's MaxPool layers (it fails with "using ceil() in
shape computation is not yet supported for MaxPool" when the model runs, not
when the session is created), so `"webgpu"` is opt-in through
`executionProviders`. If a run fails on WebGPU the model rebuilds its session
on WebAssembly and retries that run once.

## Entry points

TensorFlow.js and ONNX Runtime are large, and most apps need only one of them. Import from the entry point you need so a bundler never has to include the rest:

| Import                                            | Brings                              | Heavy dependency            |
| ------------------------------------------------- | ----------------------------------- | --------------------------- |
| `@richardmcquiston01/ai-tools/background-removal` | `loadBackgroundRemovalModel`        | ONNX Runtime Web            |
| `@richardmcquiston01/ai-tools/auto-crop`          | `computeCropRegion`                 | none                        |
| `@richardmcquiston01/ai-tools/upscale`            | `loadUpscaleModel`                  | TensorFlow.js, the upscaler |
| `@richardmcquiston01/ai-tools/provider`           | `OnnxBackgroundRemover` (see below) | none until the model loads  |
| `@richardmcquiston01/ai-tools`                    | all of the above except `provider`  | everything                  |

The main entry keeps working as before; the others are for apps that care about size. `computeCropRegion` is plain maths, so auto-crop's region helper never needs a model runtime (running the model for the saliency mask still does: that is `background-removal`).

## The model file

The U²-Net model is exported, so a bundler can emit it for you and you can drop any copy step. With Vite:

```ts
import modelUrl from "@richardmcquiston01/ai-tools/models/u2netp.onnx?url";
import { loadBackgroundRemovalModel } from "@richardmcquiston01/ai-tools/background-removal";

const model = await loadBackgroundRemovalModel(modelUrl);
```

In Node, `import.meta.resolve("@richardmcquiston01/ai-tools/models/u2netp.onnx")` gives its location. The licence and attribution files in `models/` are exported the same way.

## As an `ImageGenerator` (optional)

`@richardmcquiston01/ai-tools/provider` wraps background removal as an `ImageGenerator` from [`@richardmcquiston01/ai-providers`](https://www.npmjs.com/package/@richardmcquiston01/ai-providers), so an app can offer it next to other providers (a local ComfyUI, a hosted API) and swap between them through one interface. `ai-providers` is an optional peer dependency: install it only if you use this entry point.

```ts
import {
  browserImageCodec,
  lazyBackgroundRemovalModel,
  OnnxBackgroundRemover,
  REMOVE_BACKGROUND_MODE,
} from "@richardmcquiston01/ai-tools/provider";

const remover = new OnnxBackgroundRemover({
  // ONNX Runtime is imported on first use, so listing the provider costs nothing.
  loadModel: lazyBackgroundRemovalModel("/models/u2netp.onnx"),
  // Providers exchange encoded images; the codec turns them into pixels and back.
  codec: browserImageCodec,
});

const result = await remover.generateImage({
  instructions: "",
  prompt: "",
  images: [{ mimeType: "image/png", data: pngBytes }],
  mode: REMOVE_BACKGROUND_MODE,
});
if (result.ok)
  use(result.value.image); // a PNG with a transparent background
else console.error(result.error); // names the provider and what failed
```

`browserImageCodec` needs the DOM (canvas); pass your own `ImageCodec` elsewhere. The model is loaded once and shared between runs, and a failed load is retried on the next call.

## Model files and offline use

- **Background removal:** the package ships `models/u2netp.onnx` (about 4.5 MB) and exports it (see above). Serve or import it and pass it to `loadBackgroundRemovalModel`; nothing is fetched on your behalf.
- **Upscaling:** by default the model definitions load their weights from a public CDN mirror of `@upscalerjs/esrgan-slim`. For a self-contained deployment, serve that package's `models/<scale>x/` directory and pass the resolved `model.json` URL as `modelUrl`.
- **Size:** TensorFlow.js and ONNX Runtime are large. Load this package lazily (`await import(...)`) rather than in your main bundle.

## Licenses

The code is MIT (see `LICENSE`). The bundled `models/u2netp.onnx` is the Apache-2.0 U²-Net-P checkpoint; its attribution is in `models/NOTICE.md` and the licence text is in `models/LICENSE-APACHE-2.0.txt`.
