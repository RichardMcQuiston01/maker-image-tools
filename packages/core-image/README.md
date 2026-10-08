# @richardmcquiston01/core-image

Image processing core for laser, CNC and other maker-machine workflows: a filter registry (dithering, tone, edge/morphology, transforms, test grids), image I/O helpers, and grayscale heightmap-to-STL conversion.

Part of [maker-image-tools](https://github.com/RichardMcQuiston01/maker-image-tools).

## Install

```sh
npm i @richardmcquiston01/core-image
```

## Usage

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

Requires an environment with `ImageData` (browser, or a polyfill in Node). ESM only.

## License

MIT
