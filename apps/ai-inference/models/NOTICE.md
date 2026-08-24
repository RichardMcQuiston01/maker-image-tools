# Model attribution

## `midas-v21-small.onnx`

- **Architecture**: MiDaS v2.1 small (EfficientNet-Lite3 encoder + lightweight
  depth decoder), from Ranftl et al., _"Towards Robust Monocular Depth
  Estimation: Mixing Datasets for Zero-shot Cross-dataset Transfer"_, TPAMI 2022.
- **Source repository**: https://github.com/isl-org/MiDaS
- **License**: MIT (Copyright (c) 2019 Intel ISL).
- **File obtained from**: the official pre-exported ONNX release published directly
  by isl-org, at
  https://github.com/isl-org/MiDaS/releases/download/v2_1/model-small.onnx
  (SHA-256: `2d8c6cb8f415229daf1eb041024208e2608c9f98e17c81cc7c6ecb449c56fd58`).

Input: 256x256 RGB, ImageNet-normalized (mean=[0.485,0.456,0.406],
std=[0.229,0.224,0.225]), NCHW layout. Output is a single-channel relative
inverse-depth map (higher = nearer); it is not metric depth, so this backend
min-max normalizes it to [0, 1] per image before use.

Vendored directly into this package (rather than fetched from a model hub at
request time) so material/depth inference has no runtime dependency on any
external CDN or model-hosting service. This is a much larger file (~64MB) than
the models vendored under `packages/ai-tools/models/` because MiDaS-class depth
models are too large/heavy for practical browser download and inference —
that's why 5B-2 runs here in `@maker/ai-inference` rather than client-side like
Stage 5a's background removal and upscaling.
