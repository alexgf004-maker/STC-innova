/**
 * js/views/usuarios.js
 * Gestión de usuarios — listado, asignación diaria, crear, activar/desactivar.
 * Exporta: init(container, session)
 */

import { db, llamar, mensajeServidor } from '../firebase.js';
import { toast, escapeHtml } from '../ui.js';

const AREAS    = ['CAMBIOS', 'Caracterizacion', 'Reclamos', 'AMI', 'Factibilidades'];
// Áreas donde el técnico trabaja solo (sin pareja): se guarda un destino fijo
// para que las vistas que esperan asignacionActual.destino no se rompan.
const SIN_PAREJA = { Factibilidades: 'Individual' };
const DESTINOS = {
  CAMBIOS: ['Pareja 1', 'Pareja 2', 'Pareja 3', 'Pareja 4'],
  Caracterizacion: ['Pareja 1', 'Pareja 2', 'Pareja 3'],
  Reclamos: ['Pareja 1', 'Pareja 2'],
  AMI: ['Pareja 1', 'Pareja 2', 'Pareja 3', 'Pareja 4', 'Pareja 5', 'Pareja 6'],
  OTC:     ['NALVAR', 'RGONZA', 'JPEREZ'],
};
const ROLES = ['tecnico', 'asistente', 'admin'];

let container_, session_;
let usuarios = [];
let filtro_ = 'todos', busq_ = '', verInactivos_ = false;

const AREA_TXT  = { CAMBIOS: 'Cambios', Caracterizacion: 'Caracterización', Reclamos: 'Reclamos SIGET', AMI: 'AMI', OTC: 'OTC', Factibilidades: 'Factibilidades' };
const AREA_CLS  = { CAMBIOS: 'cm', Caracterizacion: 'cr', Reclamos: 'rc', AMI: 'am', OTC: 'otc', Factibilidades: 'fb' };
// "Cambios · Pareja 2" / "Factibilidades" (sin el destino fijo de las áreas individuales)
const textoAsig = (area, dest) => SIN_PAREJA[area] ? (AREA_TXT[area] || area) : `${AREA_TXT[area] || area} · ${dest || '—'}`;
const ICO = {
  plus:  '<line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>',
  pin:   '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>',
  lock:  '<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>',
  off:   '<circle cx="12" cy="12" r="10"/><line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/>',
  on:    '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  dots:  '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
};
const svg = (d, n = 16) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${n}" height="${n}">${d}</svg>`;

// ── Entry point ───────────────────────────────────
export async function init(container, session) {
  container_ = container;
  session_   = session;

  renderShell();
  await loadUsuarios();
}

