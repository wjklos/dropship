/**
 * Trajectory Prediction System
 *
 * Simulates forward physics to predict where the lander will land
 * given current state and optional burn parameters.
 *
 * This is the foundation of the GNC (Guidance, Navigation, Control) system.
 */

import type {
  LanderState,
  GameConfig,
  TerrainPoint,
  LandingPad,
} from "./types";
import { getTerrainHeightAt } from "./physics";

/**
 * A point along a predicted trajectory
 */
export interface TrajectoryPoint {
  t: number; // Time from now (seconds)
  x: number; // Position X
  y: number; // Position Y
  vx: number; // Velocity X
  vy: number; // Velocity Y
  alt: number; // Altitude above terrain
}

/**
 * Result of trajectory prediction
 */
export interface TrajectoryPrediction {
  // The predicted trajectory points (for visualization)
  points: TrajectoryPoint[];

  // Impact prediction
  impactPoint: { x: number; y: number } | null;
  impactTime: number; // Seconds until impact
  impactVelocity: number; // Speed at impact
  impactAngle: number; // Trajectory angle at impact (radians from vertical)

  // Landing pad analysis
  closestPad: number | null; // Index of closest pad to impact
  distanceFromPad: number; // Distance from pad center
  onPad: boolean; // Will impact be on a pad?

  // Burn info (if a burn was simulated)
  burnApplied: boolean;
}

/**
 * Parameters for a burn maneuver
 */
export interface BurnParameters {
  startTime: number; // Seconds from now to start burn
  duration: number; // Burn duration in seconds
  throttle: number; // Throttle level 0-1
  angle: number; // Thrust angle (lander rotation) in radians
}

/**
 * Simulate trajectory forward in time
 *
 * @param lander Current lander state
 * @param config Game configuration
 * @param terrain Terrain points
 * @param pads Landing pads
 * @param burn Optional burn to apply during simulation
 * @param maxTime Maximum simulation time (seconds)
 * @param dt Simulation timestep (seconds)
 */
export function predictTrajectory(
  lander: LanderState,
  config: GameConfig,
  terrain: TerrainPoint[],
  pads: LandingPad[],
  burn: BurnParameters | null = null,
  maxTime: number = 60,
  dt: number = 0.1,
): TrajectoryPrediction {
  const points: TrajectoryPoint[] = [];

  // Clone initial state for simulation
  let x = lander.position.x;
  let y = lander.position.y;
  let vx = lander.velocity.x;
  let vy = lander.velocity.y;
  let rotation = lander.rotation;
  let fuel = lander.fuel;

  let t = 0;
  let impacted = false;
  let impactPoint: { x: number; y: number } | null = null;
  let impactTime = maxTime;
  let impactVelocity = 0;
  let impactAngle = 0;

  // Sample interval for trajectory points (don't store every step)
  const sampleInterval = 0.2;
  let lastSample = 0;

  while (t < maxTime && !impacted) {
    // Check if we should apply burn at this time
    let thrust = 0;
    if (
      burn &&
      t >= burn.startTime &&
      t < burn.startTime + burn.duration &&
      fuel > 0
    ) {
      thrust = burn.throttle;
      rotation = burn.angle;
      fuel -= config.fuelConsumption * burn.throttle * dt;
    }

    // Apply physics
    const thrustMag = thrust * config.maxThrust;
    const ax = Math.sin(rotation) * thrustMag;
    const ay = -Math.cos(rotation) * thrustMag + config.gravity;

    vx += ax * dt;
    vy += ay * dt;
    x += vx * dt;
    y += vy * dt;

    // Wrap horizontal position
    if (x < 0) x += config.width;
    if (x > config.width) x -= config.width;

    // Check terrain collision
    const terrainY = getTerrainHeightAt(terrain, x, config.width);
    const landerBottom = y + 15; // Lander bottom offset

    if (landerBottom >= terrainY) {
      impacted = true;
      impactPoint = { x, y: terrainY - 15 };
      impactTime = t;
      impactVelocity = Math.sqrt(vx * vx + vy * vy);
      impactAngle = Math.atan2(vx, vy); // Angle from vertical
    }

    // Sample trajectory point
    if (t - lastSample >= sampleInterval || impacted) {
      const alt = terrainY - y - 15;
      points.push({ t, x, y, vx, vy, alt: Math.max(0, alt) });
      lastSample = t;
    }

    t += dt;
  }

  // If no impact, predict based on last known state
  if (!impacted && points.length > 0) {
    const last = points[points.length - 1];
    impactPoint = { x: last.x, y: last.y };
    impactTime = maxTime;
    impactVelocity = Math.sqrt(last.vx * last.vx + last.vy * last.vy);
  }

  // Find closest pad to impact point
  let closestPad: number | null = null;
  let distanceFromPad = Infinity;
  let onPad = false;

  if (impactPoint) {
    for (let i = 0; i < pads.length; i++) {
      const pad = pads[i];
      const padCenter = (pad.x1 + pad.x2) / 2;

      // Calculate distance with wraparound
      let dx = Math.abs(impactPoint.x - padCenter);
      if (dx > config.width / 2) dx = config.width - dx;

      if (dx < distanceFromPad) {
        distanceFromPad = dx;
        closestPad = i;

        // Check if actually on pad
        const padWidth = pad.x2 - pad.x1;
        onPad = dx <= padWidth / 2;
      }
    }
  }

  return {
    points,
    impactPoint,
    impactTime,
    impactVelocity,
    impactAngle,
    closestPad,
    distanceFromPad,
    onPad,
    burnApplied: burn !== null,
  };
}

