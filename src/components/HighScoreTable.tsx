import { Component, For, Show, createMemo } from "solid-js";
import type { HighScoreEntry } from "../lib/highScores";

interface HighScoreTableProps {
  visible: boolean;
  entries: HighScoreEntry[];
  highlightedRank: number | null;
  finalScore?: number;
  landings?: number;
  isGameOver?: boolean;
  isOverlay?: boolean;
  onKeyDown: (key: string) => void;
}

const HighScoreTable: Component<HighScoreTableProps> = (props) => {
  const getRankClass = (rank: number) => {
    if (rank === 1) return "rank-gold";
    if (rank === 2) return "rank-silver";
    if (rank === 3) return "rank-bronze";
    return "";
  };

  const getWorldColor = (worldId: string) => {
    return worldId === "mars" ? "#ff8844" : "#00ff88";
  };

  const formatScore = (score: number) => score.toLocaleString();

  // Check if we should show "didn't qualify" message
  const didNotQualify = createMemo(() => {
    return (
      props.finalScore !== undefined &&
      props.highlightedRank === null &&
      props.entries.length >= 10 &&
      props.finalScore <= (props.entries[9]?.score ?? 0)
    );
  });

  return (
    <Show when={props.visible}>
      <div
        class={`high-score-table-screen ${props.isOverlay ? "overlay" : ""}`}
        onKeyDown={(e) => props.onKeyDown(e.key)}
      >
        <div class="high-score-table-container">
          {/* Decorative stars */}
          <div class="star-decoration left">★</div>
          <div class="star-decoration right">★</div>

          <div class="table-header">
            <Show when={props.isGameOver}>
              <div class="game-over-title">GAME OVER</div>
              <div class="game-over-final-stats">
                <span class="final-score">
                  {props.finalScore?.toLocaleString() ?? 0}
                </span>
                <span class="final-label">POINTS</span>
                <span class="final-divider">|</span>
                <span class="final-landings">{props.landings ?? 0}</span>
                <span class="final-label">LANDINGS</span>
              </div>
            </Show>
            <div class="table-title">HIGH SCORES</div>
            <div class="table-subtitle">DROPSHIP HALL OF FAME</div>
          </div>

          <Show when={props.entries.length === 0}>
            <div class="no-scores">NO HIGH SCORES YET</div>
            <div class="no-scores-hint">Be the first to make the list!</div>
          </Show>

          <Show when={props.entries.length > 0}>
            <table class="high-score-table">
              <thead>
                <tr>
                  <th class="col-rank">RNK</th>
                  <th class="col-name">NAME</th>
                  <th class="col-score">SCORE</th>
                  <th class="col-world">WORLD</th>
                  <th class="col-landings">LANDS</th>
                </tr>
              </thead>
              <tbody>
                <For each={props.entries}>
                  {(entry) => (
                    <tr
                      class={`score-row ${getRankClass(entry.rank)} ${props.highlightedRank === entry.rank ? "highlighted" : ""}`}
                    >
                      <td class="col-rank">{entry.rank}.</td>
                      <td class="col-name">{entry.initials}</td>
                      <td class="col-score">{formatScore(entry.score)}</td>
                      <td
                        class="col-world"
                        style={{ color: getWorldColor(entry.worldId) }}
                      >
                        {entry.worldId.toUpperCase()}
                      </td>
                      <td class="col-landings">{entry.landingCount}</td>
                      <Show when={props.highlightedRank === entry.rank}>
                        <td class="you-indicator">← YOU</td>
                      </Show>
                    </tr>
                  )}
                </For>
              </tbody>
            </table>
          </Show>

          <Show when={didNotQualify()}>
            <div class="did-not-qualify">
              <div class="dnq-score">
                YOUR SCORE: {formatScore(props.finalScore!)}
              </div>
              <div class="dnq-message">Did not qualify for top 10</div>
            </div>
          </Show>

          <div class="table-controls">
            <span>[R] NEW GAME</span>
            <span>[ESC] EXIT</span>
          </div>
        </div>
      </div>
    </Show>
  );
};

export default HighScoreTable;
