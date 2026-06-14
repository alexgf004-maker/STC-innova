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
  'Pareja 2': '#f472b6',
  'Pareja 3': '#a78bfa',
  'Pareja 4': '#fbbf24',
  null:       '#6b7280',
};

const ESTADO_COLORS = {
  'hecha':       '#22c55e',
  'aprobada':    '#22c55e',
  'visita':      '#111827',
  'ya_cambiado': '#f97316',
  'urgente':     '#ef4444',
  null:          null,
};

let map_ = null;
let calendario_ = []; // lecturas cargadas desde Firestore

function isBlocked_(orden) {
  if (!orden.unidadLectura || !calendario_.length) return false;
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  return calendario_.some(cal => {
    if (!orden.unidadLectura.startsWith(cal.mru)) return false;
    let fecha;
    if (cal.fechaLectura?.toDate) {
      fecha = cal.fechaLectura.toDate();
    } else if (typeof cal.fechaLectura === 'string') {
      const [y,m,d] = cal.fechaLectura.split('-').map(Number);
      fecha = new Date(y, m-1, d);
    } else {
      fecha = new Date(cal.fechaLectura);
    }
    fecha.setHours(0,0,0,0);
    return Math.abs((fecha - hoy) / (1000*60*60*24)) <= 2;
  });
}
let markers_ = [];
let drawnItems_ = null;
let drawControl_ = null;
let session_, role_, pareja_;
let ordenes_ = [];
let urgentesVistas_ = new Set();
let selectedOrden_ = null;

// ── Entry point ───────────────────────────────────
export async function init(container, session) {
  session_ = session;
  role_    = session.role;
  pareja_  = session.asignacionActual?.destino || null;

  // Cancelar listener anterior si el módulo se reinicia
  if (unsubscribe_) { unsubscribe_(); unsubscribe_ = null; }
  if (map_) { map_.remove(); map_ = null; markers_ = []; }

  renderShell(container);

  // Iniciar listener en tiempo real ANTES de initMap
  suscribirOrdenes();

  // Esperar primera carga antes de inicializar el mapa
  await loadOrdenes();

  // Cargar calendario de lecturas para bloqueos visuales
  try {
    const calSnap = await db.collection('cambios_calendario').get();
    calendario_ = calSnap.docs.map(d => d.data());
  } catch(err) {
    console.warn('[mapa] Error cargando calendario:', err);
  }
  initMap();
}

