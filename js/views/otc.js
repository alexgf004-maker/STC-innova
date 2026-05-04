/**
 * js/views/otc.js
 * Módulo OTC — Órdenes Técnicas de Campo.
 * Exporta: init(container, session)
 */

import { db } from '../firebase.js';
import { toast } from '../ui.js';

// ── Constantes ────────────────────────────────────
const TECNICOS = ['NALVAR', 'RGONZA', 'JPEREZ'];
const TECNICO_COLORS = {
  'NALVAR': { accent: '#60a5fa', glass: 'rgba(37,99,235,.12)',  border: 'rgba(37,99,235,.25)'  },
  'RGONZA': { accent: '#a78bfa', glass: 'rgba(139,92,246,.12)', border: 'rgba(139,92,246,.25)' },
  'JPEREZ': { accent: '#34d399', glass: 'rgba(16,185,129,.12)', border: 'rgba(16,185,129,.25)' },
  null:     { accent: '#6b7280', glass: 'rgba(107,114,128,.08)', border: 'rgba(107,114,128,.2)' },
};

const TIPO_LABELS = {
  servicio_nuevo:  'Servicio nuevo',
  cambio_voltaje:  'Cambio voltaje',
  reconexion:      'Reconexión',
  desconexion:     'Desconexión',
  anomalia:        'Anomalía',
};

const TIPO_COLORS = {
  reconexion:     '#ef4444',
  servicio_nuevo: '#f59e0b',
  cambio_voltaje: '#f59e0b',
  desconexion:    '#6b7280',
  anomalia:       '#6b7280',
};

// Asuetos nacionales El Salvador (MM-DD)
const ASUETOS = new Set([
  '01-01', // Año Nuevo
  '04-10', '04-11', '04-12', // Semana Santa (variables — aproximación fija)
  '05-01', // Día del Trabajo
  '08-06', // Fiestas Agostinas
  '09-15', // Independencia
  '11-02', // Día de Difuntos
  '12-25', // Navidad
]);

let container_, session_, role_, destino_;
let ordenes_ = [];
let activeTab_ = 'panel';

// ── Entry point ───────────────────────────────────
export async function init(container, session) {
  container_ = container;
  session_   = session;
  role_      = session.role;
  destino_   = session.asignacionActual?.destino || null;

  renderShell();
  await loadOrdenes();
}

// ── Días hábiles ──────────────────────────────────
function esHabil(fecha) {
  const dow = fecha.getDay();
  if (dow === 0 || dow === 6) return false;
  const key = String(fecha.getMonth() + 1).padStart(2,'0') + '-' + String(fecha.getDate()).padStart(2,'0');
  return !ASUETOS.has(key);
}

function sumarDiasHabiles(desde, dias) {
  const d = new Date(desde);
  let count = 0;
  while (count < dias) {
    d.setDate(d.getDate() + 1);
    if (esHabil(d)) count++;
  }
  return d;
}

function diasHabilesRestantes(fechaVenc) {
  if (!fechaVenc) return null;
  const hoy  = new Date(); hoy.setHours(0,0,0,0);
  const venc = fechaVenc instanceof Date ? fechaVenc : fechaVenc.toDate();
  venc.setHours(0,0,0,0);
  if (venc <= hoy) return 0;
  let count = 0;
  const cursor = new Date(hoy);
  while (cursor < venc) {
    cursor.setDate(cursor.getDate() + 1);
    if (esHabil(cursor)) count++;
  }
  return count;
}

function calcularVencimiento(orden) {
  const fechaBase = orden.fechaIngreso?.toDate ? orden.fechaIngreso.toDate() : new Date();
  if (orden.tipo === 'servicio_nuevo')  return sumarDiasHabiles(fechaBase, 5);
  if (orden.tipo === 'cambio_voltaje')  return sumarDiasHabiles(fechaBase, 10);
  if (orden.tipo === 'reconexion' && orden.fechaPago) {
    const pago = orden.fechaPago?.toDate ? orden.fechaPago.toDate() : new Date(orden.fechaPago);
    return new Date(pago.getTime() + 24 * 60 * 60 * 1000);
  }
  return null;
}

