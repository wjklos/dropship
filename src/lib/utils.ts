/**
 * Common utility functions for Lunar Lander
 */

import type { LandingPad } from "./types";

/**
 * Calculate horizontal distance/error with world wraparound.
 * Returns the shortest path distance from `fromX` to `toX` in a wrapping world.
 * Positive = toX is to the right, Negative = toX is to the left.
 *
 * @param fromX - Starting x position
 * @param toX - Target x position
 * @param worldWidth - Total world width for wraparound calculation
 * @returns Signed distance (positive = right, negative = left)
 */
export function calculateHorizontalError(
  fromX: number,
  toX: number,
  worldWidth: number,
): number {
  let error = toX - fromX;
  if (Math.abs(error) > worldWidth / 2) {
    error = error > 0 ? error - worldWidth : error + worldWidth;
  }
  return error;
}

/**
 * Calculate absolute horizontal distance with world wraparound.
 * Returns the shortest path distance between two x positions.
 *
 * @param x1 - First x position
 * @param x2 - Second x position
 * @param worldWidth - Total world width for wraparound calculation
 * @returns Absolute distance (always positive)
 */
export function calculateWrappedDistance(
  x1: number,
  x2: number,
  worldWidth: number,
): number {
  let dx = Math.abs(x1 - x2);
  if (dx > worldWidth / 2) {
    dx = worldWidth - dx;
  }
  return dx;
}

/**
 * Get the center x coordinate of a landing pad.
 *
 * @param pad - The landing pad
 * @returns Center x position
 */
export function getPadCenter(pad: LandingPad): number {
  return (pad.x1 + pad.x2) / 2;
}

/**
 * Get the width of a landing pad.
 *
 * @param pad - The landing pad
 * @returns Pad width in pixels
 */
export function getPadWidth(pad: LandingPad): number {
  return pad.x2 - pad.x1;
}

/**
 * Calculate the speed (magnitude of velocity vector).
 *
 * @param vx - Horizontal velocity
 * @param vy - Vertical velocity
 * @returns Speed (always positive)
 */
export function getSpeed(vx: number, vy: number): number {
  return Math.sqrt(vx * vx + vy * vy);
}

/**
 * Clamp a value between min and max.
 *
 * @param value - Value to clamp
 * @param min - Minimum value
 * @param max - Maximum value
 * @returns Clamped value
 */
export function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/**
 * Linear interpolation between two values.
 *
 * @param a - Start value
 * @param b - End value
 * @param t - Interpolation factor (0 = a, 1 = b)
 * @returns Interpolated value
 */
export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}
