/**
 * Flight Logger
 *
 * Records detailed flight telemetry for post-flight analysis.
 * Logs are stored in localStorage and can be exported as JSON.
 */

import type {
  LanderState,
  GameConfig,
  LandingPad,
  FailureReason,
  LandingOutcome,
  GamePhase,
  AutopilotMode,
} from "./types";
import type { WorldId } from "./worlds";

/**
 * Snapshot of lander state at a point in time
 */
export interface TelemetryPoint {
  t: number; // Time since flight start (seconds)
  x: number; // Position X
  y: number; // Position Y
  vx: number; // Velocity X
  vy: number; // Velocity Y
  rot: number; // Rotation (radians)
  fuel: number; // Fuel remaining
  thrust: number; // Thrust level (0-1)
  alt: number; // Altitude above terrain
  phase: GamePhase; // Current game phase
}

/**
 * Complete flight record
 */
export interface FlightRecord {
  // Metadata
  id: string; // Unique flight ID
  timestamp: string; // ISO timestamp of flight start
  worldId: WorldId; // Moon or Mars
  mode: AutopilotMode; // off, stabilize, land, demo

  // Initial conditions
  initial: {
    x: number;
    y: number;
    vx: number;
    vy: number;
    rotation: number;
    fuel: number;
    targetPadIndex: number | null;
    targetPadX: number | null; // Center of target pad
    targetPadWidth: number | null;
  };

  // Flight duration
  duration: number; // Total flight time in seconds
  burnTime: number; // Time from first burn to landing

  // Outcome
  outcome: LandingOutcome | null;
  failureReason: FailureReason;
  landedPadIndex: number | null;

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
    maxSpeed: number; // Maximum speed during descent
    maxDescentRate: number; // Maximum vertical velocity
    maxHorizontalSpeed: number; // Maximum horizontal velocity
    minAltitude: number; // Lowest altitude before landing
    fuelUsed: number; // Total fuel consumed
    horizontalErrorAtTouchdown: number; // Distance from pad center at landing
    verticalSpeedAtTouchdown: number; // Descent rate at landing
    horizontalSpeedAtTouchdown: number; // Horizontal speed at landing
    angleAtTouchdown: number; // Rotation at landing (degrees)
    timeInOrbit: number; // Time spent in orbit phase
    abortAttempts: number; // Number of abort maneuvers
  };

  // Sampled telemetry (every 0.5 seconds)
  telemetry: TelemetryPoint[];
}

/**
 * Flight logger class - tracks a single flight
 */
export class FlightLogger {
  private record: FlightRecord;
  private lastSampleTime: number = 0;
  private sampleInterval: number = 0.5; // Sample every 0.5 seconds
  private firstBurnTime: number | null = null;

  constructor(
    worldId: WorldId,
    mode: AutopilotMode,
    lander: LanderState,
    targetPad: LandingPad | null,
    targetPadIndex: number | null,
  ) {
    this.record = {
      id: this.generateId(),
      timestamp: new Date().toISOString(),
      worldId,
      mode,
      initial: {
        x: lander.position.x,
        y: lander.position.y,
        vx: lander.velocity.x,
        vy: lander.velocity.y,
        rotation: lander.rotation,
        fuel: lander.fuel,
        targetPadIndex,
        targetPadX: targetPad ? (targetPad.x1 + targetPad.x2) / 2 : null,
        targetPadWidth: targetPad ? targetPad.x2 - targetPad.x1 : null,
      },
      duration: 0,
      burnTime: 0,
      outcome: null,
      failureReason: null,
      landedPadIndex: null,
      terminal: {
        x: 0,
        y: 0,
        vx: 0,
        vy: 0,
        rotation: 0,
        fuel: 0,
        speed: 0,
        altitude: 0,
      },
      metrics: {
        maxSpeed: 0,
        maxDescentRate: 0,
        maxHorizontalSpeed: 0,
        minAltitude: Infinity,
        fuelUsed: 0,
        horizontalErrorAtTouchdown: 0,
        verticalSpeedAtTouchdown: 0,
        horizontalSpeedAtTouchdown: 0,
        angleAtTouchdown: 0,
        timeInOrbit: 0,
        abortAttempts: 0,
      },
      telemetry: [],
    };
  }

