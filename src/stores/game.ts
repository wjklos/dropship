import { createSignal, createMemo } from "solid-js";
import type {
  LanderState,
  GameConfig,
  TerrainPoint,
  LandingPad,
  InputState,
  AutopilotMode,
  ApproachMode,
  PadViability,
  GamePhase,
  FailureReason,
  FailureStats,
  LandingOutcome,
  ScoreBreakdown,
  ArcadeState,
} from "../lib/types";
import {
  qualifiesForHighScore,
  addHighScore,
  getHighScoreTable,
  type HighScoreEntry,
} from "../lib/highScores";
import { generateTerrain, generateStars } from "../lib/terrain";
import { getAltitude, getSpeed } from "../lib/physics";
import {
  evaluateAllPads,
  selectTargetPad,
  selectTargetPadWithCone,
  createGNCState,
  triggerAbort,
  canTriggerAbort,
  areControlsLockedForAbort,
  type GNCState,
  type LandingConeResult,
} from "../lib/autopilot";
import {
  WORLDS,
  getWorld,
  getAllWorlds,
  type WorldId,
  type WorldConfig,
} from "../lib/worldRegistry";
import {
  getZoomLevel,
  calculateViewBox,
  canAbortAtAltitude,
} from "../lib/zoom";
import { getWindEffectAt } from "../lib/atmosphere";
import {
  submitFlight,
  queueFlightForSubmission,
  unlockWorld,
  type FlightSubmission,
} from "../lib/api";
import { refreshProgression } from "../lib/worldRegistry";
import {
  FlightLogger,
  saveFlightRecord,
  exportFlightRecords,
  getFlightStats,
  clearFlightRecords,
  type AbortDecision,
  type AbortOutcome,
} from "../lib/flightLogger";
import {
  predictTrajectory,
  findInsertionWindow,
  calculateTwoBurnSolution,
  calculateOptimalBurnX,
  type TrajectoryPrediction,
} from "../lib/trajectory";

// World dimensions - larger for orbital view
const WORLD_WIDTH = 2400;
const WORLD_HEIGHT = 1200;

