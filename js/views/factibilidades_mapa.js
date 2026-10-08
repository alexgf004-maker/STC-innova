/**
 * js/views/factibilidades_mapa.js
 * Mapa de Factibilidades: Leaflet + Google Maps Hybrid.
 * Base tomada de ami_mapa.js, sin lo que no aplica a esta área (parejas,
 * asignación por polígono, residuos ni padrón de ya cambiados).
 * Exporta: init(container, session), cleanup()
 *
 * Roles:
 *   tecnico         -> solo sus órdenes abiertas
 *   admin/asistente -> todas las órdenes abiertas
 */

import { suscribirAbiertas } from '../factibilidades_comun.js';
import { escapeHtml } from '../ui.js';
import { ponerEtiquetas } from './etiquetas_mapa.js';

const COLOR_PIN = '#f472b6';

let map_ = null, lienzo_ = null, markers_ = [], yaCentrado_ = false;
let session_, role_;
let ordenes_ = [];
let off_ = null;
let geoMarker_ = null, geoCircle_ = null, watchId_ = null;

const esc = v => escapeHtml(v == null ? '' : String(v));
const coordValida = (lat, lng) => isFinite(lat) && isFinite(lng) && lat > 12 && lat < 16 && lng > -92 && lng < -87;
const latLngDe = o => [parseFloat(o.latitud), parseFloat(o.longitud)];

export function init(container, session) {
  cleanup();
  session_ = session;
  role_    = session.role;
  yaCentrado_ = false;

  renderShell(container);
  initMap();
  off_ = suscribirAbiertas(session, (lista, err) => {
    if (err) { console.warn('[fb-mapa]', err.message); return; }
    ordenes_ = lista;
    plotMarkers();
    centrarEnOrdenes();
    actualizarChip();
  });
}

// Llamado por el router (o por la pestaña Mapa de la oficina) al salir
export function cleanup() {
  if (off_) { try { off_(); } catch {} off_ = null; }
  if (watchId_ != null && navigator.geolocation) { navigator.geolocation.clearWatch(watchId_); watchId_ = null; }
  if (map_) { try { map_.remove(); } catch {} map_ = null; }
  lienzo_ = null; markers_ = []; geoMarker_ = null; geoCircle_ = null;
}

// ── Shell ─────────────────────────────────────────
function renderShell(container) {
  container.innerHTML = `
    <style>
      #leaflet-map .leaflet-top.leaflet-left { display: none; }
      #leaflet-map .leaflet-control-attribution { display: none; }
    </style>
    <div id="mapa-wrapper" style="position:fixed;top:var(--topbar-h, 62px);left:0;right:0;bottom:var(--navbar-h, 72px);z-index:1">
      <div id="leaflet-map" style="width:100%;height:100%"></div>

      <div class="mapa-controls-top">
        <div class="mapa-stat-chip" style="border-color:var(--fb-border);background:var(--fb-glass)">
          <div class="mapa-stat-dot" style="background:var(--fb-light)"></div>
          <span style="font-weight:800;color:var(--fb-light);letter-spacing:.04em;margin-right:2px">FACT</span>
          <span id="fbm-stat-txt">Cargando…</span>
        </div>
        <button class="mapa-btn-icon" id="fbm-mi-ubicacion" title="Mi ubicación">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
        </button>
      </div>

      <div class="mapa-panel" id="mapa-panel">
        <div class="mapa-panel-handle" onclick="document.getElementById('mapa-panel').classList.remove('open')"></div>
        <div id="mapa-panel-content"></div>
      </div>
    </div>`;

  // Alturas reales del topbar y navbar (igual que los otros mapas)
  const topbar = document.querySelector('.topbar');
  const navbar = document.querySelector('.navbar');
  const wrapper = container.querySelector('#mapa-wrapper');
  if (window.innerWidth >= 768) {
    wrapper.style.top    = (topbar ? topbar.offsetHeight : 56) + 'px';
    wrapper.style.bottom = '0px';
    wrapper.style.left   = (navbar ? navbar.offsetWidth : 200) + 'px';
    wrapper.style.right  = '0px';
  } else {
    if (topbar) wrapper.style.top = topbar.offsetHeight + 'px';
    wrapper.style.bottom = '0px';
    if (navbar) wrapper.style.setProperty('--nav-espacio', navbar.offsetHeight + 'px');
  }

  container.querySelector('#fbm-mi-ubicacion').onclick = () => {
    if (geoMarker_ && map_) map_.setView(geoMarker_.getLatLng(), 17);
  };
  window.__fbMapa = { verOrden, abrirGoogleMaps };
}

