/**
 * WindBands Component
 *
 * Displays horizontal bands showing atmospheric layers with wind information.
 * Shows faint lines at band boundaries with density/wind speed/direction indicators.
 */

import { Component, For, createMemo } from "solid-js";
import type { WindBand } from "../lib/types";
import type { AtmosphereConfig } from "../lib/worlds";
import { getWindBandsForDisplay } from "../lib/atmosphere";

interface WindBandsProps {
  atmosphere: AtmosphereConfig | undefined;
  worldHeight: number;
  worldWidth: number;
  terrainMaxY: number; // Highest Y value (lowest point) of terrain - the surface baseline
  gameTime: number;
  primaryColor: string;
}

const WindBands: Component<WindBandsProps> = (props) => {
  // Get wind bands with current wind values
  const bandsWithWind = createMemo(() =>
    getWindBandsForDisplay(props.atmosphere, props.gameTime),
  );

  // Convert altitude to Y coordinate (altitude is from surface, Y increases downward)
  // terrainMaxY is the lowest terrain point (highest Y), so altitude 0 = terrainMaxY
  const altitudeToY = (altitude: number) => props.terrainMaxY - altitude;

  // Format wind speed for display
  const formatWind = (speed: number) => {
    const absSpeed = Math.abs(speed);
    const direction = speed > 0 ? "→" : speed < 0 ? "←" : "";
    return `${direction}${absSpeed.toFixed(0)}`;
  };

  // Format density as percentage
  const formatDensity = (density: number) => `${(density * 100).toFixed(0)}%`;

  return (
    <g class="wind-bands">
      <For each={bandsWithWind()}>
        {(band) => {
          const y1 = altitudeToY(band.altitudeMax);
          const y2 = altitudeToY(band.altitudeMin);

          // Label in upper left corner of band
          const labelX = 10;
          const labelY = y1 + 12; // Just below top boundary

          return (
            <g>
              {/* Upper boundary line */}
              <line
                x1="0"
                y1={y1}
                x2={props.worldWidth}
                y2={y1}
                stroke={props.primaryColor}
                stroke-width="1"
                stroke-dasharray="10,8"
                opacity={0.5 + 0.3 * band.density}
              />

              {/* Band info label - upper left corner */}
              <text
                x={labelX}
                y={labelY}
                fill={props.primaryColor}
                font-size="10"
                font-family="'Share Tech Mono', monospace"
                text-anchor="start"
                dominant-baseline="hanging"
                opacity={0.6 + 0.2 * band.density}
              >
                {`ρ${formatDensity(band.density)} ${formatWind(band.currentWindX)}m/s`}
              </text>
            </g>
          );
        }}
      </For>
    </g>
  );
};

export default WindBands;
