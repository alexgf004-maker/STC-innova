/**
 * js/views/bodega.js
 * Módulo Bodega / Kardex
 * Exporta: init(container, session)
 */

import { db } from '../firebase.js';
import { toast } from '../ui.js';

let container_, session_, role_, area_, uid_;
let items_ = [], solicitudes_ = [], despachos_ = [];
let activeTab_ = 'inventario';
let areaFiltro_ = 'CM'; // toggle admin

// ── Entry point ───────────────────────────────────
export async function init(container, session) {
  container_ = container;
  session_   = session;
  role_      = session.role;
  area_      = session.asignacionActual?.area || null;
  uid_       = session.uid;
  activeTab_ = role_ === 'tecnico' ? 'material' : 'inventario';
  areaFiltro_= area_ || 'CM';

  renderShell();
  await loadData();
}

// ── Shell ─────────────────────────────────────────
function renderShell() {
  const isTecnico = role_ === 'tecnico';
  const tabs = isTecnico
    ? [{ id:'material', label:'Mi material' }, { id:'solicitar', label:'Solicitar' }, { id:'historial', label:'Historial' }]
    : [{ id:'inventario', label:'Inventario' }, { id:'solicitudes', label:'Solicitudes' }, { id:'despachos', label:'Despachos' }];

  container_.innerHTML = `
    <div class="cambios-tabs">
      ${tabs.map(t => `
        <div class="cambios-tab bod ${t.id === activeTab_ ? 'active' : ''}" data-tab="${t.id}">${t.label}</div>
      `).join('')}
    </div>
    <div id="bod-content" style="padding-top:12px">
      <div class="loading-placeholder">
        <div class="loading-bar"></div><div class="loading-bar short"></div><div class="loading-bar"></div>
      </div>
    </div>

    <!-- Sheet nueva solicitud -->
    <div class="sheet-backdrop" id="sheet-solicitar">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Solicitar material</div>
        <div class="sheet-body" id="sheet-solicitar-body"></div>
      </div>
    </div>

    <!-- Sheet nueva entrada -->
    <div class="sheet-backdrop" id="sheet-entrada">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Registrar entrada</div>
        <div class="sheet-body" id="sheet-entrada-body"></div>
      </div>
    </div>

    <!-- Sheet nuevo item -->
    <div class="sheet-backdrop" id="sheet-item">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title" id="sheet-item-title">Nuevo item</div>
        <div class="sheet-body">
          <div class="form-field">
            <div class="form-label">Nombre</div>
            <input class="form-input" id="item-nombre" type="text" placeholder="Ej: Medidor monofásico"/>
          </div>
          <div class="form-field">
            <div class="form-label">Código SAP</div>
            <input class="form-input" id="item-sap" type="text" placeholder="Código SAP"/>
          </div>
          <div class="form-field">
            <div class="form-label">Código AX</div>
            <input class="form-input" id="item-ax" type="text" placeholder="Código AX (opcional)"/>
          </div>
          <div class="form-field">
            <div class="form-label">Área</div>
            <div class="select-row" id="item-area-row">
              <div class="select-chip" data-val="CM">CM</div>
              <div class="select-chip" data-val="OTC">OTC</div>
            </div>
          </div>
          <div class="form-field">
            <div class="form-label">Unidad de medida</div>
            <div class="select-row" id="item-unidad-row">
              <div class="select-chip" data-val="unidades">Unidades</div>
              <div class="select-chip" data-val="metros">Metros</div>
              <div class="select-chip" data-val="rollos">Rollos</div>
            </div>
          </div>
          <div class="form-field">
            <div class="form-label">Stock mínimo</div>
            <input class="form-input" id="item-minimo" type="number" min="0" placeholder="0"/>
          </div>
          <div id="item-error" class="form-error"></div>
          <button class="btn-primary full bod" onclick="window.__bodega.guardarItem()">
            <span id="btn-item-label">Guardar item</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Sheet rechazar solicitud -->
    <div class="sheet-backdrop" id="sheet-rechazar">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Rechazar solicitud</div>
        <div class="sheet-body">
          <div class="form-label" style="margin-bottom:8px">Motivo (opcional)</div>
          <input class="form-input" id="rechazo-motivo" type="text" placeholder="Indica el motivo del rechazo…" style="margin-bottom:16px"/>
          <button class="btn-action danger full" style="height:46px" onclick="window.__bodega.confirmarRechazo()">
            <span id="btn-rechazo-label">Confirmar rechazo</span>
          </button>
        </div>
      </div>
    </div>
  `;

  tabs.forEach(t => {
    document.querySelector(`.cambios-tab.bod[data-tab="${t.id}"]`)?.addEventListener('click', () => {
      document.querySelectorAll('.cambios-tab.bod').forEach(x => x.classList.remove('active'));
      document.querySelector(`.cambios-tab.bod[data-tab="${t.id}"]`).classList.add('active');
      activeTab_ = t.id;
      renderTab();
    });
  });

  ['sheet-solicitar','sheet-entrada','sheet-item','sheet-rechazar'].forEach(id => {
    document.getElementById(id)?.addEventListener('click', e => {
      if (e.target === document.getElementById(id)) closeSheet(id);
    });
  });

  setupSelectChips('item-area-row');
  setupSelectChips('item-unidad-row');

  window.__bodega = {
    abrirSolicitar, enviarSolicitud,
    abrirEntrada, guardarEntrada,
    abrirItem, guardarItem,
    aprobarSolicitud, rechazarSolicitud, confirmarRechazo,
    verDespacho, toggleArea,
  };
}

