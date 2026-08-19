export type MachineType = "diode-laser" | "co2-laser" | "fiber-laser" | "cnc-router";
export type MaterialOperation = "cut" | "engrave" | "score" | "mark";

export interface MaterialPreset {
  id: string;
  /** Human-readable material name, e.g. "Baltic Birch Plywood 3mm". */
  material: string;
  machineType: MachineType;
  operation: MaterialOperation;
  /** Feed rate in mm/min. */
  speed: number;
  /** Laser/spindle power as an S-value, 0-1000. */
  power: number;
  /** Number of passes to achieve a clean result. Default 1 if omitted. */
  passes?: number;
  /** Free-text guidance, e.g. "Use air assist. Test on scrap first." */
  notes?: string;
}