/**
 * Extended burn parameters with guidance data
 */
export interface DeorbitSolution {
  // The deorbit burn itself
  burn: BurnParameters;

  // Guidance data
  burnStartX: number; // X position where burn should start
  predictedImpactX: number; // Where we'll land after the burn
  horizontalErrorAtImpact: number; // Error from pad center

  // Quality metrics
  fuelCost: number; // Estimated fuel consumption
  confidence: number; // 0-1, how confident we are in this solution
  reason: string; // Why this solution was chosen

  // For visualization
  trajectoryAfterBurn: TrajectoryPrediction | null;
}

/**
 * Calculate the optimal deorbit burn to land on a specific pad
 *
 * This solves: "What burn parameters will land me on pad X?"
 *
 * Strategy:
 * 1. Calculate time-to-pad accounting for wraparound
 * 2. Estimate fall time from orbital altitude
 * 3. Binary search for optimal burn timing
 * 4. Validate with trajectory simulation
 *
 * The deorbit burn is a RETROGRADE burn that:
 * - Kills most horizontal velocity
 * - Initiates a near-vertical descent
 * - Lands on or very close to target pad
 *
 * CRITICAL: The key insight is that after the deorbit burn, the lander
 * will still drift horizontally during the fall due to:
 * 1. Residual horizontal velocity (burn doesn't kill 100%)
 * 2. Any lateral component from thrust angle errors
 *
 * We need to account for this "coast drift" when choosing when to burn.
 */
