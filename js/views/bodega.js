/**
 * js/views/bodega.js — INNOVA STC v2
 * Reescritura fiel a kardex.js v4. Todos los campos y lógica del original.
 * Campos Firestore: name, unit, sapCode, axCode, minStock, requiereSerial, stock, area
 */

import { db } from '../firebase.js';
import { toast } from '../ui.js';

// ── Constantes (iguales al original) ─────────────
const PLACAS = ['CPT-154','CPT-156','AU-250','AU-200','CNR-163','P568DA','P38DA6'];
const RESPONSABLES = ['NALVAR','RGONZA','JPEREZ'];
const CONTRATISTAS = ['INNOVA'];
const TIPOS_TRABAJO = ['Servicio nuevo','Cambio de voltaje','Reconexión','Cambio de medidor','Reubicación de medidor','Reubicación de acometida','Otro'];

// Bloques seriales página 2 del documento físico DELSUR
const BLOQUES_SERIALES = [
  { ax:'700101', sap:'200129', nombre:'MEDIDOR BIFILAR DOMICILIAR BASE A, 100 A (ETE1-330)',                                          filas:30, tipo:'serial' },
  { ax:'700102', sap:'355518', nombre:'MEDIDOR TRIFILAR DOMICILIAR BASE A, 100 A (ETE1-330)',                                         filas:30, tipo:'serial' },
  { ax:'400931', sap:'354549', nombre:'SELLO ACRILICO VERDE (SERV. NVOS., MTTO.) (CABLE 30 CM) (FTMED-30)',                           filas:10, tipo:'sello'  },
  { ax:'700326', sap:'338362', nombre:'MEDIDOR FORMA 2(S) T/ESPIGA, CLASE 100, TRIFI. 240 V, 15/100',                                 filas:5,  tipo:'serial' },
  { ax:'700332', sap:'355064', nombre:'MEDIDOR FORMA 16s, CLASE 200, 120-277V. 8 CANALES DE MEM. 200 AMP. C/BASE 7 TERMI. (ETE-16s)', filas:5,  tipo:'serial' },
  { ax:'700333', sap:'338357', nombre:'MEDIDOR FORMA 12s CLASE 200, 120-277V, TRIFILAR, 60Hz, 8 Canales de memoria, C/Base 5 Term', filas:3, tipo:'serial' },
];

// Filas del documento físico DELSUR (página 1)
const FILAS_DOC = [
  {sap:'RESERVA',ax:'STOCK',desc:'DESCRIPICIÓN',header:'col'},
  {sap:'USO HABITUAL',ax:'',desc:'',header:'sec'},
  {sap:'221477',ax:'50203',desc:'ALAMBRE COBRE THHN 8 AWG 600 V FORRO PLASTICO'},
  {sap:'213719',ax:'50806',desc:'CABLE DUPLEX AL #6 ACSR SETTER'},
  {sap:'328541',ax:'50807',desc:'CABLE TRIPLEX AL. #6 ACSR PALUDINA'},
  {sap:'352453',ax:'250201',desc:'CONECTOR DE COMPRESIÓN YPC2A8U'},
  {sap:'352460',ax:'250202',desc:'CONECTOR DE COMPRESIÓN YPC26R8U'},
  {sap:'352461',ax:'250203',desc:'CONECTOR DE COMPRESIÓN YP2U3'},
  {sap:'352462',ax:'250204',desc:'CONECTOR DE COMPRESIÓN YP26AU2'},
  {sap:'353112',ax:'400910',desc:'ANCLA PLASTICA 1 1/2 X 7 (FTN1-120)'},
  {sap:'354045',ax:'400919',desc:'TORNILLO CABEZA PLANA DE 11/2 PLG X 7MM'},
  {sap:'354549',ax:'400931',desc:'SELLO ACRILICO VERDE (SERV. NVOS., MTTO.) (CABLE 30 CM) (FTMED-30)'},
  {sap:'200129',ax:'700101',desc:'MEDIDOR BIFILAR DOMICILIAR BASE A, 100 A (ETE1-330)'},
  {sap:'355518',ax:'700102',desc:'MEDIDOR TRIFILAR DOMICILIAR BASE A, 100 A (ETE1-330)'},
  {sap:'338362',ax:'700326',desc:'MEDIDOR FORMA 2(S) T/ESPIGA, CLASE 100, TRIFI. 240 V, 15/100'},
  {sap:'219359',ax:'750109',desc:'CINTA AISLANTE SUPER 3M #33'},
  {sap:'MATERIAL PARA CL200',ax:'',desc:'',header:'sec'},
  {sap:'328560',ax:'50205',desc:'CABLE COBRE THHN # 2 AWG 600 V FORRO PLASTICO (ETM3-310)'},
  {sap:'243940',ax:'50209',desc:'CABLE COBRE THHN # 1/0 AWG 19 HILOS (ETM3-310)'},
  {sap:'337775',ax:'250101',desc:'CONECTOR MECANICO PERNO PARTIDO KSU-23'},
  {sap:'337776',ax:'250102',desc:'CONECTOR MECANICO PERNO PARTIDO KSU-26'},
  {sap:'337777',ax:'250103',desc:'CONECTOR MECANICO PERNO PARTIDO KSU-29'},
  {sap:'355064',ax:'700332',desc:'MEDIDOR FORMA 16s, CLASE 200, 120-277V. 8 CANALES DE MEM. (ETE-16s)'},
  {sap:'338357',ax:'700333',desc:'MEDIDOR FORMA 12s CLASE 200, 120-277V, TRIFILAR (ETE-12s)'},
];

// ── Helpers ───────────────────────────────────────
const safeNum = v => { const n = Number(v); return isNaN(n) ? 0 : n; };
const safeStr = (v, fb='—') => (v!==undefined&&v!==null&&String(v).trim()) ? String(v).trim() : fb;
const tc = str => safeStr(str,'').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
const fmtDate = ts => {
  if (!ts) return '—';
  try { const d=ts.toDate?ts.toDate():new Date(ts); return d.toLocaleDateString('es-SV',{day:'2-digit',month:'short',year:'numeric',hour:'2-digit',minute:'2-digit'}); } catch { return '—'; }
};

function normalizeItem(raw) {
  return {
    ...raw,
    name:           safeStr(raw.name,'')    || safeStr(raw.nombre,''),
    unit:           safeStr(raw.unit,'')    || safeStr(raw.unidad,''),
    sapCode:        safeStr(raw.sapCode,''),
    axCode:         safeStr(raw.axCode,''),
    stock:          safeNum(raw.stock),
    minStock:       safeNum(raw.minStock || raw.stockMinimo || 5),
    requiereSerial: raw.requiereSerial===true,
    area:           raw.area || 'CAMBIOS',
  };
}
const esValido = i => safeStr(i.name,'')!=='' && safeStr(i.unit,'')!=='';

// ── Estado del módulo ─────────────────────────────
let container_, session_, role_, area_, destino_, uid_;
let allItems_    = [];
let salidas_     = [];
let solicitudes_ = [];
let consumos_    = [];
let activeTab_   = 'inventario';
let areaFiltro_  = 'CAMBIOS';

// ── Entry point ───────────────────────────────────
export async function init(container, session) {
  container_ = container;
  session_   = session;
  role_      = session.role;
  area_      = session.asignacionActual?.area || null;
  destino_   = session.asignacionActual?.destino || null;
  uid_       = session.uid;
  activeTab_ = role_==='tecnico' ? 'material' : 'inventario';
  areaFiltro_= area_ || localStorage.getItem('bod_area') || 'CAMBIOS';

  renderShell();
  await loadData();
}

// ── Shell ─────────────────────────────────────────
function renderShell() {
  const isTecnico = role_==='tecnico';
  const tabs = isTecnico
    ? [{id:'material',label:'Mi material'},{id:'consumo',label:'Consumo'},{id:'solicitar',label:'Solicitar'},{id:'mis-solic',label:'Pedidos'}]
    : [{id:'inventario',label:'Inventario'},{id:'historial',label:'Historial'},{id:'solicitudes',label:'Solicitudes'}];

  container_.innerHTML = `
    <div class="cambios-tabs">
      ${tabs.map(t=>`<div class="cambios-tab bod ${t.id===activeTab_?'active':''}" data-tab="${t.id}">${t.label}</div>`).join('')}
    </div>
    <div id="bod-content" style="padding-top:12px">
      <div class="loading-placeholder"><div class="loading-bar"></div><div class="loading-bar short"></div><div class="loading-bar"></div></div>
    </div>
  `;

  tabs.forEach(t=>{
    container_.querySelector(`.cambios-tab.bod[data-tab="${t.id}"]`)?.addEventListener('click',()=>{
      container_.querySelectorAll('.cambios-tab.bod').forEach(x=>x.classList.remove('active'));
      container_.querySelector(`.cambios-tab.bod[data-tab="${t.id}"]`).classList.add('active');
      activeTab_=t.id; renderTab();
    });
  });

  window.__bodega = { toggleArea, toggleAreaHist, toggleAreaSolic, abrirDespacho, abrirNuevoItem, abrirEntrada, aprobarSolicitud, rechazarSolicitud, verSeriales };
}

// ── Cargar datos ──────────────────────────────────
async function loadData() {
  try {
    const [itemsSnap, salidasSnap, solicSnap, consumosSnap] = await Promise.all([
      db.collection('kardex').doc('inventario').collection('items').get(),
      db.collection('kardex').doc('movimientos').collection('salidas').get(),
      db.collection('solicitudes_material').get(),
      db.collection('kardex').doc('movimientos').collection('consumos').get(),
    ]);
    allItems_    = itemsSnap.docs.map(d=>normalizeItem({id:d.id,...d.data()})).filter(esValido);
    salidas_     = salidasSnap.docs.map(d=>({id:d.id,...d.data()}));
    solicitudes_ = solicSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.fecha?.seconds||0)-(a.fecha?.seconds||0));
    consumos_    = consumosSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.fecha?.seconds||0)-(a.fecha?.seconds||0));
    renderTab();
  } catch(err) {
    console.error('[bodega] Error:',err);
    document.getElementById('bod-content').innerHTML=`<div class="dev-module"><div class="dev-title">Error al cargar</div><p>${err.message}</p></div>`;
  }
}

function getItems(area) { return allItems_.filter(i=>i.area===(area||areaFiltro_)); }

// ── Calcular stock del técnico ────────────────────
function calcStockUsuario(usuario) {
  const stockU = {};
  salidas_.forEach(s=>{
    if((s.usuarioResponsable||s.tecnicoNombre)!==usuario) return;
    (s.items||[]).forEach(i=>{
      const c=safeNum(i.cantidad);
      if(!i.itemId||c<=0) return;
      stockU[i.itemId]=(stockU[i.itemId]||0)+c;
    });
  });
  consumos_.forEach(c=>{
    if(c.usuarioOperativo!==usuario) return;
    (c.items||[]).forEach(i=>{
      const cant=safeNum(i.cantidad);
      if(!i.itemId||cant<=0) return;
      stockU[i.itemId]=Math.max(0,(stockU[i.itemId]||0)-cant);
    });
  });
  return stockU;
}

// ── Render tab ────────────────────────────────────
function renderTab() {
  switch(activeTab_) {
    case 'material':    renderMiMaterial();    break;
    case 'consumo':     renderConsumo();        break;
    case 'solicitar':   renderFormSolicitar(); break;
    case 'mis-solic':   renderMisSolicitudes();break;
    case 'inventario':  renderInventario();    break;
    case 'historial':   renderHistorial();     break;
    case 'solicitudes': renderSolicitudes();   break;
  }
}

// ══════════════════════════════════════════════════
// VISTA TÉCNICO
// ══════════════════════════════════════════════════

