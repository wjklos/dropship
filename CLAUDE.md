# CLAUDE.md - Dropship Project

## Project Overview

A vector-style planetary lander game built with Solid.js, inspired by the 1979 Atari arcade classic. Features authentic CRT phosphor aesthetics, Newtonian physics simulation, multi-world support (Moon/Mars/Earth), orbital mechanics with zoom levels, and a PD controller-based autopilot system capable of autonomous landing.

**Primary Goal**: Create a playable, visually authentic recreation of the classic Lunar Lander experience with modern web technologies, emphasizing the vector graphics aesthetic and adding an intelligent autopilot for demonstration purposes.

---

## What Was Built

### Core Components

| Component | Purpose | Location |
|-----------|---------|----------|
| Physics Engine | Newtonian simulation with gravity gating for orbital mechanics | `src/lib/physics.ts` |
| GNC Autopilot | Two-burn landing with approach modes (Stop & Drop, Boostback) | `src/lib/autopilot.ts` |
| Trajectory Prediction | Real-time landing arc and impact point calculation | `src/lib/trajectory.ts` |
| Terrain Generator | Midpoint displacement algorithm for procedural landscapes | `src/lib/terrain.ts` |
| World System | Moon/Mars configurations with gravity, colors, autopilot tuning | `src/lib/worlds.ts` |
| Zoom System | Multi-level zoom based on altitude thresholds | `src/lib/zoom.ts` |
| Flight Logger | Landing analytics and statistics tracking | `src/lib/flightLogger.ts` |
| Game State Store | Solid.js signals for reactive state, phase tracking | `src/stores/game.ts` |
| SVG Renderer | Vector graphics with dynamic viewBox and glow filters | `src/components/*.tsx` |
| Crash Debris | Explosion animation when lander crashes | `src/components/CrashDebris.tsx` |
| Trajectory Overlay | Visual landing arc with impact marker | `src/components/TrajectoryOverlay.tsx` |
| CRT Effects | Scanlines, vignette, flicker via CSS | `src/index.css` |

### Key Features

1. **Multi-World Support**
   - Moon: Gray terrain, green UI, 1.62 m/s² gravity (20 px/s² game-scaled)
   - Mars: Rust terrain, orange UI, 3.71 m/s² gravity (46 px/s² game-scaled)
   - World selection in orbit, locked after first thrust
   - Per-world autopilot gain tuning

2. **Orbital Mechanics**
   - Lander starts in stable horizontal orbit
   - No gravity until first thrust tap (gravity gating)
   - Horizontal momentum carries through descent
   - Autopilot waits for optimal descent window

3. **Zoom System (like original Atari)**
   - Level 1 (orbital): 1200px view height
   - Level 2 (approach, <600px alt): 600px view height
   - Level 3 (descent, <300px alt): 400px view height
   - Level 4 (final, <100px alt): 300px view height
   - ViewBox follows lander, clamped to world bounds

4. **Full Screen Layout**
   - Fills browser window (100vw × 100vh)
   - World size: 2400×1200 pixels
   - Dynamic viewBox based on zoom level

5. **Dual-Leg Collision Detection**
   - Both leg positions checked (±20px from center, rotated)
   - Both legs must be on SAME pad for success
   - "DAMAGED" outcome: soft landing on rough terrain

6. **Failure Reason Tracking**
   - VELOCITY_HIGH: Impact speed exceeded
   - ANGLE_BAD: Landing attitude beyond limits
   - OFF_PAD: Missed landing zone
   - OUT_OF_FUEL: Propellant exhausted
   - DAMAGED: Landed on rough terrain (not a pad)
   - Displayed on crash screen with specific message

7. **Abort System**
   - Press [A] or [Escape] to abort
   - Only available during descent phase
   - Disabled below 600px altitude
   - Autopilot returns lander to orbit
   - Can reattempt landing after abort

8. **Multi-Pad Landing System**
   - Multiple landing pads per level (varies with world width)
   - Difficulty multipliers (1x-5x) based on pad width
   - Real-time viability tracking via trajectory simulation
   - Visual feedback: green (viable), red (unviable), strobe (selected)
   - Glide path guides on selected pad

9. **Demo Mode**
   - Auto-restart after landing/crash (2 second delay)
   - Stats tracking: attempts, successes, failures by reason
   - Graceful exit to other modes (keeps position/velocity)

