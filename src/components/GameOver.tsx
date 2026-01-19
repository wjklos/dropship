import { Component, Show, createMemo } from "solid-js";

interface GameOverProps {
  visible: boolean;
  score: number;
  landings: number;
}

const GameOver: Component<GameOverProps> = (props) => {
  if (!props.visible) return null;

  const formatScore = createMemo(() => props.score.toLocaleString());

  return (
    <div class="game-over-screen">
      <div class="game-over-container">
        <div class="game-over-title">GAME OVER</div>

        <div class="game-over-stats">
          <div class="game-over-stat">
            <span class="stat-value">{formatScore()}</span>
            <span class="stat-label">FINAL SCORE</span>
          </div>

          <div class="game-over-stat">
            <span class="stat-value">{props.landings}</span>
            <span class="stat-label">SUCCESSFUL LANDINGS</span>
          </div>
        </div>

        <div class="game-over-hint">CALCULATING HIGH SCORES...</div>
      </div>
    </div>
  );
};

export default GameOver;
