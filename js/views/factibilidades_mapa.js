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

import { db } from '../firebase.js';
import { tecnicosActivos } from '../vivo.js';
import { suscribirAbiertas, suscribirConfig, META_DEFECTO, AREA } from '../factibilidades_comun.js';
import { semaforoOrden, SEMAFORO, aFecha } from '../dias_habiles.js';
import { escapeHtml } from '../ui.js';
import { ponerEtiquetas } from './etiquetas_mapa.js';
import { abrirResultado, corregirUbicacion, abrirReasignar, puedeActuar, cerrarHojas } from './factibilidades_acciones.js';

const COLOR_SIN_FECHA = '#94a3b8';

let map_ = null, lienzo_ = null, markers_ = [], yaCentrado_ = false;
let session_, role_;
let ordenes_ = [];
// Oficina: filtros por semáforo y técnico, y técnicos del área para reasignar
let semF_ = 'todas', tecF_ = 'todos', tecnicos_ = [];
const pasaFiltro = o => (semF_ === 'todas' || sem(o).color === semF_)
  && (tecF_ === 'todos' || (tecF_ === 'sin' ? !o.asignadoUid : o.asignadoUid === tecF_));
const visibles = () => ordenes_.filter(pasaFiltro);
let off_ = null, offCfg_ = null;
let cfg_ = { festivos: [], festivosSet: new Set(), meta: META_DEFECTO };
let geoMarker_ = null, geoCircle_ = null, watchId_ = null;
let pendiente_ = null;   // orden que pidió abrir la lista ("Ver en el mapa")
// Última lectura del GPS del mapa, para "Corregir ubicación" (así no se abre
// un segundo GPS en el teléfono y la lectura sale al instante).
let ultimaPos_ = null, errorGps_ = null;
const oyentesGps_ = new Set();
// Referencia del Excel (vecino o transformador cercano), en palabras.
function textoReferencia(ref) {
  const r = String(ref || '').toUpperCase();
  if (r.startsWith('MD')) return `Medidor vecino ${r.slice(2)}`;
  if (r.startsWith('DS') || r.startsWith('CT')) return `Transformador ${r}`;
  if (r.startsWith('NC')) return `NC vecino ${r.slice(2)}`;
  if (/^\d{9}$/.test(r)) return `NC vecino ${r}`;
  return r;
}

function fuenteGpsMapa(ok, fallo) {
  if (ultimaPos_) ok(ultimaPos_);
  else if (errorGps_) fallo(errorGps_);
  oyentesGps_.add(ok);
  return () => oyentesGps_.delete(ok);
}

/** La lista pide abrir una orden: se centra y se abre al tener los datos. */
export function pedirAbrir(id) { pendiente_ = id; if (map_ && ordenes_.length) abrirPendiente(); }

function abrirPendiente() {
  const o = pendiente_ && ordenes_.find(x => x.id === pendiente_);
  if (!o || !map_) return;
  pendiente_ = null;
  const ll = latLngDe(o);
  if (coordValida(ll[0], ll[1])) { yaCentrado_ = true; map_.setView(ll, 17); }
  verOrden(o.id);
}

const esc = v => escapeHtml(v == null ? '' : String(v));
const coordValida = (lat, lng) => isFinite(lat) && isFinite(lng) && lat > 12 && lat < 16 && lng > -92 && lng < -87;
const latLngDe = o => [parseFloat(o.latitud), parseFloat(o.longitud)];
// El pin lleva el color del semáforo (no el de un técnico o pareja)
const sem = o => semaforoOrden(o, cfg_.festivosSet);
const colorDe = o => { const c = sem(o).color; return c ? SEMAFORO[c].color : COLOR_SIN_FECHA; };
const textoDias = n => n == null ? 'Sin fecha' : `${n} día${n !== 1 ? 's' : ''} hábil${n !== 1 ? 'es' : ''}`;

export function init(container, session) {
  cleanup();
  session_ = session;
  role_    = session.role;
  yaCentrado_ = false;
  semF_ = 'todas'; tecF_ = 'todos'; tecnicos_ = [];
  if (role_ !== 'tecnico') {
    tecnicosActivos(db).then(l => { tecnicos_ = l.filter(u => u.asignacionActual?.area === AREA); })
      .catch(err => console.warn('[fb-mapa] técnicos:', err.message));
  }

  renderShell(container);
  initMap();
  offCfg_ = suscribirConfig(cfg => { cfg_ = cfg; plotMarkers(); actualizarChip(); });
  off_ = suscribirAbiertas(session, (lista, err) => {
    if (err) { console.warn('[fb-mapa]', err.message); return; }
    ordenes_ = lista;
    if (pendiente_) abrirPendiente();
    plotMarkers();
    centrarEnOrdenes();
    actualizarChip();
    refrescarPanel();
  });
}

