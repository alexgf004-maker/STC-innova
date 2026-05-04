/**
 * js/views/cambios.js
 * Módulo Cambios de Medidor.
 * Exporta: init(container, session)
 *
 * Roles:
 *   admin / asistente → Panel de gestión + todas las parejas
 *   tecnico (CAMBIOS) → Solo su pareja
 */

import { db } from '../firebase.js';
import { toast } from '../ui.js';

// ── Caché ─────────────────────────────────────────
const cache = {
  ordenes:    { data: null, ts: 0, TTL: 2 * 60 * 1000 },
  calendario: { data: null, ts: 0, TTL: 30 * 60 * 1000 },
};

function cacheValid(key) {
  return cache[key].data && (Date.now() - cache[key].ts < cache[key].TTL);
}
function invalidateOrdenes() {
  cache.ordenes.data = null;
  cache.ordenes.ts   = 0;
}

// ── Constantes ────────────────────────────────────
const PAREJAS = ['Pareja 1', 'Pareja 2', 'Pareja 3', 'Pareja 4'];
const PAREJA_COLORS = {
  'Pareja 1': { accent: '#2dd4bf', glass: 'rgba(13,148,136,.12)', border: 'rgba(13,148,136,.25)' },
  'Pareja 2': { accent: '#60a5fa', glass: 'rgba(37,99,235,.12)',  border: 'rgba(37,99,235,.25)'  },
  'Pareja 3': { accent: '#a78bfa', glass: 'rgba(139,92,246,.12)', border: 'rgba(139,92,246,.25)' },
  'Pareja 4': { accent: '#fbbf24', glass: 'rgba(245,158,11,.12)', border: 'rgba(245,158,11,.25)' },
};

let container_, session_, role_, pareja_;
let ordenes = [], calendario = [];
let activeTab = 'panel'; // 'panel' | 'ordenes'
let selectedOrden = null;

// ── Entry point ───────────────────────────────────
export async function init(container, session) {
  container_ = container;
  session_   = session;
  role_      = session.role;
  pareja_    = session.asignacionActual?.destino || null;

  renderShell();
  await Promise.all([loadCalendario(), loadOrdenes()]);

  // Escuchar actualizaciones desde el mapa
  window.addEventListener('cambios:updated', () => {
    invalidateOrdenes();
    loadOrdenes();
  });
}

