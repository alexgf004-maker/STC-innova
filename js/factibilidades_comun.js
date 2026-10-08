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
// Un solo documento: factibilidades_config/general = { festivos: ['AAAA-MM-DD'], meta }
export const META_DEFECTO = 13;
const DOC_CONFIG = 'general';

function leerConfig(lista) {
  const d = (lista || []).find(x => x.id === DOC_CONFIG) || {};
  const festivos = [...new Set((Array.isArray(d.festivos) ? d.festivos : []).filter(f => /^\d{4}-\d{2}-\d{2}$/.test(f)))].sort();
  const meta = Number(d.meta) > 0 ? Number(d.meta) : META_DEFECTO;
  return { festivos, festivosSet: new Set(festivos), meta };
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