// ── Shell del módulo ──────────────────────────────
function renderShell() {
  container_.innerHTML = `
    <div class="flex-col gap-12">
      <div class="anim-up">
        <div style="font-size:24px;font-weight:600;letter-spacing:-.02em;line-height:1.15">Usuarios</div>
        <div style="font-size:12px;color:var(--text-4);margin-top:4px" id="usuarios-count">Cargando…</div>
      </div>

      <button class="us-btn-main anim-up" id="btn-nuevo-usuario">${svg(ICO.plus)} Nuevo usuario</button>

      <div class="ds-mini anim-up d1" id="us-resumen"></div>

      <div class="buscar-wrap anim-up d1" style="margin-bottom:0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="color:var(--text-4);flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="buscar-input" id="us-buscar" placeholder="Buscar por nombre o usuario…" autocomplete="off"/>
      </div>

      <div class="filter-row anim-up d1" id="filter-row">
        <div class="filter-chip active" data-filter="todos">Todos</div>
        <div class="filter-chip" data-filter="tecnico">Técnicos</div>
        <div class="filter-chip" data-filter="sinasignar">Sin asignar</div>
        <div class="filter-chip" data-filter="oficina">Oficina</div>
      </div>

      <div id="usuarios-list" class="anim-up d2">
        <div class="loading-placeholder">
          <div class="loading-bar"></div>
          <div class="loading-bar short"></div>
          <div class="loading-bar"></div>
        </div>
      </div>
    </div>

    <!-- Sheet crear usuario -->
    <div class="sheet-backdrop" id="sheet-nuevo">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">Nuevo usuario</div>
        <div class="sheet-body">
          <div class="form-field">
            <div class="form-label">Nombre completo</div>
            <input class="form-input" id="nu-name" type="text" placeholder="Ej: Juan Pérez"/>
          </div>
          <div class="form-field">
            <div class="form-label">Usuario para entrar</div>
            <input class="form-input" id="nu-user" type="text" placeholder="Ej: juan.perez" autocapitalize="off"/>
          </div>
          <div class="form-field">
            <div class="form-label">PIN (4–8 dígitos)</div>
            <input class="form-input" id="nu-pin" type="password" inputmode="numeric" maxlength="8" placeholder="••••"/>
          </div>
          <div class="form-field">
            <div class="form-label">Rol</div>
            <div class="select-row" id="nu-rol-row">
              <div class="select-chip active" data-val="tecnico">Técnico</div>
              <div class="select-chip" data-val="asistente">Asistente</div>
              ${session_.role === 'admin' ? '<div class="select-chip" data-val="admin">Admin</div>' : ''}
            </div>
          </div>
          <div id="nu-error" class="form-error"></div>
          <button class="btn-primary full" id="btn-crear-usuario">
            <span id="btn-crear-label">Crear usuario</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Sheet asignar área -->
    <div class="sheet-backdrop" id="sheet-asignar">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title" id="sheet-asignar-title">Asignar área</div>
        <div class="sheet-body">
          <div class="form-field">
            <div class="form-label">Área</div>
            <div class="select-row" id="asig-area-row">
              <div class="select-chip" data-val="CAMBIOS">Cambios</div>
              <div class="select-chip" data-val="Caracterizacion">Caracterización</div>
              <div class="select-chip" data-val="Reclamos">Reclamos SIGET</div>
              <div class="select-chip" data-val="AMI">AMI</div>
              <div class="select-chip" data-val="Factibilidades">Factibilidades</div>
              <div class="select-chip" data-val="null">Sin asignación</div>
            </div>
          </div>
          <div class="form-field" id="asig-destino-wrap" style="display:none">
            <div class="form-label" id="asig-destino-label">Destino</div>
            <div class="select-row flex-wrap" id="asig-destino-row"></div>
          </div>
          <div id="asig-error" class="form-error"></div>
          <button class="btn-primary full" id="btn-guardar-asig">
            <span id="btn-asig-label">Guardar asignación</span>
          </button>
        </div>
      </div>
    </div>

    <!-- Sheet editar credenciales -->
    <div class="sheet-backdrop" id="sheet-credenciales">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title" id="sheet-cred-title">Editar credenciales</div>
        <div class="sheet-body">
          <div class="form-field">
            <div class="form-label">Usuario para entrar</div>
            <input class="form-input" id="cred-username" type="text" autocomplete="off" autocapitalize="none"/>
          </div>
          <div class="form-field">
            <div class="form-label">Nuevo PIN (dejar vacío para no cambiar)</div>
            <input class="form-input" id="cred-pin" type="password" inputmode="numeric" maxlength="8" placeholder="••••"/>
          </div>
          <div class="form-field">
            <div class="form-label">Confirmar PIN</div>
            <input class="form-input" id="cred-pin2" type="password" inputmode="numeric" maxlength="8" placeholder="••••"/>
          </div>
          <div id="cred-error" class="form-error"></div>
          <button class="btn-primary full" id="btn-guardar-cred">
            <span id="btn-cred-label">Guardar cambios</span>
          </button>
        </div>
      </div>
    </div>
  `;

  // Eventos
  document.getElementById('btn-nuevo-usuario').addEventListener('click', () => openSheet('sheet-nuevo'));
  document.getElementById('btn-crear-usuario').addEventListener('click', crearUsuario);
  document.getElementById('btn-guardar-asig').addEventListener('click', guardarAsignacion);
  document.getElementById('btn-guardar-cred')?.addEventListener('click', guardarCredenciales);

  // Filtros y buscador
  document.querySelectorAll('#filter-row .filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('#filter-row .filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      filtro_ = chip.dataset.filter;
      renderLista();
    });
  });
  document.getElementById('us-buscar').addEventListener('input', e => { busq_ = e.target.value; renderLista(); });

  // Select chips
  setupSelectChips('nu-rol-row');
  setupSelectChips('asig-area-row');

  // Área cambia → actualizar destinos
  document.getElementById('asig-area-row').addEventListener('click', e => {
    const chip = e.target.closest('.select-chip');
    if (!chip) return;
    updateDestinoRow(chip.dataset.val);
  });

  // Cerrar sheets al tocar backdrop
  ['sheet-nuevo', 'sheet-asignar', 'sheet-credenciales'].forEach(id => {
    const el = document.getElementById(id);
    if (!el) return;
    el.addEventListener('click', e => {
      if (e.target === el) closeSheet(id);
    });
  });
}

