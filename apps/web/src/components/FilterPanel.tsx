import type { FilterRegistry } from "@maker/core-image";

interface FilterPanelProps {
  registry: FilterRegistry;
  disabled?: boolean;
}

/**
 * Stage 0 placeholder panel. Stage 1 registers the real filters (dithering,
 * levels, edge detection, ...) into the same FilterRegistry instance passed
 * in here, and this list becomes real controls.
 */
export function FilterPanel({ registry, disabled }: FilterPanelProps) {
  const filters = registry.list();

  return (
    <aside className="filter-panel">
      <h2>Filters</h2>
      {filters.length === 0 ? (
        <p className="filter-panel__empty">No filters registered yet — coming in Stage 1.</p>
      ) : (
        <ul>
          {filters.map((name) => (
            <li key={name}>
              <button type="button" disabled={disabled}>
                {name}
              </button>
            </li>
          ))}
        </ul>
      )}
    </aside>
  );
}
