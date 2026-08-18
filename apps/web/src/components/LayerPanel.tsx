import type { LayerMode, LayerSettings, VectorDocument } from "@maker/core-vector";

interface LayerPanelProps {
  document: VectorDocument;
  onAddLayer: () => void;
  onUpdateLayer: (layerId: string, changes: Partial<LayerSettings>) => void;
}

const LAYER_MODES: LayerMode[] = ["line", "fill", "offset-fill"];

export function LayerPanel({ document, onAddLayer, onUpdateLayer }: LayerPanelProps) {
  return (
    <section className="layer-panel">
      <h2>Layers</h2>
      {document.layers.length === 0 ? (
        <p className="layer-panel__empty">No layers yet.</p>
      ) : (
        <ul>
          {document.layers.map((layer) => (
            <li key={layer.id} className="layer-panel__row">
              <input
                type="checkbox"
                checked={layer.visible !== false}
                onChange={(event) => onUpdateLayer(layer.id, { visible: event.target.checked })}
                aria-label={`${layer.name} visible`}
              />
              <span className="layer-panel__swatch" style={{ backgroundColor: layer.color }} />
              <input
                className="layer-panel__name"
                type="text"
                value={layer.name}
                onChange={(event) => onUpdateLayer(layer.id, { name: event.target.value })}
              />
              <select
                value={layer.mode ?? "line"}
                onChange={(event) =>
                  onUpdateLayer(layer.id, { mode: event.target.value as LayerMode })
                }
              >
                {LAYER_MODES.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
              <label>
                Speed
                <input
                  type="number"
                  value={layer.speed ?? ""}
                  onChange={(event) =>
                    onUpdateLayer(
                      layer.id,
                      event.target.value === "" ? {} : { speed: Number(event.target.value) },
                    )
                  }
                />
              </label>
              <label>
                Power
                <input
                  type="number"
                  value={layer.power ?? ""}
                  onChange={(event) =>
                    onUpdateLayer(
                      layer.id,
                      event.target.value === "" ? {} : { power: Number(event.target.value) },
                    )
                  }
                />
              </label>
            </li>
          ))}
        </ul>
      )}
      <button type="button" onClick={onAddLayer}>
        Add Layer
      </button>
    </section>
  );
}
