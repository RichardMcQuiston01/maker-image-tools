import { useEffect, useRef } from "react";

interface CanvasPreviewProps {
  image: ImageData | null;
}

export function CanvasPreview({ image }: CanvasPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas || !image) return;

    canvas.width = image.width;
    canvas.height = image.height;
    canvas.getContext("2d")?.putImageData(image, 0, 0);
  }, [image]);

  if (!image) {
    return <div className="canvas-preview canvas-preview--empty">No image loaded</div>;
  }

  return <canvas ref={canvasRef} className="canvas-preview" data-testid="canvas-preview" />;
}
