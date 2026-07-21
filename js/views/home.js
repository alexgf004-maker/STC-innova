/**
 * js/views/home.js
 * Vista home — renderiza según rol del usuario.
 * Exporta: init(container, session)
 */

import { db } from '../firebase.js';
import { leerStats, recalcularStats } from '../stats.js';
import { setupRefreshBtn, toast } from '../ui.js';

const META_DIARIA = 15;

export async function init(container, session) {
  const { role, asignacionActual } = session;
  const area    = asignacionActual?.area    || null;
  const destino = asignacionActual?.destino || null;

  if (role === 'tecnico') {
    __containerTec = container;
    if (!area) { renderNoAsignacion(container, session); }
    else { renderHomeTecnico(container, session, area, destino); cargarDatosTecnico(session, area, destino); }
    cargarDespachosPendientesTecnico(session);
    return;
  }
  if (role === 'admin')     {
    renderHomeAdmin(container, session);
    cargarDatosAdmin(session);
    cargarPersonalHoy();
    setupRefreshBtn(async () => {
      await recalcularStats();
      await cargarDatosAdmin(session);
      await cargarPersonalHoy();
    });
    return;
  }
  if (role === 'asistente') {
    renderHomeAsistente(container, session);
    cargarDatosAsistente(session);
    cargarPersonalHoy();
    setupRefreshBtn(async () => {
      await recalcularStats();
      await cargarDatosAsistente(session);
      await cargarPersonalHoy();
    });
    return;
  }

  container.innerHTML = `<p style="color:var(--text-3);padding:24px">Rol no reconocido.</p>`;
}

// ── Despachos pendientes de aceptación (técnico) ──
let __pendientesTec = [];
let __containerTec = null;
let __unsubPendientes = null;   // cierra el listener al salir del home

// Escucha en TIEMPO REAL los despachos pendientes de este técnico.
// Así, cuando la asistente envía el despacho, la tarjeta aparece sola
// en el teléfono del técnico sin que él recargue nada.
function cargarDespachosPendientesTecnico(session) {
  // Cerrar un listener anterior si lo hubiera (evita duplicados y lecturas de más)
  if (__unsubPendientes) { try { __unsubPendientes(); } catch {} __unsubPendientes = null; }

  try {
    __unsubPendientes = db.collection('despachos_pendientes')
      .where('tecnicoRecibeUid', '==', session.uid)
      .onSnapshot(
        (snap) => {
          const antes = __pendientesTec.length;
          __pendientesTec = snap.docs.map(d=>({id:d.id,...d.data()}))
            .sort((a,b)=>(b.fecha?.seconds||0)-(a.fecha?.seconds||0));

          // Si llegó uno nuevo estando la app abierta, avisar
          if (__pendientesTec.length > antes && antes >= 0 && !snap.metadata.hasPendingWrites) {
            try { navigator.vibrate?.(200); } catch {}
          }

          if (__pendientesTec.length) intentarPintarPendientes(0);
          else document.getElementById('despachos-pend-tec')?.remove();
        },
        (err) => {
          console.warn('[home] Listener de despachos pendientes falló:', err);
        }
      );
  } catch(e) {
    console.warn('[home] No se pudieron cargar despachos pendientes:', e);
  }
}

// El router llama a esto al salir de la vista
export function cleanup() {
  if (__unsubPendientes) { try { __unsubPendientes(); } catch {} __unsubPendientes = null; }
}

function intentarPintarPendientes(intento){
  if (!__pendientesTec.length) return;
  // Buscar el contenedor donde pintar: el primer .flex-col dentro del container del técnico
  let cont = null;
  if (__containerTec) {
    cont = __containerTec.querySelector('.flex-col') || __containerTec;
  }
  if (!cont) {
    if (intento < 20) return setTimeout(()=>intentarPintarPendientes(intento+1), 100);
    return;
  }
  renderDespachosPendientesTecnico(cont);
}

const CAMP_LABEL_HOME = { CAMBIOS:'Cambio de Medidores', AMI:'AMI', Caracterizacion:'Caracterización', ReclamosSIGET:'Reclamos SIGET' };
const CAMP_COLOR_HOME = { CAMBIOS:'#2dd4bf', AMI:'#fbbf24', Caracterizacion:'#a78bfa', ReclamosSIGET:'#f472b6' };

function renderDespachosPendientesTecnico(cont) {
  document.getElementById('despachos-pend-tec')?.remove();
  const pendientes = __pendientesTec;
  if (!pendientes.length) return;

  const wrap = document.createElement('div');
  wrap.id = 'despachos-pend-tec';
  wrap.style.cssText = 'margin-bottom:12px';

  wrap.innerHTML = `
    <div class="flex-col gap-10">
      ${pendientes.map(p=>{
        const col = CAMP_COLOR_HOME[p.area] || '#fbbf24';
        const lbl = CAMP_LABEL_HOME[p.area] || p.area;
        const totalItems = (p.items||[]).reduce((a,i)=>a+(Number(i.cantidad)||0),0);
        return `
        <div style="background:linear-gradient(160deg,${col}18,var(--glass));border:1px solid ${col}55;border-radius:16px;padding:16px;position:relative;overflow:hidden">
          <div style="position:absolute;top:0;left:0;width:100%;height:3px;background:${col}"></div>
          <div style="display:flex;align-items:center;gap:8px;margin-bottom:10px">
            <div style="width:32px;height:32px;border-radius:9px;background:${col}22;display:flex;align-items:center;justify-content:center">
              <svg viewBox="0 0 24 24" fill="none" stroke="${col}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
            </div>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:800">Material por recibir</div>
              <div style="font-size:11px;color:var(--text-4)">${lbl} · te lo entrega ${p.entregadoPor||'bodega'}</div>
            </div>
            <div style="font-size:10px;font-weight:700;color:${col};background:${col}1a;border:1px solid ${col}44;padding:3px 10px;border-radius:20px">${totalItems} items</div>
          </div>
          <div class="flex-col gap-4" style="margin-bottom:12px">
            ${(p.items||[]).map(m=>{
              const series = m.requiereSerial
                ? (m.modoSerial==='rango' && m.serialInicio
                    ? `<div style="font-size:10px;color:var(--text-4);font-family:monospace;margin-top:2px">Serie ${m.serialInicio} a ${m.serialFin}</div>`
                    : (m.seriales&&m.seriales.length ? `<div style="font-size:10px;color:var(--text-4);font-family:monospace;margin-top:2px">${m.seriales.join(', ')}</div>` : ''))
                : '';
              return `<div style="padding:7px 0;border-top:1px solid var(--border)">
                <div style="display:flex;justify-content:space-between;font-size:12px">
                  <span style="color:var(--text-2)">${(m.nombre||m.name||'—')}</span>
                  <span style="font-weight:700">${m.cantidad} ${m.unit||''}</span>
                </div>${series}
              </div>`;
            }).join('')}
          </div>
          <div style="display:flex;gap:8px">
            <button style="flex:1;height:44px;border-radius:12px;border:1px solid var(--border);background:transparent;color:#ef4444;font-size:13px;font-weight:700;cursor:pointer;font-family:'Outfit',sans-serif" onclick="window.__despachoPend_rechazar('${p.id}')">Rechazar</button>
            <button style="flex:2;height:44px;border-radius:12px;border:none;background:${col};color:#0a1628;font-size:13px;font-weight:800;cursor:pointer;font-family:'Outfit',sans-serif" onclick="window.__despachoPend_aceptar('${p.id}')">Aceptar material</button>
          </div>
        </div>`;
      }).join('')}
    </div>`;

  cont.insertBefore(wrap, cont.firstChild);

  window.__despachoPend_aceptar = (id)=>aceptarDespachoPendiente(id);
  window.__despachoPend_rechazar = (id)=>rechazarDespachoPendiente(id);
}

