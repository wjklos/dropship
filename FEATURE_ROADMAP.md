# Lunar Lander Feature Roadmap

## Overview

This document outlines planned features for the Lunar Lander game, organized into phases based on complexity and dependencies. Each feature includes technical considerations, implementation approach, and estimated scope.

---

## Feature Summary

| # | Feature | Phase | Complexity | Dependencies |
|---|---------|-------|------------|--------------|
| 1 | Rocket Launches & Countdowns | 1 | Medium | None |
| 2 | Scrolling Terrain & Large World | 2 | High | None |
| 3 | Mars Atmosphere (drag, wind) | 1 | Medium | None |
| 4 | Asteroid Field Landing | 3 | High | Scrolling terrain |
| 5 | Rough Terrain & Canyons | 2 | Medium | Scrolling terrain |
| 6 | Damage & Communication Animations | 1 | Low | None |
| 7 | Return to Orbit (RTO) | 1 | Medium | None |
| 8 | Orbital Docking | 3 | Very High | RTO, rocket launches |
| 9 | Orbital & Ground Weapons | 4 | Very High | Multiplayer foundation |
| 10 | Abort to Secondary Site | 1 | Low | Landing cone system |
| 11 | Lander Upgrades | 2 | High | Persistence system |

---

## Phase 1: Core Gameplay Enhancements

*Focus: Single-player depth without major architecture changes*

### 1.1 Rocket Launches & Countdowns

**Description**: Rockets on occupied pads have visible countdown timers (:20, :10) and launch on trajectories that may intersect with the player. After launch, the pad becomes a valid landing spot.

**Technical Approach**:

```typescript
// New types
interface ParkedRocket {
  padIndex: number;
  countdownSeconds: number;  // 20, 10, or null (no countdown)
  launchTime: number;        // Game time when launch occurs
  state: 'countdown' | 'launching' | 'launched' | 'gone';
}

interface LaunchedRocket {
  id: number;
  position: Vec2;
  velocity: Vec2;
  rotation: number;
  trajectory: 'orbit' | 'escape' | 'suborbital';
}
```

**Implementation Steps**:
1. Add `ParkedRocket[]` to game state, initialized from occupied pads
2. Randomly assign countdown timers (some pads may not launch)
3. Display countdown overlay on pad (vector-style LED digits)
4. On launch: animate liftoff, transfer to `LaunchedRocket[]`
5. Simulate rocket trajectory (simple ballistic or orbital insertion)
6. Check collision between lander and launched rockets
7. Mark pad as unoccupied after successful launch
8. Rockets exit world bounds or reach stable orbit (disappear)

**Visual Design**:
- Countdown: Flashing digits above pad, color shifts red in final 5 seconds
- Launch: Thrust flame grows, rocket accelerates upward
- Trajectory: Faint dotted line showing predicted path (like player trajectory)

**Collision Considerations**:
- Rockets have hitbox ~20px radius
- Collision = instant crash for lander
- Autopilot should detect incoming rockets and adjust timing

**Estimated Scope**: 
- New file: `src/lib/rockets.ts` (~200 lines)
- Modify: `Terrain.tsx`, `Game.tsx`, `game.ts`
- New component: `LaunchedRocket.tsx`
- Total: ~400-500 lines new code

---

### 1.3 Mars Atmosphere (Drag, Wind, Density)

**Description**: Mars has a thin atmosphere that creates aerodynamic drag and wind effects. Affects descent rate, fuel efficiency, and landing precision.

**Technical Approach**:

```typescript
// In worlds.ts
interface AtmosphereConfig {
  enabled: boolean;
  densityAtSurface: number;    // kg/m³ (Mars ~0.02, Earth ~1.2)
  scaleHeight: number;         // Altitude for density to drop by 1/e
  windSpeed: { min: number; max: number };  // px/s
  windVariability: number;     // How often wind changes
  dragCoefficient: number;     // Lander's Cd
}

// Physics changes
function calculateDrag(velocity: Vec2, altitude: number, atmosphere: AtmosphereConfig): Vec2 {
  const density = atmosphere.densityAtSurface * Math.exp(-altitude / atmosphere.scaleHeight);
  const speed = Math.sqrt(velocity.x ** 2 + velocity.y ** 2);
  const dragMagnitude = 0.5 * density * speed * speed * atmosphere.dragCoefficient;
  // Apply opposite to velocity direction
  return {
    x: -velocity.x / speed * dragMagnitude,
    y: -velocity.y / speed * dragMagnitude
  };
}
```

**Implementation Steps**:
1. Add `AtmosphereConfig` to world definitions (Moon: disabled, Mars: enabled)
2. Modify `updatePhysics` to apply drag force after thrust
3. Implement wind as slow-changing horizontal force
4. Add wind indicator to HUD (arrow showing direction/strength)
5. Visual: Add subtle particle effects for dust/atmosphere at low altitude
6. Autopilot: Account for drag in trajectory predictions

**Gameplay Impact**:
- Descent is slower (less fuel needed for braking)
- Horizontal drift from wind requires correction
- High-speed entry causes more drag (aerobraking possible)
- Landing angle affected by crosswinds

**Visual Indicators**:
- Wind sock or arrow in HUD corner
- Dust particles at low altitude
- Heat shimmer effect during high-speed descent (optional)

**Estimated Scope**:
- Modify: `physics.ts`, `worlds.ts`, `autopilot.ts`, `HUD.tsx`
- New: Wind particle effect component (~100 lines)
- Total: ~300 lines new/modified code

---

### 1.6 Damage & Communication Animations

**Description**: Visual feedback for damage states, communication transmissions, and rescue beacon responses.

**Technical Approach**:

```typescript
// Damage states
type DamageLevel = 'nominal' | 'minor' | 'moderate' | 'severe' | 'critical';

interface LanderDamage {
  hull: DamageLevel;
  leftLeg: DamageLevel;
  rightLeg: DamageLevel;
  engine: DamageLevel;
  comms: DamageLevel;
}

// Communication events
interface CommEvent {
  type: 'beacon_detected' | 'beacon_response' | 'mission_update' | 'warning';
  message: string;
  timestamp: number;
  duration: number;
}
```

**Implementation Steps**:

1. **Damage Visualization**:
   - Parts flicker or show static when damaged
   - Broken leg renders at wrong angle
   - Engine sputters (intermittent thrust flame)
   - Cracked hull shows fracture lines

2. **Communication Effects**:
   - Beacon pulse: Expanding rings from surface location
   - Transmission: Animated waveform in HUD
   - Message display: Typewriter-style text with static
   - Audio cue: Morse code or synth beeps (optional)

3. **Rescue Beacon Mechanic**:
   - Random beacon appears on terrain
   - Player must land within range
   - Timer counts down while in range
   - Success: Rescue animation, bonus points

**Visual Style**:
- Keep vector aesthetic (no filled shapes)
- Use stroke-dasharray animation for transmission waves
- Flicker effects via opacity animation
- Green phosphor color for comm text

**Estimated Scope**:
- New: `src/components/CommOverlay.tsx` (~150 lines)
- New: `src/lib/damage.ts` (~100 lines)
- Modify: `Lander.tsx` for damage rendering
- Total: ~350 lines

---

### 1.7 Return to Orbit (RTO)

**Description**: Successfully land, then launch back to orbit. Requires fuel management - must reserve enough propellant for ascent.

**Technical Approach**:

```typescript
// New game phases
type GamePhase = 
  | 'orbit' 
  | 'descent' 
  | 'landed' 
  | 'ascent'      // NEW: Launching from surface
  | 'orbit_return' // NEW: Back in orbit after RTO
  | 'crashed';

// Fuel calculations
interface RTORequirements {
  minFuelForOrbit: number;      // Minimum fuel to reach orbital velocity
  fuelWarningThreshold: number; // Warn player when RTO becomes impossible
  ascentBurnTime: number;       // Seconds of full thrust needed
}

function calculateRTOFuel(altitude: number, config: GameConfig): number {
  // Simplified: fuel = mass * delta-v / specific_impulse
  const orbitalVelocity = config.orbitalVelocity;
  const gravityLoss = config.gravity * 10; // Approximate gravity drag
  const deltaV = orbitalVelocity + gravityLoss;
  return deltaV * config.fuelConsumption / config.maxThrust;
}
```

**Implementation Steps**:
1. Calculate minimum RTO fuel based on world gravity
2. Add fuel reservation indicator to HUD (shows RTO feasibility)
3. After landing, allow player to initiate launch (hold thrust)
4. New `ascent` phase with different autopilot behavior
5. Pitch program: Vertical initially, then gravity turn
6. Orbit insertion: Circularize at target altitude
7. Success state: Back in orbit, can attempt another landing

**Autopilot Ascent Mode**:
```typescript
function computeAscentAutopilot(lander: LanderState, config: GameConfig): AutopilotOutput {
  const altitude = getAltitude(lander);
  
  if (altitude < 100) {
    // Vertical ascent
    return { targetAngle: 0, thrust: 1.0 };
  } else if (altitude < config.orbitalAltitude * 0.5) {
    // Gravity turn - gradually pitch toward horizontal
    const pitchAngle = (altitude / config.orbitalAltitude) * (Math.PI / 2);
    return { targetAngle: pitchAngle, thrust: 1.0 };
  } else {
    // Coast to apoapsis, then circularize
    // ... orbital mechanics
  }
}
```

**HUD Additions**:
- RTO fuel indicator (green/yellow/red bar)
- "RTO POSSIBLE" / "RTO MARGINAL" / "COMMITTED" status
- Ascent guidance cues (pitch angle, time to orbit)

**Estimated Scope**:
- Modify: `physics.ts`, `autopilot.ts`, `game.ts`, `HUD.tsx`
- New: Ascent trajectory prediction
- Total: ~400 lines

---

### 1.10 Abort to Secondary Site

**Description**: During descent, if primary landing site becomes unviable, automatically or manually retarget to backup site.

**Technical Approach**:

```typescript
// Extend landing cone system
interface TargetingState {
  primaryPad: number;
  secondaryPad: number | null;
  tertiaryPad: number | null;
  abortTrigger: 'manual' | 'auto_obstacle' | 'auto_fuel' | null;
}

function selectSecondaryTarget(
  currentTarget: number,
  viabilities: PadViability[],
  landerState: LanderState
): number | null {
  // Find next best pad excluding current
  const alternatives = viabilities
    .filter(v => v.padIndex !== currentTarget && v.viable)
    .sort((a, b) => a.fuelCost - b.fuelCost);
  return alternatives[0]?.padIndex ?? null;
}
```

**Implementation Steps**:
1. Always calculate secondary/tertiary targets during descent
2. Show backup targets in HUD (dimmed)
3. Keyboard shortcut to cycle targets (e.g., Tab)
4. Auto-abort triggers:
   - Obstacle detected (future: terrain, other craft)
   - Fuel insufficient for primary
   - Primary pad becomes occupied (rocket launch)
5. Smooth transition: Autopilot redirects to new target
6. Update trajectory overlay to show new path

**Visual Feedback**:
- Primary target: Blue crosshairs
- Secondary target: Dim cyan crosshairs
- On abort: Flash transition, audio cue

**Estimated Scope**:
- Modify: `autopilot.ts`, `game.ts`, `HUD.tsx`, `Terrain.tsx`
- Total: ~200 lines

---

## Phase 2: World Expansion

*Focus: Larger play area, more complex terrain, persistence*

### 2.2 Scrolling Terrain & Large World

**Description**: Expand world beyond single screen. Terrain scrolls as lander moves. Foundation for multiplayer and more complex scenarios.