// ── Shell ─────────────────────────────────────────
function renderShell(container) {
  const isTecnico = role_ === 'tecnico';

  container.innerHTML = `
    <style>
      @keyframes pulso-urgente {
        0%   { transform:scale(1);   opacity:.7; }
        100% { transform:scale(2.5); opacity:0;  }
      }
    </style>
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
        ${role_ === 'tecnico' ? `
        <button class="mapa-btn-icon" id="btn-reset-norte" title="Volver al norte" style="display:none">
          <svg id="brujula-svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/>
          </svg>
        </button>` : ''}
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

  // Eliminar sheets anteriores si quedaron del body
  ['sheet-visita','sheet-realizada','sheet-zona','sheet-ya-cambiado','sheet-pedir-ayuda','sheet-asignar-individual'].forEach(id => {
    document.getElementById(id)?.remove();
  });
  // Insertar sheets en body (position:fixed necesita estar fuera de content-area)
  document.body.insertAdjacentHTML('beforeend', sheetsMapaHTML());

  // Calcular alturas reales del topbar y navbar
  const topbar = document.querySelector('.topbar');
  const navbar  = document.querySelector('.navbar');
  const wrapper = document.getElementById('mapa-wrapper');

  const isPC = window.innerWidth >= 768;
  if (isPC) {
    // En PC: sidebar a la izquierda, no hay navbar inferior
    const sidebarW = navbar ? navbar.offsetWidth : 200;
    const topbarH  = topbar ? topbar.offsetHeight : 56;
    wrapper.style.top    = topbarH + 'px';
    wrapper.style.bottom = '0px';
    wrapper.style.left   = sidebarW + 'px';
    wrapper.style.right  = '0px';
  } else {
    // En móvil: navbar inferior
    if (topbar) wrapper.style.top    = topbar.offsetHeight + 'px';
    if (navbar) wrapper.style.bottom = navbar.offsetHeight + 'px';
  }


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

  document.getElementById('btn-confirmar-ya-cambiado')?.addEventListener('click', confirmarYaCambiado);

  // Opciones de ayuda
  document.querySelectorAll('.ayuda-opcion').forEach(btn => {
    btn.addEventListener('click', () => {
      const motivo = btn.dataset.motivo;
      enviarAyudaWhatsApp(motivo);
    });
  });

  window.__mapa = { verOrden, marcarHecha, marcarVisita, abrirGoogleMaps, confirmarRealizada, confirmarVisita, asignarIndividual, confirmarIndividual, confirmarZona, cancelarZona, abrirYaCambiado, abrirPedirAyuda };

  // onSnapshot ya maneja actualizaciones en tiempo real
  // Este listener es fallback para cambios desde cambios.js
  window.addEventListener('cambios:updated', () => {
    // onSnapshot se encarga automáticamente
  });
}

// ── Listener en tiempo real ───────────────────────
let unsubscribe_ = null; // para cancelar el listener al salir del módulo

function suscribirOrdenes() {
  // Cancelar listener anterior si existe
  if (unsubscribe_) { unsubscribe_(); unsubscribe_ = null; }

  let query = role_ === 'tecnico' && pareja_
    ? db.collection('cambios_ordenes').where('pareja', '==', pareja_)
    : db.collection('cambios_ordenes');

  unsubscribe_ = query.onSnapshot(snap => {
    ordenes_ = snap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .filter(o => o.latitud && o.longitud);

    plotMarkers();
    updateStatChip();
  }, err => {
    console.error('[mapa] Error en listener:', err);
  });
}

async function loadOrdenes() {
  // Mantener compatibilidad — la carga inicial la hace suscribirOrdenes
  return new Promise(resolve => {
    if (ordenes_.length) { resolve(); return; }
    const timer = setTimeout(resolve, 3000); // máx 3s de espera
    const check = setInterval(() => {
      if (ordenes_.length) { clearTimeout(timer); clearInterval(check); resolve(); }
    }, 100);
  });
}

// ── Inicializar mapa Leaflet ──────────────────────
function initMap() {
  // Centro inicial — El Salvador
  const center = [13.7942, -88.8965];
  const zoom   = ordenes_.length ? 13 : 8;

  // Rotación solo para técnicos
  const conRotacion = role_ === 'tecnico';

  map_ = L.map('leaflet-map', {
    center,
    zoom,
    zoomControl: false,
    attributionControl: false,
    ...(conRotacion ? { rotate: true, touchRotate: true, rotateControl: false } : {}),
  });

  // Google Maps Hybrid tiles
  const tileLayer_ = L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 20,
    attribution: '© Google',
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', // tile transparente en error
    keepBuffer: 4, // mantener más tiles en buffer
  }).addTo(map_);

  // Si falla un tile, no hacer nada — marcadores y GPS siguen visibles
  tileLayer_.on('tileerror', () => {});

  // Cuando se recupera la señal, recargar tiles sin tocar marcadores
  window.addEventListener('online', () => {
    tileLayer_.redraw();
  });

  // Zoom control en posición correcta
  L.control.zoom({ position: 'bottomright' }).addTo(map_);

  // Cerrar panel al tocar el mapa
  map_.on('click', closePanel);

  // Redibujar etiquetas al cambiar zoom
  map_.on('zoomend', () => plotMarkers());

  // Brújula — solo para técnicos
  if (conRotacion) {
    document.getElementById('btn-reset-norte')?.addEventListener('click', () => {
      map_.setBearing(0);
    });
    map_.on('rotate', () => {
      const bearing = map_.getBearing();
      const btn = document.getElementById('btn-reset-norte');
      const svg = document.getElementById('brujula-svg');
      if (btn) btn.style.display = Math.abs(bearing) > 1 ? '' : 'none';
      if (svg) svg.style.transform = `rotate(${-bearing}deg)`;
    });
  }

  // Solo admin/asistente tiene el botón de zona — se activa con btn-asignar-zona
  // (no hay listener de click aquí, se maneja en activarModoZona)

  // Dibujar marcadores
  plotMarkers();

  // Notificar urgentes nuevas al técnico (solo una vez por sesión por orden)
  if (role_ === 'tecnico') {
    const urgentes = ordenes_.filter(o => o.urgente && !o.estadoCampo && o.pareja === pareja_);
    const nuevas   = urgentes.filter(o => !urgentesVistas_.has(o.id));
    if (nuevas.length) {
      nuevas.forEach(o => urgentesVistas_.add(o.id));
      setTimeout(() => mostrarAlertaUrgente(nuevas), 800);
    }
  }

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

      if (!map_) return; // mapa ya no existe

      if (geoMarker_) {
        geoMarker_.setLatLng([lat, lng]);
        geoCircle_.setLatLng([lat, lng]).setRadius(accuracy);
        // Re-añadir al mapa si se perdió (puede pasar offline)
        if (!map_.hasLayer(geoMarker_)) geoMarker_.addTo(map_);
        if (!map_.hasLayer(geoCircle_)) geoCircle_.addTo(map_);
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
  markers_.forEach(m => map_.removeLayer(m));
  markers_ = [];

  const mostrarLabels = map_.getZoom() >= 16;
  const visibles = ordenes_.filter(o => o.estadoCampo !== 'aprobada');

  visibles.forEach(orden => {
    if (!orden.latitud || !orden.longitud) return;

    const bloqueada = !orden.estadoCampo && isBlocked_(orden);
    const color = bloqueada
      ? '#4b5563'
      : ESTADO_COLORS[orden.estadoCampo] || PAREJA_COLORS[orden.pareja] || PAREJA_COLORS[null];
    const size  = orden.estadoCampo === 'hecha' ? 10 : 14;
    const wo    = orden.wo || '';

    const labelHtml = mostrarLabels && wo && !bloqueada ? `
      <div style="
        position:absolute;
        top:${size + 3}px;
        left:50%;
        transform:translateX(-50%);
        white-space:nowrap;
        font-size:9px;
        font-weight:700;
        font-family:'Outfit',sans-serif;
        color:white;
        text-shadow:0 1px 3px rgba(0,0,0,.9),0 0 6px rgba(0,0,0,.7);
        pointer-events:none;
        letter-spacing:.02em;
      ">${wo}</div>` : '';

    const yaCambiado = orden.estadoCampo === 'ya_cambiado';
    const esUrgente  = orden.urgente && !orden.estadoCampo;
    const icon = L.divIcon({
      className: '',
      html: bloqueada ? `
        <div style="
          width:22px;height:22px;
          background:#1f2937;
          border:2px solid #4b5563;
          border-radius:6px;
          display:flex;align-items:center;justify-content:center;
          box-shadow:0 2px 6px rgba(0,0,0,.5);
        ">
          <svg viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="11" height="11">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0110 0v4"/>
          </svg>
        </div>
      ` : yaCambiado ? `
        <div style="
          width:22px;height:22px;
          background:rgba(249,115,22,.15);
          border:2px solid #f97316;
          border-radius:6px;
          display:flex;align-items:center;justify-content:center;
          box-shadow:0 2px 6px rgba(0,0,0,.5);
        ">
          <svg viewBox="0 0 24 24" fill="none" stroke="#f97316" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="11" height="11">
            <circle cx="12" cy="12" r="10"/>
            <line x1="12" y1="8" x2="12" y2="12"/>
            <line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
        </div>
      ` : esUrgente ? `
        <div style="position:relative;width:20px;height:20px">
          <div style="position:absolute;inset:0;background:rgba(239,68,68,.3);border-radius:50%;animation:pulso-urgente 1.5s ease-out infinite"></div>
          <div style="position:absolute;inset:2px;background:#ef4444;border:2px solid rgba(255,255,255,.9);border-radius:50%;box-shadow:0 2px 8px rgba(239,68,68,.6)"></div>
        </div>
      ` : `
        <div style="position:relative">
          <div style="
            width:${size}px;height:${size}px;
            background:${color};
            border:2px solid rgba(255,255,255,.8);
            border-radius:50%;
            box-shadow:0 2px 6px rgba(0,0,0,.4);
            ${orden.estadoCampo === 'hecha' ? 'opacity:0.6' : ''}
          "></div>
          ${labelHtml}
        </div>
      `,
      iconSize:   (bloqueada || yaCambiado) ? [22,22] : esUrgente ? [20,20] : [size, size],
      iconAnchor: (bloqueada || yaCambiado) ? [11,11]  : esUrgente ? [10,10] : [size/2, size/2],
    });

    const marker = L.marker([orden.latitud, orden.longitud], { icon });
    marker.on('click', () => verOrden(orden.id));
    marker.addTo(map_);
    markers_.push(marker);
  });

  // Si el mapa pierde layers offline, re-añadir marcadores al recuperarse
  map_.once('layeradd', () => {
    markers_.forEach(m => { if (!map_.hasLayer(m)) m.addTo(map_); });
  });
}