// Expande series de un item pendiente (rango o lista)
function __expandirSeriesPend(m){
  if (m.modoSerial==='rango' && m.serialInicio){
    const nI=parseInt(String(m.serialInicio).replace(/\D/g,''),10);
    const nF=parseInt(String(m.serialFin).replace(/\D/g,''),10);
    if(isNaN(nI)||isNaN(nF)||nF<nI||(nF-nI)>1000) return [];
    const prefix=String(m.serialInicio).replace(/\d+$/,'');
    const digits=String(nF).length;
    const out=[];
    for(let n=nI;n<=nF;n++) out.push(prefix+String(n).padStart(digits,'0'));
    return out;
  }
  return (m.seriales||[]).map(s=>String(s).trim()).filter(Boolean);
}

async function aceptarDespachoPendiente(id){
  const p = __pendientesTec.find(x=>x.id===id);
  if(!p) return;
  const btn = document.querySelector(`#despachos-pend-tec button[onclick*="${id}"]`);
  if(!confirm('¿Confirmas que recibiste todo este material?')) return;

  // Bloquear botones mientras procesa
  document.querySelectorAll('#despachos-pend-tec button').forEach(b=>b.disabled=true);

  try{
    const session = JSON.parse(localStorage.getItem('innova_session') || '{}');
    const now = firebase.firestore.FieldValue.serverTimestamp();

    // Resolver quién acepta. Si la sesión guardada viene incompleta,
    // lo sacamos de Firebase Auth / Firestore para no guardar undefined.
    let uidTec    = session.uid || firebase.auth().currentUser?.uid || p.tecnicoRecibeUid || null;
    let nombreTec = session.displayName || '';
    if (!nombreTec && uidTec) {
      try {
        const uDoc = await db.collection('users').doc(uidTec).get();
        nombreTec = uDoc.data()?.displayName || '';
      } catch {}
    }
    if (!nombreTec) nombreTec = p.usuarioResponsable || 'Técnico';

    // 1. Crear la salida definitiva con constancia de aceptación
    const salidaData = {
      area: p.area || '',
      usuarioResponsable: p.usuarioResponsable || nombreTec,
      tecnicoRecibeUid: p.tecnicoRecibeUid || uidTec || null,
      parejaAcompanante: p.parejaAcompanante||'',
      parejaUid: p.parejaUid||null,
      usuarioRespAsignado: p.usuarioRespAsignado||'',
      empresaContratista: p.empresaContratista||'INNOVA',
      placaVehiculo: p.placaVehiculo||'',
      fechaEntrega: p.fechaEntrega||'',
      entregadoPor: p.entregadoPor||'',
      entregadoPorUid: p.entregadoPorUid||null,
      solicitudId: p.solicitudId||null,
      items: p.items||[],
      // Constancia de aceptación
      aceptadoPorTecnico: nombreTec,
      aceptadoPorUid: uidTec,
      fechaAceptacion: now,
      origenPendiente: id,
      fecha: now,
    };

    // Red de seguridad: Firestore rechaza cualquier campo undefined
    Object.keys(salidaData).forEach(k=>{ if(salidaData[k]===undefined) salidaData[k]=null; });

    const ref = await db.collection('kardex').doc('movimientos').collection('salidas').add(salidaData);

    // 2. Descontar stock
    const batch = db.batch();
    for(const m of (p.items||[])){
      batch.update(db.collection('kardex').doc('inventario').collection('items').doc(m.itemId),
        {stock: firebase.firestore.FieldValue.increment(-(Number(m.cantidad)||0))});
    }
    await batch.commit();

    // 3. Marcar series como despachadas
    for(const m of (p.items||[])){
      if(!m.requiereSerial) continue;
      const lista = __expandirSeriesPend(m);
      if(!lista.length) continue;
      try{
        const snapSer = await db.collection('kardex').doc('seriales').collection('items')
          .where('itemId','==',m.itemId).where('estado','==','disponible').get();
        const serSet = new Set(lista);
        const updates = snapSer.docs.filter(d=>serSet.has(String(d.data().serial).trim()))
          .map(d=>d.ref.update({estado:'despachado',salidaId:ref.id,fechaSalida:now,usuarioDespacho:p.usuarioResponsable||nombreTec||''}));
        await Promise.all(updates);
      }catch(e){ console.warn('[home] Error marcando series:',e); }
    }

    // 4. Marcar solicitud como aprobada (si venía de una)
    if(p.solicitudId){
      try{ await db.collection('solicitudes_material').doc(p.solicitudId)
        .update({estado:'aprobado',salidaId:ref.id}); }catch(e){}
    }

    // 5. Borrar el pendiente
    await db.collection('despachos_pendientes').doc(id).delete();

    // 6. Actualizar UI
    __pendientesTec = __pendientesTec.filter(x=>x.id!==id);
    const card = document.querySelector(`#despachos-pend-tec button[onclick*="${id}"]`)?.closest('div[style*="border-radius:16px"]');
    if(card) card.remove();
    if(!__pendientesTec.length) document.getElementById('despachos-pend-tec')?.remove();

    alert('Material aceptado correctamente. Queda registrado en tu historial.');
  }catch(err){
    console.error('[home] Error al aceptar despacho:',err);
    alert('Error al aceptar: '+err.message);
    document.querySelectorAll('#despachos-pend-tec button').forEach(b=>b.disabled=false);
  }
}

