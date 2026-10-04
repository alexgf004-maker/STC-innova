/**
 * js/views/etiquetas_mapa.js
 * Etiquetas de los puntos de cerca (NC en AMI, WO en Cambios) sin encimarse.
 *
 * Antes se ponía una por punto y donde hay muchas órdenes juntas los números
 * quedaban unos encima de otros y de los puntos, ilegibles. Ahora se ponen en
 * orden de prioridad (pendientes primero), cada una prueba abajo, arriba, a
 * la derecha o a la izquierda de su punto, y se omite si en ningún lado cabe
 * sin tapar otra etiqueta u otro punto. Al acercar más, hay espacio y van
 * apareciendo las demás.
 */
import { escapeHtml } from '../ui.js';

const ALTO = 17, AIRE = 2, MAXIMO = 80;

function choca(a, b) { return a.x1 < b.x2 && b.x1 < a.x2 && a.y1 < b.y2 && b.y1 < a.y2; }

/**
 * candidatas: [{ latlng, texto, prioridad }] (menor prioridad = va primero).
 * puntos:     [{ latlng, radio }] todos los puntos en pantalla (obstáculos).
 * radio:      radio de los puntos normales.
 * Devuelve los L.marker de las etiquetas que caben (ya agregados al mapa).
 */
export function ponerEtiquetas(map, candidatas, puntos, radio) {
  const ocupado = puntos.map(o => {
    const p = map.latLngToContainerPoint(o.latlng);
    return { x1: p.x - o.radio, x2: p.x + o.radio, y1: p.y - o.radio, y2: p.y + o.radio, latlng: o.latlng };
  });
  const capas = [];
  candidatas
    .map((c, i) => ({ ...c, i }))
    .sort((a, b) => a.prioridad - b.prioridad || a.i - b.i)
    .forEach(c => {
      if (capas.length >= MAXIMO) return;
      const p = map.latLngToContainerPoint(c.latlng);
      const w = String(c.texto).length * 6.3 + 12, d = radio + 3;
      // [x, y] de la esquina superior izquierda de la etiqueta en cada lado
      const lados = [
        [p.x - w / 2, p.y + d],            // abajo
        [p.x - w / 2, p.y - d - ALTO],     // arriba
        [p.x + d + 2, p.y - ALTO / 2],     // derecha
        [p.x - d - 2 - w, p.y - ALTO / 2], // izquierda
      ];
      for (const [x, y] of lados) {
        const caja = { x1: x - AIRE, x2: x + w + AIRE, y1: y - AIRE, y2: y + ALTO + AIRE };
        if (ocupado.some(o => o.latlng !== c.latlng && choca(o, caja))) continue;
        ocupado.push(caja);
        const lbl = L.marker(c.latlng, { interactive: false, keyboard: false, icon: L.divIcon({ className: '', iconSize: [0, 0], html: `
          <div style="position:absolute;left:${Math.round(x - p.x)}px;top:${Math.round(y - p.y)}px;width:${Math.round(w)}px;box-sizing:border-box;text-align:center;white-space:nowrap;
            font-size:10px;font-weight:700;letter-spacing:.02em;line-height:15px;font-family:'Outfit',sans-serif;color:#fff;
            background:rgba(6,10,20,.82);border:1px solid rgba(255,255,255,.16);border-radius:6px;
            box-shadow:0 2px 6px rgba(0,0,0,.45)">${escapeHtml(c.texto)}</div>` }) });
        lbl.addTo(map);
        capas.push(lbl);
        return;
      }
    });
  return capas;
}