// ── Shell ─────────────────────────────────────────
function renderShell() {
  const isTecnico = role_ === 'tecnico';
  const tabs = isTecnico
    ? [{ id:'ordenes', label:'Órdenes' }, { id:'panel', label:'Resumen'  }, { id:'mapa', label:'Mapa' }]
    : [{ id:'panel',   label:'Panel'   }, { id:'ordenes', label:'Órdenes' }, { id:'mapa', label:'Mapa' }];

  container_.innerHTML = `
    <!-- Tabs -->
    <div class="cambios-tabs">
      ${tabs.map((t, i) => `
        <div class="cambios-tab ${i === 0 ? 'active' : ''}" data-tab="${t.id}">${t.label}</div>
      `).join('')}
      <div class="cambios-tab-indicator"></div>
    </div>

    <!-- Contenido del tab activo -->
    <div id="cambios-content" style="padding-top:12px">
      <div class="loading-placeholder">
        <div class="loading-bar"></div>
        <div class="loading-bar short"></div>
        <div class="loading-bar"></div>
      </div>
    </div>

    <!-- Sheet detalle orden -->
    <div class="sheet-backdrop" id="sheet-orden">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title" id="sheet-orden-title">Orden</div>
        <div class="sheet-body" id="sheet-orden-body"></div>
      </div>
    </div>

    <!-- Sheet nueva orden campo -->
    <div class="sheet-backdrop" id="sheet-campo">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Orden generada en campo</div>
        <div class="sheet-body">
          <div class="form-field">
            <div class="form-label">WO (Work Order) *</div>
            <input class="form-input" id="campo-wo" type="text" placeholder="Ej: 12345678"/>
          </div>
          <div class="form-field">
            <div class="form-label">NC (opcional)</div>
            <input class="form-input" id="campo-nc" type="text" placeholder="Número de cliente"/>
          </div>
          <div class="form-field">
            <div class="form-label">Observación</div>
            <input class="form-input" id="campo-obs" type="text" placeholder="Breve descripción"/>
          </div>
          <div id="campo-error" class="form-error"></div>
          <button class="btn-primary full" id="btn-guardar-campo">
            <span id="btn-campo-label">Registrar orden</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Sheet importar Excel (solo admin/asistente) -->
    ${!isTecnico ? `
    <div class="sheet-backdrop" id="sheet-import">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Importar órdenes</div>
        <div class="sheet-body">
          <div class="import-dropzone" id="import-dropzone">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="32" height="32" style="color:var(--text-4)">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
            <p>Toca para seleccionar archivo Excel</p>
            <span>.xlsx · .xls</span>
          </div>
          <input type="file" id="import-file" accept=".xlsx,.xls" style="display:none"/>
          <div id="import-preview" style="display:none">
            <div class="import-info" id="import-info"></div>
            <div id="import-error" class="form-error"></div>
            <button class="btn-primary full" id="btn-confirmar-import">
              <span id="btn-import-label">Importar órdenes</span>
            </button>
          </div>
        </div>
      </div>
    </div>` : ''}
  `;

  // Eventos tabs
  activeTab = tabs[0].id;
  document.querySelectorAll('.cambios-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.cambios-tab').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab = tab.dataset.tab;
      renderTab();
    });
  });

  // Cerrar sheets
  ['sheet-orden', 'sheet-campo', 'sheet-import'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', e => { if (e.target === el) closeSheet(id); });
  });

  // Orden en campo
  document.getElementById('btn-guardar-campo')?.addEventListener('click', guardarOrdenCampo);

  // Import Excel
  const dropzone = document.getElementById('import-dropzone');
  const fileInput = document.getElementById('import-file');
  dropzone?.addEventListener('click', () => fileInput.click());
  fileInput?.addEventListener('change', handleFileSelect);
  document.getElementById('btn-confirmar-import')?.addEventListener('click', confirmarImport);

  // Exponer para onclick
  window.__cambios = { verOrden, marcarHecha, marcarVisita, actualizadaDelsur, aprobar, rechazar, openCampo, openImport };
}

// ── Cargar datos ──────────────────────────────────
async function loadCalendario() {
  if (cacheValid('calendario')) return;
  try {
    const snap = await db.collection('cambios_calendario').get();
    calendario = snap.docs.map(d => d.data());
    cache.calendario.data = calendario;
    cache.calendario.ts   = Date.now();
  } catch (err) {
    console.warn('[cambios] Error cargando calendario:', err);
    calendario = [];
  }
}

async function loadOrdenes() {
  if (cacheValid('ordenes')) {
    ordenes = cache.ordenes.data;
    renderTab();
    return;
  }
  try {
    let query = db.collection('cambios_ordenes');
    // Técnico solo ve su pareja
    if (role_ === 'tecnico' && pareja_) {
      query = query.where('pareja', '==', pareja_);
    }
    const snap = await query.get();
    ordenes = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    cache.ordenes.data = ordenes;
    cache.ordenes.ts   = Date.now();
    renderTab();
  } catch (err) {
    console.error('[cambios] Error cargando órdenes:', err);
    document.getElementById('cambios-content').innerHTML = `
      <div class="dev-module">
        <div class="dev-title">Error al cargar órdenes</div>
        <p>Verifica tu conexión e intenta de nuevo.</p>
      </div>
    `;
  }
}

// ── Bloqueo por lectura ───────────────────────────
function isBlocked(orden) {
  if (!orden.unidadLectura || !calendario.length) return false;
  const hoy = new Date();
  return calendario.some(cal => {
    if (!orden.unidadLectura.startsWith(cal.mru)) return false;
    const fecha = cal.fechaLectura?.toDate ? cal.fechaLectura.toDate() : new Date(cal.fechaLectura);
    const diff  = Math.abs((fecha - hoy) / (1000 * 60 * 60 * 24));
    return diff <= 2;
  });
}

