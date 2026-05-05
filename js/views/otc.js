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
  activeTab_ = role_ === 'tecnico' ? 'ordenes' : 'panel';

  renderShell();
  await loadOrdenes();
}

export async function initConTab(container, session, tab) {
  container_ = container;
  session_   = session;
  role_      = session.role;
  destino_   = session.asignacionActual?.destino || null;
  activeTab_ = tab;

  if (tab === 'mapa') {
    // Renderizar mapa directamente sin sistema de tabs
    container_.innerHTML = '';
    await loadOrdenes();
    renderMapaSimple(container_);
    return;
  }

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
      ${tabs.map(t => `
        <div class="cambios-tab otc ${t.id === activeTab_ ? 'active' : ''}" data-tab="${t.id}">${t.label}</div>
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
            <div class="form-label">Fecha de ingreso al SAP</div>
            <input class="form-input" id="otc-fecha-sap" type="date"/>
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
            <div class="form-label">Coordenadas (opcional)</div>
            <div style="display:flex;gap:8px">
              <input class="form-input" id="otc-lat" type="number" step="any" placeholder="Latitud" style="flex:1"/>
              <input class="form-input" id="otc-lng" type="number" step="any" placeholder="Longitud" style="flex:1"/>
            </div>
          </div>
          <div class="form-field" ${role_ === 'tecnico' ? 'style="display:none"' : ''}>
            <div class="form-label">Técnico asignado</div>
            <div class="select-row" id="otc-tec-row">
              ${TECNICOS.map(t => `<div class="select-chip ${role_ === 'tecnico' && t === destino_ ? 'active' : ''}" data-val="${t}">${t}</div>`).join('')}
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

    <!-- Sheet reasignar orden -->
    <div class="sheet-backdrop" id="sheet-reasignar">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title" id="sheet-reasignar-title">Reasignar orden</div>
        <div class="sheet-body">
          <div class="form-label" style="margin-bottom:8px">Asignar a técnico</div>
          <div class="select-row" id="reasignar-tec-row" style="margin-bottom:16px">
            ${TECNICOS.map(t => `<div class="select-chip" data-val="${t}">${t}</div>`).join('')}
          </div>
          <div id="reasignar-error" class="form-error"></div>
          <button class="btn-primary full otc" onclick="window.__otc.confirmarReasignar()">
            <span id="btn-reasignar-label">Confirmar reasignación</span>
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

  // Fecha SAP por defecto: hoy
  const hoy = new Date().toISOString().split('T')[0];
  const fechaSapEl = document.getElementById('otc-fecha-sap');
  if (fechaSapEl) fechaSapEl.value = hoy;

  ['sheet-nueva-otc', 'sheet-otc-detalle', 'sheet-reasignar'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      if (e.target === document.getElementById(id)) closeSheet(id);
    });
  });

  setupSelectChips('reasignar-tec-row');

  window.__otc = { verOrden, marcarHecha, aprobar, rechazar, openNueva, verTecnico, verUrgencias, _volverPanel, reasignar, confirmarReasignar, _filtroTec, _renderOrdenes: renderOrdenes };
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

// ── PANEL ─────────────────────────────────────────
function renderPanel() {
  if (role_ === 'tecnico') renderPanelTecnico();
  else renderPanelAdmin();
}

function renderPanelTecnico() {
  const content  = document.getElementById('otc-content');
  const misList  = ordenes_.filter(o => o.tecnicoDestino === destino_);
  const activas  = misList.filter(o => o.estadoCampo !== 'aprobada');
  const { reconexiones, porVencer, sinActualizar, hechas, pendientes } = priorizar(activas);

  content.innerHTML = `
    <div class="flex-col gap-12">

      <div class="panel-header anim-up">
        <div>
          <div class="section-title">${destino_ || 'Mis órdenes'}</div>
          <div class="section-sub">${activas.length} activas · ${hechas.length} realizadas</div>
        </div>
        <button class="icon-btn otc" onclick="window.__otc.openNueva()" title="Nueva orden">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      <!-- Stats -->
      <div class="stat-row anim-up d1">
        <div class="stat-chip otc-accent">
          <div class="val">${pendientes.length + porVencer.length}</div>
          <div class="lbl">Pendientes</div>
        </div>
        <div class="stat-chip otc-accent">
          <div class="val">${hechas.length}</div>
          <div class="lbl">Realizadas</div>
        </div>
        <div class="stat-chip ${reconexiones.length ? 'crit-accent' : ''}">
          <div class="val">${reconexiones.length}</div>
          <div class="lbl">Reconexiones</div>
        </div>
      </div>

      <!-- Alertas -->
      ${reconexiones.length ? `
      <div class="otc-alert-card crit anim-up d1">
        <div class="otc-alert-header">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>
          ${reconexiones.length} reconexión${reconexiones.length > 1 ? 'es' : ''} activa${reconexiones.length > 1 ? 's' : ''}
        </div>
        ${reconexiones.map(o => renderOrdenAlerta(o)).join('')}
      </div>` : ''}

      ${porVencer.length ? `
      <div class="otc-alert-card warn anim-up d2">
        <div class="otc-alert-header">⏰ ${porVencer.length} por vencer pronto</div>
        ${porVencer.map(o => renderOrdenAlerta(o)).join('')}
      </div>` : ''}

      ${sinActualizar.length ? `
      <div class="otc-alert-card warn-soft anim-up d2">
        <div class="otc-alert-header">⚠ ${sinActualizar.length} sin actualizar en DELSUR</div>
        ${sinActualizar.map(o => renderOrdenAlerta(o)).join('')}
      </div>` : ''}

      ${!activas.length ? `
      <div class="dev-module anim-up d2">
        <div class="dev-title">Sin órdenes activas</div>
        <p>No tienes órdenes pendientes asignadas.</p>
      </div>` : ''}

    </div>
  `;
}

function renderPanelAdmin() {
  const content   = document.getElementById('otc-content');
  const activas   = ordenes_.filter(o => o.estadoCampo !== 'aprobada');
  const aprobadas = ordenes_.filter(o => o.estadoCampo === 'aprobada').length;

  // Contadores globales de urgencia
  const reconGlobal   = activas.filter(o => o.tipo === 'reconexion' && !o.estadoCampo && o.fechaPago);
  const hoyGlobal     = activas.filter(o => !o.estadoCampo && getUrgencia(o) === 'hoy');
  const mananaGlobal  = activas.filter(o => !o.estadoCampo && getUrgencia(o) === 'naranja' && diasHabilesRestantes(calcularVencimiento(o)) === 1);
  const hechasSinConf = ordenes_.filter(o => o.estadoCampo === 'hecha');

  content.innerHTML = `
    <div class="flex-col gap-12">

      <!-- Header -->
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

      <!-- Tablero de urgencias globales -->
      <div class="otc-tablero anim-up d1">
        <div class="otc-tablero-item ${reconGlobal.length ? 'crit' : 'ok'}" onclick="window.__otc.verUrgencias('reconexion')">
          <div class="otc-tablero-num">${reconGlobal.length}</div>
          <div class="otc-tablero-label">Reconexiones</div>
          ${reconGlobal.length ? `<div class="otc-tablero-sub">activas ahora</div>` : '<div class="otc-tablero-sub">✓ Al día</div>'}
        </div>
        <div class="otc-tablero-item ${hoyGlobal.length ? 'crit' : 'ok'}" onclick="window.__otc.verUrgencias('hoy')">
          <div class="otc-tablero-num">${hoyGlobal.length}</div>
          <div class="otc-tablero-label">Vencen hoy</div>
          ${hoyGlobal.length ? `<div class="otc-tablero-sub">urgente</div>` : '<div class="otc-tablero-sub">✓ Sin vencer</div>'}
        </div>
        <div class="otc-tablero-item ${mananaGlobal.length ? 'warn' : 'ok'}" onclick="window.__otc.verUrgencias('manana')">
          <div class="otc-tablero-num">${mananaGlobal.length}</div>
          <div class="otc-tablero-label">Vencen mañana</div>
          ${mananaGlobal.length ? `<div class="otc-tablero-sub">atención</div>` : '<div class="otc-tablero-sub">✓ Sin riesgo</div>'}
        </div>
        <div class="otc-tablero-item ${hechasSinConf.length ? 'warn' : 'ok'}" onclick="window.__otc.verUrgencias('confirmar')">
          <div class="otc-tablero-num">${hechasSinConf.length}</div>
          <div class="otc-tablero-label">Por confirmar</div>
          ${hechasSinConf.length ? `<div class="otc-tablero-sub">pendientes</div>` : '<div class="otc-tablero-sub">✓ Al día</div>'}
        </div>
      </div>

      <!-- Semáforo por técnico -->
      <div class="section-label anim-up d2">Estado por técnico</div>
      <div class="flex-col gap-8 anim-up d2">
        ${TECNICOS.map(t => renderSemaforoTecnico(t)).join('')}
      </div>

    </div>
  `;
}

function getSemaforoTecnico(tec) {
  const lista   = ordenes_.filter(o => o.tecnicoDestino === tec && o.estadoCampo !== 'aprobada');
  const recon   = lista.filter(o => o.tipo === 'reconexion' && !o.estadoCampo && o.fechaPago).length;
  const hoy     = lista.filter(o => !o.estadoCampo && getUrgencia(o) === 'hoy').length;
  const naranja = lista.filter(o => !o.estadoCampo && getUrgencia(o) === 'naranja').length;

  if (recon > 0 || hoy > 0) return 'crit';
  if (naranja > 0)           return 'warn';
  return 'ok';
}

function renderSemaforoTecnico(tec) {
  const c       = TECNICO_COLORS[tec];
  const lista   = ordenes_.filter(o => o.tecnicoDestino === tec && o.estadoCampo !== 'aprobada');
  const recon   = lista.filter(o => o.tipo === 'reconexion' && !o.estadoCampo && o.fechaPago).length;
  const hoy     = lista.filter(o => !o.estadoCampo && getUrgencia(o) === 'hoy').length;
  const naranja = lista.filter(o => !o.estadoCampo && getUrgencia(o) === 'naranja').length;
  const total   = lista.filter(o => !o.estadoCampo).length;
  const hechas  = lista.filter(o => o.estadoCampo === 'hecha').length;
  const semaforo= getSemaforoTecnico(tec);

  const semaforoColor = { crit: '#ef4444', warn: '#f59e0b', ok: '#22c55e' }[semaforo];
  const semaforoBg    = { crit: 'rgba(239,68,68,.1)', warn: 'rgba(245,158,11,.1)', ok: 'rgba(34,197,94,.08)' }[semaforo];
  const semaforoBorder= { crit: 'rgba(239,68,68,.3)', warn: 'rgba(245,158,11,.3)', ok: 'rgba(34,197,94,.2)' }[semaforo];

  return `
    <div class="otc-semaforo-card" style="border-color:${semaforoBorder};background:${semaforoBg}"
         onclick="window.__otc.verTecnico('${tec}')">
      <div style="display:flex;align-items:center;gap:12px;flex:1">
        <!-- Semáforo -->
        <div style="width:12px;height:12px;border-radius:50%;background:${semaforoColor};flex-shrink:0;
             box-shadow:0 0 8px ${semaforoColor}"></div>
        <!-- Info -->
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:800;color:${c.accent}">${tec}</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:2px">
            ${total} pendientes · ${hechas} realizadas
            ${recon ? `<span style="color:#ef4444;font-weight:700"> · 🔴 ${recon} reconex.</span>` : ''}
            ${hoy   ? `<span style="color:#ef4444;font-weight:700"> · ${hoy} vence${hoy>1?'n':''} hoy</span>` : ''}
            ${naranja && !hoy ? `<span style="color:#f59e0b"> · ${naranja} en riesgo</span>` : ''}
          </div>
        </div>
      </div>
      <svg viewBox="0 0 24 24" fill="none" stroke="${c.accent}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
        <polyline points="9 18 15 12 9 6"/>
      </svg>
    </div>
  `;
}

// ── Ver urgencias globales ────────────────────────
let _vistaUrgencia = null;

function verUrgencias(tipo) {
  _vistaUrgencia = tipo;
  const content  = document.getElementById('otc-content');
  let lista = [];
  let titulo = '';

  if (tipo === 'reconexion') {
    lista  = ordenes_.filter(o => o.tipo === 'reconexion' && !o.estadoCampo && o.fechaPago);
    titulo = '🔴 Reconexiones activas';
  } else if (tipo === 'hoy') {
    lista  = ordenes_.filter(o => !o.estadoCampo && getUrgencia(o) === 'hoy');
    titulo = '🔴 Vencen hoy';
  } else if (tipo === 'manana') {
    lista  = ordenes_.filter(o => !o.estadoCampo && getUrgencia(o) === 'naranja' && diasHabilesRestantes(calcularVencimiento(o)) === 1);
    titulo = '🟠 Vencen mañana';
  } else if (tipo === 'confirmar') {
    lista  = ordenes_.filter(o => o.estadoCampo === 'hecha');
    titulo = 'Por confirmar';
  }

  content.innerHTML = `
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div>
          <div class="section-title">${titulo}</div>
          <div class="section-sub">${lista.length} órdenes</div>
        </div>
        <button class="icon-btn" onclick="window.__otc._volverPanel()" title="Volver">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
      </div>
      <div class="flex-col gap-8 anim-up d1">
        ${lista.map(o => renderOrdenCard(o, tipo === 'confirmar' ? 'hecha' : 'crit')).join('')}
      </div>
    </div>
  `;
}

// ── Ver técnico específico ────────────────────────
let _tecnicoActual = null;

function verTecnico(tec) {
  _tecnicoActual = tec;
  const c        = TECNICO_COLORS[tec];
  const content  = document.getElementById('otc-content');
  const lista    = ordenes_.filter(o => o.tecnicoDestino === tec && o.estadoCampo !== 'aprobada');
  const { reconexiones, porVencer, sinActualizar, hechas, pendientes, anomalias } = priorizar(lista);

  content.innerHTML = `
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div>
          <div class="section-title" style="color:${c.accent}">${tec}</div>
          <div class="section-sub">${lista.filter(o=>!o.estadoCampo).length} pendientes · ${hechas.length} realizadas</div>
        </div>
        <button class="icon-btn" onclick="window.__otc._volverPanel()" title="Volver">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <polyline points="15 18 9 12 15 6"/>
          </svg>
        </button>
      </div>

      ${!lista.length ? `<div class="dev-module"><div class="dev-title">Sin órdenes</div><p>${tec} no tiene órdenes activas.</p></div>` : ''}
      ${reconexiones.length  ? renderGrupoOtc('🔴 Reconexiones', reconexiones, 'crit')     : ''}
      ${porVencer.length     ? renderGrupoOtc('Por vencer', porVencer, 'warn')              : ''}
      ${sinActualizar.length ? renderGrupoOtc('⚠ Sin actualizar', sinActualizar, 'warn-soft'): ''}
      ${hechas.length        ? renderGrupoOtc('Realizadas — confirmar', hechas, 'hecha')    : ''}
      ${pendientes.length    ? renderGrupoOtc('Pendientes', pendientes, 'pendiente')        : ''}
      ${anomalias.length     ? renderGrupoOtc('Anomalías', anomalias, 'anomalia')           : ''}
    </div>
  `;
}

function _volverPanel() {
  _tecnicoActual  = null;
  _vistaUrgencia  = null;
  renderPanelAdmin();
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

  // Para técnico: ordenar por urgencia y renderizar sin secciones
  if (isTecnico) {
    renderOrdenesTecnico(content, lista);
    return;
  }

  // Para admin/asistente: secciones con títulos
  const { reconexiones, porVencer, sinActualizar, hechas, pendientes, anomalias } = priorizar(lista);

  content.innerHTML = `
    <div class="flex-col gap-12">

      <div class="panel-header anim-up">
        <div>
          <div class="section-title">${_filtroTec || 'Todas las órdenes'}</div>
          <div class="section-sub">${lista.filter(o=>o.estadoCampo!=='aprobada').length} activas</div>
        </div>
        <div style="display:flex;gap:8px">
          ${_filtroTec ? `
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
      ${reconexiones.length  ? renderGrupoOtc('🔴 Reconexiones activas', reconexiones, 'crit') : ''}
      ${porVencer.length     ? renderGrupoOtc('Por vencer', porVencer, 'warn') : ''}
      ${sinActualizar.length ? renderGrupoOtc('⚠ Sin actualizar DELSUR', sinActualizar, 'warn-soft') : ''}
      ${hechas.length        ? renderGrupoOtc('✓ Realizadas', hechas, 'hecha') : ''}
      ${pendientes.length    ? renderGrupoOtc('Pendientes', pendientes, 'pendiente') : ''}
      ${anomalias.length     ? renderGrupoOtc('Anomalías', anomalias, 'anomalia') : ''}
    </div>
  `;
}

// ── Vista técnico con colores de urgencia ─────────
function getUrgencia(o) {
  if (o.tipo === 'reconexion' && !o.estadoCampo && o.fechaPago) return 'reconexion';
  if (o.estadoCampo) return 'hecha';
  if (o.tipo === 'desconexion' || o.tipo === 'anomalia') return 'sinlimite';
  const dias = diasHabilesRestantes(calcularVencimiento(o));
  if (dias === null) return 'sinlimite';
  if (dias === 0)    return 'hoy';
  if (dias <= 2)     return 'naranja';
  if (dias === 3)    return 'amarillo';
  return 'normal';
}

const URGENCIA_CONFIG = {
  reconexion: { bg: 'rgba(239,68,68,.1)',   border: 'rgba(239,68,68,.3)',  dot: '#ef4444', label: null },
  hoy:        { bg: 'rgba(239,68,68,.08)',  border: 'rgba(239,68,68,.25)', dot: '#ef4444', label: 'Vence hoy' },
  naranja:    { bg: 'rgba(249,115,22,.08)', border: 'rgba(249,115,22,.25)',dot: '#f97316', label: null },
  amarillo:   { bg: 'rgba(245,158,11,.07)', border: 'rgba(245,158,11,.2)', dot: '#fbbf24', label: null },
  normal:     { bg: 'var(--glass)',          border: 'var(--border)',        dot: 'var(--text-4)', label: null },
  sinlimite:  { bg: 'rgba(255,255,255,.03)',border: 'rgba(255,255,255,.05)',dot: '#4b5563', label: null },
  hecha:      { bg: 'rgba(34,197,94,.04)',  border: 'rgba(34,197,94,.15)', dot: '#22c55e', label: null },
};

function renderOrdenesTecnico(content, lista) {
  const activas  = lista.filter(o => o.estadoCampo !== 'aprobada');
  const hechas   = activas.filter(o => o.estadoCampo === 'hecha');
  const pendientes = activas.filter(o => !o.estadoCampo);

  // Ordenar pendientes por urgencia
  const orden = ['reconexion','hoy','naranja','amarillo','normal','sinlimite'];
  pendientes.sort((a, b) => orden.indexOf(getUrgencia(a)) - orden.indexOf(getUrgencia(b)));

  // Resumen de urgencias
  const reconCount  = pendientes.filter(o => getUrgencia(o) === 'reconexion').length;
  const hoyCount    = pendientes.filter(o => getUrgencia(o) === 'hoy').length;
  const naranjaCount= pendientes.filter(o => getUrgencia(o) === 'naranja').length;
  const amarilloCount=pendientes.filter(o => getUrgencia(o) === 'amarillo').length;

  content.innerHTML = `
    <div class="flex-col gap-12">

      <div class="panel-header anim-up">
        <div>
          <div class="section-title">${destino_ || 'Mis órdenes'}</div>
          <div class="section-sub">${pendientes.length} pendientes · ${hechas.length} realizadas</div>
        </div>
        <button class="icon-btn otc" onclick="window.__otc.openNueva()" title="Nueva orden">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      <!-- Resumen de urgencias -->
      ${reconCount || hoyCount || naranjaCount || amarilloCount ? `
      <div class="urgencia-resumen anim-up d1">
        ${reconCount   ? `<div class="urgencia-badge rojo">🔴 ${reconCount} reconexión${reconCount>1?'es':''}</div>` : ''}
        ${hoyCount     ? `<div class="urgencia-badge rojo">${hoyCount} vence${hoyCount>1?'n':''} hoy</div>` : ''}
        ${naranjaCount ? `<div class="urgencia-badge naranja">${naranjaCount} en 1-2 días</div>` : ''}
        ${amarilloCount? `<div class="urgencia-badge amarillo">${amarilloCount} en 3 días</div>` : ''}
      </div>` : ''}

      <!-- Listado priorizado -->
      <div class="flex-col gap-8 anim-up d2">
        ${pendientes.map(o => renderOrdenCardTecnico(o)).join('')}
      </div>

      <!-- Realizadas -->
      ${hechas.length ? `
      <div class="section-label anim-up d3">Realizadas hoy</div>
      <div class="flex-col gap-8 anim-up d3">
        ${hechas.map(o => renderOrdenCardTecnico(o)).join('')}
      </div>` : ''}

    </div>
  `;
}

function renderOrdenCardTecnico(o) {
  const urgencia = getUrgencia(o);
  const cfg      = URGENCIA_CONFIG[urgencia];
  const dias     = diasHabilesRestantes(calcularVencimiento(o));
  const countdown= o.tipo === 'reconexion' ? countdownReconexion(o.fechaPago) : null;

  let diasLabel = '';
  if (countdown) {
    diasLabel = `<div style="font-size:11px;color:#ef4444;font-weight:800;margin-top:3px">⏱ ${countdown}</div>`;
  } else if (urgencia === 'hoy') {
    diasLabel = `<div style="font-size:11px;color:#ef4444;font-weight:700;margin-top:3px">🔴 Vence hoy</div>`;
  } else if (urgencia === 'naranja' && dias !== null) {
    diasLabel = `<div style="font-size:11px;color:#f97316;font-weight:700;margin-top:3px">🟠 ${dias} día${dias>1?'s':''} hábil${dias>1?'es':''}</div>`;
  } else if (urgencia === 'amarillo' && dias !== null) {
    diasLabel = `<div style="font-size:11px;color:#fbbf24;font-weight:600;margin-top:3px">🟡 ${dias} días hábiles</div>`;
  } else if (urgencia === 'normal' && dias !== null) {
    diasLabel = `<div style="font-size:11px;color:var(--text-4);margin-top:3px">${dias} días hábiles</div>`;
  }

  return `
    <div class="orden-card-tec" style="background:${cfg.bg};border-color:${cfg.border}"
         onclick="window.__otc.verOrden('${o.id}')">
      <div style="display:flex;align-items:center;gap:10px;flex:1;min-width:0">
        <div style="width:10px;height:10px;border-radius:50%;background:${cfg.dot};flex-shrink:0"></div>
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:8px">
            <div class="orden-wo">WO ${o.wo || '—'}</div>
            <div style="font-size:10px;font-weight:600;color:var(--text-4);text-transform:uppercase;letter-spacing:.04em">${TIPO_LABELS[o.tipo] || ''}</div>
          </div>
          <div class="orden-cliente">${o.cliente || '—'}</div>
          <div class="orden-dir">${o.direccion || ''}</div>
          ${diasLabel}
        </div>
      </div>
      ${o.estadoCampo === 'hecha' ? '<div class="status-dot ok" style="flex-shrink:0"></div>' : ''}
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
      ${!isTecnico && !o.estadoCampo ? `
      <button class="btn-action outline" onclick="window.__otc.reasignar('${o.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/></svg>
        Reasignar técnico
      </button>` : ''}

    </div>
  `;

  openSheet('sheet-otc-detalle');
}

// ── Mapa OTC ──────────────────────────────────────
async function renderMapaOtc() {
  console.log('[otc] renderMapaOtc llamado');
  const content = document.getElementById('otc-content');
  console.log('[otc] content:', content);
  renderMapaSimple(content);
}

function renderMapaSimple(content) {
  console.log('[otc-mapa] Total ordenes:', ordenes_.length);
  console.log('[otc-mapa] Con coords:', ordenes_.filter(o => o.latitud && o.longitud).map(o => ({ wo: o.wo, lat: o.latitud, lng: o.longitud })));
  console.log('[otc-mapa] L disponible:', typeof L);
  const topbar = document.querySelector('.topbar');
  const navbar  = document.querySelector('.navbar');
  const tabsH   = 48;
  const topH    = topbar ? topbar.offsetHeight : 62;
  const botH    = navbar  ? navbar.offsetHeight  : 72;
  const h       = `calc(100vh - ${topH + botH + tabsH + 24}px)`;

  content.innerHTML = `
    <div style="position:relative;height:${h};min-height:280px;border-radius:var(--radius);overflow:hidden;">
      <div id="otc-mapa-simple" style="width:100%;height:100%;"></div>

      <!-- Stat chip -->
      <div class="mapa-controls-top">
        <div class="mapa-stat-chip">
          <div class="mapa-stat-dot" id="otc-map-dot"></div>
          <span id="otc-map-stat">Cargando…</span>
        </div>
        <button class="mapa-btn-icon" id="otc-btn-loc" title="Mi ubicación">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
            <circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>
          </svg>
        </button>
      </div>

      <!-- Leyenda -->
      <div class="mapa-leyenda">
        ${TECNICOS.map(t => `
          <div class="leyenda-item">
            <div class="leyenda-dot" style="background:${TECNICO_COLORS[t].accent}"></div>
            <span>${t}</span>
          </div>`).join('')}
        <div class="leyenda-item">
          <div class="leyenda-dot" style="background:#22c55e"></div>
          <span>Realizada</span>
        </div>
      </div>

      <!-- Panel inferior -->
      <div class="mapa-panel" id="otc-panel-inf">
        <div class="mapa-panel-handle" onclick="document.getElementById('otc-panel-inf').classList.remove('open')"></div>
        <div id="otc-panel-content"></div>
      </div>
    </div>
  `;

  const map = L.map('otc-mapa-simple', {
    center: [13.7942, -88.8965], zoom: 10,
    zoomControl: false,
  });
  L.tileLayer('https://mt1.google.com/vt/lyrs=y&x={x}&y={y}&z={z}', { maxZoom: 20 }).addTo(map);
  L.control.zoom({ position: 'bottomright' }).addTo(map);

  // Cerrar panel al tocar mapa
  map.on('click', () => document.getElementById('otc-panel-inf')?.classList.remove('open'));

  // Todo dentro del setTimeout para que el mapa tenga dimensiones
  setTimeout(() => {
    map.invalidateSize();

    const conCoords = ordenes_.filter(o =>
      o.latitud && o.longitud && o.estadoCampo !== 'aprobada'
    );

    conCoords.forEach(o => {
      const color = o.estadoCampo === 'hecha'
        ? '#22c55e'
        : (TECNICO_COLORS[o.tecnicoDestino] || TECNICO_COLORS[null]).accent;

      const icon = L.divIcon({
        className: '',
        html: `<div style="width:13px;height:13px;background:${color};border:2px solid white;border-radius:50%;box-shadow:0 2px 4px rgba(0,0,0,.4);${o.estadoCampo==='hecha'?'opacity:.7':''}"></div>`,
        iconSize: [13,13], iconAnchor: [6,6],
      });

      L.marker([parseFloat(o.latitud), parseFloat(o.longitud)], { icon })
        .on('click', e => {
          L.DomEvent.stopPropagation(e);
          mostrarPanelOtc(o);
        })
        .addTo(map);
    });

    if (conCoords.length) {
      const group = L.featureGroup(conCoords.map(o => L.marker([parseFloat(o.latitud), parseFloat(o.longitud)])));
      map.fitBounds(group.getBounds().pad(0.15));
    }

    // Stat chip
    const sinCoords = ordenes_.filter(o => !o.latitud && o.estadoCampo !== 'aprobada').length;
    const statEl    = document.getElementById('otc-map-stat');
    const dotEl     = document.getElementById('otc-map-dot');
    if (statEl) {
      statEl.textContent = sinCoords
        ? `${conCoords.length} en mapa · ${sinCoords} sin coords`
        : `${conCoords.length} órdenes en mapa`;
      if (dotEl) dotEl.style.background = sinCoords ? '#f59e0b' : '#22c55e';
    }
  }, 300);

  // Geolocalización
  let geoMarker = null;
  navigator.geolocation?.watchPosition(pos => {
    const { latitude: lat, longitude: lng } = pos.coords;
    const geoIcon = L.divIcon({
      className: '',
      html: `<div style="width:14px;height:14px;background:#3b82f6;border:3px solid white;border-radius:50%;box-shadow:0 0 0 4px rgba(59,130,246,.3)"></div>`,
      iconSize: [14,14], iconAnchor: [7,7],
    });
    if (geoMarker) geoMarker.setLatLng([lat, lng]);
    else geoMarker = L.marker([lat, lng], { icon: geoIcon, zIndexOffset: 1000 }).addTo(map);
  }, null, { enableHighAccuracy: true, maximumAge: 5000 });

  document.getElementById('otc-btn-loc')?.addEventListener('click', () => {
    if (geoMarker) map.setView(geoMarker.getLatLng(), 17);
    else toast('Obteniendo ubicación…', 'ok');
  });
}

function mostrarPanelOtc(o) {
  const isTecnico = role_ === 'tecnico';
  const c = TECNICO_COLORS[o.tecnicoDestino] || TECNICO_COLORS[null];
  const panel = document.getElementById('otc-panel-inf');
  const panelContent = document.getElementById('otc-panel-content');

  panelContent.innerHTML = `
    <div class="panel-orden-header">
      <div style="flex:1;min-width:0">
        <div class="panel-orden-wo">WO ${o.wo || '—'}</div>
        <div class="panel-orden-cliente">${o.cliente || '—'}</div>
        <div class="panel-orden-dir">${TIPO_LABELS[o.tipo] || o.tipo || ''}</div>
      </div>
      <div style="display:flex;flex-direction:column;align-items:flex-end;gap:4px;flex-shrink:0">
        <div class="pareja-chip" style="color:${c.accent};border-color:${c.border};background:${c.glass}">${o.tecnicoDestino || '—'}</div>
        ${o.estadoCampo === 'hecha' ? '<div class="estado-badge ok">Realizada</div>' : '<div class="estado-badge muted">Pendiente</div>'}
      </div>
    </div>
    <div class="panel-orden-actions">
      ${isTecnico && !o.estadoCampo ? `
        <button class="btn-action cm" style="border-color:var(--otc-border);background:var(--otc-glass);color:var(--otc-light)" onclick="window.__otc.marcarHecha('${o.id}');document.getElementById('otc-panel-inf').classList.remove('open')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Realizada
        </button>` : ''}
      ${!isTecnico && o.estadoCampo === 'hecha' ? `
        <button class="btn-action cm" style="border-color:var(--otc-border);background:var(--otc-glass);color:var(--otc-light)" onclick="window.__otc.aprobar('${o.id}');document.getElementById('otc-panel-inf').classList.remove('open')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Confirmar
        </button>` : ''}
      <button class="btn-action outline" onclick="window.open('https://www.google.com/maps/dir/?api=1&destination=${o.latitud},${o.longitud}','_blank')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polygon points="3 11 22 2 13 21 11 13 3 11"/></svg>
        Navegar
      </button>
    </div>
  `;

  panel.classList.add('open');
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
  const wo       = document.getElementById('otc-wo').value.trim();
  const tipo     = getSelectedChip('otc-tipo-row');
  const fechaSap = document.getElementById('otc-fecha-sap').value;
  const cliente  = document.getElementById('otc-cliente').value.trim();
  const dir      = document.getElementById('otc-dir').value.trim();
  const latVal   = document.getElementById('otc-lat').value.trim();
  const lngVal   = document.getElementById('otc-lng').value.trim();
  const tec      = getSelectedChip('otc-tec-row');
  const errEl    = document.getElementById('otc-nueva-error');

  errEl.style.display = 'none';
  if (!wo || !tipo || !tec) {
    errEl.textContent = 'WO, tipo y técnico son obligatorios.';
    errEl.style.display = 'block';
    return;
  }
  if (!fechaSap) {
    errEl.textContent = 'La fecha de ingreso al SAP es obligatoria.';
    errEl.style.display = 'block';
    return;
  }

  // Fecha SAP como Timestamp
  const fechaIngreso = firebase.firestore.Timestamp.fromDate(new Date(fechaSap + 'T00:00:00'));

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

  const latitud  = latVal ? parseFloat(latVal)  : null;
  const longitud = lngVal ? parseFloat(lngVal)  : null;

  setLoading('btn-otc-label', 'Creando…', true);
  try {
    const data = {
      wo, tipo, cliente, direccion: dir,
      tecnicoDestino:    tec,
      fechaIngreso,
      latitud,
      longitud,
      estadoCampo:       null,
      actualizadaDelsur: false,
      fechaPago,
      diasHabilesLimite: tipo === 'servicio_nuevo' ? 5 : tipo === 'cambio_voltaje' ? 10 : null,
    };
    const ref = await db.collection('otc_ordenes').add(data);
    ordenes_.push({ id: ref.id, ...data });
    closeSheet('sheet-nueva-otc');

    // Limpiar formulario
    ['otc-wo','otc-cliente','otc-dir','otc-lat','otc-lng','otc-fecha-sap'].forEach(id => {
      const el = document.getElementById(id);
      if (el) el.value = '';
    });
    document.querySelectorAll('#otc-tipo-row .select-chip, #otc-tec-row .select-chip').forEach(c => c.classList.remove('active'));

    renderTab();
    toast('Orden creada', 'ok');
  } catch (err) {
    console.error('[otc] Error creando orden:', err);
    errEl.textContent = `Error: ${err.message}`;
    errEl.style.display = 'block';
  } finally {
    setLoading('btn-otc-label', 'Crear orden', false);
  }
}

// ── Reasignar orden ───────────────────────────────
let _reasignarId = null;

function reasignar(id) {
  const o = ordenes_.find(x => x.id === id);
  if (!o) return;
  _reasignarId = id;
  document.getElementById('sheet-reasignar-title').textContent = `Reasignar WO ${o.wo || '—'}`;
  // Pre-seleccionar técnico actual
  document.querySelectorAll('#reasignar-tec-row .select-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.val === o.tecnicoDestino);
  });
  document.getElementById('reasignar-error').style.display = 'none';
  closeSheet('sheet-otc-detalle');
  openSheet('sheet-reasignar');
}

async function confirmarReasignar() {
  const tec = getSelectedChip('reasignar-tec-row');
  if (!tec) {
    document.getElementById('reasignar-error').textContent = 'Selecciona un técnico.';
    document.getElementById('reasignar-error').style.display = 'block';
    return;
  }
  setLoading('btn-reasignar-label', 'Guardando…', true);
  try {
    await db.collection('otc_ordenes').doc(_reasignarId).update({ tecnicoDestino: tec });
    const o = ordenes_.find(x => x.id === _reasignarId);
    if (o) o.tecnicoDestino = tec;
    closeSheet('sheet-reasignar');
    renderTab();
    toast(`Orden reasignada a ${tec}`, 'ok');
  } catch (err) {
    document.getElementById('reasignar-error').textContent = 'Error al guardar.';
    document.getElementById('reasignar-error').style.display = 'block';
  } finally {
    setLoading('btn-reasignar-label', 'Confirmar reasignación', false);
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