// ── Cargar usuarios ───────────────────────────────
async function loadUsuarios() {
  try {
    // Sin orderBy: Firestore deja fuera a quien no tenga el campo de orden, y
    // un usuario sin nombre guardado desaparecía de la lista (y no se podía
    // asignar). Se ordena aquí, con el usuario como respaldo del nombre.
    const snap = await db.collection('users').get();
    const nombre = u => String(u.displayName || u.username || '');
    usuarios = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }))
      .sort((a, b) => nombre(a).localeCompare(nombre(b), 'es'));
    renderLista();
  } catch (err) {
    console.error('[usuarios] Error cargando:', err);
    document.getElementById('usuarios-list').innerHTML = `
      <div class="dev-module">
        <div class="dev-title">Error al cargar</div>
        <p>Verifica tu conexión e intenta de nuevo.</p>
      </div>
    `;
  }
}

// ── Render lista ──────────────────────────────────
// Agrupada: técnicos por área asignada hoy, luego oficina, e inactivos
// plegados al final. Tocar la asignación la cambia; "⋮" abre las acciones.
function renderLista(filtroArg) {
  if (typeof filtroArg === 'string') filtro_ = filtroArg;
  const list = document.getElementById('usuarios-list');
  if (!list) return;

  // Resumen
  const activos = usuarios.filter(u => u.active !== false);
  const tecs = activos.filter(u => u.role === 'tecnico');
  const sinAsig = tecs.filter(u => !u.asignacionActual?.area).length;
  document.getElementById('usuarios-count').textContent = `${activos.length} activos · ${usuarios.length} en total`;
  document.getElementById('us-resumen').innerHTML = `
    <div class="ds-m"><div class="ds-num-md">${tecs.length}</div><div class="ds-lbl-sm" style="margin-top:6px">Técnicos</div></div>
    <div class="ds-m"><div class="ds-num-md" style="color:#22c55e">${tecs.length - sinAsig}</div><div class="ds-lbl-sm" style="margin-top:6px">Asignados</div></div>
    <div class="ds-m"><div class="ds-num-md" style="color:${sinAsig ? '#fbbf24' : 'var(--text-3)'}">${sinAsig}</div><div class="ds-lbl-sm" style="margin-top:6px">Sin asignar</div></div>`;

  // Filtro + búsqueda
  const q = busq_.trim().toLowerCase();
  let lista = usuarios.filter(u => !q || String(u.displayName || '').toLowerCase().includes(q) || String(u.username || '').toLowerCase().includes(q));
  if (filtro_ === 'tecnico') lista = lista.filter(u => u.role === 'tecnico');
  else if (filtro_ === 'sinasignar') lista = lista.filter(u => u.role === 'tecnico' && u.active !== false && !u.asignacionActual?.area);
  else if (filtro_ === 'oficina') lista = lista.filter(u => u.role !== 'tecnico');

  if (!lista.length) {
    list.innerHTML = `<div class="dev-module"><div class="dev-title">Sin usuarios</div><p>${q ? 'Nadie coincide con la búsqueda.' : 'No hay usuarios con este filtro.'}</p></div>`;
    return;
  }

  const act = lista.filter(u => u.active !== false);
  const inact = lista.filter(u => u.active === false);
  const grupos = [];
  const tecAct = act.filter(u => u.role === 'tecnico');
  ['CAMBIOS', 'Caracterizacion', 'AMI', 'Reclamos', 'Factibilidades', 'OTC'].forEach(a => {
    const arr = tecAct.filter(u => u.asignacionActual?.area === a);
    if (arr.length) grupos.push({ titulo: AREA_TXT[a], cls: AREA_CLS[a], arr });
  });
  const sinA = tecAct.filter(u => !u.asignacionActual?.area || !AREA_TXT[u.asignacionActual.area]);
  if (sinA.length) grupos.push({ titulo: 'Técnicos sin asignar hoy', cls: '', arr: sinA });
  const ofi = act.filter(u => u.role !== 'tecnico');
  if (ofi.length) grupos.push({ titulo: 'Oficina', cls: '', arr: ofi });

  const porPareja = (a, b) => String(a.asignacionActual?.destino || '').localeCompare(String(b.asignacionActual?.destino || ''), 'es', { numeric: true })
    || String(a.displayName || '').localeCompare(String(b.displayName || ''));
  const sec = (titulo, n, cls, extra = '') => `<div class="us-sec">
      <span class="us-sec-dot ${cls}"></span><div class="ds-sec" style="margin:0">${titulo}</div>
      <div style="margin-left:auto;display:flex;align-items:center;gap:8px">${extra}<span class="us-count">${n}</span></div>
    </div>`;

  list.innerHTML = grupos.map(g => sec(g.titulo, g.arr.length, g.cls)
      + `<div class="flex-col gap-8">${g.arr.sort(porPareja).map(tarjetaUsuario).join('')}</div>`).join('')
    + (inact.length ? sec('Inactivos', inact.length, '', `<button class="us-mini-btn" id="us-ver-inactivos">${verInactivos_ ? 'Ocultar' : 'Ver'}</button>`)
      + (verInactivos_ ? `<div class="flex-col gap-8">${inact.map(tarjetaUsuario).join('')}</div>` : '') : '');

  list.querySelector('#us-ver-inactivos')?.addEventListener('click', () => { verInactivos_ = !verInactivos_; renderLista(); });
  list.querySelectorAll('[data-asignar]').forEach(b => b.onclick = () => asignar(b.dataset.asignar));
  list.querySelectorAll('[data-acciones]').forEach(b => b.onclick = () => abrirAcciones(b.dataset.acciones));
}