function countdownReconexion(fechaPago) {
  if (!fechaPago) return null;
  const pago     = fechaPago?.toDate ? fechaPago.toDate() : new Date(fechaPago);
  const limite   = new Date(pago.getTime() + 24 * 60 * 60 * 1000);
  const restante = limite - Date.now();
  if (restante <= 0) return '¡Vencida!';
  const h = Math.floor(restante / 3600000);
  const m = Math.floor((restante % 3600000) / 60000);
  return `${h}h ${m}m restantes`;
}

// ── Priorizar órdenes ─────────────────────────────
function priorizar(lista) {
  const hoy     = new Date(); hoy.setHours(23,59,59,999);
  const manana  = new Date(); manana.setDate(manana.getDate() + 1); manana.setHours(23,59,59,999);

  const reconexiones = lista.filter(o => o.tipo === 'reconexion' && !o.estadoCampo && o.fechaPago);
  const porVencer    = lista.filter(o =>
    !o.estadoCampo && o.tipo !== 'reconexion' && o.tipo !== 'desconexion' && o.tipo !== 'anomalia' && (() => {
      const v = calcularVencimiento(o);
      return v && v <= manana;
    })()
  );
  const sinActualizar= lista.filter(o => o.estadoCampo === 'hecha' && !o.actualizadaDelsur);
  const hechas       = lista.filter(o => o.estadoCampo === 'hecha' && o.actualizadaDelsur);
  const pendientes   = lista.filter(o =>
    !o.estadoCampo && o.tipo !== 'reconexion' && o.tipo !== 'anomalia' && !porVencer.find(x => x.id === o.id)
  );
  const anomalias    = lista.filter(o => !o.estadoCampo && o.tipo === 'anomalia');

  return { reconexiones, porVencer, sinActualizar, hechas, pendientes, anomalias };
}

// ── Shell ─────────────────────────────────────────
function renderShell() {
  const isTecnico = role_ === 'tecnico';
  const tabs = isTecnico
    ? [{ id:'ordenes', label:'Órdenes' }, { id:'panel', label:'Resumen' }]
    : [{ id:'panel',   label:'Panel'   }, { id:'ordenes', label:'Órdenes' }, { id:'mapa', label:'Mapa' }];

  container_.innerHTML = `
    <div class="cambios-tabs">
      ${tabs.map((t, i) => `
        <div class="cambios-tab otc ${i === 0 ? 'active' : ''}" data-tab="${t.id}">${t.label}</div>
      `).join('')}
    </div>
    <div id="otc-content" style="padding-top:12px">
      <div class="loading-placeholder">
        <div class="loading-bar"></div>
        <div class="loading-bar short"></div>
        <div class="loading-bar"></div>
      </div>
    </div>

    <!-- Sheet nueva orden manual -->
    <div class="sheet-backdrop" id="sheet-nueva-otc">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Nueva orden OTC</div>
        <div class="sheet-body">
          <div class="form-field">
            <div class="form-label">WO</div>
            <input class="form-input" id="otc-wo" type="text" placeholder="Número de orden"/>
          </div>
          <div class="form-field">
            <div class="form-label">Tipo</div>
            <div class="select-row flex-wrap" id="otc-tipo-row">
              <div class="select-chip" data-val="servicio_nuevo">Servicio nuevo</div>
              <div class="select-chip" data-val="cambio_voltaje">Cambio voltaje</div>
              <div class="select-chip" data-val="reconexion">Reconexión</div>
              <div class="select-chip" data-val="desconexion">Desconexión</div>
              <div class="select-chip" data-val="anomalia">Anomalía</div>
            </div>
          </div>
          <div class="form-field">
            <div class="form-label">Cliente</div>
            <input class="form-input" id="otc-cliente" type="text" placeholder="Nombre del cliente"/>
          </div>
          <div class="form-field">
            <div class="form-label">Dirección</div>
            <input class="form-input" id="otc-dir" type="text" placeholder="Dirección"/>
          </div>
          <div class="form-field">
            <div class="form-label">Técnico asignado</div>
            <div class="select-row" id="otc-tec-row">
              ${TECNICOS.map(t => `<div class="select-chip" data-val="${t}">${t}</div>`).join('')}
            </div>
          </div>
          <div class="form-field" id="otc-pago-wrap" style="display:none">
            <div class="form-label">Fecha de pago (reconexión)</div>
            <input class="form-input" id="otc-pago" type="datetime-local"/>
          </div>
          <div id="otc-nueva-error" class="form-error"></div>
          <button class="btn-primary full otc" id="btn-crear-otc">
            <span id="btn-otc-label">Crear orden</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Sheet detalle orden -->
    <div class="sheet-backdrop" id="sheet-otc-detalle">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title" id="sheet-otc-title">Orden OTC</div>
        <div class="sheet-body" id="sheet-otc-body"></div>
      </div>
    </div>
  `;

  activeTab_ = tabs[0].id;

  document.querySelectorAll('.cambios-tab.otc').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.cambios-tab.otc').forEach(t => t.classList.remove('active'));
      tab.classList.add('active');
      activeTab_ = tab.dataset.tab;
      renderTab();
    });
  });

  // Mostrar fecha pago si tipo = reconexion
  setupSelectChips('otc-tipo-row');
  setupSelectChips('otc-tec-row');
  document.getElementById('otc-tipo-row').addEventListener('click', e => {
    const chip = e.target.closest('.select-chip');
    if (!chip) return;
    document.getElementById('otc-pago-wrap').style.display =
      chip.dataset.val === 'reconexion' ? '' : 'none';
  });

  document.getElementById('btn-crear-otc').addEventListener('click', crearOrden);

  ['sheet-nueva-otc', 'sheet-otc-detalle'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      if (e.target === document.getElementById(id)) closeSheet(id);
    });
  });

  window.__otc = { verOrden, marcarHecha, aprobar, rechazar, openNueva };
}

