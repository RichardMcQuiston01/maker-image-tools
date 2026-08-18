import { commandsToPathData, type VectorDocument } from "@maker/core-vector";

interface VectorPreviewProps {
  document: VectorDocument;
  width: number;
  height: number;
}

export function VectorPreview({ document, width, height }: VectorPreviewProps) {
  const visibleLayerIds = new Set(
    document.layers.filter((layer) => layer.visible !== false).map((layer) => layer.id),
  );
  const visibleObjects = document.objects.filter((object) => visibleLayerIds.has(object.layerId));

  if (visibleObjects.length === 0) {
    return <div className="vector-preview vector-preview--empty">No vector objects yet</div>;
  }

  return (
    <svg
      className="vector-preview"
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      data-testid="vector-preview"
    >
      {visibleObjects.map((object) => {
        const layer = document.layers.find((candidate) => candidate.id === object.layerId);
        return (
          <path
            key={object.id}
            d={commandsToPathData(object.path.commands)}
            fill="none"
            stroke={layer?.color ?? "#000000"}
            strokeWidth={1}
          />
        );
      })}
    </svg>
  );
}
