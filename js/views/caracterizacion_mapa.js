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
 * Reutiliza el patrón de Cambios: Leaflet + Google tiles + GPS.
 */

import { db } from '../firebase.js';
import { suscribir as suscribirVivo, tecnicosActivos } from '../vivo.js';
import { toast, escapeHtml } from '../ui.js';

let map_ = null;
let session_ = null;
let container_ = null;
let role_ = null;
let esAdmin_ = false;
let ordenes_ = [];
let retiros_ = [];          // puntos de retiro (cuadrados ámbar)
let markers_ = {};          // ordenId -> { titular, suplente1, suplente2, linea }
let markersRet_ = {};       // retiroId -> marker
let selected_ = null;       // { ordenId, nivel }  nivel: 'titular'|'suplente1'|'suplente2'
let geoMarker_ = null, geoCircle_ = null, watchId_ = null;
let selectedRet_ = null;    // retiro con la hoja abierta
let unsubOrd_ = null, unsubRet_ = null;   // listeners en vivo
let cargado_ = { o: false, r: false }, encuadrado_ = false;
let parejasActivas_ = [];   // parejas con técnico activo en Caracterización

// Modo zona (admin)
let puntos_ = [], poliPreview_ = null, zonaPoligono_ = null;

const NIVEL_LABEL = { titular:'Titular', suplente1:'Suplente 1', suplente2:'Suplente 2' };
const NIVEL_COLOR = { titular:'#a78bfa', suplente1:'#fbbf24', suplente2:'#f472b6' };
const UPR_COLOR = '#38bdf8';   // celeste: punto UPR (sin suplentes)
const RETIRO_COLOR = '#f59e0b';  // ámbar: retiros (cuadrado)

export async function init(container, session) {
  cleanup();
  container_ = container;
  session_ = session;
  role_ = session.role;
  esAdmin_ = (session.role === 'admin' || session.role === 'asistente');
  cargado_ = { o: false, r: false }; encuadrado_ = false;

  // Animación del anillo de pulso + hojas responsivas (una sola vez)
  if (!document.getElementById('crc-pulso-css')) {
    const st = document.createElement('style');
    st.id = 'crc-pulso-css';
    st.textContent = `
      @keyframes crc-pulso{0%{transform:scale(.8);opacity:.5}100%{transform:scale(1.8);opacity:0}}
      .crc-hoja{position:fixed;left:0;right:0;bottom:0;z-index:1200;transform:translateY(calc(100% + 120px));transition:transform .25s ease;background:#0d1728;border-top:1px solid var(--border-md);border-radius:20px 20px 0 0;padding:18px 20px calc(var(--nav-espacio,0px) + 22px);max-height:85vh;overflow-y:auto}
      .crc-hoja.abierta{transform:translateY(0)}
      #crc-leaflet .leaflet-top.leaflet-left{display:none}
      #crc-leaflet .leaflet-control-attribution{display:none}
      .crc-ley{display:flex;align-items:center;gap:7px;font-size:10px;color:var(--text-3);line-height:1.2}
      .crc-ley i{width:11px;height:11px;border-radius:50%;border:1.5px solid rgba(255,255,255,.8);flex-shrink:0}
      .crc-res{display:flex;align-items:center;gap:10px;padding:10px;border-radius:10px;background:var(--glass);border:1px solid var(--border);cursor:pointer;margin-top:6px}
      .crc-res:active{background:var(--glass-hov)}
      @media (max-width:520px){ .crc-lbl{display:none} }
      @media (min-width:820px){
        .crc-hoja{left:auto;right:16px;bottom:auto;top:80px;width:340px;max-height:calc(100vh - 160px);border:1px solid var(--border);border-radius:16px;transform:translateX(calc(100% + 40px));box-shadow:0 8px 40px rgba(0,0,0,.5)}
        .crc-hoja.abierta{transform:translateX(0)}
      }
    `;
    document.head.appendChild(st);
  }
  container.scrollTop = 0;
  const lupa = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>';
  container.innerHTML = `
    <div id="crc-wrapper" style="position:fixed;top:var(--topbar-h,62px);left:0;right:0;bottom:var(--navbar-h,72px);z-index:1">
      <div id="crc-leaflet" style="width:100%;height:100%"></div>

      <div class="mapa-controls-top" style="right:12px;flex-wrap:wrap">
        <div class="mapa-stat-chip" style="border-color:rgba(239,68,68,.45);background:rgba(239,68,68,.12)">
          <div class="mapa-stat-dot" style="background:#ef4444"></div>
          <span class="crc-lbl" style="font-weight:800;color:#f87171;letter-spacing:.02em;margin-right:2px">Caracterización</span>
          <span id="crc-map-stat">Cargando…</span>
        </div>
        ${esAdmin_ ? `
        <button class="mapa-btn-icon" id="crc-zona" title="Asignar zona a pareja" style="border-color:rgba(239,68,68,.45);color:#f87171">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M3 3h7v7H3zM14 3h7v7h-7zM14 14h7v7h-7zM3 14h7v7H3z"/></svg>
        </button>
        <button class="mapa-btn-icon" id="crc-reset-asig" title="Quitar todas las asignaciones">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M3 12a9 9 0 1 0 9-9 9 9 0 0 0-6.7 3"/><path d="M3 3v5h5"/></svg>
        </button>` : `
        <button class="mapa-btn-icon" id="crc-gps" title="Mi ubicación" style="color:#3b82f6">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
        </button>`}
        <button class="mapa-btn-icon" id="crc-buscar-btn" title="Buscar NC, medidor o nombre" style="border-color:rgba(239,68,68,.45);color:#f87171">${lupa}</button>
        <button class="mapa-btn-icon" id="crc-ver-ret" title="Mostrar u ocultar retiros" style="width:auto;padding:0 11px;gap:6px;font-size:11.5px;font-weight:700;font-family:inherit;color:${RETIRO_COLOR}">
          <span style="width:10px;height:10px;border-radius:2px;background:${RETIRO_COLOR}"></span><span id="crc-ver-ret-lbl">Retiros</span>
        </button>
      </div>

      <!-- Buscador (oculto hasta tocar la lupa) -->
      <div id="crc-buscar-box" style="display:none;position:absolute;top:60px;left:12px;right:12px;z-index:1000;background:rgba(13,22,38,.97);border:1px solid rgba(239,68,68,.4);border-radius:12px;padding:10px;max-height:60%;overflow-y:auto">
        <div style="display:flex;gap:8px">
          <input id="crc-buscar-input" class="form-input" style="height:40px;font-size:14px" placeholder="NC, medidor o nombre" autocomplete="off"/>
          <button id="crc-buscar-cerrar" class="btn-action outline" style="width:auto;height:40px;padding:0 12px;font-size:12px">Cerrar</button>
        </div>
        <div id="crc-buscar-res"></div>
      </div>

      <div id="crc-leyenda" class="mapa-leyenda" style="display:flex;flex-direction:column;gap:5px;pointer-events:none"></div>

      <!-- Controles al dibujar una zona (admin) -->
      <div id="crc-zona-ctrl" style="position:absolute;bottom:calc(var(--nav-espacio, 0px) + 16px);left:50%;transform:translateX(-50%);z-index:900;display:none;gap:8px">
        <button id="crc-zona-cancelar" style="background:rgba(13,22,38,.94);color:var(--text-2);border:1px solid var(--border);border-radius:20px;padding:10px 18px;font-size:13px;font-weight:700;font-family:inherit;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,.4)">Cancelar</button>
        <button id="crc-cerrar-poli" style="display:none;background:#f87171;color:#0d1117;border:none;border-radius:20px;padding:10px 22px;font-size:13px;font-weight:800;font-family:inherit;cursor:pointer;box-shadow:0 4px 20px rgba(0,0,0,.4)">Cerrar zona</button>
      </div>

      <!-- Hoja de detalle del punto (técnico) -->
      <div id="crc-sheet" class="crc-hoja"></div>

      <!-- Hoja de asignación de zona (admin) -->
      <div id="crc-sheet-zona" class="crc-hoja"></div>
    </div>`;

  ajustarTamano();
  initMap();
  pintarLeyenda();
  if (esAdmin_) await cargarParejasActivas();
  suscribir();

  container.querySelector('#crc-buscar-btn').onclick = () => {
    const box = container.querySelector('#crc-buscar-box');
    const ver = box.style.display === 'none';
    box.style.display = ver ? 'block' : 'none';
    if (ver) container.querySelector('#crc-buscar-input').focus();
  };
  container.querySelector('#crc-buscar-cerrar').onclick = () => { container.querySelector('#crc-buscar-box').style.display = 'none'; };
  container.querySelector('#crc-buscar-input').oninput = e => buscar(e.target.value);
  container.querySelector('#crc-zona-cancelar').onclick = cancelarZona;
  container.querySelector('#crc-ver-ret').onclick = () => {
    verRetiros_ = !verRetiros_;
    try { localStorage.setItem('crc_ver_retiros', verRetiros_ ? '1' : '0'); } catch {}
    marcarBotonRetiros();
    retiros_.forEach(pintarRetiro);
  };
  marcarBotonRetiros();
  container.querySelector('#crc-cerrar-poli').onclick = cerrarPoligono;

  if (esAdmin_) {
    container.querySelector('#crc-zona').onclick = activarModoZona;
    container.querySelector('#crc-reset-asig').onclick = resetearAsignaciones;
  } else {
    initGPS();
    container.querySelector('#crc-gps').onclick = () => {
      if (geoMarker_) map_.setView(geoMarker_.getLatLng(), 17);
      else toast('Buscando tu ubicación…', 'ok');
    };
  }
}

