import { Component, Show, For, createMemo } from "solid-js";
import type {
  AutopilotMode,
  ApproachMode,
  GamePhase,
  FailureReason,
  LandingOutcome,
  WindEffect,
} from "../lib/types";
import type { WorldId } from "../lib/worlds";
import { WORLDS } from "../lib/worlds";

interface HUDProps {
  altitude: number;
  speed: number;
  verticalSpeed: number;
  horizontalSpeed: number;
  fuel: number;
  rotation: number;
  autopilotMode: AutopilotMode;
  isLandingZone: boolean;
  landingStatus: {
    angleOk: boolean;
    speedOk: boolean;
    canLand: boolean;
  };
  alive: boolean;
  landed: boolean;
  demoAttempts: number;
  demoSuccesses: number;
  demoDamaged: number;
  demoScore: number;
  demoStreak: number;
  // Human stats
  humanAttempts: number;
  humanSuccesses: number;
  humanDamaged: number;
  humanScore: number;
  humanStreak: number;
  // New props
  gamePhase: GamePhase;
  worldName: string;
  worldGravity: number;
  canAbort: boolean;
  failureReason: FailureReason;
  outcome: LandingOutcome | null;
  worldLocked: boolean;
  onSelectWorld: (id: WorldId) => void;
  currentWorldId: WorldId;
  approachMode: ApproachMode;
  onSelectApproach: (mode: ApproachMode) => void;
  windEffect: WindEffect;
  hasAtmosphere: boolean;
  onSelectAutopilot: (mode: AutopilotMode) => void;
  regionName: string;
  landedPadDesignation: string | null;
}

// Failure reason display messages
const FAILURE_MESSAGES: Record<string, { title: string; subtitle: string }> = {
  VELOCITY_HIGH: {
    title: "IMPACT VELOCITY EXCEEDED",
    subtitle: "Touchdown speed too high",
  },
  ANGLE_BAD: {
    title: "ATTITUDE BEYOND LIMITS",
    subtitle: "Landing angle exceeded",
  },
  DAMAGED: {
    title: "SPACECRAFT DAMAGED",
    subtitle: "Landed on rough terrain",
  },
  OFF_PAD: {
    title: "MISSED LANDING ZONE",
    subtitle: "Not on designated pad",
  },
  OUT_OF_FUEL: {
    title: "PROPELLANT EXHAUSTED",
    subtitle: "No fuel remaining",
  },
};

