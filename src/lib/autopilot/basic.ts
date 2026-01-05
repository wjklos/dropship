/**
 * Basic Autopilot Functions
 *
 * Contains the legacy staccato autopilot, stabilization, orbital wait,
 * and abort maneuver functions. These are simpler reactive controllers
 * compared to the GNC system.
 */

import type {
  LanderState,
  GameConfig,
  AutopilotCommand,
  LandingPad,
  TerrainPoint,
  GamePhase,
} from "../types";
import type { AutopilotGains } from "../worlds";
import { getAltitude } from "../physics";
import { calculateHorizontalError, getPadCenter } from "../utils";
import { DEFAULT_GAINS, getTargetDescentRate, getGravityFactor } from "./gains";

/**
 * Legacy Staccato Autopilot
 *
 * A reactive autopilot that uses the "staccato" approach:
 * - Rotate WITHOUT thrust to aim at the target
 * - Thrust only when nearly upright
 * - This prevents wasteful sideways thrust and oscillation
 *
 * This autopilot is simpler than the GNC system but less fuel-efficient.
 * It's kept for comparison and as a fallback.
 *
 * @param lander - Current lander state
 * @param terrain - Terrain points for altitude calculation
 * @param landingPad - Target landing pad
 * @param config - Game configuration
 * @param mode - Autopilot mode (stabilize, land, demo)
 * @param phase - Current game phase
 * @param gains - PD controller gains (optional, uses defaults)
 * @returns Thrust and rotation commands
 */
export function computeAutopilot(
  lander: LanderState,
  terrain: TerrainPoint[],
  landingPad: LandingPad,
  config: GameConfig,
  mode: "stabilize" | "land" | "demo",
  phase: GamePhase = "descent",
  gains: AutopilotGains = DEFAULT_GAINS,
): AutopilotCommand {
  // In orbit phase, check if we should initiate descent
  if (phase === "orbit" && !lander.hasBurned) {
    return computeOrbitalAutopilot(lander, landingPad, config);
  }

  const altitude = getAltitude(lander.position, terrain, config.width);
  const gravityFactor = getGravityFactor(config.gravity);

  // Target position (center of landing pad for 'land' mode)
  const targetX =
    mode === "stabilize" ? lander.position.x : getPadCenter(landingPad);

  // Calculate horizontal error (with wraparound)
  const horizontalError = calculateHorizontalError(
    lander.position.x,
    targetX,
    config.width,
  );
  const horizontalDistance = Math.abs(horizontalError);
  const horizontalVelocity = lander.velocity.x;
  const verticalVelocity = lander.velocity.y;
  const rotation = lander.rotation;
  const isNearlyUpright = Math.abs(rotation) < 0.12; // ~7 degrees

  // Gravity compensation (base thrust to hover when upright)
  const hoverThrust = config.gravity / config.maxThrust;

  // ============================================
  // DECIDE TARGET ROTATION
  // ============================================
  let targetRotation = 0;

  if (mode === "stabilize") {
    targetRotation = 0;
  } else {
    // Calculate what tilt we need to correct our trajectory
    // Scale corrections by gravity factor

    if (altitude > 200) {
      // VERY HIGH ALTITUDE: Aggressive horizontal correction
      if (horizontalDistance > 50) {
        const desiredVel =
          Math.sign(horizontalError) *
          Math.min(40 * gravityFactor, horizontalDistance * 0.2);
        const velError = desiredVel - horizontalVelocity;
        targetRotation = Math.max(
          -0.52,
          Math.min(0.52, velError * 0.03 * gravityFactor),
        );
      } else if (horizontalDistance > 20) {
        const desiredVel =
          Math.sign(horizontalError) *
          Math.min(20 * gravityFactor, horizontalDistance * 0.15);
        const velError = desiredVel - horizontalVelocity;
        targetRotation = Math.max(
          -0.4,
          Math.min(0.4, velError * 0.025 * gravityFactor),
        );
      } else {
        targetRotation = Math.max(
          -0.25,
          Math.min(0.25, -horizontalVelocity * 0.04),
        );
      }
    } else if (altitude > 100) {
      // HIGH ALTITUDE: Correct horizontal position
      if (horizontalDistance > 30) {
        const desiredVel =
          Math.sign(horizontalError) *
          Math.min(25 * gravityFactor, horizontalDistance * 0.15);
        const velError = desiredVel - horizontalVelocity;
        targetRotation = Math.max(
          -0.35,
          Math.min(0.35, velError * 0.025 * gravityFactor),
        );
      } else {
        targetRotation = Math.max(
          -0.2,
          Math.min(0.2, -horizontalVelocity * 0.035),
        );
      }
    } else if (altitude > 40) {
      // MID ALTITUDE: Moderate corrections
      if (horizontalDistance > 15) {
        const desiredVel =
          Math.sign(horizontalError) *
          Math.min(12 * gravityFactor, horizontalDistance * 0.12);
        const velError = desiredVel - horizontalVelocity;
        targetRotation = Math.max(
          -0.18,
          Math.min(0.18, velError * 0.03 * gravityFactor),
        );
      } else {
        targetRotation = Math.max(
          -0.12,
          Math.min(0.12, -horizontalVelocity * 0.04),
        );
      }
    } else {
      // LOW ALTITUDE: Stay upright, small corrections only
      if (horizontalDistance > 10) {
        targetRotation = Math.max(
          -0.08,
          Math.min(0.08, -horizontalVelocity * 0.025 + horizontalError * 0.002),
        );
      } else {
        targetRotation = Math.max(
          -0.06,
          Math.min(0.06, -horizontalVelocity * 0.02),
        );
      }
    }
  }

  // ============================================
  // ATTITUDE CONTROL (PD controller)
  // ============================================
  const rotationError = targetRotation - rotation;
  const rotationCommand =
    gains.attitude.kp * 1.8 * rotationError -
    gains.attitude.kd * 1.5 * lander.angularVelocity;
  const finalRotation = Math.max(-1, Math.min(1, rotationCommand));

  // ============================================
  // THRUST CONTROL - STACCATO STYLE
  // Only thrust when nearly upright!
  // ============================================
  let finalThrust = 0;

  if (mode === "stabilize") {
    finalThrust = 0; // Manual thrust in stabilize mode
  } else {
    const targetDescentRate = getTargetDescentRate(altitude, gravityFactor);

    // STACCATO: Only thrust if nearly upright
    if (isNearlyUpright) {
      if (verticalVelocity > targetDescentRate + 8 * gravityFactor) {
        finalThrust = 1.0;
      } else if (verticalVelocity > targetDescentRate + 3 * gravityFactor) {
        finalThrust = hoverThrust + 0.4;
      } else if (verticalVelocity > targetDescentRate) {
        finalThrust = hoverThrust + 0.15;
      } else if (verticalVelocity > 0) {
        finalThrust = hoverThrust * 0.7;
      } else {
        finalThrust = 0;
      }
    } else {
      // NOT upright - minimal thrust while rotating
      // Exception: emergency if falling fast or very low
      if (verticalVelocity > 30 * gravityFactor) {
        finalThrust = 0.6;
      } else if (altitude < 25 && verticalVelocity > 8 * gravityFactor) {
        finalThrust = 0.5;
      } else {
        finalThrust = 0;
      }
    }

    // Final safety: very low altitude emergency
    if (altitude < 12 && verticalVelocity > 4 * gravityFactor) {
      finalThrust = 1.0;
    }
  }

  return {
    thrust: finalThrust,
    rotation: finalRotation,
  };
}

