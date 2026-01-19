import {
  Component,
  createSignal,
  createEffect,
  For,
  onCleanup,
} from "solid-js";
import type { Vec2, LandingPad } from "../lib/types";
import type { WorldId } from "../lib/worldRegistry";

interface DebrisPiece {
  id: number;
  // SVG path or line definition
  path: string;
  // Current state
  x: number;
  y: number;
  rotation: number;
  // Velocities
  vx: number;
  vy: number;
  vr: number; // rotational velocity
  // Visual
  opacity: number;
  color: string; // Allow different colors for lander vs rocket
}

interface CrashDebrisProps {
  crashPosition: Vec2;
  crashVelocity: Vec2;
  crashRotation: number;
  gravity: number;
  active: boolean;
  // Optional: pad that was crashed into (for rocket explosion)
  crashedPad?: LandingPad;
  // World ID for theming
  worldId: WorldId;
}

// Define Moon lander parts as SVG paths (relative to center) - Apollo style
const MOON_LANDER_PARTS = [
  // Main body (descent stage)
  { path: "M -12,-8 L 12,-8 L 15,5 L -15,5 Z", mass: 1.0 },
  // Ascent stage (top)
  { path: "M -8,-8 L 8,-8 L 6,-18 L -6,-18 Z", mass: 0.8 },
  // Cabin window
  { path: "M -3,-18 L 3,-18 L 2,-22 L -2,-22 Z", mass: 0.3 },
  // Left leg
  { path: "M -12,5 L -20,15 M -22,15 L -18,15", mass: 0.4 },
  // Right leg
  { path: "M 12,5 L 20,15 M 18,15 L 22,15", mass: 0.4 },
  // Engine
  { path: "M -4,5 L 4,5 L 3,10 L -3,10 Z", mass: 0.5 },
  // Left RCS
  { path: "M -15,-2 L -18,-2", mass: 0.1 },
  // Right RCS
  { path: "M 15,-2 L 18,-2", mass: 0.1 },
];

// Define Mars lander parts as SVG paths - capsule style
const MARS_LANDER_PARTS = [
  // Heat shield (curved bottom)
  { path: "M -14,6 Q -14,12 0,14 Q 14,12 14,6", mass: 1.2 },
  // Main capsule body left
  { path: "M -14,6 L -14,-10 Q -14,-18 -8,-18", mass: 0.8 },
  // Main capsule body right
  { path: "M 14,6 L 14,-10 Q 14,-18 8,-18", mass: 0.8 },
  // Top section
  { path: "M -8,-18 L 8,-18", mass: 0.4 },
  // Left window
  { path: "M -6,-12 m -3,0 a 3,3 0 1,0 6,0 a 3,3 0 1,0 -6,0", mass: 0.2 },
  // Right window
  { path: "M 6,-12 m -3,0 a 3,3 0 1,0 6,0 a 3,3 0 1,0 -6,0", mass: 0.2 },
  // Docking port
  { path: "M -4,-22 L -4,-18 M 4,-22 L 4,-18 M -4,-22 L 4,-22", mass: 0.3 },
  // Engine nozzle
  { path: "M -5,14 L -6,20 L 6,20 L 5,14", mass: 0.5 },
  // Left leg
  { path: "M -10,10 L -18,20 M -20,20 L -16,20", mass: 0.3 },
  // Right leg
  { path: "M 10,10 L 18,20 M 16,20 L 20,20", mass: 0.3 },
];

// Define rocket parts (matching Terrain.tsx rocket design)
const ROCKET_PARTS = [
  // Rocket body
  { path: "M 0 -45 L 8 -20 L 8 0 L -8 0 L -8 -20 Z", mass: 1.0 },
  // Nose cone
  { path: "M 0 -45 L 6 -35 L -6 -35 Z", mass: 0.4 },
  // Left fin
  { path: "M -8 0 L -14 8 L -8 -8 Z", mass: 0.3 },
  // Right fin
  { path: "M 8 0 L 14 8 L 8 -8 Z", mass: 0.3 },
  // Window
  { path: "M 0 -28 m -4 0 a 4 4 0 1 0 8 0 a 4 4 0 1 0 -8 0", mass: 0.2 },
  // Engine nozzle
  { path: "M -5 0 L -6 5 L 6 5 L 5 0", mass: 0.4 },
];

