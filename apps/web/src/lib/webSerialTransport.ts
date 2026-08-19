import type { SerialTransport } from "@maker/machine-control";

/** Adapts a real Web Serial `SerialPort` to the injectable `SerialTransport` interface. */
export class WebSerialTransport implements SerialTransport {
  private readonly port: SerialPort;
  private writer: WritableStreamDefaultWriter<Uint8Array> | null = null;
  private readonly lineCallbacks = new Set<(line: string) => void>();
  private closed = false;

  constructor(port: SerialPort) {
    this.port = port;
  }

  async open(baudRate = 115200): Promise<void> {
    await this.port.open({ baudRate });
    const writable = this.port.writable;
    if (!writable) throw new Error("Serial port has no writable stream");
    this.writer = writable.getWriter();
    void this.runReadLoop();
  }

  private async runReadLoop(): Promise<void> {
    const readable = this.port.readable;
    if (!readable) return;

    const decoder = new TextDecoderStream();
    const closedPromise = readable
      .pipeTo(decoder.writable as WritableStream<Uint8Array>)
      .catch(() => undefined);
    const reader = decoder.readable.getReader();

    let buffer = "";
    try {
      while (!this.closed) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += value;
        let newlineIndex: number;
        while ((newlineIndex = buffer.indexOf("\n")) >= 0) {
          const line = buffer.slice(0, newlineIndex).replace(/\r$/, "");
          buffer = buffer.slice(newlineIndex + 1);
          if (line.length > 0) {
            for (const callback of this.lineCallbacks) callback(line);
          }
        }
      }
    } finally {
      reader.releaseLock();
      await closedPromise;
    }
  }

  async write(data: string): Promise<void> {
    if (!this.writer) throw new Error("WebSerialTransport: port is not open");
    await this.writer.write(new TextEncoder().encode(data));
  }

  onLine(callback: (line: string) => void): () => void {
    this.lineCallbacks.add(callback);
    return () => this.lineCallbacks.delete(callback);
  }

  async close(): Promise<void> {
    this.closed = true;
    this.writer?.releaseLock();
    this.writer = null;
    await this.port.close().catch(() => undefined);
  }
}