// ── Cargar datos ──────────────────────────────────
async function loadData() {
  try {
    const [itemsSnap, solicSnap, despacSnap] = await Promise.all([
      db.collection('kardex').doc('inventario').collection('items').get(),
      db.collection('solicitudes_material').get(),
      db.collection('despachos').get(),
    ]);

    items_      = itemsSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    solicitudes_= solicSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    despachos_  = despacSnap.docs.map(d => ({ id: d.id, ...d.data() }));

    renderTab();
  } catch (err) {
    console.error('[bodega] Error cargando datos:', err);
    document.getElementById('bod-content').innerHTML = `
      <div class="dev-module"><div class="dev-title">Error al cargar</div><p>Verifica tu conexión.</p></div>`;
  }
}

// ── Render tab ────────────────────────────────────
function renderTab() {
  switch (activeTab_) {
    case 'material':   renderMiMaterial();   break;
    case 'solicitar':  renderFormSolicitar(); break;
    case 'historial':  renderHistorial();    break;
    case 'inventario': renderInventario();   break;
    case 'solicitudes':renderSolicitudes();  break;
    case 'despachos':  renderDespachos();    break;
  }
}

// ══════════════════════════════════════════════════
// VISTA TÉCNICO
// ══════════════════════════════════════════════════

// ── Mi material ───────────────────────────────────
function renderMiMaterial() {
  const content = document.getElementById('bod-content');
  // Items del área del técnico
  const misItems = items_.filter(o => o.area === area_);

  content.innerHTML = `
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div>
          <div class="section-title">Mi material</div>
          <div class="section-sub">Área ${area_ || '—'} · ${misItems.length} items</div>
        </div>
        <button class="icon-btn bod" onclick="window.__bodega.abrirSolicitar()" title="Solicitar material">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      ${!misItems.length ? `
      <div class="dev-module anim-up d1">
        <div class="dev-title">Sin items registrados</div>
        <p>No hay material registrado para el área ${area_}.</p>
      </div>` : `
      <div class="flex-col gap-8 anim-up d1">
        ${misItems.map(item => renderItemCard(item)).join('')}
      </div>`}
    </div>
  `;
}

function renderItemCard(item, showActions = false) {
  const bajo    = item.stock <= item.stockMinimo;
  const agotado = item.stock === 0;
  const color   = agotado ? '#ef4444' : bajo ? '#fbbf24' : 'var(--ok)';
  const bg      = agotado ? 'rgba(239,68,68,.06)'  : bajo ? 'rgba(245,158,11,.06)' : 'var(--glass)';
  const border  = agotado ? 'rgba(239,68,68,.25)'  : bajo ? 'rgba(245,158,11,.25)' : 'var(--border)';

  return `
    <div class="bod-item-card" style="background:${bg};border-color:${border}">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap">
          <div style="font-size:13px;font-weight:700">${item.nombre}</div>
          ${agotado ? '<div class="bod-badge crit">Agotado</div>' : bajo ? '<div class="bod-badge warn">Stock bajo</div>' : ''}
        </div>
        <div style="font-size:10px;color:var(--text-4);margin-top:3px">
          ${item.codigoSAP ? `SAP: ${item.codigoSAP}` : ''}
          ${item.codigoAX  ? ` · AX: ${item.codigoAX}` : ''}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:20px;font-weight:800;color:${color}">${item.stock}</div>
        <div style="font-size:10px;color:var(--text-4)">${item.unidad || 'unidades'}</div>
      </div>
      ${showActions ? `
      <div style="display:flex;gap:6px;margin-top:8px;width:100%">
        <button class="icon-btn" style="flex:1;height:36px;font-size:11px;font-family:'Outfit',sans-serif" onclick="window.__bodega.abrirEntrada('${item.id}')">+ Entrada</button>
        <button class="icon-btn" style="flex:1;height:36px;font-size:11px;font-family:'Outfit',sans-serif" onclick="window.__bodega.abrirItem('${item.id}')">Editar</button>
      </div>` : ''}
    </div>
  `;
}

