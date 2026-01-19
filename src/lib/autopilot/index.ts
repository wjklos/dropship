/**
 * Autopilot Module
 *
 * Re-exports all autopilot functionality for backward compatibility.
 * Import from this file to get all autopilot functions and types.
 *
 * Module Structure:
 * - types.ts: GNCState, LandingConeResult, and related interfaces
 * - gains.ts: PD controller gains and descent rate calculations
 * - basic.ts: Legacy staccato autopilot, stabilize, abort maneuvers
 * - gnc.ts: GNC state machine autopilot (primary landing system)
 * - targeting.ts: Pad selection, viability evaluation, landing cone
 */

// Types
export type { GNCState, GNCPhase, LandingConeResult, PadSimulationResult } from "./types";

// Gains and control parameters
export { DEFAULT_GAINS, getTargetDescentRate, getHoverThrust, getGravityFactor } from "./gains";

// Basic autopilot functions
export {
  computeAutopilot,
  computeOrbitalAutopilot,
  computeAbortManeuver,
  computeStabilizeOnly,
  shouldDisengage,
} from "./basic";

// GNC autopilot (primary system)
export {
  createGNCState,
  computeGNCAutopilot,
  triggerAbort,
  canTriggerAbort,
  areControlsLockedForAbort,
} from "./gnc";

// Targeting and pad selection
export {
  simulateTrajectoryToPad,
  evaluateAllPads,
  selectTargetPad,
  selectTargetPadWithCone,
} from "./targeting";
