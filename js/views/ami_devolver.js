/**
 * js/views/ami_devolver.js
 * Devolver una orden de AMI a pendiente (admin/asistente), por si el técnico
 * se equivocó al marcarla (realizada o visita) o se confirmó por error.
 *
 * Limpia lo que marcó el técnico y la confirmación, y deja constancia de
 * quién la devolvió, cuándo, por qué y en qué estado estaba. Vuelve a salirle
 * como pendiente a su pareja (en el mapa o en el condominio).
 * "Ya cambiado" y "mal ubicado" tienen su propia revisión en el Panel.
 */

import { db } from '../firebase.js';
import { toast } from '../ui.js';

export const ESTADOS_DEVOLVIBLES = ['hecha', 'aprobada', 'visita'];
const ESTADO_TXT = { hecha: 'Realizada', aprobada: 'Confirmada', visita: 'Visita' };

export function puedeDevolverse(o) {
  return !!o && ESTADOS_DEVOLVIBLES.includes(o.estadoCampo);
}

// Devuelve true si se devolvió (el objeto `o` queda actualizado en memoria).
export async function devolverAPendiente(o, session) {
  if (!puedeDevolverse(o)) return false;
  const quien = o.estadoCampo === 'visita' ? o.visitadoPor : o.hechaPor;
  const motivo = prompt(
    `¿Devolver la orden NC ${o.nc || ''}${o.medidor ? ' (medidor ' + o.medidor + ')' : ''} a pendiente?\n\n` +
    `Estaba: ${ESTADO_TXT[o.estadoCampo]}${quien ? ' · marcó ' + quien : ''}${o.estadoCampo === 'aprobada' && o.aprobadoPor ? ' · confirmó ' + o.aprobadoPor : ''}\n` +
    `Volverá a salirle como pendiente a ${o.pareja || 'su pareja'}.\n\n` +
    `Motivo (opcional):`,
    ''
  );
  if (motivo === null) return false;   // canceló

  const datos = {
    estadoCampo: null,
    fechaHecha: null, hechaPor: null, parejaDelDia: null,
    aprobadoPor: null, fechaAprobacion: null,
    fechaVisita: null, visitadoPor: null, motivoVisita: null, observacionVisita: null,
    // Constancia de la devolución
    devueltaPor: session.displayName,
    devueltaEn: firebase.firestore.Timestamp.now(),
    motivoDevolucion: motivo.trim() || null,
    estadoAntesDeDevolver: o.estadoCampo,
    marcadaAntesPor: quien || null,
  };
  try {
    await db.collection('ami_ordenes').doc(o.id).update(datos);
    Object.assign(o, datos);
    toast(`NC ${o.nc || ''} devuelta a pendiente`, 'ok');
    window.dispatchEvent(new CustomEvent('ami:updated'));
    return true;
  } catch (err) {
    toast('Error al devolver: ' + err.message, 'error');
    return false;
  }
}
