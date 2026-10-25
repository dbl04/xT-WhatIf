import { STATSBOMB_PITCH_LENGTH, STATSBOMB_PITCH_WIDTH } from "@/lib/coordinates";

/**
 * Client copy of the backend's 16x12 Expected Threat grid
 * (backend/app/services/tactical_math.py, _generate_canonical_xt_grid). The pitch heatmap and
 * the offline best-receiver pick both read it, so they agree with each other and the engine.
 */
export const XT_GRID_COLS = 16;
export const XT_GRID_ROWS = 12;

/** xT of one grid cell. */
export function xtCell(col: number, row: number): number {
  const xFactor = (col / (XT_GRID_COLS - 1)) ** 2.2;
  const half = (XT_GRID_ROWS - 1) / 2;
  const yFactor = 1 - (Math.abs(row - half) / half) * 0.45;
  return Number((0.01 + 0.65 * xFactor * Math.max(0.18, yFactor)).toFixed(4));
}

/** xT of the cell holding a pitch point (no interpolation). */
export function xtAt(x: number, y: number): number {
  const col = Math.min(XT_GRID_COLS - 1, Math.max(0, Math.floor(x / (STATSBOMB_PITCH_LENGTH / XT_GRID_COLS))));
  const row = Math.min(XT_GRID_ROWS - 1, Math.max(0, Math.floor(y / (STATSBOMB_PITCH_WIDTH / XT_GRID_ROWS))));
  return xtCell(col, row);
}
