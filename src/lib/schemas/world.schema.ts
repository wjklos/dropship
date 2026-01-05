/**
 * World/Planet JSON Schema
 *
 * Defines the structure for configurable planetary bodies.
 * These can be loaded from JSON files at runtime, enabling
 * easy addition of new worlds without code changes.
 *
 * Design Goals:
 * - All current world properties supported
 * - Atmospheric conditions (Mars heat shield, wind, etc.)
 * - Terrain characteristics (rockiness, surface type)
 * - Support for non-solid bodies (asteroid fields)
 * - Extensible for future features (weather, day/night, hazards)
 */

/**
 * Atmospheric properties
 * Defines air density, heating, wind, and sound propagation
 */
export interface AtmosphericConfig {
  /** Does this world have an atmosphere? */
  hasAtmosphere: boolean;

  /** Atmospheric density relative to Earth sea level (0 = vacuum, 1 = Earth) */
  density: number;

  /** Maximum wind speed in px/s (0 for no wind) */
  maxWindSpeed: number;

  /** Wind variability - how much wind speed/direction changes (0-1) */
  windVariability: number;

  /** Altitude below which atmospheric effects apply (px) */
  atmosphereTop: number;

  /** Entry heating - temperature factor for re-entry effects */
  entryHeating: {
    /** Does this world cause entry heating? */
    enabled: boolean;
    /** Velocity threshold for heating to begin (px/s) */
    velocityThreshold: number;
    /** Maximum heating intensity (0-1) */
    maxIntensity: number;
  };

  /** Sound propagation - for sonic boom effects */
  sound: {
    /** Speed of sound in atmosphere (px/s), 0 if no atmosphere */
    speedOfSound: number;
    /** Can sonic booms occur? */
    sonicBoomEnabled: boolean;
  };

  /** Dust/particle effects on landing */
  dust: {
    /** Does landing kick up dust? */
    enabled: boolean;
    /** Color of dust particles */
    color: string;
    /** How easily dust is disturbed (0-1) */
    intensity: number;
  };
}

/**
 * Terrain generation parameters
 */
export interface TerrainConfig {
  /** Does this world have a solid surface? */
  hasSurface: boolean;

  /** Base roughness for terrain generation (0-1, higher = more jagged) */
  roughness: number;

  /** Number of midpoint displacement iterations */
  iterations: number;

  /** Minimum number of landing pads to generate */
  minPads: number;

  /** Maximum number of landing pads to generate */
  maxPads: number;

  /** Minimum pad width in pixels */
  minPadWidth: number;

  /** Maximum pad width in pixels */
  maxPadWidth: number;

  /** Probability of a pad being occupied (0-1) */
  occupiedPadChance: number;

  /** Surface type affects visuals and landing behavior */
  surfaceType: "rock" | "regolith" | "ice" | "sand" | "metal";

  /** Can the lander survive landing off-pad (damaged state)? */
  allowDamagedLanding: boolean;

  /** Hazards present on the surface */
  hazards: {
    /** Rocky outcrops that damage lander */
    rocks: boolean;
    /** Craters with steep slopes */
    craters: boolean;
    /** Ice patches with reduced friction */
    ice: boolean;
  };
}

/**
 * Non-solid body configuration (asteroid fields, gas giants)
 */
export interface AsteroidFieldConfig {
  /** Number of asteroids in the field */
  asteroidCount: number;

  /** Minimum asteroid size (px) */
  minSize: number;

  /** Maximum asteroid size (px) */
  maxSize: number;

  /** Average velocity of asteroids (px/s) */
  avgVelocity: number;

  /** Velocity variance (px/s) */
  velocityVariance: number;

  /** Can asteroids be landed on? */
  landable: boolean;

  /** Rotation rate of asteroids (rad/s average) */
  rotationRate: number;
}

/**
 * Visual theming for the world
 */
export interface WorldColors {
  /** Primary UI color (HUD, lander outline) */
  primary: string;

  /** Secondary/dimmer accent color */
  secondary: string;

  /** Terrain fill color (supports rgba) */
  terrain: string;

