// Configurazione di Vite: il sito vive su https://berlibuddy.github.io/pixeltools/
import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const BASE = '/pixeltools/';

/* -------------------------------------------------------------
   CSP (Content Security Policy): regole che il browser fa rispettare.
   Se qualcuno riuscisse a infilare codice nella pagina (es. con un PDF
   "cattivo"), il browser si rifiuterebbe di eseguirlo.
   Ogni riga apre SOLO quello che serve davvero:
   ------------------------------------------------------------- */
const CSP = [
  "default-src 'none'",          // tutto vietato, tranne quello aperto qui sotto
  "script-src 'self'",           // JavaScript solo dai nostri file (niente eval, niente CDN)
  "worker-src 'self'",           // worker di pdf.js: solo dal nostro sito
  "style-src 'self'",            // CSS solo dai nostri file (niente style="…" nei tag)
  "img-src 'self' blob: data:",  // anteprime create nel browser (miniature, firma)
  "font-src 'self'",             // font ospitati da noi (passo 5d-1 e font standard di pdf.js)
  "connect-src 'self'",          // il sito non parla con nessun altro server
  "base-uri 'none'",             // nessuno può cambiare l'indirizzo base della pagina
  "form-action 'none'",          // nessun modulo può inviare dati altrove
  "object-src 'none'",           // niente plugin vecchi (Flash & co.)
].join('; ');
// Da aggiungere quando avremo un server nostro (in un <meta> non funzionano):
//   frame-ancestors 'none' (nessun sito può "incorniciarci"), i rapporti dei blocchi,
//   e la stessa CSP anche sul file del worker di pdf.js (un <meta> vale solo per la pagina).

/* -------------------------------------------------------------
   FILE EXTRA DI PDF.JS (passo 5e) — servono all'anteprima della Firma:
     wasm/            decodificatori JBIG2 e JPEG 2000 (PDF scansionati),
                      solo la versione JavaScript: niente WebAssembly → CSP invariata
     standard_fonts/  font standard (Helvetica, Times, ZapfDingbats…) per i PDF che non li includono
     cmaps/           tabelle per il testo cinese, giapponese, coreano
   Li prendiamo da node_modules (sempre la stessa versione di pdf.js installata)
   e li mettiamo in /pixeltools/pdfjs-<versione>/: la versione nel percorso evita
   che il browser usi file vecchi dalla cache dopo un aggiornamento.
   Il browser li scarica SOLO quando un PDF ne ha bisogno.
   Licenze: pagina Crediti (scripts/crediti.mjs).
   ------------------------------------------------------------- */
const PDFJS_DIR = fileURLToPath(new URL('./node_modules/pdfjs-dist/', import.meta.url));
const PDFJS_VERSION = JSON.parse(fs.readFileSync(path.join(PDFJS_DIR, 'package.json'), 'utf8')).version;
const PDFJS_ASSETS = {
  wasm: (f) => f.endsWith('_nowasm_fallback.js'),
  standard_fonts: (f) => /\.(pfb|ttf)$/.test(f),
  cmaps: (f) => f.endsWith('.bcmap'),
};
const CONTENT_TYPES = { '.js': 'text/javascript', '.ttf': 'font/ttf' }; // il resto: dati binari

/** Mappa "percorso nel sito" → "file in node_modules" */
function pdfjsFiles() {
  const files = new Map();
  for (const [dir, wanted] of Object.entries(PDFJS_ASSETS)) {
    const list = fs.readdirSync(path.join(PDFJS_DIR, dir)).filter(wanted);
    if (!list.length) throw new Error(`pdf.js: nessun file in ${dir}/ (è cambiata la struttura del pacchetto?)`);
    for (const f of list) files.set(`pdfjs-${PDFJS_VERSION}/${dir}/${f}`, path.join(PDFJS_DIR, dir, f));
  }
  return files;
}

export default defineConfig({
  base: BASE,
  plugins: [
    {
      name: 'pixeltools-csp',
      apply: 'build', // solo nel sito pubblicato: `npm run dev` usa trucchi che la CSP bloccherebbe
      // Subito dopo <meta charset>: deve valere prima di qualsiasi script o stile
      transformIndexHtml(html) {
        const charset = '<meta charset="UTF-8">';
        if (!html.includes(charset)) throw new Error('CSP: non trovo <meta charset="UTF-8"> in index.html');
        return html.replace(charset, `${charset}\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">`);
      },
    },
    {
      name: 'pixeltools-pdfjs-assets',
      // npm run dev: li serve direttamente da node_modules
      configureServer(server) {
        const files = pdfjsFiles();
        server.middlewares.use((req, res, next) => {
          const url = decodeURIComponent((req.url ?? '').split('?')[0]);
          const file = url.startsWith(BASE) && files.get(url.slice(BASE.length));
          if (!file) return next();
          res.setHeader('Content-Type', CONTENT_TYPES[path.extname(file)] ?? 'application/octet-stream');
          fs.createReadStream(file).pipe(res);
        });
      },
      // npm run build: li copia nella cartella dist
      generateBundle() {
        for (const [fileName, file] of pdfjsFiles()) {
          this.emitFile({ type: 'asset', fileName, source: fs.readFileSync(file) });
        }
      },
    },
  ],
});
