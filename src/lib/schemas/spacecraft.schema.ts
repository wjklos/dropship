/**
 * Spacecraft/Lander JSON Schema
 *
 * Defines the structure for configurable spacecraft and landers.
 * Different missions and worlds may require different vehicle capabilities.
 *
 * Design Goals:
 * - Modular spacecraft with swappable components
 * - Different landers for different environments (Moon vs Mars vs asteroid)
 * - Visual customization (shape, colors, decals)
 * - Performance characteristics (thrust, fuel, mass)
 * - Structural properties (durability, landing gear)
 */

/**
 * Engine configuration
 */
export interface EngineConfig {
  /** Engine type identifier */
  type: "bipropellant" | "monopropellant" | "ion" | "aerospike" | "nuclear";

  /** Maximum thrust output (px/s² acceleration at empty mass) */
  maxThrust: number;

  /** Specific impulse (efficiency) - higher = more efficient */
  specificImpulse: number;

  /** Throttle range - min to max (e.g., [0.1, 1.0] for 10-100%) */
  throttleRange: [number, number];

  /** Can this engine be restarted after shutdown? */
  restartable: boolean;

  /** Number of restarts allowed (-1 for unlimited) */
  maxRestarts: number;

  /** Flame/exhaust color */
  flameColor: string;

  /** Flame length at full thrust (px) */
  flameLength: number;
}

/**
 * Fuel/propellant configuration
 */
export interface FuelConfig {
  /** Fuel type */
  type: "hydrazine" | "lox_lh2" | "lox_rp1" | "xenon" | "methane";

  /** Maximum fuel capacity (units) */
  capacity: number;

  /** Consumption rate at full thrust (units/s) */
  consumptionRate: number;

  /** Mass per unit of fuel (affects handling) */
  massPerUnit: number;
}

/**
 * Reaction Control System (RCS) for attitude control
 */
export interface RCSConfig {
  /** Rotation acceleration (rad/s²) */
  rotationAcceleration: number;

  /** Does RCS consume fuel? */
  consumesFuel: boolean;

  /** RCS fuel consumption rate (units/s when active) */
  fuelConsumption: number;

  /** Thruster locations for visual effects */
  thrusterPositions: Array<{
    x: number;
    y: number;
    direction: "up" | "down" | "left" | "right";
  }>;
}

/**
 * Landing gear configuration
 */
export interface LandingGearConfig {
  /** Number of landing legs */
  legCount: number;

  /** Distance from center to each leg (px) */
  legSpan: number;

  /** Leg height (px) */
  legHeight: number;

  /** Maximum impact velocity legs can absorb (px/s) */
  maxImpactVelocity: number;

  /** Can gear be retracted? */
  retractable: boolean;

  /** Shock absorption factor (0-1, higher = more forgiving) */
  shockAbsorption: number;

  /** Material affects durability and mass */
  material: "aluminum" | "titanium" | "carbon_composite";
}

/**
 * Structural properties
 */
export interface StructureConfig {
  /** Dry mass (without fuel) in arbitrary units */
  dryMass: number;

  /** Structural integrity (1-10, affects crash tolerance) */
  integrity: number;

  /** Heat resistance (for atmospheric entry) */
  heatResistance: number;

  /** Does this craft have a heat shield? */
  hasHeatShield: boolean;

  /** Heat shield ablation rate (if applicable) */
  heatShieldAblationRate?: number;

  /** Can survive off-pad landing with damage? */
  survivableCrashVelocity: number;
}

/**
 * Visual representation
 */
export interface SpacecraftVisuals {
  /** SVG path data for the spacecraft body */
  bodyPath: string;

  /** SVG paths for additional details (windows, panels, etc.) */
  detailPaths: string[];

  /** Primary hull color */
  primaryColor: string;

  /** Secondary/accent color */
  secondaryColor: string;

  /** Engine bell color */
  engineColor: string;

  /** Scale factor (1.0 = standard size) */
  scale: number;

