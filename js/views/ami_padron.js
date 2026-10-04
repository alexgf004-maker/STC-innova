/**
 * js/views/ami_padron.js
 * Padrón de NC ya cambiados (colección ami_cambiados, id del doc = NC).
 *
 * Admin/asistente: lo necesitan completo; se lee con el listener compartido
 * (js/vivo.js), así el panel y el mapa no lo vuelven a leer cada vez.
 * Técnico: solo pregunta por los NC de SU ruta (de 30 en 30) y recuerda la
 * respuesta durante la sesión; antes bajaba el padrón entero (miles de NC).
 */
import { db } from '../firebase.js';
import { leer } from '../vivo.js';

const revisados = new Map();   // nc -> true (está en el padrón) | false

export async function padronAmi(esAdmin, ncs = []) {
  if (esAdmin) {
    const lista = await leer('ami_cambiados', () => db.collection('ami_cambiados'));
    return new Set(lista.map(d => String(d.nc ?? d.id).trim()));
  }
  const falta = [...new Set(ncs.map(n => String(n ?? '').trim()).filter(Boolean))]
    .filter(n => !revisados.has(n) && !n.includes('/'));
  const docId = firebase.firestore.FieldPath.documentId();
  for (let k = 0; k < falta.length; k += 30) {
    const lote = falta.slice(k, k + 30);
    const snap = await db.collection('ami_cambiados').where(docId, 'in', lote).get();
    lote.forEach(n => revisados.set(n, false));
    snap.docs.forEach(d => revisados.set(String(d.data().nc ?? d.id).trim(), true));
  }
  return new Set([...revisados].filter(([, v]) => v).map(([k]) => k));
}

// Al marcar NC como cambiados desde la app, recordarlo sin volver a leer.
export function marcarEnPadron(ncs) {
  ncs.forEach(n => revisados.set(String(n ?? '').trim(), true));
}
