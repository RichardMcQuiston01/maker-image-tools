import { useCallback, useEffect, useRef, useState } from "react";
import { GrblController, type GrblState } from "@maker/machine-control";
import { WebSerialTransport } from "../lib/webSerialTransport";

interface MachinePanelProps {
  gcode: string | null;
}

const JOG_DISTANCE_MM = 10;
const JOG_FEED_RATE = 1000;
const STATUS_POLL_MS = 500;

export function MachinePanel({ gcode }: MachinePanelProps) {
  const controllerRef = useRef<GrblController | null>(null);
  const [connected, setConnected] = useState(false);
  const [status, setStatus] = useState<GrblState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [progress, setProgress] = useState<{ sent: number; total: number } | null>(null);

  const supported = typeof navigator !== "undefined" && !!navigator.serial;

  useEffect(() => {
    if (!connected) return undefined;
    const interval = setInterval(() => {
      controllerRef.current
        ?.requestStatus()
        .then((state) => setStatus({ ...state }))
        .catch(() => undefined);
    }, STATUS_POLL_MS);
    return () => clearInterval(interval);
  }, [connected]);

  const handleConnect = useCallback(async () => {
    if (!navigator.serial) {
      setError("Web Serial is not supported in this browser");
      return;
    }
    try {
      const port = await navigator.serial.requestPort();
      const transport = new WebSerialTransport(port);
      await transport.open();
      const controller = new GrblController(transport);
      await controller.connect();
      controllerRef.current = controller;
      setConnected(true);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to connect to machine");
    }
  }, []);

  const handleJog = useCallback((axis: "X" | "Y", distance: number) => {
    controllerRef.current?.jog(axis, distance, JOG_FEED_RATE).catch((err: unknown) => {
      setError(err instanceof Error ? err.message : "Jog command failed");
    });
  }, []);

  const handleStream = useCallback(async () => {
    const controller = controllerRef.current;
    if (!gcode || !controller) return;
    setStreaming(true);
    setProgress({ sent: 0, total: 0 });
    try {
      await controller.streamGcode(gcode.split("\n"), (sent, total) =>
        setProgress({ sent, total }),
      );
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to stream G-code");
    } finally {
      setStreaming(false);
    }
  }, [gcode]);

  if (!supported) {
    return (
      <section className="machine-panel">
        <h2>Machine</h2>
        <p className="machine-panel__unsupported">
          Web Serial is not supported in this browser. Try Chrome or Edge over HTTPS.
        </p>
      </section>
    );
  }

  return (
    <section className="machine-panel">
      <h2>Machine</h2>
      {!connected ? (
        <button type="button" onClick={() => void handleConnect()}>
          Connect
        </button>
      ) : (
        <>
          <p className="machine-panel__status">
            Status: {status?.status ?? "Unknown"}
            {status?.workPosition
              ? ` — X${status.workPosition.x.toFixed(2)} Y${status.workPosition.y.toFixed(2)}`
              : ""}
          </p>
          <div className="machine-panel__jog">
            <span />
            <button type="button" onClick={() => handleJog("Y", JOG_DISTANCE_MM)}>
              Y+
            </button>
            <span />
            <button type="button" onClick={() => handleJog("X", -JOG_DISTANCE_MM)}>
              X-
            </button>
            <span />
            <button type="button" onClick={() => handleJog("X", JOG_DISTANCE_MM)}>
              X+
            </button>
            <span />
            <button type="button" onClick={() => handleJog("Y", -JOG_DISTANCE_MM)}>
              Y-
            </button>
            <span />
          </div>
          <button type="button" disabled={!gcode || streaming} onClick={() => void handleStream()}>
            {streaming
              ? `Streaming ${progress?.sent ?? 0}/${progress?.total ?? 0}`
              : "Stream G-code"}
          </button>
        </>
      )}
      {error && (
        <p role="alert" className="machine-panel__error">
          {error}
        </p>
      )}
    </section>
  );
}
