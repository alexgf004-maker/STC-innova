/**
 * js/views/caracterizacion_mapa.js
 * Mapa de Caracterización de la Carga para el técnico.
 *
 * Cada orden empieza mostrando solo el TITULAR. Al tocarlo:
 *   - "Hecha aquí"  -> cierra la orden (logró = titular)
 *   - "No pude"     -> revela el Suplente 1 (con línea al titular)
 * Y así en cascada: Suplente 1 -> Suplente 2. Si tampoco el 2,
 * la orden queda "no hecha".
 *
 * Reutiliza el patrón de Cambios: Leaflet + Google tiles + GPS +
 * "Buscar contiguos" (contiguos.json).
 */

import { db } from '../firebase.js';
import { toast } from '../ui.js';

let map_ = null;
let session_ = null;
let container_ = null;
let role_ = null;
let esAdmin_ = false;
let ordenes_ = [];
let markers_ = {};          // ordenId -> { titular, suplente1, suplente2, linea }
let selected_ = null;       // { ordenId, nivel }  nivel: 'titular'|'suplente1'|'suplente2'
let geoMarker_ = null, geoCircle_ = null, watchId_ = null;

// Modo zona (admin)
let puntos_ = [], poliPreview_ = null, zonaPoligono_ = null;

// Contiguos (idéntico a Cambios)
let markersContiguos_ = [];
let contiguosData_ = null, contiguosIndex_ = null, contiguosLoading_ = false;

const NIVEL_LABEL = { titular:'Titular', suplente1:'Suplente 1', suplente2:'Suplente 2' };
const NIVEL_COLOR = { titular:'#a78bfa', suplente1:'#fbbf24', suplente2:'#f472b6' };

export async function init(container, session) {
  container_ = container;
  session_ = session;
  role_ = session.role;
  esAdmin_ = (session.role === 'admin' || session.role === 'asistente');
  container.scrollTop = 0;
  container.innerHTML = `
    <div style="position:relative;width:100%;height:calc(100vh - 132px);min-height:420px">
      <div id="crc-leaflet" style="position:absolute;inset:0;background:#0d1117"></div>

      <div style="position:absolute;top:12px;left:12px;right:12px;z-index:500;display:flex;gap:8px;align-items:center;pointer-events:none">
        <div style="background:rgba(13,17,23,.9);border:1px solid var(--border);border-radius:12px;padding:8px 14px;pointer-events:auto">
          <div style="font-size:12px;font-weight:800">Caracterización</div>
          <div style="font-size:10px;color:var(--text-4)" id="crc-map-stat">Cargando…</div>
        </div>
        <div style="flex:1"></div>
        ${esAdmin_ ? `<button id="crc-zona" style="pointer-events:auto;height:40px;padding:0 14px;border-radius:12px;border:1px solid rgba(167,139,250,.5);background:rgba(13,17,23,.9);color:#a78bfa;font-size:12px;font-weight:700;display:flex;align-items:center;gap:6px;cursor:pointer;font-family:inherit">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><polygon points="12 2 15 8.3 22 9.3 17 14 18 21 12 17.8 6 21 7 14 2 9.3 9 8.3 12 2"/></svg>
          Asignar zona
        </button>` : `
        <button id="crc-gps" style="pointer-events:auto;width:40px;height:40px;border-radius:12px;border:1px solid var(--border);background:rgba(13,17,23,.9);color:#3b82f6;display:flex;align-items:center;justify-content:center;cursor:pointer">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
        </button>`}
      </div>

      <!-- Hoja de detalle del punto (técnico) -->
      <div id="crc-sheet" style="position:absolute;left:0;right:0;bottom:0;z-index:600;transform:translateY(110%);transition:transform .25s ease;background:#0d1117;border-top:1px solid var(--border);border-radius:20px 20px 0 0;padding:18px 20px 26px;max-height:70vh;overflow-y:auto"></div>

      <!-- Hoja de asignación de zona (admin) -->
      <div id="crc-sheet-zona" style="position:absolute;left:0;right:0;bottom:0;z-index:600;transform:translateY(110%);transition:transform .25s ease;background:#0d1117;border-top:1px solid var(--border);border-radius:20px 20px 0 0;padding:18px 20px 26px;max-height:70vh;overflow-y:auto"></div>
    </div>`;

  await cargarOrdenes();
  initMap();

  if (esAdmin_) {
    container.querySelector('#crc-zona').onclick = activarModoZona;
  } else {
    initGPS();
    container.querySelector('#crc-gps').onclick = () => {
      if (geoMarker_) map_.setView(geoMarker_.getLatLng(), 17);
      else toast('Buscando tu ubicación…', 'ok');
    };
  }
}

