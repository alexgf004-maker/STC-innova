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