10. **Graphics Refinements**
    - Tighter stroke widths (1.5px body, 1px details)
    - World-themed terrain colors
    - Enhanced pad highlighting (thicker lines, more glow)

11. **Approach Modes**
    - **Stop & Drop** [S]: Kill horizontal velocity early, then descend vertically
    - **Boostback** [B]: Coast toward target, then precision braking burn (SpaceX-style)
    - Selectable during autopilot modes via HUD buttons or keyboard

12. **Landing Cone System**
    - Real-time calculation of reachable pads based on velocity and position
    - Cyan highlighting for pads in the landing cone
    - Blue targeting crosshairs on locked pad only
    - Random pad selection from cone when autopilot engages in orbit

13. **Trajectory Prediction Overlay**
    - Real-time ballistic arc showing predicted flight path
    - Impact point marker (X) with color coding:
      - Green: Landing on viable pad
      - Yellow: Landing on terrain
      - Red: Landing on occupied pad
    - Shows insertion window countdown before optimal burn point

14. **Occupied Pads with Rockets**
    - 20% of pads randomly have parked rockets
    - Cannot land on occupied pads (treated as crash)
    - Vector-style rocket graphics matching lander aesthetic
    - Red X indicator when trajectory crosses occupied pad

15. **Crash & Explosion Effects**
    - Vector-style thrust flames (animated line segments)
    - Lander breaks apart on crash (body, legs, engine, RCS all separate)
    - Each debris piece has random velocity and spin
    - Debris falls with gravity and fades out
    - Crashing into occupied pad also explodes the rocket (chain reaction!)

16. **Flight Logging**
    - Tracks all landing attempts with detailed telemetry
    - Records approach mode, fuel usage, landing accuracy
    - Failure reason tracking for analysis
    - Stored in browser localStorage

---

## Technical Decisions & Rationale

### Why Solid.js?

Solid's fine-grained reactivity maps naturally to game state:

```typescript
// Each piece of state is a signal
const [lander, setLander] = createSignal<LanderState>(initialLander);

// Derived values auto-update without diffing
const altitude = createMemo(() => 
  getAltitude(lander().position, terrain(), config.width)
);
```

**Advantages over React for this use case:**
- No virtual DOM overhead in the game loop
- Signals update subscribers directly (O(1) vs O(n) diffing)
- `createMemo` provides efficient derived state
- Smaller bundle size (~7KB vs ~40KB)

### Why SVG over Canvas?

- **Resolution independence**: Scales perfectly on any display
- **DOM integration**: CSS filters work natively (glow effects)
- **Declarative**: Matches Solid's reactive model
- **Debugging**: Elements visible in DevTools
- **Dynamic viewBox**: Easy zoom implementation

### Why Fixed Timestep Physics?

```typescript
while (accumulator >= PHYSICS_TIMESTEP) {
  updatePhysics(state, PHYSICS_TIMESTEP);
  accumulator -= PHYSICS_TIMESTEP;
}
```

- **Determinism**: Same input always produces same output
- **Stability**: Physics doesn't explode on frame drops
- **Autopilot tuning**: Controller gains remain valid regardless of framerate

### Autopilot Architecture

**Staccato Approach**: Rotate WITHOUT thrust, then thrust only when upright.
- Prevents wasteful sideways thrust
- Reduces oscillation
- More fuel-efficient descent

PD (Proportional-Derivative) control chosen over PID because:
- Lunar landing is a finite-time maneuver (no steady-state error)
- Integral term causes overshoot in descent control
- Simpler to tune with only two gains per axis

World-specific gains:
- Moon: kp=3.0, kd=2.0 (baseline)
- Mars: kp=4.0, kd=2.5 (more aggressive for higher gravity)

---

## Project Structure

