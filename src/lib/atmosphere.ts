/**
 * Atmosphere Physics Module
 *
 * Mars atmosphere: "fast numbers, small punch"
 *
 * Wind speeds can hit 44 m/s (98 mph) but force is tiny because:
 * - Dynamic pressure q = ½ρV²
 * - Mars ρ ≈ 0.02 kg/m³ (vs Earth's 1.2 kg/m³)
 * - At 25 m/s: q ≈ 6 Pa → ~66N on capsule → 0.04 m/s² (nothing)
 *
 * What winds DO matter for:
 * 1. Horizontal drift - costs fuel to cancel (Δv penalty)
 * 2. Attitude disturbances - shear/turbulence kicks you around
 * 3. Guidance dispersion - land somewhere unexpected
 *
 * What winds DON'T do:
 * - Slow you down meaningfully (need rockets for that)
 * - Shove you around like a hurricane (paper tiger)
 */

import type { WindBand, WindEffect, Vec2 } from "./types";
import type { AtmosphereConfig } from "./worldRegistry";

// Noise seed for turbulence (changes each session)
let turbulenceSeed = Math.random() * 1000;

/**
 * Simple deterministic noise function for turbulence
 */
function noise(x: number, y: number): number {
  const n = Math.sin(x * 12.9898 + y * 78.233 + turbulenceSeed) * 43758.5453;
  return n - Math.floor(n);
}

/**
 * Calculate wind effect at a given altitude
 */
export function getWindEffectAt(
  altitude: number,
  velocity: Vec2,
  atmosphere: AtmosphereConfig | undefined,
  time: number,
): WindEffect {
  // No atmosphere = no wind/drag
  if (!atmosphere || atmosphere.windBands.length === 0) {
    return {
      density: 0,
      windX: 0,
      windY: 0,
      dragX: 0,
      dragY: 0,
      torque: 0,
    };
  }

  // Find the wind band for this altitude
  const band = findWindBand(altitude, atmosphere.windBands);

  if (!band) {
    return {
      density: 0,
      windX: 0,
      windY: 0,
      dragX: 0,
      dragY: 0,
      torque: 0,
    };
  }

  // Interpolate density within band (denser at lower altitudes)
  const bandProgress =
    (altitude - band.altitudeMin) / (band.altitudeMax - band.altitudeMin);
  const densityInterp = band.density * (1 - bandProgress * 0.3); // Slight gradient

  // Calculate turbulence offsets
  const turbX =
    (noise(time * 0.5, altitude * 0.01) - 0.5) * 2 * band.turbulence;
  const turbY =
    (noise(time * 0.7 + 100, altitude * 0.01) - 0.5) * 2 * band.turbulence;

  // Wind velocity with turbulence
  const windX = band.windSpeed * (1 + turbX * 0.5);
  const windY = turbY * 20; // Vertical gusts from turbulence

  // Calculate relative velocity (velocity relative to air mass)
  const relVelX = velocity.x - windX;
  const relVelY = velocity.y - windY;

  // Drag force = -0.5 * density * Cd * v² (simplified)
  // Drag opposes relative motion through the air
  const dragMagnitude = atmosphere.dragCoefficient * densityInterp;
  const speed = Math.sqrt(relVelX * relVelX + relVelY * relVelY);

  // Quadratic drag (proportional to v²)
  const dragX =
    speed > 0 ? -dragMagnitude * relVelX * Math.abs(relVelX) * 0.01 : 0;
  const dragY =
    speed > 0 ? -dragMagnitude * relVelY * Math.abs(relVelY) * 0.01 : 0;

  // Attitude disturbance (torque) - the real Mars EDL challenge
  // Wind can't slow you (paper tiger) but shear/turbulence DOES:
  // - Kick your attitude at the worst time
  // - Force control system to work harder
  // - Make precision landing harder
  // Scales with: density, turbulence, speed, and random noise
  const torqueNoise = (noise(time * 1.3 + 50, altitude * 0.02) - 0.5) * 2;
  // Increased effect - this is where Mars atmosphere actually matters
  const torqueMagnitude = densityInterp * band.turbulence * speed * 0.0003;
  const torque = torqueNoise * torqueMagnitude;

  return {
    density: densityInterp,
    windX,
    windY,
    dragX,
    dragY,
    torque,
  };
}

/**
 * Find the wind band containing a given altitude
 */
function findWindBand(altitude: number, bands: WindBand[]): WindBand | null {
  for (const band of bands) {
    if (altitude >= band.altitudeMin && altitude < band.altitudeMax) {
      return band;
    }
  }
  return null;
}

/**
 * Get all wind bands with current conditions for display
 */
export function getWindBandsForDisplay(
  atmosphere: AtmosphereConfig | undefined,
  time: number,
): Array<WindBand & { currentWindX: number; currentWindY: number }> {
  if (!atmosphere) return [];

  return atmosphere.windBands.map((band) => {
    const midAlt = (band.altitudeMin + band.altitudeMax) / 2;
    const turbX =
      (noise(time * 0.5, midAlt * 0.01) - 0.5) * 2 * band.turbulence;
    const turbY =
      (noise(time * 0.7 + 100, midAlt * 0.01) - 0.5) * 2 * band.turbulence;

    return {
      ...band,
      currentWindX: band.windSpeed * (1 + turbX * 0.5),
      currentWindY: turbY * 20,
    };
  });
}

/**
 * Reset turbulence seed (call on new game/reset)
 */
export function resetTurbulence(): void {
  turbulenceSeed = Math.random() * 1000;
}