// ── Mapa ──────────────────────────────────────────
function initMap() {
  const conRotacion = role_ === 'tecnico';
  map_ = L.map('leaflet-map', {
    center: [13.7942, -88.8965], zoom: 8,
    zoomControl: false, attributionControl: false,
    ...(conRotacion ? { rotate: true, touchRotate: true, rotateControl: false } : {}),
  });
  const capa = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
    keepBuffer: 4,
  }).addTo(map_);
  capa.on('tileerror', () => {});
  L.control.zoom({ position: 'bottomright' }).addTo(map_);

  map_.on('click', cerrarPanel);
  map_.on('zoomend', () => plotMarkers());
  map_.on('moveend', () => { if (map_.getZoom() >= 16) plotMarkers(); });

  iniciarGeolocalizacion();

  // Si el contenedor aún no tiene su tamaño final, el mapa sale vacío
  const refrescar = () => { if (!map_) return; map_.invalidateSize(true); centrarEnOrdenes(); plotMarkers(); };
  requestAnimationFrame(refrescar);
  setTimeout(refrescar, 150);
  setTimeout(refrescar, 400);
  setTimeout(refrescar, 900);
}

function centrarEnOrdenes() {
  if (!map_ || yaCentrado_ || !markers_.length) return;
  try {
    const b = L.featureGroup(markers_.filter(m => m._ordenId)).getBounds();
    if (b.isValid()) { map_.fitBounds(b.pad(0.1), { maxZoom: 16 }); yaCentrado_ = true; }
  } catch (e) { console.warn('[fb-mapa] fitBounds:', e); }
}

function iniciarGeolocalizacion() {
  if (!navigator.geolocation) return;
  if (watchId_ != null) navigator.geolocation.clearWatch(watchId_);
  watchId_ = navigator.geolocation.watchPosition(pos => {
    const { latitude: lat, longitude: lng, accuracy } = pos.coords;
    if (!map_) return;
    if (geoMarker_) {
      geoMarker_.setLatLng([lat, lng]);
      geoCircle_.setLatLng([lat, lng]).setRadius(accuracy);
    } else {
      geoMarker_ = L.marker([lat, lng], {
        icon: L.divIcon({ className: '', iconSize: [16, 16], iconAnchor: [8, 8],
          html: '<div style="width:16px;height:16px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 0 0 4px rgba(59,130,246,.3)"></div>' }),
        zIndexOffset: 1000, interactive: false,
      }).addTo(map_);
      geoCircle_ = L.circle([lat, lng], { interactive: false, radius: accuracy, color: '#3b82f6', fillColor: '#3b82f6', fillOpacity: 0.08, weight: 1 }).addTo(map_);
    }
  }, err => console.warn('[fb-mapa] Geolocalización:', err.message),
  { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 });
}

// ── Marcadores ────────────────────────────────────
function radioPorZoom(z) { return z <= 10 ? 3 : z <= 11 ? 4 : z <= 12 ? 5 : z <= 13 ? 6 : z <= 14 ? 7 : 8; }

function ordenMasCercana(e, porDefecto) {
  const p = e?.containerPoint;
  if (!p || !map_) return porDefecto;
  let mejor = porDefecto, dist = Infinity;
  markers_.forEach(m => {
    if (!m._ordenId) return;
    const d = map_.latLngToContainerPoint(m.getLatLng()).distanceTo(p);
    if (d < dist) { dist = d; mejor = m._ordenId; }
  });
  return mejor;
}