// ── Priorizar órdenes ─────────────────────────────
function priorizarOrdenes(lista) {
  const sinActualizar = lista.filter(o => o.estadoCampo === 'hecha' && !o.actualizadaDelsur);
  const hechas        = lista.filter(o => o.estadoCampo === 'hecha' && o.actualizadaDelsur);
  const visitas       = lista.filter(o => o.estadoCampo === 'visita');
  const pendientes    = lista.filter(o => !o.estadoCampo && !isBlocked(o));
  const bloqueadas    = lista.filter(o => !o.estadoCampo && isBlocked(o));
  return { sinActualizar, hechas, visitas, pendientes, bloqueadas };
}

// ── Render tab activo ─────────────────────────────
function renderTab() {
  if (activeTab === 'panel')   renderPanel();
  else if (activeTab === 'mapa') renderMapaTab();
  else renderOrdenes();
}

// ── Mapa dentro de Cambios ────────────────────────
async function renderMapaTab() {
  const content = document.getElementById('cambios-content');
  content.innerHTML = '<div style="height:calc(100vh - 180px);min-height:300px;" id="cambios-mapa-container"></div>';

  // Importar y renderizar módulo mapa
  try {
    const mapaModule = await import('./mapa.js');
    mapaModule.init(document.getElementById('cambios-mapa-container'), session_);
  } catch (err) {
    console.error('[cambios] Error cargando mapa:', err);
    content.innerHTML = `<div class="dev-module" style="margin-top:16px">
      <div class="dev-title">Error al cargar mapa</div>
      <p>${err.message}</p>
    </div>`;
  }
}

// ── PANEL (admin/asistente) ───────────────────────
function renderPanel() {
  const content = document.getElementById('cambios-content');
  const { sinActualizar, hechas, visitas, pendientes } = priorizarOrdenes(ordenes);
  const total = ordenes.length;

  // Stats globales
  const totalHechas    = hechas.length + sinActualizar.length;
  const totalPendientes = pendientes.length + visitas.length;
  const pct = total ? Math.round((totalHechas / total) * 100) : 0;

  content.innerHTML = `
    <div class="flex-col gap-12">

      <!-- Header con acciones -->
      <div class="panel-header anim-up">
        <div>
          <div class="section-title">Panel Cambios</div>
          <div class="section-sub">
            ${totalHechas} de ${total} realizadas · ${pct}%
          </div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="icon-btn" onclick="window.__cambios.openImport()" title="Importar Excel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
              <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
              <polyline points="17 8 12 3 7 8"/>
              <line x1="12" y1="3" x2="12" y2="15"/>
            </svg>
          </button>
        </div>
      </div>

      <!-- Barra de progreso global -->
      <div class="progress-card anim-up d1">
        <div class="progress-bar-bg">
          <div class="progress-bar-fill cm" style="width:${pct}%"></div>
        </div>
        <div class="progress-stats">
          <span><span class="stat-dot ok"></span>${totalHechas} realizadas</span>
          <span><span class="stat-dot warn"></span>${visitas.length} visitas</span>
          <span><span class="stat-dot muted"></span>${totalPendientes} pendientes</span>
        </div>
      </div>

      <!-- Sin actualizar (alerta) -->
      ${sinActualizar.length ? `
      <div class="alert-section anim-up d1">
        <div class="alert-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
            <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
          </svg>
          ${sinActualizar.length} sin actualizar en DELSUR
        </div>
        ${sinActualizar.map(o => renderOrdenCard(o, 'sin-actualizar')).join('')}
      </div>` : ''}

      <!-- Stats por pareja -->
      <div class="section-label anim-up d2">Por pareja</div>
      <div class="flex-col gap-8 anim-up d2">
        ${PAREJAS.map(p => renderParejaCard(p)).join('')}
      </div>

      <!-- Realizadas hoy -->
      ${hechas.length ? `
      <div class="section-label anim-up d3">Realizadas</div>
      <div class="flex-col gap-8 anim-up d3">
        ${hechas.map(o => renderOrdenCard(o, 'hecha')).join('')}
      </div>` : ''}

    </div>
  `;
}

