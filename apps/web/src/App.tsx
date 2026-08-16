import { useMemo, useState } from "react";
import { createFilterRegistry } from "@maker/core-image";
import { DropZone } from "./components/DropZone";
import { CanvasPreview } from "./components/CanvasPreview";
import { FilterPanel } from "./components/FilterPanel";
import { useHashRoute } from "./hooks/useHashRoute";

export function App() {
  const route = useHashRoute();
  const [image, setImage] = useState<ImageData | null>(null);
  const filterRegistry = useMemo(() => createFilterRegistry(), []);

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
            <DropZone onImageLoaded={setImage} />
            <CanvasPreview image={image} />
            <FilterPanel registry={filterRegistry} disabled={!image} />
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