export function calculateDeorbitBurn(
  lander: LanderState,
  config: GameConfig,
  terrain: TerrainPoint[],
  pads: LandingPad[],
  targetPad: LandingPad,
): DeorbitSolution | null {
  const padCenter = (targetPad.x1 + targetPad.x2) / 2;
  const padWidth = targetPad.x2 - targetPad.x1;

  // Current state
  const x0 = lander.position.x;
  const y0 = lander.position.y;
  const vx0 = lander.velocity.x;
  const vy0 = lander.velocity.y;

  // If no horizontal velocity, we can't plan a meaningful deorbit
  if (Math.abs(vx0) < 1) {
    return null;
  }

  // Calculate time to reach pad center accounting for wraparound
  // Always travel in direction of current velocity
  const timeToTarget = calculateTimeToTarget(x0, vx0, padCenter, config.width);

  // If target is behind us (>1 orbit away), return null to signal waiting
  if (timeToTarget > 120) {
    return null;
  }

  // Estimate fall time from current altitude
  const altitude = config.height - y0 - 100; // Approximate terrain offset
  const baseFallTime = Math.sqrt((2 * altitude) / config.gravity);

  // The deorbit burn needs to kill horizontal velocity
  // Burn angle: retrograde (opposite to velocity)
  // Physics: sin(rotation) * thrust = x acceleration
  // If moving right (vx > 0), need thrust LEFT (negative x), so sin(r) < 0, so r = -π/2
  // If moving left (vx < 0), need thrust RIGHT (positive x), so sin(r) > 0, so r = +π/2
  const burnAngle = vx0 > 0 ? -Math.PI / 2 : Math.PI / 2;

  // Calculate burn duration to kill all horizontal velocity
  // With thrust at angle, effective horizontal deceleration = maxThrust * sin(angle) = maxThrust
  const effectiveDecel = config.maxThrust * 0.85; // Use 85% for safety margin
  const burnDuration = Math.abs(vx0) / effectiveDecel;

  // Calculate the drift distance during burn
  // While burning, lander travels horizontally: avg_vx * burnDuration / 2 (since vx goes from vx0 to ~0)
  const driftDuringBurn = (vx0 * burnDuration) / 2;

  // After burn, estimate residual velocity (not perfectly zero due to throttle level)
  const residualVx = vx0 * 0.05; // ~5% residual horizontal velocity

  // Calculate drift during coast (from burn end to landing)
  // Use conservative fall time estimate
  const coastTime = baseFallTime * 1.5;
  const driftDuringCoast = residualVx * coastTime;

  // Total expected drift from burn start to landing
  const totalDrift = driftDuringBurn + driftDuringCoast;

  // Binary search for optimal burn start time
  // We want to find t such that we land on the pad
  // Expanded search range to account for drift uncertainty
  const solution = binarySearchBurnTiming(
    lander,
    config,
    terrain,
    pads,
    targetPad,
    burnAngle,
    burnDuration,
    0, // Min start time (now)
    Math.max(0, timeToTarget), // Max start time - full time to target
  );

  return solution;
}

/**
 * Calculate time to reach a target X position accounting for wraparound
 */
function calculateTimeToTarget(
  currentX: number,
  velocityX: number,
  targetX: number,
  worldWidth: number,
): number {
  if (velocityX === 0) return Infinity;

  // Calculate distance in direction of travel
  let distance = targetX - currentX;

  // Adjust for wraparound based on velocity direction
  if (velocityX > 0) {
    // Moving right
    if (distance < 0) {
      // Target is behind us, need to wrap around
      distance += worldWidth;
    }
  } else {
    // Moving left
    if (distance > 0) {
      // Target is behind us, need to wrap around
      distance -= worldWidth;
    }
    distance = Math.abs(distance);
  }

  return distance / Math.abs(velocityX);
}

/**
 * Binary search for optimal burn timing
 *
 * Searches for the burn start time that minimizes landing error
 * Uses iterative refinement to find precise timing
 */
function binarySearchBurnTiming(
  lander: LanderState,
  config: GameConfig,
  terrain: TerrainPoint[],
  pads: LandingPad[],
  targetPad: LandingPad,
  burnAngle: number,
  burnDuration: number,
  minTime: number,
  maxTime: number,
  iterations: number = 12,
): DeorbitSolution | null {
  const padCenter = (targetPad.x1 + targetPad.x2) / 2;
  const padHalfWidth = (targetPad.x2 - targetPad.x1) / 2;

  let bestSolution: DeorbitSolution | null = null;
  let bestError = Infinity;

  // PHASE 1: Coarse sampling across entire time range
  // Use more samples for better coverage
  const numSamples = 40;

  for (let i = 0; i <= numSamples; i++) {
    const startTime = minTime + (maxTime - minTime) * (i / numSamples);

    const burn: BurnParameters = {
      startTime,
      duration: burnDuration,
      throttle: 0.85,
      angle: burnAngle,
    };

    // Simulate trajectory with this burn
    const prediction = predictTrajectory(
      lander,
      config,
      terrain,
      pads,
      burn,
      60, // Max simulation time
      0.05, // Fine timestep
    );

    if (!prediction.impactPoint) continue;

    // Calculate landing error (with wraparound)
    let error = prediction.impactPoint.x - padCenter;
    if (Math.abs(error) > config.width / 2) {
      error = error > 0 ? error - config.width : error + config.width;
    }
    const absError = Math.abs(error);

    // Calculate burn start position
    let burnStartX =
      (lander.position.x + lander.velocity.x * startTime) % config.width;
    if (burnStartX < 0) burnStartX += config.width;

    // Estimate fuel cost
    const fuelCost = config.fuelConsumption * burn.throttle * burnDuration;

    if (absError < bestError) {
      bestError = absError;
      bestSolution = {
        burn,
        burnStartX,
        predictedImpactX: prediction.impactPoint.x,
        horizontalErrorAtImpact: error,
        fuelCost,
        confidence: absError < padHalfWidth ? 1.0 : padHalfWidth / absError,
        reason:
          absError < padHalfWidth
            ? "on_target"
            : `error_${absError.toFixed(0)}px`,
        trajectoryAfterBurn: prediction,
      };
    }
  }

  // PHASE 2: If we found a solution, refine it with binary search
  if (bestSolution && bestError > 5) {
    // Binary search refinement around the best solution
    const refinedSolution = refineBurnTiming(
      lander,
      config,
      terrain,
      pads,
      targetPad,
      bestSolution.burn,
      bestError,
    );
    if (
      refinedSolution &&
      Math.abs(refinedSolution.horizontalErrorAtImpact) < bestError
    ) {
      return refinedSolution;
    }
  }

  return bestSolution;
}

