/**
 * js/app.js
 * Punto de entrada principal — cargado por index.html.
 * Verifica sesión, configura topbar, inicia router.
 */

import { auth, db } from './firebase.js';
import { initRouter, navigateTo } from './router.js';
import { hashPin, generateSalt } from './crypto.js';

const SESSION_KEY = 'innova_session';
const LOGIN_PATH  = '/STC-innova/login.html';

// Exponer navigateTo globalmente para los onclick de la navbar
window.__router = { navigateTo };

// ── Verificar sesión ──────────────────────────────
const raw = localStorage.getItem(SESSION_KEY);
if (!raw) {
  window.location.replace(LOGIN_PATH);
}

let session;
try {
  session = JSON.parse(raw);
} catch {
  localStorage.removeItem(SESSION_KEY);
  window.location.replace(LOGIN_PATH);
}

// ── Cerrar sesión ─────────────────────────────────
async function cerrarSesion() {
  try { await auth.signOut(); } catch {}
  localStorage.removeItem(SESSION_KEY);
  window.location.replace(LOGIN_PATH);
}

// ── Cambio de PIN ─────────────────────────────────
const PINS_PROHIBIDOS = ['1234','0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','4321','1212','123456','000000'];

function validarPinNuevo(pin, pinActual) {
  if (!/^\d{4,8}$/.test(pin))        return 'El PIN debe tener entre 4 y 8 dígitos.';
  if (PINS_PROHIBIDOS.includes(pin)) return 'Ese PIN es muy fácil de adivinar. Elige otro.';
  if (/^(\d)\1+$/.test(pin))         return 'No uses todos los dígitos iguales.';
  if (pin === pinActual)             return 'El PIN nuevo debe ser distinto al actual.';
  return null;
}