**Technical Approach**:

```typescript
// World configuration
interface LargeWorldConfig {
  totalWidth: number;       // e.g., 24000px (10x current)
  totalHeight: number;      // e.g., 3600px
  chunkWidth: number;       // 2400px per chunk
  visibleChunks: number;    // How many chunks to render
  wrapAround: boolean;      // World wraps horizontally
}

// Chunk-based terrain
interface TerrainChunk {
  id: number;
  startX: number;
  endX: number;
  points: TerrainPoint[];
  pads: LandingPad[];
  generated: boolean;
}

// Dynamic loading
function getVisibleChunks(cameraX: number, config: LargeWorldConfig): number[] {
  const centerChunk = Math.floor(cameraX / config.chunkWidth);
  const range = Math.ceil(config.visibleChunks / 2);
  return Array.from({ length: config.visibleChunks }, (_, i) => 
    (centerChunk - range + i + config.totalChunks) % config.totalChunks
  );
}
```

**Implementation Steps**:

1. **Chunk System**:
   - Divide terrain into chunks (2400px each)
   - Generate chunks procedurally with seed
   - Load/unload chunks based on camera position
   - Ensure seamless terrain at chunk boundaries

2. **Camera System**:
   - Camera follows lander with lookahead
   - Smooth scrolling (lerp to target position)
   - Zoom still works within larger world
   - Minimap shows overall position

3. **Terrain Generation**:
   - Consistent seed-based generation
   - Chunk boundaries use shared edge points
   - Pad distribution across chunks
   - Biome variation (flat plains, mountains, canyons)

4. **Performance**:
   - Only render visible chunks (+ 1 buffer on each side)
   - Pool and reuse SVG elements
   - Throttle physics updates for distant objects

**Minimap Design**:
```
┌─────────────────────────────┐
│  ▲                          │  <- Player position
│     ═══  ═══  ═══  ═══     │  <- Landing pads
│  ▼  ▼                       │  <- Other players/rockets
└─────────────────────────────┘
```

**Estimated Scope**:
- New: `src/lib/chunks.ts` (~300 lines)
- New: `src/components/Minimap.tsx` (~150 lines)
- Major refactor: `Terrain.tsx`, `Game.tsx`, `game.ts`
- Total: ~800-1000 lines

---

### 2.5 Rough Terrain & Canyons

**Description**: More challenging terrain with ridges, valleys, and deep canyons. Requires careful navigation and vertical velocity control.

**Technical Approach**:

```typescript
// Terrain biome types
type TerrainBiome = 'plains' | 'hills' | 'mountains' | 'canyon' | 'crater';

interface BiomeConfig {
  roughness: number;         // 0-1, affects midpoint displacement
  minHeight: number;         // Relative to baseline
  maxHeight: number;
  padFrequency: number;      // Pads per 1000px
  hazardDensity: number;     // Rocks, slopes too steep to land
}

// Canyon generation
function generateCanyon(
  startX: number, 
  width: number, 
  depth: number,
  baselineY: number
): TerrainPoint[] {
  // Steep walls down, flat bottom, steep walls up
  // Bottom may have landing pads
}

// Hazard zones
interface TerrainHazard {
  type: 'steep_slope' | 'boulder' | 'crater_rim';
  x1: number;
  x2: number;
  deadly: boolean;  // Instant crash vs damage
}
```

**Implementation Steps**:

1. **Biome System**:
   - Assign biomes to terrain chunks
   - Smooth transitions between biomes
   - Biome affects terrain generation parameters

2. **Canyon Generation**:
   - Special terrain feature spanning multiple chunks
   - Steep entry/exit walls
   - Narrow bottom with high-value pads
   - Requires vertical approach (no horizontal velocity)

3. **Hazard Detection**:
   - Mark steep slopes as hazardous
   - Boulders as point obstacles
   - Visual indicators (red tint, warning symbols)

