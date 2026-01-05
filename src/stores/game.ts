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
} from "../lib/types";
import { generateTerrain, generateStars } from "../lib/terrain";
import { getAltitude, getSpeed } from "../lib/physics";
import {
  evaluateAllPads,
  selectTargetPad,
  selectTargetPadWithCone,
  createGNCState,
  type GNCState,
  type LandingConeResult,
} from "../lib/autopilot";
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
import { getWindEffectAt } from "../lib/atmosphere";
import {
  FlightLogger,
  saveFlightRecord,
  exportFlightRecords,
  getFlightStats,
  clearFlightRecords,
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

  // Finalize and save flight log
  function finalizeFlightLog(
    outcome: LandingOutcome | null,
    failureReason: FailureReason,
    landedPadIndex: number | null,
  ) {
    if (flightLogger) {
      const record = flightLogger.finalize(
        lander(),
        altitude(),
        outcome,
        failureReason,
        landedPadIndex,
      );
      saveFlightRecord(record);
      flightLogger = null;
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

  // Initiate abort - return to orbit
  function initiateAbort() {
    if (!canAbort()) {
      return;
    }
    setGamePhase("abort");
    recordAbortInLog();
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
      // Increment streak and calculate score
      const newStreak = demoStreak() + 1;
      setDemoStreak(newStreak);
      const points = 100 * newStreak;
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
  };
}

export type GameStore = ReturnType<typeof createGameStore>;
