/**
 * Minimal ambient Web Serial API declaration, scoped to what this app uses
 * (connect/jog/stream over GRBL). `serial` is deliberately declared OPTIONAL
 * on Navigator (unlike the @types/w3c-web-serial package, which marks it
 * always-present) so `"serial" in navigator` / `if (navigator.serial)`
 * feature-detection type-checks correctly for browsers that don't support it.
 */
interface SerialPortInfo {
  usbVendorId?: number;
  usbProductId?: number;
}

interface SerialOptions {
  baudRate: number;
}

interface SerialPort extends EventTarget {
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  open(options: SerialOptions): Promise<void>;
  close(): Promise<void>;
  getInfo(): SerialPortInfo;
}

interface SerialPortRequestOptions {
  filters?: { usbVendorId?: number; usbProductId?: number }[];
}

interface Serial extends EventTarget {
  requestPort(options?: SerialPortRequestOptions): Promise<SerialPort>;
  getPorts(): Promise<SerialPort[]>;
}

interface Navigator {
  readonly serial?: Serial;
}
