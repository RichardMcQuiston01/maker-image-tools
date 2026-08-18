import { useCallback, useState } from "react";
import * as opentype from "opentype.js";

interface TextToPathPanelProps {
  onAddText: (font: opentype.Font, text: string, fontSize: number) => void;
}

export function TextToPathPanel({ onAddText }: TextToPathPanelProps) {
  const [font, setFont] = useState<opentype.Font | null>(null);
  const [fontError, setFontError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [fontSize, setFontSize] = useState(72);

  const handleFontFile = useCallback(async (file: File | undefined) => {
    if (!file) return;
    try {
      const buffer = await file.arrayBuffer();
      setFont(opentype.parse(buffer));
      setFontError(null);
    } catch (err) {
      setFont(null);
      setFontError(err instanceof Error ? err.message : "Failed to parse font file");
    }
  }, []);

  const handleAddText = useCallback(() => {
    if (!font || !text) return;
    onAddText(font, text, fontSize);
  }, [font, text, fontSize, onAddText]);

  return (
    <section className="text-panel">
      <h2>Text to Path</h2>
      <label className="text-panel__font-input">
        Font file (.ttf/.otf)
        <input
          type="file"
          accept=".ttf,.otf,font/ttf,font/otf"
          onChange={(event) => void handleFontFile(event.target.files?.[0])}
        />
      </label>
      {fontError && (
        <p role="alert" className="text-panel__error">
          {fontError}
        </p>
      )}
      <input
        type="text"
        placeholder="Text to trace"
        value={text}
        onChange={(event) => setText(event.target.value)}
        disabled={!font}
      />
      <label>
        Font size
        <input
          type="number"
          value={fontSize}
          onChange={(event) => setFontSize(Number(event.target.value) || 72)}
          disabled={!font}
        />
      </label>
      <button type="button" onClick={handleAddText} disabled={!font || !text}>
        Add Text
      </button>
    </section>
  );
}
