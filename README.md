# maker-image-tools

Collection of image tools for editing and processing images for use in Maker and Crafting machines(Laser, CNC, Waterjet, vinyl cutter, etc.)

See [`RESEARCH.md`](./RESEARCH.md) for the feature landscape survey and [`ROADMAP.md`](./ROADMAP.md) for the staged implementation plan.

## Development

This is a [Bun](https://bun.sh) workspace monorepo:

- `packages/core-image` — pure image/pixel processing (filters, ImageData I/O)
- `packages/core-vector` — vector/SVG geometry primitives
- `apps/web` — the web app (Vite + React + TypeScript)

```sh
bun install
bun run dev          # run the web app locally
bun run build        # build all packages/apps
bun run test         # run all unit tests
bun run lint         # lint
bun run typecheck    # typecheck all packages/apps
```