/**
 * Refine burn timing around an initial solution
 */
function refineBurnTiming(
  lander: LanderState,
  config: GameConfig,
  terrain: TerrainPoint[],
  pads: LandingPad[],
  targetPad: LandingPad,
  initialBurn: BurnParameters,
  initialError: number,
): DeorbitSolution | null {
  const padCenter = (targetPad.x1 + targetPad.x2) / 2;
  const padHalfWidth = (targetPad.x2 - targetPad.x1) / 2;

  let bestBurn = initialBurn;
  let bestError = initialError;

  // Search range: ±2 seconds around initial solution
  const searchRange = 2.0;
  const numSteps = 20;

  for (let i = 0; i <= numSteps; i++) {
    const timeOffset = -searchRange + (2 * searchRange * i) / numSteps;
    const testStartTime = Math.max(0, initialBurn.startTime + timeOffset);

    const burn: BurnParameters = {
      ...initialBurn,
      startTime: testStartTime,
    };

    const prediction = predictTrajectory(
      lander,
      config,
      terrain,
      pads,
      burn,
      60,
      0.05,
    );

    if (!prediction.impactPoint) continue;

    let error = prediction.impactPoint.x - padCenter;
    if (Math.abs(error) > config.width / 2) {
      error = error > 0 ? error - config.width : error + config.width;
    }

    if (Math.abs(error) < bestError) {
      bestError = Math.abs(error);
      bestBurn = burn;
    }
  }

  // Return refined solution
  const finalPrediction = predictTrajectory(
    lander,
    config,
    terrain,
    pads,
    bestBurn,
    60,
    0.05,
  );

  if (!finalPrediction.impactPoint) return null;

  let finalError = finalPrediction.impactPoint.x - padCenter;
  if (Math.abs(finalError) > config.width / 2) {
    finalError =
      finalError > 0 ? finalError - config.width : finalError + config.width;
  }

  const burnStartX =
    (lander.position.x + lander.velocity.x * bestBurn.startTime) % config.width;

  return {
    burn: bestBurn,
    burnStartX: burnStartX < 0 ? burnStartX + config.width : burnStartX,
    predictedImpactX: finalPrediction.impactPoint.x,
    horizontalErrorAtImpact: finalError,
    fuelCost: config.fuelConsumption * bestBurn.throttle * bestBurn.duration,
    confidence:
      Math.abs(finalError) < padHalfWidth
        ? 1.0
        : padHalfWidth / Math.abs(finalError),
    reason:
      Math.abs(finalError) < padHalfWidth
        ? "refined_on_target"
        : `refined_error_${Math.abs(finalError).toFixed(0)}px`,
    trajectoryAfterBurn: finalPrediction,
  };
}

/**
 * Terminal guidance solution - the final landing burn
 */
export interface TerminalGuidance {
  // When to start the terminal burn
  burnAltitude: number;
  burnStartTime: number; // Seconds from now (based on current descent rate)

  // Burn parameters
  burnDuration: number;
  throttle: number;

  // Thrust vector guidance
  targetAngle: number; // Where to point (radians, 0 = up)
  horizontalCorrection: number; // Tilt needed to correct position error

