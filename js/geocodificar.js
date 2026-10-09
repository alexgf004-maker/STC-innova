/**
 * js/geocodificar.js
 * Coordenadas aproximadas a partir de la dirección, con Google Maps.
 *
 * Hay órdenes (clientes nuevos) que DELSUR manda sin coordenadas. Se ubican
 * por dirección con el Geocoder de la API de Maps JavaScript. Solo se manda
 * la dirección (calle, distrito, población); nunca el nombre ni otro dato del
 * cliente. El resultado es APROXIMADO: en cantones o caseríos suele caer en
 * el centro del lugar, no en la casa.
 *
 * La clave se guarda en Firestore (config_privada/google), que solo leen
 * admin y asistente. En la consola de Google la clave debe estar limitada
 * al dominio de la app y a las APIs de Maps JavaScript y Geocoding, con un
 * tope diario de solicitudes.
 */
import { db } from './firebase.js';

const REF = () => db.collection('config_privada').doc('google');
let carga_ = null;

export async function leerClave() {
  const d = await REF().get();
  return d.exists ? (d.data().clave || '') : '';
}

export async function guardarClave(clave) {
  await REF().set({ clave: String(clave || '').trim() }, { merge: true });
  carga_ = null;
}

function cargarGoogle(clave) {
  if (window.google?.maps?.Geocoder) return Promise.resolve();
  if (!carga_) {
    carga_ = new Promise((resolve, reject) => {
      const cb = '__gmapsListo_' + Date.now();
      window[cb] = () => { delete window[cb]; resolve(); };
      window.gm_authFailure = () => reject(new Error('Google rechazó la clave (revisa que esté activa y permitida para este sitio).'));
      const s = document.createElement('script');
      s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(clave)}&callback=${cb}&loading=async&language=es&region=SV`;
      s.async = true;
      s.onerror = () => reject(new Error('No se pudo cargar Google Maps. Revisa la conexión.'));
      document.head.appendChild(s);
    });
    carga_.catch(() => { carga_ = null; });
  }
  return carga_;
}

/**
 * Ubica una lista de direcciones. Devuelve, en el mismo orden,
 * { lat, lng, tipo } o null si no se encontró. onProgreso(hechas, total).
 */
export async function geocodificar(direcciones, onProgreso) {
  const clave = await leerClave();
  if (!clave) throw new Error('Falta la clave de Google Maps.');
  await cargarGoogle(clave);
  const geo = new google.maps.Geocoder();
  const res = [];
  for (let i = 0; i < direcciones.length; i++) {
    res.push(await uno(geo, direcciones[i]));
    onProgreso?.(i + 1, direcciones.length);
  }
  return res;
}

async function uno(geo, direccion, intento = 0) {
  if (!direccion) return null;
  try {
    const { results } = await geo.geocode({ address: direccion, componentRestrictions: { country: 'SV' } });
    const r = results?.[0];
    if (!r) return null;
    return { lat: r.geometry.location.lat(), lng: r.geometry.location.lng(), tipo: r.geometry.location_type || '' };
  } catch (e) {
    const codigo = e?.code || '';
    if (codigo === 'ZERO_RESULTS') return null;
    // Demasiadas solicitudes seguidas: esperar y reintentar.
    if (codigo === 'OVER_QUERY_LIMIT' && intento < 3) {
      await new Promise(r => setTimeout(r, 1500 * (intento + 1)));
      return uno(geo, direccion, intento + 1);
    }
    if (codigo === 'REQUEST_DENIED') throw new Error('Google rechazó la solicitud: activa la API de Geocoding para esa clave.');
    return null;
  }
}
