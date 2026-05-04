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
  window.__cambios = { verOrden, marcarHecha, marcarVisita, actualizadaDelsur, aprobar, rechazar, openCampo, openImport, toggleAcordeon };
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

  // Stats globales
  const todasHechas   = ordenes.filter(o => o.estadoCampo === 'hecha');
  const todasVisitas  = ordenes.filter(o => o.estadoCampo === 'visita');
  const todasAprobadas= ordenes.filter(o => o.estadoCampo === 'aprobada');
  const pendientes    = ordenes.filter(o => !o.estadoCampo);
  const total         = ordenes.length;
  const pct = total ? Math.round((todasAprobadas.length / total) * 100) : 0;

  content.innerHTML = `
    <div class="flex-col gap-12">

      <!-- Header -->
      <div class="panel-header anim-up">
        <div>
          <div class="section-title">Panel Cambios</div>
          <div class="section-sub">${todasAprobadas.length} confirmadas · ${todasHechas.length} por verificar · ${pendientes.length} pendientes</div>
        </div>
        <button class="icon-btn" onclick="window.__cambios.openImport()" title="Importar Excel">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/>
            <polyline points="17 8 12 3 7 8"/>
            <line x1="12" y1="3" x2="12" y2="15"/>
          </svg>
        </button>
      </div>

      <!-- Barra progreso global -->
      <div class="progress-card anim-up d1">
        <div class="progress-bar-bg">
          <div class="progress-bar-fill cm" style="width:${pct}%"></div>
        </div>
        <div class="progress-stats">
          <span><span class="stat-dot ok"></span>${todasAprobadas.length} confirmadas</span>
          <span><span class="stat-dot warn" style="background:#fbbf24"></span>${todasHechas.length} por verificar</span>
          <span><span class="stat-dot" style="background:#111827;border:1px solid #4b5563"></span>${todasVisitas.length} visitas</span>
          <span><span class="stat-dot muted"></span>${pendientes.length} pendientes</span>
        </div>
      </div>

      <!-- Acordeón por pareja -->
      <div class="section-label anim-up d2">Verificación por pareja</div>
      <div class="flex-col gap-8 anim-up d2" id="acordeon-parejas">
        ${PAREJAS.map(p => renderAcordeonPareja(p)).join('')}
      </div>

    </div>
  `;

  // Inicializar búsquedas
  PAREJAS.forEach(p => {
    const inputId = `buscar-${p.replace(' ','-')}`;
    document.getElementById(inputId)?.addEventListener('input', e => {
      filtrarOrdenesPareja(p, e.target.value.trim());
    });
  });
}

function renderAcordeonPareja(pareja) {
  const c         = PAREJA_COLORS[pareja] || PAREJA_COLORS['Pareja 1'];
  const hechas    = ordenes.filter(o => o.pareja === pareja && o.estadoCampo === 'hecha');
  const visitas   = ordenes.filter(o => o.pareja === pareja && o.estadoCampo === 'visita');
  const aprobadas = ordenes.filter(o => o.pareja === pareja && o.estadoCampo === 'aprobada');
  const total     = ordenes.filter(o => o.pareja === pareja).length;
  const inputId   = `buscar-${pareja.replace(' ','-')}`;
  const listaId   = `lista-${pareja.replace(' ','-')}`;

  if (!total) return '';

  // Agrupar hechas por fecha
  const hechasPorFecha = agruparPorFecha(hechas);

  return `
    <div class="acordeon-card" style="border-color:${c.border};background:${c.glass}">

      <!-- Header acordeón -->
      <div class="acordeon-header" onclick="window.__cambios.toggleAcordeon('${pareja}')">
        <div>
          <div class="acordeon-title" style="color:${c.accent}">${pareja}</div>
          <div class="acordeon-sub">
            ${aprobadas.length}/${total} confirmadas
            ${hechas.length ? `· <span style="color:#fbbf24">${hechas.length} por verificar</span>` : ''}
            ${visitas.length ? `· <span style="color:var(--text-4)">${visitas.length} visitas</span>` : ''}
          </div>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <div class="acordeon-pct" style="color:${c.accent}">
            ${total ? Math.round((aprobadas.length/total)*100) : 0}%
          </div>
          <svg id="chevron-${pareja.replace(' ','-')}" viewBox="0 0 24 24" fill="none" stroke="${c.accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="transition:transform .2s">
            <polyline points="6 9 12 15 18 9"/>
          </svg>
        </div>
      </div>

      <!-- Contenido acordeón -->
      <div class="acordeon-body" id="body-${pareja.replace(' ','-')}" style="display:none">

        <!-- Barra progreso pareja -->
        <div class="progress-bar-bg" style="margin-bottom:12px">
          <div class="progress-bar-fill" style="width:${total ? Math.round((aprobadas.length/total)*100) : 0}%;background:${c.accent}"></div>
        </div>

        <!-- Buscador -->
        ${hechas.length ? `
        <div class="buscar-wrap">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="color:var(--text-4);flex-shrink:0">
            <circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>
          </svg>
          <input class="buscar-input" id="${inputId}" type="text"
                 placeholder="Buscar WO o cliente…"
                 autocomplete="off" autocorrect="off"/>
        </div>` : ''}

        <!-- Órdenes por verificar agrupadas por fecha -->
        ${hechas.length ? `
        <div class="flex-col gap-10" id="${listaId}">
          ${hechasPorFecha.map(({ fecha, ordenes: grupo }) => `
            <div>
              <div class="fecha-grupo-label">${fecha}</div>
              <div class="flex-col gap-6">
                ${grupo.map(o => renderOrdenVerificacion(o, c)).join('')}
              </div>
            </div>
          `).join('')}
        </div>` : `
        <div style="text-align:center;padding:12px 0;font-size:12px;color:var(--text-4)">
          ${aprobadas.length ? '✓ Todas confirmadas' : 'Sin órdenes realizadas aún'}
        </div>`}

        <!-- Visitas -->
        ${visitas.length ? `
        <div class="section-label" style="margin:12px 0 6px;font-size:8px">Visitas registradas</div>
        <div class="flex-col gap-6">
          ${visitas.map(o => renderOrdenVisitaPanel(o)).join('')}
        </div>` : ''}

      </div>
    </div>
  `;
}

