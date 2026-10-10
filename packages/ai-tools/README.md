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
});
const cutout: ImageData = await bg.removeBackground(image);

const mask = await bg.computeSaliencyMask(image);
const region = computeCropRegion(mask, { threshold: 0.5, margin: 8 });

// Upscaling (ESRGAN-slim via TensorFlow.js).
const upscaler = await loadUpscaleModel(4);
const bigger: ImageData = await upscaler.upscale(image);
```

## Model files and offline use

- **Background removal:** the package ships `models/u2netp.onnx` (about 4.5 MB). Serve or import it yourself and pass it to `loadBackgroundRemovalModel`; nothing is fetched on your behalf.
- **Upscaling:** by default the model definitions load their weights from a public CDN mirror of `@upscalerjs/esrgan-slim`. For a self-contained deployment, serve that package's `models/<scale>x/` directory and pass the resolved `model.json` URL as `modelUrl`.
- **Size:** TensorFlow.js and ONNX Runtime are large. Load this package lazily (`await import(...)`) rather than in your main bundle.

## Licenses

The code is MIT (see `LICENSE`). The bundled `models/u2netp.onnx` is the Apache-2.0 U²-Net-P checkpoint; its attribution is in `models/NOTICE.md` and the licence text is in `models/LICENSE-APACHE-2.0.txt`.
