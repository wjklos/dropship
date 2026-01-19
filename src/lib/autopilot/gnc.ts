/**
 * GNC Autopilot - Guidance, Navigation, and Control
 *
 * The main autopilot system using pre-computed two-burn trajectories.
 * This is a state machine that progresses through landing phases:
 *
 * 1. ORBIT_WAIT: Waiting in orbit for optimal descent window
 * 2. ORBIT_ALIGN: Orienting for deorbit burn
 * 3. DEORBIT_BURN: Retrograde burn to kill horizontal velocity
 * 4. COAST: Falling toward target with small corrections
 * 5. TERMINAL_BURN: Suicide burn to arrest descent
 * 6. TOUCHDOWN: Final approach and landing
 */

import type {
  LanderState,
  GameConfig,
  AutopilotCommand,
  LandingPad,
  TerrainPoint,
  ApproachMode,
} from "../types";
import type { AutopilotGains } from "../worlds";
import { getAltitude } from "../physics";
import {
  calculateTwoBurnSolution,
  calculateRealTimeGuidance,
  calculateOptimalBurnX,
} from "../trajectory";
import { calculateHorizontalError, getPadCenter } from "../utils";
import { DEFAULT_GAINS } from "./gains";
import type { GNCState } from "./types";
import {
  assessAbortOptions,
  initializeAbort,
  executeAbortToOrbit,
  executeAbortRetarget,
  executeAbortBrace,
  isOrbitAchieved,
  resetAbortState,
  isAbortPhase,
} from "./abort";

/**
 * Create initial GNC state
 *
 * Returns a fresh GNC state object for starting a new landing attempt.
 */
export function createGNCState(): GNCState {
  return {
    // Normal descent state
    phase: "orbit_wait",
    solution: null,
    solutionAge: 0,
    targetPadIndex: 0,
    targetPadLocked: false,
    lockedPadViable: true,
    deorbitBurnComplete: false,
    lockedDeorbitX: null,
    deorbitBurnStartTime: null,
    deorbitTimingDelta: null,
    terminalBurnStarted: false,
    lastGuidance: null,
    // Abort state
    abortDecision: null,
    abortToOrbitSubPhase: null,
    emergencyPadIndex: null,
    abortStartAltitude: null,
    abortStartFuel: null,
    abortStartVelocity: null,
    originalPadIndex: null,
  };
}

/**
 * GNC Autopilot - Computed Trajectory Landing System
 *
 * This is the primary autopilot that uses pre-computed burns for
 * fuel-efficient landings. It follows a state machine through the
 * landing phases.
 *
 * @param lander - Current lander state
 * @param terrain - Terrain points for collision/altitude
 * @param pads - All landing pads
 * @param config - Game configuration
 * @param gncState - Current GNC state (will be updated)
 * @param gameTime - Current game time for burn timing
 * @param gains - PD controller gains
 * @param approachMode - "stop_drop" or "boostback"
 * @returns Command and updated state
 */
