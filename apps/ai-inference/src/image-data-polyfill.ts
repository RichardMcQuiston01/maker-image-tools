// @maker/core-image's resize/createImageData call the real `ImageData`
// constructor. That's a browser API with no Node equivalent, so this backend
// (which reuses core-image's resize for depth-map preprocessing/upsampling)
// needs a minimal polyfill installed before core-image is imported. Only
// `.width`/`.height`/`.data` are ever read back off the result, so a plain
// polyfill is sufficient — this mirrors the test-only polyfill used
// elsewhere in the workspace, applied here at runtime instead of in tests.
if (typeof globalThis.ImageData === "undefined") {
  class ImageDataPolyfill {
    data: Uint8ClampedArray;
    width: number;
    height: number;

    constructor(dataOrWidth: Uint8ClampedArray | number, widthOrHeight: number, height?: number) {
      if (dataOrWidth instanceof Uint8ClampedArray) {
        this.data = dataOrWidth;
        this.width = widthOrHeight;
        this.height = height ?? 0;
      } else {
        this.width = dataOrWidth;
        this.height = widthOrHeight;
        this.data = new Uint8ClampedArray(this.width * this.height * 4);
      }
    }
  }

  globalThis.ImageData = ImageDataPolyfill as unknown as typeof ImageData;
}

export {};