  private generateId(): string {
    return `flight-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Update logger with current state (called every frame)
   */
  update(
    lander: LanderState,
    altitude: number,
    phase: GamePhase,
    gameTime: number,
  ): void {
    this.record.duration = gameTime;

    // Track first burn
    if (lander.hasBurned && this.firstBurnTime === null) {
      this.firstBurnTime = gameTime;
    }

    // Update metrics
    const speed = Math.sqrt(
      lander.velocity.x ** 2 + lander.velocity.y ** 2,
    );
    this.record.metrics.maxSpeed = Math.max(
      this.record.metrics.maxSpeed,
      speed,
    );
    this.record.metrics.maxDescentRate = Math.max(
      this.record.metrics.maxDescentRate,
      lander.velocity.y,
    );
    this.record.metrics.maxHorizontalSpeed = Math.max(
      this.record.metrics.maxHorizontalSpeed,
      Math.abs(lander.velocity.x),
    );
    this.record.metrics.minAltitude = Math.min(
      this.record.metrics.minAltitude,
      altitude,
    );

    // Track orbit time
    if (phase === "orbit") {
      this.record.metrics.timeInOrbit = gameTime;
    }

    // Sample telemetry at intervals
    if (gameTime - this.lastSampleTime >= this.sampleInterval) {
      this.record.telemetry.push({
        t: gameTime,
        x: Math.round(lander.position.x * 10) / 10,
        y: Math.round(lander.position.y * 10) / 10,
        vx: Math.round(lander.velocity.x * 10) / 10,
        vy: Math.round(lander.velocity.y * 10) / 10,
        rot: Math.round(lander.rotation * 100) / 100,
        fuel: Math.round(lander.fuel * 10) / 10,
        thrust: Math.round(lander.thrust * 100) / 100,
        alt: Math.round(altitude),
        phase,
      });
      this.lastSampleTime = gameTime;
    }
  }

  /**
   * Record abort attempt
   */
  recordAbort(): void {
    this.record.metrics.abortAttempts++;
  }

  /**
   * Finalize the flight record
   */
  finalize(
    lander: LanderState,
    altitude: number,
    outcome: LandingOutcome | null,
    failureReason: FailureReason,
    landedPadIndex: number | null,
  ): FlightRecord {
    const speed = Math.sqrt(
      lander.velocity.x ** 2 + lander.velocity.y ** 2,
    );

    this.record.outcome = outcome;
    this.record.failureReason = failureReason;
    this.record.landedPadIndex = landedPadIndex;

    this.record.terminal = {
      x: lander.position.x,
      y: lander.position.y,
      vx: lander.velocity.x,
      vy: lander.velocity.y,
      rotation: lander.rotation,
      fuel: lander.fuel,
      speed,
      altitude,
    };

    // Calculate final metrics
    this.record.metrics.fuelUsed = this.record.initial.fuel - lander.fuel;
    this.record.metrics.verticalSpeedAtTouchdown = lander.velocity.y;
    this.record.metrics.horizontalSpeedAtTouchdown = lander.velocity.x;
    this.record.metrics.angleAtTouchdown =
      lander.rotation * (180 / Math.PI);

    // Calculate horizontal error from target pad
    if (this.record.initial.targetPadX !== null) {
      this.record.metrics.horizontalErrorAtTouchdown = Math.abs(
        lander.position.x - this.record.initial.targetPadX,
      );
    }

    // Calculate burn time
    if (this.firstBurnTime !== null) {
      this.record.burnTime = this.record.duration - this.firstBurnTime;
    }

    return this.record;
  }

  /**
   * Get current record (for debugging)
   */
  getRecord(): FlightRecord {
    return this.record;
  }
}

/**
 * Flight log storage - persists to localStorage
 */
const STORAGE_KEY = "lunar-lander-flight-logs";
const MAX_STORED_FLIGHTS = 1000;

/**
 * Save a flight record to storage
 */
export function saveFlightRecord(record: FlightRecord): void {
  try {
    const existing = loadFlightRecords();
    existing.push(record);

    // Trim to max size (keep most recent)
    while (existing.length > MAX_STORED_FLIGHTS) {
      existing.shift();
    }

    localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
  } catch (e) {
    console.warn("Failed to save flight record:", e);
  }
}

/**
 * Load all flight records from storage
 */
export function loadFlightRecords(): FlightRecord[] {
  try {
    const data = localStorage.getItem(STORAGE_KEY);
    return data ? JSON.parse(data) : [];
  } catch (e) {
    console.warn("Failed to load flight records:", e);
    return [];
  }
}

/**
 * Export flight records as downloadable JSON file
 */
export function exportFlightRecords(): void {
  const records = loadFlightRecords();
  const blob = new Blob([JSON.stringify(records, null, 2)], {
    type: "application/json",
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `lunar-lander-flights-${new Date().toISOString().split("T")[0]}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

/**
 * Clear all stored flight records
 */
export function clearFlightRecords(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * Get flight statistics summary
 */
export function getFlightStats(): {
  total: number;
  successes: number;
  damaged: number;
  crashed: number;
  successRate: number;
  avgFuelUsed: number;
  avgFlightTime: number;
  byWorld: Record<WorldId, { total: number; successes: number }>;
  byMode: Record<AutopilotMode, { total: number; successes: number }>;
  byFailureReason: Record<string, number>;
} {
  const records = loadFlightRecords();

  const stats = {
    total: records.length,
    successes: 0,
    damaged: 0,
    crashed: 0,
    successRate: 0,
    avgFuelUsed: 0,
    avgFlightTime: 0,
    byWorld: {} as Record<WorldId, { total: number; successes: number }>,
    byMode: {} as Record<AutopilotMode, { total: number; successes: number }>,
    byFailureReason: {} as Record<string, number>,
  };

  if (records.length === 0) return stats;

  let totalFuel = 0;
  let totalTime = 0;

  for (const record of records) {
    // Outcome counts
    if (record.outcome === "success") stats.successes++;
    else if (record.outcome === "damaged") stats.damaged++;
    else if (record.outcome === "crashed") stats.crashed++;

    // Totals
    totalFuel += record.metrics.fuelUsed;
    totalTime += record.duration;

    // By world
    if (!stats.byWorld[record.worldId]) {
      stats.byWorld[record.worldId] = { total: 0, successes: 0 };
    }
    stats.byWorld[record.worldId].total++;
    if (record.outcome === "success") {
      stats.byWorld[record.worldId].successes++;
    }

    // By mode
    if (!stats.byMode[record.mode]) {
      stats.byMode[record.mode] = { total: 0, successes: 0 };
    }
    stats.byMode[record.mode].total++;
    if (record.outcome === "success") {
      stats.byMode[record.mode].successes++;
    }

    // By failure reason
    if (record.failureReason) {
      stats.byFailureReason[record.failureReason] =
        (stats.byFailureReason[record.failureReason] || 0) + 1;
    }
  }

  stats.successRate = (stats.successes / stats.total) * 100;
  stats.avgFuelUsed = totalFuel / stats.total;
  stats.avgFlightTime = totalTime / stats.total;

  return stats;
}
