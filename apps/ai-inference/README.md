# @maker/ai-inference

Backend for the AI-assisted tools in `apps/web`: material detection, depth-map/3D relief,
text-to-image generation, and color-palette suggestion for multi-color vectorization.

## Running

```sh
bun run --cwd apps/ai-inference dev
```

Listens on `PORT` (default `8787`).

## Environment variables

| Variable                | Required                                                                 | Default                  | Used by                                                                    |
| ----------------------- | ------------------------------------------------------------------------ | ------------------------ | -------------------------------------------------------------------------- |
| `PORT`                  | no                                                                       | `8787`                   | server listen port                                                         |
| `GEMINI_API_KEY`        | yes, for `/classify-material`, `/generate-image`, and `/suggest-palette` | —                        | Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) |
| `GEMINI_CLASSIFY_MODEL` | no                                                                       | `gemini-2.5-flash`       | model used for material classification                                     |
| `GEMINI_IMAGE_MODEL`    | no                                                                       | `gemini-2.5-flash-image` | model used for image generation                                            |
| `GEMINI_PALETTE_MODEL`  | no                                                                       | `gemini-2.5-flash`       | model used for color-palette suggestion                                    |

`/depth-map` (MiDaS, vendored ONNX model) works with no configuration and needs no API key.

Without `GEMINI_API_KEY` set, `/classify-material`, `/generate-image`, and `/suggest-palette`
respond with `500` and a message explaining the key is missing — there is no silent
stub/placeholder fallback once real API wiring is in place, since a placeholder result could be
mistaken for a real classification, generated image, or suggested palette.

## `POST /suggest-palette`

Body: raw image bytes (PNG). Optional `?colorCount=N` query parameter (default 6, clamped to
`[1, 32]`). Returns `{ palette: [number, number, number][], notes: string }` — an RGB triple per
suggested color, ordered as Gemini returned them.

This is a semantic stand-in for `@maker/core-vector`'s default median-cut color quantization: it
asks Gemini to pick colors that separate the image by subject/region rather than pure color
statistics. The palette is the _only_ thing this endpoint produces — assigning pixels to it and
tracing the result into vector layers (`traceImageColors({ palette })`) stays entirely
client-side and works the same whether the palette came from here or from quantization, so the
multi-color vectorization feature keeps working with this endpoint turned off.