  // State at burn start
  expectedVelocityAtBurn: number;
  expectedAltitudeError: number; // How far off the pad we'll be

  // Safety margins
  safetyMargin: number; // Extra altitude buffer (percentage)
  fuelRequired: number;
}

/**
 * Calculate suicide burn parameters for terminal descent
 *
 * This is the final braking burn to zero velocity at touchdown.
 * Uses the "suicide burn" approach - burn as late as possible, as hard as possible.
 *
 * Enhanced version that accounts for:
 * - Horizontal velocity (needs tilt to correct)
 * - Position error from pad center
 * - Safety margins
 * - Fuel requirements
 */
export function calculateSuicideBurn(
  altitude: number,
  verticalVelocity: number,
  horizontalVelocity: number,
  horizontalError: number, // Distance from pad center (signed)
  maxThrust: number,
  gravity: number,
  fuelConsumption: number,
): TerminalGuidance {
  // Total velocity magnitude
  const totalVelocity = Math.sqrt(
    verticalVelocity ** 2 + horizontalVelocity ** 2,
  );

  // Net deceleration when thrusting vertically (thrust minus gravity)
  const netVerticalDecel = maxThrust - gravity;

  // If we have horizontal error, we need to tilt to correct it
  // Calculate required horizontal acceleration to zero out error during descent
  // Time to ground at current vertical velocity (rough estimate)
  const timeToGround = verticalVelocity > 0 ? altitude / verticalVelocity : 10;

  // Required horizontal velocity change to reach pad
  // We want to arrive at pad with zero horizontal velocity
  // So we need to: 1) cancel current horizontal velocity, 2) move toward pad
  const requiredHorizontalDeltaV =
    -horizontalVelocity + (horizontalError / Math.max(1, timeToGround)) * 0.5;

  // Calculate tilt angle needed for horizontal correction
  // tan(angle) = horizontal_accel / vertical_accel
  // Keep tilt small for safety
  const maxTilt = 0.25; // ~15 degrees max
  let targetAngle = Math.atan2(
    requiredHorizontalDeltaV * 0.1,
    netVerticalDecel,
  );
  targetAngle = Math.max(-maxTilt, Math.min(maxTilt, targetAngle));

  // Effective vertical deceleration when tilted
  const effectiveVerticalDecel = netVerticalDecel * Math.cos(targetAngle);

  // Time to zero vertical velocity: t = v / a
  const burnDuration = verticalVelocity / effectiveVerticalDecel;

  // Distance traveled during constant deceleration burn
  // Using: d = v*t - 0.5*a*t²
  // But we're decelerating, so: d = v*t - 0.5*a*t²
  // At constant thrust: final_v = v - a*t, so t = v/a
  // Distance = v * (v/a) - 0.5 * a * (v/a)² = v²/a - 0.5*v²/a = 0.5*v²/a
  const burnDistance =
    (verticalVelocity * verticalVelocity) / (2 * effectiveVerticalDecel);

  // Safety margin: start burn earlier to account for uncertainties
  const safetyMarginPercent = 0.15; // 15% safety margin
  const safetyBuffer = burnDistance * safetyMarginPercent;
  const burnAltitude = burnDistance + safetyBuffer + 5; // +5 for ground clearance

  // Time until we reach burn altitude
  const burnStartTime = (altitude - burnAltitude) / verticalVelocity;

  // Fuel required for the burn
  const fuelRequired = fuelConsumption * 1.0 * burnDuration * 1.1; // 10% fuel margin

  return {
    burnAltitude: Math.max(10, burnAltitude),
    burnStartTime: Math.max(0, burnStartTime),
    burnDuration,
    throttle: 1.0, // Full throttle for suicide burn
    targetAngle,
    horizontalCorrection: targetAngle,
    expectedVelocityAtBurn: verticalVelocity, // Velocity won't change much before burn
    expectedAltitudeError: Math.abs(horizontalError),
    safetyMargin: safetyMarginPercent,
    fuelRequired,
  };
}

/**
 * Complete two-burn landing solution
 * Combines deorbit burn + terminal suicide burn
 */
export interface TwoBurnSolution {
  // Phase 1: Deorbit burn
  deorbit: DeorbitSolution | null;

  // Phase 2: Terminal burn (calculated based on post-deorbit trajectory)
  terminal: TerminalGuidance | null;

