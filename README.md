# maker-image-tools

Collection of image tools for editing and processing images for use in Maker and Crafting machines (Laser, CNC, Waterjet, vinyl cutter, etc.)

## Apps

- [`apps/web`](./apps/web) — the web app (Vite + React + TypeScript)
- [`apps/accounts`](./apps/accounts/README.md) — user identity: signup/login, OAuth, sessions
- [`apps/ai-inference`](./apps/ai-inference/README.md) — backend for the AI-assisted tools
- [`apps/billing`](./apps/billing/README.md) — subscriptions and payments
- [`apps/cloud-projects`](./apps/cloud-projects/README.md) — save, sync and share designs across devices
- [`apps/community-library`](./apps/community-library/README.md) — shared project/asset marketplace
- [`apps/material-db`](./apps/material-db/README.md) — crowdsourced material settings by material and machine

## Packages

- [`packages/core-image`](./packages/core-image/README.md) — image processing: filters, heightmaps, pixel I/O (published to npm as `@richardmcquiston01/core-image`)
- [`packages/core-vector`](./packages/core-vector/README.md) — vector geometry: tracing, SVG/DXF, boolean ops, nesting (published to npm as `@richardmcquiston01/core-vector`)
- [`packages/gcode`](./packages/gcode/README.md) — G-code generation and parsing (published to npm as `@richardmcquiston01/gcode`)
- [`packages/quality-gate`](./packages/quality-gate/README.md) — automated quality gate for the AI-assisted tools
- [`packages/ai-tools`](./packages/ai-tools/README.md) — AI-assisted image tools: background removal, upscaling, auto-crop (published to npm as `@richardmcquiston01/ai-tools`)
- [`packages/generators`](./packages/generators) — design generators: box joints, keychains, geodata
- [`packages/machine-control`](./packages/machine-control) — GRBL machine control and camera homography
- [`packages/material-library`](./packages/material-library) — material setting presets and lookup

## Development

This is a [Bun](https://bun.sh) workspace monorepo.

```sh
bun install
bun run dev          # run the web app locally
bun run build        # build all packages/apps
bun run test         # run all unit tests
bun run lint         # lint
bun run typecheck    # typecheck all packages/apps
```

## Buy Me a Coffee

If this app, code, or repository has helped you or someone you know, please consider donating. I appreciate any help to offset the costs of development and/or AI Credits.

[**Donate via Stripe**](https://donate.stripe.com/00w5kD3Gj1Xo9v7gVOcs800), or scan:

[![Donate via Stripe](./donate.svg)](https://donate.stripe.com/00w5kD3Gj1Xo9v7gVOcs800)

## Copyright

Copyright (c) 2026 Richard McQuiston

## License

Released under the [MIT License](./LICENSE).
