# Model attribution

## `u2netp.onnx`

- **Architecture**: U²-Net (small variant, "U2NETP"), from Qin et al., _"U^2-Net: Going
  Deeper with Nested U-Structure for Salient Object Detection"_, Pattern Recognition 2020.
- **Source repository**: https://github.com/xuebinqin/U-2-Net
- **License**: Apache License 2.0 (the u2net/u2netp checkpoints — NOT the separate
  `u2net_portrait` checkpoint, which carries a non-commercial restriction and is not
  used here).
- **File obtained from**: the pre-exported ONNX release published by
  https://github.com/danielgatis/rembg (MIT-licensed project; this file is an
  unmodified redistribution of the original Apache-2.0 licensed weights), at
  https://github.com/danielgatis/rembg/releases/download/v0.0.0/u2netp.onnx
  (SHA-256: `309c8469258dda742793dce0ebea8e6dd393174f89934733ecc8b14c76f4ddd8`).

Vendored directly into this package so background removal runs fully offline with
no runtime dependency on any external CDN or model-hosting service.
