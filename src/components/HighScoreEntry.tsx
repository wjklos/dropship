import { Component, For, Show, createMemo } from "solid-js";

interface HighScoreEntryProps {
  visible: boolean;
  rank: number | null;
  score: number;
  initials: string[];
  activeIndex: number;
  onKeyDown: (key: string) => void;
}

const HighScoreEntry: Component<HighScoreEntryProps> = (props) => {
  const formatScore = createMemo(() => props.score.toLocaleString());

  return (
    <Show when={props.visible}>
      <div
        class="high-score-entry-screen"
        onKeyDown={(e) => props.onKeyDown(e.key)}
      >
        <div class="high-score-entry-container">
          {/* Decorative stars */}
          <div class="star-decoration left">★</div>
          <div class="star-decoration right">★</div>

          <div class="game-over-title">GAME OVER</div>
          <div class="high-score-header">NEW HIGH SCORE!</div>

          <div class="high-score-rank">RANK #{props.rank}</div>

          <div class="high-score-value">{formatScore()}</div>

          <div class="initials-prompt">ENTER YOUR INITIALS</div>

          <div class="initials-container">
            <For each={props.initials}>
              {(letter, index) => (
                <div
                  class={`initial-box ${index() === props.activeIndex ? "active" : ""}`}
                >
                  <div class="initial-arrow up">▲</div>
                  <div class="initial-letter">{letter}</div>
                  <div class="initial-arrow down">▼</div>
                </div>
              )}
            </For>
          </div>

          <div class="entry-controls">
            <span>[↑/↓] CHANGE</span>
            <span>[←/→] MOVE</span>
            <span>[ENTER] CONFIRM</span>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default HighScoreEntry;