function renderMiMaterial() {
  const content  = document.getElementById('bod-content');
  const usuario  = destino_ || session_.displayName;
  const stockU   = calcStockUsuario(usuario);
  const misItems = Object.entries(stockU)
    .map(([id,cant])=>({cant,item:allItems_.find(i=>i.id===id)}))
    .filter(e=>e.cant>0&&e.item)
    .sort((a,b)=>safeStr(a.item.name).localeCompare(safeStr(b.item.name)));

  content.innerHTML=`
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div>
          <div class="section-title">Mi material</div>
          <div class="section-sub">${usuario} · ${misItems.length} items asignados</div>
        </div>
        <button class="icon-btn bod" onclick="window.__bodega.abrirDespacho()" style="display:none"></button>
      </div>
      ${!misItems.length?`<div class="dev-module anim-up d1"><div class="dev-title">Sin material asignado</div><p>No tienes material despachado. Solicita a bodega.</p></div>`:`
      <div class="flex-col gap-8 anim-up d1">
        ${misItems.map(e=>{
          const bajo=e.cant>0&&e.cant<=e.item.minStock;
          return `<div class="bod-item-card" style="background:${bajo?'rgba(245,158,11,.06)':'var(--glass)'};border-color:${bajo?'rgba(245,158,11,.25)':'var(--border)'}">
            <div style="flex:1;min-width:0">
              <div style="display:flex;align-items:center;gap:8px;margin-bottom:3px">
                <div style="font-size:13px;font-weight:700">${tc(e.item.name)}</div>
                ${bajo?'<div class="bod-badge warn">Poco</div>':''}
                ${e.item.requiereSerial?`<div class="bod-badge" style="color:var(--bod-light);border-color:var(--bod-border);background:var(--bod-glass)" onclick="window.__bodega.verSeriales('${e.item.id}')">Serial</div>`:''}
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
    </div>`;
}

// ── Consumo (técnico registra lo que usó en una OT) ─
function renderConsumo() {
  const content = document.getElementById('bod-content');
  const usuario = destino_ || session_.displayName;
  const misConsumosU = consumos_.filter(c=>c.usuarioOperativo===usuario);

  content.innerHTML=`
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div><div class="section-title">Consumo de material</div><div class="section-sub">${misConsumosU.length} registros</div></div>
        <button class="icon-btn bod" onclick="window.__bodega._abrirRegistrarConsumo()" title="Registrar consumo">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>
      ${!misConsumosU.length?`<div class="dev-module anim-up d1"><div class="dev-title">Sin consumos registrados</div><p>Registra el material que usas en cada orden de trabajo.</p></div>`:`
      <div class="flex-col gap-8 anim-up d1">
        ${misConsumosU.map(c=>`
          <div class="bod-solic-card" style="background:var(--glass);border-color:var(--border)">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
              <div>
                <div style="font-size:13px;font-weight:700">OT ${safeStr(c.wo)}</div>
                <div style="font-size:10px;color:var(--text-4)">${fmtDate(c.fecha)} · ${safeStr(c.tipoTrabajo)}</div>
              </div>
              <div class="bod-badge" style="color:#22c55e;border-color:rgba(34,197,94,.3);background:rgba(34,197,94,.08)">✓</div>
            </div>
            <div class="flex-col gap-3">
              ${(c.items||[]).map(i=>`<div style="display:flex;justify-content:space-between;font-size:11px">
                <span style="color:var(--text-2)">${safeStr(i.nombre)}</span>
                <span style="font-weight:700">${i.cantidad} ${safeStr(i.unit,'')}${i.serial?` · <span style="color:var(--bod-light)">${i.serial}</span>`:''}</span>
              </div>`).join('')}
            </div>
          </div>`).join('')}
      </div>`}
    </div>`;

  window.__bodega._abrirRegistrarConsumo = () => abrirRegistrarConsumo();
}

function abrirRegistrarConsumo() {
  const usuario = destino_ || session_.displayName;
  const stockU  = calcStockUsuario(usuario);
  const misItems = Object.entries(stockU)
    .map(([id,cant])=>({id,cant,item:allItems_.find(i=>i.id===id)}))
    .filter(e=>e.cant>0&&e.item)
    .sort((a,b)=>safeStr(a.item.name).localeCompare(safeStr(b.item.name)));

  let selConsumo = {}; // itemId -> {cantidad, serial}
  let busqMat = '';
  let tipoSel = TIPOS_TRABAJO[0];

  const ov = document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;z-index:500;background:#0d1117;overflow-y:auto;-webkit-overflow-scrolling:touch;';
  document.body.appendChild(ov);

  function render() {
    const entries = Object.entries(selConsumo).filter(([,v])=>v.cantidad>0);
    ov.innerHTML=`
      <div style="max-width:500px;margin:0 auto;padding:0 0 80px">
        <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;position:sticky;top:0;background:var(--bg);z-index:10">
          <button class="icon-btn" id="btn-cerrar-consumo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div class="section-title">Registrar consumo</div>
        </div>
        <div style="padding:16px 20px" class="flex-col gap-12">
          <div class="form-field">
            <div class="form-label">Número de OT *</div>
            <input class="form-input" id="rc-wo" type="text" inputmode="numeric" placeholder="Ej. 802335101" value="${document.getElementById('rc-wo')?.value||''}"/>
          </div>
          <div class="form-field">
            <div class="form-label">Tipo de trabajo *</div>
            <div class="select-row flex-wrap" id="rc-tipos">
              ${TIPOS_TRABAJO.map(t=>`<div class="select-chip ${t===tipoSel?'active':''}" data-val="${t}">${t}</div>`).join('')}
            </div>
          </div>
          <div>
            <div class="form-label" style="margin-bottom:8px">Materiales usados *</div>
            <div class="buscar-wrap" style="margin-bottom:10px">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="color:var(--text-4);flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input class="buscar-input" id="rc-buscar" placeholder="Buscar material…" value="${busqMat}" autocomplete="off"/>
            </div>
            <div id="rc-lista" class="flex-col gap-6"></div>
          </div>
          ${entries.length?`
          <div>
            <div class="section-label" style="margin-bottom:8px">Resumen</div>
            <div class="flex-col gap-6">
              ${entries.map(([id,v])=>{
                const e=misItems.find(x=>x.id===id);
                return `<div style="background:rgba(34,197,94,.06);border:1px solid rgba(34,197,94,.2);border-radius:10px;padding:10px 12px;display:flex;justify-content:space-between;font-size:12px">
                  <span style="color:var(--text-2)">${e?tc(e.item.name):id}</span>
                  <span style="font-weight:700;color:var(--ok)">${v.cantidad} ${e?safeStr(e.item.unit,''):''}${v.serial?` · ${v.serial}`:''}</span>
                </div>`;
              }).join('')}
            </div>
          </div>`:''}
          <div id="rc-error" class="form-error"></div>
          <button class="btn-primary full bod" id="rc-submit">
            <span id="rc-btn-lbl">${entries.length>0?`Guardar consumo · ${entries.length} material${entries.length>1?'es':''}`:'Selecciona materiales'}</span>
          </button>
        </div>
      </div>
    `;

    // Chips tipo
    ov.querySelector('#btn-cerrar-consumo')?.addEventListener('click', () => { ov.remove(); renderTab(); });
    ov.querySelector('#rc-tipos')?.querySelectorAll('.select-chip').forEach(c=>{
      c.addEventListener('click',()=>{
        tipoSel=c.dataset.val;
        ov.querySelectorAll('#rc-tipos .select-chip').forEach(x=>x.classList.remove('active'));
        c.classList.add('active');
      });
    });

    ov.querySelector('#rc-buscar').addEventListener('input',e=>{busqMat=e.target.value;renderLista();});
    ov.querySelector('#rc-submit').addEventListener('click',handleConsumo);
    renderLista();
  }

  function renderLista() {
    const el=ov.querySelector('#rc-lista');
    if(!el) return;
    const q=busqMat.toLowerCase();
    const filtrados=q?misItems.filter(e=>safeStr(e.item.name,'').toLowerCase().includes(q)||safeStr(e.item.sapCode,'').includes(q)):misItems;
    if(!filtrados.length){el.innerHTML='<p style="font-size:12px;color:var(--text-4);text-align:center;padding:12px">Sin material asignado</p>';return;}

    el.innerHTML=filtrados.map(e=>{
      const sd=selConsumo[e.id]||{cantidad:0,serial:''};
      const esSer=e.item.requiereSerial;
      return `<div class="bod-solicitar-row" style="background:${sd.cantidad>0?'rgba(34,197,94,.06)':'var(--glass)'};border-color:${sd.cantidad>0?'rgba(34,197,94,.2)':'var(--border)'}">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:600">${tc(e.item.name)}</div>
          <div style="font-size:10px;color:var(--text-4)">Disponible: ${e.cant} ${safeStr(e.item.unit,'')}</div>
          ${esSer&&sd.cantidad>0?`<input class="form-input" style="margin-top:6px;font-size:11px;padding:6px 10px" id="ser-${e.id}" placeholder="Serial…" value="${sd.serial}" onchange="window.__bod_serial_upd('${e.id}',this.value)"/>`:''}
        </div>
        ${esSer?`
        <button class="action-chip ${sd.cantidad>0?'ok':'muted'}" onclick="window.__bod_tog_ser('${e.id}')" style="${sd.cantidad>0?'':'color:var(--text-3);border-color:var(--border);background:var(--glass)'}">
          ${sd.cantidad>0?'✓ Sel.':'Selec.'}
        </button>`:`
        <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
          <button class="icon-btn" style="width:32px;height:32px;font-size:18px;font-weight:700" onclick="window.__bod_dec('${e.id}')">−</button>
          <div style="font-size:18px;font-weight:800;min-width:24px;text-align:center;color:${sd.cantidad>0?'var(--ok)':'var(--text-4)'}">${sd.cantidad}</div>
          <button class="icon-btn" style="width:32px;height:32px;font-size:18px;font-weight:700;${sd.cantidad<e.cant?'color:var(--bod-light);border-color:var(--bod-border);background:var(--bod-glass)':''}" onclick="window.__bod_inc('${e.id}','${e.cant}')">+</button>
        </div>`}
      </div>`;
    }).join('');
  }

  window.__bod_dec=(id)=>{if(selConsumo[id]&&selConsumo[id].cantidad>0){selConsumo[id].cantidad--;if(selConsumo[id].cantidad===0)delete selConsumo[id];}render();};
  window.__bod_inc=(id,max)=>{const m=safeNum(max);if(!selConsumo[id])selConsumo[id]={cantidad:0,serial:''};if(selConsumo[id].cantidad<m){selConsumo[id].cantidad++;}render();};
  window.__bod_tog_ser=(id)=>{if(selConsumo[id]&&selConsumo[id].cantidad>0){delete selConsumo[id];}else{selConsumo[id]={cantidad:1,serial:''};}render();};
  window.__bod_serial_upd=(id,val)=>{if(selConsumo[id])selConsumo[id].serial=val;};

  async function handleConsumo() {
    const wo  = ov.querySelector('#rc-wo').value.trim();
    const errEl=ov.querySelector('#rc-error');
    errEl.style.display='none';
    const tipo=tipoSel;
    const items=Object.entries(selConsumo).filter(([,v])=>v.cantidad>0);
    if(!wo){errEl.textContent='Ingresa el número de OT.';errEl.style.display='block';return;}
    if(!items.length){errEl.textContent='Selecciona al menos un material.';errEl.style.display='block';return;}
    // Validar seriales
    for(const[id,v] of items){
      const e=misItems.find(x=>x.id===id);
      if(e?.item.requiereSerial&&!v.serial){errEl.textContent=`Ingresa el serial de: ${tc(e.item.name)}`;errEl.style.display='block';return;}
    }
    setLoading('rc-btn-lbl','Guardando…',true);
    try {
      const consumoItems=items.map(([id,v])=>{
        const e=misItems.find(x=>x.id===id);
        return{itemId:id,nombre:e?e.item.name:'—',unit:e?e.item.unit:'',sapCode:e?e.item.sapCode:'',cantidad:v.cantidad,serial:v.serial||''};
      });
      await db.collection('kardex').doc('movimientos').collection('consumos').add({
        wo,tipoTrabajo:tipo,area:area_||'CAMBIOS',usuarioOperativo:destino_||session_.displayName,
        registradoPor:uid_,registradoPorNombre:session_.displayName,
        items:consumoItems,fecha:firebase.firestore.Timestamp.now(),
      });
      consumos_.unshift({wo,tipoTrabajo:tipo,items:consumoItems,fecha:{seconds:Date.now()/1000},usuarioOperativo:destino_||session_.displayName});
      ov.remove();
      toast('Consumo registrado','ok');
      renderConsumo();
    } catch(err){errEl.textContent=`Error: ${err.message}`;errEl.style.display='block';setLoading('rc-btn-lbl','Guardar consumo',false);}
  }

  render();
}

// ── Solicitar material ────────────────────────────
function renderFormSolicitar() {
  const content  = document.getElementById('bod-content');
  const misItems = getItems(area_);
  let sel=[], busq='';

  function render() {
    content.innerHTML=`
      <div class="flex-col gap-12">
        <div class="panel-header anim-up"><div class="section-title">Solicitar material</div></div>
        ${sel.length?`
        <div class="anim-up d1">
          <div class="section-label" style="margin-bottom:8px">Tu pedido · ${sel.length} material${sel.length>1?'es':''}</div>
          <div class="flex-col gap-6">
            ${sel.map((s,idx)=>`
              <div class="bod-solicitar-row" style="background:rgba(139,92,246,.06);border-color:var(--bod-border)">
                <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600">${tc(s.name)}</div><div style="font-size:10px;color:var(--text-4)">${s.stock} ${s.unit} disponibles</div></div>
                <div style="display:flex;align-items:center;gap:8px;flex-shrink:0">
                  <button class="icon-btn" style="width:30px;height:30px;font-size:16px" id="sol-dec-${idx}">−</button>
                  <div style="font-size:16px;font-weight:800;min-width:24px;text-align:center;color:var(--bod-light)">${s.cantidad}</div>
                  <button class="icon-btn" style="width:30px;height:30px;font-size:16px;color:var(--bod-light);border-color:var(--bod-border);background:var(--bod-glass)" id="sol-inc-${idx}" ${s.cantidad>=s.stock?'disabled':''}>+</button>
                  <button class="icon-btn" style="width:30px;height:30px" id="sol-del-${idx}"><svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
                </div>
              </div>`).join('')}
          </div>
        </div>`:''}
        <div class="anim-up d2">
          <div class="buscar-wrap" style="margin-bottom:10px">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="color:var(--text-4);flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input class="buscar-input" id="sol-buscar" placeholder="Buscar material…" value="${busq}" autocomplete="off"/>
          </div>
          <div id="sol-lista" class="flex-col gap-6"></div>
        </div>
        <div id="sol-error" class="form-error"></div>
        <button class="btn-primary full bod anim-up d2" id="sol-submit" ${!sel.length?'disabled style="opacity:.5"':''}>
          <span id="sol-btn-lbl">${sel.length>0?`Enviar solicitud · ${sel.length} material${sel.length>1?'es':''}`:'Selecciona materiales'}</span>
        </button>
      </div>
    `;
    sel.forEach((_,idx)=>{
      document.getElementById(`sol-dec-${idx}`)?.addEventListener('click',()=>{if(sel[idx].cantidad>1){sel[idx].cantidad--;render();}});
      document.getElementById(`sol-inc-${idx}`)?.addEventListener('click',()=>{if(sel[idx].cantidad<sel[idx].stock){sel[idx].cantidad++;render();}});
      document.getElementById(`sol-del-${idx}`)?.addEventListener('click',()=>{sel.splice(idx,1);render();});
    });
    document.getElementById('sol-buscar')?.addEventListener('input',e=>{busq=e.target.value;renderLista();});
    document.getElementById('sol-submit')?.addEventListener('click',handleEnviar);
    renderLista();
  }

  function renderLista() {
    const el=document.getElementById('sol-lista');
    if(!el) return;
    const selIds=new Set(sel.map(s=>s.itemId));
    const q=busq.toLowerCase();
    const lista=q?misItems.filter(i=>i.name.toLowerCase().includes(q)):misItems;
    el.innerHTML=lista.map(item=>{
      const agregado=selIds.has(item.id);
      return `<div class="bod-solicitar-row" style="background:${agregado?'rgba(34,197,94,.06)':'var(--glass)'};border-color:${agregado?'rgba(34,197,94,.2)':'var(--border)'};cursor:${agregado||item.stock===0?'default':'pointer'}" data-item="${item.id}">
        <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600">${tc(item.name)}</div><div style="font-size:10px;color:var(--text-4)">${item.sapCode?`SAP: ${item.sapCode} · `:''}Stock: ${item.stock} ${item.unit}</div></div>
        ${agregado?`<span style="font-size:11px;font-weight:700;color:var(--ok)">✓</span>`:item.stock===0?`<span style="font-size:11px;color:var(--text-4)">Agotado</span>`:`<span style="font-size:11px;font-weight:700;color:var(--bod-light)">${item.stock} ${item.unit}</span>`}
      </div>`;
    }).join('');
    el.querySelectorAll('[data-item]').forEach(row=>{
      row.addEventListener('click',()=>{
        const item=misItems.find(i=>i.id===row.dataset.item);
        if(!item||item.stock===0||sel.some(s=>s.itemId===item.id)) return;
        mostrarModalCantidad(item,(cant)=>{sel.push({itemId:item.id,name:item.name,unit:item.unit,stock:item.stock,cantidad:cant});render();});
      });
    });
  }

  async function handleEnviar() {
    if(!sel.length) return;
    const errEl=document.getElementById('sol-error');
    errEl.style.display='none';
    setLoading('sol-btn-lbl','Enviando…',true);
    try {
      const data={
        usuarioUid:uid_,usuarioNombre:session_.displayName,usuarioOperativo:destino_,
        area:area_,materiales:sel.map(s=>({itemId:s.itemId,nombre:s.name,unit:s.unit,cantidad:s.cantidad})),
        estado:'pendiente',fecha:firebase.firestore.Timestamp.now(),notas:'',
      };
      const ref=await db.collection('solicitudes_material').add(data);
      solicitudes_.unshift({id:ref.id,...data});
      sel=[];render();
      toast('Solicitud enviada','ok');
    } catch(err){errEl.textContent=`Error: ${err.message}`;errEl.style.display='block';setLoading('sol-btn-lbl','Enviar solicitud',false);}
  }

  render();
}

// ── Mis solicitudes ───────────────────────────────
function renderMisSolicitudes() {
  const content  = document.getElementById('bod-content');
  const misSolic = solicitudes_.filter(s=>s.usuarioUid===uid_);
  const BADGE={pendiente:{color:'#fbbf24',bg:'rgba(245,158,11,.08)',label:'Pendiente'},aprobado:{color:'#22c55e',bg:'rgba(34,197,94,.08)',label:'Aprobado'},rechazado:{color:'#ef4444',bg:'rgba(239,68,68,.08)',label:'Rechazado'}};

  content.innerHTML=`
    <div class="flex-col gap-12">
      <div class="panel-header anim-up"><div class="section-title">Mis solicitudes</div></div>
      ${!misSolic.length?`<div class="dev-module anim-up d1"><div class="dev-title">Sin solicitudes</div><p>Aún no has solicitado material.</p></div>`:`
      <div class="flex-col gap-8 anim-up d1">
        ${misSolic.map(s=>{
          const b=BADGE[s.estado]||BADGE.pendiente;
          return `<div class="bod-solic-card" style="border-color:${b.color}33">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
              <div style="font-size:10px;color:var(--text-4)">${fmtDate(s.fecha)}</div>
              <div class="bod-badge" style="color:${b.color};border-color:${b.color}44;background:${b.bg}">${b.label}</div>
            </div>
            <div class="flex-col gap-4">
              ${(s.materiales||[]).map(m=>`<div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--text-2)">${tc(m.nombre||m.name||'—')}</span><span style="font-weight:700">${m.cantidad} ${safeStr(m.unit||m.unidad,'')}</span></div>`).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>`}
    </div>`;
}

// ══════════════════════════════════════════════════
// VISTA ADMIN/ASISTENTE
// ══════════════════════════════════════════════════

function renderInventario() {
  const content  = document.getElementById('bod-content');
  const items    = getItems(areaFiltro_);
  const agotados = items.filter(i=>i.stock===0).length;
  const bajos    = items.filter(i=>i.stock>0&&i.stock<=i.minStock).length;

  content.innerHTML=`
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div><div class="section-title">Inventario</div><div class="section-sub">${items.length} items · ${agotados} agotados · ${bajos} bajo mínimo</div></div>
        <div style="display:flex;gap:8px">
          <button class="icon-btn bod" onclick="window.__bodega.abrirDespacho()" title="Nueva salida">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
          <button class="icon-btn bod" onclick="window.__bodega.abrirNuevoItem()" title="Nuevo item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      </div>
      <div class="bod-toggle anim-up d1">
        <div class="bod-toggle-btn ${areaFiltro_==='CAMBIOS'?'active':''}" onclick="window.__bodega.toggleArea('CAMBIOS')">CAMBIOS</div>
        <div class="bod-toggle-btn ${areaFiltro_==='AMI'?'active':''}" onclick="window.__bodega.toggleArea('AMI')">AMI</div>
        <div class="bod-toggle-btn ${areaFiltro_==='Caracterizacion'?'active':''}" onclick="window.__bodega.toggleArea('Caracterizacion')">Caracterización</div>
      </div>
      ${agotados?`<div class="otc-alert-card crit anim-up d2"><div class="otc-alert-header">🔴 ${agotados} item${agotados>1?'s':''} agotado${agotados>1?'s':''}</div></div>`:''}
      ${bajos?`<div class="otc-alert-card warn anim-up d2"><div class="otc-alert-header">⚠ ${bajos} item${bajos>1?'s':''} bajo stock mínimo</div></div>`:''}
      <div class="flex-col gap-8 anim-up d2">
        ${!items.length?`<div class="dev-module"><div class="dev-title">Sin items</div></div>`
          :items.sort((a,b)=>a.stock-b.stock).map(item=>renderItemCard(item)).join('')}
      </div>
    </div>`;
}

function toggleArea(area) { areaFiltro_=area; localStorage.setItem('bod_area',area); renderInventario(); }
function toggleAreaHist(area) { areaFiltro_=area; localStorage.setItem('bod_area',area); renderHistorial(); }
function toggleAreaSolic(area) { areaFiltro_=area; localStorage.setItem('bod_area',area); renderSolicitudes(); }

function renderItemCard(item) {
  const bajo=item.stock>0&&item.stock<=item.minStock;
  const agotado=item.stock===0;
  const color=agotado?'#ef4444':bajo?'#fbbf24':'#22c55e';
  const bg=agotado?'rgba(239,68,68,.06)':bajo?'rgba(245,158,11,.06)':'var(--glass)';
  const border=agotado?'rgba(239,68,68,.25)':bajo?'rgba(245,158,11,.25)':'var(--border)';
  return `<div class="bod-item-card" style="background:${bg};border-color:${border}">
    <div style="flex:1;min-width:0">
      <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:3px">
        <div style="font-size:13px;font-weight:700">${tc(item.name)}</div>
        ${agotado?'<div class="bod-badge crit">Agotado</div>':bajo?'<div class="bod-badge warn">Stock bajo</div>':''}
        ${item.requiereSerial?`<div class="bod-badge" style="color:var(--bod-light);border-color:var(--bod-border);background:var(--bod-glass);cursor:pointer" onclick="window.__bodega.verSeriales('${item.id}')">Serial</div>`:''}
      </div>
      <div style="font-size:10px;color:var(--text-4)">${item.sapCode?`SAP: ${item.sapCode}`:''}${item.axCode?` · AX: ${item.axCode}`:''} · Mín: ${item.minStock}</div>
    </div>
    <div style="text-align:right;flex-shrink:0">
      <div style="font-size:22px;font-weight:800;color:${color}">${item.stock}</div>
      <div style="font-size:10px;color:var(--text-4)">${safeStr(item.unit,'')}</div>
    </div>
    <div style="display:flex;gap:6px;width:100%;margin-top:8px">
      <button class="icon-btn" style="flex:1;height:34px;font-size:11px;font-family:'Outfit',sans-serif" onclick="window.__bodega.abrirEntrada('${item.id}')">+ Entrada</button>
      <button class="icon-btn" style="flex:1;height:34px;font-size:11px;font-family:'Outfit',sans-serif" onclick="window.__bodega.abrirNuevoItem('${item.id}')">Editar</button>
    </div>
  </div>`;
}

// ── Historial (salidas + devoluciones) ────────────
function renderHistorial() {
  const content = document.getElementById('bod-content');
  const sorted  = [...salidas_]
    .filter(s => (s.area || 'CAMBIOS') === areaFiltro_)
    .sort((a,b)=>(b.fecha?.seconds||0)-(a.fecha?.seconds||0));

  content.innerHTML=`
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div><div class="section-title">Historial</div><div class="section-sub">${sorted.length} salidas registradas</div></div>
        <button class="icon-btn bod" onclick="window.__bodega.abrirDespacho()" title="Nueva salida">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>
      <div class="bod-toggle anim-up d1">
        <div class="bod-toggle-btn ${areaFiltro_==='CAMBIOS'?'active':''}" onclick="window.__bodega.toggleAreaHist('CAMBIOS')">CAMBIOS</div>
        <div class="bod-toggle-btn ${areaFiltro_==='AMI'?'active':''}" onclick="window.__bodega.toggleAreaHist('AMI')">AMI</div>
        <div class="bod-toggle-btn ${areaFiltro_==='Caracterizacion'?'active':''}" onclick="window.__bodega.toggleAreaHist('Caracterizacion')">Caracterización</div>
      </div>
      ${!sorted.length?`<div class="dev-module anim-up d1"><div class="dev-title">Sin salidas</div></div>`:`
      <div class="flex-col gap-8 anim-up d1">
        ${sorted.map(s=>`
          <div class="bod-solic-card">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
              <div>
                <div style="font-size:13px;font-weight:700">${safeStr(s.tecnicoNombre||s.usuarioResponsable)}</div>
                <div style="font-size:10px;color:var(--text-4)">${fmtDate(s.fecha)} · ${safeStr(s.empresaContratista,'—')} · ${safeStr(s.placaVehiculo,'—')}</div>
              </div>
              <div style="display:flex;gap:6px">
                <button class="bod-badge" style="color:var(--bod-light);border-color:var(--bod-border);background:var(--bod-glass);cursor:pointer" onclick="window.__bodega._verMemo('${s.id}')">Memo</button>
                <button class="bod-badge" style="color:#22c55e;border-color:rgba(34,197,94,.3);background:rgba(34,197,94,.08);cursor:pointer" onclick="window.__bodega._devolucion('${s.id}')">Dev.</button>
              </div>
            </div>
            <div class="flex-col gap-3">
              ${(s.items||[]).slice(0,3).map(m=>`<div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:var(--text-3)">${tc(m.nombre||m.name||'—')}</span><span style="font-weight:600">${m.cantidad} ${safeStr(m.unit,'')}</span></div>`).join('')}
              ${(s.items||[]).length>3?`<div style="font-size:10px;color:var(--text-4)">+${(s.items||[]).length-3} más</div>`:''}
            </div>
          </div>`).join('')}
      </div>`}
    </div>`;

  window.__bodega._verMemo=(id)=>{const s=salidas_.find(x=>x.id===id);if(s)showMemo(s);};
  window.__bodega._devolucion=(id)=>{const s=salidas_.find(x=>x.id===id);if(s)abrirDevolucion(s);};
}

// ── Stock por usuario ─────────────────────────────
function renderStockUsuarios() {
  const content   = document.getElementById('bod-content');
  const itemMap   = Object.fromEntries(allItems_.map(i=>[i.id,i]));
  const stockPorU = {};
  RESPONSABLES.forEach(u=>{stockPorU[u]=calcStockUsuario(u);});

  const hayDatos = RESPONSABLES.some(u=>Object.keys(stockPorU[u]).length>0);
  if(!hayDatos){
    content.innerHTML=`<div class="dev-module anim-up"><div class="dev-title">Sin movimientos</div><p>No hay salidas registradas aún.</p></div>`;
    return;
  }

  content.innerHTML=`
    <div class="flex-col gap-12">
      <div class="panel-header anim-up"><div class="section-title">Stock por usuario</div></div>
      <div class="flex-col gap-12 anim-up d1">
        ${RESPONSABLES.map(u=>{
          const stockU=stockPorU[u];
          const items=Object.entries(stockU).map(([id,cant])=>({cant,item:itemMap[id]})).filter(e=>e.cant>0&&e.item).sort((a,b)=>a.cant-b.cant);
          if(!items.length) return '';
          const criticos=items.filter(e=>e.cant<=0||(e.item.minStock&&e.cant<=e.item.minStock/2)).length;
          const bajos=items.filter(e=>e.cant>0&&e.item.minStock&&e.cant<=e.item.minStock&&e.cant>e.item.minStock/2).length;
          const color=criticos>0?'#ef4444':bajos>0?'#fbbf24':'#22c55e';
          const alertaTxt = criticos>0 ? ('⚠ '+criticos+' crítico'+(criticos>1?'s':'')) : bajos>0 ? ('⚠ '+bajos+' bajo'+(bajos>1?'s':'')) : '✓ Sin alertas';
          return `<div>
            <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
              <div style="width:36px;height:36px;border-radius:10px;background:rgba(37,99,235,.15);display:flex;align-items:center;justify-content:center;font-size:12px;font-weight:800;color:var(--otc-light)">${u.slice(0,2)}</div>
              <div>
                <div style="font-size:14px;font-weight:800">${u}</div>
                <div style="font-size:10px;color:${color}">${alertaTxt}</div>
              </div>
            </div>
            <div class="flex-col gap-6">
              ${items.map(e=>{
                const bajo=e.cant>0&&e.item.minStock&&e.cant<=e.item.minStock;
                const critico=e.cant===0||(e.item.minStock&&e.cant<=e.item.minStock/2);
                const c=critico?'#ef4444':bajo?'#fbbf24':'#22c55e';
                return `<div style="display:flex;align-items:center;gap:12px;padding:10px 14px;background:var(--glass);border:1px solid ${critico?'rgba(239,68,68,.2)':bajo?'rgba(245,158,11,.2)':'var(--border)'};border-radius:10px">
                  <div style="flex:1;min-width:0">
                    <div style="font-size:12px;font-weight:600">${tc(e.item.name)}</div>
                    ${e.item.sapCode?`<div style="font-size:10px;color:var(--text-4)">SAP: ${e.item.sapCode}</div>`:''}
                  </div>
                  <div style="text-align:right;flex-shrink:0">
                    <div style="font-size:20px;font-weight:800;color:${c}">${e.cant}</div>
                    <div style="font-size:10px;color:var(--text-4)">${e.item.unit}</div>
                  </div>
                </div>`;
              }).join('')}
            </div>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

// ── Solicitudes admin ─────────────────────────────
function renderSolicitudes() {
  const content    = document.getElementById('bod-content');
  const solicCampana = solicitudes_.filter(s => (s.area || 'CAMBIOS') === areaFiltro_);
  const pendientes = solicCampana.filter(s=>s.estado==='pendiente');
  const resto      = solicCampana.filter(s=>s.estado!=='pendiente');
  const BADGE={pendiente:{color:'#fbbf24',bg:'rgba(245,158,11,.06)',border:'rgba(245,158,11,.2)',label:'Pendiente'},aprobado:{color:'#22c55e',bg:'rgba(34,197,94,.06)',border:'rgba(34,197,94,.2)',label:'Aprobada'},rechazado:{color:'#ef4444',bg:'rgba(239,68,68,.06)',border:'rgba(239,68,68,.2)',label:'Rechazada'}};

  function cardSolicitud(s, actions) {
    const b=BADGE[s.estado]||BADGE.pendiente;
    return `<div class="bod-solic-card" style="background:${b.bg};border-color:${b.border}">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
        <div>
          <div style="font-size:13px;font-weight:700">${safeStr(s.usuarioNombre)}</div>
          <div style="font-size:10px;color:var(--text-4)">${fmtDate(s.fecha)} · ${safeStr(s.area)}</div>
        </div>
        <div class="bod-badge" style="color:${b.color};border-color:${b.color}33;background:${b.color}11">${b.label}</div>
      </div>
      <div class="flex-col gap-4" style="margin-bottom:${actions?'12px':'0'}">
        ${(s.materiales||[]).map(m=>`<div style="display:flex;justify-content:space-between;font-size:12px"><span style="color:var(--text-2)">${tc(m.nombre||m.name||'—')}</span><span style="font-weight:700">${m.cantidad} ${safeStr(m.unit||m.unidad,'')}</span></div>`).join('')}
      </div>
      ${actions?`<div style="display:flex;gap:8px">
        <button class="btn-action cm" style="flex:1;height:40px;font-size:12px;border-color:var(--bod-border);background:var(--bod-glass);color:var(--bod-light)" onclick="window.__bodega.aprobarSolicitud('${s.id}')">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg> Aprobar
        </button>
        <button class="btn-action danger" style="flex:1;height:40px;font-size:12px" onclick="window.__bodega.rechazarSolicitud('${s.id}')">Rechazar</button>
      </div>`:''}
      ${s.aprobadoPor?`<div style="font-size:10px;color:var(--text-4);margin-top:6px">${b.label} por ${s.aprobadoPor}</div>`:''}
    </div>`;
  }

  content.innerHTML=`
    <div class="flex-col gap-12">
      <div class="panel-header anim-up"><div><div class="section-title">Solicitudes</div><div class="section-sub">${pendientes.length} pendientes · ${resto.length} respondidas</div></div></div>
      <div class="bod-toggle anim-up d1">
        <div class="bod-toggle-btn ${areaFiltro_==='CAMBIOS'?'active':''}" onclick="window.__bodega.toggleAreaSolic('CAMBIOS')">CAMBIOS</div>
        <div class="bod-toggle-btn ${areaFiltro_==='AMI'?'active':''}" onclick="window.__bodega.toggleAreaSolic('AMI')">AMI</div>
        <div class="bod-toggle-btn ${areaFiltro_==='Caracterizacion'?'active':''}" onclick="window.__bodega.toggleAreaSolic('Caracterizacion')">Caracterización</div>
      </div>
      ${pendientes.length?`<div class="section-label anim-up d1">Pendientes</div><div class="flex-col gap-8 anim-up d1">${pendientes.map(s=>cardSolicitud(s,true)).join('')}</div>`:''}
      ${resto.length?`<div class="section-label anim-up d2">Respondidas</div><div class="flex-col gap-8 anim-up d2">${resto.map(s=>cardSolicitud(s,false)).join('')}</div>`:''}
      ${!solicCampana.length?`<div class="dev-module anim-up d1"><div class="dev-title">Sin solicitudes</div></div>`:''}
    </div>`;
}

async function aprobarSolicitud(id) {
  const s=solicitudes_.find(x=>x.id===id);
  if(s) abrirDespacho(s);
}

async function rechazarSolicitud(id) {
  const sheet=document.createElement('div');
  sheet.className='sheet-backdrop open';
  sheet.innerHTML=`<div class="sheet"><div class="sheet-handle"></div><div class="sheet-title">Rechazar solicitud</div><div class="sheet-body">
    <div class="form-label" style="margin-bottom:8px">Motivo (opcional)</div>
    <input class="form-input" id="rej-mot" type="text" placeholder="Motivo…" style="margin-bottom:16px"/>
    <button class="btn-action danger" style="width:100%;height:46px" id="btn-rej"><span id="btn-rej-lbl">Confirmar rechazo</span></button>
  </div></div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener('click',e=>{if(e.target===sheet)sheet.remove();});
  document.getElementById('btn-rej').addEventListener('click',async()=>{
    const motivo=document.getElementById('rej-mot').value.trim();
    setLoading('btn-rej-lbl','Rechazando…',true);
    try{
      await db.collection('solicitudes_material').doc(id).update({estado:'rechazado',aprobadoPor:session_.displayName,fechaAprobacion:firebase.firestore.Timestamp.now(),notas:motivo||null});
      const idx=solicitudes_.findIndex(x=>x.id===id);
      if(idx!==-1) solicitudes_[idx]={...solicitudes_[idx],estado:'rechazado',aprobadoPor:session_.displayName};
      sheet.remove(); renderSolicitudes();
      toast('Solicitud rechazada','warn');
    }catch(err){toast('Error al rechazar','error');setLoading('btn-rej-lbl','Confirmar rechazo',false);}
  });
}

// ── Vista de seriales por item ────────────────────
async function verSeriales(itemId) {
  const item=allItems_.find(i=>i.id===itemId);
  const sheet=document.createElement('div');
  sheet.className='sheet-backdrop open';
  sheet.innerHTML=`<div class="sheet"><div class="sheet-handle"></div>
    <div class="sheet-title">Seriales · ${tc(item?.name||'—')}</div>
    <div class="sheet-body">
      <div class="buscar-wrap" style="margin-bottom:12px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="color:var(--text-4);flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="buscar-input" id="sv-buscar" placeholder="Buscar serial…" autocomplete="off"/>
      </div>
      <div style="display:flex;gap:6px;margin-bottom:12px">
        <div class="select-chip active" data-tab="disponible" id="sv-tab-disp">Disponibles <span id="sv-cnt-disp">0</span></div>
        <div class="select-chip" data-tab="despachado" id="sv-tab-desp">Despachados <span id="sv-cnt-desp">0</span></div>
      </div>
      <div id="sv-lista" style="max-height:60vh;overflow-y:auto">
        <p style="text-align:center;padding:20px;color:var(--text-4);font-size:12px">Cargando…</p>
      </div>
    </div>
  </div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener('click',e=>{if(e.target===sheet)sheet.remove();});

  let tabActual='disponible', seriales=[], busq='';

  function renderLista() {
    const el=document.getElementById('sv-lista');
    if(!el) return;
    const q=busq.toLowerCase();
    const filtrados=seriales.filter(s=>s.estado===tabActual&&(!q||s.serial.toLowerCase().includes(q)));
    if(!filtrados.length){el.innerHTML=`<p style="text-align:center;padding:20px;color:var(--text-4);font-size:12px">Sin seriales ${tabActual==='disponible'?'disponibles':'despachados'}</p>`;return;}
    el.innerHTML=filtrados.map(s=>`
      <div style="background:${s.estado==='disponible'?'rgba(34,197,94,.06)':'rgba(239,68,68,.06)'};border:1px solid ${s.estado==='disponible'?'rgba(34,197,94,.2)':'rgba(239,68,68,.2)'};border-radius:10px;padding:10px 14px;margin-bottom:6px">
        <div style="display:flex;align-items:center;justify-content:space-between">
          <div style="font-size:13px;font-weight:700;font-family:monospace">${s.serial}</div>
          <div class="bod-badge" style="color:${s.estado==='disponible'?'#22c55e':'#ef4444'};border-color:${s.estado==='disponible'?'rgba(34,197,94,.3)':'rgba(239,68,68,.3)'};background:${s.estado==='disponible'?'rgba(34,197,94,.08)':'rgba(239,68,68,.08)'}">
            ${s.estado==='disponible'?'Disponible':'Despachado'}
          </div>
        </div>
        ${s.usuarioDespacho?`<div style="font-size:10px;color:var(--text-4);margin-top:4px">→ ${s.usuarioDespacho} · ${fmtDate(s.fechaSalida)}</div>`:''}
      </div>`).join('');
  }

  function updateTabs() {
    const disp=seriales.filter(s=>s.estado==='disponible').length;
    const desp=seriales.filter(s=>s.estado==='despachado').length;
    document.getElementById('sv-cnt-disp').textContent=disp;
    document.getElementById('sv-cnt-desp').textContent=desp;
    ['disponible','despachado'].forEach(t=>{
      const btn=t==='disponible'?document.getElementById('sv-tab-disp'):document.getElementById('sv-tab-desp');
      btn?.classList.toggle('active',t===tabActual);
    });
  }

  try {
    const snap=await db.collection('kardex').doc('seriales').collection('items').where('itemId','==',itemId).get();
    seriales=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>a.serial.localeCompare(b.serial,undefined,{numeric:true}));
    updateTabs(); renderLista();
  } catch(err) { document.getElementById('sv-lista').innerHTML=`<p style="color:#ef4444;text-align:center;padding:20px;font-size:12px">Error al cargar: ${err.message}</p>`; }

  document.getElementById('sv-buscar')?.addEventListener('input',e=>{busq=e.target.value.trim();renderLista();});
  document.getElementById('sv-tab-disp')?.addEventListener('click',()=>{tabActual='disponible';updateTabs();renderLista();});
  document.getElementById('sv-tab-desp')?.addEventListener('click',()=>{tabActual='despachado';updateTabs();renderLista();});
}

// ── Devolución ────────────────────────────────────
function abrirDevolucion(salida) {
  let selDev={};
  (salida.items||[]).forEach(i=>{selDev[i.itemId]={cantidad:0,nombre:i.nombre||i.name,unit:i.unit,cantMax:i.cantidad,requiereSerial:!!i.requiereSerial,seriales:[],modoSerial:'individual',serialInicio:'',serialFin:''};});

  const sheet=document.createElement('div');
  sheet.className='sheet-backdrop open';
  sheet.innerHTML=`<div class="sheet"><div class="sheet-handle"></div>
    <div class="sheet-title">Devolución — ${safeStr(salida.usuarioResponsable)}</div>
    <div class="sheet-body">
      ${(salida.items||[]).map(i=>`
        <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:13px;font-weight:600">${tc(i.nombre||i.name||'—')}</div>
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-3);cursor:pointer">
              <input type="checkbox" id="dev-chk-${i.itemId}" onchange="window.__dev_toggle('${i.itemId}',this.checked)"/>
              Devolver
            </label>
          </div>
          <div id="dev-campos-${i.itemId}" style="display:none">
            ${!i.requiereSerial?`
            <div class="form-label" style="margin-bottom:6px">Cantidad (máx ${i.cantidad})</div>
            <input class="form-input" id="dev-cant-${i.itemId}" type="number" min="1" max="${i.cantidad}" value="1" style="text-align:center"/>
            `:`
            <div class="form-label" style="margin-bottom:6px">Seriales a devolver</div>
            <textarea class="form-input" id="dev-sers-${i.itemId}" rows="3" placeholder="Un serial por línea…" style="font-family:monospace;font-size:11px"></textarea>`}
          </div>
        </div>`).join('')}
      <div class="form-label" style="margin-bottom:8px">Motivo (opcional)</div>
      <input class="form-input" id="dev-motivo" type="text" placeholder="Ej. Material sobrante…" style="margin-bottom:16px"/>
      <div id="dev-error" class="form-error"></div>
      <button class="btn-primary full bod" id="btn-dev"><span id="btn-dev-lbl">Registrar devolución</span></button>
    </div>
  </div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener('click',e=>{if(e.target===sheet)sheet.remove();});

  window.__dev_toggle=(id,checked)=>{
    document.getElementById(`dev-campos-${id}`).style.display=checked?'':'none';
  };

  document.getElementById('btn-dev').addEventListener('click',async()=>{
    const errEl=document.getElementById('dev-error');
    errEl.style.display='none';
    const motivo=document.getElementById('dev-motivo').value.trim();
    const devItems=[];

    for(const i of (salida.items||[])){
      const chk=document.getElementById(`dev-chk-${i.itemId}`);
      if(!chk?.checked) continue;
      let cant=0,seriales=[];
      if(!i.requiereSerial){
        cant=safeNum(document.getElementById(`dev-cant-${i.itemId}`)?.value);
        if(!cant||cant>i.cantidad){errEl.textContent=`Cantidad inválida para ${tc(i.nombre||i.name)}`;errEl.style.display='block';return;}
      } else {
        const raw=(document.getElementById(`dev-sers-${i.itemId}`)?.value||'').trim();
        seriales=raw?raw.split('\n').map(s=>s.trim()).filter(Boolean):[];
        cant=seriales.length;
        if(!cant){errEl.textContent=`Ingresa seriales para ${tc(i.nombre||i.name)}`;errEl.style.display='block';return;}
      }
      devItems.push({itemId:i.itemId,nombre:i.nombre||i.name,unit:i.unit,cantidad:cant,seriales});
    }

    if(!devItems.length){errEl.textContent='Selecciona al menos un material a devolver.';errEl.style.display='block';return;}

    setLoading('btn-dev-lbl','Registrando…',true);
    try{
      const batch=db.batch();
      for(const d of devItems){
        batch.update(db.collection('kardex').doc('inventario').collection('items').doc(d.itemId),{stock:firebase.firestore.FieldValue.increment(d.cantidad)});
        const idx=allItems_.findIndex(i=>i.id===d.itemId);
        if(idx!==-1) allItems_[idx].stock+=d.cantidad;
      }
      const ajRef=db.collection('kardex').doc('movimientos').collection('ajustes').doc();
      batch.set(ajRef,{tipo:'devolucion',salidaOrigen:salida.id,usuarioResponsable:safeStr(salida.usuarioResponsable),items:devItems,motivo:motivo||'Sin motivo',registradoPor:uid_,registradoPorNombre:session_.displayName,fecha:firebase.firestore.FieldValue.serverTimestamp()});
      await batch.commit();
      sheet.remove(); renderHistorial();
      toast('Devolución registrada','ok');
    }catch(err){errEl.textContent=`Error: ${err.message}`;errEl.style.display='block';setLoading('btn-dev-lbl','Registrar devolución',false);}
  });
}

// ══════════════════════════════════════════════════
// FORMULARIO DESPACHO — 2 pasos
// ══════════════════════════════════════════════════
function abrirDespacho(solicitud=null) {
  const hdr={responsable:RESPONSABLES.includes(solicitud?.usuarioNombre)?solicitud.usuarioNombre:'',contratista:'INNOVA',instalador:'',placa:'',placaOtro:'',fechaSol:new Date().toISOString().split('T')[0],fechaEnt:new Date().toISOString().split('T')[0]};
  let sel=[];
  if(solicitud?.materiales?.length){
    sel=solicitud.materiales.map(m=>{
      const item=allItems_.find(i=>i.id===m.itemId);
      return{itemId:m.itemId,name:m.nombre||m.name||'—',unit:m.unit||m.unidad||'unidades',sapCode:item?.sapCode,axCode:item?.axCode,stock:item?.stock||0,cantidad:m.cantidad,requiereSerial:item?.requiereSerial||false,modoSerial:'individual',seriales:[],serialInicio:'',serialFin:''};
    });
  }

  let step=solicitud?2:1, busq='';
  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;z-index:500;background:#0d1117;overflow-y:auto;-webkit-overflow-scrolling:touch;';
  document.body.appendChild(ov);

  function renderStep1(){
    ov.innerHTML=`<div style="padding:20px;max-width:500px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
        <button id="btn-cerrar-despacho" class="icon-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg></button>
        <div class="section-title">Nueva salida — Datos</div>
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
          <div class="form-field"><div class="form-label">Fecha solicitud</div><input class="form-input" id="hdr-fsol" type="date" value="${hdr.fechaSol}"/></div>
          <div class="form-field"><div class="form-label">Fecha entrega</div><input class="form-input" id="hdr-fent" type="date" value="${hdr.fechaEnt}"/></div>
        </div>
        <div id="s1-err" class="form-error"></div>
        <button class="btn-primary full bod" id="btn-s1">Continuar → Materiales</button>
      </div>
    </div>`;

    setupChipsDyn(ov,'hdr-resp'); setupChipsDyn(ov,'hdr-cont');
    ov.querySelector('#btn-cerrar-despacho')?.addEventListener('click', () => { ov.remove(); renderTab(); });
    ov.querySelector('#hdr-placa')?.querySelectorAll('.select-chip').forEach(c=>{
      c.addEventListener('click',()=>{ov.querySelectorAll('#hdr-placa .select-chip').forEach(x=>x.classList.remove('active'));c.classList.add('active');ov.querySelector('#hdr-placa-otro').style.display=c.dataset.val==='__otro__'?'':'none';});
    });
    ov.querySelector('#btn-s1').addEventListener('click',()=>{
      const resp=ov.querySelector('#hdr-resp .select-chip.active')?.dataset.val;
      const cont=ov.querySelector('#hdr-cont .select-chip.active')?.dataset.val;
      const errEl=ov.querySelector('#s1-err');
      errEl.style.display='none';
      if(!resp||!cont){errEl.textContent='Responsable y contratista son obligatorios.';errEl.style.display='block';return;}
      hdr.responsable=resp;hdr.contratista=cont;
      hdr.instalador=ov.querySelector('#hdr-inst').value.trim();
      hdr.placa=ov.querySelector('#hdr-placa .select-chip.active')?.dataset.val||'';
      hdr.placaOtro=ov.querySelector('#hdr-placa-otro').value.trim();
      hdr.fechaSol=ov.querySelector('#hdr-fsol').value;
      hdr.fechaEnt=ov.querySelector('#hdr-fent').value;
      step=2;renderStep2();
    });
  }

  function renderStep2(){
    const itemsArea=allItems_.filter(i=>i.area===(solicitud?.area||areaFiltro_));
    ov.innerHTML=`
    <div style="max-width:500px;margin:0 auto;display:flex;flex-direction:column;min-height:100vh">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;position:sticky;top:0;background:var(--bg);z-index:10">
        <button class="icon-btn" id="back1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg></button>
        <div class="section-title">Materiales del despacho</div>
      </div>
      ${sel.length?`<div style="padding:12px 20px;border-bottom:1px solid var(--border);background:var(--bod-glass)">
        <div class="section-label" style="margin-bottom:8px">${sel.length} material${sel.length>1?'es':''} seleccionado${sel.length>1?'s':''}</div>
        <div class="flex-col gap-8">
          ${sel.map((s,idx)=>`<div>
            <div style="display:flex;align-items:center;gap:8px">
              <div style="flex:1;font-size:12px;font-weight:600">${tc(s.name)}</div>
              <button class="icon-btn" style="width:28px;height:28px" onclick="window.__d_del(${idx})"><svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="12" height="12"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>
            <div style="display:flex;align-items:center;gap:10px;margin-top:6px">
              <button class="icon-btn" style="width:34px;height:34px;font-size:18px;font-weight:700" onclick="window.__d_dec(${idx})">−</button>
              <div style="flex:1;text-align:center;font-size:20px;font-weight:800;color:var(--bod-light)">${s.cantidad} <span style="font-size:11px;color:var(--text-4)">${s.unit}</span></div>
              <button class="icon-btn" style="width:34px;height:34px;font-size:18px;font-weight:700;color:var(--bod-light);border-color:var(--bod-border);background:var(--bod-glass)" onclick="window.__d_inc(${idx})">+</button>
            </div>
            ${s.requiereSerial?renderSerial(s,idx):''}
          </div>`).join('<div style="height:1px;background:var(--border);margin:4px 0"></div>')}
        </div>
      </div>`:''}
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
          <span id="btn-des-lbl">${sel.length>0?`Registrar salida · ${sel.length} material${sel.length>1?'es':''}`:'Agrega materiales'}</span>
        </button>
      </div>
    </div>`;

    window.__d_del=idx=>{sel.splice(idx,1);renderStep2();};
    window.__d_dec=idx=>{if(sel[idx].cantidad>1){sel[idx].cantidad--;}renderStep2();};
    window.__d_inc=idx=>{if(sel[idx].cantidad<sel[idx].stock){sel[idx].cantidad++;}renderStep2();};
    window.__d_smod=(idx,modo)=>{sel[idx].modoSerial=modo;renderStep2();};
    window.__d_sadd=idx=>{const v=document.getElementById(`si-${idx}`)?.value.trim();if(v&&!sel[idx].seriales.includes(v)){sel[idx].seriales.push(v);document.getElementById(`si-${idx}`).value='';renderStep2();}};
    window.__d_sdel=(idx,i)=>{sel[idx].seriales.splice(i,1);renderStep2();};
    window.__d_srange=idx=>{sel[idx].serialInicio=document.getElementById(`sri-${idx}`)?.value.trim()||'';sel[idx].serialFin=document.getElementById(`srf-${idx}`)?.value.trim()||'';};

    ov.querySelector('#back1').onclick=()=>{step=1;renderStep1();};
    ov.querySelector('#bus-mat').addEventListener('input',e=>{busq=e.target.value;renderLista();});
    ov.querySelector('#btn-des').addEventListener('click',handleDespacho);
    renderLista();

    function renderLista(){
      const el=ov.querySelector('#lista-mat');
      if(!el) return;
      const q=busq.toLowerCase();
      const selIds=new Set(sel.map(s=>s.itemId));
      const lista=q?itemsArea.filter(i=>i.name.toLowerCase().includes(q)||i.sapCode.includes(q)):itemsArea;
      el.innerHTML=lista.map(item=>{
        const ag=selIds.has(item.id);
        return `<div class="bod-solicitar-row" style="background:${ag?'rgba(34,197,94,.06)':'var(--glass)'};border-color:${ag?'rgba(34,197,94,.2)':'var(--border)'};cursor:${ag||item.stock===0?'default':'pointer'}" data-item="${item.id}">
          <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600">${tc(item.name)}</div><div style="font-size:10px;color:var(--text-4)">${item.sapCode?`SAP: ${item.sapCode} · `:''}Stock: ${item.stock} ${item.unit}</div></div>
          ${ag?`<span style="font-size:11px;font-weight:700;color:var(--ok)">✓</span>`:item.stock===0?`<span style="font-size:11px;color:var(--text-4)">Agotado</span>`:`<span style="font-size:11px;font-weight:700;color:var(--bod-light)">${item.stock} ${item.unit}</span>`}
        </div>`;
      }).join('');
      el.querySelectorAll('[data-item]').forEach(row=>{
        row.addEventListener('click',()=>{
          const item=itemsArea.find(i=>i.id===row.dataset.item);
          if(!item||item.stock===0||sel.some(s=>s.itemId===item.id)) return;
          mostrarModalCantidad(item,cant=>{
            sel.push({itemId:item.id,name:item.name,unit:item.unit,stock:item.stock,sapCode:item.sapCode,axCode:item.axCode,cantidad:cant,requiereSerial:item.requiereSerial,modoSerial:'individual',seriales:[],serialInicio:'',serialFin:''});
            renderStep2();
          });
        });
      });
    }
  }

  function renderSerial(s,idx){
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
      <div class="flex-col gap-4">${s.seriales.map((ser,i)=>`<div style="display:flex;align-items:center;gap:6px;font-size:11px"><div style="flex:1;background:var(--glass);border:1px solid var(--border);border-radius:6px;padding:4px 8px;font-family:monospace">${ser}</div><button class="icon-btn" style="width:24px;height:24px" onclick="window.__d_sdel(${idx},${i})"><svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="10" height="10"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button></div>`).join('')}</div>
      `:`
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <div><div style="font-size:10px;color:var(--text-4);margin-bottom:4px">Inicio</div><input class="form-input" id="sri-${idx}" type="text" value="${s.serialInicio}" placeholder="Primer serial" style="font-size:12px;padding:8px 10px" onblur="window.__d_srange(${idx})"/></div>
        <div><div style="font-size:10px;color:var(--text-4);margin-bottom:4px">Fin</div><input class="form-input" id="srf-${idx}" type="text" value="${s.serialFin}" placeholder="Último serial" style="font-size:12px;padding:8px 10px" onblur="window.__d_srange(${idx})"/></div>
      </div>`}
    </div>`;
  }

  async function handleDespacho(){
    if(!sel.length) return;
    const errEl=ov.querySelector('#s2-err');
    const btn=ov.querySelector('#btn-des');
    errEl.style.display='none'; btn.disabled=true;
    document.getElementById('btn-des-lbl').innerHTML='<div class="spinner"></div>';
    const placa=hdr.placa==='__otro__'?hdr.placaOtro:hdr.placa;
    try{
      const salidaData={
        area:solicitud?.area||areaFiltro_,
        usuarioResponsable:hdr.responsable,empresaContratista:hdr.contratista,
        instaladorResponsable:hdr.instalador,placaVehiculo:placa,
        fechaSolicitud:hdr.fechaSol,fechaEntrega:hdr.fechaEnt,
        entregadoPor:session_.displayName,entregadoPorUid:uid_,
        solicitudId:solicitud?.id||null,
        items:sel.map(s=>({itemId:s.itemId,sapCode:s.sapCode,axCode:s.axCode,nombre:s.name,unit:s.unit,cantidad:s.cantidad,requiereSerial:s.requiereSerial,modoSerial:s.requiereSerial?s.modoSerial:null,seriales:s.requiereSerial&&s.modoSerial==='individual'?s.seriales:[],serialInicio:s.requiereSerial&&s.modoSerial==='rango'?s.serialInicio:'',serialFin:s.requiereSerial&&s.modoSerial==='rango'?s.serialFin:''})),
        fecha:firebase.firestore.FieldValue.serverTimestamp(),
      };
      const ref=await db.collection('kardex').doc('movimientos').collection('salidas').add(salidaData);

      // Descontar stock + actualizar seriales
      const batch=db.batch();
      for(const s of sel){
        batch.update(db.collection('kardex').doc('inventario').collection('items').doc(s.itemId),{stock:firebase.firestore.FieldValue.increment(-s.cantidad)});
      }
      if(solicitud?.id){
        batch.update(db.collection('solicitudes_material').doc(solicitud.id),{estado:'aprobado',salidaId:ref.id,aprobadoPor:session_.displayName,fechaAprobacion:firebase.firestore.FieldValue.serverTimestamp()});
      }
      await batch.commit();

      // Actualizar seriales despachados
      for(const s of sel){
        if(!s.requiereSerial) continue;
        let lista=s.seriales||[];
        if(s.modoSerial==='rango'&&s.serialInicio){
          const nI=parseInt(s.serialInicio.replace(/\D/g,''),10);
          const nF=parseInt(s.serialFin.replace(/\D/g,''),10);
          const prefix=s.serialInicio.replace(/\d+$/,'');
          const digits=String(nF).length;
          lista=[];
          for(let n=nI;n<=nF;n++) lista.push(prefix+String(n).padStart(digits,'0'));
        }
        if(!lista.length) continue;
        try{
          const snapSer=await db.collection('kardex').doc('seriales').collection('items').where('itemId','==',s.itemId).where('estado','==','disponible').get();
          const serSet=new Set(lista);
          const updates=snapSer.docs.filter(d=>serSet.has(d.data().serial)).map(d=>d.ref.update({estado:'despachado',salidaId:ref.id,fechaSalida:firebase.firestore.FieldValue.serverTimestamp(),usuarioDespacho:hdr.responsable}));
          await Promise.all(updates);
        }catch(e){console.warn('Seriales:',e);}
      }

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
      toast('Salida registrada','ok');
      showMemo({...salidaData,id:ref.id,fecha:new Date()});
      renderSolicitudes();
    }catch(err){
      console.error('[bodega] Error despacho:',err);
      errEl.textContent=`Error: ${err.message}`;errEl.style.display='block';
      btn.disabled=false;
      document.getElementById('btn-des-lbl').textContent=`Registrar salida · ${sel.length} material${sel.length>1?'es':''}`;
    }
  }

  if(step===2) renderStep2(); else renderStep1();
}

// ── Memo oficial DELSUR ───────────────────────────
function showMemo(salida) {
  const memo={
    USUARIO_RESPONSABLE:    safeStr(salida.usuarioResponsable||salida.tecnicoNombre,''),
    EMPRESA_CONTRATISTA:    safeStr(salida.empresaContratista,''),
    INSTALADOR_RESPONSABLE: safeStr(salida.instaladorResponsable,''),
    ENTREGADO_POR:          safeStr(salida.entregadoPor||salida.registradoPorNombre,''),
    PLACA_VEHICULO:         safeStr(salida.placaVehiculo,''),
    FECHA_SOLICITUD:        safeStr(salida.fechaSolicitud,''),
    FECHA_ENTREGA:          safeStr(salida.fechaEntrega,''),
    MATERIALES:(salida.items||[]).map(i=>({RESERVA:safeStr(i.sapCode,''),STOCK:safeStr(i.axCode,''),CANTIDAD:safeNum(i.cantidad),DESCRIPCION:safeStr(i.nombre||i.name,''),_requiereSerial:!!i.requiereSerial,_modoSerial:i.modoSerial||'individual',_seriales:i.seriales||[],_serialInicio:i.serialInicio||'',_serialFin:i.serialFin||''})),
    SERIALES:(salida.items||[]).filter(i=>i.requiereSerial),
  };

  const sheet=document.createElement('div');
  sheet.className='sheet-backdrop open';
  sheet.innerHTML=`<div class="sheet" style="max-height:90vh;overflow-y:auto">
    <div class="sheet-handle"></div>
    <div class="sheet-title">Memo de despacho</div>
    <div class="sheet-body">
      <div style="text-align:center;border-bottom:1px solid var(--border);padding-bottom:12px;margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;text-transform:uppercase">DISTRIBUIDORA DE ELECTRICIDAD DELSUR S.A. DE C.V.</div>
        <div style="font-size:10px;color:var(--text-4);margin-top:2px">OTC - GERENCIA COMERCIAL · DESPACHO/CARGA DE MATERIALES</div>
      </div>
      <div class="flex-col gap-6" style="margin-bottom:16px">
        ${[['USUARIO RESPONSABLE',memo.USUARIO_RESPONSABLE],['EMPRESA CONTRATISTA',memo.EMPRESA_CONTRATISTA],['INSTALADOR RESPONSABLE',memo.INSTALADOR_RESPONSABLE],['ENTREGADO POR',memo.ENTREGADO_POR],['PLACA DE VEHICULO',memo.PLACA_VEHICULO],['FECHA SOLICITUD',memo.FECHA_SOLICITUD],['FECHA ENTREGA',memo.FECHA_ENTREGA]].map(([k,v])=>`
          <div style="display:flex;gap:8px;font-size:11px">
            <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--text-4);min-width:120px;padding-top:2px">${k}:</div>
            <div style="font-weight:600;border-bottom:1px solid var(--border-md);flex:1;padding-bottom:2px">${v||'—'}</div>
          </div>`).join('')}
      </div>
      <div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--text-4);margin-bottom:8px">Materiales despachados</div>
      <div style="border:1px solid var(--border-md);border-radius:8px;overflow:hidden;margin-bottom:16px">
        <div style="display:grid;grid-template-columns:3fr 2fr 1fr 3fr;background:rgba(255,255,255,.06);border-bottom:1px solid var(--border)">
          ${['RESERVA','STOCK','CANT.','DESCRIPCIÓN'].map(h=>`<div style="font-size:8px;font-weight:700;padding:6px 8px;text-transform:uppercase;color:var(--text-4)">${h}</div>`).join('')}
        </div>
        ${memo.MATERIALES.map((m,i)=>`<div style="display:grid;grid-template-columns:3fr 2fr 1fr 3fr;${i%2===0?'background:rgba(255,255,255,.02)':''}border-bottom:1px solid rgba(255,255,255,.04)">
          <div style="font-size:10px;padding:6px 8px;font-family:monospace">${m.RESERVA||'—'}</div>
          <div style="font-size:10px;padding:6px 8px;font-family:monospace">${m.STOCK||'—'}</div>
          <div style="font-size:11px;font-weight:700;padding:6px 8px;text-align:center">${m.CANTIDAD}</div>
          <div style="font-size:10px;padding:6px 8px;text-transform:uppercase">${m.DESCRIPCION}</div>
        </div>`).join('')}
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:16px;margin-top:24px">
        <div style="text-align:center"><div style="border-bottom:1px solid var(--border-md);height:32px;margin-bottom:4px"></div><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--text-4)">Firma de entregado</div></div>
        <div style="text-align:center"><div style="border-bottom:1px solid var(--border-md);height:32px;margin-bottom:4px"></div><div style="font-size:9px;font-weight:700;text-transform:uppercase;color:var(--text-4)">Firma de recibido</div></div>
      </div>
    </div>
    <div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:8px">
      <button class="btn-action outline" style="flex:1;height:44px" onclick="this.closest('.sheet-backdrop').remove()">Cerrar</button>
      <button class="btn-primary bod" style="flex:1;height:44px" onclick="window.__bodega._imprimir(window.__memo_data)"><span>🖨️ Imprimir</span></button>
    </div>
  </div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener('click',e=>{if(e.target===sheet)sheet.remove();});
  window.__memo_data=memo;
  window.__bodega._imprimir=(m)=>imprimirDespacho(m);
}

// ── Imprimir formato oficial DELSUR ───────────────
function imprimirDespacho(memo) {
  const cantMap={};
  for(const it of (memo.MATERIALES||[])) cantMap[String(it.RESERVA).trim()]=it.CANTIDAD;

  const serialMap={};
  for(const it of (memo.MATERIALES||[])){
    const sap=String(it.RESERVA||'').trim();
    if(it._seriales&&it._seriales.length>0) serialMap[sap]={tipo:'individual',seriales:it._seriales};
    else if(it._serialInicio){
      const ini=String(it._serialInicio).trim();const fin=String(it._serialFin||'').trim();
      const nIni=parseInt(ini.replace(/\D/g,''),10);const nFin=parseInt(fin.replace(/\D/g,''),10);
      const prefix=ini.replace(/\d+$/,'');
      if(!isNaN(nIni)&&!isNaN(nFin)&&nFin>=nIni&&(nFin-nIni)<=500){
        const expanded=[];const digits=String(nFin).length;
        for(let n=nIni;n<=nFin;n++) expanded.push(prefix+String(n).padStart(digits,'0'));
        serialMap[sap]={tipo:'individual',seriales:expanded};
      } else serialMap[sap]={tipo:'rango',inicio:ini,fin:fin};
    }
  }

  const css=`@page{size:215.9mm 279.4mm;margin:8.8mm 6.3mm 4.9mm 12.7mm;}*{margin:0;padding:0;box-sizing:border-box;}body{font-family:Arial,sans-serif;font-size:6pt;color:#000;background:#fff;width:196.9mm;}.empresa{font-size:7pt;font-weight:bold;}.sub{font-size:6pt;}.lbl{font-size:5.5pt;display:block;}.linea{font-size:6pt;font-weight:bold;display:inline-block;border-bottom:0.4pt solid #000;min-height:2.5mm;padding-bottom:0.2mm;min-width:45mm;max-width:90mm;}.tm{width:196.9mm;border-collapse:collapse;font-size:5.5pt;margin-top:1.5mm;table-layout:fixed;}.tm td,.tm th{border:0.4pt solid #000;padding:0.25mm 0.4mm;vertical-align:middle;overflow:hidden;line-height:1.35;}.c-sap{width:17mm;}.c-ax{width:11mm;}.c-desc{width:155mm;}.c-cant{width:13.9mm;}.th{font-weight:bold;font-size:6pt;text-align:center;}.sec{font-weight:bold;text-align:center;}.code{text-align:center;font-size:5pt;}.cant{text-align:center;font-weight:bold;}.page2{page-break-before:always;}.titulo-p2{font-size:7pt;font-weight:bold;margin-bottom:2mm;}.pg2{position:relative;width:196.9mm;height:260mm;}.tb{position:absolute;border:0.5pt solid #000;overflow:hidden;display:flex;flex-direction:column;}.tb-hdr{background:#F7C6AC;font-weight:bold;border-bottom:0.5pt solid #000;flex-shrink:0;}.tb-hdr table{width:100%;border-collapse:collapse;table-layout:fixed;}.tb-hdr .cod{font-size:5pt;padding:0.5mm 0.8mm;border-right:0.5pt solid #000;vertical-align:middle;text-align:center;width:15mm;min-width:15mm;max-width:15mm;}.tb-hdr .nom{font-size:5.5pt;padding:0.5mm 0.8mm;vertical-align:middle;text-align:center;}.tb-body{flex:1;min-height:0;overflow:hidden;}.tb-body table{width:100%;height:100%;border-collapse:collapse;table-layout:fixed;}.tb-body td{border:0.3pt solid #ccc;padding:0 0.5mm;font-size:5pt;}.nb{width:15mm;min-width:15mm;max-width:15mm;text-align:center;color:#555;border-right:0.4pt solid #999;}.hc{background:#f5f5f5;font-weight:bold;text-align:center;font-size:4.5pt;border-bottom:0.4pt solid #999;}.cc{text-align:center;border-right:0.3pt solid #999;}.ci{text-align:center;border-right:0.3pt solid #999;}.cf{text-align:center;}.filled{color:#000;font-weight:bold;}@media print{body{-webkit-print-color-adjust:exact;print-color-adjust:exact;}}`;

  const v=memo;
  const filas=FILAS_DOC.map(row=>{
    if(row.header==='col') return '<tr><th class="th">RESERVA</th><th class="th">STOCK</th><th class="th">DESCRIPICIÓN</th><th class="th cant">CANTIDAD</th></tr>';
    if(row.header==='sec') return `<tr><td class="sec" colspan="4">${row.sap}</td></tr>`;
    const cant=cantMap[row.sap]||'';
    return `<tr><td class="code">${row.sap}</td><td class="code">${row.ax}</td><td>${row.desc}</td><td class="cant">${cant}</td></tr>`;
  }).join('');

  const p1=`<table style="width:196.9mm;border-collapse:collapse;margin-bottom:1.5mm;"><colgroup><col style="width:98mm"><col style="width:98.9mm"></colgroup>
    <tr><td rowspan="2" style="vertical-align:top;padding-right:2mm;border:none;"><div class="empresa">DISTRUIBUIDORA DE ELECTRICIDAD DELSUR S.A. DE C.V.</div><div class="sub">OTC - GERENCIA COMERCIAL</div><div class="sub">DESPACHO/ CARGA DE MATERIALES</div></td><td style="border:none;padding-bottom:1.5mm;"><span class="lbl">USUARIO RESPONSABLE:</span><span class="linea">${v.USUARIO_RESPONSABLE}</span></td></tr>
    <tr><td style="border:none;padding-bottom:1.5mm;"><span class="lbl">INSTALADOR RESPONSABLE:</span><span class="linea">${v.INSTALADOR_RESPONSABLE}</span></td></tr>
    <tr><td style="border:none;padding-top:2mm;padding-bottom:1.5mm;"><span class="lbl">EMPRESA CONTRATISTA:</span><span class="linea">${v.EMPRESA_CONTRATISTA}</span></td><td style="border:none;padding-top:2mm;padding-bottom:1.5mm;"><span class="lbl">FIRMA DE RECIBIDO:</span><span class="linea">&nbsp;</span></td></tr>
    <tr><td style="border:none;padding-bottom:1.5mm;"><span class="lbl">ENTREGADO POR:</span><span class="linea">${v.ENTREGADO_POR}</span></td><td style="border:none;padding-bottom:1.5mm;"><span class="lbl">PLACA DE VEHICULO:</span><span class="linea">${v.PLACA_VEHICULO}</span></td></tr>
    <tr><td style="border:none;padding-bottom:1.5mm;"><span class="lbl">FIRMA DE ENTREGADO:</span><span class="linea">&nbsp;</span></td><td style="border:none;padding-bottom:1.5mm;"><span class="lbl">FECHA ENTREGA DE MATERIAL:</span><span class="linea">${v.FECHA_ENTREGA}</span></td></tr>
    <tr><td style="border:none;"><span class="lbl">FECHA DE SOLICITUD</span><span class="linea">${v.FECHA_SOLICITUD}</span></td><td style="border:none;"></td></tr>
  </table><table class="tm"><colgroup><col class="c-sap"><col class="c-ax"><col class="c-desc"><col class="c-cant"></colgroup>${filas}</table>`;

  function buildHdrTd(b){return `<div class="tb-hdr"><table><tr><td class="cod">${b.ax}<br>${b.sap}</td><td class="nom">${b.nombre}</td></tr></table></div>`;}
  function buildFilas(b){
    const serData=serialMap[b.sap]||null;
    let rows='';
    if(b.tipo==='sello'){
      rows+='<tr><td class="nb hc"></td><td class="cc hc">Cantidad</td><td class="ci hc">Inicio</td><td class="cf hc">Fin</td></tr>';
      for(let i=1;i<=b.filas;i++){let cant='',ini='',fin='';if(serData&&serData.tipo==='rango'&&i===1){cant=cantMap[b.sap]||'';ini=serData.inicio||'';fin=serData.fin||'';}const cls=cant?' class="filled"':'';rows+=`<tr><td class="nb">${i}</td><td class="cc"${cls}>${cant}</td><td class="ci"${cls}>${ini}</td><td class="cf"${cls}>${fin}</td></tr>`;}
    }else{
      const sers=serData&&serData.tipo==='individual'?serData.seriales:[];
      for(let i=1;i<=b.filas;i++){const val=sers[i-1]||'';const cls=val?' class="filled"':'';rows+=`<tr><td class="nb">${i}</td><td${cls}>${val}</td></tr>`;}
    }
    return `<div class="tb-body"><table>${rows}</table></div>`;
  }

  const p2=`<div class="page2"><div class="titulo-p2">Serial de medidores /sellos entregados</div><div class="pg2">
    <div class="tb" style="left:0;top:0;width:62.6mm;height:166.4mm;">${buildHdrTd(BLOQUES_SERIALES[0])}${buildFilas(BLOQUES_SERIALES[0])}</div>
    <div class="tb" style="left:69.2mm;top:0;width:62.9mm;height:166.4mm;">${buildHdrTd(BLOQUES_SERIALES[1])}${buildFilas(BLOQUES_SERIALES[1])}</div>
    <div class="tb" style="left:138.1mm;top:0;width:50.4mm;height:59.7mm;">${buildHdrTd(BLOQUES_SERIALES[2])}${buildFilas(BLOQUES_SERIALES[2])}</div>
    <div class="tb" style="left:0;top:172.3mm;width:62.6mm;height:36.1mm;">${buildHdrTd(BLOQUES_SERIALES[3])}${buildFilas(BLOQUES_SERIALES[3])}</div>
    <div class="tb" style="left:69.2mm;top:172.3mm;width:62.9mm;height:36.1mm;">${buildHdrTd(BLOQUES_SERIALES[4])}${buildFilas(BLOQUES_SERIALES[4])}</div>
    <div class="tb" style="left:0;top:215mm;width:82.3mm;height:36.1mm;">${buildHdrTd(BLOQUES_SERIALES[5])}${buildFilas(BLOQUES_SERIALES[5])}</div>
  </div></div>`;

  const html=`<!DOCTYPE html><html><head><meta charset="UTF-8"><title>Memo Despacho</title><style>${css}</style></head><body>${p1}${p2}</body></html>`;
  let ifr=document.getElementById('__print_frame');
  if(ifr)ifr.remove();
  ifr=document.createElement('iframe');
  ifr.id='__print_frame';
  ifr.style.cssText='position:fixed;top:-9999px;left:-9999px;width:216mm;height:280mm;border:none;';
  document.body.appendChild(ifr);
  const iDoc=ifr.contentDocument||ifr.contentWindow.document;
  iDoc.open();iDoc.write(html);iDoc.close();
  setTimeout(()=>{try{ifr.contentWindow.print();}catch(e){const w=window.open('','_blank');if(w){w.document.write(html);w.document.close();}}},500);
}

// ── Nuevo/Editar item ─────────────────────────────
function abrirNuevoItem(itemId=null) {
  const item=itemId?allItems_.find(i=>i.id===itemId):null;
  const sheet=document.createElement('div');
  sheet.className='sheet-backdrop open';
  sheet.innerHTML=`<div class="sheet"><div class="sheet-handle"></div>
    <div class="sheet-title">${item?'Editar item':'Nuevo item'}</div>
    <div class="sheet-body">
      <div class="form-field"><div class="form-label">Nombre *</div><input class="form-input" id="ni-nombre" value="${tc(item?.name||'')}" placeholder="Ej. Medidor monofásico"/></div>
      <div class="form-field"><div class="form-label">Código SAP</div><input class="form-input" id="ni-sap" value="${safeStr(item?.sapCode,'')}" placeholder="SAP"/></div>
      <div class="form-field"><div class="form-label">Código AX</div><input class="form-input" id="ni-ax" value="${safeStr(item?.axCode,'')}" placeholder="AX"/></div>
      <div class="form-field"><div class="form-label">Unidad *</div><input class="form-input" id="ni-unit" value="${safeStr(item?.unit,'')}" placeholder="Ej. unidades, metros"/></div>
      <div class="form-field">
        <div class="form-label">Área *</div>
        <div class="select-row" id="ni-area-row">
          ${['CAMBIOS','AMI','Caracterizacion'].map(a=>`<div class="select-chip ${(item?.area||areaFiltro_)===a?'active':''}" data-val="${a}">${a==='Caracterizacion'?'Caracterización':a}</div>`).join('')}
        </div>
      </div>
      <div class="form-field"><div class="form-label">Stock mínimo</div><input class="form-input" id="ni-minstock" type="number" min="0" value="${item?.minStock??5}"/></div>
      ${!item?`<div class="form-field"><div class="form-label">Stock inicial</div><input class="form-input" id="ni-stockinit" type="number" min="0" value="0"/></div>`:''}
      <div class="form-field" style="display:flex;align-items:center;gap:10px">
        <input type="checkbox" id="ni-serial" ${item?.requiereSerial?'checked':''} style="width:18px;height:18px;cursor:pointer"/>
        <label for="ni-serial" style="font-size:13px;font-weight:500;cursor:pointer">Requiere control de seriales</label>
      </div>
      <div id="ni-error" class="form-error"></div>
      <button class="btn-primary full bod" id="btn-ni"><span id="btn-ni-lbl">${item?'Guardar cambios':'Crear item'}</span></button>
    </div>
  </div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener('click',e=>{if(e.target===sheet){sheet.remove();renderInventario();}});
  setupChipsDyn(sheet,'ni-area-row');

  document.getElementById('btn-ni').addEventListener('click',async()=>{
    const nombre=document.getElementById('ni-nombre').value.trim();
    const unit=document.getElementById('ni-unit').value.trim();
    const area=sheet.querySelector('#ni-area-row .select-chip.active')?.dataset.val;
    const errEl=document.getElementById('ni-error');
    errEl.style.display='none';
    if(!nombre||!unit||!area){errEl.textContent='Nombre, unidad y área son obligatorios.';errEl.style.display='block';return;}
    setLoading('btn-ni-lbl','Guardando…',true);
    try{
      const data={name:nombre,unit,area,sapCode:document.getElementById('ni-sap').value.trim()||null,axCode:document.getElementById('ni-ax').value.trim()||null,minStock:safeNum(document.getElementById('ni-minstock').value),requiereSerial:document.getElementById('ni-serial').checked};
      if(itemId){
        await db.collection('kardex').doc('inventario').collection('items').doc(itemId).update(data);
        const idx=allItems_.findIndex(i=>i.id===itemId);
        if(idx!==-1) allItems_[idx]=normalizeItem({...allItems_[idx],...data});
        toast('Item actualizado','ok');
      }else{
        const stockInit=safeNum(document.getElementById('ni-stockinit')?.value);
        const ref=await db.collection('kardex').doc('inventario').collection('items').add({...data,stock:stockInit,creadoEn:firebase.firestore.FieldValue.serverTimestamp(),creadoPor:uid_});
        allItems_.push(normalizeItem({id:ref.id,...data,stock:stockInit}));
        toast('Item creado','ok');
      }
      sheet.remove();renderInventario();
    }catch(err){errEl.textContent=`Error: ${err.message}`;errEl.style.display='block';setLoading('btn-ni-lbl',itemId?'Guardar cambios':'Crear item',false);}
  });
}

// ── Entrada de material ───────────────────────────
function abrirEntrada(itemId) {
  const item=allItems_.find(i=>i.id===itemId);
  const sheet=document.createElement('div');
  sheet.className='sheet-backdrop open';
  sheet.innerHTML=`<div class="sheet"><div class="sheet-handle"></div>
    <div class="sheet-title">Registrar entrada</div>
    <div class="sheet-body">
      <div style="background:var(--glass);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;margin-bottom:16px">
        <div style="font-size:14px;font-weight:700">${tc(item?.name||'—')}</div>
        <div style="font-size:11px;color:var(--text-4);margin-top:3px">Stock actual: ${item?.stock||0} ${safeStr(item?.unit,'')}</div>
      </div>
      <div class="form-field"><div class="form-label">Cantidad *</div><input class="form-input" id="ent-cant" type="number" min="1" placeholder="0"/></div>
      <div class="form-field"><div class="form-label">Motivo / Referencia</div><input class="form-input" id="ent-ref" type="text" placeholder="Ej. Compra, Reposición…"/></div>
      ${item?.requiereSerial?`
      <div class="form-field">
        <div class="form-label">Seriales (uno por línea)</div>
        <textarea class="form-input" id="ent-sers" rows="4" placeholder="12345001&#10;12345002&#10;..." style="font-family:monospace;font-size:11px;resize:none"></textarea>
      </div>`:''}
      <div id="ent-error" class="form-error"></div>
      <button class="btn-primary full bod" id="btn-ent"><span id="btn-ent-lbl">Registrar entrada</span></button>
    </div>
  </div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener('click',e=>{if(e.target===sheet){sheet.remove();renderInventario();}});

  document.getElementById('btn-ent').addEventListener('click',async()=>{
    let cantidad=safeNum(document.getElementById('ent-cant').value);
    const motivo=document.getElementById('ent-ref').value.trim();
    const errEl=document.getElementById('ent-error');
    errEl.style.display='none';
    let seriales=[];
    if(item?.requiereSerial){
      const raw=(document.getElementById('ent-sers')?.value||'').trim();
      seriales=raw?raw.split('\n').map(s=>s.trim()).filter(Boolean):[];
      if(!seriales.length){errEl.textContent='Ingresa al menos un serial.';errEl.style.display='block';return;}
      cantidad=seriales.length;
    }else if(!cantidad||cantidad<=0){errEl.textContent='Ingresa una cantidad válida.';errEl.style.display='block';return;}

    setLoading('btn-ent-lbl','Guardando…',true);
    try{
      const now=firebase.firestore.Timestamp.now();
      const nuevoStock=(item?.stock||0)+cantidad;
      const batch=db.batch();
      batch.update(db.collection('kardex').doc('inventario').collection('items').doc(itemId),{stock:nuevoStock});
      const entRef=db.collection('kardex').doc('movimientos').collection('ajustes').doc();
      batch.set(entRef,{tipo:'entrada',itemId,itemNombre:item?.name,cantidad,motivo:motivo||null,seriales:item?.requiereSerial?seriales:[],stockAntes:item?.stock||0,stockDespues:nuevoStock,fecha:now,registradoPor:uid_,registradoPorNombre:session_.displayName});
      // Registrar seriales en colección de seriales
      if(item?.requiereSerial&&seriales.length){
        for(const ser of seriales){
          const serRef=db.collection('kardex').doc('seriales').collection('items').doc();
          batch.set(serRef,{sapCode:item.sapCode,axCode:item.axCode,itemId,itemNombre:item.name,serial:ser,estado:'disponible',fechaEntrada:now,registradoPor:uid_});
        }
      }
      await batch.commit();
      const idx=allItems_.findIndex(i=>i.id===itemId);
      if(idx!==-1) allItems_[idx].stock=nuevoStock;
      sheet.remove();renderInventario();
      toast(`Stock actualizado: ${nuevoStock} ${safeStr(item?.unit,'')}`, 'ok');
    }catch(err){errEl.textContent=`Error: ${err.message}`;errEl.style.display='block';setLoading('btn-ent-lbl','Registrar entrada',false);}
  });
}

// ── Helpers ───────────────────────────────────────
function mostrarModalCantidad(item, onAdd) {
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
    m.remove();onAdd(cant);
  });
}

function setupChipsDyn(root,rowId) {
  root.querySelector(`#${rowId}`)?.querySelectorAll('.select-chip').forEach(chip=>{
    chip.addEventListener('click',()=>{root.querySelectorAll(`#${rowId} .select-chip`).forEach(c=>c.classList.remove('active'));chip.classList.add('active');});
  });
}

function setLoading(labelId,text,loading) {
  const el=document.getElementById(labelId);
  if(!el) return;
  el.innerHTML=loading?'<div class="spinner"></div>':text;
  const btn=el.closest('button');
  if(btn) btn.disabled=loading;
}