// Si el panel abierto es de una orden que cambió (o se cerró), actualizarlo
let abierta_ = null;
function refrescarPanel() {
  if (!abierta_ || !document.getElementById('mapa-panel')?.classList.contains('open')) return;
  if (ordenes_.some(x => x.id === abierta_)) verOrden(abierta_);
  else { abierta_ = null; cerrarPanel(); }
}

// Llamado por el router (o por la pestaña Mapa de la oficina) al salir
export function cleanup() {
  if (off_) { try { off_(); } catch {} off_ = null; }
  if (offCfg_) { try { offCfg_(); } catch {} offCfg_ = null; }
  cerrarHojas();
  document.getElementById('fbm-sheet-filtro')?.remove();
  abierta_ = null;
  if (watchId_ != null && navigator.geolocation) { navigator.geolocation.clearWatch(watchId_); watchId_ = null; }
  if (map_) { try { map_.remove(); } catch {} map_ = null; }
  lienzo_ = null; markers_ = []; geoMarker_ = null; geoCircle_ = null;
  ultimaPos_ = null; errorGps_ = null; oyentesGps_.clear();
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
        ${role_ !== 'tecnico' ? `
        <button class="mapa-btn-icon" id="fbm-filtro" title="Filtrar" style="border-color:var(--fb-border);color:var(--fb-light)">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><polygon points="22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3"/></svg>
        </button>` : ''}
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
  const btnF = container.querySelector('#fbm-filtro');
  if (btnF) btnF.onclick = abrirFiltro;
  window.__fbMapa = {
    verOrden, abrirGoogleMaps,
    resultado: id => abrirResultado(ordenes_.find(x => x.id === id), session_, () => cerrarPanel()),
    gps: id => corregirUbicacion(ordenes_.find(x => x.id === id), session_, null, watchId_ != null ? fuenteGpsMapa : undefined),
    reasignar: id => abrirReasignar([ordenes_.find(x => x.id === id)], session_, tecnicos_),
  };
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
    ultimaPos_ = { lat, lng, precision: accuracy }; errorGps_ = null;
    oyentesGps_.forEach(fn => { try { fn(ultimaPos_); } catch {} });
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
  }, err => { errorGps_ = err; console.warn('[fb-mapa] Geolocalización:', err.message); },
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

  // Las rojas se dibujan al final para que queden encima
  const orden = visibles().sort((a, b) => (sem(a).dias ?? -1) - (sem(b).dias ?? -1));
  orden.forEach(o => {
    const ll = latLngDe(o);
    if (!coordValida(ll[0], ll[1])) return;
    const m = L.circleMarker(ll, {
      renderer: lienzo_, bubblingMouseEvents: false, radius: r,
      fillColor: colorDe(o), fillOpacity: 1,
      // Ubicación aproximada (por dirección, sin corregir): borde amarillo punteado
      color: o.ubicacionAprox && !o.coordCorregida ? '#fbbf24' : cerca ? '#ffffff' : 'rgba(5,10,20,.55)', weight: cerca ? 2 : 1,
      dashArray: o.ubicacionAprox && !o.coordCorregida && cerca ? '3 3' : null,
    });
    m._ordenId = o.id;
    m.on('click', e => tocarPunto(ordenMasCercana(e, o.id)));
    m.addTo(map_);
    markers_.push(m);
    if (conEtiquetas && vista.contains(ll)) {
      if (o.numeroOrden) etiquetas.push({ latlng: ll, texto: String(o.numeroOrden), prioridad: -(sem(o).dias || 0) });
      puntos.push({ latlng: ll, radio: r + 2 });
    }
  });
  if (etiquetas.length) markers_.push(...ponerEtiquetas(map_, etiquetas, puntos, r));
}

function actualizarChip() {
  const el = document.getElementById('fbm-stat-txt');
  if (!el) return;
  const vis = visibles();
  const rojas = vis.filter(o => sem(o).color === 'rojo').length;
  const filtrado = semF_ !== 'todas' || tecF_ !== 'todos';
  el.innerHTML = `${vis.length}${filtrado ? ' de ' + ordenes_.length : ''} abierta${ordenes_.length !== 1 ? 's' : ''}${rojas ? ` · <span style="color:${SEMAFORO.rojo.color}">${rojas} en rojo</span>` : ''}`;
  document.getElementById('fbm-filtro')?.style.setProperty('background', filtrado ? 'var(--fb-glass)' : '');
}

