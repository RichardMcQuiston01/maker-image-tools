# maker-image-tools

Collection of image tools for editing and processing images for use in Maker and Crafting machines(Laser, CNC, Waterjet, vinyl cutter, etc.)

See [`RESEARCH.md`](./RESEARCH.md) for the feature landscape survey and [`ROADMAP.md`](./ROADMAP.md) for the staged implementation plan.

## Development

This is a pnpm workspace monorepo:

- `packages/core-image` — pure image/pixel processing (filters, ImageData I/O)
- `packages/core-vector` — vector/SVG geometry primitives
- `apps/web` — the web app (Vite + React + TypeScript)

```sh
pnpm install
pnpm dev          # run the web app locally
pnpm build        # build all packages/apps
pnpm test         # run all unit tests
pnpm lint         # lint
pnpm typecheck    # typecheck all packages/apps
```
