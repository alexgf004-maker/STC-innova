/**
 * js/views/home.js
 * Vista home — renderiza según rol del usuario.
 * Exporta: init(container, session)
 */

/**
 * @param {HTMLElement} container
 * @param {Object} session - { uid, displayName, role, asignacion }
 */
export function init(container, session) {
  const { role, asignacion } = session;
  const area = asignacion?.area;

  if (role === 'tecnico') {
    if (!area) return renderNoAsignacion(container, session);
    return renderHomeTecnico(container, session, area);
  }
  if (role === 'madelyn')   return renderHomeMadelyn(container, session);
  if (role === 'asistente') return renderHomeAsistente(container, session);

  container.innerHTML = `<p style="color:var(--text-3);padding:24px">Rol no reconocido.</p>`;
}

// ── Home Técnico (CM u OTC) ───────────────────────
function renderHomeTecnico(container, session, area) {
  const isCM        = area === 'CM';
  const color       = isCM ? 'cm' : 'otc';
  const accentColor = isCM ? '#2dd4bf' : '#60a5fa';
  const rgbAccent   = isCM ? '13,148,136' : '37,99,235';
  const label       = isCM ? 'Cambios de Medidor' : 'Órdenes Técnicas de Campo';
  const pareja      = session.asignacion?.pareja;

  container.innerHTML = `
    <div class="flex-col gap-12" style="padding-top:4px">

      <div class="welcome-card ${color} anim-up">
        <div class="welcome-area-label">${area} · ${label}</div>
        <div class="welcome-name">${session.displayName}</div>
        <div class="welcome-role">
          Área asignada para hoy${pareja ? ` · Pareja ${pareja}` : ''}
        </div>
      </div>

      <div class="stat-row anim-up d1">
        <div class="stat-chip ${color}-accent">
          <div class="val" id="stat-pendientes">—</div>
          <div class="lbl">Pendientes</div>
        </div>
        <div class="stat-chip ${color}-accent">
          <div class="val" id="stat-hechas">—</div>
          <div class="lbl">Realizadas</div>
        </div>
        <div class="stat-chip">
          <div class="val" id="stat-total">—</div>
          <div class="lbl">Total</div>
        </div>
      </div>

      <div class="section-label anim-up d2">Accesos rápidos</div>
      <div class="quick-grid anim-up d2">
        <div class="quick-card" onclick="window.__router.navigateTo('ordenes')">
          <div class="qc-icon" style="background:rgba(${rgbAccent},.15)">
            <svg viewBox="0 0 24 24" fill="none" stroke="${accentColor}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/>
              <line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/>
              <line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>
            </svg>
          </div>
          <div class="qc-title">Mis órdenes</div>
          <div class="qc-sub">Ver listado completo</div>
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

        ${!isCM ? `
        <div class="quick-card" style="border-color:var(--crit-light,rgba(239,68,68,.2));background:rgba(239,68,68,.05)">
          <div class="qc-icon" style="background:rgba(239,68,68,.1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--crit-light)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="10"/>
              <line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
          </div>
          <div class="qc-title" style="color:var(--crit-light)">Reconexiones</div>
          <div class="qc-sub">Órdenes urgentes</div>
        </div>` : ''}
      </div>

      <div class="section-label anim-up d3">Últimas órdenes</div>
      <div class="dev-module anim-up d3">
        <div class="dev-title">Sin órdenes cargadas</div>
        <p>Se cargarán cuando el asistente asigne órdenes del día.</p>
      </div>

    </div>
  `;
  // TODO Fase 2: cargar stats reales desde Firestore
}

// ── Sin asignación ────────────────────────────────
function renderNoAsignacion(container, session) {
  container.innerHTML = `
    <div class="no-assign anim-up">
      <div class="no-assign-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">
          <rect x="3" y="4" width="18" height="18" rx="2" ry="2"/>
          <line x1="16" y1="2" x2="16" y2="6"/>
          <line x1="8" y1="2" x2="8" y2="6"/>
          <line x1="3" y1="10" x2="21" y2="10"/>
        </svg>
      </div>
      <h3>Sin asignación hoy</h3>
      <p>No tienes área asignada para el día de hoy. Contacta a tu asistente para recibir tu asignación.</p>
      <div class="no-assign-badge">${session.displayName}</div>
    </div>
  `;
}

