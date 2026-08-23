See `packages/ai-tools/models/NOTICE.md` for `u2netp.onnx`'s provenance/license
(Apache License 2.0, from the original U²-Net authors, redistributed via
danielgatis/rembg's GitHub releases).

`esrgan-slim/2x` and `esrgan-slim/4x` are copied unmodified from the
`@upscalerjs/esrgan-slim` npm package (MIT licensed) so upscaling has no
runtime dependency on the jsdelivr/unpkg CDN mirrors that package's browser
build otherwise falls back to.

These files are vendored directly (not fetched at runtime from any external
host) so both AI features work fully offline once the app is loaded.
