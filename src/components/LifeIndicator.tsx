import { Component, For, Show, createMemo } from "solid-js";
import type { WorldId } from "../lib/worldRegistry";

interface LifeIndicatorProps {
  lives: number;
  maxLives: number;
  worldId: WorldId;
  lifeLostAnimation: boolean;
  lifeGainedAnimation: boolean;
}

/**
 * Mini lander icon for life display
 * Simplified version of the main lander, scaled to ~15px
 */
const MiniLander: Component<{
  index: number;
  isActive: boolean;
  isLost: boolean;
  isNew: boolean;
  color: string;
}> = (props) => {
  const x = () => props.index * 22 + 10;

  return (
    <g
      transform={`translate(${x()}, 10)`}
      class={`life-icon ${props.isLost ? "exploding" : ""} ${props.isNew ? "drawing" : ""}`}
      style={{ opacity: props.isActive ? 1 : 0.2 }}
    >
      {/* Simplified lander body - scaled down */}
      <g transform="scale(0.4)">
        {/* Main body */}
        <path
          d="M 0 -15 L -12 5 L -8 5 L -8 10 L 8 10 L 8 5 L 12 5 Z"
          fill="none"
          stroke={props.color}
          stroke-width="2"
          stroke-linejoin="round"
        />
        {/* Left leg */}
        <line
          x1="-8"
          y1="10"
          x2="-15"
          y2="18"
          stroke={props.color}
          stroke-width="1.5"
        />
        <line
          x1="-15"
          y1="18"
          x2="-18"
          y2="18"
          stroke={props.color}
          stroke-width="1.5"
        />
        {/* Right leg */}
        <line
          x1="8"
          y1="10"
          x2="15"
          y2="18"
          stroke={props.color}
          stroke-width="1.5"
        />
        <line
          x1="15"
          y1="18"
          x2="18"
          y2="18"
          stroke={props.color}
          stroke-width="1.5"
        />
      </g>
    </g>
  );
};

/**
 * Explosion debris for lost life animation
 */
const LifeExplosion: Component<{ index: number; color: string }> = (props) => {
  const x = () => props.index * 22 + 10;

  // Generate debris lines
  const debris = [
    { angle: 0, length: 8 },
    { angle: 45, length: 6 },
    { angle: 90, length: 7 },
    { angle: 135, length: 5 },
    { angle: 180, length: 8 },
    { angle: 225, length: 6 },
    { angle: 270, length: 7 },
    { angle: 315, length: 5 },
  ];

  return (
    <g transform={`translate(${x()}, 10)`} class="life-explosion">
      <For each={debris}>
        {(d) => {
          const rad = (d.angle * Math.PI) / 180;
          const x2 = Math.cos(rad) * d.length;
          const y2 = Math.sin(rad) * d.length;
          return (
            <line
              x1="0"
              y1="0"
              x2={x2}
              y2={y2}
              stroke={props.color}
              stroke-width="1"
              class="debris-line"
              style={{
                "--debris-angle": `${d.angle}deg`,
                "--debris-length": `${d.length}px`,
              }}
            />
          );
        }}
      </For>
    </g>
  );
};

const LifeIndicator: Component<LifeIndicatorProps> = (props) => {
  const color = createMemo(() =>
    props.worldId === "mars" ? "#ff8844" : "#00ff88"
  );

  // Calculate which icons to show
  const lifeIcons = createMemo(() => {
    const icons = [];
    const displayCount = Math.min(props.maxLives, 5); // Show max 5 icons

    for (let i = 0; i < displayCount; i++) {
      icons.push({
        index: i,
        isActive: i < props.lives,
        isLost: props.lifeLostAnimation && i === props.lives - 1,
        isNew:
          props.lifeGainedAnimation && i === props.lives - 1 && props.lives > 0,
      });
    }
    return icons;
  });

  const showOverflow = createMemo(() => props.lives > 5);

  return (
    <div class="life-indicator">
      <svg
        width={Math.min(props.maxLives, 5) * 22 + 20}
        height="24"
        viewBox={`0 0 ${Math.min(props.maxLives, 5) * 22 + 20} 24`}
      >
        <defs>
          <filter id="life-glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="1" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
        </defs>

        <g filter="url(#life-glow)">
          <For each={lifeIcons()}>
            {(icon) => (
              <>
                <MiniLander
                  index={icon.index}
                  isActive={icon.isActive}
                  isLost={icon.isLost}
                  isNew={icon.isNew}
                  color={color()}
                />
                <Show when={icon.isLost}>
                  <LifeExplosion index={icon.index} color={color()} />
                </Show>
              </>
            )}
          </For>
        </g>
      </svg>

      <Show when={showOverflow()}>
        <span class="life-overflow" style={{ color: color() }}>
          +{props.lives - 5}
        </span>
      </Show>
    </div>
  );
};

export default LifeIndicator;
