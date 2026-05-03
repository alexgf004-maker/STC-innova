/**
 * js/views/mapa.js
 * Mapa de campo — Leaflet + Google Maps Hybrid.
 * Exporta: init(container, session)
 *
 * Roles:
 *   tecnico  → solo su pareja, panel inferior al tocar marcador
 *   admin/asistente → todas las parejas, asignación por zona
 */

import { db } from '../firebase.js';
import { toast } from '../ui.js';

const PAREJA_COLORS = {
  'Pareja 1': '#2dd4bf',
  'Pareja 2': '#60a5fa',
  'Pareja 3': '#a78bfa',
  'Pareja 4': '#fbbf24',
  null:       '#6b7280',
};

const ESTADO_COLORS = {
  'hecha':   '#22c55e',
  'visita':  '#111827',
  null:      null, // usa color de pareja
};

let map_ = null;
let markers_ = [];
let drawnItems_ = null;
let drawControl_ = null;
let session_, role_, pareja_;
let ordenes_ = [];
let selectedOrden_ = null;

// ── Entry point ───────────────────────────────────
export async function init(container, session) {
  session_ = session;
  role_    = session.role;
  pareja_  = session.asignacionActual?.destino || null;

  // Destruir mapa anterior si existe
  if (map_) {
    map_.remove();
    map_ = null;
    markers_ = [];
  }

  renderShell(container);
  await loadOrdenes();
  initMap();
}