export function computeGNCAutopilot(
  lander: LanderState,
  terrain: TerrainPoint[],
  pads: LandingPad[],
  config: GameConfig,
  gncState: GNCState,
  gameTime: number,
  gains: AutopilotGains = DEFAULT_GAINS,
  approachMode: ApproachMode = "stop_drop",
): { command: AutopilotCommand; newState: GNCState } {
  const altitude = getAltitude(lander.position, terrain, config.width);
  const state = { ...gncState };

  // ============================================
  // ABORT PHASE HANDLING
  // ============================================
  // If in an abort phase, handle it separately from normal descent
  if (isAbortPhase(state.phase)) {
    return handleAbortPhase(lander, terrain, pads, config, state, gains);
  }

  // Get target pad
  const targetPad = pads[state.targetPadIndex] || pads[0];
  const padCenter = getPadCenter(targetPad);

  // Calculate horizontal error to target
  const horizontalError = calculateHorizontalError(
    lander.position.x,
    padCenter,
    config.width,
  );

  // Update trajectory solution periodically
  // The solution must be recalculated because startTime is a snapshot that doesn't
  // automatically count down. The lockedDeorbitX is stored separately for display.
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
  // STATE MACHINE TRANSITIONS
  // ============================================

  // Check if pad is ahead of us (in direction of travel)
  const padIsAhead = checkPadIsAhead(lander.velocity.x, horizontalError);

  // Handle state transitions
  if (!lander.hasBurned) {
    handleOrbitPhase(state, horizontalError, padIsAhead);

    // When pad is locked, calculate the fixed optimal burn position
    // This is based on pad location and physics, not lander position
    if (state.targetPadLocked && state.lockedDeorbitX === null) {
      state.lockedDeorbitX = calculateOptimalBurnX(
        padCenter,
        lander.velocity.x, // Current orbital velocity
        config.gravity,
        config.maxThrust,
        altitude,
        config.width,
      );
    }
  } else if (!state.deorbitBurnComplete) {
    handleDeorbitPhase(
      state,
      lander,
      horizontalError,
      guidance,
      gameTime,
      approachMode,
      config.width,
    );
  } else {
    handleDescentPhase(state, lander, config, altitude);
  }

  // Check if locked pad is still viable
  updatePadViability(state, targetPad, horizontalError, altitude);

  // ============================================
  // COMPUTE COMMANDS BASED ON PHASE
  // ============================================

  const { targetAngle, targetThrust } = computePhaseCommands(
    state.phase,
    lander,
    config,
    altitude,
    padCenter,
    horizontalError,
    approachMode,
  );

  // Apply attitude control
  const rotationError = targetAngle - lander.rotation;
  const rotationCommand =
    gains.attitude.kp * 2.0 * rotationError -
    gains.attitude.kd * 1.8 * lander.angularVelocity;
  const finalRotation = Math.max(-1, Math.min(1, rotationCommand));

  // Apply safety overrides
  let finalThrust = targetThrust;
  finalThrust = applySafetyOverrides(finalThrust, lander.velocity.y, altitude);

  return {
    command: {
      thrust: finalThrust,
      rotation: finalRotation,
    },
    newState: state,
  };
}

/**
 * Check if target pad is ahead of lander in direction of travel
 */
function checkPadIsAhead(velocityX: number, horizontalError: number): boolean {
  if (Math.abs(velocityX) < 1) return true;

  if (velocityX > 0) {
    return horizontalError > -50;
  } else {
    return horizontalError < 50;
  }
}

/**
 * Handle state transitions during orbit phase
 */
function handleOrbitPhase(
  state: GNCState,
  horizontalError: number,
  padIsAhead: boolean,
): void {
  // Lock target pad when we have a good solution with enough lead time
  // Only lock if burn is at least 2 seconds away (so deorbit point is ahead of lander)
  const hasGoodLeadTime =
    state.solution?.deorbit && state.solution.deorbit.burn.startTime > 2;
  if (
    !state.targetPadLocked &&
    state.solution?.deorbit &&
    padIsAhead &&
    hasGoodLeadTime
  ) {
    state.targetPadLocked = true;
    state.lockedPadViable = state.solution.viable;
    // Note: lockedDeorbitX is calculated in computeGNCAutopilot using calculateOptimalBurnX
  }

  const deorbit = state.solution?.deorbit;
  const trajectoryOnTarget =
    deorbit &&
    (deorbit.trajectoryAfterBurn?.onPad === true ||
      Math.abs(deorbit.horizontalErrorAtImpact) < 30);
  const goodConfidence = deorbit && deorbit.confidence > 0.7;
  const inBurnWindow = deorbit && deorbit.burn.startTime < 1.5;

  // Safety: don't enter orbit_align if burn.startTime is too small
  // This prevents immediate burns right after reset when a pad happens to be nearby
  // Require at least 0.5s lead time to properly orient
  const burnTimingSafe = deorbit && deorbit.burn.startTime > 0.3;

  // Only proceed to orbit_align if we have locked a pad
  // This ensures the deorbit marker is shown before we start the burn
  if (
    state.targetPadLocked &&
    state.solution?.deorbit &&
    padIsAhead &&
    (trajectoryOnTarget || goodConfidence) &&
    inBurnWindow &&
    burnTimingSafe
  ) {
    state.phase = "orbit_align";
  } else {
    state.phase = "orbit_wait";
  }
}

/**
 * Handle state transitions during deorbit burn phase
 */
