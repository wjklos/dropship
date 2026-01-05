/**
 * Atmospheric Effects Component
 *
 * Renders vector-style visual effects for:
 * - Atmospheric entry heating (plasma envelope + streaks)
 * - Landing dust kick-up (radial lines + particle spray)
 *
 * Only active on worlds with atmosphere (Mars).
 */

import { Component, createMemo, For, Show } from "solid-js";

interface AtmosphericEffectsProps {
  // Lander state
  landerX: number;
  landerY: number;
  velocityX: number;
  velocityY: number;
  rotation: number;
  thrust: number;
  altitude: number;
  landed: boolean;
  alive: boolean;

  // World properties
  hasAtmosphere: boolean;
  atmosphereColor: string | undefined;
  dustColor: string; // World-specific dust color

  // Thresholds
  heatingAltitude: number; // Below this, heating can occur
  heatingVelocity: number; // Above this velocity, heating occurs
}

const AtmosphericEffects: Component<AtmosphericEffectsProps> = (props) => {
  // Calculate speed and direction
  const speed = createMemo(() =>
    Math.sqrt(props.velocityX ** 2 + props.velocityY ** 2),
  );

  const velocityAngle = createMemo(() =>
    Math.atan2(props.velocityY, props.velocityX),
  );

  // Heat intensity: 0-1 based on velocity and altitude
  const heatIntensity = createMemo(() => {
    if (!props.hasAtmosphere || !props.alive) return 0;
    if (props.altitude > props.heatingAltitude) return 0;
    if (speed() < props.heatingVelocity) return 0;

    // Intensity increases with velocity and decreases with altitude
    const velocityFactor = Math.min(
      1,
      (speed() - props.heatingVelocity) / (props.heatingVelocity * 2),
    );
    const altitudeFactor = 1 - props.altitude / props.heatingAltitude;

    return Math.min(1, velocityFactor * altitudeFactor * 1.5);
  });

  // Dust intensity: disabled - effect removed
  const dustIntensity = createMemo(() => {
    return 0;
  });

  // Generate plasma streak positions (trailing behind lander)
  const plasmaStreaks = createMemo(() => {
    const intensity = heatIntensity();
    if (intensity < 0.1) return [];

    const streaks = [];
    const numStreaks = Math.floor(5 + intensity * 10);
    const angle = velocityAngle();

    for (let i = 0; i < numStreaks; i++) {
      // Streaks trail behind the velocity vector
      const spreadAngle = angle + Math.PI + (Math.random() - 0.5) * 0.8;
      const distance = 20 + Math.random() * 40 * intensity;
      const length = 10 + Math.random() * 30 * intensity;

      streaks.push({
        id: i,
        x1: props.landerX + Math.cos(spreadAngle) * 15,
        y1: props.landerY + Math.sin(spreadAngle) * 15,
        x2: props.landerX + Math.cos(spreadAngle) * (15 + distance),
        y2: props.landerY + Math.sin(spreadAngle) * (15 + distance),
        opacity: 0.3 + Math.random() * 0.5 * intensity,
        width: 1 + Math.random() * 2 * intensity,
      });
    }
    return streaks;
  });

  // Generate radial dust lines (emanating from below lander)
  const dustLines = createMemo(() => {
    const intensity = dustIntensity();
    if (intensity < 0.1) return [];

    const lines = [];
    const numLines = Math.floor(8 + intensity * 12);
    const groundY = props.landerY + props.altitude + 15; // Approximate ground position

    for (let i = 0; i < numLines; i++) {
      // Lines spread outward from below the lander
      const angle = (i / numLines) * Math.PI * 2;
      const startRadius = 10 + Math.random() * 10;
      const endRadius = startRadius + 20 + Math.random() * 40 * intensity;

      lines.push({
        id: i,
        x1: props.landerX + Math.cos(angle) * startRadius,
        y1: groundY,
        x2: props.landerX + Math.cos(angle) * endRadius,
        y2: groundY + Math.sin(angle) * 5 - Math.random() * 10 * intensity,
        opacity: 0.2 + Math.random() * 0.4 * intensity,
        width: 1 + Math.random() * intensity,
      });
    }
    return lines;
  });

  // Generate dust particles (small, numerous)
  const dustParticles = createMemo(() => {
    const intensity = dustIntensity();
    if (intensity < 0.15) return [];

    const particles = [];
    const numParticles = Math.floor(20 + intensity * 40);
    const groundY = props.landerY + props.altitude + 15;

    for (let i = 0; i < numParticles; i++) {
      const angle = Math.random() * Math.PI * 2;
      const distance = 10 + Math.random() * 60 * intensity;
      const height = Math.random() * 40 * intensity;

      particles.push({
        id: i,
        cx: props.landerX + Math.cos(angle) * distance,
        cy: groundY - height,
        r: 0.5 + Math.random() * 1 * intensity, // Smaller particles
        opacity: 0.3 + Math.random() * 0.5 * intensity,
      });
    }
    return particles;
  });

  // Heat envelope color - shifts from orange to white with intensity
  const heatColor = createMemo(() => {
    const intensity = heatIntensity();
    if (intensity < 0.5) {
      // Orange to yellow
      const r = 255;
      const g = Math.floor(100 + intensity * 200);
      const b = Math.floor(intensity * 100);
      return `rgb(${r}, ${g}, ${b})`;
    } else {
      // Yellow to white
      const factor = (intensity - 0.5) * 2;
      const r = 255;
      const g = Math.floor(200 + factor * 55);
      const b = Math.floor(50 + factor * 205);
      return `rgb(${r}, ${g}, ${b})`;
    }
  });

  return (
    <g class="atmospheric-effects">
      {/* Heat envelope around lander during atmospheric entry */}
      <Show when={heatIntensity() > 0.1}>
        {/* Plasma streaks trailing behind - rendered first so envelope is on top */}
        <g class="plasma-streaks">
          <For each={plasmaStreaks()}>
            {(streak) => (
              <line
                x1={streak.x1}
                y1={streak.y1}
                x2={streak.x2}
                y2={streak.y2}
                stroke={heatColor()}
                stroke-width={streak.width}
                opacity={streak.opacity}
                stroke-linecap="round"
                filter="url(#glow)"
              />
            )}
          </For>
        </g>
      </Show>

      {/* Dust effects during landing - particles only */}
      <Show when={dustIntensity() > 0.1}>
        <g class="dust-particles">
          <For each={dustParticles()}>
            {(particle) => (
              <circle
                cx={particle.cx}
                cy={particle.cy}
                r={particle.r}
                fill={props.dustColor}
                opacity={particle.opacity}
              />
            )}
          </For>
        </g>
      </Show>
    </g>
  );
};

export default AtmosphericEffects;
