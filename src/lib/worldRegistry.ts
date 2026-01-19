/**
 * World Registry
 *
 * Manages world configurations from API with fallback to hardcoded defaults.
 * Provides reactive state for Solid.js components.
 */

import { createSignal, createRoot } from "solid-js";
import {
  fetchWorlds,
  fetchSpacecraft,
  fetchUserProgression,
  getDefaultItems,
  type APIWorldResponse,
  type APISpacecraftResponse,
  type UserProgression,
} from "./api";
import type { WindBand } from "./types";

// Re-export WorldId type (now dynamic, but we keep the type for compatibility)
export type WorldId = string;

// Location names for landing zones (fallback defaults)
// Exported for backward compatibility with terrain.ts
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
];

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
];

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
  "Starbase",
];

const DEFAULT_LOCATIONS: Record<string, string[]> = {
  moon: [
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
  ],
  mars: [
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
  ],
  earth: [
    "Pacific Ocean",
    "Atlantic Ocean",
    "Cape Canaveral",
    "Boca Chica",
    "Kennedy Space Center",
    "Vandenberg SFB",
    "Kwajalein Atoll",
    "Mahia Peninsula",
    "Kourou",
    "Starbase",
  ],
};

// Interfaces matching the game's expected format
export interface AutopilotGains {
  attitude: { kp: number; kd: number };
  horizontal: { kp: number; kd: number };
  vertical: { kp: number; kd: number };
}

export interface WorldColors {
  primary: string;
  secondary: string;
  terrain: string;
  terrainStroke: string;
  sky: string;
  padViable: string;
  padUnviable: string;
  atmosphere?: string;
  dust: string;
  water?: string;
  waterStroke?: string;
}

export interface AtmosphereConfig {
  windBands: WindBand[];
  dragCoefficient: number;
}

export interface WorldConfig {
  id: WorldId;
  name: string;
  displayName: string;
  description?: string;
  gravity: number;
  realGravity: number;
  orbitalVelocity: number;
  orbitalAltitude: number;
  maxThrust: number;
  colors: WorldColors;
  autopilotGains: AutopilotGains;
  atmosphere?: AtmosphereConfig;
  hasWater?: boolean;
  hasDawnSky?: boolean;
  // New fields from API
  isDefault?: boolean;
  unlockedByDefault?: boolean;
  unlockRequirements?: {
    landingsRequired?: number;
    prerequisiteWorld?: string;
  };
  locations?: string[];
}

