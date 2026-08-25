# @maker/ai-inference

Backend for the AI-assisted tools in `apps/web`: material detection, depth-map/3D relief, and text-to-image generation.

## Running

```sh
bun run --cwd apps/ai-inference dev
```

Listens on `PORT` (default `8787`).

## Environment variables

| Variable                | Required                                            | Default                  | Used by                                                                    |
| ----------------------- | --------------------------------------------------- | ------------------------ | -------------------------------------------------------------------------- |
| `PORT`                  | no                                                  | `8787`                   | server listen port                                                         |
| `GEMINI_API_KEY`        | yes, for `/classify-material` and `/generate-image` | —                        | Gemini API key from [Google AI Studio](https://aistudio.google.com/apikey) |
| `GEMINI_CLASSIFY_MODEL` | no                                                  | `gemini-2.5-flash`       | model used for material classification                                     |
| `GEMINI_IMAGE_MODEL`    | no                                                  | `gemini-2.5-flash-image` | model used for image generation                                            |

`/depth-map` (MiDaS, vendored ONNX model) works with no configuration and needs no API key.

Without `GEMINI_API_KEY` set, `/classify-material` and `/generate-image` respond with `500` and a
message explaining the key is missing — there is no silent stub/placeholder fallback once real
API wiring is in place, since a placeholder result could be mistaken for a real classification or
generated image.
