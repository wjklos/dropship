import type { WorldId } from "./worlds";

// Vector 2D
export interface Vec2 {
  x: number;
  y: number;
}

// Failure reasons for crash analysis
export type FailureReason =
  | "VELOCITY_HIGH"
  | "ANGLE_BAD"
  | "OFF_PAD"
  | "OUT_OF_FUEL"
  | "DAMAGED"
  | null;

// Landing outcome (more granular than boolean)
export type LandingOutcome = "success" | "damaged" | "crashed";

// Game phase for orbital mechanics
export type GamePhase = "orbit" | "descent" | "abort" | "landed" | "crashed";

// Lander state
export interface LanderState {
  position: Vec2;
  velocity: Vec2;
  rotation: number; // radians, 0 = pointing up
  angularVelocity: number;
  fuel: number;
  thrust: number; // 0-1 current thrust level
  alive: boolean;
  landed: boolean;
  // Orbital mechanics
  hasBurned: boolean; // True after first thrust (gravity activates)
  // Landing outcome tracking
  outcome: LandingOutcome | null;
  failureReason: FailureReason;
  // G-force tracking
  currentGs: number; // Current G-force being experienced
  maxGs: number; // Maximum G-force experienced during flight
}

// Terrain point
export interface TerrainPoint {
  x: number;
  y: number;
}

// Landing pad with difficulty multiplier
export interface LandingPad {
  x1: number;
  x2: number;
  y: number;
  multiplier: 1 | 2 | 3 | 4 | 5; // Difficulty/reward multiplier (1=easy, 5=hard)
  occupied: boolean; // If true, a rocket is on this pad - cannot land here
  designation: string; // Pad designation within region (e.g., "A", "B", "C")
}

// Viability status for each pad
export interface PadViability {
  padIndex: number;
  viable: boolean;
  estimatedFuelCost: number;
  distance: number;
}

// Game configuration
export interface GameConfig {
  width: number;
  height: number;
  gravity: number;
  maxThrust: number;
  rotationSpeed: number;
  fuelConsumption: number;
  maxLandingVelocity: number;
  maxLandingAngle: number; // radians
  // World and physics
  worldId: WorldId;
  legSpan: number; // Distance from center to each leg (20px)
  // Orbital parameters
  orbitalAltitude: number;
  orbitalVelocity: number;
}

// Collision result with detailed outcome
export interface CollisionResult {
  collision: boolean;
  outcome: LandingOutcome | null;
  landedPadIndex: number | null;
  crashedPadIndex: number | null; // Set when crashing into an occupied pad
  terrainY: number;
  failureReason: FailureReason;
}

// Zoom level configuration
export interface ZoomLevel {
  altitudeThreshold: number; // Altitude above which this zoom applies
  scale: number; // Zoom multiplier
  viewHeight: number; // Visible world height at this zoom
}

// Failure statistics for demo mode analysis
export interface FailureStats {
  VELOCITY_HIGH: number;
  ANGLE_BAD: number;
  OFF_PAD: number;
  OUT_OF_FUEL: number;
  DAMAGED: number;
}

// Input state
export interface InputState {
  thrust: boolean;
  rotateLeft: boolean;
  rotateRight: boolean;
}

// Autopilot mode
export type AutopilotMode = "off" | "stabilize" | "land" | "demo";

// Approach mode for GNC autopilot
// - "stop_drop": Stop, Drop, and Stick It - kill horizontal velocity early, drop vertically
// - "boostback": SpaceX-style - retain velocity, fly to target, precision landing
export type ApproachMode = "stop_drop" | "boostback";

// Autopilot state
export interface AutopilotState {
  mode: AutopilotMode;
  targetX: number;
  targetDescentRate: number;
}

// Complete game state
export interface GameState {
  lander: LanderState;
  terrain: TerrainPoint[];
  landingPad: LandingPad;
  config: GameConfig;
  input: InputState;
  autopilot: AutopilotState;
  time: number;
  score: number;
}

// Autopilot output commands
export interface AutopilotCommand {
  thrust: number; // 0-1
  rotation: number; // -1 to 1 (left/right)
}

// Wind band definition for atmospheric worlds
export interface WindBand {
  altitudeMin: number; // Lower bound (px from surface)
  altitudeMax: number; // Upper bound (px from surface)
  density: number; // Air density (0-1, affects drag)
  windSpeed: number; // Horizontal wind velocity (px/s, positive = right)
  turbulence: number; // Random variation factor (0-1)
  particleColor?: string; // Optional color for wind particles in this band
}

// Current wind effect at lander position
export interface WindEffect {
  density: number; // Air density at current altitude
  windX: number; // Horizontal wind (px/s)
  windY: number; // Vertical wind (px/s) - usually from turbulence
  dragX: number; // Drag force X component (px/s²)
  dragY: number; // Drag force Y component (px/s²)
  torque: number; // Attitude disturbance (rad/s²) - Mars wobble effect
}
