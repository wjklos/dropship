/**
 * Autopilot Gains and Control Parameters
 *
 * PD controller gains and helper functions for descent rate targeting.
 * These values are tuned for the game's physics simulation.
 */

import type { AutopilotGains } from "../worlds";

/**
 * Default PD Controller gains (tuned for Moon baseline)
 *
 * These gains can be overridden per-world to account for different
 * gravity levels and atmospheric conditions.
 *
 * PD Controller explanation:
 * - kp (proportional): How strongly to correct for position/angle error
 * - kd (derivative): How strongly to dampen velocity/rate of change
 */
export const DEFAULT_GAINS: AutopilotGains = {
  attitude: {
    kp: 3.0, // Rotation correction strength
    kd: 2.0, // Angular velocity damping
  },
  horizontal: {
    kp: 0.02, // Horizontal position error correction
    kd: 0.3, // Horizontal velocity damping
  },
  vertical: {
    kp: 0.5, // Vertical descent rate correction
    kd: 0.1, // Vertical acceleration damping
  },
};

/**
 * Target descent rate based on altitude and gravity
 *
 * Returns the desired descent velocity (positive = downward) for a given
 * altitude. Higher altitudes allow faster descent; near the surface we
 * slow down for a soft landing.
 *
 * The gravity factor scales these rates for different worlds - higher
 * gravity worlds need faster descent rates to maintain control authority.
 *
 * @param altitude - Current altitude above terrain (px)
 * @param gravityFactor - Gravity multiplier relative to Moon (default 1.0)
 * @returns Target descent rate in px/s (positive = downward)
 */
export function getTargetDescentRate(
  altitude: number,
  gravityFactor: number = 1,
): number {
  // Scale rates by square root of gravity - higher gravity means we can
  // descend faster while maintaining the same control margin
  const factor = Math.sqrt(gravityFactor);

  // Altitude-based descent rate schedule
  // Higher altitude = faster descent, lower = slower for precision
  if (altitude > 500) return 40 * factor; // High altitude cruise
  if (altitude > 200) return 25 * factor; // Approach phase
  if (altitude > 100) return 15 * factor; // Terminal approach
  if (altitude > 50) return 8 * factor; // Final descent
  if (altitude > 20) return 4 * factor; // Hover approach
  return 2 * factor; // Touchdown
}

/**
 * Calculate hover thrust level
 *
 * Returns the thrust level (0-1) needed to maintain altitude
 * when pointing straight up.
 *
 * @param gravity - World gravity in px/s²
 * @param maxThrust - Maximum thrust in px/s²
 * @returns Thrust level (0-1) for hover
 */
export function getHoverThrust(gravity: number, maxThrust: number): number {
  return gravity / maxThrust;
}

/**
 * Calculate gravity factor relative to Moon baseline
 *
 * @param worldGravity - World gravity in px/s²
 * @param moonGravity - Moon baseline gravity (default 20 px/s²)
 * @returns Gravity multiplier
 */
export function getGravityFactor(
  worldGravity: number,
  moonGravity: number = 20,
): number {
  return worldGravity / moonGravity;
}