  /** Glow filter intensity (0-1) */
  glowIntensity: number;

  /** Decal/marking configuration */
  decals?: Array<{
    type: "text" | "flag" | "logo";
    content: string;
    position: { x: number; y: number };
    scale: number;
  }>;
}

/**
 * Sensor and avionics configuration
 */
export interface AvionicsConfig {
  /** Radar altimeter range (px) */
  altimeterRange: number;

  /** Terrain mapping capability */
  hasTerrainMapping: boolean;

  /** Autopilot capability level (0-3) */
  autopilotLevel: number;

  /** Guidance computer precision modifier */
  guidancePrecision: number;

  /** Communication range (for multiplayer/mission control) */
  commRange: number;
}

/**
 * Special capabilities
 */
export interface SpecialCapabilities {
  /** Can hover indefinitely (unlimited fuel in hover mode) */
  hoverMode: boolean;

  /** Abort system - emergency ascent capability */
  abortSystem: boolean;

  /** Abort system thrust multiplier */
  abortThrustMultiplier?: number;

  /** Cargo capacity (for future mission types) */
  cargoCapacity: number;

  /** Docking capability */
  canDock: boolean;

  /** Aerial refueling capability */
  canRefuel: boolean;

  /** VTOL capability (for winged craft) */
  vtol: boolean;
}

/**
 * Complete spacecraft configuration
 */
export interface SpacecraftConfig {
  /** Unique identifier */
  id: string;

  /** Display name */
  name: string;

  /** Short description */
  description: string;

  /** Spacecraft class */
  class: "lander" | "shuttle" | "capsule" | "hopper" | "cargo";

  /** Which worlds is this craft designed for? */
  compatibleWorlds: string[];

  /** Engine configuration */
  engine: EngineConfig;

  /** Fuel configuration */
  fuel: FuelConfig;

  /** Reaction control system */
  rcs: RCSConfig;

  /** Landing gear */
  landingGear: LandingGearConfig;

  /** Structural properties */
  structure: StructureConfig;

  /** Visual appearance */
  visuals: SpacecraftVisuals;

  /** Avionics and sensors */
  avionics: AvionicsConfig;

  /** Special capabilities */
  capabilities: SpecialCapabilities;

  /** Autopilot gain modifiers (multiplied with world gains) */
  autopilotModifiers: {
    attitude: number;
    horizontal: number;
    vertical: number;
  };

  /** Is this craft unlocked by default? */
  unlockedByDefault: boolean;

  /** Unlock requirements */
  unlockRequirements?: {
    landingsRequired?: number;
    perfectLandings?: number;
    worldsCompleted?: string[];
  };
}

/**
 * Example spacecraft configurations
 */