  // Overall solution quality
  viable: boolean;
  totalFuelCost: number;
  confidence: number;
  reason: string;
}

/**
 * Calculate complete two-burn landing solution
 *
 * This is the master function that computes:
 * 1. Optimal deorbit burn to get on trajectory to pad
 * 2. Terminal suicide burn to land safely
 */
export function calculateTwoBurnSolution(
  lander: LanderState,
  config: GameConfig,
  terrain: TerrainPoint[],
  pads: LandingPad[],
  targetPad: LandingPad,
): TwoBurnSolution {
  const padCenter = (targetPad.x1 + targetPad.x2) / 2;

  // Calculate deorbit burn
  const deorbit = calculateDeorbitBurn(
    lander,
    config,
    terrain,
    pads,
    targetPad,
  );

  if (!deorbit) {
    // No deorbit solution - either we need to wait or can't reach this pad
    return {
      deorbit: null,
      terminal: null,
      viable: false,
      totalFuelCost: 0,
      confidence: 0,
      reason: "no_deorbit_solution",
    };
  }

  // If deorbit solution has a predicted trajectory, calculate terminal burn
  // based on the state at the end of the deorbit coast phase
  let terminal: TerminalGuidance | null = null;

  if (deorbit.trajectoryAfterBurn) {
    const prediction = deorbit.trajectoryAfterBurn;

    // Find state when altitude drops below terminal burn threshold (~200px)
    const terminalThreshold = 200;
    const terminalPoint = prediction.points.find(
      (p) => p.alt <= terminalThreshold,
    );

    if (terminalPoint) {
      // Calculate terminal burn from this point
      terminal = calculateSuicideBurn(
        terminalPoint.alt,
        terminalPoint.vy,
        terminalPoint.vx,
        deorbit.horizontalErrorAtImpact,
        config.maxThrust,
        config.gravity,
        config.fuelConsumption,
      );
    } else if (prediction.impactPoint) {
      // Fallback: calculate from impact prediction
      const lastPoint = prediction.points[prediction.points.length - 1];
      terminal = calculateSuicideBurn(
        lastPoint?.alt ?? 100,
        lastPoint?.vy ?? 30,
        lastPoint?.vx ?? 0,
        deorbit.horizontalErrorAtImpact,
        config.maxThrust,
        config.gravity,
        config.fuelConsumption,
      );
    }
  }

  // Calculate total fuel cost
  const totalFuelCost = deorbit.fuelCost + (terminal?.fuelRequired ?? 20);

  // Determine overall viability
  const hasEnoughFuel = lander.fuel >= totalFuelCost * 1.2; // 20% margin
  const padHalfWidth = (targetPad.x2 - targetPad.x1) / 2;
  const onTarget = Math.abs(deorbit.horizontalErrorAtImpact) < padHalfWidth;

  const viable = hasEnoughFuel && deorbit.confidence > 0.5;

  return {
    deorbit,
    terminal,
    viable,
    totalFuelCost,
    confidence: deorbit.confidence * (hasEnoughFuel ? 1.0 : 0.5),
    reason: viable
      ? onTarget
        ? "solution_found"
        : "solution_marginal"
      : hasEnoughFuel
        ? "low_confidence"
        : "insufficient_fuel",
  };
}

/**
 * Find the optimal insertion window for a target pad
 *
 * Returns the time (in seconds) until the optimal deorbit burn window opens.
 * Returns 0 if the window is open now.
 * Returns -1 if the pad is not reachable (shouldn't happen with wraparound).
 */