// ── Shell ─────────────────────────────────────────
function renderShell(container) {
  const isTecnico = role_ === 'tecnico';

  container.innerHTML = `
    <div id="mapa-wrapper" style="
      position:fixed;
      top: var(--topbar-h, 62px);
      left:0; right:0;
      bottom: var(--navbar-h, 72px);
      z-index:1;
    ">
      <!-- Mapa -->
      <div id="leaflet-map" style="width:100%;height:100%;"></div>

      <!-- Controles superiores -->
      <div class="mapa-controls-top">
        <div class="mapa-stat-chip" id="mapa-stat">
          <div class="mapa-stat-dot"></div>
          <span id="mapa-stat-txt">Cargando…</span>
        </div>
        ${!isTecnico ? `
        <button class="mapa-btn" id="btn-asignar-zona" title="Asignar zona a pareja">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/>
          </svg>
          Asignar zona
        </button>` : ''}
        <button class="mapa-btn-icon" id="btn-mi-ubicacion" title="Mi ubicación">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
          </svg>
        </button>
      </div>

      <!-- Leyenda -->
      <div class="mapa-leyenda" id="mapa-leyenda">
        ${isTecnico ? '' : Object.entries(PAREJA_COLORS)
          .filter(([k]) => k !== 'null')
          .map(([p, c]) => `
            <div class="leyenda-item">
              <div class="leyenda-dot" style="background:${c}"></div>
              <span>${p}</span>
            </div>
          `).join('')}
        <div class="leyenda-item">
          <div class="leyenda-dot" style="background:#22c55e"></div>
          <span>Realizada</span>
        </div>
        <div class="leyenda-item">
          <div class="leyenda-dot" style="background:#f59e0b"></div>
          <span>Visita</span>
        </div>
      </div>

      <!-- Panel inferior (detalle orden) -->
      <div class="mapa-panel" id="mapa-panel">
        <div class="mapa-panel-handle" onclick="document.getElementById('mapa-panel').classList.remove('open')"></div>
        <div id="mapa-panel-content"></div>
      </div>

    </div>
  `;

  // Calcular alturas reales del topbar y navbar
  const topbar = document.querySelector('.topbar');
  const navbar  = document.querySelector('.navbar');
  if (topbar) document.getElementById('mapa-wrapper').style.top  = topbar.offsetHeight + 'px';
  if (navbar)  document.getElementById('mapa-wrapper').style.bottom = navbar.offsetHeight + 'px';

  // Inyectar sheets fuera del mapa-wrapper (necesitan z-index alto)
  const sheetsHTML = `
    <!-- Sheet motivo visita -->
    <div class="sheet-backdrop" id="sheet-visita">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Motivo de visita</div>
        <div class="sheet-body">
          <div class="form-label" style="margin-bottom:8px">Motivo principal</div>
          <div class="select-row flex-wrap" id="visita-motivo-row" style="margin-bottom:16px">
            <div class="select-chip" data-val="Medidor interno">Medidor interno</div>
            <div class="select-chip" data-val="Medidor sobre techo">Medidor sobre techo</div>
            <div class="select-chip" data-val="Panal de abejas cerca">Panal de abejas</div>
            <div class="select-chip" data-val="Cliente ausente">Cliente ausente</div>
          </div>
          <div class="form-label" style="margin-bottom:8px">Observación adicional (opcional)</div>
          <input class="form-input" id="visita-obs" type="text" placeholder="Describe la situación…" style="margin-bottom:16px"/>
          <div id="visita-error" class="form-error"></div>
          <button class="btn-primary full" id="btn-confirmar-visita" onclick="window.__mapa.confirmarVisita()">
            <span id="btn-visita-label">Registrar visita</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Sheet confirmación realizada -->
    <div class="sheet-backdrop" id="sheet-realizada">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">¿Ya actualizaste en DELSUR?</div>
        <div class="sheet-body">
          <p style="font-size:13px;color:var(--text-3);margin-bottom:20px;line-height:1.6">
            Confirma si ya ingresaste esta orden en el sistema de DELSUR.
          </p>
          <div style="display:flex;flex-direction:column;gap:8px">
            <button class="btn-action cm" id="btn-si-delsur" onclick="window.__mapa.confirmarRealizada(true)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
              Sí, ya actualicé en DELSUR
            </button>
            <button class="btn-action outline" id="btn-no-delsur" onclick="window.__mapa.confirmarRealizada(false)">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
              No, lo actualizaré después
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Sheet asignación individual -->
    <div class="sheet-backdrop" id="sheet-asignar-individual">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title" id="sheet-indiv-title">Asignar pareja</div>
        <div class="sheet-body">
          <div class="form-label" style="margin-bottom:8px">Selecciona la pareja</div>
          <div class="select-row flex-wrap" id="indiv-pareja-row" style="margin-bottom:16px">
            <div class="select-chip" data-val="Pareja 1">Pareja 1</div>
            <div class="select-chip" data-val="Pareja 2">Pareja 2</div>
            <div class="select-chip" data-val="Pareja 3">Pareja 3</div>
            <div class="select-chip" data-val="Pareja 4">Pareja 4</div>
            <div class="select-chip" data-val="null" style="color:var(--text-4)">Sin pareja</div>
          </div>
          <div id="indiv-error" class="form-error"></div>
          <button class="btn-primary full" onclick="window.__mapa.confirmarIndividual()">
            <span id="btn-indiv-label">Confirmar</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Sheet zona -->
    <div class="sheet-backdrop" id="sheet-zona">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Asignar zona</div>
        <div class="sheet-body">
          <div id="zona-preview" style="display:none" class="zona-preview-box">
            <div class="zona-preview-num" id="zona-count">0</div>
            <div class="zona-preview-label">órdenes en la zona seleccionada</div>
          </div>
          <div class="form-label" style="margin:12px 0 8px">Asignar a</div>
          <div class="select-row flex-wrap" id="zona-pareja-row" style="margin-bottom:16px">
            <div class="select-chip" data-val="Pareja 1">Pareja 1</div>
            <div class="select-chip" data-val="Pareja 2">Pareja 2</div>
            <div class="select-chip" data-val="Pareja 3">Pareja 3</div>
            <div class="select-chip" data-val="Pareja 4">Pareja 4</div>
            <div class="select-chip" data-val="null" style="color:var(--text-4)">Sin pareja</div>
          </div>
          <div id="zona-error" class="form-error"></div>
          <button class="btn-primary full" id="btn-confirmar-zona" onclick="window.__mapa.confirmarZona()">
            <span id="btn-zona-label">Confirmar asignación</span>
          </button>
          <button class="btn-action outline" id="btn-cancelar-zona" onclick="window.__mapa.cancelarZona()" style="margin-top:8px;width:100%;height:44px">
            Cancelar y borrar zona
          </button>
        </div>
      </div>
    </div>
  `;

  // Eliminar sheets anteriores si existen
  ['sheet-visita','sheet-realizada','sheet-zona'].forEach(id => {
    document.getElementById(id)?.remove();
  });

  // Insertar en body directamente
  document.body.insertAdjacentHTML('beforeend', sheetsHTML);

  // Eventos del mapa-wrapper
  document.getElementById('btn-asignar-zona')?.addEventListener('click', activarModoZona);
  document.getElementById('btn-mi-ubicacion')?.addEventListener('click', () => {
    if (geoMarker_) {
      map_.setView(geoMarker_.getLatLng(), 17);
    } else {
      toast('Obteniendo ubicación…', 'ok');
    }
  });

  // Cerrar panel al tocar fuera
  document.getElementById('mapa-panel')?.addEventListener('click', e => {
    if (e.target === document.getElementById('mapa-panel')) closePanel();
  });

  // Eventos de sheets (ahora ya existen en el DOM)
  document.getElementById('btn-confirmar-zona')?.addEventListener('click', confirmarZona);
  document.getElementById('btn-cancelar-zona')?.addEventListener('click', cancelarZona);
  document.getElementById('btn-confirmar-visita')?.addEventListener('click', confirmarVisita);
  document.getElementById('btn-si-delsur')?.addEventListener('click', () => confirmarRealizada(true));
  document.getElementById('btn-no-delsur')?.addEventListener('click', () => confirmarRealizada(false));

  // Select chips
  setupSelectChips('zona-pareja-row');
  setupSelectChips('visita-motivo-row');
  setupSelectChips('indiv-pareja-row');

  // Cerrar sheets al tocar backdrop
  document.getElementById('sheet-zona')?.addEventListener('click', e => {
    if (e.target === document.getElementById('sheet-zona')) cancelarZona();
  });
  ['sheet-visita', 'sheet-realizada', 'sheet-asignar-individual'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      if (e.target === document.getElementById(id)) closeSheet(id);
    });
  });

  window.__mapa = { verOrden, marcarHecha, marcarVisita, abrirGoogleMaps, confirmarRealizada, confirmarVisita, asignarIndividual, confirmarIndividual, confirmarZona, cancelarZona };
}

