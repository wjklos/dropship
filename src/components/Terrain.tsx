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
          const padWidth = () => pad.x2 - pad.x1;
          const padHeight = 3; // Height of hatched rectangle

          return (
            <g class="landing-pad" classList={{ selected: isSelected() }}>
              {/* Hatched rectangle pad - solid outline with diagonal lines inside */}
              <rect
                x={pad.x1}
                y={pad.y - padHeight}
                width={padWidth()}
                height={padHeight}
                fill="none"
                stroke={padColor()}
                stroke-width="2"
                filter="url(#glow-highlight)"
                class={isSelected() ? "strobe" : ""}
              />

              {/* Diagonal hatch lines inside the pad */}
              <g clip-path={`url(#pad-clip-${index()})`}>
                <defs>
                  <clipPath id={`pad-clip-${index()}`}>
                    <rect
                      x={pad.x1}
                      y={pad.y - padHeight}
                      width={padWidth()}
                      height={padHeight}
                    />
                  </clipPath>
                </defs>
                {/* Create diagonal hatch pattern */}
                {Array.from({ length: Math.ceil(padWidth() / 6) + 2 }).map(
                  (_, i) => (
                    <line
                      x1={pad.x1 + i * 6 - padHeight}
                      y1={pad.y}
                      x2={pad.x1 + i * 6}
                      y2={pad.y - padHeight}
                      stroke={padColor()}
                      stroke-width="1"
                      opacity="0.7"
                    />
                  ),
                )}
              </g>

              {/* Brightened top edge for depth */}
              <line
                x1={pad.x1}
                y1={pad.y - padHeight}
                x2={pad.x2}
                y2={pad.y - padHeight}
                stroke="white"
                stroke-width="1"
                opacity="0.5"
                filter="url(#glow)"
              />

              {/* Side markers extending up */}
              <line
                x1={pad.x1}
                y1={pad.y - padHeight}
                x2={pad.x1}
                y2={pad.y - 12}
                stroke={padColor()}
                stroke-width="2"
                filter="url(#glow-highlight)"
                class={isSelected() ? "strobe" : ""}
              />
              <line
                x1={pad.x2}
                y1={pad.y - padHeight}
                x2={pad.x2}
                y2={pad.y - 12}
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
                y2={pad.y - 8}
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

              {/* Vertical broadcast lines - always visible from orbit */}
              <line
                x1={pad.x1}
                y1={pad.y - 12}
                x2={pad.x1}
                y2={0}
                stroke={padColor()}
                stroke-width="1"
                stroke-dasharray="6 12"
                opacity={isSelected() ? "0.5" : "0.2"}
              />
              <line
                x1={pad.x2}
                y1={pad.y - 12}
                x2={pad.x2}
                y2={0}
                stroke={padColor()}
                stroke-width="1"
                stroke-dasharray="6 12"
                opacity={isSelected() ? "0.5" : "0.2"}
              />
              {/* Center guide line - brighter for selected pad */}
              <line
                x1={padCenter()}
                y1={pad.y - 22}
                x2={padCenter()}
                y2={0}
                stroke={padColor()}
                stroke-width={isSelected() ? "2" : "1"}
                stroke-dasharray={isSelected() ? "4 6" : "2 10"}
                opacity={isSelected() ? "0.6" : "0.15"}
                filter={isSelected() ? "url(#glow)" : "none"}
              />
            </g>
          );
        }}
      </For>
    </g>
  );
};

export default Terrain;
