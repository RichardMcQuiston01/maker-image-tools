import type { MaterialPreset } from "./types.js";

/**
 * Curated, hand-written starting-point settings for common laser/CNC materials.
 *
 * These mirror the kind of built-in material library shipped by tools like
 * LightBurn or xTool Creative Space: sane defaults to load into the G-code
 * generator (`speed` is mm/min feed rate, `power` is a 0-1000 S-value) and
 * then fine-tune on scrap. They are explicitly starting points, not
 * guarantees — actual results vary by machine, lens, focus, material batch,
 * and air assist setup.
 */
export const MATERIAL_PRESETS: MaterialPreset[] = [
  // ---------------------------------------------------------------------
  // Diode laser (typical hobbyist class, ~5-40W optical/diode input power)
  // ---------------------------------------------------------------------
  {
    id: "diode-plywood-3mm-cut",
    material: "Baltic Birch Plywood 3mm",
    machineType: "diode-laser",
    operation: "cut",
    speed: 300,
    power: 950,
    passes: 2,
    notes: "Use air assist. Two passes gives a cleaner edge than one slow pass on a 20-40W diode.",
  },
  {
    id: "diode-plywood-6mm-cut",
    material: "Baltic Birch Plywood 6mm",
    machineType: "diode-laser",
    operation: "cut",
    speed: 150,
    power: 1000,
    passes: 4,
    notes:
      "Expect char on the exit kerf at this thickness on a diode. A CO2 laser will do this in far fewer passes.",
  },
  {
    id: "diode-plywood-3mm-engrave",
    material: "Baltic Birch Plywood 3mm",
    machineType: "diode-laser",
    operation: "engrave",
    speed: 3000,
    power: 300,
    passes: 1,
    notes: "Lower power keeps the engrave light-colored; raise power for darker, deeper marks.",
  },
  {
    id: "diode-mdf-3mm-cut",
    material: "MDF 3mm",
    machineType: "diode-laser",
    operation: "cut",
    speed: 250,
    power: 1000,
    passes: 3,
    notes: "MDF chars heavily and produces fine dust; ensure good extraction/air assist.",
  },
  {
    id: "diode-mdf-engrave",
    material: "MDF 3mm",
    machineType: "diode-laser",
    operation: "engrave",
    speed: 3000,
    power: 350,
  },
  {
    id: "diode-acrylic-3mm-cut",
    material: "Black Cast Acrylic 3mm",
    machineType: "diode-laser",
    operation: "cut",
    speed: 150,
    power: 1000,
    passes: 3,
    notes:
      "Diode lasers cannot cut clear/transparent acrylic (the beam passes through it) - use black or other dark cast acrylic only.",
  },
  {
    id: "diode-cardboard-cut",
    material: "Corrugated Cardboard",
    machineType: "diode-laser",
    operation: "cut",
    speed: 600,
    power: 700,
    passes: 1,
    notes: "Watch for flame-up; keep air assist on and don't linger at corners.",
  },
  {
    id: "diode-leather-engrave",
    material: "Vegetable-Tanned Leather 2-3mm",
    machineType: "diode-laser",
    operation: "engrave",
    speed: 3000,
    power: 400,
    notes: "Produces a dark brown scorched mark, not a dyed color change.",
  },
  {
    id: "diode-leather-cut",
    material: "Vegetable-Tanned Leather 2-3mm",
    machineType: "diode-laser",
    operation: "cut",
    speed: 300,
    power: 850,
    passes: 2,
  },
  {
    id: "diode-basswood-cut",
    material: "Basswood/Balsa 3mm",
    machineType: "diode-laser",
    operation: "cut",
    speed: 400,
    power: 900,
    passes: 2,
    notes: "Very soft, low-density wood - test speed first as it cuts much faster than plywood.",
  },
  {
    id: "diode-basswood-engrave",
    material: "Basswood/Balsa 3mm",
    machineType: "diode-laser",
    operation: "engrave",
    speed: 3500,
    power: 300,
  },
  {
    id: "diode-cork-engrave",
    material: "Cork Sheet 3mm",
    machineType: "diode-laser",
    operation: "engrave",
    speed: 3000,
    power: 350,
  },
  {
    id: "diode-anodized-aluminum-mark",
    material: "Anodized Aluminum",
    machineType: "diode-laser",
    operation: "mark",
    speed: 2000,
    power: 200,
    notes:
      "A diode can only remove the thin anodized surface coating to reveal the bare metal underneath - it cannot engrave into the aluminum itself.",
  },

  // ---------------------------------------------------------------------
  // CO2 laser (typical hobbyist/prosumer glass-tube class, ~40-100W)
  // ---------------------------------------------------------------------
  {
    id: "co2-plywood-3mm-cut",
    material: "Baltic Birch Plywood 3mm",
    machineType: "co2-laser",
    operation: "cut",
    speed: 500,
    power: 800,
    passes: 1,
    notes: "Use air assist to reduce charring on the cut edge.",
  },
  {
    id: "co2-plywood-6mm-cut",
    material: "Baltic Birch Plywood 6mm",
    machineType: "co2-laser",
    operation: "cut",
    speed: 250,
    power: 950,
    passes: 2,
  },
  {
    id: "co2-plywood-3mm-engrave",
    material: "Baltic Birch Plywood 3mm",
    machineType: "co2-laser",
    operation: "engrave",
    speed: 6000,
    power: 250,
  },
  {
    id: "co2-acrylic-3mm-cut",
    material: "Cast Acrylic 3mm",
    machineType: "co2-laser",
    operation: "cut",
    speed: 400,
    power: 700,
    passes: 1,
    notes:
      "CO2 handles clear cast acrylic well, unlike a diode laser. Use lower air assist for a flame-polished edge.",
  },
  {
    id: "co2-acrylic-6mm-cut",
    material: "Cast Acrylic 6mm",
    machineType: "co2-laser",
    operation: "cut",
    speed: 150,
    power: 900,
    passes: 2,
  },
  {
    id: "co2-mdf-cut",
    material: "MDF 3mm",
    machineType: "co2-laser",
    operation: "cut",
    speed: 400,
    power: 850,
    passes: 1,
  },
  {
    id: "co2-mdf-engrave",
    material: "MDF 3mm",
    machineType: "co2-laser",
    operation: "engrave",
    speed: 6000,
    power: 300,
  },
  {
    id: "co2-leather-cut",
    material: "Vegetable-Tanned Leather 2-3mm",
    machineType: "co2-laser",
    operation: "cut",
    speed: 500,
    power: 500,
    passes: 1,
  },
  {
    id: "co2-leather-engrave",
    material: "Vegetable-Tanned Leather 2-3mm",
    machineType: "co2-laser",
    operation: "engrave",
    speed: 8000,
    power: 200,
  },
  {
    id: "co2-cardstock-cut",
    material: "Cardstock/Paper",
    machineType: "co2-laser",
    operation: "cut",
    speed: 2000,
    power: 200,
    passes: 1,
  },
  {
    id: "co2-cardstock-score",
    material: "Cardstock/Paper",
    machineType: "co2-laser",
    operation: "score",
    speed: 4000,
    power: 100,
    notes: "Light pass for fold lines - not a through-cut.",
  },
  {
    id: "co2-fabric-cut",
    material: "Fabric/Felt",
    machineType: "co2-laser",
    operation: "cut",
    speed: 1000,
    power: 300,
    passes: 1,
    notes: "Synthetic fabrics can melt/fuse at the edge instead of fraying - test on scrap.",
  },
  {
    id: "co2-glass-engrave",
    material: "Glass",
    machineType: "co2-laser",
    operation: "engrave",
    speed: 3000,
    power: 150,
    notes:
      "Produces a frosted surface mark by micro-fracturing the surface; glass cannot be cut with a CO2 laser.",
  },

  // ---------------------------------------------------------------------
  // Fiber laser (typical hobbyist metal-marking class, ~20-50W)
  // ---------------------------------------------------------------------
  {
    id: "fiber-stainless-mark",
    material: "Stainless Steel",
    machineType: "fiber-laser",
    operation: "mark",
    speed: 1200,
    power: 600,
    notes: "Produces a dark oxide mark. Slower speed / higher power deepens and darkens the mark.",
  },
  {
    id: "fiber-anodized-aluminum-mark",
    material: "Anodized Aluminum",
    machineType: "fiber-laser",
    operation: "mark",
    speed: 1500,
    power: 400,
    notes:
      "A fiber laser ablates the anodized layer cleanly, giving high-contrast marks at modest power.",
  },
  {
    id: "fiber-brass-mark",
    material: "Brass",
    machineType: "fiber-laser",
    operation: "mark",
    speed: 1000,
    power: 700,
  },
  {
    id: "fiber-titanium-mark",
    material: "Titanium",
    machineType: "fiber-laser",
    operation: "mark",
    speed: 1200,
    power: 650,
    notes:
      "Power/speed control the oxide color produced (straw to blue to black) - test a gradient on scrap.",
  },

  // ---------------------------------------------------------------------
  // CNC router (small desktop router/spindle class)
  // ---------------------------------------------------------------------
  {
    id: "cnc-plywood-3mm-cut",
    material: "Baltic Birch Plywood 3mm",
    machineType: "cnc-router",
    operation: "cut",
    speed: 1500,
    power: 18,
    passes: 1,
    notes:
      "`power` here is spindle speed in RPM/1000, not laser power - 18 means 18000 RPM. Use a 1/8in single-flute upcut end mill.",
  },
  {
    id: "cnc-plywood-6mm-cut",
    material: "Baltic Birch Plywood 6mm",
    machineType: "cnc-router",
    operation: "cut",
    speed: 1000,
    power: 18,
    passes: 2,
    notes:
      "`power` here is spindle speed in RPM/1000 (18 = 18000 RPM). Split into two depth passes to reduce tear-out.",
  },
  {
    id: "cnc-mdf-cut",
    material: "MDF 3mm",
    machineType: "cnc-router",
    operation: "cut",
    speed: 1200,
    power: 16,
    passes: 1,
    notes:
      "`power` here is spindle speed in RPM/1000 (16 = 16000 RPM). MDF produces very fine dust - use dust collection.",
  },
  {
    id: "cnc-aluminum-engrave",
    material: "Soft Aluminum (6061)",
    machineType: "cnc-router",
    operation: "engrave",
    speed: 300,
    power: 24,
    passes: 1,
    notes:
      "`power` here is spindle speed in RPM/1000 (24 = 24000 RPM). Light engraving pass only, shallow depth-of-cut, use cutting fluid/lubricant and a rigid setup.",
  },
];
