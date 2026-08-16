import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { App } from "../App";

describe("App", () => {
  it("renders the header and the home view by default", () => {
    render(<App />);

    expect(screen.getByRole("heading", { name: "Maker Image Tools" })).toBeInTheDocument();
    expect(screen.getByText(/Stage 0 foundation shell/)).toBeInTheDocument();
  });

  it("renders the editor view, with an empty filter panel, when navigating to #/editor", async () => {
    window.location.hash = "#/editor";
    render(<App />);

    expect(await screen.findByText(/Drag & drop an image here/)).toBeInTheDocument();
    expect(screen.getByText(/No filters registered yet/)).toBeInTheDocument();
  });
});