function plotMarkers() {
  if (!map_) return;
  markers_.forEach(m => map_.removeLayer(m));
  markers_ = [];
  if (!lienzo_) lienzo_ = L.canvas({ padding: 0.5, tolerance: 14 });

  const z = map_.getZoom();
  const r = radioPorZoom(z);
  const cerca = z >= 13;
  const conEtiquetas = z >= 16;
  const vista = conEtiquetas ? map_.getBounds().pad(0.2) : null;
  const etiquetas = [], puntos = [];

  ordenes_.forEach(o => {
    const ll = latLngDe(o);
    if (!coordValida(ll[0], ll[1])) return;
    const m = L.circleMarker(ll, {
      renderer: lienzo_, bubblingMouseEvents: false, radius: r,
      fillColor: COLOR_PIN, fillOpacity: 1,
      color: cerca ? '#ffffff' : 'rgba(5,10,20,.55)', weight: cerca ? 2 : 1,
    });
    m._ordenId = o.id;
    m.on('click', e => tocarPunto(ordenMasCercana(e, o.id)));
    m.addTo(map_);
    markers_.push(m);
    if (conEtiquetas && vista.contains(ll)) {
      if (o.numeroOrden) etiquetas.push({ latlng: ll, texto: String(o.numeroOrden), prioridad: 0 });
      puntos.push({ latlng: ll, radio: r + 2 });
    }
  });
  if (etiquetas.length) markers_.push(...ponerEtiquetas(map_, etiquetas, puntos, r));
}

function actualizarChip() {
  const el = document.getElementById('fbm-stat-txt');
  if (el) el.textContent = `${ordenes_.length} abierta${ordenes_.length !== 1 ? 's' : ''}`;
}

// ── Panel ─────────────────────────────────────────
// Si hay varias gotas encimadas, primero una lista para elegir.
function tocarPunto(id) {
  const o = ordenes_.find(x => x.id === id);
  if (!o || !map_) return;
  const pt = map_.latLngToContainerPoint(latLngDe(o));
  const cercanas = ordenes_.filter(x => {
    const ll = latLngDe(x);
    if (!coordValida(ll[0], ll[1])) return false;
    const p = map_.latLngToContainerPoint(ll);
    return Math.hypot(p.x - pt.x, p.y - pt.y) <= 22;
  });
  if (cercanas.length <= 1) { verOrden(id); return; }

  const content = document.getElementById('mapa-panel-content');
  content.innerHTML = `
    <div style="padding:4px 4px 10px">
      <div style="font-size:14px;font-weight:800;margin-bottom:2px;color:#f1f5f9">${cercanas.length} órdenes aquí</div>
      <div style="font-size:11px;color:#94a3b8;margin-bottom:12px">Están muy juntas. Elige cuál quieres abrir.</div>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${cercanas.map(x => `
          <button class="fbm-encimada" data-id="${x.id}" style="display:flex;align-items:center;gap:10px;width:100%;text-align:left;padding:10px 12px;border-radius:10px;border:1px solid var(--border);background:var(--glass);cursor:pointer;font-family:inherit">
            <span style="width:10px;height:10px;border-radius:50%;background:${COLOR_PIN};flex-shrink:0"></span>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:700;color:#f1f5f9">${esc(x.numeroOrden || '—')}</div>
              <div style="font-size:11px;color:#94a3b8;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(x.direccion || '')}</div>
            </div>
          </button>`).join('')}
      </div>
    </div>`;
  document.getElementById('mapa-panel').classList.add('open');
  content.querySelectorAll('.fbm-encimada').forEach(b => { b.onclick = () => verOrden(b.dataset.id); });
}

function verOrden(id) {
  const o = ordenes_.find(x => x.id === id);
  if (!o) return;
  const [lat, lng] = latLngDe(o);
  document.getElementById('mapa-panel-content').innerHTML = `
    <div class="panel-scroll-info">
      <div style="font-size:17px;font-weight:800;color:#fff;letter-spacing:-.01em;margin-bottom:2px">${esc(o.numeroOrden || '—')}</div>
      ${o.cliente ? `<div style="font-size:13px;font-weight:500;color:rgba(255,255,255,.85);margin-bottom:11px">${esc(o.cliente)}</div>` : ''}
      ${o.direccion ? `
      <div class="ds-hilite" style="display:flex;align-items:flex-start;gap:8px;margin-bottom:11px">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="flex-shrink:0;margin-top:1px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <div style="font-size:13px;font-weight:500;color:rgba(255,255,255,.95);line-height:1.4">${esc(o.direccion)}</div>
      </div>` : ''}
    </div>
    <div class="panel-orden-actions panel-actions-fixed">
      <button class="btn-action outline" onclick="window.__fbMapa.abrirGoogleMaps(${lat},${lng})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
        Navegar
      </button>
    </div>`;
  document.getElementById('mapa-panel').classList.add('open');
}

function cerrarPanel() {
  document.getElementById('mapa-panel')?.classList.remove('open');
}

function abrirGoogleMaps(lat, lng) {
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
}
