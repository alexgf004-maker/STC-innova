/**
 * js/views/ami.js
 * Módulo AMI (medidores telegestionados / remotos).
 *
 * AMI es, en el fondo, un cambio de medidores igual que el área "Cambios",
 * pero para medidores telegestionados y en campaña separada. Diferencias:
 *   - Las órdenes NO traen WO; se identifican solo por NC.
 *   - Versión más sencilla: sin órdenes urgentes ni cargas de listados aparte.
 *
 * Este archivo es por ahora el CASCARÓN del área: deja el espacio creado,
 * las pestañas y la identidad visual (morado) listas, pero la lógica de
 * órdenes (importador, mapa, marcar hechas) se conecta cuando tengamos el
 * archivo real de órdenes de AMI. Así el área ya existe sin cargar todo de una.
 *
 * Exporta: init(container, session)
 *
 * Roles:
 *   admin / asistente → Panel de gestión + todas las parejas
 *   tecnico (AMI)     → Solo su pareja
 */

import { db } from '../firebase.js';
import { toast } from '../ui.js';

// ── Identidad del área ────────────────────────────
const AREA = 'AMI';
const COLECCION = 'ami_ordenes';        // colección propia en Firestore
const ACCENT = '#a78bfa';               // morado/violeta (distinto de las otras áreas)
const ACCENT_GLASS = 'rgba(139,92,246,.12)';
const ACCENT_BORDER = 'rgba(139,92,246,.35)';

// Parejas (mismas que Cambios; se ajustará si AMI usa otras cuadrillas)
const PAREJAS = ['Pareja 1', 'Pareja 2', 'Pareja 3', 'Pareja 4'];
const PALETA_PAREJA = ['#2dd4bf', '#fbbf24', '#a78bfa', '#f472b6', '#60a5fa'];
function colorPareja(pareja) {
  const n = parseInt(String(pareja).replace(/\D/g, ''), 10);
  return PALETA_PAREJA[(n - 1) % PALETA_PAREJA.length] || '#94a3b8';
}

// ── Residuos (órdenes arrastradas de rutas anteriores) ──
// Una orden es "residuo" si sigue pendiente y su fechaRuta es de un día
// anterior a hoy. La ruta que DELSUR manda cada día trae fechaRuta = ese día.
function claveDiaAMI(ts) {
  const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : (ts ? new Date(ts) : null));
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function diasArrastrada(o) {
  const clave = claveDiaAMI(o.fechaRuta);
  if (!clave) return 0;
  const [y,m,d] = clave.split('-').map(Number);
  const ruta = new Date(y, m-1, d); ruta.setHours(0,0,0,0);
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const dias = Math.round((hoy - ruta) / 86400000);
  return dias > 0 ? dias : 0;
}
function esResiduo(o) {
  const hecha = o.estadoCampo === 'hecha' || o.estadoCampo === 'aprobada';
  return !hecha && diasArrastrada(o) > 0;
}

// ── Estado del módulo ─────────────────────────────
let container_, session_, role_, pareja_;
let ordenes_ = [];
let activeTab_ = 'panel';   // 'panel' | 'ordenes' | 'mapa'
let esAdmin_ = false;

// ── Entry point ───────────────────────────────────
export async function init(container, session) {
  container_ = container;
  session_   = session;
  role_      = session.role;
  esAdmin_   = role_ === 'admin' || role_ === 'asistente';
  pareja_    = session.asignacionActual?.destino || null;
  activeTab_ = esAdmin_ ? 'panel' : 'resumen';

  renderShell();
  await cargarOrdenes();
  setTab(activeTab_);
}