function tarjetaUsuario(u) {
  const area = u.asignacionActual?.area || null;
  const dest = u.asignacionActual?.destino || null;
  const cls = AREA_CLS[area] || '';
  const esYo = u.id === session_.uid;
  const asignacion = u.role !== 'tecnico' || u.active === false ? '' : `
    <button class="us-asig ${area ? cls : 'sin'}" data-asignar="${u.id}">
      ${svg(ICO.pin, 12)}
      ${area ? escapeHtml(textoAsig(area, dest)) : 'Sin asignar · tocar para asignar'}
    </button>`;
  return `
    <div class="us-card ${u.active === false ? 'inactivo' : ''}">
      <div class="user-avatar ${cls}">${escapeHtml(getInitials(u.displayName))}</div>
      <div style="flex:1;min-width:0">
        <div style="display:flex;align-items:center;gap:6px;min-width:0">
          <span class="us-nombre">${escapeHtml(u.displayName || '—')}</span>
          ${esYo ? '<span class="estado-badge muted" style="font-size:9px;padding:2px 7px">Tú</span>' : ''}
        </div>
        <div class="us-meta">${u.username ? '@' + escapeHtml(u.username) + ' · ' : ''}${getRoleLabel(u.role)}${u.active === false ? ' · Inactivo' : ''}</div>
        ${asignacion}
      </div>
      ${tieneAcciones(u) ? `<button class="us-dots" data-acciones="${u.id}" title="Opciones">${svg(ICO.dots, 18)}</button>` : '<span style="width:34px;flex-shrink:0"></span>'}
    </div>`;
}

function tieneAcciones(u) {
  return (u.role === 'tecnico' && u.active !== false) || session_.role === 'admin' || puedeToggle(u);
}