// obligatorio = true  -> pantalla bloqueante (primer ingreso)
// obligatorio = false -> con botón cancelar (cambio voluntario)
function abrirCambioPin(obligatorio) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:900;background:#0a1628;overflow-y:auto;display:flex;align-items:center;justify-content:center;padding:24px';
    ov.innerHTML = `
      <div style="width:100%;max-width:400px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="width:52px;height:52px;margin:0 auto 12px;border-radius:15px;background:linear-gradient(140deg,#2dd4bf,#0d9488);display:flex;align-items:center;justify-content:center">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26">
              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
          </div>
          <div style="font-size:19px;font-weight:800">${obligatorio ? 'Crea tu PIN personal' : 'Cambiar PIN'}</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:6px;line-height:1.5">
            ${obligatorio
              ? 'Todos comparten el mismo PIN de las pruebas. Define uno propio antes de continuar: con él confirmas la recepción de material.'
              : 'Elige un PIN nuevo. Solo tú debes conocerlo.'}
          </div>
        </div>

        <div style="background:var(--bg-card,#161f2e);border:1px solid var(--border);border-radius:16px;padding:20px">
          <div class="form-field">
            <div class="form-label">PIN actual</div>
            <input class="form-input" id="pin-actual" type="password" inputmode="numeric" maxlength="8" placeholder="El que usas ahora" autocomplete="off"/>
          </div>
          <div class="form-field">
            <div class="form-label">PIN nuevo</div>
            <input class="form-input" id="pin-nuevo" type="password" inputmode="numeric" maxlength="8" placeholder="4 a 8 dígitos" autocomplete="off"/>
          </div>
          <div class="form-field">
            <div class="form-label">Confirma el PIN nuevo</div>
            <input class="form-input" id="pin-conf" type="password" inputmode="numeric" maxlength="8" placeholder="Repítelo" autocomplete="off"/>
          </div>

          <div id="pin-error" class="form-error" style="margin-bottom:10px"></div>
          <button class="btn-primary full" id="pin-guardar"><span id="pin-guardar-lbl">Guardar PIN</span></button>

          ${obligatorio
            ? `<button id="pin-salir" style="width:100%;height:42px;margin-top:10px;border-radius:12px;border:none;background:transparent;color:var(--text-4);font-size:12px;font-weight:600;cursor:pointer;font-family:'Outfit',sans-serif">Cerrar sesión</button>`
            : `<button id="pin-cancelar" style="width:100%;height:44px;margin-top:10px;border-radius:12px;border:1px solid var(--border);background:transparent;color:var(--text-3);font-size:13px;font-weight:600;cursor:pointer;font-family:'Outfit',sans-serif">Cancelar</button>`}
        </div>
      </div>`;
    document.body.appendChild(ov);

    const errEl = ov.querySelector('#pin-error');
    const btn   = ov.querySelector('#pin-guardar');
    const lbl   = ov.querySelector('#pin-guardar-lbl');
    const mostrarError = (msg) => { errEl.textContent = msg; errEl.style.display = 'block'; };

    ov.querySelector('#pin-salir')?.addEventListener('click', cerrarSesion);
    ov.querySelector('#pin-cancelar')?.addEventListener('click', () => { ov.remove(); resolve(false); });

    btn.addEventListener('click', async () => {
      errEl.style.display = 'none';
      const actual = ov.querySelector('#pin-actual').value.trim();
      const nuevo  = ov.querySelector('#pin-nuevo').value.trim();
      const conf   = ov.querySelector('#pin-conf').value.trim();

      if (!actual)        return mostrarError('Ingresa tu PIN actual.');
      if (nuevo !== conf) return mostrarError('Los PIN nuevos no coinciden.');
      const err = validarPinNuevo(nuevo, actual);
      if (err) return mostrarError(err);

      btn.disabled = true;
      lbl.innerHTML = '<div class="spinner"></div>';

      try {
        // Verificar el PIN actual contra Firestore
        const doc = await db.collection('users').doc(session.uid).get();
        if (!doc.exists) throw new Error('No se encontró tu usuario.');
        const u = doc.data();
        const hashActual = await hashPin(u.pinSalt || '', actual);
        if (hashActual !== u.pinHash) {
          btn.disabled = false;
          lbl.textContent = 'Guardar PIN';
          return mostrarError('El PIN actual no es correcto.');
        }

        // Guardar el PIN nuevo con salt nuevo
        const saltNuevo = generateSalt();
        const hashNuevo = await hashPin(saltNuevo, nuevo);
        await db.collection('users').doc(session.uid).update({
          pinHash: hashNuevo,
          pinSalt: saltNuevo,
          pinChanged: true,
        });

        session.pinChanged = true;
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        ov.remove();
        resolve(true);
      } catch (e) {
        console.error('[app] Error cambiando PIN:', e);
        btn.disabled = false;
        lbl.textContent = 'Guardar PIN';
        mostrarError('No se pudo guardar: ' + e.message);
      }
    });

    setTimeout(() => ov.querySelector('#pin-actual')?.focus(), 120);
  });
}

// ── Modo mantenimiento ────────────────────────────
// Lee config/app { maintenance: true|false, maintenanceMsg: "..." }
// Si está activo y el usuario NO es admin, bloquea la app.
let mantenimientoActivo_ = false;

async function estaEnMantenimiento() {
  try {
    const doc = await db.collection('config').doc('app').get();
    if (!doc.exists) return { activo: false, msg: '' };
    const d = doc.data();
    return { activo: d.maintenance === true, msg: d.maintenanceMsg || '' };
  } catch (err) {
    // Si no se puede leer, NO bloquear (mejor dejar pasar que trancar a todos)
    console.warn('[app] No se pudo leer config de mantenimiento:', err);
    return { activo: false, msg: '' };
  }
}