  /** Terrain outline/stroke color */
  terrainStroke: string;

  /** Sky/background color */
  sky: string;

  /** Viable landing pad color */
  padViable: string;

  /** Non-viable landing pad color */
  padUnviable: string;

  /** Atmospheric glow color (for entry effects) */
  atmosphereGlow?: string;

  /** Dust/particle color */
  dustColor?: string;
}

/**
 * Autopilot tuning parameters
 * Different gravity/atmosphere requires different control gains
 */
export interface AutopilotGains {
  attitude: {
    /** Proportional gain for attitude control */
    kp: number;
    /** Derivative gain for attitude control */
    kd: number;
  };
  horizontal: {
    /** Proportional gain for horizontal position control */
    kp: number;
    /** Derivative gain for horizontal velocity control */
    kd: number;
  };
  vertical: {
    /** Proportional gain for vertical descent control */
    kp: number;
    /** Derivative gain for vertical velocity control */
    kd: number;
  };
}

/**
 * Physics parameters for the world
 */
export interface PhysicsConfig {
  /** Surface gravity in px/s² (game-scaled) */
  gravity: number;

  /** Real-world gravity in m/s² (for display) */
  realGravity: number;

  /** Horizontal velocity in orbit (px/s) */
  orbitalVelocity: number;

  /** Starting altitude above terrain baseline (px) */
  orbitalAltitude: number;

  /** Maximum thrust available (px/s²) */
  maxThrust: number;

  /** Fuel consumption rate (units/s at full thrust) */
  fuelConsumption: number;

  /** Safe landing velocity threshold (px/s) */
  maxLandingVelocity: number;

  /** Safe landing angle threshold (radians) */
  maxLandingAngle: number;

  /** Rotation speed (rad/s²) */
  rotationSpeed: number;

  /** Starting fuel amount */
  startingFuel: number;
}

/**
 * Complete world configuration
 */
export interface WorldConfig {
  /** Unique identifier for the world */
  id: string;

  /** Internal name (e.g., "LUNA") */
  name: string;

  /** Display name for UI (e.g., "Moon") */
  displayName: string;

  /** Brief description of the world */
  description: string;

  /** World type determines behavior */
  type: "solid" | "asteroid_field" | "gas_giant" | "station";

  /** Physics parameters */
  physics: PhysicsConfig;

  /** Visual theming */
  colors: WorldColors;

  /** Autopilot tuning */
  autopilotGains: AutopilotGains;

  /** Atmospheric properties (optional - vacuum by default) */
  atmosphere?: AtmosphericConfig;

  /** Terrain generation parameters (for solid worlds) */
  terrain?: TerrainConfig;

  /** Asteroid field configuration (for asteroid_field type) */
  asteroidField?: AsteroidFieldConfig;

  /** World size in pixels */
  dimensions: {
    width: number;
    height: number;
  };

  /** Difficulty rating (1-5) */
  difficulty: number;

  /** Is this world unlocked by default? */
  unlockedByDefault: boolean;

  /** Requirements to unlock this world */
  unlockRequirements?: {
    /** Number of successful landings on another world */
    landingsRequired?: number;
    /** Specific world that must be completed */
    prerequisiteWorld?: string;
  };
}

/**
 * Example world configurations in JSON format
 */
