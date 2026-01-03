import { Component, onMount, onCleanup, createEffect, For } from "solid-js";
import { createGameStore } from "../stores/game";
import { updatePhysics, checkTerrainCollision } from "../lib/physics";
import {
  computeAutopilot,
  computeStabilizeOnly,
  selectTargetPad,
  computeAbortManeuver,
} from "../lib/autopilot";
import { WORLDS } from "../lib/worlds";
import Lander from "./Lander";
import Terrain from "./Terrain";
import HUD from "./HUD";
import CRTOverlay from "./CRTOverlay";

const PHYSICS_TIMESTEP = 1 / 60; // 60 Hz physics

const Game: Component = () => {
  const store = createGameStore();
  let animationFrameId: number;
  let lastTime = 0;
  let accumulator = 0;

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
      container.style.setProperty("--vector-primary", world.colors.primary);
      container.style.setProperty("--vector-secondary", world.colors.secondary);
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

    // Handle abort phase - autopilot takes over for return to orbit
    if (phase === "abort") {
      const command = computeAbortManeuver(
        lander,
        config,
        world.orbitalAltitude,
      );
      thrustInput = command.thrust;
      rotationInput = command.rotation;

      // Check if abort complete (back at orbital altitude with low descent rate)
      if (
        store.altitude() > world.orbitalAltitude - 100 &&
        lander.velocity.y < 5 &&
        lander.velocity.y > -5
      ) {
        store.completeAbort();
      }
    }
    // Handle autopilot modes
    else if (autopilot !== "off") {
      // Get the target pad for autopilot
      const pads = store.landingPads();
      const viabilities = store.padViabilities();
      const targetPad =
        viabilities.length > 0
          ? selectTargetPad(viabilities, pads)
          : { pad: pads[0], index: 0, viable: true };

      const command =
        autopilot === "stabilize"
          ? computeStabilizeOnly(lander)
          : computeAutopilot(
              lander,
              store.terrain(),
              targetPad.pad,
              config,
              autopilot as "stabilize" | "land" | "demo",
              phase,
              world.autopilotGains,
            );

      // For stabilize mode, allow manual thrust override
      if (autopilot === "stabilize") {
        thrustInput = input.thrust ? 1 : 0;
        rotationInput = command.rotation;
      } else {
        thrustInput = command.thrust;
        rotationInput = command.rotation;
      }
    } else {
      // Manual control
      thrustInput = input.thrust ? 1 : 0;
      rotationInput = (input.rotateLeft ? -1 : 0) + (input.rotateRight ? 1 : 0);
    }

    // Update physics
    const newLander = updatePhysics(
      lander,
      config,
      thrustInput,
      rotationInput,
      dt,
    );

    // Transition from orbit to descent on first burn
    if (phase === "orbit" && newLander.hasBurned && !lander.hasBurned) {
      store.startDescent();
    }

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

        if (isDemo) {
          store.recordDemoResult(true, null);
          setTimeout(() => store.reset(true), 2000);
        }
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

        if (isDemo) {
          store.recordDemoResult(false, collision.failureReason);
          setTimeout(() => store.reset(true), 2000);
        }
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

        if (isDemo) {
          store.recordDemoResult(false, collision.failureReason);
          setTimeout(() => store.reset(true), 2000);
        }
      }
      store.setGameOver(true);
    } else {
      store.setLander(newLander);
    }
  };

  // Keyboard handlers
  const handleKeyDown = (e: KeyboardEvent) => {
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
        </defs>

        {/* Stars */}
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

        {/* Terrain */}
        <Terrain
          terrain={store.terrain()}
          landingPads={store.landingPads()}
          padViabilities={store.padViabilities()}
          selectedPadIndex={store.selectedPadIndex()}
          width={store.config().width}
          height={store.config().height}
        />

        {/* Lander */}
        <Lander lander={store.lander()} />
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
        gamePhase={store.gamePhase()}
        worldName={store.world().name}
        worldGravity={store.world().realGravity}
        canAbort={store.canAbort()}
        failureReason={store.lander().failureReason}
        outcome={store.lander().outcome}
        worldLocked={store.worldLocked()}
        onSelectWorld={store.selectWorld}
        currentWorldId={store.worldId()}
      />

      {/* CRT Effect Overlay */}
      <CRTOverlay />
    </div>
  );
};

export default Game;