// ── Solicitar ─────────────────────────────────────
function renderFormSolicitar() {
  const content  = document.getElementById('bod-content');
  const misItems = items_.filter(o => o.area === area_);

  content.innerHTML = `
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div class="section-title">Nueva solicitud</div>
      </div>

      <div class="anim-up d1">
        <div class="section-label" style="margin-bottom:10px">Selecciona materiales y cantidades</div>
        <div class="flex-col gap-8" id="solicitar-items">
          ${misItems.map(item => `
            <div class="bod-solicitar-row">
              <div style="flex:1;min-width:0">
                <div style="font-size:13px;font-weight:600">${item.nombre}</div>
                <div style="font-size:10px;color:var(--text-4)">Stock: ${item.stock} ${item.unidad || 'unidades'}</div>
              </div>
              <input class="form-input" id="cant-${item.id}" type="number" min="0" value="0"
                     style="width:72px;text-align:center;" placeholder="0"/>
            </div>
          `).join('')}
        </div>
      </div>

      <div class="anim-up d2">
        <div class="form-label" style="margin-bottom:8px">Notas (opcional)</div>
        <input class="form-input" id="solicitar-notas" type="text" placeholder="Observaciones adicionales…"/>
      </div>

      <div id="solicitar-error" class="form-error anim-up d2"></div>
      <button class="btn-primary full bod anim-up d2" onclick="window.__bodega.enviarSolicitud()">
        <span id="btn-solicitar-label">Enviar solicitud</span>
      </button>
    </div>
  `;
}

async function enviarSolicitud() {
  const misItems  = items_.filter(o => o.area === area_);
  const materiales = misItems
    .map(item => ({ itemId: item.id, nombre: item.nombre, cantidad: parseInt(document.getElementById(`cant-${item.id}`)?.value || '0') }))
    .filter(m => m.cantidad > 0);

  const errEl = document.getElementById('solicitar-error');
  errEl.style.display = 'none';

  if (!materiales.length) {
    errEl.textContent = 'Agrega al menos un material con cantidad mayor a 0.';
    errEl.style.display = 'block';
    return;
  }

  setLoading('btn-solicitar-label', 'Enviando…', true);
  try {
    const data = {
      usuarioUid:    uid_,
      usuarioNombre: session_.displayName,
      area:          area_,
      materiales,
      estado:        'pendiente',
      fecha:         firebase.firestore.Timestamp.now(),
      aprobadoPor:   null,
      fechaAprobacion: null,
      notas:         document.getElementById('solicitar-notas').value.trim() || null,
    };
    const ref = await db.collection('solicitudes_material').add(data);
    solicitudes_.push({ id: ref.id, ...data });
    toast('Solicitud enviada', 'ok');
    // Cambiar a historial
    activeTab_ = 'historial';
    document.querySelectorAll('.cambios-tab.bod').forEach(t => t.classList.remove('active'));
    document.querySelector('.cambios-tab.bod[data-tab="historial"]')?.classList.add('active');
    renderTab();
  } catch (err) {
    console.error('[bodega] Error enviando solicitud:', err);
    errEl.textContent = `Error: ${err.message}`;
    errEl.style.display = 'block';
  } finally {
    setLoading('btn-solicitar-label', 'Enviar solicitud', false);
  }
}

// ── Historial técnico ─────────────────────────────
function renderHistorial() {
  const content = document.getElementById('bod-content');
  const misSolic = solicitudes_
    .filter(s => s.usuarioUid === uid_)
    .sort((a, b) => (b.fecha?.seconds || 0) - (a.fecha?.seconds || 0));

  content.innerHTML = `
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div class="section-title">Mis solicitudes</div>
      </div>

      ${!misSolic.length ? `
      <div class="dev-module anim-up d1">
        <div class="dev-title">Sin solicitudes</div>
        <p>Aún no has realizado ninguna solicitud de material.</p>
      </div>` : `
      <div class="flex-col gap-8 anim-up d1">
        ${misSolic.map(s => renderSolicitudCard(s, false)).join('')}
      </div>`}
    </div>
  `;
}

