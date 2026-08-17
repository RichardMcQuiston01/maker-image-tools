import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../App";

describe("App", () => {
  it("renders the header and the home view by default", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Maker Image Tools" })).toBeInTheDocument();
    expect(screen.getByText(/Stage 0 foundation shell/)).toBeInTheDocument();
  });

  it("renders the editor view with the built-in filters grouped, disabled until an image loads", async () => {
    window.location.hash = "#/editor";
    render(<App />);

    expect(await screen.findByText(/Drag & drop an image here/)).toBeInTheDocument();

    expect(screen.getByRole("heading", { name: "Tone" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Dither" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Edges & Morphology" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Transform" })).toBeInTheDocument();

    const grayscaleButton = screen.getByRole("button", { name: "Grayscale" });
    expect(grayscaleButton).toBeDisabled();

    expect(screen.getByRole("button", { name: "Reset" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "Export PNG" })).toBeDisabled();
  });
});
