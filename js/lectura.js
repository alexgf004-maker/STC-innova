/**
 * js/lectura.js
 * Bloqueo de órdenes por lectura de medidores.
 *
 * Mientras DELSUR lee los medidores de una ruta no se puede cambiar el
 * medidor: la orden se bloquea DIAS_BLOQUEO días antes y después del día de
 * lectura (igual que Cambios con su calendario por MRU).
 *
 * En AMI cada cliente trae su propia fecha ("F. Lectura" del Excel) y se
 * guarda en la orden como fechaLectura: 'AAAA-MM-DD'.
 */

export const DIAS_BLOQUEO = 2;

const dosDig = n => String(n).padStart(2, '0');
const aClave = d => `${d.getFullYear()}-${dosDig(d.getMonth() + 1)}-${dosDig(d.getDate())}`;

/**
 * Fecha de lectura del Excel -> 'AAAA-MM-DD' (o '' si no se entiende).
 * Acepta el número de fecha de Excel (46302), una fecha de JS, 'AAAA-MM-DD'
 * y 'DD/MM/AAAA' (formato de El Salvador).
 */
export function fechaLecturaDe(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date) return isNaN(v) ? '' : aClave(v);
  if (typeof v === 'number' || /^\d{5}(\.\d+)?$/.test(String(v).trim())) {
    const n = Number(v);
    if (n < 20000 || n > 80000) return '';
    // Días desde 1899-12-30 (calendario de Excel), sin zona horaria
    const d = new Date(Math.round((n - 25569) * 86400000));
    return `${d.getUTCFullYear()}-${dosDig(d.getUTCMonth() + 1)}-${dosDig(d.getUTCDate())}`;
  }
  const t = String(v).trim();
  let m = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(t);
  if (m) return `${m[1]}-${dosDig(m[2])}-${dosDig(m[3])}`;
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{2,4})$/.exec(t);
  if (m) {
    const y = m[3].length === 2 ? '20' + m[3] : m[3];
    if (+m[2] >= 1 && +m[2] <= 12 && +m[1] >= 1 && +m[1] <= 31) return `${y}-${dosDig(m[2])}-${dosDig(m[1])}`;
  }
  return '';
}

function aFecha(clave) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(clave || ''));
  return m ? new Date(+m[1], +m[2] - 1, +m[3]) : null;
}

/** ¿Hoy cae dentro de los días de bloqueo alrededor de esa fecha de lectura? */
export function enLectura(fechaLectura, hoy = new Date()) {
  const f = aFecha(fechaLectura);
  if (!f) return false;
  const h = new Date(hoy); h.setHours(0, 0, 0, 0);
  return Math.abs(Math.round((f - h) / 86400000)) <= DIAS_BLOQUEO;
}

/** Día en que se libera (el siguiente al último día de bloqueo). */
export function liberaEl(fechaLectura) {
  const f = aFecha(fechaLectura);
  if (!f) return null;
  f.setDate(f.getDate() + DIAS_BLOQUEO + 1);
  return f;
}

/** "mié 7 oct" */
export function textoFecha(clave) {
  const f = clave instanceof Date ? clave : aFecha(clave);
  return f ? f.toLocaleDateString('es-SV', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
}
