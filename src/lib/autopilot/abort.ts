/**
 * Abort System - Physics-Based Abort Decision and Execution
 *
 * When abort is triggered, the autopilot assesses the situation and chooses
 * the best available option:
 *
 * 1. ABORT TO ORBIT: If sufficient fuel remains, execute multi-step maneuver
 *    to return to stable orbit. This is expensive due to gravity losses.
 *
 * 2. ABORT RETARGET: If orbit is not achievable but there's a reachable pad,
 *    redirect to the best emergency landing site.
 *
 * 3. ABORT BRACE: If neither option is viable, minimize impact velocity
 *    to reduce damage.
 *
 * Based on orbital mechanics principles:
 * - Abort costs MORE than descent due to gravity losses
 * - Early aborts (high altitude, more fuel) have more options
 * - Late aborts (low altitude, less fuel) may only allow brace
 */

import type { LanderState, GameConfig, LandingPad, TerrainPoint, AutopilotCommand } from "../types";
import type { GNCState, AbortDecision, AbortToOrbitSubPhase } from "./types";
import { getAltitude } from "../physics";
import { calculateHorizontalError, getPadCenter } from "../utils";

/**
 * Abort feasibility result
 */
export interface AbortFeasibility {
  canReachOrbit: boolean;
  orbitDvRequired: number;
  orbitFuelRequired: number;
  canRetarget: boolean;
  bestEmergencyPad: number | null;
  emergencyPadDistance: number | null;
  recommendation: AbortDecision;
}

/**
 * Calculate if orbit can be reached from current state
 *
 * Orbit return is only sensible when:
 * 1. At HIGH altitude (>70% orbital altitude) - otherwise just land
 * 2. Have enough fuel for the maneuver
 *
 * Below 70% orbital altitude, landing is almost always easier and safer.
 *
 * @param lander - Current lander state
 * @param config - Game configuration with orbital parameters
 * @param terrain - Terrain for altitude calculation
 * @returns Whether orbit is achievable and fuel estimate
 */
export function canReachOrbit(
  lander: LanderState,
  config: GameConfig,
  terrain: TerrainPoint[],
): { possible: boolean; dvRequired: number; fuelRequired: number } {
  const altitude = getAltitude(lander.position, terrain, config.width);
  const vx = lander.velocity.x;
  const vy = lander.velocity.y;

  // STRICT: Must be at least 70% of orbital altitude to even consider orbit return
  // Below this, landing is almost always the better choice
  const minAltitudeForOrbit = config.orbitalAltitude * 0.7; // 560px for Moon

  console.log("[Abort] Config check:", {
    configOrbitalAltitude: config.orbitalAltitude,
    calculatedThreshold: minAltitudeForOrbit,
    currentAltitude: altitude,
  });

  if (altitude < minAltitudeForOrbit) {
    console.log("[Abort] Too low for orbit - MUST LAND:", {
      altitude: altitude.toFixed(0),
      threshold: minAltitudeForOrbit.toFixed(0),
      decision: "LAND",
    });
    return { possible: false, dvRequired: Infinity, fuelRequired: Infinity };
  }

  // Calculate Δv for orbit return
  const dvToStopDescent = Math.max(0, vy * 1.5);
  const altitudeDeficit = Math.max(0, config.orbitalAltitude - altitude);
  const dvToClimb = Math.sqrt(2 * config.gravity * altitudeDeficit) * 2.0; // Conservative
  const existingProgradeVel = Math.abs(vx);
  const dvToOrbitalVelocity = Math.max(0, config.orbitalVelocity - existingProgradeVel);
  const gravityLosses = (dvToStopDescent + dvToClimb) * 0.5;

  const totalDv = dvToStopDescent + dvToClimb + dvToOrbitalVelocity + gravityLosses;
  const burnTime = totalDv / config.maxThrust;
  const fuelNeeded = burnTime * config.fuelConsumption * 2.0; // 100% margin - be conservative

  const possible = lander.fuel >= fuelNeeded;

  console.log("[Abort] Orbit feasibility:", {
    altitude: altitude.toFixed(0),
    threshold: minAltitudeForOrbit.toFixed(0),
    fuelNeeded: fuelNeeded.toFixed(1),
    fuelAvailable: lander.fuel.toFixed(1),
    possible,
    decision: possible ? "ORBIT POSSIBLE" : "NOT ENOUGH FUEL - LAND",
  });

  return { possible, dvRequired: totalDv, fuelRequired: fuelNeeded };
}

