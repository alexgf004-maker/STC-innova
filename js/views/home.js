/**
 * js/views/home.js
 * Vista home — renderiza según rol del usuario.
 * Exporta: init(container, session)
 */

import { db } from '../firebase.js';
import { leerStats, recalcularStats } from '../stats.js';
import { setupRefreshBtn } from '../ui.js';

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

const CAMP_LABEL_HOME = { AMI:'AMI', Caracterizacion:'Caracterización', ReclamosSIGET:'Reclamos SIGET' };
const CAMP_COLOR_HOME = { AMI:'#fbbf24', Caracterizacion:'#a78bfa', ReclamosSIGET:'#f472b6' };

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
        <div class="quick-card" onclick="window.__router.navigateTo('${isCambios ? 'cambios' : 'otc'}')">
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

        ${!isCambios ? `
        <div class="quick-card" style="border-color:rgba(239,68,68,.25);background:rgba(239,68,68,.05)" onclick="window.__router.navigateTo('otc')">
          <div class="qc-icon" style="background:rgba(239,68,68,.12)">
            <svg viewBox="0 0 24 24" fill="none" stroke="#f87171" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <div class="qc-title" style="color:#f87171">Reconexiones</div>
          <div class="qc-sub">Órdenes urgentes</div>
        </div>` : ''}
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
        <div class="stat-chip otc-accent"><div class="val" id="m-stat-otc">—</div><div class="lbl">OTC activas</div></div>
        <div class="stat-chip warn-accent"><div class="val" id="m-stat-alert">—</div><div class="lbl">Solicitudes</div></div>
      </div>

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
        <div class="quick-card otc" onclick="window.__router.navigateTo('otc')">
          <div class="qc-icon" style="background:rgba(37,99,235,.15)">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--otc-light)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          </div>
          <div class="qc-title" style="color:var(--otc-light)">OTC</div>
          <div class="qc-sub">Órdenes técnicas</div>
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
        <div class="stat-chip otc-accent"><div class="val" id="a-stat-otc">—</div><div class="lbl">OTC activas</div></div>
        <div class="stat-chip" style="border-color:var(--purple-border);background:var(--purple-glass)"><div class="val" style="color:var(--purple)" id="a-stat-sol">—</div><div class="lbl">Solicitudes</div></div>
      </div>

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
        <div class="quick-card otc" onclick="window.__router.navigateTo('otc')">
          <div class="qc-icon" style="background:rgba(37,99,235,.15)">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--otc-light)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
          </div>
          <div class="qc-title" style="color:var(--otc-light)">Panel OTC</div>
          <div class="qc-sub">Alertas · Seguimiento</div>
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
}