// ── Cargar órdenes (lee la colección; aún puede estar vacía) ──
async function cargarOrdenes() {
  try {
    // Cargar el padrón de NC ya cambiados (para marcar/esconder)
    let padron = new Set();
    try {
      const pad = await db.collection('ami_cambiados').get();
      padron = new Set(pad.docs.map(d => String(d.data().nc ?? d.id).trim()));
    } catch (e) { /* si no existe aún, padrón vacío */ }

    const snap = await db.collection(COLECCION).get();
    let todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // El técnico ve solo las órdenes de su pareja
    if (!esAdmin_) {
      todas = pareja_ ? todas.filter(o => o.pareja === pareja_) : [];
    }
    // Cruce con el padrón: marcar ya cambiadas; al técnico se le esconden
    todas.forEach(o => { o._yaCambiada = padron.has(String(o.nc ?? '').trim()); });
    if (!esAdmin_) todas = todas.filter(o => !o._yaCambiada);
    ordenes_ = todas;
  } catch (err) {
    // Si la colección aún no existe o no hay permisos, no rompemos el cascarón
    console.warn('[ami] No se pudieron cargar órdenes todavía:', err.message);
    ordenes_ = [];
  }
}

// ── Shell (pestañas + contenedor) ─────────────────
function renderShell() {
  const tabs = esAdmin_
    ? [{ id: 'panel', label: 'Panel' }, { id: 'ordenes', label: 'Órdenes' }, { id: 'mapa', label: 'Mapa' }]
    : [{ id: 'resumen', label: 'Resumen' }, { id: 'ordenes', label: 'Órdenes' }];

  container_.innerHTML = `
    <div class="area-tabs" style="margin-bottom:14px">
      ${tabs.map((t, i) => `
        <button class="area-tab ami-tab ${i === 0 ? 'active am' : ''}" data-tab="${t.id}">${t.label}</button>
      `).join('')}
    </div>
    <div id="ami-content"></div>`;

  container_.querySelectorAll('.ami-tab').forEach(tab => {
    tab.onclick = () => setTab(tab.dataset.tab);
  });
}

function setTab(tab) {
  activeTab_ = tab;
  container_.querySelectorAll('.ami-tab').forEach(t => {
    const activa = t.dataset.tab === tab;
    t.classList.toggle('active', activa);
    t.classList.toggle('am', activa);
  });
  const cont = container_.querySelector('#ami-content');
  if (!cont) return;
  if (tab === 'mapa') {
    // Montar el mapa real (mismo módulo que usa el técnico)
    cont.innerHTML = '';
    import('./ami_mapa.js')
      .then(mod => mod.init(cont, session_))
      .catch(err => {
        cont.innerHTML = bloquePreparacion('No se pudo cargar el mapa', 'Intenta de nuevo en un momento.');
        console.warn('[ami] Error cargando ami_mapa:', err.message);
      });
  }
  else if (tab === 'ordenes') cont.innerHTML = renderOrdenes();
  else                     cont.innerHTML = renderPanel();
}

// ── Panel (resumen del área) ──────────────────────
function renderPanel() {
  const total = ordenes_.length;
  const hechas = ordenes_.filter(o => o.estadoCampo === 'hecha' || o.estadoCampo === 'aprobada').length;
  const pend = ordenes_.filter(o => !o.estadoCampo && !o._yaCambiada).length;
  const residuos = ordenes_.filter(esResiduo).length;
  const yaCambiadas = ordenes_.filter(o => o._yaCambiada).length;
  const pct = total ? Math.round((hechas / total) * 100) : 0;

  return `
    <div class="welcome-card am" style="border-color:${ACCENT_BORDER};background:${ACCENT_GLASS};border-radius:16px;padding:18px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <div style="width:10px;height:10px;border-radius:50%;background:${ACCENT}"></div>
        <div style="font-size:16px;font-weight:800;color:${ACCENT}">AMI · Medidores telegestionados</div>
      </div>
      <div style="font-size:12px;color:var(--text-3);line-height:1.5">
        Cambio de medidores remotos, en campaña separada. Las órdenes se identifican por NC.
      </div>
    </div>

    ${total === 0
      ? bloquePreparacion('Aún no hay órdenes cargadas',
          'Cuando se cargue el listado de órdenes de AMI, aquí verás el avance por cuadrilla y el estado del día, igual que en Cambios.')
      : `
      <div class="progress-card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
          <div style="font-size:13px;font-weight:700">Avance del día</div>
          <div style="font-size:12px;color:var(--text-4)">${hechas} de ${total} · ${pct}%</div>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width:${pct}%;background:${ACCENT}"></div>
        </div>
        <div class="progress-stats" style="margin-top:10px">
          <span><span class="stat-dot muted"></span>${pend} pendientes</span>
          <span><span class="stat-dot ok"></span>${hechas} hechas</span>
          ${residuos ? `<span><span class="stat-dot" style="background:#f59e0b"></span>${residuos} arrastradas</span>` : ''}
          ${yaCambiadas ? `<span><span class="stat-dot" style="background:#16a34a"></span>${yaCambiadas} ya cambiadas</span>` : ''}
        </div>
      </div>`}`;
}

