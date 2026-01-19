import {
  Component,
  onMount,
  onCleanup,
  createEffect,
  createSignal,
  For,
  Show,
} from "solid-js";
import { createGameStore } from "../stores/game";
import { updatePhysics, checkTerrainCollision } from "../lib/physics";
import {
  computeAutopilot,
  computeStabilizeOnly,
  selectTargetPad,
  computeGNCAutopilot,
} from "../lib/autopilot";
import { WORLDS } from "../lib/worldRegistry";
import Lander from "./Lander";
import Terrain from "./Terrain";
import HUD from "./HUD";
import CRTOverlay from "./CRTOverlay";
import TrajectoryOverlay from "./TrajectoryOverlay";
import CrashDebris from "./CrashDebris";
import PadTelemetry from "./PadTelemetry";
import AtmosphericEffects from "./AtmosphericEffects";
import WindBands from "./WindBands";
import WindParticles from "./WindParticles";
import ScoreBreakdown from "./ScoreBreakdown";
import HighScoreEntry from "./HighScoreEntry";
import HighScoreTable from "./HighScoreTable";
import GameOver from "./GameOver";
import EarthSky from "./EarthSky";

const PHYSICS_TIMESTEP = 1 / 60; // 60 Hz physics

const Game: Component = () => {
  const store = createGameStore();
  let animationFrameId: number;
  let lastTime = 0;
  let accumulator = 0;

  // Track which pad was crashed into (for rocket explosion)
  const [crashedPadIndex, setCrashedPadIndex] = createSignal<number | null>(
    null,
  );

  // Reset crashedPadIndex when game resets (lander becomes alive again)
  createEffect(() => {
    if (store.lander().alive) {
      setCrashedPadIndex(null);
    }
  });

  // Apply world theme colors to CSS
  createEffect(() => {
    const world = store.world();
    const container = document.querySelector(".game-container") as HTMLElement;
    if (container) {
      container.style.setProperty("--world-primary", world.colors.primary);
      container.style.setProperty("--world-secondary", world.colors.secondary);
      container.style.setProperty("--world-terrain", world.colors.terrain);
      container.style.setProperty(
        "--world-terrain-stroke",
        world.colors.terrainStroke,
      );
      container.style.setProperty("--world-sky", world.colors.sky);
      container.style.setProperty("--world-pad-viable", world.colors.padViable);
      container.style.setProperty(
        "--world-pad-unviable",
        world.colors.padUnviable,
      );
      // Earth-specific water colors
      if (world.colors.water) {
        container.style.setProperty("--world-water", world.colors.water);
      }
      if (world.colors.waterStroke) {
        container.style.setProperty(
          "--world-water-stroke",
          world.colors.waterStroke,
        );
      }
      // Note: --vector-primary and --vector-secondary stay as fixed green
      // for consistent UI elements (dialogs, HUD). World-specific theming
      // uses --world-primary and --world-secondary instead.
    }
  });

  // Game loop
  const gameLoop = (timestamp: number) => {
    if (lastTime === 0) lastTime = timestamp;
    const deltaTime = Math.min((timestamp - lastTime) / 1000, 0.1); // Cap at 100ms
    lastTime = timestamp;

    if (!store.paused() && !store.gameOver()) {
      accumulator += deltaTime;

      // Fixed timestep physics updates
      while (accumulator >= PHYSICS_TIMESTEP) {
        updateGame(PHYSICS_TIMESTEP);
        accumulator -= PHYSICS_TIMESTEP;
        store.setGameTime((t) => t + PHYSICS_TIMESTEP);
      }

      // Update pad viabilities after physics
      store.updateViabilities();

      // Update trajectory prediction (every few frames for performance)
      if (Math.floor(store.gameTime() * 10) % 2 === 0) {
        store.updateTrajectoryPrediction();
      }
    }

    animationFrameId = requestAnimationFrame(gameLoop);
  };

  const updateGame = (dt: number) => {
    const lander = store.lander();
    const input = store.input();
    const autopilot = store.autopilotMode();
    const phase = store.gamePhase();
    const config = store.config();
    const world = store.world();

    if (!lander.alive || lander.landed) return;

    let thrustInput = 0;
    let rotationInput = 0;

    // Check if controls are locked (e.g., during GNC abort)
    const controlsLocked = store.controlsLocked();

    // Handle autopilot modes (including abort phases which are handled by GNC)
    if (autopilot !== "off" || controlsLocked) {
      // Get the target pad from store (already selected/randomized in updateViabilities)
      const pads = store.landingPads();
      const selectedIdx = store.selectedPadIndex();
      const targetPadInfo = {
        pad: pads[selectedIdx] || pads[0],
        index: selectedIdx,
        viable: true,
      };

      if (autopilot === "stabilize" && !controlsLocked) {
        // Stabilize mode - just attitude control, manual thrust
        // (abort overrides stabilize mode)
        const command = computeStabilizeOnly(lander);
        thrustInput = input.thrust ? 1 : 0;
        rotationInput = command.rotation;
      } else {
        // Land/Demo mode or abort - use GNC autopilot with computed burns
        let gncState = store.gncState();

        // Update target pad in GNC state if not locked
        // IMPORTANT: We must create a new state object to persist the change
        if (
          !gncState.targetPadLocked &&
          gncState.targetPadIndex !== targetPadInfo.index
        ) {
          gncState = { ...gncState, targetPadIndex: targetPadInfo.index };
        }

        // Debug: Check config before GNC call
        if (gncState.phase.startsWith("abort") || gncState.phase === "abort_assess") {
          console.log("[Game] Config passed to GNC:", {
            orbitalAltitude: config.orbitalAltitude,
            worldId: config.worldId,
          });
        }

        const { command, newState } = computeGNCAutopilot(
          lander,
          store.terrain(),
          pads,
          config,
          gncState,
          store.gameTime(),
          world.autopilotGains,
          store.approachMode(),
        );

        // Update GNC state
        store.setGNCState(newState);

        // Check if orbit stabilized during reorient - disable gravity so lander floats while rotating
        if (newState.orbitStabilized && lander.hasBurned) {
          console.log("[Game] Orbit stabilized - disabling gravity for reorient at current altitude", {
            position: { x: lander.position.x, y: lander.position.y },
            altitude: store.altitude(),
          });
          store.setLander({
            ...lander,
            // Keep current position - we're already at proper altitude (checked at abort initiation)
            hasBurned: false, // Re-enable gravity gating (no gravity in orbit)
            velocity: { x: config.orbitalVelocity, y: 0 }, // Lock to orbital velocity, no vertical
            thrust: 0, // Ensure no thrust
          });
          // Skip physics this frame - we just locked the orbital state
          return;
        }

        // Check if abort_to_orbit completed (returned to orbit_wait)
        // The GNC state machine resets to orbit_wait when orbit is achieved
        if (
          gncState.phase.startsWith("abort_") &&
          newState.phase === "orbit_wait"
        ) {
          console.log("[Game] Abort to orbit completed! Calling completeAbort()", {
            oldPhase: gncState.phase,
            newPhase: newState.phase,
          });
          // Abort complete - reset game state to orbit
          // IMPORTANT: Return early to prevent updatePhysics from overwriting
          // the reset lander state with physics from the old (falling) state
          store.completeAbort();
          return;
        }

        thrustInput = command.thrust;
        rotationInput = command.rotation;
      }
    } else {
      // Manual control
      thrustInput = input.thrust ? 1 : 0;
      rotationInput = (input.rotateLeft ? -1 : 0) + (input.rotateRight ? 1 : 0);
    }

    // Update physics (with atmosphere if world has one)
    const newLander = updatePhysics(
      lander,
      config,
      thrustInput,
      rotationInput,
      dt,
      world.atmosphere,
      store.gameTime(),
      store.altitude(),
    );

    // Transition from orbit to descent on first burn
    if (phase === "orbit" && newLander.hasBurned && !lander.hasBurned) {
      store.startDescent();
      // Initialize flight logger when descent begins
      store.initFlightLogger();
    }

    // Update flight logger every frame
    store.updateFlightLogger();

    // Check collisions
    const collision = checkTerrainCollision(
      newLander,
      store.terrain(),
      store.landingPads(),
      config,
    );

    if (collision.collision) {
      const isDemo = store.autopilotMode() === "demo";

      if (collision.outcome === "success") {
        // Successful landing!
        store.setLander({
          ...newLander,
          landed: true,
          alive: true,
          velocity: { x: 0, y: 0 },
          angularVelocity: 0,
          thrust: 0,
          outcome: "success",
          failureReason: null,
          position: {
            x: newLander.position.x,
            y: collision.terrainY - 15, // Snap to ground
          },
        });
        store.setGamePhase("landed");
        store.setLandedPadIndex(collision.landedPadIndex);

        // Record abort outcome if we were in an abort sequence
        store.recordAbortOutcome("landed_success");

        // Finalize flight log and get backend score
        store
          .finalizeFlightLog("success", null, collision.landedPadIndex)
          .then((backendScore) => {
            if (isDemo) {
              store.recordDemoResult(true, null, backendScore);
              setTimeout(() => store.reset(true), 2000);
            } else if (store.isArcadeMode()) {
              // Arcade mode - record result with backend score
              const landedPad = store.landingPads()[collision.landedPadIndex!];
              store.recordArcadeResult(
                "success",
                landedPad,
                newLander,
                null,
                backendScore,
              );
            } else if (store.autopilotMode() === "off") {
              // Manual mode - record human result
              store.recordHumanResult(true, null);
            }
          });
      } else if (collision.outcome === "damaged") {
        // Damaged landing - survived but not on pad
        store.setLander({
          ...newLander,
          landed: true,
          alive: true,
          velocity: { x: 0, y: 0 },
          angularVelocity: 0,
          thrust: 0,
          outcome: "damaged",
          failureReason: collision.failureReason,
          position: {
            x: newLander.position.x,
            y: collision.terrainY - 15,
          },
        });
        store.setGamePhase("landed");

        // Record abort outcome if we were in an abort sequence
        store.recordAbortOutcome("landed_damaged");

        // Finalize flight log (no score needed for damaged)
        store
          .finalizeFlightLog("damaged", collision.failureReason, null)
          .then(() => {
            if (isDemo) {
              store.recordDemoResult(false, collision.failureReason);
              setTimeout(() => store.reset(true), 2000);
            } else if (store.isArcadeMode()) {
              // Arcade mode - damaged = no life lost, no score
              store.recordArcadeResult("damaged", null, newLander);
            } else if (store.autopilotMode() === "off") {
              // Manual mode - record human result
              store.recordHumanResult(false, collision.failureReason);
            }
          });
      } else {
        // Crash!
        store.setLander({
          ...newLander,
          alive: false,
          thrust: 0,
          outcome: "crashed",
          failureReason: collision.failureReason,
        });
        store.setGamePhase("crashed");
        // Track if we crashed into an occupied pad (for rocket explosion)
        setCrashedPadIndex(collision.crashedPadIndex);

        // Record abort outcome if we were in an abort sequence
        store.recordAbortOutcome("crashed");

        // Finalize flight log (no score needed for crashed)
        store
          .finalizeFlightLog("crashed", collision.failureReason, null)
          .then(() => {
            if (isDemo) {
              store.recordDemoResult(false, collision.failureReason);
              setTimeout(() => store.reset(true), 2000);
            } else if (store.isArcadeMode()) {
              // Arcade mode - crash = lose a life
              store.recordArcadeResult("crashed", null, newLander);
            } else if (store.autopilotMode() === "off") {
              // Manual mode - record human result
              store.recordHumanResult(false, collision.failureReason);
            }
          });
      }
      store.setGameOver(true);
    } else {
      store.setLander(newLander);
    }
  };

  // Keyboard handlers
  const handleKeyDown = (e: KeyboardEvent) => {
    const phase = store.gamePhase();

    // Route to high score entry handler
    if (phase === "high_score_entry") {
      e.preventDefault();
      store.handleHighScoreEntryKeyDown(e.key);
      return;
    }

    // Route to high score table handler
    if (phase === "high_score_table") {
      e.preventDefault();
      store.handleHighScoreTableKeyDown(e.key);
      return;
    }

    // Handle arcade mode start key
    if (e.key === "9" && !store.isArcadeMode() && phase === "orbit") {
      e.preventDefault();
      store.startArcadeSession();
      return;
    }

    // Prevent default for game keys
    if (
      [
        " ",
        "ArrowUp",
        "ArrowLeft",
        "ArrowRight",
        "w",
        "a",
        "d",
        "Escape",
      ].includes(e.key)
    ) {
      e.preventDefault();
    }
    store.handleKeyDown(e.key);
  };

  const handleKeyUp = (e: KeyboardEvent) => {
    store.handleKeyUp(e.key);
  };

  onMount(() => {
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    animationFrameId = requestAnimationFrame(gameLoop);
    // Start idle timer for high score display
    store.resetIdleTimer();
  });

  onCleanup(() => {
    window.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("keyup", handleKeyUp);
    cancelAnimationFrame(animationFrameId);
  });

  // Dynamic viewBox based on zoom level
  const viewBox = () => {
    const vb = store.viewBox();
    return `${vb.x} ${vb.y} ${vb.width} ${vb.height}`;
  };

  return (
    <div class="game-container">
      <svg
        class="game-svg"
        viewBox={viewBox()}
        preserveAspectRatio="xMidYMid meet"
      >
        {/* SVG Filters for glow effect */}
        <defs>
          <filter id="glow" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur stdDeviation="2" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter
            id="glow-highlight"
            x="-50%"
            y="-50%"
            width="200%"
            height="200%"
          >
            <feGaussianBlur stdDeviation="3" result="blur" />
            <feComposite in="SourceGraphic" in2="blur" operator="over" />
          </filter>
          <filter
            id="glow-strong"
            x="-100%"
            y="-100%"
            width="300%"
            height="300%"
          >
            <feGaussianBlur stdDeviation="4" result="blur" />
            <feMerge>
              <feMergeNode in="blur" />
              <feMergeNode in="blur" />
              <feMergeNode in="SourceGraphic" />
            </feMerge>
          </filter>

          {/* Clip path for wind elements - everything above terrain */}
          <clipPath id="above-terrain-clip">
            <rect
              x="0"
              y="0"
              width={store.config().width}
              height={Math.max(...store.terrain().map((p) => p.y)) - 10}
            />
          </clipPath>

          {/* Hatch patterns for deorbit timing bar */}
          <pattern
            id="deorbit-hatch-green"
            patternUnits="userSpaceOnUse"
            width="4"
            height="4"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="4"
              stroke="rgba(0, 255, 100, 0.6)"
              stroke-width="2"
            />
          </pattern>
          <pattern
            id="deorbit-hatch-yellow"
            patternUnits="userSpaceOnUse"
            width="4"
            height="4"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="4"
              stroke="rgba(255, 200, 0, 0.6)"
              stroke-width="2"
            />
          </pattern>
          <pattern
            id="deorbit-hatch-red"
            patternUnits="userSpaceOnUse"
            width="4"
            height="4"
            patternTransform="rotate(45)"
          >
            <line
              x1="0"
              y1="0"
              x2="0"
              y2="4"
              stroke="rgba(255, 50, 50, 0.6)"
              stroke-width="2"
            />
          </pattern>
        </defs>

        {/* Earth Sky - dawn gradient with sun */}
        {store.worldId() === "earth" && (
          <EarthSky
            width={store.config().width}
            height={store.config().height}
            stars={store.stars()}
          />
        )}

        {/* Stars (for non-Earth worlds) */}
        {store.worldId() !== "earth" && (
          <g class="stars">
            <For each={store.stars()}>
              {(star) => (
                <circle
                  cx={star.x}
                  cy={star.y}
                  r={star.size}
                  fill={`rgba(200, 255, 200, ${star.brightness * 0.7})`}
                />
              )}
            </For>
          </g>
        )}

        {/* Atmosphere gradient overlay (Mars has dusty atmosphere) */}
        {store.world().colors.atmosphere && (
          <>
            <defs>
              <linearGradient
                id="atmosphere-gradient"
                x1="0%"
                y1="0%"
                x2="0%"
                y2="100%"
              >
                <stop
                  offset="0%"
                  stop-color={store.world().colors.atmosphere}
                  stop-opacity="0"
                />
                <stop
                  offset="40%"
                  stop-color={store.world().colors.atmosphere}
                  stop-opacity="0.15"
                />
                <stop
                  offset="70%"
                  stop-color={store.world().colors.atmosphere}
                  stop-opacity="0.35"
                />
                <stop
                  offset="100%"
                  stop-color={store.world().colors.atmosphere}
                  stop-opacity="0.6"
                />
              </linearGradient>
            </defs>
            <rect
              x="0"
              y="0"
              width={store.config().width}
              height={store.config().height}
              fill="url(#atmosphere-gradient)"
            />
          </>
        )}

        {/* Wind particles - render BEFORE terrain so they appear behind, clipped to above terrain */}
        {store.world().atmosphere && (
          <g clip-path="url(#above-terrain-clip)">
            <WindParticles
              atmosphere={store.world().atmosphere}
              worldWidth={store.config().width}
              terrainMaxY={Math.max(...store.terrain().map((p) => p.y))}
              gameTime={store.gameTime()}
              primaryColor={store.world().colors.primary}
              orbitalVelocity={store.world().orbitalVelocity}
            />
          </g>
        )}

        {/* Wind bands overlay for atmospheric worlds */}
        {store.world().atmosphere && (
          <WindBands
            atmosphere={store.world().atmosphere}
            worldHeight={store.config().height}
            worldWidth={store.config().width}
            terrainMaxY={Math.max(...store.terrain().map((p) => p.y))}
            gameTime={store.gameTime()}
            primaryColor={store.world().colors.primary}
          />
        )}

        {/* Terrain */}
        <Terrain
          terrain={store.terrain()}
          landingPads={store.landingPads()}
          padViabilities={store.padViabilities()}
          selectedPadIndex={store.selectedPadIndex()}
          lockedPadIndex={
            store.gncState().targetPadLocked
              ? store.gncState().targetPadIndex
              : null
          }
          lockedPadViable={store.gncState().lockedPadViable}
          highlightedPadIndex={
            // Only show highlighted pad in manual mode when not locked
            store.autopilotMode() === "off" && !store.gncState().targetPadLocked
              ? (store.landingCone()[store.highlightedConeIndex()] ?? null)
              : null
          }
          landingCone={store.landingCone()}
          width={store.config().width}
          height={store.config().height}
          destroyedPadIndex={crashedPadIndex()}
          time={store.gameTime()}
          worldId={store.worldId()}
        />

        {/* Trajectory Prediction Overlay */}
        <TrajectoryOverlay
          prediction={store.trajectoryPrediction()}
          targetPad={store.targetPad()}
          landingPads={store.landingPads()}
          lockedDeorbitX={store.gncState().lockedDeorbitX}
          deorbitTimingDelta={store.gncState().deorbitTimingDelta}
          showTrajectory={store.showTrajectory()}
          phase={store.gamePhase()}
          worldWidth={store.config().width}
          currentGs={store.lander().currentGs}
          maxGs={store.lander().maxGs}
          landerX={store.lander().position.x}
          landerY={store.lander().position.y}
          landerVelocityX={store.lander().velocity.x}
          zoomScale={store.currentZoom().scale}
          gameTime={store.gameTime()}
        />

        {/* In-SVG telemetry below locked pad (visible when zoomed in) */}
        <PadTelemetry
          pad={
            store.gncState().targetPadLocked
              ? store.landingPads()[store.gncState().targetPadIndex]
              : null
          }
          altitude={store.altitude()}
          verticalSpeed={store.verticalSpeed()}
          horizontalSpeed={store.horizontalSpeed()}
          fuel={store.lander().fuel}
          angleOk={store.landingStatus().angleOk}
          speedOk={store.landingStatus().speedOk}
          zoomLevel={store.currentZoom()}
          visible={
            store.lander().alive &&
            !store.lander().landed &&
            store.gamePhase() === "descent"
          }
        />

        {/* Atmospheric effects (heat shield, dust) */}
        <AtmosphericEffects
          landerX={store.lander().position.x}
          landerY={store.lander().position.y}
          velocityX={store.lander().velocity.x}
          velocityY={store.lander().velocity.y}
          rotation={store.lander().rotation}
          thrust={store.lander().thrust}
          altitude={store.altitude()}
          landed={store.lander().landed}
          alive={store.lander().alive}
          hasAtmosphere={!!store.world().colors.atmosphere}
          atmosphereColor={store.world().colors.atmosphere}
          dustColor={store.world().colors.dust}
          heatingAltitude={600}
          heatingVelocity={80}
        />

        {/* Lander - hide when crashed (debris takes over) */}
        {store.lander().outcome !== "crashed" && (
          <Lander
            lander={store.lander()}
            zoomLevel={store.currentZoom()}
            worldId={store.worldId()}
            altitude={store.altitude()}
          />
        )}

        {/* Crash debris animation */}
        <CrashDebris
          crashPosition={store.lander().position}
          crashVelocity={store.lander().velocity}
          crashRotation={store.lander().rotation}
          gravity={store.config().gravity}
          active={store.lander().outcome === "crashed"}
          crashedPad={
            crashedPadIndex() !== null
              ? store.landingPads()[crashedPadIndex()!]
              : undefined
          }
          worldId={store.worldId()}
        />
      </svg>

      {/* HUD Overlay */}
      <HUD
        altitude={store.altitude()}
        speed={store.speed()}
        verticalSpeed={store.verticalSpeed()}
        horizontalSpeed={store.horizontalSpeed()}
        fuel={store.lander().fuel}
        rotation={store.lander().rotation}
        autopilotMode={store.autopilotMode()}
        isLandingZone={store.isLandingZone()}
        landingStatus={store.landingStatus()}
        alive={store.lander().alive}
        landed={store.lander().landed}
        demoAttempts={store.demoAttempts()}
        demoSuccesses={store.demoSuccesses()}
        demoDamaged={store.demoDamaged()}
        demoScore={store.demoScore()}
        demoStreak={store.demoStreak()}
        humanAttempts={store.humanAttempts()}
        humanSuccesses={store.humanSuccesses()}
        humanDamaged={store.humanDamaged()}
        humanScore={store.humanScore()}
        humanStreak={store.humanStreak()}
        gamePhase={store.gamePhase()}
        worldName={store.world().name}
        worldGravity={store.world().realGravity}
        canAbort={store.canAbort()}
        failureReason={store.lander().failureReason}
        outcome={store.lander().outcome}
        worldLocked={store.worldLocked()}
        onSelectWorld={store.selectWorld}
        currentWorldId={store.worldId()}
        approachMode={store.approachMode()}
        onSelectApproach={store.setApproachMode}
        windEffect={store.currentWindEffect()}
        hasAtmosphere={!!store.world().atmosphere}
        onSelectAutopilot={store.setAutopilotMode}
        regionName={store.regionName()}
        landedPadDesignation={store.landedPadDesignation()}
        isArcadeMode={store.isArcadeMode()}
        arcadeLives={store.arcadeLives()}
        arcadeTotalScore={store.arcadeTotalScore()}
        arcadeStreak={store.arcadeStreak()}
        lifeLostAnimation={store.lifeLostAnimation()}
        lifeGainedAnimation={store.lifeGainedAnimation()}
        arcadeCountdown={store.arcadeCountdown()}
        onStartArcade={store.startArcadeSession}
      />

      {/* Score Breakdown Overlay (arcade mode) */}
      <ScoreBreakdown
        breakdown={store.lastScoreBreakdown()}
        visible={store.showScoreBreakdown()}
        totalScore={store.arcadeTotalScore()}
        streak={store.arcadeStreak()}
      />

      {/* Game Over Screen */}
      <GameOver
        visible={store.showGameOver()}
        score={store.arcadeTotalScore()}
        landings={store.arcadeLandingCount()}
      />

      {/* High Score Entry Screen */}
      <HighScoreEntry
        visible={store.showHighScoreEntry()}
        rank={store.newHighScoreRank()}
        score={store.arcadeTotalScore()}
        initials={store.highScoreInitials()}
        activeIndex={store.activeInitialIndex()}
        onKeyDown={store.handleHighScoreEntryKeyDown}
      />

      {/* High Score Table */}
      <HighScoreTable
        visible={store.showHighScoreTable()}
        entries={store.highScoreEntries()}
        highlightedRank={store.highlightedHighScoreRank()}
        finalScore={store.arcadeTotalScore()}
        landings={store.arcadeLandingCount()}
        isGameOver={store.isArcadeMode()}
        onKeyDown={store.handleHighScoreTableKeyDown}
      />

      {/* Idle High Scores - shown after 3 minutes of inactivity */}
      <HighScoreTable
        visible={store.showIdleHighScores()}
        entries={store.highScoreEntries()}
        highlightedRank={null}
        isGameOver={false}
        isOverlay={true}
        onKeyDown={() => {}}
      />

      {/* CRT Effect Overlay */}
      <CRTOverlay />
    </div>
  );
};

export default Game;