export function cleanup() {
  if (watchId_ != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId_);
  watchId_ = null;
  document.getElementById('crc-cerrar-poli')?.remove();
  if (map_) { try { map_.remove(); } catch {} map_ = null; }
  markers_ = {}; selected_ = null; geoMarker_ = null; geoCircle_ = null; puntos_ = [];
}

async function cargarOrdenes() {
  try {
    // El técnico ve las órdenes de su pareja/asignación; por ahora todas las pendientes
    const snap = await db.collection('caracterizacion_ordenes').get();
    ordenes_ = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  } catch (err) {
    toast('Error cargando órdenes: ' + err.message, 'error');
    ordenes_ = [];
  }
}

function initMap() {
  const conPuntos = ordenes_.filter(o => o.titular?.lat != null);
  const center = conPuntos.length ? [conPuntos[0].titular.lat, conPuntos[0].titular.lng] : [13.7942, -88.8965];
  const zoom = conPuntos.length ? 14 : 8;

  map_ = L.map('crc-leaflet', {
    center, zoom, zoomControl: false, attributionControl: false,
    rotate: true, touchRotate: true, rotateControl: false,
  });

  L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 20, attribution: '© Google', keepBuffer: 4,
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  }).addTo(map_).on('tileerror', () => {});

  // Pintar solo los titulares al inicio (cascada)
  ordenes_.forEach(o => pintarOrden(o));
  updateStat();
}

// Pinta una orden según su estado. Muestra el titular; si la orden ya
// avanzó en la cascada (nivel intentado), muestra hasta ahí.
function pintarOrden(o) {
  quitarMarcadores(o.id);
  markers_[o.id] = {};

  // ADMIN: un solo pin por orden (el titular), coloreado por pareja.
  // El foco es asignar zonas, no la cascada.
  if (esAdmin_) {
    const t = o.titular;
    if (!t || t.lat == null) return;
    const cerrada = o.estado === 'hecha' || o.estado === 'no_hecha';
    let color = '#64748b';                    // sin asignar: gris
    if (cerrada) color = o.estado === 'hecha' ? '#22c55e' : '#ef4444';
    else if (o.pareja) color = colorPareja(o.pareja);
    const m = crearMarcador(t, color, o.pareja ? String(o.pareja).replace(/\D/g,'') || 'P' : '', !cerrada);
    m.on('click', () => abrirAsignarIndividual(o.id));
    m.addTo(map_); markers_[o.id].titular = m;
    return;
  }

  // TÉCNICO: cascada. Si está cerrada, un punto resumen.
  if (o.estado === 'hecha' || o.estado === 'no_hecha') {
    const donde = o.logranoEn && o[o.logranoEn] ? o[o.logranoEn] : o.titular;
    if (donde?.lat != null) {
      const m = crearMarcador(donde, o.estado === 'hecha' ? '#22c55e' : '#ef4444', o.estado === 'hecha' ? '&#10003;' : '&#10007;', true);
      m.on('click', () => abrirDetalle(o.id, o.logranoEn || 'titular'));
      m.addTo(map_); markers_[o.id].cerrada = m;
    }
    return;
  }

  const nivel = o._nivelVisible || 'titular';
  const niveles = ['titular','suplente1','suplente2'];
  const idx = niveles.indexOf(nivel);

  for (let i = 0; i <= idx; i++) {
    const k = niveles[i];
    const p = o[k];
    if (!p || p.lat == null) continue;
    const activo = (i === idx);
    const m = crearMarcador(p, NIVEL_COLOR[k], String(i === 0 ? 'T' : i), activo);
    m.on('click', () => abrirDetalle(o.id, k));
    m.addTo(map_); markers_[o.id][k] = m;
  }

  if (idx > 0) {
    const pts = [];
    for (let i = 0; i <= idx; i++) { const p = o[niveles[i]]; if (p?.lat != null) pts.push([p.lat, p.lng]); }
    if (pts.length > 1) {
      markers_[o.id].linea = L.polyline(pts, { color:'#fbbf24', weight:2, dashArray:'5,6', opacity:.7 }).addTo(map_);
    }
  }
}