```
lunar-lander/
├── .gitignore              # Node.js gitignore
├── index.html              # Entry point
├── package.json            # Dependencies and scripts
├── tsconfig.json           # TypeScript configuration
├── vite.config.ts          # Vite bundler configuration
├── README.md               # User-facing documentation
├── CLAUDE.md               # This file
└── src/
    ├── index.tsx           # App bootstrap
    ├── index.css           # Global styles, CRT effects, world themes
    ├── App.tsx             # Root component
    ├── components/
    │   ├── Game.tsx        # Main game loop, keyboard handling, zoom
    │   ├── Lander.tsx      # SVG lander with vector thrust flames
    │   ├── Terrain.tsx     # SVG terrain, landing pads, parked rockets
    │   ├── HUD.tsx         # Telemetry, phase, world/approach selection
    │   ├── CRTOverlay.tsx  # Scanline/vignette effects
    │   ├── CrashDebris.tsx # Explosion debris animation
    │   └── TrajectoryOverlay.tsx  # Landing arc prediction display
    ├── lib/
    │   ├── types.ts        # TypeScript interfaces
    │   ├── physics.ts      # Newtonian simulation, dual-leg collision
    │   ├── autopilot.ts    # GNC autopilot, approach modes, pad selection
    │   ├── trajectory.ts   # Trajectory prediction, burn calculations
    │   ├── terrain.ts      # Procedural generation, occupied pads
    │   ├── worlds.ts       # World configurations (Moon, Mars)
    │   ├── zoom.ts         # Zoom level calculations
    │   └── flightLogger.ts # Landing analytics and storage
    └── stores/
        └── game.ts         # Solid.js reactive state, phase tracking
```

---

## Game Controls

| Key | Action |
|-----|--------|
| `↑` / `W` / `Space` | Main engine thrust |
| `←` | Rotate counter-clockwise |
| `→` | Rotate clockwise |
| `A` / `Escape` | Abort (return to orbit) |
| `P` | Pause/unpause |
| `R` | Reset (new terrain, new lander position) |
| `T` | Toggle trajectory prediction overlay |
| `1` | Autopilot OFF (full manual) |
| `2` | Autopilot STABILIZE (attitude hold, manual thrust) |
| `3` | Autopilot LAND (full autonomous) |
| `0` | Autopilot DEMO (autonomous + auto-restart + stats) |
| `S` | Select STOP & DROP approach mode |
| `B` | Select BOOSTBACK approach mode |

**World Selection** (in orbit only, before first burn):
- Click world buttons in HUD
- Selecting Mars changes gravity and color theme

**Approach Modes** (during autopilot):
- **Stop & Drop**: Traditional vertical descent after killing horizontal velocity
- **Boostback**: SpaceX-style coast then precision retrograde burn

---

## Configuration & Tuning

### World Configurations

In `src/lib/worlds.ts`:

```typescript
moon: {
  gravity: 20,              // px/s² (represents 1.62 m/s²)
  orbitalVelocity: 120,     // px/s horizontal
  orbitalAltitude: 800,     // px above terrain
  maxThrust: 60,
  colors: { /* gray terrain, green UI */ },
  autopilotGains: { attitude: { kp: 3.0, kd: 2.0 }, ... }
}

mars: {
  gravity: 46,              // px/s² (represents 3.71 m/s²)
  orbitalVelocity: 100,     // Slower due to higher gravity
  orbitalAltitude: 800,
  maxThrust: 80,            // Higher thrust to compensate
  colors: { /* rust terrain, orange UI */ },
  autopilotGains: { attitude: { kp: 4.0, kd: 2.5 }, ... }
}
```

### Zoom Levels

In `src/lib/zoom.ts`:

```typescript
ZOOM_LEVELS = [
  { altitudeThreshold: 600, scale: 1, viewHeight: 1200 },  // Orbital
  { altitudeThreshold: 300, scale: 2, viewHeight: 600 },   // Approach
  { altitudeThreshold: 100, scale: 3, viewHeight: 400 },   // Descent
  { altitudeThreshold: 0, scale: 4, viewHeight: 300 },     // Final
];

ABORT_ALTITUDE_THRESHOLD = 600;  // Can't abort below this
```

### Lander Dimensions

```
Leg span: 40px (-20 to +20 from center)
Body width: 30px (-15 to +15)
Height: ~37px (-22 top to +15 feet)
Collision offset: 15px from center to bottom
```

### Landing Pad Widths by Difficulty

| Multiplier | Width | Margin over leg span |
|------------|-------|---------------------|
| 1x (Easy)  | 100px | 60px                |
| 2x         | 80px  | 40px                |
| 3x         | 65px  | 25px                |
| 4x         | 55px  | 15px                |
| 5x (Hard)  | 50px  | 10px                |

