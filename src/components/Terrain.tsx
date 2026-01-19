import { Component, createMemo, For } from "solid-js";
import type { TerrainPoint, LandingPad, PadViability } from "../lib/types";
import { terrainToPath } from "../lib/terrain";

/**
 * Pad visual state for color coding
 * - locked: Blue - committed target pad
 * - locked_nonviable: Flashing blue/red - locked but can't reach it
 * - highlighted: Yellow/gold - currently highlighted for manual selection
 * - in_cone: Cyan - in the landing cone (reachable)
 * - viable: Green - achievable alternative (not in cone)
 * - nonviable: Dim - can't reach this pad
 */
export type PadVisualState =
  | "locked"
  | "locked_nonviable"
  | "highlighted"
  | "in_cone"
  | "viable"
  | "nonviable";

interface TerrainProps {
  terrain: TerrainPoint[];
  landingPads: LandingPad[];
  padViabilities: PadViability[];
  selectedPadIndex: number;
  lockedPadIndex: number | null; // Which pad is locked (committed)
  lockedPadViable: boolean; // Is the locked pad still reachable?
  highlightedPadIndex: number | null; // Which pad is highlighted for manual selection
  landingCone: number[]; // Pad indices in the reachable landing cone
  width: number;
  height: number;
  destroyedPadIndex: number | null; // Pad with destroyed rocket (from crash)
  time?: number; // Game time for wave animation (Earth)
  worldId?: string; // World ID for Earth-specific features
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

  // Earth-specific: Separate land and water segments
  const landSegments = createMemo(() =>
    props.terrain.filter((p) => !p.isWater),
  );

  const waterSegments = createMemo(() =>
    props.terrain.filter((p) => p.isWater === true),
  );

  // Water surface with animated waves
  const waterPath = createMemo(() => {
    const water = waterSegments();
    if (water.length === 0) return "";

    const time = props.time || 0;
    let path = `M ${water[0].x} ${water[0].y}`;

    for (let i = 1; i < water.length; i++) {
      // Add subtle wave motion
      const waveY = water[i].y + Math.sin(water[i].x * 0.02 + time * 0.001) * 2;
      path += ` L ${water[i].x} ${waveY}`;
    }

    return path;
  });