// Create game configuration from world
function createConfig(world: WorldConfig): GameConfig {
  console.log("[Config] Creating config from world:", {
    worldId: world.id,
    worldOrbitalAltitude: world.orbitalAltitude,
  });
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

// Initial lander state - starts in orbit, oriented sideways
// Thruster points opposite to velocity (right) to enable retrograde burn
function createInitialLander(
  config: GameConfig,
  world: WorldConfig,
): LanderState {
  // Position high but visible below HUD (approx 150px from top of viewport)
  // With viewHeight 1200 at orbital zoom, y=150 keeps lander visible
  const orbitalY = 150;

  return {
    position: {
      x: config.width * 0.1, // Start on the left side
      y: orbitalY, // High up but visible below HUD
    },
    velocity: {
      x: world.orbitalVelocity, // Horizontal orbital velocity (moving right)
      y: 0, // No vertical velocity in orbit
    },
    rotation: -Math.PI / 2, // -90° - tilted LEFT, thrust pushes LEFT (opposite to rightward velocity)
    angularVelocity: 0,
    fuel: 100,
    thrust: 0,
    alive: true,
    landed: false,
    hasBurned: false, // No thrust yet - in stable orbit
    outcome: null,
    failureReason: null,
    // G-force tracking
    currentGs: 0,
    maxGs: 0,
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
    0.6,
    7,
    initialWorld.id,
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
  const [regionName, setRegionName] = createSignal<string>(
    initialTerrain.regionName,
  );
  const [stars, setStars] = createSignal(initialStars);

  // Game phase tracking
  const [gamePhase, setGamePhase] = createSignal<GamePhase>("orbit");

  // Pad viability state
  const [padViabilities, setPadViabilities] = createSignal<PadViability[]>([]);
  const [selectedPadIndex, setSelectedPadIndex] = createSignal<number>(0);
  const [landingCone, setLandingCone] = createSignal<number[]>([]); // Pad indices in the reachable cone
  const [targetLocked, setTargetLocked] = createSignal<boolean>(false); // Has target been selected for this flight?
  const [highlightedConeIndex, setHighlightedConeIndex] =
    createSignal<number>(0); // Index within the cone for manual cycling

  // Input state
  const [input, setInput] = createSignal<InputState>({
    thrust: false,
    rotateLeft: false,
    rotateRight: false,
  });

  // Autopilot state
  const [autopilotMode, setAutopilotMode] = createSignal<AutopilotMode>("off");
  const [approachMode, setApproachMode] =
    createSignal<ApproachMode>("stop_drop");

  // Game state
  const [gameTime, setGameTime] = createSignal(0);
  const [paused, setPaused] = createSignal(false);
  const [gameOver, setGameOver] = createSignal(false);
  const [landedPadIndex, setLandedPadIndex] = createSignal<number | null>(null);

  // Demo mode stats
  const [demoAttempts, setDemoAttempts] = createSignal(0);
  const [demoSuccesses, setDemoSuccesses] = createSignal(0);
  const [demoDamaged, setDemoDamaged] = createSignal(0);
  const [demoScore, setDemoScore] = createSignal(0);
  const [demoStreak, setDemoStreak] = createSignal(0);
  const [failureStats, setFailureStats] = createSignal<FailureStats>({
    VELOCITY_HIGH: 0,
    ANGLE_BAD: 0,
    OFF_PAD: 0,
    OUT_OF_FUEL: 0,
    DAMAGED: 0,
  });

  // Human mode stats
  const [humanAttempts, setHumanAttempts] = createSignal(0);
  const [humanSuccesses, setHumanSuccesses] = createSignal(0);
  const [humanDamaged, setHumanDamaged] = createSignal(0);
  const [humanScore, setHumanScore] = createSignal(0);
  const [humanStreak, setHumanStreak] = createSignal(0); // Current consecutive successes

  // Last failure reason for display
  const [lastFailureReason, setLastFailureReason] =
    createSignal<FailureReason>(null);

  // ============================================
  // ARCADE MODE STATE
  // ============================================
  const STARTING_LIVES = 3;
  const MAX_LIVES = 5;
  const LIFE_AWARD_INTERVAL = 5; // Award life every 5 successful landings

  const [arcadeLives, setArcadeLives] = createSignal(STARTING_LIVES);
  const [arcadeTotalScore, setArcadeTotalScore] = createSignal(0);
  const [arcadeStreak, setArcadeStreak] = createSignal(0);
  const [arcadeConsecutiveSuccesses, setArcadeConsecutiveSuccesses] =
    createSignal(0); // For life awards
  const [arcadeLandingCount, setArcadeLandingCount] = createSignal(0);
  const [isArcadeMode, setIsArcadeMode] = createSignal(false);

  // Score breakdown for display
  const [lastScoreBreakdown, setLastScoreBreakdown] =
    createSignal<ScoreBreakdown | null>(null);
  const [showScoreBreakdown, setShowScoreBreakdown] = createSignal(false);

  // Life animation triggers
  const [lifeLostAnimation, setLifeLostAnimation] = createSignal(false);
  const [lifeGainedAnimation, setLifeGainedAnimation] = createSignal(false);

  // Game over screen state
  const [showGameOver, setShowGameOver] = createSignal(false);

  // Arcade countdown timer (for "Next level in X...")
  const [arcadeCountdown, setArcadeCountdown] = createSignal<number | null>(
    null,
  );

  // High score entry state
  const [showHighScoreEntry, setShowHighScoreEntry] = createSignal(false);
  const [newHighScoreRank, setNewHighScoreRank] = createSignal<number | null>(
    null,
  );
  const [highScoreInitials, setHighScoreInitials] = createSignal([
    "A",
    "A",
    "A",
  ]);
  const [activeInitialIndex, setActiveInitialIndex] = createSignal(0);

  // High score table state
  const [showHighScoreTable, setShowHighScoreTable] = createSignal(false);
  const [highlightedHighScoreRank, setHighlightedHighScoreRank] = createSignal<
    number | null
  >(null);
  const [highScoreEntries, setHighScoreEntries] =
    createSignal<HighScoreEntry[]>(getHighScoreTable());

  // Idle timer for showing high scores after inactivity
  const IDLE_TIMEOUT = 3 * 60 * 1000; // 3 minutes
  const IDLE_DISPLAY_DURATION = 15 * 1000; // 15 seconds
  let idleTimer: ReturnType<typeof setTimeout> | null = null;
  let idleDisplayTimer: ReturnType<typeof setTimeout> | null = null;
  const [showIdleHighScores, setShowIdleHighScores] = createSignal(false);

  function resetIdleTimer() {
    // Clear existing timers
    if (idleTimer) clearTimeout(idleTimer);
    if (idleDisplayTimer) clearTimeout(idleDisplayTimer);
    setShowIdleHighScores(false);

    // Don't start idle timer if in arcade mode or showing high score screens
    if (isArcadeMode() || showHighScoreEntry() || showHighScoreTable()) return;

    // Start new idle timer
    idleTimer = setTimeout(() => {
      // Only show if game is idle - must be in orbit phase, not in arcade mode,
      // and not showing other screens
      const phase = gamePhase();
      if (
        phase !== "orbit" ||
        isArcadeMode() ||
        showHighScoreEntry() ||
        showHighScoreTable() ||
        autopilotMode() === "demo"
      ) {
        // Not idle, restart timer
        resetIdleTimer();
        return;
      }

      // Show high scores after idle timeout
      setHighScoreEntries(getHighScoreTable());
      setShowIdleHighScores(true);

      // Hide after display duration
      idleDisplayTimer = setTimeout(() => {
        setShowIdleHighScores(false);
        // Restart the idle timer
        resetIdleTimer();
      }, IDLE_DISPLAY_DURATION);
    }, IDLE_TIMEOUT);
  }

  // Flight logger - tracks current flight for analysis
  let flightLogger: FlightLogger | null = null;

  // Initialize flight logger for a new flight
  function initFlightLogger() {
    const pads = landingPads();
    const viabilities = padViabilities();
    const currentLander = lander();
    const cfg = config();
    const targetPad =
      viabilities.length > 0
        ? selectTargetPad(
            viabilities,
            pads,
            currentLander.position.x,
            currentLander.velocity.x,
            cfg.width,
          )
        : { pad: pads[0], index: 0, viable: true };

    // Only include approachMode for autopilot modes that use it
    const mode = autopilotMode();
    const approach = mode === "land" || mode === "demo" ? approachMode() : null;

    flightLogger = new FlightLogger(
      worldId(),
      mode,
      approach,
      lander(),
      targetPad.pad,
      targetPad.index,
    );
  }

  // Update flight logger with current state
  function updateFlightLogger() {
    if (flightLogger) {
      flightLogger.update(lander(), altitude(), gamePhase(), gameTime());
    }
  }

  // Finalize and save flight log, returns backend score
  async function finalizeFlightLog(
    outcome: LandingOutcome | null,
    failureReason: FailureReason,
    landedPadIndex: number | null,
  ): Promise<number | null> {
    if (flightLogger) {
      const record = flightLogger.finalize(
        lander(),
        altitude(),
        outcome,
        failureReason,
        landedPadIndex,
      );
      // Save locally
      saveFlightRecord(record);

      // Submit to backend API
      const submission: FlightSubmission = {
        id: record.id,
        timestamp: record.timestamp,
        worldId: record.worldId,
        outcome: record.outcome,
        failureReason: record.failureReason,
        mode: record.mode,
        approachMode: record.approachMode,
        duration: record.duration,
        burnTime: record.burnTime,
        initial: {
          x: record.initial.x,
          y: record.initial.y,
          vx: record.initial.vx,
          vy: record.initial.vy,
          rotation: record.initial.rotation,
          fuel: record.initial.fuel,
          targetPadIndex: record.initial.targetPadIndex,
        },
        terminal: record.terminal,
        metrics: {
          maxSpeed: record.metrics.maxSpeed,
          maxDescentRate: record.metrics.maxDescentRate,
          maxHorizontalSpeed: record.metrics.maxHorizontalSpeed,
          maxGs: record.metrics.maxGs,
          minAltitude: record.metrics.minAltitude,
          fuelUsed: record.metrics.fuelUsed,
          horizontalErrorAtTouchdown: record.metrics.horizontalErrorAtTouchdown,
          verticalSpeedAtTouchdown: record.metrics.verticalSpeedAtTouchdown,
          horizontalSpeedAtTouchdown: record.metrics.horizontalSpeedAtTouchdown,
          angleAtTouchdown: record.metrics.angleAtTouchdown,
          timeInOrbit: record.metrics.timeInOrbit,
          abortAttempts: record.metrics.abortAttempts,
          // Include detailed abort events (filter out 'pending' outcome for clean submission)
          abortEvents: record.metrics.abortEvents
            .filter((e) => e.outcome !== "pending")
            .map((e) => ({
              altitude: e.altitude,
              phase: e.phase,
              fuel: e.fuel,
              velocity: e.velocity,
              decision: e.decision,
              outcome: e.outcome,
              originalPadIndex: e.originalPadIndex,
              emergencyPadIndex: e.emergencyPadIndex,
              timestamp: e.timestamp,
            })),
        },
        landedPadIndex: record.landedPadIndex,
        landedPadMultiplier:
          landedPadIndex !== null
            ? landingPads()[landedPadIndex]?.multiplier
            : undefined,
        // Include telemetry (required by backend)
        telemetry: record.telemetry,
      };

      flightLogger = null;

      // Submit and return backend score
      const result = await submitFlight(submission);
      if (result) {
        // On successful landing, attempt to unlock the next world
        if (outcome === "success") {
          attemptWorldUnlock(record.worldId);
        }
        return result.score ?? null;
      } else {
        // Queue for later if submission failed
        queueFlightForSubmission(submission);
        return null;
      }
    }
    return null;
  }

  // World unlock progression chain
  const WORLD_UNLOCK_CHAIN: Record<string, string> = {
    moon: "mars",
    mars: "earth",
    // earth: future worlds...
  };

  // Attempt to unlock the next world after a successful landing
  async function attemptWorldUnlock(landedWorldId: string): Promise<void> {
    const nextWorld = WORLD_UNLOCK_CHAIN[landedWorldId];
    if (!nextWorld) {
      console.log(`[Unlock] No next world to unlock after ${landedWorldId}`);
      return;
    }

    console.log(`[Unlock] Attempting to unlock ${nextWorld} after landing on ${landedWorldId}`);

    const result = await unlockWorld(nextWorld);
    if (result && result.success !== false) {
      console.log(`[Unlock] Successfully unlocked ${nextWorld}:`, result);
      // Refresh progression to update UI
      await refreshProgression();
    } else {
      console.log(`[Unlock] Could not unlock ${nextWorld} (may already be unlocked or requirements not met)`);
    }
  }

  // Record abort in flight log
  function recordAbortInLog() {
    if (flightLogger) {
      flightLogger.recordAbort();
    }
  }

  // Trajectory prediction state
  const [trajectoryPrediction, setTrajectoryPrediction] =
    createSignal<TrajectoryPrediction | null>(null);
  const [optimalBurnPoint, setOptimalBurnPoint] = createSignal<number | null>(
    null,
  );
  const [lockedDeorbitPoint, setLockedDeorbitPoint] = createSignal<
    number | null
  >(null);
  const [insertionWindowTime, setInsertionWindowTime] = createSignal<number>(0);
  const [showTrajectory, setShowTrajectory] = createSignal<boolean>(true);

  // GNC Autopilot state
  const [gncState, setGNCState] = createSignal<GNCState>(createGNCState());

  // Update trajectory prediction (called from game loop)
  function updateTrajectoryPrediction() {
    const currentLander = lander();
    const cfg = config();
    const terr = terrain();
    const pads = landingPads();

    // Only predict if lander is alive and not landed
    if (!currentLander.alive || currentLander.landed) {
      setTrajectoryPrediction(null);
      return;
    }

    // Get target pad
    const viabilities = padViabilities();
    const targetPadInfo =
      viabilities.length > 0
        ? selectTargetPad(
            viabilities,
            pads,
            currentLander.position.x,
            currentLander.velocity.x,
            cfg.width,
          )
        : { pad: pads[0], index: 0, viable: true };

    // Predict trajectory (no burn - just ballistic)
    const prediction = predictTrajectory(
      currentLander,
      cfg,
      terr,
      pads,
      null, // No burn for current prediction
      30, // 30 seconds max
      0.05, // Fine timestep for accuracy
    );

    setTrajectoryPrediction(prediction);

    // Calculate insertion window if in orbit
    if (gamePhase() === "orbit" && !currentLander.hasBurned) {
      const window = findInsertionWindow(
        currentLander,
        cfg,
        terr,
        targetPadInfo.pad,
      );
      setOptimalBurnPoint(window.optimalBurnPoint);
      setInsertionWindowTime(window.windowOpensIn);
    } else {
      setOptimalBurnPoint(null);
      setInsertionWindowTime(0);
    }
  }

  // Get current target pad
  const targetPad = createMemo(() => {
    const pads = landingPads();
    const viabilities = padViabilities();
    const l = lander();
    const cfg = config();
    if (viabilities.length > 0) {
      const target = selectTargetPad(
        viabilities,
        pads,
        l.position.x,
        l.velocity.x,
        cfg.width,
      );
      return target.pad;
    }
    return pads.length > 0 ? pads[0] : null;
  });

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

  // Current wind effect at lander position
  const currentWindEffect = createMemo(() => {
    const currentWorld = world();
    const l = lander();
    const alt = altitude();
    const time = gameTime();

    return getWindEffectAt(alt, l.velocity, currentWorld.atmosphere, time);
  });

  // Check if world selection is locked (after first burn)
  const worldLocked = createMemo(() => lander().hasBurned);

  // Get the designation of the pad that was landed on (for success message)
  const landedPadDesignation = createMemo(() => {
    const idx = landedPadIndex();
    if (idx === null) return null;
    const pads = landingPads();
    return pads[idx]?.designation ?? null;
  });

  // Check if abort is available
  const canAbort = createMemo(() => {
    const phase = gamePhase();
    // Abort available during descent (before landing/crash)
    // The GNC system handles abort phases and decision making
    return phase === "descent" && canTriggerAbort(gncState(), lander());
  });

  // Check if controls are locked for abort
  const controlsLocked = createMemo(() => areControlsLockedForAbort(gncState()));

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

    // Select best target pad with cone analysis
    // Randomize only if:
    // 1. Target not yet locked AND
    // 2. Autopilot is engaged (demo/land mode) AND
    // 3. Still in orbit (hasn't burned yet) - has time to be selective
    // If autopilot engaged during descent, pick safest (nearest viable) option
    const isAutoMode = autopilotMode() === "demo" || autopilotMode() === "land";
    const inOrbit = !currentLander.hasBurned;
    const shouldRandomize = !targetLocked() && isAutoMode && inOrbit;

    const coneResult = selectTargetPadWithCone(
      viabilities,
      pads,
      currentLander.position.x,
      currentLander.velocity.x,
      cfg.width,
      shouldRandomize,
    );

    // Update landing cone for visualization
    setLandingCone(coneResult.cone);

    // Lock target when autopilot is engaged and we have a good cone to choose from
    // Wait for at least 2 pads in cone before locking - simulates pilot selecting target
    // This gives time for the cone to populate so randomization is meaningful
    const minPadsForLock = 2;
    const coneReady = coneResult.cone.length >= minPadsForLock;

    if (isAutoMode && !targetLocked() && coneReady) {
      // NOW do the random selection from the full cone and lock it
      // Re-select with randomization to ensure we pick from all available pads
      const finalSelection = selectTargetPadWithCone(
        viabilities,
        pads,
        currentLander.position.x,
        currentLander.velocity.x,
        cfg.width,
        true, // Force randomization for final selection
      );
      setTargetLocked(true);
      setSelectedPadIndex(finalSelection.selected.index);
    }
    // Don't update selectedPadIndex until we lock - prevents overwriting the random selection
    // The crosshairs will show the locked pad once autopilot engages
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
    const newTerrain = generateTerrain(
      newConfig.width,
      newConfig.height,
      0.6,
      7,
      newWorldId,
    );
    setTerrain(newTerrain.terrain);
    setLandingPads(newTerrain.landingPads);
    setRegionName(newTerrain.regionName);
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

    const newTerrain = generateTerrain(
      cfg.width,
      cfg.height,
      0.6,
      7,
      currentWorld.id,
    );
    setTerrain(newTerrain.terrain);
    setLandingPads(newTerrain.landingPads);
    setRegionName(newTerrain.regionName);
    setLander(createInitialLander(cfg, currentWorld));
    setPadViabilities([]);
    setSelectedPadIndex(0);
    setLandingCone([]);
    setTargetLocked(false); // Reset so next flight picks a new random target
    setGameTime(0);
    setGameOver(false);
    setGamePhase("orbit");
    setPaused(false);
    setLastFailureReason(null);
    setLandedPadIndex(null);

    // Reset GNC autopilot state
    setGNCState(createGNCState());

    if (preserveMode) {
      setAutopilotMode(currentMode);
    } else {
      setAutopilotMode("off");
    }
  }

  // Initiate abort - triggers GNC abort system
  function initiateAbort() {
    if (!canAbort()) {
      console.log("[Abort] Cannot abort - canAbort() returned false");
      return;
    }

    // Use the new GNC abort system
    const currentGNCState = gncState();
    const currentLander = lander();
    const pads = landingPads();
    const cfg = config();
    const terr = terrain();
    const currentGameTime = gameTime();
    const currentAltitude = altitude();

    // IMPORTANT: Capture state BEFORE triggerAbort modifies it
    const phaseBeforeAbort = currentGNCState.phase;
    const originalPadIdx = currentGNCState.targetPadLocked
      ? currentGNCState.targetPadIndex
      : null;

    console.log("[Abort] Initiating abort:", {
      phase: phaseBeforeAbort,
      altitude: currentAltitude,
      fuel: currentLander.fuel,
      vx: currentLander.velocity.x,
      vy: currentLander.velocity.y,
      hasFlightLogger: !!flightLogger,
    });

    // Trigger abort through GNC
    const abortTriggered = triggerAbort(
      currentGNCState,
      currentLander,
      pads,
      cfg,
      terr,
    );

    console.log("[Abort] triggerAbort returned:", abortTriggered, {
      newPhase: currentGNCState.phase,
      decision: currentGNCState.abortDecision,
      emergencyPad: currentGNCState.emergencyPadIndex,
    });

    if (abortTriggered) {
      // Update GNC state with abort changes
      setGNCState({ ...currentGNCState });

      // Record detailed abort event in flight log
      if (flightLogger) {
        // Map GNC abort decision to logger's AbortDecision type
        const decision: AbortDecision =
          currentGNCState.abortDecision === "orbit"
            ? "orbit"
            : currentGNCState.abortDecision === "retarget"
              ? "retarget"
              : "brace";

        console.log("[Abort] Recording abort event:", {
          altitude: currentAltitude,
          phase: phaseBeforeAbort, // Use phase BEFORE abort
          fuel: currentLander.fuel,
          decision,
          originalPadIdx,
          emergencyPadIndex: currentGNCState.emergencyPadIndex,
          timestamp: currentGameTime,
        });

        flightLogger.startAbortEvent(
          currentAltitude,
          phaseBeforeAbort, // Use phase BEFORE abort was triggered
          currentLander.fuel,
          {
            vx: currentLander.velocity.x,
            vy: currentLander.velocity.y,
          },
          decision,
          originalPadIdx,
          currentGNCState.emergencyPadIndex,
          currentGameTime,
        );
      } else {
        console.warn("[Abort] No flight logger - abort event not recorded!");
      }
    }
  }

  // Complete abort - called when GNC abort returns to orbit
  // This is now handled automatically by the GNC state machine
  function completeAbort() {
    const l = lander();
    const currentWorld = world();

    console.log("[Abort] completeAbort CALLED - returning to orbit", {
      hasFlightLogger: !!flightLogger,
      currentPosition: { x: l.position.x, y: l.position.y },
      currentVelocity: { vx: l.velocity.x, vy: l.velocity.y },
      currentRotation: l.rotation,
      newVelocity: { vx: currentWorld.orbitalVelocity, vy: 0 },
      newRotation: -Math.PI / 2,
    });

    // Record successful orbit return in flight log and SUBMIT IT
    // This is critical - abort events must be submitted before the logger is reset
    if (flightLogger) {
      const hasPending = flightLogger.hasPendingAbort();
      console.log("[Abort] Flight logger exists, hasPendingAbort:", hasPending);

      if (hasPending) {
        flightLogger.completeAbortEvent("orbit_achieved");
        console.log("[Abort] Marked abort event as orbit_achieved");
      }

      // Submit the aborted flight to backend (outcome=null means aborted/no landing)
      // This ensures abort events are recorded even when returning to orbit
      const record = flightLogger.finalize(
        l,
        altitude(),
        null, // No landing outcome - returned to orbit
        null, // No failure reason
        null, // No landed pad
      );

      // Save locally
      saveFlightRecord(record);

      // Submit to backend with abort events
      const submission: FlightSubmission = {
        id: record.id,
        timestamp: record.timestamp,
        worldId: record.worldId,
        outcome: null, // Aborted - returned to orbit
        failureReason: null,
        mode: record.mode,
        approachMode: record.approachMode,
        duration: record.duration,
        burnTime: record.burnTime,
        initial: {
          x: record.initial.x,
          y: record.initial.y,
          vx: record.initial.vx,
          vy: record.initial.vy,
          rotation: record.initial.rotation,
          fuel: record.initial.fuel,
          targetPadIndex: record.initial.targetPadIndex,
        },
        terminal: record.terminal,
        metrics: {
          maxSpeed: record.metrics.maxSpeed,
          maxDescentRate: record.metrics.maxDescentRate,
          maxHorizontalSpeed: record.metrics.maxHorizontalSpeed,
          maxGs: record.metrics.maxGs,
          minAltitude: record.metrics.minAltitude,
          fuelUsed: record.metrics.fuelUsed,
          horizontalErrorAtTouchdown: record.metrics.horizontalErrorAtTouchdown,
          verticalSpeedAtTouchdown: record.metrics.verticalSpeedAtTouchdown,
          horizontalSpeedAtTouchdown: record.metrics.horizontalSpeedAtTouchdown,
          angleAtTouchdown: record.metrics.angleAtTouchdown,
          timeInOrbit: record.metrics.timeInOrbit,
          abortAttempts: record.metrics.abortAttempts,
          abortEvents: record.metrics.abortEvents
            .filter((e) => e.outcome !== "pending")
            .map((e) => ({
              altitude: e.altitude,
              phase: e.phase,
              fuel: e.fuel,
              velocity: e.velocity,
              decision: e.decision,
              outcome: e.outcome,
              originalPadIndex: e.originalPadIndex,
              emergencyPadIndex: e.emergencyPadIndex,
              timestamp: e.timestamp,
            })),
        },
        landedPadIndex: null,
        telemetry: record.telemetry,
      };

      console.log("[Abort] Submitting flight with abort events:", {
        flightId: submission.id,
        outcome: submission.outcome,
        abortAttempts: submission.metrics.abortAttempts,
        abortEventsCount: submission.metrics.abortEvents?.length ?? 0,
        abortEvents: submission.metrics.abortEvents,
      });

      // Submit async (don't block game)
      submitFlight(submission).then((result) => {
        if (!result) {
          console.warn("[Abort] Flight submission failed, queuing for later");
          queueFlightForSubmission(submission);
        } else {
          console.log("[Abort] Flight successfully submitted to backend:", result);
        }
      });

      // Clear the logger so a fresh one is created on next descent
      flightLogger = null;
    }

    // Reset lander to orbital state at current position
    // The reorient phase has already rotated to retrograde stance (-π/2)
    // Position is kept - canReachOrbit() already verified we're at proper altitude
    setLander({
      ...l,
      // Keep current position - already at proper altitude (verified at abort initiation)
      hasBurned: false,
      velocity: {
        x: currentWorld.orbitalVelocity,
        y: 0,
      },
      // Keep current rotation - reorient phase already aligned to retrograde
      angularVelocity: 0,
    });
    setGamePhase("orbit");

    // Reset target lock so player can select a new pad
    setTargetLocked(false);

    // Turn OFF autopilot - player is back in control
    setAutopilotMode("off");

    // Reset GNC state for fresh start
    setGNCState(createGNCState());

    // Verify the state was set correctly
    const finalLander = lander();
    console.log("[Abort] Returned to orbit - autopilot OFF, player in control", {
      finalPosition: { x: finalLander.position.x, y: finalLander.position.y },
      finalVelocity: { vx: finalLander.velocity.x, vy: finalLander.velocity.y },
      finalRotation: finalLander.rotation,
      finalHasBurned: finalLander.hasBurned,
      gamePhase: gamePhase(),
      autopilotMode: autopilotMode(),
    });
  }

  // Record abort outcome for non-orbit cases (landed or crashed after abort)
  function recordAbortOutcome(outcome: AbortOutcome) {
    if (flightLogger && flightLogger.hasPendingAbort()) {
      flightLogger.completeAbortEvent(outcome);
    }
  }

  // Transition from orbit to descent (called when first thrust happens)
  function startDescent() {
    if (gamePhase() === "orbit") {
      setGamePhase("descent");
    }
  }

  // Record demo result
  function recordDemoResult(
    success: boolean,
    reason: FailureReason = null,
    backendScore: number | null = null,
  ) {
    setDemoAttempts((a) => a + 1);
    setLastFailureReason(reason);

    if (success) {
      setDemoSuccesses((s) => s + 1);
      // Increment streak
      const newStreak = demoStreak() + 1;
      setDemoStreak(newStreak);
      // Use backend score if available, otherwise fall back to streak-based
      const points = backendScore ?? 100 * newStreak;
      setDemoScore((s) => s + points);
    } else if (reason === "DAMAGED") {
      setDemoDamaged((d) => d + 1);
      setDemoStreak(0); // Break the streak
      setFailureStats((stats) => ({
        ...stats,
        DAMAGED: stats.DAMAGED + 1,
      }));
    } else if (reason) {
      setDemoStreak(0); // Break the streak
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
    setDemoScore(0);
    setDemoStreak(0);
    setFailureStats({
      VELOCITY_HIGH: 0,
      ANGLE_BAD: 0,
      OFF_PAD: 0,
      OUT_OF_FUEL: 0,
      DAMAGED: 0,
    });
  }

  // Record human result with scoring
  // Score: base 100 points, multiplied by streak (1x, 2x, 3x, etc.)
  function recordHumanResult(success: boolean, reason: FailureReason = null) {
    setHumanAttempts((a) => a + 1);
    setLastFailureReason(reason);

    if (success) {
      setHumanSuccesses((s) => s + 1);
      // Increment streak and calculate score
      const newStreak = humanStreak() + 1;
      setHumanStreak(newStreak);
      const points = 100 * newStreak;
      setHumanScore((s) => s + points);
    } else if (reason === "DAMAGED") {
      setHumanDamaged((d) => d + 1);
      // Damaged landing breaks the streak but doesn't add to crashed count
      setHumanStreak(0);
    } else {
      // Crashed - break the streak
      setHumanStreak(0);
    }
  }

  // Reset human stats
  function resetHumanStats() {
    setHumanAttempts(0);
    setHumanSuccesses(0);
    setHumanDamaged(0);
    setHumanScore(0);
    setHumanStreak(0);
  }

  // ============================================
  // ARCADE MODE FUNCTIONS
  // ============================================

  /**
   * Calculate landing score based on multiple factors
   */
  function calculateLandingScore(
    pad: LandingPad,
    landerState: LanderState,
    currentStreak: number,
    currentWorldId: WorldId,
  ): ScoreBreakdown {
    const BASE_SCORE = 1000;

    // Pad difficulty multiplier (1-5)
    const padMultiplier = pad.multiplier;

    // Fuel multiplier (1.0-2.0 based on remaining fuel)
    const fuelPercent = landerState.fuel;
    let fuelMultiplier = 1.0;
    if (fuelPercent >= 80) fuelMultiplier = 2.0;
    else if (fuelPercent >= 60) fuelMultiplier = 1.7;
    else if (fuelPercent >= 40) fuelMultiplier = 1.4;
    else if (fuelPercent >= 20) fuelMultiplier = 1.2;

    // Precision multiplier (1.0-1.5 based on distance from pad center)
    const padCenter = (pad.x1 + pad.x2) / 2;
    const padRadius = (pad.x2 - pad.x1) / 2;
    const distFromCenter = Math.abs(landerState.position.x - padCenter);
    const precisionMultiplier = Math.max(
      1.0,
      1.5 - (distFromCenter / padRadius) * 0.5,
    );

    // Speed multiplier (1.0-1.3 based on landing velocity)
    const speed = Math.abs(landerState.velocity.y);
    const maxSafeSpeed = 15; // config.maxLandingVelocity
    const speedMultiplier = Math.max(1.0, 1.3 - (speed / maxSafeSpeed) * 0.3);

    // Streak bonus (+500 per consecutive success)
    const streakBonus = 500 * currentStreak;

    // World multiplier (Mars is harder = 1.5x bonus)
    const worldMultiplier = currentWorldId === "mars" ? 1.5 : 1.0;

    // Calculate total
    const subtotal =
      BASE_SCORE *
        padMultiplier *
        fuelMultiplier *
        precisionMultiplier *
        speedMultiplier +
      streakBonus;
    const totalScore = Math.round(subtotal * worldMultiplier);

    return {
      baseScore: BASE_SCORE,
      padMultiplier,
      fuelMultiplier: Math.round(fuelMultiplier * 100) / 100,
      precisionMultiplier: Math.round(precisionMultiplier * 100) / 100,
      speedMultiplier: Math.round(speedMultiplier * 100) / 100,
      streakBonus,
      worldMultiplier,
      totalScore,
    };
  }

  /**
   * Start a new arcade session
   */
  function startArcadeSession() {
    setIsArcadeMode(true);
    setArcadeLives(STARTING_LIVES);
    setArcadeTotalScore(0);
    setArcadeStreak(0);
    setArcadeConsecutiveSuccesses(0);
    setArcadeLandingCount(0);
    setLastScoreBreakdown(null);
    setShowScoreBreakdown(false);
    setShowHighScoreEntry(false);
    setShowHighScoreTable(false);
    setHighScoreInitials(["A", "A", "A"]);
    setActiveInitialIndex(0);
    reset(false);
  }

  /**
   * End arcade session and check for high score
   */
  function endArcadeSession() {
    const finalScore = arcadeTotalScore();
    const qualification = qualifiesForHighScore(finalScore);

    setGamePhase("game_over");

    if (qualification.qualifies) {
      setNewHighScoreRank(qualification.rank);
      setShowHighScoreEntry(true);
      setGamePhase("high_score_entry");
    } else {
      setShowHighScoreTable(true);
      setHighScoreEntries(getHighScoreTable());
      setGamePhase("high_score_table");
    }
  }

  /**
   * Start countdown timer for arcade mode
   */
  function startArcadeCountdown(seconds: number, onComplete: () => void) {
    setArcadeCountdown(seconds);

    const interval = setInterval(() => {
      setArcadeCountdown((c) => {
        if (c === null || c <= 1) {
          clearInterval(interval);
          setArcadeCountdown(null);
          onComplete();
          return null;
        }
        return c - 1;
      });
    }, 1000);
  }

  /**
   * Record arcade landing result
   * @param backendScore - Score from backend API (if available)
   */
  function recordArcadeResult(
    outcome: LandingOutcome,
    pad: LandingPad | null,
    landerState: LanderState,
    failureReason: FailureReason = null,
    backendScore: number | null = null,
  ) {
    // Always increment attempts for player stats
    setHumanAttempts((a) => a + 1);

    if (outcome === "success" && pad) {
      // Update player stats
      setHumanSuccesses((s) => s + 1);

      // Calculate score - use backend score if available, otherwise calculate locally
      const newStreak = arcadeStreak() + 1;
      setArcadeStreak(newStreak);

      const breakdown = calculateLandingScore(
        pad,
        landerState,
        newStreak,
        worldId(),
      );

      // Override with backend score if available
      if (backendScore !== null) {
        breakdown.totalScore = backendScore;
      }

      setLastScoreBreakdown(breakdown);
      setArcadeTotalScore((s) => s + breakdown.totalScore);
      setArcadeLandingCount((c) => c + 1);
      setShowScoreBreakdown(true);

      // Track consecutive successes for life awards
      const newConsecutive = arcadeConsecutiveSuccesses() + 1;
      setArcadeConsecutiveSuccesses(newConsecutive);

      // Award life every LIFE_AWARD_INTERVAL successes
      if (
        newConsecutive % LIFE_AWARD_INTERVAL === 0 &&
        arcadeLives() < MAX_LIVES
      ) {
        awardLife();
      }

      // Start countdown then reset
      startArcadeCountdown(5, () => {
        setShowScoreBreakdown(false);
        if (isArcadeMode() && arcadeLives() > 0) {
          reset(false);
        }
      });
    } else if (outcome === "damaged") {
      // Update player stats
      setHumanDamaged((d) => d + 1);

      // Damaged = no life lost, no points, streak reset
      setArcadeStreak(0);
      setLastScoreBreakdown(null);

      // Start countdown then reset
      startArcadeCountdown(5, () => {
        if (isArcadeMode() && arcadeLives() > 0) {
          reset(false);
        }
      });
    } else if (outcome === "crashed") {
      // Crashed = lose life, streak reset (crashed count derived from attempts - successes - damaged)
      setArcadeStreak(0);
      setLastScoreBreakdown(null);
      loseLife();
    }
  }

  /**
   * Award an extra life
   */
  function awardLife() {
    if (arcadeLives() >= MAX_LIVES) return;

    setLifeGainedAnimation(true);
    setArcadeLives((l) => l + 1);

    setTimeout(() => {
      setLifeGainedAnimation(false);
    }, 1000);
  }

  /**
   * Lose a life
   */
  function loseLife() {
    const currentLives = arcadeLives();
    if (currentLives <= 0) return;

    const newLives = currentLives - 1;
    setArcadeLives(newLives);

    setLifeLostAnimation(true);
    setTimeout(() => {
      setLifeLostAnimation(false);
    }, 500);

    // Check for game over
    if (newLives <= 0) {
      // Game over - show countdown then end session
      startArcadeCountdown(5, () => {
        endArcadeSession();
      });
    } else {
      // Start countdown then reset for next attempt
      startArcadeCountdown(5, () => {
        if (isArcadeMode()) {
          reset(false);
        }
      });
    }
  }

  /**
   * Handle high score initial entry keyboard input
   */
  function handleHighScoreEntryKeyDown(key: string) {
    const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 ";
    const current = highScoreInitials();
    const activeIdx = activeInitialIndex();

    switch (key) {
      case "ArrowUp":
      case "w":
      case "W": {
        const currentChar = current[activeIdx];
        const currentCharIdx = chars.indexOf(currentChar);
        const prevCharIdx = (currentCharIdx - 1 + chars.length) % chars.length;
        setHighScoreInitials((letters) => {
          const updated = [...letters];
          updated[activeIdx] = chars[prevCharIdx];
          return updated;
        });
        break;
      }

      case "ArrowDown":
      case "s":
      case "S": {
        const currentChar = current[activeIdx];
        const currentCharIdx = chars.indexOf(currentChar);
        const nextCharIdx = (currentCharIdx + 1) % chars.length;
        setHighScoreInitials((letters) => {
          const updated = [...letters];
          updated[activeIdx] = chars[nextCharIdx];
          return updated;
        });
        break;
      }

      case "ArrowLeft":
        setActiveInitialIndex((idx) => Math.max(0, idx - 1));
        break;

      case "ArrowRight":
        setActiveInitialIndex((idx) => Math.min(2, idx + 1));
        break;

      case "Enter":
      case " ":
        if (activeIdx < 2) {
          setActiveInitialIndex((idx) => idx + 1);
        } else {
          // Submit high score
          submitHighScore();
        }
        break;
    }
  }

  /**
   * Submit the high score with entered initials
   */
  function submitHighScore() {
    const initials = highScoreInitials().join("");
    const score = arcadeTotalScore();
    const landings = arcadeLandingCount();
    const world = worldId();

    const newTable = addHighScore(initials, score, world, landings);
    setHighScoreEntries(newTable.entries);

    // Find the rank of the just-added score
    const addedEntry = newTable.entries.find(
      (e) => e.score === score && e.initials === initials,
    );
    setHighlightedHighScoreRank(addedEntry?.rank ?? null);

    setShowHighScoreEntry(false);
    setShowHighScoreTable(true);
    setGamePhase("high_score_table");
  }

  /**
   * Handle high score table keyboard input
   */
  function handleHighScoreTableKeyDown(key: string) {
    if (key.toLowerCase() === "r") {
      // Start new arcade session
      setShowHighScoreTable(false);
      setHighlightedHighScoreRank(null);
      startArcadeSession();
    } else if (key === "Escape") {
      // Exit to normal mode
      setShowHighScoreTable(false);
      setHighlightedHighScoreRank(null);
      setIsArcadeMode(false);
      setGamePhase("orbit");
      reset(false);
    }
  }

  /**
   * Exit arcade mode
   */
  function exitArcadeMode() {
    setIsArcadeMode(false);
    setShowHighScoreEntry(false);
    setShowHighScoreTable(false);
    setGamePhase("orbit");
    reset(false);
  }

  // Input handlers
  function handleKeyDown(key: string) {
    // Reset idle timer on any key press
    resetIdleTimer();

    // Hide idle high scores if showing
    if (showIdleHighScores()) {
      setShowIdleHighScores(false);
    }

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
      case "l":
        // Export flight logs
        exportFlightRecords();
        break;
      case "c":
        // Toggle trajectory arc visibility
        setShowTrajectory((v) => !v);
        break;
      case "s":
        // Select Stop & Drop approach
        setApproachMode("stop_drop");
        break;
      case "b":
        // Select Boostback approach
        setApproachMode("boostback");
        break;
      case "x":
        // Toggle manual pad lock (only in manual mode, using same logic as autopilot)
        if (autopilotMode() === "off") {
          const currentState = gncState();
          if (currentState.targetPadLocked) {
            // Unlock - clear the target
            setGNCState({
              ...currentState,
              targetPadLocked: false,
              lockedDeorbitX: null,
              lockedPadViable: true,
              deorbitTimingDelta: null,
              solution: null,
            });
            setTargetLocked(false);
          } else {
            // Lock the currently highlighted pad from the cone
            const cone = landingCone();
            if (cone.length > 0) {
              // Get the highlighted pad index within the cone
              const coneIdx = highlightedConeIndex() % cone.length;
              const padIndex = cone[coneIdx];
              const pads = landingPads();
              const targetPad = pads[padIndex];

              // Calculate deorbit solution for this pad
              const solution = calculateTwoBurnSolution(
                lander(),
                config(),
                terrain(),
                pads,
                targetPad,
              );

              // Debug: log the solution details
              const padCenter = (targetPad.x1 + targetPad.x2) / 2;
              console.log(
                `[Manual Lock] Pad ${padIndex} center: ${padCenter.toFixed(0)}, Lander X: ${lander().position.x.toFixed(0)}, Vx: ${lander().velocity.x.toFixed(1)}`,
              );
              console.log(`[Manual Lock] Solution:`, {
                hasSolution: !!solution.deorbit,
                burnStartX: solution.deorbit?.burnStartX?.toFixed(0),
                burnStartTime: solution.deorbit?.burn.startTime.toFixed(2),
                predictedImpactX:
                  solution.deorbit?.predictedImpactX?.toFixed(0),
                horizontalError:
                  solution.deorbit?.horizontalErrorAtImpact?.toFixed(0),
              });

              // Only lock if we have a valid deorbit solution with enough lead time
              const hasValidDeorbit = solution.deorbit !== null;
              const hasEnoughLeadTime =
                solution.deorbit && solution.deorbit.burn.startTime > 1;

              if (hasValidDeorbit && hasEnoughLeadTime) {
                // Calculate the fixed optimal burn X based on pad and physics
                const currentLander = lander();
                const currentConfig = config();
                const alt = altitude();
                const optimalBurnX = calculateOptimalBurnX(
                  padCenter,
                  currentLander.velocity.x,
                  currentConfig.gravity,
                  currentConfig.maxThrust,
                  alt,
                  currentConfig.width,
                );

                // Lock the pad with deorbit point
                setGNCState({
                  ...currentState,
                  targetPadIndex: padIndex,
                  targetPadLocked: true,
                  lockedPadViable: solution.viable,
                  lockedDeorbitX: optimalBurnX,
                  solution: solution,
                });
                setSelectedPadIndex(padIndex);
                setTargetLocked(true);
              } else {
                console.log(
                  `[Manual] Cannot lock pad - ${!hasValidDeorbit ? "no deorbit solution" : `burn in ${solution.deorbit?.burn.startTime.toFixed(1)}s (need >1s)`}`,
                );
              }
            } else {
              console.log(`[Manual] No pads in cone to lock`);
            }
          }
        }
        break;
      case "[":
        // Cycle to previous pad in cone (manual mode only)
        if (autopilotMode() === "off" && !gncState().targetPadLocked) {
          const cone = landingCone();
          if (cone.length > 0) {
            const current = highlightedConeIndex();
            const newIdx = (current - 1 + cone.length) % cone.length;
            setHighlightedConeIndex(newIdx);
            console.log(
              `[Manual] Highlighting pad ${cone[newIdx]} (${newIdx + 1}/${cone.length})`,
            );
          }
        }
        break;
      case "]":
        // Cycle to next pad in cone (manual mode only)
        if (autopilotMode() === "off" && !gncState().targetPadLocked) {
          const cone = landingCone();
          if (cone.length > 0) {
            const current = highlightedConeIndex();
            const newIdx = (current + 1) % cone.length;
            setHighlightedConeIndex(newIdx);
            console.log(
              `[Manual] Highlighting pad ${cone[newIdx]} (${newIdx + 1}/${cone.length})`,
            );
          }
        }
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
    landingCone,
    highlightedConeIndex,
    stars,
    input,
    autopilotMode,
    setAutopilotMode,
    approachMode,
    setApproachMode,
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
    controlsLocked,
    initiateAbort,
    completeAbort,

    // Zoom
    currentZoom,
    viewBox,

    // Demo stats
    demoAttempts,
    demoSuccesses,
    demoDamaged,
    demoScore,
    demoStreak,
    failureStats,
    lastFailureReason,

    // Human stats
    humanAttempts,
    humanSuccesses,
    humanDamaged,
    humanScore,
    humanStreak,

    // Landing info
    landedPadIndex,
    setLandedPadIndex,
    landedPadDesignation,
    regionName,

    // Derived
    altitude,
    speed,
    verticalSpeed,
    horizontalSpeed,
    isLandingZone,
    landingStatus,
    currentWindEffect,

    // Actions
    reset,
    updateViabilities,
    recordDemoResult,
    resetDemoStats,
    recordHumanResult,
    resetHumanStats,
    handleKeyDown,
    handleKeyUp,

    // Flight logging
    initFlightLogger,
    updateFlightLogger,
    finalizeFlightLog,
    recordAbortInLog,
    recordAbortOutcome,
    exportFlightRecords,
    getFlightStats,
    clearFlightRecords,

    // Trajectory prediction
    trajectoryPrediction,
    optimalBurnPoint,
    insertionWindowTime,
    updateTrajectoryPrediction,
    targetPad,
    showTrajectory,

    // GNC Autopilot
    gncState,
    setGNCState,

    // Arcade Mode
    isArcadeMode,
    arcadeLives,
    arcadeTotalScore,
    arcadeStreak,
    arcadeLandingCount,
    arcadeCountdown,
    lastScoreBreakdown,
    showScoreBreakdown,
    lifeLostAnimation,
    lifeGainedAnimation,
    showGameOver,
    startArcadeSession,
    endArcadeSession,
    recordArcadeResult,
    exitArcadeMode,

    // High Score Entry
    showHighScoreEntry,
    newHighScoreRank,
    highScoreInitials,
    activeInitialIndex,
    handleHighScoreEntryKeyDown,
    submitHighScore,

    // High Score Table
    showHighScoreTable,
    highlightedHighScoreRank,
    highScoreEntries,
    handleHighScoreTableKeyDown,

    // Idle high scores
    showIdleHighScores,
    resetIdleTimer,
  };
}

export type GameStore = ReturnType<typeof createGameStore>;
