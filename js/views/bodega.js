
/**
 * js/views/bodega.js — INNOVA STC v2
 * Reescritura fiel a kardex.js v4. Campos reales: name, unit, sapCode, axCode, minStock.
 */

import { db } from '../firebase.js';
import { toast } from '../ui.js';

// ── Constantes ────────────────────────────────────
const PLACAS = ['CPT-154','CPT-156','AU-250','AU-200','CNR-163','P568DA','P38DA6'];
const RESPONSABLES = ['NALVAR','RGONZA','JPEREZ'];
const CONTRATISTAS = ['INNOVA'];

// ── Helpers (iguales al original) ─────────────────
const safeNum = v => { const n = Number(v); return isNaN(n) ? 0 : n; };
const safeStr = (v, fb='—') => (v !== undefined && v !== null && String(v).trim()) ? String(v).trim() : fb;
const tc = str => safeStr(str).toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

function normalizeItem(raw) {
  return {
    ...raw,
    name:           safeStr(raw.name,'')    || safeStr(raw.nombre,''),
    unit:           safeStr(raw.unit,'')    || safeStr(raw.unidad,''),
    sapCode:        safeStr(raw.sapCode,''),
    axCode:         safeStr(raw.axCode,''),
    stock:          safeNum(raw.stock),
    minStock:       safeNum(raw.minStock || raw.stockMinimo || 5),
    requiereSerial: raw.requiereSerial === true,
    area:           raw.area || 'OTC',
  };
}

function esValido(item) {
  return safeStr(item.name,'') !== '' && safeStr(item.unit,'') !== '';
}

// ── Estado del módulo ─────────────────────────────
let container_, session_, role_, area_, uid_;
let allItems_    = []; // todos los items sin filtro
let salidas_     = [];
let solicitudes_ = [];
let activeTab_   = 'inventario';
let areaFiltro_  = 'OTC';

// ── Entry point ───────────────────────────────────
export async function init(container, session) {
  container_ = container;
  session_   = session;
  role_      = session.role;
  area_      = session.asignacionActual?.area || null;
  uid_       = session.uid;
  activeTab_ = role_ === 'tecnico' ? 'material' : 'inventario';
  areaFiltro_= area_ || localStorage.getItem('bod_area') || 'OTC';

  renderShell();
  await loadData();
}

