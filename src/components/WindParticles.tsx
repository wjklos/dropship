/**
 * WindArrows Component
 *
 * Animated arrows that drift with the wind in each atmospheric band.
 * Arrow direction shows wind direction, movement shows speed.
 * Renders behind terrain for depth effect.
 */

import {
  Component,
  For,
  createMemo,
  createSignal,
  onMount,
  onCleanup,
} from "solid-js";
import type { AtmosphereConfig } from "../lib/worlds";
import { getWindBandsForDisplay } from "../lib/atmosphere";

interface WindParticlesProps {
  atmosphere: AtmosphereConfig | undefined;
  worldWidth: number;
  terrainMaxY: number;
  gameTime: number;
  primaryColor: string;
  orbitalVelocity: number; // Reference speed - wind is relative to this
}

interface WindArrow {
  id: number;
  x: number;
  y: number;
  opacity: number;
  bandIndex: number;
  color: string;
  direction: number; // 1 for right, -1 for left
}

const WindParticles: Component<WindParticlesProps> = (props) => {
  const [arrows, setArrows] = createSignal<WindArrow[]>([]);
  let nextId = 0;

  // Get wind bands with current wind values
  const bandsWithWind = createMemo(() =>
    getWindBandsForDisplay(props.atmosphere, props.gameTime),
  );

  // Convert altitude to Y coordinate
  const altitudeToY = (altitude: number) => props.terrainMaxY - altitude;

  // Calculate total arrows per band based on wind speed (2x volume)
  const getArrowCount = (windSpeed: number, bandHeight: number) => {
    const absSpeed = Math.abs(windSpeed);
    // More wind = more arrows, scaled by band height, 2x density
    const density = Math.min(absSpeed / 10, 3); // 0 to 3 arrows per 100px height
    return Math.floor((bandHeight / 100) * density * 16); // 2x the original
  };

  // Initialize arrows for all bands
  const initializeArrows = () => {
    const bands = bandsWithWind();
    const newArrows: WindArrow[] = [];

    bands.forEach((band, bandIndex) => {
      const y1 = altitudeToY(band.altitudeMax);
      const y2 = altitudeToY(band.altitudeMin);
      const bandHeight = y2 - y1;
      const count = getArrowCount(band.windSpeed, bandHeight);
      const direction = band.windSpeed >= 0 ? 1 : -1;

      for (let i = 0; i < count; i++) {
        newArrows.push({
          id: nextId++,
          x: Math.random() * props.worldWidth,
          y: y1 + Math.random() * bandHeight,
          opacity: 0.4 + Math.random() * 0.4,
          bandIndex,
          color: band.particleColor || props.primaryColor,
          direction,
        });
      }
    });

    setArrows(newArrows);
  };

  // Track cumulative position offsets per band (not per particle)
  // This avoids re-randomizing particles and keeps movement smooth
  const [bandOffsets, setBandOffsets] = createSignal<number[]>([0, 0, 0]);
  let lastUpdateTime = 0;

  // Update band offsets based on wind - runs every frame
  const updateOffsets = (currentTime: number) => {
    const dt = lastUpdateTime > 0 ? (currentTime - lastUpdateTime) / 1000 : 0;
    lastUpdateTime = currentTime;

    const bands = bandsWithWind();

    setBandOffsets((prev) =>
      prev.map((offset, i) => {
        const band = bands[i];
        if (!band) return offset;

        // Visible but slow drift
        // Wind of 8 px/s becomes ~8 px/s visual drift
        // Lander orbits at 100 px/s, so particles are ~12x slower
        const drift = band.currentWindX * 1.0 * dt;
        return offset + drift;
      }),
    );
  };

  // Animation loop for offsets only
  let animationFrame: number;
  const animate = (timestamp: number) => {
    updateOffsets(timestamp);
    animationFrame = requestAnimationFrame(animate);
  };

  onMount(() => {
    initializeArrows();
    lastUpdateTime = performance.now();
    animationFrame = requestAnimationFrame(animate);
  });

  onCleanup(() => {
    cancelAnimationFrame(animationFrame);
  });

  // Only reinitialize when world actually changes (check by id)
  let lastAtmosphere: typeof props.atmosphere = undefined;
  createMemo(() => {
    const atm = props.atmosphere;
    if (atm !== lastAtmosphere) {
      lastAtmosphere = atm;
      initializeArrows();
    }
  });

  // Calculate arrow position with band offset applied
  const getArrowX = (arrow: WindArrow) => {
    const offset = bandOffsets()[arrow.bandIndex] || 0;
    let x = arrow.x + offset;
    // Wrap
    while (x > props.worldWidth) x -= props.worldWidth;
    while (x < 0) x += props.worldWidth;
    return x;
  };

  // Arrow size
  const arrowLength = 8;
  const arrowHeadSize = 3;

  return (
    <g class="wind-arrows">
      <For each={arrows()}>
        {(arrow) => {
          const x = getArrowX(arrow);
          const y = arrow.y;
          const dir = arrow.direction;

          // Arrow pointing in wind direction
          // Line from tail to head
          const tailX = x - (arrowLength / 2) * dir;
          const headX = x + (arrowLength / 2) * dir;

          return (
            <g opacity={arrow.opacity}>
              {/* Arrow shaft */}
              <line
                x1={tailX}
                y1={y}
                x2={headX}
                y2={y}
                stroke={arrow.color}
                stroke-width="1"
              />
              {/* Arrow head */}
              <path
                d={`M ${headX} ${y} L ${headX - arrowHeadSize * dir} ${y - arrowHeadSize / 2} L ${headX - arrowHeadSize * dir} ${y + arrowHeadSize / 2} Z`}
                fill={arrow.color}
              />
            </g>
          );
        }}
      </For>
    </g>
  );
};

export default WindParticles;
