# Lunar Lander

A vector-style orbital descent simulator inspired by the 1979 Atari arcade classic. Features multiple worlds, orbital mechanics, intelligent autopilot, and authentic CRT phosphor aesthetics.

## Quick Start

```bash
npm install
npm run dev
```

Open http://localhost:3000 in your browser.

---

## Controls

### Flight Controls

| Key | Action |
|-----|--------|
| `↑` / `W` / `Space` | Main engine thrust |
| `←` / `A` | Rotate counter-clockwise |
| `→` / `D` | Rotate clockwise |
| `A` | Abort (return to orbit) |
| `P` | Pause |
| `R` | Reset / New mission |

### Autopilot Modes

| Key | Mode | Description |
|-----|------|-------------|
| `1` | OFF | Full manual control |
| `2` | STABILIZE | Auto-levels attitude, manual thrust |
| `3` | LAND | Autonomous landing sequence |
| `0` | DEMO | Continuous autonomous landings |

### Approach Modes (when autopilot is LAND or DEMO)

| Key | Mode | Description |
|-----|------|-------------|
| `S` | Stop & Drop | Kill horizontal velocity, descend vertically |
| `B` | Boostback | SpaceX-style trajectory to target |

### Target Selection (manual mode)

| Key | Action |
|-----|--------|
| `Space` | Cycle through landing pads |
| `X` | Lock selected target |

### Other

| Key | Action |
|-----|--------|
| `C` | Toggle trajectory arc display |
| `L` | Log flight data to console |

---

## How to Play

### 1. Select Your World

At mission start, you're in orbit. Choose your destination:
- **LUNA** (Moon) - Lower gravity (1.62 m/s²), easier landings
- **MARS** - Higher gravity (3.71 m/s²), requires more skill

Once you fire your engines, the world selection locks.

### 2. Begin Descent

Tap thrust to break orbit. Gravity activates and descent begins.

### 3. Land on a Pad

Landing pads are marked with multipliers (1x-5x):
- **1x** - Wide pad, easy target
- **5x** - Narrow pad, high skill required

For a successful landing:
- Vertical speed: < 15 m/s
- Angle: < 10° from vertical
- Position: Both legs on the same pad

### 4. Scoring

- Successful landing: 100 points × pad multiplier × streak multiplier
- Consecutive landings build your streak (1x, 2x, 3x...)
- Crashes or damage reset the streak

---

## Flight Phases

| Phase | Description |
|-------|-------------|
| **ORBIT** | Coasting horizontally, no gravity until first thrust |
| **DESCENT** | Active flight, gravity enabled |
| **ABORT** | Returning to orbit (press A when above 500m) |
| **LANDED** | Successful touchdown |
| **CRASHED** | Mission failed |

---

## HUD Reference

### Top Bar
- **ALTITUDE** - Height above terrain (meters)
- **V/SPEED** - Vertical velocity (m/s, positive = descending)
- **H/SPEED** - Horizontal velocity (m/s)
- **ANGLE** - Rotation from vertical (degrees)
- **FUEL** - Remaining propellant (%)
- **WIND** - (Mars only) Current wind speed and direction

### Status Indicators
- **LANDING ZONE** - Lit when over a pad
- **VEL OK/HIGH** - Landing velocity status
- **ATT OK/CHECK** - Landing attitude status

### Stats Panel
Tracks attempts, successes, damaged landings, crashes, and success rate.

---

## Landing Outcomes

| Outcome | Condition |
|---------|-----------|
| **SUCCESS** | Both legs on pad, speed OK, angle OK |
| **DAMAGED** | Soft landing but missed the pad |
| **CRASHED - VELOCITY HIGH** | Impact speed exceeded limits |
| **CRASHED - ANGLE BAD** | Landed at too steep an angle |
| **CRASHED - OUT OF FUEL** | Ran out of propellant |

---

## Autopilot Tips

The autopilot uses a GNC (Guidance, Navigation, Control) system:

1. **In orbit**: Waits for optimal deorbit burn window
2. **Descent**: Follows computed trajectory to target pad
3. **Terminal**: Precision hover and vertical descent

The **Stop & Drop** approach is more fuel-efficient but slower.
The **Boostback** approach is faster but uses more fuel.

Watch the **RYG bar** (Red-Yellow-Green) on the terrain - it shows the optimal deorbit burn position relative to your target pad.

---

## World Differences

### Luna (Moon)
- Gravity: 1.62 m/s² (game: 20 px/s²)
- No atmosphere
- Green UI theme
- Regions: Tranquility Base, Ocean of Storms, Tycho, etc.

### Mars
- Gravity: 3.71 m/s² (game: 46 px/s²)
- Thin atmosphere with wind bands
- Orange UI theme (green dialogs)
- Regions: Jezero Crater, Olympus Mons, Valles Marineris, etc.

---

## Build Commands

```bash
npm install      # Install dependencies
npm run dev      # Development server (hot reload)
npm run build    # Production build
npm run preview  # Preview production build
```

---

## Tech Stack

- **Solid.js** - Reactive UI framework
- **TypeScript** - Type-safe game logic
- **Vite** - Fast bundler and dev server
- **SVG** - Vector graphics rendering
- **CSS** - CRT effects and theming


