import { useCallback, useState, type ChangeEvent, type DragEvent } from "react";
import { loadImageData, SUPPORTED_IMAGE_MIME_TYPES } from "@maker/core-image";

interface DropZoneProps {
  onImageLoaded: (image: ImageData) => void;
}

export function DropZone({ onImageLoaded }: DropZoneProps) {
  const [isDragging, setIsDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleFile = useCallback(
    async (file: File | undefined) => {
      if (!file) return;

      const isSupported = (SUPPORTED_IMAGE_MIME_TYPES as readonly string[]).includes(file.type);
      if (!isSupported) {
        setError(`Unsupported file type: ${file.type || "unknown"}`);
        return;
      }

      setError(null);
      try {
        const image = await loadImageData(file);
        onImageLoaded(image);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load image");
      }
    },
    [onImageLoaded],
  );

  const onDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      event.preventDefault();
      setIsDragging(false);
      void handleFile(event.dataTransfer.files[0]);
    },
    [handleFile],
  );

  const onInputChange = useCallback(
    (event: ChangeEvent<HTMLInputElement>) => {
      void handleFile(event.target.files?.[0]);
    },
    [handleFile],
  );

  return (
    <div
      className={`drop-zone${isDragging ? " drop-zone--active" : ""}`}
      onDragOver={(event) => {
        event.preventDefault();
        setIsDragging(true);
      }}
      onDragLeave={() => setIsDragging(false)}
      onDrop={onDrop}
    >
      <p>Drag &amp; drop an image here, or</p>
      <label className="drop-zone__button">
        Choose file
        <input type="file" accept="image/*" onChange={onInputChange} hidden />
      </label>
      {error && (
        <p role="alert" className="drop-zone__error">
          {error}
        </p>
      )}
    </div>
  );
}
