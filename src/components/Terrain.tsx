import { Component, createMemo, For } from "solid-js";
import type { TerrainPoint, LandingPad, PadViability } from "../lib/types";
import { terrainToPath } from "../lib/terrain";

interface TerrainProps {
  terrain: TerrainPoint[];
  landingPads: LandingPad[];
  padViabilities: PadViability[];
  selectedPadIndex: number;
  width: number;
  height: number;
}

const Terrain: Component<TerrainProps> = (props) => {
  const terrainPath = createMemo(() =>
    terrainToPath(props.terrain, props.width, props.height),
  );

  // Create terrain outline (vector style - just the top edge)
  const terrainOutline = createMemo(() => {
    if (props.terrain.length === 0) return "";

    let path = `M ${props.terrain[0].x} ${props.terrain[0].y}`;
    for (let i = 1; i < props.terrain.length; i++) {
      path += ` L ${props.terrain[i].x} ${props.terrain[i].y}`;
    }
    return path;
  });

  return (
    <g class="terrain">
      {/* Terrain fill - subtle, uses world theme color */}
      <path d={terrainPath()} fill="var(--world-terrain)" stroke="none" />

      {/* Terrain outline - dim thin line so pads stand out */}
      <path
        d={terrainOutline()}
        fill="none"
        stroke="var(--world-terrain-stroke)"
        stroke-width="1"
        stroke-linecap="round"
        stroke-linejoin="round"
      />

      {/* Landing pads */}
      <For each={props.landingPads}>
        {(pad, index) => {
          const viability = () => props.padViabilities[index()];
          const isSelected = () => index() === props.selectedPadIndex;
          const padColor = () =>
            viability()?.viable !== false
              ? "var(--world-pad-viable)"
              : "var(--world-pad-unviable)";
          const padCenter = () => (pad.x1 + pad.x2) / 2;

          return (
            <g class="landing-pad" classList={{ selected: isSelected() }}>
              {/* Pad surface */}
              <line
                x1={pad.x1}
                y1={pad.y}
                x2={pad.x2}
                y2={pad.y}
                stroke={padColor()}
                stroke-width="4"
                stroke-linecap="round"
                filter="url(#glow-highlight)"
                class={isSelected() ? "strobe" : ""}
              />

              {/* Pad markers */}
              <line
                x1={pad.x1}
                y1={pad.y}
                x2={pad.x1}
                y2={pad.y - 10}
                stroke={padColor()}
                stroke-width="2"
                filter="url(#glow-highlight)"
                class={isSelected() ? "strobe" : ""}
              />
              <line
                x1={pad.x2}
                y1={pad.y}
                x2={pad.x2}
                y2={pad.y - 10}
                stroke={padColor()}
                stroke-width="2"
                filter="url(#glow-highlight)"
                class={isSelected() ? "strobe" : ""}
              />

              {/* Center marker */}
              <line
                x1={padCenter()}
                y1={pad.y - 15}
                x2={padCenter()}
                y2={pad.y - 5}
                stroke={padColor()}
                stroke-width="2"
                filter="url(#glow-highlight)"
                class={isSelected() ? "strobe" : ""}
              />

              {/* Multiplier label */}
              <text
                x={padCenter()}
                y={pad.y - 22}
                text-anchor="middle"
                fill={padColor()}
                font-size="12"
                font-family="var(--font-display)"
                filter="url(#glow)"
              >
                {pad.multiplier}x
              </text>

              {/* Glide path guides - vertical lines from selected pad */}
              {isSelected() && (
                <>
                  <line
                    x1={pad.x1}
                    y1={pad.y - 10}
                    x2={pad.x1}
                    y2={0}
                    stroke={padColor()}
                    stroke-width="1"
                    stroke-dasharray="4 8"
                    opacity="0.3"
                  />
                  <line
                    x1={pad.x2}
                    y1={pad.y - 10}
                    x2={pad.x2}
                    y2={0}
                    stroke={padColor()}
                    stroke-width="1"
                    stroke-dasharray="4 8"
                    opacity="0.3"
                  />
                </>
              )}
            </g>
          );
        }}
      </For>
    </g>
  );
};

export default Terrain;
