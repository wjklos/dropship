import { Component, onMount, Show } from "solid-js";
import Game from "./components/Game";
import {
  initializeWorldRegistry,
  isWorldsLoading,
  isWorldsInitialized,
} from "./lib/worldRegistry";

const App: Component = () => {
  // Initialize world registry on mount
  // This fetches worlds from API and caches them
  onMount(() => {
    initializeWorldRegistry();
  });

  return (
    <div class="app">
      <Show
        when={!isWorldsLoading() || isWorldsInitialized()}
        fallback={
          <div class="loading-screen">
            <div class="loading-text">INITIALIZING...</div>
          </div>
        }
      >
        <Game />
      </Show>
    </div>
  );
};

export default App;