export function findInsertionWindow(
  lander: LanderState,
  config: GameConfig,
  terrain: TerrainPoint[],
  targetPad: LandingPad,
): { windowOpensIn: number; optimalBurnPoint: number } {
  const padCenter = (targetPad.x1 + targetPad.x2) / 2;
  const vx = lander.velocity.x;

  if (vx === 0)
    return { windowOpensIn: -1, optimalBurnPoint: lander.position.x };

  // Estimate fall time
  const alt = config.height - lander.position.y;
  const fallTime = Math.sqrt((2 * alt) / config.gravity) * 1.3;

  // Calculate how far we'll drift during fall
  // After deorbit burn, we'll have reduced but not zero horizontal velocity
  // Estimate residual velocity as 10% of current
  const residualVx = vx * 0.1;
  const driftDuringFall = residualVx * fallTime;

  // Optimal burn point: where we need to be when we start deorbit burn
  const optimalBurnPoint = padCenter - driftDuringFall;

  // Normalize to world bounds
  let normalizedBurnPoint = optimalBurnPoint;
  while (normalizedBurnPoint < 0) normalizedBurnPoint += config.width;
  while (normalizedBurnPoint > config.width)
    normalizedBurnPoint -= config.width;

  // Calculate distance to optimal burn point
  let distanceToBurnPoint = normalizedBurnPoint - lander.position.x;

  // Handle wraparound - always travel in direction of velocity
  if (vx > 0 && distanceToBurnPoint < 0) {
    distanceToBurnPoint += config.width;
  } else if (vx < 0 && distanceToBurnPoint > 0) {
    distanceToBurnPoint -= config.width;
  }

  const timeToWindow = Math.abs(distanceToBurnPoint / vx);

  return {
    windowOpensIn: timeToWindow,
    optimalBurnPoint: normalizedBurnPoint,
  };
}

/**
 * Generate trajectory path segments for visualization
 * Handles wraparound by creating separate path segments
 * Returns an array of SVG path strings (one per continuous segment)
 */
export function getTrajectorySegments(
  prediction: TrajectoryPrediction,
  worldWidth: number,
): string[] {
  if (prediction.points.length < 2) return [];

  const segments: string[] = [];
  let currentSegment = `M ${prediction.points[0].x} ${prediction.points[0].y}`;

  for (let i = 1; i < prediction.points.length; i++) {
    const prev = prediction.points[i - 1];
    const curr = prediction.points[i];

    // Detect wraparound: if x jumps by more than half the world width
    const dx = curr.x - prev.x;
    if (Math.abs(dx) > worldWidth / 2) {
      // Wraparound occurred - end current segment and start new one
      segments.push(currentSegment);
      currentSegment = `M ${curr.x} ${curr.y}`;
    } else {
      currentSegment += ` L ${curr.x} ${curr.y}`;
    }
  }

  // Don't forget the last segment
  segments.push(currentSegment);

  return segments;
}

/**
 * Generate trajectory points for visualization
 * Returns a simplified path suitable for SVG rendering
 * @deprecated Use getTrajectorySegments instead for proper wraparound handling
 */
export function getTrajectoryPath(prediction: TrajectoryPrediction): string {
  if (prediction.points.length < 2) return "";

  let path = `M ${prediction.points[0].x} ${prediction.points[0].y}`;

  for (let i = 1; i < prediction.points.length; i++) {
    const p = prediction.points[i];
    path += ` L ${p.x} ${p.y}`;
  }

  return path;
}

/**
 * Real-time guidance state for the autopilot
 * Updated every frame during descent
 */
export interface GuidanceState {
  // Current phase
  phase:
    | "coast"
    | "deorbit_burn"
    | "coast_to_terminal"
    | "terminal_burn"
    | "landed";

  // Commands for this frame
  shouldThrust: boolean;
  targetThrottle: number;
  targetAngle: number;

  // Status info
  timeToNextBurn: number;
  distanceToTarget: number;
  predictedLandingError: number;

  // Debug info
  reason: string;
}

/**
 * Calculate real-time guidance commands during descent
 *
 * This is called every frame to provide guidance to the autopilot.
 * It uses the pre-computed two-burn solution and tracks progress through the phases.
 */
