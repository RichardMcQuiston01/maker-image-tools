# Research: Image/Design Tools for Laser, CNC & Maker Machines

This document surveys existing web and desktop tools used to prepare images and
designs for laser cutters, CNC routers, and similar maker machines. For each
feature found, it notes whether the feature is achievable purely in a **web
browser with TypeScript** (client-side, no backend), whether it realistically
**requires a server** (Node/Python/etc.), and whether it **requires AI/ML**
(a trained model), versus being implementable with classic
algorithms/deterministic code.

Goal: identify which parts of a `maker-image-tools` web app can be built as a
pure client-side TypeScript app, which parts need backend infrastructure, and
which parts need an AI/ML model to be competitive with existing products.

---

## 1. Tools Surveyed

| Tool | Type | Platform | Notes |
|---|---|---|---|
| [ImagR](https://imag-r.com/) | Image prep for laser engraving | Browser (SaaS, freemium) | 100+ filters, 3 modes (One Click / Easy / Advanced), AI material optimization, AI background removal, no install |
| [Machines for Makers](https://www.machinesformakers.com/tools) | Reviews, comparisons, buying guides & calculators | Web content site | Not a design tool itself; publishes machine reviews/comparisons and some calculators (settings/kerf guides) |
| xTool Studio (formerly xTool Creative Space / XCS) | Design + machine control | Desktop app (Win/Mac) | Vector/bitmap editor, camera preview, material library (400+ materials/5000+ presets), AI image generation ("AImake"), AI background removal ("AI Cutout"), cloud sync |
| WeCreat Studio (MakeIt) | Design + machine control | Desktop + mobile app | Project/vector library (200+ projects), one-click material presets, camera preview + autofocus; positions itself as a "starter" tool that hands off to LightBurn |
| LightBurn | Layout, vector/raster editing, laser control | Native desktop (Win/Mac/Linux) | 30 layers w/ per-layer power/speed/mode, image tracing, node editing, dithering modes, camera alignment, supports GRBL/Ruida/Trocen/etc. controllers |
| [Vectorizer.AI](https://vectorizer.ai/) | Raster→vector tracing | Browser (SaaS) | AI-assisted tracing to clean, editable SVG/EPS/DXF/PDF |
| [Engravo.app](https://engravo.app/) | Image editing for laser/CNC | Browser (SaaS) | AI depth maps, background removal, vectorization, 20+ tools |
| MakeLineArt / Bonny Creations "Rasterize" / Porexo / PhotoEngraving.online | Free image→engraving converters | Browser (free web tools) | 1-bit/dithered PNG or G-code output; Floyd-Steinberg dithering, Canny edge detection, material presets — all run client-side in the browser, no AI |
| DithX | Dithering/prep tool | Browser (free) | Cited as a free browser-based alternative to ImagR |
| [pic.net Heightmap Generator](https://www.pic.net/heightmap/) | Grayscale→heightmap/STL | Browser, no-upload | Adjust depth/contrast/smoothing, export PNG/STL — purely local canvas processing |
| WeSculpt / 3D AI Studio / Vector Witch / EasyCreate (Vectric) | Photo→3D relief / depth map | Browser (SaaS) | AI monocular depth estimation to generate CNC-carvable relief models |
| [SVGnest](https://svgnest.com/) / Deepnest | Part nesting (packing) | Browser (SVGnest, open source) / Desktop (Deepnest) | Genetic-algorithm nesting of SVG/DXF shapes to minimize material waste; SVGnest is now bundled inside LightBurn |
| Easel (Inventables) | CAD/CAM for CNC routers | Browser (cloud SaaS) | Full design→toolpath→carve pipeline in-browser; drives GRBL/FluidNC machines live over USB via the browser (WebUSB/WebSerial-style access), or exports G-code |
| OpenBuilds CAM | SVG/DXF/bitmap → G-code | Browser (free web app) | Toolpath generation entirely client-side |
| Carbide Create | CAD/CAM for CNC | Desktop (free tier) | Vector design + toolpaths for Carbide 3D routers |
| Snapmaker Luban | 3-in-1 (3D print/laser/CNC) | Desktop, open source | G-code generation for all three processes; built on CNCjs + CuraEngine |
| GRBLWeb / Universal G-Code Sender (UGS) | G-code sender / machine control | Browser (GRBLWeb) / Java desktop (UGS) | Demonstrates that direct serial control of GRBL machines is achievable from a browser via the Web Serial API |

---

## 2. Feature Matrix

Legend:
- **Client TS** — Yes = fully achievable in-browser with TypeScript/Canvas/WebGL/WASM, no backend needed.
- **Needs Server** — Yes = realistically needs a backend (accounts, storage, heavy compute, licensing, shared datasets).
- **Needs AI** — Yes = needs a trained ML model to be competitive; "Optional" = a non-AI version is easy, but an AI version is noticeably better.

| Feature | Description | Client TS | Needs Server | Needs AI |
|---|---|:---:|:---:|:---:|
| File import (JPG/PNG/BMP/WebP/SVG) | Drag-drop/upload and decode raster + vector formats | ✅ Yes | ❌ No | ❌ No |
| DXF import/export | Parse/write AutoCAD DXF | ✅ Yes (JS DXF libs exist) | ❌ No | ❌ No |
| Grayscale conversion | Luminance/weighted grayscale | ✅ Yes | ❌ No | ❌ No |
| Levels & Curves | Histogram-based tone mapping | ✅ Yes | ❌ No | ❌ No |
| Brightness/Contrast/Gamma | Pixel math | ✅ Yes | ❌ No | ❌ No |
| Dithering (Floyd-Steinberg, Atkinson, Jarvis, Stucki, Sierra, Burkes, Bayer, Blue Noise) | Convert grayscale to 1-bit patterns for engraving | ✅ Yes | ❌ No | ❌ No |
| Halftone patterns | Line/dot screen generation | ✅ Yes | ❌ No | ❌ No |
| Morphology filters (erode/dilate/open/close) | Classic image-processing ops | ✅ Yes | ❌ No | ❌ No |
| Edge detection (Sobel/Canny) | Classic gradient-based edge finding | ✅ Yes (WASM/opencv.js helps perf) | ❌ No | ❌ No |
| Crop / Rotate / Resize | Canvas transforms | ✅ Yes | ❌ No | ❌ No |
| DPI/test-grid pattern generator | Generate calibration grids | ✅ Yes | ❌ No | ❌ No |
| Material test-grid (speed/power grid) generator | Generate a grid of settings combos to burn | ✅ Yes | ❌ No | ❌ No |
| Raster-to-vector tracing (Potrace-style, single/limited colors) | Classic bitmap tracing to Bézier paths | ✅ Yes (potrace has a JS/WASM port) | ❌ No | ❌ No |
| Multi-color/complex photo vectorization ("Vectorizer.AI" quality) | Clean, semantically-aware vector regions from complex photos | ⚠️ Partial | ✅ Often | ⚠️ Optional/Better with AI |
| SVG vector editing (nodes, paths, boolean ops, text) | Standard vector editor | ✅ Yes (proven by svg-edit, Method Draw, etc.) | ❌ No | ❌ No |
| Layer management (per-layer speed/power/mode) | UI/data model | ✅ Yes | ❌ No | ❌ No |
| Font rendering / text-to-path | Use browser text/Canvas + opentype.js | ✅ Yes | ❌ No | ❌ No |
| G-code generation from vector/raster data | Deterministic path→G-code math | ✅ Yes | ❌ No | ❌ No |
| G-code viewer/simulator | Parse + render toolpath in canvas/WebGL | ✅ Yes | ❌ No | ❌ No |
| Nesting/packing (SVGnest-style) | Genetic-algorithm bin packing of parts | ✅ Yes (already shipped as JS, use Web Worker for perf) | ❌ No (server optional for very large jobs) | ❌ No |
| Kerf/offset compensation | Path offsetting math (Clipper.js) | ✅ Yes | ❌ No | ❌ No |
| Direct machine control (jog, stream G-code, real-time status) | Web Serial / Web USB API to talk to GRBL/etc. | ✅ Yes (Chrome/Edge only, HTTPS required) | ❌ No | ❌ No |
| Camera preview & alignment (checkerboard/homography calibration) | getUserMedia + perspective-transform math | ✅ Yes | ❌ No | ❌ No |
| Material settings library (lookup by material+machine) | Static/curated dataset | ✅ Yes (bundled JSON) for a fixed set | ✅ Yes for a large, crowdsourced, frequently-updated library (e.g., 400+ materials/5000+ presets) | ❌ No |
| User accounts, saved projects, cross-device sync | Auth, DB, storage | ❌ No | ✅ Yes | ❌ No |
| Cloud project/asset library, marketplace, community projects | Shared content, moderation, CDN | ❌ No | ✅ Yes | ❌ No |
| Subscription/licensing/payments | Billing, entitlements | ❌ No | ✅ Yes | ❌ No |
| Batch processing of many/large images | Can be done client-side for modest volumes; queueing/scale needs a backend | ⚠️ Partial | ✅ For scale | ❌ No |
| AI background removal (subject/foreground segmentation) | Salient-object/portrait segmentation | ⚠️ Small models feasible client-side via WASM/WebGPU (e.g., ONNX U²-Net) | ✅ Typically, for best quality | ✅ Yes |
| AI image upscaling / super-resolution | ESRGAN-style upscalers | ⚠️ Small images feasible client-side (WebGPU) | ✅ Typically | ✅ Yes |
| AI denoising / detail enhancement (Topaz-style) | Learned denoising beyond classic filters | ⚠️ Classic denoise (bilateral/NLM) is non-AI; top quality needs a model | ✅ For best quality | ✅ Optional (classic alt. exists) |
| AI material auto-detection from photo | Classify material for auto-settings | ❌ No client equivalent | ✅ Yes | ✅ Yes |
| AI depth-map / 3D relief generation from a single 2D photo | Monocular depth estimation (e.g., MiDaS/Depth Anything) for CNC relief carving | ❌ Not practical client-side at quality | ✅ Yes | ✅ Yes |
| AI image generation (text-to-image design/art) | Diffusion-model generation | ❌ No | ✅ Yes | ✅ Yes |
| AI-assisted "smart" vectorization of complex photos | Semantic region detection + tracing | ⚠️ Partial with classic clustering | ✅ For best quality | ✅ Yes |
| AI auto-crop / smart subject framing | Object/saliency detection | ⚠️ Basic heuristics (contrast/entropy) possible without AI | ✅ For best quality | ✅ Optional |
| Parametric design generators (jewelry, boxes, maps, keychains) | Rule-based/algorithmic generation from parameters (often mislabeled "AI" in marketing) | ✅ Yes — this is usually deterministic parametric code, not ML | ❌ No | ❌ No (despite marketing) |

---

## 3. Features That Are Easily Replicated in TypeScript, Without AI

These are proven to work client-side today (several of the tools above already
ship this way — Easel, OpenBuilds CAM, SVGnest, MakeLineArt, PhotoEngraving.online,
pic.net's heightmap tool, DithX — are all browser-only, no AI):

- Image import/export (raster + SVG/DXF), crop/rotate/resize
- Grayscale, levels/curves, brightness/contrast/gamma
- All classic dithering algorithms (Floyd-Steinberg, Atkinson, Jarvis, Stucki, Sierra, Burkes, Bayer ordered, blue-noise) and halftone screening
- Morphology filters, classic edge detection (Sobel/Canny)
- Potrace-style raster→vector tracing for line art/high-contrast images
- Vector editing (nodes, paths, boolean ops, text-to-path)
- Layer/per-layer settings management
- G-code generation, G-code viewing/simulation
- Nesting/packing (SVGnest is literally already a browser-only TS/JS library)
- Kerf offsetting (Clipper.js-style polygon offsetting)
- Direct machine control over Web Serial/Web USB (jogging, streaming G-code, reading status) — Chrome/Edge desktop only
- Camera-based alignment via `getUserMedia` + homography/perspective transform math
- Grayscale-image-to-heightmap/STL export (non-AI relief generation, like pic.net's tool)
- "AI design generator" style parametric tools (box generators, keychain/earring generators, map-from-real-geodata generators) — these are deterministic/parametric, not actually ML, and are straightforward in TS

**Conclusion:** the large majority of what LightBurn, xTool Studio, WeCreat
Studio, and the free browser converters (MakeLineArt, Porexo, PhotoEngraving.online)
offer as their *core* feature set is classic, deterministic image/vector/G-code
processing — well-suited to a pure client-side TypeScript app with no backend
and no AI.

---

## 4. Features That Realistically Require a Server

Not because the algorithm needs a backend, but because the *feature itself* is
inherently multi-user/shared/stateful or requires more compute/storage than is
reasonable to ship to every browser tab:

- User accounts, authentication, saved/synced projects across devices
- Community/shared project libraries, asset marketplaces, moderation
- Large, continuously-updated, crowdsourced material-settings databases (e.g., xTool's 400+ materials/5000+ presets)
- Subscriptions, billing, license/entitlement checks (ImagR's paid tiers)
- Large-scale batch processing / job queues for many users at once
- Hosting/serving AI models too large or slow to run client-side (see §5)
- Any workflow needing durable server-side storage of user-uploaded images (e.g., for support, re-processing, or sharing links)

None of these strictly require **Python** — a Node/TypeScript backend (e.g.,
a lightweight API + Postgres/S3) covers all of them. Python becomes the natural
choice specifically when hosting AI/ML model inference (§5), where the ML
ecosystem (PyTorch/ONNX Runtime, HuggingFace, OpenCV) is more mature — though
ONNX Runtime and most inference servers can also be run from Node.js if
preferred.

---

## 5. Features That More or Less Require AI

These are the features where competitors clearly differentiate using trained
models, and where a non-AI implementation would be noticeably worse or
effectively impossible at comparable quality:

1. **Background removal** (ImagR, xTool Studio "AI Cutout", remove.bg) — needs a
   salient-object/portrait segmentation model (e.g., U²-Net, MODNet, or a
   hosted API like remove.bg). A small ONNX model can run client-side via
   WebGPU/WASM for modest quality; best quality needs a server-hosted model.
2. **AI image upscaling** (Topaz-style super-resolution) — needs a
   super-resolution model (ESRGAN/Real-ESRGAN class); classic bicubic/Lanczos
   upscaling is trivial in TS but clearly inferior.
3. **AI denoising/detail enhancement** — classic filters (bilateral, non-local
   means) work reasonably; learned denoisers produce visibly better results on
   noisy/low-res source photos.
4. **AI material auto-detection & auto-optimized settings** (ImagR's "AI
   optimization for wood, slate, acrylic & 10+ materials") — needs an image
   classifier plus a settings-mapping model/heuristic trained on real burn data.
5. **AI depth-map / 3D relief generation from a single photo** (WeSculpt, 3D AI
   Studio, EasyCreate by Vectric, Engravo.app) — needs monocular depth
   estimation (e.g., MiDaS, Depth Anything). This is fundamentally different
   from the non-AI grayscale→heightmap tools (like pic.net), which only remap
   existing pixel brightness to depth rather than inferring 3D structure from a
   flat photo.
6. **AI image generation** ("AImake" in xTool Studio, Gemini-based generation) —
   requires a diffusion/generative model; not feasible without a hosted model.
7. **AI-assisted vectorization of complex, multi-color photographs** to clean,
   semantically meaningful vector regions (Vectorizer.AI's headline feature) —
   basic Potrace-style tracing is non-AI and works for line art/logos, but
   matching Vectorizer.AI's quality on complex photos needs learned
   segmentation/edge understanding.
8. **AI smart auto-crop/subject framing** — benefits from saliency/object
   detection models; simple entropy/contrast-based heuristics can approximate
   it without AI but are less reliable.

**Note on marketing language:** several "AI-powered" design generator features
(xTool's earring/keychain/box/map generators) are, on inspection, likely
parametric/rule-based generators rather than true ML — worth verifying per
product, but not something to assume requires a model just because a vendor
calls it "AI."

---

## 6. Recommendation for `maker-image-tools`

Given the above, a pure client-side TypeScript web app (no backend, no AI) can
credibly replicate the **core** functionality of LightBurn/xTool
Studio/WeCreat Studio/MakeLineArt/PhotoEngraving.online/SVGnest/OpenBuilds CAM:
image import, grayscale/levels/curves, all standard dithering algorithms,
classic edge detection, Potrace-style vector tracing, vector editing, layered
G-code generation, nesting, kerf offsetting, G-code preview, and even direct
machine control via the Web Serial API (Chrome/Edge).

The features that would meaningfully differentiate the product but require
either a server or an AI model are: accounts/cloud sync, a
large/crowdsourced material-settings database, AI background removal, AI
upscaling, AI material detection, and AI depth-map/relief generation from
photos. These can be treated as a **v2 roadmap** layered on top of a working
v1 that is 100% client-side.