// ── Órdenes (lista) ───────────────────────────────
function renderOrdenes() {
  if (!ordenes_.length) {
    return bloquePreparacion('Sin órdenes por ahora',
      'El listado de órdenes AMI se cargará más adelante. Cada orden se identificará por su NC (estos medidores no traen WO).');
  }
  const residuos = ordenes_.filter(esResiduo);
  const resto = ordenes_.filter(o => !esResiduo(o));

  const tarjeta = (o) => {
    const dias = diasArrastrada(o);
    const residuo = esResiduo(o);
    return `
      <div class="orden-card" style="flex-direction:column;align-items:stretch;cursor:default;border-left:3px solid ${o._yaCambiada ? '#16a34a' : residuo ? '#f59e0b' : ACCENT}">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div class="orden-wo" style="color:${ACCENT}">NC ${o.nc || '—'}</div>
          ${o.cliente ? `<div class="orden-cliente" style="flex:1;min-width:120px">${o.cliente}</div>` : '<div style="flex:1"></div>'}
          ${o._yaCambiada ? `<span class="estado-badge ok" style="background:rgba(22,163,74,.15);border-color:rgba(22,163,74,.4);color:#16a34a">Ya cambiada</span>` : ''}
          ${residuo && !o._yaCambiada ? `<span class="estado-badge warn">Arrastrada &middot; ${dias} d&iacute;a${dias>1?'s':''}</span>` : ''}
          <div class="estado-badge ${o.estadoCampo === 'hecha' || o.estadoCampo === 'aprobada' ? 'ok' : 'muted'}">${o.estadoCampo || 'pendiente'}</div>
        </div>
        ${o.direccion ? `<div class="orden-dir" style="margin-top:6px">${o.direccion}</div>` : ''}
      </div>`;
  };

  const seccion = (titulo, arr, color) => arr.length ? `
    <div style="display:flex;align-items:center;gap:8px;margin:14px 0 8px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:${color}">${titulo}</div>
      <div style="flex:1;height:1px;background:var(--border)"></div>
      <div style="font-size:11px;color:var(--text-4)">${arr.length}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">${arr.map(tarjeta).join('')}</div>` : '';

  return seccion('Arrastradas (rutas anteriores)', residuos, '#f59e0b')
       + seccion('Ruta actual', resto, ACCENT);
}

// ── Bloque "en preparación" reutilizable ──────────
function bloquePreparacion(titulo, texto) {
  return `
    <div style="text-align:center;padding:36px 20px;border:1px dashed var(--border);border-radius:16px;background:var(--glass)">
      <div style="width:48px;height:48px;border-radius:14px;background:${ACCENT_GLASS};display:flex;align-items:center;justify-content:center;margin:0 auto 14px">
        <svg viewBox="0 0 24 24" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.9 4.9l2.9 2.9"/><path d="M16.2 16.2l2.9 2.9"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.9 19.1l2.9-2.9"/><path d="M16.2 7.8l2.9-2.9"/></svg>
      </div>
      <div style="font-size:14px;font-weight:700;margin-bottom:6px">${titulo}</div>
      <div style="font-size:12px;color:var(--text-4);line-height:1.5;max-width:320px;margin:0 auto">${texto}</div>
    </div>`;
}