// ── Cargar órdenes ────────────────────────────────
async function loadOrdenes() {
  try {
    let query = db.collection('cambios_ordenes')
      .where('latitud',  '!=', null);

    if (role_ === 'tecnico' && pareja_) {
      query = db.collection('cambios_ordenes')
        .where('pareja', '==', pareja_);
    }

    const snap = await query.get();
    ordenes_ = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(o => o.latitud && o.longitud);

  } catch (err) {
    console.error('[mapa] Error cargando órdenes:', err);
    ordenes_ = [];
  }
}

// ── Inicializar mapa Leaflet ──────────────────────
function initMap() {
  // Centro inicial — El Salvador
  const center = [13.7942, -88.8965];
  const zoom   = ordenes_.length ? 13 : 8;

  map_ = L.map('leaflet-map', {
    center,
    zoom,
    zoomControl: false,
    attributionControl: false,
  });

  // Google Maps Hybrid tiles
  L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    attribution: '© Google',
  }).addTo(map_);

  // Zoom control en posición correcta
  L.control.zoom({ position: 'bottomright' }).addTo(map_);

  // Cerrar panel al tocar el mapa
  map_.on('click', closePanel);

  // Inicializar capa de dibujo (solo admin/asistente)
  if (role_ !== 'tecnico') {
    drawnItems_ = new L.FeatureGroup();
    map_.addLayer(drawnItems_);

    drawControl_ = new L.Control.Draw({
      position: 'topright',
      draw: {
        rectangle: {
          shapeOptions: { color: '#2dd4bf', weight: 2, fillOpacity: 0.1 },
        },
        polygon:   false,
        polyline:  false,
        circle:    false,
        marker:    false,
        circlemarker: false,
      },
      edit: { featureGroup: drawnItems_, remove: true },
    });
    // No agregar control automáticamente — se activa al presionar "Asignar zona"

    map_.on('click', closePanel);
  }

  // Dibujar marcadores
  plotMarkers();

  // Ajustar bounds si hay órdenes
  if (ordenes_.length && markers_.length) {
    const group = L.featureGroup(markers_);
    map_.fitBounds(group.getBounds().pad(0.1));
  }

  // Actualizar stat chip
  updateStatChip();

  // Geolocalización — mostrar posición actual
  iniciarGeolocalizacion();
}

