import { Component, createMemo, Show, For } from "solid-js";
import type { LanderState, ZoomLevel } from "../lib/types";
import type { WorldId } from "../lib/worlds";

interface LanderProps {
  lander: LanderState;
  zoomLevel: ZoomLevel;
  worldId: WorldId;
  altitude: number;
}

// Generate random flame line segments for vector-style exhaust
function generateFlameLines(
  thrust: number,
): Array<{ x1: number; y1: number; x2: number; y2: number; opacity: number }> {
  if (thrust <= 0) return [];

  const lines: Array<{
    x1: number;
    y1: number;
    x2: number;
    y2: number;
    opacity: number;
  }> = [];
  const numLines = 3 + Math.floor(thrust * 5); // 3-8 lines based on thrust
  const baseLength = 12 + thrust * 25;

  for (let i = 0; i < numLines; i++) {
    // Random spread from engine nozzle
    const spreadX = (Math.random() - 0.5) * 8 * thrust;
    const startY = 10 + Math.random() * 3;
    const length = baseLength * (0.5 + Math.random() * 0.5);
    const endX = spreadX * (1 + Math.random() * 0.5);

    lines.push({
      x1: spreadX * 0.3,
      y1: startY,
      x2: endX,
      y2: startY + length,
      opacity: 0.4 + Math.random() * 0.6,
    });
  }

  return lines;
}

