import { describe, expect, it } from "vitest";
import { GrblController, type SerialTransport } from "../src/grbl.js";

class FakeTransport implements SerialTransport {
  written: string[] = [];
  private lineCallback: ((line: string) => void) | null = null;

  async write(data: string): Promise<void> {
    this.written.push(data);
  }

  onLine(callback: (line: string) => void): () => void {
    this.lineCallback = callback;
    return () => {
      this.lineCallback = null;
    };
  }

  emitLine(line: string): void {
    this.lineCallback?.(line);
  }
}

/** Flushes microtasks until the transport has recorded at least `count` writes. */
async function waitForWriteCount(transport: FakeTransport, count: number): Promise<void> {
  for (let i = 0; i < 50 && transport.written.length < count; i++) {
    await Promise.resolve();
  }
}

describe("GrblController.sendLine", () => {
  it("resolves when an ok line arrives", async () => {
    const transport = new FakeTransport();
    const controller = new GrblController(transport);

    const promise = controller.sendLine("G0 X1");
    expect(transport.written).toEqual(["G0 X1\n"]);

    transport.emitLine("ok");
    await expect(promise).resolves.toBeUndefined();
  });

  it("rejects with a message containing the error code on error:<N>", async () => {
    const transport = new FakeTransport();
    const controller = new GrblController(transport);

    const promise = controller.sendLine("G0 X1");
    transport.emitLine("error:3");

    await expect(promise).rejects.toThrow(/3/);
  });

  it("rejects immediately if a command is already pending", async () => {
    const transport = new FakeTransport();
    const controller = new GrblController(transport);

    const first = controller.sendLine("G0 X1");
    await expect(controller.sendLine("G0 Y1")).rejects.toThrow(/already pending/);

    transport.emitLine("ok");
    await first;
  });

  it("does not resolve/reject a pending sendLine when a status report arrives in between", async () => {
    const transport = new FakeTransport();
    const controller = new GrblController(transport);

    let settled = false;
    const promise = controller.sendLine("G0 X1");
    promise.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    transport.emitLine("<Idle|MPos:0.000,0.000,0.000|FS:0,0>");

    // Flush microtasks a few times to give the promise a chance to settle.
    await Promise.resolve();
    await Promise.resolve();
    await new Promise((resolve) => setTimeout(resolve, 0));

    expect(settled).toBe(false);

    transport.emitLine("ok");
    await promise;
    expect(settled).toBe(true);
  });
});

describe("GrblController status reports", () => {
  it("updates status, machinePosition and workPosition when both are present", () => {
    const transport = new FakeTransport();
    const controller = new GrblController(transport);

    transport.emitLine("<Run|MPos:1.500,2.000,0.000|WPos:1.000,1.500,0.000|FS:500,0>");

    expect(controller.state.status).toBe("Run");
    expect(controller.state.machinePosition).toEqual({ x: 1.5, y: 2, z: 0 });
    expect(controller.state.workPosition).toEqual({ x: 1, y: 1.5, z: 0 });
  });

  it("leaves workPosition null when only MPos is present", () => {
    const transport = new FakeTransport();
    const controller = new GrblController(transport);

    transport.emitLine("<Idle|MPos:0.000,0.000,0.000|FS:0,0>");

    expect(controller.state.status).toBe("Idle");
    expect(controller.state.machinePosition).toEqual({ x: 0, y: 0, z: 0 });
    expect(controller.state.workPosition).toBeNull();
  });

  it("falls back to Unknown for an unrecognized status word", () => {
    const transport = new FakeTransport();
    const controller = new GrblController(transport);

    transport.emitLine("<SomethingWeird|FS:0,0>");

    expect(controller.state.status).toBe("Unknown");
  });
});

describe("GrblController.jog", () => {
  it("sends the exact expected jog line", async () => {
    const transport = new FakeTransport();
    const controller = new GrblController(transport);

    const promise = controller.jog("X", 10, 500);
    expect(transport.written).toEqual(["$J=G91 X10 F500\n"]);

    transport.emitLine("ok");
    await promise;
  });
});

describe("GrblController.requestStatus", () => {
  it("writes a bare ? with no newline and resolves with state from the next status line", async () => {
    const transport = new FakeTransport();
    const controller = new GrblController(transport);

    const promise = controller.requestStatus();
    expect(transport.written).toEqual(["?"]);

    transport.emitLine("<Hold|MPos:3.000,4.000,0.000|FS:0,0>");

    const state = await promise;
    expect(state.status).toBe("Hold");
    expect(state.machinePosition).toEqual({ x: 3, y: 4, z: 0 });
    expect(state).toBe(controller.state);
  });
});

describe("GrblController.streamGcode", () => {
  it("sends only non-blank, non-comment lines and reports correct progress", async () => {
    const transport = new FakeTransport();
    const controller = new GrblController(transport);

    const lines = ["G0 X1", "", "  ", "; a full-line comment", "G1 Y2 ; trailing comment", "G2 Z3"];
    const progressCalls: Array<[number, number]> = [];

    const streamPromise = controller.streamGcode(lines, (sent, total) => {
      progressCalls.push([sent, total]);
    });

    // Respond to each expected command in order, waiting for the write to
    // actually happen before emitting each response.
    for (let i = 1; i <= 3; i++) {
      await waitForWriteCount(transport, i);
      transport.emitLine("ok");
    }

    await streamPromise;

    expect(transport.written).toEqual(["G0 X1\n", "G1 Y2\n", "G2 Z3\n"]);
    expect(progressCalls).toEqual([
      [1, 3],
      [2, 3],
      [3, 3],
    ]);
  });

  it("stops immediately on an error response, never writing later lines", async () => {
    const transport = new FakeTransport();
    const controller = new GrblController(transport);

    const lines = ["G0 X1", "G1 Y2", "G2 Z3"];

    const streamPromise = controller.streamGcode(lines);

    await waitForWriteCount(transport, 1);
    transport.emitLine("ok");
    await waitForWriteCount(transport, 2);
    transport.emitLine("error:9");

    await expect(streamPromise).rejects.toThrow(/9/);
    expect(transport.written).toEqual(["G0 X1\n", "G1 Y2\n"]);
  });
});