function handleDeorbitPhase(
  state: GNCState,
  lander: LanderState,
  horizontalError: number,
  guidance: { phase: string },
  gameTime: number,
  approachMode: ApproachMode,
  worldWidth: number,
): void {
  const horizontalVelLow = Math.abs(lander.velocity.x) < 8;
  const nearTarget = Math.abs(horizontalError) < 100;
  const boostbackComplete =
    approachMode === "boostback" &&
    nearTarget &&
    Math.abs(lander.velocity.x) < 20;

  if (horizontalVelLow || boostbackComplete) {
    if (!state.deorbitBurnComplete) {
      console.log(
        `[GNC] Deorbit complete: vx=${lander.velocity.x.toFixed(1)}, vy=${lander.velocity.y.toFixed(1)}`,
      );
    }
    state.deorbitBurnComplete = true;
    state.phase = "coast";
  } else if (state.deorbitBurnStartTime !== null) {
    state.phase = "deorbit_burn";
  } else if (guidance.phase === "deorbit_burn") {
    state.deorbitBurnStartTime = gameTime;

    // Calculate timing delta: how far off from optimal deorbit point
    // Positive = late (past optimal), Negative = early (before optimal)
    if (state.lockedDeorbitX !== null && Math.abs(lander.velocity.x) > 1) {
      let distanceFromOptimal = lander.position.x - state.lockedDeorbitX;

      // Handle world wraparound
      if (distanceFromOptimal > worldWidth / 2) {
        distanceFromOptimal -= worldWidth;
      } else if (distanceFromOptimal < -worldWidth / 2) {
        distanceFromOptimal += worldWidth;
      }

      // Convert to time based on velocity
      // If moving right and past optimal (positive distance), we're late (+)
      // If moving right and before optimal (negative distance), we're early (-)
      const velocity = lander.velocity.x;
      if (velocity > 0) {
        state.deorbitTimingDelta = distanceFromOptimal / velocity;
      } else {
        // Moving left: signs are reversed
        state.deorbitTimingDelta = -distanceFromOptimal / Math.abs(velocity);
      }

      // Log the timing delta for analysis
      const sign = state.deorbitTimingDelta >= 0 ? "+" : "";
      console.log(
        `[GNC] Deorbit burn started: ${sign}${state.deorbitTimingDelta.toFixed(2)}s from optimal`,
      );
    }

    state.phase = "deorbit_burn";
  }
}

/**
 * Handle state transitions during descent phase
 */
function handleDescentPhase(
  state: GNCState,
  lander: LanderState,
  config: GameConfig,
  altitude: number,
): void {
  const netDecel = config.maxThrust - config.gravity;
  const stoppingDistance =
    (lander.velocity.y * lander.velocity.y) / (2 * netDecel);
  const burnAltitude = stoppingDistance * 1.3 + 10;

  const prevPhase = state.phase;

  if (altitude > burnAltitude && altitude > 50) {
    state.phase = "coast";
  } else if (altitude > 5) {
    state.phase = "terminal_burn";
    state.terminalBurnStarted = true;
  } else {
    state.phase = "touchdown";
  }

  // Log phase transitions
  if (prevPhase !== state.phase) {
    console.log(
      `[GNC] Phase: ${prevPhase} -> ${state.phase}, alt: ${altitude.toFixed(0)}, vy: ${lander.velocity.y.toFixed(1)}, burnAlt: ${burnAltitude.toFixed(0)}, stopDist: ${stoppingDistance.toFixed(0)}`,
    );
  }
}

/**
 * Update pad viability status
 */
function updatePadViability(
  state: GNCState,
  targetPad: LandingPad,
  horizontalError: number,
  altitude: number,
): void {
  if (state.targetPadLocked && state.solution) {
    const padHalfWidth = (targetPad.x2 - targetPad.x1) / 2;
    const predictedError = Math.abs(horizontalError);
    state.lockedPadViable =
      state.solution.confidence > 0.3 &&
      (predictedError < padHalfWidth * 3 || altitude > 200);
  }
}

/**
 * Compute thrust and angle commands for current phase
 */
function computePhaseCommands(
  phase: GNCState["phase"],
  lander: LanderState,
  config: GameConfig,
  altitude: number,
  padCenter: number,
  horizontalError: number,
  approachMode: ApproachMode,
): { targetAngle: number; targetThrust: number } {
  switch (phase) {
    case "orbit_wait":
      return computeOrbitWaitCommands(lander);

    case "orbit_align":
      return computeOrbitAlignCommands(lander);

    case "deorbit_burn":
      return computeDeorbitBurnCommands(
        lander,
        config,
        horizontalError,
        approachMode,
      );

    case "coast":
      return computeCoastCommands(lander, config, altitude, padCenter);

    case "terminal_burn":
      return computeTerminalBurnCommands(lander, config, altitude, padCenter);

    case "touchdown":
      return computeTouchdownCommands(lander);

    default:
      return { targetAngle: 0, targetThrust: 0 };
  }
}