// ── Cargar órdenes ────────────────────────────────
async function loadOrdenes() {
  try {
    let query = db.collection('otc_ordenes');
    if (role_ === 'tecnico' && destino_) {
      query = query.where('tecnicoDestino', '==', destino_);
    }
    const snap = await query.get();
    ordenes_ = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderTab();
  } catch (err) {
    console.error('[otc] Error cargando:', err);
    document.getElementById('otc-content').innerHTML = `
      <div class="dev-module"><div class="dev-title">Error al cargar</div><p>Verifica tu conexión.</p></div>`;
  }
}

// ── Render tab ────────────────────────────────────
function renderTab() {
  if      (activeTab_ === 'panel')   renderPanel();
  else if (activeTab_ === 'mapa')    renderMapaOtc();
  else                               renderOrdenes();
}

// ── PANEL admin/asistente ─────────────────────────
function renderPanel() {
  const content = document.getElementById('otc-content');
  const activas = ordenes_.filter(o => o.estadoCampo !== 'aprobada');
  const { reconexiones, porVencer, sinActualizar } = priorizar(activas);
  const aprobadas = ordenes_.filter(o => o.estadoCampo === 'aprobada').length;
  const hechas    = ordenes_.filter(o => o.estadoCampo === 'hecha').length;

  content.innerHTML = `
    <div class="flex-col gap-12">

      <div class="panel-header anim-up">
        <div>
          <div class="section-title">Panel OTC</div>
          <div class="section-sub">${activas.length} activas · ${aprobadas} confirmadas</div>
        </div>
        <button class="icon-btn otc" onclick="window.__otc.openNueva()" title="Nueva orden">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      <!-- Alertas críticas -->
      ${reconexiones.length ? `
      <div class="otc-alert-card crit anim-up d1">
        <div class="otc-alert-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          ${reconexiones.length} reconexión${reconexiones.length > 1 ? 'es' : ''} activa${reconexiones.length > 1 ? 's' : ''}
        </div>
        ${reconexiones.map(o => renderOrdenAlerta(o)).join('')}
      </div>` : ''}

      ${porVencer.length ? `
      <div class="otc-alert-card warn anim-up d1">
        <div class="otc-alert-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
          ${porVencer.length} orden${porVencer.length > 1 ? 'es' : ''} por vencer
        </div>
        ${porVencer.map(o => renderOrdenAlerta(o)).join('')}
      </div>` : ''}

      ${sinActualizar.length ? `
      <div class="otc-alert-card warn-soft anim-up d2">
        <div class="otc-alert-header">⚠ ${sinActualizar.length} sin actualizar en DELSUR</div>
        ${sinActualizar.map(o => renderOrdenAlerta(o)).join('')}
      </div>` : ''}

      <!-- Por técnico -->
      <div class="section-label anim-up d2">Por técnico</div>
      <div class="flex-col gap-8 anim-up d2">
        ${TECNICOS.map(t => renderTecnicoCard(t)).join('')}
      </div>

      <!-- Realizadas por verificar -->
      ${hechas ? `
      <div class="section-label anim-up d3">Por verificar</div>
      <div class="flex-col gap-8 anim-up d3">
        ${ordenes_.filter(o => o.estadoCampo === 'hecha').map(o => renderOrdenCard(o)).join('')}
      </div>` : ''}

    </div>
  `;
}