// ── Panel ─────────────────────────────────────────
// Si hay varias gotas encimadas, primero una lista para elegir.
function tocarPunto(id) {
  const o = ordenes_.find(x => x.id === id);
  if (!o || !map_) return;
  const pt = map_.latLngToContainerPoint(latLngDe(o));
  const cercanas = visibles().filter(x => {
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
            <span style="width:10px;height:10px;border-radius:50%;background:${colorDe(x)};flex-shrink:0"></span>
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:700;color:#f1f5f9">${esc(x.numeroOrden || '—')} <span style="font-weight:500;color:${colorDe(x)}">· ${textoDias(sem(x).dias)}</span></div>
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
  abierta_ = id;
  const [lat, lng] = latLngDe(o);
  const actua = puedeActuar(o, session_);
  const fmt = v => { const d = aFecha(v); return d ? d.toLocaleString('es-SV', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; };
  const visitas = (Array.isArray(o.visitas) ? o.visitas : []).slice().sort((a, b) => (aFecha(b.fecha) || 0) - (aFecha(a.fecha) || 0));
  const fila = (k, v) => `<div style="display:flex;justify-content:space-between;gap:10px;font-size:12px;margin-bottom:3px"><span style="color:#94a3b8">${k}</span><span style="color:#e2e8f0;text-align:right">${v}</span></div>`;
  const { dias, color } = sem(o);
  const s = color ? SEMAFORO[color] : null;
  const lib = aFecha(o.fechaLiberacion);
  document.getElementById('mapa-panel-content').innerHTML = `
    <div class="panel-scroll-info">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:12px;margin-bottom:11px">
        <div style="flex:1;min-width:0">
          <div style="font-size:17px;font-weight:800;color:#fff;letter-spacing:-.01em">${esc(o.numeroOrden || '—')}</div>
          ${o.cliente ? `<div style="font-size:13px;font-weight:500;color:rgba(255,255,255,.85);margin-top:2px">${esc(o.cliente)}</div>` : ''}
        </div>
        ${o.estado === 'visita' ? '<div class="estado-badge warn" style="flex-shrink:0">Sin acceso</div>' : ''}
      </div>
      <div style="display:flex;align-items:center;gap:12px;border-radius:12px;padding:10px 12px;margin-bottom:11px;background:${s ? s.color + '1f' : 'var(--glass)'};border:1px solid ${s ? s.color + '66' : 'var(--border)'}">
        <div style="font-size:30px;font-weight:600;line-height:1;color:${s ? s.color : '#fff'}">${dias ?? '—'}</div>
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;color:#fff">${dias == null ? 'Sin fecha de liberación' : `día${dias !== 1 ? 's' : ''} hábil${dias !== 1 ? 'es' : ''} · ${s.texto}`}</div>
          <div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:2px">${lib ? 'Liberada el ' + lib.toLocaleDateString('es-SV', { weekday: 'short', day: 'numeric', month: 'short' }) : ''}</div>
        </div>
      </div>
      ${o.direccion ? `
      <div class="ds-hilite" style="display:flex;align-items:flex-start;gap:8px;margin-bottom:11px">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="flex-shrink:0;margin-top:1px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
        <div style="font-size:13px;font-weight:500;color:rgba(255,255,255,.95);line-height:1.4">${esc(o.direccion)}</div>
      </div>` : ''}
      ${o.ubicacionAprox && !o.coordCorregida ? `
      <div style="display:flex;align-items:flex-start;gap:8px;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.35);border-radius:11px;padding:9px 12px;margin-bottom:11px;font-size:12px;color:#fde68a;line-height:1.4">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15" style="flex-shrink:0;margin-top:1px"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        <span><b>Ubicación aproximada</b>${o.ubicacionNivel ? ` (a nivel de ${esc(o.ubicacionNivel)})` : ''}: sacada de la dirección. Guíate por la dirección y la referencia; estando en el sitio, corrige la ubicación.</span>
      </div>` : ''}
      ${o.referencia || o.telefono ? `
      <div style="padding:10px 12px;background:var(--glass);border:1px solid var(--border);border-radius:10px;margin-bottom:11px">
        ${o.referencia ? fila('Referencia', esc(textoReferencia(o.referencia))) : ''}
        ${o.telefono ? fila('Teléfono', `<a href="tel:${esc(o.telefono)}" style="color:#60a5fa">${esc(o.telefono)}</a>`) : ''}
      </div>` : ''}
      ${role_ !== 'tecnico' ? `<div style="font-size:12px;color:var(--text-3);margin-bottom:11px">Asignada a <b style="color:${o.asignadoNombre ? '#e2e8f0' : '#fbbf24'}">${esc(o.asignadoNombre || 'nadie')}</b>${o.asignacionManual ? ' · reasignada en la app' : ''}</div>` : ''}
      ${visitas.length ? `
      <div style="padding:10px 12px;background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.3);border-radius:10px;margin-bottom:11px">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#fbbf24;margin-bottom:6px">Visitas sin acceso (${visitas.length})</div>
        ${visitas.map(v => `<div style="font-size:12px;color:#e2e8f0;margin-bottom:4px"><span style="color:#94a3b8">${fmt(v.fecha)} · ${esc(v.tecnico || '')}</span><br>${esc(v.observacion || '')}</div>`).join('')}
      </div>` : ''}
      ${o.coordCorregida ? `
      <div style="padding:10px 12px;background:var(--glass);border:1px solid var(--border);border-radius:10px;margin-bottom:11px">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--fb-light);margin-bottom:6px">Ubicación corregida</div>
        ${fila('Por', esc(o.corregidaPor || ''))}
        ${o.fechaCorreccion ? fila('Cuándo', fmt(o.fechaCorreccion)) : ''}
      </div>` : ''}
    </div>
    <div class="panel-orden-actions panel-actions-fixed">
      ${actua ? `
      <button class="btn-action fb" onclick="window.__fbMapa.resultado('${o.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        Resultado
      </button>` : ''}
      <button class="btn-action outline" onclick="window.__fbMapa.abrirGoogleMaps(${lat},${lng})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
        Navegar
      </button>
      ${role_ !== 'tecnico' ? `
      <button class="btn-action fb" onclick="window.__fbMapa.reasignar('${o.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
        Reasignar
      </button>` : ''}
      ${actua ? `
      <button class="btn-action outline" style="flex-basis:100%" onclick="window.__fbMapa.gps('${o.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
        Corregir ubicación con mi GPS
      </button>` : ''}
    </div>`;
  document.getElementById('mapa-panel').classList.add('open');
}

function cerrarPanel() {
  abierta_ = null;
  document.getElementById('mapa-panel')?.classList.remove('open');
}

function abrirGoogleMaps(lat, lng) {
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
}

// ── Filtros de la oficina ─────────────────────────
function abrirFiltro() {
  document.getElementById('fbm-sheet-filtro')?.remove();
  const tecs = new Map(tecnicos_.map(u => [u.id, u.displayName]));
  ordenes_.forEach(o => { if (o.asignadoUid && !tecs.has(o.asignadoUid)) tecs.set(o.asignadoUid, o.asignadoNombre || 'Sin nombre'); });
  const listaTec = [['todos', 'Todos'], ...[...tecs.entries()].sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'es')), ['sin', 'Sin asignar']];
  const sems = [['todas', 'Todas'], ['rojo', SEMAFORO.rojo.texto], ['amarillo', SEMAFORO.amarillo.texto], ['verde', SEMAFORO.verde.texto]];
  document.body.insertAdjacentHTML('beforeend', `
    <div class="sheet-backdrop" id="fbm-sheet-filtro">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Filtrar el mapa</div>
        <div class="sheet-body" style="padding-bottom:16px">
          <div class="form-field">
            <div class="form-label">Semáforo</div>
            <div class="select-row flex-wrap" id="fbm-f-sem">${sems.map(([k, t]) => `<div class="select-chip ${semF_ === k ? 'active' : ''}" data-val="${k}">${t}</div>`).join('')}</div>
          </div>
          <div class="form-field">
            <div class="form-label">Técnico</div>
            <div class="select-row flex-wrap" id="fbm-f-tec">${listaTec.map(([k, t]) => `<div class="select-chip ${tecF_ === k ? 'active' : ''}" data-val="${esc(k)}">${esc(t)}</div>`).join('')}</div>
          </div>
          <button class="btn-primary full" id="fbm-f-ok">Ver en el mapa</button>
        </div>
      </div>
    </div>`);
  const sh = document.getElementById('fbm-sheet-filtro');
  const cerrar = () => sh.remove();
  sh.addEventListener('click', e => { if (e.target === sh) cerrar(); });
  ['fbm-f-sem', 'fbm-f-tec'].forEach(id => sh.querySelectorAll(`#${id} .select-chip`).forEach(c => c.onclick = () => {
    sh.querySelectorAll(`#${id} .select-chip`).forEach(x => x.classList.toggle('active', x === c));
  }));
  sh.querySelector('#fbm-f-ok').onclick = () => {
    semF_ = sh.querySelector('#fbm-f-sem .active')?.dataset.val || 'todas';
    tecF_ = sh.querySelector('#fbm-f-tec .active')?.dataset.val || 'todos';
    cerrar(); cerrarPanel();
    plotMarkers(); actualizarChip();
    // Encuadrar lo filtrado
    const pts = visibles().map(latLngDe).filter(ll => coordValida(ll[0], ll[1]));
    if (pts.length && map_) map_.fitBounds(L.latLngBounds(pts).pad(0.15), { maxZoom: 16 });
  };
  requestAnimationFrame(() => sh.classList.add('open'));
}