// Hardcoded default worlds (used as fallback when API fails)
const DEFAULT_WORLDS: Record<string, WorldConfig> = {
  moon: {
    id: "moon",
    name: "LUNA",
    displayName: "Moon",
    description: "Earth's natural satellite. Low gravity, no atmosphere.",
    gravity: 20,
    realGravity: 1.62,
    orbitalVelocity: 120,
    orbitalAltitude: 800,
    maxThrust: 60,
    colors: {
      primary: "#00ff88",
      secondary: "#00cc66",
      terrain: "rgba(100, 100, 100, 0.3)",
      terrainStroke: "rgba(160, 160, 160, 0.5)",
      sky: "#000a04",
      padViable: "#00ff00",
      padUnviable: "#ff3333",
      dust: "rgba(180, 180, 180, 0.8)",
    },
    autopilotGains: {
      attitude: { kp: 3.0, kd: 2.0 },
      horizontal: { kp: 0.02, kd: 0.3 },
      vertical: { kp: 0.5, kd: 0.1 },
    },
    isDefault: true,
    unlockedByDefault: true,
    locations: DEFAULT_LOCATIONS.moon,
  },
  mars: {
    id: "mars",
    name: "MARS",
    displayName: "Mars",
    description: "The Red Planet. Higher gravity, thin atmosphere with wind.",
    gravity: 46,
    realGravity: 3.71,
    orbitalVelocity: 100,
    orbitalAltitude: 800,
    maxThrust: 138,
    colors: {
      primary: "#ff6644",
      secondary: "#cc4422",
      terrain: "rgba(140, 70, 50, 0.3)",
      terrainStroke: "rgba(180, 100, 70, 0.5)",
      sky: "#0a0402",
      padViable: "#ffaa00",
      padUnviable: "#ff3333",
      atmosphere: "rgba(180, 120, 100, 0.4)",
      dust: "rgba(180, 100, 70, 0.8)",
    },
    autopilotGains: {
      attitude: { kp: 4.0, kd: 2.5 },
      horizontal: { kp: 0.025, kd: 0.35 },
      vertical: { kp: 0.7, kd: 0.15 },
    },
    atmosphere: {
      dragCoefficient: 0.008,
      windBands: [
        {
          altitudeMin: 150,
          altitudeMax: 300,
          density: 0.4,
          windSpeed: -8,
          turbulence: 0.2,
          particleColor: "#ffaa77",
        },
        {
          altitudeMin: 50,
          altitudeMax: 150,
          density: 0.7,
          windSpeed: 5,
          turbulence: 0.4,
          particleColor: "#dd8866",
        },
        {
          altitudeMin: 0,
          altitudeMax: 50,
          density: 1.0,
          windSpeed: -3,
          turbulence: 0.6,
          particleColor: "#bb6644",
        },
      ],
    },
    isDefault: true,
    unlockedByDefault: true,
    locations: DEFAULT_LOCATIONS.mars,
  },
  earth: {
    id: "earth",
    name: "TERRA",
    displayName: "Earth",
    description: "Home planet. High gravity, thick atmosphere.",
    gravity: 122,
    realGravity: 9.81,
    orbitalVelocity: 85,
    orbitalAltitude: 800,
    maxThrust: 366,
    colors: {
      primary: "#00E5FF",
      secondary: "#0099CC",
      terrain: "#2C5F2D",
      terrainStroke: "#3D7A3D",
      sky: "#0A0A1A",
      padViable: "#00ff88",
      padUnviable: "#ff3333",
      atmosphere: "rgba(100, 180, 255, 0.3)",
      dust: "rgba(120, 180, 220, 0.8)",
      water: "#1A4D6D",
      waterStroke: "#2A6D8D",
    },
    autopilotGains: {
      attitude: { kp: 5.0, kd: 3.0 },
      horizontal: { kp: 0.03, kd: 0.45 },
      vertical: { kp: 1.2, kd: 0.25 },
    },
    hasWater: true,
    hasDawnSky: true,
    atmosphere: {
      dragCoefficient: 0.35,
      windBands: [
        {
          altitudeMin: 400,
          altitudeMax: 600,
          density: 0.5,
          windSpeed: 25,
          turbulence: 0.3,
          particleColor: "#d0e8ff",
        },
        {
          altitudeMin: 200,
          altitudeMax: 400,
          density: 0.7,
          windSpeed: -15,
          turbulence: 0.6,
          particleColor: "#a0c8e8",
        },
        {
          altitudeMin: 0,
          altitudeMax: 200,
          density: 0.9,
          windSpeed: 8,
          turbulence: 0.5,
          particleColor: "#80b0d0",
        },
      ],
    },
    isDefault: true,
    unlockedByDefault: true,
    locations: DEFAULT_LOCATIONS.earth,
  },
};

/**
 * Convert API world response to internal WorldConfig format
 */
