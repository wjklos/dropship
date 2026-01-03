/**
 * World Configuration System
 *
 * Defines planetary bodies with their physical properties, visual themes,
 * and autopilot tuning parameters. Designed for easy addition of new worlds.
 */

export type WorldId = 'moon' | 'mars';

export interface AutopilotGains {
  attitude: { kp: number; kd: number };
  horizontal: { kp: number; kd: number };
  vertical: { kp: number; kd: number };
}

export interface WorldColors {
  primary: string;        // UI elements, lander
  secondary: string;      // Dimmer accents
  terrain: string;        // Terrain fill
  terrainStroke: string;  // Terrain outline
  sky: string;            // Background
  padViable: string;      // Reachable landing pad
  padUnviable: string;    // Unreachable landing pad
}

export interface WorldConfig {
  id: WorldId;
  name: string;
  displayName: string;
  gravity: number;           // px/s² (game-scaled)
  realGravity: number;       // m/s² (actual)
  orbitalVelocity: number;   // px/s horizontal in orbit
  orbitalAltitude: number;   // px above terrain baseline
  maxThrust: number;         // px/s² thrust capability
  colors: WorldColors;
  autopilotGains: AutopilotGains;
}

export const WORLDS: Record<WorldId, WorldConfig> = {
  moon: {
    id: 'moon',
    name: 'LUNA',
    displayName: 'Moon',
    gravity: 20,              // Baseline gravity
    realGravity: 1.62,        // m/s²
    orbitalVelocity: 120,     // Horizontal orbit speed
    orbitalAltitude: 800,     // Start altitude
    maxThrust: 60,            // Baseline thrust
    colors: {
      primary: '#00ff88',
      secondary: '#00cc66',
      terrain: 'rgba(100, 100, 100, 0.3)',
      terrainStroke: 'rgba(160, 160, 160, 0.5)',
      sky: '#000a04',
      padViable: '#00ff00',
      padUnviable: '#ff3333',
    },
    autopilotGains: {
      attitude: { kp: 3.0, kd: 2.0 },
      horizontal: { kp: 0.02, kd: 0.3 },
      vertical: { kp: 0.5, kd: 0.1 },
    },
  },
  mars: {
    id: 'mars',
    name: 'MARS',
    displayName: 'Mars',
    gravity: 46,              // ~2.3x Moon
    realGravity: 3.71,        // m/s²
    orbitalVelocity: 100,     // Slower due to higher gravity
    orbitalAltitude: 800,     // Same start altitude
    maxThrust: 80,            // Higher thrust to compensate for gravity
    colors: {
      primary: '#ff6644',
      secondary: '#cc4422',
      terrain: 'rgba(140, 70, 50, 0.3)',
      terrainStroke: 'rgba(180, 100, 70, 0.5)',
      sky: '#0a0402',
      padViable: '#ffaa00',
      padUnviable: '#ff3333',
    },
    autopilotGains: {
      attitude: { kp: 4.0, kd: 2.5 },
      horizontal: { kp: 0.025, kd: 0.35 },
      vertical: { kp: 0.7, kd: 0.15 },
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
