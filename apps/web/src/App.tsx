import { useCallback, useMemo, useState } from "react";
import { createFilterRegistry, exportImageData, registerBuiltInFilters } from "@maker/core-image";
import {
  addLayer,
  addObject,
  createDocument,
  pathsToDxf,
  pathsToSvg,
  textToPaths,
  traceImage,
  updateLayer,
  type LayerSettings,
  type NestResult,
  type VectorDocument,
} from "@maker/core-vector";
import type * as opentype from "opentype.js";
import { DropZone } from "./components/DropZone";
import { CanvasPreview } from "./components/CanvasPreview";
import { FilterPanel } from "./components/FilterPanel";
import { VectorPreview } from "./components/VectorPreview";
import { LayerPanel } from "./components/LayerPanel";
import { TextToPathPanel } from "./components/TextToPathPanel";
import { GcodePanel } from "./components/GcodePanel";
import { GcodeToolpathPreview } from "./components/GcodeToolpathPreview";
import { NestingPanel } from "./components/NestingPanel";
import { NestingPreview } from "./components/NestingPreview";
import { MachinePanel } from "./components/MachinePanel";
import { useHashRoute } from "./hooks/useHashRoute";
import { downloadBlob } from "./lib/download";

interface NestingState {
  result: NestResult;
  binWidth: number;
  binHeight: number;
}

function createInitialDocument(): VectorDocument {
  return addLayer(createDocument(), { name: "Layer 1" });
}

export function App() {
  const route = useHashRoute();
  const [originalImage, setOriginalImage] = useState<ImageData | null>(null);
  const [image, setImage] = useState<ImageData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [vectorDoc, setVectorDoc] = useState<VectorDocument>(createInitialDocument);
  const [gcode, setGcode] = useState<string | null>(null);
  const [nesting, setNesting] = useState<NestingState | null>(null);

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

  const addPathsToFirstLayer = useCallback((paths: ReturnType<typeof traceImage>) => {
    setVectorDoc((doc) => {
      let next = doc.layers.length > 0 ? doc : addLayer(doc, { name: "Layer 1" });
      const layerId = next.layers[0]!.id;
      for (const path of paths) {
        next = addObject(next, path, layerId);
      }
      return next;
    });
  }, []);

  const handleTraceToVector = useCallback(() => {
    if (!image) return;
    try {
      addPathsToFirstLayer(traceImage(image, {}));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to trace image");
    }
  }, [image, addPathsToFirstLayer]);

  const handleAddText = useCallback(
    (font: opentype.Font, text: string, fontSize: number) => {
      try {
        // textToPaths positions glyphs relative to a baseline at (x, y), with
        // ascenders extending to y < 0 (matching Canvas2D's fillText convention) —
        // place the baseline near the bottom of the visible canvas so the text
        // actually falls inside the preview's 0..height viewBox instead of
        // rendering above it.
        const baselineY = (image?.height ?? 400) - Math.round(fontSize * 0.2);
        addPathsToFirstLayer(textToPaths(font, text, { fontSize, x: 10, y: baselineY }));
        setError(null);
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to convert text to paths");
      }
    },
    [addPathsToFirstLayer, image],
  );

  const handleAddLayer = useCallback(() => {
    setVectorDoc((doc) => addLayer(doc, { name: `Layer ${doc.layers.length + 1}` }));
  }, []);

  const handleUpdateLayer = useCallback((layerId: string, changes: Partial<LayerSettings>) => {
    setVectorDoc((doc) => updateLayer(doc, layerId, changes));
  }, []);

  const vectorPaths = useMemo(() => vectorDoc.objects.map((object) => object.path), [vectorDoc]);

  const handleExportSvg = useCallback(() => {
    const svg = pathsToSvg(
      vectorPaths,
      image ? { width: image.width, height: image.height } : undefined,
    );
    downloadBlob(new Blob([svg], { type: "image/svg+xml" }), "maker-image-tools-export.svg");
  }, [vectorPaths, image]);

  const handleExportDxf = useCallback(() => {
    const dxf = pathsToDxf(vectorPaths);
    downloadBlob(new Blob([dxf], { type: "application/dxf" }), "maker-image-tools-export.dxf");
  }, [vectorPaths]);

  const handleGcodeGenerated = useCallback((generated: string) => {
    setGcode(generated);
  }, []);

  const handleDownloadGcode = useCallback(() => {
    if (!gcode) return;
    downloadBlob(new Blob([gcode], { type: "text/plain" }), "maker-image-tools-export.gcode");
  }, [gcode]);

  const handleNested = useCallback((result: NestResult, binWidth: number, binHeight: number) => {
    setNesting({ result, binWidth, binHeight });
  }, []);

  const hasVectorObjects = vectorDoc.objects.length > 0;

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
          <>
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

            <div className="vector-section">
              <div className="vector-section__preview">
                <VectorPreview
                  document={vectorDoc}
                  width={image?.width ?? 400}
                  height={image?.height ?? 400}
                />
                <div className="editor__actions">
                  <button type="button" disabled={!image} onClick={handleTraceToVector}>
                    Trace to Vector
                  </button>
                  <button type="button" disabled={!hasVectorObjects} onClick={handleExportSvg}>
                    Export SVG
                  </button>
                  <button type="button" disabled={!hasVectorObjects} onClick={handleExportDxf}>
                    Export DXF
                  </button>
                </div>
              </div>
              <div className="vector-section__side">
                <LayerPanel
                  document={vectorDoc}
                  onAddLayer={handleAddLayer}
                  onUpdateLayer={handleUpdateLayer}
                />
                <TextToPathPanel onAddText={handleAddText} />
              </div>
            </div>

            <div className="toolpath-section">
              <div className="toolpath-section__preview">
                {nesting && (
                  <NestingPreview
                    result={nesting.result}
                    binWidth={nesting.binWidth}
                    binHeight={nesting.binHeight}
                  />
                )}
                {gcode && (
                  <>
                    <GcodeToolpathPreview gcode={gcode} />
                    <div className="editor__actions">
                      <button type="button" onClick={handleDownloadGcode}>
                        Download .gcode
                      </button>
                    </div>
                  </>
                )}
              </div>
              <div className="toolpath-section__side">
                <NestingPanel paths={vectorPaths} onNested={handleNested} />
                <GcodePanel paths={vectorPaths} onGenerate={handleGcodeGenerated} />
                <MachinePanel gcode={gcode} />
              </div>
            </div>
          </>
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
