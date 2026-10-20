# maker-image-tools

- Author: [Richard McQuiston](mailto:richard.mcquiston@gmail.com)
- Website: https://richardmcquiston.com/

## Table of Contents

| [Overview](#overview) | [Features](#features) | [Getting Started](#getting-started) | [Project Layout](#project-layout) | [More Information](#more-information) | [Buy Me a Coffee](#buy-me-a-coffee) | [License](#license) | [Copyright](#copyright) |

## Overview

maker-image-tools helps you prepare images for maker machines. These include laser cutters, Computer Numerical Control (CNC) routers, waterjets, and vinyl cutters.

Use it as a web app. You can also install the code libraries by themselves. They are written in TypeScript.

[Back to Top](#table-of-contents)

## Features

- Image filters, such as dithering, blur, and sepia.
- Heightmaps and 3D (STL) files made from gray images.
- Vector tracing, SVG and DXF files, and shape nesting.
- G-code creation and reading for machine toolpaths.
- AI tools: background removal, upscaling, auto-crop, and depth.
- Design generators, material settings, and control of GRBL machines.
- Services in progress: accounts, billing, cloud projects, and shared libraries.

[Back to Top](#table-of-contents)

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org) 20 or newer
- [Bun](https://bun.sh) 1.1 or newer

### Installation

1. Clone the repository.
2. Install the dependencies:

```sh
bun install
```

### Usage

Start the web app on your computer:

```sh
bun run dev
```

Other commands:

```sh
bun run build        # build all packages and apps
bun run test         # run all unit tests
bun run lint         # check code with ESLint
bun run typecheck    # check types in all packages and apps
bun run format       # check formatting with Prettier
bun run format:write # fix formatting
```

### Examples

Four packages are published to npm. This example uses `@richardmcquiston01/core-image`:

```sh
npm i @richardmcquiston01/core-image
```

```ts
import {
  createFilterRegistry,
  imageToHeightmapStl,
  loadImageData,
} from "@richardmcquiston01/core-image";

const image: ImageData = await loadImageData(blob);
const registry = createFilterRegistry();
const stl: string = imageToHeightmapStl(image);
```

This needs `ImageData`, which browsers provide. Each package README has more detail.

[Back to Top](#table-of-contents)

## Project Layout

This is a Bun workspace monorepo. That means many projects share one repository.

### Apps

- [`apps/web`](./apps/web) — the web app (Vite, React, and TypeScript)
- [`apps/accounts`](./apps/accounts/README.md) — sign up, log in, OAuth, and sessions
- [`apps/ai-inference`](./apps/ai-inference/README.md) — backend for the AI-assisted tools
- [`apps/billing`](./apps/billing/README.md) — subscriptions and payments
- [`apps/cloud-projects`](./apps/cloud-projects/README.md) — save, sync, and share designs
- [`apps/community-library`](./apps/community-library/README.md) — shared projects and assets
- [`apps/material-db`](./apps/material-db/README.md) — material settings by material and machine

### Packages

- [`packages/core-image`](./packages/core-image/README.md) — filters, heightmaps, and pixel input and output (npm: `@richardmcquiston01/core-image`)
- [`packages/core-vector`](./packages/core-vector/README.md) — tracing, SVG and DXF, boolean operations, and nesting (npm: `@richardmcquiston01/core-vector`)
- [`packages/gcode`](./packages/gcode/README.md) — G-code generation and parsing (npm: `@richardmcquiston01/gcode`)
- [`packages/ai-tools`](./packages/ai-tools/README.md) — background removal, upscaling, auto-crop, and depth (npm: `@richardmcquiston01/ai-tools`)
- [`packages/quality-gate`](./packages/quality-gate/README.md) — automatic quality checks for the AI tools
- [`packages/generators`](./packages/generators) — box joints, keychains, and geodata designs
- [`packages/machine-control`](./packages/machine-control) — GRBL machine control and camera alignment
- [`packages/material-library`](./packages/material-library) — material setting presets and lookup

[Back to Top](#table-of-contents)

## More Information

- [ROADMAP.md](./ROADMAP.md) — the staged plan for new features
- [RESEARCH.md](./RESEARCH.md) — the research behind the roadmap

[Back to Top](#table-of-contents)

## Buy Me a Coffee

If this app, code, or repository has helped you or someone you know, please consider donating. I appreciate any help to offset the costs of development and/or AI Credits.

[**Donate via Stripe**](https://donate.stripe.com/00w5kD3Gj1Xo9v7gVOcs800), or scan:

[![Donate via Stripe](./donate.svg)](https://donate.stripe.com/00w5kD3Gj1Xo9v7gVOcs800)

[Back to Top](#table-of-contents)

## License

Released under the [MIT License](./LICENSE).

[Back to Top](#table-of-contents)

## Copyright

(c)2026 Richard McQuiston. All rights reserved.

[Back to Top](#table-of-contents)
