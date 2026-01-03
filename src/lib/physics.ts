import type {
  LanderState,
  GameConfig,
  Vec2,
  TerrainPoint,
  LandingPad,
  CollisionResult,
  FailureReason,
  LandingOutcome,
} from "./types";

/**
 * Update lander physics for one timestep
 * Implements gravity gating - no gravity until first thrust (orbital mechanics)
 *
 * ORBITAL MECHANICS:
 * - Before first burn: stable orbit (constant altitude, can rotate freely)
 * - After first burn: normal physics with gravity
 */
export function updatePhysics(
  lander: LanderState,
  config: GameConfig,
  thrustInput: number, // 0-1
  rotationInput: number, // -1 to 1
  dt: number,
): LanderState {
  if (!lander.alive || lander.landed) {
    return lander;
  }

  // Clone state
  const next: LanderState = {
    ...lander,
    position: { ...lander.position },
    velocity: { ...lander.velocity },
  };

  // Track first burn - once thrust is applied, gravity kicks in
  if (thrustInput > 0 && next.fuel > 0 && !next.hasBurned) {
    next.hasBurned = true;
  }

  // Update rotation (always allowed, even in orbit)
  next.angularVelocity += rotationInput * config.rotationSpeed * dt;
  next.angularVelocity *= 0.95; // Angular damping
  next.rotation += next.angularVelocity * dt;

  // Normalize rotation to -PI to PI
  while (next.rotation > Math.PI) next.rotation -= 2 * Math.PI;
  while (next.rotation < -Math.PI) next.rotation += 2 * Math.PI;

  // ORBITAL MODE: Before first burn, maintain stable orbit
  if (!next.hasBurned) {
    // In orbit: maintain constant altitude, constant horizontal velocity
    // Only rotation changes - no thrust, no gravity, no position change except horizontal drift
    next.position.x += next.velocity.x * dt;

    // Wrap horizontal position
    if (next.position.x < 0) next.position.x += config.width;
    if (next.position.x > config.width) next.position.x -= config.width;

    // Altitude stays constant (no vertical velocity change)
    next.velocity.y = 0;
    next.thrust = 0;

    return next;
  }

  // DESCENT MODE: Normal physics after first burn

  // Calculate thrust (only if fuel available)
  const actualThrust = next.fuel > 0 ? thrustInput * config.maxThrust : 0;
  next.thrust = actualThrust / config.maxThrust;

  // Consume fuel
  if (actualThrust > 0) {
    next.fuel = Math.max(
      0,
      next.fuel - config.fuelConsumption * thrustInput * dt,
    );
  }

  // Thrust vector (opposite to flame direction)
  // Flame points "down" in lander-local coords (+Y in local space)
  // When rotation=0 (upright): thrust is pure -Y (up)
  // When rotation>0 (tilted right): thrust has +X component (pushes right)
  const thrustVec: Vec2 = {
    x: Math.sin(next.rotation) * actualThrust,
    y: -Math.cos(next.rotation) * actualThrust,
  };

  // Apply forces (thrust + gravity)
  next.velocity.x += thrustVec.x * dt;
  next.velocity.y += (thrustVec.y + config.gravity) * dt;

  // Update position
  next.position.x += next.velocity.x * dt;
  next.position.y += next.velocity.y * dt;

  // Wrap horizontal position
  if (next.position.x < 0) next.position.x += config.width;
  if (next.position.x > config.width) next.position.x -= config.width;

  // Keep in world bounds vertically
  if (next.position.y < 0) {
    next.position.y = 0;
    next.velocity.y = Math.max(0, next.velocity.y);
  }

  return next;
}

/**
 * Check collision with terrain using dual-leg detection
 * Both legs must be on the same pad for successful landing
 */
