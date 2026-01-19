/**
 * API Client for Dropship Backend
 *
 * Handles fetching worlds, spacecraft, and other game data from the backend API.
 * Includes caching layer with localStorage fallback for offline play.
 */

import type { WorldConfig as SchemaWorldConfig } from "./schemas/world.schema";
import type { SpacecraftConfig as SchemaSpacecraftConfig } from "./schemas/spacecraft.schema";

// API Configuration
const API_URL = import.meta.env.VITE_API_URL || "https://dropship.configtree.com";

// Cache keys
const CACHE_KEYS = {
  worlds: "dropship_worlds_cache",
  spacecraft: "dropship_spacecraft_cache",
  cacheTimestamp: "dropship_cache_timestamp",
};

// Cache duration (1 hour)
const CACHE_DURATION_MS = 60 * 60 * 1000;

/**
 * API Response types matching backend schema
 */
export interface APIWorldResponse {
  id: string;
  name: string;
  displayName: string;
  description?: string;
  type: "solid" | "asteroid_field" | "gas_giant" | "station";
  physics: {
    gravity: number;
    realGravity: number;
    orbitalVelocity: number;
    orbitalAltitude: number;
    maxThrust: number;
    fuelConsumption?: number;
    maxLandingVelocity?: number;
    maxLandingAngle?: number;
    rotationSpeed?: number;
    startingFuel?: number;
  };
  colors: {
    primary: string;
    secondary: string;
    terrain: string;
    terrainStroke: string;
    sky: string;
    padViable: string;
    padUnviable: string;
    atmosphere?: string;
    dust?: string;
    water?: string;
    waterStroke?: string;
  };
  autopilotGains: {
    attitude: { kp: number; kd: number };
    horizontal: { kp: number; kd: number };
    vertical: { kp: number; kd: number };
  };
  atmosphere?: {
    windBands?: Array<{
      altitudeMin: number;
      altitudeMax: number;
      density: number;
      windSpeed: number;
      turbulence: number;
      particleColor?: string;
    }>;
    dragCoefficient?: number;
  };
  terrain?: {
    roughness?: number;
    iterations?: number;
    minPads?: number;
    maxPads?: number;
  };
  dimensions?: {
    width: number;
    height: number;
  };
  difficulty?: number;
  isDefault?: boolean;
  unlockedByDefault?: boolean;
  unlockRequirements?: {
    landingsRequired?: number;
    prerequisiteWorld?: string;
  };
  // Features
  hasWater?: boolean;
  hasDawnSky?: boolean;
  // Location names for landing zones
  locations?: string[];
}

export interface APISpacecraftResponse {
  id: string;
  name: string;
  description?: string;
  class: "lander" | "shuttle" | "capsule" | "hopper" | "cargo";
  compatibleWorlds: string[];
  engine: {
    type: string;
    maxThrust: number;
    specificImpulse?: number;
    throttleRange?: [number, number];
    restartable?: boolean;
    maxRestarts?: number;
    flameColor?: string;
    flameLength?: number;
  };
  fuel: {
    type?: string;
    capacity: number;
    consumptionRate: number;
    massPerUnit?: number;
  };
  rcs?: {
    rotationAcceleration: number;
    consumesFuel?: boolean;
    fuelConsumption?: number;
  };
  landingGear?: {
    legCount?: number;
    legSpan: number;
    legHeight?: number;
    maxImpactVelocity?: number;
  };
  structure?: {
    dryMass?: number;
    integrity?: number;
    heatResistance?: number;
    hasHeatShield?: boolean;
  };
  visuals?: {
    bodyPath?: string;
    detailPaths?: string[];
    primaryColor?: string;
    secondaryColor?: string;
    engineColor?: string;
    scale?: number;
    glowIntensity?: number;
  };
  avionics?: {
    altimeterRange?: number;
    hasTerrainMapping?: boolean;
    autopilotLevel?: number;
    guidancePrecision?: number;
  };
  capabilities?: {
    hoverMode?: boolean;
    abortSystem?: boolean;
    abortThrustMultiplier?: number;
  };
  autopilotModifiers?: {
    attitude?: number;
    horizontal?: number;
    vertical?: number;
  };
  isDefault?: boolean;
  unlockedByDefault?: boolean;
  unlockRequirements?: {
    landingsRequired?: number;
    perfectLandings?: number;
    worldsCompleted?: string[];
  };
}

/**
 * API Error class
 */