4. **Navigation Aids**:
   - Terrain elevation profile in HUD
   - Warning when approaching ridge
   - Autopilot avoids hazards

**Canyon Landing Challenge**:
- Must descend vertically into canyon
- Horizontal velocity = wall collision
- Limited abort options (walls block escape)
- High score multiplier for canyon landings

**Estimated Scope**:
- Modify: `terrain.ts` (major), `physics.ts`, `autopilot.ts`
- New: Hazard overlay component
- Total: ~500 lines

---

### 2.11 Lander Upgrades

**Description**: Persistent upgrades that carry between sessions. Improve fuel capacity, thrust, defense, and special capabilities.

**Technical Approach**:

```typescript
// Upgrade definitions
interface LanderUpgrade {
  id: string;
  name: string;
  description: string;
  tier: 1 | 2 | 3;
  cost: number;              // Points or currency
  effect: UpgradeEffect;
  prerequisites: string[];   // Upgrade IDs required first
}

type UpgradeEffect = 
  | { type: 'fuel_capacity'; multiplier: number }
  | { type: 'thrust_power'; multiplier: number }
  | { type: 'fuel_efficiency'; multiplier: number }
  | { type: 'armor'; damageReduction: number }
  | { type: 'shields'; capacity: number; rechargeRate: number }
  | { type: 'rcs_power'; multiplier: number }
  | { type: 'reusable'; refuelRate: number };

// Upgrade tree
const UPGRADE_TREE: LanderUpgrade[] = [
  // Tier 1 - Basic
  { id: 'fuel_1', name: 'Extended Tanks', tier: 1, cost: 100,
    effect: { type: 'fuel_capacity', multiplier: 1.25 }, prerequisites: [] },
  { id: 'thrust_1', name: 'Engine Upgrade', tier: 1, cost: 100,
    effect: { type: 'thrust_power', multiplier: 1.15 }, prerequisites: [] },
  
  // Tier 2 - Advanced
  { id: 'fuel_2', name: 'Fuel Optimization', tier: 2, cost: 250,
    effect: { type: 'fuel_efficiency', multiplier: 1.2 }, prerequisites: ['fuel_1'] },
  { id: 'armor_1', name: 'Hull Plating', tier: 2, cost: 300,
    effect: { type: 'armor', damageReduction: 0.3 }, prerequisites: [] },
  
  // Tier 3 - Elite
  { id: 'reusable', name: 'Reusable Systems', tier: 3, cost: 1000,
    effect: { type: 'reusable', refuelRate: 10 }, prerequisites: ['fuel_2', 'thrust_1'] },
  { id: 'shields', name: 'Energy Shields', tier: 3, cost: 1500,
    effect: { type: 'shields', capacity: 100, rechargeRate: 5 }, prerequisites: ['armor_1'] },
];

// Player profile
interface PlayerProfile {
  id: string;
  name: string;
  unlockedUpgrades: string[];
  equippedUpgrades: string[];  // Limit to N slots
  currency: number;
  stats: PlayerStats;
}
```

**Implementation Steps**:

1. **Persistence Layer**:
   - Store player profile in localStorage (initially)
   - Later: Backend API for cross-device sync
   - Profile includes unlocks, currency, stats

2. **Upgrade UI**:
   - Tech tree visualization
   - Purchase confirmation
   - Equip/unequip management
   - Preview effect on lander stats

3. **Apply Upgrades**:
   - Modify `GameConfig` based on equipped upgrades
   - Visual changes to lander (larger tanks, shield glow)
   - HUD shows active upgrade effects

4. **Earning Currency**:
   - Successful landings award points
   - Bonus for difficulty (pad multiplier, fuel remaining)
   - Streak bonuses
   - Achievement unlocks

**Upgrade Categories**:

| Category | Upgrades | Effect |
|----------|----------|--------|
| Propulsion | Engine Mk2, Mk3 | +15%, +30% thrust |
| Fuel | Extended Tanks, Efficiency | +25% capacity, -20% consumption |
| Durability | Hull Plating, Shields | Damage reduction, energy shield |
| RCS | Improved Thrusters | Faster rotation |
| Special | Reusable, VTOL Assist | Land & relaunch, assisted landing |

