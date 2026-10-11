/**
 * js/factibilidades_comun.js
 * Datos compartidos del área Factibilidades (lista, mapa e inicios).
 *
 * Lecturas cuidadas (plan Blaze): solo se escuchan las órdenes ABIERTAS
 * (estado null o 'visita'), con un listener compartido por js/vivo.js. El
 * técnico solo escucha las suyas. El histórico de cerradas no se lee.
 *
 * Importante para el importador: toda orden nueva debe guardarse con
 * `estado: null` explícito; Firestore no encuentra con == null los
 * documentos a los que les falta el campo.
 */

import { db } from './firebase.js';
import { suscribir } from './vivo.js';
import { semaforoOrden } from './dias_habiles.js';

export const COL_ORDENES = 'factibilidades_ordenes';
export const COL_CONFIG  = 'factibilidades_config';
export const AREA        = 'Factibilidades';

// Una consulta por estado abierto (null y 'visita'); se juntan en el cliente.
function consultasAbiertas(session) {
  const base = () => {
    let q = db.collection(COL_ORDENES);
    if (session.role === 'tecnico') q = q.where('asignadoUid', '==', session.uid);
    return q;
  };
  const sufijo = session.role === 'tecnico' ? session.uid : '*';
  return [
    [`${COL_ORDENES}|abiertas|${sufijo}`, () => base().where('estado', '==', null)],
    [`${COL_ORDENES}|visitas|${sufijo}`,  () => base().where('estado', '==', 'visita')],
  ];
}

/**
 * Escucha las órdenes abiertas (del técnico o de todos, según el rol).
 * cb(lista, error). Devuelve la función para dejar de escuchar.
 */
export function suscribirAbiertas(session, cb) {
  const partes = consultasAbiertas(session).map(() => null);
  const offs = consultasAbiertas(session).map(([clave, crear], i) => suscribir(clave, crear, (lista, _c, err) => {
    if (err) { cb(null, err); return; }
    partes[i] = lista;
    // Al pasar de abierta a visita la orden puede estar un instante en las dos.
    if (partes.every(Boolean)) cb([...new Map(partes.flat().map(o => [o.id, o])).values()], null);
  }));
  return () => offs.forEach(off => off());
}

// ── Configuración (festivos y meta diaria) ────────
// Un solo documento: factibilidades_config/general = { festivos: ['AAAA-MM-DD'], meta,
//   modoAtrasadas: { uid: true }, radioCercanas }
export const META_DEFECTO = 13;
export const RADIO_CERCANAS_DEFECTO = 300;   // metros
const DOC_CONFIG = 'general';

function leerConfig(lista) {
  const d = (lista || []).find(x => x.id === DOC_CONFIG) || {};
  const festivos = [...new Set((Array.isArray(d.festivos) ? d.festivos : []).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f)))].sort();
  const meta = Number(d.meta) > 0 ? Number(d.meta) : META_DEFECTO;
  const modoAtrasadas = d.modoAtrasadas && typeof d.modoAtrasadas === 'object' ? d.modoAtrasadas : {};
  const radioCercanas = Number(d.radioCercanas) > 0 ? Number(d.radioCercanas) : RADIO_CERCANAS_DEFECTO;
  return { festivos, festivosSet: new Set(festivos), meta, modoAtrasadas, radioCercanas };
}

// ── Modo atrasadas (por técnico) ──────────────────
// Para que se atiendan las órdenes viejas: el técnico con este modo solo ve
// sus atrasadas (rojas) y las que estén cerca de alguna de ellas, aunque sean
// nuevas, para que las haga de paso. Si ya no tiene atrasadas, se le muestran
// las por vencer (amarillas) con sus cercanas; si tampoco, todas.
const metros = (a, b) => {
  const R = 6371000, rad = Math.PI / 180;
  const dLat = (b[0] - a[0]) * rad, dLng = (b[1] - a[1]) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
};
const punto = o => { const p = [parseFloat(o.latitud), parseFloat(o.longitud)]; return isFinite(p[0]) && isFinite(p[1]) ? p : null; };