/**
 * Find the best emergency landing pad
 *
 * CRITICAL: Work WITH orbital momentum, not against it!
 * - Only consider pads AHEAD in direction of travel
 * - Prefer closest pad (easiest to reach)
 * - Exclude occupied pads
 *
 * @param lander - Current lander state
 * @param pads - Available landing pads
 * @param config - Game configuration
 * @param terrain - Terrain for calculations
 * @returns Best emergency pad index or null if none reachable
 */
export function findBestEmergencyPad(
  lander: LanderState,
  pads: LandingPad[],
  config: GameConfig,
  terrain: TerrainPoint[],
): { padIndex: number | null; distance: number | null } {
  const altitude = getAltitude(lander.position, terrain, config.width);
  const vx = lander.velocity.x;
  const vy = lander.velocity.y;
  const g = config.gravity;

  // Estimate time to ground (free-fall approximation)
  const discriminant = vy * vy + 2 * g * altitude;
  const timeToGround = discriminant > 0
    ? (-vy + Math.sqrt(discriminant)) / g
    : Math.sqrt(2 * altitude / g);

  // Estimate natural horizontal range during descent
  const naturalRange = vx * timeToGround;

  // CRITICAL: In this game, orbital direction is always RIGHTWARD (positive x)
  // For emergency landing, prefer pads AHEAD in orbital direction (to the right)
  // This works WITH momentum instead of fighting it
  const reachablePads = pads
    .map((pad, index) => {
      if (pad.occupied) return null;

      const padCenter = getPadCenter(pad);
      // Signed distance: positive = pad is to the right (orbital direction)
      let signedDistance = padCenter - lander.position.x;

      // Handle world wrap
      if (signedDistance > config.width / 2) signedDistance -= config.width;
      if (signedDistance < -config.width / 2) signedDistance += config.width;

      // Prefer pads to the RIGHT (orbital direction) or directly below
      // Allow small backward corrections but strongly prefer forward
      const isPadAhead = signedDistance >= -30; // Allow tiny bit behind for nearly-overhead pads

      if (!isPadAhead) return null;

      // Check if pad is reachable
      const absDistance = Math.abs(signedDistance);

      // Forward reach based on current momentum toward right + maneuvering
      const forwardReach = Math.max(naturalRange, 0) * 1.3 + (lander.fuel / config.fuelConsumption) * 15;

      // Can we reach it?
      if (signedDistance >= 0 && signedDistance <= forwardReach) {
        // Pad is ahead - reachable
        return { index, pad, distance: absDistance, signedDistance };
      } else if (signedDistance < 0 && absDistance <= 50) {
        // Pad is slightly behind but very close - reachable with small correction
        return { index, pad, distance: absDistance, signedDistance };
      }

      return null;
    })
    .filter((p): p is { index: number; pad: LandingPad; distance: number; signedDistance: number } => p !== null);

  if (reachablePads.length === 0) {
    return { padIndex: null, distance: null };
  }

  // Sort by CLOSEST first - emergency means safety over score
  reachablePads.sort((a, b) => a.distance - b.distance);

  return {
    padIndex: reachablePads[0].index,
    distance: reachablePads[0].distance,
  };
}

/**
 * Assess abort situation and recommend best action
 *
 * Decision priority:
 * 1. If orbit is achievable → abort_to_orbit (safest, preserves options)
 * 2. If emergency pad reachable → abort_retarget (controlled landing)
 * 3. Otherwise → abort_brace (minimize damage)
 *
 * @param lander - Current lander state
 * @param pads - Available landing pads
 * @param config - Game configuration
 * @param terrain - Terrain for calculations
 * @returns Abort feasibility assessment with recommendation
 */