function apiWorldToConfig(apiWorld: APIWorldResponse): WorldConfig {
  const config: WorldConfig = {
    id: apiWorld.id,
    name: apiWorld.name,
    displayName: apiWorld.displayName,
    description: apiWorld.description,
    gravity: apiWorld.physics.gravity,
    realGravity: apiWorld.physics.realGravity,
    orbitalVelocity: apiWorld.physics.orbitalVelocity,
    orbitalAltitude: apiWorld.physics.orbitalAltitude,
    maxThrust: apiWorld.physics.maxThrust,
    colors: {
      primary: apiWorld.colors.primary,
      secondary: apiWorld.colors.secondary,
      terrain: apiWorld.colors.terrain,
      terrainStroke: apiWorld.colors.terrainStroke,
      sky: apiWorld.colors.sky,
      padViable: apiWorld.colors.padViable,
      padUnviable: apiWorld.colors.padUnviable,
      atmosphere: apiWorld.colors.atmosphere,
      dust: apiWorld.colors.dust || "rgba(180, 180, 180, 0.8)",
      water: apiWorld.colors.water,
      waterStroke: apiWorld.colors.waterStroke,
    },
    autopilotGains: apiWorld.autopilotGains,
    isDefault: apiWorld.isDefault,
    unlockedByDefault: apiWorld.unlockedByDefault,
    unlockRequirements: apiWorld.unlockRequirements,
    hasWater: apiWorld.hasWater,
    hasDawnSky: apiWorld.hasDawnSky,
    locations: apiWorld.locations || DEFAULT_LOCATIONS[apiWorld.id] || [],
  };

  // Convert atmosphere if present
  if (apiWorld.atmosphere && apiWorld.atmosphere.windBands) {
    config.atmosphere = {
      dragCoefficient: apiWorld.atmosphere.dragCoefficient || 0,
      windBands: apiWorld.atmosphere.windBands.map((band) => ({
        altitudeMin: band.altitudeMin,
        altitudeMax: band.altitudeMax,
        density: band.density,
        windSpeed: band.windSpeed,
        turbulence: band.turbulence,
        particleColor: band.particleColor,
      })),
    };
  }

  return config;
}

// Create reactive world registry using Solid.js primitives
// This runs outside of component context so it persists across the app
const worldRegistryRoot = createRoot(() => {
  const [worlds, setWorlds] = createSignal<Record<string, WorldConfig>>(DEFAULT_WORLDS);
  const [spacecraft, setSpacecraft] = createSignal<APISpacecraftResponse[]>([]);
  const [userProgression, setUserProgression] = createSignal<UserProgression | null>(null);
  const [isLoading, setIsLoading] = createSignal(false);
  const [isInitialized, setIsInitialized] = createSignal(false);
  const [error, setError] = createSignal<string | null>(null);

  /**
   * Initialize the registry by fetching data from API
   */
  async function initialize(): Promise<void> {
    if (isInitialized() || isLoading()) return;

    setIsLoading(true);
    setError(null);

    try {
      // Fetch worlds, spacecraft, and user progression in parallel
      const [apiWorlds, apiSpacecraft, progression] = await Promise.all([
        fetchWorlds(),
        fetchSpacecraft(),
        fetchUserProgression(),
      ]);

      // Process worlds
      if (apiWorlds.length > 0) {
        const worldsMap: Record<string, WorldConfig> = {};
        for (const apiWorld of apiWorlds) {
          worldsMap[apiWorld.id] = apiWorldToConfig(apiWorld);
        }
        setWorlds(worldsMap);
        console.log(`[WorldRegistry] Loaded ${apiWorlds.length} worlds from API`);
      } else {
        console.log("[WorldRegistry] No API worlds, using defaults");
        // Keep default worlds
      }

      // Store spacecraft
      if (apiSpacecraft.length > 0) {
        setSpacecraft(apiSpacecraft);
        console.log(
          `[WorldRegistry] Loaded ${apiSpacecraft.length} spacecraft from API`,
        );
      }

      // Store user progression
      if (progression) {
        setUserProgression(progression);
        console.log(
          `[WorldRegistry] User has ${progression.unlockedWorlds.length} unlocked worlds`,
        );
      } else {
        console.log("[WorldRegistry] No user progression, using defaults");
      }

      setIsInitialized(true);
    } catch (err) {
      const message = err instanceof Error ? err.message : "Unknown error";
      setError(message);
      console.error("[WorldRegistry] Failed to initialize:", message);
      // Keep using default worlds on error
    } finally {
      setIsLoading(false);
    }
  }

  /**
   * Refresh user progression (call after unlocking a world)
   */
  async function refreshProgression(): Promise<void> {
    try {
      const progression = await fetchUserProgression();
      if (progression) {
        setUserProgression(progression);
        console.log("[WorldRegistry] User progression refreshed");
      }
    } catch (err) {
      console.warn("[WorldRegistry] Failed to refresh progression:", err);
    }
  }

  /**
   * Get a world by ID
   */
  function getWorld(id: WorldId): WorldConfig {
    const currentWorlds = worlds();
    if (id in currentWorlds) {
      return currentWorlds[id];
    }
    // Fallback to moon if world not found
    console.warn(`[WorldRegistry] World "${id}" not found, falling back to moon`);
    return currentWorlds["moon"] || DEFAULT_WORLDS.moon;
  }

  /**
   * Get all world IDs
   */
  function getWorldIds(): WorldId[] {
    return Object.keys(worlds());
  }

  /**
   * Get all worlds as array
   */
  function getAllWorlds(): WorldConfig[] {
    return Object.values(worlds());
  }

  /**
   * Get default worlds (for offline fallback)
   */
  function getDefaultWorlds(): WorldConfig[] {
    return Object.values(worlds()).filter((w) => w.isDefault === true);
  }

  /**
   * Get unlocked worlds (based on user progression)
   * Returns worlds that the user has unlocked via the backend,
   * plus any worlds marked as unlockedByDefault.
   */
  function getUnlockedWorlds(): WorldConfig[] {
    const progression = userProgression();
    const currentWorlds = worlds();

    if (progression && progression.unlockedWorlds.length > 0) {
      // User has progression data - filter by their unlocked worlds
      // Plus always include worlds that are unlocked by default
      return Object.values(currentWorlds).filter(
        (w) =>
          progression.unlockedWorlds.includes(w.id) ||
          w.unlockedByDefault === true,
      );
    }

    // No progression data - fall back to default unlocked worlds
    return Object.values(currentWorlds).filter(
      (w) => w.unlockedByDefault === true || w.isDefault === true,
    );
  }

  /**
   * Check if a specific world is unlocked for the user
   */
  function isWorldUnlocked(worldId: string): boolean {
    const progression = userProgression();
    const world = getWorld(worldId);

    // World is unlocked if:
    // 1. It's unlocked by default, OR
    // 2. User's progression includes it
    if (world.unlockedByDefault === true) return true;
    if (progression && progression.unlockedWorlds.includes(worldId)) return true;

    return false;
  }

  /**
   * Get locations for a world
   */
  function getWorldLocations(id: WorldId): string[] {
    const world = getWorld(id);
    return world.locations || DEFAULT_LOCATIONS[id] || [];
  }

  /**
   * Get gravity factor relative to moon
   */
  function getGravityFactor(world: WorldConfig): number {
    const moonGravity = getWorld("moon").gravity;
    return world.gravity / moonGravity;
  }

  return {
    // Reactive state
    worlds,
    spacecraft,
    userProgression,
    isLoading,
    isInitialized,
    error,
    // Actions
    initialize,
    refreshProgression,
    // Getters
    getWorld,
    getWorldIds,
    getAllWorlds,
    getDefaultWorlds,
    getUnlockedWorlds,
    isWorldUnlocked,
    getWorldLocations,
    getGravityFactor,
  };
});

