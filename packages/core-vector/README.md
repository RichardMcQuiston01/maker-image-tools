# @richardmcquiston01/core-vector

Vector geometry core for laser, CNC and other maker-machine workflows: raster tracing (including multicolor), SVG and DXF import/export, boolean operations, path offset and kerf compensation, text-to-paths, and part nesting.

Part of [maker-image-tools](https://github.com/RichardMcQuiston01/maker-image-tools).

## Install

```sh
npm i @richardmcquiston01/core-vector
```

## Usage

```ts
import { pathsToDxf, svgToPaths, union } from "@richardmcquiston01/core-vector";

const paths = svgToPaths(svgString);
const merged = union(paths[0]!, paths[1]!);
const dxf: string = pathsToDxf(merged);
```

ESM only.

## License

MIT
