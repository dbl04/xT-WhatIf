/**
 * StatsBomb Canonical Coordinate Utilities for xT-WhatIf.
 * 
 * Strict Specification:
 * - Length (X-Axis): 0.0 to 120.0 meters (left goal to right goal).
 * - Width (Y-Axis): 0.0 to 80.0 meters (top touchline to bottom touchline).
 * - Origin (0.0, 0.0): Top-left corner flag.
 * 
 * All coordinate transformation functions must be pure, deterministic, and clamped.
 */

export const STATSBOMB_PITCH_LENGTH = 120.0;
export const STATSBOMB_PITCH_WIDTH = 80.0;
export const STATSBOMB_ASPECT_RATIO = STATSBOMB_PITCH_LENGTH / STATSBOMB_PITCH_WIDTH; // 1.5

export interface StatsbombPoint {
  x: number;
  y: number;
}

export interface ScreenPoint {
  px: number;
  py: number;
}

/**
 * Maps standard StatsBomb (X, Y) coordinates to pixel dimensions on a screen / SVG canvas.
 */
export function statsbombToScreen(
  x: number,
  y: number,
  canvasWidth: number,
  canvasHeight: number
): ScreenPoint {
  const clampedX = Math.max(0.0, Math.min(STATSBOMB_PITCH_LENGTH, x));
  const clampedY = Math.max(0.0, Math.min(STATSBOMB_PITCH_WIDTH, y));

  const px = (clampedX / STATSBOMB_PITCH_LENGTH) * canvasWidth;
  const py = (clampedY / STATSBOMB_PITCH_WIDTH) * canvasHeight;

  return { px, py };
}

/**
 * Maps screen / pointer pixels (relative to canvas bounding rect) back to StatsBomb coordinates.
 * Clamps result strictly within [0.0, 120.0] and [0.0, 80.0] with 1 decimal precision.
 */
export function screenToStatsbomb(
  px: number,
  py: number,
  canvasWidth: number,
  canvasHeight: number,
  margin: number = 0.5
): StatsbombPoint {
  if (canvasWidth <= 0 || canvasHeight <= 0) {
    return { x: 60.0, y: 40.0 };
  }

  const rawX = (px / canvasWidth) * STATSBOMB_PITCH_LENGTH;
  const rawY = (py / canvasHeight) * STATSBOMB_PITCH_WIDTH;

  const clampedX = Math.max(margin, Math.min(STATSBOMB_PITCH_LENGTH - margin, rawX));
  const clampedY = Math.max(margin, Math.min(STATSBOMB_PITCH_WIDTH - margin, rawY));

  return {
    x: Number(clampedX.toFixed(1)),
    y: Number(clampedY.toFixed(1)),
  };
}

/**
 * Normalizes StatsBomb (x, y) to percentage [0..100] for responsive CSS positioning.
 */
export function statsbombToPercent(x: number, y: number): { xPct: number; yPct: number } {
  return {
    xPct: (Math.max(0, Math.min(STATSBOMB_PITCH_LENGTH, x)) / STATSBOMB_PITCH_LENGTH) * 100,
    yPct: (Math.max(0, Math.min(STATSBOMB_PITCH_WIDTH, y)) / STATSBOMB_PITCH_WIDTH) * 100,
  };
}

/**
 * Calculates Euclidean displacement in real meters between two positions on the pitch.
 */
export function calculateDistanceMeters(
  p1: { x: number; y: number },
  p2: { x: number; y: number }
): number {
  return Number(Math.hypot(p2.x - p1.x, p2.y - p1.y).toFixed(2));
}

/**
 * Returns tactical zone classification based on standard 18-pitch division.
 */
export function getTacticalZoneName(x: number, y: number): string {
  // Goal areas
  if (x >= 102.0 && y >= 18.0 && y <= 62.0) {
    return "Penalty Box (Área Rival)";
  }
  // Zone 14 (Central space in front of penalty box: X 80-102, Y 28-52)
  if (x >= 80.0 && x < 102.0 && y >= 28.0 && y <= 52.0) {
    return "Zona 14 (Boca del Área)";
  }
  // Half-spaces
  if (x >= 60.0 && y >= 18.0 && y < 28.0) {
    return "Medio Espacio Izquierdo Rival";
  }
  if (x >= 60.0 && y > 52.0 && y <= 62.0) {
    return "Medio Espacio Derecho Rival";
  }
  // Flanks
  if (y < 18.0) {
    return "Carril Exterior Izquierdo";
  }
  if (y > 62.0) {
    return "Carril Exterior Derecho";
  }
  if (x < 60.0) {
    return "Campo Propio";
  }
  return "Zona Ofensiva Central";
}
