/**
 * js/views/home.js
 * Vista home — renderiza según rol del usuario.
 * Exporta: init(container, session)
 */

import { db } from '../firebase.js';

const META_DIARIA = 15;

export async function init(container, session) {
  const { role, asignacionActual } = session;
  const area    = asignacionActual?.area    || null;
  const destino = asignacionActual?.destino || null;

  if (role === 'tecnico') {
    if (!area) return renderNoAsignacion(container, session);
    renderHomeTecnico(container, session, area, destino);
    cargarDatosTecnico(session, area, destino);
    return;
  }
  if (role === 'admin')     { renderHomeAdmin(container, session);     cargarDatosAdmin(session);     return; }
  if (role === 'asistente') { renderHomeAsistente(container, session); cargarDatosAsistente(session); return; }

  container.innerHTML = `<p style="color:var(--text-3);padding:24px">Rol no reconocido.</p>`;
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
          : '<div class="companero-chip muted">Sin compañero asignado</div>'}
      `;
    }
  } catch(err) {
    console.warn('[home] Error cargando datos técnico:', err);
  }
}

// ── Carga datos admin ─────────────────────────────
async function cargarDatosAdmin(session) {
  try {
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const [cmSnap, otcSnap, solSnap] = await Promise.all([
      db.collection('cambios_ordenes').get(),
      db.collection('otc_ordenes').where('estadoCampo', '!=', 'aprobada').get(),
      db.collection('solicitudes_material').where('estado', '==', 'pendiente').get(),
    ]);

    const cmHoy = cmSnap.docs.filter(d => {
      const f = d.data().fechaHecha?.toDate?.();
      return f && f >= hoy;
    }).length;

    const sinActualizar = cmSnap.docs.filter(d => {
      const data = d.data();
      return (data.estadoCampo === 'hecha' || data.estadoCampo === 'aprobada') && !data.actualizadaDelsur;
    }).length;

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setVal('m-stat-cm',    cmHoy);
    setVal('m-stat-otc',   otcSnap.size);
    setVal('m-stat-alert', solSnap.size);

    renderIndicadorCorte(sinActualizar);
  } catch(err) {
    console.warn('[home] Error cargando datos admin:', err);
    renderIndicadorCorte(0);
  }
}

// ── Carga datos asistente ─────────────────────────
async function cargarDatosAsistente(session) {
  try {
    const hoy = new Date(); hoy.setHours(0,0,0,0);
    const [cmSnap, otcSnap, solSnap] = await Promise.all([
      db.collection('cambios_ordenes').get(),
      db.collection('otc_ordenes').where('estadoCampo', '!=', 'aprobada').get(),
      db.collection('solicitudes_material').where('estado', '==', 'pendiente').get(),
    ]);

    const cmHoy = cmSnap.docs.filter(d => {
      const f = d.data().fechaHecha?.toDate?.();
      return f && f >= hoy;
    }).length;

    const sinActualizar = cmSnap.docs.filter(d => {
      const data = d.data();
      return (data.estadoCampo === 'hecha' || data.estadoCampo === 'aprobada') && !data.actualizadaDelsur;
    }).length;

    const setVal = (id, val) => { const el = document.getElementById(id); if (el) el.textContent = val; };
    setVal('a-stat-cm',  cmHoy);
    setVal('a-stat-otc', otcSnap.size);
    setVal('a-stat-sol', solSnap.size);

    renderIndicadorCorte(sinActualizar);
  } catch(err) {
    console.warn('[home] Error cargando datos asistente:', err);
    renderIndicadorCorte(0);
  }
}

// ── Indicador corte del 15 ────────────────────────
function renderIndicadorCorte(sinActualizar) {
  const el = document.getElementById('indicador-corte');
  if (!el) return;

  const hoy   = new Date();
  const dia   = hoy.getDate();
  const mes   = hoy.getMonth();
  const anio  = hoy.getFullYear();

  // Próximo corte
  let corte;
  if (dia <= 15) {
    corte = new Date(anio, mes, 15);
  } else {
    corte = new Date(anio, mes + 1, 15);
  }

  const diffMs   = corte - hoy;
  const diasFaltan = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  // Semáforo
  let color, bg, border, icono, urgencia;
  if (diasFaltan >= 11) {
    color = '#22c55e'; bg = 'rgba(34,197,94,.06)'; border = 'rgba(34,197,94,.2)';
    icono = '🟢'; urgencia = 'Con tiempo';
  } else if (diasFaltan >= 4) {
    color = '#fbbf24'; bg = 'rgba(245,158,11,.06)'; border = 'rgba(245,158,11,.2)';
    icono = '🟡'; urgencia = 'Atención';
  } else {
    color = '#ef4444'; bg = 'rgba(239,68,68,.06)'; border = 'rgba(239,68,68,.2)';
    icono = '🔴'; urgencia = diasFaltan === 0 ? '¡Hoy es el corte!' : 'Urgente';
  }

  const corteStr = corte.toLocaleDateString('es-SV', { day:'numeric', month:'long' });

  el.innerHTML = `
    <div style="background:${bg};border:1px solid ${border};border-radius:var(--radius);padding:16px 18px;display:flex;align-items:center;gap:16px">
      <div style="font-size:28px;flex-shrink:0">${icono}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:8px;margin-bottom:4px">
          <div style="font-size:13px;font-weight:700;color:${color}">${urgencia}</div>
          <div style="font-size:11px;color:var(--text-4)">· Corte ${corteStr}</div>
        </div>
        <div style="font-size:12px;color:var(--text-2)">
          <strong style="color:${color}">${diasFaltan} día${diasFaltan !== 1 ? 's' : ''}</strong> para el corte
          ${sinActualizar === null
            ? ' · <span style="color:var(--text-4)">Calculando…</span>'
            : sinActualizar > 0
              ? ` · <strong style="color:${diasFaltan < 4 ? '#ef4444' : color}">${sinActualizar} orden${sinActualizar !== 1 ? 'es' : ''} sin actualizar en DELSUR</strong>`
              : ' · <span style="color:#22c55e">✓ Todo actualizado en DELSUR</span>'}
        </div>
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

// ── Sin asignación ────────────────────────────────
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
      <div class="quick-grid anim-up d2">
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
}