function renderSolicitudCard(s, showActions = true) {
  const estadoConfig = {
    pendiente: { color: '#fbbf24', bg: 'rgba(245,158,11,.06)', border: 'rgba(245,158,11,.2)', label: 'Pendiente' },
    aprobada:  { color: '#22c55e', bg: 'rgba(34,197,94,.06)',  border: 'rgba(34,197,94,.2)',  label: 'Aprobada'  },
    rechazada: { color: '#ef4444', bg: 'rgba(239,68,68,.06)',  border: 'rgba(239,68,68,.2)',  label: 'Rechazada' },
  }[s.estado] || { color: 'var(--text-4)', bg: 'var(--glass)', border: 'var(--border)', label: s.estado };

  return `
    <div class="bod-solic-card" style="background:${estadoConfig.bg};border-color:${estadoConfig.border}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
        <div>
          <div style="font-size:12px;font-weight:700">${s.usuarioNombre || '—'}</div>
          <div style="font-size:10px;color:var(--text-4)">${formatDate(s.fecha)} · Área ${s.area || '—'}</div>
        </div>
        <div class="bod-badge" style="color:${estadoConfig.color};border-color:${estadoConfig.color}33;background:${estadoConfig.color}11">
          ${estadoConfig.label}
        </div>
      </div>

      <div class="flex-col gap-4" style="margin-bottom:${showActions && s.estado === 'pendiente' ? '12px' : '0'}">
        ${(s.materiales || []).map(m => `
          <div style="display:flex;justify-content:space-between;font-size:12px">
            <span style="color:var(--text-2)">${m.nombre}</span>
            <span style="font-weight:700;color:var(--text)">${m.cantidad} ${getUnidadItem(m.itemId)}</span>
          </div>`).join('')}
      </div>

      ${s.notas ? `<div style="font-size:11px;color:var(--text-4);font-style:italic;margin-bottom:8px">${s.notas}</div>` : ''}
      ${s.estado === 'rechazada' && s.notas ? `<div style="font-size:11px;color:#f87171">Motivo: ${s.notas}</div>` : ''}

      ${showActions && s.estado === 'pendiente' ? `
      <div style="display:flex;gap:8px">
        <button class="btn-action cm full" style="flex:1;height:40px;font-size:12px;border-color:var(--bod-border);background:var(--bod-glass);color:var(--bod-light)"
                onclick="window.__bodega.aprobarSolicitud('${s.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Aprobar
        </button>
        <button class="btn-action danger" style="flex:1;height:40px;font-size:12px"
                onclick="window.__bodega.rechazarSolicitud('${s.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/></svg>
          Rechazar
        </button>
      </div>` : ''}

      ${s.aprobadoPor ? `
      <div style="font-size:10px;color:var(--text-4);margin-top:6px">
        ${s.estado === 'aprobada' ? 'Aprobada' : 'Respondida'} por ${s.aprobadoPor} · ${formatDate(s.fechaAprobacion)}
      </div>` : ''}
    </div>
  `;
}

// ══════════════════════════════════════════════════
// VISTA ADMIN/ASISTENTE
// ══════════════════════════════════════════════════

// ── Inventario ────────────────────────────────────
function renderInventario() {
  const content  = document.getElementById('bod-content');
  const itemsFiltrados = items_.filter(o => o.area === areaFiltro_);
  const bajos    = itemsFiltrados.filter(i => i.stock <= i.stockMinimo && i.stock > 0).length;
  const agotados = itemsFiltrados.filter(i => i.stock === 0).length;

  content.innerHTML = `
    <div class="flex-col gap-12">

      <div class="panel-header anim-up">
        <div>
          <div class="section-title">Inventario</div>
          <div class="section-sub">${itemsFiltrados.length} items · ${agotados ? `${agotados} agotados · ` : ''}${bajos} con stock bajo</div>
        </div>
        <button class="icon-btn bod" onclick="window.__bodega.abrirItem()" title="Nuevo item">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      <!-- Toggle área -->
      <div class="bod-toggle anim-up d1">
        <div class="bod-toggle-btn ${areaFiltro_ === 'CM' ? 'active' : ''}" onclick="window.__bodega.toggleArea('CM')">CM — Cambios</div>
        <div class="bod-toggle-btn ${areaFiltro_ === 'OTC' ? 'active' : ''}" onclick="window.__bodega.toggleArea('OTC')">OTC</div>
      </div>

      <!-- Alertas -->
      ${agotados ? `
      <div class="otc-alert-card crit anim-up d2">
        <div class="otc-alert-header">🔴 ${agotados} item${agotados>1?'s':''} agotado${agotados>1?'s':''}</div>
      </div>` : ''}
      ${bajos ? `
      <div class="otc-alert-card warn anim-up d2">
        <div class="otc-alert-header">⚠ ${bajos} item${bajos>1?'s':''} con stock bajo</div>
      </div>` : ''}

      <!-- Lista items -->
      <div class="flex-col gap-8 anim-up d2">
        ${!itemsFiltrados.length
          ? `<div class="dev-module"><div class="dev-title">Sin items</div><p>No hay items registrados para ${areaFiltro_}.</p></div>`
          : itemsFiltrados
              .sort((a,b) => (a.stock <= a.stockMinimo ? -1 : 1))
              .map(item => renderItemCard(item, true)).join('')
        }
      </div>

    </div>
  `;
}