export class APIError extends Error {
  constructor(
    message: string,
    public status?: number,
    public endpoint?: string,
  ) {
    super(message);
    this.name = "APIError";
  }
}

/**
 * Fetch with timeout and credentials
 *
 * All API requests include `credentials: 'include'` for session cookie handling.
 * The backend uses cookie-based sessions for anonymous players (dropship_session=anon_<uuid>).
 */
async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = 10000,
): Promise<Response> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...options,
      credentials: "include", // Required for session cookies
      signal: controller.signal,
    });
    return response;
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Check if cache is valid
 */
function isCacheValid(): boolean {
  try {
    const timestamp = localStorage.getItem(CACHE_KEYS.cacheTimestamp);
    if (!timestamp) return false;

    const cacheTime = parseInt(timestamp, 10);
    return Date.now() - cacheTime < CACHE_DURATION_MS;
  } catch {
    return false;
  }
}

/**
 * Save data to cache
 */
function saveToCache<T>(key: string, data: T): void {
  try {
    localStorage.setItem(key, JSON.stringify(data));
    localStorage.setItem(CACHE_KEYS.cacheTimestamp, Date.now().toString());
  } catch (e) {
    console.warn("Failed to save to cache:", e);
  }
}

/**
 * Load data from cache
 */
function loadFromCache<T>(key: string): T | null {
  try {
    const data = localStorage.getItem(key);
    return data ? JSON.parse(data) : null;
  } catch {
    return null;
  }
}

/**
 * Fetch all worlds from API
 */
export async function fetchWorlds(): Promise<APIWorldResponse[]> {
  // Check cache first
  if (isCacheValid()) {
    const cached = loadFromCache<APIWorldResponse[]>(CACHE_KEYS.worlds);
    if (cached && cached.length > 0) {
      console.log("[API] Using cached worlds data");
      return cached;
    }
  }

  try {
    console.log("[API] Fetching worlds from", `${API_URL}/worlds`);
    const response = await fetchWithTimeout(`${API_URL}/worlds`);

    if (!response.ok) {
      throw new APIError(
        `Failed to fetch worlds: ${response.statusText}`,
        response.status,
        "/worlds",
      );
    }

    const data = await response.json();
    const worlds: APIWorldResponse[] = Array.isArray(data) ? data : data.worlds || [];

    // Cache the result
    if (worlds.length > 0) {
      saveToCache(CACHE_KEYS.worlds, worlds);
      console.log(`[API] Cached ${worlds.length} worlds`);
    }

    return worlds;
  } catch (error) {
    console.warn("[API] Failed to fetch worlds, trying cache:", error);

    // Try to use cached data even if expired
    const cached = loadFromCache<APIWorldResponse[]>(CACHE_KEYS.worlds);
    if (cached && cached.length > 0) {
      console.log("[API] Using expired cache as fallback");
      return cached;
    }

    // Return empty array - caller should use defaults
    return [];
  }
}

/**
 * Fetch a specific world by ID
 */
export async function fetchWorld(id: string): Promise<APIWorldResponse | null> {
  try {
    const response = await fetchWithTimeout(`${API_URL}/worlds/${id}`);

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new APIError(
        `Failed to fetch world: ${response.statusText}`,
        response.status,
        `/worlds/${id}`,
      );
    }

    return await response.json();
  } catch (error) {
    console.warn(`[API] Failed to fetch world ${id}:`, error);
    return null;
  }
}

/**
 * Fetch all spacecraft from API
 */
export async function fetchSpacecraft(): Promise<APISpacecraftResponse[]> {
  // Check cache first
  if (isCacheValid()) {
    const cached = loadFromCache<APISpacecraftResponse[]>(CACHE_KEYS.spacecraft);
    if (cached && cached.length > 0) {
      console.log("[API] Using cached spacecraft data");
      return cached;
    }
  }

  try {
    console.log("[API] Fetching spacecraft from", `${API_URL}/spacecraft`);
    const response = await fetchWithTimeout(`${API_URL}/spacecraft`);

    if (!response.ok) {
      throw new APIError(
        `Failed to fetch spacecraft: ${response.statusText}`,
        response.status,
        "/spacecraft",
      );
    }

    const data = await response.json();
    const spacecraft: APISpacecraftResponse[] = Array.isArray(data)
      ? data
      : data.spacecraft || [];

    // Cache the result
    if (spacecraft.length > 0) {
      saveToCache(CACHE_KEYS.spacecraft, spacecraft);
      console.log(`[API] Cached ${spacecraft.length} spacecraft`);
    }

    return spacecraft;
  } catch (error) {
    console.warn("[API] Failed to fetch spacecraft, trying cache:", error);

    // Try to use cached data even if expired
    const cached = loadFromCache<APISpacecraftResponse[]>(CACHE_KEYS.spacecraft);
    if (cached && cached.length > 0) {
      console.log("[API] Using expired cache as fallback");
      return cached;
    }

    // Return empty array - caller should use defaults
    return [];
  }
}