// ── Geolocalización ───────────────────────────────
let geoMarker_ = null;
let geoCircle_ = null;

function iniciarGeolocalizacion() {
  if (!navigator.geolocation) return;

  const iconHtml = `
    <div style="
      width:16px; height:16px;
      background:#3b82f6;
      border:3px solid white;
      border-radius:50%;
      box-shadow:0 0 0 4px rgba(59,130,246,.3);
    "></div>
  `;

  navigator.geolocation.watchPosition(
    pos => {
      const { latitude: lat, longitude: lng, accuracy } = pos.coords;

      if (geoMarker_) {
        geoMarker_.setLatLng([lat, lng]);
        geoCircle_.setLatLng([lat, lng]).setRadius(accuracy);
      } else {
        geoMarker_ = L.marker([lat, lng], {
          icon: L.divIcon({
            className: '',
            html: iconHtml,
            iconSize:   [16, 16],
            iconAnchor: [8, 8],
          }),
          zIndexOffset: 1000,
        }).addTo(map_);

        geoCircle_ = L.circle([lat, lng], {
          radius:      accuracy,
          color:       '#3b82f6',
          fillColor:   '#3b82f6',
          fillOpacity: 0.08,
          weight:      1,
        }).addTo(map_);
      }
    },
    err => console.warn('[mapa] Geolocalización:', err.message),
    { enableHighAccuracy: true, maximumAge: 5000, timeout: 10000 }
  );
}

// ── Marcadores ────────────────────────────────────
function plotMarkers() {
  // Limpiar marcadores anteriores
  markers_.forEach(m => map_.removeLayer(m));
  markers_ = [];

  ordenes_.forEach(orden => {
    if (!orden.latitud || !orden.longitud) return;

    const color = ESTADO_COLORS[orden.estadoCampo] || PAREJA_COLORS[orden.pareja] || PAREJA_COLORS[null];
    const size  = orden.estadoCampo === 'hecha' ? 10 : 14;

    const icon = L.divIcon({
      className: '',
      html: `
        <div style="
          width:${size}px;height:${size}px;
          background:${color};
          border:2px solid rgba(255,255,255,.8);
          border-radius:50%;
          box-shadow:0 2px 6px rgba(0,0,0,.4);
          ${orden.estadoCampo === 'hecha' ? 'opacity:0.6' : ''}
        "></div>
      `,
      iconSize:   [size, size],
      iconAnchor: [size/2, size/2],
    });

    const marker = L.marker([orden.latitud, orden.longitud], { icon });
    marker.on('click', () => verOrden(orden.id));
    marker.addTo(map_);
    markers_.push(marker);
  });
}

function updateStatChip() {
  const total   = ordenes_.length;
  const hechas  = ordenes_.filter(o => o.estadoCampo === 'hecha').length;
  const sinAsig = ordenes_.filter(o => !o.pareja).length;

  const txt = document.getElementById('mapa-stat-txt');
  if (!txt) return;

  if (sinAsig > 0) {
    txt.textContent = `${sinAsig} sin asignar · ${hechas}/${total} realizadas`;
    document.querySelector('.mapa-stat-dot').style.background = '#f59e0b';
  } else {
    txt.textContent = `${hechas} de ${total} realizadas`;
    document.querySelector('.mapa-stat-dot').style.background = '#22c55e';
  }
}

