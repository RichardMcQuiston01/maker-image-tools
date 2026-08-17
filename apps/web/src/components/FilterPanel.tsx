import { BUILT_IN_FILTERS, type BuiltInFilterEntry } from "@maker/core-image";

interface FilterPanelProps {
  onApply: (name: string) => void;
  disabled?: boolean;
}

function groupFilters(entries: readonly BuiltInFilterEntry[]): Map<string, BuiltInFilterEntry[]> {
  const groups = new Map<string, BuiltInFilterEntry[]>();
  for (const entry of entries) {
    const group = groups.get(entry.group) ?? [];
    group.push(entry);
    groups.set(entry.group, group);
  }
  return groups;
}

export function FilterPanel({ onApply, disabled }: FilterPanelProps) {
  const groups = groupFilters(BUILT_IN_FILTERS);

  return (
    <aside className="filter-panel">
      <h2>Filters</h2>
      {Array.from(groups.entries()).map(([group, entries]) => (
        <section key={group} className="filter-panel__group">
          <h3>{group}</h3>
          <ul>
            {entries.map(({ name, label }) => (
              <li key={name}>
                <button type="button" disabled={disabled} onClick={() => onApply(name)}>
                  {label}
                </button>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </aside>
  );
}