const HUD: Component<HUDProps> = (props) => {
  const fuelPercent = createMemo(() => Math.round(props.fuel));
  const altDisplay = createMemo(() => Math.max(0, Math.round(props.altitude)));
  const vSpeedDisplay = createMemo(() => props.verticalSpeed.toFixed(1));
  const hSpeedDisplay = createMemo(() => props.horizontalSpeed.toFixed(1));
  const angleDisplay = createMemo(() =>
    Math.round(props.rotation * (180 / Math.PI)),
  );

  const fuelStatus = createMemo(() => {
    if (props.fuel > 50) return "ok";
    if (props.fuel > 20) return "warning";
    return "danger";
  });

  // Wind direction arrow
  const windArrow = createMemo(() => {
    const windX = props.windEffect.windX;
    if (Math.abs(windX) < 2) return "";
    return windX > 0 ? "→" : "←";
  });

  const windSpeed = createMemo(() =>
    Math.abs(props.windEffect.windX).toFixed(0),
  );
  const airDensity = createMemo(() =>
    (props.windEffect.density * 100).toFixed(0),
  );

  const speedStatus = createMemo(() => {
    if (props.verticalSpeed < 10) return "ok";
    if (props.verticalSpeed < 15) return "warning";
    return "danger";
  });

  const phaseDisplay = createMemo(() => {
    switch (props.gamePhase) {
      case "orbit":
        return "ORBIT - TAP THRUST TO BEGIN DESCENT";
      case "descent":
        return "DESCENT PHASE";
      case "abort":
        return "ABORT - RETURNING TO ORBIT";
      case "landed":
        return "LANDED";
      case "crashed":
        return "MISSION ENDED";
      default:
        return "";
    }
  });

  const failureMessage = createMemo(() => {
    if (props.failureReason && FAILURE_MESSAGES[props.failureReason]) {
      return FAILURE_MESSAGES[props.failureReason];
    }
    return { title: "MISSION FAILED", subtitle: "Contact with surface" };
  });

  return (
    <div class="hud">
      {/* Game phase indicator */}
      <div class={`hud-phase ${props.gamePhase}`}>{phaseDisplay()}</div>

      {/* Top telemetry bar */}
      <div class="hud-top">
        <div class="hud-title">
          {props.worldName} MODULE DESCENT GUIDANCE
          <span
            style={{ "margin-left": "15px", "font-size": "9px", opacity: 0.7 }}
          >
            G: {props.worldGravity.toFixed(2)} m/s²
          </span>
        </div>
        <div class="hud-row">
          <div class="telemetry-block">
            <div class="label">ALTITUDE</div>
            <div class="value seven-segment">{altDisplay()}</div>
            <div class="unit">M</div>
          </div>

          <div class="telemetry-block">
            <div class="label">V/SPEED</div>
            <div class={`value seven-segment ${speedStatus()}`}>
              {vSpeedDisplay()}
            </div>
            <div class="unit">M/S</div>
          </div>

          <div class="telemetry-block">
            <div class="label">H/SPEED</div>
            <div class="value seven-segment">{hSpeedDisplay()}</div>
            <div class="unit">M/S</div>
          </div>

          <div class="telemetry-block">
            <div class="label">ANGLE</div>
            <div
              class={`value seven-segment ${props.landingStatus.angleOk ? "ok" : "danger"}`}
            >
              {angleDisplay()}°
            </div>
          </div>

          <div class="telemetry-block fuel">
            <div class="label">FUEL</div>
            <div class="fuel-bar">
              <div
                class={`fuel-fill ${fuelStatus()}`}
                style={{ width: `${fuelPercent()}%` }}
              />
            </div>
            <div class={`value ${fuelStatus()}`}>{fuelPercent()}%</div>
          </div>

          {/* Wind indicator - only for atmospheric worlds */}
          <Show when={props.hasAtmosphere && props.windEffect.density > 0}>
            <div class="telemetry-block wind">
              <div class="label">WIND</div>
              <div class="value seven-segment wind-value">
                {windArrow()} {windSpeed()}
              </div>
              <div class="unit">M/S</div>
              <div class="density-indicator">
                <span class="density-label">ρ</span>
                <span class="density-value">{airDensity()}%</span>
              </div>
            </div>
          </Show>
        </div>
      </div>

      {/* World selection - only show in orbit before first burn */}
      <Show when={props.gamePhase === "orbit" && !props.worldLocked}>
        <div class="world-select">
          <div class="world-select-label">SELECT DESTINATION</div>
          <div class="world-buttons">
            <For each={Object.values(WORLDS)}>
              {(world) => (
                <button
                  class={`world-btn ${props.currentWorldId === world.id ? "active" : ""}`}
                  style={{ "--world-color": world.colors.primary }}
                  onClick={() => props.onSelectWorld(world.id)}
                >
                  {world.name}
                </button>
              )}
            </For>
          </div>
        </div>
      </Show>

      {/* World locked indicator */}
      <Show when={props.worldLocked && props.gamePhase === "descent"}>
        <div class="world-select locked">
          <div class="world-select-label">DESTINATION: {props.worldName}</div>
        </div>
      </Show>

      {/* Status indicators */}
      <div class="hud-status">
        <div class="status-row">
          <div class={`indicator ${props.isLandingZone ? "active" : ""}`}>
            <span class="dot" /> LANDING ZONE
          </div>
          <div
            class={`indicator ${props.landingStatus.speedOk ? "ok" : "warning"}`}
          >
            <span class="dot" /> VEL{" "}
            {props.landingStatus.speedOk ? "OK" : "HIGH"}
          </div>
          <div
            class={`indicator ${props.landingStatus.angleOk ? "ok" : "warning"}`}
          >
            <span class="dot" /> ATT{" "}
            {props.landingStatus.angleOk ? "OK" : "CHECK"}
          </div>
        </div>
      </div>

      {/* Abort indicator */}
      <Show when={props.canAbort && props.gamePhase === "descent"}>
        <div class="abort-indicator">[A] ABORT AVAILABLE</div>
      </Show>

      {/* Autopilot status */}
      <div class="hud-autopilot">
        <div class="autopilot-label">AUTOPILOT</div>
        <div class="autopilot-modes">
          <button
            class={`mode-btn ${props.autopilotMode === "off" ? "active" : ""}`}
            data-key="1"
            onClick={() => props.onSelectAutopilot("off")}
          >
            [1] OFF
          </button>
          <button
            class={`mode-btn ${props.autopilotMode === "stabilize" ? "active" : ""}`}
            data-key="2"
            onClick={() => props.onSelectAutopilot("stabilize")}
          >
            [2] STAB
          </button>
          <button
            class={`mode-btn ${props.autopilotMode === "land" ? "active" : ""}`}
            data-key="3"
            onClick={() => props.onSelectAutopilot("land")}
          >
            [3] LAND
          </button>
          <button
            class={`mode-btn ${props.autopilotMode === "demo" ? "active" : ""}`}
            data-key="0"
            onClick={() => props.onSelectAutopilot("demo")}
          >
            [0] DEMO
          </button>
        </div>
      </div>

      {/* Approach mode selector - only show when autopilot is land or demo */}
      <Show
        when={props.autopilotMode === "land" || props.autopilotMode === "demo"}
      >
        <div class="hud-approach">
          <div class="approach-label">APPROACH</div>
          <div class="approach-modes">
            <button
              class={`mode-btn approach-btn ${props.approachMode === "stop_drop" ? "active" : ""}`}
              onClick={() => props.onSelectApproach("stop_drop")}
            >
              [S] STOP & DROP
            </button>
            <button
              class={`mode-btn approach-btn ${props.approachMode === "boostback" ? "active" : ""}`}
              onClick={() => props.onSelectApproach("boostback")}
            >
              [B] BOOSTBACK
            </button>
          </div>
        </div>
      </Show>

      {/* Stats panel - shows demo stats in demo mode, human stats in manual mode */}
      <Show when={props.autopilotMode === "demo"}>
        <div class="hud-stats-panel">
          <div class="stats-label">DEMO STATS</div>
          <div class="stats-row score">
            <span class="stat-value">{props.demoScore}</span>
            <span class="stat-label">SCORE</span>
          </div>
          <div class="stats-row streak">
            <span class="stat-value">
              {props.demoStreak > 0 ? `${props.demoStreak}x` : "-"}
            </span>
            <span class="stat-label">STREAK</span>
          </div>
          <div class="stats-row">
            <span class="stat-value">{props.demoSuccesses}</span>
            <span class="stat-label">LANDED</span>
          </div>
          <div class="stats-row damaged">
            <span class="stat-value">{props.demoDamaged}</span>
            <span class="stat-label">DAMAGED</span>
          </div>
          <div class="stats-row">
            <span class="stat-value">
              {props.demoAttempts - props.demoSuccesses - props.demoDamaged}
            </span>
            <span class="stat-label">CRASHED</span>
          </div>
          <div class="stats-row success-rate">
            <span class="stat-value">
              {props.demoAttempts > 0
                ? Math.round((props.demoSuccesses / props.demoAttempts) * 100)
                : 0}
              %
            </span>
            <span class="stat-label">SUCCESS</span>
          </div>
        </div>
      </Show>

      <Show when={props.autopilotMode === "off"}>
        <div class="hud-stats-panel">
          <div class="stats-label">HUMAN STATS</div>
          <div class="stats-row score">
            <span class="stat-value">{props.humanScore}</span>
            <span class="stat-label">SCORE</span>
          </div>
          <div class="stats-row streak">
            <span class="stat-value">
              {props.humanStreak > 0 ? `${props.humanStreak}x` : "-"}
            </span>
            <span class="stat-label">STREAK</span>
          </div>
          <div class="stats-row">
            <span class="stat-value">{props.humanSuccesses}</span>
            <span class="stat-label">LANDED</span>
          </div>
          <div class="stats-row damaged">
            <span class="stat-value">{props.humanDamaged}</span>
            <span class="stat-label">DAMAGED</span>
          </div>
          <div class="stats-row">
            <span class="stat-value">
              {props.humanAttempts - props.humanSuccesses - props.humanDamaged}
            </span>
            <span class="stat-label">CRASHED</span>
          </div>
          <div class="stats-row success-rate">
            <span class="stat-value">
              {props.humanAttempts > 0
                ? Math.round((props.humanSuccesses / props.humanAttempts) * 100)
                : 0}
              %
            </span>
            <span class="stat-label">SUCCESS</span>
          </div>
        </div>
      </Show>

      {/* Crash message with failure reason */}
      <Show when={!props.alive && props.outcome === "crashed"}>
        <div class="message crash">
          <div class="message-title">CONTACT LIGHT</div>
          <div class="message-subtitle">{failureMessage().title}</div>
          <div class="failure-reason">{failureMessage().subtitle}</div>
          <div class="message-hint">Press [R] to restart</div>
        </div>
      </Show>

      {/* Damaged landing message */}
      <Show when={props.landed && props.outcome === "damaged"}>
        <div class="message crash">
          <div class="message-title">TOUCHDOWN</div>
          <div class="message-subtitle">SPACECRAFT DAMAGED</div>
          <div class="failure-reason">Landed on rough terrain - not on pad</div>
          <div class="message-hint">Press [R] to restart</div>
        </div>
      </Show>

      {/* Success message */}
      <Show when={props.landed && props.outcome === "success"}>
        <div class="message success">
          <div class="message-title">THE DROPSHIP HAS LANDED</div>
          <div class="message-subtitle">
            {props.regionName} - PAD {props.landedPadDesignation}
          </div>
          <div class="message-hint">Press [R] for new mission</div>
        </div>
      </Show>

      {/* Controls help */}
      <div class="hud-controls">
        <span>[↑/W/SPACE] Thrust</span>
        <span>[←] [→] Rotate</span>
        <span>[A] Abort</span>
        <span>[P] Pause</span>
        <span>[R] Reset</span>
        <span>[C] Arc</span>
        <Show when={props.autopilotMode === "off"}>
          <span>[ ] Cycle Pad</span>
          <span>[X] Lock Target</span>
        </Show>
        <span>[L] Log</span>
      </div>
    </div>
  );
};

export default HUD;