const PALETA_PAREJA = ['#2dd4bf','#fbbf24','#a78bfa','#f472b6','#60a5fa'];
function colorPareja(pareja) {
  const n = parseInt(String(pareja).replace(/\D/g,''), 10);
  return PALETA_PAREJA[(n - 1) % PALETA_PAREJA.length] || '#94a3b8';
}

function crearMarcador(p, color, texto, activo) {
  const size = activo ? 30 : 22;
  const icon = L.divIcon({
    className: '',
    html: `<div style="width:${size}px;height:${size}px;background:${color};border:2.5px solid white;border-radius:50%;box-shadow:0 2px 8px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-size:${activo?13:11}px;font-weight:800;color:#0a1628;${activo?'':'opacity:.7'}">${texto}</div>`,
    iconSize: [size, size], iconAnchor: [size/2, size/2],
  });
  return L.marker([p.lat, p.lng], { icon });
}

function quitarMarcadores(ordenId) {
  const g = markers_[ordenId];
  if (!g) return;
  Object.values(g).forEach(m => { if (m && map_.hasLayer(m)) map_.removeLayer(m); });
  delete markers_[ordenId];
}

// ── Detalle del punto + acciones de cascada ──
function abrirDetalle(ordenId, nivel) {
  const o = ordenes_.find(x => x.id === ordenId);
  if (!o) return;
  selected_ = { ordenId, nivel };
  const p = o[nivel] || o.titular;
  const cerrada = o.estado === 'hecha' || o.estado === 'no_hecha';
  const sheet = container_.querySelector('#crc-sheet');

  const siguiente = nivel === 'titular' ? 'suplente1' : nivel === 'suplente1' ? 'suplente2' : null;
  const haySiguiente = siguiente && o[siguiente];

  sheet.innerHTML = `
    <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 14px"></div>
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
      <div style="width:10px;height:10px;border-radius:50%;background:${NIVEL_COLOR[nivel]}"></div>
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:${NIVEL_COLOR[nivel]}">${NIVEL_LABEL[nivel]}</div>
    </div>
    <div style="font-size:16px;font-weight:800;margin-bottom:2px">${p.nombre || '—'}</div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:2px">NC ${p.nc}</div>
    <div style="font-size:11px;color:var(--text-4);margin-bottom:14px">${p.direccion || ''}</div>

    <div style="display:flex;gap:8px;font-size:11px;color:var(--text-4);margin-bottom:16px">
      ${p.medidor ? `<div>Medidor: <span style="color:var(--text-2)">${p.medidor}</span></div>` : ''}
      ${p.ds ? `<div>DS: <span style="color:var(--text-2)">${p.ds}</span></div>` : ''}
    </div>

    ${cerrada ? `
      <div style="text-align:center;padding:12px;border-radius:12px;background:${o.estado==='hecha'?'rgba(34,197,94,.1)':'rgba(239,68,68,.1)'};border:1px solid ${o.estado==='hecha'?'rgba(34,197,94,.3)':'rgba(239,68,68,.3)'};font-size:13px;font-weight:700;color:${o.estado==='hecha'?'#22c55e':'#ef4444'}">
        ${o.estado==='hecha' ? `Caracterizada en ${NIVEL_LABEL[o.logranoEn]||'titular'}` : 'No se pudo caracterizar'}
      </div>
    ` : `
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button id="crc-nopude" style="flex:1;padding:13px;border-radius:12px;border:1px solid rgba(239,68,68,.4);background:rgba(239,68,68,.1);color:#f87171;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">No pude</button>
        <button id="crc-hecha" style="flex:2;padding:13px;border-radius:12px;border:none;background:#22c55e;color:#0a1628;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">Hecha aquí</button>
      </div>
      <button id="crc-contiguos" style="width:100%;padding:11px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-3);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">Buscar contiguos</button>
      ${haySiguiente ? `<div style="font-size:10px;color:var(--text-4);text-align:center;margin-top:10px">Si no puedes, se te mostrará ${NIVEL_LABEL[siguiente]}</div>`
        : nivel==='suplente2' ? `<div style="font-size:10px;color:var(--text-4);text-align:center;margin-top:10px">Último punto. Si no puedes, la orden queda no hecha.</div>` : ''}
    `}
  `;

  sheet.style.transform = 'translateY(0)';

  if (!cerrada) {
    sheet.querySelector('#crc-hecha').onclick = () => marcarHecha(ordenId, nivel);
    sheet.querySelector('#crc-nopude').onclick = () => marcarNoPude(ordenId, nivel);
    sheet.querySelector('#crc-contiguos').onclick = buscarContiguos;
  }

  if (p.lat != null) map_.setView([p.lat, p.lng], Math.max(map_.getZoom(), 16));
}