const Lander: Component<LanderProps> = (props) => {
  // Scale lander based on zoom level
  const landerScale = createMemo(() => {
    const baseViewHeight = 250;
    const scale = baseViewHeight / props.zoomLevel.viewHeight;
    return Math.max(0.35, Math.min(1.0, scale));
  });

  // Vector-style flame lines - regenerate each frame for flicker effect
  const flameLines = createMemo(() => generateFlameLines(props.lander.thrust));

  const transform = createMemo(() => {
    const { x, y } = props.lander.position;
    const rotation = props.lander.rotation * (180 / Math.PI);
    const scale = landerScale();
    return `translate(${x}, ${y}) rotate(${rotation}) scale(${scale})`;
  });

  // Landing leg deployment for Mars lander
  // Legs deploy when altitude < 80px, fully deployed at < 40px
  const legDeployment = createMemo(() => {
    if (props.worldId !== "mars") return 1; // Moon lander always has legs out
    if (props.altitude > 80) return 0; // Legs stowed
    if (props.altitude < 40) return 1; // Fully deployed
    // Animate between 80 and 40
    return (80 - props.altitude) / 40;
  });

  return (
    <g transform={transform()} class="lander">
      {/* Vector-style thrust flames - individual line segments */}
      <Show when={props.lander.thrust > 0}>
        <g class="thrust-flame">
          <For each={flameLines()}>
            {(line) => (
              <line
                x1={line.x1}
                y1={line.y1}
                x2={line.x2}
                y2={line.y2}
                stroke={`rgba(255, ${180 + Math.random() * 75}, ${50 + Math.random() * 100}, ${line.opacity})`}
                stroke-width="1.5"
                stroke-linecap="round"
                filter="url(#glow)"
              />
            )}
          </For>
          {/* Core bright center line */}
          <line
            x1="0"
            y1="10"
            x2="0"
            y2={10 + 15 + props.lander.thrust * 20 + Math.random() * 8}
            stroke="rgba(255, 255, 200, 0.9)"
            stroke-width="2"
            stroke-linecap="round"
            filter="url(#glow)"
          />
        </g>
      </Show>

      {/* Moon Lander - classic Apollo-style angular design */}
      <Show when={props.worldId === "moon"}>
        <g class="lander-body" filter="url(#glow)">
          {/* Main body (descent stage) */}
          <polygon
            points="-12,-8 12,-8 15,5 -15,5"
            fill="none"
            stroke="var(--vector-primary)"
            stroke-width="1.5"
          />

          {/* Ascent stage (top) */}
          <polygon
            points="-8,-8 8,-8 6,-18 -6,-18"
            fill="none"
            stroke="var(--vector-primary)"
            stroke-width="1.5"
          />

          {/* Cabin window */}
          <polygon
            points="-3,-18 3,-18 2,-22 -2,-22"
            fill="none"
            stroke="var(--vector-primary)"
            stroke-width="1"
          />

          {/* Left leg */}
          <line
            x1="-12"
            y1="5"
            x2="-20"
            y2="15"
            stroke="var(--vector-primary)"
            stroke-width="1.5"
          />
          <line
            x1="-22"
            y1="15"
            x2="-18"
            y2="15"
            stroke="var(--vector-primary)"
            stroke-width="1.5"
          />

          {/* Right leg */}
          <line
            x1="12"
            y1="5"
            x2="20"
            y2="15"
            stroke="var(--vector-primary)"
            stroke-width="1.5"
          />
          <line
            x1="18"
            y1="15"
            x2="22"
            y2="15"
            stroke="var(--vector-primary)"
            stroke-width="1.5"
          />

          {/* Center engine */}
          <polygon
            points="-4,5 4,5 3,10 -3,10"
            fill="none"
            stroke="var(--vector-primary)"
            stroke-width="1"
          />

          {/* RCS thrusters (small) */}
          <line
            x1="-15"
            y1="-2"
            x2="-18"
            y2="-2"
            stroke="var(--vector-primary)"
            stroke-width="0.75"
          />
          <line
            x1="15"
            y1="-2"
            x2="18"
            y2="-2"
            stroke="var(--vector-primary)"
            stroke-width="0.75"
          />
        </g>
      </Show>

      {/* Mars Lander - aerodynamic capsule design */}
      <Show when={props.worldId === "mars"}>
        <g class="lander-body" filter="url(#glow)">
          {/* Heat shield (rounded bottom) */}
          <path
            d="M -14,6 Q -14,12 0,14 Q 14,12 14,6"
            fill="none"
            stroke="var(--vector-primary)"
            stroke-width="1.5"
          />

          {/* Main capsule body (rounded rectangle) */}
          <path
            d="M -14,6 L -14,-10 Q -14,-18 -8,-18 L 8,-18 Q 14,-18 14,-10 L 14,6"
            fill="none"
            stroke="var(--vector-primary)"
            stroke-width="1.5"
          />

          {/* Cabin windows (portholes) */}
          <circle
            cx="-6"
            cy="-12"
            r="3"
            fill="none"
            stroke="var(--vector-primary)"
            stroke-width="1"
          />
          <circle
            cx="6"
            cy="-12"
            r="3"
            fill="none"
            stroke="var(--vector-primary)"
            stroke-width="1"
          />

          {/* Docking port on top */}
          <rect
            x="-4"
            y="-22"
            width="8"
            height="4"
            fill="none"
            stroke="var(--vector-primary)"
            stroke-width="1"
            rx="1"
          />

          {/* Engine nozzle */}
          <path
            d="M -5,14 L -3,10 L 3,10 L 5,14"
            fill="none"
            stroke="var(--vector-primary)"
            stroke-width="1"
          />

          {/* Landing legs with deployment animation */}
          {/* Legs pivot from attachment point at body, swing outward */}
          <g class="landing-legs">
            {/* Left leg - pivots from (-10, 8), swings left */}
            <line
              x1="-10"
              y1="8"
              x2={-10 - legDeployment() * 10}
              y2={8 + 12}
              stroke="var(--vector-primary)"
              stroke-width="1.5"
              opacity={0.3 + legDeployment() * 0.7}
            />
            {/* Left foot pad */}
            <Show when={legDeployment() > 0.5}>
              <line
                x1={-10 - legDeployment() * 10 - 3}
                y1={20}
                x2={-10 - legDeployment() * 10 + 3}
                y2={20}
                stroke="var(--vector-primary)"
                stroke-width="1.5"
                opacity={legDeployment()}
              />
            </Show>

            {/* Right leg - pivots from (10, 8), swings right */}
            <line
              x1="10"
              y1="8"
              x2={10 + legDeployment() * 10}
              y2={8 + 12}
              stroke="var(--vector-primary)"
              stroke-width="1.5"
              opacity={0.3 + legDeployment() * 0.7}
            />
            {/* Right foot pad */}
            <Show when={legDeployment() > 0.5}>
              <line
                x1={10 + legDeployment() * 10 - 3}
                y1={20}
                x2={10 + legDeployment() * 10 + 3}
                y2={20}
                stroke="var(--vector-primary)"
                stroke-width="1.5"
                opacity={legDeployment()}
              />
            </Show>
          </g>

          {/* RCS thrusters */}
          <line
            x1="-14"
            y1="-5"
            x2="-17"
            y2="-5"
            stroke="var(--vector-primary)"
            stroke-width="0.75"
          />
          <line
            x1="14"
            y1="-5"
            x2="17"
            y2="-5"
            stroke="var(--vector-primary)"
            stroke-width="0.75"
          />
        </g>
      </Show>
    </g>
  );
};

export default Lander;