function renderTecnicoCard(tec) {
  const c       = TECNICO_COLORS[tec];
  const lista   = ordenes_.filter(o => o.tecnicoDestino === tec);
  if (!lista.length) return '';
  const activas  = lista.filter(o => o.estadoCampo !== 'aprobada').length;
  const hechas   = lista.filter(o => o.estadoCampo === 'hecha').length;
  const recon    = lista.filter(o => o.tipo === 'reconexion' && !o.estadoCampo && o.fechaPago).length;

  return `
    <div class="pareja-card" style="border-color:${c.border};background:${c.glass}"
         onclick="document.querySelectorAll('.cambios-tab.otc').forEach(t=>t.classList.remove('active'));
                  document.querySelector('.cambios-tab.otc[data-tab=ordenes]').classList.add('active');
                  window.__otc._filtroTec='${tec}';
                  window.__otc._renderOrdenes();">
      <div class="pareja-card-header">
        <div class="pareja-name" style="color:${c.accent}">${tec}</div>
        <div style="display:flex;gap:6px;align-items:center">
          ${recon ? `<div style="font-size:10px;color:#ef4444;font-weight:700">🔴 ${recon} reconex.</div>` : ''}
          <svg viewBox="0 0 24 24" fill="none" stroke="${c.accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
      </div>
      <div class="pareja-stats">${activas} activas · ${hechas} por verificar</div>
    </div>
  `;
}

function renderOrdenAlerta(o) {
  const c = TECNICO_COLORS[o.tecnicoDestino] || TECNICO_COLORS[null];
  const countdown = o.tipo === 'reconexion' ? countdownReconexion(o.fechaPago) : null;
  const dias = diasHabilesRestantes(calcularVencimiento(o));

  return `
    <div class="orden-verif-card" onclick="window.__otc.verOrden('${o.id}')" style="margin-top:6px">
      <div class="orden-verif-info">
        <div class="orden-wo" style="font-size:12px">WO ${o.wo || '—'}</div>
        <div class="orden-cliente" style="font-size:10px">${o.cliente || '—'}</div>
        ${countdown ? `<div style="font-size:10px;color:#ef4444;font-weight:700;margin-top:2px">⏱ ${countdown}</div>` : ''}
        ${dias !== null && !countdown ? `<div style="font-size:10px;color:#fbbf24;margin-top:2px">${dias === 0 ? 'Vence hoy' : `Vence en ${dias} día${dias > 1 ? 's' : ''} hábil${dias > 1 ? 'es' : ''}`}</div>` : ''}
      </div>
      <div class="pareja-chip" style="color:${c.accent};border-color:${c.border};background:${c.glass}">${o.tecnicoDestino || '—'}</div>
    </div>
  `;
}

