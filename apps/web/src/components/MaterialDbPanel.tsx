import { useCallback, useState } from "react";
import { useAuth } from "../hooks/useAuth";
import { MATERIAL_DB_URL } from "../lib/materialDbUrl";

interface Preset {
  id: string;
  material: string;
  machineType: string;
  operation: string;
  speed: number;
  power: number;
  passes: number;
  notes: string | null;
}

interface MaterialDbPanelProps {
  onApplyPreset: (speed: number, power: number, passes: number) => void;
}

export function MaterialDbPanel({ onApplyPreset }: MaterialDbPanelProps) {
  const { status: authStatus, user } = useAuth();

  const [material, setMaterial] = useState("");
  const [machineType, setMachineType] = useState("");
  const [operation, setOperation] = useState("");
  const [results, setResults] = useState<Preset[]>([]);
  const [searchStatus, setSearchStatus] = useState<"idle" | "searching">("idle");
  const [error, setError] = useState<string | null>(null);

  const [submitMaterial, setSubmitMaterial] = useState("");
  const [submitMachineType, setSubmitMachineType] = useState("");
  const [submitOperation, setSubmitOperation] = useState("");
  const [submitSpeed, setSubmitSpeed] = useState(300);
  const [submitPower, setSubmitPower] = useState(1000);
  const [submitStatus, setSubmitStatus] = useState<"idle" | "submitting" | "submitted">("idle");

  const handleSearch = useCallback(async () => {
    try {
      setSearchStatus("searching");
      setError(null);
      const params = new URLSearchParams();
      if (material.trim()) params.set("material", material.trim());
      if (machineType.trim()) params.set("machineType", machineType.trim());
      if (operation.trim()) params.set("operation", operation.trim());

      const response = await fetch(`${MATERIAL_DB_URL}/presets?${params.toString()}`);
      if (!response.ok) {
        throw new Error(`Material database responded with ${response.status}`);
      }
      const body = (await response.json()) as { presets: Preset[] };
      setResults(body.presets);
      setSearchStatus("idle");
    } catch (err) {
      setSearchStatus("idle");
      setError(
        err instanceof Error
          ? `${err.message} (is the @maker/material-db dev server running?)`
          : "Failed to search presets",
      );
    }
  }, [material, machineType, operation]);

  const handleSubmit = useCallback(async () => {
    if (!user || !submitMaterial.trim() || !submitMachineType.trim() || !submitOperation.trim()) {
      return;
    }
    try {
      setSubmitStatus("submitting");
      setError(null);
      const response = await fetch(`${MATERIAL_DB_URL}/presets`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          userId: user.id,
          material: submitMaterial.trim(),
          machineType: submitMachineType.trim(),
          operation: submitOperation.trim(),
          speed: submitSpeed,
          power: submitPower,
        }),
      });
      if (!response.ok) {
        throw new Error(`Submission failed with ${response.status}`);
      }
      setSubmitStatus("submitted");
      setSubmitMaterial("");
      setSubmitMachineType("");
      setSubmitOperation("");
    } catch (err) {
      setSubmitStatus("idle");
      setError(
        err instanceof Error
          ? `${err.message} (is the @maker/material-db dev server running?)`
          : "Failed to submit preset",
      );
    }
  }, [user, submitMaterial, submitMachineType, submitOperation, submitSpeed, submitPower]);

  return (
    <section className="ai-panel">
      <h2>Community Material Presets</h2>
      <p className="ai-panel__hint">
        Search speed/power settings other makers have submitted, or contribute your own.
      </p>
      {error && (
        <p role="alert" className="ai-panel__error">
          {error}
        </p>
      )}

      <div className="material-db-panel__search">
        <input
          type="text"
          placeholder="Material"
          value={material}
          onChange={(event) => setMaterial(event.target.value)}
        />
        <input
          type="text"
          placeholder="Machine type"
          value={machineType}
          onChange={(event) => setMachineType(event.target.value)}
        />
        <input
          type="text"
          placeholder="Operation"
          value={operation}
          onChange={(event) => setOperation(event.target.value)}
        />
        <button
          type="button"
          disabled={searchStatus === "searching"}
          onClick={() => void handleSearch()}
        >
          {searchStatus === "searching" ? "Searching…" : "Search"}
        </button>
      </div>

      {results.length > 0 && (
        <ul className="material-db-panel__results">
          {results.map((preset) => (
            <li key={preset.id}>
              <span>
                {preset.material} — {preset.machineType} — {preset.operation} (speed {preset.speed},
                power {preset.power})
              </span>
              <button
                type="button"
                onClick={() => onApplyPreset(preset.speed, preset.power, preset.passes)}
              >
                Apply
              </button>
            </li>
          ))}
        </ul>
      )}

      <h3>Submit a preset</h3>
      {authStatus !== "signed-in" ? (
        <p className="ai-panel__hint">Log in to submit a preset for review.</p>
      ) : (
        <div className="material-db-panel__submit">
          <input
            type="text"
            placeholder="Material"
            value={submitMaterial}
            onChange={(event) => setSubmitMaterial(event.target.value)}
          />
          <input
            type="text"
            placeholder="Machine type"
            value={submitMachineType}
            onChange={(event) => setSubmitMachineType(event.target.value)}
          />
          <input
            type="text"
            placeholder="Operation"
            value={submitOperation}
            onChange={(event) => setSubmitOperation(event.target.value)}
          />
          <label>
            Speed
            <input
              type="number"
              value={submitSpeed}
              onChange={(event) => setSubmitSpeed(Number(event.target.value) || 0)}
            />
          </label>
          <label>
            Power
            <input
              type="number"
              value={submitPower}
              onChange={(event) => setSubmitPower(Number(event.target.value) || 0)}
            />
          </label>
          <button
            type="button"
            disabled={
              submitStatus === "submitting" ||
              !submitMaterial.trim() ||
              !submitMachineType.trim() ||
              !submitOperation.trim()
            }
            onClick={() => void handleSubmit()}
          >
            {submitStatus === "submitting" ? "Submitting…" : "Submit for review"}
          </button>
          {submitStatus === "submitted" && (
            <p className="ai-panel__hint">Submitted — awaiting moderation.</p>
          )}
        </div>
      )}
    </section>
  );
}
