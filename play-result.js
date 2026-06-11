// ============================================================
//  PLAY-RESULT — Result screen (overlay) + best-record storage
// ============================================================
// Renders the end-of-song Result as a fullscreen overlay (same layering idea
// as the Play fullscreen canvas) and persists best records to localStorage.
//
// Shown when a manual session ends — naturally (clear/fail by gauge) or by
// force-end. play.js calls showResult(PS.playResult) from finalizePlay().
//
// Display items (design §3.7): song title/artist/difficulty, Score (7-digit
// million), Percent, Rank, State, Best flag, judgment distribution + counts,
// Max Combo, and applied play options. Actions: Retry (→ replay) and Back
// (→ close overlay; Music Select wiring comes with the scene system).
//
// Best record key: until the song loader/packager exists there is no stable
// song id, so we derive one from metadata (artist|title|difficulty). When the
// packaged song.json lands, swap keyFor() to use the folder-based song id.

import { LS_PREFIX, STATE_COLOR, RANK_TABLE } from './constants.js';
import { D } from './state.js';
import { PS } from './play-state.js';

// ── Best-record storage ──────────────────────────────────────

function keyFor() {
  const m = D.metadata || {};
  const slug = s => String(s || '').trim().toLowerCase().replace(/\s+/g, '-');
  return `${LS_PREFIX}score_${slug(m.artist)}|${slug(m.title)}|${slug(m.difficulty)}`;
}

/** Read the stored best record for the current chart, or null. */
export function getBest() {
  try {
    const raw = localStorage.getItem(keyFor());
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

/**
 * Merge a finished result into the stored best. "Best" is decided by score
 * (higher wins); maxCombo and the best state are tracked independently so a
 * later lower-score full-combo run still upgrades the recorded mark.
 * Returns true if this play set a new best score.
 */
export function saveBest(result) {
  const prev = getBest();
  const isNewScore = !prev || result.score > prev.bestScore;
  const rec = {
    bestScore: Math.max(result.score, prev?.bestScore ?? 0),
    bestRank:  isNewScore ? result.rank : (prev?.bestRank ?? result.rank),
    bestState: betterState(prev?.bestState, result.state),
    maxCombo:  Math.max(result.maxCombo, prev?.maxCombo ?? 0),
    playCount: (prev?.playCount ?? 0) + 1,
  };
  try { localStorage.setItem(keyFor(), JSON.stringify(rec)); } catch {}
  return isNewScore;
}

// State priority for "best" tracking: AS>AP>FC>H>C>P>N>F.
const STATE_ORDER = ['AS', 'AP', 'FC', 'H', 'C', 'P', 'N', 'F'];
function betterState(a, b) {
  const ia = STATE_ORDER.indexOf(a); const ib = STATE_ORDER.indexOf(b);
  if (ia === -1) return b;
  if (ib === -1) return a;
  return ia <= ib ? a : b;   // lower index = better
}

// ── Overlay lifecycle ────────────────────────────────────────

let _retryCb = null;

/**
 * Show the Result overlay for `result`. `onRetry` is invoked when the player
 * chooses Retry (caller restarts the chart). Back just hides the overlay.
 */
export function showResult(result, onRetry) {
  if (!result) return;
  _retryCb = onRetry || null;
  // Practice-style sessions (mid-chart start, reduced rate) display their
  // result but never touch the stored best — recordEligible is stamped by
  // finalizePlay; treat absence as eligible for backward compatibility.
  const isNewBest = (result.recordEligible !== false) ? saveBest(result) : false;
  const best = getBest();
  renderResultDOM(result, best, isNewBest);
  const ov = document.getElementById('resultOv');
  if (ov) ov.classList.add('show');
}

export function hideResult() {
  const ov = document.getElementById('resultOv');
  if (ov) ov.classList.remove('show');
}

export function resultRetry() {
  hideResult();
  const cb = _retryCb; _retryCb = null;
  if (cb) cb();
}

export function resultBack() {
  hideResult();
  // Scene system not built yet — for now this returns to the Play tab idle view.
  // When Music Select exists, route there instead.
}

// ── Rendering (DOM, not canvas — crisp text + easy layout) ───

function renderResultDOM(r, best, isNewBest) {
  const m = D.metadata || {};
  const stateColor = STATE_COLOR[r.state] || '#fff';
  const diff = m.difficulty || '';
  const lvl = m.level ? ` ${m.level}` : '';

  const counts = r.counts || { sync: 0, perfect: 0, good: 0, miss: 0 };
  const optBits = [];
  if (r.options) {
    optBits.push(r.options.gaugeType === 'hard' ? 'HARD' : 'NORMAL');
    if (r.options.lockTarget && r.options.lockTarget !== 'none') {
      optBits.push(r.options.lockTarget.toUpperCase() +
        (r.options.lockMode === 'cascade' ? '↓' : '!'));
    }
  }

  const host = document.getElementById('resultBody');
  if (!host) return;
  host.innerHTML = `
    <div class="rs-song">
      <div class="rs-title">${esc(m.title || 'Untitled')}</div>
      <div class="rs-artist">${esc(m.artist || '')}</div>
      <div class="rs-diff">${esc(diff)}${lvl}</div>
    </div>

    <div class="rs-rankrow">
      <div class="rs-rank">${esc(r.rank)}</div>
      <div class="rs-state" style="color:${stateColor};border-color:${stateColor}">${esc(r.state)}</div>
    </div>

    <div class="rs-score">${pad7(r.score)}</div>
    <div class="rs-pct">${r.accuracy.toFixed(2)}%${isNewBest ? '<span class="rs-new">NEW BEST</span>' : ''}</div>

    <div class="rs-counts">
      <div class="rs-c"><span class="rs-cl" style="color:#fff">SYNC</span><span>${counts.sync}</span></div>
      <div class="rs-c"><span class="rs-cl" style="color:#ffd23f">PERFECT</span><span>${counts.perfect}</span></div>
      <div class="rs-c"><span class="rs-cl" style="color:#4aff8a">GOOD</span><span>${counts.good}</span></div>
      <div class="rs-c"><span class="rs-cl" style="color:#ff5a6a">MISS</span><span>${counts.miss}</span></div>
    </div>

    <div class="rs-fs">
      <span style="color:#ff5a6a">FAST ${r.fastCount ?? 0}</span>
      <span style="color:#5aa0ff">SLOW ${r.slowCount ?? 0}</span>
    </div>

    <div class="rs-meta">
      <div>MAX COMBO <b>${r.maxCombo}</b></div>
      <div>BEST <b>${pad7(best?.bestScore ?? r.score)}</b> · ${esc(best?.bestState ?? r.state)}</div>
      ${optBits.length ? `<div>OPTIONS <b>${esc(optBits.join(' · '))}</b></div>` : ''}
    </div>

    <div class="rs-actions">
      <button class="rs-btn" data-action="resultRetry">RETRY</button>
      <button class="rs-btn rs-back" data-action="resultBack">BACK</button>
    </div>
  `;
}

function pad7(n) { return String(Math.max(0, Math.round(n))).padStart(7, '0'); }
function esc(s) {
  return String(s).replace(/[&<>"']/g, c =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}