function renderParejaCard(pareja) {
  const c = PAREJA_COLORS[pareja] || PAREJA_COLORS['Pareja 1'];
  const lista = ordenes.filter(o => o.pareja === pareja);
  if (!lista.length) return '';

  const hechas     = lista.filter(o => o.estadoCampo === 'hecha').length;
  const sinActual  = lista.filter(o => o.estadoCampo === 'hecha' && !o.actualizadaDelsur).length;
  const visitas    = lista.filter(o => o.estadoCampo === 'visita').length;
  const pendientes = lista.filter(o => !o.estadoCampo).length;
  const total      = lista.length;
  const pct        = total ? Math.round((hechas / total) * 100) : 0;

  return `
    <div class="pareja-card" style="border-color:${c.border};background:${c.glass}">
      <div class="pareja-card-header">
        <div class="pareja-name" style="color:${c.accent}">${pareja}</div>
        <div class="pareja-pct" style="color:${c.accent}">${pct}%</div>
      </div>
      <div class="progress-bar-bg" style="margin:8px 0">
        <div class="progress-bar-fill" style="width:${pct}%;background:${c.accent}"></div>
      </div>
      <div class="pareja-stats">
        <span>${hechas}/${total} hechas</span>
        ${sinActual ? `<span style="color:#f87171">· ${sinActual} sin actualizar</span>` : ''}
        ${visitas   ? `<span style="color:#fbbf24">· ${visitas} visitas</span>` : ''}
        ${pendientes? `<span style="color:var(--text-4)">· ${pendientes} pendientes</span>` : ''}
      </div>
    </div>
  `;
}

// ── ÓRDENES (técnico y admin) ─────────────────────
function renderOrdenes() {
  const content = document.getElementById('cambios-content');
  const lista   = role_ === 'tecnico' ? ordenes.filter(o => o.pareja === pareja_) : ordenes;
  const { sinActualizar, hechas, visitas, pendientes, bloqueadas } = priorizarOrdenes(lista);

  const isTecnico = role_ === 'tecnico';

  content.innerHTML = `
    <div class="flex-col gap-12">

      <!-- Header -->
      <div class="panel-header anim-up">
        <div>
          <div class="section-title">${isTecnico ? (pareja_ || 'Mis órdenes') : 'Todas las órdenes'}</div>
          <div class="section-sub">${lista.length} órdenes · ${hechas.length + sinActualizar.length} realizadas</div>
        </div>
        <button class="icon-btn cm" onclick="window.__cambios.openCampo()" title="Orden en campo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      ${!lista.length ? `
        <div class="dev-module">
          <div class="dev-title">Sin órdenes</div>
          <p>No hay órdenes asignadas para ${pareja_ || 'esta vista'}.</p>
        </div>` : ''}

      <!-- Sin actualizar -->
      ${sinActualizar.length ? renderGrupo('⚠ Sin actualizar en DELSUR', sinActualizar, 'sin-actualizar', 'd1') : ''}

      <!-- Visitas -->
      ${visitas.length ? renderGrupo('Visitas registradas', visitas, 'visita', 'd2') : ''}

      <!-- Pendientes -->
      ${pendientes.length ? renderGrupo('Pendientes', pendientes, 'pendiente', 'd2') : ''}

      <!-- Hechas -->
      ${hechas.length ? renderGrupo('Realizadas', hechas, 'hecha', 'd3') : ''}

      <!-- Bloqueadas -->
      ${bloqueadas.length ? renderGrupo('🔒 Bloqueadas por lectura', bloqueadas, 'bloqueada', 'd4') : ''}

    </div>
  `;
}

function renderGrupo(titulo, lista, tipo, delay) {
  return `
    <div class="anim-up ${delay}">
      <div class="section-label" style="margin-bottom:8px">${titulo}</div>
      <div class="flex-col gap-8">
        ${lista.map(o => renderOrdenCard(o, tipo)).join('')}
      </div>
    </div>
  `;
}