export function cleanup() {
  if (unsubOrd_) { unsubOrd_(); unsubOrd_ = null; }
  if (unsubRet_) { unsubRet_(); unsubRet_ = null; }
  if (watchId_ != null && navigator.geolocation) navigator.geolocation.clearWatch(watchId_);
  watchId_ = null;
  if (map_) { try { map_.remove(); } catch {} map_ = null; }
  markers_ = {}; markersRet_ = {}; ordenes_ = []; retiros_ = [];
  selected_ = null; selectedRet_ = null; geoMarker_ = null; geoCircle_ = null;
  puntos_ = []; poliPreview_ = null; zonaPoligono_ = null;
}

// Mismo cálculo que los mapas de Cambios y AMI: en PC el menú va a la
// izquierda (no hay barra inferior); en teléfono, barra inferior.
function ajustarTamano() {
  const w = container_.querySelector('#crc-wrapper');
  const topbar = document.querySelector('.topbar');
  const navbar = document.querySelector('.navbar');
  if (window.innerWidth >= 768) {
    w.style.top = (topbar ? topbar.offsetHeight : 56) + 'px';
    w.style.bottom = '0px';
    w.style.left = (navbar ? navbar.offsetWidth : 200) + 'px';
    w.style.right = '0px';
  } else {
    // En móvil el mapa llega hasta abajo y el menú flota encima (antes el
    // mapa se cortaba arriba del menú y quedaba una franja vacía). Lo que va
    // pegado abajo (leyenda, zoom, botones, panel) sube con --nav-espacio.
    if (topbar) w.style.top = topbar.offsetHeight + 'px';
    w.style.bottom = '0px';
    if (navbar) w.style.setProperty('--nav-espacio', navbar.offsetHeight + 'px');
  }
}

// Parejas con al menos un técnico activo en Caracterización (para asignar).
async function cargarParejasActivas() {
  try {
    const set = new Set();
    if (esAdmin_) {
      (await tecnicosActivos(db)).forEach(u => { if (u.asignacionActual?.area === 'Caracterizacion' && u.asignacionActual?.destino) set.add(u.asignacionActual.destino); });
    } else {
      const us = await db.collection('users')
        .where('asignacionActual.area', '==', 'Caracterizacion')
        .where('active', '==', true).get();
      us.docs.forEach(d => { const p = d.data().asignacionActual?.destino; if (p) set.add(p); });
    }
    parejasActivas_ = [...set];
  } catch { parejasActivas_ = []; }
}
// Activas + las que ya tengan puntos; si no hay ninguna, las 3 de siempre.
function parejasDisponibles() {
  const num = x => parseInt(String(x).replace(/\D/g, ''), 10) || 0;
  const set = new Set([...parejasActivas_, ...ordenes_.map(o => o.pareja), ...retiros_.map(r => r.pareja)].filter(Boolean));
  const lista = [...set].sort((a, b) => num(a) - num(b));
  return lista.length ? lista : PAREJAS_CRC;
}

// Escucha en vivo: el técnico solo lee lo de su pareja (consulta filtrada,
// no toda la colección); el admin ve todo. Lo que marca un técnico le
// aparece a su compañero y al admin sin recargar.
function suscribir() {
  const miPareja = session_.asignacionActual?.destino || null;
  if (!esAdmin_ && !miPareja) { cargado_ = { o: true, r: true }; updateStat(); return; }
  // Listeners compartidos con la lista y el inicio (js/vivo.js): entrar y
  // salir del mapa ya no vuelve a leer las colecciones completas.
  const q = nombre => esAdmin_ ? db.collection(nombre) : db.collection(nombre).where('pareja', '==', miPareja);
  const clave = nombre => `${nombre}|${esAdmin_ ? '*' : miPareja}`;
  // Adapta los cambios del listener compartido a la forma de un snapshot
  const comoSnap = cambios => ({ docChanges: () => cambios.map(c => ({
    type: c.type, doc: { id: c.doc.id, data: () => c.doc, metadata: { hasPendingWrites: c.local } } })) });
  unsubOrd_ = suscribirVivo(clave('caracterizacion_ordenes'), () => q('caracterizacion_ordenes'), (_l, cambios, err) => {
    if (err) { toast('Error cargando órdenes: ' + err.message, 'error'); cargado_.o = true; trasCarga(); return; }
    aplicarCambios(comoSnap(cambios), 'o');
  });
  unsubRet_ = suscribirVivo(clave('caracterizacion_retiros'), () => q('caracterizacion_retiros'), (_l, cambios, err) => {
    if (err) { cargado_.r = true; trasCarga(); return; }
    aplicarCambios(comoSnap(cambios), 'r');
  });
}

function aplicarCambios(snap, tipo) {
  const lista = tipo === 'o' ? ordenes_ : retiros_;
  snap.docChanges().forEach(ch => {
    const data = { id: ch.doc.id, ...ch.doc.data() };
    const i = lista.findIndex(x => x.id === data.id);
    const ajeno = !ch.doc.metadata.hasPendingWrites;   // cambio que no hice yo
    if (ch.type === 'removed') {
      if (i >= 0) lista.splice(i, 1);
      if (tipo === 'o') quitarMarcadores(data.id); else quitarRetiro(data.id);
      avisarSiAbierta(tipo, data.id, 'Este punto ya no está asignado a tu pareja');
      return;
    }
    const antes = i >= 0 ? lista[i] : null;
    if (i >= 0) lista[i] = data; else lista.push(data);
    if (tipo === 'o') pintarOrden(data); else pintarRetiro(data);
    if (antes && ajeno && cargado_[tipo] &&
        (antes.estado !== data.estado || antes._nivelVisible !== data._nivelVisible)) {
      avisarSiAbierta(tipo, data.id, 'Tu pareja actualizó este punto');
    }
  });
  cargado_[tipo] = true;
  trasCarga();
}

function avisarSiAbierta(tipo, id, msg) {
  const abierta = tipo === 'o' ? selected_?.ordenId === id : selectedRet_ === id;
  if (!abierta) return;
  cerrarTodasLasHojas();
  toast(msg, 'warn');
}

function trasCarga() {
  updateStat();
  pintarLeyenda();
  if (!encuadrado_ && cargado_.o && cargado_.r) { encuadrado_ = true; encuadrar(); abrirFoco(); }
}

// Si se llegó desde la lista tocando un punto, abrirlo directamente
function abrirFoco() {
  let f = null;
  try { f = JSON.parse(sessionStorage.getItem('crc_foco') || 'null'); sessionStorage.removeItem('crc_foco'); } catch {}
  if (!f || !map_) return;
  if (f.tipo === 'r') {
    const r = retiros_.find(x => x.id === f.id);
    if (!r) return;
    if (r.lat == null) { toast('Ese retiro no tiene ubicación en el mapa', 'warn'); return; }
    map_.setView([r.lat, r.lng], 18);
    abrirDetalleRetiro(r.id);
    return;
  }
  const o = ordenes_.find(x => x.id === f.id);
  if (!o) return;
  const nivel = o.logranoEn || o._nivelVisible || 'titular';
  const p = o[nivel] || o.titular;
  if (p?.lat == null) { toast('Esa orden no tiene ubicación en el mapa', 'warn'); return; }
  map_.setView([p.lat, p.lng], 18);
  if (esAdmin_) { o.estado === 'por_confirmar' ? abrirConfirmar(o.id) : abrirAsignarIndividual(o.id); }
  else abrirDetalle(o.id, nivel);
}

