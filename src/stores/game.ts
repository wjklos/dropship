import { createSignal, createMemo } from "solid-js";
import type {
  LanderState,
  GameConfig,
  TerrainPoint,
  LandingPad,
  InputState,
  AutopilotMode,
  PadViability,
  GamePhase,
  FailureReason,
  FailureStats,
} from "../lib/types";
import { generateTerrain, generateStars } from "../lib/terrain";
import { getAltitude, getSpeed } from "../lib/physics";
import { evaluateAllPads, selectTargetPad } from "../lib/autopilot";
import {
  WORLDS,
  getWorld,
  type WorldId,
  type WorldConfig,
} from "../lib/worlds";
import {
  getZoomLevel,
  calculateViewBox,
  canAbortAtAltitude,
} from "../lib/zoom";

// World dimensions - larger for orbital view
const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1200;

// Create game configuration from world
function createConfig(world: WorldConfig): GameConfig {
  return {
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    gravity: world.gravity,
    maxThrust: world.maxThrust,
    rotationSpeed: 4,
    fuelConsumption: 8,
    maxLandingVelocity: 15,
    maxLandingAngle: 0.3,
    worldId: world.id,
    legSpan: 20,
    orbitalAltitude: world.orbitalAltitude,
    orbitalVelocity: world.orbitalVelocity,
  };
}

// Initial lander state - starts in orbit
function createInitialLander(
  config: GameConfig,
  world: WorldConfig,
): LanderState {
  return {
    position: {
      x: config.width * 0.1, // Start on the left side
      y: config.height - world.orbitalAltitude, // High orbit (remember Y increases downward)
    },
    velocity: {
      x: world.orbitalVelocity, // Horizontal orbital velocity
      y: 0, // No vertical velocity in orbit
    },
    rotation: 0,
    angularVelocity: 0,
    fuel: 100,
    thrust: 0,
    alive: true,
    landed: false,
    hasBurned: false, // No thrust yet - in stable orbit
    outcome: null,
    failureReason: null,
  };
}

