/* =============================================================
   PixelTools — src/core/images.js
   Aiuti per le immagini con la Canvas API (condivisi da tutti i tool)
   - loadBitmap:   legge un file immagine (rispetta la rotazione delle foto)
   - fileToCanvas: disegna l'immagine su un canvas (ridimensiona, sfondo)
   - canvasToBlob: canvas → file (PNG, JPG, WebP)
   - canEncode:    il browser sa creare questo formato?
   ============================================================= */

/**
 * Decodifica un file immagine. createImageBitmap è veloce e applica
 * l'orientamento EXIF (foto da smartphone); in caso di problemi usa <img>.
 */
export async function loadBitmap(file) {
    if ('createImageBitmap' in window) {
      try { return await createImageBitmap(file, { imageOrientation: 'from-image' }); } catch { /* fallback sotto */ }
    }
    return new Promise((resolve, reject) => {
      const url = URL.createObjectURL(file);
      const img = new Image();
      img.onload = () => { URL.revokeObjectURL(url); resolve(img); };
      img.onerror = () => { URL.revokeObjectURL(url); reject(new Error(`Impossibile leggere l'immagine "${file.name}".`)); };
      img.src = url;
    });
  }
  
  /**
   * Disegna un'immagine su un canvas, opzionalmente ridimensionandola
   * (maxSide = lato lungo massimo in px) e con uno sfondo (utile per JPG,
   * che non supporta la trasparenza).
   */
  export async function fileToCanvas(file, { maxSide = 0, background = null } = {}) {
    const src = await loadBitmap(file);
    let w = src.naturalWidth || src.width;
    let hgt = src.naturalHeight || src.height;
    const longest = Math.max(w, hgt);
    if (maxSide > 0 && longest > maxSide) {
      const ratio = maxSide / longest;
      w = Math.round(w * ratio);
      hgt = Math.round(hgt * ratio);
    }
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = hgt;
    const ctx = canvas.getContext('2d');
    if (background) { ctx.fillStyle = background; ctx.fillRect(0, 0, w, hgt); }
    ctx.imageSmoothingQuality = 'high';
    ctx.drawImage(src, 0, 0, w, hgt);
    src.close?.(); // libera memoria (solo ImageBitmap)
    return canvas;
  }
  
  /** canvas.toBlob in versione Promise */
  export function canvasToBlob(canvas, type, quality) {
    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('Conversione immagine fallita.'))), type, quality);
    });
  }
  
  /** Il browser sa codificare questo formato? (es. WebP su vecchi Safari no) */
  export function canEncode(type) {
    const c = document.createElement('canvas');
    c.width = c.height = 1;
    return c.toDataURL(type).startsWith(`data:${type}`);
  }