/**
 * Trajectory Overlay Component
 *
 * Visualizes predicted trajectory and landing information.
 * Shows:
 * - Ballistic arc from current position
 * - Predicted impact point
 * - Optimal insertion point for target pad
 * - Insertion window countdown
 */

import { Component, createMemo, Show, For } from "solid-js";
import type { TrajectoryPrediction } from "../lib/trajectory";
import type { LandingPad } from "../lib/types";
import { getTrajectorySegments } from "../lib/trajectory";

interface TrajectoryOverlayProps {
  prediction: TrajectoryPrediction | null;
  targetPad: LandingPad | null;
  landingPads: LandingPad[];
  optimalBurnPoint: number | null;
  windowOpensIn: number;
  showTrajectory: boolean;
  phase: "orbit" | "descent" | "terminal" | "landed" | "crashed" | "abort";
  worldWidth: number;
}

const TrajectoryOverlay: Component<TrajectoryOverlayProps> = (props) => {
  // Generate SVG path segments for trajectory arc (handles wraparound)
  const trajectorySegments = createMemo(() => {
    if (!props.prediction || !props.showTrajectory) return [];
    return getTrajectorySegments(props.prediction, props.worldWidth);
  });

  // Impact marker position
  const impactMarker = createMemo(() => {
    if (!props.prediction?.impactPoint) return null;
    return props.prediction.impactPoint;
  });

  // Check if impact point is on an occupied pad
  const impactOnOccupiedPad = createMemo(() => {
    if (!props.prediction?.impactPoint) return false;
    const impactX = props.prediction.impactPoint.x;
    return props.landingPads.some(
      (pad) => pad.occupied && impactX >= pad.x1 && impactX <= pad.x2,
    );
  });

  // Color based on whether we'll hit the pad (red if occupied)
  const trajectoryColor = createMemo(() => {
    if (!props.prediction) return "rgba(255, 255, 0, 0.5)";
    if (impactOnOccupiedPad()) return "rgba(255, 50, 50, 0.8)"; // Red for occupied pad
    if (props.prediction.onPad) return "rgba(0, 255, 136, 0.7)";
    if (props.prediction.distanceFromPad < 50) return "rgba(255, 200, 0, 0.7)";
    return "rgba(255, 100, 100, 0.6)";
  });

  // Target pad center
  const padCenter = createMemo(() => {
    if (!props.targetPad) return null;
    return (props.targetPad.x1 + props.targetPad.x2) / 2;
  });

  return (
    <g class="trajectory-overlay">
      {/* Predicted trajectory arc (multiple segments for wraparound) */}
      <Show
        when={
          trajectorySegments().length > 0 &&
          props.phase !== "landed" &&
          props.phase !== "crashed"
        }
      >
        <For each={trajectorySegments()}>
          {(segment) => (
            <path
              d={segment}
              fill="none"
              stroke={trajectoryColor()}
              stroke-width="2"
              stroke-dasharray="8 4"
              filter="url(#glow)"
            />
          )}
        </For>
      </Show>

      {/* Impact point marker */}
      <Show
        when={
          impactMarker() &&
          props.phase !== "landed" &&
          props.phase !== "crashed"
        }
      >
        <g transform={`translate(${impactMarker()!.x}, ${impactMarker()!.y})`}>
          {/* X marks the spot */}
          <line
            x1="-8"
            y1="-8"
            x2="8"
            y2="8"
            stroke={trajectoryColor()}
            stroke-width="2"
            filter="url(#glow)"
          />
          <line
            x1="8"
            y1="-8"
            x2="-8"
            y2="8"
            stroke={trajectoryColor()}
            stroke-width="2"
            filter="url(#glow)"
          />
          {/* Circle around impact point */}
          <circle
            cx="0"
            cy="0"
            r="12"
            fill="none"
            stroke={trajectoryColor()}
            stroke-width="1.5"
            stroke-dasharray="4 4"
            filter="url(#glow)"
          />
        </g>
      </Show>

      {/* Optimal burn point indicator (during orbit phase) */}
      <Show when={props.phase === "orbit" && props.optimalBurnPoint !== null}>
        <g>
          {/* Vertical line at optimal burn point */}
          <line
            x1={props.optimalBurnPoint!}
            y1={0}
            x2={props.optimalBurnPoint!}
            y2={200}
            stroke="rgba(0, 200, 255, 0.6)"
            stroke-width="2"
            stroke-dasharray="6 6"
            filter="url(#glow)"
          />
          {/* Diamond marker at top */}
          <polygon
            points={`${props.optimalBurnPoint!},20 ${props.optimalBurnPoint! - 8},35 ${props.optimalBurnPoint!},50 ${props.optimalBurnPoint! + 8},35`}
            fill="none"
            stroke="rgba(0, 200, 255, 0.8)"
            stroke-width="2"
            filter="url(#glow)"
          />
          {/* "BURN" label */}
          <text
            x={props.optimalBurnPoint!}
            y={70}
            text-anchor="middle"
            fill="rgba(0, 200, 255, 0.9)"
            font-size="10"
            font-family="var(--font-mono)"
            filter="url(#glow)"
          >
            DEORBIT
          </text>
        </g>
      </Show>

      {/* Target pad highlight */}
      <Show when={props.targetPad && padCenter()}>
        <g>
          {/* Target reticle at pad */}
          <circle
            cx={padCenter()!}
            cy={props.targetPad!.y - 30}
            r="15"
            fill="none"
            stroke="rgba(0, 255, 136, 0.5)"
            stroke-width="1.5"
            filter="url(#glow)"
          />
          <line
            x1={padCenter()! - 20}
            y1={props.targetPad!.y - 30}
            x2={padCenter()! + 20}
            y2={props.targetPad!.y - 30}
            stroke="rgba(0, 255, 136, 0.5)"
            stroke-width="1"
          />
          <line
            x1={padCenter()!}
            y1={props.targetPad!.y - 50}
            x2={padCenter()!}
            y2={props.targetPad!.y - 10}
            stroke="rgba(0, 255, 136, 0.5)"
            stroke-width="1"
          />
        </g>
      </Show>

      {/* Insertion window countdown (shown in orbit) */}
      <Show when={props.phase === "orbit" && props.windowOpensIn > 0.5}>
        <g>
          {/* This will be positioned in screen space by HUD, but we can add a marker here */}
        </g>
      </Show>

      {/* Impact prediction info */}
      <Show
        when={props.prediction && impactMarker() && props.phase === "descent"}
      >
        <g
          transform={`translate(${impactMarker()!.x}, ${impactMarker()!.y - 25})`}
        >
          <text
            x="0"
            y="0"
            text-anchor="middle"
            fill={trajectoryColor()}
            font-size="9"
            font-family="var(--font-mono)"
            filter="url(#glow)"
          >
            {props.prediction!.impactTime.toFixed(1)}s
          </text>
          <text
            x="0"
            y="10"
            text-anchor="middle"
            fill={trajectoryColor()}
            font-size="9"
            font-family="var(--font-mono)"
            filter="url(#glow)"
          >
            {props.prediction!.impactVelocity.toFixed(0)} m/s
          </text>
        </g>
      </Show>
    </g>
  );
};

export default TrajectoryOverlay;