function computeOrbitWaitCommands(lander: LanderState): {
  targetAngle: number;
  targetThrust: number;
} {
  return {
    targetAngle: lander.velocity.x > 0 ? -Math.PI / 2 : Math.PI / 2,
    targetThrust: 0,
  };
}

function computeOrbitAlignCommands(lander: LanderState): {
  targetAngle: number;
  targetThrust: number;
} {
  const targetAngle = lander.velocity.x > 0 ? -Math.PI / 2 : Math.PI / 2;
  const alignmentError = Math.abs(lander.rotation - targetAngle);
  return {
    targetAngle,
    targetThrust: alignmentError < 0.2 ? 0.15 : 0,
  };
}

function computeDeorbitBurnCommands(
  lander: LanderState,
  config: GameConfig,
  horizontalError: number,
  approachMode: ApproachMode,
): { targetAngle: number; targetThrust: number } {
  if (approachMode === "stop_drop") {
    const targetAngle = lander.velocity.x > 0 ? -Math.PI / 2 : Math.PI / 2;
    let targetThrust: number;

    if (Math.abs(lander.velocity.x) > 20) {
      targetThrust = 0.9;
    } else if (Math.abs(lander.velocity.x) > 10) {
      targetThrust = 0.7;
    } else {
      targetThrust = 0.5;
    }

    return { targetAngle, targetThrust };
  } else {
    // Boostback approach
    const horizontalDecel = config.maxThrust * 0.9;
    const currentSpeed = Math.abs(lander.velocity.x);
    const stoppingDistance =
      (currentSpeed * currentSpeed) / (2 * horizontalDecel);
    const distanceToTarget = Math.abs(horizontalError);
    const brakeMargin = currentSpeed * 1.0 + 100;

    if (stoppingDistance + brakeMargin >= distanceToTarget) {
      const targetAngle = lander.velocity.x > 0 ? -Math.PI / 2 : Math.PI / 2;
      const urgency =
        (stoppingDistance + currentSpeed) / Math.max(distanceToTarget, 1);

      let targetThrust: number;
      if (urgency > 1.0) targetThrust = 1.0;
      else if (urgency > 0.8) targetThrust = 0.9;
      else if (urgency > 0.6) targetThrust = 0.75;
      else targetThrust = 0.5;

      return { targetAngle, targetThrust };
    }

    return { targetAngle: 0, targetThrust: 0 };
  }
}

function computeCoastCommands(
  lander: LanderState,
  config: GameConfig,
  altitude: number,
  padCenter: number,
): { targetAngle: number; targetThrust: number } {
  const timeToGround =
    altitude > 0 && lander.velocity.y > 0 ? altitude / lander.velocity.y : 10;
  const predictedLandingX =
    lander.position.x + lander.velocity.x * timeToGround;

  const predictedError = calculateHorizontalError(
    predictedLandingX,
    padCenter,
    config.width,
  );
  const directError = calculateHorizontalError(
    lander.position.x,
    padCenter,
    config.width,
  );

  const altBlend = Math.min(1, altitude / 200);
  const effectiveError =
    predictedError * altBlend + directError * (1 - altBlend);

  const positionTerm = effectiveError * 0.005;
  const velocityTerm = -lander.velocity.x * 0.02;
  const maxTilt = Math.abs(effectiveError) > 100 ? 0.35 : 0.25;
  const targetAngle = Math.max(
    -maxTilt,
    Math.min(maxTilt, positionTerm + velocityTerm),
  );

  const needsCorrection =
    Math.abs(lander.velocity.x) > 8 || Math.abs(effectiveError) > 30;
  const alignedForCorrection = Math.abs(lander.rotation - targetAngle) < 0.12;

  let targetThrust = 0;
  if (needsCorrection && alignedForCorrection) {
    targetThrust = Math.min(
      0.5,
      Math.abs(effectiveError) * 0.003 + Math.abs(lander.velocity.x) * 0.02,
    );
  }

  return { targetAngle, targetThrust };
}