export function checkTerrainCollision(
  lander: LanderState,
  terrain: TerrainPoint[],
  landingPads: LandingPad[],
  config: GameConfig,
): CollisionResult {
  const LEG_SPAN = config.legSpan || 20;
  const LANDER_BOTTOM_OFFSET = 15;

  // Calculate leg positions (accounting for rotation)
  const cosR = Math.cos(lander.rotation);
  const sinR = Math.sin(lander.rotation);

  // Center position
  const cx = lander.position.x;
  const cy = lander.position.y;

  // Left leg position (rotated -LEG_SPAN from center)
  const leftLegX = cx - LEG_SPAN * cosR;
  const leftLegY = cy + LANDER_BOTTOM_OFFSET + LEG_SPAN * Math.abs(sinR);

  // Right leg position (rotated +LEG_SPAN from center)
  const rightLegX = cx + LEG_SPAN * cosR;
  const rightLegY = cy + LANDER_BOTTOM_OFFSET + LEG_SPAN * Math.abs(sinR);

  // Center bottom (for backward compatibility)
  const centerY = cy + LANDER_BOTTOM_OFFSET;

  // Get terrain height at each position
  const leftTerrainY = getTerrainHeightAt(terrain, leftLegX, config.width);
  const rightTerrainY = getTerrainHeightAt(terrain, rightLegX, config.width);
  const centerTerrainY = getTerrainHeightAt(terrain, cx, config.width);

  // Check if each leg is on a pad and get pad surface height
  const leftPadIndex = findPadAtX(leftLegX, landingPads);
  const rightPadIndex = findPadAtX(rightLegX, landingPads);

  // Use pad surface height if on a pad, otherwise terrain height
  // Pad surface is slightly above terrain (pad.y is the top of the pad)
  const leftSurfaceY =
    leftPadIndex !== null
      ? landingPads[leftPadIndex].y - 3 // Pad is 3px tall, land on top
      : leftTerrainY;
  const rightSurfaceY =
    rightPadIndex !== null ? landingPads[rightPadIndex].y - 3 : rightTerrainY;
  const centerSurfaceY = centerTerrainY;

  // Check for collision (either leg touching surface)
  const leftCollision = leftLegY >= leftSurfaceY;
  const rightCollision = rightLegY >= rightSurfaceY;
  const centerCollision = centerY >= centerSurfaceY;

  // No collision yet
  if (!leftCollision && !rightCollision && !centerCollision) {
    return {
      collision: false,
      outcome: null,
      landedPadIndex: null,
      terrainY: centerTerrainY,
      failureReason: null,
    };
  }

  // Collision occurred - determine outcome
  const speed = Math.sqrt(lander.velocity.x ** 2 + lander.velocity.y ** 2);
  const angleOk = Math.abs(lander.rotation) < config.maxLandingAngle;
  const speedOk = speed < config.maxLandingVelocity;

  // Check fuel status
  const outOfFuel = lander.fuel <= 0;

  // Both legs must be on the SAME pad for success
  const bothLegsOnSamePad =
    leftPadIndex !== null &&
    rightPadIndex !== null &&
    leftPadIndex === rightPadIndex;

  let outcome: LandingOutcome;
  let failureReason: FailureReason = null;
  let landedPadIndex: number | null = null;

  if (!speedOk) {
    outcome = "crashed";
    failureReason = "VELOCITY_HIGH";
  } else if (!angleOk) {
    outcome = "crashed";
    failureReason = "ANGLE_BAD";
  } else if (bothLegsOnSamePad) {
    // Perfect landing - both legs on pad, good speed and angle
    outcome = "success";
    landedPadIndex = leftPadIndex;
  } else if (speedOk && angleOk) {
    // Met velocity/angle criteria but not both legs on same pad
    // This is a DAMAGED landing
    outcome = "damaged";
    failureReason = "DAMAGED";
  } else {
    outcome = "crashed";
    failureReason = "OFF_PAD";
  }

  // Check if out of fuel was the root cause
  if (outOfFuel && outcome === "crashed" && !failureReason) {
    failureReason = "OUT_OF_FUEL";
  }

  // Determine landing surface height - use pad surface if landing on pad
  const landingSurfaceY =
    bothLegsOnSamePad && landedPadIndex !== null
      ? landingPads[landedPadIndex].y - 3 // Top of pad
      : centerTerrainY;

  return {
    collision: true,
    outcome,
    landedPadIndex,
    terrainY: landingSurfaceY,
    failureReason,
  };
}

/**
 * Find which pad (if any) contains the given x position
 */
function findPadAtX(x: number, pads: LandingPad[]): number | null {
  for (let i = 0; i < pads.length; i++) {
    if (x >= pads[i].x1 && x <= pads[i].x2) {
      return i;
    }
  }
  return null;
}

/**
 * Get terrain height at a given x position
 */
export function getTerrainHeightAt(
  terrain: TerrainPoint[],
  x: number,
  width: number,
): number {
  // Handle wraparound
  while (x < 0) x += width;
  while (x > width) x -= width;

  // Find the two points x is between
  for (let i = 0; i < terrain.length - 1; i++) {
    const p1 = terrain[i];
    const p2 = terrain[i + 1];

    if (x >= p1.x && x <= p2.x) {
      // Linear interpolation
      const t = (x - p1.x) / (p2.x - p1.x);
      return p1.y + t * (p2.y - p1.y);
    }
  }

  // Fallback
  return terrain[terrain.length - 1].y;
}

/**
 * Calculate speed
 */
export function getSpeed(velocity: Vec2): number {
  return Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
}

/**
 * Calculate altitude above terrain
 */
export function getAltitude(
  position: Vec2,
  terrain: TerrainPoint[],
  width: number,
): number {
  const terrainY = getTerrainHeightAt(terrain, position.x, width);
  return terrainY - position.y - 15; // 15px lander offset
}
