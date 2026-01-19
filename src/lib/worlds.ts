/**
 * World Configuration System
 *
 * Defines planetary bodies with their physical properties, visual themes,
 * and autopilot tuning parameters. Designed for easy addition of new worlds.
 */

import type { WindBand } from "./types";

export type WorldId = "moon" | "mars" | "earth";

// Location names for landing zones
// Moon: Apollo landing sites, craters, maria, and notable features
export const MOON_LOCATIONS: string[] = [
  "Tranquility Base",
  "Ocean of Storms",
  "Fra Mauro",
  "Hadley Rille",
  "Descartes",
  "Taurus-Littrow",
  "Copernicus",
  "Tycho",
  "Aristarchus",
  "Kepler",
  "Plato",
  "Mare Imbrium",
  "Mare Serenitatis",
  "Mare Crisium",
  "Montes Apenninus",
  "Alphonsus",
  "Ptolemaeus",
  "Archimedes",
  "Eratosthenes",
  "Grimaldi",
  "Lansberg",
  "Moltke",
  "Shorty Crater",
  "Surveyor Basin",
  "Lunar South Pole",
];

// Mars: Landing sites, craters, plains, and notable features
export const MARS_LOCATIONS: string[] = [
  "Jezero Crater",
  "Gale Crater",
  "Utopia Planitia",
  "Chryse Planitia",
  "Meridiani Planum",
  "Elysium Planitia",
  "Gusev Crater",
  "Acidalia Planitia",
  "Isidis Basin",
  "Hellas Basin",
  "Argyre Basin",
  "Valles Marineris",
  "Olympus Mons",
  "Arcadia Planitia",
  "Amazonis Planitia",
  "Syrtis Major",
  "Terra Meridiani",
  "Nili Fossae",
  "Mawrth Vallis",
  "Holden Crater",
  "Eberswalde",
  "Columbia Hills",
  "Bradbury Landing",
  "Aeolis Mons",
  "Green Valley",
];

// Earth: Oceans, seas, spaceports, and island locations
export const EARTH_LOCATIONS: string[] = [
  "Pacific Ocean",
  "Atlantic Ocean",
  "Cape Canaveral",
  "Boca Chica",
  "Kennedy Space Center",
  "Vandenberg SFB",
  "Kwajalein Atoll",
  "Mahia Peninsula",
  "Kourou",
  "Baikonur",
  "Vostochny",
  "Tanegashima",
  "Wallops Island",
  "Sea of Tranquility", // Easter egg - Moon reference
  "Starbase",
  "Indian Ocean",
  "Mediterranean Sea",
  "Caribbean Sea",
  "Gulf of Mexico",
  "North Sea",
  "Coral Sea",
  "Barents Sea",
  "South China Sea",
  "Bay of Bengal",
  "Just Read The Instructions", // SpaceX droneship
];

export interface AutopilotGains {
  attitude: { kp: number; kd: number };
  horizontal: { kp: number; kd: number };
  vertical: { kp: number; kd: number };
}

export interface WorldColors {
  primary: string; // UI elements, lander
  secondary: string; // Dimmer accents
  terrain: string; // Terrain fill
  terrainStroke: string; // Terrain outline
  sky: string; // Background
  padViable: string; // Reachable landing pad
  padUnviable: string; // Unreachable landing pad
  atmosphere?: string; // Atmosphere haze color (null for vacuum)
  dust: string; // Dust/regolith color for landing effects
  water?: string; // Water fill color (Earth only)
  waterStroke?: string; // Water surface stroke color (Earth only)
}

export interface AtmosphereConfig {
  windBands: WindBand[]; // Altitude-based wind layers
  dragCoefficient: number; // Base drag multiplier (0 = vacuum, 1 = Earth-like)
}

export interface WorldConfig {
  id: WorldId;
  name: string;
  displayName: string;
  gravity: number; // px/s² (game-scaled)
  realGravity: number; // m/s² (actual)
  orbitalVelocity: number; // px/s horizontal in orbit
  orbitalAltitude: number; // px above terrain baseline
  maxThrust: number; // px/s² thrust capability
  colors: WorldColors;
  autopilotGains: AutopilotGains;
  atmosphere?: AtmosphereConfig; // Optional atmosphere with wind/drag
  hasWater?: boolean; // Earth-specific: mixed land/water terrain
  hasDawnSky?: boolean; // Earth-specific: dawn gradient background
}

