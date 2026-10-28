/* =============================================================
   PixelTools — src/core/dom.js
   Piccoli aiuti per lavorare con la pagina (condivisi da tutti i tool)
   - $, $$:  selezionano elementi (uno / tutti)
   - h:      crea un elemento in modo sicuro
   - clamp:  tiene un numero tra un minimo e un massimo
   ============================================================= */

/** Scorciatoie per selezionare elementi */
export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/**
 * Crea un elemento DOM in modo sicuro (niente innerHTML con dati utente).
 * h('button', { class: 'btn', type: 'button' }, 'Testo')
 */
export function h(tag, props = {}, ...children) {
  const el = document.createElement(tag);
  for (const [key, value] of Object.entries(props)) {
    if (value === false || value == null) continue;
    if (key === 'class') el.className = value;
    else if (key === 'dataset') Object.assign(el.dataset, value);
    else if (key.startsWith('on') && typeof value === 'function') el.addEventListener(key.slice(2), value);
    else el.setAttribute(key, value === true ? '' : value);
  }
  el.append(...children.flat().filter((c) => c != null && c !== false));
  return el;
}

/** clamp(15, 0, 10) → 10 · clamp(-3, 0, 10) → 0 */
export const clamp = (v, min, max) => Math.min(Math.max(v, min), Math.max(min, max));