export const EXAMPLE_SPACECRAFT: Record<string, SpacecraftConfig> = {
  apollo_lm: {
    id: "apollo_lm",
    name: "Apollo LM",
    description: "Classic Lunar Module design. Reliable and well-balanced for Moon operations.",
    class: "lander",
    compatibleWorlds: ["moon", "ceres"],
    engine: {
      type: "bipropellant",
      maxThrust: 60,
      specificImpulse: 311,
      throttleRange: [0.1, 1.0],
      restartable: true,
      maxRestarts: -1,
      flameColor: "#ffaa00",
      flameLength: 25,
    },
    fuel: {
      type: "hydrazine",
      capacity: 100,
      consumptionRate: 8,
      massPerUnit: 0.1,
    },
    rcs: {
      rotationAcceleration: 4,
      consumesFuel: false,
      fuelConsumption: 0,
      thrusterPositions: [
        { x: -15, y: -10, direction: "left" },
        { x: 15, y: -10, direction: "right" },
        { x: -15, y: 10, direction: "right" },
        { x: 15, y: 10, direction: "left" },
      ],
    },
    landingGear: {
      legCount: 4,
      legSpan: 20,
      legHeight: 15,
      maxImpactVelocity: 15,
      retractable: false,
      shockAbsorption: 0.7,
      material: "aluminum",
    },
    structure: {
      dryMass: 50,
      integrity: 5,
      heatResistance: 2,
      hasHeatShield: false,
      survivableCrashVelocity: 20,
    },
    visuals: {
      bodyPath: "M 0 -12 L 12 -4 L 12 8 L 6 15 L -6 15 L -12 8 L -12 -4 Z",
      detailPaths: [
        "M -6 15 L -8 20 L -5 15", // Left leg
        "M 6 15 L 8 20 L 5 15",   // Right leg
        "M -4 -4 L 4 -4 L 4 2 L -4 2 Z", // Window
      ],
      primaryColor: "#c0c0c0",
      secondaryColor: "#808080",
      engineColor: "#404040",
      scale: 1.0,
      glowIntensity: 0.6,
    },
    avionics: {
      altimeterRange: 1000,
      hasTerrainMapping: false,
      autopilotLevel: 2,
      guidancePrecision: 1.0,
      commRange: 5000,
    },
    capabilities: {
      hoverMode: false,
      abortSystem: true,
      abortThrustMultiplier: 1.5,
      cargoCapacity: 0,
      canDock: true,
      canRefuel: false,
      vtol: false,
    },
    autopilotModifiers: {
      attitude: 1.0,
      horizontal: 1.0,
      vertical: 1.0,
    },
    unlockedByDefault: true,
  },

  mars_lander: {
    id: "mars_lander",
    name: "Mars Descent Vehicle",
    description: "Heavy-duty lander with heat shield and enhanced thrust for Mars operations.",
    class: "lander",
    compatibleWorlds: ["mars"],
    engine: {
      type: "bipropellant",
      maxThrust: 80,
      specificImpulse: 340,
      throttleRange: [0.2, 1.0],
      restartable: true,
      maxRestarts: 3,
      flameColor: "#ff6600",
      flameLength: 30,
    },
    fuel: {
      type: "lox_lh2",
      capacity: 120,
      consumptionRate: 10,
      massPerUnit: 0.08,
    },
    rcs: {
      rotationAcceleration: 3.5,
      consumesFuel: true,
      fuelConsumption: 0.5,
      thrusterPositions: [
        { x: -18, y: -8, direction: "left" },
        { x: 18, y: -8, direction: "right" },
        { x: -18, y: 8, direction: "right" },
        { x: 18, y: 8, direction: "left" },
      ],
    },
    landingGear: {
      legCount: 4,
      legSpan: 25,
      legHeight: 18,
      maxImpactVelocity: 12,
      retractable: false,
      shockAbsorption: 0.8,
      material: "titanium",
    },
    structure: {
      dryMass: 70,
      integrity: 7,
      heatResistance: 8,
      hasHeatShield: true,
      heatShieldAblationRate: 0.1,
      survivableCrashVelocity: 15,
    },
    visuals: {
      bodyPath: "M 0 -15 L 15 -5 L 15 10 L 8 18 L -8 18 L -15 10 L -15 -5 Z",
      detailPaths: [
        "M -8 18 L -12 25 L -6 18",
        "M 8 18 L 12 25 L 6 18",
        "M -5 -8 L 5 -8 L 5 0 L -5 0 Z",
        "M -15 -5 A 20 20 0 0 1 15 -5", // Heat shield arc
      ],
      primaryColor: "#d4a574",
      secondaryColor: "#8b6914",
      engineColor: "#2a2a2a",
      scale: 1.2,
      glowIntensity: 0.7,
    },
    avionics: {
      altimeterRange: 1500,
      hasTerrainMapping: true,
      autopilotLevel: 3,
      guidancePrecision: 1.2,
      commRange: 10000,
    },
    capabilities: {
      hoverMode: false,
      abortSystem: true,
      abortThrustMultiplier: 1.8,
      cargoCapacity: 50,
      canDock: false,
      canRefuel: false,
      vtol: false,
    },
    autopilotModifiers: {
      attitude: 1.1,
      horizontal: 1.0,
      vertical: 1.2,
    },
    unlockedByDefault: true,
  },

  asteroid_hopper: {
    id: "asteroid_hopper",
    name: "Asteroid Hopper",
    description: "Lightweight craft optimized for low-gravity asteroid operations.",
    class: "hopper",
    compatibleWorlds: ["asteroid_belt", "ceres"],
    engine: {
      type: "monopropellant",
      maxThrust: 30,
      specificImpulse: 220,
      throttleRange: [0.05, 1.0],
      restartable: true,
      maxRestarts: -1,
      flameColor: "#88ff88",
      flameLength: 15,
    },
    fuel: {
      type: "hydrazine",
      capacity: 80,
      consumptionRate: 5,
      massPerUnit: 0.05,
    },
    rcs: {
      rotationAcceleration: 6,
      consumesFuel: true,
      fuelConsumption: 0.2,
      thrusterPositions: [
        { x: -10, y: -5, direction: "left" },
        { x: 10, y: -5, direction: "right" },
        { x: 0, y: -10, direction: "up" },
        { x: 0, y: 10, direction: "down" },
      ],
    },
    landingGear: {
      legCount: 3,
      legSpan: 15,
      legHeight: 12,
      maxImpactVelocity: 25,
      retractable: true,
      shockAbsorption: 0.9,
      material: "carbon_composite",
    },
    structure: {
      dryMass: 20,
      integrity: 4,
      heatResistance: 1,
      hasHeatShield: false,
      survivableCrashVelocity: 30,
    },
    visuals: {
      bodyPath: "M 0 -8 L 8 0 L 8 8 L 0 12 L -8 8 L -8 0 Z",
      detailPaths: [
        "M -5 8 L -7 14 L -3 8",
        "M 5 8 L 7 14 L 3 8",
        "M 0 8 L 0 14",
        "M -3 -3 L 3 -3 L 3 3 L -3 3 Z",
      ],
      primaryColor: "#e0e0e0",
      secondaryColor: "#a0a0a0",
      engineColor: "#505050",
      scale: 0.8,
      glowIntensity: 0.5,
    },
    avionics: {
      altimeterRange: 500,
      hasTerrainMapping: true,
      autopilotLevel: 3,
      guidancePrecision: 1.5,
      commRange: 2000,
    },
    capabilities: {
      hoverMode: true,
      abortSystem: false,
      cargoCapacity: 10,
      canDock: true,
      canRefuel: true,
      vtol: false,
    },
    autopilotModifiers: {
      attitude: 0.8,
      horizontal: 0.7,
      vertical: 0.8,
    },
    unlockedByDefault: false,
    unlockRequirements: {
      landingsRequired: 15,
      worldsCompleted: ["moon", "ceres"],
    },
  },
};

/**
 * JSON Schema for validation
 */
export const SPACECRAFT_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["id", "name", "class", "compatibleWorlds", "engine", "fuel", "rcs", "landingGear", "structure", "visuals", "avionics", "capabilities"],
  properties: {
    id: { type: "string", pattern: "^[a-z_]+$" },
    name: { type: "string", maxLength: 50 },
    description: { type: "string", maxLength: 200 },
    class: { type: "string", enum: ["lander", "shuttle", "capsule", "hopper", "cargo"] },
    compatibleWorlds: { type: "array", items: { type: "string" } },
    engine: {
      type: "object",
      required: ["type", "maxThrust", "specificImpulse", "throttleRange", "restartable", "flameColor", "flameLength"],
    },
    fuel: {
      type: "object",
      required: ["type", "capacity", "consumptionRate", "massPerUnit"],
    },
    landingGear: {
      type: "object",
      required: ["legCount", "legSpan", "legHeight", "maxImpactVelocity"],
    },
    structure: {
      type: "object",
      required: ["dryMass", "integrity", "heatResistance"],
    },
    visuals: {
      type: "object",
      required: ["bodyPath", "primaryColor", "secondaryColor", "scale"],
    },
    unlockedByDefault: { type: "boolean" },
  },
};
