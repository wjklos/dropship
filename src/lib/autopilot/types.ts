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
 */
export type GNCPhase =
  | "orbit_wait"
  | "orbit_align"
  | "deorbit_burn"
  | "coast"
  | "terminal_burn"
  | "touchdown";

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