// Create game store
export function createGameStore() {
  // World selection - persists across resets
  const [worldId, setWorldId] = createSignal<WorldId>("moon");

  // Get current world config
  const world = createMemo(() => getWorld(worldId()));

  // Create config from world
  const config = createMemo(() => createConfig(world()));

  // Generate initial terrain
  const initialWorld = getWorld("moon");
  const initialConfig = createConfig(initialWorld);
  const initialTerrain = generateTerrain(
    initialConfig.width,
    initialConfig.height,
  );
  const initialStars = generateStars(
    initialConfig.width,
    initialConfig.height,
    200,
  );

  // Core state signals
  const [lander, setLander] = createSignal<LanderState>(
    createInitialLander(initialConfig, initialWorld),
  );
  const [terrain, setTerrain] = createSignal<TerrainPoint[]>(
    initialTerrain.terrain,
  );
  const [landingPads, setLandingPads] = createSignal<LandingPad[]>(
    initialTerrain.landingPads,
  );
  const [stars, setStars] = createSignal(initialStars);

  // Game phase tracking
  const [gamePhase, setGamePhase] = createSignal<GamePhase>("orbit");

  // Pad viability state
  const [padViabilities, setPadViabilities] = createSignal<PadViability[]>([]);
  const [selectedPadIndex, setSelectedPadIndex] = createSignal<number>(0);

  // Input state
  const [input, setInput] = createSignal<InputState>({
    thrust: false,
    rotateLeft: false,
    rotateRight: false,
  });

  // Autopilot state
  const [autopilotMode, setAutopilotMode] = createSignal<AutopilotMode>("off");

  // Game state
  const [gameTime, setGameTime] = createSignal(0);
  const [paused, setPaused] = createSignal(false);
  const [gameOver, setGameOver] = createSignal(false);

  // Demo mode stats
  const [demoAttempts, setDemoAttempts] = createSignal(0);
  const [demoSuccesses, setDemoSuccesses] = createSignal(0);
  const [demoDamaged, setDemoDamaged] = createSignal(0);
  const [failureStats, setFailureStats] = createSignal<FailureStats>({
    VELOCITY_HIGH: 0,
    ANGLE_BAD: 0,
    OFF_PAD: 0,
    OUT_OF_FUEL: 0,
    DAMAGED: 0,
  });

  // Last failure reason for display
  const [lastFailureReason, setLastFailureReason] =
    createSignal<FailureReason>(null);

  // Derived values (memos)
  const altitude = createMemo(() =>
    getAltitude(lander().position, terrain(), config().width),
  );

  const speed = createMemo(() => getSpeed(lander().velocity));

  const verticalSpeed = createMemo(() => lander().velocity.y);

  const horizontalSpeed = createMemo(() => lander().velocity.x);

  const isLandingZone = createMemo(() => {
    const l = lander();
    const pads = landingPads();
    return pads.some((pad) => l.position.x >= pad.x1 && l.position.x <= pad.x2);
  });

  const landingStatus = createMemo(() => {
    const l = lander();
    const cfg = config();
    const angleOk = Math.abs(l.rotation) < cfg.maxLandingAngle;
    const speedOk = speed() < cfg.maxLandingVelocity;

    return {
      angleOk,
      speedOk,
      canLand: angleOk && speedOk && isLandingZone(),
    };
  });

  // Check if world selection is locked (after first burn)
  const worldLocked = createMemo(() => lander().hasBurned);

  // Check if abort is available
  const canAbort = createMemo(() => {
    const phase = gamePhase();
    const alt = altitude();
    return phase === "descent" && canAbortAtAltitude(alt);
  });

  // Current zoom level
  const currentZoom = createMemo(() => getZoomLevel(altitude()));

  // Calculate viewBox for current state
  const viewBox = createMemo(() => {
    const l = lander();
    const cfg = config();
    const zoom = currentZoom();
    // Approximate aspect ratio (will be updated by Game component)
    const aspectRatio =
      typeof window !== "undefined"
        ? window.innerWidth / window.innerHeight
        : 16 / 9;

    return calculateViewBox(
      l.position.x,
      l.position.y,
      cfg.width,
      cfg.height,
      zoom,
      aspectRatio,
    );
  });

  // Update pad viabilities based on current lander state
  function updateViabilities() {
    const currentLander = lander();
    const currentTerrain = terrain();
    const pads = landingPads();
    const cfg = config();

    if (!currentLander.alive || currentLander.landed) {
      return; // Don't update if game is over
    }

    const viabilities = evaluateAllPads(
      currentLander,
      currentTerrain,
      pads,
      cfg,
    );
    setPadViabilities(viabilities);

    // Select best target pad
    const target = selectTargetPad(viabilities, pads);
    setSelectedPadIndex(target.index);
  }

  // Change world (only allowed before first burn)
  function selectWorld(newWorldId: WorldId) {
    if (worldLocked()) {
      return; // Can't change world after descent started
    }

    setWorldId(newWorldId);
    const newWorld = getWorld(newWorldId);
    const newConfig = createConfig(newWorld);

    // Regenerate terrain for new world size
    const newTerrain = generateTerrain(newConfig.width, newConfig.height);
    setTerrain(newTerrain.terrain);
    setLandingPads(newTerrain.landingPads);
    setStars(generateStars(newConfig.width, newConfig.height, 200));

    // Reset lander to orbit with new world parameters
    setLander(createInitialLander(newConfig, newWorld));
    setPadViabilities([]);
    setSelectedPadIndex(0);
    setGamePhase("orbit");
    setGameOver(false);
    setLastFailureReason(null);
  }

  // Reset game (preserveMode keeps autopilot mode for demo continuous play)
  function reset(preserveMode: boolean = false) {
    const currentMode = autopilotMode();
    const currentWorld = world();
    const cfg = config();

    const newTerrain = generateTerrain(cfg.width, cfg.height);
    setTerrain(newTerrain.terrain);
    setLandingPads(newTerrain.landingPads);
    setLander(createInitialLander(cfg, currentWorld));
    setPadViabilities([]);
    setSelectedPadIndex(0);
    setGameTime(0);
    setGameOver(false);
    setGamePhase("orbit");
    setPaused(false);
    setLastFailureReason(null);

    if (preserveMode) {
      setAutopilotMode(currentMode);
    } else {
      setAutopilotMode("off");
    }
  }

  // Initiate abort - return to orbit
  function initiateAbort() {
    if (!canAbort()) {
      return;
    }
    setGamePhase("abort");
  }

  // Complete abort - back in orbit
  function completeAbort() {
    const l = lander();
    const currentWorld = world();

    // Reset to orbital state
    setLander({
      ...l,
      hasBurned: false,
      velocity: {
        x: currentWorld.orbitalVelocity,
        y: 0,
      },
    });
    setGamePhase("orbit");
  }

  // Transition from orbit to descent (called when first thrust happens)
  function startDescent() {
    if (gamePhase() === "orbit") {
      setGamePhase("descent");
    }
  }

  // Record demo result
  function recordDemoResult(success: boolean, reason: FailureReason = null) {
    setDemoAttempts((a) => a + 1);
    setLastFailureReason(reason);

    if (success) {
      setDemoSuccesses((s) => s + 1);
    } else if (reason === "DAMAGED") {
      setDemoDamaged((d) => d + 1);
      setFailureStats((stats) => ({
        ...stats,
        DAMAGED: stats.DAMAGED + 1,
      }));
    } else if (reason) {
      setFailureStats((stats) => ({
        ...stats,
        [reason]: (stats[reason] || 0) + 1,
      }));
    }
  }

  // Reset demo stats
  function resetDemoStats() {
    setDemoAttempts(0);
    setDemoSuccesses(0);
    setDemoDamaged(0);
    setFailureStats({
      VELOCITY_HIGH: 0,
      ANGLE_BAD: 0,
      OFF_PAD: 0,
      OUT_OF_FUEL: 0,
      DAMAGED: 0,
    });
  }

  // Input handlers
  function handleKeyDown(key: string) {
    switch (key.toLowerCase()) {
      case " ":
      case "arrowup":
      case "w":
        setInput((i) => ({ ...i, thrust: true }));
        break;
      case "arrowleft":
        setInput((i) => ({ ...i, rotateLeft: true }));
        break;
      case "arrowright":
        setInput((i) => ({ ...i, rotateRight: true }));
        break;
      case "a":
        // A is abort when not holding for rotation
        if (!input().rotateLeft) {
          initiateAbort();
        }
        setInput((i) => ({ ...i, rotateLeft: true }));
        break;
      case "d":
        setInput((i) => ({ ...i, rotateRight: true }));
        break;
      case "p":
        setPaused((p) => !p);
        break;
      case "r":
        reset();
        break;
      case "1":
        setAutopilotMode("off");
        break;
      case "2":
        setAutopilotMode("stabilize");
        break;
      case "3":
        setAutopilotMode("land");
        break;
      case "0":
        setAutopilotMode("demo");
        break;
      case "m":
        // Select Moon
        selectWorld("moon");
        break;
      case "escape":
        // Abort on Escape key
        initiateAbort();
        break;
    }
  }

  function handleKeyUp(key: string) {
    switch (key.toLowerCase()) {
      case " ":
      case "arrowup":
      case "w":
        setInput((i) => ({ ...i, thrust: false }));
        break;
      case "arrowleft":
      case "a":
        setInput((i) => ({ ...i, rotateLeft: false }));
        break;
      case "arrowright":
      case "d":
        setInput((i) => ({ ...i, rotateRight: false }));
        break;
    }
  }

  return {
    // World
    worldId,
    world,
    selectWorld,
    worldLocked,

    // State
    lander,
    setLander,
    terrain,
    landingPads,
    padViabilities,
    selectedPadIndex,
    stars,
    input,
    autopilotMode,
    setAutopilotMode,
    gameTime,
    setGameTime,
    paused,
    setPaused,
    gameOver,
    setGameOver,
    config,

    // Game phase
    gamePhase,
    setGamePhase,
    startDescent,
    canAbort,
    initiateAbort,
    completeAbort,

    // Zoom
    currentZoom,
    viewBox,

    // Demo stats
    demoAttempts,
    demoSuccesses,
    demoDamaged,
    failureStats,
    lastFailureReason,

    // Derived
    altitude,
    speed,
    verticalSpeed,
    horizontalSpeed,
    isLandingZone,
    landingStatus,

    // Actions
    reset,
    updateViabilities,
    recordDemoResult,
    resetDemoStats,
    handleKeyDown,
    handleKeyUp,
  };
}

export type GameStore = ReturnType<typeof createGameStore>;