/**
 * Fetch a specific spacecraft by ID
 */
export async function fetchSpacecraftById(
  id: string,
): Promise<APISpacecraftResponse | null> {
  try {
    const response = await fetchWithTimeout(`${API_URL}/spacecraft/${id}`);

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new APIError(
        `Failed to fetch spacecraft: ${response.statusText}`,
        response.status,
        `/spacecraft/${id}`,
      );
    }

    return await response.json();
  } catch (error) {
    console.warn(`[API] Failed to fetch spacecraft ${id}:`, error);
    return null;
  }
}

/**
 * Clear API cache
 */
export function clearAPICache(): void {
  try {
    localStorage.removeItem(CACHE_KEYS.worlds);
    localStorage.removeItem(CACHE_KEYS.spacecraft);
    localStorage.removeItem(CACHE_KEYS.cacheTimestamp);
    console.log("[API] Cache cleared");
  } catch (e) {
    console.warn("Failed to clear cache:", e);
  }
}

/**
 * Check API health
 */
export async function checkAPIHealth(): Promise<boolean> {
  try {
    const response = await fetchWithTimeout(`${API_URL}/health`, {}, 5000);
    return response.ok;
  } catch {
    return false;
  }
}

/**
 * Filter items by isDefault for offline fallback
 */
export function getDefaultItems<T extends { isDefault?: boolean }>(
  items: T[],
): T[] {
  return items.filter((item) => item.isDefault === true);
}

/**
 * Flight submission payload
 * Matches the backend POST /flights schema
 */
export interface FlightSubmission {
  // Flight ID (generated client-side)
  id: string;

  // Timestamp (ISO format)
  timestamp: string;

  // Required fields
  worldId: string;

  // Flight outcome
  outcome: "success" | "damaged" | "crashed" | null;
  failureReason?: string | null;

  // Flight metadata
  mode: string; // off, stabilize, land, demo
  approachMode?: string | null; // stop_drop, boostback

  // Timing
  duration: number; // seconds
  burnTime: number; // seconds from first burn to landing

  // Initial state
  initial: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    rotation: number;
    fuel: number;
    targetPadIndex: number | null;
  };

  // Terminal state
  terminal: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    rotation: number;
    fuel: number;
    speed: number;
    altitude: number;
  };

  // Performance metrics
  metrics: {
    maxSpeed: number;
    maxDescentRate: number;
    maxHorizontalSpeed: number;
    maxGs: number;
    minAltitude: number;
    fuelUsed: number;
    horizontalErrorAtTouchdown: number;
    verticalSpeedAtTouchdown: number;
    horizontalSpeedAtTouchdown: number;
    angleAtTouchdown: number;
    timeInOrbit: number;
    abortAttempts: number;
    abortEvents?: Array<{
      altitude: number;
      phase: string;
      fuel: number;
      velocity: { vx: number; vy: number };
      decision: "orbit" | "retarget" | "brace";
      outcome: "orbit_achieved" | "landed_success" | "landed_damaged" | "crashed" | "pending";
      originalPadIndex: number | null;
      emergencyPadIndex: number | null;
      timestamp: number;
    }>;
  };

  // Landing info
  landedPadIndex: number | null;
  landedPadMultiplier?: number;

  // Telemetry data (required by backend)
  telemetry: Array<{
    t: number;
    x: number;
    y: number;
    vx: number;
    vy: number;
    rot: number;
    fuel: number;
    thrust: number;
    alt: number;
    phase: string;
  }>;
}

/**
 * Flight submission response from backend
 */
export interface FlightSubmissionResponse {
  id: string;
  score?: number;
  pointsEarned?: number;
  pointsAwarded?: number;
  newTotalPoints?: number;
  achievements?: string[];
  leaderboardRank?: number;
  message?: string;
}

/**
 * Submit a completed flight to the backend
 *
 * Note: Currently submits anonymously. When auth is added,
 * the backend will associate flights with the user.
 */
