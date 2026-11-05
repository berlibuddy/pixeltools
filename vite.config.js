// Configurazione di Vite: il sito vive su https://berlibuddy.github.io/pixeltools/
import { defineConfig } from 'vite';

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
  "font-src 'self'",             // font ospitati da noi (passo 5d-1)
  "connect-src 'self'",          // il sito non parla con nessun altro server
  "base-uri 'none'",             // nessuno può cambiare l'indirizzo base della pagina
  "form-action 'none'",          // nessun modulo può inviare dati altrove
  "object-src 'none'",           // niente plugin vecchi (Flash & co.)
].join('; ');
// Da aggiungere quando avremo un server nostro (in un <meta> non funzionano):
//   frame-ancestors 'none' (nessun sito può "incorniciarci") e i rapporti dei blocchi.

export default defineConfig({
  base: '/pixeltools/',
  plugins: [{
    name: 'pixeltools-csp',
    apply: 'build', // solo nel sito pubblicato: `npm run dev` usa trucchi che la CSP bloccherebbe
    // Subito dopo <meta charset>: deve valere prima di qualsiasi script o stile
    transformIndexHtml(html) {
      const charset = '<meta charset="UTF-8">';
      if (!html.includes(charset)) throw new Error('CSP: non trovo <meta charset="UTF-8"> in index.html');
      return html.replace(charset, `${charset}\n  <meta http-equiv="Content-Security-Policy" content="${CSP}">`);
    },
  }],
});
