/* =============================================================
   PixelTools — src/tools/crochet/editor.js
   EDITOR DELLO SCHEMA (Uncinetto): ritocco a mano e disegno su foglio vuoto.
   Funziona col mouse e col dito (Pointer Events: un solo codice per entrambi).
   - Strumenti: Matita · Gomma (rimette lo sfondo) · Riempi (secchiello) · Prendi (contagocce)
   - Sul telefono: un dito disegna, DUE dita spostano lo schema e pizzicando lo ingrandiscono
     (come nelle app di disegno). Se il primo dito aveva già colorato, torna tutto com'era.
   - Annulla / Ripeti (anche Ctrl+Z, Ctrl+Y, Ctrl+Maiusc+Z), zoom − / +
   - Colori: tocchi un quadratino per sceglierlo, "Cambia colore", "+ Nuovo colore"
   Lo schema (P) è lo stesso oggetto che usano anteprima, legenda, PNG e PDF:
   P = { W, H, cells: Uint8Array, palette: [{ r, g, b, hex, letter, name, ink, count }], tech }
   ============================================================= */
import { $, h } from '../../core/dom.js';
import { luma, toHex, parseHex } from '../../core/pixel-engine.js';

const HISTORY_MAX = 100;
/* Una frase per strumento: si legge solo quella che serve (più facile da capire) */
const TOOL_HINTS = {
  pencil: () => 'Matita: tocca o trascina sui quadretti per colorarli con il colore scelto qui sotto.',
  eraser: (bg) => `Gomma: tocca o trascina per rimettere il colore dello sfondo (${bg}).`,
  fill: () => 'Riempi: tocca un quadretto e tutta la sua zona prende il colore scelto.',
  pick: () => 'Prendi: tocca un quadretto per usare il suo colore (poi torni alla matita).',
};

/** Ricalcola i punti di ogni colore */
export function recount(P) {
  for (const c of P.palette) c.count = 0;
  for (const i of P.cells) P.palette[i].count++;
}

/** Riempi: colora la zona dello stesso colore che si tocca sui lati (come il secchiello) */
export function floodFill(cells, W, H, start, color) {
  const from = cells[start];
  if (from === color) return 0;
  const stack = [start];
  let n = 0;
  cells[start] = color;
  while (stack.length) {
    const i = stack.pop(), x = i % W;
    n++;
    for (const j of [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i + W < W * H ? i + W : -1]) {
      if (j >= 0 && cells[j] === from) { cells[j] = color; stack.push(j); }
    }
  }
  return n;
}

/** Celle sulla linea da (x0,y0) a (x1,y1): il dito veloce non lascia buchi */
export function lineCells(x0, y0, x1, y1) {
  const out = [];
  const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0);
  const sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
  let err = dx + dy;
  for (;;) {
    out.push([x0, y0]);
    if (x0 === x1 && y0 === y1) break;
    const e2 = 2 * err;
    if (e2 >= dy) { err += dy; x0 += sx; }
    if (e2 <= dx) { err += dx; y0 += sy; }
  }
  return out;
}

/** Voce della palette da un colore esadecimale */
export function paletteEntry(hex, letter, name) {
  const [r, g, b] = parseHex(hex);
  return { r, g, b, hex: toHex(r, g, b), letter, name, ink: luma(r, g, b) > 140 ? '#111111' : '#ffffff', count: 0 };
}

/**
 * Collega l'editor alla pagina del tool.
 * opts: canvas, stage, letters, getPattern(), getLayout() → { pad, cw, ch, cssW },
 *       redraw() (solo il disegno), refresh() (disegno + legenda + numeri), zoomBy(f)
 */