// ── ÓRDENES (técnico y admin) ─────────────────────
let _filtroTec = null;

function renderOrdenes() {
  const content = document.getElementById('otc-content');
  const isTecnico = role_ === 'tecnico';
  let lista = isTecnico
    ? ordenes_.filter(o => o.tecnicoDestino === destino_)
    : (_filtroTec ? ordenes_.filter(o => o.tecnicoDestino === _filtroTec) : ordenes_);

  const { reconexiones, porVencer, sinActualizar, hechas, pendientes, anomalias } = priorizar(lista);

  content.innerHTML = `
    <div class="flex-col gap-12">

      <div class="panel-header anim-up">
        <div>
          <div class="section-title">${isTecnico ? (destino_ || 'Mis órdenes') : (_filtroTec || 'Todas las órdenes')}</div>
          <div class="section-sub">${lista.filter(o=>o.estadoCampo!=='aprobada').length} activas</div>
        </div>
        <div style="display:flex;gap:8px">
          ${!isTecnico && _filtroTec ? `
          <button class="icon-btn" onclick="window.__otc._filtroTec=null;window.__otc._renderOrdenes()" title="Ver todas">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
          </button>` : ''}
          <button class="icon-btn otc" onclick="window.__otc.openNueva()" title="Nueva orden">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
      </div>

      ${!lista.length ? `<div class="dev-module"><div class="dev-title">Sin órdenes</div><p>No hay órdenes asignadas.</p></div>` : ''}

      ${reconexiones.length ? renderGrupoOtc('🔴 Reconexiones activas', reconexiones, 'crit') : ''}
      ${porVencer.length    ? renderGrupoOtc('🟠 Por vencer', porVencer, 'warn') : ''}
      ${sinActualizar.length? renderGrupoOtc('⚠ Sin actualizar DELSUR', sinActualizar, 'warn-soft') : ''}
      ${hechas.length       ? renderGrupoOtc('✓ Realizadas', hechas, 'hecha') : ''}
      ${pendientes.length   ? renderGrupoOtc('Pendientes', pendientes, 'pendiente') : ''}
      ${anomalias.length    ? renderGrupoOtc('Anomalías', anomalias, 'anomalia') : ''}

    </div>
  `;
}

function renderGrupoOtc(titulo, lista, tipo) {
  return `
    <div class="anim-up">
      <div class="section-label" style="margin-bottom:8px">${titulo}</div>
      <div class="flex-col gap-8">
        ${lista.map(o => renderOrdenCard(o, tipo)).join('')}
      </div>
    </div>
  `;
}

function renderOrdenCard(o, tipo = '') {
  const c        = TECNICO_COLORS[o.tecnicoDestino] || TECNICO_COLORS[null];
  const countdown= o.tipo === 'reconexion' ? countdownReconexion(o.fechaPago) : null;
  const dias     = diasHabilesRestantes(calcularVencimiento(o));
  const isTecnico= role_ === 'tecnico';

  const statusDot = {
    'crit':      `<div class="status-dot" style="background:#ef4444"></div>`,
    'warn':      `<div class="status-dot warn"></div>`,
    'warn-soft': `<div class="status-dot warn pulse"></div>`,
    'hecha':     `<div class="status-dot ok"></div>`,
    'pendiente': `<div class="status-dot muted"></div>`,
    'anomalia':  `<div class="status-dot muted"></div>`,
  }[tipo] || `<div class="status-dot muted"></div>`;

  return `
    <div class="orden-card ${tipo}" onclick="window.__otc.verOrden('${o.id}')">
      <div class="orden-card-left">
        ${statusDot}
        <div class="orden-info">
          <div class="orden-wo">WO ${o.wo || '—'}</div>
          <div class="orden-cliente">${o.cliente || '—'}</div>
          <div class="orden-dir">${TIPO_LABELS[o.tipo] || o.tipo || '—'}</div>
          ${countdown ? `<div style="font-size:10px;color:#ef4444;font-weight:700">⏱ ${countdown}</div>` : ''}
          ${dias !== null && dias <= 2 && !countdown ? `<div style="font-size:10px;color:#fbbf24">${dias === 0 ? 'Vence hoy' : `${dias} día${dias>1?'s':''} hábil${dias>1?'es':''}`}</div>` : ''}
        </div>
      </div>
      <div class="orden-card-right">
        ${!isTecnico ? `<div class="pareja-chip" style="color:${c.accent};border-color:${c.border};background:${c.glass}">${o.tecnicoDestino || '—'}</div>` : ''}
        ${tipo === 'hecha' && !isTecnico ? `
          <button class="action-chip ok" onclick="event.stopPropagation();window.__otc.aprobar('${o.id}')">✓</button>
        ` : ''}
      </div>
    </div>
  `;
}

