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
import {
  calculateTwoBurnSolution,
  calculateRealTimeGuidance,
  type TwoBurnSolution,
  type GuidanceState,
} from "./trajectory";

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

// ============================================================================
// GNC AUTOPILOT - Two-Burn Computed Trajectory System
// ============================================================================

/**
 * GNC Autopilot state - persists across frames
 */
export interface GNCState {
  // Current autopilot phase
  phase:
    | "orbit_wait"
    | "orbit_align"
    | "deorbit_burn"
    | "coast"
    | "terminal_burn"
    | "touchdown";

  // Computed solution (recalculated periodically)
  solution: TwoBurnSolution | null;
  solutionAge: number; // Frames since last solution update

  // Target pad (locked once descent starts)
  targetPadIndex: number;
  targetPadLocked: boolean;
  lockedPadViable: boolean; // Is the locked pad still reachable?

  // Burn tracking
  deorbitBurnComplete: boolean;
  deorbitBurnStartTime: number | null;
  terminalBurnStarted: boolean;

  // Performance tracking
  lastGuidance: GuidanceState | null;
}

/**
 * Create initial GNC state
 */
export function createGNCState(): GNCState {
  return {
    phase: "orbit_wait",
    solution: null,
    solutionAge: 0,
    targetPadIndex: 0,
    targetPadLocked: false,
    lockedPadViable: true,
    deorbitBurnComplete: false,
    deorbitBurnStartTime: null,
    terminalBurnStarted: false,
    lastGuidance: null,
  };
}

/**
 * GNC Autopilot - Computed trajectory two-burn landing system
 *
 * This is the new autopilot that uses pre-computed burns instead of
 * reactive control. It follows a state machine:
 *
 * 1. ORBIT_WAIT: Waiting for optimal descent window
 * 2. ORBIT_ALIGN: Orienting for deorbit burn
 * 3. DEORBIT_BURN: Executing retrograde burn to kill horizontal velocity
 * 4. COAST: Falling toward target, small corrections only
 * 5. TERMINAL_BURN: Suicide burn for final landing
 * 6. TOUCHDOWN: Final approach and landing
 */