// Mostrar todos los puntos (instalaciones y retiros) al abrir el mapa
function encuadrar() {
  if (!map_) return;
  const pts = [];
  ordenes_.forEach(o => { if (o.titular?.lat != null) pts.push([o.titular.lat, o.titular.lng]); });
  retiros_.forEach(r => { if (r.lat != null) pts.push([r.lat, r.lng]); });
  if (!pts.length) return;
  if (pts.length === 1) map_.setView(pts[0], 16);
  else map_.fitBounds(L.latLngBounds(pts).pad(0.08), { maxZoom: 17 });
}

function initMap() {
  map_ = L.map('crc-leaflet', {
    center: [13.7942, -88.8965], zoom: 8, zoomControl: false, attributionControl: false,
    rotate: true, touchRotate: true, rotateControl: false,
  });
  L.control.zoom({ position: 'bottomright' }).addTo(map_);

  L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', {
    maxZoom: 20, attribution: '© Google', keepBuffer: 4,
    errorTileUrl: 'data:image/gif;base64,R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7',
  }).addTo(map_).on('tileerror', () => {});

  // Tocar el mapa (fuera de un marcador) cierra cualquier hoja abierta,
  // salvo cuando se está dibujando una zona.
  map_.on('click', () => {
    if (puntos_ && puntos_.length) return;   // dibujando zona: no cerrar
    cerrarTodasLasHojas();
  });
}

// Leyenda según lo que ve cada rol
function pintarLeyenda() {
  const el = container_?.querySelector('#crc-leyenda');
  if (!el) return;
  const item = (color, txt, cuadro) => `<div class="crc-ley"><i style="background:${color};${cuadro ? 'border-radius:3px' : ''}"></i>${txt}</div>`;
  const hayUPR = ordenes_.some(o => o.esUPR);
  el.innerHTML = esAdmin_
    ? item('#64748b', 'Sin asignar') +
      parejasDisponibles().map(p => item(colorPareja(p), escapeHtml(p))).join('') +
      item('#22c55e', 'Por confirmar') +
      (retiros_.length ? item('#94a3b8', 'Cuadro = retiro', true) : '')
    : item(NIVEL_COLOR.titular, 'Titular') +
      item(NIVEL_COLOR.suplente1, 'Suplente 1') +
      item(NIVEL_COLOR.suplente2, 'Suplente 2') +
      (hayUPR ? item(UPR_COLOR, 'UPR') : '') +
      item('#22c55e', 'Hecha (por confirmar)') +
      (retiros_.length ? item(RETIRO_COLOR, 'Retiro', true) : '');
}

// Buscador: NC, medidor o nombre en titulares, suplentes visibles y retiros
function buscar(texto) {
  const res = container_.querySelector('#crc-buscar-res');
  const q = String(texto || '').trim().toLowerCase();
  if (q.length < 2) { res.innerHTML = q ? '<div style="font-size:12px;color:var(--text-4);margin-top:8px">Escribe al menos 2 caracteres</div>' : ''; return; }
  const coincide = p => p && [p.nc, p.medidor, p.nombre].some(v => String(v ?? '').toLowerCase().includes(q));
  const encontrados = [];
  ordenes_.forEach(o => {
    if (o.estado === 'confirmada') return;
    ['titular', 'suplente1', 'suplente2'].forEach(k => {
      if (!coincide(o[k])) return;
      // Al técnico solo se le lleva a puntos ya visibles de la cascada
      const niveles = ['titular', 'suplente1', 'suplente2'];
      const visible = esAdmin_ || niveles.indexOf(k) <= niveles.indexOf(o._nivelVisible || 'titular');
      encontrados.push({ tipo: 'o', o, k, visible });
    });
  });
  retiros_.forEach(r => { if (coincide(r)) encontrados.push({ tipo: 'r', r }); });
  if (!encontrados.length) { res.innerHTML = '<div style="font-size:12px;color:var(--text-4);margin-top:8px">Sin coincidencias</div>'; return; }
  res.innerHTML = encontrados.slice(0, 20).map((x, i) => {
    const p = x.tipo === 'o' ? x.o[x.k] : x.r;
    const color = x.tipo === 'r' ? RETIRO_COLOR : NIVEL_COLOR[x.k];
    const etq = x.tipo === 'r' ? 'Retiro' : NIVEL_LABEL[x.k] + (x.visible ? '' : ' · aún no visible');
    return `<div class="crc-res" data-i="${i}">
      <i style="width:10px;height:10px;border-radius:${x.tipo === 'r' ? '2px' : '50%'};background:${color};flex-shrink:0"></i>
      <div style="flex:1;min-width:0">
        <div style="font-size:13px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${escapeHtml(p.nombre || 'NC ' + p.nc)}</div>
        <div style="font-size:11px;color:var(--text-4)">NC ${escapeHtml(p.nc || '')}${p.medidor ? ' · ' + escapeHtml(p.medidor) : ''} · ${etq}</div>
      </div>
    </div>`;
  }).join('');
  res.querySelectorAll('.crc-res').forEach(el => el.onclick = () => {
    const x = encontrados[Number(el.dataset.i)];
    container_.querySelector('#crc-buscar-box').style.display = 'none';
    if (x.tipo === 'r') { map_.setView([x.r.lat, x.r.lng], 18); abrirDetalleRetiro(x.r.id); return; }
    const k = x.visible ? x.k : (x.o._nivelVisible || 'titular');
    if (!x.visible) toast(`Es ${NIVEL_LABEL[x.k]} de esta orden; aparece si no se logra el punto actual`, 'warn');
    const p = x.o[k] || x.o.titular;
    if (p?.lat != null) map_.setView([p.lat, p.lng], 18);
    if (esAdmin_) { x.o.estado === 'por_confirmar' ? abrirConfirmar(x.o.id) : abrirAsignarIndividual(x.o.id); }
    else abrirDetalle(x.o.id, k);
  });
}

function cerrarTodasLasHojas() {
  const s1 = container_.querySelector('#crc-sheet');
  const s2 = container_.querySelector('#crc-sheet-zona');
  if (s1) s1.classList.remove('abierta');
  if (s2) s2.classList.remove('abierta');
  selected_ = null;
  selectedRet_ = null;
}