/**
 * Orbital Autopilot - Wait for Optimal Descent Window
 *
 * Maintains attitude while in orbit, waiting for the optimal
 * moment to initiate descent based on pad position.
 *
 * @deprecated Use computeGNCAutopilot instead for better landing accuracy
 */
export function computeOrbitalAutopilot(
  lander: LanderState,
  landingPad: LandingPad,
  config: GameConfig,
): AutopilotCommand {
  const padCenterX = getPadCenter(landingPad);

  // Calculate horizontal distance to pad (with wraparound)
  const dx = calculateHorizontalError(
    lander.position.x,
    padCenterX,
    config.width,
  );

  // Calculate time to reach pad at current horizontal velocity
  const timeToTarget =
    lander.velocity.x !== 0 ? Math.abs(dx / lander.velocity.x) : Infinity;

  // Estimate descent time using physics
  const altitude = config.height - lander.position.y - 100;
  const descentTime = Math.sqrt((2 * altitude) / config.gravity) * 1.8;

  // Maintain attitude (keep upright)
  const rotationError = -lander.rotation;
  const rotationCommand = 2.0 * rotationError - 1.5 * lander.angularVelocity;

  // Start descent when time to target matches descent time
  const approaching =
    (dx > 0 && lander.velocity.x > 0) || (dx < 0 && lander.velocity.x < 0);
  const inWindow =
    timeToTarget <= descentTime && Math.abs(dx) < config.width * 0.3;

  if (approaching && inWindow) {
    return {
      thrust: 0.1, // Small thrust to break orbit
      rotation: Math.max(-1, Math.min(1, rotationCommand)),
    };
  }

  return {
    thrust: 0,
    rotation: Math.max(-1, Math.min(1, rotationCommand)),
  };
}

/**
 * Abort Maneuver - Return to Orbit
 *
 * Full thrust upward until reaching orbital altitude.
 * Used when the pilot decides to abort the landing attempt.
 *
 * @param lander - Current lander state
 * @param config - Game configuration
 * @param targetAltitude - Altitude to reach before cutting thrust
 * @returns Thrust and rotation commands
 */
export function computeAbortManeuver(
  lander: LanderState,
  config: GameConfig,
  targetAltitude: number,
): AutopilotCommand {
  // Target: point straight up
  const rotationError = -lander.rotation;
  const rotationCommand = 3.0 * rotationError - 2.0 * lander.angularVelocity;

  // Calculate current state
  const currentAltitude = config.height - lander.position.y - 100;
  const ascending = lander.velocity.y < 0;
  const nearTarget = currentAltitude > targetAltitude - 150;

  let thrust = 1.0; // Default full thrust

  if (ascending && nearTarget) {
    thrust = 0.3; // Reduce thrust near target
  }

  if (ascending && lander.velocity.y < -20) {
    thrust = 0; // Cut thrust when rising fast enough
  }

  return {
    thrust,
    rotation: Math.max(-1, Math.min(1, rotationCommand)),
  };
}

/**
 * Stabilize Only Autopilot
 *
 * Simply rights the ship and kills angular velocity.
 * No thrust control - that's left to the pilot.
 *
 * @param lander - Current lander state
 * @returns Rotation command only (thrust = 0)
 */
export function computeStabilizeOnly(lander: LanderState): AutopilotCommand {
  const rotationError = -lander.rotation;
  const rotationCommand =
    DEFAULT_GAINS.attitude.kp * rotationError -
    DEFAULT_GAINS.attitude.kd * lander.angularVelocity;

  return {
    thrust: 0,
    rotation: Math.max(-1, Math.min(1, rotationCommand)),
  };
}

/**
 * Check if autopilot should disengage
 *
 * Returns true if the lander has landed or crashed,
 * indicating the autopilot should stop commanding.
 *
 * @param lander - Current lander state
 * @returns Whether to disengage autopilot
 */
export function shouldDisengage(lander: LanderState): boolean {
  return !lander.alive || lander.landed;
}