function computeTerminalBurnCommands(
  lander: LanderState,
  config: GameConfig,
  altitude: number,
  padCenter: number,
): { targetAngle: number; targetThrust: number } {
  const netDecel = config.maxThrust - config.gravity;
  const timeToZeroVelocity = lander.velocity.y / netDecel;
  const stopDistance = (lander.velocity.y * timeToZeroVelocity) / 2;
  const timeToGround = lander.velocity.y > 0 ? altitude / lander.velocity.y : 5;

  const avgVelocityDuringBurn = lander.velocity.x * 0.5;
  const predictedLandingX =
    lander.position.x + avgVelocityDuringBurn * timeToGround;

  const directError = calculateHorizontalError(
    lander.position.x,
    padCenter,
    config.width,
  );
  const predictedError = calculateHorizontalError(
    predictedLandingX,
    padCenter,
    config.width,
  );

  const altitudeFactor = Math.min(1, altitude / 100);
  const positionTerm = directError * 0.008 * (1 - altitudeFactor * 0.5);
  const predictionTerm = predictedError * 0.004 * altitudeFactor;
  const velocityTerm = -lander.velocity.x * 0.035;
  const targetAngle = Math.max(
    -0.25,
    Math.min(0.25, positionTerm + predictionTerm + velocityTerm),
  );

  let targetThrust: number;
  if (stopDistance > altitude * 0.9) {
    targetThrust = 1.0;
  } else if (stopDistance > altitude * 0.6) {
    targetThrust = 0.85;
  } else if (lander.velocity.y > 10) {
    targetThrust = 0.6;
  } else if (lander.velocity.y > 5) {
    targetThrust = 0.4;
  } else {
    targetThrust = config.gravity / config.maxThrust;
  }

  return { targetAngle, targetThrust };
}

function computeTouchdownCommands(lander: LanderState): {
  targetAngle: number;
  targetThrust: number;
} {
  let targetThrust: number;
  if (lander.velocity.y > 3) {
    targetThrust = 0.5;
  } else if (lander.velocity.y > 1) {
    targetThrust = 0.3;
  } else {
    targetThrust = 0;
  }

  return { targetAngle: 0, targetThrust };
}

/**
 * Apply safety overrides to thrust command
 */
function applySafetyOverrides(
  thrust: number,
  verticalVelocity: number,
  altitude: number,
): number {
  // Emergency brake if falling too fast
  if (verticalVelocity > 40 && altitude < 200) {
    return 1.0;
  }

  // Emergency brake if very low and still descending
  if (altitude < 20 && verticalVelocity > 8) {
    return 1.0;
  }

  return thrust;
}

// ============================================
// ABORT SYSTEM FUNCTIONS
// ============================================

/**
 * Trigger abort from normal descent
 *
 * This is called when the player (or an auto-abort event) triggers an abort.
 * It assesses the situation and transitions to the appropriate abort phase.
 *
 * @param state - GNC state to modify
 * @param lander - Current lander state
 * @param pads - Available landing pads
 * @param config - Game configuration
 * @param terrain - Terrain for calculations
 * @returns true if abort was initiated, false if not possible
 */
export function triggerAbort(
  state: GNCState,
  lander: LanderState,
  pads: LandingPad[],
  config: GameConfig,
  terrain: TerrainPoint[],
): boolean {
  // Can't abort if already in abort or already landed
  if (isAbortPhase(state.phase) || state.phase === "touchdown") {
    return false;
  }

  const altitude = getAltitude(lander.position, terrain, config.width);

  // Assess abort options
  const assessment = assessAbortOptions(lander, pads, config, terrain);

  // Initialize abort state
  initializeAbort(state, lander, altitude, assessment);

  return true;
}

/**
 * Handle abort phases
 *
 * Routes to the appropriate abort execution function based on current phase.
 *
 * @param lander - Current lander state
 * @param terrain - Terrain
 * @param pads - Landing pads
 * @param config - Game configuration
 * @param state - GNC state
 * @param gains - Autopilot gains
 * @returns Command and updated state
 */