// ── Home Madelyn ──────────────────────────────────
function renderHomeMadelyn(container, session) {
  container.innerHTML = `
    <div class="flex-col gap-12" style="padding-top:4px">

      <div class="welcome-card office anim-up">
        <div class="welcome-area-label">Vista ejecutiva</div>
        <div class="welcome-name">${session.displayName}</div>
        <div class="welcome-role">Coordinadora de Servicios Técnicos y Comerciales</div>
      </div>

      <div class="section-label anim-up d1">Resumen del día</div>
      <div class="stat-row anim-up d1">
        <div class="stat-chip cm-accent">
          <div class="val" id="m-stat-cm">—</div>
          <div class="lbl">CM hoy</div>
        </div>
        <div class="stat-chip otc-accent">
          <div class="val" id="m-stat-otc">—</div>
          <div class="lbl">OTC activas</div>
        </div>
        <div class="stat-chip warn-accent">
          <div class="val" id="m-stat-alert">—</div>
          <div class="lbl">Alertas</div>
        </div>
      </div>

      <div class="quick-grid anim-up d2">
        <div class="quick-card cm" onclick="window.__router.navigateTo('cambios')">
          <div class="qc-icon" style="background:rgba(13,148,136,.15)">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--cm-light)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
          </div>
          <div class="qc-title" style="color:var(--cm-light)">Cambios</div>
          <div class="qc-sub">Panel de seguimiento</div>
        </div>

        <div class="quick-card otc" onclick="window.__router.navigateTo('otc')">
          <div class="qc-icon" style="background:rgba(37,99,235,.15)">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--otc-light)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          </div>
          <div class="qc-title" style="color:var(--otc-light)">OTC</div>
          <div class="qc-sub">Órdenes técnicas</div>
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
          <div class="qc-sub">Inventario y despachos</div>
        </div>

        <div class="quick-card" onclick="window.__router.navigateTo('usuarios')">
          <div class="qc-icon" style="background:var(--glass)">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
            </svg>
          </div>
          <div class="qc-title">Usuarios</div>
          <div class="qc-sub">Gestión y asignación</div>
        </div>
      </div>

    </div>
  `;
  // TODO Fase 2: cargar stats reales
}

// ── Home Asistente ────────────────────────────────
function renderHomeAsistente(container, session) {
  container.innerHTML = `
    <div class="flex-col gap-12" style="padding-top:4px">

      <div class="welcome-card office anim-up">
        <div class="welcome-area-label">Operación diaria</div>
        <div class="welcome-name">${session.displayName}</div>
        <div class="welcome-role">Asistente técnico-comercial</div>
      </div>

      <div class="stat-row anim-up d1">
        <div class="stat-chip cm-accent">
          <div class="val" id="a-stat-cm">—</div>
          <div class="lbl">CM hoy</div>
        </div>
        <div class="stat-chip otc-accent">
          <div class="val" id="a-stat-otc">—</div>
          <div class="lbl">OTC</div>
        </div>
        <div class="stat-chip purple">
          <div class="val" style="color:var(--purple)" id="a-stat-sol">—</div>
          <div class="lbl">Solicitudes</div>
        </div>
      </div>

      <div class="quick-grid anim-up d2">
        <div class="quick-card cm" onclick="window.__router.navigateTo('cambios')">
          <div class="qc-icon" style="background:rgba(13,148,136,.15)">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--cm-light)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/>
            </svg>
          </div>
          <div class="qc-title" style="color:var(--cm-light)">Panel Cambios</div>
          <div class="qc-sub">Confirmar · Asignar</div>
        </div>

        <div class="quick-card otc" onclick="window.__router.navigateTo('otc')">
          <div class="qc-icon" style="background:rgba(37,99,235,.15)">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--otc-light)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/>
            </svg>
          </div>
          <div class="qc-title" style="color:var(--otc-light)">Panel OTC</div>
          <div class="qc-sub">Alertas · Seguimiento</div>
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
          <div class="qc-sub">Aprobar solicitudes</div>
        </div>

        <div class="quick-card" onclick="window.__router.navigateTo('usuarios')">
          <div class="qc-icon" style="background:var(--glass)">
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-2)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
              <path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/>
              <path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/>
            </svg>
          </div>
          <div class="qc-title">Usuarios</div>
          <div class="qc-sub">Asignar área del día</div>
        </div>
      </div>

    </div>
  `;
}
