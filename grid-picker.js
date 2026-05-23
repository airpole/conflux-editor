// ============================================================
//  GRID-PICKER — divisor picker dropdown for Notes/Shape grids
// ============================================================
import { $, GDIVS } from './constants.js';
import { ES } from './editor-state.js';

export function buildGP(id, cur) {
  $(id).innerHTML = GDIVS.map(d => {
    const l = (d % 3 === 0 && d > 3) ? `1/${d}T` : `1/${d}`;
    return `<div class="gi${d === cur ? ' on' : ''}" data-action="pickGrid" data-arg="${id}:${d}">${l}</div>`;
  }).join('');
}

export function toggleGP(id) { $(id).classList.toggle('show'); }
export function closeGP(id)  { $(id).classList.remove('show'); }

export function pickNG(d) {
  ES.nGD = d;
  $('ngBtn').textContent = (d % 3 === 0 && d > 3) ? `1/${d}T` : `1/${d}`;
  buildGP('ngp', ES.nGD);
  import('./notes-render.js').then(m => m.drawN());
}

export function pickSG(d) {
  ES.sGD = d;
  $('sgBtn').textContent = (d % 3 === 0 && d > 3) ? `1/${d}T` : `1/${d}`;
  buildGP('sgp', ES.sGD);
  import('./shape-render.js').then(m => m.drawS());
}

// Outside-click closes any open picker
document.addEventListener('pointerdown', e => {
  if (!e.target.closest('.gpop') && !e.target.closest('#ngBtn') && !e.target.closest('#sgBtn')) {
    closeGP('ngp'); closeGP('sgp');
  }
});