### Game Phase State Machine

```
ORBIT → (first thrust) → DESCENT
DESCENT → (abort) → ABORT → (altitude restored) → ORBIT
DESCENT → (collision) → LANDED (success/damaged) | CRASHED
```

---

## Known Issues & Limitations

1. **No save state** - Refreshing loses progress
2. **Keyboard only** - No gamepad or touch support
3. **Fixed terrain seed** - Same terrain per session
4. **Autopilot can fail** - Extreme conditions may exceed controller capability
5. **No atmospheric drag** - Mars treated as vacuum (for now)

---

## Backend Integration

### API Endpoint

The backend API is deployed at `https://dropship.configtree.com`.

### Environment Variables

Create a `.env` file (or configure in your deployment):

```bash
# API Configuration
VITE_API_URL=https://dropship.configtree.com

# Cognito Authentication (public values - not secrets)
VITE_COGNITO_USER_POOL_ID=us-east-2_XBnvpusfc
VITE_COGNITO_CLIENT_ID=1k0ba7j0iuh97lmkpefumddibn
VITE_COGNITO_DOMAIN=https://dropship-auth.auth.us-east-2.amazoncognito.com
VITE_COGNITO_REGION=us-east-2
```

**Note:** These Cognito values are intentionally public. User Pool ID and Client ID are designed to be in client code. Security is enforced via JWT validation on the backend and PKCE auth flow.

### API Endpoints

| Endpoint | Method | Description |
|----------|--------|-------------|
| `/health` | GET | Health check |
| `/flights` | POST | Submit completed flight |
| `/flights` | GET | List user's flights |
| `/flights/{id}` | GET | Get flight for replay |
| `/leaderboard` | GET | Get leaderboard (`?world=moon&period=all`) |
| `/worlds` | GET | List all worlds with configs |
| `/worlds/{id}` | GET | Get world configuration |
| `/spacecraft` | GET | List all spacecraft |
| `/spacecraft/{id}` | GET | Get spacecraft configuration |
| `/users/{id}/progression` | GET | Get user progression |
| `/users/{id}/points` | GET | Get user points balance |
| `/users/{id}/unlocks/worlds` | POST | Unlock a world |
| `/users/{id}/unlocks/spacecraft` | POST | Unlock spacecraft |

### Integration Tasks

See GitHub Issue #1 for detailed integration checklist:
- [ ] Create API client (`src/lib/api.ts`)
- [ ] Submit flights to backend on completion
- [ ] Fetch leaderboards from API
- [ ] Load world/spacecraft configs from API
- [ ] Add authentication flows
- [ ] Implement offline fallback with localStorage

### Backend Repository

The backend source is at `github.com/wjklos/dropship-backend`.

---

## Testing Checklist

### Core Gameplay
- [ ] Lander starts in horizontal orbit
- [ ] No gravity until first thrust
- [ ] World selection works before first burn
- [ ] World locked after first burn
- [ ] Zoom transitions at altitude thresholds
- [ ] ViewBox follows lander correctly

### Collision & Outcomes
- [ ] Both legs checked for collision
- [ ] SUCCESS: both legs on same pad, good speed/angle
- [ ] DAMAGED: soft landing off pad
- [ ] CRASHED: displays specific failure reason

### Abort System
- [ ] [A] initiates abort during descent
- [ ] Abort disabled below 600px
- [ ] Autopilot returns to orbit
- [ ] Can reattempt after abort

### Autopilot
- [ ] Waits for optimal descent window in orbit
- [ ] Targets nearest viable pad
- [ ] Handles Mars higher gravity

### Demo Mode
- [ ] Auto-restart after landing/crash
- [ ] Stats track attempts and failure reasons
- [ ] Mode switch preserves position/velocity

---

## References

- [1979 Atari Lunar Lander](https://en.wikipedia.org/wiki/Lunar_Lander_(1979_video_game))
- [Solid.js Documentation](https://www.solidjs.com/docs/latest)
- [PID Controller Theory](https://en.wikipedia.org/wiki/PID_controller)
- [Fix Your Timestep](https://gafferongames.com/post/fix_your_timestep/)

---

*Last updated: January 2025*
*Author: Claude (Anthropic)*
*Version 3.0: GNC autopilot, approach modes, trajectory prediction, crash animations*