/**
 * Órdenes que ve el técnico. Devuelve { lista, foco } donde foco es null si
 * el modo está apagado, o { nivel: 'rojo'|'amarillo'|null, base, cercanas,
 * cercanasIds } (nivel null = ya no le quedan rojas ni amarillas: ve todo).
 */
export function aplicarModoAtrasadas(lista, cfg, uid) {
  if (!cfg?.modoAtrasadas?.[uid]) return { lista, foco: null };
  const color = o => semaforoOrden(o, cfg.festivosSet).color;
  const nivel = lista.some(o => color(o) === 'rojo') ? 'rojo' : lista.some(o => color(o) === 'amarillo') ? 'amarillo' : null;
  if (!nivel) return { lista, foco: { nivel: null, base: 0, cercanas: 0, cercanasIds: new Set() } };
  const base = lista.filter(o => color(o) === nivel);
  const puntosBase = base.map(punto).filter(Boolean);
  const radio = cfg.radioCercanas || RADIO_CERCANAS_DEFECTO;
  const cercanas = lista.filter(o => {
    if (color(o) === nivel) return false;
    const p = punto(o);
    return !!p && puntosBase.some(b => metros(p, b) <= radio);
  });
  return {
    lista: [...base, ...cercanas],
    foco: { nivel, base: base.length, cercanas: cercanas.length, cercanasIds: new Set(cercanas.map(o => o.id)) },
  };
}

/** Texto corto del modo para el técnico: "Modo atrasadas: 12 atrasadas · 4 cercanas". */
export function textoModoAtrasadas(foco) {
  if (!foco) return '';
  if (!foco.nivel) return 'Modo atrasadas: ya no tienes atrasadas ni por vencer. Ves todas tus órdenes.';
  const n = foco.base;
  const que = foco.nivel === 'rojo' ? (n === 1 ? 'atrasada' : 'atrasadas') : 'por vencer';
  return `Modo atrasadas: ves solo ${n === 1 ? 'tu orden' : `tus ${n} órdenes`} ${que}`
    + (foco.cercanas ? ` y ${foco.cercanas} cercana${foco.cercanas !== 1 ? 's' : ''} a ellas` : '')
    + (foco.nivel === 'amarillo' ? ' (ya no tienes atrasadas)' : '') + '.';
}

/** cb(config) con { festivos, festivosSet, meta }; si falla, la config por defecto. */
export function suscribirConfig(cb) {
  return suscribir(COL_CONFIG, () => db.collection(COL_CONFIG), (lista, _c, err) => {
    if (err) console.warn('[factibilidades] config:', err.message);
    cb(leerConfig(err ? [] : lista));
  });
}

export function guardarConfig(datos) {
  return db.collection(COL_CONFIG).doc(DOC_CONFIG).set(datos, { merge: true });
}

// ── Cerradas del período ──────────────────────────
// Solo las cerradas desde `desde` (hoy para el técnico, el mes para la
// oficina): nunca el histórico completo. Un solo filtro de rango sobre
// fechaHecha (no necesita índice compuesto); el técnico filtra las suyas en
// el teléfono, son pocas (las cerradas de hoy).
export function suscribirCerradas(session, desde, cb) {
  const d = new Date(desde.getFullYear(), desde.getMonth(), desde.getDate());
  const clave = `${COL_ORDENES}|cerradas|${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  return suscribir(clave,
    () => db.collection(COL_ORDENES).where('fechaHecha', '>=', firebase.firestore.Timestamp.fromDate(d)),
    (lista, _c, err) => {
      if (err) { cb(null, err); return; }
      const cerradas = lista.filter(o => o.estado === 'cerrada');
      cb(session.role === 'tecnico' ? cerradas.filter(o => o.asignadoUid === session.uid) : cerradas, null);
    });
}