// Pinta una orden según su estado. Muestra el titular; si la orden ya
// avanzó en la cascada (nivel intentado), muestra hasta ahí.
function pintarOrden(o) {
  if (!map_) return;
  quitarMarcadores(o.id);
  markers_[o.id] = {};

  // ADMIN: un solo pin por orden (el titular), coloreado por pareja.
  // El foco es asignar zonas y confirmar las que el técnico marcó.
  if (esAdmin_) {
    if (o.estado === 'confirmada') return;   // confirmadas desaparecen
    const t = o.titular;
    if (!t || t.lat == null) return;
    const porConfirmar = o.estado === 'por_confirmar';
    let color = '#64748b';                    // sin asignar: gris
    if (porConfirmar) color = '#22c55e';      // lista para confirmar: verde
    else if (o.pareja) color = colorPareja(o.pareja);
    const m = crearMarcador(t, color, porConfirmar ? '&#10003;' : '', false, false, porConfirmar);
    m.on('click', () => porConfirmar ? abrirConfirmar(o.id) : abrirAsignarIndividual(o.id));
    m.addTo(map_); markers_[o.id].titular = m;
    return;
  }

  // TÉCNICO: las confirmadas ya no se muestran (desaparecen).
  if (o.estado === 'confirmada') return;

  // Por confirmar: punto atenuado (opaco) en donde se logró, esperando al asistente.
  if (o.estado === 'por_confirmar') {
    const donde = o.logranoEn && o[o.logranoEn] ? o[o.logranoEn] : o.titular;
    if (donde?.lat != null) {
      const m = crearMarcador(donde, '#22c55e', '&#10003;', false, false, true);  // atenuado
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
    // El suplente recién revelado (nivel activo que no es el titular) se destaca con pulso
    const destacar = activo && i > 0;
    // Los UPR se pintan en celeste para que el técnico los reconozca al instante
    const color = (o.esUPR && k === 'titular') ? UPR_COLOR : NIVEL_COLOR[k];
    const m = crearMarcador(p, color, String(i === 0 ? 'T' : i), activo, destacar);
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

function crearMarcador(p, color, texto, activo, destacar, atenuado) {
  const size = activo ? 20 : 14;
  const anillo = destacar
    ? `<div style="position:absolute;inset:-8px;border-radius:50%;background:${color};opacity:.35;animation:crc-pulso 1.4s ease-out infinite"></div>`
    : '';
  const op = atenuado ? 'opacity:.45;' : '';
  const icon = L.divIcon({
    className: '',
    html: `<div style="position:relative;display:flex;align-items:center;justify-content:center;${op}">${anillo}<div style="position:relative;width:${size}px;height:${size}px;background:${color};border:2px solid rgba(255,255,255,.9);border-radius:50%;box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:${activo?11:9}px;font-weight:800;color:#0a1628;line-height:1">${texto || ''}</div></div>`,
    iconSize: [size, size], iconAnchor: [size/2, size/2],
  });
  return L.marker([p.lat, p.lng], { icon });
}

// Mostrar u ocultar los retiros en el mapa (se recuerda en este teléfono).
// Con cientos de puntos, ocultarlos hace el mapa más ligero.
let verRetiros_ = (() => { try { return localStorage.getItem('crc_ver_retiros') !== '0'; } catch { return true; } })();
function marcarBotonRetiros() {
  const b = container_?.querySelector('#crc-ver-ret');
  if (!b) return;
  b.style.opacity = verRetiros_ ? '1' : '.55';
  b.querySelector('#crc-ver-ret-lbl').textContent = verRetiros_ ? 'Retiros' : 'Retiros ocultos';
}

function quitarRetiro(id) {
  if (markersRet_[id]) { if (map_) map_.removeLayer(markersRet_[id]); delete markersRet_[id]; }
}

// ── RETIROS: cuadrado ámbar (verde si retirado, rojo si no se pudo) ──
function pintarRetiro(r) {
  if (!map_) return;
  quitarRetiro(r.id);
  if (r.lat == null || r.lng == null) return;
  // Revisados por admin/asistente: salen del mapa (como las instalaciones listas)
  if (r.confirmado) return;
  if (!verRetiros_) return;

  // Pendiente: gris si no tiene pareja, color de su pareja si está asignado.
  // Retirado = verde, No se pudo = rojo (el estado manda sobre la asignación).
  // Técnico: pendiente en ámbar (como dice la leyenda). Admin: color de la
  // pareja (o gris si no tiene), igual que las instalaciones.
  const color = r.estado === 'retirado' ? '#22c55e'
              : r.estado === 'no_retirado' ? '#ef4444'
              : !esAdmin_ ? RETIRO_COLOR
              : r.pareja ? colorPareja(r.pareja) : '#64748b';
  const atenuado = r.estado === 'retirado';   // los hechos se ven más tenues
  const marca = r.estado === 'retirado' ? '&#10003;' : r.estado === 'no_retirado' ? '&#10007;' : '';

  const icon = L.divIcon({
    className: '',
    html: `<div style="position:relative;display:flex;align-items:center;justify-content:center;${atenuado?'opacity:.5;':''}">
      <div style="width:15px;height:15px;background:${color};border:2px solid rgba(255,255,255,.9);border-radius:3px;box-shadow:0 2px 6px rgba(0,0,0,.4);display:flex;align-items:center;justify-content:center;font-size:9px;font-weight:800;color:#0a1628;line-height:1">${marca}</div>
    </div>`,
    iconSize: [15, 15], iconAnchor: [7.5, 7.5],
  });
  const m = L.marker([r.lat, r.lng], { icon });
  m.on('click', () => abrirDetalleRetiro(r.id));
  m.addTo(map_);
  markersRet_[r.id] = m;
}

function abrirDetalleRetiro(retiroId) {
  const r = retiros_.find(x => x.id === retiroId);
  if (!r) return;
  cerrarTodasLasHojas();
  selectedRet_ = retiroId;
  const sheet = container_.querySelector('#crc-sheet');
  const hecho = r.estado === 'retirado' || r.estado === 'no_retirado';

  sheet.innerHTML = `
    <div class="panel-scroll-info">
    <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 14px"></div>
    <div style="display:inline-flex;align-items:center;gap:6px;background:rgba(245,158,11,.14);border:1px solid rgba(245,158,11,.4);border-radius:8px;padding:3px 10px;margin-bottom:10px">
      <div style="width:9px;height:9px;background:${RETIRO_COLOR};border-radius:2px"></div>
      <span style="font-size:11px;font-weight:800;letter-spacing:.04em;color:${RETIRO_COLOR}">RETIRO</span>
    </div>
    <div style="font-size:17px;font-weight:800;color:#fff;margin-bottom:2px">${escapeHtml(r.nombre || r.nc)}</div>
    <div style="font-size:13px;font-weight:600;color:rgba(255,255,255,.8);margin-bottom:12px">NC ${escapeHtml(r.nc)}${r.pareja ? ' · ' + escapeHtml(r.pareja) : ''}</div>

    ${r.direccion ? `
    <div style="display:flex;align-items:flex-start;gap:8px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:11px;padding:10px 12px;margin-bottom:12px">
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="flex-shrink:0;margin-top:1px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
      <div style="font-size:13px;font-weight:500;color:rgba(255,255,255,.95);line-height:1.4">${escapeHtml(r.direccion)}</div>
    </div>` : ''}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:14px">
      ${r.medidor ? `<div style="background:var(--glass);border:1px solid var(--border);border-radius:10px;padding:9px 11px;grid-column:1 / -1">
        <div style="font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:3px">Medidor</div>
        <div style="font-size:15px;font-weight:700;color:${RETIRO_COLOR};font-family:monospace">${escapeHtml(r.medidor)}</div>
      </div>` : ''}
      ${r.ds ? `<div style="background:var(--glass);border:1px solid var(--border);border-radius:10px;padding:9px 11px">
        <div style="font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:3px">DS</div>
        <div style="font-size:14px;font-weight:700;color:#fff">${escapeHtml(r.ds)}</div>
      </div>` : ''}
    </div>
    </div><!-- fin panel-scroll-info -->

    <div class="panel-actions-fixed">
    ${hecho ? `
      <div style="background:var(--glass);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:8px">
        <div style="font-size:12px;font-weight:700;color:${r.estado === 'retirado' ? '#22c55e' : '#ef4444'}">${r.estado === 'retirado' ? 'Retirado' : 'No se pudo retirar'}</div>
        ${r.motivo ? `<div style="font-size:11px;color:#f87171;margin-top:4px">${escapeHtml(r.motivo)}</div>` : ''}
        ${r.hechoPor ? `<div style="font-size:10px;color:var(--text-4);margin-top:6px">Por ${escapeHtml(r.hechoPor)}${r.fechaHecho ? ' · ' + fmtFechaCorta(r.fechaHecho) : ''}</div>` : ''}
      </div>
      ${!esAdmin_ ? `<button id="crc-ret-deshacer" style="width:100%;padding:11px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-3);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">Volver a marcar</button>` : `
      <div style="display:flex;gap:8px">
        <button id="crc-ret-devolver" style="flex:1;padding:13px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-2);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Devolver a pendiente</button>
        <button id="crc-ret-confirmar" class="btn-marca" style="flex:1.4;padding:13px;border-radius:12px;font-size:13px;cursor:pointer;font-family:inherit">Revisado · quitar del mapa</button>
      </div>`}
    ` : `
      <div style="display:flex;gap:8px">
        <button id="crc-ret-nopudo" style="flex:1;padding:13px;border-radius:12px;border:1px solid rgba(239,68,68,.4);background:rgba(239,68,68,.1);color:#f87171;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">No se pudo</button>
        <button id="crc-ret-ok" style="flex:2;padding:13px;border-radius:12px;border:none;background:#22c55e;color:#0a1628;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">Retirado</button>
      </div>
    `}
    </div>
  `;
  sheet.classList.add('abierta');

  if (!hecho) {
    sheet.querySelector('#crc-ret-ok').onclick = () => marcarRetiro(retiroId, 'retirado');
    sheet.querySelector('#crc-ret-nopudo').onclick = () => pedirMotivoRetiro(retiroId);
  } else if (!esAdmin_) {
    const btn = sheet.querySelector('#crc-ret-deshacer');
    if (btn) btn.onclick = () => marcarRetiro(retiroId, 'pendiente');
  } else {
    sheet.querySelector('#crc-ret-confirmar').onclick = () => confirmarRetiro(retiroId);
    sheet.querySelector('#crc-ret-devolver').onclick = () => {
      if (confirm('¿Devolver este retiro a pendiente? Volverá a salirle a su pareja.')) marcarRetiro(retiroId, 'pendiente');
    };
  }
}

function pedirMotivoRetiro(retiroId) {
  const sheet = container_.querySelector('#crc-sheet');
  sheet.innerHTML = `
    <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 14px"></div>
    <div style="font-size:15px;font-weight:800;margin-bottom:6px">No se pudo retirar</div>
    <div style="font-size:12px;color:var(--text-3);margin-bottom:12px">¿Por qué no se pudo? (breve)</div>
    <textarea id="crc-ret-motivo" rows="3" placeholder="Ej: portón cerrado, cliente ausente, dirección no existe…" style="width:100%;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-2);font-size:14px;font-family:inherit;outline:none;resize:vertical;margin-bottom:12px"></textarea>
    <div style="display:flex;gap:8px">
      <button id="crc-ret-cancel" style="flex:1;padding:13px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-3);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Cancelar</button>
      <button id="crc-ret-guardar" style="flex:2;padding:13px;border-radius:12px;border:none;background:#ef4444;color:#fff;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">Guardar</button>
    </div>
  `;
  setTimeout(() => sheet.querySelector('#crc-ret-motivo')?.focus(), 250);
  sheet.querySelector('#crc-ret-cancel').onclick = () => abrirDetalleRetiro(retiroId);
  sheet.querySelector('#crc-ret-guardar').onclick = () => {
    const motivo = sheet.querySelector('#crc-ret-motivo').value.trim();
    marcarRetiro(retiroId, 'no_retirado', motivo);
  };
}

async function marcarRetiro(retiroId, estado, motivo) {
  const r = retiros_.find(x => x.id === retiroId);
  if (!r) return;
  try {
    const patch = { estado };
    if (estado === 'pendiente') {
      patch.motivo = '';
      patch.hechoPor = '';
      patch.fechaHecho = null;
      if (esAdmin_) { patch.confirmado = false; patch.confirmadoPor = null; patch.fechaConfirmacion = null; }
    } else {
      patch.motivo = motivo || '';
      patch.hechoPor = session_.displayName;
      patch.fechaHecho = firebase.firestore.Timestamp.now();
    }
    await db.collection('caracterizacion_retiros').doc(retiroId).update(patch);
    Object.assign(r, patch);
    pintarRetiro(r);
    cerrarTodasLasHojas();
    updateStat();
    const msg = estado === 'retirado' ? 'Marcado como retirado'
              : estado === 'no_retirado' ? 'Registrado: no se pudo'
              : 'Retiro reabierto';
    toast(msg, 'ok');
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

// Admin/asistente: marca un retiro hecho como revisado; sale del mapa.
async function confirmarRetiro(retiroId) {
  const r = retiros_.find(x => x.id === retiroId);
  if (!r) return;
  const patch = { confirmado: true, confirmadoPor: session_.displayName, fechaConfirmacion: firebase.firestore.Timestamp.now() };
  try {
    await db.collection('caracterizacion_retiros').doc(retiroId).update(patch);
    Object.assign(r, patch);
    pintarRetiro(r);
    cerrarTodasLasHojas();
    updateStat();
    toast('Retiro revisado', 'ok');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

function fmtFechaCorta(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth()+1)} ${p(d.getHours())}:${p(d.getMinutes())}`;
}


function quitarMarcadores(ordenId) {
  const g = markers_[ordenId];
  if (!g) return;
  Object.values(g).forEach(m => { if (m && map_ && map_.hasLayer(m)) map_.removeLayer(m); });
  delete markers_[ordenId];
}

// ── Detalle del punto + acciones de cascada ──
function abrirDetalle(ordenId, nivel) {
  const o = ordenes_.find(x => x.id === ordenId);
  if (!o) return;
  selected_ = { ordenId, nivel };
  const p = o[nivel] || o.titular;
  const cerrada = o.estado === 'por_confirmar' || o.estado === 'confirmada';
  const sheet = container_.querySelector('#crc-sheet');

  const siguiente = nivel === 'titular' ? 'suplente1' : nivel === 'suplente1' ? 'suplente2' : null;
  const haySiguiente = siguiente && o[siguiente];
  const visitas = Array.isArray(o.visitas) ? o.visitas : [];

  sheet.innerHTML = `
    <div class="panel-scroll-info">
    <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 14px"></div>
    ${o.esUPR ? `<div style="display:flex;align-items:center;gap:7px;background:rgba(56,189,248,.14);border:1px solid rgba(56,189,248,.45);border-radius:10px;padding:9px 12px;margin-bottom:12px">
      <span style="font-size:13px;font-weight:800;letter-spacing:.06em;color:${UPR_COLOR}">UPR</span>
      <span style="font-size:11px;color:var(--text-3)">${o.tarifa ? 'Tarifa ' + o.tarifa : 'Punto UPR'}</span>
    </div>` : ''}
    <div style="display:flex;align-items:center;gap:8px;margin-bottom:6px">
      <div style="width:10px;height:10px;border-radius:50%;background:${(o.esUPR && nivel==='titular') ? UPR_COLOR : NIVEL_COLOR[nivel]}"></div>
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:${(o.esUPR && nivel==='titular') ? UPR_COLOR : NIVEL_COLOR[nivel]}">${NIVEL_LABEL[nivel]}</div>
    </div>
    <div style="font-size:17px;font-weight:800;color:#fff;margin-bottom:2px">${escapeHtml(p.nombre || '—')}</div>
    <div style="font-size:13px;font-weight:600;color:rgba(255,255,255,.8);margin-bottom:12px">NC ${escapeHtml(p.nc)}</div>

    ${p.direccion ? `
    <div style="display:flex;align-items:flex-start;gap:8px;background:rgba(255,255,255,.08);border:1px solid rgba(255,255,255,.12);border-radius:11px;padding:10px 12px;margin-bottom:12px">
      <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="flex-shrink:0;margin-top:1px"><path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/></svg>
      <div style="font-size:13px;font-weight:500;color:rgba(255,255,255,.95);line-height:1.4">${escapeHtml(p.direccion)}</div>
    </div>` : ''}

    <div style="display:grid;grid-template-columns:1fr 1fr;gap:9px;margin-bottom:${visitas.length?'12px':'16px'}">
      ${p.medidor ? `<div style="background:var(--glass);border:1px solid var(--border);border-radius:10px;padding:9px 11px;grid-column:1 / -1">
        <div style="font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:3px">Medidor</div>
        <div style="font-size:15px;font-weight:700;color:#f472b6;font-family:monospace">${escapeHtml(p.medidor)}</div>
      </div>` : ''}
      ${p.ds ? `<div style="background:var(--glass);border:1px solid var(--border);border-radius:10px;padding:9px 11px">
        <div style="font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:3px">DS</div>
        <div style="font-size:14px;font-weight:700;color:#fff">${escapeHtml(p.ds)}</div>
      </div>` : ''}
      ${o.tarifa ? `<div style="background:var(--glass);border:1px solid var(--border);border-radius:10px;padding:9px 11px">
        <div style="font-size:10px;font-weight:700;letter-spacing:.05em;text-transform:uppercase;color:rgba(255,255,255,.45);margin-bottom:3px">Tarifa</div>
        <div style="font-size:14px;font-weight:700;color:#fff">${escapeHtml(o.tarifa)}</div>
      </div>` : ''}
    </div>

    ${visitas.length ? `<div style="font-size:12px;color:#fbbf24;margin-bottom:16px;font-weight:600">Visitas: ${visitas.map(v=>NIVEL_LABEL[v]).join(', ')}</div>` : ''}
    </div><!-- fin panel-scroll-info -->

    <div class="panel-actions-fixed">
    ${cerrada ? `
      <div style="text-align:center;padding:12px;border-radius:12px;background:rgba(251,191,36,.1);border:1px solid rgba(251,191,36,.3);font-size:13px;font-weight:700;color:#fbbf24">
        ${o.logranoEn ? `Hecha en ${NIVEL_LABEL[o.logranoEn]}` : 'Sin lograr'} · esperando confirmación
      </div>
    ` : `
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button id="crc-visita" style="flex:1;padding:13px;border-radius:12px;border:1px solid rgba(251,191,36,.4);background:rgba(251,191,36,.12);color:#fbbf24;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Visita</button>
        <button id="crc-hecha" style="flex:2;padding:13px;border-radius:12px;border:none;background:#22c55e;color:#0a1628;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">Hecho aquí</button>
      </div>
      ${nivel !== 'titular' ? `<button id="crc-atras" style="width:100%;padding:11px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-3);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;display:flex;align-items:center;justify-content:center;gap:6px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="15 18 9 12 15 6"/></svg>
        Volver al ${NIVEL_LABEL[nivelAnterior(nivel)]}
      </button>` : ''}
      ${haySiguiente ? `<div style="font-size:10px;color:var(--text-4);text-align:center;margin-top:10px">Si registras visita, pasarás a ${NIVEL_LABEL[siguiente]}</div>`
        : nivel==='suplente2' ? `<div style="font-size:10px;color:var(--text-4);text-align:center;margin-top:10px">Último punto. Si registras visita, la orden queda sin lograr.</div>` : ''}
    `}
    </div>
  `;

  sheet.classList.add('abierta');

  if (!cerrada) {
    sheet.querySelector('#crc-hecha').onclick = () => marcarHecha(ordenId, nivel);
    sheet.querySelector('#crc-visita').onclick = () => marcarVisita(ordenId, nivel);
    const btnAtras = sheet.querySelector('#crc-atras');
    if (btnAtras) btnAtras.onclick = () => retrocederCascada(ordenId, nivel);
  }

  if (p.lat != null) map_.setView([p.lat, p.lng], Math.max(map_.getZoom(), 16));
}

function cerrarSheet() {
  const sheet = container_.querySelector('#crc-sheet');
  if (sheet) sheet.classList.remove('abierta');
  selected_ = null;
}

// "Hecha aquí": cierra la orden registrando el nivel
// "Hecho aquí": la orden se logró en este punto. Queda POR CONFIRMAR
// (el asistente la valida después). Guarda las visitas acumuladas.
async function marcarHecha(ordenId, nivel) {
  const o = ordenes_.find(x => x.id === ordenId);
  if (!o) return;
  const visitas = Array.isArray(o.visitas) ? o.visitas : [];
  try {
    await db.collection('caracterizacion_ordenes').doc(ordenId).update({
      estado: 'por_confirmar', logranoEn: nivel, visitas,
      hechaPor: session_.displayName, fechaHecha: firebase.firestore.Timestamp.now(),
    });
    o.estado = 'por_confirmar'; o.logranoEn = nivel; o.visitas = visitas; o.hechaPor = session_.displayName;
    pintarOrden(o);
    cerrarSheet(); updateStat();
    const nv = visitas.length;
    toast(`Hecha en ${NIVEL_LABEL[nivel]}${nv ? ` (${nv} visita${nv>1?'s':''})` : ''} · falta revisar`, 'ok');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

function nivelAnterior(nivel) {
  return nivel === 'suplente2' ? 'suplente1' : nivel === 'suplente1' ? 'titular' : null;
}

// Retrocede un paso la cascada. Si el punto anterior tenía una visita
// registrada, el técnico decide si la mantiene (se cobra) o la borra.
function retrocederCascada(ordenId, nivelActual) {
  const o = ordenes_.find(x => x.id === ordenId);
  if (!o) return;
  const anterior = nivelAnterior(nivelActual);
  if (!anterior) return;

  const visitas = Array.isArray(o.visitas) ? o.visitas : [];
  const teniaVisita = visitas.includes(anterior);

  const sheet = container_.querySelector('#crc-sheet');
  sheet.innerHTML = `
    <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 14px"></div>
    <div style="font-size:16px;font-weight:800;margin-bottom:6px">Volver al ${NIVEL_LABEL[anterior]}</div>
    <div style="font-size:12px;color:var(--text-3);line-height:1.5;margin-bottom:16px">
      Regresarás al ${NIVEL_LABEL[anterior]} para intentarlo de nuevo.${teniaVisita ? ` Ya habías registrado una visita en ese punto.` : ''}
    </div>
    ${teniaVisita ? `
      <div style="font-size:11px;font-weight:700;color:var(--text-3);margin-bottom:8px">¿Qué hago con esa visita?</div>
      <div style="display:flex;gap:8px;margin-bottom:8px">
        <button id="crc-ret-mantener" style="flex:1;padding:13px;border-radius:12px;border:1px solid rgba(251,191,36,.4);background:rgba(251,191,36,.12);color:#fbbf24;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Mantener visita</button>
        <button id="crc-ret-borrar" style="flex:1;padding:13px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-2);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Borrar visita</button>
      </div>
    ` : `
      <button id="crc-ret-ok" style="width:100%;padding:13px;border-radius:12px;border:none;background:#a78bfa;color:#0d1117;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit">Volver al ${NIVEL_LABEL[anterior]}</button>
    `}
    <button id="crc-ret-cancel" style="width:100%;padding:11px;border-radius:12px;border:1px solid var(--border);background:transparent;color:var(--text-4);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit;margin-top:8px">Cancelar</button>
  `;

  const aplicar = async (borrarVisita) => {
    let nuevasVisitas = visitas;
    if (borrarVisita) nuevasVisitas = visitas.filter(v => v !== anterior);
    try {
      await db.collection('caracterizacion_ordenes').doc(ordenId).update({
        _nivelVisible: anterior, visitas: nuevasVisitas,
      });
      o._nivelVisible = anterior;
      o.visitas = nuevasVisitas;
      pintarOrden(o);
      cerrarSheet();
      setTimeout(() => abrirDetalle(ordenId, anterior), 260);
      toast(borrarVisita ? `Volviste al ${NIVEL_LABEL[anterior]} · visita borrada` : `Volviste al ${NIVEL_LABEL[anterior]}`, 'ok');
    } catch (err) { toast('Error: ' + err.message, 'error'); }
  };

  if (teniaVisita) {
    sheet.querySelector('#crc-ret-mantener').onclick = () => aplicar(false);
    sheet.querySelector('#crc-ret-borrar').onclick = () => aplicar(true);
  } else {
    sheet.querySelector('#crc-ret-ok').onclick = () => aplicar(false);
  }
  sheet.querySelector('#crc-ret-cancel').onclick = () => abrirDetalle(ordenId, nivelActual);
}

// "Visita" (antes "No pude"): registra una visita cobrable en este punto
// y pasa al siguiente. Si no hay más suplentes, la orden queda por confirmar
// como no lograda (solo visitas).
async function marcarVisita(ordenId, nivel) {
  const o = ordenes_.find(x => x.id === ordenId);
  if (!o) return;
  const siguiente = nivel === 'titular' ? 'suplente1' : nivel === 'suplente1' ? 'suplente2' : null;

  // Acumular la visita de este nivel (sin duplicar si ya estaba)
  const visitas = Array.isArray(o.visitas) ? [...o.visitas] : [];
  if (!visitas.includes(nivel)) visitas.push(nivel);
  o.visitas = visitas;

  if (siguiente && o[siguiente]) {
    // Revelar el siguiente punto (persistimos la visita para no perderla)
    try {
      await db.collection('caracterizacion_ordenes').doc(ordenId).update({ visitas, _nivelVisible: siguiente });
    } catch (err) { /* si falla, seguimos localmente */ }
    o._nivelVisible = siguiente;
    pintarOrden(o);
    cerrarSheet();
    setTimeout(() => abrirDetalle(ordenId, siguiente), 260);
    toast(`Visita registrada · mostrando ${NIVEL_LABEL[siguiente]}`, 'ok');
  } else {
    // No hay más suplentes: la orden termina sin lograrse (solo visitas).
    try {
      await db.collection('caracterizacion_ordenes').doc(ordenId).update({
        estado: 'por_confirmar', logranoEn: null, visitas,
        hechaPor: session_.displayName, fechaHecha: firebase.firestore.Timestamp.now(),
      });
      o.estado = 'por_confirmar';
      pintarOrden(o);
      cerrarSheet(); updateStat();
      toast(`${visitas.length} visita${visitas.length>1?'s':''}, ningún punto logrado · falta revisar`, 'warn');
    } catch (err) { toast('Error: ' + err.message, 'error'); }
  }
}

function updateStat() {
  const el = container_.querySelector('#crc-map-stat');
  if (!el) return;
  if (!esAdmin_ && !ordenes_.length) {
    const miPareja = session_.asignacionActual?.destino;
    el.textContent = miPareja ? `Sin órdenes para ${miPareja}` : 'Sin pareja asignada';
    return;
  }
  const total = ordenes_.length;
  const hechas = ordenes_.filter(o => o.estado === 'por_confirmar' || o.estado === 'confirmada').length;
  const pend = ordenes_.filter(o => !o.estado || o.estado === 'pendiente').length;
  const retPend = retiros_.filter(r => !r.estado || r.estado === 'pendiente').length;
  let txt = `${pend} pendiente${pend !== 1 ? 's' : ''} · ${hechas} hecha${hechas !== 1 ? 's' : ''}`;
  if (retiros_.length) txt += ` · ${retPend} retiro${retPend !== 1 ? 's' : ''}`;
  el.textContent = txt;
}

// ══════════════════════════════════════════════════════════════
//  ASIGNACIÓN POR ZONA (admin/asistente)
//  Dibuja un polígono; las órdenes cuyo TITULAR cae dentro se
//  asignan a la pareja elegida.
// ══════════════════════════════════════════════════════════════

const PAREJAS_CRC = ['Pareja 1','Pareja 2','Pareja 3'];

// Solo se cuentan/asignan por zona los puntos aún pendientes. Los ya hechos
// (instalación por_confirmar/confirmada, retiro retirado/no_retirado) siguen
// en los datos pero NO deben re-asignarse a otra pareja al delimitar una zona.
const instAsignableZona = o => !o.estado || o.estado === 'pendiente';
const retAsignableZona  = r => !r.estado || r.estado === 'pendiente';

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
  const ctrl = container_.querySelector('#crc-zona-ctrl');
  if (ctrl) ctrl.style.display = 'none';
}

function activarModoZona() {
  if (!map_) return;
  cerrarTodasLasHojas();
  puntos_ = [];
  limpiarPoligono();
  map_.getContainer().style.cursor = 'crosshair';
  toast('Toca para marcar la zona · ciérrala con el botón o doble toque', 'ok', 5000);
  const ctrl = container_.querySelector('#crc-zona-ctrl');
  ctrl.style.display = 'flex';
  container_.querySelector('#crc-cerrar-poli').style.display = 'none';
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
  const btn = container_.querySelector('#crc-cerrar-poli');
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
  const ctrl = container_.querySelector('#crc-zona-ctrl');
  if (ctrl) ctrl.style.display = 'none';
  if (poliPreview_) { map_.removeLayer(poliPreview_); poliPreview_ = null; }
  zonaPoligono_ = L.polygon(puntos_, { color:'#a78bfa', weight:2, fillOpacity:.12 }).addTo(map_);

  const dentro = ordenes_.filter(o => instAsignableZona(o) && o.titular?.lat != null &&
    pointInPolygon(L.latLng(o.titular.lat, o.titular.lng), puntos_));
  const dentroRet = retiros_.filter(r => retAsignableZona(r) && r.lat != null &&
    pointInPolygon(L.latLng(r.lat, r.lng), puntos_));

  abrirSheetZona(dentro.length, dentroRet.length);
}

function abrirSheetZona(cuantas, cuantosRet) {
  const sheet = container_.querySelector('#crc-sheet-zona');
  const detalle = cuantosRet
    ? `${cuantas} instalación${cuantas!==1?'es':''} y ${cuantosRet} retiro${cuantosRet!==1?'s':''} en esta zona`
    : `${cuantas} orden${cuantas!==1?'es':''} en esta zona (por titular)`;
  sheet.innerHTML = `
    <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 14px"></div>
    <div style="font-size:16px;font-weight:800;margin-bottom:4px">Asignar zona</div>
    <div style="font-size:12px;color:var(--text-4);margin-bottom:16px">${detalle}</div>
    <div class="form-label" style="margin-bottom:8px">Pareja</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:8px" id="crc-zona-parejas">
      ${parejasDisponibles().map(p => `<div class="crc-zp" data-val="${escapeHtml(p)}" style="cursor:pointer;padding:9px 16px;border-radius:20px;border:1px solid var(--border);background:var(--glass);font-size:13px;font-weight:700">${p}</div>`).join('')}
      <div class="crc-zp" data-val="null" style="cursor:pointer;padding:9px 16px;border-radius:20px;border:1px solid var(--border);background:var(--glass);font-size:13px;font-weight:700;color:var(--text-4)">Sin pareja</div>
    </div>
    <div id="crc-zona-err" class="form-error" style="display:none;margin-bottom:8px"></div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button id="crc-zona-cancel" style="flex:1;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-3);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Cancelar</button>
      <button id="crc-zona-ok" style="flex:2;padding:12px;border-radius:12px;border:none;background:#a78bfa;color:#0d1117;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit"><span id="crc-zona-ok-lbl">Asignar</span></button>
    </div>`;
  sheet.classList.add('abierta');

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
  if (sheet) sheet.classList.remove('abierta');
  limpiarPoligono();
  puntos_ = [];
  if (map_) { map_.off('click', onMapClickZona_); map_.off('dblclick', onMapDblZona_); map_.getContainer().style.cursor = ''; }
}

async function confirmarZona(pareja) {
  const err = container_.querySelector('#crc-zona-err');
  if (!pareja) { err.textContent = 'Selecciona una pareja o "Sin pareja".'; err.style.display = 'block'; return; }
  const dentro = ordenes_.filter(o => instAsignableZona(o) && o.titular?.lat != null &&
    pointInPolygon(L.latLng(o.titular.lat, o.titular.lng), puntos_));
  const dentroRet = retiros_.filter(r => retAsignableZona(r) && r.lat != null &&
    pointInPolygon(L.latLng(r.lat, r.lng), puntos_));
  if (!dentro.length && !dentroRet.length) { err.textContent = 'No hay puntos en esa zona.'; err.style.display = 'block'; return; }

  const val = pareja === 'null' ? null : pareja;
  const btn = container_.querySelector('#crc-zona-ok');
  btn.disabled = true;
  container_.querySelector('#crc-zona-ok-lbl').textContent = 'Asignando…';
  try {
    const ts = firebase.firestore.Timestamp.now();
    // Instalaciones
    for (let i = 0; i < dentro.length; i += 400) {
      const batch = db.batch();
      dentro.slice(i, i + 400).forEach(o => {
        batch.update(db.collection('caracterizacion_ordenes').doc(o.id), { pareja: val, asignadoEn: ts });
      });
      await batch.commit();
    }
    // Retiros
    for (let i = 0; i < dentroRet.length; i += 400) {
      const batch = db.batch();
      dentroRet.slice(i, i + 400).forEach(r => {
        batch.update(db.collection('caracterizacion_retiros').doc(r.id), { pareja: val, asignadoEn: ts });
      });
      await batch.commit();
    }
    dentro.forEach(o => { o.pareja = val; pintarOrden(o); });
    dentroRet.forEach(r => { r.pareja = val; pintarRetiro(r); });
    cancelarZona();
    pintarLeyenda();
    const partes = [];
    if (dentro.length) partes.push(`${dentro.length} instalaciones`);
    if (dentroRet.length) partes.push(`${dentroRet.length} retiros`);
    toast(`${partes.join(' y ')} asignados${val ? ' a ' + val : ' (sin pareja)'}`, 'ok');
  } catch (e) {
    btn.disabled = false;
    container_.querySelector('#crc-zona-ok-lbl').textContent = 'Reintentar';
    toast('Error: ' + e.message, 'error');
  }
}

// Asignar una sola orden (admin toca un titular)
// El asistente confirma una orden "por confirmar" desde el mapa
function abrirConfirmar(ordenId) {
  const o = ordenes_.find(x => x.id === ordenId);
  if (!o) return;
  const t = o.titular || {};
  const visitas = Array.isArray(o.visitas) ? o.visitas : [];
  const sheet = container_.querySelector('#crc-sheet-zona');
  sheet.innerHTML = `
    <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 14px"></div>
    <div style="font-size:15px;font-weight:800;margin-bottom:2px">${escapeHtml(t.nombre || o.ncTitular)}</div>
    <div style="font-size:11px;color:var(--text-4);margin-bottom:14px">NC ${o.ncTitular}${o.pareja ? ' · ' + o.pareja : ''}</div>

    <div style="background:var(--glass);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:14px">
      <div style="font-size:12px;font-weight:700;color:#22c55e;margin-bottom:6px">${o.logranoEn ? `Hecha en ${NIVEL_LABEL[o.logranoEn]}` : 'Sin lograr (solo visitas)'}</div>
      ${visitas.length ? `<div style="font-size:11px;color:#fbbf24">Visitas cobrables: ${visitas.map(v=>NIVEL_LABEL[v]).join(', ')} (${visitas.length})</div>` : `<div style="font-size:11px;color:var(--text-4)">Sin visitas</div>`}
      ${o.hechaPor ? `<div style="font-size:10px;color:var(--text-4);margin-top:6px">Marcada por ${escapeHtml(o.hechaPor)}</div>` : ''}
    </div>

    <div style="display:flex;gap:8px">
      <button id="crc-conf-rech" style="flex:1;padding:12px;border-radius:12px;border:1px solid rgba(239,68,68,.4);background:rgba(239,68,68,.1);color:#f87171;font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Regresar a por hacer</button>
      <button id="crc-conf-ok" style="flex:2;padding:12px;border-radius:12px;border:none;background:#22c55e;color:#0a1628;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit"><span id="crc-conf-lbl">Marcar como lista</span></button>
    </div>`;
  sheet.classList.add('abierta');

  sheet.querySelector('#crc-conf-ok').onclick = () => confirmarOrden(ordenId, sheet);
  sheet.querySelector('#crc-conf-rech').onclick = () => regresarPendiente(ordenId, sheet);
}

async function confirmarOrden(ordenId, sheet) {
  const btn = sheet.querySelector('#crc-conf-ok'); btn.disabled = true;
  sheet.querySelector('#crc-conf-lbl').textContent = 'Confirmando…';
  try {
    await db.collection('caracterizacion_ordenes').doc(ordenId).update({
      estado: 'confirmada',
      confirmadaPor: session_.displayName, fechaConfirmacion: firebase.firestore.Timestamp.now(),
    });
    const o = ordenes_.find(x => x.id === ordenId);
    if (o) { o.estado = 'confirmada'; pintarOrden(o); }
    sheet.classList.remove('abierta');
    toast('Orden marcada como lista', 'ok');
  } catch (err) {
    btn.disabled = false; sheet.querySelector('#crc-conf-lbl').textContent = 'Reintentar';
    toast('Error: ' + err.message, 'error');
  }
}

async function regresarPendiente(ordenId, sheet) {
  try {
    await db.collection('caracterizacion_ordenes').doc(ordenId).update({
      estado: 'pendiente', logranoEn: null, _nivelVisible: 'titular',
    });
    const o = ordenes_.find(x => x.id === ordenId);
    if (o) { o.estado = 'pendiente'; o.logranoEn = null; o._nivelVisible = 'titular'; pintarOrden(o); }
    sheet.classList.remove('abierta');
    toast('Orden regresada a pendiente', 'warn');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

function abrirAsignarIndividual(ordenId) {
  const o = ordenes_.find(x => x.id === ordenId);
  if (!o) return;
  const t = o.titular || {};
  const nSup = [o.suplente1, o.suplente2].filter(s => s && s.nc).length;
  const dato = (etq, val) => val ? `<div style="display:flex;justify-content:space-between;gap:12px;font-size:12px;margin-bottom:3px"><span style="color:var(--text-4)">${etq}</span><span style="color:var(--text-2);text-align:right">${escapeHtml(val)}</span></div>` : '';
  const sheet = container_.querySelector('#crc-sheet-zona');
  sheet.innerHTML = `
    <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 14px"></div>
    ${o.esUPR ? `<div style="display:inline-block;font-size:11px;font-weight:800;letter-spacing:.06em;color:${UPR_COLOR};background:rgba(56,189,248,.14);border:1px solid rgba(56,189,248,.45);border-radius:8px;padding:3px 9px;margin-bottom:8px">UPR${o.tarifa ? ' · ' + o.tarifa : ''}</div>` : ''}
    <div style="font-size:15px;font-weight:800;margin-bottom:2px">${escapeHtml(t.nombre || o.ncTitular)}</div>
    <div style="font-size:11px;color:var(--text-4);margin-bottom:12px">NC ${o.ncTitular} · ${o.pareja ? o.pareja : 'sin asignar'}</div>
    <div style="background:var(--glass);border:1px solid var(--border);border-radius:10px;padding:10px 12px;margin-bottom:14px">
      ${dato('Dirección', t.direccion)}
      ${dato('Medidor', t.medidor)}
      ${dato('DS', t.ds)}
      ${!o.esUPR ? dato('Tarifa', o.tarifa) : ''}
      ${dato('Suplentes', nSup ? `${nSup} suplente${nSup>1?'s':''}` : 'Sin suplentes')}
    </div>
    <div class="form-label" style="margin-bottom:8px">Asignar a</div>
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-bottom:16px" id="crc-ind-parejas">
      ${parejasDisponibles().map(p => `<div class="crc-ip" data-val="${p}" style="cursor:pointer;padding:9px 16px;border-radius:20px;border:1px solid ${o.pareja===p?'#a78bfa':'var(--border)'};background:${o.pareja===p?'rgba(167,139,250,.15)':'var(--glass)'};font-size:13px;font-weight:700">${p}</div>`).join('')}
      <div class="crc-ip" data-val="null" style="cursor:pointer;padding:9px 16px;border-radius:20px;border:1px solid var(--border);background:var(--glass);font-size:13px;font-weight:700;color:var(--text-4)">Quitar</div>
    </div>
    <button id="crc-ind-cerrar" style="width:100%;padding:11px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-3);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">Cerrar</button>`;
  sheet.classList.add('abierta');

  sheet.querySelectorAll('.crc-ip').forEach(chip => chip.onclick = async () => {
    const val = chip.dataset.val === 'null' ? null : chip.dataset.val;
    try {
      await db.collection('caracterizacion_ordenes').doc(ordenId).update({ pareja: val, asignadoEn: firebase.firestore.Timestamp.now() });
      o.pareja = val; pintarOrden(o);
      sheet.classList.remove('abierta');
      toast(val ? `Asignada a ${val}` : 'Asignación quitada', 'ok');
    } catch (e) { toast('Error: ' + e.message, 'error'); }
  });
  sheet.querySelector('#crc-ind-cerrar').onclick = () => { sheet.classList.remove('abierta'); };
}

// ── Quitar todas las asignaciones (admin) ──
// Deja en "sin asignar" (gris) todas las instalaciones y retiros que
// tengan pareja. Útil cuando se asignó una zona por error.
async function resetearAsignaciones() {
  const inst = ordenes_.filter(o => o.pareja);
  const rets = retiros_.filter(r => r.pareja);
  const total = inst.length + rets.length;
  if (!total) { toast('No hay asignaciones que quitar', 'warn'); return; }

  if (!confirm(`Se quitará la asignación de ${total} punto${total>1?'s':''} (${inst.length} instalaciones, ${rets.length} retiros).\n\nTodos volverán a "sin asignar" (gris). Esto no borra las órdenes ni su avance.\n\n¿Continuar?`)) return;

  try {
    toast('Quitando asignaciones…', 'ok');
    // Instalaciones
    for (let i = 0; i < inst.length; i += 400) {
      const batch = db.batch();
      inst.slice(i, i + 400).forEach(o => {
        batch.update(db.collection('caracterizacion_ordenes').doc(o.id), { pareja: null });
      });
      await batch.commit();
    }
    // Retiros
    for (let i = 0; i < rets.length; i += 400) {
      const batch = db.batch();
      rets.slice(i, i + 400).forEach(r => {
        batch.update(db.collection('caracterizacion_retiros').doc(r.id), { pareja: null });
      });
      await batch.commit();
    }
    // Actualizar en memoria y repintar
    inst.forEach(o => { o.pareja = null; pintarOrden(o); });
    rets.forEach(r => { r.pareja = null; pintarRetiro(r); });
    updateStat();
    toast(`${total} asignaciones quitadas`, 'ok');
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
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