function toggleArea(area) {
  areaFiltro_ = area;
  renderInventario();
}

// ── Solicitudes ───────────────────────────────────
function renderSolicitudes() {
  const content   = document.getElementById('bod-content');
  const pendientes= solicitudes_.filter(s => s.estado === 'pendiente')
    .sort((a,b) => (b.fecha?.seconds||0) - (a.fecha?.seconds||0));
  const resto     = solicitudes_.filter(s => s.estado !== 'pendiente')
    .sort((a,b) => (b.fecha?.seconds||0) - (a.fecha?.seconds||0));

  content.innerHTML = `
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div>
          <div class="section-title">Solicitudes</div>
          <div class="section-sub">${pendientes.length} pendientes · ${resto.length} respondidas</div>
        </div>
      </div>

      ${!solicitudes_.length ? `
      <div class="dev-module anim-up d1">
        <div class="dev-title">Sin solicitudes</div>
        <p>No se han registrado solicitudes de material.</p>
      </div>` : ''}

      ${pendientes.length ? `
      <div class="section-label anim-up d1">Pendientes de aprobación</div>
      <div class="flex-col gap-8 anim-up d1">
        ${pendientes.map(s => renderSolicitudCard(s, true)).join('')}
      </div>` : ''}

      ${resto.length ? `
      <div class="section-label anim-up d2">Respondidas</div>
      <div class="flex-col gap-8 anim-up d2">
        ${resto.map(s => renderSolicitudCard(s, false)).join('')}
      </div>` : ''}
    </div>
  `;
}

let _solicitudIdPendiente = null;

async function aprobarSolicitud(id) {
  const s = solicitudes_.find(x => x.id === id);
  if (!s) return;

  setLoadingById(`btn-aprobacion-${id}`, 'Procesando…', true);
  try {
    const now = firebase.firestore.Timestamp.now();

    // 1. Descontar stock de cada item
    const batch = db.batch();
    for (const m of s.materiales) {
      const item = items_.find(i => i.id === m.itemId);
      if (!item) continue;
      const nuevoStock = Math.max(0, (item.stock || 0) - m.cantidad);
      const ref = db.collection('kardex').doc('inventario').collection('items').doc(m.itemId);
      batch.update(ref, { stock: nuevoStock });
    }

    // 2. Registrar consumo
    const consumoRef = db.collection('kardex').doc('movimientos').collection('consumos').doc();
    batch.set(consumoRef, {
      solicitudId:   id,
      usuarioUid:    s.usuarioUid,
      usuarioNombre: s.usuarioNombre,
      area:          s.area,
      materiales:    s.materiales,
      fecha:         now,
      aprobadoPor:   session_.displayName,
    });

    // 3. Crear despacho
    const despachoRef = db.collection('despachos').doc();
    const despachoData = {
      solicitudId:   id,
      usuarioUid:    s.usuarioUid,
      usuarioNombre: s.usuarioNombre,
      area:          s.area,
      materiales:    s.materiales,
      fecha:         now,
      aprobadoPor:   session_.displayName,
      notas:         s.notas || null,
    };
    batch.set(despachoRef, despachoData);

    // 4. Actualizar solicitud
    batch.update(db.collection('solicitudes_material').doc(id), {
      estado:          'aprobada',
      aprobadoPor:     session_.displayName,
      fechaAprobacion: now,
    });

    await batch.commit();

    // Actualizar local
    const sIdx = solicitudes_.findIndex(x => x.id === id);
    if (sIdx !== -1) {
      solicitudes_[sIdx] = { ...solicitudes_[sIdx], estado: 'aprobada', aprobadoPor: session_.displayName, fechaAprobacion: now };
    }
    for (const m of s.materiales) {
      const iIdx = items_.findIndex(i => i.id === m.itemId);
      if (iIdx !== -1) items_[iIdx].stock = Math.max(0, (items_[iIdx].stock || 0) - m.cantidad);
    }
    despachos_.push({ id: despachoRef.id, ...despachoData });

    renderTab();
    toast('Solicitud aprobada — stock actualizado', 'ok');
  } catch (err) {
    console.error('[bodega] Error aprobando:', err);
    toast('Error al aprobar', 'error');
  }
}

