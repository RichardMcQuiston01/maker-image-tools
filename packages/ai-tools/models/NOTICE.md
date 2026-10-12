# Model attribution

## `u2netp.onnx`

- **Architecture**: U²-Net (small variant, "U2NETP"), from Qin et al., _"U^2-Net: Going
  Deeper with Nested U-Structure for Salient Object Detection"_, Pattern Recognition 2020.
- **Source repository**: https://github.com/xuebinqin/U-2-Net
- **License**: Apache License 2.0 — full text in `LICENSE-APACHE-2.0.txt` alongside this file (the u2net/u2netp checkpoints — NOT the separate
  `u2net_portrait` checkpoint, which carries a non-commercial restriction and is not
  used here).
- **File obtained from**: the pre-exported ONNX release published by
  https://github.com/danielgatis/rembg (MIT-licensed project; this file is an
  unmodified redistribution of the original Apache-2.0 licensed weights), at
  https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx
  (SHA-256: `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`).

Vendored directly into this package so background removal runs fully offline with
no runtime dependency on any external CDN or model-hosting service.

## `depth-anything-v2-small.onnx`

- **Architecture**: Depth Anything V2, Small (ViT-S / DINOv2 encoder, DPT decoder), from Yang et al.,
  _"Depth Anything V2"_, NeurIPS 2024.
- **Source repository**: https://github.com/DepthAnything/Depth-Anything-V2
- **License**: Apache License 2.0 — full text in `LICENSE-APACHE-2.0.txt` alongside this file. Only the
  **Small** checkpoint is Apache-2.0; the Base, Large and Giant checkpoints carry a CC-BY-NC-4.0
  (non-commercial) licence and are NOT used here.
- **File obtained from**: the ONNX export published at
  https://huggingface.co/onnx-community/depth-anything-v2-small (file `onnx/model_quantized.onnx`, the
  int8-quantized build, 27,258,801 bytes), redistributed unmodified.
  (SHA-256: `fcf51f1b230362b28690bb9d1809bf0431f29cad20534e3f589bd7285547f20d`).
- **Interface**: input `pixel_values` `[1, 3, H, W]` (H and W multiples of 14, ImageNet mean/std);
  output `predicted_depth` `[1, H, W]`, relative inverse depth (larger = nearer).

Vendored directly into this package so depth estimation runs fully offline, like background removal.