// Enciende/apaga el mantenimiento (solo admin)
async function toggleMantenimiento() {
  const encender = !mantenimientoActivo_;
  const texto = encender
    ? 'Activar modo mantenimiento?\n\nLos técnicos y asistentes no podrán usar la app hasta que lo apagues.'
    : 'Desactivar modo mantenimiento?\n\nTodos podrán volver a usar la app.';
  if (!window.confirm(texto)) return;

  try {
    await db.collection('config').doc('app').set({ maintenance: encender }, { merge: true });
    mantenimientoActivo_ = encender;
    pintarEstadoMantenimiento();
  } catch (err) {
    console.error('[app] Error cambiando mantenimiento:', err);
    window.alert('No se pudo cambiar: ' + err.message);
  }
}

// Refresca el botón y la franja de aviso del admin
function pintarEstadoMantenimiento() {
  const btn = document.getElementById('btn-mant');
  if (btn) {
    btn.style.color       = mantenimientoActivo_ ? '#fbbf24' : '';
    btn.style.background  = mantenimientoActivo_ ? 'rgba(251,191,36,.14)' : '';
    btn.style.borderColor = mantenimientoActivo_ ? 'rgba(251,191,36,.4)'  : '';
    btn.title = mantenimientoActivo_ ? 'Mantenimiento ACTIVO — toca para apagar' : 'Activar mantenimiento';
  }

  document.getElementById('aviso-mant')?.remove();
  if (mantenimientoActivo_) {
    const aviso = document.createElement('div');
    aviso.id = 'aviso-mant';
    aviso.style.cssText = 'position:fixed;bottom:0;left:0;right:0;z-index:800;background:#fbbf24;color:#0a1628;text-align:center;padding:6px 12px;font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;cursor:pointer';
    aviso.textContent = 'Modo mantenimiento activo — solo tú puedes entrar. Toca para apagar.';
    aviso.addEventListener('click', toggleMantenimiento);
    document.body.appendChild(aviso);
  }
}

function mostrarPantallaMantenimiento(msg) {
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:1000;background:#0a1628;display:flex;align-items:center;justify-content:center;padding:28px;text-align:center';
  ov.innerHTML = `
    <div style="max-width:340px">
      <div style="width:60px;height:60px;margin:0 auto 18px;border-radius:17px;background:rgba(251,191,36,.12);border:1px solid rgba(251,191,36,.35);display:flex;align-items:center;justify-content:center">
        <svg viewBox="0 0 24 24" fill="none" stroke="#fbbf24" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="28" height="28">
          <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
        </svg>
      </div>
      <div style="font-size:20px;font-weight:800;margin-bottom:10px">Estamos actualizando</div>
      <div style="font-size:13px;color:var(--text-3);line-height:1.6;margin-bottom:24px">
        ${msg || 'El sistema está en mantenimiento por unos minutos. Vuelve a intentar más tarde.'}
      </div>
      <button id="mnt-reintentar" style="width:100%;height:46px;border-radius:12px;border:1px solid rgba(45,212,191,.35);background:rgba(45,212,191,.1);color:#2dd4bf;font-size:13px;font-weight:700;cursor:pointer;font-family:'Outfit',sans-serif;margin-bottom:8px">Reintentar</button>
      <button id="mnt-salir" style="width:100%;height:42px;border-radius:12px;border:none;background:transparent;color:var(--text-4);font-size:12px;font-weight:600;cursor:pointer;font-family:'Outfit',sans-serif">Cerrar sesión</button>
    </div>`;
  document.body.appendChild(ov);

  document.getElementById('mnt-reintentar').addEventListener('click', () => location.reload());
  document.getElementById('mnt-salir').addEventListener('click', async () => {
    try { await auth.signOut(); } catch {}
    localStorage.removeItem(SESSION_KEY);
    window.location.replace(LOGIN_PATH);
  });
}

