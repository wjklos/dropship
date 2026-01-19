/**
 * Autopilot System
 *
 * This file re-exports all autopilot functionality from the modular
 * autopilot/ directory for backward compatibility.
 *
 * The autopilot has been split into smaller, focused modules:
 * - autopilot/types.ts: Type definitions (GNCState, LandingConeResult)
 * - autopilot/gains.ts: PD controller gains and descent rates
 * - autopilot/basic.ts: Legacy staccato autopilot, stabilize, abort
 * - autopilot/gnc.ts: GNC state machine (primary landing system)
 * - autopilot/targeting.ts: Pad selection and viability evaluation
 *
 * For new code, prefer importing directly from 'autopilot/index'
 * or specific submodules for better tree-shaking.
 */

// Re-export everything from the autopilot module
export {
  // Types
  type GNCState,
  type GNCPhase,
  type LandingConeResult,
  type PadSimulationResult,

  // Gains
  DEFAULT_GAINS,
  getTargetDescentRate,
  getHoverThrust,
  getGravityFactor,

  // Basic autopilot
  computeAutopilot,
  computeOrbitalAutopilot,
  computeAbortManeuver,
  computeStabilizeOnly,
  shouldDisengage,

  // GNC autopilot
  createGNCState,
  computeGNCAutopilot,
  triggerAbort,
  canTriggerAbort,
  areControlsLockedForAbort,

  // Targeting
  simulateTrajectoryToPad,
  evaluateAllPads,
  selectTargetPad,
  selectTargetPadWithCone,
} from "./autopilot/index";
