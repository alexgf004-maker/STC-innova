/**
 * js/dias_habiles.js
 * Días hábiles y semáforo de Factibilidades. ÚNICA función de cálculo: la
 * usan la lista, el mapa, los inicios y los reportes, para que todos
 * muestren exactamente el mismo número.
 *
 * Reglas (SPEC_Factibilidades.md, sección 5):
 *   - Se cuentan días hábiles desde la fecha de liberación hasta hoy, o hasta
 *     la fecha en que se cerró si la orden ya está cerrada.
 *   - El día de liberación cuenta como día 1 (si es hábil). Una orden
 *     liberada hoy ya tiene 1 día; una liberada en sábado empieza a contar
 *     el lunes.
 *   - No hábiles: sábados, domingos y los festivos (lista 'AAAA-MM-DD' que
 *     mantiene el admin en factibilidades_config).
 *   - Semáforo: 1 a 3 verde, 4 a 5 amarillo, más de 5 rojo.
 *
 * Sin dependencias (ni Firebase ni DOM) para poder probarlo con Node:
 *   TZ=America/El_Salvador node --test tests/*.test.mjs
 * Las fechas se toman en la hora local del teléfono (El Salvador).
 */

export const SEMAFORO = {
  verde:    { color: '#22c55e', pill: 'ok',   texto: 'A tiempo' },
  amarillo: { color: '#fbbf24', pill: 'warn', texto: 'Por vencer' },
  rojo:     { color: '#ef4444', pill: 'crit', texto: 'Atrasada' },
};

// Timestamp de Firestore, Date, milisegundos o texto 'AAAA-MM-DD' -> Date
export function aFecha(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return isNaN(v) ? null : v;
  if (typeof v.toDate === 'function') return v.toDate();
  if (typeof v === 'number') return new Date(v);
  if (typeof v === 'object' && typeof v.seconds === 'number') return new Date(v.seconds * 1000);
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(v).trim());
  if (m) return new Date(+m[1], +m[2] - 1, +m[3]);
  const d = new Date(v);
  return isNaN(d) ? null : d;
}

const dosDig = n => String(n).padStart(2, '0');

/** 'AAAA-MM-DD' del día (hora local). */
export function claveDia(v) {
  const d = aFecha(v);
  return d ? `${d.getFullYear()}-${dosDig(d.getMonth() + 1)}-${dosDig(d.getDate())}` : '';
}

function comoSet(festivos) {
  if (festivos instanceof Set) return festivos;
  return new Set((festivos || []).map(claveDia).filter(Boolean));
}

/** ¿Es día hábil? (ni sábado, ni domingo, ni festivo) */
export function esHabil(v, festivos) {
  const d = aFecha(v);
  if (!d) return false;
  const dow = d.getDay();
  return dow !== 0 && dow !== 6 && !comoSet(festivos).has(claveDia(d));
}

/**
 * Días hábiles entre `desde` y `hasta`, contando ambos extremos.
 * Devuelve 0 si `hasta` es anterior a `desde` o falta alguna fecha.
 */
export function diasHabiles(desde, hasta, festivos) {
  const a = aFecha(desde), b = aFecha(hasta);
  if (!a || !b) return 0;
  const fest = comoSet(festivos);
  const dia = new Date(a.getFullYear(), a.getMonth(), a.getDate());
  const fin = new Date(b.getFullYear(), b.getMonth(), b.getDate());
  let n = 0;
  while (dia <= fin) {
    const dow = dia.getDay();
    if (dow !== 0 && dow !== 6 && !fest.has(claveDia(dia))) n++;
    dia.setDate(dia.getDate() + 1);   // por fecha, no por 24 h: sin saltos raros
  }
  return n;
}

/** 'verde' | 'amarillo' | 'rojo' según los días hábiles. */
export function semaforo(dias) {
  return dias > 5 ? 'rojo' : dias >= 4 ? 'amarillo' : 'verde';
}

/**
 * Días hábiles de una orden: hasta hoy si sigue abierta, hasta su cierre si
 * ya se cerró (queda como tiempo de atención). null si no trae liberación.
 */
export function diasOrden(o, festivos, ahora = new Date()) {
  if (!o || !aFecha(o.fechaLiberacion)) return null;
  const fin = o.estado === 'cerrada' && aFecha(o.fechaHecha) ? o.fechaHecha : ahora;
  return diasHabiles(o.fechaLiberacion, fin, festivos);
}

/** { dias, color: 'verde'|'amarillo'|'rojo'|null } de una orden. */
export function semaforoOrden(o, festivos, ahora = new Date()) {
  const dias = diasOrden(o, festivos, ahora);
  return { dias, color: dias == null ? null : semaforo(dias) };
}
