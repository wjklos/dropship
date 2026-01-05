import { Component, Show, createMemo } from "solid-js";
import type { LandingPad } from "../lib/types";

interface PadTelemetryProps {
  pad: LandingPad | null;
  altitude: number;
  verticalSpeed: number;
  horizontalSpeed: number;
  fuel: number;
  angleOk: boolean;
  speedOk: boolean;
  zoomLevel: number;
  visible: boolean;
}

/**
 * In-SVG telemetry display positioned below the locked landing pad
 * Only visible when zoomed in during final approach
 */
const PadTelemetry: Component<PadTelemetryProps> = (props) => {
  // Only show at zoom level 3+ (altitude < 300)
  const shouldShow = createMemo(
    () => props.visible && props.pad && props.zoomLevel >= 3,
  );

  const padCenter = createMemo(() =>
    props.pad ? (props.pad.x1 + props.pad.x2) / 2 : 0,
  );

  // Position below the pad
  const displayY = createMemo(() => (props.pad ? props.pad.y + 25 : 0));

  // Format values
  const altDisplay = createMemo(() => Math.max(0, Math.round(props.altitude)));
  const vSpeedDisplay = createMemo(() => props.verticalSpeed.toFixed(1));
  const hSpeedDisplay = createMemo(() => props.horizontalSpeed.toFixed(1));
  const fuelDisplay = createMemo(() => Math.round(props.fuel));

  // Status colors
  const speedColor = createMemo(() => {
    if (props.verticalSpeed < 10) return "#44ff88";
    if (props.verticalSpeed < 15) return "#ffaa44";
    return "#ff4444";
  });

  const fuelColor = createMemo(() => {
    if (props.fuel > 50) return "#44ff88";
    if (props.fuel > 20) return "#ffaa44";
    return "#ff4444";
  });

  // Scale text size based on zoom level for readability
  const fontSize = createMemo(() => {
    if (props.zoomLevel >= 4) return 8;
    if (props.zoomLevel >= 3) return 10;
    return 12;
  });

  const lineHeight = createMemo(() => fontSize() * 1.4);

  return (
    <Show when={shouldShow()}>
      <g
        class="pad-telemetry"
        transform={`translate(${padCenter()}, ${displayY()})`}
      >
        {/* Background panel */}
        <rect
          x={-60}
          y={0}
          width={120}
          height={lineHeight() * 4 + 8}
          fill="rgba(0, 0, 0, 0.7)"
          stroke="var(--world-primary, #44ff88)"
          stroke-width="1"
          rx="2"
          ry="2"
        />

        {/* Altitude */}
        <text
          x={-55}
          y={lineHeight()}
          font-size={fontSize()}
          font-family="var(--font-mono)"
          fill="#888"
        >
          ALT
        </text>
        <text
          x={55}
          y={lineHeight()}
          text-anchor="end"
          font-size={fontSize()}
          font-family="var(--font-mono)"
          fill="#44ff88"
        >
          {altDisplay()} M
        </text>

        {/* Vertical Speed */}
        <text
          x={-55}
          y={lineHeight() * 2}
          font-size={fontSize()}
          font-family="var(--font-mono)"
          fill="#888"
        >
          V/S
        </text>
        <text
          x={55}
          y={lineHeight() * 2}
          text-anchor="end"
          font-size={fontSize()}
          font-family="var(--font-mono)"
          fill={speedColor()}
        >
          {vSpeedDisplay()} M/S
        </text>

        {/* Horizontal Speed */}
        <text
          x={-55}
          y={lineHeight() * 3}
          font-size={fontSize()}
          font-family="var(--font-mono)"
          fill="#888"
        >
          H/S
        </text>
        <text
          x={55}
          y={lineHeight() * 3}
          text-anchor="end"
          font-size={fontSize()}
          font-family="var(--font-mono)"
          fill={props.speedOk ? "#44ff88" : "#ffaa44"}
        >
          {hSpeedDisplay()} M/S
        </text>

        {/* Fuel */}
        <text
          x={-55}
          y={lineHeight() * 4}
          font-size={fontSize()}
          font-family="var(--font-mono)"
          fill="#888"
        >
          FUEL
        </text>
        <text
          x={55}
          y={lineHeight() * 4}
          text-anchor="end"
          font-size={fontSize()}
          font-family="var(--font-mono)"
          fill={fuelColor()}
        >
          {fuelDisplay()}%
        </text>

        {/* Status indicators */}
        <g transform={`translate(0, ${lineHeight() * 4 + 12})`}>
          <circle
            cx={-40}
            cy={0}
            r={3}
            fill={props.speedOk ? "#44ff88" : "#ff4444"}
          />
          <text
            x={-34}
            y={3}
            font-size={fontSize() - 1}
            font-family="var(--font-mono)"
            fill={props.speedOk ? "#44ff88" : "#ff4444"}
          >
            VEL
          </text>

          <circle
            cx={10}
            cy={0}
            r={3}
            fill={props.angleOk ? "#44ff88" : "#ff4444"}
          />
          <text
            x={16}
            y={3}
            font-size={fontSize() - 1}
            font-family="var(--font-mono)"
            fill={props.angleOk ? "#44ff88" : "#ff4444"}
          >
            ATT
          </text>
        </g>
      </g>
    </Show>
  );
};

export default PadTelemetry;