function cerrarSheet() {
  const sheet = container_.querySelector('#crc-sheet');
  if (sheet) sheet.style.transform = 'translateY(110%)';
  selected_ = null;
}

// "Hecha aquí": cierra la orden registrando el nivel
async function marcarHecha(ordenId, nivel) {
  try {
    await db.collection('caracterizacion_ordenes').doc(ordenId).update({
      estado: 'hecha', logranoEn: nivel,
      hechaPor: session_.displayName, fechaHecha: firebase.firestore.Timestamp.now(),
    });
    const o = ordenes_.find(x => x.id === ordenId);
    if (o) { o.estado = 'hecha'; o.logranoEn = nivel; o.hechaPor = session_.displayName; pintarOrden(o); }
    cerrarSheet(); updateStat();
    toast(`Hecha en ${NIVEL_LABEL[nivel]}`, 'ok');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

// "No pude": revela el siguiente suplente, o cierra como no_hecha
async function marcarNoPude(ordenId, nivel) {
  const o = ordenes_.find(x => x.id === ordenId);
  if (!o) return;
  const siguiente = nivel === 'titular' ? 'suplente1' : nivel === 'suplente1' ? 'suplente2' : null;

  if (siguiente && o[siguiente]) {
    // Revelar el siguiente nivel
    o._nivelVisible = siguiente;
    pintarOrden(o);
    cerrarSheet();
    setTimeout(() => abrirDetalle(ordenId, siguiente), 260);
    toast(`Mostrando ${NIVEL_LABEL[siguiente]}`, 'ok');
  } else {
    // No hay más suplentes -> orden no hecha
    try {
      await db.collection('caracterizacion_ordenes').doc(ordenId).update({
        estado: 'no_hecha', logranoEn: null,
        hechaPor: session_.displayName, fechaHecha: firebase.firestore.Timestamp.now(),
      });
      o.estado = 'no_hecha'; pintarOrden(o);
      cerrarSheet(); updateStat();
      toast('Orden marcada como no hecha', 'warn');
    } catch (err) { toast('Error: ' + err.message, 'error'); }
  }
}

function updateStat() {
  const el = container_.querySelector('#crc-map-stat');
  if (!el) return;
  const total = ordenes_.length;
  const hechas = ordenes_.filter(o => o.estado === 'hecha').length;
  const pend = ordenes_.filter(o => o.estado !== 'hecha' && o.estado !== 'no_hecha').length;
  el.textContent = `${pend} pendientes · ${hechas} hechas`;
}

// ══════════════════════════════════════════════════════════════
//  ASIGNACIÓN POR ZONA (admin/asistente)
//  Dibuja un polígono; las órdenes cuyo TITULAR cae dentro se
//  asignan a la pareja elegida.
// ══════════════════════════════════════════════════════════════

const PAREJAS_CRC = ['Pareja 1','Pareja 2','Pareja 3'];

function pointInPolygon(point, vertices) {
  const x = point.lat, y = point.lng;
  let inside = false;
  for (let i = 0, j = vertices.length - 1; i < vertices.length; j = i++) {
    const xi = vertices[i].lat, yi = vertices[i].lng;
    const xj = vertices[j].lat, yj = vertices[j].lng;
    const intersect = ((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi);
    if (intersect) inside = !inside;
  }
  return inside;
}

function limpiarPoligono() {
  if (poliPreview_) { map_.removeLayer(poliPreview_); poliPreview_ = null; }
  if (zonaPoligono_) { map_.removeLayer(zonaPoligono_); zonaPoligono_ = null; }
  const btn = document.getElementById('crc-cerrar-poli');
  if (btn) btn.style.display = 'none';
}

function activarModoZona() {
  if (!map_) return;
  cerrarSheet();
  puntos_ = [];
  limpiarPoligono();
  map_.getContainer().style.cursor = 'crosshair';
  toast('Toca para marcar la zona · ciérrala con el botón o doble toque', 'ok', 5000);

  let btn = document.getElementById('crc-cerrar-poli');
  if (!btn) {
    btn = document.createElement('button');
    btn.id = 'crc-cerrar-poli';
    btn.textContent = 'Cerrar zona';
    btn.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);z-index:700;background:#a78bfa;color:#0d1117;border:none;border-radius:20px;padding:10px 24px;font-size:13px;font-weight:800;font-family:inherit;cursor:pointer;display:none;box-shadow:0 4px 20px rgba(0,0,0,.4)';
    document.body.appendChild(btn);
    btn.addEventListener('click', cerrarPoligono);
  }
  btn.style.display = 'none';

  map_.on('click', onMapClickZona_);
  map_.on('dblclick', onMapDblZona_);
}

function onMapClickZona_(e) {
  if (puntos_.length > 0) {
    const dist = map_.distance(puntos_[puntos_.length - 1], e.latlng);
    if (dist < 5) return;
  }
  puntos_.push(e.latlng);
  if (poliPreview_) map_.removeLayer(poliPreview_);
  if (puntos_.length === 1) {
    poliPreview_ = L.circleMarker(puntos_[0], { radius:5, color:'#a78bfa', fillColor:'#a78bfa', fillOpacity:1, weight:2 }).addTo(map_);
  } else {
    poliPreview_ = L.polygon(puntos_, { color:'#a78bfa', weight:2, fillOpacity:.1, dashArray:'6,4' }).addTo(map_);
  }
  const btn = document.getElementById('crc-cerrar-poli');
  if (btn) btn.style.display = puntos_.length >= 3 ? '' : 'none';
}

function onMapDblZona_(e) {
  L.DomEvent.stop(e);
  if (puntos_.length >= 3) cerrarPoligono();
}

function cerrarPoligono() {
  if (puntos_.length < 3) { toast('Necesitas al menos 3 puntos', 'warn'); return; }
  map_.off('click', onMapClickZona_);
  map_.off('dblclick', onMapDblZona_);
  map_.getContainer().style.cursor = '';
  const btn = document.getElementById('crc-cerrar-poli');
  if (btn) btn.style.display = 'none';
  if (poliPreview_) { map_.removeLayer(poliPreview_); poliPreview_ = null; }
  zonaPoligono_ = L.polygon(puntos_, { color:'#a78bfa', weight:2, fillOpacity:.12 }).addTo(map_);

  const dentro = ordenes_.filter(o => o.titular?.lat != null &&
    pointInPolygon(L.latLng(o.titular.lat, o.titular.lng), puntos_));

  abrirSheetZona(dentro.length);
}

function abrirSheetZona(cuantas) {
  const sheet = container_.querySelector('#crc-sheet-zona');
  sheet.innerHTML = `
    <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 14px"></div>
    <div style="font-size:16px;font-weight:800;margin-bottom:4px">Asignar zona</div>
    <div style="font-size:12px;color:var(--text-4);margin-bottom:16px">${cuantas} orden${cuantas!==1?'es':''} en esta zona (por titular)</div>
    <div class="form-label" style="margin-bottom:8px">Pareja</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px" id="crc-zona-parejas">
      ${PAREJAS_CRC.map(p => `<div class="crc-zp" data-val="${p}" style="cursor:pointer;padding:9px 16px;border-radius:20px;border:1px solid var(--border);background:var(--glass);font-size:13px;font-weight:700">${p}</div>`).join('')}
      <div class="crc-zp" data-val="null" style="cursor:pointer;padding:9px 16px;border-radius:20px;border:1px solid var(--border);background:var(--glass);font-size:13px;font-weight:700;color:var(--text-4)">Sin pareja</div>
    </div>
    <div id="crc-zona-err" class="form-error" style="display:none;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button id="crc-zona-cancel" style="flex:1;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-3);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Cancelar</button>
      <button id="crc-zona-ok" style="flex:2;padding:12px;border-radius:12px;border:none;background:#a78bfa;color:#0d1117;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit"><span id="crc-zona-ok-lbl">Asignar</span></button>
    </div>`;
  sheet.style.transform = 'translateY(0)';

  let sel = null;
  sheet.querySelectorAll('.crc-zp').forEach(chip => chip.onclick = () => {
    sheet.querySelectorAll('.crc-zp').forEach(c => { c.style.borderColor='var(--border)'; c.style.background='var(--glass)'; });
    chip.style.borderColor = '#a78bfa'; chip.style.background = 'rgba(167,139,250,.15)';
    sel = chip.dataset.val;
  });
  sheet.querySelector('#crc-zona-cancel').onclick = cancelarZona;
  sheet.querySelector('#crc-zona-ok').onclick = () => confirmarZona(sel);
}

function cancelarZona() {
  const sheet = container_.querySelector('#crc-sheet-zona');
  if (sheet) sheet.style.transform = 'translateY(110%)';
  limpiarPoligono();
  puntos_ = [];
  if (map_) { map_.off('click', onMapClickZona_); map_.off('dblclick', onMapDblZona_); map_.getContainer().style.cursor = ''; }
}

async function confirmarZona(pareja) {
  const err = container_.querySelector('#crc-zona-err');
  if (!pareja) { err.textContent = 'Selecciona una pareja o "Sin pareja".'; err.style.display = 'block'; return; }
  const dentro = ordenes_.filter(o => o.titular?.lat != null &&
    pointInPolygon(L.latLng(o.titular.lat, o.titular.lng), puntos_));
  if (!dentro.length) { err.textContent = 'No hay órdenes en esa zona.'; err.style.display = 'block'; return; }

  const val = pareja === 'null' ? null : pareja;
  const btn = container_.querySelector('#crc-zona-ok');
  btn.disabled = true;
  container_.querySelector('#crc-zona-ok-lbl').textContent = 'Asignando…';
  try {
    const ts = firebase.firestore.Timestamp.now();
    for (let i = 0; i < dentro.length; i += 400) {
      const batch = db.batch();
      dentro.slice(i, i + 400).forEach(o => {
        batch.update(db.collection('caracterizacion_ordenes').doc(o.id), { pareja: val, asignadoEn: ts });
      });
      await batch.commit();
    }
    dentro.forEach(o => { o.pareja = val; pintarOrden(o); });
    cancelarZona();
    toast(`${dentro.length} órdenes asignadas${val ? ' a ' + val : ' (sin pareja)'}`, 'ok');
  } catch (e) {
    btn.disabled = false;
    container_.querySelector('#crc-zona-ok-lbl').textContent = 'Reintentar';
    toast('Error: ' + e.message, 'error');
  }
}

// Asignar una sola orden (admin toca un titular)
function abrirAsignarIndividual(ordenId) {
  const o = ordenes_.find(x => x.id === ordenId);
  if (!o) return;
  const t = o.titular || {};
  const sheet = container_.querySelector('#crc-sheet-zona');
  sheet.innerHTML = `
    <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 14px"></div>
    <div style="font-size:15px;font-weight:800;margin-bottom:2px">${t.nombre || o.ncTitular}</div>
    <div style="font-size:11px;color:var(--text-4);margin-bottom:16px">NC ${o.ncTitular}${o.pareja ? ' · ' + o.pareja : ' · sin asignar'}</div>
    <div class="form-label" style="margin-bottom:8px">Asignar a</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px" id="crc-ind-parejas">
      ${PAREJAS_CRC.map(p => `<div class="crc-ip" data-val="${p}" style="cursor:pointer;padding:9px 16px;border-radius:20px;border:1px solid ${o.pareja===p?'#a78bfa':'var(--border)'};background:${o.pareja===p?'rgba(167,139,250,.15)':'var(--glass)'};font-size:13px;font-weight:700">${p}</div>`).join('')}
      <div class="crc-ip" data-val="null" style="cursor:pointer;padding:9px 16px;border-radius:20px;border:1px solid var(--border);background:var(--glass);font-size:13px;font-weight:700;color:var(--text-4)">Quitar</div>
    </div>
    <button id="crc-ind-cerrar" style="width:100%;padding:11px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-3);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">Cerrar</button>`;
  sheet.style.transform = 'translateY(0)';

  sheet.querySelectorAll('.crc-ip').forEach(chip => chip.onclick = async () => {
    const val = chip.dataset.val === 'null' ? null : chip.dataset.val;
    try {
      await db.collection('caracterizacion_ordenes').doc(ordenId).update({ pareja: val, asignadoEn: firebase.firestore.Timestamp.now() });
      o.pareja = val; pintarOrden(o);
      sheet.style.transform = 'translateY(110%)';
      toast(val ? `Asignada a ${val}` : 'Asignación quitada', 'ok');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  });
  sheet.querySelector('#crc-ind-cerrar').onclick = () => { sheet.style.transform = 'translateY(110%)'; };
}

// ── GPS (idéntico a Cambios) ──
function initGPS() {
  if (!navigator.geolocation) return;
  const iconHtml = `<div style="width:16px;height:16px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 0 0 2px #3b82f6"></div>`;
  watchId_ = navigator.geolocation.watchPosition(
    pos => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;
      if (!map_) return;
      if (geoMarker_) {
        geoMarker_.setLatLng([lat, lng]);
        geoCircle_.setLatLng([lat, lng]).setRadius(accuracy);
        if (!map_.hasLayer(geoMarker_)) geoMarker_.addTo(map_);
        if (!map_.hasLayer(geoCircle_)) geoCircle_.addTo(map_);
      } else {
        geoMarker_ = L.marker([lat, lng], { icon: L.divIcon({ className:'', html: iconHtml, iconSize:[16,16], iconAnchor:[8,8] }), zIndexOffset: 1000 }).addTo(map_);
        geoCircle_ = L.circle([lat, lng], { radius: accuracy, color:'#3b82f6', fillColor:'#3b82f6', fillOpacity:.08, weight:1 }).addTo(map_);
      }
    },
    err => console.warn('[crc-mapa] GPS:', err.message),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
  );
}

// ── Buscar contiguos (idéntico a Cambios) ──
async function cargarContiguosData() {
  if (contiguosData_) return true;
  if (contiguosLoading_) {
    let i = 0; while (contiguosLoading_ && i < 100) { await new Promise(r => setTimeout(r, 100)); i++; }
    return !!contiguosData_;
  }
  contiguosLoading_ = true;
  try {
    const resp = await fetch('contiguos.json');
    if (!resp.ok) throw new Error('No se pudo cargar');
    contiguosData_ = await resp.json();
    contiguosIndex_ = {};
    for (let i = 0; i < contiguosData_.length; i++) contiguosIndex_[contiguosData_[i][0]] = i;
    return true;
  } catch (err) { console.error('[contiguos]', err); contiguosData_ = null; return false; }
  finally { contiguosLoading_ = false; }
}

async function buscarContiguos() {
  if (!selected_) return;
  const o = ordenes_.find(x => x.id === selected_.ordenId);
  const p = o?.[selected_.nivel];
  const nc = String(p?.nc || '').trim();
  if (!nc) { toast('Este punto no tiene NC', 'error'); return; }

  toast('Cargando base de contiguos…', 'ok');
  const ok = await cargarContiguosData();
  if (!ok) { toast('No se pudo cargar la base', 'error'); return; }

  const pos = contiguosIndex_[nc];
  if (pos === undefined) { toast('NC no encontrado en la base', 'error'); return; }

  limpiarContiguos();
  for (let off = -2; off <= 2; off++) {
    const i = pos + off;
    if (i < 0 || i >= contiguosData_.length) continue;
    const r = contiguosData_[i];
    if (!r[5] || !r[6]) continue;
    const esCentro = off === 0;
    const color = esCentro ? '#2dd4bf' : '#fbbf24';
    const icon = L.divIcon({
      className: '',
      html: '<div style="display:flex;flex-direction:column;align-items:center">'
        + '<div style="width:'+(esCentro?24:20)+'px;height:'+(esCentro?24:20)+'px;background:'+color+';border:2px solid white;border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#0a1628">'+(esCentro?'&#9679;':(off<0?'&#8593;':'&#8595;'))+'</div>'
        + '<div style="margin-top:2px;background:rgba(10,22,40,.85);padding:1px 6px;border-radius:6px;font-size:10px;font-weight:700;color:white;white-space:nowrap">NC '+r[0]+'</div></div>',
      iconSize: [60, 44], iconAnchor: [30, 22],
    });
    const m = L.marker([r[5], r[6]], { icon, zIndexOffset: 1000 }).addTo(map_);
    markersContiguos_.push(m);
  }
  toast('Contiguos en el mapa (amarillos)', 'ok');
}

function limpiarContiguos() {
  markersContiguos_.forEach(m => { if (map_.hasLayer(m)) map_.removeLayer(m); });
  markersContiguos_ = [];
}