export function assessAbortOptions(
  lander: LanderState,
  pads: LandingPad[],
  config: GameConfig,
  terrain: TerrainPoint[],
): AbortFeasibility {
  const altitude = getAltitude(lander.position, terrain, config.width);

  // Check orbit feasibility (strict - only if high enough AND have fuel)
  const orbitCheck = canReachOrbit(lander, config, terrain);

  // Check emergency landing feasibility
  const emergencyPad = findBestEmergencyPad(lander, pads, config, terrain);

  // Determine recommendation - PREFER LANDING when low
  let recommendation: AbortDecision;
  if (orbitCheck.possible) {
    recommendation = "orbit";
  } else if (emergencyPad.padIndex !== null) {
    recommendation = "retarget";
  } else {
    recommendation = "brace";
  }

  console.log("[Abort] === ABORT DECISION ===", {
    altitude: altitude.toFixed(0),
    orbitPossible: orbitCheck.possible,
    emergencyPadAvailable: emergencyPad.padIndex !== null,
    emergencyPadIndex: emergencyPad.padIndex,
    DECISION: recommendation.toUpperCase(),
  });

  return {
    canReachOrbit: orbitCheck.possible,
    orbitDvRequired: orbitCheck.dvRequired,
    orbitFuelRequired: orbitCheck.fuelRequired,
    canRetarget: emergencyPad.padIndex !== null,
    bestEmergencyPad: emergencyPad.padIndex,
    emergencyPadDistance: emergencyPad.distance,
    recommendation,
  };
}

/**
 * Initialize abort state in GNC
 *
 * Called when abort is triggered to set up the abort state machine.
 *
 * @param state - Current GNC state to modify
 * @param lander - Current lander state
 * @param altitude - Current altitude
 * @param assessment - Result from assessAbortOptions
 */
export function initializeAbort(
  state: GNCState,
  lander: LanderState,
  altitude: number,
  assessment: AbortFeasibility,
): void {
  // Store abort telemetry
  state.abortStartAltitude = altitude;
  state.abortStartFuel = lander.fuel;
  state.abortStartVelocity = { vx: lander.velocity.x, vy: lander.velocity.y };
  state.originalPadIndex = state.targetPadIndex;

  // Set decision and phase
  state.abortDecision = assessment.recommendation;

  switch (assessment.recommendation) {
    case "orbit":
      state.phase = "abort_to_orbit";
      state.abortToOrbitSubPhase = "arrest_descent";
      break;
    case "retarget":
      state.phase = "abort_retarget";
      state.emergencyPadIndex = assessment.bestEmergencyPad;
      // Update target to emergency pad
      if (assessment.bestEmergencyPad !== null) {
        state.targetPadIndex = assessment.bestEmergencyPad;
        state.targetPadLocked = true;
        state.lockedPadViable = true;
      }
      break;
    case "brace":
      state.phase = "abort_brace";
      break;
  }
}

/**
 * Execute abort_to_orbit maneuver
 *
 * This maneuver actively climbs to proper orbital altitude (y=150).
 * Phases:
 * 1. arrest_descent: Full thrust UP to stop falling
 * 2. climb_to_orbit: Thrust UP to reach orbital altitude
 * 3. prograde_burn: Build horizontal velocity at orbital altitude
 * 4. reorient: Spin to retrograde stance
 *
 * @param lander - Current lander state
 * @param state - GNC state
 * @param config - Game configuration
 * @param terrain - Terrain for altitude
 * @returns Autopilot command
 */
