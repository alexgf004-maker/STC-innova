/**
 * js/views/orden_duplicada.js
 * "Generar orden" en campo: antes se podía registrar dos veces la misma
 * WO/NC (o una que ya existía de la lista de DELSUR) y quedaba duplicada,
 * contando doble en el avance. Esto busca si ya existe (1 lectura).
 */
import { db } from '../firebase.js';

const ESTADO_TXT = { hecha: 'realizada', aprobada: 'confirmada', visita: 'con visita', ya_cambiado: 'reportada como ya cambiada', mal_ubicado: 'mal ubicada' };

/** Devuelve un mensaje de error si ya existe una orden con ese valor; null si no (o sin señal). */
export async function avisoOrdenDuplicada(coleccion, campo, valor, etiqueta) {
  try {
    const snap = await db.collection(coleccion).where(campo, '==', valor).limit(1).get();
    if (snap.empty) return null;
    const o = snap.docs[0].data();
    const estado = ESTADO_TXT[o.estadoCampo] || 'pendiente';
    const quien = o.pareja ? ` (${o.pareja})` : '';
    return `Ya existe una orden con ${etiqueta} ${valor}${quien}, ${estado}. No se registra de nuevo: márcala desde su punto en el mapa o avisa a la oficina.`;
  } catch {
    return null;   // sin señal: no bloquear el registro
  }
}
