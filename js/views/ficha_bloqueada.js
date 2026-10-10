/**
 * js/views/ficha_bloqueada.js
 * Ficha de una gota bloqueada por lectura (mapas de Cambios y AMI).
 *
 * Muestra por qué no se puede trabajar, los días del bloqueo alrededor de la
 * lectura (con hoy marcado) y cuándo se libera, más los datos para saber de
 * qué orden se trata.
 */
import { escapeHtml } from '../ui.js';
import { DIAS_BLOQUEO, liberaEl } from '../lectura.js';

const esc = v => escapeHtml(v == null ? '' : String(v));
const CANDADO = '<rect x="3" y="11" width="18" height="11" rx="2" ry="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>';
const svg = (d, n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${n}" height="${n}">${d}</svg>`;

function aFecha(clave) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(clave || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}
const mismoDia = (a, b) => a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
const dSem = d => d.toLocaleDateString('es-SV', { weekday: 'short' }).replace('.', '');
const dLargo = d => d.toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'short' });

/**
 * HTML de la ficha. datos: { titulo ('NC 123' / 'WO 456'), cliente, direccion,
 * fechaLectura ('AAAA-MM-DD'), ruta, etiquetaRuta, extra: [[etiqueta, valor], ...] }
 */
export function fichaBloqueada({ titulo, cliente, direccion, fechaLectura, ruta, etiquetaRuta = 'Ruta de lectura', extra = [] }) {
  const lect = aFecha(fechaLectura);
  const hoy = new Date(); hoy.setHours(0, 0, 0, 0);
  const libre = lect ? liberaEl(fechaLectura) : null;
  const faltan = libre ? Math.round((libre - hoy) / 86400000) : null;

  // Tira de días: los del bloqueo y el primero libre
  let tira = '';
  if (lect) {
    const dias = [];
    for (let i = -DIAS_BLOQUEO; i <= DIAS_BLOQUEO + 1; i++) { const d = new Date(lect); d.setDate(d.getDate() + i); dias.push({ d, i }); }
    tira = `
      <div class="bl-tira">
        ${dias.map(({ d, i }) => {
          const cls = i === 0 ? 'lect' : i > DIAS_BLOQUEO ? 'libre' : 'bloq';
          const tag = i === 0 ? 'Lectura' : i > DIAS_BLOQUEO ? 'Libre' : '';
          return `<div class="bl-dia ${cls} ${mismoDia(d, hoy) ? 'hoy' : ''}">
            <span class="bl-dia-s">${esc(dSem(d))}</span>
            <span class="bl-dia-n">${d.getDate()}</span>
            <span class="bl-dia-t">${mismoDia(d, hoy) ? 'Hoy' : tag}</span>
          </div>`;
        }).join('')}
      </div>`;
  }

  const filas = [
    ['Cliente', cliente],
    [etiquetaRuta, ruta],
    ...extra,
  ].filter(([, v]) => v);

  return `
    <div class="bl-ficha">
      <div class="bl-cab">
        <div class="bl-ico">${svg(CANDADO, 22)}</div>
        <div style="flex:1;min-width:0">
          <div class="bl-eti">${esc(titulo)}</div>
          <div class="bl-tit">Bloqueada por lectura</div>
        </div>
        ${faltan != null && faltan > 0 ? `<div class="bl-cuenta"><b>${faltan}</b>${faltan === 1 ? 'día' : 'días'}</div>` : ''}
      </div>
      <div class="bl-sub">${libre
        ? `No se puede trabajar hasta el <b>${esc(dLargo(libre))}</b>.`
        : 'Está en período de lectura y no se puede trabajar estos días.'}</div>
      ${tira}
      ${direccion ? `<div class="bl-dir">${esc(direccion)}</div>` : ''}
      ${filas.length ? `<div class="bl-info">${filas.map(([k, v]) => `<div class="bl-fila"><span>${esc(k)}</span><span>${esc(v)}</span></div>`).join('')}</div>` : ''}
      <div class="bl-nota">DELSUR está leyendo los medidores de esta zona. Cambiar el medidor en estos días le altera la lectura al cliente.</div>
      <button class="btn-action outline bl-ok" onclick="document.getElementById('mapa-panel')?.classList.remove('open')">Entendido</button>
    </div>`;
}