// ── Detalle orden ─────────────────────────────────
function verOrden(id) {
  const o = ordenes_.find(x => x.id === id);
  if (!o) return;

  const isTecnico = role_ === 'tecnico';
  const c         = TECNICO_COLORS[o.tecnicoDestino] || TECNICO_COLORS[null];
  const countdown = o.tipo === 'reconexion' ? countdownReconexion(o.fechaPago) : null;
  const dias      = diasHabilesRestantes(calcularVencimiento(o));
  const venc      = calcularVencimiento(o);

  document.getElementById('sheet-otc-title').textContent = `WO ${o.wo || '—'}`;
  document.getElementById('sheet-otc-body').innerHTML = `
    <div class="flex-col gap-12">

      <!-- Estado y tipo -->
      <div class="orden-estado-row">
        <div class="estado-badge" style="color:${TIPO_COLORS[o.tipo]||'#6b7280'};border-color:${TIPO_COLORS[o.tipo]||'#6b7280'}44;background:${TIPO_COLORS[o.tipo]||'#6b7280'}11">
          ${TIPO_LABELS[o.tipo] || o.tipo || '—'}
        </div>
        ${o.estadoCampo === 'hecha'    ? '<div class="estado-badge ok">Realizada</div>'   : ''}
        ${o.estadoCampo === 'aprobada' ? '<div class="estado-badge ok">Confirmada</div>'  : ''}
        ${!o.estadoCampo               ? '<div class="estado-badge muted">Pendiente</div>': ''}
        ${o.actualizadaDelsur ? '<div class="estado-badge ok-outline">✓ DELSUR</div>' : ''}
        ${o.tecnicoDestino ? `<div class="pareja-chip" style="color:${c.accent};border-color:${c.border};background:${c.glass}">${o.tecnicoDestino}</div>` : ''}
      </div>

      <!-- Urgencia -->
      ${countdown ? `
      <div class="card" style="background:rgba(239,68,68,.08);border-color:rgba(239,68,68,.25)">
        <div style="font-size:13px;font-weight:800;color:#ef4444">⏱ ${countdown}</div>
        <div style="font-size:11px;color:var(--text-3);margin-top:4px">Reconexión — el cliente ya pagó</div>
      </div>` : ''}
      ${dias !== null && dias <= 2 && !countdown ? `
      <div class="card" style="background:rgba(245,158,11,.08);border-color:rgba(245,158,11,.25)">
        <div style="font-size:13px;font-weight:700;color:#fbbf24">${dias === 0 ? '⚠ Vence hoy' : `⚠ Vence en ${dias} día${dias>1?'s':''} hábil${dias>1?'es':''}`}</div>
        ${venc ? `<div style="font-size:11px;color:var(--text-3);margin-top:4px">Fecha límite: ${formatDate(venc)}</div>` : ''}
      </div>` : ''}

      <!-- Info cliente -->
      <div class="detail-section">
        <div class="detail-label">Cliente</div>
        <div class="detail-field full"><div class="detail-key">Nombre</div><div class="detail-val">${o.cliente || '—'}</div></div>
        <div class="detail-field full"><div class="detail-key">Dirección</div><div class="detail-val">${o.direccion || '—'}</div></div>
      </div>

      <!-- Info orden -->
      <div class="detail-section">
        <div class="detail-label">Datos de la orden</div>
        <div class="detail-row">
          <div class="detail-field"><div class="detail-key">Ingresada</div><div class="detail-val">${formatDate(o.fechaIngreso)}</div></div>
          ${venc ? `<div class="detail-field"><div class="detail-key">Vencimiento</div><div class="detail-val">${formatDate(venc)}</div></div>` : ''}
          ${o.fechaPago ? `<div class="detail-field"><div class="detail-key">Fecha pago</div><div class="detail-val">${formatDate(o.fechaPago)}</div></div>` : ''}
        </div>
      </div>

      <!-- Historial -->
      ${o.fechaHecha ? `
      <div class="detail-section">
        <div class="detail-label">Historial</div>
        <div class="detail-field full"><div class="detail-key">Realizada</div><div class="detail-val">${formatDate(o.fechaHecha)} · ${o.hechaPor || '—'}</div></div>
        ${o.aprobadoPor ? `<div class="detail-field full"><div class="detail-key">Confirmada por</div><div class="detail-val">${o.aprobadoPor}</div></div>` : ''}
      </div>` : ''}

      <!-- Acciones técnico -->
      ${isTecnico && !o.estadoCampo ? `
      <button class="btn-action cm" style="border-color:var(--otc-border);background:var(--otc-glass);color:var(--otc-light)" onclick="window.__otc.marcarHecha('${o.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
        Marcar como realizada
      </button>` : ''}

      <!-- Acciones admin/asistente -->
      ${!isTecnico && o.estadoCampo === 'hecha' ? `
      <div class="flex-col gap-8">
        <button class="btn-action cm" style="border-color:var(--otc-border);background:var(--otc-glass);color:var(--otc-light)" onclick="window.__otc.aprobar('${o.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Confirmar realizada
        </button>
        <button class="btn-action danger" onclick="window.__otc.rechazar('${o.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          Rechazar — volver a pendiente
        </button>
      </div>` : ''}

    </div>
  `;

  openSheet('sheet-otc-detalle');
}