export function calculateRealTimeGuidance(
  lander: LanderState,
  config: GameConfig,
  terrain: TerrainPoint[],
  pads: LandingPad[],
  targetPad: LandingPad,
  solution: TwoBurnSolution | null,
  altitude: number,
): GuidanceState {
  const padCenter = (targetPad.x1 + targetPad.x2) / 2;

  // Calculate current horizontal error
  let horizontalError = padCenter - lander.position.x;
  if (Math.abs(horizontalError) > config.width / 2) {
    horizontalError =
      horizontalError > 0
        ? horizontalError - config.width
        : horizontalError + config.width;
  }

  // Default: coast (no thrust, stay upright)
  const defaultGuidance: GuidanceState = {
    phase: "coast",
    shouldThrust: false,
    targetThrottle: 0,
    targetAngle: 0,
    timeToNextBurn: Infinity,
    distanceToTarget: Math.abs(horizontalError),
    predictedLandingError: Math.abs(horizontalError),
    reason: "default_coast",
  };

  // If no solution, return default
  if (!solution || !solution.viable) {
    return { ...defaultGuidance, reason: "no_solution" };
  }

  // Determine current phase based on altitude and burn timing
  const deorbit = solution.deorbit;
  const terminal = solution.terminal;

  // PHASE 1: Waiting for deorbit burn
  if (deorbit && deorbit.burn.startTime > 0.5) {
    // Still coasting toward deorbit burn point
    return {
      phase: "coast",
      shouldThrust: false,
      targetThrottle: 0,
      targetAngle: lander.velocity.x > 0 ? Math.PI / 2 : -Math.PI / 2, // Pre-orient retrograde
      timeToNextBurn: deorbit.burn.startTime,
      distanceToTarget: Math.abs(horizontalError),
      predictedLandingError: Math.abs(deorbit.horizontalErrorAtImpact),
      reason: "waiting_for_deorbit",
    };
  }

  // PHASE 2: Executing deorbit burn
  if (
    deorbit &&
    deorbit.burn.startTime <= 0.5 &&
    Math.abs(lander.velocity.x) > 5
  ) {
    // Time to execute deorbit burn - kill horizontal velocity
    return {
      phase: "deorbit_burn",
      shouldThrust: true,
      targetThrottle: deorbit.burn.throttle,
      targetAngle: deorbit.burn.angle,
      timeToNextBurn: 0,
      distanceToTarget: Math.abs(horizontalError),
      predictedLandingError: Math.abs(deorbit.horizontalErrorAtImpact),
      reason: "executing_deorbit",
    };
  }

  // PHASE 3: Coasting to terminal burn
  if (terminal && altitude > terminal.burnAltitude) {
    // Coasting down, waiting for terminal burn altitude
    // Calculate time to terminal burn
    const timeToTerminal =
      lander.velocity.y > 0
        ? (altitude - terminal.burnAltitude) / lander.velocity.y
        : Infinity;

    // Small corrections allowed during coast
    const correctionAngle = Math.max(
      -0.15,
      Math.min(0.15, horizontalError * 0.002 - lander.velocity.x * 0.02),
    );

    return {
      phase: "coast_to_terminal",
      shouldThrust: false,
      targetThrottle: 0,
      targetAngle: correctionAngle,
      timeToNextBurn: timeToTerminal,
      distanceToTarget: Math.abs(horizontalError),
      predictedLandingError: Math.abs(
        horizontalError + lander.velocity.x * timeToTerminal * 0.5,
      ),
      reason: "coast_to_terminal",
    };
  }

  // PHASE 4: Terminal burn (suicide burn)
  if (terminal && altitude <= terminal.burnAltitude && altitude > 5) {
    // Executing terminal burn
    // Calculate required thrust angle for horizontal correction
    const correctionAngle = terminal.targetAngle;

    // Modulate throttle based on descent rate
    // Full throttle if descending fast, reduce as we slow down
    const targetDescentRate = Math.max(2, altitude * 0.1); // Slower as we get lower
    const descentError = lander.velocity.y - targetDescentRate;
    const throttle = descentError > 5 ? 1.0 : descentError > 0 ? 0.7 : 0.3;

    return {
      phase: "terminal_burn",
      shouldThrust: true,
      targetThrottle: throttle,
      targetAngle: correctionAngle,
      timeToNextBurn: 0,
      distanceToTarget: Math.abs(horizontalError),
      predictedLandingError: Math.abs(horizontalError),
      reason: "terminal_burn",
    };
  }

  // PHASE 5: Landed or very close
  if (altitude <= 5) {
    return {
      phase: "landed",
      shouldThrust: lander.velocity.y > 3, // Tiny thrust to cushion
      targetThrottle: 0.3,
      targetAngle: 0,
      timeToNextBurn: 0,
      distanceToTarget: Math.abs(horizontalError),
      predictedLandingError: Math.abs(horizontalError),
      reason: "final_touchdown",
    };
  }

  return defaultGuidance;
}
