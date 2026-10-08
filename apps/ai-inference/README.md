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
| `ACCOUNTS_URL`          | yes, for `/classify-material`, `/generate-image`, and `/suggest-palette` | —                        | `@maker/accounts` base URL, used to verify the caller's session            |
| `BILLING_URL`           | yes, for `/classify-material`, `/generate-image`, and `/suggest-palette` | —                        | `@maker/billing` base URL, used for plan tier and usage-quota checks       |

`/depth-map` (MiDaS, vendored ONNX model) works with no configuration and needs no API key, and
is the only route with no auth or usage limit — it costs nothing to run, so there's nothing to
ration.

Without `GEMINI_API_KEY` set, `/classify-material`, `/generate-image`, and `/suggest-palette`
respond with `500` and a message explaining the key is missing — there is no silent
stub/placeholder fallback once real API wiring is in place, since a placeholder result could be
mistaken for a real classification, generated image, or suggested palette.

## Authentication and usage quota

`/classify-material`, `/generate-image`, and `/suggest-palette` all call Gemini, so each one
costs real money per request. All three require a `Authorization: Bearer <token>` header, verified
against `@maker/accounts`'s `GET /me` — a missing or invalid/expired token gets `401`.

Usage is tracked under a single `ai_requests` metric via `@maker/billing`'s usage-metering API
(`GET /usage`, `POST /usage`), recorded only after a Gemini call actually succeeds — a failed
call (e.g. a `500` from a missing `GEMINI_API_KEY`) never counts against a caller's usage. Free-tier
callers are capped at 20 AI requests per month; going over returns `402` with a message explaining
the limit. Paid tiers (`pro`/`studio`) have no cap here — usage is still recorded for them, and
`@maker/billing` meters it to Stripe instead (see `apps/billing`'s "Usage-based billing").

## `POST /suggest-palette`

Body: raw image bytes (PNG). Optional `?colorCount=N` query parameter (default 6, clamped to
`[1, 32]`). Returns `{ palette: [number, number, number][], notes: string }` — an RGB triple per
suggested color, ordered as Gemini returned them.

This is a semantic stand-in for `@richardmcquiston01/core-vector`'s default median-cut color quantization: it
asks Gemini to pick colors that separate the image by subject/region rather than pure color
statistics. The palette is the _only_ thing this endpoint produces — assigning pixels to it and
tracing the result into vector layers (`traceImageColors({ palette })`) stays entirely
client-side and works the same whether the palette came from here or from quantization, so the
multi-color vectorization feature keeps working with this endpoint turned off.