// ── Mapa OTC ──────────────────────────────────────
async function renderMapaOtc() {
  const content = document.getElementById('otc-content');
  content.innerHTML = '<div style="height:calc(100vh - 180px);min-height:300px;" id="otc-mapa-container"></div>';
  try {
    const mapaModule = await import('./mapa_otc.js');
    mapaModule.init(document.getElementById('otc-mapa-container'), session_, ordenes_);
  } catch {
    // Fallback — mapa simple con Leaflet
    renderMapaSimple(content);
  }
}

function renderMapaSimple(content) {
  content.innerHTML = `<div id="otc-mapa-simple" style="height:calc(100vh - 180px);min-height:300px;border-radius:var(--radius);overflow:hidden;"></div>`;
  const map = L.map('otc-mapa-simple', { center: [13.7942, -88.8965], zoom: 10, zoomControl: false });
  L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 20 }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  const conCoords = ordenes_.filter(o => o.latitud && o.longitud && o.estadoCampo !== 'aprobada');
  conCoords.forEach(o => {
    const c = TECNICO_COLORS[o.tecnicoDestino] || TECNICO_COLORS[null];
    const icon = L.divIcon({
      className: '',
      html: `<div style="width:12px;height:12px;background:${c.accent};border:2px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,.4)"></div>`,
      iconSize: [12,12], iconAnchor: [6,6],
    });
    L.marker([o.latitud, o.longitud], { icon })
      .on('click', () => verOrden(o.id))
      .addTo(map);
  });

  if (conCoords.length) {
    const group = L.featureGroup(conCoords.map(o => L.marker([o.latitud, o.longitud])));
    map.fitBounds(group.getBounds().pad(0.1));
  }
}

