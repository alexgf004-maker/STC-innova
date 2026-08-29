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
      ${tabs.map(t=>{
        // Globo rojo en la pestaña Solicitudes con las pendientes de esta campaña
        let badge='';
        if(t.id==='solicitudes'){
          const n=solicitudes_.filter(s=>(s.area||'CAMBIOS')===areaFiltro_ && (s.estado||'pendiente')==='pendiente').length;
          if(n>0) badge=`<span class="bod-tab-badge" style="margin-left:6px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#ef4444;color:#fff;font-size:10px;font-weight:800;line-height:18px;display:inline-block;text-align:center;vertical-align:middle">${n>99?'99+':n}</span>`;
        }
        return `<div class="cambios-tab bod ${t.id===activeTab_?'active':''}" data-tab="${t.id}">${t.label}${badge}</div>`;
      }).join('')}
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
    actualizarBadgeSolicitudes();
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
  actualizarBadgeSolicitudes();
}

// Repinta el globo de la pestaña Solicitudes con las pendientes de la campaña activa
function actualizarBadgeSolicitudes(){
  const tab = container_?.querySelector('.cambios-tab.bod[data-tab="solicitudes"]');
  if(!tab) return;
  const n = solicitudes_.filter(s=>(s.area||'CAMBIOS')===areaFiltro_ && (s.estado||'pendiente')==='pendiente').length;
  let badge = tab.querySelector('.bod-tab-badge');
  if(n>0){
    if(!badge){
      badge=document.createElement('span');
      badge.className='bod-tab-badge';
      badge.style.cssText='margin-left:6px;min-width:18px;height:18px;padding:0 5px;border-radius:9px;background:#ef4444;color:#fff;font-size:10px;font-weight:800;line-height:18px;display:inline-block;text-align:center;vertical-align:middle';
      tab.appendChild(badge);
    }
    badge.textContent = n>99?'99+':n;
  } else if(badge){
    badge.remove();
  }
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
      sheet.remove(); renderSolicitudes(); actualizarBadgeSolicitudes();
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
      const item=allItems_.find(i=>i.id