function renderOrdenCard(o, tipo) {
  const blocked  = tipo === 'bloqueada';
  const c        = PAREJA_COLORS[o.pareja] || PAREJA_COLORS['Pareja 1'];
  const isTecnico = role_ === 'tecnico';

  // Íconos de estado
  const statusIcon = {
    'hecha':         `<div class="status-dot ok"></div>`,
    'sin-actualizar':`<div class="status-dot warn pulse"></div>`,
    'visita':        `<div class="status-dot warn"></div>`,
    'pendiente':     `<div class="status-dot muted"></div>`,
    'bloqueada':     `<div class="status-dot muted"></div>`,
  }[tipo] || `<div class="status-dot muted"></div>`;

  return `
    <div class="orden-card ${tipo}" onclick="window.__cambios.verOrden('${o.id}')">
      <div class="orden-card-left">
        ${statusIcon}
        <div class="orden-info">
          <div class="orden-wo">WO ${o.wo || '—'}</div>
          ${blocked ? `
            <div class="orden-bloqueada-label">Bloqueada por lectura</div>
          ` : `
            <div class="orden-cliente">${o.cliente || '—'}</div>
            <div class="orden-dir">${o.direccion || ''}</div>
          `}
        </div>
      </div>
      <div class="orden-card-right">
        ${!isTecnico && o.pareja ? `<div class="pareja-chip" style="color:${c.accent};border-color:${c.border};background:${c.glass}">${o.pareja.replace('Pareja ','P')}</div>` : ''}
        ${tipo === 'sin-actualizar' && isTecnico ? `
          <button class="action-chip warn" onclick="event.stopPropagation();window.__cambios.actualizadaDelsur('${o.id}')">Ya actualicé</button>
        ` : ''}
        ${tipo === 'sin-actualizar' && !isTecnico ? `
          <div style="display:flex;gap:4px">
            <button class="action-chip ok" onclick="event.stopPropagation();window.__cambios.aprobar('${o.id}')">✓</button>
            <button class="action-chip danger" onclick="event.stopPropagation();window.__cambios.rechazar('${o.id}')">✕</button>
          </div>
        ` : ''}
      </div>
    </div>
  `;
}