// ── Acciones ──────────────────────────────────────
async function marcarHecha(id) {
  try {
    const now = firebase.firestore.Timestamp.now();
    await db.collection('otc_ordenes').doc(id).update({
      estadoCampo:       'hecha',
      fechaHecha:        now,
      hechaPor:          session_.displayName,
      actualizadaDelsur: false,
    });
    const o = ordenes_.find(x => x.id === id);
    if (o) { o.estadoCampo = 'hecha'; o.actualizadaDelsur = false; }
    closeSheet('sheet-otc-detalle');
    renderTab();
    toast('Orden marcada como realizada', 'ok');
  } catch (err) {
    console.error('[otc] Error:', err);
    toast('Error al guardar', 'error');
  }
}

async function aprobar(id) {
  try {
    const now = firebase.firestore.Timestamp.now();
    await db.collection('otc_ordenes').doc(id).update({
      estadoCampo:      'aprobada',
      actualizadaDelsur: true,
      aprobadoPor:      session_.displayName,
      fechaAprobacion:  now,
    });
    const o = ordenes_.find(x => x.id === id);
    if (o) { o.estadoCampo = 'aprobada'; o.actualizadaDelsur = true; }
    closeSheet('sheet-otc-detalle');
    renderTab();
    toast('Orden confirmada', 'ok');
  } catch (err) {
    toast('Error al confirmar', 'error');
  }
}

async function rechazar(id) {
  if (!confirm('¿Rechazar? La orden volverá a pendiente.')) return;
  try {
    await db.collection('otc_ordenes').doc(id).update({
      estadoCampo: null, actualizadaDelsur: false,
      fechaHecha: null, hechaPor: null,
    });
    const o = ordenes_.find(x => x.id === id);
    if (o) { o.estadoCampo = null; o.actualizadaDelsur = false; }
    closeSheet('sheet-otc-detalle');
    renderTab();
    toast('Orden rechazada — pendiente', 'warn');
  } catch (err) {
    toast('Error al rechazar', 'error');
  }
}

// ── Crear orden manual ────────────────────────────
function openNueva() { openSheet('sheet-nueva-otc'); }

async function crearOrden() {
  const wo      = document.getElementById('otc-wo').value.trim();
  const tipo    = getSelectedChip('otc-tipo-row');
  const cliente = document.getElementById('otc-cliente').value.trim();
  const dir     = document.getElementById('otc-dir').value.trim();
  const tec     = getSelectedChip('otc-tec-row');
  const errEl   = document.getElementById('otc-nueva-error');

  errEl.style.display = 'none';
  if (!wo || !tipo || !tec) {
    errEl.textContent = 'WO, tipo y técnico son obligatorios.';
    errEl.style.display = 'block';
    return;
  }

  const ahora = firebase.firestore.Timestamp.now();
  let fechaPago = null;
  if (tipo === 'reconexion') {
    const pagoVal = document.getElementById('otc-pago').value;
    if (!pagoVal) {
      errEl.textContent = 'Ingresa la fecha de pago para la reconexión.';
      errEl.style.display = 'block';
      return;
    }
    fechaPago = firebase.firestore.Timestamp.fromDate(new Date(pagoVal));
  }

  setLoading('btn-otc-label', 'Creando…', true);
  try {
    const data = {
      wo, tipo, cliente, direccion: dir,
      tecnicoDestino:    tec,
      fechaIngreso:      ahora,
      estadoCampo:       null,
      actualizadaDelsur: false,
      latitud:           null,
      longitud:          null,
      fechaPago,
      diasHabilesLimite: tipo === 'servicio_nuevo' ? 5 : tipo === 'cambio_voltaje' ? 10 : null,
    };
    const ref = await db.collection('otc_ordenes').add(data);
    ordenes_.push({ id: ref.id, ...data });
    closeSheet('sheet-nueva-otc');
    renderTab();
    toast('Orden creada', 'ok');
  } catch (err) {
    errEl.textContent = 'Error al crear. Intenta de nuevo.';
    errEl.style.display = 'block';
  } finally {
    setLoading('btn-otc-label', 'Crear orden', false);
  }
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

function formatDate(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-SV', { day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit' });
}

// Exponer para onclick del panel de técnicos
window.__otc = { verOrden, marcarHecha, aprobar, rechazar, openNueva, _filtroTec, _renderOrdenes: renderOrdenes };
