// ============================================================
//  CONFIG — build-time feature flags
// ============================================================
// Single source of truth for what's exposed in a given build. The editor and
// the game share ONE codebase (so a bug fixed once is fixed for both); these
// flags decide what the *player* can reach, without removing any code.
//
// To ship a game-only build: set FEATURES.editor = false. The editor code
// still ships, but every route to it is gated — the Mode-select "Editor"
// button is hidden and the Title dev-shortcut disappears. The player has no
// path to the editor. To develop: set it true.
//
// (Later, the editor scene's heavy modules can be lazy-imported only when the
// editor route is taken, so a game-only build never downloads them. The flag
// is already the gate that decision will hang off of.)

export const FEATURES = {
  // Master switch for editor access. false = game-only public build.
  editor: true,
};

// Scene shown on boot. Always 'title' for real builds; flip to 'editor' during
// development to skip the Title → Mode-select → Editor click path.
export const START_SCENE = 'title';