// ── Panel inferior de detalle ─────────────────────
function verOrden(id) {
  const o = ordenes_.find(x => x.id === id);
  if (!o) return;
  selectedOrden_ = o;

  const isTecnico = role_ === 'tecnico';
  const c = PAREJA_COLORS[o.pareja] || '#6b7280';

  const panel   = document.getElementById('mapa-panel');
  const content = document.getElementById('mapa-panel-content');

  content.innerHTML = `
    <div class="panel-orden-header">
      <div style="flex:1;min-width:0">
        <div class="panel-orden-wo">WO ${o.wo || '—'}</div>
        <div class="panel-orden-cliente">${o.cliente || '—'}</div>
        <div class="panel-orden-dir">${o.direccion || ''}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
        ${o.pareja ? `<div class="pareja-chip" style="color:${c};border-color:${c}33;background:${c}15">${o.pareja}</div>` : ''}
        ${o.estadoCampo === 'hecha'  ? '<div class="estado-badge ok">Realizada</div>'    : ''}
        ${o.estadoCampo === 'visita' ? '<div class="estado-badge warn">Visita</div>'     : ''}
        ${!o.estadoCampo             ? '<div class="estado-badge muted">Pendiente</div>' : ''}
      </div>
    </div>

    <!-- Info técnica -->
    <div class="panel-detail-grid">
      ${o.nc       ? `<div class="panel-detail-item"><div class="panel-detail-key">NC</div><div class="panel-detail-val">${o.nc}</div></div>` : ''}
      ${o.serie    ? `<div class="panel-detail-item"><div class="panel-detail-key">Serie</div><div class="panel-detail-val">${o.serie}</div></div>` : ''}
      ${o.dsct     ? `<div class="panel-detail-item"><div class="panel-detail-key">DSCT</div><div class="panel-detail-val">${o.dsct}</div></div>` : ''}
      ${o.unidadLectura ? `<div class="panel-detail-item"><div class="panel-detail-key">MRU</div><div class="panel-detail-val">${o.unidadLectura}</div></div>` : ''}
      ${o.concepto ? `<div class="panel-detail-item full"><div class="panel-detail-key">Concepto</div><div class="panel-detail-val">${o.concepto}</div></div>` : ''}
      ${o.motivoVisita ? `<div class="panel-detail-item full"><div class="panel-detail-key">Motivo visita</div><div class="panel-detail-val" style="color:#fbbf24">${o.motivoVisita}${o.observacionVisita ? ' — ' + o.observacionVisita : ''}</div></div>` : ''}
    </div>

    ${o.telefono ? `
    <div class="panel-orden-tel">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13">
        <path d="M22 16.92v3a2 2 0 01-2.18 2 19.79 19.79 0 01-8.63-3.07A19.5 19.5 0 014.17 9.82a19.79 19.79 0 01-3.07-8.59A2 2 0 013.08 1h3a2 2 0 012 1.72c.127.96.361 1.903.7 2.81a2 2 0 01-.45 2.11L7.09 8.91a16 16 0 006 6l1.27-1.27a2 2 0 012.11-.45c.907.339 1.85.573 2.81.7A2 2 0 0122 16.92z"/>
      </svg>
      <a href="tel:${o.telefono}">${o.telefono}</a>
    </div>` : ''}

    <div class="panel-orden-actions">
      ${isTecnico && (!o.estadoCampo || o.estadoCampo === 'visita') ? `
        <button class="btn-action cm" onclick="window.__mapa.marcarHecha('${o.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Realizada
        </button>` : ''}
      ${isTecnico && !o.estadoCampo ? `
        <button class="btn-action outline" onclick="window.__mapa.marcarVisita('${o.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          Visita
        </button>` : ''}
      ${!isTecnico ? `
        <button class="btn-action cm" onclick="window.__mapa.asignarIndividual('${o.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
          Asignar pareja
        </button>` : ''}
      <button class="btn-action outline" onclick="window.__mapa.abrirGoogleMaps(${o.latitud},${o.longitud})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
        Navegar
      </button>
    </div>
  `;

  panel.classList.add('open');
}

function closePanel() {
  document.getElementById('mapa-panel')?.classList.remove('open');
  selectedOrden_ = null;
}

// ── Acciones desde mapa ───────────────────────────
function marcarHecha(id) {
  const o = ordenes_.find(x => x.id === id);
  if (!o) return;
  closePanel();           // limpia panel pero también pone selectedOrden_ = null
  selectedOrden_ = o;     // restaurar después de closePanel
  openSheet('sheet-realizada');
}

async function confirmarRealizada(actualizadaDelsur) {
  if (!selectedOrden_) return;
  const id = selectedOrden_.id;
  closeSheet('sheet-realizada');
  selectedOrden_ = null;

  try {
    const now = firebase.firestore.Timestamp.now();
    await db.collection('cambios_ordenes').doc(id).update({
      estadoCampo:       'hecha',
      fechaHecha:        now,
      hechaPor:          session_.displayName,
      actualizadaDelsur,
    });
    const o = ordenes_.find(x => x.id === id);
    if (o) { o.estadoCampo = 'hecha'; o.actualizadaDelsur = actualizadaDelsur; }
    plotMarkers();
    updateStatChip();
    window.dispatchEvent(new CustomEvent('cambios:updated'));
    toast(actualizadaDelsur ? 'Realizada y actualizada en DELSUR' : 'Realizada — pendiente actualizar en DELSUR', 'ok');
  } catch (err) {
    console.error('[mapa] Error marcando hecha:', err);
    toast('Error al guardar', 'error');
  }
}

