import { computeGcodeBounds, parseGcode, type GcodeMove } from "@maker/gcode";

interface GcodeToolpathPreviewProps {
  gcode: string;
}

export function GcodeToolpathPreview({ gcode }: GcodeToolpathPreviewProps) {
  const moves = parseGcode(gcode);

  if (moves.length === 0) {
    return (
      <div className="toolpath-preview toolpath-preview--empty">No toolpath to preview</div>
    );
  }

  const bounds = computeGcodeBounds(moves);
  const padding = Math.max(bounds.width, bounds.height, 1) * 0.05 + 1;
  const minX = bounds.x - padding;
  const width = bounds.width + padding * 2;
  const height = bounds.height + padding * 2;
  // G-code Y grows upward; SVG Y grows downward, so flip the viewBox origin.
  const minY = -(bounds.y + bounds.height) - padding;

  return (
    <svg
      className="toolpath-preview"
      viewBox={`${minX} ${minY} ${width} ${height}`}
      data-testid="toolpath-preview"
    >
      {moves.map((move: GcodeMove, index: number) => (
        <line
          key={index}
          x1={move.from.x}
          y1={-move.from.y}
          x2={move.to.x}
          y2={-move.to.y}
          stroke={move.type === "rapid" ? "#999999" : "#e11d48"}
          strokeDasharray={move.type === "rapid" ? "1.5,1.5" : undefined}
          strokeWidth={move.type === "rapid" ? 0.3 : 0.6}
        />
      ))}
    </svg>
  );
}