// ── Shell ─────────────────────────────────────────
function renderShell() {
  const isTecnico = role_ === 'tecnico';
  const tabs = isTecnico
    ? [
        { id:'material',  label:'Mi material' },
        { id:'solicitar', label:'Solicitar'   },
        { id:'mis-solic', label:'Historial'   },
      ]
    : [
        { id:'inventario',  label:'Inventario'  },
        { id:'salidas',     label:'Despachos'   },
        { id:'solicitudes', label:'Solicitudes' },
      ];

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
  `;

  tabs.forEach(t => {
    container_.querySelector(`.cambios-tab.bod[data-tab="${t.id}"]`)?.addEventListener('click', () => {
      container_.querySelectorAll('.cambios-tab.bod').forEach(x => x.classList.remove('active'));
      container_.querySelector(`.cambios-tab.bod[data-tab="${t.id}"]`).classList.add('active');
      activeTab_ = t.id;
      renderTab();
    });
  });

  window.__bodega = {
    toggleArea, abrirDespacho, abrirSolicitar,
    aprobarSolicitud, rechazarSolicitud,
    abrirNuevoItem, abrirEntrada,
  };
}

// ── Cargar datos (sin where — filtrar en JS como el original) ─
async function loadData() {
  try {
    const [itemsSnap, salidasSnap, solicSnap] = await Promise.all([
      db.collection('kardex').doc('inventario').collection('items').get(),
      db.collection('kardex').doc('movimientos').collection('salidas').get(),
      db.collection('solicitudes_material').get(),
    ]);

    allItems_    = itemsSnap.docs.map(d => normalizeItem({ id: d.id, ...d.data() })).filter(esValido);
    salidas_     = salidasSnap.docs.map(d => ({ id: d.id, ...d.data() }));
    solicitudes_ = solicSnap.docs
      .map(d => ({ id: d.id, ...d.data() }))
      .sort((a,b) => (b.fecha?.seconds||0) - (a.fecha?.seconds||0));

    renderTab();
  } catch (err) {
    console.error('[bodega] Error cargando:', err);
    document.getElementById('bod-content').innerHTML = `
      <div class="dev-module"><div class="dev-title">Error al cargar</div><p>${err.message}</p></div>`;
  }
}

// ── Filtrar items por área ────────────────────────
function getItems(area) {
  return allItems_.filter(i => i.area === (area || areaFiltro_));
}

// ── Render tab ────────────────────────────────────
function renderTab() {
  switch (activeTab_) {
    case 'material':    renderMiMaterial();    break;
    case 'solicitar':   renderFormSolicitar(); break;
    case 'mis-solic':   renderMisSolicitudes();break;
    case 'inventario':  renderInventario();    break;
    case 'salidas':     renderSalidas();       break;
    case 'solicitudes': renderSolicitudes();   break;
  }
}

// ══════════════════════════════════════════════════
// VISTA TÉCNICO
// ══════════════════════════════════════════════════

// Mi material — calculado igual que el original (salidas - consumos del usuario)
function renderMiMaterial() {
  const content  = document.getElementById('bod-content');
  const usuario  = session_.asignacionActual?.destino || session_.displayName;

  // Stock del técnico = lo que le han despachado
  const stockU = {};
  salidas_.forEach(s => {
    const resp = s.usuarioResponsable || s.tecnicoNombre;
    if (resp !== usuario) return;
    (s.items||[]).forEach(item => {
      const cant = safeNum(item.cantidad);
      if (!item.itemId || cant <= 0) return;
      stockU[item.itemId] = (stockU[item.itemId] || 0) + cant;
    });
  });

  const misItems = Object.entries(stockU)
    .map(([id, cant]) => ({ cant, item: allItems_.find(i => i.id === id) }))
    .filter(e => e.cant > 0 && e.item)
    .sort((a,b) => safeStr(a.item.name).localeCompare(safeStr(b.item.name)));

  content.innerHTML = `
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div>
          <div class="section-title">Mi material</div>
          <div class="section-sub">${usuario} · ${misItems.length} items asignados</div>
        </div>
        <button class="icon-btn bod" onclick="window.__bodega.abrirSolicitar()">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>

      ${!misItems.length ? `
      <div class="dev-module anim-up d1">
        <div class="dev-title">Sin material asignado</div>
        <p>No tienes material despachado. Solicita a bodega.</p>
      </div>` : `
      <div class="flex-col gap-8 anim-up d1">
        ${misItems.map(e => {
          const bajo = e.cant <= e.item.minStock && e.cant > 0;
          return `
          <div class="bod-item-card" style="background:${bajo?'rgba(245,158,11,.06)':'var(--glass)'};border-color:${bajo?'rgba(245,158,11,.25)':'var(--border)'}">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
                <div style="font-size:13px;font-weight:700">${tc(e.item.name)}</div>
                ${bajo ? '<div class="bod-badge warn">Poco stock</div>' : ''}
                ${e.item.requiereSerial ? '<div class="bod-badge" style="color:var(--bod-light);border-color:var(--bod-border);background:var(--bod-glass)">Serial</div>' : ''}
              </div>
              <div style="font-size:10px;color:var(--text-4)">${e.item.sapCode?`SAP: ${e.item.sapCode}`:''}${e.item.axCode?` · AX: ${e.item.axCode}`:''}</div>
            </div>
            <div style="text-align:right;flex-shrink:0">
              <div style="font-size:22px;font-weight:800;color:${bajo?'#fbbf24':'#22c55e'}">${e.cant}</div>
              <div style="font-size:10px;color:var(--text-4)">${safeStr(e.item.unit,'')}</div>
            </div>
          </div>`;
        }).join('')}
      </div>`}
    </div>
  `;
}

// Solicitar material
function renderFormSolicitar() {
  const content  = document.getElementById('bod-content');
  const misItems = getItems(area_);

  content.innerHTML = `
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div class="section-title">Solicitar material</div>
      </div>
      <div class="anim-up d1">
        <div class="section-label" style="margin-bottom:10px">Selecciona cantidades</div>
        <div class="flex-col gap-8">
          ${!misItems.length
            ? `<div class="dev-module"><div class="dev-title">Sin items</div><p>No hay material registrado para ${area_}.</p></div>`
            : misItems.map(item => `
              <div class="bod-solicitar-row">
                <div style="flex:1;min-width:0">
                  <div style="font-size:13px;font-weight:600">${tc(item.name)}</div>
                  <div style="font-size:10px;color:var(--text-4)">
                    Stock: ${item.stock} ${safeStr(item.unit,'')}
                    ${item.sapCode ? ` · SAP: ${item.sapCode}` : ''}
                  </div>
                </div>
                <input class="form-input" id="scant-${item.id}" type="number" min="0" value="0"
                       style="width:72px;text-align:center;"/>
              </div>`).join('')}
        </div>
      </div>
      <div class="anim-up d2">
        <div class="form-label" style="margin-bottom:8px">Notas (opcional)</div>
        <input class="form-input" id="solic-notas" type="text" placeholder="Observaciones…"/>
      </div>
      <div id="solic-error" class="form-error"></div>
      <button class="btn-primary full bod anim-up d2" id="btn-solic">
        <span id="btn-solic-label">Enviar solicitud</span>
      </button>
    </div>
  `;

  document.getElementById('btn-solic').addEventListener('click', enviarSolicitud);
}

async function enviarSolicitud() {
  const misItems   = getItems(area_);
  const materiales = misItems
    .map(item => ({
      itemId:   item.id,
      nombre:   item.name,
      sapCode:  item.sapCode || null,
      unidad:   item.unit,
      cantidad: safeNum(document.getElementById(`scant-${item.id}`)?.value),
    }))
    .filter(m => m.cantidad > 0);

  const errEl = document.getElementById('solic-error');
  errEl.style.display = 'none';
  if (!materiales.length) {
    errEl.textContent = 'Agrega al menos un material con cantidad mayor a 0.';
    errEl.style.display = 'block';
    return;
  }

  setLoading('btn-solic-label', 'Enviando…', true);
  try {
    const data = {
      usuarioUid:    uid_,
      usuarioNombre: session_.displayName,
      area:          area_,
      materiales,
      estado:        'pendiente',
      fecha:         firebase.firestore.Timestamp.now(),
      aprobadoPor:   null, fechaAprobacion: null,
      notas:         document.getElementById('solic-notas').value.trim() || null,
    };
    const ref = await db.collection('solicitudes_material').add(data);
    solicitudes_.unshift({ id: ref.id, ...data });
    activeTab_ = 'mis-solic';
    container_.querySelectorAll('.cambios-tab.bod').forEach(t => t.classList.remove('active'));
    container_.querySelector('.cambios-tab.bod[data-tab="mis-solic"]')?.classList.add('active');
    renderTab();
    toast('Solicitud enviada', 'ok');
  } catch (err) {
    errEl.textContent = `Error: ${err.message}`; errEl.style.display = 'block';
  } finally {
    setLoading('btn-solic-label', 'Enviar solicitud', false);
  }
}

function renderMisSolicitudes() {
  const content  = document.getElementById('bod-content');
  const misSolic = solicitudes_.filter(s => s.usuarioUid === uid_);

  content.innerHTML = `
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div class="section-title">Mis solicitudes</div>
      </div>
      ${!misSolic.length
        ? `<div class="dev-module anim-up d1"><div class="dev-title">Sin solicitudes</div><p>Aún no has solicitado material.</p></div>`
        : `<div class="flex-col gap-8 anim-up d1">${misSolic.map(s => renderSolicitudCard(s, false)).join('')}</div>`}
    </div>
  `;
}

// ══════════════════════════════════════════════════
// VISTA ADMIN/ASISTENTE
// ══════════════════════════════════════════════════

function renderInventario() {
  const content   = document.getElementById('bod-content');
  const items     = getItems(areaFiltro_);
  const agotados  = items.filter(i => i.stock === 0).length;
  const bajos     = items.filter(i => i.stock > 0 && i.stock <= i.minStock).length;

  content.innerHTML = `
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div>
          <div class="section-title">Inventario</div>
          <div class="section-sub">${items.length} items · ${agotados} agotados · ${bajos} bajo mínimo</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="icon-btn bod" onclick="window.__bodega.abrirDespacho()" title="Nuevo despacho">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
              <path d="M5 12h14M12 5l7 7-7 7"/>
            </svg>
          </button>
          <button class="icon-btn bod" onclick="window.__bodega.abrirNuevoItem()" title="Nuevo item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
              <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
            </svg>
          </button>
        </div>
      </div>

      <div class="bod-toggle anim-up d1">
        <div class="bod-toggle-btn ${areaFiltro_==='OTC'    ? 'active' : ''}" onclick="window.__bodega.toggleArea('OTC')">OTC</div>
        <div class="bod-toggle-btn ${areaFiltro_==='CAMBIOS'? 'active' : ''}" onclick="window.__bodega.toggleArea('CAMBIOS')">CAMBIOS</div>
      </div>

      ${agotados ? `<div class="otc-alert-card crit anim-up d2"><div class="otc-alert-header">🔴 ${agotados} item${agotados>1?'s':''} agotado${agotados>1?'s':''}</div></div>` : ''}
      ${bajos    ? `<div class="otc-alert-card warn anim-up d2"><div class="otc-alert-header">⚠ ${bajos} item${bajos>1?'s':''} bajo stock mínimo</div></div>` : ''}

      <div class="flex-col gap-8 anim-up d2">
        ${!items.length
          ? `<div class="dev-module"><div class="dev-title">Sin items</div><p>No hay items para ${areaFiltro_}.</p></div>`
          : items.sort((a,b) => a.stock - b.stock).map(i => renderItemCard(i)).join('')}
      </div>
    </div>
  `;
}

function toggleArea(area) {
  areaFiltro_ = area;
  localStorage.setItem('bod_area', area);
  renderInventario();
}

function renderItemCard(item) {
  const bajo    = item.stock > 0 && item.stock <= item.minStock;
  const agotado = item.stock === 0;
  const color   = agotado ? '#ef4444' : bajo ? '#fbbf24' : '#22c55e';
  const bg      = agotado ? 'rgba(239,68,68,.06)'  : bajo ? 'rgba(245,158,11,.06)' : 'var(--glass)';
  const border  = agotado ? 'rgba(239,68,68,.25)'  : bajo ? 'rgba(245,158,11,.25)' : 'var(--border)';

  return `
    <div class="bod-item-card" style="background:${bg};border-color:${border}">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px">
          <div style="font-size:13px;font-weight:700">${tc(item.name)}</div>
          ${agotado ? '<div class="bod-badge crit">Agotado</div>' : bajo ? '<div class="bod-badge warn">Stock bajo</div>' : ''}
          ${item.requiereSerial ? '<div class="bod-badge" style="color:var(--bod-light);border-color:var(--bod-border);background:var(--bod-glass)">Serial</div>' : ''}
        </div>
        <div style="font-size:10px;color:var(--text-4)">
          ${item.sapCode ? `SAP: ${item.sapCode}` : ''}${item.axCode ? ` · AX: ${item.axCode}` : ''}
          · Mín: ${item.minStock}
        </div>
      </div>
      <div style="text-align:right;flex-shrink:0">
        <div style="font-size:22px;font-weight:800;color:${color}">${item.stock}</div>
        <div style="font-size:10px;color:var(--text-4)">${safeStr(item.unit,'')}</div>
      </div>
      <div style="display:flex;gap:6px;width:100%;margin-top:8px">
        <button class="icon-btn" style="flex:1;height:34px;font-size:11px;font-family:'Outfit',sans-serif"
                onclick="window.__bodega.abrirEntrada('${item.id}')">+ Entrada</button>
        <button class="icon-btn" style="flex:1;height:34px;font-size:11px;font-family:'Outfit',sans-serif"
                onclick="window.__bodega.abrirNuevoItem('${item.id}')">Editar</button>
      </div>
    </div>
  `;
}

// Nuevo / Editar item
function abrirNuevoItem(itemId = null) {
  const item = itemId ? allItems_.find(i => i.id === itemId) : null;
  const sheet = document.createElement('div');
  sheet.className = 'sheet-backdrop open';
  sheet.innerHTML = `
    <div class="sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-title">${item ? 'Editar item' : 'Nuevo item'}</div>
      <div class="sheet-body">
        <div class="form-field">
          <div class="form-label">Nombre *</div>
          <input class="form-input" id="ni-nombre" value="${tc(item?.name||'')}" placeholder="Ej: Medidor monofásico"/>
        </div>
        <div class="form-field">
          <div class="form-label">Código SAP</div>
          <input class="form-input" id="ni-sap" value="${safeStr(item?.sapCode,'')}" placeholder="Código SAP"/>
        </div>
        <div class="form-field">
          <div class="form-label">Código AX</div>
          <input class="form-input" id="ni-ax" value="${safeStr(item?.axCode,'')}" placeholder="Código AX"/>
        </div>
        <div class="form-field">
          <div class="form-label">Unidad *</div>
          <div class="select-row flex-wrap" id="ni-unit-row">
            ${['unidades','metros','rollos'].map(u => `<div class="select-chip ${(item?.unit||'unidades')===u?'active':''}" data-val="${u}">${u.charAt(0).toUpperCase()+u.slice(1)}</div>`).join('')}
          </div>
        </div>
        <div class="form-field">
          <div class="form-label">Área *</div>
          <div class="select-row" id="ni-area-row">
            ${['OTC','CAMBIOS'].map(a => `<div class="select-chip ${(item?.area||areaFiltro_)===a?'active':''}" data-val="${a}">${a}</div>`).join('')}
          </div>
        </div>
        <div class="form-field">
          <div class="form-label">Stock mínimo</div>
          <input class="form-input" id="ni-minstock" type="number" min="0" value="${item?.minStock??5}"/>
        </div>
        <div class="form-field" style="display:flex;align-items:center;gap:10px">
          <input type="checkbox" id="ni-serial" ${item?.requiereSerial?'checked':''} style="width:18px;height:18px;cursor:pointer"/>
          <label for="ni-serial" style="font-size:13px;font-weight:500;cursor:pointer">Requiere control de seriales</label>
        </div>
        <div id="ni-error" class="form-error"></div>
        <button class="btn-primary full bod" id="btn-ni">
          <span id="btn-ni-label">${item?'Guardar cambios':'Crear item'}</span>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(sheet);
  sheet.addEventListener('click', e => { if(e.target===sheet){sheet.remove();renderInventario();} });
  setupChipsDyn(sheet,'ni-unit-row');
  setupChipsDyn(sheet,'ni-area-row');

  document.getElementById('btn-ni').addEventListener('click', async () => {
    const nombre = document.getElementById('ni-nombre').value.trim();
    const unit   = sheet.querySelector('#ni-unit-row .select-chip.active')?.dataset.val || 'unidades';
    const area   = sheet.querySelector('#ni-area-row .select-chip.active')?.dataset.val;
    const errEl  = document.getElementById('ni-error');
    errEl.style.display = 'none';
    if (!nombre || !area) { errEl.textContent='Nombre y área son obligatorios.'; errEl.style.display='block'; return; }

    setLoading('btn-ni-label','Guardando…',true);
    try {
      const data = {
        name:           nombre,
        unit,
        area,
        sapCode:        document.getElementById('ni-sap').value.trim() || null,
        axCode:         document.getElementById('ni-ax').value.trim()  || null,
        minStock:       safeNum(document.getElementById('ni-minstock').value),
        requiereSerial: document.getElementById('ni-serial').checked,
      };
      if (itemId) {
        await db.collection('kardex').doc('inventario').collection('items').doc(itemId).update(data);
        const idx = allItems_.findIndex(i=>i.id===itemId);
        if(idx!==-1) allItems_[idx] = normalizeItem({...allItems_[idx],...data});
        toast('Item actualizado','ok');
      } else {
        const ref = await db.collection('kardex').doc('inventario').collection('items').add({...data,stock:0});
        allItems_.push(normalizeItem({id:ref.id,...data,stock:0}));
        toast('Item creado','ok');
      }
      sheet.remove(); renderInventario();
    } catch(err) {
      errEl.textContent=`Error: ${err.message}`; errEl.style.display='block';
      setLoading('btn-ni-label',itemId?'Guardar cambios':'Crear item',false);
    }
  });
}

