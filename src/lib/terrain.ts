import type { TerrainPoint, LandingPad } from "./types";

/**
 * Pad widths by multiplier (based on 44px lander leg span)
 * Harder pads are narrower
 */
const PAD_WIDTHS: Record<1 | 2 | 3 | 4 | 5, number> = {
  1: 100, // Easy - generous margin
  2: 80,
  3: 65,
  4: 55,
  5: 50, // Just 6px wider than leg span - very tight
};

/**
 * Generate terrain using midpoint displacement algorithm
 * Creates that classic jagged moonscape feel
 */
export function generateTerrain(
  width: number,
  height: number,
  roughness: number = 0.6,
  iterations: number = 7,
): { terrain: TerrainPoint[]; landingPads: LandingPad[] } {
  // Start with endpoints
  const baseY = height * 0.75; // Ground level at 75% of height
  let points: TerrainPoint[] = [
    { x: 0, y: baseY },
    { x: width, y: baseY },
  ];

  // Midpoint displacement
  let displacement = height * 0.3; // Initial displacement range

  for (let i = 0; i < iterations; i++) {
    const newPoints: TerrainPoint[] = [];

    for (let j = 0; j < points.length - 1; j++) {
      const p1 = points[j];
      const p2 = points[j + 1];

      newPoints.push(p1);

      // Midpoint with random displacement
      const midX = (p1.x + p2.x) / 2;
      const midY = (p1.y + p2.y) / 2 + (Math.random() - 0.5) * displacement;

      // Clamp to reasonable bounds
      const clampedY = Math.max(height * 0.5, Math.min(height * 0.95, midY));

      newPoints.push({ x: midX, y: clampedY });
    }

    newPoints.push(points[points.length - 1]);
    points = newPoints;
    displacement *= roughness; // Reduce displacement each iteration
  }

  // Generate multiple landing pads
  const landingPads = generateLandingPads(points, width, height, baseY);

  // Flatten terrain at each pad location
  for (const pad of landingPads) {
    points = flattenTerrainForPad(points, pad);
  }

  return { terrain: points, landingPads };
}

/**
 * Generate multiple landing pads with varying difficulties
 */
function generateLandingPads(
  terrain: TerrainPoint[],
  width: number,
  height: number,
  baseY: number,
): LandingPad[] {
  // Determine number of pads based on width (minimum 3, roughly 1 per 180px)
  const padCount = Math.max(3, Math.floor(width / 180));

  // Divide terrain into segments
  const segmentWidth = width / padCount;
  const pads: LandingPad[] = [];

  // Generate multipliers ensuring variety
  const multipliers = generateMultiplierDistribution(padCount);

  for (let i = 0; i < padCount; i++) {
    const multiplier = multipliers[i];
    const padWidth = PAD_WIDTHS[multiplier];

    // Calculate segment boundaries with padding
    const segmentStart = i * segmentWidth;
    const segmentEnd = (i + 1) * segmentWidth;

    // Find valid x position within segment (with margins)
    const margin = 20; // Margin from segment edges
    const minX = segmentStart + margin;
    const maxX = segmentEnd - margin - padWidth;

    // Random position within valid range
    const padStart = minX + Math.random() * Math.max(0, maxX - minX);
    const padEnd = padStart + padWidth;

    // Find average terrain height in pad region
    let padY = 0;
    let padPointCount = 0;

    for (const point of terrain) {
      if (point.x >= padStart && point.x <= padEnd) {
        padY += point.y;
        padPointCount++;
      }
    }

    padY = padPointCount > 0 ? padY / padPointCount : baseY;

    // 20% chance pad is occupied by a rocket awaiting takeoff
    const occupied = Math.random() < 0.2;

    pads.push({
      x1: padStart,
      x2: padEnd,
      y: padY,
      multiplier,
      occupied,
    });
  }

  // Ensure at least one pad is NOT occupied (so landing is possible)
  const hasFreePad = pads.some((p) => !p.occupied);
  if (!hasFreePad && pads.length > 0) {
    // Make a random pad free
    const freeIndex = Math.floor(Math.random() * pads.length);
    pads[freeIndex].occupied = false;
  }

  return pads;
}

/**
 * Generate a distribution of multipliers ensuring variety
 * At least one easy (1-2) and one hard (4-5) pad
 */
function generateMultiplierDistribution(count: number): (1 | 2 | 3 | 4 | 5)[] {
  const multipliers: (1 | 2 | 3 | 4 | 5)[] = [];

  // Ensure at least one easy pad
  multipliers.push(Math.random() < 0.5 ? 1 : 2);

  // Ensure at least one hard pad
  multipliers.push(Math.random() < 0.5 ? 4 : 5);

  // Fill remaining with random distribution
  for (let i = 2; i < count; i++) {
    const roll = Math.random();
    if (roll < 0.2) multipliers.push(1);
    else if (roll < 0.4) multipliers.push(2);
    else if (roll < 0.6) multipliers.push(3);
    else if (roll < 0.8) multipliers.push(4);
    else multipliers.push(5);
  }

  // Shuffle to distribute across terrain
  for (let i = multipliers.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [multipliers[i], multipliers[j]] = [multipliers[j], multipliers[i]];
  }

  return multipliers;
}

/**
 * Flatten terrain around a landing pad with smooth blend zones
 */
function flattenTerrainForPad(
  points: TerrainPoint[],
  pad: LandingPad,
): TerrainPoint[] {
  const blendZone = 10; // Pixels for smooth transition

  return points.map((point) => {
    if (point.x >= pad.x1 - blendZone && point.x <= pad.x2 + blendZone) {
      // Inside pad area - flatten completely
      if (point.x >= pad.x1 && point.x <= pad.x2) {
        return { ...point, y: pad.y };
      }
      // Blend zone - smooth transition
      const distToEdge = point.x < pad.x1 ? pad.x1 - point.x : point.x - pad.x2;
      const blend = distToEdge / blendZone;
      return { ...point, y: point.y * blend + pad.y * (1 - blend) };
    }
    return point;
  });
}

/**
 * Convert terrain points to SVG path string
 */
export function terrainToPath(
  terrain: TerrainPoint[],
  width: number,
  height: number,
): string {
  if (terrain.length === 0) return "";

  // Start at bottom left
  let path = `M 0 ${height}`;

  // Line up to first terrain point
  path += ` L ${terrain[0].x} ${terrain[0].y}`;

  // Draw terrain line
  for (let i = 1; i < terrain.length; i++) {
    path += ` L ${terrain[i].x} ${terrain[i].y}`;
  }

  // Close at bottom right
  path += ` L ${width} ${height}`;
  path += " Z";

  return path;
}

/**
 * Generate star positions
 */
export function generateStars(
  width: number,
  height: number,
  count: number = 50,
): { x: number; y: number; size: number; brightness: number }[] {
  const stars = [];

  for (let i = 0; i < count; i++) {
    stars.push({
      x: Math.random() * width,
      y: Math.random() * height * 0.6, // Stars in upper 60%
      size: Math.random() * 2 + 0.5,
      brightness: Math.random() * 0.5 + 0.5,
    });
  }

  return stars;
}
