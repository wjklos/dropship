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
  lockedDeorbitX: number | null;
  deorbitTimingDelta: number | null;
  showTrajectory: boolean;
  phase: "orbit" | "descent" | "terminal" | "landed" | "crashed" | "abort";
  worldWidth: number;
  currentGs: number;
  maxGs: number;
  landerX: number;
  landerY: number;
  landerVelocityX: number;
  zoomScale: number;
  gameTime: number;
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

  // Hide reticle and X marker at high zoom (scale >= 3)
  const isCloseView = createMemo(() => props.zoomScale >= 3);

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

      {/* Impact point marker - hidden at close zoom */}
      <Show
        when={
          impactMarker() &&
          props.phase !== "landed" &&
          props.phase !== "crashed" &&
          !isCloseView()
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

      {/* Deorbit burn window - horizontal bar showing green/yellow/red zones */}
      <Show
        when={
          props.lockedDeorbitX !== null &&
          props.phase !== "landed" &&
          props.phase !== "crashed"
        }
      >
        {(() => {
          const optimalX = props.lockedDeorbitX!;
          const velocity = props.landerVelocityX;
          const worldWidth = props.worldWidth;

          // Calculate horizontal distance from lander to deorbit point
          // Account for world wraparound
          let distanceToDeorbit = optimalX - props.landerX;
          if (velocity > 0) {
            // Moving right - if deorbit is "behind" us, it's actually ahead (wrapped)
            if (distanceToDeorbit < 0) distanceToDeorbit += worldWidth;
          } else if (velocity < 0) {
            // Moving left
            if (distanceToDeorbit > 0) distanceToDeorbit -= worldWidth;
          }

          // Time to reach deorbit point
          const timeToDeorbit =
            velocity !== 0 ? Math.abs(distanceToDeorbit / velocity) : 999;

          // Use a FIXED reference velocity for zone widths (orbital velocity at lock time)
          // This prevents the bar from collapsing when thrust changes velocity
          // Use 100 px/s as a reasonable orbital speed reference
          const referenceVelocity = 100;

          // Define window zones (in seconds converted to pixels based on reference velocity)
          // Green: optimal point (small zone around optimalX)
          // Yellow: acceptable zone (extends from green)
          // Red: last chance / overshoot zone (extends from yellow on both sides)
          const greenHalfWidth = referenceVelocity * 0.5; // ±0.5 second buffer = 1s total
          const yellowWidth = referenceVelocity * 1.5; // 1.5 more seconds each side
          const redWidth = referenceVelocity * 1; // 1 more second each side

          // Flash speed based on urgency
          const flashSpeed = timeToDeorbit < 1 ? 10 : timeToDeorbit < 3 ? 6 : 3;
          const flashOpacity =
            timeToDeorbit < 5
              ? 0.7 + 0.3 * Math.abs(Math.sin(props.gameTime * flashSpeed))
              : 0.8;

          // Determine current zone color for text based on time and whether we've passed it
          let textColor = "rgba(0, 255, 100, 0.9)"; // Green
          const timePastOptimal = -timeToDeorbit; // Negative means we haven't reached it yet

          if (timeToDeorbit < 0.5 && timeToDeorbit >= 0) {
            textColor = "rgba(0, 255, 100, 1)"; // Green - we're in the sweet spot
          } else if (timeToDeorbit < 2) {
            textColor = "rgba(255, 200, 0, 1)"; // Yellow - close
          } else if (timeToDeorbit < 3.5) {
            textColor = "rgba(255, 200, 0, 0.9)"; // Yellow - approaching
          } else {
            textColor = "rgba(0, 255, 100, 0.9)"; // Green - plenty of time
          }

          // Position the bar at orbital altitude (around y=100)
          const barY = 95;
          const barHeight = 14;

          return (
            <g>
              {/* Horizontal burn window bar - SYMMETRICAL zones on both sides */}
              <g opacity={flashOpacity}>
                {/* Left red zone (undershoot - too early) */}
                <rect
                  x={optimalX - greenHalfWidth - yellowWidth - redWidth}
                  y={barY}
                  width={redWidth}
                  height={barHeight}
                  fill="url(#deorbit-hatch-red)"
                  stroke="rgba(255, 50, 50, 0.8)"
                  stroke-width="1"
                />
                {/* Left yellow zone */}
                <rect
                  x={optimalX - greenHalfWidth - yellowWidth}
                  y={barY}
                  width={yellowWidth}
                  height={barHeight}
                  fill="url(#deorbit-hatch-yellow)"
                  stroke="rgba(255, 200, 0, 0.8)"
                  stroke-width="1"
                />
                {/* Green zone (optimal - centered) */}
                <rect
                  x={optimalX - greenHalfWidth}
                  y={barY}
                  width={greenHalfWidth * 2}
                  height={barHeight}
                  fill="url(#deorbit-hatch-green)"
                  stroke="rgba(0, 255, 100, 0.8)"
                  stroke-width="1"
                />
                {/* Right yellow zone */}
                <rect
                  x={optimalX + greenHalfWidth}
                  y={barY}
                  width={yellowWidth}
                  height={barHeight}
                  fill="url(#deorbit-hatch-yellow)"
                  stroke="rgba(255, 200, 0, 0.8)"
                  stroke-width="1"
                />
                {/* Right red zone (overshoot - too late) */}
                <rect
                  x={optimalX + greenHalfWidth + yellowWidth}
                  y={barY}
                  width={redWidth}
                  height={barHeight}
                  fill="url(#deorbit-hatch-red)"
                  stroke="rgba(255, 50, 50, 0.8)"
                  stroke-width="1"
                />
              </g>

              {/* Countdown timer - below bar (only shown before burn starts) */}
              {props.deorbitTimingDelta === null && (
                <text
                  x={optimalX}
                  y={barY + barHeight + 18}
                  text-anchor="middle"
                  fill={textColor}
                  font-size="11"
                  font-family="var(--font-mono)"
                  font-weight="bold"
                  filter="url(#glow)"
                  opacity={flashOpacity}
                >
                  {timeToDeorbit > 99
                    ? "---"
                    : timeToDeorbit < 0.5
                      ? "NOW!"
                      : `T-${timeToDeorbit.toFixed(1)}s`}
                </text>
              )}

              {/* Timing delta - shown after burn starts */}
              {props.deorbitTimingDelta !== null && (
                <text
                  x={optimalX}
                  y={barY + barHeight + 18}
                  text-anchor="middle"
                  fill={
                    Math.abs(props.deorbitTimingDelta) < 0.5
                      ? "rgba(0, 255, 100, 1)"
                      : Math.abs(props.deorbitTimingDelta) < 2
                        ? "rgba(255, 200, 0, 1)"
                        : "rgba(255, 50, 50, 1)"
                  }
                  font-size="11"
                  font-family="var(--font-mono)"
                  font-weight="bold"
                  filter="url(#glow)"
                  opacity={0.9}
                >
                  {props.deorbitTimingDelta >= 0 ? "+" : ""}
                  {props.deorbitTimingDelta.toFixed(1)}s
                </text>
              )}

              {/* Optimal point marker - solid green line through the bar */}
              <line
                x1={optimalX}
                y1={barY - 4}
                x2={optimalX}
                y2={barY + barHeight + 4}
                stroke="rgba(0, 255, 100, 1)"
                stroke-width="2"
                filter="url(#glow)"
                opacity={flashOpacity}
              />

              {/* Vertical guide line extending down from bar to surface */}
              <line
                x1={optimalX}
                y1={barY + barHeight}
                x2={optimalX}
                y2={500}
                stroke="rgba(0, 255, 100, 0.6)"
                stroke-width="1.5"
                stroke-dasharray="8 6"
                opacity={0.4 * flashOpacity}
                filter="url(#glow)"
              />
            </g>
          );
        })()}
      </Show>

      {/* Target pad highlight - hidden at close zoom */}
      <Show when={props.targetPad && padCenter() && !isCloseView()}>
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

      {/* Impact prediction info - positioned below the X marker */}
      <Show
        when={props.prediction && impactMarker() && props.phase === "descent"}
      >
        <g
          transform={`translate(${impactMarker()!.x}, ${impactMarker()!.y + 25})`}
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

      {/* G-force display - shown during active flight (not landed/crashed) */}
      <Show when={props.phase !== "landed" && props.phase !== "crashed"}>
        <g transform={`translate(${props.landerX}, ${props.landerY - 45})`}>
          {/* Current G-force */}
          <text
            x="0"
            y="0"
            text-anchor="middle"
            fill={
              props.currentGs > 3
                ? "rgba(255, 100, 100, 0.9)"
                : props.currentGs > 2
                  ? "rgba(255, 200, 0, 0.9)"
                  : "rgba(0, 255, 136, 0.8)"
            }
            font-size="10"
            font-family="var(--font-mono)"
            filter="url(#glow)"
          >
            {props.currentGs.toFixed(1)}G
          </text>
          {/* Max G-force */}
          <text
            x="0"
            y="12"
            text-anchor="middle"
            fill="rgba(180, 180, 180, 0.7)"
            font-size="8"
            font-family="var(--font-mono)"
            filter="url(#glow)"
          >
            MAX {props.maxGs.toFixed(1)}G
          </text>
        </g>
      </Show>
    </g>
  );
};

export default TrajectoryOverlay;
