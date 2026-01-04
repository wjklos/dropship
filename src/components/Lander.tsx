import { Component, createMemo, createSignal, Show, For } from "solid-js";
import type { LanderState, ZoomLevel } from "../lib/types";

interface LanderProps {
  lander: LanderState;
  zoomLevel: ZoomLevel;
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

      {/* Lander body - vector style (tighter graphics) */}
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
    </g>
  );
};

export default Lander;