// Hoja de acciones de un usuario
function abrirAcciones(uid) {
  const u = usuarios.find(x => x.id === uid);
  if (!u) return;
  document.getElementById('sheet-us-acciones')?.remove();
  const sh = document.createElement('div');
  sh.className = 'sheet-backdrop open';
  sh.id = 'sheet-us-acciones';
  const item = (id, ico, txt, sub, cls = '') => `<button class="us-accion ${cls}" id="${id}">${svg(ico, 18)}<span style="flex:1;text-align:left"><span style="display:block">${txt}</span>${sub ? `<span class="us-accion-sub">${sub}</span>` : ''}</span></button>`;
  const area = u.asignacionActual?.area;
  sh.innerHTML = `<div class="sheet">
    <div class="sheet-handle"></div>
    <div class="sheet-body">
      <div style="display:flex;align-items:center;gap:12px;margin-bottom:14px">
        <div class="user-avatar ${AREA_CLS[area] || ''}">${escapeHtml(getInitials(u.displayName))}</div>
        <div style="min-width:0">
          <div style="font-size:16px;font-weight:600">${escapeHtml(u.displayName || '—')}</div>
          <div class="us-meta">${u.username ? '@' + escapeHtml(u.username) + ' · ' : ''}${getRoleLabel(u.role)}</div>
        </div>
      </div>
      <div class="flex-col gap-8">
        ${u.role === 'tecnico' && u.active !== false ? item('us-a-asig', ICO.pin, 'Asignar área y pareja', area ? escapeHtml(textoAsig(area, u.asignacionActual?.destino)) : 'Sin asignar hoy') : ''}
        ${session_.role === 'admin' ? item('us-a-cred', ICO.lock, 'Cambiar usuario o PIN', '') : ''}
        ${puedeToggle(u) ? item('us-a-toggle', u.active === false ? ICO.on : ICO.off, u.active === false ? 'Activar usuario' : 'Desactivar usuario', u.active === false ? 'Podrá volver a entrar' : 'Ya no podrá entrar a la app', u.active === false ? 'ok' : 'danger') : ''}
      </div>
      <button class="btn-action outline" id="us-a-cerrar" style="height:44px;margin-top:12px">Cerrar</button>
    </div>
  </div>`;
  document.body.appendChild(sh);
  const cerrar = () => sh.remove();
  sh.addEventListener('click', e => { if (e.target === sh) cerrar(); });
  sh.querySelector('#us-a-cerrar').onclick = cerrar;
  sh.querySelector('#us-a-asig')?.addEventListener('click', () => { cerrar(); asignar(uid); });
  sh.querySelector('#us-a-cred')?.addEventListener('click', () => { cerrar(); editarCredenciales(uid); });
  sh.querySelector('#us-a-toggle')?.addEventListener('click', () => { cerrar(); toggleActive(uid, u.active !== false); });
}

// ── Permisos ──────────────────────────────────────
function puedeToggle(u) {
  // Nadie puede desactivarse a sí mismo
  if (u.id === session_.uid) return false;
  // Admin puede togglear a cualquiera menos a sí mismo
  if (session_.role === 'admin') return true;
  // Asistente solo puede togglear técnicos
  if (session_.role === 'asistente') return u.role === 'tecnico';
  return false;
}

// ── Crear usuario ─────────────────────────────────
async function crearUsuario() {
  const name = document.getElementById('nu-name').value.trim();
  const user = document.getElementById('nu-user').value.trim().toLowerCase();
  const pin  = document.getElementById('nu-pin').value;
  const role = getSelectedChip('nu-rol-row');
  const errEl = document.getElementById('nu-error');

  errEl.textContent = '';
  errEl.style.display = 'none';

  if (!name || !user || pin.length < 4 || !role) {
    showFormError('nu-error', 'Completa todos los campos. PIN mínimo 4 dígitos.');
    return;
  }

  // Verificar username único
  const exists = usuarios.find(u => u.username === user);
  if (exists) {
    showFormError('nu-error', 'Ese username ya existe.');
    return;
  }

  setLoading('btn-crear-label', 'Creando…', true);

  try {
    // Lo crea el servidor: la cuenta de Firebase (con contraseña al azar que
    // nadie conoce), la ficha, el registro en `usernames` y el PIN protegido.
    const { uid } = await llamar('crearUsuario', { username: user, displayName: name, role, pin });

    // Actualizar lista local
    usuarios.push({
      id: uid, uid, username: user, displayName: name,
      role, active: true, asignacionActual: null,
    });

    closeSheet('sheet-nuevo');
    document.getElementById('nu-name').value = '';
    document.getElementById('nu-user').value = '';
    document.getElementById('nu-pin').value  = '';

    renderLista();
    toast(`Usuario ${name} creado`, 'ok');

  } catch (err) {
    console.error('[usuarios] Error creando:', err);
    showFormError('nu-error', mensajeServidor(err, 'Error al crear. Intenta de nuevo.'));
  } finally {
    setLoading('btn-crear-label', 'Crear usuario', false);
  }
}

// ── Asignar área ──────────────────────────────────
let asignarUID = null;

