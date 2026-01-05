/**
 * Landing Pad Targeting System
 *
 * Functions for evaluating landing pad viability, selecting optimal
 * targets, and computing the landing cone.
 */

import type {
  LanderState,
  GameConfig,
  LandingPad,
  TerrainPoint,
  PadViability,
} from "../types";
import { getAltitude, getTerrainHeightAt, updatePhysics } from "../physics";
import { calculateWrappedDistance, getPadCenter } from "../utils";
import { computeAutopilot } from "./basic";
import type { LandingConeResult, PadSimulationResult } from "./types";

/**
 * Simulate trajectory to a specific pad to determine viability
 *
 * Runs a forward simulation of the autopilot attempting to land on
 * the specified pad. Returns whether landing would succeed and the
 * estimated fuel cost.
 *
 * @param lander - Current lander state
 * @param terrain - Terrain points
 * @param pad - Target landing pad
 * @param config - Game configuration
 * @returns Viability and fuel cost
 */
export function simulateTrajectoryToPad(
  lander: LanderState,
  terrain: TerrainPoint[],
  pad: LandingPad,
  config: GameConfig,
): PadSimulationResult {
  // Clone lander state for simulation
  let simLander: LanderState = {
    ...lander,
    position: { ...lander.position },
    velocity: { ...lander.velocity },
  };

  const startFuel = simLander.fuel;
  const dt = 0.1;
  const maxIterations = 500;

  for (let i = 0; i < maxIterations; i++) {
    // Check for fuel exhaustion
    if (simLander.fuel <= 0) {
      const altitude = getAltitude(simLander.position, terrain, config.width);
      if (altitude < 50 && simLander.velocity.y > config.maxLandingVelocity) {
        return { viable: false, fuelCost: startFuel };
      }
    }

    // Get autopilot command
    const command = computeAutopilot(
      simLander,
      terrain,
      pad,
      config,
      "land",
      "descent",
    );

    // Update physics
    simLander = updatePhysics(
      simLander,
      config,
      command.thrust,
      command.rotation,
      dt,
    );

    // Check for terrain collision
    const terrainY = getTerrainHeightAt(
      terrain,
      simLander.position.x,
      config.width,
    );
    const landerBottom = simLander.position.y + 15;

    if (landerBottom >= terrainY) {
      // Landed - check if successful
      const onPad =
        simLander.position.x >= pad.x1 && simLander.position.x <= pad.x2;
      const speed = Math.sqrt(
        simLander.velocity.x ** 2 + simLander.velocity.y ** 2,
      );
      const angleOk = Math.abs(simLander.rotation) < config.maxLandingAngle;
      const speedOk = speed < config.maxLandingVelocity;

      if (onPad && angleOk && speedOk) {
        return { viable: true, fuelCost: startFuel - simLander.fuel };
      } else {
        return { viable: false, fuelCost: startFuel - simLander.fuel };
      }
    }
  }

  // Simulation timed out
  return { viable: false, fuelCost: startFuel };
}

/**
 * Evaluate viability of all landing pads
 *
 * Runs simulations for each pad to determine which ones can be
 * successfully landed on from the current position.
 *
 * @param lander - Current lander state
 * @param terrain - Terrain points
 * @param pads - All landing pads
 * @param config - Game configuration
 * @returns Viability info for each pad
 */
export function evaluateAllPads(
  lander: LanderState,
  terrain: TerrainPoint[],
  pads: LandingPad[],
  config: GameConfig,
): PadViability[] {
  return pads.map((pad, index) => {
    const padCenter = getPadCenter(pad);
    const distance = calculateWrappedDistance(
      lander.position.x,
      padCenter,
      config.width,
    );

    const result = simulateTrajectoryToPad(lander, terrain, pad, config);

    return {
      padIndex: index,
      viable: result.viable,
      estimatedFuelCost: result.fuelCost,
      distance,
    };
  });
}

/**
 * Select the best target pad
 *
 * Selects a pad that is ahead of the lander in its direction of travel,
 * preferring closer viable pads to conserve fuel.
 *
 * CRITICAL: Must select pads AHEAD of lander in direction of travel.
 * The lander starts in orbit moving at ~120 px/s. We need to pick a pad
 * that is far enough ahead for trajectory planning (~300px minimum).
 *
 * @param viabilities - Viability info for each pad
 * @param pads - All landing pads
 * @param landerX - Current lander X position
 * @param landerVx - Current lander X velocity
 * @param worldWidth - World width for wraparound
 * @param randomize - Whether to randomize among viable candidates
 * @returns Selected pad info
 */
