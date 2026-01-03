import type {
  LanderState,
  GameConfig,
  AutopilotCommand,
  LandingPad,
  TerrainPoint,
  PadViability,
  GamePhase,
} from "./types";
import type { AutopilotGains } from "./worlds";
import { getAltitude, getTerrainHeightAt, updatePhysics } from "./physics";

/**
 * Default PD Controller gains (for Moon)
 * Can be overridden per-world
 */
const DEFAULT_GAINS: AutopilotGains = {
  attitude: {
    kp: 3.0,
    kd: 2.0,
  },
  horizontal: {
    kp: 0.02,
    kd: 0.3,
  },
  vertical: {
    kp: 0.5,
    kd: 0.1,
  },
};

/**
 * Desired descent rate based on altitude and gravity factor
 */
function getTargetDescentRate(
  altitude: number,
  gravityFactor: number = 1,
): number {
  // Scale rates by gravity - higher gravity means faster safe descent
  const factor = Math.sqrt(gravityFactor);

  if (altitude > 500) return 40 * factor;
  if (altitude > 200) return 25 * factor;
  if (altitude > 100) return 15 * factor;
  if (altitude > 50) return 8 * factor;
  if (altitude > 20) return 4 * factor;
  return 2 * factor;
}

/**
 * Main autopilot function
 * Returns thrust and rotation commands
 *
 * Strategy: STACCATO APPROACH
 * - Rotate WITHOUT thrust to aim
 * - Thrust only when nearly upright
 * - This prevents wasteful sideways thrust and oscillation
 *
 * ORBITAL MODE:
 * - In orbit phase, wait for optimal descent point
 * - Calculate when to initiate burn based on pad position
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
  const gravityFactor = config.gravity / 20; // Normalize to Moon baseline

  // Target position (center of landing pad for 'land' mode)
  const targetX =
    mode === "stabilize"
      ? lander.position.x
      : (landingPad.x1 + landingPad.x2) / 2;

  // Calculate horizontal error (with wraparound)
  let horizontalError = targetX - lander.position.x;
  if (Math.abs(horizontalError) > config.width / 2) {
    horizontalError =
      horizontalError > 0
        ? horizontalError - config.width
        : horizontalError + config.width;
  }

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
    // Scale corrections by gravity factor (higher gravity needs more aggressive corrections)

    if (altitude > 200) {
      // VERY HIGH ALTITUDE: Aggressive horizontal correction
      // Allow larger tilt angles to build horizontal velocity early
      if (horizontalDistance > 50) {
        const desiredVel =
          Math.sign(horizontalError) *
          Math.min(40 * gravityFactor, horizontalDistance * 0.2);
        const velError = desiredVel - horizontalVelocity;
        // More aggressive tilt - up to 30 degrees
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
        // Close to target, arrest horizontal velocity
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
      // Prioritize vertical alignment but still correct drift
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
  // ATTITUDE CONTROL (fast PD controller)
  // Use world-specific gains
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
    finalThrust = 0; // Manual thrust
  } else {
    // Determine target descent rate based on altitude
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
      // NOT upright - no thrust while rotating (staccato style)
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
 * Orbital autopilot - waits for optimal descent point
 * Maintains attitude while calculating descent window
 */
function computeOrbitalAutopilot(
  lander: LanderState,
  landingPad: LandingPad,
  config: GameConfig,
): AutopilotCommand {
  const padCenterX = (landingPad.x1 + landingPad.x2) / 2;

  // Calculate horizontal distance to pad (with wraparound)
  let dx = padCenterX - lander.position.x;
  if (Math.abs(dx) > config.width / 2) {
    dx = dx > 0 ? dx - config.width : dx + config.width;
  }

  // Calculate time to reach pad at current horizontal velocity
  const timeToTarget =
    lander.velocity.x !== 0 ? Math.abs(dx / lander.velocity.x) : Infinity;

  // Estimate descent time using physics
  // t = sqrt(2 * altitude / gravity) with safety factor
  const altitude = config.height - lander.position.y - 100; // Rough altitude
  const descentTime = Math.sqrt((2 * altitude) / config.gravity) * 1.8;

  // Maintain attitude (keep upright)
  const rotationError = -lander.rotation;
  const rotationCommand = 2.0 * rotationError - 1.5 * lander.angularVelocity;

  // Start descent when time to target is close to descent time
  // Also check that we're approaching the pad (not moving away)
  const approaching =
    (dx > 0 && lander.velocity.x > 0) || (dx < 0 && lander.velocity.x < 0);
  const inWindow =
    timeToTarget <= descentTime && Math.abs(dx) < config.width * 0.3;

  if (approaching && inWindow) {
    // Initiate descent with small thrust tap
    return {
      thrust: 0.1, // Small thrust to break orbit
      rotation: Math.max(-1, Math.min(1, rotationCommand)),
    };
  }

  // Not in window yet - maintain attitude, no thrust
  return {
    thrust: 0,
    rotation: Math.max(-1, Math.min(1, rotationCommand)),
  };
}

