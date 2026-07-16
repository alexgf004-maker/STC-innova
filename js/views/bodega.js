/**
 * js/views/bodega.js — INNOVA STC v2
 * Reescritura fiel a kardex.js v4. Todos los campos y lógica del original.
 * Campos Firestore: name, unit, sapCode, axCode, minStock, requiereSerial, stock, area
 */

import { db } from '../firebase.js';
import { toast } from '../ui.js';

// ── Constantes (iguales al original) ─────────────
const PLACAS = ['CPT-154','CPT-156','AU-250','AU-200','CNR-163','P568DA','P38DA6','SG-295','SG-297','AEC-240'];
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
// Muestra el nombre tal cual se escribió (antes forzaba Title Case y
// destrozaba siglas y códigos: AWG -> Awg, 3x220 -> 3X220)
const tc = str => safeStr(str,'');
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
let montadoId_ = 0;  // incrementa cada init; detecta si la vista sigue activa
let campanaTecnico_ = null;  // campaña que el técnico está viendo (arranca en la asignada)
let pickerCampana_  = false; // true = mostrar el selector de campaña al técnico
let tecnicos_ = [];          // lista de técnicos de la app para despacho
let serialesCache_ = {};     // itemId -> [seriales disponibles] para validación en vivo
let allItems_    = [];
let salidas_     = [];
let despachosPendientes_ = [];  // despachos esperando aceptación del técnico
let devolucionesPendientes_ = [];  // devoluciones de técnicos esperando aprobación
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
  activeTab_ = role_==='tecnico' ? 'recibido' : 'inventario';
  areaFiltro_= area_ || localStorage.getItem('bod_area') || 'CAMBIOS';
  // El técnico arranca en su campaña asignada, pero puede moverse a cualquiera
  campanaTecnico_ = area_ || null;

  const miMontaje = ++montadoId_;
  renderShell();
  await loadData(miMontaje);
}

// Verifica que la vista de bodega siga activa (no se navegó a otra)
function sigueActiva(id) {
  return id === montadoId_ && document.getElementById('bod-content');
}

// ── Colores por campaña ───────────────────────────
const CAMPANA_COLORS = {
  'CAMBIOS':         { color:'#2dd4bf', bg:'rgba(45,212,191,.12)', border:'rgba(45,212,191,.4)', label:'CAMBIOS' },
  'AMI':             { color:'#fbbf24', bg:'rgba(251,191,36,.12)', border:'rgba(251,191,36,.4)', label:'AMI' },
  'Caracterizacion': { color:'#a78bfa', bg:'rgba(167,139,250,.12)', border:'rgba(167,139,250,.4)', label:'Caracterización' },
  'ReclamosSIGET':   { color:'#f472b6', bg:'rgba(244,114,182,.12)', border:'rgba(244,114,182,.4)', label:'Reclamos SIGET' },
};

function campanaToggleHTML() {
  return `<div class="bod-campana-toggle" style="display:flex;gap:6px;margin-bottom:12px">
    ${Object.entries(CAMPANA_COLORS).map(([key, c]) => {
      const activo = areaFiltro_ === key;
      return `<div onclick="window.__bodega.setCampana('${key}')" style="
        flex:1;text-align:center;padding:10px 8px;border-radius:12px;cursor:pointer;
        font-size:12px;font-weight:700;transition:all .2s;
        color:${activo ? c.color : 'var(--text-4)'};
        background:${activo ? c.bg : 'rgba(255,255,255,.03)'};
        border:1px solid ${activo ? c.border : 'rgba(255,255,255,.06)'};
      ">${c.label}</div>`;
    }).join('')}
  </div>`;
}

// ── Shell ─────────────────────────────────────────
function renderShell() {
  const isTecnico = role_==='tecnico';
  const tabs = isTecnico
    ? (area_
        ? [{id:'recibido',label:'Material recibido'},{id:'solicitar',label:'Solicitar'},{id:'mis-solic',label:'Pedidos'}]
        : [{id:'solicitar',label:'Solicitar'},{id:'recibido',label:'Material recibido'},{id:'mis-solic',label:'Pedidos'}])
    : [{id:'inventario',label:'Inventario'},{id:'historial',label:'Historial'},{id:'solicitudes',label:'Solicitudes'}];

  container_.innerHTML = `
    ${!isTecnico ? `<div id="bod-campana-wrap" style="padding-top:4px">${campanaToggleHTML()}</div>` : ''}
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

  window.__bodega = { setCampana, elegirCampanaTecnico, cambiarCampanaTecnico, abrirDespacho, abrirNuevoItem, abrirEntrada, abrirImportar, exportarInventario, aprobarSolicitud, rechazarSolicitud, verSeriales };
}

// ── Cargar datos ──────────────────────────────────
async function loadData(miMontaje) {
  try {
    const [itemsSnap, salidasSnap, solicSnap, consumosSnap] = await Promise.all([
      db.collection('kardex').doc('inventario').collection('items').get(),
      db.collection('kardex').doc('movimientos').collection('salidas').get(),
      db.collection('solicitudes_material').get(),
      db.collection('kardex').doc('movimientos').collection('consumos').get(),
    ]);
    // Si el usuario ya navegó a otra vista, no renderizar
    if (miMontaje !== undefined && !sigueActiva(miMontaje)) return;
    allItems_    = itemsSnap.docs.map(d=>normalizeItem({id:d.id,...d.data()})).filter(esValido);
    salidas_     = salidasSnap.docs.map(d=>({id:d.id,...d.data()}));
    solicitudes_ = solicSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.fecha?.seconds||0)-(a.fecha?.seconds||0));
    consumos_    = consumosSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.fecha?.seconds||0)-(a.fecha?.seconds||0));
    renderTab();
    // Cargar técnicos por separado — si falla no rompe la bodega
    try {
      const usersSnap = await db.collection('users').where('role','==','tecnico').get();
      if (miMontaje !== undefined && !sigueActiva(miMontaje)) return;
      tecnicos_ = usersSnap.docs.map(d=>({id:d.id,...d.data()})).filter(u=>u.active!==false).sort((a,b)=>safeStr(a.displayName).localeCompare(safeStr(b.displayName)));
    } catch(e) {
      console.warn('[bodega] No se pudieron cargar técnicos:',e);
    }
    // Cargar despachos pendientes de aceptación (admin/asistente)
    if (role_==='admin' || role_==='asistente') {
      try {
        const pendSnap = await db.collection('despachos_pendientes').get();
        if (miMontaje !== undefined && !sigueActiva(miMontaje)) return;
        despachosPendientes_ = pendSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.fecha?.seconds||0)-(a.fecha?.seconds||0));
        if (despachosPendientes_.length && activeTab_==='historial') renderHistorial();
      } catch(e) {
        console.warn('[bodega] No se pudieron cargar despachos pendientes:',e);
      }
      // Devoluciones pendientes de los técnicos
      try {
        const devSnap = await db.collection('devoluciones_pendientes').where('estado','==','pendiente').get();
        if (miMontaje !== undefined && !sigueActiva(miMontaje)) return;
        devolucionesPendientes_ = devSnap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>(b.fecha?.seconds||0)-(a.fecha?.seconds||0));
        if (devolucionesPendientes_.length && activeTab_==='historial') renderHistorial();
      } catch(e) {
        console.warn('[bodega] No se pudieron cargar devoluciones pendientes:',e);
      }
    }
  } catch(err) {
    console.error('[bodega] Error:',err);
    if (miMontaje !== undefined && !sigueActiva(miMontaje)) return;
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
    case 'recibido':    renderRecibido();       break;
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

  // Agrupar por campaña (area del item)
  const porCampana = {};
  misItems.forEach(e=>{
    const camp = e.item.area || 'CAMBIOS';
    if(!porCampana[camp]) porCampana[camp]=[];
    porCampana[camp].push(e);
  });
  const campanasOrden = ['CAMBIOS','AMI','Caracterizacion','ReclamosSIGET'].filter(c=>porCampana[c]?.length);

  function itemCard(e) {
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
  }

  content.innerHTML=`
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div>
          <div class="section-title">Mi material</div>
          <div class="section-sub">${usuario} · ${misItems.length} items asignados</div>
        </div>
      </div>
      ${!misItems.length?`<div class="dev-module anim-up d1"><div class="dev-title">Sin material asignado</div><p>No tienes material despachado. Solicita a bodega.</p></div>`:
        campanasOrden.map((camp,idx)=>{
          const cc = CAMPANA_COLORS[camp] || CAMPANA_COLORS['CAMBIOS'];
          return `<div class="anim-up d${Math.min(idx+1,3)}">
            <div class="section-label" style="color:${cc.color};margin-bottom:8px">${cc.label}</div>
            <div class="flex-col gap-8">${porCampana[camp].map(itemCard).join('')}</div>
          </div>`;
        }).join('')}
    </div>`;
}

