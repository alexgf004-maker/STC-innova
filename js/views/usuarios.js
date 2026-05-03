/**
 * js/views/usuarios.js
 * Gestión de usuarios — listado, asignación diaria, crear, activar/desactivar.
 * Exporta: init(container, session)
 */

import { db, auth, SEED } from '../firebase.js';
import { hashPin, derivePassword, generateSalt } from '../crypto.js';
import { toast } from '../ui.js';

const AREAS    = ['CAMBIOS', 'OTC'];
const DESTINOS = {
  CAMBIOS: ['Pareja 1', 'Pareja 2', 'Pareja 3', 'Pareja 4'],
  OTC:     ['NALVAR', 'RGONZA', 'JPEREZ'],
};
const ROLES = ['tecnico', 'asistente', 'admin'];

let container_, session_;
let usuarios = [];

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
    <div class="flex-col gap-12" style="padding-top:4px">

      <!-- Header -->
      <div class="usuarios-header anim-up">
        <div>
          <div class="section-title">Usuarios</div>
          <div class="section-sub" id="usuarios-count">Cargando…</div>
        </div>
        <button class="btn-primary" id="btn-nuevo-usuario">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14">
            <line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          Nuevo
        </button>
      </div>

      <!-- Filtros -->
      <div class="filter-row anim-up d1" id="filter-row">
        <div class="filter-chip active" data-filter="todos">Todos</div>
        <div class="filter-chip" data-filter="tecnico">Técnicos</div>
        <div class="filter-chip" data-filter="asistente">Asistentes</div>
        <div class="filter-chip" data-filter="admin">Admin</div>
      </div>

      <!-- Lista -->
      <div id="usuarios-list" class="flex-col gap-8 anim-up d2">
        <div class="loading-placeholder">
          <div class="loading-bar"></div>
          <div class="loading-bar short"></div>
          <div class="loading-bar"></div>
          <div class="loading-bar short"></div>
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
            <div class="form-label">Username</div>
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
              <div class="select-chip" data-val="admin">Admin</div>
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
              <div class="select-chip" data-val="OTC">OTC</div>
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
  `;

  // Eventos
  document.getElementById('btn-nuevo-usuario').addEventListener('click', () => openSheet('sheet-nuevo'));
  document.getElementById('btn-crear-usuario').addEventListener('click', crearUsuario);
  document.getElementById('btn-guardar-asig').addEventListener('click', guardarAsignacion);

  // Filtros
  document.querySelectorAll('.filter-chip').forEach(chip => {
    chip.addEventListener('click', () => {
      document.querySelectorAll('.filter-chip').forEach(c => c.classList.remove('active'));
      chip.classList.add('active');
      renderLista(chip.dataset.filter);
    });
  });

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
  ['sheet-nuevo', 'sheet-asignar'].forEach(id => {
    const el = document.getElementById(id);
    el.addEventListener('click', e => {
      if (e.target === el) closeSheet(id);
    });
  });
}

// ── Cargar usuarios ───────────────────────────────
async function loadUsuarios() {
  try {
    const snap = await db.collection('users').orderBy('displayName').get();
    usuarios = snap.docs.map(doc => ({ id: doc.id, ...doc.data() }));

    const total = usuarios.length;
    const activos = usuarios.filter(u => u.active).length;
    document.getElementById('usuarios-count').textContent = `${activos} activos · ${total} total`;

    renderLista('todos');
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
function renderLista(filtro) {
  const list = document.getElementById('usuarios-list');
  let filtered = filtro === 'todos'
    ? usuarios
    : usuarios.filter(u => u.role === filtro);

  if (!filtered.length) {
    list.innerHTML = `<div class="dev-module"><div class="dev-title">Sin usuarios</div><p>No hay usuarios con este filtro.</p></div>`;
    return;
  }

  list.innerHTML = filtered.map(u => {
    const asgn  = u.asignacionActual;
    const area  = asgn?.area || null;
    const dest  = asgn?.destino || null;
    const color = area === 'CAMBIOS' ? 'cm' : area === 'OTC' ? 'otc' : '';

    return `
      <div class="user-card ${u.active ? '' : 'inactive'}" data-uid="${u.id}">
        <div class="user-card-left">
          <div class="user-avatar ${color}">${getInitials(u.displayName)}</div>
          <div class="user-info">
            <div class="user-name">${u.displayName}</div>
            <div class="user-meta">
              <span class="role-badge ${u.role}">${getRoleLabel(u.role)}</span>
              ${!u.active ? '<span class="inactive-badge">Inactivo</span>' : ''}
            </div>
            ${u.role === 'tecnico' ? `
              <div class="user-asign ${color}">
                ${area
                  ? `<span>${area}</span><span class="dot-sep">·</span><span>${dest || '—'}</span>`
                  : '<span class="sin-asign">Sin asignación hoy</span>'}
              </div>` : ''}
          </div>
        </div>
        <div class="user-card-actions">
          ${u.role === 'tecnico' ? `
            <button class="icon-btn" onclick="window.__usuarios.asignar('${u.id}')" title="Asignar área">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
                <path d="M17 3a2.828 2.828 0 114 4L7.5 20.5 2 22l1.5-5.5L17 3z"/>
              </svg>
            </button>` : ''}
          <button class="icon-btn ${u.active ? 'danger' : 'ok'}"
                  onclick="window.__usuarios.toggleActive('${u.id}', ${u.active})"
                  title="${u.active ? 'Desactivar' : 'Activar'}">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16">
              ${u.active
                ? '<circle cx="12" cy="12" r="10"/><line x1="8" y1="8" x2="16" y2="16"/><line x1="16" y1="8" x2="8" y2="16"/>'
                : '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>'}
            </svg>
          </button>
        </div>
      </div>
    `;
  }).join('');
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
    const email    = `${user}@innova-stc.internal`;
    const salt     = generateSalt();
    const pinHash  = await hashPin(salt, pin);

    // Crear en Firebase Auth con app secundaria para no perder sesión
    const secondaryApp = firebase.app.length > 1
      ? firebase.app('secondary')
      : firebase.initializeApp(firebase.app().options, 'secondary');

    const secondaryAuth = secondaryApp.auth();
    const tempPass = Math.random().toString(36).slice(2) + 'Aa1!'; // temp
    const cred = await secondaryAuth.createUserWithEmailAndPassword(email, tempPass);
    const uid  = cred.user.uid;

    // Derivar contraseña real y actualizar
    const realPass = await derivePassword(uid, SEED);
    await cred.user.updatePassword(realPass);
    await secondaryAuth.signOut();

    // Crear documento en Firestore
    await db.collection('users').doc(uid).set({
      uid,
      username:      user,
      displayName:   name,
      internalEmail: email,
      role,
      active:        true,
      pinHash,
      pinSalt:       salt,
      asignacionActual: null,
      usuarioOperativoAsignado: null,
      createdAt:     firebase.firestore.FieldValue.serverTimestamp(),
      createdBy:     session_.uid,
    });

    // Actualizar lista local
    usuarios.push({
      id: uid, uid, username: user, displayName: name,
      role, active: true, asignacionActual: null,
    });

    const total   = usuarios.length;
    const activos = usuarios.filter(u => u.active).length;
    document.getElementById('usuarios-count').textContent = `${activos} activos · ${total} total`;

    closeSheet('sheet-nuevo');
    document.getElementById('nu-name').value = '';
    document.getElementById('nu-user').value = '';
    document.getElementById('nu-pin').value  = '';

    renderLista(document.querySelector('.filter-chip.active')?.dataset.filter || 'todos');
    toast(`Usuario ${name} creado`, 'ok');

  } catch (err) {
    console.error('[usuarios] Error creando:', err);
    if (err.code === 'auth/email-already-in-use') {
      showFormError('nu-error', 'Ese username ya existe en el sistema.');
    } else {
      showFormError('nu-error', 'Error al crear. Intenta de nuevo.');
    }
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

  document.getElementById('sheet-asignar-title').textContent = `Asignar: ${u.displayName}`;

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

  if (!area || area === 'null') {
    wrap.style.display = 'none';
    return;
  }

  wrap.style.display = '';
  label.textContent = area === 'CAMBIOS' ? 'Pareja' : 'Supervisor';

  const destinos = DESTINOS[area] || [];
  row.innerHTML = destinos.map(d => `
    <div class="select-chip ${selectedDestino === d ? 'active' : ''}" data-val="${d}">${d}</div>
  `).join('');

  setupSelectChips('asig-destino-row');
}

async function guardarAsignacion() {
  const area    = getSelectedChip('asig-area-row');
  const destino = getSelectedChip('asig-destino-row');

  if (!area) {
    showFormError('asig-error', 'Selecciona un área.');
    return;
  }
  if (area !== 'null' && !destino) {
    showFormError('asig-error', area === 'CAMBIOS' ? 'Selecciona una pareja.' : 'Selecciona un supervisor.');
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
    renderLista(document.querySelector('.filter-chip.active')?.dataset.filter || 'todos');
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

    const activos = usuarios.filter(x => x.active).length;
    document.getElementById('usuarios-count').textContent = `${activos} activos · ${usuarios.length} total`;

    renderLista(document.querySelector('.filter-chip.active')?.dataset.filter || 'todos');
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
  return role === 'admin' ? 'Admin' : role === 'asistente' ? 'Asistente' : 'Técnico';
}

// Exponer funciones para los onclick del HTML
window.__usuarios = { asignar, toggleActive };
