# Roadmap: `maker-image-tools`

This roadmap turns the findings in [`RESEARCH.md`](./RESEARCH.md) into a
staged, multi-agent implementation plan. It is ordered so the **quickest,
lowest-risk, purely client-side wins ship first**, and the **AI-dependent,
backend-dependent work comes last**, once there's already a usable product.

It also identifies which planned features are _not_ actually about image
processing — those are broken out into separate, reusable sub-repositories
rather than absorbed into this repo.

---

## Guiding principles

1. **Client-side first.** Nothing in Stages 0–4 needs a server or a model.
   That's a legitimate, shippable v1: a static site that does everything
   LightBurn/xTool Studio/WeCreat Studio do for image prep, vectorization,
   and G-code generation.
2. **AI and servers are additive, not required.** Stage 5+ features are
   layered on top and must degrade gracefully — the app should keep working
   with them turned off.
3. **One package/module per workstream.** Each track below owns its own
   files/package so independent agents can work in parallel with near-zero
   merge conflicts. A monorepo layout (e.g. pnpm workspaces) is assumed:
   `packages/core-image`, `packages/core-vector`, `packages/gcode`,
   `packages/machine-control`, `apps/web`, etc.
4. **Only image/vector/G-code processing lives in this repo.** Accounts,
   billing, cloud sync, community libraries, and AI model hosting are
   generic platform concerns reusable by _other_ maker-tool apps — they
   become their own sub-repos (see [§8](#8-non-image-related-features--reusable-sub-repositories)).

## How to read this roadmap

- **Stages** are sequential — each assumes the previous stage's foundation exists.
- **Tracks** within a stage are independent workstreams — hand each to its
  own agent and run them concurrently.
- **Effort**: S (~1 agent-session), M (a few sessions), L (many sessions,
  likely needs its own sub-plan), XL (a project in its own right).
- Every track lists its dependencies explicitly; anything without a listed
  dependency beyond "Stage 0" can start immediately.

---

## 0. Stage 0 — Foundation

_Single agent, blocking — everything else depends on this._

| Track | Deliverable                                                                                                                                            | Effort |
| ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------ | ------ |
| 0.1   | Monorepo scaffold (pnpm workspaces or Turborepo), TypeScript config, lint/format, unit test runner, CI (build+test on PR)                              | S      |
| 0.2   | `packages/core-image`: `ImageData` load/decode/export pipeline for JPG/PNG/BMP/WebP; pure-function filter interface (`(ImageData, opts) => ImageData`) | S      |
| 0.3   | `packages/core-vector`: SVG DOM load/serialize wrapper, shared geometry types (point/path/bbox) used by every later vector track                       | S      |
| 0.4   | `apps/web`: minimal shell — file drop zone, canvas preview, filter panel placeholder, routing                                                          | S      |

**Exit criteria:** an agent can drop in a new filter function or vector
operation and have it appear in the app with no scaffolding work.

---

## 1. Stage 1 — Quick wins: pure pixel processing

_Depends on: 0.2. Fully parallelizable — these are pure, unit-testable
functions with no UI dependency and no shared state, so they're the ideal
first batch of independent agent tasks._

| Track | Feature                                                                                                    | Effort |
| ----- | ---------------------------------------------------------------------------------------------------------- | ------ |
| 1A    | Grayscale, levels, curves, brightness/contrast/gamma                                                       | S      |
| 1B    | Dithering algorithms: Floyd-Steinberg, Atkinson, Jarvis, Stucki, Sierra, Burkes, Bayer ordered, blue-noise | S      |
| 1C    | Halftone screening, morphology filters (erode/dilate/open/close), classic edge detection (Sobel/Canny)     | M      |
| 1D    | Crop/rotate/resize; DPI test-grid generator; material test-grid (speed×power grid) generator               | S      |

**Exit criteria:** a user can import a photo, apply any filter/dithering
mode, and export a laser-ready 1-bit or grayscale image — matching the
core of MakeLineArt / PhotoEngraving.online / ImagR's "One Click" mode.

---

## 2. Stage 2 — Vector & tracing

_Depends on: 0.3. Tracks are independent of each other; 2A and 2D depend
only on Stage 1 output existing as an input, not on each other's code._

| Track | Feature                                                                                                                                       | Effort |
| ----- | --------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 2A    | Raster→vector tracing engine (Potrace-style, port/wrap an existing WASM Potrace)                                                              | M      |
| 2B    | SVG import/export + vector editor primitives (node editing, path boolean ops)                                                                 | L      |
| 2C    | DXF import/export (wrap a JS DXF parser/writer)                                                                                               | M      |
| 2D    | Text-to-path (opentype.js integration); per-object layer/property data model (speed/power/mode per layer, mirroring LightBurn's layer system) | M      |

**Exit criteria:** a traced or hand-drawn design can be edited node-by-node,
organized into layers with independent settings, and round-tripped through
SVG/DXF — matching LightBurn's/xTool Studio's core editor.

---

## 3. Stage 3 — G-code & machine-facing pipeline

_Depends on: Stage 1 (raster fill data) + Stage 2 (vector path data)._

| Track | Feature                                                                                                                                   | Effort |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 3A    | G-code generation from vector paths (cut) and raster fills (engrave)                                                                      | M      |
| 3B    | G-code viewer/simulator (canvas/WebGL toolpath playback)                                                                                  | M      |
| 3C    | Nesting/packing (wrap the existing SVGnest algorithm as a Web Worker) + kerf/offset compensation (Clipper.js)                             | M      |
| 3D    | Camera preview & alignment (`getUserMedia` + homography calibration) + direct machine control (Web Serial/WebUSB: GRBL jog/stream/status) | L      |

> **Note:** Track 3D is written against a standalone package
> (`@maker/machine-control`, see [§8](#8-non-image-related-features--reusable-sub-repositories))
> from day one rather than app-local code — G-code streaming and Web Serial
> handling are useful to any future maker tool, not just this one.

**Exit criteria:** a design produced in Stage 1–2 can be nested onto stock,
converted to G-code, previewed, and streamed live to a GRBL machine over
USB from the browser — closing the loop end-to-end with zero backend.

---

## 4. Stage 4 — Non-AI "advanced" wins

_Depends on: Stages 1–3. This closes out a legitimate, fully-featured,
100%-client-side v1._

| Track | Feature                                                                                                                                               | Effort |
| ----- | ----------------------------------------------------------------------------------------------------------------------------------------------------- | ------ |
| 4A    | Grayscale→heightmap/STL relief export (brightness remap, non-AI)                                                                                      | S      |
| 4B    | Bundled static material-settings library (curated JSON, not yet crowdsourced)                                                                         | S      |
| 4C    | Parametric design generators (box joints, keychains/earrings, map-from-geodata) — deterministic geometry, not ML, despite how competitors market this | M      |

**v1 ship point:** everything above is a static site. No accounts, no
server, no AI, and it already covers the bulk of LightBurn / xTool Studio /
WeCreat Studio / SVGnest / OpenBuilds CAM feature parity per `RESEARCH.md` §3.

---

## 5. Stage 5 — AI-assisted features

_The "more involved development" tier. Split by where inference runs —
this materially changes cost, latency, and privacy, so treat 5a and 5b as
separate decisions, not one track._

### 5a. Small models, runnable client-side (no new backend)

| Track | Feature                                                                                            | Effort |
| ----- | -------------------------------------------------------------------------------------------------- | ------ |
| 5A-1  | AI background removal — small U²-Net/MODNet model via ONNX Runtime Web (WebGPU with WASM fallback) | L      |
| 5A-2  | AI upscaling — small Real-ESRGAN-class model, size-capped for browser feasibility                  | L      |

Ships as a lazy-loaded, opt-in model bundle inside `apps/web`. Real jump in
complexity vs. Stage 0–4: model conversion/quantization, download-size
budgeting, WebGPU feature-detection and fallback, and quality evaluation
against a held-out image set.

### 5b. Requires a hosted inference backend

| Track | Feature                                                                                                               | Effort |
| ----- | --------------------------------------------------------------------------------------------------------------------- | ------ |
| 5B-1  | AI material auto-detection (classifier + settings mapping trained on real burn data)                                  | L      |
| 5B-2  | AI depth-map / 3D relief generation from a single photo (MiDaS/Depth Anything class model)                            | XL     |
| 5B-3  | AI image generation (diffusion model or hosted API)                                                                   | L      |
| 5B-4  | AI-assisted vectorization of complex multi-color photos (learned segmentation + tracing, Vectorizer.AI-class quality) | XL     |
| 5B-5  | AI smart auto-crop / subject framing (saliency/object detection)                                                      | M      |

All of 5b calls out to `@maker/ai-inference` (see §8) rather than shipping
model weights to the browser. Each track needs an explicit quality gate —
compare output against ImagR / Vectorizer.AI / WeSculpt sample outputs
before merging — since "AI feature technically works" and "AI feature is
competitive" are different bars.

---

## 6. Stage 6+ — Platform growth

Accounts, cloud sync, community libraries, crowdsourced material databases,
and billing all become relevant once there's a working product to attach
them to. None of this is image-processing logic, so none of it is planned
as work _inside_ `maker-image-tools` — see §8 for the full breakout. The
web app in this repo only ever gains thin client SDK calls into those
services (e.g. "save project" hits `@maker/cloud-projects`'s API).

---

## 7. Suggested multi-agent execution order

| Stage | Tracks that run in parallel                                                                            | Hard dependency                       |
| ----- | ------------------------------------------------------------------------------------------------------ | ------------------------------------- |
| 0     | 0.1 → then 0.2, 0.3, 0.4 in parallel                                                                   | none                                  |
| 1     | 1A, 1B, 1C, 1D all in parallel                                                                         | 0.2                                   |
| 2     | 2A, 2C, 2D in parallel; 2B can start alongside but is the largest/riskiest, consider a dedicated agent | 0.3                                   |
| 3     | 3A after 1+2 land; 3B after 3A; 3C and 3D in parallel with 3A                                          | 1, 2                                  |
| 4     | 4A, 4B, 4C all in parallel                                                                             | 3                                     |
| 5a    | 5A-1, 5A-2 in parallel                                                                                 | 4 (app must exist to embed models in) |
| 5b    | 5B-1..5B-5 in parallel, each against `@maker/ai-inference` once it exists                              | `@maker/ai-inference` service (§8)    |

A coordinating agent (or the human maintainer) should own merges into
`main`/staging branches at each stage boundary, since Stage boundaries are
also natural integration/regression-test checkpoints.

---

## 8. Non-image-related features → reusable sub-repositories

These features showed up in the competitor research but aren't image,
vector, or G-code processing — they're generic platform infrastructure.
Building them as separate repos means they can be reused by _any_ future
maker-tool app (not just this one), can be developed/deployed
independently, and don't bloat the client-side-first `maker-image-tools`
bundle with server-dependent code paths.

| Sub-repo                  | Purpose                                                                    | Contains                                                                                                                                           | Stack                                                                           | Consumed starting at                          |
| ------------------------- | -------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------- | --------------------------------------------- |
| `maker-machine-control`   | Browser↔hardware G-code streaming, generic to any laser/CNC/plotter        | Web Serial/WebUSB wrappers, GRBL/Ruida/Marlin protocol adapters, jog/stream/status API                                                             | TS library, no backend                                                          | Stage 3D                                      |
| `maker-nesting`           | Maintained, documented wrapper around part-nesting algorithms              | SVGnest/Deepnest-derived packing engine as a clean TS package + Web Worker harness                                                                 | TS library, no backend                                                          | Stage 3C                                      |
| `maker-accounts`          | User identity                                                              | Auth (OAuth/email), sessions, entitlements/plan tier                                                                                               | Node/TS + Postgres                                                              | Stage 6                                       |
| `maker-billing`           | Subscriptions & payments                                                   | Stripe (or similar) integration, plan management, usage metering                                                                                   | Node/TS                                                                         | Stage 6                                       |
| `maker-cloud-projects`    | Save/sync/share designs across devices                                     | Project CRUD API, object storage (S3-compatible), shareable links                                                                                  | Node/TS + Postgres + object storage                                             | Stage 6                                       |
| `maker-community-library` | Shared project/asset marketplace                                           | Browse/search/publish projects, moderation queue, ratings                                                                                          | Node/TS + Postgres + CDN                                                        | Stage 6                                       |
| `maker-material-db`       | Crowdsourced material settings (speed/power presets by material × machine) | Submission/review API, versioned presets, search                                                                                                   | Node/TS + Postgres                                                              | Stage 4B's static JSON can migrate here later |
| `maker-ai-inference`      | Hosted AI model serving for Stage 5b features                              | Model serving endpoints (background removal, depth-map, material classification, image generation, vectorization), request queueing, rate limiting | Python/FastAPI (or Node + ONNX Runtime) + GPU hosting or third-party model APIs | Stage 5b                                      |

**Integration pattern:** `maker-image-tools` (this repo) depends on the
_client_ packages (`maker-machine-control`, `maker-nesting`) directly as
npm dependencies, and talks to the _service_ repos
(`maker-accounts`/`maker-billing`/`maker-cloud-projects`/
`maker-community-library`/`maker-material-db`/`maker-ai-inference`) purely
over HTTP through thin typed SDK clients — so the core app never has a
hard compile-time dependency on any backend, and Stage 0–4 remain
deployable as a static site indefinitely even after these services exist.