export async function submitFlight(
  flight: FlightSubmission,
): Promise<FlightSubmissionResponse | null> {
  try {
    console.log("[API] Submitting flight to backend...", {
      worldId: flight.worldId,
      outcome: flight.outcome,
      duration: flight.duration.toFixed(1) + "s",
    });

    const response = await fetchWithTimeout(
      `${API_URL}/flights`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(flight),
      },
      15000, // 15 second timeout for submissions
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.warn(`[API] Flight submission failed (${response.status}):`, errorText);

      // Don't throw - we don't want to break the game if submission fails
      return null;
    }

    const result: FlightSubmissionResponse = await response.json();
    console.log("[API] Flight submitted successfully:", result);

    return result;
  } catch (error) {
    // Log but don't throw - flight submission is non-critical
    console.warn("[API] Failed to submit flight:", error);
    return null;
  }
}

/**
 * Queue for offline flight submissions
 * Stores flights that failed to submit for later retry
 */
const PENDING_FLIGHTS_KEY = "dropship_pending_flights";

/**
 * Save a flight to the pending queue (for offline support)
 */
export function queueFlightForSubmission(flight: FlightSubmission): void {
  try {
    const pending = loadFromCache<FlightSubmission[]>(PENDING_FLIGHTS_KEY) || [];
    pending.push(flight);

    // Keep max 50 pending flights
    while (pending.length > 50) {
      pending.shift();
    }

    localStorage.setItem(PENDING_FLIGHTS_KEY, JSON.stringify(pending));
    console.log(`[API] Flight queued for later submission (${pending.length} pending)`);
  } catch (e) {
    console.warn("Failed to queue flight:", e);
  }
}

/**
 * Try to submit all pending flights
 */
export async function submitPendingFlights(): Promise<number> {
  const pending = loadFromCache<FlightSubmission[]>(PENDING_FLIGHTS_KEY) || [];
  if (pending.length === 0) return 0;

  console.log(`[API] Attempting to submit ${pending.length} pending flights...`);

  let submitted = 0;
  const stillPending: FlightSubmission[] = [];

  for (const flight of pending) {
    const result = await submitFlight(flight);
    if (result) {
      submitted++;
    } else {
      stillPending.push(flight);
    }
  }

  // Update pending queue
  localStorage.setItem(PENDING_FLIGHTS_KEY, JSON.stringify(stillPending));

  if (submitted > 0) {
    console.log(`[API] Submitted ${submitted} pending flights, ${stillPending.length} still pending`);
  }

  return submitted;
}

// ============================================
// USER PROGRESSION API
// ============================================

/**
 * Progression stats from backend
 */
export interface ProgressionStats {
  totalFlights: number;
  successfulLandings: number;
  perfectLandings: number;
  flightsByWorld: Record<string, number>;
  bestScoreByWorld: Record<string, number>;
}

/**
 * User progression data from backend
 * Matches backend UserProgression struct (camelCase JSON)
 */
export interface UserProgression {
  userId: string;
  totalPoints: number;
  availablePoints: number;
  unlockedWorlds: string[];
  unlockedSpacecraft: string[];
  stats: ProgressionStats;
  achievements: string[];
  updatedAt: string;
}

/**
 * Fetch user progression (unlocked worlds, spacecraft, points, stats)
 * Uses "me" to let backend identify user from session cookie
 */
export async function fetchUserProgression(): Promise<UserProgression | null> {
  try {
    console.log("[API] Fetching user progression...");
    const response = await fetchWithTimeout(`${API_URL}/users/me/progression`);

    if (!response.ok) {
      if (response.status === 401 || response.status === 404) {
        // No session or new user - return null, caller should use defaults
        console.log("[API] No user session or new user");
        return null;
      }
      throw new APIError(
        `Failed to fetch progression: ${response.statusText}`,
        response.status,
        "/users/me/progression",
      );
    }

    const data = await response.json();
    // Backend wraps response in { progression: ... }
    const progression: UserProgression = data.progression || data;

    console.log("[API] User progression loaded:", {
      worlds: progression.unlockedWorlds.length,
      availablePoints: progression.availablePoints,
      totalFlights: progression.stats.totalFlights,
    });

    return progression;
  } catch (error) {
    console.warn("[API] Failed to fetch user progression:", error);
    return null;
  }
}

/**
 * Fetch user's current points balance
 */
export async function fetchUserPoints(): Promise<number | null> {
  try {
    const response = await fetchWithTimeout(`${API_URL}/users/me/points`);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    return data.points ?? data.totalPoints ?? null;
  } catch (error) {
    console.warn("[API] Failed to fetch user points:", error);
    return null;
  }
}

