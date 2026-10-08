# @richardmcquiston01/gcode

G-code generation and parsing for laser, CNC and other maker machines: convert vector paths or raster images to G-code, and parse G-code back into moves with bounds.

Part of [maker-image-tools](https://github.com/RichardMcQuiston01/maker-image-tools).

## Install

```sh
npm i @richardmcquiston01/gcode
```

## Usage

```ts
import { computeGcodeBounds, parseGcode, pathsToGcode } from "@richardmcquiston01/gcode";

const gcode: string = pathsToGcode(paths);
const bounds = computeGcodeBounds(parseGcode(gcode));
```

ESM only.

## License

MIT