export const EXAMPLE_WORLDS: Record<string, WorldConfig> = {
  moon: {
    id: "moon",
    name: "LUNA",
    displayName: "Moon",
    description: "Earth's natural satellite. Low gravity, no atmosphere.",
    type: "solid",
    physics: {
      gravity: 20,
      realGravity: 1.62,
      orbitalVelocity: 120,
      orbitalAltitude: 800,
      maxThrust: 60,
      fuelConsumption: 8,
      maxLandingVelocity: 15,
      maxLandingAngle: 0.3,
      rotationSpeed: 4,
      startingFuel: 100,
    },
    colors: {
      primary: "#00ff88",
      secondary: "#00cc66",
      terrain: "rgba(100, 100, 100, 0.3)",
      terrainStroke: "rgba(160, 160, 160, 0.5)",
      sky: "#000a04",
      padViable: "#00ff00",
      padUnviable: "#ff3333",
    },
    autopilotGains: {
      attitude: { kp: 3.0, kd: 2.0 },
      horizontal: { kp: 0.02, kd: 0.3 },
      vertical: { kp: 0.5, kd: 0.1 },
    },
    terrain: {
      hasSurface: true,
      roughness: 0.6,
      iterations: 7,
      minPads: 3,
      maxPads: 5,
      minPadWidth: 40,
      maxPadWidth: 80,
      occupiedPadChance: 0.3,
      surfaceType: "regolith",
      allowDamagedLanding: true,
      hazards: { rocks: true, craters: true, ice: false },
    },
    dimensions: { width: 2400, height: 1800 },
    difficulty: 1,
    unlockedByDefault: true,
  },

  mars: {
    id: "mars",
    name: "MARS",
    displayName: "Mars",
    description: "The Red Planet. Higher gravity, thin atmosphere with wind and dust.",
    type: "solid",
    physics: {
      gravity: 46,
      realGravity: 3.71,
      orbitalVelocity: 100,
      orbitalAltitude: 800,
      maxThrust: 80,
      fuelConsumption: 10,
      maxLandingVelocity: 12,
      maxLandingAngle: 0.25,
      rotationSpeed: 3.5,
      startingFuel: 120,
    },
    colors: {
      primary: "#ff6644",
      secondary: "#cc4422",
      terrain: "rgba(140, 70, 50, 0.3)",
      terrainStroke: "rgba(180, 100, 70, 0.5)",
      sky: "#0a0402",
      padViable: "#ffaa00",
      padUnviable: "#ff3333",
      atmosphereGlow: "#ff4400",
      dustColor: "#cc8866",
    },
    autopilotGains: {
      attitude: { kp: 4.0, kd: 2.5 },
      horizontal: { kp: 0.025, kd: 0.35 },
      vertical: { kp: 0.7, kd: 0.15 },
    },
    atmosphere: {
      hasAtmosphere: true,
      density: 0.01, // Very thin - 1% of Earth
      maxWindSpeed: 30,
      windVariability: 0.5,
      atmosphereTop: 600,
      entryHeating: {
        enabled: true,
        velocityThreshold: 80,
        maxIntensity: 0.7,
      },
      sound: {
        speedOfSound: 240,
        sonicBoomEnabled: true,
      },
      dust: {
        enabled: true,
        color: "#cc8866",
        intensity: 0.8,
      },
    },
    terrain: {
      hasSurface: true,
      roughness: 0.7,
      iterations: 7,
      minPads: 2,
      maxPads: 4,
      minPadWidth: 35,
      maxPadWidth: 70,
      occupiedPadChance: 0.4,
      surfaceType: "rock",
      allowDamagedLanding: true,
      hazards: { rocks: true, craters: true, ice: false },
    },
    dimensions: { width: 2400, height: 1800 },
    difficulty: 3,
    unlockedByDefault: true,
  },

  ceres: {
    id: "ceres",
    name: "CERES",
    displayName: "Ceres",
    description: "Dwarf planet in the asteroid belt. Extremely low gravity, ice deposits.",
    type: "solid",
    physics: {
      gravity: 8,
      realGravity: 0.27,
      orbitalVelocity: 80,
      orbitalAltitude: 600,
      maxThrust: 40,
      fuelConsumption: 6,
      maxLandingVelocity: 20,
      maxLandingAngle: 0.35,
      rotationSpeed: 5,
      startingFuel: 80,
    },
    colors: {
      primary: "#88ccff",
      secondary: "#6699cc",
      terrain: "rgba(120, 130, 140, 0.3)",
      terrainStroke: "rgba(180, 190, 200, 0.5)",
      sky: "#020408",
      padViable: "#66ffff",
      padUnviable: "#ff6666",
    },
    autopilotGains: {
      attitude: { kp: 2.5, kd: 1.8 },
      horizontal: { kp: 0.015, kd: 0.25 },
      vertical: { kp: 0.4, kd: 0.08 },
    },
    terrain: {
      hasSurface: true,
      roughness: 0.5,
      iterations: 6,
      minPads: 3,
      maxPads: 6,
      minPadWidth: 50,
      maxPadWidth: 100,
      occupiedPadChance: 0.2,
      surfaceType: "ice",
      allowDamagedLanding: true,
      hazards: { rocks: false, craters: true, ice: true },
    },
    dimensions: { width: 2000, height: 1500 },
    difficulty: 2,
    unlockedByDefault: false,
    unlockRequirements: {
      landingsRequired: 5,
      prerequisiteWorld: "moon",
    },
  },

  asteroid_belt: {
    id: "asteroid_belt",
    name: "BELT",
    displayName: "Asteroid Belt",
    description: "Navigate and land on tumbling asteroids in the main belt.",
    type: "asteroid_field",
    physics: {
      gravity: 5, // Micro-gravity on asteroid surface
      realGravity: 0.001,
      orbitalVelocity: 60,
      orbitalAltitude: 500,
      maxThrust: 30,
      fuelConsumption: 5,
      maxLandingVelocity: 25,
      maxLandingAngle: 0.5,
      rotationSpeed: 6,
      startingFuel: 100,
    },
    colors: {
      primary: "#aaaaaa",
      secondary: "#888888",
      terrain: "rgba(80, 80, 80, 0.4)",
      terrainStroke: "rgba(120, 120, 120, 0.6)",
      sky: "#000204",
      padViable: "#88ff88",
      padUnviable: "#ff8888",
    },
    autopilotGains: {
      attitude: { kp: 2.0, kd: 1.5 },
      horizontal: { kp: 0.01, kd: 0.2 },
      vertical: { kp: 0.3, kd: 0.05 },
    },
    asteroidField: {
      asteroidCount: 15,
      minSize: 30,
      maxSize: 150,
      avgVelocity: 10,
      velocityVariance: 5,
      landable: true,
      rotationRate: 0.2,
    },
    dimensions: { width: 3000, height: 2000 },
    difficulty: 4,
    unlockedByDefault: false,
    unlockRequirements: {
      landingsRequired: 10,
      prerequisiteWorld: "ceres",
    },
  },
};