// ── Configurar topbar ─────────────────────────────
function setupTopbar(session) {
  const { displayName, role, asignacionActual } = session;
  const area = asignacionActual?.area || null;

  document.getElementById('topbar-name').textContent = displayName;
  document.getElementById('topbar-sub').textContent  = getSubtitle(role, area);

  // Botón refresh para admin y asistente
  if (role === 'admin' || role === 'asistente') {
    document.getElementById('btn-refresh').style.display = '';
    document.getElementById('btn-refresh').addEventListener('click', () => {
      navigateTo(window.__router.currentTab || 'home');
    });
  }

  // Botón de mantenimiento — SOLO admin
  if (role === 'admin') {
    const acciones  = document.querySelector('.topbar-actions');
    const btnLogout = document.getElementById('btn-logout');
    if (acciones && btnLogout && !document.getElementById('btn-mant')) {
      const btnMant = document.createElement('div');
      btnMant.className = 'topbar-btn';
      btnMant.id = 'btn-mant';
      btnMant.innerHTML = `
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17">
          <path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>
        </svg>`;
      btnMant.addEventListener('click', toggleMantenimiento);
      acciones.insertBefore(btnMant, btnLogout);
    }
  }

  // Botón "Cambiar PIN" — todos los roles
  const acc  = document.querySelector('.topbar-actions');
  const salir = document.getElementById('btn-logout');
  if (acc && salir && !document.getElementById('btn-pin')) {
    const btnPin = document.createElement('div');
    btnPin.className = 'topbar-btn';
    btnPin.id = 'btn-pin';
    btnPin.title = 'Cambiar PIN';
    btnPin.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17">
        <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
      </svg>`;
    btnPin.addEventListener('click', () => abrirCambioPin(false));
    acc.insertBefore(btnPin, salir);
  }
}

function getSubtitle(role, area) {
  if (role === 'admin')     return 'Coordinadora · Vista ejecutiva';
  if (role === 'asistente') return 'Asistente · Operación diaria';
  if (role === 'tecnico') {
    if (!area) return 'Técnico · Sin asignación hoy';
    return `Técnico · Área ${area}`;
  }
  return 'INNOVA STC';
}

// ── Logout ────────────────────────────────────────
document.getElementById('btn-logout').addEventListener('click', async () => {
  if (!window.confirm('¿Cerrar sesión?')) return;
  try { await auth.signOut(); } catch {}
  localStorage.removeItem(SESSION_KEY);
  window.location.replace(LOGIN_PATH);
});

// ── Splash + arranque ─────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const splash = document.getElementById('splash');
  const appEl  = document.getElementById('app');

  let debeCambiarPin = false;

  // Refrescar datos del usuario desde Firestore
  // Así asignaciones y cambios de rol se reflejan sin cerrar sesión
  try {
    const doc = await db.collection('users').doc(session.uid).get();
    if (doc.exists) {
      const fresh = doc.data();
      session.role             = fresh.role;
      session.displayName      = fresh.displayName;
      session.asignacionActual = fresh.asignacionActual || null;
      session.pinChanged       = fresh.pinChanged === true;
      // Actualizar localStorage con datos frescos
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));

      // Nunca ha personalizado su PIN -> obligarlo
      debeCambiarPin = fresh.pinChanged !== true;
    }
  } catch (err) {
    // Sin conexión — usar sesión cacheada, no bloquear el acceso
    console.warn('[app] Sin conexión, usando sesión cacheada');
  }

  splash.classList.add('hidden');

  // ── Muro de mantenimiento (todos menos admin) ──
  const mnt = await estaEnMantenimiento();
  mantenimientoActivo_ = mnt.activo;

  if (mnt.activo && session.role !== 'admin') {
    splash.remove();
    mostrarPantallaMantenimiento(mnt.msg);
    return;   // no se monta la app
  }

  appEl.style.display = 'flex';
  setupTopbar(session);

  // ── PIN obligatorio: bloquea hasta que defina uno propio ──
  if (debeCambiarPin) {
    await abrirCambioPin(true);
    setupTopbar(session);
  }

  initRouter(session);

  // Pinta el botón y la franja según el estado (solo relevante para admin)
  if (session.role === 'admin') pintarEstadoMantenimiento();

  setTimeout(() => splash.remove(), 400);
});
