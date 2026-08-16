import { useCallback, useMemo, useState } from "react";
import { createFilterRegistry, exportImageData, registerBuiltInFilters } from "@maker/core-image";
import { DropZone } from "./components/DropZone";
import { CanvasPreview } from "./components/CanvasPreview";
import { FilterPanel } from "./components/FilterPanel";
import { useHashRoute } from "./hooks/useHashRoute";
import { downloadBlob } from "./lib/download";

export function App() {
  const route = useHashRoute();
  const [originalImage, setOriginalImage] = useState<ImageData | null>(null);
  const [image, setImage] = useState<ImageData | null>(null);
  const [error, setError] = useState<string | null>(null);

  const filterRegistry = useMemo(() => {
    const registry = createFilterRegistry();
    registerBuiltInFilters(registry);
    return registry;
  }, []);

  const handleImageLoaded = useCallback((loaded: ImageData) => {
    setOriginalImage(loaded);
    setImage(loaded);
    setError(null);
  }, []);

  const handleApplyFilter = useCallback(
    (name: string) => {
      if (!image) return;
      try {
        setImage(filterRegistry.apply(name, image, {}));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : `Failed to apply filter "${name}"`);
      }
    },
    [filterRegistry, image],
  );

  const handleReset = useCallback(() => {
    setImage(originalImage);
    setError(null);
  }, [originalImage]);

  const handleExport = useCallback(async () => {
    if (!image) return;
    try {
      const blob = await exportImageData(image, { mimeType: "image/png" });
      downloadBlob(blob, "maker-image-tools-export.png");
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to export image");
    }
  }, [image]);

  return (
    <div className="app">
      <header className="app__header">
        <h1>Maker Image Tools</h1>
        <nav>
          <a href="#/">Home</a>
          <a href="#/editor">Editor</a>
        </nav>
      </header>

      <main className="app__main">
        {route === "/editor" ? (
          <div className="editor">
            <DropZone onImageLoaded={handleImageLoaded} />
            <div className="editor__preview">
              <CanvasPreview image={image} />
              <div className="editor__actions">
                <button type="button" disabled={!image} onClick={handleReset}>
                  Reset
                </button>
                <button type="button" disabled={!image} onClick={() => void handleExport()}>
                  Export PNG
                </button>
              </div>
              {error && (
                <p role="alert" className="editor__error">
                  {error}
                </p>
              )}
            </div>
            <FilterPanel onApply={handleApplyFilter} disabled={!image} />
          </div>
        ) : (
          <p>
            Stage 0 foundation shell. Head to the <a href="#/editor">editor</a> to try the drop zone
            and canvas preview.
          </p>
        )}
      </main>
    </div>
  );
}