async function rechazarDespachoPendiente(id){
  const p = __pendientesTec.find(x=>x.id===id);
  if(!p) return;
  if(!confirm('¿Rechazar este material? Se le notificará a quien te lo entrega para corregir.')) return;
  document.querySelectorAll('#despachos-pend-tec button').forEach(b=>b.disabled=true);
  try{
    await db.collection('despachos_pendientes').doc(id).delete();
    __pendientesTec = __pendientesTec.filter(x=>x.id!==id);
    const card = document.querySelector(`#despachos-pend-tec button[onclick*="${id}"]`)?.closest('div[style*="border-radius:16px"]');
    if(card) card.remove();
    if(!__pendientesTec.length) document.getElementById('despachos-pend-tec')?.remove();
    alert('Material rechazado. El despacho fue devuelto.');
  }catch(err){
    console.error('[home] Error al rechazar:',err);
    alert('Error al rechazar: '+err.message);
    document.querySelectorAll('#despachos-pend-tec button').forEach(b=>b.disabled=false);
  }
}

// ── Carga de datos técnico ────────────────────────
async function cargarDatosTecnico(session, area, destino) {
  try {
    // Compañeros
    let companeros = [];
    if (destino) {
      const snap = await db.collection('users')
        .where('asignacionActual.destino', '==', destino)
        .where('active', '==', true).get();
      companeros = snap.docs.map(d => d.data().displayName).filter(n => n !== session.displayName);
    }

    // Órdenes de la pareja
    const col = area === 'CAMBIOS' ? 'cambios_ordenes' : 'otc_ordenes';
    const campo = area === 'CAMBIOS' ? 'pareja' : 'tecnicoDestino';
    const snap = await db.collection(col).where(campo, '==', destino).get();
    const ordenes = snap.docs.map(d => ({ id: d.id, ...d.data() }));

    const total      = ordenes.length;
    const aprobadas  = ordenes.filter(o => o.estadoCampo === 'aprobada').length;
    const pendientes = ordenes.filter(o => !o.estadoCampo).length;
    const pct        = total ? Math.round((aprobadas / total) * 100) : 0;

    // Actualizar chips
    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setVal('stat-pendientes', pendientes);
    setVal('stat-hechas',     aprobadas);
    setVal('stat-total',      total);

    // Actualizar barra de progreso total
    const bar = document.getElementById('prog-total-bar');
    const pctEl = document.getElementById('prog-total-pct');
    const subEl = document.getElementById('prog-total-sub');
    if (bar)   bar.style.width   = pct + '%';
    if (pctEl) pctEl.textContent = pct + '%';
    if (subEl) subEl.textContent = `${aprobadas} de ${total} órdenes confirmadas`;

    // Actualizar compañeros
    const compRow = document.getElementById('companeros-row');
    if (compRow && destino) {
      compRow.innerHTML = `
        <div class="companero-chip self">${destino}</div>
        ${companeros.length
          ? companeros.map(c => `<div class="companero-chip">${c}</div>`).join('')
          : '<div class="companero-chip muted">Sin compañero asignado hoy</div>'}
      `;
    }
  } catch(err) {
    console.warn('[home] Error cargando datos técnico:', err);
  }
}

// ── Carga datos admin ─────────────────────────────
async function cargarDatosAdmin(session) {
  try {
    let stats = await leerStats();
    // Si no existe el documento aún, lo calculamos una vez
    if (!stats) stats = await recalcularStats();
    if (!stats) return;

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setVal('m-stat-cm',    stats.cmHechasHoy       ?? '—');
    setVal('m-stat-otc',   stats.otcActivas        ?? '—');
    setVal('m-stat-alert', stats.solicitudesPendientes ?? '—');

    renderIndicadorCorte(stats.cmSinActualizar ?? 0);
  } catch(err) {
    console.warn('[home] Error cargando datos admin:', err);
    renderIndicadorCorte(0);
  }
}

// ── Carga datos asistente ─────────────────────────
async function cargarDatosAsistente(session) {
  try {
    let stats = await leerStats();
    if (!stats) stats = await recalcularStats();
    if (!stats) return;

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setVal('a-stat-cm',  stats.cmHechasHoy       ?? '—');
    setVal('a-stat-otc', stats.otcActivas        ?? '—');
    setVal('a-stat-sol', stats.solicitudesPendientes ?? '—');

    renderIndicadorCorte(stats.cmSinActualizar ?? 0);
  } catch(err) {
    console.warn('[home] Error cargando datos asistente:', err);
    renderIndicadorCorte(0);
  }
}