function handleAbortPhase(
  lander: LanderState,
  terrain: TerrainPoint[],
  pads: LandingPad[],
  config: GameConfig,
  state: GNCState,
  gains: AutopilotGains,
): { command: AutopilotCommand; newState: GNCState } {
  let command: AutopilotCommand;

  switch (state.phase) {
    case "abort_assess":
      // Quick assessment phase - should transition immediately
      // This handles the case where we need to re-assess mid-abort
      const assessment = assessAbortOptions(lander, pads, config, terrain);
      const altitude = getAltitude(lander.position, terrain, config.width);
      initializeAbort(state, lander, altitude, assessment);
      // Fall through to execute the chosen abort type
      return handleAbortPhase(lander, terrain, pads, config, state, gains);

    case "abort_to_orbit":
      command = executeAbortToOrbit(lander, state, config, terrain);

      // Check if orbit achieved and reoriented - if so, reset to orbit_wait
      const orbitAchieved = isOrbitAchieved(lander, state, config, terrain);

      // Debug: Log reorient progress
      if (state.abortToOrbitSubPhase === "reorient") {
        const retrogradeAngle = -Math.PI / 2;
        let rotationError = lander.rotation - retrogradeAngle;
        while (rotationError > Math.PI) rotationError -= 2 * Math.PI;
        while (rotationError < -Math.PI) rotationError += 2 * Math.PI;

        console.log("[Abort] Reorient check:", {
          rotation: (lander.rotation * 180 / Math.PI).toFixed(1) + "°",
          targetRotation: "-90°",
          rotationError: (rotationError * 180 / Math.PI).toFixed(1) + "°",
          angularVelocity: lander.angularVelocity.toFixed(2),
          isAligned: Math.abs(rotationError) < 0.1,
          isStable: Math.abs(lander.angularVelocity) < 0.5,
          orbitAchieved,
        });
      }

      if (orbitAchieved) {
        console.log("[Abort] ORBIT ACHIEVED & ORIENTED! Transitioning to orbit_wait");
        resetAbortState(state);
        state.phase = "orbit_wait";
        state.targetPadLocked = false;
        state.deorbitBurnComplete = false;
        state.solution = null;
      }
      break;

    case "abort_retarget":
      // Abort retarget: Emergency pad is already set as target
      // Transition immediately to normal GNC landing (coast phase)
      // The autopilot will execute a normal landing approach to the emergency pad
      // Player stays locked out until landing is complete
      console.log("[Abort] Retarget: transitioning to normal landing on emergency pad", state.emergencyPadIndex);
      state.phase = "coast";
      // Keep abort state intact so we know this is an abort landing
      // (don't call resetAbortState - we need to track this was an abort)
      // Fall through to coast handling below (will be handled next frame)
      command = { thrust: 0, rotation: 0 };
      break;

    case "abort_brace":
      command = executeAbortBrace(lander, config);
      break;

    default:
      // Shouldn't reach here, but provide safe default
      command = { thrust: 0, rotation: 0 };
  }

  // Apply attitude control gains
  const rotationCommand =
    gains.attitude.kp * command.rotation -
    gains.attitude.kd * lander.angularVelocity * 0.5;
  const finalRotation = Math.max(-1, Math.min(1, rotationCommand));

  return {
    command: {
      thrust: command.thrust,
      rotation: finalRotation,
    },
    newState: state,
  };
}

/**
 * Check if abort is currently possible
 *
 * Abort is possible when:
 * - Not already in an abort phase
 * - Not on the ground (touchdown)
 * - Have some fuel remaining
 */
export function canTriggerAbort(state: GNCState, lander: LanderState): boolean {
  if (isAbortPhase(state.phase)) return false;
  if (state.phase === "touchdown") return false;
  if (lander.fuel <= 0) return false;
  return true;
}

/**
 * Check if player controls should be locked due to abort
 *
 * During abort, player controls should be locked until:
 * - Orbit is achieved (abort_to_orbit) - then controls unlocked, player resumes
 * - Landing is complete (abort_retarget or abort_brace) - locked throughout landing
 *
 * For abort_retarget, controls stay locked even after transitioning to normal
 * landing phases (coast, terminal_burn, touchdown) because it's an emergency landing.
 */
export function areControlsLockedForAbort(state: GNCState): boolean {
  // Locked during explicit abort phases
  if (isAbortPhase(state.phase)) {
    return true;
  }

  // Also locked if this is an abort-initiated landing
  // (abortDecision is "retarget" or "brace" means we're in emergency landing mode)
  if (state.abortDecision === "retarget" || state.abortDecision === "brace") {
    return true;
  }

  return false;
}
