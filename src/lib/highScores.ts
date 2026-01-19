/**
 * High Score System
 * Manages persistent high score storage and retrieval for arcade mode
 */

import type { WorldId } from "./worldRegistry";

const STORAGE_KEY = "dropship-high-scores";
const STORAGE_VERSION = 1;
const MAX_ENTRIES = 10;

export interface HighScoreEntry {
  rank: number;
  initials: string; // 3 characters
  score: number;
  worldId: WorldId;
  landingCount: number;
  timestamp: string; // ISO format
}

export interface HighScoreTable {
  entries: HighScoreEntry[];
  version: number;
}

/**
 * Load high scores from localStorage
 */
export function loadHighScores(): HighScoreTable {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (!stored) {
      return { entries: [], version: STORAGE_VERSION };
    }

    const parsed = JSON.parse(stored) as HighScoreTable;

    // Handle version migrations if needed in the future
    if (parsed.version !== STORAGE_VERSION) {
      // For now, just reset if version mismatch
      return { entries: [], version: STORAGE_VERSION };
    }

    // Validate entries
    const validEntries = parsed.entries
      .filter(
        (e) =>
          typeof e.initials === "string" &&
          e.initials.length === 3 &&
          typeof e.score === "number" &&
          e.score >= 0
      )
      .slice(0, MAX_ENTRIES);

    // Re-rank entries
    return {
      entries: validEntries.map((e, i) => ({ ...e, rank: i + 1 })),
      version: STORAGE_VERSION,
    };
  } catch {
    // If anything goes wrong, return empty table
    return { entries: [], version: STORAGE_VERSION };
  }
}

/**
 * Save high scores to localStorage
 */
export function saveHighScores(table: HighScoreTable): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(table));
  } catch {
    // localStorage might be full or disabled - silently fail
    console.warn("Failed to save high scores to localStorage");
  }
}

/**
 * Check if a score qualifies for the high score table
 */
export function qualifiesForHighScore(score: number): {
  qualifies: boolean;
  rank: number | null;
} {
  if (score <= 0) {
    return { qualifies: false, rank: null };
  }

  const table = loadHighScores();

  // If table not full, auto-qualifies
  if (table.entries.length < MAX_ENTRIES) {
    // Find insertion rank
    const rank =
      table.entries.findIndex((e) => score > e.score) + 1 ||
      table.entries.length + 1;
    return { qualifies: true, rank };
  }

  // Check if score beats lowest entry
  const lowestScore = table.entries[MAX_ENTRIES - 1].score;
  if (score > lowestScore) {
    // Find insertion rank
    const rank = table.entries.findIndex((e) => score > e.score) + 1;
    return { qualifies: true, rank };
  }

  return { qualifies: false, rank: null };
}

/**
 * Add a new high score entry
 */
export function addHighScore(
  initials: string,
  score: number,
  worldId: WorldId,
  landingCount: number
): HighScoreTable {
  const table = loadHighScores();

  const newEntry: HighScoreEntry = {
    rank: 0, // Will be set after sorting
    initials: initials.toUpperCase().padEnd(3, " ").slice(0, 3),
    score,
    worldId,
    landingCount,
    timestamp: new Date().toISOString(),
  };

  // Insert into sorted position
  const insertIndex = table.entries.findIndex((e) => score > e.score);
  if (insertIndex === -1) {
    table.entries.push(newEntry);
  } else {
    table.entries.splice(insertIndex, 0, newEntry);
  }

  // Trim to max entries and re-rank
  table.entries = table.entries.slice(0, MAX_ENTRIES).map((e, i) => ({
    ...e,
    rank: i + 1,
  }));

  saveHighScores(table);
  return table;
}

/**
 * Get the current high score table
 */
export function getHighScoreTable(): HighScoreEntry[] {
  return loadHighScores().entries;
}

/**
 * Clear all high scores (for testing/reset)
 */
export function clearHighScores(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Silently fail
  }
}

/**
 * Get the lowest score on the table (for display purposes)
 */
export function getLowestHighScore(): number {
  const table = loadHighScores();
  if (table.entries.length < MAX_ENTRIES) {
    return 0;
  }
  return table.entries[table.entries.length - 1]?.score ?? 0;
}

/**
 * Get the highest score on the table
 */
export function getHighestScore(): number {
  const table = loadHighScores();
  return table.entries[0]?.score ?? 0;
}