// ── Ver detalle de orden ──────────────────────────
function verOrden(id) {
  const o = ordenes.find(x => x.id === id);
  if (!o) return;
  selectedOrden = o;

  const blocked   = isBlocked(o);
  const isTecnico = role_ === 'tecnico';
  const c         = PAREJA_COLORS[o.pareja] || PAREJA_COLORS['Pareja 1'];

  document.getElementById('sheet-orden-title').textContent = `WO ${o.wo || '—'}`;

  document.getElementById('sheet-orden-body').innerHTML = `
    <div class="flex-col gap-12">

      <!-- Estado -->
      <div class="orden-estado-row">
        ${o.estadoCampo === 'hecha'  ? `<div class="estado-badge ok">Realizada</div>` : ''}
        ${o.estadoCampo === 'visita' ? `<div class="estado-badge warn">Visita registrada</div>` : ''}
        ${!o.estadoCampo             ? `<div class="estado-badge muted">Pendiente</div>` : ''}
        ${blocked                    ? `<div class="estado-badge crit">🔒 Bloqueada</div>` : ''}
        ${o.actualizadaDelsur        ? `<div class="estado-badge ok-outline">✓ Actualizada DELSUR</div>` : ''}
        ${o.pareja ? `<div class="estado-badge" style="color:${c.accent};border-color:${c.border};background:${c.glass}">${o.pareja}</div>` : ''}
      </div>

      ${blocked ? `
        <div class="card" style="background:rgba(239,68,68,.06);border-color:rgba(239,68,68,.2)">
          <p style="font-size:12px;color:#f87171">Esta orden está bloqueada por lectura programada. No se puede trabajar en este momento.</p>
        </div>` : ''}

      <!-- Info cliente -->
      ${!blocked ? `
      <div class="detail-section">
        <div class="detail-label">Cliente</div>
        <div class="detail-row">
          <div class="detail-field"><div class="detail-key">NC</div><div class="detail-val">${o.nc || '—'}</div></div>
          <div class="detail-field"><div class="detail-key">Nombre</div><div class="detail-val">${o.cliente || '—'}</div></div>
        </div>
        <div class="detail-field full"><div class="detail-key">Dirección</div><div class="detail-val">${o.direccion || '—'}</div></div>
        ${o.telefono ? `<div class="detail-field full"><div class="detail-key">Teléfono</div><div class="detail-val">
          <a href="tel:${o.telefono}" style="color:var(--cm-light)">${o.telefono}</a>
        </div></div>` : ''}
      </div>

      <!-- Info técnica -->
      <div class="detail-section">
        <div class="detail-label">Datos técnicos</div>
        <div class="detail-row">
          <div class="detail-field"><div class="detail-key">Serie</div><div class="detail-val">${o.serie || '—'}</div></div>
          <div class="detail-field"><div class="detail-key">DSCT</div><div class="detail-val">${o.dsct || '—'}</div></div>
          <div class="detail-field"><div class="detail-key">MRU</div><div class="detail-val">${o.unidadLectura || '—'}</div></div>
        </div>
        ${o.concepto ? `<div class="detail-field full"><div class="detail-key">Concepto</div><div class="detail-val">${o.concepto}</div></div>` : ''}
      </div>` : ''}

      <!-- Historial -->
      ${(o.fechaHecha || o.fechaVisita) ? `
      <div class="detail-section">
        <div class="detail-label">Historial</div>
        ${o.fechaHecha  ? `<div class="detail-field full"><div class="detail-key">Realizada</div><div class="detail-val">${formatDate(o.fechaHecha)} · ${o.hechaPor || '—'}</div></div>` : ''}
        ${o.fechaVisita ? `<div class="detail-field full"><div class="detail-key">Visita</div><div class="detail-val">${formatDate(o.fechaVisita)} · ${o.visitadoPor || '—'}</div></div>` : ''}
        ${o.aprobadoPor ? `<div class="detail-field full"><div class="detail-key">Aprobada por</div><div class="detail-val">${o.aprobadoPor}</div></div>` : ''}
      </div>` : ''}

      <!-- Acciones técnico -->
      ${isTecnico && !blocked ? `
      <div class="flex-col gap-8">
        ${!o.estadoCampo || o.estadoCampo === 'visita' ? `
          <button class="btn-action cm" onclick="window.__cambios.marcarHecha('${o.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            Marcar como realizada
          </button>` : ''}
        ${!o.estadoCampo ? `
          <button class="btn-action outline" onclick="window.__cambios.marcarVisita('${o.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Registrar visita
          </button>` : ''}
        ${o.estadoCampo === 'hecha' && !o.actualizadaDelsur ? `
          <button class="btn-action warn" onclick="window.__cambios.actualizadaDelsur('${o.id}')">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><polyline points="23 4 23 10 17 10"/><polyline points="1 20 1 14 7 14"/><path d="M3.51 9a9 9 0 0114.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0020.49 15"/></svg>
            Ya actualicé en DELSUR
          </button>` : ''}
      </div>` : ''}

      <!-- Acciones admin/asistente -->
      ${!isTecnico && o.estadoCampo === 'hecha' && !o.actualizadaDelsur ? `
      <div class="flex-col gap-8">
        <button class="btn-action cm" onclick="window.__cambios.aprobar('${o.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Confirmar actualización
        </button>
        <button class="btn-action danger" onclick="window.__cambios.rechazar('${o.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          Rechazar
        </button>
      </div>` : ''}

    </div>
  `;

  openSheet('sheet-orden');
}

// ── Acciones ──────────────────────────────────────
async function marcarHecha(id) {
  const now = firebase.firestore.Timestamp.now();
  await updateOrden(id, {
    estadoCampo:      'hecha',
    fechaHecha:       now,
    hechaPor:         session_.displayName,
    actualizadaDelsur: false,
  }, 'Orden marcada como realizada');
}

async function marcarVisita(id) {
  const now = firebase.firestore.Timestamp.now();
  await updateOrden(id, {
    estadoCampo: 'visita',
    fechaVisita: now,
    visitadoPor: session_.displayName,
  }, 'Visita registrada');
}