function rechazarSolicitud(id) {
  _solicitudIdPendiente = id;
  document.getElementById('rechazo-motivo').value = '';
  openSheet('sheet-rechazar');
}

async function confirmarRechazo() {
  const id     = _solicitudIdPendiente;
  const motivo = document.getElementById('rechazo-motivo').value.trim();
  if (!id) return;

  setLoading('btn-rechazo-label', 'Rechazando…', true);
  try {
    const now = firebase.firestore.Timestamp.now();
    await db.collection('solicitudes_material').doc(id).update({
      estado:          'rechazada',
      aprobadoPor:     session_.displayName,
      fechaAprobacion: now,
      notas:           motivo || null,
    });
    const idx = solicitudes_.findIndex(x => x.id === id);
    if (idx !== -1) solicitudes_[idx] = { ...solicitudes_[idx], estado: 'rechazada', aprobadoPor: session_.displayName, notas: motivo };
    closeSheet('sheet-rechazar');
    renderTab();
    toast('Solicitud rechazada', 'warn');
  } catch (err) {
    toast('Error al rechazar', 'error');
  } finally {
    setLoading('btn-rechazo-label', 'Confirmar rechazo', false);
  }
}

// ── Despachos ─────────────────────────────────────
function renderDespachos() {
  const content = document.getElementById('bod-content');
  const sorted  = [...despachos_].sort((a,b) => (b.fecha?.seconds||0) - (a.fecha?.seconds||0));

  content.innerHTML = `
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div>
          <div class="section-title">Despachos</div>
          <div class="section-sub">${sorted.length} memos generados</div>
        </div>
      </div>

      ${!sorted.length ? `
      <div class="dev-module anim-up d1">
        <div class="dev-title">Sin despachos</div>
        <p>Aún no se han generado memos de despacho.</p>
      </div>` : `
      <div class="flex-col gap-8 anim-up d1">
        ${sorted.map(d => `
          <div class="bod-solic-card" onclick="window.__bodega.verDespacho('${d.id}')">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
              <div>
                <div style="font-size:13px;font-weight:700">${d.usuarioNombre || '—'}</div>
                <div style="font-size:10px;color:var(--text-4)">${formatDate(d.fecha)} · Área ${d.area || '—'}</div>
              </div>
              <div class="bod-badge" style="color:var(--bod-light);border-color:var(--bod-border);background:var(--bod-glass)">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="10" height="10" style="margin-right:3px"><path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/></svg>
                PDF
              </div>
            </div>
            <div class="flex-col gap-3">
              ${(d.materiales||[]).map(m => `
                <div style="display:flex;justify-content:space-between;font-size:11px">
                  <span style="color:var(--text-3)">${m.nombre}</span>
                  <span style="font-weight:600">${m.cantidad} ${getUnidadItem(m.itemId)}</span>
                </div>`).join('')}
            </div>
          </div>
        `).join('')}
      </div>`}
    </div>
  `;
}

// ── Generar PDF despacho ──────────────────────────
function verDespacho(id) {
  const d = despachos_.find(x => x.id === id);
  if (!d) return;
  generarPDFDespacho(d);
}

