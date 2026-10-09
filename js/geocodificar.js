/**
 * js/geocodificar.js
 * Coordenadas aproximadas a partir de la dirección, con Google Maps.
 *
 * Hay órdenes (clientes nuevos) que DELSUR manda sin coordenadas. Se ubican
 * por dirección con el Geocoder de la API de Maps JavaScript. Solo se manda
 * la dirección (calle, colonia, población, departamento); nunca el nombre ni
 * otro dato del cliente. El resultado es APROXIMADO.
 *
 * Para no caer en un lugar con el mismo nombre en otra parte del país
 * (cantones y barrios se repiten mucho), cada dirección puede traer una ZONA
 * (departamento + caja de coordenadas): la búsqueda se limita a esa zona y se
 * descarta lo que caiga fuera. Además se prueban varias consultas, de la más
 * detallada a la más general, y nunca se acepta un resultado que sea solo
 * el país o el departamento.
 *
 * La clave se guarda en Firestore (config_privada/google), que solo leen
 * admin y asistente. En la consola de Google la clave debe estar limitada
 * al dominio de la app y a las APIs de Maps JavaScript y Geocoding, con un
 * tope diario de solicitudes.
 */
import { db } from './firebase.js';

const REF = () => db.collection('config_privada').doc('google');
let carga_ = null;

// Zonas de DELSUR (cajas amplias por departamento: [sur, oeste, norte, este]).
export const ZONAS = {
  'San Salvador': [13.55, -89.35, 13.95, -88.95],
  'La Libertad':  [13.45, -89.75, 14.10, -89.15],
  'La Paz':       [13.20, -89.25, 13.75, -88.70],
  'Cuscatlan':    [13.60, -89.15, 14.05, -88.80],
  'San Vicente':  [13.30, -88.95, 13.80, -88.50],
};

// Qué tan precisa fue la ubicación, según el tipo de resultado de Google.
const NIVELES = [
  [['street_address', 'premise', 'subpremise', 'route', 'intersection'], 'calle'],
  [['neighborhood', 'sublocality', 'sublocality_level_1', 'establishment', 'point_of_interest', 'colloquial_area', 'natural_feature'], 'colonia o lugar'],
  [['locality'], 'pueblo o cantón'],
  [['administrative_area_level_3', 'administrative_area_level_2'], 'municipio'],
];
function nivelDe(tipos) {
  for (const [lista, nombre] of NIVELES) if (tipos.some(t => lista.includes(t))) return nombre;
  return null;   // país o departamento: demasiado general, no sirve
}

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
 * Ubica una lista. Cada elemento puede ser un texto (una sola consulta) o
 * { consultas: ['más detallada', …, 'más general'], zona: 'La Paz' }.
 * Devuelve, en el mismo orden, { lat, lng, tipo, nivel } o null.
 */
export async function geocodificar(items, onProgreso) {
  const clave = await leerClave();
  if (!clave) throw new Error('Falta la clave de Google Maps.');
  await cargarGoogle(clave);
  const geo = new google.maps.Geocoder();
  const res = [];
  for (let i = 0; i < items.length; i++) {
    const it = typeof items[i] === 'string' ? { consultas: [items[i]] } : (items[i] || {});
    res.push(await ubicar(geo, it));
    onProgreso?.(i + 1, items.length);
  }
  return res;
}

async function ubicar(geo, { consultas = [], zona = '' }) {
  const caja = ZONAS[zona] || null;
  const dentro = (lat, lng) => !caja || (lat >= caja[0] && lat <= caja[2] && lng >= caja[1] && lng <= caja[3]);
  for (const consulta of consultas.filter(Boolean)) {
    const pedido = { address: consulta, componentRestrictions: { country: 'SV' } };
    if (caja) pedido.bounds = { south: caja[0], west: caja[1], north: caja[2], east: caja[3] };
    const resultados = await pedir(geo, pedido);
    for (const r of resultados) {
      const nivel = nivelDe(r.types || []);
      const lat = r.geometry.location.lat(), lng = r.geometry.location.lng();
      if (nivel && dentro(lat, lng)) return { lat, lng, tipo: r.geometry.location_type || '', nivel };
    }
  }
  return null;
}

async function pedir(geo, pedido, intento = 0) {
  try {
    const { results } = await geo.geocode(pedido);
    return results || [];
  } catch (e) {
    const codigo = e?.code || '';
    if (codigo === 'ZERO_RESULTS') return [];
    // Demasiadas solicitudes seguidas: esperar y reintentar.
    if (codigo === 'OVER_QUERY_LIMIT' && intento < 3) {
      await new Promise(r => setTimeout(r, 1500 * (intento + 1)));
      return pedir(geo, pedido, intento + 1);
    }
    if (codigo === 'REQUEST_DENIED') throw new Error('Google rechazó la solicitud: activa la API de Geocoding para esa clave.');
    return [];
  }
}