async function actualizadaDelsur(id) {
  await updateOrden(id, {
    actualizadaDelsur: true,
  }, 'Actualización registrada');
}

async function aprobar(id) {
  const now = firebase.firestore.Timestamp.now();
  await updateOrden(id, {
    estadoCampo:      'aprobada',
    actualizadaDelsur: true,
    aprobadoPor:      session_.displayName,
    fechaAprobacion:  now,
  }, 'Orden aprobada');
}

async function rechazar(id) {
  if (!confirm('¿Rechazar la actualización? La orden volverá a estado "hecha sin actualizar".')) return;
  await updateOrden(id, {
    actualizadaDelsur: false,
    estadoCampo:      'hecha',
  }, 'Orden rechazada — pendiente de actualizar');
}

async function updateOrden(id, data, msg) {
  try {
    await db.collection('cambios_ordenes').doc(id).update(data);

    const idx = ordenes.findIndex(o => o.id === id);
    if (idx !== -1) ordenes[idx] = { ...ordenes[idx], ...data };
    invalidateOrdenes();

    closeSheet('sheet-orden');
    renderTab();
    window.dispatchEvent(new CustomEvent('cambios:updated'));
    toast(msg, 'ok');
  } catch (err) {
    console.error('[cambios] Error actualizando:', err);
    toast('Error al guardar', 'error');
  }
}

// ── Orden en campo ────────────────────────────────
function openCampo() { openSheet('sheet-campo'); }

async function guardarOrdenCampo() {
  const wo  = document.getElementById('campo-wo').value.trim();
  const nc  = document.getElementById('campo-nc').value.trim();
  const obs = document.getElementById('campo-obs').value.trim();
  const errEl = document.getElementById('campo-error');

  errEl.style.display = 'none';
  if (!wo) {
    errEl.textContent = 'El número WO es obligatorio.';
    errEl.style.display = 'block';
    return;
  }

  setLoading('btn-campo-label', 'Registrando…', true);
  try {
    const data = {
      wo,
      nc:             nc || null,
      observacion:    obs || null,
      pareja:         pareja_,
      estadoCampo:    'hecha',
      actualizadaDelsur: false,
      generadaEnCampo: true,
      generadaPor:    session_.displayName,
      fechaHecha:     firebase.firestore.Timestamp.now(),
      hechaPor:       session_.displayName,
    };
    const ref = await db.collection('cambios_ordenes').add(data);
    ordenes.push({ id: ref.id, ...data });
    invalidateOrdenes();

    closeSheet('sheet-campo');
    document.getElementById('campo-wo').value  = '';
    document.getElementById('campo-nc').value  = '';
    document.getElementById('campo-obs').value = '';
    renderTab();
    toast('Orden registrada', 'ok');
  } catch (err) {
    console.error('[cambios] Error orden campo:', err);
    errEl.textContent = 'Error al registrar. Intenta de nuevo.';
    errEl.style.display = 'block';
  } finally {
    setLoading('btn-campo-label', 'Registrar orden', false);
  }
}

// ── Import Excel ──────────────────────────────────
let importData = [];

function openImport() { openSheet('sheet-import'); }

