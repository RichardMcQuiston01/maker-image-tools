import { useCallback, useState } from "react";
import { nestParts, type NestResult, type VectorPath } from "@maker/core-vector";

interface NestingPanelProps {
  paths: VectorPath[];
  onNested: (result: NestResult, binWidth: number, binHeight: number) => void;
}

export function NestingPanel({ paths, onNested }: NestingPanelProps) {
  const [binWidth, setBinWidth] = useState(300);
  const [binHeight, setBinHeight] = useState(200);
  const [spacing, setSpacing] = useState(2);
  const [error, setError] = useState<string | null>(null);

  const handleNest = useCallback(() => {
    if (paths.length === 0) return;
    try {
      onNested(nestParts(paths, { binWidth, binHeight, spacing }), binWidth, binHeight);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to nest parts");
    }
  }, [paths, binWidth, binHeight, spacing, onNested]);

  return (
    <section className="nesting-panel">
      <h2>Nesting</h2>
      <label>
        Bin width (mm)
        <input
          type="number"
          value={binWidth}
          onChange={(event) => setBinWidth(Number(event.target.value) || 0)}
        />
      </label>
      <label>
        Bin height (mm)
        <input
          type="number"
          value={binHeight}
          onChange={(event) => setBinHeight(Number(event.target.value) || 0)}
        />
      </label>
      <label>
        Spacing (mm)
        <input
          type="number"
          min={0}
          value={spacing}
          onChange={(event) => setSpacing(Math.max(0, Number(event.target.value) || 0))}
        />
      </label>
      {error && (
        <p role="alert" className="nesting-panel__error">
          {error}
        </p>
      )}
      <button type="button" disabled={paths.length === 0} onClick={handleNest}>
        Nest Parts
      </button>
    </section>
  );
}
