/** Pure ImageData helpers with no Canvas/DOM dependency beyond the ImageData constructor itself. */

export function createImageData(
  width: number,
  height: number,
  fill?: [number, number, number, number],
): ImageData {
  const data = new Uint8ClampedArray(width * height * 4);
  if (fill) {
    const [r, g, b, a] = fill;
    for (let i = 0; i < data.length; i += 4) {
      data[i] = r;
      data[i + 1] = g;
      data[i + 2] = b;
      data[i + 3] = a;
    }
  }
  return new ImageData(data, width, height);
}

export function cloneImageData(image: ImageData): ImageData {
  return new ImageData(new Uint8ClampedArray(image.data), image.width, image.height);
}

export function getPixel(image: ImageData, x: number, y: number): [number, number, number, number] {
  const i = (y * image.width + x) * 4;
  const data = image.data;
  return [data[i] ?? 0, data[i + 1] ?? 0, data[i + 2] ?? 0, data[i + 3] ?? 0];
}

export function setPixel(
  image: ImageData,
  x: number,
  y: number,
  rgba: [number, number, number, number],
): void {
  const i = (y * image.width + x) * 4;
  const data = image.data;
  data[i] = rgba[0];
  data[i + 1] = rgba[1];
  data[i + 2] = rgba[2];
  data[i + 3] = rgba[3];
}