function handleFileSelect(e) {
  const file = e.target.files[0];
  if (!file) return;

  const reader = new FileReader();
  reader.onload = evt => {
    try {
      const wb   = XLSX.read(evt.target.result, { type: 'binary' });
      const ws   = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(ws, { header: 1, defval: '' });

      if (rows.length < 2) {
        document.getElementById('import-error').textContent = 'El archivo está vacío.';
        document.getElementById('import-error').style.display = 'block';
        return;
      }

      // Mapear columnas: WO, NC, Cliente, Dirección, Latitud, Longitud, Serie, DS, MRU, Concepto, Teléfono
      const headers = rows[0].map(h => String(h).toLowerCase().trim());
      const colIdx  = {
        wo:        findCol(headers, ['wo', 'work order', 'orden']),
        nc:        findCol(headers, ['nc', 'número cliente', 'num cliente']),
        cliente:   findCol(headers, ['cliente', 'nombre']),
        direccion: findCol(headers, ['dirección', 'direccion', 'dir']),
        latitud:   findCol(headers, ['latitud', 'lat']),
        longitud:  findCol(headers, ['longitud', 'lng', 'lon']),
        serie:     findCol(headers, ['serie']),
        dsct:      findCol(headers, ['ds', 'dsct', 'descuento']),
        unidadLectura: findCol(headers, ['mru', 'unidad lectura']),
        concepto:  findCol(headers, ['concepto']),
        telefono:  findCol(headers, ['teléfono', 'telefono', 'tel']),
      };

      importData = rows.slice(1)
        .filter(r => r[colIdx.wo])
        .map(r => ({
          wo:           String(r[colIdx.wo]  ?? '').trim(),
          nc:           String(r[colIdx.nc]  ?? '').trim(),
          cliente:      String(r[colIdx.cliente] ?? '').trim(),
          direccion:    String(r[colIdx.direccion] ?? '').trim(),
          latitud:      parseFloat(r[colIdx.latitud])  || null,
          longitud:     parseFloat(r[colIdx.longitud]) || null,
          serie:        String(r[colIdx.serie]    ?? '').trim(),
          dsct:         String(r[colIdx.dsct]     ?? '').trim(),
          unidadLectura:String(r[colIdx.unidadLectura] ?? '').trim(),
          concepto:     String(r[colIdx.concepto] ?? '').trim(),
          telefono:     String(r[colIdx.telefono] ?? '').trim(),
          pareja:       null,
          estadoCampo:  null,
          actualizadaDelsur: false,
          generadaEnCampo:   false,
        }));

      document.getElementById('import-info').innerHTML = `
        <div class="import-info-box">
          <div class="import-info-num">${importData.length}</div>
          <div class="import-info-label">órdenes encontradas en el archivo</div>
          <div style="font-size:11px;color:var(--text-4);margin-top:4px">${file.name}</div>
        </div>
      `;
      document.getElementById('import-preview').style.display = '';
      document.getElementById('import-error').style.display   = 'none';

    } catch (err) {
      console.error('[cambios] Error leyendo Excel:', err);
      document.getElementById('import-error').textContent = 'Error al leer el archivo. Verifica que sea un Excel válido.';
      document.getElementById('import-error').style.display = 'block';
    }
  };
  reader.readAsBinaryString(file);
}

function findCol(headers, options) {
  for (const opt of options) {
    const idx = headers.findIndex(h => h.includes(opt));
    if (idx !== -1) return idx;
  }
  return -1;
}

async function confirmarImport() {
  if (!importData.length) return;
  setLoading('btn-import-label', 'Importando…', true);

  try {
    // Batch write (máx 500 por batch)
    const batches = [];
    let batch = db.batch();
    let count = 0;

    for (const orden of importData) {
      const ref = db.collection('cambios_ordenes').doc();
      batch.set(ref, orden);
      count++;
      if (count === 499) {
        batches.push(batch.commit());
        batch = db.batch();
        count = 0;
      }
    }
    if (count > 0) batches.push(batch.commit());
    await Promise.all(batches);

    invalidateOrdenes();
    closeSheet('sheet-import');
    await loadOrdenes();
    toast(`${importData.length} órdenes importadas`, 'ok');
    importData = [];
  } catch (err) {
    console.error('[cambios] Error importando:', err);
    document.getElementById('import-error').textContent = 'Error al importar. Intenta de nuevo.';
    document.getElementById('import-error').style.display = 'block';
  } finally {
    setLoading('btn-import-label', 'Importar órdenes', false);
  }
}

// ── Helpers ───────────────────────────────────────
function openSheet(id)  { document.getElementById(id)?.classList.add('open'); }
function closeSheet(id) { document.getElementById(id)?.classList.remove('open'); }

function setLoading(labelId, text, loading) {
  const el = document.getElementById(labelId);
  if (!el) return;
  el.innerHTML = loading ? '<div class="spinner"></div>' : text;
  const btn = el.closest('button');
  if (btn) btn.disabled = loading;
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-SV', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}