function renderOrdenVerificacion(o, c) {
  return `
    <div class="orden-verif-card" id="verif-${o.id}">
      <div class="orden-verif-info" onclick="window.__cambios.verOrden('${o.id}')">
        <div class="orden-wo" style="font-size:12px">WO ${o.wo || '—'}</div>
        <div class="orden-cliente" style="font-size:10px">${o.cliente || '—'}</div>
        ${o.actualizadaDelsur
          ? '<div style="font-size:9px;color:var(--ok);margin-top:2px">✓ Actualizada en DELSUR</div>'
          : '<div style="font-size:9px;color:#fbbf24;margin-top:2px">⚠ Pendiente actualizar DELSUR</div>'}
      </div>
      <button class="btn-confirmar-orden" onclick="window.__cambios.aprobar('${o.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
          <path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>
        </svg>
        Confirmar
      </button>
    </div>
  `;
}

function renderOrdenVisitaPanel(o) {
  return `
    <div class="orden-visita-panel" onclick="window.__cambios.verOrden('${o.id}')">
      <div class="status-dot" style="background:#111827;border:1px solid #4b5563;flex-shrink:0"></div>
      <div style="flex:1;min-width:0">
        <div style="font-size:12px;font-weight:700">WO ${o.wo || '—'}</div>
        <div style="font-size:10px;color:var(--text-3)">${o.motivoVisita || 'Sin motivo registrado'}</div>
      </div>
    </div>
  `;
}

// ── Agrupar por fecha ─────────────────────────────
function agruparPorFecha(lista) {
  const grupos = {};
  const hoy    = new Date();
  const ayer   = new Date(hoy); ayer.setDate(ayer.getDate() - 1);

  lista.forEach(o => {
    const ts = o.fechaHecha?.toDate ? o.fechaHecha.toDate() : null;
    let etiqueta = 'Sin fecha';
    if (ts) {
      const d = ts.toLocaleDateString('es-SV', { weekday:'long', day:'2-digit', month:'short' });
      if (ts.toDateString() === hoy.toDateString())  etiqueta = `Hoy · ${d}`;
      else if (ts.toDateString() === ayer.toDateString()) etiqueta = `Ayer · ${d}`;
      else etiqueta = d.charAt(0).toUpperCase() + d.slice(1);
    }
    if (!grupos[etiqueta]) grupos[etiqueta] = [];
    grupos[etiqueta].push(o);
  });

  // Ordenar: Hoy primero, luego Ayer, luego más antiguas
  return Object.entries(grupos)
    .sort(([a], [b]) => {
      if (a.startsWith('Hoy'))  return -1;
      if (b.startsWith('Hoy'))  return 1;
      if (a.startsWith('Ayer')) return -1;
      if (b.startsWith('Ayer')) return 1;
      return 0;
    })
    .map(([fecha, ordenes]) => ({ fecha, ordenes }));
}
function toggleAcordeon(pareja) {
  const key    = pareja.replace(' ', '-');
  const body   = document.getElementById(`body-${key}`);
  const chevron= document.getElementById(`chevron-${key}`);
  if (!body) return;
  const open = body.style.display === 'none';
  body.style.display    = open ? '' : 'none';
  if (chevron) chevron.style.transform = open ? 'rotate(180deg)' : '';
}