// ── Recibido (historial de entradas al técnico) ───
function renderRecibido() {
  const content = document.getElementById('bod-content');
  const usuario = destino_ || session_.displayName;
  const miNombre = safeStr(session_.displayName);

  // Entregas donde el técnico participó: como quien firmó O como pareja.
  // Se hace match por UID (nuevos) y por nombre (registros antiguos).
  const misEntradas = salidas_
    .map(s=>{
      const firmoUid  = s.tecnicoRecibeUid && s.tecnicoRecibeUid === uid_;
      const firmoNom  = safeStr(s.usuarioResponsable||s.tecnicoNombre) === usuario
                     || safeStr(s.usuarioResponsable||s.tecnicoNombre) === miNombre;
      const parejaUid = s.parejaUid && s.parejaUid === uid_;
      const parejaNom = safeStr(s.parejaAcompanante) && safeStr(s.parejaAcompanante) === miNombre;
      const firmo  = firmoUid || firmoNom;
      const espareja = !firmo && (parejaUid || parejaNom);
      if(!firmo && !espareja) return null;
      return { s, firmo };
    })
    .filter(Boolean)
    .sort((a,b)=>(b.s.fecha?.seconds||0)-(a.s.fecha?.seconds||0));

  content.innerHTML=`
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div>
          <div class="section-title">Material recibido</div>
          <div class="section-sub">${misEntradas.length} entrega${misEntradas.length===1?'':'s'} · historial de lo entregado</div>
        </div>
      </div>
      ${!misEntradas.length?`<div class="dev-module anim-up d1"><div class="dev-title">Sin entregas</div><p>Aquí aparecerá el material que bodega les despache, a ti o a tu pareja.</p></div>`:`
      <div class="flex-col gap-8 anim-up d1">
        ${misEntradas.map(({s,firmo})=>{
          const camp = s.area || 'CAMBIOS';
          const cc = CAMPANA_COLORS[camp] || CAMPANA_COLORS['CAMBIOS'];
          const totalItems = (s.items||[]).reduce((a,i)=>a+safeNum(i.cantidad),0);
          const quienFirmo = safeStr(s.usuarioResponsable||s.tecnicoNombre,'—');
          const laPareja   = safeStr(s.parejaAcompanante,'');
          return `<div class="bod-solic-card"${!firmo?' style="border-color:rgba(255,255,255,.14)"':''}>
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
              <div style="min-width:0">
                <div style="font-size:12px;font-weight:700">${fmtDate(s.fecha)}</div>
                <div style="font-size:10px;color:var(--text-4)">${totalItems} items · entregó ${safeStr(s.registradoPorNombre||s.entregadoPor,'—')}</div>
              </div>
              <div class="bod-badge" style="color:${cc.color};border-color:${cc.color}33;background:${cc.color}11;flex-shrink:0">${cc.label}</div>
            </div>
            <div style="font-size:10px;color:${firmo?'var(--ok)':'var(--text-4)'};font-weight:600;margin-bottom:8px">
              ${firmo
                ? `Lo recibiste tú${laPareja?` · con ${laPareja}`:''}`
                : `Recibido por ${quienFirmo} (tu pareja)`}
            </div>
            <div class="flex-col gap-3">
              ${(s.items||[]).map(m=>{
                const seriales = m.modoSerial==='rango' && m.serialInicio
                  ? `<div style="font-size:10px;color:var(--text-4);margin-top:2px;font-family:monospace">Serie ${m.serialInicio} a ${m.serialFin}</div>`
                  : (m.seriales&&m.seriales.length)
                    ? `<div style="font-size:10px;color:var(--text-4);margin-top:2px;font-family:monospace">${m.seriales.slice(0,4).join(', ')}${m.seriales.length>4?` +${m.seriales.length-4}`:''}</div>`
                    : '';
                return `<div style="padding:6px 0;border-top:1px solid var(--border)">
                  <div style="display:flex;justify-content:space-between;font-size:12px">
                    <span style="color:var(--text-2)">${tc(m.nombre||m.name||'—')}</span>
                    <span style="font-weight:700">${m.cantidad} ${safeStr(m.unit,'')}</span>
                  </div>${seriales}
                </div>`;
              }).join('')}
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
              <div class="bod-badge" style="color:#22c55e;border-color:rgba(34,197,94,.3);background:rgba(34,197,94,.08)">&#10003;</div>
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
          ${sd.cantidad>0?'Sel.':'Selec.'}
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

  // Campaña efectiva: la asignada, o la que el técnico elija si no tiene área
  // El técnico puede moverse entre campañas; su asignación solo define la inicial
  const campanaEfectiva = campanaTecnico_ || area_;

  // Mostrar el selector si el técnico lo pidió, o si no tiene ninguna campaña
  if (pickerCampana_ || !campanaEfectiva) {
    content.innerHTML = `
      <div class="flex-col gap-12">
        <div class="panel-header anim-up"><div class="section-title">Solicitar material</div></div>
        <div class="anim-up d1" style="padding:8px 0">
          <div class="section-label" style="margin-bottom:12px">¿Para qué campaña necesitas material?</div>
          <div class="flex-col gap-8">
            ${Object.entries(CAMPANA_COLORS).map(([key, c]) => `
              <div onclick="window.__bodega.elegirCampanaTecnico('${key}')" style="
                padding:18px 16px;border-radius:14px;cursor:pointer;
                background:${c.bg};border:1px solid ${c.border};
                display:flex;align-items:center;justify-content:space-between;
              ">
                <span style="font-size:15px;font-weight:700;color:${c.color}">${c.label}</span>
                <svg viewBox="0 0 24 24" fill="none" stroke="${c.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="9 18 15 12 9 6"/></svg>
              </div>`).join('')}
          </div>
        </div>
      </div>`;
    return;
  }

  const misItems = getItems(campanaEfectiva);
  const esCampanaNueva = (campanaEfectiva==='CAMBIOS'||campanaEfectiva==='AMI'||campanaEfectiva==='Caracterizacion'||campanaEfectiva==='ReclamosSIGET');
  let sel=[], busq='', pareja='', placa='', placaOtro='';

  function render() {
    const cc = CAMPANA_COLORS[campanaEfectiva] || CAMPANA_COLORS['CAMBIOS'];
    content.innerHTML=`
      <div class="flex-col gap-12">
        <div class="panel-header anim-up">
          <div class="section-title">Solicitar material</div>
          <div onclick="window.__bodega.cambiarCampanaTecnico()" style="cursor:pointer;font-size:11px;font-weight:700;padding:5px 12px;border-radius:20px;color:${cc.color};background:${cc.bg};border:1px solid ${cc.border}">${cc.label} &#9662;</div>
        </div>

        ${esCampanaNueva?`
        <div class="anim-up d1" style="background:var(--glass);border:1px solid var(--border);border-radius:14px;padding:14px">
          <div class="section-label" style="margin-bottom:10px">Datos de la salida</div>
          <div class="form-field">
            <div class="form-label">Pareja / acompañante *</div>
            <div style="position:relative">
              <input class="form-input" id="sol-pareja" value="${pareja}" placeholder="Escribe para buscar…" autocomplete="off"/>
              <div id="sol-pareja-lista" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:20;margin-top:4px;background:var(--bg-2,#1a2332);border:1px solid var(--border);border-radius:12px;max-height:180px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.4)"></div>
            </div>
          </div>
          <div class="form-field" style="margin-bottom:0">
            <div class="form-label">Vehículo *</div>
            <div class="select-row flex-wrap" id="sol-placa">
              ${PLACAS.map(p=>`<div class="select-chip ${placa===p?'active':''}" data-val="${p}">${p}</div>`).join('')}
              <div class="select-chip ${placa==='__otro__'?'active':''}" data-val="__otro__">Otra</div>
            </div>
            <input class="form-input" id="sol-placa-otro" style="margin-top:8px;display:${placa==='__otro__'?'':'none'}" placeholder="Ingresa la placa" value="${placaOtro}"/>
          </div>
        </div>`:''}

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

    // Campos de salida (solo campañas nuevas)
    if (esCampanaNueva) {
      // Autocompletado de pareja
      const pInput = document.getElementById('sol-pareja');
      const pLista = document.getElementById('sol-pareja-lista');
      function renderPareja(filtro){
        const q = safeStr(filtro,'').toLowerCase().trim();
        const matches = tecnicos_.filter(t => safeStr(t.displayName).toLowerCase().includes(q) && safeStr(t.displayName)!==session_.displayName);
        if(!matches.length){ pLista.style.display='none'; return; }
        pLista.innerHTML = matches.map(t=>`<div class="ac-opt" data-nombre="${safeStr(t.displayName)}" style="padding:11px 14px;font-size:13px;cursor:pointer;border-bottom:1px solid var(--border)">${safeStr(t.displayName)}</div>`).join('');
        pLista.style.display='block';
        pLista.querySelectorAll('.ac-opt').forEach(opt=>{
          opt.addEventListener('click',()=>{ pInput.value=opt.dataset.nombre; pareja=opt.dataset.nombre; pLista.style.display='none'; });
        });
      }
      pInput?.addEventListener('focus',()=>renderPareja(pInput.value));
      pInput?.addEventListener('input',()=>{ pareja=pInput.value.trim(); renderPareja(pInput.value); });
      document.addEventListener('click',(e)=>{ if(pInput && !pInput.contains(e.target) && !pLista?.contains(e.target)) pLista.style.display='none'; });

      // Selector de placa
      document.getElementById('sol-placa')?.querySelectorAll('.select-chip').forEach(c=>{
        c.addEventListener('click',()=>{
          document.querySelectorAll('#sol-placa .select-chip').forEach(x=>x.classList.remove('active'));
          c.classList.add('active');
          placa=c.dataset.val;
          const otroEl=document.getElementById('sol-placa-otro');
          if(otroEl) otroEl.style.display = placa==='__otro__'?'':'none';
        });
      });
      document.getElementById('sol-placa-otro')?.addEventListener('input',e=>{placaOtro=e.target.value.trim();});
    }

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
        ${agregado?`<span style="font-size:11px;font-weight:700;color:var(--ok)">&#10003;</span>`:item.stock===0?`<span style="font-size:11px;color:var(--text-4)">Agotado</span>`:`<span style="font-size:11px;font-weight:700;color:var(--bod-light)">${item.stock} ${item.unit}</span>`}
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

    // Validar campos obligatorios en campañas nuevas
    let placaFinal='';
    if(esCampanaNueva){
      if(!pareja){
        errEl.textContent='Indica con qué pareja/acompañante andas.';errEl.style.display='block';return;
      }
      placaFinal = placa==='__otro__' ? placaOtro : placa;
      if(!placaFinal){
        errEl.textContent='Indica el vehículo en el que andas.';errEl.style.display='block';return;
      }
    }

    setLoading('sol-btn-lbl','Enviando…',true);
    try {
      const data={
        usuarioUid:uid_,usuarioNombre:session_.displayName,usuarioOperativo:destino_,
        area:campanaEfectiva,materiales:sel.map(s=>({itemId:s.itemId,nombre:s.name,unit:s.unit,cantidad:s.cantidad})),
        estado:'pendiente',fecha:firebase.firestore.Timestamp.now(),notas:'',
        parejaAcompanante: esCampanaNueva ? pareja : '',
        placaVehiculo: esCampanaNueva ? placaFinal : '',
      };
      const ref=await db.collection('solicitudes_material').add(data);
      solicitudes_.unshift({id:ref.id,...data});
      sel=[];pareja='';placa='';placaOtro='';render();
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
          <button class="icon-btn bod" onclick="window.__bodega.exportarInventario()" title="Exportar a Excel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <button class="icon-btn bod" onclick="window.__bodega.abrirImportar()" title="Importar Excel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </button>
          <button class="icon-btn bod" onclick="window.__bodega.abrirDespacho()" title="Nueva salida">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M5 12h14M12 5l7 7-7 7"/></svg>
          </button>
          <button class="icon-btn bod" onclick="window.__bodega.abrirNuevoItem()" title="Nuevo item">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>
        </div>
      </div>
      ${agotados?`<div class="otc-alert-card crit anim-up d2"><div class="otc-alert-header">${agotados} item${agotados>1?'s':''} agotado${agotados>1?'s':''}</div></div>`:''}
      ${bajos?`<div class="otc-alert-card warn anim-up d2"><div class="otc-alert-header">${bajos} item${bajos>1?'s':''} bajo stock mínimo</div></div>`:''}
      <div class="buscar-wrap anim-up d2">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="color:var(--text-4);flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="buscar-input" id="bod-inv-buscar" placeholder="Buscar material…" autocomplete="off"/>
      </div>
      <div class="flex-col gap-6 anim-up d2" id="bod-inv-lista">
        ${!items.length?`<div class="dev-module"><div class="dev-title">Sin items</div></div>`
          :items.sort((a,b)=>a.stock-b.stock).map(item=>renderItemCard(item)).join('')}
      </div>
    </div>`;

  // Buscador
  const buscar=document.getElementById('bod-inv-buscar');
  const lista=document.getElementById('bod-inv-lista');
  function pintar(q){
    const term=(q||'').toLowerCase().trim();
    const arr=items.filter(i=>!term||i.name.toLowerCase().includes(term)||(i.sapCode||'').includes(term)||(i.axCode||'').includes(term)).sort((a,b)=>a.stock-b.stock);
    lista.innerHTML=arr.length?arr.map(item=>renderItemCard(item)).join(''):`<div style="text-align:center;color:var(--text-4);font-size:12px;padding:24px">Sin resultados</div>`;
    enlazarFilas();
  }
  buscar?.addEventListener('input',e=>pintar(e.target.value));

  // Expandir/colapsar acciones al tocar
  function enlazarFilas(){
    lista.querySelectorAll('.bod-item-row').forEach(row=>{
      const head=row.querySelector('.bod-item-head');
      const acts=row.querySelector('.bod-item-actions');
      const chev=row.querySelector('.bod-item-chevron');
      head.addEventListener('click',()=>{
        const abierto=acts.style.display==='flex';
        // cerrar otros
        lista.querySelectorAll('.bod-item-actions').forEach(a=>a.style.display='none');
        lista.querySelectorAll('.bod-item-chevron').forEach(c=>c.style.transform='');
        if(!abierto){acts.style.display='flex';chev.style.transform='rotate(90deg)';}
      });
    });
  }
  enlazarFilas();
}

function setCampana(area) {
  areaFiltro_ = area;
  localStorage.setItem('bod_area', area);
  // Actualizar el toggle visual
  const wrap = document.getElementById('bod-campana-wrap');
  if (wrap) wrap.innerHTML = campanaToggleHTML();
  // Re-renderizar la vista activa
  renderTab();
}

function elegirCampanaTecnico(area) {
  campanaTecnico_ = area;
  pickerCampana_  = false;
  renderFormSolicitar();
}

function cambiarCampanaTecnico() {
  pickerCampana_ = true;
  renderFormSolicitar();
}

function renderItemCard(item) {
  const bajo=item.stock>0&&item.stock<=item.minStock;
  const agotado=item.stock===0;
  const color=agotado?'#ef4444':bajo?'#fbbf24':'#22c55e';
  const bg=agotado?'rgba(239,68,68,.05)':bajo?'rgba(245,158,11,.05)':'var(--glass)';
  const border=agotado?'rgba(239,68,68,.22)':bajo?'rgba(245,158,11,.22)':'var(--border)';
  return `<div class="bod-item-row" data-item="${item.id}" style="background:${bg};border:1px solid ${border};border-radius:12px;overflow:hidden">
    <div class="bod-item-head" style="display:flex;align-items:center;gap:10px;padding:11px 13px;cursor:pointer">
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          <span style="font-size:13px;font-weight:700">${tc(item.name)}</span>
          ${agotado?'<span class="bod-badge crit" style="font-size:8px">Agotado</span>':bajo?'<span class="bod-badge warn" style="font-size:8px">Bajo</span>':''}
          ${item.requiereSerial?`<span class="bod-badge" style="font-size:8px;color:var(--bod-light);border-color:var(--bod-border);background:var(--bod-glass)">Serial</span>`:''}
        </div>
        <div style="font-size:9.5px;color:var(--text-4);margin-top:2px">${item.sapCode?`SAP ${item.sapCode}`:''}${item.axCode?` · AX ${item.axCode}`:''} · Mín ${item.minStock}</div>
      </div>
      <div style="text-align:right;flex-shrink:0;line-height:1">
        <div style="font-size:19px;font-weight:800;color:${color}">${item.stock}</div>
        <div style="font-size:9px;color:var(--text-4)">${safeStr(item.unit,'')}</div>
      </div>
      <svg class="bod-item-chevron" viewBox="0 0 24 24" fill="none" stroke="var(--text-4)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15" style="flex-shrink:0;transition:transform .2s"><polyline points="9 18 15 12 9 6"/></svg>
    </div>
    <div class="bod-item-actions" style="display:none;gap:6px;padding:0 13px 11px">
      <button class="btn-action" style="flex:1;height:38px;font-size:12px;color:var(--bod-light);border:1px solid var(--bod-border);background:var(--bod-glass)" onclick="event.stopPropagation();window.__bodega.abrirEntrada('${item.id}')">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg> Entrada
      </button>
      <button class="btn-action outline" style="flex:1;height:38px;font-size:12px" onclick="event.stopPropagation();window.__bodega.abrirNuevoItem('${item.id}')">Editar</button>
      ${item.requiereSerial?`<button class="btn-action outline" style="flex:1;height:38px;font-size:12px" onclick="event.stopPropagation();window.__bodega.verSeriales('${item.id}')">Series</button>`:''}
    </div>
  </div>`;
}

// ── Historial (salidas + devoluciones) ────────────
function renderHistorial() {
  const content = document.getElementById('bod-content');
  const sorted  = [...salidas_]
    .filter(s => (s.area || 'CAMBIOS') === areaFiltro_)
    .sort((a,b)=>(b.fecha?.seconds||0)-(a.fecha?.seconds||0));
  const pendientes = despachosPendientes_.filter(p => (p.area||'') === areaFiltro_);
  const devoluciones = devolucionesPendientes_.filter(d => (d.area||'') === areaFiltro_);

  const devHTML = devoluciones.length ? `
    <div class="anim-up d1" style="margin-bottom:4px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#2dd4bf">Devoluciones por revisar</div>
        <div style="flex:1;height:1px;background:rgba(45,212,191,.2)"></div>
        <div style="font-size:11px;color:var(--text-4)">${devoluciones.length}</div>
      </div>
      <div class="flex-col gap-8">
        ${devoluciones.map(d=>`
          <div class="bod-solic-card" style="background:rgba(45,212,191,.05);border-color:rgba(45,212,191,.25)">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
              <div>
                <div style="font-size:13px;font-weight:700">${safeStr(d.tecnicoNombre)}</div>
                <div style="font-size:10px;color:var(--text-4)">${fmtDate(d.fecha)} · Devuelve material</div>
              </div>
            </div>
            <div class="flex-col gap-3" style="margin-bottom:10px">
              ${(d.items||[]).map(m=>`<div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:var(--text-3)">${tc(m.nombre||m.name||'—')}${m.requiereSerial?` <span style="color:var(--text-4)">(${(m.seriales||[]).length} series)</span>`:''}</span><span style="font-weight:600">${m.cantidad} ${safeStr(m.unit,'')}</span></div>`).join('')}
              ${d.nota?`<div style="font-size:10px;color:var(--text-4);font-style:italic;margin-top:4px">Nota: ${safeStr(d.nota)}</div>`:''}
            </div>
            <div style="display:flex;gap:6px">
              <button class="bod-badge" style="flex:1;text-align:center;color:#2dd4bf;border-color:rgba(45,212,191,.4);background:rgba(45,212,191,.12);cursor:pointer;padding:8px;font-weight:700" onclick="window.__bodega._verDev('${d.id}')">Revisar y aprobar</button>
            </div>
          </div>`).join('')}
      </div>
    </div>` : '';

  const pendHTML = pendientes.length ? `
    <div class="anim-up d1" style="margin-bottom:4px">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:#fbbf24">Pendientes de aceptación</div>
        <div style="flex:1;height:1px;background:rgba(251,191,36,.2)"></div>
        <div style="font-size:11px;color:var(--text-4)">${pendientes.length}</div>
      </div>
      <div class="flex-col gap-8">
        ${pendientes.map(p=>`
          <div class="bod-solic-card" style="background:rgba(251,191,36,.05);border-color:rgba(251,191,36,.25)">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:8px">
              <div>
                <div style="font-size:13px;font-weight:700">${safeStr(p.usuarioResponsable)}</div>
                <div style="font-size:10px;color:var(--text-4)">${fmtDate(p.fecha)} · Esperando aceptación del técnico</div>
              </div>
              <button class="bod-badge" style="color:#ef4444;border-color:rgba(239,68,68,.3);background:rgba(239,68,68,.08);cursor:pointer" onclick="window.__bodega._cancelarPend('${p.id}')">Cancelar</button>
            </div>
            <div class="flex-col gap-3">
              ${(p.items||[]).slice(0,3).map(m=>`<div style="display:flex;justify-content:space-between;font-size:11px"><span style="color:var(--text-3)">${tc(m.nombre||m.name||'—')}</span><span style="font-weight:600">${m.cantidad} ${safeStr(m.unit,'')}</span></div>`).join('')}
              ${(p.items||[]).length>3?`<div style="font-size:10px;color:var(--text-4)">+${(p.items||[]).length-3} más</div>`:''}
            </div>
          </div>`).join('')}
      </div>
    </div>` : '';

  content.innerHTML=`
    <div class="flex-col gap-12">
      <div class="panel-header anim-up">
        <div><div class="section-title">Historial</div><div class="section-sub">${sorted.length} salidas registradas</div></div>
        <button class="icon-btn bod" onclick="window.__bodega.abrirDespacho()" title="Nueva salida">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
        </button>
      </div>
      ${devHTML}
      ${pendHTML}
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
  window.__bodega._cancelarPend=(id)=>cancelarPendiente(id);
  window.__bodega._aprobarDev=(id)=>aprobarDevolucionTecnico(id);
  window.__bodega._rechazarDev=(id)=>rechazarDevolucionTecnico(id);
  window.__bodega._verDev=(id)=>verDetalleDevolucion(id);
}

async function cancelarPendiente(id){
  const p=despachosPendientes_.find(x=>x.id===id);
  if(!p) return;
  if(!confirm(`¿Cancelar el despacho pendiente para ${safeStr(p.usuarioResponsable)}? El material no se ha descontado.`)) return;
  try{
    await db.collection('despachos_pendientes').doc(id).delete();
    despachosPendientes_=despachosPendientes_.filter(x=>x.id!==id);
    toast('Despacho cancelado','ok');
    renderHistorial();
  }catch(err){
    toast('Error al cancelar: '+err.message,'error');
  }
}

// ── Aprobar devolución de un técnico ──────────────
// Suma a bodega, registra/libera series, deja constancia y genera memo.
async function aprobarDevolucionTecnico(id, itemsAjustados){
  const d=devolucionesPendientes_.find(x=>x.id===id);
  if(!d) return;
  // Si vienen items ajustados desde la pantalla de revisión, se usan esos
  const items = itemsAjustados || d.items || [];
  if(!items.length){ toast('No hay material que aprobar','error'); return; }
  if(!itemsAjustados && !confirm(`¿Confirmas que ${safeStr(d.tecnicoNombre)} te entregó este material? Se sumará a bodega.`)) return;

  try{
    const now=firebase.firestore.FieldValue.serverTimestamp();
    const dItems = items;   // usar los ajustados

    // 1) Sumar stock de cada material + registrar movimiento
    for(const it of dItems){
      const itemRef=db.collection('kardex').doc('inventario').collection('items').doc(it.itemId);
      const cant=safeNum(it.cantidad);
      // Leer stock actual desde memoria
      const local=allItems_.find(x=>x.id===it.itemId);
      const stockAntes=safeNum(local?.stock);
      const stockDespues=stockAntes+cant;
      const batch=db.batch();
      batch.update(itemRef,{stock:firebase.firestore.FieldValue.increment(cant)});
      const movRef=db.collection('kardex').doc('movimientos').collection('ajustes').doc();
      batch.set(movRef,{
        tipo:'devolucion', origen:'devolucion_tecnico',
        itemId:it.itemId, itemNombre:it.nombre,
        cantidad:cant, stockAntes, stockDespues,
        area:d.area, seriales:it.seriales||[],
        motivo:`Devolución de ${d.tecnicoNombre}`+(d.nota?` — ${d.nota}`:''),
        devolucionId:id, tecnicoUid:d.tecnicoUid, tecnicoNombre:d.tecnicoNombre,
        fecha:now, registradoPor:uid_, registradoPorNombre:session_.displayName,
      });
      await batch.commit();
      if(local) local.stock=stockDespues;

      // 2) Registrar/liberar series (si es medidor)
      if(it.requiereSerial && (it.seriales||[]).length){
        // ¿Ya existen esas series? Las que estén 'despachado' se liberan;
        // las que no existan se crean como 'disponible' (material previo).
        const existentes=await db.collection('kardex').doc('seriales').collection('items')
          .where('itemId','==',it.itemId).get();
        const mapa={}; existentes.docs.forEach(doc=>{ mapa[doc.data().serial]=doc; });
        for(let i=0;i<it.seriales.length;i+=400){
          const b=db.batch();
          it.seriales.slice(i,i+400).forEach(ser=>{
            const doc=mapa[ser];
            if(doc){
              b.update(doc.ref,{estado:'disponible',salidaId:null,fechaSalida:null,usuarioDespacho:null,devueltoEn:now,devueltoPor:d.tecnicoNombre});
            }else{
              const nuevo=db.collection('kardex').doc('seriales').collection('items').doc();
              b.set(nuevo,{itemId:it.itemId,itemNombre:it.nombre,serial:ser,estado:'disponible',sapCode:local?.sapCode||'',axCode:local?.axCode||'',fechaEntrada:now,origen:'devolucion',devueltoPor:d.tecnicoNombre,registradoPor:uid_});
            }
          });
          await b.commit();
        }
        if(serialesCache_[it.itemId]) delete serialesCache_[it.itemId];
      }
    }

    // 3) Guardar la devolución aprobada (para el memo) y quitar la pendiente
    const aprobadaRef=await db.collection('devoluciones').add({
      area:d.area,
      tecnicoUid:d.tecnicoUid, tecnicoNombre:d.tecnicoNombre,
      items:dItems, nota:d.nota||null,
      fechaDevolucion:d.fecha||now,
      aprobadoPor:session_.displayName, aprobadoPorUid:uid_,
      fechaAprobacion:now,
    });
    await db.collection('devoluciones_pendientes').doc(id).delete();
    devolucionesPendientes_=devolucionesPendientes_.filter(x=>x.id!==id);

    toast('Devolución aprobada y sumada a bodega','ok');
    // Mostrar el memo de devolución
    const memoData={id:aprobadaRef.id, ...d, aprobadoPor:session_.displayName, fechaAprobacion:new Date()};
    mostrarMemoDevolucion(memoData);
    renderHistorial();
  }catch(err){
    console.error('[bodega] Error aprobando devolución:',err);
    toast('Error al aprobar: '+err.message,'error');
  }
}

async function rechazarDevolucionTecnico(id){
  const d=devolucionesPendientes_.find(x=>x.id===id);
  if(!d) return;
  if(!confirm(`¿Rechazar la devolución de ${safeStr(d.tecnicoNombre)}? No se sumará nada a bodega.`)) return;
  try{
    await db.collection('devoluciones_pendientes').doc(id).update({estado:'rechazada',rechazadoPor:session_.displayName,fechaRechazo:firebase.firestore.FieldValue.serverTimestamp()});
    devolucionesPendientes_=devolucionesPendientes_.filter(x=>x.id!==id);
    toast('Devolución rechazada','ok');
    renderHistorial();
  }catch(err){
    toast('Error al rechazar: '+err.message,'error');
  }
}

// Pantalla de revisión: ver el detalle, ajustar y aprobar/rechazar
function verDetalleDevolucion(id){
  const d=devolucionesPendientes_.find(x=>x.id===id);
  if(!d) return;

  // Copia editable de los items
  const items=JSON.parse(JSON.stringify(d.items||[]));

  const ov=document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;z-index:850;background:#0d1117;overflow-y:auto;-webkit-overflow-scrolling:touch;';

  function pintar(){
    ov.innerHTML=`
    <div style="max-width:520px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;position:sticky;top:0;background:#0d1117;z-index:10">
        <button class="icon-btn" id="dd-back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg></button>
        <div style="flex:1">
          <div class="section-title">Revisar devolución</div>
          <div style="font-size:11px;color:var(--text-4)">${safeStr(d.tecnicoNombre)} · ${fmtDate(d.fecha)}</div>
        </div>
      </div>

      <div style="padding:16px 20px;flex:1" class="flex-col gap-12">
        ${d.nota?`<div style="font-size:12px;color:var(--text-3);font-style:italic;background:var(--glass);border:1px solid var(--border);border-radius:10px;padding:10px">Nota del técnico: ${safeStr(d.nota)}</div>`:''}
        <div style="font-size:11px;color:var(--text-4)">Revisa físicamente lo que te entregó. Puedes quitar lo que no cuadre antes de aprobar.</div>

        ${items.length? items.map((it,idx)=>`
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;margin-bottom:${it.requiereSerial?'10px':'0'}">
              <div style="flex:1">
                <div style="font-size:13px;font-weight:700">${tc(it.nombre||it.name||'—')}</div>
                <div style="font-size:10px;color:var(--text-4)">${it.requiereSerial?'Medidor con serie':safeStr(it.unit,'unidades')}</div>
              </div>
              ${it.requiereSerial
                ? `<div style="font-size:12px;font-weight:700;color:var(--bod-light)">${(it.seriales||[]).length}</div>`
                : `<div style="display:flex;align-items:center;gap:6px">
                     <button class="dd-menos" data-idx="${idx}" style="width:28px;height:28px;border-radius:8px;border:1px solid var(--border);background:var(--glass);color:var(--text-2);font-size:16px;cursor:pointer">-</button>
                     <span style="min-width:32px;text-align:center;font-weight:700;font-size:14px">${it.cantidad}</span>
                     <button class="dd-mas" data-idx="${idx}" style="width:28px;height:28px;border-radius:8px;border:1px solid var(--border);background:var(--glass);color:var(--text-2);font-size:16px;cursor:pointer">+</button>
                   </div>`}
            </div>
            ${it.requiereSerial?`
              <div style="display:flex;flex-wrap:wrap;gap:5px">
                ${(it.seriales||[]).map(s=>`
                  <div class="dd-serdel" data-idx="${idx}" data-ser="${s}" style="cursor:pointer;display:flex;align-items:center;gap:5px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.4);border-radius:7px;padding:5px 8px;font-family:monospace;font-size:11px;font-weight:700;color:#22c55e">${s}<span style="color:#ef4444;font-size:12px">&#10007;</span></div>`).join('')}
                ${!(it.seriales||[]).length?`<div style="font-size:11px;color:#ef4444">Sin series — se quitará al aprobar</div>`:''}
              </div>`:''}
          </div>`).join('')
        : `<div style="text-align:center;padding:24px;color:var(--text-4);font-size:12px">No queda material en esta devolución.</div>`}
      </div>

      <div style="padding:14px 20px;border-top:1px solid var(--border);background:#0d1117;position:sticky;bottom:0;display:flex;gap:8px">
        <button class="btn-primary" id="dd-rechazar" style="flex:1;background:rgba(239,68,68,.15);border:1px solid rgba(239,68,68,.4);color:#f87171">Rechazar</button>
        <button class="btn-primary bod" id="dd-aprobar" style="flex:2"><span id="dd-aprobar-lbl">Aprobar y sumar</span></button>
      </div>
    </div>`;

    ov.querySelector('#dd-back').onclick=()=>ov.remove();

    // Ajustar cantidades (material sin serie)
    ov.querySelectorAll('.dd-mas').forEach(b=>b.onclick=()=>{ const i=+b.dataset.idx; items[i].cantidad++; pintar(); });
    ov.querySelectorAll('.dd-menos').forEach(b=>b.onclick=()=>{ const i=+b.dataset.idx; items[i].cantidad=Math.max(0,items[i].cantidad-1); pintar(); });
    // Quitar una serie
    ov.querySelectorAll('.dd-serdel').forEach(b=>b.onclick=()=>{
      const i=+b.dataset.idx;
      items[i].seriales=(items[i].seriales||[]).filter(x=>x!==b.dataset.ser);
      items[i].cantidad=items[i].seriales.length;
      pintar();
    });

    ov.querySelector('#dd-rechazar').onclick=async()=>{ ov.remove(); await rechazarDevolucionTecnico(id); };
    ov.querySelector('#dd-aprobar').onclick=async()=>{
      // Filtrar items vacíos (cantidad 0 o sin series)
      const finales=items.filter(it=> it.requiereSerial ? (it.seriales||[]).length>0 : it.cantidad>0)
        .map(it=> it.requiereSerial ? {...it, cantidad:it.seriales.length} : it);
      if(!finales.length){ toast('No queda material que aprobar. Usa Rechazar.','error'); return; }
      const btn=ov.querySelector('#dd-aprobar'); btn.disabled=true;
      ov.querySelector('#dd-aprobar-lbl').textContent='Sumando…';
      ov.remove();
      await aprobarDevolucionTecnico(id, finales);
    };
  }
  pintar();
  document.body.appendChild(ov);
}

// Memo de devolución con sellos digitales (técnico / asistente)
function mostrarMemoDevolucion(d){
  const AC = d.area==='AMI' ? '#c98a00' : d.area==='ReclamosSIGET' ? '#be185d' : d.area==='CAMBIOS' ? '#0d9488' : '#7c5cd6';
  const CAMPANA_LABEL = { CAMBIOS:'Cambio de Medidores', AMI:'AMI', Caracterizacion:'Caracterización de la Carga', ReclamosSIGET:'Reclamos SIGET' };
  const fechaDev = d.fechaDevolucion?.toDate ? d.fechaDevolucion.toDate() : new Date();
  const fechaApr = d.fechaAprobacion?.toDate ? d.fechaAprobacion.toDate() : (d.fechaAprobacion||new Date());
  const fmt = dt => { try{ return dt.toLocaleDateString('es-SV',{day:'2-digit',month:'long',year:'numeric',hour:'2-digit',minute:'2-digit'}); }catch{ return '—'; } };

  const ov=document.createElement('div');
  ov.className='sheet-backdrop open';
  ov.innerHTML=`<div class="sheet" style="max-height:90vh;overflow-y:auto"><div class="sheet-handle"></div>
    <div id="memo-dev-print" style="background:#fff;color:#1a1a1a;padding:28px 24px;border-radius:10px;font-family:'Outfit',sans-serif">
      <div style="text-align:center;border-bottom:2px solid ${AC};padding-bottom:14px;margin-bottom:16px">
        <div style="font-size:20px;font-weight:800;color:${AC}">INNOVA</div>
        <div style="font-size:11px;color:#555;margin-top:2px">Constancia de devolución de material</div>
        <div style="font-size:12px;font-weight:700;margin-top:6px">${CAMPANA_LABEL[d.area]||d.area}</div>
      </div>
      <div style="font-size:12px;margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:#777">Técnico que devuelve:</span><span style="font-weight:700">${safeStr(d.tecnicoNombre)}</span></div>
        <div style="display:flex;justify-content:space-between;margin-bottom:4px"><span style="color:#777">Recibido por:</span><span style="font-weight:700">${safeStr(d.aprobadoPor)}</span></div>
        ${d.nota?`<div style="margin-top:6px;color:#555;font-style:italic">Nota: ${safeStr(d.nota)}</div>`:''}
      </div>
      <table style="width:100%;border-collapse:collapse;font-size:12px;margin-bottom:16px">
        <thead><tr style="border-bottom:1.5px solid ${AC}">
          <th style="text-align:left;padding:6px 4px;color:${AC}">Material</th>
          <th style="text-align:center;padding:6px 4px;color:${AC}">Cantidad</th>
        </tr></thead>
        <tbody>
          ${(d.items||[]).map(m=>`
            <tr style="border-bottom:1px solid #eee">
              <td style="padding:6px 4px">${safeStr(m.nombre||m.name)}${m.requiereSerial&&(m.seriales||[]).length?`<div style="font-size:10px;color:#888;font-family:monospace;margin-top:2px">${m.seriales.join(', ')}</div>`:''}</td>
              <td style="text-align:center;padding:6px 4px;font-weight:700">${m.cantidad} ${safeStr(m.unit,'')}</td>
            </tr>`).join('')}
        </tbody>
      </table>
      <div style="display:flex;gap:12px;margin-top:24px">
        <div style="flex:1;text-align:center;padding:10px;border:1px dashed ${AC};border-radius:8px">
          <div style="font-size:10px;color:#888">Devuelto digitalmente</div>
          <div style="font-size:12px;font-weight:700;margin-top:3px">${safeStr(d.tecnicoNombre)}</div>
          <div style="font-size:9px;color:#aaa;margin-top:2px">${fmt(fechaDev)}</div>
        </div>
        <div style="flex:1;text-align:center;padding:10px;border:1px dashed ${AC};border-radius:8px">
          <div style="font-size:10px;color:#888">Recibido digitalmente</div>
          <div style="font-size:12px;font-weight:700;margin-top:3px">${safeStr(d.aprobadoPor)}</div>
          <div style="font-size:9px;color:#aaa;margin-top:2px">${fmt(fechaApr)}</div>
        </div>
      </div>
    </div>
    <div style="padding:14px 0 4px"><button class="btn-primary full" onclick="window.print()">Imprimir / Guardar PDF</button></div>
  </div>`;
  document.body.appendChild(ov);
  ov.addEventListener('click',e=>{if(e.target===ov)ov.remove();});
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
          const alertaTxt = criticos>0 ? (''+criticos+' crítico'+(criticos>1?'s':'')) : bajos>0 ? (''+bajos+' bajo'+(bajos>1?'s':'')) : '&#10003; Sin alertas';
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
  // Series que salieron en esta entrega (soporta registros viejos por rango)
  const seriesDeItem = (i) => {
    if (i.seriales && i.seriales.length) return i.seriales.slice();
    if (i.serialInicio) return expandirSeriales('rango', null, i.serialInicio, i.serialFin);
    return [];
  };

  let selDev = {};
  (salida.items||[]).forEach(i=>{
    selDev[i.itemId] = {
      nombre: i.nombre||i.name, unit: i.unit, cantMax: i.cantidad,
      requiereSerial: !!i.requiereSerial,
      disponibles: seriesDeItem(i),   // series que se entregaron
      seriales: [],                   // series que se devuelven
      cantidad: 0,
      activo: false,
    };
  });

  const sheet=document.createElement('div');
  sheet.className='sheet-backdrop open';
  sheet.innerHTML=`<div class="sheet"><div class="sheet-handle"></div>
    <div class="sheet-title">Devolución — ${safeStr(salida.usuarioResponsable)}</div>
    <div class="sheet-body">
      ${(salida.items||[]).map(i=>{
        const d = selDev[i.itemId];
        return `
        <div style="margin-bottom:16px;padding-bottom:16px;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
            <div style="font-size:13px;font-weight:600">${tc(i.nombre||i.name||'—')}</div>
            <label style="display:flex;align-items:center;gap:6px;font-size:11px;color:var(--text-3);cursor:pointer">
              <input type="checkbox" id="dev-chk-${i.itemId}" onchange="window.__dev_toggle('${i.itemId}',this.checked)"/>
              Devolver
            </label>
          </div>
          <div id="dev-campos-${i.itemId}" style="display:none">
            ${!i.requiereSerial ? `
              <div class="form-label" style="margin-bottom:6px">Cantidad (máx ${i.cantidad})</div>
              <input class="form-input" id="dev-cant-${i.itemId}" type="number" min="1" max="${i.cantidad}" value="1" style="text-align:center"/>
            ` : (d.disponibles.length ? `
              <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
                <div class="form-label" style="margin:0">Toca las series que regresan</div>
                <div id="dev-est-${i.itemId}" style="font-size:11px;font-weight:700;color:var(--text-4)">0 de ${d.disponibles.length}</div>
              </div>
              <div style="display:flex;gap:6px;margin-bottom:8px">
                <div class="select-chip" style="font-size:10px;cursor:pointer" onclick="window.__dev_todas('${i.itemId}')">Todas</div>
                <div class="select-chip" style="font-size:10px;cursor:pointer" onclick="window.__dev_ninguna('${i.itemId}')">Ninguna</div>
              </div>
              <div id="dev-chips-${i.itemId}"></div>
            ` : `
              <div style="font-size:11px;color:var(--text-4)">Esta entrega no registró series.</div>
            `)}
          </div>
        </div>`;
      }).join('')}
      <div class="form-label" style="margin-bottom:8px">Motivo (opcional)</div>
      <input class="form-input" id="dev-motivo" type="text" placeholder="Ej. Material sobrante…" style="margin-bottom:16px"/>
      <div id="dev-error" class="form-error"></div>
      <button class="btn-primary full bod" id="btn-dev"><span id="btn-dev-lbl">Registrar devolución</span></button>
    </div>
  </div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener('click',e=>{if(e.target===sheet)sheet.remove();});

  function pintarDev(itemId){
    const d = selDev[itemId];
    if(!d || !d.requiereSerial) return;
    const chipsEl = document.getElementById(`dev-chips-${itemId}`);
    const estEl   = document.getElementById(`dev-est-${itemId}`);
    if(estEl){
      const n = d.seriales.length;
      estEl.textContent = `${n} de ${d.disponibles.length}`;
      estEl.style.color = n ? '#22c55e' : 'var(--text-4)';
    }
    if(!chipsEl) return;
    const set = new Set(d.seriales);
    chipsEl.innerHTML = `
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(88px,1fr));gap:5px">
        ${d.disponibles.map(ser=>{
          const on = set.has(ser);
          return `<div onclick="window.__dev_pick('${itemId}','${ser}')" style="cursor:pointer;background:${on?'rgba(34,197,94,.1)':'var(--glass)'};border:1px solid ${on?'rgba(34,197,94,.4)':'var(--border)'};border-radius:7px;padding:7px 4px;text-align:center;font-family:monospace;font-size:11px;font-weight:${on?'700':'500'};color:${on?'#22c55e':'var(--text-3)'};display:flex;align-items:center;justify-content:center;gap:3px">
            ${on?'<span style="font-size:10px">&#10003;</span>':''}<span>${ser}</span>
          </div>`;
        }).join('')}
      </div>`;
  }

  window.__dev_toggle=(id,checked)=>{
    selDev[id].activo = checked;
    const el = document.getElementById(`dev-campos-${id}`);
    if(el) el.style.display = checked ? '' : 'none';
    if(checked) pintarDev(id);
  };
  window.__dev_pick=(id,ser)=>{
    const d = selDev[id];
    const i = d.seriales.indexOf(ser);
    if(i===-1) d.seriales.push(ser); else d.seriales.splice(i,1);
    pintarDev(id);
  };
  window.__dev_todas=(id)=>{ selDev[id].seriales = selDev[id].disponibles.slice(); pintarDev(id); };
  window.__dev_ninguna=(id)=>{ selDev[id].seriales = []; pintarDev(id); };

  document.getElementById('btn-dev').addEventListener('click',async()=>{
    const errEl=document.getElementById('dev-error');
    errEl.style.display='none';
    const motivo=document.getElementById('dev-motivo').value.trim();
    const devItems=[];

    for(const i of (salida.items||[])){
      const chk=document.getElementById(`dev-chk-${i.itemId}`);
      if(!chk?.checked) continue;
      const d=selDev[i.itemId];

      let cant=0, seriales=[];
      if(i.requiereSerial){
        seriales = d.seriales.slice();
        cant = seriales.length;
        if(!cant){errEl.textContent=`Selecciona las series a devolver de ${tc(i.nombre||i.name)}`;errEl.style.display='block';return;}
      } else {
        cant = safeNum(document.getElementById(`dev-cant-${i.itemId}`)?.value);
        if(!cant || cant<1){errEl.textContent=`Ingresa la cantidad de ${tc(i.nombre||i.name)}`;errEl.style.display='block';return;}
        if(cant>i.cantidad){errEl.textContent=`${tc(i.nombre||i.name)}: no puedes devolver más de ${i.cantidad}.`;errEl.style.display='block';return;}
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

      // LIBERAR LAS SERIES: vuelven a quedar disponibles en bodega
      for(const d of devItems){
        if(!d.seriales.length) continue;
        try{
          const snapSer=await db.collection('kardex').doc('seriales').collection('items')
            .where('itemId','==',d.itemId).where('estado','==','despachado').get();
          const set=new Set(d.seriales);
          const updates=snapSer.docs
            .filter(doc=>set.has(doc.data().serial))
            .map(doc=>doc.ref.update({
              estado:'disponible',
              salidaId:null,
              fechaSalida:null,
              usuarioDespacho:null,
              devueltoEn:firebase.firestore.FieldValue.serverTimestamp(),
              devueltoPor:session_.displayName,
            }));
          await Promise.all(updates);
          // Refrescar caché para que vuelvan a aparecer al despachar
          if(serialesCache_[d.itemId]) delete serialesCache_[d.itemId];
        }catch(e){console.warn('[bodega] No se pudieron liberar seriales:',e);}
      }

      sheet.remove(); renderHistorial();
      toast('Devolución registrada','ok');
    }catch(err){errEl.textContent=`Error: ${err.message}`;errEl.style.display='block';setLoading('btn-dev-lbl','Registrar devolución',false);}
  });
}
// ══════════════════════════════════════════════════
// FORMULARIO DESPACHO — 2 pasos
// ══════════════════════════════════════════════════
function abrirDespacho(solicitud=null) {
  const campanaDespacho = solicitud?.area || areaFiltro_ || 'CAMBIOS';
  const esCampanaNueva = (campanaDespacho==='CAMBIOS' || campanaDespacho==='AMI' || campanaDespacho==='Caracterizacion' || campanaDespacho==='ReclamosSIGET');
  const hdr={
    responsable:solicitud?.usuarioNombre||'',
    pareja:solicitud?.parejaAcompanante||'',
    usuarioResp:'',
    contratista:'INNOVA',
    instalador:'',
    placa:solicitud?.placaVehiculo&&PLACAS.includes(solicitud.placaVehiculo)?solicitud.placaVehiculo:(solicitud?.placaVehiculo?'__otro__':''),
    placaOtro:solicitud?.placaVehiculo&&!PLACAS.includes(solicitud.placaVehiculo)?solicitud.placaVehiculo:'',
    fechaSol:new Date().toISOString().split('T')[0],
    fechaEnt:new Date().toISOString().split('T')[0]
  };
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

  // Carga seriales disponibles de un item (para validación en vivo). Cachea.
  async function cargarSerialesItem(itemId){
    if(serialesCache_[itemId]) return serialesCache_[itemId];
    try{
      const snap=await db.collection('kardex').doc('seriales').collection('items')
        .where('itemId','==',itemId).where('estado','==','disponible').get();
      serialesCache_[itemId]=snap.docs.map(d=>String(d.data().serial).trim());
    }catch(e){
      console.warn('[bodega] Error cargando seriales:',e);
      serialesCache_[itemId]=[];
    }
    return serialesCache_[itemId];
  }

  function renderStep1(){
    ov.innerHTML=`<div style="padding:20px;max-width:500px;margin:0 auto">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:24px">
        <button id="btn-cerrar-despacho" class="icon-btn"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg></button>
        <div class="section-title">Nueva salida — Datos</div>
      </div>
      <div class="flex-col gap-12">
        <div class="form-field">
          <div class="form-label">Técnico que recibe *</div>
          <div style="position:relative">
            <input class="form-input" id="hdr-resp" value="${hdr.responsable}" placeholder="Escribe para buscar…" autocomplete="off"/>
            <div id="hdr-resp-lista" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:20;margin-top:4px;background:var(--bg-2,#1a2332);border:1px solid var(--border);border-radius:12px;max-height:200px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.4)"></div>
          </div>
        </div>
        ${esCampanaNueva?`
        <div class="form-field">
          <div class="form-label">Usuario responsable</div>
          <input class="form-input" id="hdr-usuario" value="${hdr.usuarioResp||''}" placeholder="Usuario asignado (opcional)" autocomplete="off"/>
        </div>
        <div class="form-field">
          <div class="form-label">Pareja / acompañante</div>
          <div style="position:relative">
            <input class="form-input" id="hdr-pareja" value="${hdr.pareja}" placeholder="Escribe para buscar…" autocomplete="off"/>
            <div id="hdr-pareja-lista" style="display:none;position:absolute;top:100%;left:0;right:0;z-index:20;margin-top:4px;background:var(--bg-2,#1a2332);border:1px solid var(--border);border-radius:12px;max-height:200px;overflow-y:auto;box-shadow:0 8px 24px rgba(0,0,0,.4)"></div>
          </div>
        </div>`:''}
        <div class="form-field">
          <div class="form-label">Empresa contratista *</div>
          <div class="select-row" id="hdr-cont">
            ${CONTRATISTAS.map(c=>`<div class="select-chip ${hdr.contratista===c?'active':''}" data-val="${c}">${c}</div>`).join('')}
          </div>
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

    setupChipsDyn(ov,'hdr-cont');
    ov.querySelector('#btn-cerrar-despacho')?.addEventListener('click', () => { ov.remove(); renderTab(); });

    // Autocompletado genérico de técnicos (reutilizable)
    function setupAutocompleteTec(inputId, listaId) {
      const input = ov.querySelector('#'+inputId);
      const lista = ov.querySelector('#'+listaId);
      if (!input || !lista) return;
      function render(filtro) {
        const q = safeStr(filtro,'').toLowerCase().trim();
        const matches = tecnicos_.filter(t => safeStr(t.displayName).toLowerCase().includes(q));
        if (!matches.length) { lista.style.display='none'; return; }
        lista.innerHTML = matches.map(t=>`<div class="ac-opt" data-nombre="${safeStr(t.displayName)}" style="padding:11px 14px;font-size:13px;cursor:pointer;border-bottom:1px solid var(--border)">${safeStr(t.displayName)}</div>`).join('');
        lista.style.display='block';
        lista.querySelectorAll('.ac-opt').forEach(opt=>{
          opt.addEventListener('click',()=>{ input.value=opt.dataset.nombre; lista.style.display='none'; });
        });
      }
      input.addEventListener('focus',()=>render(input.value));
      input.addEventListener('input',()=>render(input.value));
      document.addEventListener('click',(e)=>{ if(input && !input.contains(e.target) && !lista.contains(e.target)) lista.style.display='none'; });
    }
    setupAutocompleteTec('hdr-resp','hdr-resp-lista');
    setupAutocompleteTec('hdr-pareja','hdr-pareja-lista');


    ov.querySelector('#hdr-placa')?.querySelectorAll('.select-chip').forEach(c=>{
      c.addEventListener('click',()=>{ov.querySelectorAll('#hdr-placa .select-chip').forEach(x=>x.classList.remove('active'));c.classList.add('active');ov.querySelector('#hdr-placa-otro').style.display=c.dataset.val==='__otro__'?'':'none';});
    });
    ov.querySelector('#btn-s1').addEventListener('click',()=>{
      const resp=ov.querySelector('#hdr-resp')?.value.trim();
      const cont=ov.querySelector('#hdr-cont .select-chip.active')?.dataset.val;
      const errEl=ov.querySelector('#s1-err');
      errEl.style.display='none';
      if(!resp||!cont){errEl.textContent='Técnico que recibe y contratista son obligatorios.';errEl.style.display='block';return;}
      hdr.responsable=resp;hdr.contratista=cont;
      hdr.pareja=ov.querySelector('#hdr-pareja')?.value.trim()||'';
      hdr.usuarioResp=ov.querySelector('#hdr-usuario')?.value.trim()||'';
      hdr.instalador='';
      hdr.placa=ov.querySelector('#hdr-placa .select-chip.active')?.dataset.val||'';
      hdr.placaOtro=ov.querySelector('#hdr-placa-otro').value.trim();
      hdr.fechaSol=ov.querySelector('#hdr-fsol').value;
      hdr.fechaEnt=ov.querySelector('#hdr-fent').value;
      step=2;renderStep2();
    });
  }

  function renderStep2(){
    const itemsArea=allItems_.filter(i=>i.area===(solicitud?.area||areaFiltro_));
    const hayserial=sel.some(s=>s.requiereSerial);
    ov.innerHTML=`
    <div style="max-width:520px;margin:0 auto;display:flex;flex-direction:column;min-height:100vh">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;position:sticky;top:0;background:var(--bg);z-index:10">
        <button class="icon-btn" id="back1"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg></button>
        <div style="flex:1">
          <div class="section-title">Materiales</div>
          <div style="font-size:11px;color:var(--text-4)">Paso 2 de ${hayserial?'3':'2'} · toca para agregar</div>
        </div>
      </div>

      ${sel.length?`
      <div style="padding:12px 20px;background:var(--bod-glass);border-bottom:1px solid var(--border)">
        <div class="section-label" style="margin-bottom:10px">Seleccionados (${sel.length})</div>
        <div class="flex-col gap-6">
          ${sel.map((s,idx)=>`
            <div style="display:flex;align-items:center;gap:10px;background:var(--bg-card);border:1px solid var(--border);border-radius:10px;padding:8px 10px">
              <div style="flex:1;min-width:0">
                <div style="font-size:12px;font-weight:700">${tc(s.name)}</div>
                ${s.requiereSerial?`<div style="font-size:9px;color:var(--bod-light);font-weight:600;text-transform:uppercase;margin-top:1px">Requiere serial</div>`:''}
              </div>
              <div style="display:flex;align-items:center;gap:6px">
                <button class="icon-btn" style="width:30px;height:30px;font-size:16px;font-weight:700" onclick="window.__d_dec(${idx})">−</button>
                <div style="min-width:42px;text-align:center;font-size:15px;font-weight:800;color:var(--bod-light)">${s.cantidad}</div>
                <button class="icon-btn" style="width:30px;height:30px;font-size:16px;font-weight:700;color:var(--bod-light);border-color:var(--bod-border);background:var(--bod-glass)" onclick="window.__d_inc(${idx})">+</button>
              </div>
              <button class="icon-btn" style="width:30px;height:30px" onclick="window.__d_del(${idx})"><svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="13" height="13"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg></button>
            </div>`).join('')}
        </div>
      </div>`:''}

      <div style="padding:14px 20px 0;flex:1">
        <div class="buscar-wrap" style="margin-bottom:12px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="color:var(--text-4);flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input class="buscar-input" id="bus-mat" placeholder="Buscar material…" value="${busq}" autocomplete="off"/>
        </div>
        <div id="lista-mat" class="flex-col gap-6"></div>
      </div>

      <div style="padding:14px 20px;border-top:1px solid var(--border);background:var(--bg);position:sticky;bottom:0">
        <div id="s2-err" class="form-error" style="margin-bottom:8px"></div>
        <button class="btn-primary full bod" id="btn-des" ${!sel.length?'disabled style="opacity:.5"':''}>
          <span id="btn-des-lbl">${!sel.length?'Agrega materiales':hayserial?`Continuar → Seriales`:esCampanaNueva?`Enviar para aceptación`:`Registrar salida · ${sel.length} item${sel.length>1?'s':''}`}</span>
        </button>
      </div>
    </div>`;

    window.__d_del=idx=>{sel.splice(idx,1);renderStep2();};
    window.__d_dec=idx=>{if(sel[idx].cantidad>1){sel[idx].cantidad--;}renderStep2();};
    window.__d_inc=idx=>{if(sel[idx].cantidad<sel[idx].stock){sel[idx].cantidad++;}renderStep2();};

    ov.querySelector('#back1').onclick=()=>{step=1;renderStep1();};
    ov.querySelector('#bus-mat').addEventListener('input',e=>{busq=e.target.value;renderLista();});
    ov.querySelector('#btn-des').addEventListener('click',()=>{
      if(!sel.length) return;
      if(hayserial){ step=3; renderStep3(); }
      else handleDespacho();
    });
    renderLista();

    function renderLista(){
      const el=ov.querySelector('#lista-mat');
      if(!el) return;
      const q=busq.toLowerCase();
      const selIds=new Set(sel.map(s=>s.itemId));
      const lista=q?itemsArea.filter(i=>i.name.toLowerCase().includes(q)||i.sapCode.includes(q)):itemsArea;
      if(!lista.length){el.innerHTML=`<div style="text-align:center;color:var(--text-4);font-size:12px;padding:24px">Sin materiales</div>`;return;}
      el.innerHTML=lista.map(item=>{
        const ag=selIds.has(item.id);
        const dis=ag||item.stock===0;
        return `<div class="bod-solicitar-row" style="background:${ag?'rgba(34,197,94,.06)':'var(--glass)'};border-color:${ag?'rgba(34,197,94,.25)':'var(--border)'};cursor:${dis?'default':'pointer'};opacity:${item.stock===0?'.5':'1'}" data-item="${item.id}">
          <div style="flex:1;min-width:0">
            <div style="font-size:13px;font-weight:600">${tc(item.name)}${item.requiereSerial?`<span style="font-size:9px;color:var(--bod-light);font-weight:700;text-transform:uppercase;margin-left:6px">Serial</span>`:''}</div>
            <div style="font-size:10px;color:var(--text-4)">${item.sapCode?`SAP: ${item.sapCode} · `:''}Stock: ${item.stock} ${item.unit}</div>
          </div>
          ${ag?`<span style="font-size:16px;font-weight:700;color:var(--ok)">&#10003;</span>`:item.stock===0?`<span style="font-size:11px;color:var(--text-4)">Agotado</span>`:`<span style="font-size:20px;font-weight:800;color:var(--text-4);line-height:1">+</span>`}
        </div>`;
      }).join('');
      el.querySelectorAll('[data-item]').forEach(row=>{
        row.addEventListener('click',()=>{
          const item=itemsArea.find(i=>i.id===row.dataset.item);
          if(!item||item.stock===0||sel.some(s=>s.itemId===item.id)) return;
          mostrarModalCantidad(item,cant=>{
            sel.push({itemId:item.id,name:item.name,unit:item.unit,stock:item.stock,sapCode:item.sapCode,axCode:item.axCode,cantidad:cant,requiereSerial:item.requiereSerial,modoSerial:'individual',seriales:[],serialInicio:'',serialFin:''});
            if(item.requiereSerial) cargarSerialesItem(item.id); // precargar para validación
            renderStep2();
          });
        });
      });
    }
  }

  // Ordena series de forma natural (por el número final)
  // Ordena series de forma natural (por el número final)
  // Ordena series de forma natural (por el número final)
  function ordenarSeries(arr){
    return arr.slice().sort((a,b)=>{
      const na=parseInt(String(a).replace(/\D/g,''),10);
      const nb=parseInt(String(b).replace(/\D/g,''),10);
      if(!isNaN(na)&&!isNaN(nb)&&na!==nb) return na-nb;
      return String(a).localeCompare(String(b));
    });
  }

  // Busca una serie disponible a partir de lo que se escribió.
  // Acepta dígitos parciales (ej. "087" encuentra "12345087").
  // Devuelve {serial} | {error}
  function resolverSerie(texto, disponibles, yaMarcadas){
    const t = String(texto||'').trim();
    if(!t) return {error:'vacío'};
    const exacta = disponibles.find(x=>String(x)===t);
    if(exacta) return {serial:exacta};
    const cand = disponibles.filter(x=>String(x).includes(t));
    if(cand.length===1) return {serial:cand[0]};
    if(cand.length>1)  return {error:`La serie ${t} coincide con ${cand.length}. Escribe más dígitos.`};
    const marcada = (yaMarcadas||[]).some(x=>String(x).includes(t));
    if(marcada) return {error:`La serie ${t} ya la marcaste.`};
    return {error:`La serie ${t} no está disponible en bodega.`};
  }

  function renderStep3(){
    const conSerial=sel.filter(s=>s.requiereSerial);
    ov.innerHTML=`
    <div style="max-width:520px;margin:0 auto;display:flex;flex-direction:column;min-height:100vh">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;position:sticky;top:0;background:var(--bg);z-index:10">
        <button class="icon-btn" id="back2"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg></button>
        <div style="flex:1">
          <div class="section-title">Seriales</div>
          <div style="font-size:11px;color:var(--text-4)">Paso 3 de 3</div>
        </div>
      </div>

      <div style="padding:16px 20px;flex:1" class="flex-col gap-16">
        ${conSerial.map(s=>{const idx=sel.indexOf(s);return `
          <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:14px">

            <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
              <div style="font-size:14px;font-weight:700">${tc(s.name)}</div>
              <div id="est-${idx}"></div>
            </div>

            <!-- Series marcadas -->
            <div id="marc-${idx}"></div>

            <!-- BLOQUE 1: rango -->
            <div style="background:rgba(139,92,246,.05);border:1px solid rgba(139,92,246,.18);border-radius:10px;padding:10px;margin-bottom:8px">
              <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--bod-light);margin-bottom:7px">Tomé un bloque seguido</div>
              <div style="display:flex;gap:6px;align-items:center">
                <input class="form-input" id="rd-${idx}" inputmode="numeric" autocomplete="off" placeholder="Del…" style="flex:1;padding:9px 10px;font-size:13px;font-family:monospace;text-align:center"/>
                <span style="font-size:11px;color:var(--text-4)">al</span>
                <input class="form-input" id="rh-${idx}" inputmode="numeric" autocomplete="off" placeholder="…al" style="flex:1;padding:9px 10px;font-size:13px;font-family:monospace;text-align:center"/>
                <button class="icon-btn" id="brg-${idx}" style="width:38px;height:38px;flex-shrink:0;color:var(--bod-light);border-color:var(--bod-border);background:var(--bod-glass);font-size:18px">+</button>
              </div>
            </div>

            <!-- BLOQUE 2: suelta -->
            <div style="background:rgba(255,255,255,.02);border:1px solid var(--border);border-radius:10px;padding:10px;margin-bottom:8px">
              <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--text-3);margin-bottom:7px">Agregar una suelta</div>
              <div style="display:flex;gap:6px">
                <input class="form-input" id="su-${idx}" inputmode="numeric" autocomplete="off" placeholder="Número del medidor" style="flex:1;padding:9px 10px;font-size:13px;font-family:monospace"/>
                <button class="icon-btn" id="bsu-${idx}" style="width:38px;height:38px;flex-shrink:0;color:var(--bod-light);border-color:var(--bod-border);background:var(--bod-glass);font-size:18px">+</button>
              </div>
            </div>

            <!-- Mensaje de resultado -->
            <div id="msg-${idx}" style="font-size:11px;font-weight:600;margin-bottom:8px;display:none"></div>

            <!-- Atajos -->
            <div id="acc-${idx}" style="display:flex;gap:6px;flex-wrap:wrap"></div>
          </div>`;}).join('')}
      </div>

      <div style="padding:14px 20px;border-top:1px solid var(--border);background:var(--bg);position:sticky;bottom:0">
        <div id="s3-err" class="form-error" style="margin-bottom:8px"></div>
        <button class="btn-primary full bod" id="btn-des3"><span id="btn-des-lbl">${esCampanaNueva?'Enviar para aceptación':`Registrar salida · ${sel.length} item${sel.length>1?'s':''}`}</span></button>
      </div>
    </div>`;

    const msg=(idx,texto,color)=>{
      const el=document.getElementById(`msg-${idx}`);
      if(!el) return;
      if(!texto){ el.style.display='none'; return; }
      el.textContent=texto; el.style.color=color; el.style.display='block';
    };

    // Agregar un RANGO
    window.__d_rango=idx=>{
      const s=sel[idx];
      const disp=ordenarSeries(serialesCache_[s.itemId]||[]).filter(x=>!s.seriales.includes(x));
      const elD=document.getElementById(`rd-${idx}`), elH=document.getElementById(`rh-${idx}`);
      const a=resolverSerie(elD?.value, disp, s.seriales);
      if(a.error){ msg(idx, a.error==='vacío'?'Escribe la serie inicial.':a.error, '#ef4444'); return; }
      const b=resolverSerie(elH?.value, disp, s.seriales);
      if(b.error){ msg(idx, b.error==='vacío'?'Escribe la serie final.':b.error, '#ef4444'); return; }

      const i=disp.indexOf(a.serial), j=disp.indexOf(b.serial);
      const [ini,fin] = i<=j ? [i,j] : [j,i];
      const tramo=disp.slice(ini,fin+1);
      s.seriales=ordenarSeries([...s.seriales, ...tramo]);
      if(elD) elD.value=''; if(elH) elH.value='';
      msg(idx, `Se agregaron ${tramo.length}: de la ${tramo[0]} a la ${tramo[tramo.length-1]}.`, '#22c55e');
      pintarSerial(idx);
    };

    // Agregar una SUELTA
    window.__d_suelta=idx=>{
      const s=sel[idx];
      const disp=ordenarSeries(serialesCache_[s.itemId]||[]).filter(x=>!s.seriales.includes(x));
      const el=document.getElementById(`su-${idx}`);
      const r=resolverSerie(el?.value, disp, s.seriales);
      if(r.error){ msg(idx, r.error==='vacío'?'Escribe el número del medidor.':r.error, '#ef4444'); return; }
      s.seriales=ordenarSeries([...s.seriales, r.serial]);
      if(el){ el.value=''; el.focus(); }
      msg(idx, `Se agregó la ${r.serial}.`, '#22c55e');
      pintarSerial(idx);
    };

    window.__d_del=(idx,serial)=>{
      sel[idx].seriales=sel[idx].seriales.filter(x=>x!==serial);
      msg(idx,'',''); pintarSerial(idx);
    };
    window.__d_first=idx=>{
      const s=sel[idx];
      s.seriales=ordenarSeries(serialesCache_[s.itemId]||[]).slice(0,s.cantidad);
      msg(idx, `Se agregaron las primeras ${s.seriales.length}.`, '#22c55e');
      pintarSerial(idx);
    };
    window.__d_clear=idx=>{ sel[idx].seriales=[]; msg(idx,'',''); pintarSerial(idx); };

    ov.querySelector('#back2').onclick=()=>{step=2;renderStep2();};
    ov.querySelector('#btn-des3').addEventListener('click',handleDespacho);

    conSerial.forEach(s=>{
      const idx=sel.indexOf(s);
      document.getElementById(`brg-${idx}`)?.addEventListener('click',()=>window.__d_rango(idx));
      document.getElementById(`bsu-${idx}`)?.addEventListener('click',()=>window.__d_suelta(idx));
      document.getElementById(`rh-${idx}`)?.addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();window.__d_rango(idx);} });
      document.getElementById(`su-${idx}`)?.addEventListener('keydown',e=>{ if(e.key==='Enter'){e.preventDefault();window.__d_suelta(idx);} });
      if(!serialesCache_[s.itemId]){
        cargarSerialesItem(s.itemId).then(()=>{ if(step===3) pintarSerial(idx); });
      }
      pintarSerial(idx);
    });
  }

  // Repinta contador, marcadas y atajos (nunca los inputs)
  function pintarSerial(idx){
    const s=sel[idx];
    if(!s) return;
    const estEl  = document.getElementById(`est-${idx}`);
    const marcEl = document.getElementById(`marc-${idx}`);
    const accEl  = document.getElementById(`acc-${idx}`);
    const cache  = serialesCache_[s.itemId];

    if(estEl) estEl.innerHTML = estadoHTML(s, cache);

    if(marcEl){
      marcEl.innerHTML = s.seriales.length ? `
        <div style="display:flex;flex-wrap:wrap;gap:5px;margin-bottom:10px">
          ${s.seriales.map(ser=>`
            <div onclick="window.__d_del(${idx},'${ser}')" style="cursor:pointer;display:flex;align-items:center;gap:6px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.4);border-radius:7px;padding:6px 9px;font-family:monospace;font-size:11px;font-weight:700;color:#22c55e">
              <span>${ser}</span><span style="color:#ef4444;font-size:12px">&#10007;</span>
            </div>`).join('')}
        </div>`
        : `<div style="font-size:11px;color:var(--text-4);margin-bottom:10px">${cache ? `${cache.length} series disponibles en bodega.` : 'Cargando series…'}</div>`;
    }

    if(accEl){
      const b=[];
      if(cache && cache.length>=s.cantidad && !s.seriales.length)
        b.push(`<div class="select-chip" style="font-size:10px;cursor:pointer" onclick="window.__d_first(${idx})">Tomar las primeras ${s.cantidad}</div>`);
      if(s.seriales.length)
        b.push(`<div class="select-chip" style="font-size:10px;cursor:pointer" onclick="window.__d_clear(${idx})">Limpiar</div>`);
      accEl.innerHTML=b.join('');
    }
  }

  function estadoHTML(s, cache){
    const n = s.seriales.length;
    if(!cache) return `<div style="font-size:11px;color:var(--text-4)">Cargando…</div>`;
    if(cache.length < s.cantidad)
      return `<div style="font-size:11px;font-weight:700;color:#ef4444">Solo hay ${cache.length} en bodega</div>`;
    const base = `${n} de ${s.cantidad}`;
    if(n === s.cantidad) return `<div style="font-size:11px;font-weight:700;color:#22c55e">&#10003; ${base}</div>`;
    if(n > s.cantidad)   return `<div style="font-size:11px;font-weight:700;color:#ef4444">${base} · sobran ${n-s.cantidad}</div>`;
    return `<div style="font-size:11px;font-weight:600;color:#fbbf24">${base}</div>`;
  }
  // Valida las series de un item contra los disponibles en bodega.
  function validarSeriales(s){
    const disp=serialesCache_[s.itemId]||null;
    let lista=[];
    if(s.modoSerial==='rango'){
      lista=expandirSeriales('rango',null,s.serialInicio,s.serialFin);
    }else{
      lista=(s.seriales||[]).slice();
    }
    const series=lista.map(ser=>{
      const t=String(ser).trim();
      let ok=null;
      if(disp!==null) ok=disp.includes(t);
      return {serial:t, ok};
    });
    const invalidos=series.filter(x=>x.ok===false).map(x=>x.serial);
    const validos=series.filter(x=>x.ok===true).length;
    const completo = lista.length===s.cantidad && invalidos.length===0 && (disp===null || series.every(x=>x.ok===true));
    return {series, lista, validos, invalidos, cargando:disp===null,
            faltan:s.cantidad-lista.length, completo};
  }

  async function handleDespacho(){
    if(!sel.length) return;
    // El error puede mostrarse en paso 2 o 3
    const errEl=ov.querySelector('#s3-err')||ov.querySelector('#s2-err');

    // ── Validación de seriales (obligatoria) ──
    const conSerial=sel.filter(s=>s.requiereSerial);
    if(conSerial.length){
      // Asegurar que los seriales estén cargados
      for(const s of conSerial){ await cargarSerialesItem(s.itemId); }
      for(const s of conSerial){
        const v=validarSeriales(s);
        if(v.lista.length!==s.cantidad){
          if(errEl){errEl.textContent=`${tc(s.name)}: indicaste ${v.lista.length} serie(s) pero vas a entregar ${s.cantidad}.`;errEl.style.display='block';}
          if(step!==3){step=3;renderStep3();}
          return;
        }
        // Duplicados dentro de la misma entrega
        const dup=v.lista.find((x,i)=>v.lista.indexOf(x)!==i);
        if(dup){
          if(errEl){errEl.textContent=`${tc(s.name)}: la serie ${dup} está repetida.`;errEl.style.display='block';}
          if(step!==3){step=3;renderStep3();}
          return;
        }
        if(v.invalidos.length){
          if(errEl){errEl.textContent=`${tc(s.name)}: la(s) serie(s) ${v.invalidos.slice(0,3).join(', ')}${v.invalidos.length>3?'…':''} no está(n) disponible(s) en bodega.`;errEl.style.display='block';}
          if(step!==3){step=3;renderStep3();}
          return;
        }
      }
    }

    const btn=ov.querySelector('#btn-des3')||ov.querySelector('#btn-des');
    if(errEl) errEl.style.display='none';
    if(btn) btn.disabled=true;
    const lbl=document.getElementById('btn-des-lbl');
    if(lbl) lbl.innerHTML='<div class="spinner"></div>';
    const placa=hdr.placa==='__otro__'?hdr.placaOtro:hdr.placa;

    const areaDespacho=solicitud?.area||areaFiltro_;
    const esCampanaNueva=(areaDespacho==='CAMBIOS'||areaDespacho==='AMI'||areaDespacho==='Caracterizacion'||areaDespacho==='ReclamosSIGET');

    // ── Campañas nuevas: crear despacho PENDIENTE (no descuenta stock aún) ──
    if(esCampanaNueva){
      try{
        // Buscar el UID del técnico que recibe (para que le llegue en su sesión)
        const tecRecibe=tecnicos_.find(t=>safeStr(t.displayName)===hdr.responsable);
        const tecPareja=tecnicos_.find(t=>safeStr(t.displayName)===hdr.pareja);
        const pendData={
          area:areaDespacho,
          estado:'pendiente_aceptacion',
          usuarioResponsable:hdr.responsable,
          tecnicoRecibeUid:tecRecibe?.id||null,
          parejaAcompanante:hdr.pareja||'',parejaUid:tecPareja?.id||null,usuarioRespAsignado:hdr.usuarioResp||'',empresaContratista:hdr.contratista,
          placaVehiculo:placa,fechaEntrega:hdr.fechaEnt,
          entregadoPor:session_.displayName,entregadoPorUid:uid_,
          solicitudId:solicitud?.id||null,
          items:sel.map(s=>({itemId:s.itemId,sapCode:s.sapCode,axCode:s.axCode,nombre:s.name,unit:s.unit,cantidad:s.cantidad,requiereSerial:s.requiereSerial,modoSerial:s.requiereSerial?s.modoSerial:null,seriales:s.requiereSerial&&s.modoSerial==='individual'?s.seriales:[],serialInicio:s.requiereSerial&&s.modoSerial==='rango'?s.serialInicio:'',serialFin:s.requiereSerial&&s.modoSerial==='rango'?s.serialFin:''})),
          fecha:firebase.firestore.FieldValue.serverTimestamp(),
        };
        await db.collection('despachos_pendientes').add(pendData);
        ov.remove();
        toast('Enviado al técnico para aceptación','ok');
      }catch(err){
        console.error('[bodega] Error despacho pendiente:',err);
        if(errEl){errEl.textContent=`Error: ${err.message}`;errEl.style.display='block';}
        if(btn) btn.disabled=false;
        const lbl2=document.getElementById('btn-des-lbl');
        if(lbl2) lbl2.textContent='Enviar para aceptación';
      }
      return;
    }

    // ── CAMBIOS/OTC: flujo normal (descuenta stock de una vez) ──
    try{
      const tecR=tecnicos_.find(t=>safeStr(t.displayName)===hdr.responsable);
      const tecP=tecnicos_.find(t=>safeStr(t.displayName)===hdr.pareja);
      const salidaData={
        area:solicitud?.area||areaFiltro_,
        usuarioResponsable:hdr.responsable,tecnicoRecibeUid:tecR?.id||null,
        parejaAcompanante:hdr.pareja||'',parejaUid:tecP?.id||null,
        usuarioRespAsignado:hdr.usuarioResp||'',empresaContratista:hdr.contratista,
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

      // Limpiar caché de seriales de los items despachados (ya cambiaron)
      for(const s of sel){ if(s.requiereSerial) delete serialesCache_[s.itemId]; }

      ov.remove();
      toast('Salida registrada','ok');
      showMemo({...salidaData,id:ref.id,fecha:new Date()});
      renderSolicitudes();
    }catch(err){
      console.error('[bodega] Error despacho:',err);
      if(errEl){errEl.textContent=`Error: ${err.message}`;errEl.style.display='block';}
      if(btn) btn.disabled=false;
      const lbl2=document.getElementById('btn-des-lbl');
      if(lbl2) lbl2.textContent=`Registrar salida · ${sel.length} item${sel.length>1?'es':''}`;
    }
  }

  if(step===2) renderStep2(); else renderStep1();
}

// ── Memo oficial DELSUR ───────────────────────────
// ── Memo INNOVA para AMI y Caracterización ────────
const CAMPANA_LABEL = { CAMBIOS:'Cambio de Medidores', AMI:'AMI', Caracterizacion:'Caracterización de la Carga', ReclamosSIGET:'Reclamos SIGET' };

// Expande las series de un item de salida para listarlas explícitas
function seriesDeItem(it) {
  if (it.seriales && it.seriales.length) return it.seriales.slice();
  if (it.serialInicio) {
    const ini=String(it.serialInicio).trim(), fin=String(it.serialFin||'').trim();
    const nI=parseInt(ini.replace(/\D/g,''),10), nF=parseInt(fin.replace(/\D/g,''),10);
    const prefix=ini.replace(/\d+$/,'');
    if(!isNaN(nI)&&!isNaN(nF)&&nF>=nI&&(nF-nI)<=500){
      const out=[], digits=String(nF).length;
      for(let n=nI;n<=nF;n++) out.push(prefix+String(n).padStart(digits,'0'));
      return out;
    }
  }
  return [];
}

function showMemoCampana(salida) {
  const camp = CAMPANA_LABEL[salida.area] || salida.area;
  const items = (salida.items||[]).map(i=>({
    nombre: safeStr(i.nombre||i.name,''),
    cantidad: safeNum(i.cantidad),
    unit: safeStr(i.unit,''),
    requiereSerial: !!i.requiereSerial,
    series: i.requiereSerial ? seriesDeItem(i) : [],
  }));

  const fechaEnt = safeStr(salida.fechaEntrega,'') || (salida.fecha?.seconds ? fmtDate(salida.fecha) : '');
  const memoData = { area:salida.area, camp, items,
    recibe: safeStr(salida.usuarioResponsable||salida.tecnicoNombre,''),
    pareja: safeStr(salida.parejaAcompanante,''),
    usuarioResp: safeStr(salida.usuarioRespAsignado,''),
    vehiculo: safeStr(salida.placaVehiculo,''),
    entrega: safeStr(salida.entregadoPor||salida.registradoPorNombre,''),
    fecha: fechaEnt,
    // Sellos digitales
    selloEntregaFecha: salida.fecha ? fmtDate(salida.fecha) : '',
    selloRecibeNombre: safeStr(salida.aceptadoPorTecnico,''),
    selloRecibeFecha:  salida.fechaAceptacion ? fmtDate(salida.fechaAceptacion) : '',
  };

  const AC = (CAMPANA_COLORS[salida.area]||CAMPANA_COLORS['AMI']).color; // color de acento por campaña

  // Filas de material (con series en tabla si aplica)
  const filaMat = (m,i) => {
    const seriesTabla = m.requiereSerial && m.series.length
      ? `<tr><td colspan="2" style="padding:0;border:none">
          <div style="background:rgba(255,255,255,.02);border-left:2px solid ${AC};margin:2px 0 6px 8px;padding:6px 10px;border-radius:0 6px 6px 0">
            <div style="font-size:8px;font-weight:800;color:${AC};text-transform:uppercase;letter-spacing:.04em;margin-bottom:4px">Series entregadas · ${m.series.length}</div>
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(90px,1fr));gap:3px">
              ${m.series.map(s=>`<div style="font-family:monospace;font-size:10px;color:var(--text-2);background:rgba(255,255,255,.03);border-radius:4px;padding:2px 6px;text-align:center">${s}</div>`).join('')}
            </div>
          </div></td></tr>`
      : '';
    return `<tr style="border-bottom:1px solid rgba(255,255,255,.05)">
        <td style="padding:9px 10px;font-size:12px;text-transform:uppercase;letter-spacing:.02em">${tc(m.nombre)}</td>
        <td style="padding:9px 10px;font-size:13px;font-weight:800;text-align:right;white-space:nowrap;color:${AC}">${m.cantidad} <span style="font-size:10px;font-weight:600;color:var(--text-4)">${m.unit}</span></td>
      </tr>${seriesTabla}`;
  };

  const dato = (k,v) => `
    <div style="display:flex;gap:10px;align-items:baseline">
      <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--text-4);min-width:112px">${k}</div>
      <div style="font-weight:600;font-size:12px;flex:1;border-bottom:1px dashed var(--border-md);padding-bottom:3px">${v||'—'}</div>
    </div>`;

  // Sello digital: si hay fecha, se muestra como comprobante; si no, línea de firma
  const sello = (rol, nom, texto, fecha) => {
    if (!fecha) {
      return `<div style="flex:1;text-align:center">
        <div style="height:38px;border-bottom:1.5px solid var(--text-3);margin-bottom:6px"></div>
        <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:${AC}">${rol}</div>
        <div style="font-size:11px;font-weight:600;margin-top:2px">${nom||'—'}</div>
      </div>`;
    }
    return `<div style="flex:1;text-align:center">
      <div style="border:1.5px solid ${AC};border-radius:10px;padding:8px 6px;background:${AC}0f;position:relative">
        <div style="display:flex;align-items:center;justify-content:center;gap:4px;margin-bottom:3px">
          <svg viewBox="0 0 24 24" fill="none" stroke="${AC}" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><polyline points="20 6 9 17 4 12"/></svg>
          <span style="font-size:8px;font-weight:900;text-transform:uppercase;letter-spacing:.06em;color:${AC}">${texto}</span>
        </div>
        <div style="font-size:11px;font-weight:700;line-height:1.2">${nom||'—'}</div>
        <div style="font-size:8.5px;color:var(--text-4);margin-top:2px">${fecha}</div>
      </div>
      <div style="font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text-4);margin-top:5px">${rol}</div>
    </div>`;
  };

  const sheet=document.createElement('div');
  sheet.className='sheet-backdrop open';
  sheet.innerHTML=`<div class="sheet" style="max-height:92vh;overflow-y:auto">
    <div class="sheet-handle"></div>
    <div class="sheet-body" style="padding-top:4px">

      <!-- Encabezado -->
      <div style="position:relative;text-align:center;padding:18px 0 16px;border-radius:16px;background:linear-gradient(160deg,${AC}14,transparent 70%);margin-bottom:4px">
        <div style="display:inline-flex;align-items:center;gap:8px;margin-bottom:4px">
          <div style="width:26px;height:26px;border-radius:8px;background:${AC};display:flex;align-items:center;justify-content:center">
            <svg viewBox="0 0 24 24" fill="none" stroke="#0a1628" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          </div>
          <div style="font-size:20px;font-weight:900;letter-spacing:.08em">INNOVA</div>
        </div>
        <div style="font-size:10px;color:var(--text-3);font-weight:500">Servicios Técnicos y Comerciales</div>
        <div style="display:inline-block;margin-top:8px;font-size:11px;font-weight:800;color:${AC};text-transform:uppercase;letter-spacing:.06em;background:${AC}1a;border:1px solid ${AC}44;padding:3px 14px;border-radius:20px">${camp}</div>
      </div>

      <!-- Sellos de entrega y aceptación -->
      <div style="display:flex;gap:14px;padding:16px 4px 18px">
        ${sello('Entrega', memoData.entrega, 'Entregado digitalmente', memoData.selloEntregaFecha)}
        ${sello('Recibe', memoData.selloRecibeNombre || memoData.recibe, 'Aceptado digitalmente', memoData.selloRecibeFecha)}
      </div>

      <!-- Datos -->
      <div class="flex-col gap-9" style="padding:14px;background:var(--glass);border:1px solid var(--border);border-radius:12px;margin-bottom:16px">
        ${dato('Usuario resp.', memoData.usuarioResp)}
        ${dato('Persona retira', memoData.recibe)}
        ${dato('Acompañante', memoData.pareja)}
        ${dato('Vehículo', memoData.vehiculo)}
        ${dato('Fecha entrega', memoData.fecha)}
      </div>

      <!-- Material -->
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:8px">
        <div style="font-size:10px;font-weight:800;text-transform:uppercase;letter-spacing:.05em;color:var(--text-3)">Material entregado</div>
        <div style="flex:1;height:1px;background:var(--border)"></div>
        <div style="font-size:10px;color:var(--text-4)">${items.length} línea${items.length>1?'s':''}</div>
      </div>
      <div style="border:1px solid var(--border);border-radius:12px;overflow:hidden">
        <table style="width:100%;border-collapse:collapse">
          <thead><tr style="background:${AC}12">
            <th style="text-align:left;padding:8px 10px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--text-3)">Descripción</th>
            <th style="text-align:right;padding:8px 10px;font-size:9px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:var(--text-3)">Cantidad</th>
          </tr></thead>
          <tbody>${items.map(filaMat).join('')}</tbody>
        </table>
      </div>

    </div>
    <div style="padding:12px 16px;border-top:1px solid var(--border);display:flex;gap:8px">
      <button class="btn-action outline" style="flex:1;height:44px" onclick="this.closest('.sheet-backdrop').remove()">Cerrar</button>
      <button class="btn-primary bod" style="flex:1;height:44px" onclick="window.__bodega._imprimirCamp(window.__memo_camp)"><span>Imprimir</span></button>
    </div>
  </div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener('click',e=>{if(e.target===sheet)sheet.remove();});
  window.__memo_camp = memoData;
  window.__bodega._imprimirCamp = (m)=>imprimirCampana(m);
}

function imprimirCampana(m) {
  const AC = m.area==='AMI' ? '#c98a00' : m.area==='ReclamosSIGET' ? '#be185d' : m.area==='CAMBIOS' ? '#0d9488' : '#7c5cd6';
  const filas = m.items.map(it=>{
    const serie = it.requiereSerial && it.series.length
      ? `<tr><td colspan="2" style="border:0.4pt solid #000;border-top:none;padding:1.5mm 2mm;background:#fafafa">
           <div style="font-size:7pt;font-weight:bold;color:${AC};text-transform:uppercase;margin-bottom:1mm">Series entregadas (${it.series.length})</div>
           <div style="display:flex;flex-wrap:wrap;gap:1.5mm">
             ${it.series.map(s=>`<span style="font-family:'Courier New',monospace;font-size:8pt;border:0.3pt solid #999;border-radius:1mm;padding:0.3mm 1.5mm">${s}</span>`).join('')}
           </div>
         </td></tr>`
      : '';
    return `<tr>
      <td style="border:0.4pt solid #000;padding:1.5mm 2mm;font-size:9pt;text-transform:uppercase">${(it.nombre||'').toUpperCase()}</td>
      <td style="border:0.4pt solid #000;padding:1.5mm 2mm;font-size:9pt;text-align:right;font-weight:bold;width:28mm">${it.cantidad} ${it.unit}</td>
    </tr>${serie}`;
  }).join('');

  const html=`<!DOCTYPE html><html><head><meta charset="utf-8"><title>Memo ${m.camp}</title>
  <style>
    @page{size:215.9mm 279.4mm;margin:14mm 16mm;}
    *{margin:0;padding:0;box-sizing:border-box;}
    body{font-family:Arial,Helvetica,sans-serif;color:#111;background:#fff;font-size:9pt;}
    .head{position:relative;text-align:center;padding-bottom:5mm;margin-bottom:6mm;border-bottom:2pt solid ${AC};}
    .emp{font-size:22pt;font-weight:900;letter-spacing:3px;}
    .uni{font-size:8.5pt;color:#444;margin-top:1mm;}
    .camp{display:inline-block;font-size:9pt;font-weight:bold;margin-top:2.5mm;text-transform:uppercase;letter-spacing:1px;color:${AC};border:1pt solid ${AC};border-radius:10pt;padding:1mm 5mm;}
    .firmas{display:flex;gap:20mm;margin-bottom:8mm;}
    .firma{flex:1;text-align:center;}
    .firma .linea{border-bottom:0.6pt solid #000;height:16mm;margin-bottom:1.5mm;}
    .firma .rol{font-size:7.5pt;font-weight:bold;text-transform:uppercase;letter-spacing:.5px;color:${AC};}
    .firma .nom{font-size:8.5pt;margin-top:0.5mm;}
    .datos{width:100%;margin-bottom:6mm;border-collapse:collapse;}
    .datos td{padding:1.5mm 0;font-size:9pt;vertical-align:bottom;}
    .lbl{font-weight:bold;text-transform:uppercase;font-size:7.5pt;width:38mm;color:#333;}
    .val{border-bottom:0.4pt solid #000;padding-left:2mm !important;}
    .tit{font-size:8pt;font-weight:bold;text-transform:uppercase;color:#333;margin-bottom:2mm;letter-spacing:.5px;}
    table.mat{width:100%;border-collapse:collapse;}
    table.mat th{background:${AC}22;border:0.4pt solid #000;padding:1.5mm 2mm;font-size:7.5pt;text-transform:uppercase;letter-spacing:.5px;}
    .sello{border:1pt solid ${AC};border-radius:2mm;padding:2.5mm 2mm;background:#fbfbfb;text-align:center;margin-bottom:1.5mm;}
    .sello-tit{font-size:7pt;font-weight:bold;text-transform:uppercase;letter-spacing:.4px;color:${AC};margin-bottom:1mm;}
    .sello-nom{font-size:9pt;font-weight:bold;}
    .sello-fec{font-size:7pt;color:#555;margin-top:0.5mm;}
  </style></head><body>
    <div class="head">
      <div class="emp">INNOVA</div>
      <div class="uni">Servicios Técnicos y Comerciales</div>
      <div class="camp">Campaña: ${m.camp}</div>
    </div>

    <div class="firmas">
      ${m.selloEntregaFecha
        ? `<div class="firma"><div class="sello"><div class="sello-tit">&#10003; Entregado digitalmente</div><div class="sello-nom">${m.entrega||''}</div><div class="sello-fec">${m.selloEntregaFecha}</div></div><div class="rol">Entrega</div></div>`
        : `<div class="firma"><div class="linea"></div><div class="rol">Entrega</div><div class="nom">${m.entrega||''}</div></div>`}
      ${m.selloRecibeFecha
        ? `<div class="firma"><div class="sello"><div class="sello-tit">&#10003; Aceptado digitalmente</div><div class="sello-nom">${m.selloRecibeNombre||m.recibe||''}</div><div class="sello-fec">${m.selloRecibeFecha}</div></div><div class="rol">Recibe</div></div>`
        : `<div class="firma"><div class="linea"></div><div class="rol">Recibe</div><div class="nom">${m.recibe||''}</div></div>`}
    </div>

    <table class="datos">
      <tr><td class="lbl">Usuario responsable:</td><td class="val">${m.usuarioResp||''}</td></tr>
      <tr><td class="lbl">Persona que retira:</td><td class="val">${m.recibe||''}</td></tr>
      <tr><td class="lbl">Acompañante:</td><td class="val">${m.pareja||''}</td></tr>
      <tr><td class="lbl">Vehículo:</td><td class="val">${m.vehiculo||''}</td><td class="lbl" style="width:24mm;padding-left:6mm">Fecha:</td><td class="val">${m.fecha||''}</td></tr>
    </table>

    <div class="tit">Material entregado</div>
    <table class="mat">
      <tr><th style="text-align:left">Descripción</th><th style="width:28mm;text-align:right">Cantidad</th></tr>
      ${filas}
    </table>
  </body></html>`;

  const w=window.open('','_blank');
  if(!w){toast('Permite ventanas emergentes para imprimir','error');return;}
  w.document.write(html);
  w.document.close();
  setTimeout(()=>{w.focus();w.print();},400);
}

function showMemo(salida) {
  // AMI y Caracterización usan memo propio de INNOVA
  if (salida.area === 'CAMBIOS' || salida.area === 'AMI' || salida.area === 'Caracterizacion' || salida.area === 'ReclamosSIGET') {
    return showMemoCampana(salida);
  }
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
        ${[['TÉCNICO QUE RECIBE',memo.USUARIO_RESPONSABLE],['EMPRESA CONTRATISTA',memo.EMPRESA_CONTRATISTA],['ENTREGADO POR',memo.ENTREGADO_POR],['PLACA DE VEHICULO',memo.PLACA_VEHICULO],['FECHA SOLICITUD',memo.FECHA_SOLICITUD],['FECHA ENTREGA',memo.FECHA_ENTREGA]].map(([k,v])=>`
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
      <button class="btn-primary bod" style="flex:1;height:44px" onclick="window.__bodega._imprimir(window.__memo_data)"><span>Imprimir</span></button>
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
    <tr><td style="vertical-align:top;padding-right:2mm;border:none;"><div class="empresa">DISTRUIBUIDORA DE ELECTRICIDAD DELSUR S.A. DE C.V.</div><div class="sub">OTC - GERENCIA COMERCIAL</div><div class="sub">DESPACHO/ CARGA DE MATERIALES</div></td><td style="border:none;padding-bottom:1.5mm;"><span class="lbl">TÉCNICO QUE RECIBE:</span><span class="linea">${v.USUARIO_RESPONSABLE}</span></td></tr>
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

// ── Importar items desde Excel ────────────────────
function exportarInventario() {
  const campana = areaFiltro_;
  const items = allItems_.filter(i => i.area === campana).sort((a,b)=>safeStr(a.name).localeCompare(safeStr(b.name)));
  if (!items.length) { toast('No hay materiales en esta campaña', 'error'); return; }

  // Encabezados EXACTOS que el importador reconoce. La columna Stock va vacía
  // para escribir lo que entra. NO se agregan columnas extra: el importador
  // busca por inclusión ("stock", "ax") y una columna de más rompe el mapeo.
  const filas = items.map(i => ({
    Nombre:  safeStr(i.name,''),
    Unidad:  safeStr(i.unit,''),
    SAP:     safeStr(i.sapCode,''),
    AX:      safeStr(i.axCode,''),
    Stock:   '',                       // <- escribe aquí lo que llega
    Minimo:  safeNum(i.minStock)||5,
  }));

  const ws = XLSX.utils.json_to_sheet(filas, { header:['Nombre','Unidad','SAP','AX','Stock','Minimo'] });
  ws['!cols'] = [{wch:40},{wch:10},{wch:14},{wch:14},{wch:10},{wch:8}];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, campana.substring(0,28));

  const label = (CAMPANA_COLORS[campana]?.label || campana).replace(/[^\w]/g,'_');
  const hoy = new Date().toISOString().split('T')[0];
  XLSX.writeFile(wb, `Inventario_${label}_${hoy}.xlsx`);
  toast('Excel exportado', 'ok');
}

function abrirImportar() {
  const sheet=document.createElement('div');
  sheet.className='sheet-backdrop open';
  sheet.innerHTML=`<div class="sheet"><div class="sheet-handle"></div>
    <div class="sheet-title">Importar items (Excel)</div>
    <div class="sheet-body">
      <div class="form-field">
        <div class="form-label">Campaña destino *</div>
        <div class="select-row flex-wrap" id="imp-campana">
          <div class="select-chip active" data-val="CAMBIOS">CAMBIOS</div>
          <div class="select-chip" data-val="AMI">AMI</div>
          <div class="select-chip" data-val="Caracterizacion">Caracterización</div>
          <div class="select-chip" data-val="ReclamosSIGET">Reclamos SIGET</div>
        </div>
      </div>
      <div style="font-size:11px;color:var(--text-4);line-height:1.6;margin-bottom:14px">
        El Excel debe tener columnas: <b>Nombre</b>, <b>Unidad</b>, <b>SAP</b>, <b>AX</b>, <b>Stock</b>, <b>Minimo</b>.<br>
        Si un código SAP o AX ya existe, se <b>suma</b> el stock. Si no, se crea el item.
      </div>
      <input type="file" id="imp-file" accept=".xlsx,.xls" style="display:none"/>
      <button class="btn-primary full bod" id="imp-btn-file">Seleccionar archivo Excel</button>
      <div id="imp-preview" style="margin-top:14px"></div>
      <div id="imp-error" class="form-error"></div>
    </div>
  </div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener('click',e=>{if(e.target===sheet){sheet.remove();renderInventario();}});
  setupChipsDyn(sheet,'imp-campana');

  let parsedRows=[];
  const fileInput=sheet.querySelector('#imp-file');
  sheet.querySelector('#imp-btn-file').addEventListener('click',()=>fileInput.click());

  fileInput.addEventListener('change',async(e)=>{
    const file=e.target.files[0];
    if(!file) return;
    const errEl=sheet.querySelector('#imp-error');
    errEl.style.display='none';
    try {
      const data=await file.arrayBuffer();
      const wb=XLSX.read(data,{type:'array'});
      const ws=wb.Sheets[wb.SheetNames[0]];
      const rows=XLSX.utils.sheet_to_json(ws,{defval:''});
      if(!rows.length){errEl.textContent='El archivo está vacío.';errEl.style.display='block';return;}

      // Normalizar columnas (tolera variaciones de nombre)
      parsedRows=rows.map(r=>{
        // Coincidencia EXACTA primero; si no, por inclusión. Evita que
        // "stock actual" sea confundida con "stock", etc.
        const get=(...keys)=>{
          const cols=Object.keys(r);
          for(const k of cols){ const kn=k.toLowerCase().trim(); if(keys.includes(kn)) return r[k]; }
          for(const k of cols){ const kn=k.toLowerCase().trim(); if(keys.some(x=>kn.includes(x))) return r[k]; }
          return '';
        };
        return {
          name:   String(get('nombre','descripcion','descripción','material')).trim(),
          unit:   String(get('unidad','unit','um')).trim()||'unidades',
          sapCode:String(get('sap','reserva')).trim(),
          axCode: String(get('ax','stock code','codigo ax','código ax')).trim(),
          stock:  safeNum(get('stock','cantidad','existencia')),
          minStock:safeNum(get('minimo','mínimo','min','stock minimo')),
        };
      }).filter(r=>r.name);

      if(!parsedRows.length){errEl.textContent='No se encontraron filas válidas (falta columna Nombre).';errEl.style.display='block';return;}

      sheet.querySelector('#imp-preview').innerHTML=`
        <div style="padding:12px;background:var(--bod-glass);border:1px solid var(--bod-border);border-radius:12px;margin-bottom:12px">
          <div style="font-size:13px;font-weight:700;color:var(--bod-light);margin-bottom:4px">${parsedRows.length} items detectados</div>
          <div style="font-size:11px;color:var(--text-4)">Revisa y confirma la importación</div>
        </div>
        <button class="btn-primary full bod" id="imp-confirmar"><span id="imp-lbl">Importar ${parsedRows.length} items</span></button>`;

      sheet.querySelector('#imp-confirmar').addEventListener('click',()=>ejecutarImport(sheet,parsedRows));
    } catch(err){
      errEl.textContent='Error al leer el Excel: '+err.message;
      errEl.style.display='block';
    }
  });
}

async function ejecutarImport(sheet, rows) {
  const campana=sheet.querySelector('#imp-campana .select-chip.active')?.dataset.val||'CAMBIOS';
  const errEl=sheet.querySelector('#imp-error');
  errEl.style.display='none';
  setLoading('imp-lbl','Importando…',true);

  try {
    const col=db.collection('kardex').doc('inventario').collection('items');
    const movCol=db.collection('kardex').doc('movimientos').collection('ajustes');
    const now=firebase.firestore.FieldValue.serverTimestamp();
    let creados=0, actualizados=0;
    const movimientos=[];  // se registran al final, en lote

    for(const r of rows){
      const rSap  = safeStr(r.sapCode,'').trim();
      const rAx   = safeStr(r.axCode,'').trim();
      const rName = safeStr(r.name,'').trim().toLowerCase();
      const cant  = safeNum(r.stock);

      // Buscar el material existente en la misma campaña.
      // 1) Por código SAP o AX si el Excel los trae.
      // 2) Si no hay códigos, por NOMBRE (así no se duplica cuando el
      //    material no tiene SAP/AX, que es el caso de varias campañas).
      const existente = allItems_.find(i => {
        if (i.area !== campana) return false;
        const iSap = safeStr(i.sapCode,'').trim();
        const iAx  = safeStr(i.axCode,'').trim();
        if (rSap && iSap && iSap === rSap) return true;
        if (rAx  && iAx  && iAx  === rAx ) return true;
        // Sin coincidencia de código: comparar por nombre solo si NINGUNO
        // de los dos lados aporta un código que debiera haber coincidido.
        if (!rSap && !rAx) {
          return safeStr(i.name,'').trim().toLowerCase() === rName;
        }
        return false;
      });

      if(existente){
        const stockAntes=safeNum(existente.stock);
        const nuevoStock=stockAntes+cant;
        await col.doc(existente.id).update({
          stock:nuevoStock,
          name:r.name||existente.name,
          unit:r.unit||existente.unit,
          minStock:r.minStock||existente.minStock,
        });
        existente.stock=nuevoStock;
        actualizados++;
        // Solo registrar movimiento si de verdad entró cantidad
        if(cant>0) movimientos.push({tipo:'entrada',origen:'importacion',itemId:existente.id,itemNombre:existente.name,cantidad:cant,stockAntes,stockDespues:nuevoStock,area:campana,seriales:[],motivo:'Importación por Excel',fecha:now,registradoPor:uid_,registradoPorNombre:session_.displayName});
      } else {
        const nuevo={
          name:r.name, unit:r.unit,
          sapCode:r.sapCode, axCode:r.axCode,
          stock:cant, minStock:safeNum(r.minStock)||5,
          requiereSerial:false, area:campana,
        };
        const ref=await col.add(nuevo);
        allItems_.push(normalizeItem({id:ref.id,...nuevo}));
        creados++;
        if(cant>0) movimientos.push({tipo:'entrada',origen:'importacion',itemId:ref.id,itemNombre:nuevo.name,cantidad:cant,stockAntes:0,stockDespues:cant,area:campana,seriales:[],motivo:'Importación por Excel (item nuevo)',fecha:now,registradoPor:uid_,registradoPorNombre:session_.displayName});
      }
    }

    // Registrar todos los movimientos en lotes de 400
    for(let i=0;i<movimientos.length;i+=400){
      const batch=db.batch();
      movimientos.slice(i,i+400).forEach(m=>batch.set(movCol.doc(),m));
      await batch.commit();
    }

    toast(`Importados: ${creados} nuevos, ${actualizados} actualizados`,'ok');
    sheet.remove();
    areaFiltro_=campana;
    renderInventario();
  } catch(err){
    errEl.textContent='Error al importar: '+err.message;
    errEl.style.display='block';
    setLoading('imp-lbl','Reintentar',false);
  }
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
          ${['CAMBIOS','AMI','Caracterizacion','ReclamosSIGET'].map(a=>`<div class="select-chip ${(item?.area||areaFiltro_)===a?'active':''}" data-val="${a}">${a==='Caracterizacion'?'Caracterización':a==='ReclamosSIGET'?'Reclamos SIGET':a}</div>`).join('')}
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
// Expande seriales según modo (individual o rango). Devuelve array de seriales.
function expandirSeriales(modo, textoIndividual, inicio, fin) {
  if (modo === 'rango') {
    const ini = String(inicio||'').trim();
    const f   = String(fin||'').trim();
    if (!ini || !f) return [];
    const nI = parseInt(ini.replace(/\D/g,''),10);
    const nF = parseInt(f.replace(/\D/g,''),10);
    if (isNaN(nI) || isNaN(nF) || nF < nI) return [];
    if (nF - nI > 1000) return []; // tope de seguridad: rango máximo 1000
    const prefix = ini.replace(/\d+$/,'');
    const digits = String(nF).length;
    const lista = [];
    for (let n=nI; n<=nF; n++) lista.push(prefix+String(n).padStart(digits,'0'));
    return lista;
  }
  // individual: uno por línea
  return String(textoIndividual||'').trim()
    ? String(textoIndividual).trim().split('\n').map(s=>s.trim()).filter(Boolean)
    : [];
}

// Caja: genera desde el primer serial N consecutivos y descuenta los faltantes.
// "faltan" acepta números cortos (14) o completos (12345014), coma o espacio.
// Devuelve { seriales, faltantes, error }
function expandirCaja(desde, cantidad, faltanTexto) {
  const ini = String(desde||'').trim();
  const cant = parseInt(cantidad,10);
  if (!ini)              return { error:'Escribe el primer serial de la caja.' };
  if (!cant || cant<=0)  return { error:'Escribe cuántos medidores trae la caja.' };
  if (cant > 1000)       return { error:'La caja no puede tener más de 1000.' };

  const nIni = parseInt(ini.replace(/\D/g,''),10);
  if (isNaN(nIni))       return { error:'El primer serial debe contener números.' };

  const prefix = ini.replace(/\d+$/,'');
  const digits = ini.replace(/\D/g,'').length;
  const fmt = n => prefix + String(n).padStart(digits,'0');

  // Todos los de la caja llena
  const todos = [];
  for (let k=0; k<cant; k++) todos.push(fmt(nIni+k));

  // Resolver faltantes. Cada número escrito puede ser:
  //  - el serial COMPLETO (ej. 12345014), o
  //  - la POSICIÓN dentro de la caja (ej. 14 = el 14º medidor).
  // Se prioriza el serial completo; si no calza, se toma como posición.
  const faltantes = [];
  const noEncontrados = [];
  const setTodos = new Set(todos);
  const tokens = String(faltanTexto||'').split(/[\s,;]+/).map(t=>t.trim()).filter(Boolean);
  for (const t of tokens) {
    const limpio = t.replace(/\D/g,'');
    if (!limpio) continue;
    let serial = null;
    // 1) Serial completo tal cual, o con el prefijo de la caja
    if (setTodos.has(t))            serial = t;
    else if (setTodos.has(prefix+limpio)) serial = prefix+limpio;
    else {
      // 2) Posición dentro de la caja (1..cant)
      const pos = parseInt(limpio,10);
      if (pos>=1 && pos<=cant) serial = todos[pos-1];
    }
    if (serial) faltantes.push(serial);
    else noEncontrados.push(t);
  }

  if (noEncontrados.length) {
    return { error:`Estos faltantes no caen dentro de la caja: ${noEncontrados.join(', ')}` };
  }

  const setFalt = new Set(faltantes);
  const seriales = todos.filter(x => !setFalt.has(x));
  return { seriales, faltantes };
}

function abrirEntrada(itemId) {
  const item=allItems_.find(i=>i.id===itemId);
  const esSerial = !!item?.requiereSerial;
  const sheet=document.createElement('div');
  sheet.className='sheet-backdrop open';
  sheet.innerHTML=`<div class="sheet"><div class="sheet-handle"></div>
    <div class="sheet-title">Registrar entrada</div>
    <div class="sheet-body">
      <div style="background:var(--glass);border:1px solid var(--border);border-radius:var(--radius-sm);padding:14px;margin-bottom:16px">
        <div style="font-size:14px;font-weight:700">${tc(item?.name||'—')}</div>
        <div style="font-size:11px;color:var(--text-4);margin-top:3px">Stock actual: ${item?.stock||0} ${safeStr(item?.unit,'')}</div>
      </div>
      ${esSerial?`
      <div class="form-field">
        <div class="form-label">Modo de ingreso de seriales</div>
        <div class="select-row" id="ent-modo">
          <div class="select-chip active" data-val="caja">Caja</div>
          <div class="select-chip" data-val="rango">Rango</div>
          <div class="select-chip" data-val="individual">Individual</div>
        </div>
      </div>
      <div id="ent-serial-caja">
        <div style="background:rgba(45,212,191,.05);border:1px solid rgba(45,212,191,.18);border-radius:10px;padding:12px;margin-bottom:8px">
          <div style="display:grid;grid-template-columns:1.4fr 1fr;gap:10px;margin-bottom:10px">
            <div class="form-field" style="margin:0"><div class="form-label">Primer serial de la caja *</div><input class="form-input" id="ent-cj-desde" type="text" inputmode="numeric" placeholder="12345001" style="font-family:monospace"/></div>
            <div class="form-field" style="margin:0"><div class="form-label">Cantidad de la caja *</div><input class="form-input" id="ent-cj-cant" type="number" min="1" placeholder="30" style="text-align:center"/></div>
          </div>
          <div class="form-field" style="margin:0">
            <div class="form-label">Faltan (los que sacaron) — opcional</div>
            <input class="form-input" id="ent-cj-faltan" type="text" inputmode="numeric" placeholder="Ej. 14, 23, 29" style="font-family:monospace"/>
            <div style="font-size:10px;color:var(--text-4);margin-top:5px">Escribe solo los números que faltan, cortos o completos, separados por coma o espacio.</div>
          </div>
        </div>
        <div id="ent-cj-info" style="font-size:11px;font-weight:600;color:var(--bod-light);margin-bottom:12px"></div>
      </div>
      <div id="ent-serial-individual" style="display:none">
        <div class="form-field">
          <div class="form-label">Seriales (uno por línea) *</div>
          <textarea class="form-input" id="ent-sers" rows="5" placeholder="12345001&#10;12345002&#10;..." style="font-family:monospace;font-size:11px;resize:none"></textarea>
        </div>
      </div>
      <div id="ent-serial-rango" style="display:none">
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
          <div class="form-field"><div class="form-label">Serial inicial *</div><input class="form-input" id="ent-sri" type="text" placeholder="12345001" style="font-family:monospace"/></div>
          <div class="form-field"><div class="form-label">Serial final *</div><input class="form-input" id="ent-srf" type="text" placeholder="12345050" style="font-family:monospace"/></div>
        </div>
        <div id="ent-rango-info" style="font-size:11px;color:var(--bod-light);margin-top:-6px;margin-bottom:12px"></div>
      </div>
      `:`
      <div class="form-field"><div class="form-label">Cantidad *</div><input class="form-input" id="ent-cant" type="number" min="1" placeholder="0"/></div>
      `}
      <div class="form-field"><div class="form-label">Motivo / Referencia</div><input class="form-input" id="ent-ref" type="text" placeholder="Ej. Compra, Reposición…"/></div>
      <div id="ent-error" class="form-error"></div>
      <button class="btn-primary full bod" id="btn-ent"><span id="btn-ent-lbl">Registrar entrada</span></button>
    </div>
  </div>`;
  document.body.appendChild(sheet);
  sheet.addEventListener('click',e=>{if(e.target===sheet){sheet.remove();renderInventario();}});

  // Toggle de modo serial
  if (esSerial) {
    const cajaBox = sheet.querySelector('#ent-serial-caja');
    const indBox = sheet.querySelector('#ent-serial-individual');
    const ranBox = sheet.querySelector('#ent-serial-rango');
    const infoEl = sheet.querySelector('#ent-rango-info');
    const cjInfo = sheet.querySelector('#ent-cj-info');
    sheet.querySelectorAll('#ent-modo .select-chip').forEach(chip=>{
      chip.addEventListener('click',()=>{
        sheet.querySelectorAll('#ent-modo .select-chip').forEach(c=>c.classList.remove('active'));
        chip.classList.add('active');
        const modo=chip.dataset.val;
        cajaBox.style.display = modo==='caja'?'':'none';
        indBox.style.display = modo==='individual'?'':'none';
        ranBox.style.display = modo==='rango'?'':'none';
      });
    });
    // Info en vivo del rango
    const actualizarInfo=()=>{
      const lista=expandirSeriales('rango',null,sheet.querySelector('#ent-sri').value,sheet.querySelector('#ent-srf').value);
      infoEl.textContent = lista.length ? `Se generarán ${lista.length} seriales` : 'Revisa el rango (inicial y final)';
    };
    sheet.querySelector('#ent-sri')?.addEventListener('input',actualizarInfo);
    sheet.querySelector('#ent-srf')?.addEventListener('input',actualizarInfo);
    // Info en vivo de la caja
    const actualizarCaja=()=>{
      const r=expandirCaja(
        sheet.querySelector('#ent-cj-desde').value,
        sheet.querySelector('#ent-cj-cant').value,
        sheet.querySelector('#ent-cj-faltan').value
      );
      if(r.error){ cjInfo.textContent=r.error; cjInfo.style.color='#ef4444'; return; }
      const nf=r.faltantes.length;
      cjInfo.style.color='#22c55e';
      cjInfo.textContent = nf
        ? `Entrarán ${r.seriales.length} medidores (${nf} faltante${nf>1?'s':''}: ${r.faltantes.join(', ')})`
        : `Entrarán ${r.seriales.length} medidores (caja completa)`;
    };
    sheet.querySelector('#ent-cj-desde')?.addEventListener('input',actualizarCaja);
    sheet.querySelector('#ent-cj-cant')?.addEventListener('input',actualizarCaja);
    sheet.querySelector('#ent-cj-faltan')?.addEventListener('input',actualizarCaja);
  }

  document.getElementById('btn-ent').addEventListener('click',async()=>{
    const motivo=document.getElementById('ent-ref').value.trim();
    const errEl=document.getElementById('ent-error');
    errEl.style.display='none';
    let cantidad=0, seriales=[];

    if(esSerial){
      const modo=sheet.querySelector('#ent-modo .select-chip.active')?.dataset.val||'caja';
      if(modo==='caja'){
        const r=expandirCaja(
          document.getElementById('ent-cj-desde')?.value,
          document.getElementById('ent-cj-cant')?.value,
          document.getElementById('ent-cj-faltan')?.value
        );
        if(r.error){errEl.textContent=r.error;errEl.style.display='block';return;}
        seriales=r.seriales;
      }else if(modo==='individual'){
        seriales=expandirSeriales('individual',document.getElementById('ent-sers')?.value);
      }else{
        seriales=expandirSeriales('rango',null,document.getElementById('ent-sri')?.value,document.getElementById('ent-srf')?.value);
      }
      if(!seriales.length){errEl.textContent=modo==='rango'?'Ingresa un rango válido (serial inicial y final).':modo==='caja'?'Revisa los datos de la caja.':'Ingresa al menos un serial.';errEl.style.display='block';return;}
      // Detectar duplicados dentro del mismo ingreso
      const dup=seriales.find((s,i)=>seriales.indexOf(s)!==i);
      if(dup){errEl.textContent=`Serial repetido en la lista: ${dup}`;errEl.style.display='block';return;}
      cantidad=seriales.length;
    }else{
      cantidad=safeNum(document.getElementById('ent-cant').value);
      if(!cantidad||cantidad<=0){errEl.textContent='Ingresa una cantidad válida.';errEl.style.display='block';return;}
    }

    setLoading('btn-ent-lbl','Guardando…',true);
    try{
      const now=firebase.firestore.Timestamp.now();
      let reintegradas=[];   // series que estaban despachadas y se liberan
      let nuevasSeries=[];   // series que no existían y se crean

      // Clasificar las series: nuevas / disponibles (repetidas) / despachadas (reintegrar)
      if(esSerial && seriales.length){
        const snapSer=await db.collection('kardex').doc('seriales').collection('items').where('itemId','==',itemId).get();
        const docPorSerial={};
        snapSer.docs.forEach(d=>{ docPorSerial[String(d.data().serial)]=d; });

        const yaDisponibles=[];
        for(const s of seriales){
          const doc=docPorSerial[String(s)];
          if(!doc){ nuevasSeries.push(s); }
          else if(doc.data().estado==='despachado'){ reintegradas.push({serial:s, ref:doc.ref}); }
          else { yaDisponibles.push(s); }
        }

        // Las que ya están disponibles en bodega no tiene sentido reingresarlas
        if(yaDisponibles.length){
          errEl.innerHTML=`Estas series ya están disponibles en bodega (no despachadas):<br><span style="font-family:monospace">${yaDisponibles.slice(0,10).join(', ')}${yaDisponibles.length>10?'…':''}</span>`;
          errEl.style.display='block';
          setLoading('btn-ent-lbl','Registrar entrada',false);
          return;
        }
      }

      const nuevoStock=(item?.stock||0)+cantidad;
      const batch=db.batch();
      batch.update(db.collection('kardex').doc('inventario').collection('items').doc(itemId),{stock:nuevoStock});
      const entRef=db.collection('kardex').doc('movimientos').collection('ajustes').doc();
      const huboReintegro=reintegradas.length>0;
      batch.set(entRef,{
        tipo:huboReintegro?'devolucion':'entrada',
        origen:huboReintegro?'reintegro_manual':'manual',
        itemId, itemNombre:item?.name, cantidad, area:item?.area||areaFiltro_,
        motivo:motivo||(huboReintegro?'Reintegro de series devueltas':null),
        seriales:esSerial?seriales:[],
        serialesReintegradas:reintegradas.map(r=>r.serial),
        stockAntes:item?.stock||0, stockDespues:nuevoStock,
        fecha:now, registradoPor:uid_, registradoPorNombre:session_.displayName,
      });
      // Crear las series nuevas
      for(const ser of nuevasSeries){
        const serRef=db.collection('kardex').doc('seriales').collection('items').doc();
        batch.set(serRef,{sapCode:item.sapCode,axCode:item.axCode,itemId,itemNombre:item.name,serial:ser,estado:'disponible',fechaEntrada:now,registradoPor:uid_});
      }
      // Liberar (reintegrar) las series que estaban despachadas
      for(const r of reintegradas){
        batch.update(r.ref,{estado:'disponible',salidaId:null,fechaSalida:null,usuarioDespacho:null,devueltoEn:now,devueltoPor:'Reintegro manual',reintegradoPor:session_.displayName});
      }
      await batch.commit();
      const idx=allItems_.findIndex(i=>i.id===itemId);
      if(idx!==-1) allItems_[idx].stock=nuevoStock;
      if(serialesCache_[itemId]) delete serialesCache_[itemId];
      sheet.remove();renderInventario();
      const msg=huboReintegro
        ? `Entrada: +${cantidad}${reintegradas.length?` (${reintegradas.length} reintegrada${reintegradas.length>1?'s':''})`:''}`
        : `Entrada registrada: +${cantidad} ${safeStr(item?.unit,'')}`;
      toast(msg, 'ok');
    }catch(err){errEl.textContent=`Error: ${err.message}`;errEl.style.display='block';setLoading('btn-ent-lbl','Registrar entrada',false);}
  });
}

// ── Helpers ───────────────────────────────────────
function mostrarModalCantidad(item, onAdd) {
  const m=document.createElement('div');
  m.style.cssText='position:fixed;inset:0;background:rgba(3,7,18,.75);backdrop-filter:blur(4px);-webkit-backdrop-filter:blur(4px);display:flex;align-items:flex-end;justify-content:center;z-index:600;';
  m.innerHTML=`<div style="background:#161f2e;width:100%;max-width:520px;border-radius:24px 24px 0 0;padding:8px 22px max(34px,22px);border-top:1px solid rgba(255,255,255,.08);box-shadow:0 -8px 40px rgba(0,0,0,.5)">
    <div style="width:40px;height:4px;background:rgba(255,255,255,.18);border-radius:2px;margin:0 auto 20px"></div>
    <div style="font-size:17px;font-weight:800;margin-bottom:4px">${tc(item.name)}</div>
    <div style="font-size:12px;color:var(--text-4);margin-bottom:24px">${item.stock} ${item.unit} disponibles en bodega</div>
    <div style="display:flex;align-items:center;justify-content:space-between;gap:18px;margin-bottom:24px">
      <button id="mc-dec" style="width:60px;height:60px;border-radius:16px;border:1px solid var(--border);background:var(--glass);color:var(--text);font-size:28px;font-weight:700;cursor:pointer;flex-shrink:0">−</button>
      <div style="flex:1;text-align:center">
        <input id="mc-cant" type="number" min="1" max="${item.stock}" value="1" style="width:100%;text-align:center;font-size:44px;font-weight:900;color:var(--bod-light);background:transparent;border:none;outline:none;font-family:'Outfit',sans-serif"/>
        <div style="font-size:12px;color:var(--text-4);margin-top:-4px">${item.unit}</div>
      </div>
      <button id="mc-inc" style="width:60px;height:60px;border-radius:16px;border:1px solid var(--bod-border);background:var(--bod-glass);color:var(--bod-light);font-size:28px;font-weight:700;cursor:pointer;flex-shrink:0">+</button>
    </div>
    <div id="mc-err" class="form-error" style="margin-bottom:10px"></div>
    <div style="display:flex;gap:10px">
      <button id="mc-cancel" style="flex:1;height:50px;border-radius:14px;border:1px solid var(--border);background:transparent;color:var(--text-3);font-size:14px;font-weight:600;cursor:pointer;font-family:'Outfit',sans-serif">Cancelar</button>
      <button class="btn-primary bod" id="mc-add" style="flex:2;height:50px">Agregar</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  const cantEl=m.querySelector('#mc-cant');
  setTimeout(()=>{cantEl.focus();cantEl.select();},80);
  m.addEventListener('click',e=>{if(e.target===m)m.remove();});
  m.querySelector('#mc-cancel').onclick=()=>m.remove();
  m.querySelector('#mc-dec').onclick=()=>{const v=safeNum(cantEl.value);if(v>1)cantEl.value=v-1;};
  m.querySelector('#mc-inc').onclick=()=>{const v=safeNum(cantEl.value);if(v<item.stock)cantEl.value=v+1;};
  m.querySelector('#mc-add').addEventListener('click',()=>{
    const cant=safeNum(cantEl.value);
    const errEl=m.querySelector('#mc-err');
    if(cant<=0){errEl.textContent='Cantidad inválida.';errEl.style.display='block';return;}
    if(cant>item.stock){errEl.textContent=`Solo hay ${item.stock} ${item.unit} en bodega.`;errEl.style.display='block';return;}
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
