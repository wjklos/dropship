import { Component, Show, createMemo, createSignal, onMount } from "solid-js";
import type { ScoreBreakdown as ScoreBreakdownType } from "../lib/types";

interface ScoreBreakdownProps {
  breakdown: ScoreBreakdownType | null;
  visible: boolean;
  totalScore: number;
  streak: number;
}

const ScoreBreakdown: Component<ScoreBreakdownProps> = (props) => {
  const [animatedTotal, setAnimatedTotal] = createSignal(0);
  const [showTotal, setShowTotal] = createSignal(false);

  // Animate total score when breakdown becomes visible
  createMemo(() => {
    if (props.visible && props.breakdown) {
      setAnimatedTotal(0);
      setShowTotal(false);

      // Delay before showing total
      setTimeout(() => {
        setShowTotal(true);
        // Animate the total counting up
        const target = props.breakdown!.totalScore;
        const duration = 500;
        const start = performance.now();

        const animate = (now: number) => {
          const elapsed = now - start;
          const progress = Math.min(elapsed / duration, 1);
          // Ease out
          const eased = 1 - Math.pow(1 - progress, 3);
          setAnimatedTotal(Math.round(target * eased));

          if (progress < 1) {
            requestAnimationFrame(animate);
          }
        };
        requestAnimationFrame(animate);
      }, 800);
    }
  });

  const formatMultiplier = (value: number) => {
    if (value === 1) return "1.0x";
    return `${value.toFixed(1)}x`;
  };

  return (
    <Show when={props.visible && props.breakdown}>
      <div class="score-breakdown-overlay">
        <div class="score-breakdown">
          <div class="breakdown-header">LANDING SCORE</div>

          <div class="breakdown-rows">
            <div class="breakdown-row">
              <span class="breakdown-label">PAD DIFFICULTY</span>
              <span class="breakdown-value multiplier">
                {props.breakdown!.padMultiplier}x
              </span>
            </div>

            <div class="breakdown-row">
              <span class="breakdown-label">FUEL BONUS</span>
              <span class="breakdown-value multiplier">
                {formatMultiplier(props.breakdown!.fuelMultiplier)}
              </span>
            </div>

            <div class="breakdown-row">
              <span class="breakdown-label">PRECISION</span>
              <span class="breakdown-value multiplier">
                {formatMultiplier(props.breakdown!.precisionMultiplier)}
              </span>
            </div>

            <div class="breakdown-row">
              <span class="breakdown-label">SOFT LANDING</span>
              <span class="breakdown-value multiplier">
                {formatMultiplier(props.breakdown!.speedMultiplier)}
              </span>
            </div>

            <Show when={props.breakdown!.streakBonus > 0}>
              <div class="breakdown-row streak">
                <span class="breakdown-label">
                  STREAK #{props.streak}
                </span>
                <span class="breakdown-value bonus">
                  +{props.breakdown!.streakBonus.toLocaleString()}
                </span>
              </div>
            </Show>

            <Show when={props.breakdown!.worldMultiplier > 1}>
              <div class="breakdown-row world">
                <span class="breakdown-label">MARS BONUS</span>
                <span class="breakdown-value multiplier mars">
                  {formatMultiplier(props.breakdown!.worldMultiplier)}
                </span>
              </div>
            </Show>
          </div>

          <Show when={showTotal()}>
            <div class="breakdown-total">
              <span class="total-label">SCORE</span>
              <span class="total-value">
                +{animatedTotal().toLocaleString()}
              </span>
            </div>
          </Show>

          <div class="breakdown-running-total">
            <span class="running-label">TOTAL</span>
            <span class="running-value">
              {props.totalScore.toLocaleString()}
            </span>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default ScoreBreakdown;