function marcarVisita(id) {
  const o = ordenes_.find(x => x.id === id);
  if (!o) return;
  closePanel();           // limpia panel pero también pone selectedOrden_ = null
  selectedOrden_ = o;     // restaurar después de closePanel

  document.querySelectorAll('#visita-motivo-row .select-chip').forEach(c => c.classList.remove('active'));
  document.getElementById('visita-obs').value = '';
  document.getElementById('visita-error').style.display = 'none';

  openSheet('sheet-visita');
}

async function confirmarVisita() {
  if (!selectedOrden_) return;

  const motivo = getSelectedChip('visita-motivo-row');
  const obs    = document.getElementById('visita-obs').value.trim();
  const errEl  = document.getElementById('visita-error');

  if (!motivo) {
    errEl.textContent = 'Selecciona un motivo de visita.';
    errEl.style.display = 'block';
    return;
  }

  const id = selectedOrden_.id;
  setLoading('btn-visita-label', 'Registrando…', true);

  try {
    const now = firebase.firestore.Timestamp.now();
    await db.collection('cambios_ordenes').doc(id).update({
      estadoCampo:       'visita',
      fechaVisita:       now,
      visitadoPor:       session_.displayName,
      motivoVisita:      motivo,
      observacionVisita: obs || null,
    });

    const o = ordenes_.find(x => x.id === id);
    if (o) {
      o.estadoCampo       = 'visita';
      o.motivoVisita      = motivo;
      o.observacionVisita = obs || null;
    }

    selectedOrden_ = null;
    plotMarkers();
    updateStatChip();
    window.dispatchEvent(new CustomEvent('cambios:updated'));
    closeSheet('sheet-visita');
    toast(`Visita registrada — ${motivo}`, 'ok');
  } catch (err) {
    console.error('[mapa] Error registrando visita:', err);
    errEl.textContent = 'Error al guardar. Intenta de nuevo.';
    errEl.style.display = 'block';
  } finally {
    setLoading('btn-visita-label', 'Registrar visita', false);
  }
}

function abrirGoogleMaps(lat, lng) {
  window.open(`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`, '_blank');
}

// ── Asignación individual ─────────────────────────
function asignarIndividual(id) {
  const o = ordenes_.find(x => x.id === id);
  if (!o) return;
  closePanel();
  selectedOrden_ = o;

  // Pre-seleccionar pareja actual si existe
  document.querySelectorAll('#indiv-pareja-row .select-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.val === (o.pareja || 'null'));
  });
  document.getElementById('indiv-error').style.display = 'none';
  document.getElementById('sheet-indiv-title').textContent = `Asignar: WO ${o.wo || '—'}`;
  openSheet('sheet-asignar-individual');
}

async function confirmarIndividual() {
  if (!selectedOrden_) return;
  const parejaVal = getSelectedChip('indiv-pareja-row');
  if (!parejaVal) {
    document.getElementById('indiv-error').textContent = 'Selecciona una pareja.';
    document.getElementById('indiv-error').style.display = 'block';
    return;
  }

  const pareja = parejaVal === 'null' ? null : parejaVal;
  const id     = selectedOrden_.id;

  setLoading('btn-indiv-label', 'Guardando…', true);
  try {
    await db.collection('cambios_ordenes').doc(id).update({
      pareja,
      asignadoEn: firebase.firestore.FieldValue.serverTimestamp(),
    });
    const o = ordenes_.find(x => x.id === id);
    if (o) o.pareja = pareja;
    selectedOrden_ = null;
    plotMarkers();
    updateStatChip();
    closeSheet('sheet-asignar-individual');
    toast(pareja ? `Asignada a ${pareja}` : 'Orden desasignada', 'ok');
  } catch (err) {
    console.error('[mapa] Error asignando:', err);
    document.getElementById('indiv-error').textContent = 'Error al guardar.';
    document.getElementById('indiv-error').style.display = 'block';
  } finally {
    setLoading('btn-indiv-label', 'Confirmar', false);
  }
}