/**
 * Unlock response from backend
 */
export interface UnlockResponse {
  success: boolean;
  message?: string;
  newPointsBalance?: number;
  unlockedItem?: string;
}

/**
 * Unlock a world for the user
 * @param worldId - The world ID to unlock
 */
export async function unlockWorld(worldId: string): Promise<UnlockResponse | null> {
  try {
    console.log(`[API] Unlocking world: ${worldId}`);
    const response = await fetchWithTimeout(
      `${API_URL}/users/me/unlocks/worlds`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ worldId }),
      },
      10000,
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.warn(`[API] Failed to unlock world (${response.status}):`, errorText);
      return { success: false, message: errorText };
    }

    const result: UnlockResponse = await response.json();
    console.log("[API] World unlocked:", result);
    return result;
  } catch (error) {
    console.warn("[API] Failed to unlock world:", error);
    return null;
  }
}

/**
 * Unlock a spacecraft for the user
 * @param spacecraftId - The spacecraft ID to unlock
 */
export async function unlockSpacecraft(spacecraftId: string): Promise<UnlockResponse | null> {
  try {
    console.log(`[API] Unlocking spacecraft: ${spacecraftId}`);
    const response = await fetchWithTimeout(
      `${API_URL}/users/me/unlocks/spacecraft`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ spacecraftId }),
      },
      10000,
    );

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      console.warn(`[API] Failed to unlock spacecraft (${response.status}):`, errorText);
      return { success: false, message: errorText };
    }

    const result: UnlockResponse = await response.json();
    console.log("[API] Spacecraft unlocked:", result);
    return result;
  } catch (error) {
    console.warn("[API] Failed to unlock spacecraft:", error);
    return null;
  }
}

// ============================================
// LEADERBOARD API
// ============================================

/**
 * Leaderboard entry
 */
export interface LeaderboardEntry {
  rank: number;
  userId: string;
  displayName?: string;
  score: number;
  worldId?: string;
  landingCount?: number;
  timestamp?: string;
}

/**
 * Leaderboard response
 */
export interface LeaderboardResponse {
  entries: LeaderboardEntry[];
  period: "daily" | "weekly" | "all";
  world?: string;
  totalEntries: number;
}

/**
 * Fetch leaderboard
 * @param options - Filter options (world, period)
 */
export async function fetchLeaderboard(options?: {
  world?: string;
  period?: "daily" | "weekly" | "all";
}): Promise<LeaderboardResponse | null> {
  try {
    const params = new URLSearchParams();
    if (options?.world) params.set("world", options.world);
    if (options?.period) params.set("period", options.period);

    const url = params.toString()
      ? `${API_URL}/leaderboard?${params}`
      : `${API_URL}/leaderboard`;

    console.log("[API] Fetching leaderboard...");
    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      throw new APIError(
        `Failed to fetch leaderboard: ${response.statusText}`,
        response.status,
        "/leaderboard",
      );
    }

    const data: LeaderboardResponse = await response.json();
    console.log(`[API] Leaderboard loaded: ${data.entries.length} entries`);
    return data;
  } catch (error) {
    console.warn("[API] Failed to fetch leaderboard:", error);
    return null;
  }
}

// ============================================
// FLIGHT HISTORY API
// ============================================

/**
 * Fetch a specific flight for replay
 * @param flightId - The flight ID
 */
export async function fetchFlight(flightId: string): Promise<FlightSubmission | null> {
  try {
    const response = await fetchWithTimeout(`${API_URL}/flights/${flightId}`);

    if (!response.ok) {
      if (response.status === 404) return null;
      throw new APIError(
        `Failed to fetch flight: ${response.statusText}`,
        response.status,
        `/flights/${flightId}`,
      );
    }

    return await response.json();
  } catch (error) {
    console.warn(`[API] Failed to fetch flight ${flightId}:`, error);
    return null;
  }
}

/**
 * Fetch user's flight history
 */
export async function fetchFlightHistory(limit?: number): Promise<FlightSubmission[]> {
  try {
    const params = new URLSearchParams();
    if (limit) params.set("limit", limit.toString());

    const url = params.toString()
      ? `${API_URL}/flights?${params}`
      : `${API_URL}/flights`;

    const response = await fetchWithTimeout(url);

    if (!response.ok) {
      return [];
    }

    const data = await response.json();
    return Array.isArray(data) ? data : data.flights || [];
  } catch (error) {
    console.warn("[API] Failed to fetch flight history:", error);
    return [];
  }
}
