/**
 * js/vivo.js
 * Datos en vivo compartidos entre pantallas.
 *
 * Antes cada pantalla leía la colección completa por su cuenta: el panel de
 * Cambios con .get(), el mapa con su propio onSnapshot, el inicio del técnico
 * otra vez con .get()... y al volver a entrar, todo de nuevo. Con miles de
 * órdenes eso son miles de lecturas cada vez.
 *
 * Aquí hay UN listener por consulta (por ejemplo "cambios_ordenes" o
 * "cambios_ordenes de la Pareja 2") que comparten todas las pantallas:
 *   - La primera vez se lee la colección; después solo llegan (y se cobran)
 *     los documentos que cambian.
 *   - Al salir de la pantalla el listener sigue vivo un rato (CERRAR_TRAS_MS),
 *     así ir del panel al mapa y volver no cuesta lecturas.
 *   - Si nadie lo usa en ese tiempo se cierra. Al reabrirlo antes de 30 min,
 *     Firestore (con la persistencia activada en firebase.js) solo cobra lo
 *     que cambió mientras estuvo cerrado.
 */

const CERRAR_TRAS_MS = 15 * 60 * 1000;
const canales = new Map();   // clave -> canal

function abrir(clave, crearQuery) {
  const c = { datos: new Map(), listo: false, subs: new Set(), unsub: null, timer: null };
  canales.set(clave, c);
  c.unsub = crearQuery().onSnapshot(snap => {
    const cambios = [];
    snap.docChanges().forEach(ch => {
      const d = { id: ch.doc.id, ...ch.doc.data() };
      if (ch.type === 'removed') c.datos.delete(d.id); else c.datos.set(d.id, d);
      cambios.push({ type: ch.type, doc: d, local: ch.doc.metadata.hasPendingWrites });
    });
    c.listo = true;
    const lista = [...c.datos.values()];
    [...c.subs].forEach(fn => { try { fn(lista, cambios, null); } catch (e) { console.error('[vivo]', e); } });
  }, err => {
    console.warn('[vivo] Error en', clave, err.message);
    [...c.subs].forEach(fn => { try { fn(null, [], err); } catch {} });
    cerrar(clave);
  });
  return c;
}

function cerrar(clave) {
  const c = canales.get(clave);
  if (!c) return;
  clearTimeout(c.timer);
  try { c.unsub && c.unsub(); } catch {}
  canales.delete(clave);
}

/**
 * Escucha una consulta compartida.
 * cb(lista, cambios, error): lista = todos los documentos ({id, ...datos});
 * cambios = [{type:'added'|'modified'|'removed', doc, local}]. La primera
 * llamada trae todo como 'added'. Devuelve la función para dejar de escuchar.
 */
export function suscribir(clave, crearQuery, cb) {
  let c = canales.get(clave) || abrir(clave, crearQuery);
  clearTimeout(c.timer);
  c.subs.add(cb);
  if (c.listo) {
    const lista = [...c.datos.values()];
    try { cb(lista, lista.map(doc => ({ type: 'added', doc, local: false })), null); } catch (e) { console.error('[vivo]', e); }
  }
  return () => {
    c.subs.delete(cb);
    if (!c.subs.size) {
      clearTimeout(c.timer);
      c.timer = setTimeout(() => { if (!c.subs.size) cerrar(clave); }, CERRAR_TRAS_MS);
    }
  };
}

/**
 * Lee una vez (para paneles y listas): devuelve la lista actual. Si el
 * listener ya está abierto no cuesta lecturas; si no, lo abre y lo deja vivo
 * un rato para la siguiente pantalla.
 */
export function leer(clave, crearQuery) {
  return new Promise((resolve, reject) => {
    let off = null, hecho = false;
    const cb = (lista, _c, err) => {
      if (hecho) return;
      hecho = true;
      if (off) off(); else setTimeout(() => off && off(), 0);
      err ? reject(err) : resolve(lista);
    };
    off = suscribir(clave, crearQuery, cb);
    if (hecho) off();
  });
}

/** Lista actual de una consulta si su listener ya está abierto y listo; si no, null. */
export function actual(clave) {
  const c = canales.get(clave);
  return c && c.listo ? [...c.datos.values()] : null;
}

/**
 * Técnicos activos (para "personal de hoy" y las parejas en campo de cada
 * área). Lo comparten el inicio, los paneles y los mapas de oficina.
 */
export function tecnicosActivos(db) {
  return leer('users|tecnicos-activos', () => db.collection('users').where('role', '==', 'tecnico').where('active', '==', true));
}