function asignar(uid) {
  asignarUID = uid;
  const u = usuarios.find(x => x.id === uid);
  if (!u) return;

  document.getElementById('sheet-asignar-title').textContent = `Asignar · ${u.displayName}`;

  // Resetear selección
  document.querySelectorAll('#asig-area-row .select-chip').forEach(c => c.classList.remove('active'));
  document.getElementById('asig-destino-wrap').style.display = 'none';
  document.getElementById('asig-error').textContent = '';

  // Pre-seleccionar si ya tiene asignación
  const asgn = u.asignacionActual;
  if (asgn?.area) {
    const chip = document.querySelector(`#asig-area-row [data-val="${asgn.area}"]`);
    if (chip) chip.classList.add('active');
    updateDestinoRow(asgn.area, asgn.destino);
  } else {
    const chip = document.querySelector('#asig-area-row [data-val="null"]');
    if (chip) chip.classList.add('active');
  }

  openSheet('sheet-asignar');
}

function updateDestinoRow(area, selectedDestino = null) {
  const wrap  = document.getElementById('asig-destino-wrap');
  const label = document.getElementById('asig-destino-label');
  const row   = document.getElementById('asig-destino-row');

  if (!area || area === 'null' || SIN_PAREJA[area]) {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = '';
  label.textContent = (area === 'CAMBIOS' || area === 'Caracterizacion' || area === 'Reclamos' || area === 'AMI') ? 'Pareja' : 'Supervisor';

  const destinos = DESTINOS[area] || [];
  // Cuántos técnicos activos ya están en cada pareja/destino de esa área
  // (con la lista ya cargada, sin leer más de Firestore)
  const ocupados = d => usuarios.filter(x => x.id !== asignarUID && x.active !== false
    && x.asignacionActual?.area === area && x.asignacionActual?.destino === d).length;
  row.innerHTML = destinos.map(d => {
    const n = ocupados(d);
    return `<div class="select-chip ${selectedDestino === d ? 'active' : ''}" data-val="${d}">${d}${n ? `<span class="us-chip-n">${n}</span>` : ''}</div>`;
  }).join('');

  setupSelectChips('asig-destino-row');
}

async function guardarAsignacion() {
  const area    = getSelectedChip('asig-area-row');
  const destino = SIN_PAREJA[area] || getSelectedChip('asig-destino-row');

  if (!area) {
    showFormError('asig-error', 'Selecciona un área.');
    return;
  }
  if (area !== 'null' && !destino) {
    showFormError('asig-error', (area === 'CAMBIOS' || area === 'Caracterizacion' || area === 'Reclamos' || area === 'AMI') ? 'Selecciona una pareja.' : 'Selecciona un supervisor.');
    return;
  }

  setLoading('btn-asig-label', 'Guardando…', true);

  try {
    const asignacionActual = area === 'null'
      ? null
      : { area, destino };

    await db.collection('users').doc(asignarUID).update({ asignacionActual });

    // Actualizar lista local
    const u = usuarios.find(x => x.id === asignarUID);
    if (u) u.asignacionActual = asignacionActual;

    closeSheet('sheet-asignar');
    renderLista();
    toast('Asignación guardada', 'ok');

  } catch (err) {
    console.error('[usuarios] Error asignando:', err);
    showFormError('asig-error', 'Error al guardar. Intenta de nuevo.');
  } finally {
    setLoading('btn-asig-label', 'Guardar asignación', false);
  }
}

// ── Activar / Desactivar ──────────────────────────
async function toggleActive(uid, currentlyActive) {
  const u      = usuarios.find(x => x.id === uid);
  const action = currentlyActive ? 'desactivar' : 'activar';
  if (!confirm(`¿${action.charAt(0).toUpperCase() + action.slice(1)} a ${u?.displayName}?`)) return;

  try {
    await db.collection('users').doc(uid).update({ active: !currentlyActive });
    if (u) u.active = !currentlyActive;

    renderLista();
    toast(`Usuario ${currentlyActive ? 'desactivado' : 'activado'}`, currentlyActive ? 'warn' : 'ok');
  } catch (err) {
    console.error('[usuarios] Error toggle:', err);
    toast('Error al actualizar', 'error');
  }
}

// ── Helpers ───────────────────────────────────────
function openSheet(id)  {
  document.getElementById(id).classList.add('open');
  document.body.style.overflow = 'hidden';
}
function closeSheet(id) {
  document.getElementById(id).classList.remove('open');
  document.body.style.overflow = '';
}

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
  const active = document.querySelector(`#${rowId} .select-chip.active`);
  return active?.dataset.val || null;
}