**Estimated Scope**:
- New: `src/lib/upgrades.ts` (~200 lines)
- New: `src/lib/persistence.ts` (~150 lines)
- New: `src/components/UpgradeTree.tsx` (~300 lines)
- Modify: `game.ts`, `physics.ts`, `Lander.tsx`
- Total: ~800 lines

---

## Phase 3: Advanced Mechanics

*Focus: Complex scenarios, AI opponents, orbital mechanics*

### 3.4 Asteroid Field Landing

**Description**: Navigate through a field of moving asteroids to land on a target asteroid. Objects must be avoided or deflected.

**Technical Approach**:

```typescript
// Asteroid types
interface Asteroid {
  id: number;
  position: Vec2;
  velocity: Vec2;
  rotation: number;
  angularVelocity: number;
  radius: number;
  shape: AsteroidShape;      // Procedural polygon
  hasLandingZone: boolean;   // Target asteroid
  landingPad?: LandingPad;
}

type AsteroidShape = Vec2[];  // Polygon vertices

// Field configuration
interface AsteroidFieldConfig {
  count: number;
  minRadius: number;
  maxRadius: number;
  velocityRange: { min: number; max: number };
  targetAsteroidIndex: number;
  fieldBounds: { width: number; height: number };
}

// Collision detection
function checkAsteroidCollision(
  lander: LanderState, 
  asteroid: Asteroid
): boolean {
  // Point-in-polygon for asteroid shape
  // Or simplified circle collision
}
```

**Implementation Steps**:

1. **Asteroid Generation**:
   - Procedural irregular polygon shapes
   - Random sizes within range
   - One designated landing target
   - Others are obstacles

2. **Asteroid Physics**:
   - Each asteroid moves independently
   - Optional: Asteroids bounce off each other
   - Gravity from large asteroids (optional)
   - Rotation for visual effect

3. **Navigation**:
   - Radar/proximity display
   - Collision prediction
   - Safe path highlighting
   - Autopilot obstacle avoidance

4. **Landing on Moving Target**:
   - Match asteroid velocity before touchdown
   - Relative velocity displayed
   - Asteroid rotates - timing matters

**Visual Style**:
- Wireframe asteroids (irregular polygons)
- Glow effect on target asteroid
- Warning indicators for close asteroids
- Radar sweep effect

**Estimated Scope**:
- New: `src/lib/asteroids.ts` (~300 lines)
- New: `src/components/AsteroidField.tsx` (~200 lines)
- New: `src/components/Radar.tsx` (~150 lines)
- Total: ~700 lines

---

### 3.8 Orbital Docking

**Description**: Rendezvous and dock with a rocket launching from the surface or an orbiting station.

**Technical Approach**:

```typescript
// Docking states
type DockingPhase = 
  | 'separation'      // Far from target
  | 'approach'        // Closing distance
  | 'final'           // Within 100m
  | 'contact'         // Physical connection
  | 'docked';

interface DockingState {
  phase: DockingPhase;
  targetId: number;           // Rocket or station ID
  relativePosition: Vec2;     // Position relative to target
  relativeVelocity: Vec2;
  closingRate: number;        // m/s toward target
  alignment: number;          // Angle difference (radians)
}

interface DockingPort {
  position: Vec2;             // Relative to craft center
  orientation: number;        // Angle of port
  compatible: string[];       // Compatible port types
}

// Docking requirements
const DOCKING_TOLERANCES = {
  maxClosingRate: 0.5,        // m/s
  maxLateralRate: 0.2,        // m/s
  maxAngleDiff: 0.05,         // radians (~3 degrees)
  captureDistance: 2,         // meters
};
```

**Implementation Steps**:

1. **Target Tracking**:
   - Launched rockets become docking targets
   - Orbital stations (future) as targets
   - Relative navigation (target-centered view)

2. **Approach Guidance**:
   - R-bar / V-bar approach paths
   - Closing rate indicators
   - Alignment cues

3. **Final Approach**:
   - Precision RCS control
   - Docking camera view (close-up)
   - Contact detection

4. **Docked State**:
   - Combined vehicle physics
   - Fuel transfer
   - Mission completion

**HUD for Docking**:
```
┌─────────────────────────────┐
│  RANGE: 125m  RATE: -0.3m/s │
│  ┌───────────────────┐      │
│  │         +         │ ← Alignment indicator
│  │       ──┼──       │
│  │         │         │
│  └───────────────────┘      │
│  ALIGN: 0.02° LATERAL: 0.1m/s│
└─────────────────────────────┘
```

**Estimated Scope**:
- New: `src/lib/docking.ts` (~400 lines)
- New: `src/components/DockingHUD.tsx` (~250 lines)
- Modify: `physics.ts`, `Game.tsx`
- Total: ~800 lines

---

## Phase 4: Combat & Competition

*Focus: Multiplayer, adversarial gameplay*

### 4.9 Orbital & Ground Weapons

**Description**: Defensive and offensive capabilities. Orbital bombardment of ground targets, ground-based missiles, point defense.

**Technical Approach**:

```typescript
// Weapon types
type WeaponType = 
  | 'orbital_kinetic'     // Kinetic impactor from orbit
  | 'orbital_laser'       // Directed energy
  | 'ground_missile'      // SAM-style
  | 'point_defense'       // Anti-missile
  | 'emp';                // Disable electronics

interface Weapon {
  type: WeaponType;
  damage: number;
  range: number;
  cooldown: number;
  ammo: number | 'unlimited';
  guidance: 'none' | 'heat' | 'radar' | 'laser';
}

interface Projectile {
  id: number;
  type: WeaponType;
  position: Vec2;
  velocity: Vec2;
  target: Vec2 | EntityId;
  damage: number;
  timeToLive: number;
}

// Combat state
interface CombatState {
  activeProjectiles: Projectile[];
  threats: ThreatAssessment[];
  pointDefenseActive: boolean;
  shieldStatus: number;
}
```

**Implementation Steps**:

1. **Weapon Systems**:
   - Orbital bombardment (target ground positions)
   - Ground-to-orbit missiles
   - Point defense (auto-targets incoming)
   - Shield system (absorbs hits)

2. **Projectile Physics**:
   - Ballistic for kinetic weapons
   - Homing for guided missiles
   - Instant for lasers (hitscan)

3. **Threat Detection**:
   - Warning when targeted
   - Incoming projectile indicators
   - Time-to-impact countdown

4. **Countermeasures**:
   - Evasive maneuvers
   - Point defense activation
   - Chaff/flares (decoys)

**Combat HUD Additions**:
- Threat warning indicator
- Weapon status/ammo
- Target lock indicator
- Shield/armor status

**Multiplayer Considerations**:
- Weapon balance for fair PvP
- Safe zones (no weapons near pads)
- Ceasefire mechanics

**Estimated Scope**:
- New: `src/lib/weapons.ts` (~400 lines)
- New: `src/lib/combat.ts` (~300 lines)
- New: `src/components/CombatHUD.tsx` (~200 lines)
- New: `src/components/Projectile.tsx` (~100 lines)
- Total: ~1000+ lines

---

## Phase 5: Multiplayer Foundation

*Required for full multiplayer but applicable to AI opponents first*

### 5.1 Multiplayer Architecture

**Description**: Foundation for multiple simultaneous players in shared world.

**Technical Approach**:

```typescript
// Network state
interface MultiplayerState {
  sessionId: string;
  playerId: string;
  players: Map<string, RemotePlayer>;
  syncTick: number;
  latency: number;
}

interface RemotePlayer {
  id: string;
  name: string;
  lander: LanderState;
  lastUpdate: number;
  interpolatedPosition: Vec2;
}

// State synchronization
interface StateUpdate {
  tick: number;
  playerId: string;
  position: Vec2;
  velocity: Vec2;
  rotation: number;
  thrust: number;
  inputs: InputState;
}

// Orbital slots
interface OrbitalSlot {
  altitude: number;
  occupied: boolean;
  playerId: string | null;
}
```

**Implementation Phases**:

1. **Phase 5.1a: AI Opponents**
   - Computer-controlled landers
   - Use existing autopilot
   - Compete for landing pads
   - Foundation for full multiplayer

2. **Phase 5.1b: Local Multiplayer**
   - Split screen or shared view
   - Turn-based or simultaneous
   - Shared keyboard or gamepad

3. **Phase 5.1c: Network Multiplayer**
   - WebSocket or WebRTC
   - Client-server or P2P
   - State interpolation
   - Lag compensation

**Orbital Mechanics for Multiple Craft**:
- Multiple orbital altitudes
- Orbital slots to prevent collision
- Descent windows based on position
- "Traffic control" for landing order

**Scoring System**:
```typescript
interface Score {
  landings: number;
  perfectLandings: number;
  fuelEfficiency: number;
  speedBonus: number;
  difficultyMultiplier: number;
  total: number;
}

interface Leaderboard {
  daily: PlayerScore[];
  weekly: PlayerScore[];
  allTime: PlayerScore[];
}
```

**Estimated Scope**:
- AI Opponents: ~500 lines
- Local Multiplayer: ~400 lines
- Network Multiplayer: ~1500+ lines (major undertaking)

---

## Implementation Priority

### Recommended Order

```
Phase 1 (Core Enhancements):
  1.10 Abort to Secondary ─────────┐
  1.6  Damage/Comm Animations ─────┤
  1.7  Return to Orbit ────────────┼── Can be done in parallel
  1.3  Mars Atmosphere ────────────┤
  1.1  Rocket Launches ────────────┘

Phase 2 (World Expansion):
  2.2  Scrolling Terrain ──────────┐
  2.5  Rough Terrain/Canyons ──────┼── Sequential (terrain first)
  2.11 Lander Upgrades ────────────┘   (upgrades can parallel)

Phase 3 (Advanced):
  3.4  Asteroid Field ─────────────┐
  3.8  Orbital Docking ────────────┘── After RTO complete

Phase 4 (Combat):
  4.9  Weapons ────────────────────── After multiplayer foundation

Phase 5 (Multiplayer):
  5.1a AI Opponents ───────────────┐
  5.1b Local Multiplayer ──────────┼── Progressive complexity
  5.1c Network Multiplayer ────────┘
```

### Quick Wins (< 1 day each)
1. Abort to Secondary Site
2. Damage Animations
3. Mars Atmosphere (basic drag)

### Medium Effort (1-3 days each)
4. Return to Orbit
5. Rocket Launches
6. Communication Effects
7. Lander Upgrades (basic)

### Major Effort (1+ weeks each)
8. Scrolling Terrain
9. Asteroid Field
10. Orbital Docking
11. Weapons System
12. Network Multiplayer

---

## Technical Debt to Address First

Before implementing new features, consider addressing:

1. **Split large files** (autopilot.ts, trajectory.ts)
2. **Fix TypeScript error** in autopilot.ts
3. **Add unit tests** for physics calculations
4. **Remove debug console.log statements**
5. **Extract common utilities** (horizontal wraparound, pad center)

---

## Open Questions

1. **Persistence**: LocalStorage sufficient, or need backend?
2. **Multiplayer Model**: Peer-to-peer or dedicated server?
3. **Mobile Support**: Touch controls priority?
4. **Audio**: Web Audio API sound effects?
5. **Monetization**: If any, what model? (cosmetics, no pay-to-win)

---

*Document created: January 2025*
*For: Lunar Lander v3.0+*
