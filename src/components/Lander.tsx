import { Component, createMemo, Show } from "solid-js";
import type { LanderState, ZoomLevel } from "../lib/types";

interface LanderProps {
  lander: LanderState;
  zoomLevel: ZoomLevel;
}

const Lander: Component<LanderProps> = (props) => {
  // Scale lander based on zoom level
  // When zoomed out (orbital), lander appears smaller
  // When zoomed in (landing), lander appears normal size
  const landerScale = createMemo(() => {
    // Base scale is 1 at viewHeight 250 (most zoomed in)
    // Scale down proportionally as viewHeight increases
    const baseViewHeight = 250;
    const scale = baseViewHeight / props.zoomLevel.viewHeight;
    // Clamp between 0.35 (small but visible in orbit) and 1.0 (full size at landing)
    return Math.max(0.35, Math.min(1.0, scale));
  });

  // Thrust flame animation
  const flameLength = createMemo(() => {
    const base = 15;
    const variable = 20 * props.lander.thrust;
    const flicker = Math.random() * 5 * props.lander.thrust;
    return base + variable + flicker;
  });

  const flameWidth = createMemo(() => {
    return 6 + 8 * props.lander.thrust;
  });

  const transform = createMemo(() => {
    const { x, y } = props.lander.position;
    const rotation = props.lander.rotation * (180 / Math.PI);
    const scale = landerScale();
    return `translate(${x}, ${y}) rotate(${rotation}) scale(${scale})`;
  });

  return (
    <g transform={transform()} class="lander">
      {/* Thrust flame */}
      <Show when={props.lander.thrust > 0}>
        <g class="thrust-flame">
          {/* Outer flame glow */}
          <polygon
            points={`
              -${flameWidth() * 0.8},0
              0,${flameLength() * 1.2}
              ${flameWidth() * 0.8},0
            `}
            fill="none"
            stroke="rgba(255, 150, 50, 0.3)"
            stroke-width="8"
            filter="url(#glow)"
          />
          {/* Middle flame */}
          <polygon
            points={`
              -${flameWidth() * 0.6},0
              0,${flameLength()}
              ${flameWidth() * 0.6},0
            `}
            fill="none"
            stroke="rgba(255, 200, 100, 0.6)"
            stroke-width="4"
            filter="url(#glow)"
          />
          {/* Inner flame */}
          <polygon
            points={`
              -${flameWidth() * 0.3},2
              0,${flameLength() * 0.7}
              ${flameWidth() * 0.3},2
            `}
            fill="none"
            stroke="rgba(255, 255, 200, 0.9)"
            stroke-width="2"
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
