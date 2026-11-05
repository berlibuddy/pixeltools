/* =============================================================
   PixelTools — scripts/crediti.mjs
   Genera src/tools/credits/licenses.json: l'elenco di tutto il codice
   di altri che finisce nel sito (librerie, loro aiutanti, font), con
   versione, licenza e TESTO COMPLETO della licenza.

   Perché: Vite toglie i commenti dai file pubblicati, compresi gli
   avvisi di copyright. Le licenze (MIT, Apache, OFL…) chiedono che
   restino visibili → la pagina #crediti li mostra tutti.

   Quando lanciarlo: ogni volta che si aggiunge, toglie o aggiorna una
   libreria (dopo `npm ci`). Comando:   npm run crediti

   Cosa conta: i pacchetti del package-lock.json che NON sono
   "dev" (servono solo per costruire il sito, es. Vite) e NON sono
   "optional" (es. @napi-rs/canvas: serve a pdf.js solo dentro Node,
   mai nel browser).
   ============================================================= */
import fs from 'node:fs';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT = path.join(ROOT, 'src/tools/credits/licenses.json');
const lock = JSON.parse(fs.readFileSync(path.join(ROOT, 'package-lock.json'), 'utf8'));

// Codice di altri che una libreria contiene già al suo interno (scritto nei suoi file).
const NOTES = {
  'pdf-lib': 'Contiene codice derivato da: PDFKit (MIT, © 2014 Devon Govett), base64-arraybuffer (MIT, © 2012 Niklas von Hertzen), XPDF (Apache 2.0, © 1996-2003 Glyph & Cog, LLC), pdf.js (Apache 2.0, © 2012 Mozilla Foundation).',
  jszip: 'Licenza doppia (MIT oppure GPLv3): PixelTools la usa con la licenza MIT. Contiene già al suo interno pako e gli altri piccoli pacchetti elencati qui.',
  'pdfjs-dist': 'Usiamo la versione "legacy" (più compatibile con i browser), che contiene anche core-js (vedi sotto).',
};
// Licenze scelte quando un pacchetto ne offre più di una
const CHOSEN = { jszip: 'MIT' };

const MIT_TEXT = (copyright) => `${copyright}

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in
all copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN
THE SOFTWARE.
`;

/** Testo della licenza: file LICENSE/COPYING, altrimenti la sezione "License" del README */
function licenseText(dir) {
  const files = fs.readdirSync(dir);
  const file = files.find((f) => /^(licen[cs]e|copying)(\.(md|markdown|txt))?$/i.test(f));
  if (file) return fs.readFileSync(path.join(dir, file), 'utf8').trim();

  const readme = files.find((f) => /^readme(\.md)?$/i.test(f));
  if (readme) {
    const m = fs.readFileSync(path.join(dir, readme), 'utf8').match(/^#+\s*licen[cs]e\s*\n([\s\S]*?)(?=^#+\s|(?![\s\S]))/im);
    if (m) return m[1].trim().replaceAll('&lt;', '<').replaceAll('&gt;', '>');
  }
  throw new Error(`Nessun testo di licenza trovato in ${dir}`);
}

/** Prima riga "Copyright …" / "© …" di un testo ('' se non c'è) */
function copyrightLine(text) {
  // "Copyright" con la maiuscola (salta frasi del testo legale) e non il modello "[yyyy]" della Apache
  const lines = text.split('\n').map((l) => l.replace(/^[\s*#>/-]+/, '').trim());
  return lines.find((l) => /^(Copyright|COPYRIGHT|©)/.test(l) && !l.includes('[yyyy]')) ?? '';
}

/** Inizio del file principale del pacchetto: a volte l'avviso di copyright sta lì (es. pdf.js) */
function headerOf(dir, pkg) {
  const main = path.join(dir, pkg.main || 'index.js');
  return fs.existsSync(main) ? fs.readFileSync(main, 'utf8').slice(0, 2000) : '';
}

function homepage(pkg) {
  let url = pkg.homepage || (typeof pkg.repository === 'string' ? pkg.repository : pkg.repository?.url) || '';
  url = url.replace(/^git\+/, '').replace(/^git:\/\//, 'https://').replace(/\.git$/, '').replace(/#readme$/, '');
  if (/^[\w-]+\/[\w.-]+$/.test(url)) url = `https://github.com/${url}`; // forma breve "utente/repo"
  return url.startsWith('http') ? url : '';
}

const items = [];
for (const [key, info] of Object.entries(lock.packages)) {
  if (!key || info.dev || info.optional) continue;
  const name = key.slice(key.lastIndexOf('node_modules/') + 'node_modules/'.length);
  const dir = path.join(ROOT, key);
  const pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8'));
  const text = licenseText(dir);
  items.push({
    name,
    version: pkg.version,
    license: CHOSEN[name] ?? pkg.license,
    copyright: copyrightLine(text) || copyrightLine(headerOf(dir, pkg)),
    url: homepage(pkg),
    note: NOTES[name] ?? '',
    text,
  });
}

// core-js: non è un pacchetto npm nostro, è già dentro pdf.js "legacy" → lo leggiamo dal file
const pdfjsLegacy = path.join(ROOT, 'node_modules/pdfjs-dist/legacy/build/pdf.min.mjs');
const cj = fs.existsSync(pdfjsLegacy)
  && fs.readFileSync(pdfjsLegacy, 'utf8').match(/version:"([\d.]+)",mode:[^,]+,copyright:"([^"]+)"/);
if (cj) {
  const copyright = cj[2].replace(/\s*All rights reserved\.$/, '');
  items.push({
    name: 'core-js', version: cj[1], license: 'MIT', copyright,
    url: 'https://github.com/zloirock/core-js',
    note: 'Incluso dentro pdf.js "legacy" (non è installato a parte).',
    text: MIT_TEXT(`Copyright ${copyright.replace(/^©\s*/, '© ')}`),
  });
} else {
  console.warn('⚠ core-js non trovato dentro pdf.js: controlla se serve ancora la sua voce.');
}

// Prima le librerie "principali" (quelle che usiamo direttamente), poi i font, poi gli aiutanti
const deps = JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).dependencies;
const rank = (it) => (it.name.startsWith('@fontsource/') ? 1 : it.name in deps ? 0 : 2);
items.sort((a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name));
items.forEach((it) => { it.main = rank(it) < 2; });

fs.writeFileSync(OUT, JSON.stringify(items, null, 2) + '\n');
console.log(`✔ ${items.length} voci scritte in ${path.relative(ROOT, OUT)}`);