/**
 * JSON Schema for validation (can be used with ajv or similar)
 */
export const WORLD_JSON_SCHEMA = {
  $schema: "http://json-schema.org/draft-07/schema#",
  type: "object",
  required: ["id", "name", "displayName", "type", "physics", "colors", "autopilotGains", "dimensions", "difficulty"],
  properties: {
    id: { type: "string", pattern: "^[a-z_]+$" },
    name: { type: "string", maxLength: 20 },
    displayName: { type: "string", maxLength: 50 },
    description: { type: "string", maxLength: 200 },
    type: { type: "string", enum: ["solid", "asteroid_field", "gas_giant", "station"] },
    physics: {
      type: "object",
      required: ["gravity", "realGravity", "orbitalVelocity", "orbitalAltitude", "maxThrust"],
      properties: {
        gravity: { type: "number", minimum: 0 },
        realGravity: { type: "number", minimum: 0 },
        orbitalVelocity: { type: "number", minimum: 0 },
        orbitalAltitude: { type: "number", minimum: 100 },
        maxThrust: { type: "number", minimum: 1 },
        fuelConsumption: { type: "number", minimum: 0 },
        maxLandingVelocity: { type: "number", minimum: 1 },
        maxLandingAngle: { type: "number", minimum: 0, maximum: 1.57 },
        rotationSpeed: { type: "number", minimum: 0 },
        startingFuel: { type: "number", minimum: 0 },
      },
    },
    colors: {
      type: "object",
      required: ["primary", "secondary", "terrain", "terrainStroke", "sky", "padViable", "padUnviable"],
      properties: {
        primary: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        secondary: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        terrain: { type: "string" },
        terrainStroke: { type: "string" },
        sky: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        padViable: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
        padUnviable: { type: "string", pattern: "^#[0-9a-fA-F]{6}$" },
      },
    },
    difficulty: { type: "integer", minimum: 1, maximum: 5 },
    unlockedByDefault: { type: "boolean" },
  },
};