// Export functions from the registry root
export const {
  worlds: worldsSignal,
  spacecraft: spacecraftSignal,
  userProgression: userProgressionSignal,
  isLoading: isWorldsLoading,
  isInitialized: isWorldsInitialized,
  error: worldsError,
  initialize: initializeWorldRegistry,
  refreshProgression,
  getWorld,
  getWorldIds,
  getAllWorlds,
  getDefaultWorlds,
  getUnlockedWorlds,
  isWorldUnlocked,
  getWorldLocations,
  getGravityFactor,
} = worldRegistryRoot;

// Export WORLDS as a getter for backward compatibility with existing code
// This returns the current worlds object (reactive)
export function getWorlds(): Record<string, WorldConfig> {
  return worldRegistryRoot.worlds();
}

// For components that need the static object (like HUD iteration)
// This will update when worlds change
export const WORLDS = new Proxy({} as Record<string, WorldConfig>, {
  get(_target, prop: string) {
    const currentWorlds = worldRegistryRoot.worlds();
    return currentWorlds[prop];
  },
  ownKeys() {
    return Object.keys(worldRegistryRoot.worlds());
  },
  getOwnPropertyDescriptor(_target, prop: string) {
    const currentWorlds = worldRegistryRoot.worlds();
    if (prop in currentWorlds) {
      return {
        enumerable: true,
        configurable: true,
        value: currentWorlds[prop],
      };
    }
    return undefined;
  },
  has(_target, prop: string) {
    return prop in worldRegistryRoot.worlds();
  },
});
