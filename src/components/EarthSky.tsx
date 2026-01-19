import { Component, For } from "solid-js";

interface Star {
  x: number;
  y: number;
  size: number;
  brightness: number;
}

interface EarthSkyProps {
  width: number;
  height: number;
  stars: Star[];
}

/**
 * Earth-specific sky background with dawn gradient, stars, and rising sun
 * Creates a "dawn landing" aesthetic - stars at top, sunrise at bottom
 */
const EarthSky: Component<EarthSkyProps> = (props) => {
  return (
    <g class="earth-sky">
      {/* Dawn gradient background */}
      <defs>
        <linearGradient
          id="earth-sky-gradient"
          x1="0%"
          y1="0%"
          x2="0%"
          y2="100%"
        >
          {/* Top: Deep space with stars visible */}
          <stop offset="0%" stop-color="#0A0A1A" />
          <stop offset="25%" stop-color="#0F1025" />
          {/* Middle: Twilight transition */}
          <stop offset="45%" stop-color="#1A1A3A" />
          <stop offset="60%" stop-color="#2A3A5A" />
          {/* Horizon: Warm sunrise colors */}
          <stop offset="75%" stop-color="#4A3A4A" />
          <stop offset="85%" stop-color="#FF7E5F" />
          <stop offset="92%" stop-color="#FEB47B" />
          <stop offset="100%" stop-color="#FFD194" />
        </linearGradient>

        {/* Sun glow filter */}
        <filter id="sun-glow" x="-100%" y="-100%" width="300%" height="300%">
          <feGaussianBlur stdDeviation="15" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>

        {/* Sun corona gradient */}
        <radialGradient id="sun-corona" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stop-color="#FFD700" stop-opacity="0.9" />
          <stop offset="30%" stop-color="#FFB366" stop-opacity="0.6" />
          <stop offset="60%" stop-color="#FF9E4D" stop-opacity="0.3" />
          <stop offset="100%" stop-color="#FF7E5F" stop-opacity="0" />
        </radialGradient>
      </defs>

      {/* Sky gradient background */}
      <rect
        width={props.width}
        height={props.height}
        fill="url(#earth-sky-gradient)"
      />

      {/* Stars in upper 40% of sky */}
      <For each={props.stars.filter((s) => s.y < props.height * 0.4)}>
        {(star) => (
          <circle
            cx={star.x}
            cy={star.y}
            r={star.size}
            fill="white"
            opacity={star.brightness * 0.8}
          />
        )}
      </For>

      {/* Rising sun at bottom center - partially below horizon */}
      <g transform={`translate(${props.width / 2}, ${props.height + 60})`}>
        {/* Outer corona glow (large, faded) */}
        <circle r="200" fill="url(#sun-corona)" />

        {/* Middle glow ring */}
        <circle
          r="120"
          fill="none"
          stroke="#FFB366"
          stroke-width="2"
          opacity="0.4"
        />

        {/* Inner glow */}
        <circle r="80" fill="#FF9E4D" filter="url(#sun-glow)" opacity="0.7" />

        {/* Sun core */}
        <circle r="50" fill="#FFD700" filter="url(#sun-glow)" opacity="0.9" />

        {/* Bright center */}
        <circle r="25" fill="#FFFFEE" opacity="0.8" />
      </g>

      {/* Atmospheric haze layer near horizon */}
      <rect
        x="0"
        y={props.height * 0.7}
        width={props.width}
        height={props.height * 0.3}
        fill="url(#atmosphere-haze)"
        opacity="0.15"
      />

      <defs>
        <linearGradient id="atmosphere-haze" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stop-color="#4DA6FF" stop-opacity="0" />
          <stop offset="100%" stop-color="#4DA6FF" stop-opacity="0.4" />
        </linearGradient>
      </defs>
    </g>
  );
};

export default EarthSky;
