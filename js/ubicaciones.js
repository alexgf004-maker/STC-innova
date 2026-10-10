/**
 * js/ubicaciones.js
 * Ubicar órdenes por NC o medidor con un padrón de coordenadas.
 *
 * Las órdenes de Factibilidades (clientes nuevos) no traen coordenadas, y
 * por dirección (Google) quedaban lejos. Pero casi todas traen en el Texto
 * breve una referencia de algo que ya existe al lado: el medidor del vecino
 * (MD…), su contrato (NC…) o el poste o transformador (DS…, CT…). Con un
 * padrón que diga dónde está cada NC / medidor, el punto queda junto a esa
 * referencia.
 *
 * El padrón "ubicaciones" se sube en Excel desde Padrones de clientes y se
 * guarda compacto: filas [nc, medidor, ds, lat, lng]. Además se aprovechan
 * los padrones que ya existen (Caracterización y Contiguos).
 */
import { leerPadron } from './padrones.js';

const normCab = s => String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/\s+/g, ' ').trim();

// Clave para comparar códigos: sin espacios ni guiones, y si es solo número,
// sin ceros a la izquierda (en un archivo "0012345" y en otro "12345").
function clave(s) {
  const k = String(s ?? '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  return /^\d+$/.test(k) ? k.replace(/^0+(?=\d)/, '') : k;
}

// El padrón de DELSUR trae el medidor con su modelo: "1430749-EM-10 (240V)".
// La referencia del Excel (MD1430749) y el número de serie traen solo el
// número, así que se guarda solo eso.
function claveMedidor(s) {
  const m = String(s ?? '').match(/^\s*(\d+)\s*-/);
  return m ? clave(m[1]) : clave(s);
}

// Dentro de El Salvador (con margen).
const enSV = (lat, lng) => lat > 12.9 && lat < 14.6 && lng > -90.3 && lng < -87.5;

function numero(v) {
  if (typeof v === 'number') return v;
  const n = parseFloat(String(v ?? '').trim().replace(',', '.'));
  return Number.isFinite(n) ? n : NaN;
}

// ── Leer el Excel del padrón ──────────────────────
const CABECERAS = {
  nc:  ['NC', 'CONTRATO', 'CUENTA', 'NIC', 'NUMERO DE CONTRATO', 'N CONTRATO', 'NO. CONTRATO', 'NO CONTRATO', 'CUENTA CONTRATO'],
  md:  ['MD', 'MEDIDOR', 'NUMERO DE SERIE', 'SERIE', 'NO. MEDIDOR', 'NO MEDIDOR', 'N MEDIDOR', 'NUMERO DE MEDIDOR', 'APARATO', 'EQUIPO', 'SERIE MEDIDOR'],
  ds:  ['DS', 'UBIC.TECN.', 'UBIC. TECN.', 'UBICACION TECNICA', 'TRANSFORMADOR', 'CT', 'POSTE'],
  lat: ['LATITUD', 'LAT', 'Y', 'COORD Y', 'COORDENADA Y', 'GPS_LAT'],
  lng: ['LONGITUD', 'LON', 'LNG', 'LONG', 'X', 'COORD X', 'COORDENADA X', 'GPS_LON', 'GPS_LNG'],
  par: ['COORDENADAS', 'COORDENADA', 'UBICACION', 'GPS', 'LAT,LNG', 'LAT, LNG'],
};

function buscarCabecera(rows) {
  for (let i = 0; i < Math.min(rows.length, 10); i++) {
    const H = (rows[i] || []).map(normCab);
    const c = k => H.findIndex(x => CABECERAS[k].includes(x));
    const ix = { nc: c('nc'), md: c('md'), ds: c('ds'), lat: c('lat'), lng: c('lng'), par: c('par') };
    const conCoord = (ix.lat >= 0 && ix.lng >= 0) || ix.par >= 0;
    if (conCoord && (ix.nc >= 0 || ix.md >= 0 || ix.ds >= 0)) return { fila: i, ix, H: rows[i] };
  }
  return null;
}

/**
 * Hojas del libro (cada una como filas de celdas) -> padrón compacto.
 * Devuelve { filas: [[nc, md, ds, lat, lng]…], leidas, descartadas, hojas }
 * o { error }.
 */
export function leerPadronUbicaciones(hojas) {
  const filas = [];
  let leidas = 0, descartadas = 0, usadas = 0, columnas = null;
  for (const rows of hojas) {
    const cab = buscarCabecera(rows);
    if (!cab) continue;
    usadas++;
    // Qué columna se tomó para cada dato (para mostrarlo al subir)
    if (!columnas) columnas = Object.fromEntries(['nc', 'md', 'ds'].map(k => [k, cab.ix[k] >= 0 ? String(cab.H[cab.ix[k]]).trim() : '']));
    const { ix } = cab;
    const v = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
    for (const r of rows.slice(cab.fila + 1)) {
      if (!r || !r.length) continue;
      const nc = clave(v(r, ix.nc)), md = claveMedidor(v(r, ix.md)), ds = clave(v(r, ix.ds));
      if (!nc && !md && !ds) continue;
      leidas++;
      let lat, lng;
      if (ix.lat >= 0 && ix.lng >= 0) { lat = numero(r[ix.lat]); lng = numero(r[ix.lng]); }
      else {
        // "13.7, -89.2" o, con coma decimal, "13,7 -89,2"
        const t = v(r, ix.par);
        const p = (t.includes('.') ? t.split(/[,;\s]+/) : t.split(/[;\s]+/)).filter(Boolean);
        lat = numero(p[0]); lng = numero(p[1]);
      }
      // Columnas cruzadas (latitud en la de longitud): se corrige solo.
      if (!enSV(lat, lng) && enSV(lng, lat)) [lat, lng] = [lng, lat];
      if (!enSV(lat, lng)) { descartadas++; continue; }
      filas.push([nc, md, ds, Math.round(lat * 1e6) / 1e6, Math.round(lng * 1e6) / 1e6]);
    }
  }
  if (!usadas) return { error: 'No se encontraron columnas de NC o medidor junto con Latitud y Longitud (o Coordenadas).' };
  if (!filas.length) return { error: `Se leyeron ${leidas} filas pero ninguna con coordenadas dentro de El Salvador. Si las coordenadas vienen en otro sistema (no grados decimales), avísame.` };
  return { filas, leidas, descartadas, hojas: usadas, columnas };
}

// ── Índice para buscar ────────────────────────────
// Un mismo DS alimenta a varios clientes: se toma el centro de todos.
function nuevoIndice() {
  const nc = new Map(), md = new Map(), ds = new Map();
  const poner = (mapa, k, lat, lng) => {
    if (!k || !enSV(lat, lng)) return;
    const p = mapa.get(k);
    if (p) { p.lat += lat; p.lng += lng; p.n++; } else mapa.set(k, { lat, lng, n: 1 });
  };
  return {
    nc, md, ds,
    agregar(n, m, d, lat, lng) {
      lat = numero(lat); lng = numero(lng);
      poner(nc, clave(n), lat, lng); poner(ds, clave(d), lat, lng);
      const mk = claveMedidor(m);
      poner(md, mk, lat, lng);
      // Padrón subido antes de separar el modelo: "1430749EM10240V" -> 1430749
      const pre = mk.match(/^(\d+)[A-Z]/);
      if (pre) poner(md, clave(pre[1]), lat, lng);
    },
  };
}

let indice_ = null, conContiguos_ = false;

/**
 * Carga el índice. Primero el padrón de ubicaciones y Caracterización; el de
 * Contiguos (el más pesado) solo si `faltan(indice)` dice que sigue habiendo
 * órdenes sin encontrar. Devuelve { indice, fuentes: [...] }.
 */
export async function cargarIndiceUbicaciones(faltan) {
  if (!indice_) {
    const idx = nuevoIndice();
    const fuentes = [];
    const [ubic, crc] = await Promise.all([
      leerPadron('ubicaciones').catch(() => null),
      leerPadron('caracterizacion').catch(() => null),
    ]);
    let resumen = null;
    if (Array.isArray(ubic)) {
      ubic.forEach(r => idx.agregar(r[0], r[1], r[2], r[3], r[4]));
      fuentes.push('ubicaciones');
      resumen = { filas: ubic.length, nc: 0, md: 0, ds: 0 };
      ubic.forEach(r => { if (r[0]) resumen.nc++; if (r[1]) resumen.md++; if (r[2]) resumen.ds++; });
    }
    if (crc) { (Array.isArray(crc) ? crc : Object.values(crc)).forEach(r => idx.agregar(r.nc, r.medidor, r.ds, r.lat, r.lng)); fuentes.push('caracterizacion'); }
    indice_ = { indice: idx, fuentes, resumen };
  }
  if (!conContiguos_ && (!faltan || faltan(indice_.indice))) {
    const cont = await leerPadron('contiguos').catch(() => null);
    // Contiguos: [nc, nombre, direccion, marca, aparato, lat, lng]
    if (Array.isArray(cont)) {
      cont.forEach(r => indice_.indice.agregar(r[0], r[4], '', r[5], r[6]));
      indice_.fuentes.push('contiguos');
      conContiguos_ = true;
    }
  }
  return indice_;
}

/** Olvidar el índice (por ejemplo, después de subir un padrón nuevo). */
export function olvidarIndiceUbicaciones() { indice_ = null; conContiguos_ = false; }

function buscarEn(mapa, codigo) {
  const k = clave(codigo);
  if (!k) return null;
  const p = mapa.get(k) || mapa.get(clave(k.replace(/^[A-Z]+/, '')));
  return p ? { lat: p.lat / p.n, lng: p.lng / p.n } : null;
}

/**
 * Busca dónde ubicar una orden, de lo más exacto a lo más general:
 * su propio NC o medidor, la referencia del vecino (MD/NC/DS/CT) y por último
 * la ubicación técnica (DS) de la orden.
 * Devuelve { lat, lng, exacta, fuente } o null.
 */
export function ubicarPorCodigos(idx, { nc, medidor, referencia, ds }) {
  const r = (p, exacta, fuente) => (p ? { ...p, exacta, fuente } : null);
  const ref = clave(referencia);
  const pref = (ref.match(/^[A-Z]+/) || [''])[0];
  const deRef = () => {
    if (!ref) return null;
    if (pref === 'MD') return r(buscarEn(idx.md, ref), false, 'medidor del vecino');
    if (pref === 'NC') return r(buscarEn(idx.nc, ref), false, 'contrato del vecino');
    if (pref === 'DS' || pref === 'CT') return r(buscarEn(idx.ds, ref) || buscarEn(idx.md, ref), false, 'poste o transformador de referencia');
    return r(buscarEn(idx.md, ref), false, 'medidor del vecino')
      || r(buscarEn(idx.nc, ref), false, 'contrato del vecino')
      || r(buscarEn(idx.ds, ref), false, 'poste o transformador de referencia');
  };
  return r(buscarEn(idx.nc, nc), true, 'contrato del cliente')
    || r(buscarEn(idx.md, medidor), true, 'medidor del cliente')
    || deRef()
    || r(buscarEn(idx.ds, ds), false, 'transformador de la orden');
}

/**
 * Por qué una orden no se pudo ubicar: no trae ninguna referencia, solo trae
 * un poste o transformador (DS), o trae medidor / contrato que no está en el
 * padrón.
 */
export function motivoSinUbicar({ nc, medidor, referencia, ds }) {
  const ref = clave(referencia);
  const pref = (ref.match(/^[A-Z]+/) || [''])[0];
  const refEsDS = /^(DS|CT)/.test(pref);
  if (clave(nc) || clave(medidor) || (ref && /\d/.test(ref) && !refEsDS)) return 'medidor o contrato';
  if ((ref && refEsDS) || clave(ds)) return 'poste';
  return 'ninguna';
}