  return (
    <g class="terrain">
      {/* Terrain fill - subtle, uses world theme color */}
      <path d={terrainPath()} fill="var(--world-terrain)" stroke="none" />

      {/* Earth water surface */}
      {waterSegments().length > 0 && (
        <>
          {/* Water fill below surface */}
          <path
            d={`${waterPath()} L ${props.width} ${props.height} L 0 ${props.height} Z`}
            fill="var(--world-water, #1A4D6D)"
            opacity="0.6"
          />
          {/* Animated water surface line */}
          <path
            d={waterPath()}
            fill="none"
            stroke="var(--world-water-stroke, #2A6D8D)"
            stroke-width="2"
            opacity="0.8"
          />
        </>
      )}

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
          const isLocked = () => props.lockedPadIndex === index();
          const isHighlighted = () => props.highlightedPadIndex === index();
          const isInCone = () => props.landingCone.includes(index());

          // Determine pad visual state
          const padState = (): PadVisualState => {
            if (isLocked()) {
              return props.lockedPadViable ? "locked" : "locked_nonviable";
            }
            // Highlighted pad (manual selection cycling) - only if not locked
            if (isHighlighted() && isInCone()) {
              return "highlighted";
            }
            // Show cone membership before general viability
            if (isInCone()) {
              return "in_cone";
            }
            if (viability()?.viable !== false) {
              return "viable";
            }
            return "nonviable";
          };

          // Color based on state
          // Blue = locked, Yellow = highlighted, Cyan = in cone, Green = viable alternatives, Dim = nonviable
          const padColor = () => {
            switch (padState()) {
              case "locked":
                return "#4488ff"; // Blue - committed target
              case "locked_nonviable":
                return "#4488ff"; // Base blue (CSS animation handles flash)
              case "highlighted":
                return "#ffdd44"; // Yellow/gold - currently highlighted for selection
              case "in_cone":
                return "#44dddd"; // Cyan - in landing cone (reachable)
              case "viable":
                return "#44ff88"; // Green - achievable alternative
              case "nonviable":
                return "var(--world-pad-unviable)"; // Dim
            }
          };

          const padCenter = () => (pad.x1 + pad.x2) / 2;
          const padWidth = () => pad.x2 - pad.x1;
          const padHeight = 3; // Height of hatched rectangle

          // Floating pad wave animation (Earth only)
          const waveOffset = () => {
            if (!pad.isFloating) return 0;
            const time = props.time || 0;
            return Math.sin(time * 0.5 + (pad.wavePhase || 0)) * 3;
          };

          const padY = () => pad.y + waveOffset();

          return (
            <g
              class="landing-pad"
              classList={{
                selected: isLocked(), // Only mark as selected when locked
                locked: padState() === "locked",
                "locked-nonviable": padState() === "locked_nonviable",
              }}
            >
              {/* Hatched rectangle pad - solid outline with diagonal lines inside */}
              <rect
                x={pad.x1}
                y={padY() - padHeight}
                width={padWidth()}
                height={padHeight}
                fill="none"
                stroke={padColor()}
                stroke-width={isLocked() ? "3" : "2"}
                filter={
                  isLocked() ? "url(#glow-strong)" : "url(#glow-highlight)"
                }
                class={
                  padState() === "locked_nonviable"
                    ? "flash-warning"
                    : isLocked()
                      ? "strobe"
                      : ""
                }
              />

              {/* Diagonal hatch lines inside the pad */}
              <g clip-path={`url(#pad-clip-${index()})`}>
                <defs>
                  <clipPath id={`pad-clip-${index()}`}>
                    <rect
                      x={pad.x1}
                      y={padY() - padHeight}
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
                      y1={padY()}
                      x2={pad.x1 + i * 6}
                      y2={padY() - padHeight}
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
                y1={padY() - padHeight}
                x2={pad.x2}
                y2={padY() - padHeight}
                stroke="white"
                stroke-width="1"
                opacity="0.5"
                filter="url(#glow)"
              />

              {/* Side markers extending up */}
              <line
                x1={pad.x1}
                y1={padY() - padHeight}
                x2={pad.x1}
                y2={padY() - 12}
                stroke={padColor()}
                stroke-width={isLocked() ? "3" : "2"}
                filter={
                  isLocked() ? "url(#glow-strong)" : "url(#glow-highlight)"
                }
                class={
                  padState() === "locked_nonviable"
                    ? "flash-warning"
                    : isLocked()
                      ? "strobe"
                      : ""
                }
              />
              <line
                x1={pad.x2}
                y1={padY() - padHeight}
                x2={pad.x2}
                y2={padY() - 12}
                stroke={padColor()}
                stroke-width={isLocked() ? "3" : "2"}
                filter={
                  isLocked() ? "url(#glow-strong)" : "url(#glow-highlight)"
                }
                class={
                  padState() === "locked_nonviable"
                    ? "flash-warning"
                    : isLocked()
                      ? "strobe"
                      : ""
                }
              />

              {/* Center marker */}
              <line
                x1={padCenter()}
                y1={padY() - 15}
                x2={padCenter()}
                y2={padY() - 8}
                stroke={padColor()}
                stroke-width={isLocked() ? "3" : "2"}
                filter={
                  isLocked() ? "url(#glow-strong)" : "url(#glow-highlight)"
                }
                class={
                  padState() === "locked_nonviable"
                    ? "flash-warning"
                    : isLocked()
                      ? "strobe"
                      : ""
                }
              />

              {/* Multiplier label - show "OCCUPIED" for occupied pads */}
              <text
                x={padCenter()}
                y={padY() - 22}
                text-anchor="middle"
                fill={pad.occupied ? "#ff6644" : padColor()}
                font-size="12"
                font-family="var(--font-display)"
                filter="url(#glow)"
              >
                {pad.occupied ? "OCCUPIED" : `${pad.multiplier}x`}
              </text>

              {/* Floating pad pontoons (Earth only) */}
              {pad.isFloating && (
                <>
                  {/* Left pontoon */}
                  <rect
                    x={pad.x1 + 5}
                    y={padY() + 3}
                    width="12"
                    height="6"
                    rx="2"
                    fill="none"
                    stroke={padColor()}
                    stroke-width="1"
                    opacity="0.6"
                  />
                  {/* Right pontoon */}
                  <rect
                    x={pad.x2 - 17}
                    y={padY() + 3}
                    width="12"
                    height="6"
                    rx="2"
                    fill="none"
                    stroke={padColor()}
                    stroke-width="1"
                    opacity="0.6"
                  />
                  {/* Support struts */}
                  <line
                    x1={pad.x1 + 11}
                    y1={padY()}
                    x2={pad.x1 + 11}
                    y2={padY() + 3}
                    stroke={padColor()}
                    stroke-width="1"
                  />
                  <line
                    x1={pad.x2 - 11}
                    y1={padY()}
                    x2={pad.x2 - 11}
                    y2={padY() + 3}
                    stroke={padColor()}
                    stroke-width="1"
                  />
                </>
              )}

              {/* Rocket on occupied pads - sitting on the pad surface (hide if destroyed) */}
              {pad.occupied && props.destroyedPadIndex !== index() && (
                <g
                  class="parked-rocket"
                  transform={`translate(${padCenter()}, ${padY() - 11})`}
                >
                  {/* Rocket body - simple vector style */}
                  <path
                    d="M 0 -45 L 8 -20 L 8 0 L -8 0 L -8 -20 Z"
                    fill="none"
                    stroke="#ff8866"
                    stroke-width="1.5"
                    filter="url(#glow)"
                  />
                  {/* Rocket nose cone */}
                  <path
                    d="M 0 -45 L 6 -35 L -6 -35 Z"
                    fill="none"
                    stroke="#ff8866"
                    stroke-width="1.5"
                  />
                  {/* Left fin */}
                  <path
                    d="M -8 0 L -14 8 L -8 -8 Z"
                    fill="none"
                    stroke="#ff8866"
                    stroke-width="1"
                  />
                  {/* Right fin */}
                  <path
                    d="M 8 0 L 14 8 L 8 -8 Z"
                    fill="none"
                    stroke="#ff8866"
                    stroke-width="1"
                  />
                  {/* Window */}
                  <circle
                    cx="0"
                    cy="-28"
                    r="4"
                    fill="none"
                    stroke="#ffaa88"
                    stroke-width="1"
                  />
                  {/* Engine nozzle */}
                  <path
                    d="M -5 0 L -6 5 L 6 5 L 5 0"
                    fill="none"
                    stroke="#ff8866"
                    stroke-width="1"
                  />
                </g>
              )}

              {/* Vertical broadcast lines - ONLY visible when locked */}
              {isLocked() && (
                <>
                  <line
                    x1={pad.x1}
                    y1={padY() - 12}
                    x2={pad.x1}
                    y2={0}
                    stroke={padColor()}
                    stroke-width="2"
                    stroke-dasharray="8 8"
                    opacity="0.7"
                    class={
                      padState() === "locked_nonviable" ? "flash-warning" : ""
                    }
                  />
                  <line
                    x1={pad.x2}
                    y1={padY() - 12}
                    x2={pad.x2}
                    y2={0}
                    stroke={padColor()}
                    stroke-width="2"
                    stroke-dasharray="8 8"
                    opacity="0.7"
                    class={
                      padState() === "locked_nonviable" ? "flash-warning" : ""
                    }
                  />
                  {/* Center guide line */}
                  <line
                    x1={padCenter()}
                    y1={padY() - 22}
                    x2={padCenter()}
                    y2={0}
                    stroke={padColor()}
                    stroke-width="3"
                    stroke-dasharray="6 4"
                    opacity="0.8"
                    filter="url(#glow)"
                    class={
                      padState() === "locked_nonviable" ? "flash-warning" : ""
                    }
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
