/**
 * Autopilot Type Definitions
 *
 * Core interfaces and types used across the autopilot system.
 */

import type { LandingPad, PadViability } from "../types";
import type { TwoBurnSolution, GuidanceState } from "../trajectory";

/**
 * GNC Autopilot Phase
 * Represents the current state in the landing state machine
 *
 * Normal descent phases:
 *   orbit_wait → orbit_align → deorbit_burn → coast → terminal_burn → touchdown
 *
 * Abort phases (entered when abort triggered):
 *   abort_assess → (abort_to_orbit | abort_retarget | abort_brace)
 */
export type GNCPhase =
  // Normal descent phases
  | "orbit_wait"
  | "orbit_align"
  | "deorbit_burn"
  | "coast"
  | "terminal_burn"
  | "touchdown"
  // Abort phases
  | "abort_assess"    // Calculating best abort option (orbit vs emergency land vs brace)
  | "abort_to_orbit"  // Executing return to orbit maneuver
  | "abort_retarget"  // Redirecting to best available emergency pad
  | "abort_brace";    // Minimizing crash damage (insufficient fuel for other options)

/**
 * Abort decision made during abort_assess phase
 */
export type AbortDecision = "orbit" | "retarget" | "brace" | null;

/**
 * Sub-phase for abort_to_orbit maneuver
 * The orbit abort is a multi-step sequence:
 * 1. arrest_descent - Full thrust to stop downward velocity
 * 2. prograde_burn - Build horizontal velocity toward orbit
 * 3. coast_to_apoapsis - Engine off, coast to highest point
 * 4. circularize - Small burn to achieve stable orbit
 * 5. reorient - Rotate to retrograde stance (orbital position)
 */
export type AbortToOrbitSubPhase =
  | "arrest_descent"
  | "prograde_burn"
  | "coast_to_apoapsis"
  | "circularize"
  | "reorient";

/**
 * GNC Autopilot state - persists across frames
 *
 * This state object tracks the autopilot's progress through the landing
 * sequence and is updated each frame by computeGNCAutopilot.
 */
export interface GNCState {
  /** Current autopilot phase in the landing state machine */
  phase: GNCPhase;

  /** Computed two-burn trajectory solution (recalculated periodically) */
  solution: TwoBurnSolution | null;

  /** Frames since last solution update */
  solutionAge: number;

  /** Index of the target landing pad */
  targetPadIndex: number;

  /** Whether the target pad is locked (committed to landing) */
  targetPadLocked: boolean;

  /** Whether the locked pad is still reachable */
  lockedPadViable: boolean;

  /** Whether the deorbit burn has completed */
  deorbitBurnComplete: boolean;

  /** X position where deorbit burn should begin (locked when target selected) */
  lockedDeorbitX: number | null;

  /** Game time when deorbit burn started (null if not started) */
  deorbitBurnStartTime: number | null;

  /** Delta time from optimal deorbit point when burn actually started (+ = late, - = early) */
  deorbitTimingDelta: number | null;

  /** Whether terminal burn has been initiated */
  terminalBurnStarted: boolean;

  /** Last computed guidance state for telemetry/debugging */
  lastGuidance: GuidanceState | null;

  // ========== Abort State ==========

  /** Decision made during abort_assess: which abort strategy to use */
  abortDecision: AbortDecision;

  /** Current sub-phase for abort_to_orbit maneuver */
  abortToOrbitSubPhase: AbortToOrbitSubPhase | null;

  /** Target emergency pad index for abort_retarget */
  emergencyPadIndex: number | null;

  /** Altitude when abort was initiated (for telemetry) */
  abortStartAltitude: number | null;

  /** Fuel remaining when abort was initiated (for telemetry) */
  abortStartFuel: number | null;

  /** Velocity when abort was initiated (for telemetry) */
  abortStartVelocity: { vx: number; vy: number } | null;

  /** Original target pad before abort (for telemetry) */
  originalPadIndex: number | null;

  /** Flag set when orbit is stabilized during abort_to_orbit (triggers gravity disable) */
  orbitStabilized?: boolean;
}

/**
 * Result of landing cone analysis
 *
 * Contains information about which pads are reachable from the current
 * position and velocity, used for target selection and visualization.
 */
export interface LandingConeResult {
  /** The selected target pad */
  selected: {
    pad: LandingPad;
    index: number;
    viable: boolean;
  };

  /** Indices of all pads within the reachable landing cone */
  cone: number[];

  /** Minimum forward distance for the landing cone (px) */
  minForwardDistance: number;

  /** Maximum forward distance for the landing cone (px) */
  maxForwardDistance: number;
}

/**
 * Result of pad viability simulation
 */
export interface PadSimulationResult {
  /** Whether the pad can be successfully landed on */
  viable: boolean;

  /** Estimated fuel cost to reach this pad */
  fuelCost: number;
}