export const WORLDS: Record<WorldId, WorldConfig> = {
  moon: {
    id: "moon",
    name: "LUNA",
    displayName: "Moon",
    gravity: 20, // Baseline gravity
    realGravity: 1.62, // m/s²
    orbitalVelocity: 120, // Horizontal orbit speed
    orbitalAltitude: 800, // Start altitude
    maxThrust: 60, // 3x gravity for consistent TWR across worlds (~0.5G felt)
    colors: {
      primary: "#00ff88",
      secondary: "#00cc66",
      terrain: "rgba(100, 100, 100, 0.3)",
      terrainStroke: "rgba(160, 160, 160, 0.5)",
      sky: "#000a04",
      padViable: "#00ff00",
      padUnviable: "#ff3333",
      // No atmosphere - Moon is a vacuum
      dust: "rgba(180, 180, 180, 0.8)", // Gray lunar regolith
    },
    autopilotGains: {
      attitude: { kp: 3.0, kd: 2.0 },
      horizontal: { kp: 0.02, kd: 0.3 },
      vertical: { kp: 0.5, kd: 0.1 },
    },
  },
  mars: {
    id: "mars",
    name: "MARS",
    displayName: "Mars",
    gravity: 46, // ~2.3x Moon
    realGravity: 3.71, // m/s²
    orbitalVelocity: 100, // Slower due to higher gravity
    orbitalAltitude: 800, // Same start altitude
    maxThrust: 138, // 3x gravity for consistent TWR across worlds (~1.14G felt)
    colors: {
      primary: "#ff6644",
      secondary: "#cc4422",
      terrain: "rgba(140, 70, 50, 0.3)",
      terrainStroke: "rgba(180, 100, 70, 0.5)",
      sky: "#0a0402",
      padViable: "#ffaa00",
      padUnviable: "#ff3333",
      // Dusty pink/orange Mars atmosphere
      atmosphere: "rgba(180, 120, 100, 0.4)",
      dust: "rgba(180, 100, 70, 0.8)", // Rust-colored Martian dust
    },
    autopilotGains: {
      attitude: { kp: 4.0, kd: 2.5 },
      horizontal: { kp: 0.025, kd: 0.35 },
      vertical: { kp: 0.7, kd: 0.15 },
    },
    // Mars thin atmosphere - "fast numbers, small punch"
    // 3 surface-based wind bands (PBL only - no wind in orbit/upper atmo)
    // Above ~300px is essentially vacuum with only solar wind
    atmosphere: {
      dragCoefficient: 0.008, // Essentially negligible braking effect
      windBands: [
        // Upper PBL (150-300px) - high altitude winds, shear layer
        {
          altitudeMin: 150,
          altitudeMax: 300,
          density: 0.4,
          windSpeed: -8, // Opposite direction shear
          turbulence: 0.2,
          particleColor: "#ffaa77", // Pale orange
        },
        // Mid PBL (50-150px) - main convection zone
        {
          altitudeMin: 50,
          altitudeMax: 150,
          density: 0.7,
          windSpeed: 5, // Light prevailing wind
          turbulence: 0.4,
          particleColor: "#dd8866", // Dusty pink
        },
        // Surface layer (0-50px) - dust devil territory
        {
          altitudeMin: 0,
          altitudeMax: 50,
          density: 1.0,
          windSpeed: -3, // Light variable surface wind
          turbulence: 0.6,
          particleColor: "#bb6644", // Rust/brown
        },
      ],
    },
  },
  earth: {
    id: "earth",
    name: "TERRA",
    displayName: "Earth",
    gravity: 122, // 6x Moon's 20 (represents 9.81 m/s²)
    realGravity: 9.81, // m/s²
    orbitalVelocity: 85, // Slower due to drag
    orbitalAltitude: 800, // Same start altitude
    maxThrust: 366, // 3x gravity for consistent TWR across worlds (~2.4G felt)
    colors: {
      primary: "#00E5FF", // Electric cyan
      secondary: "#0099CC",
      terrain: "#2C5F2D", // Deep earth green (land)
      terrainStroke: "#3D7A3D",
      sky: "#0A0A1A", // Will be overridden by gradient in EarthSky component
      padViable: "#00ff88", // Keep pads consistent green
      padUnviable: "#ff3333",
      // Earth atmosphere - blue haze
      atmosphere: "rgba(100, 180, 255, 0.3)",
      dust: "rgba(120, 180, 220, 0.8)", // Blue-gray water spray
      water: "#1A4D6D", // Deep ocean blue
      waterStroke: "#2A6D8D", // Lighter water surface
    },
    autopilotGains: {
      attitude: { kp: 5.0, kd: 3.0 }, // More aggressive for high gravity
      horizontal: { kp: 0.03, kd: 0.45 },
      vertical: { kp: 1.2, kd: 0.25 },
    },
    // Earth-specific features
    hasWater: true,
    hasDawnSky: true,
    // Earth atmosphere - strong drag and wind
    atmosphere: {
      dragCoefficient: 0.35, // Significant atmospheric braking
      windBands: [
        // Upper atmosphere (400-600px) - jet stream
        {
          altitudeMin: 400,
          altitudeMax: 600,
          density: 0.5,
          windSpeed: 25, // Fast high-altitude winds
          turbulence: 0.3,
          particleColor: "#d0e8ff", // Pale blue
        },
        // Mid atmosphere (200-400px) - turbulent zone
        {
          altitudeMin: 200,
          altitudeMax: 400,
          density: 0.7,
          windSpeed: -15, // Opposite direction shear
          turbulence: 0.6,
          particleColor: "#a0c8e8", // Light blue
        },
        // Low atmosphere (0-200px) - surface winds
        {
          altitudeMin: 0,
          altitudeMax: 200,
          density: 0.9,
          windSpeed: 8, // Moderate surface wind
          turbulence: 0.5,
          particleColor: "#80b0d0", // Blue-gray
        },
      ],
    },
  },
};

/**
 * Get world configuration by ID
 */
export function getWorld(id: WorldId): WorldConfig {
  return WORLDS[id];
}

/**
 * Get all available world IDs
 */
export function getWorldIds(): WorldId[] {
  return Object.keys(WORLDS) as WorldId[];
}

/**
 * Get gravity-scaled descent rate
 * Adjusts target descent rates based on world gravity relative to Moon baseline
 */
export function getGravityFactor(world: WorldConfig): number {
  return world.gravity / WORLDS.moon.gravity;
}
