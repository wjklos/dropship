/**
 * Zoom System
 *
 * Implements multi-level zoom based on altitude, similar to the original
 * Atari Lunar Lander. Higher altitudes show more of the world, lower
 * altitudes zoom in for precision landing.
 */

import type { ZoomLevel } from './types';

// Zoom levels - ordered from highest altitude to lowest
export const ZOOM_LEVELS: ZoomLevel[] = [
  { altitudeThreshold: 600, scale: 1, viewHeight: 1200 },   // Orbital view
  { altitudeThreshold: 300, scale: 2, viewHeight: 600 },    // Approach
  { altitudeThreshold: 100, scale: 3, viewHeight: 400 },    // Descent
  { altitudeThreshold: 0, scale: 4, viewHeight: 300 },      // Final approach
];

// Abort threshold - can't abort below this altitude (matches first zoom transition)
export const ABORT_ALTITUDE_THRESHOLD = 600;

/**
 * Get the appropriate zoom level for the current altitude
 */
export function getZoomLevel(altitude: number): ZoomLevel {
  for (const level of ZOOM_LEVELS) {
    if (altitude >= level.altitudeThreshold) {
      return level;
    }
  }
  // Return most zoomed in level if below all thresholds
  return ZOOM_LEVELS[ZOOM_LEVELS.length - 1];
}

/**
 * Calculate the SVG viewBox parameters for the current zoom level
 * Centers on the lander while clamping to world bounds
 */
export function calculateViewBox(
  landerX: number,
  landerY: number,
  worldWidth: number,
  worldHeight: number,
  zoomLevel: ZoomLevel,
  aspectRatio: number,  // window width / height
): { x: number; y: number; width: number; height: number } {
  const viewHeight = zoomLevel.viewHeight;
  const viewWidth = viewHeight * aspectRatio;

  // Center on lander
  let viewX = landerX - viewWidth / 2;
  let viewY = landerY - viewHeight / 2;

  // Clamp to world bounds
  viewX = Math.max(0, Math.min(worldWidth - viewWidth, viewX));
  viewY = Math.max(0, Math.min(worldHeight - viewHeight, viewY));

  // Ensure we don't have negative dimensions
  const finalWidth = Math.min(viewWidth, worldWidth);
  const finalHeight = Math.min(viewHeight, worldHeight);

  return {
    x: Math.max(0, viewX),
    y: Math.max(0, viewY),
    width: finalWidth,
    height: finalHeight
  };
}

/**
 * Smoothly interpolate between zoom levels for transitions
 * Returns a value between 0 and 1 for transition progress
 */
export function getZoomTransition(
  altitude: number,
  currentLevel: ZoomLevel,
  transitionRange: number = 50  // Altitude range over which to transition
): number {
  const threshold = currentLevel.altitudeThreshold;
  if (altitude >= threshold + transitionRange) {
    return 0; // Fully at current level
  }
  if (altitude <= threshold) {
    return 1; // Fully at next level
  }
  // Linear interpolation
  return 1 - (altitude - threshold) / transitionRange;
}

/**
 * Check if abort is available at current altitude
 */
export function canAbortAtAltitude(altitude: number): boolean {
  return altitude >= ABORT_ALTITUDE_THRESHOLD;
}