// ── Filtrar órdenes por WO/cliente ───────────────
function filtrarOrdenesPareja(pareja, query) {
  const listaId = `lista-${pareja.replace(' ','-')}`;
  const lista   = document.getElementById(listaId);
  if (!lista) return;

  const hechas = ordenes.filter(o => o.pareja === pareja && o.estadoCampo === 'hecha');
  const c      = PAREJA_COLORS[pareja] || PAREJA_COLORS['Pareja 1'];

  const filtradas = query
    ? hechas.filter(o =>
        (o.wo      || '').toLowerCase().includes(query.toLowerCase()) ||
        (o.cliente || '').toLowerCase().includes(query.toLowerCase())
      )
    : hechas;

  if (!filtradas.length) {
    lista.innerHTML = `<div style="text-align:center;padding:8px;font-size:11px;color:var(--text-4)">Sin resultados</div>`;
    return;
  }

  // Mantener agrupación por fecha si no hay búsqueda activa
  if (!query) {
    const grupos = agruparPorFecha(filtradas);
    lista.innerHTML = grupos.map(({ fecha, ordenes: grupo }) => `
      <div>
        <div class="fecha-grupo-label">${fecha}</div>
        <div class="flex-col gap-6">
          ${grupo.map(o => renderOrdenVerificacion(o, c)).join('')}
        </div>
      </div>
    `).join('');
  } else {
    lista.innerHTML = `<div class="flex-col gap-6">${filtradas.map(o => renderOrdenVerificacion(o, c)).join('')}</div>`;
  }
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
        ${(tipo === 'sin-actualizar' || tipo === 'hecha') && !isTecnico ? `
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
        ${o.parejaDelDia?.length > 1 ? `<div class="detail-field full"><div class="detail-key">Trabajaron ese día</div><div class="detail-val">${o.parejaDelDia.join(' · ')}</div></div>` : ''}
        ${o.fechaVisita ? `<div class="detail-field full"><div class="detail-key">Visita</div><div class="detail-val">${formatDate(o.fechaVisita)} · ${o.visitadoPor || '—'}</div></div>` : ''}
        ${o.aprobadoPor ? `<div class="detail-field full"><div class="detail-key">Confirmada por</div><div class="detail-val">${o.aprobadoPor}</div></div>` : ''}
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
      ${!isTecnico && o.estadoCampo === 'hecha' ? `
      <div class="flex-col gap-8">
        <button class="btn-action cm" onclick="window.__cambios.aprobar('${o.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Confirmar realizada
        </button>
        <button class="btn-action danger" onclick="window.__cambios.rechazar('${o.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          Rechazar — volver a pendiente
        </button>
      </div>` : ''}

    </div>
  `;

  openSheet('sheet-orden');
}

// ── Acciones ──────────────────────────────────────
async function marcarHecha(id) {
  const now = firebase.firestore.Timestamp.now();

  // Buscar compañeros con el mismo destino hoy
  let parejaDelDia = [session_.displayName];
  try {
    const destino = session_.asignacion?.destino || session_.asignacionActual?.destino;
    if (destino) {
      const snap = await db.collection('users')
        .where('asignacionActual.destino', '==', destino)
        .where('active', '==', true)
        .get();
      parejaDelDia = snap.docs.map(d => d.data().displayName);
    }
  } catch { /* sin conexión — usar solo nombre propio */ }

  await updateOrden(id, {
    estadoCampo:       'hecha',
    fechaHecha:        now,
    hechaPor:          session_.displayName,
    actualizadaDelsur: false,
    parejaDelDia,
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
  try {
    await db.collection('cambios_ordenes').doc(id).update({
      estadoCampo:       'aprobada',
      actualizadaDelsur:  true,
      aprobadoPor:       session_.displayName,
      fechaAprobacion:   now,
    });
    const idx = ordenes.findIndex(o => o.id === id);
    if (idx !== -1) ordenes[idx] = { ...ordenes[idx], estadoCampo: 'aprobada', actualizadaDelsur: true, aprobadoPor: session_.displayName };
    invalidateOrdenes();

    // Quitar card del acordeón sin recargar todo el panel
    const card = document.getElementById(`verif-${id}`);
    if (card) {
      card.style.transition = 'opacity .2s, transform .2s';
      card.style.opacity = '0';
      card.style.transform = 'translateX(20px)';
      setTimeout(() => {
        card.remove();
        // Actualizar subtítulo del acordeón
        renderPanel();
      }, 200);
    } else {
      closeSheet('sheet-orden');
      renderTab();
    }

    window.dispatchEvent(new CustomEvent('cambios:updated'));
    toast('Orden confirmada', 'ok');
  } catch (err) {
    console.error('[cambios] Error aprobando:', err);
    toast('Error al confirmar', 'error');
  }
}

async function rechazar(id) {
  if (!confirm('¿Rechazar esta orden? Volverá a pendiente para que el técnico la ejecute nuevamente.')) return;
  await updateOrden(id, {
    estadoCampo:       null,
    actualizadaDelsur: false,
    fechaHecha:        null,
    hechaPor:          null,
  }, 'Orden rechazada — regresa a pendiente');
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