export function computeGNCAutopilot(
  lander: LanderState,
  terrain: TerrainPoint[],
  pads: LandingPad[],
  config: GameConfig,
  gncState: GNCState,
  gameTime: number,
  gains: AutopilotGains = DEFAULT_GAINS,
): { command: AutopilotCommand; newState: GNCState } {
  const altitude = getAltitude(lander.position, terrain, config.width);
  const state = { ...gncState };

  // Get target pad
  const targetPad = pads[state.targetPadIndex] || pads[0];
  const padCenter = (targetPad.x1 + targetPad.x2) / 2;

  // Calculate horizontal error to target
  let horizontalError = padCenter - lander.position.x;
  if (Math.abs(horizontalError) > config.width / 2) {
    horizontalError =
      horizontalError > 0
        ? horizontalError - config.width
        : horizontalError + config.width;
  }

  // Update solution periodically (every 30 frames or when stale)
  state.solutionAge++;
  if (state.solution === null || state.solutionAge > 30) {
    state.solution = calculateTwoBurnSolution(
      lander,
      config,
      terrain,
      pads,
      targetPad,
    );
    state.solutionAge = 0;
  }

  // Get real-time guidance
  const guidance = calculateRealTimeGuidance(
    lander,
    config,
    terrain,
    pads,
    targetPad,
    state.solution,
    altitude,
  );
  state.lastGuidance = guidance;

  // ============================================
  // STATE MACHINE
  // ============================================

  // Check if pad is ahead of us (in direction of travel)
  // This prevents trying to go backwards to reach a pad we passed
  const padIsAhead = (() => {
    const vx = lander.velocity.x;
    if (Math.abs(vx) < 1) return true; // Not really moving, any pad is fine

    // Pad is ahead if horizontalError has same sign as velocity
    // (positive error = pad to the right, positive vx = moving right)
    if (vx > 0) {
      // Moving right - pad should be to our right (positive error after wraparound adjustment)
      // Allow small negative error for pads we're about to pass over
      return horizontalError > -50;
    } else {
      // Moving left - pad should be to our left (negative error)
      return horizontalError < 50;
    }
  })();

  // Transition logic
  if (!lander.hasBurned) {
    // Still in orbit - lock target early but only deorbit when in position

    // Lock the target pad once we have a deorbit solution (for visualization)
    // Lock early so the user can see the target, even if solution isn't perfect
    if (!state.targetPadLocked && state.solution?.deorbit && padIsAhead) {
      state.targetPadLocked = true;
      state.lockedPadViable = state.solution.viable;
    }

    // Check if trajectory prediction shows we'll land on/near the pad
    // This is the key signal to start deorbit - when the predicted impact is on target
    const deorbit = state.solution?.deorbit;
    const trajectoryOnTarget =
      deorbit &&
      (deorbit.trajectoryAfterBurn?.onPad === true ||
        Math.abs(deorbit.horizontalErrorAtImpact) < 30);

    // Check confidence - we need a good solution before committing
    const goodConfidence = deorbit && deorbit.confidence > 0.7;

    // Burn timing check - we should be within the optimal window
    // The burn.startTime is recalculated every frame, so small values mean "burn soon"
    const inBurnWindow = deorbit && deorbit.burn.startTime < 1.5;

    // Only enter orbit_align (and initiate deorbit) if:
    // 1. We have a high-confidence solution
    // 2. Trajectory predicts landing on/near pad
    // 3. The pad is AHEAD of us (not behind)
    // 4. We're in the burn window
    if (
      state.solution?.deorbit &&
      padIsAhead &&
      (trajectoryOnTarget || goodConfidence) &&
      inBurnWindow
    ) {
      state.phase = "orbit_align";
    } else {
      state.phase = "orbit_wait";
    }
  } else if (!state.deorbitBurnComplete) {
    // Check if deorbit burn is complete (horizontal velocity killed)
    if (Math.abs(lander.velocity.x) < 8) {
      state.deorbitBurnComplete = true;
      state.phase = "coast";
    } else if (state.deorbitBurnStartTime !== null) {
      state.phase = "deorbit_burn";
    } else if (guidance.phase === "deorbit_burn") {
      state.deorbitBurnStartTime = gameTime;
      state.phase = "deorbit_burn";
    }
  } else {
    // Post deorbit - decide between coast and terminal burn based on stopping distance
    // Calculate stopping distance: how far we'll travel while braking to zero
    const netDecel = config.maxThrust - config.gravity;
    const stoppingDistance =
      (lander.velocity.y * lander.velocity.y) / (2 * netDecel);
    const safetyMargin = 1.3; // Start burn 30% early for safety
    const burnAltitude = stoppingDistance * safetyMargin + 10; // +10 for ground clearance

    if (altitude > burnAltitude && altitude > 50) {
      // Still have room to coast
      state.phase = "coast";
    } else if (altitude > 5) {
      // Need to start terminal burn NOW
      state.phase = "terminal_burn";
      state.terminalBurnStarted = true;
    } else {
      state.phase = "touchdown";
    }
  }

  // Check if locked pad is still viable (can we still land on it?)
  if (state.targetPadLocked && state.solution) {
    const padHalfWidth = (targetPad.x2 - targetPad.x1) / 2;
    const predictedError = Math.abs(horizontalError);
    // Pad becomes non-viable if we're way off course or solution confidence is low
    state.lockedPadViable =
      state.solution.confidence > 0.3 &&
      (predictedError < padHalfWidth * 3 || altitude > 200);
  }

  // ============================================
  // COMPUTE COMMANDS BASED ON PHASE
  // ============================================

  let targetAngle = 0;
  let targetThrust = 0;

  switch (state.phase) {
    case "orbit_wait": {
      // Maintain retrograde orientation, wait for window
      // Physics: sin(rotation) * thrust = x acceleration
      // If moving right (vx > 0), need thrust LEFT (negative x), so sin(r) < 0, so r = -π/2
      // If moving left (vx < 0), need thrust RIGHT (positive x), so sin(r) > 0, so r = +π/2
      targetAngle = lander.velocity.x > 0 ? -Math.PI / 2 : Math.PI / 2;
      targetThrust = 0;
      break;
    }

    case "orbit_align": {
      // Orient for deorbit burn, initiate when ready
      // Retrograde: thrust opposite to velocity direction
      targetAngle = lander.velocity.x > 0 ? -Math.PI / 2 : Math.PI / 2;
      // Small thrust to initiate descent (breaks orbit)
      const alignmentError = Math.abs(lander.rotation - targetAngle);
      if (alignmentError < 0.2) {
        targetThrust = 0.15; // Initiate descent
      } else {
        targetThrust = 0;
      }
      break;
    }

    case "deorbit_burn": {
      // Execute deorbit burn - full retrograde thrust
      // Retrograde: thrust opposite to velocity direction
      targetAngle = lander.velocity.x > 0 ? -Math.PI / 2 : Math.PI / 2;

      // Thrust hard to kill horizontal velocity
      if (Math.abs(lander.velocity.x) > 20) {
        targetThrust = 0.9;
      } else if (Math.abs(lander.velocity.x) > 10) {
        targetThrust = 0.7;
      } else {
        targetThrust = 0.5;
      }
      break;
    }

    case "coast": {
      // Falling toward target - active corrections to stay on course
      // This is CRITICAL for landing accuracy

      // Calculate where we'll land at current trajectory
      const timeToGround =
        altitude > 0 && lander.velocity.y > 0
          ? altitude / lander.velocity.y
          : 10;
      const predictedLandingX =
        lander.position.x + lander.velocity.x * timeToGround;

      // Calculate error from predicted landing to pad center
      let predictedError = padCenter - predictedLandingX;
      if (Math.abs(predictedError) > config.width / 2) {
        predictedError =
          predictedError > 0
            ? predictedError - config.width
            : predictedError + config.width;
      }

      // Also calculate direct position error for low-altitude precision
      let directError = padCenter - lander.position.x;
      if (Math.abs(directError) > config.width / 2) {
        directError =
          directError > 0
            ? directError - config.width
            : directError + config.width;
      }

      // Use PD control for horizontal correction
      // Blend predicted error (good at high alt) with direct error (good at low alt)
      const altBlend = Math.min(1, altitude / 200);
      const effectiveError =
        predictedError * altBlend + directError * (1 - altBlend);

      const positionTerm = effectiveError * 0.005; // Proportional to blended error
      const velocityTerm = -lander.velocity.x * 0.02; // Damping for horizontal velocity

      // Tilt to correct - more aggressive when far off
      const maxTilt = Math.abs(effectiveError) > 100 ? 0.35 : 0.25;
      targetAngle = Math.max(
        -maxTilt,
        Math.min(maxTilt, positionTerm + velocityTerm),
      );

      // Apply thrust for corrections if we have significant horizontal velocity
      // or if we're drifting away from target
      const needsCorrection =
        Math.abs(lander.velocity.x) > 8 || Math.abs(effectiveError) > 30;
      const alignedForCorrection =
        Math.abs(lander.rotation - targetAngle) < 0.12;

      if (needsCorrection && alignedForCorrection) {
        // Thrust to make the correction - proportional to how far off we are
        const correctionMagnitude = Math.min(
          0.5,
          Math.abs(effectiveError) * 0.003 + Math.abs(lander.velocity.x) * 0.02,
        );
        targetThrust = correctionMagnitude;
      } else {
        targetThrust = 0;
      }
      break;
    }

    case "terminal_burn": {
      // Suicide burn - thrust to arrest descent while correcting horizontal position
      // Calculate required deceleration
      const netDecel = config.maxThrust - config.gravity;
      const timeToZeroVelocity = lander.velocity.y / netDecel;
      const stopDistance = (lander.velocity.y * timeToZeroVelocity) / 2;

      // Estimate time to ground
      const timeToGround =
        lander.velocity.y > 0 ? altitude / lander.velocity.y : 5;

      // Calculate where we'll land if we don't correct
      // Use a better estimate that accounts for deceleration
      const avgVelocityDuringBurn = lander.velocity.x * 0.5;
      const predictedLandingX =
        lander.position.x + avgVelocityDuringBurn * timeToGround;

      // Direct position error from current position to pad center
      let directError = padCenter - lander.position.x;
      if (Math.abs(directError) > config.width / 2) {
        directError =
          directError > 0
            ? directError - config.width
            : directError + config.width;
      }

      // Predicted error (where we'll land vs where we want)
      let predictedError = padCenter - predictedLandingX;
      if (Math.abs(predictedError) > config.width / 2) {
        predictedError =
          predictedError > 0
            ? predictedError - config.width
            : predictedError + config.width;
      }

      // Tilt for horizontal correction during burn
      // Use BOTH direct position error AND predicted error for better centering
      // Weight direct error more heavily at low altitude for precision
      const altitudeFactor = Math.min(1, altitude / 100);
      const positionTerm = directError * 0.008 * (1 - altitudeFactor * 0.5);
      const predictionTerm = predictedError * 0.004 * altitudeFactor;
      const velocityTerm = -lander.velocity.x * 0.035;
      const correctionTilt = Math.max(
        -0.25,
        Math.min(0.25, positionTerm + predictionTerm + velocityTerm),
      );
      targetAngle = correctionTilt;

      // Throttle based on how fast we're descending vs. altitude remaining
      if (stopDistance > altitude * 0.9) {
        // Need to brake NOW
        targetThrust = 1.0;
      } else if (stopDistance > altitude * 0.6) {
        targetThrust = 0.85;
      } else if (lander.velocity.y > 10) {
        targetThrust = 0.6;
      } else if (lander.velocity.y > 5) {
        targetThrust = 0.4;
      } else {
        // Descending slowly - hover thrust
        targetThrust = config.gravity / config.maxThrust;
      }
      break;
    }

    case "touchdown": {
      // Final landing - stay upright, gentle thrust
      targetAngle = 0;
      if (lander.velocity.y > 3) {
        targetThrust = 0.5;
      } else if (lander.velocity.y > 1) {
        targetThrust = 0.3;
      } else {
        targetThrust = 0;
      }
      break;
    }
  }

  // ============================================
  // ATTITUDE CONTROL
  // ============================================
  const rotationError = targetAngle - lander.rotation;
  const rotationCommand =
    gains.attitude.kp * 2.0 * rotationError -
    gains.attitude.kd * 1.8 * lander.angularVelocity;
  const finalRotation = Math.max(-1, Math.min(1, rotationCommand));

  // ============================================
  // SAFETY OVERRIDES
  // ============================================
  let finalThrust = targetThrust;

  // Emergency brake if falling too fast
  if (lander.velocity.y > 40 && altitude < 200) {
    finalThrust = 1.0;
  }

  // Emergency brake if very low and still descending
  if (altitude < 20 && lander.velocity.y > 8) {
    finalThrust = 1.0;
  }

  return {
    command: {
      thrust: finalThrust,
      rotation: finalRotation,
    },
    newState: state,
  };
}

