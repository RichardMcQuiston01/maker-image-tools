const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

export class SvgParseError extends Error {}

/** Parse an SVG document string into its root <svg> element. */
export function parseSvg(source: string): SVGSVGElement {
  const doc = new DOMParser().parseFromString(source, "image/svg+xml");

  const parserError = doc.querySelector("parsererror");
  if (parserError) {
    throw new SvgParseError(parserError.textContent ?? "Failed to parse SVG");
  }

  const root = doc.documentElement;
  if (!root || root.namespaceURI !== SVG_NAMESPACE || root.tagName.toLowerCase() !== "svg") {
    throw new SvgParseError("Document root is not an <svg> element");
  }

  return root as unknown as SVGSVGElement;
}

/** Serialize an SVG (sub)tree back to a string. */
export function serializeSvg(root: Element): string {
  return new XMLSerializer().serializeToString(root);
}

/** Create an empty <svg> root element with the given viewport, in document units. */
export function createSvgRoot(width: number, height: number): SVGSVGElement {
  const doc = document.implementation.createDocument(SVG_NAMESPACE, "svg", null);
  const root = doc.documentElement as unknown as SVGSVGElement;
  root.setAttribute("width", String(width));
  root.setAttribute("height", String(height));
  root.setAttribute("viewBox", `0 0 ${width} ${height}`);
  return root;
}
