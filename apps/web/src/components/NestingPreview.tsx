import {
  boundingBoxOfPoints,
  commandsToPathData,
  flattenPath,
  type NestResult,
  type Point,
} from "@maker/core-vector";

interface NestingPreviewProps {
  result: NestResult;
  binWidth: number;
  binHeight: number;
}

function rotatePoint(p: Point, center: Point, radians: number): Point {
  const dx = p.x - center.x;
  const dy = p.y - center.y;
  return {
    x: center.x + dx * Math.cos(radians) - dy * Math.sin(radians),
    y: center.y + dx * Math.sin(radians) + dy * Math.cos(radians),
  };
}

export function NestingPreview({ result, binWidth, binHeight }: NestingPreviewProps) {
  if (result.placements.length === 0) {
    return <div className="nesting-preview nesting-preview--empty">No nested layout yet</div>;
  }

  const bins = Array.from({ length: result.binCount }, (_, binIndex) => binIndex);

  return (
    <div className="nesting-preview">
      {bins.map((binIndex) => (
        <svg
          key={binIndex}
          className="nesting-preview__bin"
          viewBox={`0 0 ${binWidth} ${binHeight}`}
          width={binWidth}
          height={binHeight}
          data-testid="nesting-preview-bin"
        >
          <rect
            x={0}
            y={0}
            width={binWidth}
            height={binHeight}
            className="nesting-preview__bin-rect"
          />
          {result.placements
            .filter((placement) => placement.binIndex === binIndex)
            .map((placement, index) => {
              const flattened = flattenPath(placement.path, 1);
              const bbox = boundingBoxOfPoints(flattened);
              const center: Point = { x: bbox.x + bbox.width / 2, y: bbox.y + bbox.height / 2 };
              const radians = (placement.rotation * Math.PI) / 180;

              // Same rotate-about-center-then-translate-to-(x,y) semantics as
              // nestParts itself, so the preview matches what a G-code export
              // would actually cut.
              const corners: Point[] = [
                { x: bbox.x, y: bbox.y },
                { x: bbox.x + bbox.width, y: bbox.y },
                { x: bbox.x, y: bbox.y + bbox.height },
                { x: bbox.x + bbox.width, y: bbox.y + bbox.height },
              ].map((corner) => rotatePoint(corner, center, radians));
              const rotatedMinX = Math.min(...corners.map((p) => p.x));
              const rotatedMinY = Math.min(...corners.map((p) => p.y));
              const translateX = placement.x - rotatedMinX;
              const translateY = placement.y - rotatedMinY;

              return (
                <path
                  key={index}
                  d={commandsToPathData(placement.path.commands)}
                  fill="none"
                  stroke="#2563eb"
                  strokeWidth={1}
                  transform={`translate(${translateX} ${translateY}) rotate(${placement.rotation} ${center.x} ${center.y})`}
                />
              );
            })}
        </svg>
      ))}
    </div>
  );
}
