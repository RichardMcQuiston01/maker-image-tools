// jsdom (unlike a real browser) doesn't implement the ImageData constructor.
// Our source modules use the real, standard `ImageData` global — this is a
// test-environment-only polyfill so those modules can be unit tested without
// a full Canvas 2D stack.
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