/**
 * Orbital autopilot - waits for optimal descent point
 * Maintains attitude while calculating descent window
 * @deprecated Use computeGNCAutopilot instead for better landing accuracy
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
 * Result of landing cone analysis
 */
export interface LandingConeResult {
  // The selected target pad
  selected: { pad: LandingPad; index: number; viable: boolean };
  // All pads in the landing cone (viable targets)
  cone: number[]; // Pad indices that are in the reachable cone
  // Cone boundaries for visualization
  minForwardDistance: number;
  maxForwardDistance: number;
}

/**
 * Select the best target pad
 * CRITICAL: Must select pads AHEAD of lander in direction of travel
 *
 * The lander starts in orbit moving at ~120 px/s. We need to pick a pad
 * that is far enough ahead that we can plan a deorbit burn to reach it.
 * Minimum "ahead" distance should be ~500px to allow time for trajectory planning.
 */
export function selectTargetPad(
  viabilities: PadViability[],
  pads: LandingPad[],
  landerX?: number,
  landerVx?: number,
  worldWidth?: number,
  randomize: boolean = false,
): { pad: LandingPad; index: number; viable: boolean } {
  const result = selectTargetPadWithCone(
    viabilities,
    pads,
    landerX,
    landerVx,
    worldWidth,
    randomize,
  );
  return result.selected;
}