export function createEditor(ws, opts) {
  const { canvas, stage, letters, getPattern, getLayout, redraw, refresh, zoomBy } = opts;
  const bar = $('#cr-editbar');
  const paletteEl = $('#cr-palette');
  const undoBtn = $('#cr-undo');
  const redoBtn = $('#cr-redo');
  const colorEdit = $('#cr-color-edit');
  const colorAdd = $('#cr-color-add');
  const colorEditLabel = $('#cr-color-edit-label');
  const colorAddLabel = $('#cr-color-add-label');
  const toolHint = $('#cr-tool-hint');

  const E = { on: false, tool: 'pencil', active: 0, bg: 0, undo: [], redo: [], pending: null, drawing: false, last: null, frame: 0 };

  const snapshot = (P) => ({ cells: Uint8Array.from(P.cells), palette: P.palette.map((c) => ({ ...c })) });
  const restore = (P, s) => { P.cells = Uint8Array.from(s.cells); P.palette = s.palette.map((c) => ({ ...c })); };
  const same = (a, b) => a.cells.length === b.cells.length && a.cells.every((v, i) => v === b.cells[i])
    && a.palette.length === b.palette.length && a.palette.every((c, i) => c.hex === b.palette[i].hex);

  /** Inizio di una modifica: si fotografa lo schema (per Annulla) */
  function begin() {
    if (E.pending) end();
    E.pending = snapshot(getPattern());
  }
  /** Fine di una modifica: se è cambiato qualcosa va nella storia */
  function end() {
    const P = getPattern();
    const before = E.pending;
    E.pending = null;
    if (!before || same(before, snapshot(P))) return;
    E.undo.push(before);
    if (E.undo.length > HISTORY_MAX) E.undo.shift();
    E.redo = [];
    recount(P);
    refresh();
    renderPalette();
  }

  function updateButtons() {
    undoBtn.disabled = !E.undo.length;
    redoBtn.disabled = !E.redo.length;
    const P = getPattern();
    const filet = P?.tech === 'filet'; // nel Filet ci sono solo pieno e vuoto
    colorEditLabel.hidden = filet;
    colorAddLabel.hidden = filet || P.palette.length >= letters.length;
  }

  function step(from, to) {
    const P = getPattern();
    if (!from.length) return;
    to.push(snapshot(P));
    restore(P, from.pop());
    E.active = Math.min(E.active, P.palette.length - 1);
    recount(P);
    refresh();
    renderPalette();
  }

  /* ---------- Colori ---------- */
  function renderPalette() {
    const P = getPattern();
    if (!P) return;
    paletteEl.replaceChildren(...P.palette.map((c, i) => {
      const b = h('button', {
        type: 'button', class: 'cr-swatch', role: 'radio',
        'aria-checked': String(i === E.active), 'aria-label': `Colore ${c.letter} ${c.hex}`,
        onclick: () => { E.active = i; renderPalette(); },
      }, c.letter);
      b.style.background = c.hex; // colore dal JavaScript: permesso dalla CSP
      b.style.color = c.ink;
      return b;
    }));
    colorEdit.value = P.palette[E.active].hex.toLowerCase();
    updateButtons();
  }

  // "Cambia colore": il colore attivo cambia mentre muovi il selettore, la storia si scrive alla fine
  colorEditLabel.addEventListener('pointerdown', () => { if (E.on) begin(); });
  colorEdit.addEventListener('input', () => {
    const P = getPattern();
    if (!E.pending) begin(); // tastiera: il selettore si apre senza pointerdown
    const c = P.palette[E.active];
    Object.assign(c, paletteEntry(colorEdit.value, c.letter, c.name), { count: c.count });
    redraw();
    renderPalette();
  });
  colorEdit.addEventListener('change', end);

  // "+ Nuovo colore": scegli il colore e diventa quello attivo
  colorAdd.addEventListener('change', () => {
    const P = getPattern();
    if (P.palette.length >= letters.length) return;
    begin();
    const used = new Set(P.palette.map((c) => c.letter));
    const letter = [...letters].find((l) => !used.has(l));
    P.palette.push(paletteEntry(colorAdd.value, letter, `Colore ${P.palette.length + 1}`));
    E.active = P.palette.length - 1;
    end();
    renderPalette();
  });

  /* ---------- Strumenti ---------- */
  function setTool(t) {
    E.tool = t;
    ws.querySelectorAll('input[name="cr-tool"]').forEach((r) => { r.checked = r.value === t; });
    toolHint.textContent = TOOL_HINTS[t](getPattern()?.palette[E.bg]?.letter ?? 'A');
  }
  ws.querySelectorAll('input[name="cr-tool"]').forEach((r) => r.addEventListener('change', () => setTool(r.value)));
  undoBtn.addEventListener('click', () => step(E.undo, E.redo));
  redoBtn.addEventListener('click', () => step(E.redo, E.undo));
  $('#cr-zoom-in').addEventListener('click', () => zoomBy(1.5));
  $('#cr-zoom-out').addEventListener('click', () => zoomBy(1 / 1.5));

  /** Quale quadretto c'è sotto il dito / il mouse (null se fuori dallo schema) */
  function cellAt(e) {
    const P = getPattern();
    const L = getLayout();
    const rect = canvas.getBoundingClientRect();
    const k = L.cssW / rect.width; // il canvas può essere mostrato più piccolo o più grande
    const x = Math.floor(((e.clientX - rect.left) * k - L.pad) / L.cw);
    const y = Math.floor(((e.clientY - rect.top) * k - L.pad) / L.ch);
    return x >= 0 && y >= 0 && x < P.W && y < P.H ? [x, y] : null;
  }
  const drawSoon = () => { if (!E.frame) E.frame = requestAnimationFrame(() => { E.frame = 0; redraw(); }); };
  function paint([x, y]) {
    const P = getPattern();
    P.cells[y * P.W + x] = E.tool === 'eraser' ? E.bg : E.active;
  }

  /* Dita sullo schema (solo touch): con due dita si sposta e si ingrandisce */
  const touches = new Map(); // pointerId → posizione
  let gesture = null;        // { lastMid, startDist, scale, ending }
  let tap = null;            // Riempi e Prendi agiscono quando il dito si alza (così due dita non li attivano)
  function fingers() {
    const [a, b] = [...touches.values()];
    return { mid: [(a.x + b.x) / 2, (a.y + b.y) / 2], dist: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)) };
  }
  function startGesture() {
    if (E.drawing) { // il primo dito aveva già colorato: torna com'era, niente storia
      restore(getPattern(), E.pending);
      E.pending = null;
      E.drawing = false;
      redraw();
    }
    tap = null;
    const f = fingers();
    const rect = canvas.getBoundingClientRect();
    canvas.style.transformOrigin = `${f.mid[0] - rect.left}px ${f.mid[1] - rect.top}px`;
    gesture = { lastMid: f.mid, startDist: f.dist, scale: 1, ending: false };
  }
  function moveGesture() {
    const f = fingers();
    const dx = f.mid[0] - gesture.lastMid[0], dy = f.mid[1] - gesture.lastMid[1];
    gesture.lastMid = f.mid;
    stage.scrollLeft -= dx;
    const top = stage.scrollTop;
    stage.scrollTop -= dy;
    if (stage.scrollTop === top) window.scrollBy(0, -dy); // lo schema non scorre in verticale: scorre la pagina
    gesture.scale = Math.min(4, Math.max(0.25, f.dist / gesture.startDist));
    canvas.style.transform = `scale(${gesture.scale})`; // anteprima veloce; il ridisegno vero alla fine
  }
  function endGesture() {
    canvas.style.transform = '';
    if (Math.abs(gesture.scale - 1) > 0.08) zoomBy(gesture.scale);
    gesture.ending = true; // il dito rimasto giù non deve disegnare
  }

  canvas.addEventListener('pointerdown', (e) => {
    if (!E.on || e.button > 0) return;
    if (e.pointerType === 'touch') {
      touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (touches.size === 2 && !gesture) { e.preventDefault(); startGesture(); return; }
      if (touches.size > 1 || gesture) return;
    }
    const c = cellAt(e);
    if (!c) return;
    e.preventDefault();
    canvas.setPointerCapture(e.pointerId);
    if (E.tool === 'fill' || E.tool === 'pick') { tap = { id: e.pointerId, cell: c }; return; }
    begin();
    E.drawing = true;
    E.last = c;
    paint(c);
    drawSoon();
  });
  canvas.addEventListener('pointermove', (e) => {
    if (touches.has(e.pointerId)) touches.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (gesture) { if (!gesture.ending && touches.size === 2) moveGesture(); return; }
    if (!E.drawing) return;
    const c = cellAt(e);
    if (!c) return;
    for (const cell of lineCells(E.last[0], E.last[1], c[0], c[1])) paint(cell);
    E.last = c;
    drawSoon();
  });
  function release(e) {
    touches.delete(e.pointerId);
    if (gesture) {
      if (!gesture.ending) endGesture();
      if (!touches.size) gesture = null;
      return;
    }
    if (tap && tap.id === e.pointerId) {
      const { cell } = tap;
      tap = null;
      if (e.type !== 'pointerup') return;
      const P = getPattern();
      if (E.tool === 'pick') { // prendi il colore e torna alla matita
        E.active = P.cells[cell[1] * P.W + cell[0]];
        renderPalette();
        setTool('pencil');
        return;
      }
      begin();
      floodFill(P.cells, P.W, P.H, cell[1] * P.W + cell[0], E.active);
      end();
      return;
    }
    if (!E.drawing) return;
    E.drawing = false;
    end();
  }
  canvas.addEventListener('pointerup', release);
  canvas.addEventListener('pointercancel', release);

  // Tastiera: Ctrl+Z annulla, Ctrl+Y o Ctrl+Maiusc+Z ripete (non mentre si scrive in un campo)
  ws.addEventListener('keydown', (e) => {
    if (!E.on || !(e.ctrlKey || e.metaKey) || e.target.matches('input[type="number"], input[type="text"]')) return;
    const k = e.key.toLowerCase();
    if (k === 'z' && !e.shiftKey) { e.preventDefault(); step(E.undo, E.redo); } else if (k === 'y' || (k === 'z' && e.shiftKey)) { e.preventDefault(); step(E.redo, E.undo); }
  });

  return {
    get on() { return E.on; },
    get changed() { return E.undo.length > 0; },
    start(active = 0, bg = 0) {
      E.on = true;
      E.bg = bg;
      E.undo = [];
      E.redo = [];
      E.pending = null;
      E.active = active;
      setTool('pencil');
      bar.hidden = false;
      stage.classList.add('is-editing');
      renderPalette();
    },
    stop() {
      E.on = false;
      E.drawing = false;
      bar.hidden = true;
      stage.classList.remove('is-editing');
      touches.clear();
      gesture = null;
      tap = null;
      canvas.style.transform = '';
    },
  };
}