// Entrada de material
function abrirEntrada(itemId) {
  const item  = allItems_.find(i=>i.id===itemId);
  const sheet = document.createElement('div');
  sheet.className = 'sheet-backdrop open';
  sheet.innerHTML = `
    <div class="sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-title">Registrar entrada</div>
      <div class="sheet-body">
        <div class="bod-item-info-card">
          <div style="font-size:14px;font-weight:700">${tc(item?.name||'—')}</div>
          <div style="font-size:11px;color:var(--text-4);margin-top:3px">Stock actual: ${item?.stock||0} ${safeStr(item?.unit,'')}</div>
        </div>
        <div class="form-field">
          <div class="form-label">Cantidad a ingresar *</div>
          <input class="form-input" id="ent-cant" type="number" min="1" placeholder="0"/>
        </div>
        <div class="form-field">
          <div class="form-label">Referencia / Nota</div>
          <input class="form-input" id="ent-ref" type="text" placeholder="Ej: Factura 1234"/>
        </div>
        <div id="ent-error" class="form-error"></div>
        <button class="btn-primary full bod" id="btn-ent">
          <span id="btn-ent-label">Registrar entrada</span>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(sheet);
  sheet.addEventListener('click', e => { if(e.target===sheet){sheet.remove();renderInventario();} });

  document.getElementById('btn-ent').addEventListener('click', async () => {
    const cantidad = safeNum(document.getElementById('ent-cant').value);
    const refTxt   = document.getElementById('ent-ref').value.trim();
    const errEl    = document.getElementById('ent-error');
    errEl.style.display = 'none';
    if(!cantidad||cantidad<=0){errEl.textContent='Ingresa una cantidad válida.';errEl.style.display='block';return;}

    setLoading('btn-ent-label','Guardando…',true);
    try {
      const nuevoStock = (item?.stock||0) + cantidad;
      const now = firebase.firestore.Timestamp.now();
      const batch = db.batch();
      batch.update(db.collection('kardex').doc('inventario').collection('items').doc(itemId),{stock:nuevoStock});
      const entRef = db.collection('kardex').doc('movimientos').collection('entradas').doc();
      batch.set(entRef,{itemId,itemName:item?.name,cantidad,referencia:refTxt||null,fecha:now,registradoPor:session_.displayName});
      await batch.commit();
      const idx = allItems_.findIndex(i=>i.id===itemId);
      if(idx!==-1) allItems_[idx].stock = nuevoStock;
      sheet.remove(); renderInventario();
      toast(`Stock actualizado: ${nuevoStock} ${safeStr(item?.unit,'')}`, 'ok');
    } catch(err) {
      errEl.textContent=`Error: ${err.message}`; errEl.style.display='block';
      setLoading('btn-ent-label','Registrar entrada',false);
    }
  });
}

// Despachos / Salidas
function renderSalidas() {
  const content = document.getElementById('bod-content');
  const sorted  = [...salidas_].sort((a,b)=>(b.fecha?.seconds||0)-(a.fecha?.seconds||0));

  content.innerHTML = `
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div>
          <div class="section-title">Despachos</div>
          <div class="section-sub">${sorted.length} registros</div>
        </div>
        <button class="icon-btn bod" onclick="window.__bodega.abrirDespacho()" title="Nuevo despacho">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
        </button>
      </div>
      ${!sorted.length ? `<div class="dev-module anim-up d1"><div class="dev-title">Sin despachos</div><p>No hay salidas registradas.</p></div>` : `
      <div class="flex-col gap-8 anim-up d1">
        ${sorted.map(s => `
          <div class="bod-solic-card" onclick="window.__bodega._verSalida('${s.id}')">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
              <div>
                <div style="font-size:13px;font-weight:700">${safeStr(s.usuarioResponsable||s.tecnicoNombre)}</div>
                <div style="font-size:10px;color:var(--text-4)">${formatDate(s.fecha)} · ${safeStr(s.empresaContratista,'—')} · ${safeStr(s.placaVehiculo,'—')}</div>
              </div>
              <div class="bod-badge" style="color:var(--bod-light);border-color:var(--bod-border);background:var(--bod-glass)">PDF</div>
            </div>
            <div class="flex-col gap-3">
              ${(s.items||[]).slice(0,3).map(m=>`
                <div style="display:flex;justify-content:space-between;font-size:11px">
                  <span style="color:var(--text-3)">${tc(m.nombre||m.name||'—')}</span>
                  <span style="font-weight:600">${m.cantidad} ${safeStr(m.unit,'')}</span>
                </div>`).join('')}
              ${(s.items||[]).length>3?`<div style="font-size:10px;color:var(--text-4)">+${(s.items||[]).length-3} más</div>`:''}
            </div>
          </div>
        `).join('')}
      </div>`}
    </div>
  `;
  window.__bodega._verSalida = id => {
    const s = salidas_.find(x=>x.id===id);
    if(s) generarPDF(s);
  };
}

// Solicitudes
function renderSolicitudes() {
  const content    = document.getElementById('bod-content');
  const pendientes = solicitudes_.filter(s=>s.estado==='pendiente');
  const resto      = solicitudes_.filter(s=>s.estado!=='pendiente');

  content.innerHTML = `
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div>
          <div class="section-title">Solicitudes</div>
          <div class="section-sub">${pendientes.length} pendientes · ${resto.length} respondidas</div>
        </div>
      </div>
      ${pendientes.length?`
      <div class="section-label anim-up d1">Pendientes de aprobación</div>
      <div class="flex-col gap-8 anim-up d1">${pendientes.map(s=>renderSolicitudCard(s,true)).join('')}</div>`:''}
      ${resto.length?`
      <div class="section-label anim-up d2">Respondidas</div>
      <div class="flex-col gap-8 anim-up d2">${resto.map(s=>renderSolicitudCard(s,false)).join('')}</div>`:''}
      ${!solicitudes_.length?`<div class="dev-module anim-up d1"><div class="dev-title">Sin solicitudes</div></div>`:''}
    </div>
  `;
}

function renderSolicitudCard(s, showActions) {
  const cfg = {
    pendiente: {color:'#fbbf24',bg:'rgba(245,158,11,.06)',border:'rgba(245,158,11,.2)',label:'Pendiente'},
    aprobado:  {color:'#22c55e',bg:'rgba(34,197,94,.06)', border:'rgba(34,197,94,.2)', label:'Aprobada'},
    aprobada:  {color:'#22c55e',bg:'rgba(34,197,94,.06)', border:'rgba(34,197,94,.2)', label:'Aprobada'},
    rechazada: {color:'#ef4444',bg:'rgba(239,68,68,.06)', border:'rgba(239,68,68,.2)', label:'Rechazada'},
  }[s.estado] || {color:'var(--text-4)',bg:'var(--glass)',border:'var(--border)',label:s.estado};

  return `
    <div class="bod-solic-card" style="background:${cfg.bg};border-color:${cfg.border}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
        <div>
          <div style="font-size:13px;font-weight:700">${safeStr(s.usuarioNombre)}</div>
          <div style="font-size:10px;color:var(--text-4)">${formatDate(s.fecha)} · Área ${safeStr(s.area)}</div>
        </div>
        <div class="bod-badge" style="color:${cfg.color};border-color:${cfg.color}33;background:${cfg.color}11">${cfg.label}</div>
      </div>
      <div class="flex-col gap-4" style="margin-bottom:${showActions?'12px':'0'}">
        ${(s.materiales||[]).map(m=>`
          <div style="display:flex;justify-content:space-between;font-size:12px">
            <span style="color:var(--text-2)">${tc(m.nombre||m.name||'—')}</span>
            <span style="font-weight:700">${m.cantidad} ${safeStr(m.unidad||m.unit,'')}</span>
          </div>`).join('')}
      </div>
      ${s.notas?`<div style="font-size:11px;color:var(--text-4);font-style:italic;margin-bottom:8px">"${s.notas}"</div>`:''}
      ${showActions?`
      <div style="display:flex;gap:8px">
        <button class="btn-action cm" style="flex:1;height:40px;font-size:12px;border-color:var(--bod-border);background:var(--bod-glass);color:var(--bod-light)"
                onclick="window.__bodega.aprobarSolicitud('${s.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
          Aprobar y despachar
        </button>
        <button class="btn-action danger" style="flex:1;height:40px;font-size:12px"
                onclick="window.__bodega.rechazarSolicitud('${s.id}')">Rechazar</button>
      </div>`:''}
      ${s.aprobadoPor?`<div style="font-size:10px;color:var(--text-4);margin-top:6px">${cfg.label} por ${s.aprobadoPor}</div>`:''}
    </div>
  `;
}

async function aprobarSolicitud(id) {
  const s = solicitudes_.find(x=>x.id===id);
  if(s) abrirDespacho(s);
}

async function rechazarSolicitud(id) {
  const sheet = document.createElement('div');
  sheet.className = 'sheet-backdrop open';
  sheet.innerHTML = `
    <div class="sheet">
      <div class="sheet-handle"></div>
      <div class="sheet-title">Rechazar solicitud</div>
      <div class="sheet-body">
        <div class="form-label" style="margin-bottom:8px">Motivo (opcional)</div>
        <input class="form-input" id="rej-motivo" type="text" placeholder="Motivo del rechazo…" style="margin-bottom:16px"/>
        <button class="btn-action danger" style="width:100%;height:46px" id="btn-rej">
          <span id="btn-rej-label">Confirmar rechazo</span>
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(sheet);
  sheet.addEventListener('click', e=>{if(e.target===sheet)sheet.remove();});
  document.getElementById('btn-rej').addEventListener('click', async () => {
    const motivo = document.getElementById('rej-motivo').value.trim();
    setLoading('btn-rej-label','Rechazando…',true);
    try {
      await db.collection('solicitudes_material').doc(id).update({
        estado:'rechazada', aprobadoPor:session_.displayName,
        fechaAprobacion:firebase.firestore.Timestamp.now(), notas:motivo||null,
      });
      const idx = solicitudes_.findIndex(x=>x.id===id);
      if(idx!==-1) solicitudes_[idx]={...solicitudes_[idx],estado:'rechazada',aprobadoPor:session_.displayName};
      sheet.remove(); renderSolicitudes();
      toast('Solicitud rechazada','warn');
    } catch(err) {
      toast('Error al rechazar','error');
      setLoading('btn-rej-label','Confirmar rechazo',false);
    }
  });
}