// ── Asignación por zona ───────────────────────────
let zonaActual_ = null;

function activarModoZona() {
  if (!map_ || !drawControl_) return;
  map_.addControl(drawControl_);
  closePanel();
  toast('Dibuja un rectángulo sobre las órdenes a asignar', 'ok', 4000);
}

function onZonaCreada(e) {
  drawnItems_.clearLayers();
  zonaActual_ = e.layer;
  drawnItems_.addLayer(zonaActual_);
  map_.removeControl(drawControl_);

  const bounds = zonaActual_.getBounds();
  const dentro = ordenes_.filter(o =>
    o.latitud && o.longitud &&
    bounds.contains(L.latLng(o.latitud, o.longitud))
  );

  document.getElementById('zona-count').textContent = dentro.length;
  document.getElementById('zona-preview').style.display = dentro.length ? '' : 'none';
  document.getElementById('zona-error').style.display = 'none';

  // Reset selección de pareja
  document.querySelectorAll('#zona-pareja-row .select-chip').forEach(c => c.classList.remove('active'));

  openSheet('sheet-zona');
}

async function confirmarZona() {
  const parejaVal = getSelectedChip('zona-pareja-row');
  const errEl     = document.getElementById('zona-error');

  if (!parejaVal) {
    errEl.textContent = 'Selecciona una pareja o "Sin pareja".';
    errEl.style.display = 'block';
    return;
  }
  if (!zonaActual_) {
    errEl.textContent = 'Dibuja una zona primero.';
    errEl.style.display = 'block';
    return;
  }

  const pareja = parejaVal === 'null' ? null : parejaVal;
  const bounds = zonaActual_.getBounds();
  const dentro = ordenes_.filter(o =>
    o.latitud && o.longitud &&
    bounds.contains(L.latLng(o.latitud, o.longitud))
  );

  if (!dentro.length) {
    errEl.textContent = 'No hay órdenes en esa zona.';
    errEl.style.display = 'block';
    return;
  }

  setLoading('btn-zona-label', 'Asignando…', true);
  try {
    const ts = firebase.firestore.FieldValue.serverTimestamp();
    let batch = db.batch();
    let count = 0;
    const batches = [];

    for (const o of dentro) {
      batch.update(db.collection('cambios_ordenes').doc(o.id), {
        pareja,
        asignadoEn: ts,
      });
      count++;
      if (count === 499) {
        batches.push(batch.commit());
        batch = db.batch();
        count = 0;
      }
    }
    if (count > 0) batches.push(batch.commit());
    await Promise.all(batches);

    dentro.forEach(o => { o.pareja = pareja; });
    drawnItems_.clearLayers();
    zonaActual_ = null;
    plotMarkers();
    updateStatChip();
    closeSheet('sheet-zona');
    toast(pareja
      ? `${dentro.length} órdenes asignadas a ${pareja}`
      : `${dentro.length} órdenes desasignadas`, 'ok');
  } catch (err) {
    console.error('[mapa] Error asignando zona:', err);
    errEl.textContent = 'Error al asignar. Intenta de nuevo.';
    errEl.style.display = 'block';
  } finally {
    setLoading('btn-zona-label', 'Confirmar asignación', false);
  }
}

function cancelarZona() {
  drawnItems_?.clearLayers();
  zonaActual_ = null;
  try { map_.removeControl(drawControl_); } catch {}
  closeSheet('sheet-zona');
}

// ── Helpers ───────────────────────────────────────
function openSheet(id)  { document.getElementById(id)?.classList.add('open'); }
function closeSheet(id) { document.getElementById(id)?.classList.remove('open'); }

function setupSelectChips(rowId) {
  const row = document.getElementById(rowId);
  if (!row) return;
  row.querySelectorAll('.select-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      row.querySelectorAll('.select-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
    });
  });
}

function getSelectedChip(rowId) {
  return document.querySelector(`#${rowId} .select-chip.active`)?.dataset.val || null;
}

function setLoading(labelId, text, loading) {
  const el = document.getElementById(labelId);
  if (!el) return;
  el.innerHTML = loading ? '<div class="spinner"></div>' : text;
  const btn = el.closest('button');
  if (btn) btn.disabled = loading;
}