export function selectTargetPad(
  viabilities: PadViability[],
  pads: LandingPad[],
  landerX?: number,
  landerVx?: number,
  worldWidth?: number,
  randomize: boolean = false,
): { pad: LandingPad; index: number; viable: boolean } {
  const result = selectTargetPadWithCone(
    viabilities,
    pads,
    landerX,
    landerVx,
    worldWidth,
    randomize,
  );
  return result.selected;
}

/**
 * Select target pad and return full cone analysis
 *
 * Extended version that also returns the landing cone information
 * for visualization purposes. Excludes occupied pads from selection.
 *
 * @param viabilities - Viability info for each pad
 * @param pads - All landing pads
 * @param landerX - Current lander X position
 * @param landerVx - Current lander X velocity
 * @param worldWidth - World width for wraparound
 * @param randomize - Whether to randomize among viable candidates
 * @returns Selected pad and landing cone info
 */
export function selectTargetPadWithCone(
  viabilities: PadViability[],
  pads: LandingPad[],
  landerX?: number,
  landerVx?: number,
  worldWidth?: number,
  randomize: boolean = false,
): LandingConeResult {
  const defaultResult: LandingConeResult = {
    selected: { pad: pads[0], index: 0, viable: false },
    cone: [],
    minForwardDistance: 0,
    maxForwardDistance: 0,
  };

  if (!pads.length) return defaultResult;

  // Filter out occupied pads - they cannot be landed on
  const availableViabilities = viabilities.filter(
    (v) => !pads[v.padIndex].occupied,
  );

  if (availableViabilities.length === 0) {
    return defaultResult;
  }

  // Fall back to nearest pad if we don't have velocity info
  if (
    landerX === undefined ||
    landerVx === undefined ||
    worldWidth === undefined ||
    Math.abs(landerVx) < 5
  ) {
    const sorted = [...availableViabilities].sort(
      (a, b) => a.distance - b.distance,
    );
    const nearest = sorted[0];
    if (!nearest) {
      return defaultResult;
    }
    return {
      selected: {
        pad: pads[nearest.padIndex],
        index: nearest.padIndex,
        viable: nearest.viable,
      },
      cone: [nearest.padIndex],
      minForwardDistance: 0,
      maxForwardDistance: worldWidth ?? 0,
    };
  }

  // Calculate forward distance for each pad
  const padsWithForwardDistance = availableViabilities.map((v) => {
    const pad = pads[v.padIndex];
    const padCenter = getPadCenter(pad);

    let dx = padCenter - landerX;

    // Normalize for wraparound based on velocity direction
    if (landerVx > 0) {
      if (dx < 0) dx += worldWidth;
    } else {
      if (dx > 0) dx -= worldWidth;
      dx = Math.abs(dx);
    }

    return {
      ...v,
      forwardDistance: dx,
      padCenter,
    };
  });

  // Define the landing cone boundaries
  const minAheadDistance = 300;
  const maxAheadDistance = worldWidth * 0.75;

  // Get pads in the cone
  const conePadIndices = padsWithForwardDistance
    .filter(
      (p) =>
        p.forwardDistance >= minAheadDistance &&
        p.forwardDistance <= maxAheadDistance,
    )
    .map((p) => p.padIndex);

  // Get candidate pads
  let candidates = padsWithForwardDistance.filter(
    (p) =>
      p.forwardDistance >= minAheadDistance &&
      p.forwardDistance <= maxAheadDistance,
  );

  // Fall back to any pad ahead if no candidates in ideal range
  if (candidates.length === 0) {
    candidates = padsWithForwardDistance.filter((p) => p.forwardDistance > 0);
  }

  // Fall back to all available pads if still none
  if (candidates.length === 0) {
    candidates = padsWithForwardDistance;
  }

  // Sort by forward distance (prefer closer)
  candidates.sort((a, b) => a.forwardDistance - b.forwardDistance);

  // Select from candidates
  let selected: (typeof candidates)[0] | undefined;

  if (randomize) {
    if (candidates.length > 1) {
      const randomIndex = Math.floor(Math.random() * candidates.length);
      selected = candidates[randomIndex];
    } else {
      selected = candidates[0];
    }
  } else {
    selected = candidates.find((v) => v.viable) || candidates[0];
  }

  if (!selected) {
    return defaultResult;
  }

  return {
    selected: {
      pad: pads[selected.padIndex],
      index: selected.padIndex,
      viable: selected.viable,
    },
    cone: conePadIndices,
    minForwardDistance: minAheadDistance,
    maxForwardDistance: maxAheadDistance,
  };
}
