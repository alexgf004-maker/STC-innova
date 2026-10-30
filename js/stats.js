/**
 * js/stats.js
 * Maneja el documento resumen en Firestore: stats/resumen
 * Se actualiza cada vez que cambia el estado de una orden o solicitud.
 */

import { db } from './firebase.js';

const STATS_REF = () => db.collection('stats').doc('resumen');

// ── Leer stats (solo 1 documento) ────────────────
export async function leerStats() {
  try {
    const snap = await STATS_REF().get();
    return snap.exists ? snap.data() : null;
  } catch(err) {
    console.warn('[stats] Error leyendo:', err);
    return null;
  }
}

// ── Recalcular y guardar stats ────────────────────
export async function recalcularStats() {
  try {
    const hoy = new Date(); hoy.setHours(0,0,0,0);

    const [cmSnap, otcSnap, solSnap, despSnap] = await Promise.all([
      db.collection('cambios_ordenes').get(),
      db.collection('otc_ordenes').get(),
      db.collection('solicitudes_material').where('estado', '==', 'pendiente').get(),
      db.collection('despachos_pendientes').get(),
    ]);
    // Las que ya tienen el material enviado (esperando que el técnico acepte) ya se atendieron
    const enviadas = new Set(despSnap.docs.map(d => d.data().solicitudId).filter(Boolean));

    const cmDocs = cmSnap.docs.map(d => d.data());

    const cmHechasHoy = cmDocs.filter(d => {
      const f = d.fechaHecha?.toDate?.();
      return f && f >= hoy && (d.estadoCampo === 'hecha' || d.estadoCampo === 'aprobada');
    }).length;

    const cmSinActualizar = cmDocs.filter(d =>
      (d.estadoCampo === 'hecha' || d.estadoCampo === 'aprobada') && !d.actualizadaDelsur
    ).length;

    const cmTotal    = cmDocs.length;
    const cmAprobadas = cmDocs.filter(d => d.estadoCampo === 'aprobada').length;

    const otcActivas = otcSnap.docs.filter(d => d.data().estadoCampo !== 'aprobada').length;

    const stats = {
      cmHechasHoy,
      cmSinActualizar,
      cmTotal,
      cmAprobadas,
      otcActivas,
      solicitudesPendientes: solSnap.docs.filter(d => !enviadas.has(d.id)).length,
      actualizadoEn: firebase.firestore.Timestamp.now(),
    };

    await STATS_REF().set(stats, { merge: true });
    return stats;
  } catch(err) {
    console.warn('[stats] Error recalculando:', err);
    return null;
  }
}