export function executeAbortToOrbit(
  lander: LanderState,
  state: GNCState,
  config: GameConfig,
  terrain: TerrainPoint[],
): AutopilotCommand {
  const altitude = getAltitude(lander.position, terrain, config.width);
  const vy = lander.velocity.y;
  const vx = lander.velocity.x;

  // Target orbital altitude and Y position
  const targetOrbitalY = 150; // Standard orbital Y position
  const atOrbitalAltitude = lander.position.y <= targetOrbitalY + 20; // Within 20px of orbital altitude

  // Coordinate system: 0° = UP, +90° = RIGHT (prograde), -90° = LEFT (retrograde)
  const progradeAngle = Math.PI / 2;

  switch (state.abortToOrbitSubPhase) {
    case "arrest_descent": {
      // Point UP and thrust hard to stop falling
      if (vy <= 0) {
        // Stopped falling - move to climb phase
        console.log("[Abort] Transition: arrest_descent -> prograde_burn", {
          vy: vy.toFixed(1),
          altitude: altitude.toFixed(0),
          targetY: targetOrbitalY,
          currentY: lander.position.y.toFixed(0),
        });
        state.abortToOrbitSubPhase = "prograde_burn";
      }

      return {
        thrust: 1.0,
        rotation: normalizeRotationCommand(0, lander.rotation), // Point straight UP
      };
    }

    case "prograde_burn": {
      // Combined climb and prograde burn
      // Tilt based on: how high we are vs how fast we're moving horizontally
      const needsAltitude = !atOrbitalAltitude;
      const needsVelocity = Math.abs(vx) < config.orbitalVelocity * 0.9;

      let targetAngle: number;

      if (needsAltitude && vy > -10) {
        // Need to climb and not climbing fast - point mostly up
        targetAngle = progradeAngle * 0.3;
      } else if (needsAltitude) {
        // Climbing well - balance between up and prograde
        targetAngle = progradeAngle * 0.5;
      } else if (needsVelocity) {
        // At altitude, need velocity - point prograde
        targetAngle = progradeAngle * 0.9;
      } else {
        // Have both - transition to reorient
        console.log("[Abort] Transition: prograde_burn -> reorient (orbit achieved)", {
          vy: vy.toFixed(1),
          vx: vx.toFixed(1),
          altitude: altitude.toFixed(0),
          y: lander.position.y.toFixed(0),
        });
        state.abortToOrbitSubPhase = "reorient";
        state.orbitStabilized = true;
        return { thrust: 0, rotation: 0 };
      }

      // Full thrust while building orbit
      return {
        thrust: 1.0,
        rotation: normalizeRotationCommand(targetAngle, lander.rotation),
      };
    }

    case "coast_to_apoapsis":
    case "circularize": {
      // DEPRECATED phases - skip to prograde_burn
      state.abortToOrbitSubPhase = "prograde_burn";
      return { thrust: 1.0, rotation: 0 };
    }

    case "reorient": {
      // Rotate to retrograde stance (-90°) for normal orbital operations
      const retrogradeAngle = -Math.PI / 2;

      return {
        thrust: 0,
        rotation: normalizeRotationCommand(retrogradeAngle, lander.rotation),
      };
    }

    default:
      return { thrust: 0, rotation: 0 };
  }
}

/**
 * Execute abort_retarget - redirect to emergency pad
 *
 * CRITICAL: The emergency pad should already be AHEAD in direction of travel
 * (selected by findBestEmergencyPad). Just guide to it naturally.
 *
 * @param lander - Current lander state
 * @param state - GNC state
 * @param pads - Landing pads
 * @param config - Game configuration
 * @param terrain - Terrain
 * @returns Autopilot command
 */
export function executeAbortRetarget(
  lander: LanderState,
  state: GNCState,
  pads: LandingPad[],
  config: GameConfig,
  terrain: TerrainPoint[],
): AutopilotCommand {
  const altitude = getAltitude(lander.position, terrain, config.width);
  const vx = lander.velocity.x;
  const vy = lander.velocity.y;
  const pad = pads[state.emergencyPadIndex ?? 0];
  const padCenter = getPadCenter(pad);

  // Calculate signed horizontal error (positive = pad to the right)
  let horizontalError = padCenter - lander.position.x;
  if (horizontalError > config.width / 2) horizontalError -= config.width;
  if (horizontalError < -config.width / 2) horizontalError += config.width;

  // Are we roughly on course? (pad is in direction of travel)
  const movingTowardPad =
    (vx > 0 && horizontalError > 0) || (vx < 0 && horizontalError < 0);

  // Determine if we should be in terminal burn
  const needsTerminalBurn = altitude < 120 || (altitude < 200 && vy > 25);

  if (needsTerminalBurn) {
    // Terminal landing - control descent with gentle lateral corrections
    const descentRate = vy;
    const targetDescentRate = Math.min(12, altitude * 0.08);

    // Small lateral corrections only - don't fight momentum hard
    let targetAngle = 0;
    if (Math.abs(horizontalError) > 30) {
      // Gentle tilt toward pad
      targetAngle = horizontalError > 0 ? -Math.PI / 12 : Math.PI / 12;
    } else if (Math.abs(horizontalError) > 10) {
      targetAngle = horizontalError > 0 ? -Math.PI / 18 : Math.PI / 18;
    }

    // Thrust to control descent rate
    const thrustNeeded = descentRate > targetDescentRate ? 0.9 : 0.4;

    return {
      thrust: thrustNeeded,
      rotation: normalizeRotationCommand(targetAngle, lander.rotation),
    };
  } else {
    // Coasting/maneuvering phase
    // If we're moving toward the pad, mostly just control descent
    // If we need course correction, apply gentle steering

    let targetAngle = 0;
    let thrustLevel = 0.3;

    if (movingTowardPad) {
      // On course - minimal steering, manage descent
      if (vy > 15) {
        // Need to slow descent
        targetAngle = 0;
        thrustLevel = 0.6;
      } else {
        // Coast toward pad
        thrustLevel = 0.2;
      }
    } else {
      // Need to correct course - gentle steering toward pad
      targetAngle = horizontalError > 0 ? -Math.PI / 8 : Math.PI / 8;
      thrustLevel = 0.5;
    }

    return {
      thrust: thrustLevel,
      rotation: normalizeRotationCommand(targetAngle, lander.rotation),
    };
  }
}

