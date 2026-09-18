import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import * as opentype from "opentype.js";
import { GeneratorsPanel } from "../components/GeneratorsPanel";

// jsdom (as of 25.0.1) doesn't implement Blob#arrayBuffer, which the font
// upload handler relies on - polyfill it via FileReader, scoped to this file.
if (!Blob.prototype.arrayBuffer) {
  Blob.prototype.arrayBuffer = function (this: Blob): Promise<ArrayBuffer> {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result as ArrayBuffer);
      reader.onerror = () => reject(reader.error as DOMException);
      reader.readAsArrayBuffer(this);
    });
  };
}

/**
 * A minimal, valid TrueType font built entirely in-memory (no fixture file
 * on disk) with glyphs for the digits/letters these tests need - mirroring
 * packages/core-vector/test/text.test.ts's synthetic-font approach, but
 * serialized to real binary bytes via toArrayBuffer() since
 * house-number-generator's loadFont() parses raw font bytes rather than
 * accepting an in-memory opentype.js Font object directly.
 */
function makeFontFile(name: string, characters: string): File {
  const notdefPath = new opentype.Path();
  const notdefGlyph = new opentype.Glyph({
    name: ".notdef",
    unicode: 0,
    advanceWidth: 300,
    path: notdefPath,
  });
  const glyphs = [notdefGlyph];
  for (const ch of new Set(characters)) {
    const path = new opentype.Path();
    path.moveTo(0, 0);
    path.lineTo(300, 0);
    path.lineTo(300, 300);
    path.lineTo(0, 300);
    path.close();
    glyphs.push(
      new opentype.Glyph({
        name: `glyph-${ch.charCodeAt(0)}`,
        unicode: ch.charCodeAt(0),
        advanceWidth: 300,
        path,
      }),
    );
  }
  const font = new opentype.Font({
    familyName: "Test",
    styleName: "Regular",
    unitsPerEm: 1000,
    ascender: 800,
    descender: -200,
    glyphs,
  });
  const bytes = new Uint8Array(font.toArrayBuffer());
  return new File([bytes], name, { type: "font/ttf" });
}

describe("GeneratorsPanel > HouseNumberSignGenerator", () => {
  it("shows the name/name-font fields only when style is name + numbers", () => {
    render(<GeneratorsPanel onAddPaths={vi.fn()} />);

    expect(screen.queryByPlaceholderText("The Smiths")).not.toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Numbers only"), {
      target: { value: "nameAndNumbers" },
    });

    expect(screen.getByPlaceholderText("The Smiths")).toBeInTheDocument();
    expect(screen.getByText("Name font file (.ttf/.otf)")).toBeInTheDocument();
  });

  it("shows the screw size selector only for hardware assembly", () => {
    render(<GeneratorsPanel onAddPaths={vi.fn()} />);

    expect(screen.getByText("Screw size")).toBeInTheDocument();

    fireEvent.change(screen.getByDisplayValue("Hardware (screws)"), {
      target: { value: "adhesive" },
    });

    expect(screen.queryByText("Screw size")).not.toBeInTheDocument();
  });

  it("shows a clear error when an invalid font file is uploaded", async () => {
    render(<GeneratorsPanel onAddPaths={vi.fn()} />);

    const badFile = new File([new Uint8Array([1, 2, 3, 4])], "bad.ttf", { type: "font/ttf" });
    const numberFontInput = screen.getByLabelText(/Number font file/);
    fireEvent.change(numberFontInput, { target: { files: [badFile] } });

    expect(await screen.findByRole("alert")).toHaveTextContent(/Failed to parse font file/);
  });

  it("generates a numbers-only sign and adds the resulting paths to the design", async () => {
    const onAddPaths = vi.fn();
    render(<GeneratorsPanel onAddPaths={onAddPaths} />);

    fireEvent.change(screen.getByPlaceholderText("742"), { target: { value: "742" } });

    const fontFile = makeFontFile("digits.ttf", "742");
    const numberFontInput = screen.getByLabelText(/Number font file/);
    fireEvent.change(numberFontInput, { target: { files: [fontFile] } });

    const addButton = await screen.findByRole("button", { name: "Add Sign to Design" });
    await vi.waitFor(() => expect(addButton).toBeEnabled());
    fireEvent.click(addButton);

    expect(onAddPaths).toHaveBeenCalledTimes(1);
    const paths = onAddPaths.mock.calls[0]![0] as unknown[];
    expect(paths.length).toBeGreaterThan(0);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });
});
