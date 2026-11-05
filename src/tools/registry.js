/* =============================================================
   PixelTools — src/tools/registry.js
   ELENCO DEI TOOL: da qui nascono la dashboard (le card), i titoli
   delle pagine e il caricamento "a richiesta" di ogni tool.
   Aggiungere un tool = creare la sua cartella + una voce qui sotto.

   Ogni voce:
     id       → nome della cartella e dell'indirizzo (#merge)
     name     → titolo della card
     title    → titolo della scheda del browser ("… — PixelTools")
     desc     → descrizione della card
     section  → sezione della dashboard: pdf · images · pixel · files
     accent   → colore della card (variabile CSS in src/styles/style.css)
     icon     → disegno 16×16 in pixel (contenuto dell'<svg>)
     load     → scarica il tool (tool.js) quando lo apri
     hidden   → (facoltativo) true = niente card nella dashboard: la pagina
                si apre da un link (es. #crediti nel footer)
   ============================================================= */
export const TOOLS = [
  {
    id: 'merge',
    name: 'Unisci PDF',
    title: 'Unisci PDF',
    desc: "Combina più PDF in un unico file, nell'ordine che preferisci.",
    section: 'pdf',
    accent: 'var(--c-merge)',
    icon: `
      <rect x="1" y="1" width="8" height="10"/><rect x="2" y="2" width="6" height="8" fill="#fff"/>
      <rect x="7" y="5" width="8" height="10"/><rect x="8" y="6" width="6" height="8" fill="#fff"/>
      <rect x="10" y="8" width="2" height="4"/><rect x="9" y="9" width="4" height="2"/>`,
    load: () => import('./merge/tool.js'),
  },
  {
    id: 'sign',
    name: 'Firma & Annota',
    title: 'Firma & Annotazioni',
    desc: 'Disegna la firma, aggiungi data e testo e posizionali sul PDF.',
    section: 'pdf',
    accent: 'var(--c-sign)',
    icon: `
      <rect x="1" y="1" width="10" height="14"/><rect x="2" y="2" width="8" height="12" fill="#fff"/>
      <rect x="3" y="4" width="6" height="1"/><rect x="3" y="6" width="4" height="1"/>
      <rect x="3" y="11" width="2" height="1"/><rect x="5" y="10" width="1" height="1"/>
      <rect x="6" y="11" width="1" height="1"/><rect x="7" y="10" width="2" height="1"/>
      <path d="M14 1h1v2h-1v1h-1v1h-1v1h-1v1h-1v1h-2v-2h1v-1h1v-1h1v-1h1v-1h1v-1h1z"/>`,
    load: () => import('./sign/tool.js'),
  },
  {
    id: 'img2pdf',
    name: 'Immagini in PDF',
    title: 'Immagini in PDF',
    desc: 'Trasforma una o più foto JPG/PNG in un documento PDF.',
    section: 'pdf',
    accent: 'var(--c-img2pdf)',
    icon: `
      <rect x="2" y="1" width="12" height="14"/><rect x="3" y="2" width="10" height="12" fill="#fff"/>
      <rect x="5" y="4" width="2" height="2"/>
      <path d="M4 12h8v-2h-1v-1h-1v-1h-1v1h-1v1h-1v-1h-1v1h-1v1h-1z"/>`,
    load: () => import('./img2pdf/tool.js'),
  },
  {
    id: 'convert',
    name: 'Converti & Comprimi',
    title: 'Converti & Comprimi',
    desc: 'Converti tra JPG, PNG e WebP e riduci il peso delle immagini.',
    section: 'images',
    accent: 'var(--c-convert)',
    icon: `
      <rect x="2" y="3" width="9" height="2"/><path d="M10 1h1v1h1v1h1v2h-1v1h-1v1h-1z"/>
      <rect x="5" y="11" width="9" height="2"/><path d="M6 9h-1v1h-1v1h-1v2h1v1h1v1h1z"/>
      <rect x="2" y="5" width="2" height="3"/><rect x="12" y="8" width="2" height="3"/>`,
    load: () => import('./convert/tool.js'),
  },
  {
    id: 'zip',
    name: 'Crea ZIP',
    title: 'Crea ZIP',
    desc: 'Comprimi file e cartelle in un unico archivio .zip.',
    section: 'files',
    accent: 'var(--c-zip)',
    icon: `
      <rect x="1" y="1" width="6" height="3"/>
      <rect x="1" y="3" width="14" height="12"/><rect x="2" y="4" width="12" height="10" fill="#fff"/>
      <rect x="7" y="4" width="2" height="1"/><rect x="8" y="5" width="2" height="1"/>
      <rect x="7" y="6" width="2" height="1"/><rect x="8" y="7" width="2" height="1"/>
      <rect x="7" y="9" width="3" height="3"/><rect x="8" y="10" width="1" height="1" fill="#fff"/>`,
    load: () => import('./zip/tool.js'),
  },
  {
    id: 'crochet',
    name: 'Foto in Uncinetto',
    title: 'Foto in Uncinetto',
    desc: 'Trasforma una foto in uno schema per uncinetto: C2C, filet o punto basso.',
    section: 'pixel',
    accent: 'var(--c-crochet)',
    icon: `
      <rect x="5" y="4" width="5" height="1"/><rect x="4" y="5" width="1" height="1"/><rect x="10" y="5" width="1" height="1"/>
      <rect x="3" y="6" width="1" height="4"/><rect x="11" y="6" width="1" height="4"/>
      <rect x="4" y="10" width="1" height="1"/><rect x="10" y="10" width="1" height="1"/><rect x="5" y="11" width="5" height="1"/>
      <rect x="5" y="6" width="1" height="1"/><rect x="6" y="7" width="1" height="1"/><rect x="7" y="8" width="1" height="1"/><rect x="8" y="9" width="1" height="1"/>
      <rect x="7" y="6" width="1" height="1"/><rect x="8" y="7" width="1" height="1"/><rect x="9" y="8" width="1" height="1"/>
      <rect x="13" y="3" width="1" height="12"/><rect x="14" y="2" width="1" height="1"/><rect x="12" y="4" width="1" height="1"/>`,
    load: () => import('./crochet/tool.js'),
  },
  {
    id: 'pixel',
    name: 'Foto in Pixel Art',
    title: 'Foto in Pixel Art',
    desc: "Palette retrò, dithering e contorno. Ripulisce anche la pixel art fatta con l'AI.",
    section: 'pixel',
    accent: 'var(--c-pixel)',
    icon: `
      <path fill-rule="evenodd" d="M1 1h14v14h-14zM2 2v12h12v-12z"/>
      <rect x="5" y="5" width="2" height="2"/><rect x="9" y="5" width="2" height="2"/>
      <rect x="4" y="9" width="1" height="1"/><rect x="5" y="10" width="6" height="1"/><rect x="11" y="9" width="1" height="1"/>`,
    load: () => import('./pixel/tool.js'),
  },
  {
    id: 'credits',
    title: 'Crediti e licenze',
    hidden: true, // pagina, non un tool: si apre dal link nel footer
    load: () => import('./credits/tool.js'),
  },
];
