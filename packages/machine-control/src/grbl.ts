/**
 * GRBL protocol implementation over an injectable transport.
 *
 * This module contains no reference to `navigator.serial` or `SerialPort` —
 * it is written entirely against the small `SerialTransport` interface below
 * so it can be unit tested without real hardware. A real Web Serial-backed
 * adapter implementing `SerialTransport` is expected to be added separately.
 */

export interface SerialTransport {
  write(data: string): Promise<void>;
  /** Registers a callback invoked once per complete line received (already newline-stripped). Returns an unsubscribe function. */
  onLine(callback: (line: string) => void): () => void;
}

export type GrblStatus =
  "Idle" | "Run" | "Hold" | "Jog" | "Alarm" | "Door" | "Check" | "Home" | "Sleep" | "Unknown";

export interface GrblPosition {
  x: number;
  y: number;
  z: number;
}

export interface GrblState {
  status: GrblStatus;
  machinePosition: GrblPosition | null;
  workPosition: GrblPosition | null;
}

const KNOWN_STATUSES: readonly string[] = [
  "Idle",
  "Run",
  "Hold",
  "Jog",
  "Alarm",
  "Door",
  "Check",
  "Home",
  "Sleep",
];

function toGrblStatus(word: string): GrblStatus {
  return KNOWN_STATUSES.includes(word) ? (word as GrblStatus) : "Unknown";
}

function parsePosition(field: string): GrblPosition | null {
  const parts = field.split(",");
  if (parts.length !== 3) {
    return null;
  }
  const x = Number(parts[0]);
  const y = Number(parts[1]);
  const z = Number(parts[2]);
  if (Number.isNaN(x) || Number.isNaN(y) || Number.isNaN(z)) {
    return null;
  }
  return { x, y, z };
}

function isStatusReportLine(line: string): boolean {
  return line.startsWith("<") && line.endsWith(">");
}

interface ParsedStatusReport {
  status: GrblStatus;
  machinePosition: GrblPosition | null;
  workPosition: GrblPosition | null;
}

function parseStatusReport(line: string): ParsedStatusReport {
  const inner = line.slice(1, -1);
  const fields = inner.split("|");
  const statusWord = fields[0] ?? "";
  const status = toGrblStatus(statusWord);

  let machinePosition: GrblPosition | null = null;
  let workPosition: GrblPosition | null = null;

  for (const field of fields.slice(1)) {
    if (field.startsWith("MPos:")) {
      machinePosition = parsePosition(field.slice("MPos:".length));
    } else if (field.startsWith("WPos:")) {
      workPosition = parsePosition(field.slice("WPos:".length));
    }
  }

  return { status, machinePosition, workPosition };
}

function stripGcodeComment(line: string): string {
  const commentStart = line.indexOf(";");
  const withoutComment = commentStart === -1 ? line : line.slice(0, commentStart);
  return withoutComment.trim();
}

interface PendingCommand {
  resolve: () => void;
  reject: (error: Error) => void;
}

export class GrblController {
  readonly state: GrblState;
  private readonly transport: SerialTransport;
  private pending: PendingCommand | null = null;
  private pendingStatusResolvers: Array<(state: GrblState) => void> = [];

  constructor(transport: SerialTransport) {
    this.transport = transport;
    this.state = { status: "Unknown", machinePosition: null, workPosition: null };
    this.transport.onLine((line) => this.handleLine(line));
  }

  private handleLine(line: string): void {
    if (isStatusReportLine(line)) {
      const parsed = parseStatusReport(line);
      this.state.status = parsed.status;
      this.state.machinePosition = parsed.machinePosition;
      this.state.workPosition = parsed.workPosition;

      const resolvers = this.pendingStatusResolvers;
      this.pendingStatusResolvers = [];
      for (const resolve of resolvers) {
        resolve(this.state);
      }
      return;
    }

    if (line === "ok") {
      const pending = this.pending;
      this.pending = null;
      pending?.resolve();
      return;
    }

    if (line.startsWith("error:")) {
      const code = line.slice("error:".length);
      const pending = this.pending;
      this.pending = null;
      pending?.reject(new Error(`GRBL error: ${code}`));
      return;
    }
  }

  async connect(): Promise<void> {
    // No handshake is needed against this injectable transport. A real
    // navigator.serial-backed adapter would perform a soft-reset here; this
    // method exists so callers have a consistent lifecycle entry point and
    // so that future adapter can add a handshake without changing this
    // class's public API.
  }

  async sendLine(line: string): Promise<void> {
    if (this.pending) {
      throw new Error("A command is already pending");
    }

    const result = new Promise<void>((resolve, reject) => {
      this.pending = { resolve, reject };
    });

    try {
      await this.transport.write(`${line}\n`);
    } catch (error) {
      this.pending = null;
      throw error instanceof Error ? error : new Error(String(error));
    }

    return result;
  }

  async jog(axis: "X" | "Y", distance: number, feedRate: number): Promise<void> {
    return this.sendLine(`$J=G91 ${axis}${distance} F${feedRate}`);
  }

  async requestStatus(): Promise<GrblState> {
    const result = new Promise<GrblState>((resolve) => {
      this.pendingStatusResolvers.push(resolve);
    });

    await this.transport.write("?");

    return result;
  }

  async streamGcode(
    lines: string[],
    onProgress?: (sent: number, total: number) => void,
  ): Promise<void> {
    const toSend = lines.map(stripGcodeComment).filter((line) => line.length > 0);
    const total = toSend.length;
    let sent = 0;

    for (const line of toSend) {
      await this.sendLine(line);
      sent += 1;
      onProgress?.(sent, total);
    }
  }
}
