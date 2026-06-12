// ============================================================
//  SCENE-MANAGER — top-level screen switching (title / mode-select /
//                  settings / music-select / editor / game)
// ============================================================
// Scenes are the layer ABOVE editor tabs. The editor's note/shape/play/meta
// tabs (tab-nav.js) live entirely inside the single 'editor' scene and are
// unaffected by scene switching — different axis, no collision. Scene switching
// toggles `style.display` on the scene's mount element; tab switching toggles
// `.panel.on` inside #app. The two never touch the same DOM property.
//
// Each scene registers a mount element (the empty #scene-* div in index.html,
// or #app for the editor) plus optional lifecycle hooks:
//   mount()    — lazy first-time DOM build. Called once, the first time the
//                scene is shown. New scenes (title etc.) draw their innerHTML
//                here; the editor needs no mount (markup already in HTML).
//   onEnter()  — every time the scene becomes visible (resize canvases, focus…)
//   onExit()   — every time the scene is left (stop playback, cancel pending…)
//
// Lazy mount matters for the editor build-gate: a game-only build never shows
// the editor scene, so its mount() never runs and (when editor UI is wired
// behind mount) its cost is never paid.
//
// One scene is visible at a time. goScene() pushes onto a back stack so a
// natural Title → Mode-select → Music-select drill-down can unwind via goBack().

const _scenes = new Map();   // id → { el, display, mount, onEnter, onExit, mounted }
let _current = null;          // currently visible scene id
const _stack = [];            // back-navigation history of scene ids

/**
 * Register a scene.
 * @param {string} id           unique scene id (e.g. 'title', 'editor')
 * @param {object} opts
 * @param {HTMLElement} opts.el the mount element (its display is toggled)
 * @param {string} [opts.display='block']  display value when visible
 *                 (#app uses 'flex'; new scenes use 'block')
 * @param {Function} [opts.mount]    lazy one-time DOM build, receives el
 * @param {Function} [opts.onEnter]  run each time the scene is shown
 * @param {Function} [opts.onExit]   run each time the scene is hidden
 */
export function registerScene(id, opts) {
  if (!opts || !opts.el) {
    console.warn(`registerScene('${id}'): missing mount element`);
    return;
  }
  _scenes.set(id, {
    el: opts.el,
    display: opts.display || 'block',
    mount: opts.mount || null,
    onEnter: opts.onEnter || null,
    onExit: opts.onExit || null,
    mounted: false,
  });
}

/** The id of the currently visible scene, or null before first goScene. */
export function currentScene() { return _current; }

/** Is a scene with this id registered? */
export function hasScene(id) { return _scenes.has(id); }

function _show(id) {
  const s = _scenes.get(id);
  if (!s) { console.warn(`goScene: '${id}' not registered`); return false; }
  // Lazy first mount.
  if (!s.mounted) {
    if (s.mount) s.mount(s.el);
    s.mounted = true;
  }
  // Hide the outgoing scene, run its exit hook.
  if (_current && _current !== id) {
    const prev = _scenes.get(_current);
    if (prev) {
      if (prev.onExit) prev.onExit();
      prev.el.style.display = 'none';
    }
  }
  // Show the incoming scene, run its enter hook.
  s.el.style.display = s.display;
  _current = id;
  if (s.onEnter) s.onEnter();
  return true;
}

/**
 * Switch to a scene. The current scene id is pushed onto the back stack so
 * goBack() can return to it. Switching to the already-current scene is a no-op.
 * @param {string} id
 * @param {object} [opts]
 * @param {boolean} [opts.replace=false] replace current in history instead of
 *        pushing (use for sideways moves that shouldn't be "backable")
 */
export function goScene(id, opts) {
  if (id === _current) return;
  const replace = opts && opts.replace;
  const from = _current;
  if (_show(id)) {
    if (from && !replace) _stack.push(from);
  }
}

/**
 * Return to the previous scene on the back stack. No-op if the stack is empty
 * (e.g. already at the root title screen). Returns the id moved to, or null.
 */
export function goBack() {
  if (_stack.length === 0) return null;
  const target = _stack.pop();
  // Show without pushing the current scene back onto the stack.
  const from = _current;
  const s = _scenes.get(target);
  if (!s) return null;
  if (!s.mounted) { if (s.mount) s.mount(s.el); s.mounted = true; }
  if (from && from !== target) {
    const prev = _scenes.get(from);
    if (prev) { if (prev.onExit) prev.onExit(); prev.el.style.display = 'none'; }
  }
  s.el.style.display = s.display;
  _current = target;
  if (s.onEnter) s.onEnter();
  return target;
}

/** Clear back history (e.g. when returning to Title as a fresh root). */
export function resetSceneStack() { _stack.length = 0; }