function showFormError(elId, msg) {
  const el = document.getElementById(elId);
  if (!el) return;
  el.textContent = msg;
  el.style.display = 'block';
}

function setLoading(labelId, text, loading) {
  const el = document.getElementById(labelId);
  if (!el) return;
  el.innerHTML = loading ? '<div class="spinner"></div>' : text;
  const btn = el.closest('button');
  if (btn) btn.disabled = loading;
}

function getInitials(name) {
  return (name || '?').split(' ').slice(0, 2).map(w => w[0]).join('').toUpperCase();
}

function getRoleLabel(role) {
  // Un rol mal escrito o vacío antes salía como "Técnico" pero sin poder
  // asignarse; ahora se ve el problema.
  return role === 'admin' ? 'Admin' : role === 'asistente' ? 'Asistente' : role === 'tecnico' ? 'Técnico'
    : `Rol no válido (${role ? escapeHtml(String(role)) : 'vacío'})`;
}

// Exponer funciones para los onclick del HTML
// ── Editar credenciales ───────────────────────────
let credUid_ = null;

function editarCredenciales(uid) {
  const u = usuarios.find(x => x.id === uid);
  if (!u) return;
  credUid_ = uid;
  document.getElementById('sheet-cred-title').textContent = `Credenciales · ${u.displayName}`;
  document.getElementById('cred-username').value = u.username || '';
  document.getElementById('cred-pin').value  = '';
  document.getElementById('cred-pin2').value = '';
  document.getElementById('cred-error').style.display = 'none';
  openSheet('sheet-credenciales');
}

async function guardarCredenciales() {
  const username = document.getElementById('cred-username').value.trim().toLowerCase();
  const pin      = document.getElementById('cred-pin').value;
  const pin2     = document.getElementById('cred-pin2').value;
  const errEl    = document.getElementById('cred-error');
  errEl.style.display = 'none';

  if (!username) { errEl.textContent = 'El username no puede estar vacío.'; errEl.style.display = 'block'; return; }
  if (pin && pin.length < 4) { errEl.textContent = 'El PIN debe tener al menos 4 dígitos.'; errEl.style.display = 'block'; return; }
  if (pin && pin !== pin2) { errEl.textContent = 'Los PINs no coinciden.'; errEl.style.display = 'block'; return; }

  const duplicado = usuarios.find(u => u.username === username && u.id !== credUid_);
  if (duplicado) { errEl.textContent = 'Ese username ya está en uso.'; errEl.style.display = 'block'; return; }

  setLoading('btn-cred-label', 'Guardando…', true);
  try {
    const update = { username };

    // El PIN lo guarda el servidor (protegido, fuera de la ficha del usuario)
    if (pin) await llamar('adminPin', { uid: credUid_, pin });

    // El login resuelve username -> uid + correo con la colección `usernames`.
    // Si cambia el username hay que registrar el nuevo (con el MISMO correo
    // interno de Firebase Auth, que no cambia) y borrar el viejo; antes solo
    // se cambiaba en `users` y el usuario ya no podía entrar con el nuevo.
    // Se registra primero el nuevo para no dejarlo sin forma de entrar.
    const previo = usuarios.find(u => u.id === credUid_);
    const viejo = previo?.username || '';
    if (viejo !== username) {
      let email = previo?.internalEmail || null;
      if (viejo) {
        const vDoc = await db.collection('usernames').doc(viejo).get().catch(() => null);
        if (vDoc?.exists && vDoc.data().email) email = vDoc.data().email;
      }
      email = email || `${viejo || username}@innova-stc.internal`;
      await db.collection('usernames').doc(username).set({ uid: credUid_, email });
    }

    await db.collection('users').doc(credUid_).update(update);
    if (viejo && viejo !== username) await db.collection('usernames').doc(viejo).delete().catch(() => {});

    const idx = usuarios.findIndex(u => u.id === credUid_);
    if (idx !== -1) usuarios[idx] = { ...usuarios[idx], ...update };
    closeSheet('sheet-credenciales');
    renderLista();
    toast('Credenciales actualizadas', 'ok');
  } catch(err) {
    errEl.textContent = mensajeServidor(err, `Error: ${err.message}`);
    errEl.style.display = 'block';
  } finally {
    setLoading('btn-cred-label', 'Guardar cambios', false);
  }
}

window.__usuarios = { asignar, toggleActive, editarCredenciales };