/**
 * Abort maneuver - return to orbit
 * Full thrust upward until reaching orbital altitude
 */
export function computeAbortManeuver(
  lander: LanderState,
  config: GameConfig,
  targetAltitude: number,
): AutopilotCommand {
  // Target: point straight up
  const rotationError = -lander.rotation;
  const rotationCommand = 3.0 * rotationError - 2.0 * lander.angularVelocity;

  // Full thrust until ascending and close to target
  const currentAltitude = config.height - lander.position.y - 100;
  const ascending = lander.velocity.y < 0;
  const nearTarget = currentAltitude > targetAltitude - 150;

  let thrust = 1.0; // Default full thrust

  if (ascending && nearTarget) {
    // Approaching target - reduce thrust
    thrust = 0.3;
  }

  if (ascending && lander.velocity.y < -20) {
    // Rising fast enough - cut thrust
    thrust = 0;
  }

  return {
    thrust,
    rotation: Math.max(-1, Math.min(1, rotationCommand)),
  };
}

/**
 * Simplified "stabilize only" autopilot
 * Just rights the ship and kills rotation
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
 * Check if autopilot should disengage (landed or crashed)
 */
export function shouldDisengage(lander: LanderState): boolean {
  return !lander.alive || lander.landed;
}

/**
 * Simulate trajectory to a specific pad to determine viability
 */
export function simulateTrajectoryToPad(
  lander: LanderState,
  terrain: TerrainPoint[],
  pad: LandingPad,
  config: GameConfig,
): { viable: boolean; fuelCost: number } {
  // Clone lander state for simulation
  let simLander: LanderState = {
    ...lander,
    position: { ...lander.position },
    velocity: { ...lander.velocity },
  };

  const startFuel = simLander.fuel;
  const dt = 0.1;
  const maxIterations = 500;

  for (let i = 0; i < maxIterations; i++) {
    if (simLander.fuel <= 0) {
      const altitude = getAltitude(simLander.position, terrain, config.width);
      if (altitude < 50 && simLander.velocity.y > config.maxLandingVelocity) {
        return { viable: false, fuelCost: startFuel };
      }
    }

    const command = computeAutopilot(
      simLander,
      terrain,
      pad,
      config,
      "land",
      "descent",
    );

    simLander = updatePhysics(
      simLander,
      config,
      command.thrust,
      command.rotation,
      dt,
    );

    const terrainY = getTerrainHeightAt(
      terrain,
      simLander.position.x,
      config.width,
    );
    const landerBottom = simLander.position.y + 15;

    if (landerBottom >= terrainY) {
      const onPad =
        simLander.position.x >= pad.x1 && simLander.position.x <= pad.x2;
      const speed = Math.sqrt(
        simLander.velocity.x ** 2 + simLander.velocity.y ** 2,
      );
      const angleOk = Math.abs(simLander.rotation) < config.maxLandingAngle;
      const speedOk = speed < config.maxLandingVelocity;

      if (onPad && angleOk && speedOk) {
        return { viable: true, fuelCost: startFuel - simLander.fuel };
      } else {
        return { viable: false, fuelCost: startFuel - simLander.fuel };
      }
    }
  }

  return { viable: false, fuelCost: startFuel };
}

/**
 * Evaluate viability of all pads
 */
export function evaluateAllPads(
  lander: LanderState,
  terrain: TerrainPoint[],
  pads: LandingPad[],
  config: GameConfig,
): PadViability[] {
  return pads.map((pad, index) => {
    const padCenter = (pad.x1 + pad.x2) / 2;

    let dx = padCenter - lander.position.x;
    if (Math.abs(dx) > config.width / 2) {
      dx = dx > 0 ? dx - config.width : dx + config.width;
    }
    const distance = Math.abs(dx);

    const result = simulateTrajectoryToPad(lander, terrain, pad, config);

    return {
      padIndex: index,
      viable: result.viable,
      estimatedFuelCost: result.fuelCost,
      distance,
    };
  });
}

/**
 * Select the best target pad
 */
export function selectTargetPad(
  viabilities: PadViability[],
  pads: LandingPad[],
): { pad: LandingPad; index: number; viable: boolean } {
  const sorted = [...viabilities].sort((a, b) => a.distance - b.distance);

  const nearestViable = sorted.find((v) => v.viable);
  if (nearestViable) {
    return {
      pad: pads[nearestViable.padIndex],
      index: nearestViable.padIndex,
      viable: true,
    };
  }

  const nearest = sorted[0];
  return {
    pad: pads[nearest.padIndex],
    index: nearest.padIndex,
    viable: false,
  };
}