function generarPDFDespacho(d) {
  try {
    const { jsPDF } = window.jspdf;
    const doc = new jsPDF({ unit: 'mm', format: 'letter' });
    const fecha = d.fecha?.toDate ? d.fecha.toDate() : new Date();
    const fechaStr = fecha.toLocaleDateString('es-SV', { day:'2-digit', month:'long', year:'numeric' });

    // Header
    doc.setFillColor(7, 89, 133);
    doc.rect(0, 0, 216, 30, 'F');
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(16); doc.setFont('helvetica', 'bold');
    doc.text('INNOVA STC — DELSUR', 14, 12);
    doc.setFontSize(10); doc.setFont('helvetica', 'normal');
    doc.text('Memo de Despacho de Material', 14, 20);
    doc.text(`Fecha: ${fechaStr}`, 140, 12);

    // Info despacho
    doc.setTextColor(30, 30, 30);
    doc.setFontSize(11); doc.setFont('helvetica', 'bold');
    doc.text('Información del despacho', 14, 42);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10);
    doc.text(`Técnico receptor: ${d.usuarioNombre || '—'}`, 14, 52);
    doc.text(`Área: ${d.area || '—'}`, 14, 60);
    doc.text(`Aprobado por: ${d.aprobadoPor || '—'}`, 14, 68);
    if (d.notas) doc.text(`Notas: ${d.notas}`, 14, 76);

    // Tabla materiales
    const startY = d.notas ? 88 : 80;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('Materiales despachados', 14, startY);

    // Encabezados tabla
    doc.setFillColor(230, 240, 250);
    doc.rect(14, startY + 4, 188, 8, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(9);
    doc.setTextColor(30, 30, 30);
    doc.text('Material', 16, startY + 10);
    doc.text('Código SAP', 100, startY + 10);
    doc.text('Cantidad', 155, startY + 10);
    doc.text('Unidad', 180, startY + 10);

    // Filas
    doc.setFont('helvetica', 'normal');
    let y = startY + 20;
    (d.materiales || []).forEach((m, i) => {
      const item = items_.find(it => it.id === m.itemId);
      if (i % 2 === 0) { doc.setFillColor(248,250,252); doc.rect(14, y-5, 188, 8, 'F'); }
      doc.text(m.nombre || '—', 16, y);
      doc.text(item?.codigoSAP || '—', 100, y);
      doc.text(String(m.cantidad), 157, y);
      doc.text(item?.unidad || 'unidades', 180, y);
      y += 10;
    });

    // Línea de firma
    y += 20;
    doc.setDrawColor(150,150,150);
    doc.line(14, y, 100, y);
    doc.line(116, y, 202, y);
    doc.setFontSize(9);
    doc.text('Firma técnico receptor', 14, y + 6);
    doc.text('Firma responsable bodega', 116, y + 6);

    // Footer
    doc.setFontSize(8); doc.setTextColor(150,150,150);
    doc.text('INNOVA STC — DELSUR · Generado automáticamente', 14, 270);
    doc.text(`Ref: ${d.id}`, 14, 276);

    doc.save(`despacho_${d.usuarioNombre?.replace(/ /g,'_')}_${fechaStr.replace(/ /g,'_')}.pdf`);
    toast('PDF generado', 'ok');
  } catch (err) {
    console.error('[bodega] Error generando PDF:', err);
    toast('Error al generar PDF — verifica que jsPDF esté cargado', 'error');
  }
}

// ── Entrada de material ───────────────────────────
function abrirEntrada(itemId) {
  const item = items_.find(i => i.id === itemId);
  document.getElementById('sheet-entrada-body').innerHTML = `
    <div class="flex-col gap-12">
      <div style="background:var(--glass);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px">
        <div style="font-size:14px;font-weight:700">${item?.nombre || '—'}</div>
        <div style="font-size:11px;color:var(--text-4);margin-top:3px">Stock actual: ${item?.stock || 0} ${item?.unidad || 'unidades'}</div>
      </div>
      <div class="form-field">
        <div class="form-label">Cantidad a ingresar</div>
        <input class="form-input" id="entrada-cantidad" type="number" min="1" placeholder="0"/>
      </div>
      <div class="form-field">
        <div class="form-label">Referencia / Nota</div>
        <input class="form-input" id="entrada-ref" type="text" placeholder="Ej: Factura 1234"/>
      </div>
      <div id="entrada-error" class="form-error"></div>
      <button class="btn-primary full bod" onclick="window.__bodega.guardarEntrada('${itemId}')">
        <span id="btn-entrada-label">Registrar entrada</span>
      </button>
    </div>
  `;
  openSheet('sheet-entrada');
}