// ── Indicador corte del 15 ────────────────────────
function renderIndicadorCorte(sinActualizar) {
  const el = document.getElementById('indicador-corte');
  if (!el) return;

  const hoy  = new Date();
  const dia  = hoy.getDate();
  const mes  = hoy.getMonth();
  const anio = hoy.getFullYear();

  const corte = dia <= 15
    ? new Date(anio, mes, 15)
    : new Date(anio, mes + 1, 15);

  const diasFaltan = Math.ceil((corte - hoy) / (1000 * 60 * 60 * 24));

  let color, bg, border, label;
  if (diasFaltan >= 11) {
    color = 'var(--ok)'; bg = 'rgba(34,197,94,.06)'; border = 'rgba(34,197,94,.15)'; label = 'Al día';
  } else if (diasFaltan >= 4) {
    color = '#fbbf24'; bg = 'rgba(245,158,11,.06)'; border = 'rgba(245,158,11,.2)'; label = 'Atención';
  } else {
    color = '#ef4444'; bg = 'rgba(239,68,68,.06)'; border = 'rgba(239,68,68,.2)'; label = diasFaltan === 0 ? '¡Hoy es el corte!' : 'Urgente';
  }

  const corteStr = corte.toLocaleDateString('es-SV', { day:'numeric', month:'long' });

  el.innerHTML = `
    <div style="background:${bg};border:1px solid ${border};border-radius:var(--radius);padding:14px 16px">
      <div style="display:flex;align-items:center;justify-content:space-between;margin-bottom:8px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-4)">Corte del 15 · ${corteStr}</div>
        <div style="font-size:10px;font-weight:700;color:${color};background:${bg};border:1px solid ${border};border-radius:8px;padding:3px 8px">${label}</div>
      </div>
      <div style="display:flex;align-items:baseline;gap:6px">
        <div style="font-size:28px;font-weight:800;color:${color};letter-spacing:-.02em">${diasFaltan}</div>
        <div style="font-size:13px;color:var(--text-3);font-weight:500">día${diasFaltan !== 1 ? 's' : ''} restantes</div>
        ${sinActualizar === null ? `<div style="margin-left:auto;font-size:11px;color:var(--text-4)">Calculando…</div>`
          : sinActualizar > 0 ? `<div style="margin-left:auto;font-size:12px;font-weight:700;color:${diasFaltan < 4 ? '#ef4444' : '#fbbf24'}">${sinActualizar} sin actualizar</div>`
          : `<div style="margin-left:auto;font-size:12px;font-weight:600;color:var(--ok)">&#10003; Todo actualizado</div>`}
      </div>
    </div>
  `;
}

// ── Home Técnico ──────────────────────────────────
function renderHomeTecnico(container, session, area, destino) {
  const isCambios   = area === 'CAMBIOS';
  const color       = isCambios ? 'cm' : 'otc';
  const accentColor = isCambios ? '#2dd4bf' : '#60a5fa';
  const rgbAccent   = isCambios ? '13,148,136' : '37,99,235';
  const areaLabel   = isCambios ? 'Cambios de Medidor' : 'Órdenes Técnicas de Campo';

  const hoy = new Date().toLocaleDateString('es-SV', { weekday:'long', day:'numeric', month:'long' });
  const fechaLabel = hoy.charAt(0).toUpperCase() + hoy.slice(1);

  container.innerHTML = `
    <div class="flex-col gap-12" style="padding-top:4px">

      <!-- Welcome card -->
      <div class="welcome-card ${color} anim-up">
        <div class="welcome-area-label">${fechaLabel}</div>
        <div class="welcome-name">${session.displayName}</div>
        <div class="welcome-role">${destino || area} · ${areaLabel}</div>
        ${destino ? `<div class="companeros-row" id="companeros-row">
          <div class="companero-chip self">${destino}</div>
          <div class="companero-chip muted">Cargando…</div>
        </div>` : ''}
      </div>

      <!-- Progreso total de la pareja -->
      <div class="progress-card ${color} anim-up d1">
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:10px">
          <div style="font-size:13px;font-weight:700">Progreso total · ${destino || ''}</div>
          <div style="font-size:22px;font-weight:800;color:var(--${color}-light)" id="prog-total-pct">—</div>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill ${color}" id="prog-total-bar" style="width:0%;transition:width .6s ease"></div>
        </div>
        <div style="font-size:11px;color:var(--text-4);margin-top:6px" id="prog-total-sub">Cargando…</div>
      </div>

      <!-- Stats -->
      <div class="stat-row anim-up d2">
        <div class="stat-chip ${color}-accent">
          <div class="val" id="stat-pendientes">—</div>
          <div class="lbl">Pendientes</div>
        </div>
        <div class="stat-chip ${color}-accent">
          <div class="val" id="stat-hechas">—</div>
          <div class="lbl">Confirmadas</div>
        </div>
        <div class="stat-chip">
          <div class="val" id="stat-total">—</div>
          <div class="lbl">Total</div>
        </div>
      </div>

      <!-- Accesos rápidos -->
      <div class="section-label anim-up d3">Accesos rápidos</div>
      <div class="quick-grid anim-up d3">
        <div class="quick-card" onclick="window.__router.navigateTo('cambios')">
          <div class="qc-icon" style="background:rgba(${rgbAccent},.15)">
            <svg viewBox="0 0 24 24" fill="none" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </div>
          <div class="qc-title">Mis órdenes</div>
          <div class="qc-sub">Ver listado del día</div>
        </div>

        <div class="quick-card" onclick="window.__router.navigateTo('mapa')">
          <div class="qc-icon" style="background:rgba(${rgbAccent},.15)">
            <svg viewBox="0 0 24 24" fill="none" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/>
              <line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>
            </svg>
          </div>
          <div class="qc-title">Mapa</div>
          <div class="qc-sub">Ver puntos del día</div>
        </div>

        <div class="quick-card" onclick="window.__router.navigateTo('bodega')">
          <div class="qc-icon" style="background:var(--purple-glass)">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--purple)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/>
              <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
              <line x1="12" y1="22.08" x2="12" y2="12"/>
            </svg>
          </div>
          <div class="qc-title">Bodega</div>
          <div class="qc-sub">Material asignado</div>
        </div>

        <div class="quick-card" onclick="window.__abrirDevolucion()">
          <div class="qc-icon" style="background:rgba(45,212,191,.15)">
            <svg viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 01-4 4H4"/>
            </svg>
          </div>
          <div class="qc-title">Devolver material</div>
          <div class="qc-sub">Reintegrar a bodega</div>
        </div>

      </div>

    </div>
  `;
}

// ── Personal asignado hoy ─────────────────────────
async function cargarPersonalHoy() {
  const el = document.getElementById('personal-hoy');
  if (!el) return;

  try {
    const snap = await db.collection('users')
      .where('active', '==', true)
      .where('role', '==', 'tecnico')
      .get();

    const tecnicos = snap.docs.map(d => d.data()).filter(u => u.asignacionActual?.destino);

    // Agrupar por destino (pareja)
    const grupos = {};
    tecnicos.forEach(u => {
      const pareja = u.asignacionActual.destino;
      if (!grupos[pareja]) grupos[pareja] = [];
      grupos[pareja].push(u.displayName);
    });

    const sinAsignar = snap.docs.map(d => d.data())
      .filter(u => u.role === 'tecnico' && u.active && !u.asignacionActual?.destino);

    const parejas = Object.keys(grupos).sort();

    if (!parejas.length && !sinAsignar.length) {
      el.innerHTML = '';
      return;
    }

    el.innerHTML = `
      <div style="background:var(--glass);border:1px solid var(--border);border-radius:var(--radius);padding:14px 16px">
        <div style="font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.06em;color:var(--text-4);margin-bottom:10px">Personal activo hoy</div>
        <div class="flex-col gap-8">
          ${parejas.map(pareja => `
            <div style="display:flex;align-items:center;gap:10px">
              <div style="font-size:12px;font-weight:700;color:var(--cm-light);min-width:80px;flex-shrink:0">${pareja}</div>
              <div style="display:flex;flex-wrap:wrap;gap:6px">
                ${grupos[pareja].map(nombre => `
                  <div style="font-size:11px;font-weight:500;background:rgba(45,212,191,.08);border:1px solid rgba(45,212,191,.2);border-radius:8px;padding:3px 10px;color:var(--text-2)">${nombre}</div>
                `).join('')}
              </div>
            </div>
          `).join('')}
          ${sinAsignar.length ? `
          <div style="display:flex;align-items:center;gap:10px">
            <div style="font-size:12px;font-weight:700;color:var(--text-4);min-width:80px;flex-shrink:0">Sin asignar</div>
            <div style="display:flex;flex-wrap:wrap;gap:6px">
              ${sinAsignar.map(u => `
                <div style="font-size:11px;font-weight:500;background:var(--glass);border:1px solid var(--border);border-radius:8px;padding:3px 10px;color:var(--text-4)">${u.displayName}</div>
              `).join('')}
            </div>
          </div>` : ''}
        </div>
      </div>
    `;
  } catch(err) {
    console.warn('[home] Error cargando personal:', err);
  }
}
function renderNoAsignacion(container, session) {
  container.innerHTML = `
    <div class="no-assign anim-up">
      <div class="no-assign-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </div>
      <h3>Sin asignación hoy</h3>
      <p>No tienes área asignada para el día de hoy. Contacta a tu asistente.</p>
      <div class="no-assign-badge">${session.displayName}</div>
    </div>

    <div class="flex-col gap-10 anim-up d1" style="margin-top:24px">
      <div class="section-label" style="text-align:center;margin-bottom:2px">Material de bodega</div>
      <div class="quick-card" onclick="window.__router.navigateTo('bodega')" style="cursor:pointer">
        <div class="qc-icon" style="background:var(--purple-glass)">
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--purple)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
        </div>
        <div class="qc-title" style="color:var(--purple)">Solicitar material</div>
        <div class="qc-sub">Pide material, revisa tu stock y pedidos</div>
      </div>
      <div class="quick-card" onclick="window.__abrirDevolucion()" style="cursor:pointer">
        <div class="qc-icon" style="background:rgba(45,212,191,.15)">
          <svg viewBox="0 0 24 24" fill="none" stroke="#2dd4bf" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="9 10 4 15 9 20"/><path d="M20 4v7a4 4 0 01-4 4H4"/></svg>
        </div>
        <div class="qc-title" style="color:#2dd4bf">Devolver material</div>
        <div class="qc-sub">Reintegrar material a bodega</div>
      </div>
    </div>
  `;
}

// ── Home Admin ────────────────────────────────────
function renderHomeAdmin(container, session) {
  const hoy = new Date().toLocaleDateString('es-SV', { weekday:'long', day:'numeric', month:'long' });
  container.innerHTML = `
    <div class="flex-col gap-12" style="padding-top:4px">
      <div class="welcome-card office anim-up">
        <div class="welcome-area-label">${hoy.charAt(0).toUpperCase()+hoy.slice(1)}</div>
        <div class="welcome-name">${session.displayName}</div>
        <div class="welcome-role">Administrador · INNOVA STC</div>
      </div>
      <div class="stat-row anim-up d1">
        <div class="stat-chip cm-accent"><div class="val" id="m-stat-cm">—</div><div class="lbl">CM hoy</div></div>
        <div class="stat-chip warn-accent"><div class="val" id="m-stat-alert">—</div><div class="lbl">Solicitudes</div></div>
      </div>

      <!-- Aviso de solicitudes de material -->
      <div id="aviso-solicitudes"></div>

      <!-- Indicador corte del 15 -->
      <div id="indicador-corte" class="anim-up d2"></div>

      <!-- Personal asignado hoy -->
      <div id="personal-hoy" class="anim-up d3"></div>

      <div class="quick-grid anim-up d2">
        <div class="quick-card cm" onclick="window.__router.navigateTo('cambios')">
          <div class="qc-icon" style="background:rgba(13,148,136,.15)">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--cm-light)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
          </div>
          <div class="qc-title" style="color:var(--cm-light)">Cambios</div>
          <div class="qc-sub">Panel de seguimiento</div>
        </div>
        <div class="quick-card" onclick="window.__router.navigateTo('bodega')">
          <div class="qc-icon" style="background:var(--purple-glass)">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--purple)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          </div>
          <div class="qc-title">Bodega</div>
          <div class="qc-sub">Inventario y despachos</div>
        </div>
        <div class="quick-card" onclick="window.__router.navigateTo('usuarios')">
          <div class="qc-icon" style="background:var(--glass)">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
          </div>
          <div class="qc-title">Usuarios</div>
          <div class="qc-sub">Gestión y asignación</div>
        </div>
      </div>
    </div>
  `;
  // Mostrar indicador de inmediato sin esperar Firestore
  renderIndicadorCorte(null);
  cargarPersonalHoy();
  pintarAvisoSolicitudes();
}

// ── Home Asistente ────────────────────────────────
function renderHomeAsistente(container, session) {
  const hoy = new Date().toLocaleDateString('es-SV', { weekday:'long', day:'numeric', month:'long' });
  container.innerHTML = `
    <div class="flex-col gap-12" style="padding-top:4px">
      <div class="welcome-card office anim-up">
        <div class="welcome-area-label">${hoy.charAt(0).toUpperCase()+hoy.slice(1)}</div>
        <div class="welcome-name">${session.displayName}</div>
        <div class="welcome-role">Asistente · Operación diaria</div>
      </div>
      <div class="stat-row anim-up d1">
        <div class="stat-chip cm-accent"><div class="val" id="a-stat-cm">—</div><div class="lbl">CM hoy</div></div>
        <div class="stat-chip" style="border-color:var(--purple-border);background:var(--purple-glass)"><div class="val" style="color:var(--purple)" id="a-stat-sol">—</div><div class="lbl">Solicitudes</div></div>
      </div>

      <!-- Aviso de solicitudes de material -->
      <div id="aviso-solicitudes"></div>

      <!-- Indicador corte del 15 -->
      <div id="indicador-corte" class="anim-up d2"></div>

      <!-- Personal asignado hoy -->
      <div id="personal-hoy" class="anim-up d3"></div>

      <div class="quick-grid anim-up d3">
        <div class="quick-card cm" onclick="window.__router.navigateTo('cambios')">
          <div class="qc-icon" style="background:rgba(13,148,136,.15)">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--cm-light)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>
          </div>
          <div class="qc-title" style="color:var(--cm-light)">Panel Cambios</div>
          <div class="qc-sub">Confirmar · Asignar</div>
        </div>
        <div class="quick-card" onclick="window.__router.navigateTo('bodega')">
          <div class="qc-icon" style="background:var(--purple-glass)">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--purple)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>
          </div>
          <div class="qc-title">Bodega</div>
          <div class="qc-sub">Aprobar solicitudes</div>
        </div>
        <div class="quick-card" onclick="window.__router.navigateTo('usuarios')">
          <div class="qc-icon" style="background:var(--glass)">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>
          </div>
          <div class="qc-title">Usuarios</div>
          <div class="qc-sub">Asignar área del día</div>
        </div>
      </div>
    </div>
  `;
  renderIndicadorCorte(null);
  cargarPersonalHoy();
  pintarAvisoSolicitudes();
}

// ══════════════════════════════════════════════════════════════
//  DEVOLUCIÓN DE MATERIAL (lado técnico)
//  El técnico declara qué devuelve; queda PENDIENTE hasta que la
//  asistente lo apruebe. No suma a bodega aquí.
// ══════════════════════════════════════════════════════════════

const CAMP_DEVOL = {
  CAMBIOS:       { label:'Cambio de Medidores', color:'#2dd4bf' },
  AMI:           { label:'AMI',                 color:'#fbbf24' },
  Caracterizacion:{ label:'Caracterización',    color:'#a78bfa' },
  ReclamosSIGET: { label:'Reclamos SIGET',      color:'#f472b6' },
};

// Series consecutivas por rango
function _devExpandirRango(ini, fin){
  const a=String(ini||'').trim(), b=String(fin||'').trim();
  if(!a||!b) return [];
  const na=parseInt(a.replace(/\D/g,''),10), nb=parseInt(b.replace(/\D/g,''),10);
  if(isNaN(na)||isNaN(nb)||nb<na||nb-na>5000) return [];
  const pref=a.replace(/\d+$/,''), dig=a.replace(/\D/g,'').length;
  const out=[]; for(let n=na;n<=nb;n++) out.push(pref+String(n).padStart(dig,'0'));
  return out;
}
// Caja: desde + cantidad, quitando faltantes (seriales completos)
function _devExpandirCaja(desde, cant, faltan){
  const ini=String(desde||'').trim(), c=parseInt(cant,10);
  if(!ini||!c||c<=0||c>1000) return {error:'Revisa los datos de la caja.'};
  const nIni=parseInt(ini.replace(/\D/g,''),10);
  if(isNaN(nIni)) return {error:'El primer serial debe tener números.'};
  const pref=ini.replace(/\d+$/,''), dig=ini.replace(/\D/g,'').length;
  const todos=[]; for(let k=0;k<c;k++) todos.push(pref+String(nIni+k).padStart(dig,'0'));
  const setT=new Set(todos), falt=[], noEnc=[];
  String(faltan||'').split(/[\s,;]+/).map(t=>t.trim()).filter(Boolean).forEach(t=>{
    const limpio=t.replace(/\D/g,''); if(!limpio) return;
    let s=null;
    if(setT.has(t)) s=t;
    else if(setT.has(pref+limpio)) s=pref+limpio;
    else { const nT=parseInt(limpio,10); const cand=todos.find(x=>parseInt(x.replace(/\D/g,''),10)===nT); if(cand) s=cand; }
    if(s) falt.push(s); else noEnc.push(t);
  });
  if(noEnc.length) return {error:`No caen en la caja: ${noEnc.join(', ')}`};
  const setF=new Set(falt);
  return {seriales:todos.filter(x=>!setF.has(x)), faltantes:falt};
}

window.__abrirDevolucion = async function(){
  const session = JSON.parse(localStorage.getItem('innova_session') || '{}');

  const ov = document.createElement('div');
  ov.style.cssText='position:fixed;inset:0;z-index:800;background:#0d1117;overflow-y:auto;-webkit-overflow-scrolling:touch;';
  ov.innerHTML = `
    <div style="max-width:520px;margin:0 auto;min-height:100vh;display:flex;flex-direction:column">
      <div style="padding:14px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;position:sticky;top:0;background:#0d1117;z-index:10">
        <button class="icon-btn" id="dev-back"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg></button>
        <div style="flex:1">
          <div class="section-title">Devolver material</div>
          <div style="font-size:11px;color:var(--text-4)">Reintegrar material a bodega</div>
        </div>
      </div>
      <div style="padding:16px 20px;flex:1" id="dev-body">
        <div class="form-label" style="margin-bottom:8px">¿De qué campaña es el material?</div>
        <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px" id="dev-camp"></div>
        <div id="dev-lista" style="margin-top:16px"></div>
      </div>
      <div style="padding:14px 20px;border-top:1px solid var(--border);background:#0d1117;position:sticky;bottom:0" id="dev-footer" style="display:none">
        <div id="dev-err" class="form-error" style="margin-bottom:8px"></div>
        <button class="btn-primary full" id="dev-enviar" style="display:none"><span id="dev-enviar-lbl">Enviar devolución</span></button>
      </div>
    </div>`;
  document.body.appendChild(ov);
  ov.querySelector('#dev-back').onclick=()=>ov.remove();

  // Estado
  let campana=null, materiales=[], seleccion={};  // itemId -> {item, cantidad, seriales}

  // Pintar chips de campaña
  const campWrap=ov.querySelector('#dev-camp');
  campWrap.innerHTML=Object.entries(CAMP_DEVOL).map(([k,v])=>`
    <div class="dev-camp-chip" data-camp="${k}" style="cursor:pointer;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--glass);text-align:center;font-size:13px;font-weight:700;color:${v.color}">${v.label}</div>
  `).join('');
  campWrap.querySelectorAll('.dev-camp-chip').forEach(chip=>{
    chip.onclick=()=>{
      campWrap.querySelectorAll('.dev-camp-chip').forEach(c=>{c.style.borderColor='var(--border)';c.style.background='var(--glass)';});
      const col=CAMP_DEVOL[chip.dataset.camp].color;
      chip.style.borderColor=col; chip.style.background=col+'22';
      campana=chip.dataset.camp; seleccion={};
      cargarMateriales();
    };
  });

  async function cargarMateriales(){
    const lista=ov.querySelector('#dev-lista');
    lista.innerHTML=`<div style="text-align:center;padding:20px;color:var(--text-4);font-size:12px">Cargando materiales…</div>`;
    try{
      const snap=await db.collection('kardex').doc('inventario').collection('items').where('area','==',campana).get();
      materiales=snap.docs.map(d=>({id:d.id,...d.data()})).sort((a,b)=>String(a.name||'').localeCompare(String(b.name||'')));
      if(!materiales.length){ lista.innerHTML=`<div style="text-align:center;padding:20px;color:var(--text-4);font-size:12px">No hay materiales en esta campaña.</div>`; return; }
      pintarLista('');
    }catch(e){
      lista.innerHTML=`<div style="text-align:center;padding:20px;color:#ef4444;font-size:12px">Error cargando: ${e.message}</div>`;
    }
  }

  function pintarLista(filtro){
    const lista=ov.querySelector('#dev-lista');
    const f=(filtro||'').toLowerCase();
    const items=materiales.filter(m=>String(m.name||'').toLowerCase().includes(f));
    lista.innerHTML=`
      <div class="buscar-wrap" style="margin-bottom:12px">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" width="14" height="14" style="color:var(--text-4);flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="buscar-input" id="dev-buscar" placeholder="Buscar material…" autocomplete="off" value="${filtro||''}"/>
      </div>
      <div class="flex-col gap-8">
        ${items.map(m=>{
          const sel=seleccion[m.id];
          const on=!!sel;
          return `<div style="background:var(--bg-card);border:1px solid ${on?'rgba(45,212,191,.4)':'var(--border)'};border-radius:12px;padding:12px">
            <div style="display:flex;align-items:center;gap:10px">
              <div style="flex:1">
                <div style="font-size:13px;font-weight:600">${m.name||'—'}</div>
                <div style="font-size:10px;color:var(--text-4)">${m.requiereSerial?'Con serie':m.unit||'unidades'}</div>
              </div>
              <button class="dev-toggle" data-id="${m.id}" style="cursor:pointer;padding:7px 14px;border-radius:20px;border:1px solid ${on?'rgba(45,212,191,.5)':'var(--border)'};background:${on?'rgba(45,212,191,.15)':'var(--glass)'};color:${on?'#2dd4bf':'var(--text-3)'};font-size:11px;font-weight:700">${on?'Quitar':'Devolver'}</button>
            </div>
            <div class="dev-detalle" data-id="${m.id}" style="display:${on?'block':'none'};margin-top:10px"></div>
          </div>`;
        }).join('')}
      </div>`;
    // Buscador
    const bus=ov.querySelector('#dev-buscar');
    bus?.addEventListener('input',()=>pintarLista(bus.value));
    // Toggles
    ov.querySelectorAll('.dev-toggle').forEach(btn=>{
      btn.onclick=()=>{
        const id=btn.dataset.id;
        const m=materiales.find(x=>x.id===id);
        if(seleccion[id]) delete seleccion[id];
        else seleccion[id]={item:m,cantidad:m.requiereSerial?0:1,seriales:[]};
        pintarLista(bus?.value||'');
        actualizarFooter();
      };
    });
    // Detalles de los seleccionados
    Object.keys(seleccion).forEach(id=>pintarDetalle(id));
    actualizarFooter();
  }

  function pintarDetalle(id){
    const cont=ov.querySelector(`.dev-detalle[data-id="${id}"]`);
    if(!cont) return;
    const sel=seleccion[id];
    const m=sel.item;
    if(!m.requiereSerial){
      cont.innerHTML=`
        <div class="form-label" style="margin-bottom:6px">Cantidad a devolver</div>
        <input class="form-input dev-cant" data-id="${id}" type="number" min="1" value="${sel.cantidad}" style="text-align:center"/>`;
      cont.querySelector('.dev-cant').addEventListener('input',e=>{ sel.cantidad=Math.max(0,parseInt(e.target.value,10)||0); actualizarFooter(); });
    }else{
      cont.innerHTML=`
        <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:8px">
          <div class="form-label" style="margin:0">Seriales que devuelves</div>
          <div style="font-size:11px;font-weight:700;color:${sel.seriales.length?'#22c55e':'var(--text-4)'}" class="dev-est" data-id="${id}">${sel.seriales.length} seriales</div>
        </div>
        <div style="display:flex;gap:6px;margin-bottom:8px" class="dev-modo" data-id="${id}">
          <div class="select-chip active" data-modo="caja" style="font-size:10px;cursor:pointer">Caja</div>
          <div class="select-chip" data-modo="rango" style="font-size:10px;cursor:pointer">Rango</div>
          <div class="select-chip" data-modo="individual" style="font-size:10px;cursor:pointer">Individual</div>
        </div>
        <div class="dev-modo-caja" data-id="${id}">
          <div style="display:grid;grid-template-columns:1.3fr 1fr;gap:8px;margin-bottom:6px">
            <input class="form-input dev-cj-desde" data-id="${id}" inputmode="numeric" placeholder="Primer serial" style="font-family:monospace;font-size:12px"/>
            <input class="form-input dev-cj-cant" data-id="${id}" type="number" min="1" placeholder="Cantidad" style="text-align:center;font-size:12px"/>
          </div>
          <input class="form-input dev-cj-faltan" data-id="${id}" inputmode="numeric" placeholder="Faltan (ej. 1657809, 1657817)" style="font-family:monospace;font-size:12px"/>
        </div>
        <div class="dev-modo-rango" data-id="${id}" style="display:none">
          <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
            <input class="form-input dev-ri" data-id="${id}" inputmode="numeric" placeholder="Del…" style="font-family:monospace;font-size:12px"/>
            <input class="form-input dev-rf" data-id="${id}" inputmode="numeric" placeholder="…al" style="font-family:monospace;font-size:12px"/>
          </div>
        </div>
        <div class="dev-modo-individual" data-id="${id}" style="display:none">
          <textarea class="form-input dev-ind" data-id="${id}" rows="4" placeholder="Un serial por línea" style="font-family:monospace;font-size:11px;resize:none"></textarea>
        </div>
        <button class="dev-aplicar" data-id="${id}" style="width:100%;margin-top:8px;padding:9px;border-radius:10px;border:1px solid rgba(45,212,191,.4);background:rgba(45,212,191,.12);color:#2dd4bf;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Agregar seriales</button>
        <div class="dev-msg" data-id="${id}" style="font-size:11px;font-weight:600;margin-top:8px;display:none"></div>
        <div class="dev-chips" data-id="${id}" style="margin-top:8px"></div>`;

      // Toggle de modo
      cont.querySelectorAll(`.dev-modo[data-id="${id}"] .select-chip`).forEach(chip=>{
        chip.onclick=()=>{
          cont.querySelectorAll(`.dev-modo[data-id="${id}"] .select-chip`).forEach(c=>c.classList.remove('active'));
          chip.classList.add('active');
          const modo=chip.dataset.modo;
          cont.querySelector(`.dev-modo-caja[data-id="${id}"]`).style.display=modo==='caja'?'':'none';
          cont.querySelector(`.dev-modo-rango[data-id="${id}"]`).style.display=modo==='rango'?'':'none';
          cont.querySelector(`.dev-modo-individual[data-id="${id}"]`).style.display=modo==='individual'?'':'none';
        };
      });
      // Aplicar seriales
      cont.querySelector(`.dev-aplicar[data-id="${id}"]`).onclick=()=>{
        const modo=cont.querySelector(`.dev-modo[data-id="${id}"] .select-chip.active`)?.dataset.modo||'caja';
        const msg=cont.querySelector(`.dev-msg[data-id="${id}"]`);
        let nuevas=[];
        if(modo==='caja'){
          const r=_devExpandirCaja(cont.querySelector(`.dev-cj-desde[data-id="${id}"]`).value, cont.querySelector(`.dev-cj-cant[data-id="${id}"]`).value, cont.querySelector(`.dev-cj-faltan[data-id="${id}"]`).value);
          if(r.error){ msg.textContent=r.error; msg.style.color='#ef4444'; msg.style.display='block'; return; }
          nuevas=r.seriales;
        }else if(modo==='rango'){
          nuevas=_devExpandirRango(cont.querySelector(`.dev-ri[data-id="${id}"]`).value, cont.querySelector(`.dev-rf[data-id="${id}"]`).value);
          if(!nuevas.length){ msg.textContent='Revisa el rango.'; msg.style.color='#ef4444'; msg.style.display='block'; return; }
        }else{
          nuevas=String(cont.querySelector(`.dev-ind[data-id="${id}"]`).value||'').split('\n').map(s=>s.trim()).filter(Boolean);
          if(!nuevas.length){ msg.textContent='Escribe al menos un serial.'; msg.style.color='#ef4444'; msg.style.display='block'; return; }
        }
        // Fusionar sin duplicar
        const set=new Set(sel.seriales); nuevas.forEach(s=>set.add(s)); sel.seriales=[...set];
        msg.textContent=`Se agregaron. Total: ${sel.seriales.length}.`; msg.style.color='#22c55e'; msg.style.display='block';
        pintarChips(id); actualizarEst(id); actualizarFooter();
      };
      pintarChips(id);
    }
  }

  function pintarChips(id){
    const cont=ov.querySelector(`.dev-chips[data-id="${id}"]`);
    if(!cont) return;
    const sel=seleccion[id];
    cont.innerHTML=sel.seriales.length?`
      <div style="display:flex;flex-wrap:wrap;gap:5px">
        ${sel.seriales.map(s=>`<div class="dev-chip-del" data-id="${id}" data-ser="${s}" style="cursor:pointer;display:flex;align-items:center;gap:5px;background:rgba(34,197,94,.1);border:1px solid rgba(34,197,94,.4);border-radius:7px;padding:5px 8px;font-family:monospace;font-size:11px;font-weight:700;color:#22c55e">${s}<span style="color:#ef4444;font-size:12px">&#10007;</span></div>`).join('')}
      </div>`:'';
    cont.querySelectorAll('.dev-chip-del').forEach(chip=>{
      chip.onclick=()=>{ sel.seriales=sel.seriales.filter(x=>x!==chip.dataset.ser); pintarChips(id); actualizarEst(id); actualizarFooter(); };
    });
  }
  function actualizarEst(id){
    const est=ov.querySelector(`.dev-est[data-id="${id}"]`);
    if(est){ const n=seleccion[id].seriales.length; est.textContent=`${n} seriales`; est.style.color=n?'#22c55e':'var(--text-4)'; }
  }

  function actualizarFooter(){
    const footer=ov.querySelector('#dev-footer');
    const btn=ov.querySelector('#dev-enviar');
    const hay=Object.keys(seleccion).length>0;
    btn.style.display=hay?'':'none';
  }

  // Enviar
  ov.querySelector('#dev-enviar').addEventListener('click', async ()=>{
    const errEl=ov.querySelector('#dev-err'); errEl.style.display='none';
    const items=[];
    for(const id of Object.keys(seleccion)){
      const s=seleccion[id];
      if(s.item.requiereSerial){
        if(!s.seriales.length){ errEl.textContent=`Agrega los seriales de ${s.item.name}.`; errEl.style.display='block'; return; }
        items.push({itemId:id, nombre:s.item.name, unit:s.item.unit||'unidades', requiereSerial:true, cantidad:s.seriales.length, seriales:s.seriales});
      }else{
        if(!s.cantidad||s.cantidad<1){ errEl.textContent=`Indica la cantidad de ${s.item.name}.`; errEl.style.display='block'; return; }
        items.push({itemId:id, nombre:s.item.name, unit:s.item.unit||'unidades', requiereSerial:false, cantidad:s.cantidad, seriales:[]});
      }
    }
    if(!items.length){ errEl.textContent='Selecciona al menos un material.'; errEl.style.display='block'; return; }

    const nota=(ov.querySelector('#dev-nota')?.value||'').trim();
    const btn=ov.querySelector('#dev-enviar'); const lbl=ov.querySelector('#dev-enviar-lbl');
    btn.disabled=true; lbl.textContent='Enviando…';
    try{
      await db.collection('devoluciones_pendientes').add({
        estado:'pendiente',
        area:campana,
        tecnicoUid:session.uid,
        tecnicoNombre:session.displayName,
        items,
        nota:nota||null,
        fecha:firebase.firestore.FieldValue.serverTimestamp(),
      });
      ov.remove();
      toast('Devolución enviada. Bodega la revisará.','ok');
    }catch(e){
      btn.disabled=false; lbl.textContent='Enviar devolución';
      errEl.textContent='Error: '+e.message; errEl.style.display='block';
    }
  });

  // Campo de nota (se agrega al footer una vez)
  const footer=ov.querySelector('#dev-footer');
  const notaWrap=document.createElement('div');
  notaWrap.style.marginBottom='8px';
  notaWrap.innerHTML=`<input class="form-input" id="dev-nota" type="text" placeholder="Nota (opcional)" style="font-size:12px"/>`;
  footer.insertBefore(notaWrap, footer.querySelector('#dev-err'));
};

// ── Aviso de solicitudes de material en el dashboard ──
// Lee el conteo por campaña que mantiene el listener global (app.js)
// y se registra para repintarse cuando llegan cambios en vivo.
function pintarAvisoSolicitudes(){
  const cont=document.getElementById('aviso-solicitudes');
  if(!cont) return;
  const CAMP={ CAMBIOS:{l:'Cambio de Medidores',c:'#2dd4bf'}, AMI:{l:'AMI',c:'#fbbf24'}, Caracterizacion:{l:'Caracterización',c:'#a78bfa'}, ReclamosSIGET:{l:'Reclamos SIGET',c:'#f472b6'}, OTC:{l:'OTC',c:'#60a5fa'} };
  const data=window.__solicPorCampana||{};
  const total=Object.values(data).reduce((a,b)=>a+b,0);
  if(!total){ cont.innerHTML=''; return; }
  const chips=Object.entries(data).filter(([,n])=>n>0).map(([k,n])=>{
    const info=CAMP[k]||{l:k,c:'#94a3b8'};
    return `<div style="display:flex;align-items:center;gap:6px;background:${info.c}18;border:1px solid ${info.c}44;border-radius:20px;padding:5px 12px">
      <span style="font-size:11px;font-weight:700;color:${info.c}">${info.l}</span>
      <span style="min-width:18px;height:18px;border-radius:9px;background:${info.c};color:#0d1117;font-size:11px;font-weight:800;display:flex;align-items:center;justify-content:center">${n}</span>
    </div>`;
  }).join('');
  cont.innerHTML=`
    <div class="anim-up d1" onclick="window.__router.navigateTo('bodega')" style="cursor:pointer;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);border-radius:16px;padding:14px 16px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:10px">
        <div style="width:34px;height:34px;border-radius:10px;background:rgba(239,68,68,.15);display:flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M6 8a6 6 0 0112 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 003.4 0"/></svg>
        </div>
        <div style="flex:1">
          <div style="font-size:14px;font-weight:800;color:#f87171">${total} solicitud${total>1?'es':''} de material</div>
          <div style="font-size:11px;color:var(--text-4)">Toca para ir a Bodega y despachar</div>
        </div>
      </div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">${chips}</div>
    </div>`;
}

// Repintar en vivo cuando el listener global detecte cambios
window.__onSolicitudesCambio = () => { try{ pintarAvisoSolicitudes(); }catch{} };