const CrashDebris: Component<CrashDebrisProps> = (props) => {
  const [debris, setDebris] = createSignal<DebrisPiece[]>([]);
  const [animationFrame, setAnimationFrame] = createSignal(0);

  // Initialize debris when crash becomes active
  createEffect(() => {
    if (props.active) {
      const pieces: DebrisPiece[] = [];

      // Random explosion velocity based on crash impact
      const impactSpeed = Math.sqrt(
        props.crashVelocity.x ** 2 + props.crashVelocity.y ** 2,
      );
      const explosionForce = Math.min(impactSpeed * 0.5, 80);

      // Select lander parts based on world, but always use green color
      const landerParts =
        props.worldId === "mars" ? MARS_LANDER_PARTS : MOON_LANDER_PARTS;
      const landerColor = "#00ff88"; // Always green to match lander

      // Generate lander debris
      landerParts.forEach((part, i) => {
        const angle = Math.random() * Math.PI * 2;
        const speed =
          (explosionForce * (0.3 + Math.random() * 0.7)) / part.mass;

        pieces.push({
          id: i,
          path: part.path,
          x: props.crashPosition.x,
          y: props.crashPosition.y,
          rotation:
            props.crashRotation * (180 / Math.PI) + (Math.random() - 0.5) * 30,
          vx: props.crashVelocity.x * 0.3 + Math.cos(angle) * speed,
          vy:
            props.crashVelocity.y * 0.3 +
            Math.sin(angle) * speed -
            Math.random() * 40,
          vr: (Math.random() - 0.5) * 400,
          opacity: 1,
          color: landerColor,
        });
      });

      // If crashed into an occupied pad, also explode the rocket!
      if (props.crashedPad?.occupied) {
        const rocketX = (props.crashedPad.x1 + props.crashedPad.x2) / 2;
        const rocketY = props.crashedPad.y - 11; // Match rocket position from Terrain.tsx

        // Bigger explosion for the rocket (chain reaction!)
        const rocketExplosionForce = explosionForce * 1.5 + 60;

        ROCKET_PARTS.forEach((part, i) => {
          const angle = Math.random() * Math.PI * 2;
          const speed =
            (rocketExplosionForce * (0.3 + Math.random() * 0.7)) / part.mass;

          pieces.push({
            id: 100 + i, // Offset ID to avoid collision
            path: part.path,
            x: rocketX,
            y: rocketY,
            rotation: (Math.random() - 0.5) * 60,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed - Math.random() * 60, // More upward bias
            vr: (Math.random() - 0.5) * 500, // Faster spin
            opacity: 1,
            color: "#ff8866", // Orange color matching the rocket
          });
        });
      }

      setDebris(pieces);

      // Start animation loop
      let lastTime = performance.now();
      let frameId: number;

      const animate = (currentTime: number) => {
        const dt = Math.min((currentTime - lastTime) / 1000, 0.05);
        lastTime = currentTime;

        setDebris((prev) =>
          prev.map((piece) => ({
            ...piece,
            x: piece.x + piece.vx * dt,
            y: piece.y + piece.vy * dt,
            vy: piece.vy + props.gravity * dt, // Apply gravity
            rotation: piece.rotation + piece.vr * dt,
            opacity: Math.max(0, piece.opacity - dt * 0.3), // Fade out over ~3 seconds
          })),
        );

        setAnimationFrame((f) => f + 1);

        // Continue animation while any piece is visible
        if (debris().some((p) => p.opacity > 0)) {
          frameId = requestAnimationFrame(animate);
        }
      };

      frameId = requestAnimationFrame(animate);

      onCleanup(() => {
        if (frameId) cancelAnimationFrame(frameId);
      });
    } else {
      setDebris([]);
    }
  });

  return (
    <g class="crash-debris">
      <For each={debris()}>
        {(piece) => (
          <g
            transform={`translate(${piece.x}, ${piece.y}) rotate(${piece.rotation})`}
            opacity={piece.opacity}
          >
            <path
              d={piece.path}
              fill="none"
              stroke={piece.color}
              stroke-width="1.5"
              filter="url(#glow)"
            />
          </g>
        )}
      </For>
    </g>
  );
};

export default CrashDebris;
