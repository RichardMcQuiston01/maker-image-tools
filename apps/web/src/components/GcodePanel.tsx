import { useCallback, useState } from "react";
import { kerfCompensate, type VectorPath } from "@maker/core-vector";
import { pathsToGcode } from "@maker/gcode";
import { getAllPresets } from "@maker/material-library";

interface GcodePanelProps {
  paths: VectorPath[];
  feedRate: number;
  power: number;
  passes: number;
  onFeedRateChange: (feedRate: number) => void;
  onPowerChange: (power: number) => void;
  onPassesChange: (passes: number) => void;
  onGenerate: (gcode: string) => void;
}

const MATERIAL_PRESETS = getAllPresets();

export function GcodePanel({
  paths,
  feedRate,
  power,
  passes,
  onFeedRateChange,
  onPowerChange,
  onPassesChange,
  onGenerate,
}: GcodePanelProps) {
  const [kerfWidth, setKerfWidth] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const handlePresetChange = useCallback(
    (presetId: string) => {
      const preset = MATERIAL_PRESETS.find((candidate) => candidate.id === presetId);
      if (!preset) return;
      onFeedRateChange(preset.speed);
      onPowerChange(preset.power);
      onPassesChange(preset.passes ?? 1);
    },
    [onFeedRateChange, onPowerChange, onPassesChange],
  );

  const handleGenerate = useCallback(() => {
    if (paths.length === 0) return;
    try {
      const compensated =
        kerfWidth > 0
          ? paths.flatMap((path) => kerfCompensate(path, kerfWidth, { side: "outset" }))
          : paths;
      onGenerate(pathsToGcode(compensated, { feedRate, power, passes }));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to generate G-code");
    }
  }, [paths, feedRate, power, passes, kerfWidth, onGenerate]);

  return (
    <section className="gcode-panel">
      <h2>G-code</h2>
      <label>
        Material preset
        <select defaultValue="" onChange={(event) => handlePresetChange(event.target.value)}>
          <option value="" disabled>
            Choose a preset…
          </option>
          {MATERIAL_PRESETS.map((preset) => (
            <option key={preset.id} value={preset.id}>
              {preset.material} — {preset.machineType} — {preset.operation}
            </option>
          ))}
        </select>
      </label>
      <label>
        Feed rate (mm/min)
        <input
          type="number"
          value={feedRate}
          onChange={(event) => onFeedRateChange(Number(event.target.value) || 0)}
        />
      </label>
      <label>
        Power (0-1000)
        <input
          type="number"
          value={power}
          onChange={(event) => onPowerChange(Number(event.target.value) || 0)}
        />
      </label>
      <label>
        Passes
        <input
          type="number"
          min={1}
          value={passes}
          onChange={(event) => onPassesChange(Math.max(1, Number(event.target.value) || 1))}
        />
      </label>
      <label>
        Kerf width (mm)
        <input
          type="number"
          min={0}
          step={0.01}
          value={kerfWidth}
          onChange={(event) => setKerfWidth(Math.max(0, Number(event.target.value) || 0))}
        />
      </label>
      {error && (
        <p role="alert" className="gcode-panel__error">
          {error}
        </p>
      )}
      <button type="button" disabled={paths.length === 0} onClick={handleGenerate}>
        Generate G-code
      </button>
    </section>
  );
}