// ══════════════════════════════════════════════════
// FORMULARIO DESPACHO — 2 pasos (fiel al original)
// ══════════════════════════════════════════════════
function abrirDespacho(solicitud = null) {
  const hdr = {
    responsable: RESPONSABLES.includes(solicitud?.usuarioNombre)||false ? solicitud.usuarioNombre : '',
    contratista: 'INNOVA', instalador: '', placa: '', placaOtro: '',
    fechaSol: new Date().toISOString().split('T')[0],
    fechaEnt: new Date().toISOString().split('T')[0],
  };

  let sel = [];
  if (solicitud?.materiales?.length) {
    sel = solicitud.materiales.map(m => {
      const item = allItems_.find(i=>i.id===m.itemId);
      return {
        itemId:m.itemId, name:m.nombre||m.name||'—',
        unit:m.unidad||m.unit||'unidades',
        sapCode:item?.sapCode||null, axCode:item?.axCode||null,
        stock:item?.stock||0, cantidad:m.cantidad,
        requiereSerial:item?.requiereSerial||false,
        modoSerial:'individual', seriales:[], serialInicio:'', serialFin:'',
      };
    });
  }

  let step = solicitud ? 2 : 1;
  const ov = document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;z-index:200;background:var(--bg);overflow-y:auto;';
  document.body.appendChild(ov);

  function renderStep1() {
    ov.innerHTML = `
      <div style="padding:20px;max-width:500px;margin:0 auto">
        <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
          <button onclick="this.closest('div[style]').remove()" class="icon-btn">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="section-title">Datos del despacho</div>
        </div>
        <div class="flex-col gap-12">
          <div class="form-field">
            <div class="form-label">Usuario responsable *</div>
            <div class="select-row flex-wrap" id="hdr-resp">
              ${RESPONSABLES.map(r=>`<div class="select-chip ${hdr.responsable===r?'active':''}" data-val="${r}">${r}</div>`).join('')}
            </div>
          </div>
          <div class="form-field">
            <div class="form-label">Empresa contratista *</div>
            <div class="select-row" id="hdr-cont">
              ${CONTRATISTAS.map(c=>`<div class="select-chip ${hdr.contratista===c?'active':''}" data-val="${c}">${c}</div>`).join('')}
            </div>
          </div>
          <div class="form-field">
            <div class="form-label">Instalador responsable</div>
            <input class="form-input" id="hdr-inst" value="${hdr.instalador}" placeholder="Nombre del instalador"/>
          </div>
          <div class="form-field">
            <div class="form-label">Placa del vehículo</div>
            <div class="select-row flex-wrap" id="hdr-placa">
              ${PLACAS.map(p=>`<div class="select-chip ${hdr.placa===p?'active':''}" data-val="${p}">${p}</div>`).join('')}
              <div class="select-chip ${hdr.placa==='__otro__'?'active':''}" data-val="__otro__">Otra</div>
            </div>
            <input class="form-input" id="hdr-placa-otro" style="margin-top:8px;display:${hdr.placa==='__otro__'?'':'none'}" placeholder="Ingresa la placa" value="${hdr.placaOtro}"/>
          </div>
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:12px">
            <div class="form-field">
              <div class="form-label">Fecha solicitud</div>
              <input class="form-input" id="hdr-fsol" type="date" value="${hdr.fechaSol}"/>
            </div>
            <div class="form-field">
              <div class="form-label">Fecha entrega</div>
              <input class="form-input" id="hdr-fent" type="date" value="${hdr.fechaEnt}"/>
            </div>
          </div>
          <div id="s1-err" class="form-error"></div>
          <button class="btn-primary full bod" id="btn-s1">Continuar → Materiales</button>
        </div>
      </div>
    `;
    setupChipsDyn(ov,'hdr-resp');
    setupChipsDyn(ov,'hdr-cont');
    ov.querySelector('#hdr-placa')?.querySelectorAll('.select-chip').forEach(c=>{
      c.addEventListener('click',()=>{
        ov.querySelectorAll('#hdr-placa .select-chip').forEach(x=>x.classList.remove('active'));
        c.classList.add('active');
        ov.querySelector('#hdr-placa-otro').style.display = c.dataset.val==='__otro__'?'':'none';
      });
    });
    ov.querySelector('#btn-s1').addEventListener('click',()=>{
      const resp = ov.querySelector('#hdr-resp .select-chip.active')?.dataset.val;
      const cont = ov.querySelector('#hdr-cont .select-chip.active')?.dataset.val;
      const errEl = ov.querySelector('#s1-err');
      errEl.style.display='none';
      if(!resp||!cont){errEl.textContent='Responsable y contratista son obligatorios.';errEl.style.display='block';return;}
      hdr.responsable = resp; hdr.contratista = cont;
      hdr.instalador  = ov.querySelector('#hdr-inst').value.trim();
      hdr.placa       = ov.querySelector('#hdr-placa .select-chip.active')?.dataset.val||'';
      hdr.placaOtro   = ov.querySelector('#hdr-placa-otro').value.trim();
      hdr.fechaSol    = ov.querySelector('#hdr-fsol').value;
      hdr.fechaEnt    = ov.querySelector('#hdr-fent').value;
      step=2; renderStep2();
    });
  }

  let busq='';

  function renderStep2() {
    const itemsArea = allItems_.filter(i=>i.area===(solicitud?.area||areaFiltro_));
    ov.innerHTML=`
      <div style="max-width:500px;margin:0 auto;display:flex;flex-direction:column;min-height:100vh">
        <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;position:sticky;top:0;background:var(--bg);z-index:10">
          <button class="icon-btn" id="back1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg></button>
          <div class="section-title">Materiales del despacho</div>
        </div>

        ${sel.length?`
        <div style="padding:12px 20px;border-bottom:1px solid var(--border);background:var(--bod-glass)">
          <div class="section-label" style="margin-bottom:8px">${sel.length} material${sel.length>1?'es':''} seleccionado${sel.length>1?'s':''}</div>
          <div class="flex-col gap-8">
            ${sel.map((s,idx)=>`
              <div>
                <div style="display:flex;align-items:center;gap:8px">
                  <div style="flex:1;font-size:12px;font-weight:600">${tc(s.name)}</div>
                  <button class="icon-btn" style="width:28px;height:28px" onclick="window.__d_del(${idx})">
                    <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                  </button>
                </div>
                <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
                  <button class="icon-btn" style="width:34px;height:34px;font-size:20px;font-weight:700" onclick="window.__d_dec(${idx})">−</button>
                  <div style="flex:1;text-align:center;font-size:20px;font-weight:800;color:var(--bod-light)">${s.cantidad} <span style="font-size:11px;color:var(--text-4)">${s.unit}</span></div>
                  <button class="icon-btn" style="width:34px;height:34px;font-size:20px;font-weight:700;color:var(--bod-light);border-color:var(--bod-border);background:var(--bod-glass)" onclick="window.__d_inc(${idx})">+</button>
                </div>
                ${s.requiereSerial?renderSerial(s,idx):''}
              </div>
            `).join('<div style="height:1px;background:var(--border);margin:4px 0"></div>')}
          </div>
        </div>`:``}

        <div style="padding:12px 20px 0;flex:1">
          <div class="buscar-wrap" style="margin-bottom:10px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="color:var(--text-4);flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input class="buscar-input" id="bus-mat" placeholder="Buscar material…" value="${busq}" autocomplete="off"/>
          </div>
          <div id="lista-mat" class="flex-col gap-6"></div>
        </div>

        <div style="padding:14px 20px;border-top:1px solid var(--border);background:var(--bg);position:sticky;bottom:0">
          <div id="s2-err" class="form-error" style="margin-bottom:8px"></div>
          <button class="btn-primary full bod" id="btn-des" ${!sel.length?'disabled style="opacity:.5"':''}>
            <span id="btn-des-lbl">${sel.length>0?`Registrar despacho · ${sel.length} material${sel.length>1?'es':''}` :'Agrega materiales'}</span>
          </button>
        </div>
      </div>
    `;

    window.__d_del = idx=>{sel.splice(idx,1);renderStep2();};
    window.__d_dec = idx=>{if(sel[idx].cantidad>1){sel[idx].cantidad--;renderStep2();}};
    window.__d_inc = idx=>{if(sel[idx].cantidad<sel[idx].stock){sel[idx].cantidad++;renderStep2();}};
    window.__d_smod= (idx,modo)=>{sel[idx].modoSerial=modo;renderStep2();};
    window.__d_sadd= idx=>{const v=document.getElementById(`si-${idx}`)?.value.trim();if(v&&!sel[idx].seriales.includes(v)){sel[idx].seriales.push(v);document.getElementById(`si-${idx}`).value='';renderStep2();}};
    window.__d_sdel= (idx,i)=>{sel[idx].seriales.splice(i,1);renderStep2();};
    window.__d_srange=(idx)=>{sel[idx].serialInicio=document.getElementById(`sri-${idx}`)?.value.trim()||'';sel[idx].serialFin=document.getElementById(`srf-${idx}`)?.value.trim()||'';};

    ov.querySelector('#back1').onclick=()=>{step=1;renderStep1();};
    ov.querySelector('#bus-mat').addEventListener('input',e=>{busq=e.target.value;renderLista();});
    ov.querySelector('#btn-des').addEventListener('click',handleDespacho);
    renderLista();

    function renderLista() {
      const el=ov.querySelector('#lista-mat');
      if(!el) return;
      const q=busq.trim().toLowerCase();
      const selIds=new Set(sel.map(s=>s.itemId));
      const lista=q?itemsArea.filter(i=>i.name.toLowerCase().includes(q)||i.sapCode.includes(q)):itemsArea;
      if(!lista.length){el.innerHTML='<p style="font-size:12px;color:var(--text-4);text-align:center;padding:16px">Sin resultados</p>';return;}
      el.innerHTML=lista.map(item=>{
        const agregado=selIds.has(item.id);
        return `<div data-item="${item.id}" class="bod-solicitar-row" style="background:${agregado?'rgba(34,197,94,.08)':'var(--glass)'};border-color:${agregado?'rgba(34,197,94,.3)':'var(--border)'};cursor:${agregado||item.stock===0?'default':'pointer'}">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600;color:${item.stock===0?'var(--text-4)':'var(--text)'}">${tc(item.name)}</div>
            <div style="font-size:10px;color:var(--text-4)">${item.sapCode?'SAP: '+item.sapCode+' · ':''}Stock: ${item.stock} ${item.unit}</div>
          </div>
          ${agregado?`<span style="font-size:11px;font-weight:700;color:var(--ok)">✓</span>`:item.stock===0?`<span style="font-size:11px;color:var(--text-4)">Agotado</span>`:`<span style="font-size:11px;font-weight:700;color:var(--bod-light)">${item.stock} ${item.unit}</span>`}
        </div>`;
      }).join('');
      el.querySelectorAll('[data-item]').forEach(row=>{
        row.addEventListener('click',()=>{
          const item=itemsArea.find(i=>i.id===row.dataset.item);
          if(!item||item.stock===0||sel.some(s=>s.itemId===item.id)) return;
          mostrarModalCant(item);
        });
      });
    }
  }

  function renderSerial(s,idx) {
    return `<div style="background:rgba(139,92,246,.06);border:1px solid rgba(139,92,246,.2);border-radius:10px;padding:10px;margin-top:8px">
      <div style="font-size:10px;font-weight:700;color:var(--bod-light);text-transform:uppercase;margin-bottom:8px">Seriales</div>
      <div style="display:flex;gap:6px;margin-bottom:8px">
        <div class="select-chip ${s.modoSerial==='individual'?'active':''}" style="font-size:10px" onclick="window.__d_smod(${idx},'individual')">Individual</div>
        <div class="select-chip ${s.modoSerial==='rango'?'active':''}" style="font-size:10px" onclick="window.__d_smod(${idx},'rango')">Rango</div>
      </div>
      ${s.modoSerial==='individual'?`
      <div style="display:flex;gap:6px;margin-bottom:6px">
        <input class="form-input" id="si-${idx}" type="text" placeholder="Serial…" style="flex:1;padding:8px 10px;font-size:12px"/>
        <button class="icon-btn" style="width:36px;height:36px;color:var(--bod-light);border-color:var(--bod-border);background:var(--bod-glass)" onclick="window.__d_sadd(${idx})">+</button>
      </div>
      <div class="flex-col gap-4">
        ${s.seriales.map((ser,i)=>`<div style="display:flex;align-items:center;gap:6px;font-size:11px">
          <div style="flex:1;background:var(--glass);border:1px solid var(--border);border-radius:6px;padding:4px 8px">${ser}</div>
          <button class="icon-btn" style="width:24px;height:24px" onclick="window.__d_sdel(${idx},${i})"><svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
        </div>`).join('')}
      </div>`:`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><div style="font-size:10px;color:var(--text-4);margin-bottom:4px">Inicio</div><input class="form-input" id="sri-${idx}" type="text" value="${s.serialInicio}" placeholder="Primer serial" style="font-size:12px;padding:8px 10px" onblur="window.__d_srange(${idx})"/></div>
        <div><div style="font-size:10px;color:var(--text-4);margin-bottom:4px">Fin</div><input class="form-input" id="srf-${idx}" type="text" value="${s.serialFin}" placeholder="Último serial" style="font-size:12px;padding:8px 10px" onblur="window.__d_srange(${idx})"/></div>
      </div>`}
    </div>`;
  }

  function mostrarModalCant(item) {
    const m=document.createElement('div');
    m.style.cssText='position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;z-index:300;';
    m.innerHTML=`<div style="background:var(--bg-card);width:100%;border-radius:20px 20px 0 0;padding:20px 20px max(32px,20px)">
      <div style="width:36px;height:4px;background:rgba(255,255,255,.15);border-radius:2px;margin:0 auto 16px"></div>
      <div style="font-size:15px;font-weight:700;margin-bottom:4px">${tc(item.name)}</div>
      <div style="font-size:11px;color:var(--text-4);margin-bottom:20px">${item.stock} ${item.unit} disponibles</div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px">
        <button id="mc-dec" class="icon-btn" style="width:56px;height:56px;font-size:24px;font-weight:700">−</button>
        <div style="flex:1;text-align:center">
          <input id="mc-cant" type="number" min="1" max="${item.stock}" value="1" style="width:100%;text-align:center;font-size:40px;font-weight:900;color:var(--text);background:transparent;border:none;outline:none;font-family:'Outfit',sans-serif"/>
          <div style="font-size:12px;color:var(--text-4)">${item.unit}</div>
        </div>
        <button id="mc-inc" class="icon-btn" style="width:56px;height:56px;font-size:24px;font-weight:700;color:var(--bod-light);border-color:var(--bod-border);background:var(--bod-glass)">+</button>
      </div>
      <div id="mc-err" class="form-error" style="margin-bottom:8px"></div>
      <button class="btn-primary full bod" id="mc-add">Agregar al despacho</button>
    </div>`;
    document.body.appendChild(m);
    const cantEl=m.querySelector('#mc-cant');
    setTimeout(()=>{cantEl.focus();cantEl.select();},80);
    m.addEventListener('click',e=>{if(e.target===m)m.remove();});
    m.querySelector('#mc-dec').onclick=()=>{const v=safeNum(cantEl.value);if(v>1)cantEl.value=v-1;};
    m.querySelector('#mc-inc').onclick=()=>{const v=safeNum(cantEl.value);if(v<item.stock)cantEl.value=v+1;};
    m.querySelector('#mc-add').addEventListener('click',()=>{
      const cant=safeNum(cantEl.value);
      const errEl=m.querySelector('#mc-err');
      if(cant<=0){errEl.textContent='Cantidad inválida.';errEl.style.display='block';return;}
      if(cant>item.stock){errEl.textContent=`Máximo: ${item.stock}`;errEl.style.display='block';return;}
      sel.push({itemId:item.id,name:item.name,unit:item.unit,stock:item.stock,sapCode:item.sapCode,axCode:item.axCode,cantidad:cant,requiereSerial:item.requiereSerial,modoSerial:'individual',seriales:[],serialInicio:'',serialFin:''});
      m.remove(); renderStep2();
    });
  }

  async function handleDespacho() {
    if(!sel.length) return;
    const errEl=ov.querySelector('#s2-err');
    const btn=ov.querySelector('#btn-des');
    errEl.style.display='none';
    btn.disabled=true;
    document.getElementById('btn-des-lbl').innerHTML='<div class="spinner"></div>';
    const placa=hdr.placa==='__otro__'?hdr.placaOtro:hdr.placa;

    try {
      const salidaData={
        usuarioResponsableUid:uid_, usuarioResponsable:hdr.responsable,
        empresaContratista:hdr.contratista, instaladorResponsable:hdr.instalador,
        placaVehiculo:placa, fechaSolicitud:hdr.fechaSol, fechaEntrega:hdr.fechaEnt,
        entregadoPor:session_.displayName, entregadoPorUid:uid_,
        solicitudId:solicitud?.id||null,
        area:solicitud?.area||areaFiltro_,
        items:sel.map(s=>({
          itemId:s.itemId,sapCode:s.sapCode,axCode:s.axCode,
          nombre:s.name,unit:s.unit,cantidad:s.cantidad,
          requiereSerial:s.requiereSerial,
          modoSerial:s.requiereSerial?s.modoSerial:null,
          seriales:s.requiereSerial&&s.modoSerial==='individual'?s.seriales:[],
          serialInicio:s.requiereSerial&&s.modoSerial==='rango'?s.serialInicio:'',
          serialFin:s.requiereSerial&&s.modoSerial==='rango'?s.serialFin:'',
        })),
        fecha:firebase.firestore.FieldValue.serverTimestamp(),
      };

      const ref=await db.collection('kardex').doc('movimientos').collection('salidas').add(salidaData);

      const batch=db.batch();
      for(const s of sel){
        batch.update(db.collection('kardex').doc('inventario').collection('items').doc(s.itemId),{stock:firebase.firestore.FieldValue.increment(-s.cantidad)});
      }
      if(solicitud?.id){
        batch.update(db.collection('solicitudes_material').doc(solicitud.id),{
          estado:'aprobado',salidaId:ref.id,
          aprobadoPor:session_.displayName,
          fechaAprobacion:firebase.firestore.FieldValue.serverTimestamp(),
        });
      }
      await batch.commit();

      // Actualizar local
      for(const s of sel){
        const idx=allItems_.findIndex(i=>i.id===s.itemId);
        if(idx!==-1) allItems_[idx].stock=Math.max(0,(allItems_[idx].stock||0)-s.cantidad);
      }
      if(solicitud?.id){
        const sIdx=solicitudes_.findIndex(x=>x.id===solicitud.id);
        if(sIdx!==-1) solicitudes_[sIdx].estado='aprobado';
      }
      salidas_.unshift({id:ref.id,...salidaData,fecha:{seconds:Date.now()/1000}});

      ov.remove();
      toast('Despacho registrado','ok');
      generarPDF({...salidaData,id:ref.id,fecha:new Date()});
      renderSolicitudes();
    } catch(err) {
      console.error('[bodega] Error despacho:',err);
      errEl.textContent=`Error: ${err.message}`; errEl.style.display='block';
      btn.disabled=false;
      document.getElementById('btn-des-lbl').textContent=`Registrar despacho · ${sel.length} material${sel.length>1?'es':''}`;
    }
  }

  if(step===2) renderStep2(); else renderStep1();
}

