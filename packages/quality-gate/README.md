# @maker/quality-gate

`ROADMAP.md` §5b says every Stage 5b AI track "needs an explicit quality gate — compare output
against ImagR / Vectorizer.AI / WeSculpt sample outputs before merging — since 'AI feature
technically works' and 'AI feature is competitive' are different bars." That gate was never
actually built when those tracks shipped (their own test suites only ever assert "real inference
ran and produced a plausible-shaped output", explicitly disclaiming any quality judgment — see e.g.
`packages/ai-tools/test/background-removal.test.ts`'s "not a quality assertion about segmentation
accuracy" comment). This package is that gate, with an important scope caveat below.

## What's actually gated here, and why only this much

This sandbox has no network access, so it can't fetch real ImagR/Vectorizer.AI/WeSculpt sample
outputs to compare against, and no `GEMINI_API_KEY` to call the paid Gemini API this repo's other
Stage 5b tracks depend on. What's left is genuinely useful, just narrower than the roadmap's
original framing: **automated regression gates against synthetic fixtures with exactly-known
ground truth**, for the three Stage 5 tracks that run a real, vendored, local model with no network
or paid-API dependency:

| Track                   | Gated by                                           | Metric                                                          |
| ----------------------- | -------------------------------------------------- | --------------------------------------------------------------- |
| 5A-1 background removal | `background-removal-and-auto-crop.quality.test.ts` | mask IoU vs. an exactly-known circle mask                       |
| 5B-5 smart auto-crop    | same file (reuses the same saliency mask)          | bounding-box IoU vs. the circle's exact bounding box            |
| 5A-2 upscale            | `upscale.quality.test.ts`                          | sharpness (variance of Laplacian) vs. a naive bilinear baseline |

These run as ordinary `bun test` tests against this repo's own already-vendored model files
(`packages/ai-tools/models/u2netp.onnx`, `@upscalerjs/esrgan-slim`'s weights) — no network, no API
key, so they run in CI exactly like every other test in this repo.

**Not gated here, and why**:

- **5B-1 material auto-detection, 5B-3 image generation, 5B-4 AI-assisted vectorization** (all in
  `@maker/ai-inference`) call the paid Gemini API. There's no way to exercise the real model in
  this sandbox (no `GEMINI_API_KEY`, no network egress to Google's API), so there's nothing to
  score. See "Manual eval rubric" below for how to gate these once you have both.
- **5B-2 depth-map generation** runs a real local model (`MiDaS` small, no network needed) — but
  unlike segmentation, monocular depth estimation leans on cues (texture gradients, occlusion,
  learned scene priors) that only exist in real photos. A synthetic flat-color/gradient fixture
  doesn't reliably trigger those cues, so an automated near/far ordering assertion against one
  would be testing the fixture's applicability, not the model's real quality — a meaningfully
  flaky gate is worse than no gate. This is the same reason `apps/ai-inference/test/depth.test.ts`
  itself only asserts "real inference ran, produced values in range, and wasn't perfectly flat" —
  not a directional depth-ordering claim.

## Why sharpness, not PSNR, for upscale

The obvious first instinct for an upscale quality gate is PSNR (or SSIM) against the true
higher-resolution source. Calibrating that against this repo's own vendored ESRGAN-slim model
showed it _loses_ to naive bilinear upsampling on PSNR, consistently, across several synthetic
detail patterns — which sounds like a red flag but isn't: `@maker/ai-tools`'s upscaler is a
GAN-based super-resolution model, and GAN-based super-resolution is well known to trade
pixel-accuracy for perceptually sharper, more plausible-looking detail (that's the entire point of
the "generative adversarial" part — it's rewarded for detail a discriminator finds convincing, not
for matching the source pixel-for-pixel). A PSNR-based gate would fail a model behaving exactly as
designed. Sharpness-vs-naive-baseline is the metric that actually reflects this feature's value
proposition, and calibration showed the real model beating naive bilinear by 19x-38x on it — the
gate's threshold is set well below that with a wide safety margin.

## Manual eval rubric (Gemini-backed tracks)

For 5B-1/5B-3/5B-4, run `@maker/ai-inference` locally with a real `GEMINI_API_KEY` (see its
README) against a handful of your own representative inputs, and judge each output against these
questions rather than an automated pass/fail:

- **5B-1 material detection**: does the suggested material/machine-type/settings match what you'd
  actually pick for that image? Try a few visually similar-but-different materials (e.g. birch vs.
  basswood plywood) and check the classifier doesn't just return the same answer regardless of
  input.
- **5B-3 image generation**: is the output usable as a laser/CNC design source (clean-ish edges,
  a plausible subject, not obviously malformed) for a range of prompts spanning simple/complex
  and literal/stylized asks?
- **5B-4 AI-assisted vectorization**: compare the segmented color-layer output against the source
  photo — are color regions cleanly separated along real edges, or is it bleeding/fragmenting in a
  way a purely algorithmic (non-AI) vectorizer wouldn't?

If you have both the API key and a way to fetch real ImagR/Vectorizer.AI/WeSculpt sample outputs,
comparing against those directly is the original ask this package's automated gates couldn't fully
deliver on — this rubric is the fallback for doing that judgment call by hand instead.