function updateStatChip() {
  const activas  = ordenes_.filter(o => o.estadoCampo !== 'aprobada');
  const total    = activas.length;
  const hechas   = activas.filter(o => o.estadoCampo === 'hecha').length;
  const sinAsig  = activas.filter(o => !o.pareja).length;
  const aprobadas = ordenes_.filter(o => o.estadoCampo === 'aprobada').length;

  const txt = document.getElementById('mapa-stat-txt');
  if (!txt) return;

  if (sinAsig > 0) {
    txt.textContent = `${sinAsig} sin asignar · ${hechas}/${total} pendientes`;
    document.querySelector('.mapa-stat-dot').style.background = '#f59e0b';
  } else if (total === 0) {
    txt.textContent = `${aprobadas} órdenes aprobadas ✓`;
    document.querySelector('.mapa-stat-dot').style.background = '#22c55e';
  } else {
    txt.textContent = `${hechas} realizadas · ${total - hechas} pendientes · ${aprobadas} aprobadas`;
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

  // Si está bloqueada por lectura, mostrar solo el candado
  if (isBlocked_(o)) {
    content.innerHTML = `
      <div style="padding:24px 16px;text-align:center">
        <svg viewBox="0 0 24 24" fill="none" stroke="#6b7280" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="40" height="40" style="margin:0 auto 12px">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
          <path d="M7 11V7a5 5 0 0110 0v4"/>
        </svg>
        <div style="font-size:14px;font-weight:700;color:var(--text-2);margin-bottom:6px">Orden bloqueada</div>
        <div style="font-size:12px;color:var(--text-4)">Esta orden está en período de lectura<br>y no puede realizarse en este momento.</div>
      </div>
    `;
    panel.classList.add('open');
    return;
  }

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
      ${o.nc          ? `<div class="panel-detail-item"><div class="panel-detail-key">NC</div><div class="panel-detail-val">${o.nc}</div></div>` : ''}
      ${(o.serieActual || o.serie) ? `<div class="panel-detail-item"><div class="panel-detail-key">Serie medidor</div><div class="panel-detail-val" style="font-family:monospace;font-weight:700;color:var(--cm-light)">${o.serieActual || o.serie}</div></div>` : ''}
      ${o.marca       ? `<div class="panel-detail-item"><div class="panel-detail-key">Marca</div><div class="panel-detail-val">${o.marca}</div></div>` : ''}
      ${o.dsct        ? `<div class="panel-detail-item"><div class="panel-detail-key">DSCT</div><div class="panel-detail-val">${o.dsct}</div></div>` : ''}
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
      <button class="btn-action outline" onclick="window.__mapa.abrirGoogleMaps(${o.latitud},${o.longitud})">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
        Navegar
      </button>
      ${!isTecnico ? `
        <button class="btn-action cm" onclick="window.__mapa.asignarIndividual('${o.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
          Asignar pareja
        </button>` : ''}
      ${isTecnico && !o.estadoCampo ? `
        <button class="icon-btn" title="Registrar visita" onclick="window.__mapa.marcarVisita('${o.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
        </button>` : ''}
      ${isTecnico && (!o.estadoCampo || o.estadoCampo === 'visita') ? `
        <button class="icon-btn" title="Ya estaba cambiado" style="color:#fb923c;border-color:rgba(249,115,22,.3)" onclick="window.__mapa.abrirYaCambiado('${o.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
        </button>
        <button class="icon-btn" title="Pedir ayuda" style="color:#fbbf24;border-color:rgba(251,191,36,.3)" onclick="window.__mapa.abrirPedirAyuda('${o.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>
        </button>` : ''}
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

  // Obtener pareja del día
  let parejaDelDia = [session_.displayName];
  try {
    const destino = session_.asignacionActual?.destino;
    if (destino) {
      const snap = await db.collection('users')
        .where('asignacionActual.destino', '==', destino)
        .where('active', '==', true).get();
      parejaDelDia = snap.docs.map(d => d.data().displayName);
    }
  } catch { /* sin conexión */ }

  try {
    const now = firebase.firestore.Timestamp.now();
    await db.collection('cambios_ordenes').doc(id).update({
      estadoCampo:       'hecha',
      fechaHecha:        now,
      hechaPor:          session_.displayName,
      actualizadaDelsur,
      parejaDelDia,
    });
    const o = ordenes_.find(x => x.id === id);
    if (o) { o.estadoCampo = 'hecha'; o.actualizadaDelsur = actualizadaDelsur; o.parejaDelDia = parejaDelDia; }
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

// ── Ya estaba cambiado ────────────────────────────
function mostrarAlertaUrgente(urgentes) {
  document.getElementById('alerta-urgente')?.remove();
  const div = document.createElement('div');
  div.id = 'alerta-urgente';
  div.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#1f1f2e;border:1px solid rgba(239,68,68,.5);border-radius:16px;padding:14px 18px;z-index:1000;max-width:320px;width:calc(100% - 40px);box-shadow:0 4px 24px rgba(239,68,68,.25);font-family:Outfit,sans-serif;cursor:pointer';
  div.innerHTML = `
    <div style="display:flex;align-items:center;gap:10px;margin-bottom:8px">
      <div style="width:8px;height:8px;background:#ef4444;border-radius:50%;flex-shrink:0"></div>
      <div style="font-size:13px;font-weight:700;color:#ef4444">${urgentes.length} orden${urgentes.length > 1 ? 'es urgentes' : ' urgente'}</div>
    </div>
    ${urgentes.map(o => `<div style="font-size:12px;color:#e2e8f0;margin-bottom:2px">· WO ${o.wo || '—'} — ${o.cliente || '—'}</div>`).join('')}
    <div style="font-size:11px;color:#64748b;margin-top:8px">Toca para cerrar</div>
  `;
  div.addEventListener('click', () => div.remove());
  document.body.appendChild(div);
  setTimeout(() => div?.remove(), 8000);
}

function abrirYaCambiado(id) {
  selectedOrden_ = ordenes_.find(x => x.id === id) || selectedOrden_;
  document.getElementById('ya-cambiado-comentario').value = '';
  document.getElementById('ya-cambiado-error').style.display = 'none';
  openSheet('sheet-ya-cambiado');
}

async function confirmarYaCambiado() {
  if (!selectedOrden_) return;
  const comentario = document.getElementById('ya-cambiado-comentario').value.trim();
  setLoading('btn-ya-cambiado-lbl', 'Guardando…', true);
  try {
    await db.collection('cambios_ordenes').doc(selectedOrden_.id).update({
      estadoCampo:  'ya_cambiado',
      yaCambiadoPor: session_.displayName,
      yaCambiadoEn:  firebase.firestore.Timestamp.now(),
      yaCambiadoComentario: comentario || null,
    });
    const o = ordenes_.find(x => x.id === selectedOrden_.id);
    if (o) o.estadoCampo = 'ya_cambiado';
    closeSheet('sheet-ya-cambiado');
    closePanel();
    plotMarkers();
    toast('Orden reportada como ya cambiada', 'ok');
  } catch(err) {
    document.getElementById('ya-cambiado-error').textContent = `Error: ${err.message}`;
    document.getElementById('ya-cambiado-error').style.display = 'block';
  } finally {
    setLoading('btn-ya-cambiado-lbl', 'Confirmar reporte', false);
  }
}

// ── Pedir ayuda por WhatsApp ──────────────────────
function abrirPedirAyuda(id) {
  selectedOrden_ = ordenes_.find(x => x.id === id) || selectedOrden_;
  openSheet('sheet-pedir-ayuda');
}

function enviarAyudaWhatsApp(motivo) {
  const o = selectedOrden_;
  if (!o) return;
  const msg = `⚠️ Necesito ayuda con una orden\n`
    + `WO: ${o.wo || '—'}\n`
    + `NC: ${o.nc || '—'}\n`
    + `Cliente: ${o.cliente || '—'}\n`
    + `Dirección: ${o.direccion || '—'}\n`
    + `Serie medidor: ${o.serieActual || o.serie || '—'}\n`
    + `Marca: ${o.marca || '—'}\n`
    + `\nMotivo: ${motivo}`;

  const url = `https://wa.me/50371185821?text=${encodeURIComponent(msg)}`;
  closeSheet('sheet-pedir-ayuda');
  window.open(url, '_blank');
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

// ── Asignación por polígono ─────────────────────
let zonaActual_   = null;
let zonaPoligono_ = null;
let poliPreview_  = null;
let puntos_       = [];

// Ray casting — punto dentro de polígono
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

function activarModoZona() {
  if (!map_) return;
  closePanel();
  puntos_ = [];
  limpiarPoligono();
  map_.getContainer().style.cursor = 'crosshair';
  toast('Toca para agregar puntos · Cierra el polígono con el botón o doble toque', 'ok', 5000);

  let btnCerrar = document.getElementById('btn-cerrar-poligono');
  if (!btnCerrar) {
    btnCerrar = document.createElement('button');
    btnCerrar.id = 'btn-cerrar-poligono';
    btnCerrar.textContent = 'Cerrar polígono';
    btnCerrar.style.cssText = 'position:fixed;bottom:100px;left:50%;transform:translateX(-50%);z-index:500;background:var(--cm-light);color:#0d1117;border:none;border-radius:20px;padding:10px 24px;font-size:13px;font-weight:700;font-family:Outfit,sans-serif;cursor:pointer;display:none;box-shadow:0 4px 20px rgba(0,0,0,.4)';
    document.body.appendChild(btnCerrar);
    btnCerrar.addEventListener('click', cerrarPoligono);
  }

  map_.on('click', onMapClick_);
  map_.on('dblclick', onMapDblClick_);
}

function onMapClick_(e) {
  if (puntos_.length > 0) {
    const dist = map_.distance(puntos_[puntos_.length - 1], e.latlng);
    if (dist < 5) return;
  }
  puntos_.push(e.latlng);

  if (poliPreview_) map_.removeLayer(poliPreview_);

  if (puntos_.length === 1) {
    poliPreview_ = L.circleMarker(puntos_[0], {
      radius: 5, color: '#2dd4bf', fillColor: '#2dd4bf', fillOpacity: 1, weight: 2
    }).addTo(map_);
  } else {
    poliPreview_ = L.polygon(puntos_, {
      color: '#2dd4bf', weight: 2, fillOpacity: 0.1, dashArray: '6,4'
    }).addTo(map_);
  }

  const btnCerrar = document.getElementById('btn-cerrar-poligono');
  if (btnCerrar) btnCerrar.style.display = puntos_.length >= 3 ? '' : 'none';
}

function onMapDblClick_(e) {
  L.DomEvent.stop(e);
  if (puntos_.length >= 3) cerrarPoligono();
}

function cerrarPoligono() {
  if (puntos_.length < 3) { toast('Necesitas al menos 3 puntos', 'warn'); return; }

  map_.off('click', onMapClick_);
  map_.off('dblclick', onMapDblClick_);
  map_.getContainer().style.cursor = '';

  const btnCerrar = document.getElementById('btn-cerrar-poligono');
  if (btnCerrar) btnCerrar.style.display = 'none';

  if (poliPreview_) { map_.removeLayer(poliPreview_); poliPreview_ = null; }

  zonaPoligono_ = L.polygon(puntos_, {
    color: '#2dd4bf', weight: 2, fillOpacity: 0.12
  }).addTo(map_);
  zonaActual_ = zonaPoligono_;

  const dentro = ordenes_.filter(o =>
    o.latitud && o.longitud &&
    pointInPolygon(L.latLng(parseFloat(o.latitud), parseFloat(o.longitud)), puntos_)
  );

  document.getElementById('zona-count').textContent = dentro.length;
  document.getElementById('zona-preview').style.display = dentro.length ? '' : 'none';
  document.getElementById('zona-error').style.display = 'none';
  document.querySelectorAll('#zona-pareja-row .select-chip').forEach(c => c.classList.remove('active'));
  openSheet('sheet-zona');
}

function limpiarPoligono() {
  if (zonaPoligono_) { map_.removeLayer(zonaPoligono_); zonaPoligono_ = null; }
  if (poliPreview_)  { map_.removeLayer(poliPreview_);  poliPreview_  = null; }
  const btn = document.getElementById('btn-cerrar-poligono');
  if (btn) btn.style.display = 'none';
}

function cancelarZona() {
  map_.off('click', onMapClick_);
  map_.off('dblclick', onMapDblClick_);
  map_.getContainer().style.cursor = '';
  limpiarPoligono();
  zonaActual_ = null;
  puntos_     = [];
  closeSheet('sheet-zona');
}
// ── Helpers ───────────────────────────────────────
async function confirmarZona() {
  const parejaVal = getSelectedChip('zona-pareja-row');
  const errEl     = document.getElementById('zona-error');

  if (!parejaVal) {
    errEl.textContent = 'Selecciona una pareja o "Sin pareja".';
    errEl.style.display = 'block';
    return;
  }
  if (!zonaActual_ || puntos_.length < 3) {
    errEl.textContent = 'Dibuja una zona primero.';
    errEl.style.display = 'block';
    return;
  }

  const pareja = parejaVal === 'null' ? null : parejaVal;
  const dentro = ordenes_.filter(o =>
    o.latitud && o.longitud &&
    pointInPolygon(L.latLng(parseFloat(o.latitud), parseFloat(o.longitud)), puntos_)
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
      batch.update(db.collection('cambios_ordenes').doc(o.id), { pareja, asignadoEn: ts });
      count++;
      if (count === 499) { batches.push(batch.commit()); batch = db.batch(); count = 0; }
    }
    if (count > 0) batches.push(batch.commit());
    await Promise.all(batches);

    dentro.forEach(o => { o.pareja = pareja; });
    limpiarPoligono();
    zonaActual_ = null;
    puntos_     = [];
    plotMarkers();
    updateStatChip();
    closeSheet('sheet-zona');
    toast(pareja
      ? `${dentro.length} órdenes asignadas a ${pareja}`
      : `${dentro.length} órdenes desasignadas`, 'ok');
  } catch(err) {
    console.error('[mapa] Error asignando zona:', err);
    errEl.textContent = `Error: ${err.message}`;
    errEl.style.display = 'block';
  } finally {
    setLoading('btn-zona-label', 'Confirmar asignación', false);
  }
}

function openSheet(id)  { document.getElementById(id)?.classList.add('open'); }
function closeSheet(id) { document.getElementById(id)?.classList.remove('open'); }
// Exponer para onclick en HTML
window.__mapaCloseSheet = closeSheet;

// Llamado por el router al navegar fuera del mapa
export function cleanup() {
  ['sheet-visita','sheet-realizada','sheet-zona','sheet-ya-cambiado','sheet-pedir-ayuda','sheet-asignar-individual'].forEach(id => {
    document.getElementById(id)?.remove();
  });
  document.getElementById('alerta-urgente')?.remove();
  const btn = document.getElementById('btn-cerrar-poligono');
  if (btn) btn.remove();
}

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

// ── HTML de sheets del mapa ──────────────────────
function sheetsMapaHTML() {
  return `
    <!-- Sheet ya estaba cambiado -->
    <div class="sheet-backdrop" id="sheet-ya-cambiado">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Ya estaba cambiado</div>
        <div class="sheet-body">
          <div style="font-size:13px;color:var(--text-2);margin-bottom:16px;line-height:1.6">
            Indica que el medidor de esta orden ya fue cambiado anteriormente. El asistente lo revisará y decidirá si eliminarla.
          </div>
          <div class="form-field">
            <div class="form-label">Comentario (opcional)</div>
            <textarea class="form-input" id="ya-cambiado-comentario" rows="3" placeholder="Ej. El medidor nuevo es de marca X..." style="resize:none"></textarea>
          </div>
          <div id="ya-cambiado-error" class="form-error"></div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px;margin-top:4px">
            <button onclick="window.__mapaCloseSheet('sheet-ya-cambiado')"
              style="height:44px;border-radius:12px;border:1px solid var(--border);background:transparent;color:var(--text-3);font-size:13px;font-weight:600;font-family:'Outfit',sans-serif;cursor:pointer">
              Cancelar
            </button>
            <button id="btn-confirmar-ya-cambiado"
              style="height:44px;border-radius:12px;border:1px solid rgba(249,115,22,.4);background:rgba(249,115,22,.15);color:#fb923c;font-size:13px;font-weight:600;font-family:'Outfit',sans-serif;cursor:pointer">
              <span id="btn-ya-cambiado-lbl">Confirmar</span>
            </button>
          </div>
        </div>
      </div>
    </div>

    <!-- Sheet pedir ayuda -->
    <div class="sheet-backdrop" id="sheet-pedir-ayuda">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Pedir ayuda</div>
        <div class="sheet-body">
          <div class="form-label" style="margin-bottom:12px">¿Cuál es el problema?</div>
          <div class="flex-col gap-8" id="ayuda-opciones">
            <button class="ayuda-opcion" data-motivo="Punto mal ubicado — la dirección no coincide con el lugar físico">
              <div style="font-size:13px;font-weight:600;color:var(--text)">Punto mal ubicado</div>
              <div style="font-size:11px;color:var(--text-4);margin-top:2px">La dirección no coincide con el lugar</div>
            </button>
            <button class="ayuda-opcion" data-motivo="Medidor ya fue cambiado — aparece como pendiente pero ya fue reemplazado">
              <div style="font-size:13px;font-weight:600;color:var(--text)">Medidor ya fue cambiado</div>
              <div style="font-size:11px;color:var(--text-4);margin-top:2px">Aparece pendiente pero ya fue reemplazado</div>
            </button>
            <button class="ayuda-opcion" data-motivo="Otro problema">
              <div style="font-size:13px;font-weight:600;color:var(--text)">Otro problema</div>
              <div style="font-size:11px;color:var(--text-4);margin-top:2px">Especifica en el mensaje de WhatsApp</div>
            </button>
          </div>
          <button class="btn-action outline" style="width:100%;margin-top:12px;height:44px" onclick="window.__mapaCloseSheet('sheet-pedir-ayuda')">Cancelar</button>
        </div>
      </div>
    </div>

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
}
