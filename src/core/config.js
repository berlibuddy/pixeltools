/* =============================================================
   PixelTools — src/core/config.js
   Impostazioni comuni (condivise da più tool)
   ============================================================= */
   export const CONFIG = {
    // pdf.js lavora in un "worker" separato: deve avere la STESSA versione del file principale
    pdfjsWorker: 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js',
    // A4 in punti PDF (1 pt = 1/72 di pollice)
    a4: [595.28, 841.89],
  };