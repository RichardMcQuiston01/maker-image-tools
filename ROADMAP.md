# Roadmap: `maker-image-tools`

This roadmap turns the findings in [`RESEARCH.md`](./RESEARCH.md) into a
staged, multi-agent implementation plan. It is ordered so the **quickest,
lowest-risk, purely client-side wins ship first**, and the **AI-dependent,
backend-dependent work comes last**, once there's already a usable product.

It also identifies which planned features are _not_ actually about image
processing — those get their own `apps/*` workstream inside this monorepo
rather than a separate repository (see [§8](#8-non-image-related-features--in-repo-platform-workstreams)
for why).

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
   merge conflicts. A monorepo layout (Bun workspaces) is assumed:
   `packages/core-image`, `packages/core-vector`, `packages/gcode`,
   `packages/machine-control`, `apps/web`, etc.
4. **Non-image platform concerns still live in this repo, as their own
   workstream.** Accounts, billing, cloud sync, community libraries, and AI
   model hosting are generic platform concerns that _could_ be reused by
   other maker-tool apps, but every workstream that's reached this point —
   `@maker/machine-control`, nesting, `@maker/ai-inference` — ended up
   staying in this monorepo rather than a separate repo, since there's been
   no second consumer to justify the split. Stage 6 follows the same
   pattern: its own `apps/*` workspace, not a new repo (see
   [§8](#8-non-image-related-features--in-repo-platform-workstreams)).

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
| 0.1   | Monorepo scaffold (Bun workspaces), TypeScript config, lint/format, unit test runner, CI (build+test on PR)                                            | S      |
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

> **Note:** Track 3D is written against a standalone workspace package
> (`@maker/machine-control`, see [§8](#8-non-image-related-features--in-repo-platform-workstreams))
> from day one rather than app-local code — G-code streaming and Web Serial
> handling are useful to any future maker tool, not just this one — even
> though it currently lives in this same monorepo rather than its own repo.

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

All of 5b calls out to `@maker/ai-inference` (an in-repo workspace, see §8)
rather than shipping model weights to the browser. Each track needs an
explicit quality gate —
compare output against ImagR / Vectorizer.AI / WeSculpt sample outputs
before merging — since "AI feature technically works" and "AI feature is
competitive" are different bars.

---

## 6. Stage 6+ — Platform growth

Accounts, cloud sync, community libraries, crowdsourced material databases,
and billing all become relevant once there's a working product to attach
them to. None of this is image-processing logic, but per §8 it's still
built as its own `apps/*` workspace inside this monorepo (mirroring
`apps/ai-inference`) rather than a separate repository — see §8 for the
current plan and the reasoning. `apps/web` only ever gains thin client
calls into those workspaces (e.g. "save project" hits `apps/cloud-projects`'s
API), the same way it already talks to `apps/ai-inference` today.

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

## 8. Non-image-related features → in-repo platform workstreams

These features showed up in the competitor research but aren't image,
vector, or G-code processing — they're generic platform infrastructure.
Earlier drafts of this roadmap planned them as separate, reusable
repositories so they could be shared by future maker-tool apps. In
practice, every workstream that's reached this point stayed inside this
monorepo instead: `@maker/machine-control` (Stage 3D) and nesting (folded
into `@maker/core-vector`, Stage 3C) are workspace packages, and
`@maker/ai-inference` (Stage 5b) is a workspace app — none of them became
a separate repo, because there's been no second consuming app yet to
justify the cross-repo publish/version/consume overhead. Stage 6 follows
the same precedent: each concern below gets its own `apps/*` workspace
here rather than a standalone repo.

The tradeoff this accepts: these workstreams don't get reused by other
maker-tool projects for free, and mixing a static client-side site with
authenticated backend services (Postgres, Stripe, object storage) in one
repo means a wider range of deploy targets and CI jobs than Stage 0–4 alone
needed. `apps/web`'s build must keep importing only client-safe subpaths
from each of these — the same discipline `@maker/ai-inference/wire`
already established, and that PR #14/#15's bundle-content check already
verifies — so the static-site build never picks up a server-only
dependency. If a second maker-tool app is ever built and needs to share
one of these services, that's the trigger to extract it into its own repo
then, not before.

| Workstream               | Purpose                                                                    | Contains                                                                                                                                  | Stack                               | Consumed starting at                          |
| ------------------------ | -------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------- | --------------------------------------------- |
| `apps/accounts`          | User identity                                                              | Auth (OAuth/email), sessions, entitlements/plan tier                                                                                      | Node/TS + Postgres                  | Stage 6                                       |
| `apps/billing`           | Subscriptions & payments                                                   | Stripe (or similar) integration, plan management, usage metering                                                                          | Node/TS                             | Stage 6                                       |
| `apps/cloud-projects`    | Save/sync/share designs across devices                                     | Project CRUD API, object storage (S3-compatible), shareable links                                                                         | Node/TS + Postgres + object storage | Stage 6                                       |
| `apps/community-library` | Shared project/asset marketplace                                           | Browse/search/publish projects, moderation queue, ratings                                                                                 | Node/TS + Postgres + CDN            | Stage 6                                       |
| `apps/material-db`       | Crowdsourced material settings (speed/power presets by material × machine) | Submission/review API, versioned presets, search                                                                                          | Node/TS + Postgres                  | Stage 4B's static JSON can migrate here later |
| `apps/ai-inference`      | Hosted AI model serving for Stage 5b features                              | Model serving endpoints (material classification, depth-map, image generation, color-palette suggestion), request queueing, rate limiting | Node/TS + ONNX Runtime + Gemini API | Stage 5b — **already built**                  |

**Integration pattern:** `apps/web` depends on `@maker/machine-control` and
`@maker/core-vector` (which now includes nesting) directly as workspace
packages, and talks to the service workspaces above
(`apps/accounts`/`apps/billing`/`apps/cloud-projects`/
`apps/community-library`/`apps/material-db`/`apps/ai-inference`) purely
over HTTP through thin typed client calls — so `apps/web` never has a hard
compile-time dependency on any backend, and Stage 0–4 remain deployable as
a static site indefinitely even after these services exist.