async function guardarEntrada(itemId) {
  const cantidad = parseInt(document.getElementById('entrada-cantidad').value || '0');
  const ref      = document.getElementById('entrada-ref').value.trim();
  const errEl    = document.getElementById('entrada-error');
  errEl.style.display = 'none';

  if (!cantidad || cantidad <= 0) {
    errEl.textContent = 'Ingresa una cantidad válida.';
    errEl.style.display = 'block';
    return;
  }

  setLoading('btn-entrada-label', 'Guardando…', true);
  try {
    const item = items_.find(i => i.id === itemId);
    const nuevoStock = (item?.stock || 0) + cantidad;
    const now  = firebase.firestore.Timestamp.now();

    const batch = db.batch();
    batch.update(db.collection('kardex').doc('inventario').collection('items').doc(itemId), { stock: nuevoStock });
    const entRef = db.collection('kardex').doc('movimientos').collection('entradas').doc();
    batch.set(entRef, { itemId, cantidad, referencia: ref || null, fecha: now, registradoPor: session_.displayName });
    await batch.commit();

    const idx = items_.findIndex(i => i.id === itemId);
    if (idx !== -1) items_[idx].stock = nuevoStock;
    closeSheet('sheet-entrada');
    renderTab();
    toast(`Entrada registrada — nuevo stock: ${nuevoStock}`, 'ok');
  } catch (err) {
    errEl.textContent = `Error: ${err.message}`;
    errEl.style.display = 'block';
  } finally {
    setLoading('btn-entrada-label', 'Registrar entrada', false);
  }
}

// ── Nuevo / Editar item ───────────────────────────
let _editItemId = null;

function abrirItem(itemId = null) {
  _editItemId = itemId || null;
  const item  = itemId ? items_.find(i => i.id === itemId) : null;

  document.getElementById('sheet-item-title').textContent = item ? 'Editar item' : 'Nuevo item';
  document.getElementById('item-nombre').value  = item?.nombre    || '';
  document.getElementById('item-sap').value     = item?.codigoSAP || '';
  document.getElementById('item-ax').value      = item?.codigoAX  || '';
  document.getElementById('item-minimo').value  = item?.stockMinimo ?? '';
  document.getElementById('item-error').style.display = 'none';

  document.querySelectorAll('#item-area-row .select-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.val === (item?.area || areaFiltro_));
  });
  document.querySelectorAll('#item-unidad-row .select-chip').forEach(c => {
    c.classList.toggle('active', c.dataset.val === (item?.unidad || 'unidades'));
  });

  openSheet('sheet-item');
}

async function guardarItem() {
  const nombre  = document.getElementById('item-nombre').value.trim();
  const sap     = document.getElementById('item-sap').value.trim();
  const ax      = document.getElementById('item-ax').value.trim();
  const area    = getSelectedChip('item-area-row');
  const unidad  = getSelectedChip('item-unidad-row');
  const minimo  = parseInt(document.getElementById('item-minimo').value || '0');
  const errEl   = document.getElementById('item-error');
  errEl.style.display = 'none';

  if (!nombre || !area) {
    errEl.textContent = 'Nombre y área son obligatorios.';
    errEl.style.display = 'block';
    return;
  }

  setLoading('btn-item-label', 'Guardando…', true);
  try {
    const data = { nombre, codigoSAP: sap || null, codigoAX: ax || null, area, unidad: unidad || 'unidades', stockMinimo: minimo };

    if (_editItemId) {
      await db.collection('kardex').doc('inventario').collection('items').doc(_editItemId).update(data);
      const idx = items_.findIndex(i => i.id === _editItemId);
      if (idx !== -1) items_[idx] = { ...items_[idx], ...data };
      toast('Item actualizado', 'ok');
    } else {
      const ref = await db.collection('kardex').doc('inventario').collection('items').add({ ...data, stock: 0 });
      items_.push({ id: ref.id, ...data, stock: 0 });
      toast('Item creado', 'ok');
    }
    closeSheet('sheet-item');
    renderTab();
  } catch (err) {
    errEl.textContent = `Error: ${err.message}`;
    errEl.style.display = 'block';
  } finally {
    setLoading('btn-item-label', 'Guardar item', false);
  }
}

// ── Helpers ───────────────────────────────────────
function abrirSolicitar() {
  activeTab_ = 'solicitar';
  document.querySelectorAll('.cambios-tab.bod').forEach(t => t.classList.remove('active'));
  document.querySelector('.cambios-tab.bod[data-tab="solicitar"]')?.classList.add('active');
  renderTab();
}

function getUnidadItem(itemId) {
  return items_.find(i => i.id === itemId)?.unidad || 'unidades';
}

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

function setLoadingById(id, text, loading) {
  // No usado actualmente — placeholder para futuros botones individuales
}

function formatDate(ts) {
  if (!ts) return '—';
  const d = ts?.toDate ? ts.toDate() : new Date(ts);
  return d.toLocaleDateString('es-SV', { day:'2-digit', month:'short', year:'numeric' });
}