/**
 * Select target pad and return full cone analysis
 * Excludes occupied pads from selection (they have rockets on them)
 */
export function selectTargetPadWithCone(
  viabilities: PadViability[],
  pads: LandingPad[],
  landerX?: number,
  landerVx?: number,
  worldWidth?: number,
  randomize: boolean = false,
): LandingConeResult {
  const defaultResult: LandingConeResult = {
    selected: { pad: pads[0], index: 0, viable: false },
    cone: [],
    minForwardDistance: 0,
    maxForwardDistance: 0,
  };

  if (!pads.length) return defaultResult;

  // Filter out occupied pads - they cannot be landed on
  const availableViabilities = viabilities.filter(
    (v) => !pads[v.padIndex].occupied,
  );

  // If all pads are occupied, return default (shouldn't happen - terrain ensures at least one free)
  if (availableViabilities.length === 0) {
    return defaultResult;
  }

  // If we don't have velocity info, fall back to nearest available pad
  if (
    landerX === undefined ||
    landerVx === undefined ||
    worldWidth === undefined ||
    Math.abs(landerVx) < 5
  ) {
    const sorted = [...availableViabilities].sort(
      (a, b) => a.distance - b.distance,
    );
    const nearest = sorted[0];
    if (!nearest) {
      return defaultResult;
    }
    return {
      selected: {
        pad: pads[nearest.padIndex],
        index: nearest.padIndex,
        viable: nearest.viable,
      },
      cone: [nearest.padIndex],
      minForwardDistance: 0,
      maxForwardDistance: worldWidth,
    };
  }

  // Calculate "forward distance" for each available pad (distance in direction of travel)
  const padsWithForwardDistance = availableViabilities.map((v) => {
    const pad = pads[v.padIndex];
    const padCenter = (pad.x1 + pad.x2) / 2;

    // Calculate distance accounting for wraparound
    let dx = padCenter - landerX;

    // Normalize for wraparound based on velocity direction
    if (landerVx > 0) {
      // Moving right - positive dx means ahead
      if (dx < 0) dx += worldWidth; // Wrap negative to positive (pad is ahead via wraparound)
    } else {
      // Moving left - negative dx means ahead
      if (dx > 0) dx -= worldWidth; // Wrap positive to negative
      dx = Math.abs(dx); // Convert to positive "forward" distance
    }

    return {
      ...v,
      forwardDistance: dx,
      padCenter,
    };
  });

  // Define the landing cone - pads that are reachable
  const minAheadDistance = 300; // Minimum distance to plan deorbit
  const maxAheadDistance = worldWidth * 0.75; // Maximum practical range

  // Get all available pads in the cone (excludes occupied)
  const conePadIndices = padsWithForwardDistance
    .filter(
      (p) =>
        p.forwardDistance >= minAheadDistance &&
        p.forwardDistance <= maxAheadDistance,
    )
    .map((p) => p.padIndex);

  let candidates = padsWithForwardDistance.filter(
    (p) =>
      p.forwardDistance >= minAheadDistance &&
      p.forwardDistance <= maxAheadDistance,
  );

  // If no candidates far enough ahead, accept any pad that's ahead at all
  if (candidates.length === 0) {
    candidates = padsWithForwardDistance.filter((p) => p.forwardDistance > 0);
  }

  // If still no candidates, use all available pads
  if (candidates.length === 0) {
    candidates = padsWithForwardDistance;
  }

  // Sort by forward distance - prefer closer pads (less fuel needed)
  candidates.sort((a, b) => a.forwardDistance - b.forwardDistance);

  // Select from candidates - either random or first viable
  let selected: (typeof candidates)[0] | undefined;

  if (randomize && candidates.length > 1) {
    // Random selection among ALL candidates in the cone
    // Don't filter by viability - that's too restrictive early in flight
    // The autopilot will adapt to reach whichever pad is selected
    const randomIndex = Math.floor(Math.random() * candidates.length);
    selected = candidates[randomIndex];
  } else {
    // Emergency mode or single candidate - prefer nearest viable pad
    selected = candidates.find((v) => v.viable) || candidates[0];
  }

  if (!selected) {
    return defaultResult;
  }

  return {
    selected: {
      pad: pads[selected.padIndex],
      index: selected.padIndex,
      viable: selected.viable,
    },
    cone: conePadIndices,
    minForwardDistance: minAheadDistance,
    maxForwardDistance: maxAheadDistance,
  };
}
