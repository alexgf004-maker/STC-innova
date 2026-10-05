/**
 * js/padrones.js
 * Padrones de clientes (nombre, dirección, medidor, coordenadas).
 *
 * Antes eran archivos públicos del sitio (caracterizacion_padron.json y
 * contiguos.json): cualquiera con el enlace podía descargar los datos de
 * miles de clientes sin iniciar sesión. Ahora viven en Firestore, en la
 * colección `padrones`, y las reglas solo dejan leerlos a usuarios activos.
 *
 * Un documento de Firestore admite ~1 MB, así que cada padrón se guarda en
 * partes de texto JSON:
 *   padrones/{nombre}               { partes, total, actualizadoEn, actualizadoPor }
 *   padrones/{nombre}/partes/{000}  { datos: '<JSON de esa parte>' }
 * Un padrón puede ser un arreglo (filas) o un objeto (indexado por NC).
 */
import { db } from './firebase.js';

export const PADRONES = {
  caracterizacion: { titulo: 'Padrón de Caracterización' },
  contiguos:       { titulo: 'Contiguos (Cambios y AMI)' },
};

const MAX_BYTES = 800 * 1024;   // margen bajo el límite de 1 MiB por documento
const cache_ = new Map();       // nombre -> Promise de los datos

const ref = nombre => db.collection('padrones').doc(nombre);

/** Datos del padrón (arreglo u objeto), o null si no está en Firestore. */
export function leerPadron(nombre) {
  if (!cache_.has(nombre)) {
    const p = (async () => {
      const meta = await ref(nombre).get();
      if (!meta.exists || !meta.data().partes) return null;
      const n = meta.data().partes;
      const snap = await ref(nombre).collection('partes').get();
      const partes = snap.docs
        .filter(d => parseInt(d.id, 10) < n)
        .sort((a, b) => a.id.localeCompare(b.id))
        .map(d => JSON.parse(d.data().datos));
      if (partes.length !== n) throw new Error('Padrón incompleto');
      return Array.isArray(partes[0]) ? partes.flat() : Object.assign({}, ...partes);
    })();
    cache_.set(nombre, p);
    p.catch(() => cache_.delete(nombre));   // reintentar la próxima vez
  }
  return cache_.get(nombre);
}

/** Estado de un padrón en Firestore (para el admin). */
export async function infoPadron(nombre) {
  const meta = await ref(nombre).get();
  return meta.exists ? meta.data() : null;
}

// Parte los datos en trozos de texto JSON que quepan en un documento.
function partir(datos) {
  const enc = new TextEncoder();
  const items = Array.isArray(datos) ? datos : Object.entries(datos);
  const armar = trozo => JSON.stringify(Array.isArray(datos) ? trozo : Object.fromEntries(trozo));
  const partes = [];
  let trozo = [], bytes = 2;
  for (const it of items) {
    const b = enc.encode(JSON.stringify(it)).length + 1;
    if (trozo.length && bytes + b > MAX_BYTES) { partes.push(armar(trozo)); trozo = []; bytes = 2; }
    trozo.push(it); bytes += b;
  }
  if (trozo.length || !partes.length) partes.push(armar(trozo));
  return partes;
}

/**
 * Sube (o reemplaza) un padrón completo. Solo admin (las reglas lo exigen).
 * onProgreso(hechas, total) para mostrar avance.
 */
export async function subirPadron(nombre, datos, usuario, onProgreso) {
  if (!datos || typeof datos !== 'object') throw new Error('El archivo no tiene un padrón válido.');
  const partes = partir(datos);
  const anterior = await infoPadron(nombre);
  // Primero se marca como incompleto para que nadie lea a medias.
  await ref(nombre).set({ partes: 0 }, { merge: true });
  for (let i = 0; i < partes.length; i++) {
    await ref(nombre).collection('partes').doc(String(i).padStart(3, '0')).set({ datos: partes[i] });
    onProgreso?.(i + 1, partes.length);
  }
  // Borrar partes sobrantes de una versión anterior más grande.
  for (let i = partes.length; i < (anterior?.total_partes || anterior?.partes || 0) + 5; i++) {
    await ref(nombre).collection('partes').doc(String(i).padStart(3, '0')).delete().catch(() => {});
  }
  await ref(nombre).set({
    partes: partes.length,
    total_partes: partes.length,
    total: Array.isArray(datos) ? datos.length : Object.keys(datos).length,
    actualizadoEn: firebase.firestore.Timestamp.now(),
    actualizadoPor: usuario || '',
  });
  cache_.delete(nombre);
  return partes.length;
}