// ── Generar PDF (igual al formato físico DELSUR) ──
function generarPDF(salida) {
  try {
    const {jsPDF} = window.jspdf;
    const doc=new jsPDF({unit:'mm',format:'letter'});
    const fecha=salida.fecha instanceof Date?salida.fecha:(salida.fecha?.toDate?salida.fecha.toDate():new Date());
    const fechaStr=fecha.toLocaleDateString('es-SV',{day:'2-digit',month:'long',year:'numeric'});

    // Encabezado
    doc.setFillColor(27,79,138);
    doc.rect(0,0,216,32,'F');
    doc.setTextColor(255,255,255);
    doc.setFontSize(15);doc.setFont('helvetica','bold');
    doc.text('INNOVA STC — DELSUR',14,13);
    doc.setFontSize(9);doc.setFont('helvetica','normal');
    doc.text('Registro de Salida de Material',14,21);
    doc.text(`Fecha: ${fechaStr}`,140,13);
    doc.text(`Ref: ${safeStr(salida.id,'—').slice(-8)}`,140,21);

    // Datos
    let y=42;
    doc.setTextColor(30,30,30);
    doc.setFontSize(10);doc.setFont('helvetica','bold');
    doc.text('Datos del despacho',14,y);
    doc.setFont('helvetica','normal');y+=10;
    [
      ['Usuario responsable:',safeStr(salida.usuarioResponsable)],
      ['Empresa contratista:',safeStr(salida.empresaContratista)],
      ['Instalador:',safeStr(salida.instaladorResponsable)],
      ['Placa vehículo:',safeStr(salida.placaVehiculo)],
      ['Fecha solicitud:',safeStr(salida.fechaSolicitud)],
      ['Fecha entrega:',safeStr(salida.fechaEntrega)],
      ['Entregado por:',safeStr(salida.entregadoPor)],
    ].forEach(([k,v])=>{
      doc.setFont('helvetica','bold');doc.text(k,14,y);
      doc.setFont('helvetica','normal');doc.text(v,72,y);
      y+=8;
    });

    // Tabla
    y+=6;
    doc.setFont('helvetica','bold');doc.setFontSize(10);
    doc.text('Materiales despachados',14,y);y+=6;
    doc.setFillColor(230,240,250);doc.rect(14,y,188,8,'F');
    doc.setFontSize(8);doc.setFont('helvetica','bold');
    doc.text('Material',16,y+5.5);
    doc.text('SAP',90,y+5.5);
    doc.text('Cant.',122,y+5.5);
    doc.text('Unidad',140,y+5.5);
    doc.text('Seriales',165,y+5.5);
    y+=10;doc.setFont('helvetica','normal');

    (salida.items||[]).forEach((item,i)=>{
      if(i%2===0){doc.setFillColor(248,250,252);doc.rect(14,y-5,188,8,'F');}
      doc.text(tc(safeStr(item.nombre||item.name)).substring(0,35),16,y);
      doc.text(safeStr(item.sapCode),90,y);
      doc.text(String(item.cantidad),123,y);
      doc.text(safeStr(item.unit,''),140,y);
      let ser='';
      if(item.requiereSerial){
        if(item.modoSerial==='rango'&&item.serialInicio) ser=`${item.serialInicio}—${item.serialFin}`;
        else if(item.seriales?.length) ser=item.seriales.join(', ').substring(0,22);
      }
      doc.text(ser,165,y);y+=8;
    });

    // Firmas
    y+=16;
    doc.setDrawColor(150,150,150);
    doc.line(14,y,90,y);doc.line(126,y,202,y);
    doc.setFontSize(8);
    doc.text('Firma técnico receptor',14,y+5);
    doc.text('Firma responsable bodega',126,y+5);
    doc.setFontSize(7);doc.setTextColor(150,150,150);
    doc.text('INNOVA STC · DELSUR · Generado automáticamente',14,268);

    doc.save(`despacho_${safeStr(salida.usuarioResponsable,'').replace(/ /g,'_')}_${safeStr(salida.fechaEntrega,fechaStr)}.pdf`);
    toast('PDF generado','ok');
  } catch(err) {
    console.error('[bodega] Error PDF:',err);
    toast('Error al generar PDF','error');
  }
}

// ── Helpers ───────────────────────────────────────
function abrirSolicitar() {
  activeTab_='solicitar';
  container_.querySelectorAll('.cambios-tab.bod').forEach(t=>t.classList.remove('active'));
  container_.querySelector('.cambios-tab.bod[data-tab="solicitar"]')?.classList.add('active');
  renderTab();
}

function setupChipsDyn(root,rowId) {
  root.querySelector(`#${rowId}`)?.querySelectorAll('.select-chip').forEach(chip=>{
    chip.addEventListener('click',()=>{
      root.querySelectorAll(`#${rowId} .select-chip`).forEach(c=>c.classList.remove('active'));
      chip.classList.add('active');
    });
  });
}

function setLoading(labelId,text,loading) {
  const el=document.getElementById(labelId);
  if(!el) return;
  el.innerHTML=loading?'<div class="spinner"></div>':text;
  const btn=el.closest('button');
  if(btn) btn.disabled=loading;
}

function formatDate(ts) {
  if(!ts) return '—';
  const d=ts?.toDate?ts.toDate():new Date(ts);
  return d.toLocaleDateString('es-SV',{day:'2-digit',month:'short',year:'numeric'});
}
