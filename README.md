# Lunar Lander

A vector-style lunar lander game built with Solid.js, inspired by the 1979 Atari arcade classic and NASA mission control aesthetics.

![Lunar Lander](screenshot.png)

## Features

- **Vector Graphics**: SVG-based rendering with authentic phosphorescent CRT glow
- **CRT Effects**: Scanlines, vignette, and subtle flicker for that retro feel
- **Realistic Physics**: Newtonian mechanics with thrust, gravity, and rotation
- **Autopilot System**: PD controller-based autopilot with multiple modes:
  - **Stabilize**: Automatically keeps the lander upright while you control thrust
  - **Land**: Full autonomous landing sequence
  - **Demo**: Watch the AI land perfectly
- **NASA Mission Control HUD**: Seven-segment displays, status indicators, and telemetry

## Getting Started

```bash
# Install dependencies
npm install

# Start development server
npm run dev

# Build for production
npm run build
```

Then open http://localhost:3000 in your browser.

## Controls

| Key | Action |
|-----|--------|
| `↑` / `W` / `Space` | Thrust |
| `←` / `A` | Rotate left |
| `→` / `D` | Rotate right |
| `P` | Pause |
| `R` | Reset / New game |
| `1` | Autopilot OFF |
| `2` | Autopilot STABILIZE |
| `3` | Autopilot LAND |
| `0` | Autopilot DEMO |

## Landing Requirements

- Vertical speed: < 15 m/s
- Angle: < 17° from vertical  
- Position: On the landing pad (highlighted in yellow)

## Project Structure

```
src/
├── components/
│   ├── Game.tsx       # Main game loop and rendering
│   ├── Lander.tsx     # SVG lander with thrust animation
│   ├── Terrain.tsx    # Procedural terrain with landing pad
│   ├── HUD.tsx        # Mission control telemetry display
│   └── CRTOverlay.tsx # Scanlines and glow effects
├── lib/
│   ├── physics.ts     # Newtonian physics simulation
│   ├── autopilot.ts   # PD controller autopilot
│   ├── terrain.ts     # Midpoint displacement terrain gen
│   └── types.ts       # TypeScript interfaces
├── stores/
│   └── game.ts        # Solid.js signals for game state
├── App.tsx
├── index.tsx
└── index.css          # CRT aesthetic and HUD styling
```

## The Autopilot

The autopilot uses a **PD (Proportional-Derivative) controller** approach:

1. **Attitude Control**: Maintains upright orientation by applying rotation proportional to angle error, with derivative damping on angular velocity

2. **Horizontal Control**: Calculates desired horizontal velocity based on distance to landing pad, then tilts the lander to achieve it

3. **Descent Control**: Targets descent rate based on altitude (faster when high, slower near ground), with emergency braking near the surface

The three control loops blend together, with safety overrides when tilted too far from vertical.

## Tech Stack

- **Solid.js**: Fine-grained reactive framework - perfect for game state
- **Vite**: Fast dev server and bundler
- **TypeScript**: Type safety for physics and game logic
- **SVG**: Vector graphics that scale beautifully
- **CSS**: CRT effects without WebGL overhead

## Tuning

Key physics constants in `src/stores/game.ts`:

```typescript
gravity: 20,           // Lunar gravity (px/s²)
maxThrust: 60,         // Engine power (px/s²)
rotationSpeed: 4,      // Rotation rate (rad/s²)
fuelConsumption: 8,    // Fuel burn rate
maxLandingVelocity: 15,// Safe landing speed
maxLandingAngle: 0.3,  // Safe landing angle (radians)
```

Autopilot gains in `src/lib/autopilot.ts`:

```typescript
GAINS = {
  attitude: { kp: 3.0, kd: 2.0 },   // Rotation control
  horizontal: { kp: 0.02, kd: 0.3 }, // Position control  
  vertical: { kp: 0.5, ki: 0.01 },   // Descent control
}
```

## License

MIT - Have fun!