/**
 * Execute abort_brace - minimize impact damage
 *
 * When nothing else is possible, try to:
 * 1. Point engines down (upright attitude)
 * 2. Use remaining fuel to slow descent as much as possible
 * 3. Aim for softest possible touchdown
 *
 * @param lander - Current lander state
 * @param config - Game configuration
 * @returns Autopilot command
 */
export function executeAbortBrace(
  lander: LanderState,
  config: GameConfig,
): AutopilotCommand {
  // Point straight up for maximum braking efficiency
  const targetAngle = 0;

  // Full thrust if we have fuel and are descending
  const hasFuel = lander.fuel > 0;
  const isDescending = lander.velocity.y > 5;
  const thrustLevel = hasFuel && isDescending ? 1.0 : 0;

  return {
    thrust: thrustLevel,
    rotation: normalizeRotationCommand(targetAngle, lander.rotation),
  };
}

/**
 * Check if abort_to_orbit maneuver is complete
 *
 * Orbit is achieved when:
 * 1. In reorient phase (orbit is stable)
 * 2. Lander is aligned to retrograde stance (-π/2)
 * 3. Angular velocity is near zero (stable orientation)
 *
 * @param lander - Current lander state
 * @param state - GNC state
 * @param config - Game configuration
 * @param terrain - Terrain
 * @returns true if orbit has been achieved and lander is properly oriented
 */
export function isOrbitAchieved(
  lander: LanderState,
  state: GNCState,
  config: GameConfig,
  terrain: TerrainPoint[],
): boolean {
  // Must be in reorient phase
  if (state.abortToOrbitSubPhase !== "reorient") {
    return false;
  }

  // Check alignment to retrograde (-π/2)
  const retrogradeAngle = -Math.PI / 2;
  let rotationError = lander.rotation - retrogradeAngle;

  // Normalize to [-PI, PI]
  while (rotationError > Math.PI) rotationError -= 2 * Math.PI;
  while (rotationError < -Math.PI) rotationError += 2 * Math.PI;

  const isAligned = Math.abs(rotationError) < 0.1; // ~6 degrees tolerance
  const isStable = Math.abs(lander.angularVelocity) < 0.5;

  return isAligned && isStable;
}

/**
 * Reset abort state (after successful abort or for new attempt)
 */
export function resetAbortState(state: GNCState): void {
  state.abortDecision = null;
  state.abortToOrbitSubPhase = null;
  state.emergencyPadIndex = null;
  state.abortStartAltitude = null;
  state.abortStartFuel = null;
  state.abortStartVelocity = null;
  state.originalPadIndex = null;
  state.orbitStabilized = false;
}

/**
 * Helper: Normalize rotation command
 * Returns a rotation rate (-1 to 1) to reach target angle
 */
function normalizeRotationCommand(targetAngle: number, currentAngle: number): number {
  let error = targetAngle - currentAngle;

  // Normalize to [-PI, PI]
  while (error > Math.PI) error -= 2 * Math.PI;
  while (error < -Math.PI) error += 2 * Math.PI;

  // PD-style control with high gain for quick response
  const kp = 3.0;
  return Math.max(-1, Math.min(1, error * kp));
}

/**
 * Check if currently in an abort phase
 */
export function isAbortPhase(phase: string): boolean {
  return phase.startsWith("abort_");
}
