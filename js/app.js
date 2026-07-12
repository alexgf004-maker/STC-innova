/**
 * js/app.js
 * Punto de entrada principal — cargado por index.html.
 * Verifica sesión, obliga cambio de PIN inicial, configura topbar, inicia router.
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

// ── Validación del PIN nuevo ──────────────────────
const PINS_PROHIBIDOS = ['1234','0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','4321','1212','123456','000000'];

function validarPinNuevo(pin, pinActual) {
  if (!/^\d{4,8}$/.test(pin))        return 'El PIN debe tener entre 4 y 8 dígitos.';
  if (PINS_PROHIBIDOS.includes(pin)) return 'Ese PIN es muy facil de adivinar. Elige otro.';
  if (/^(\d)\1+$/.test(pin))         return 'No uses todos los digitos iguales.';
  if (pin === pinActual)             return 'El PIN nuevo debe ser distinto al actual.';
  return null;
}

// ── Pantalla de cambio de PIN ─────────────────────
// obligatorio = true  -> no se puede cerrar (primer ingreso)
// obligatorio = false -> tiene boton cancelar (cambio voluntario)
function abrirCambioPin(obligatorio) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:900;background:#0a1628;overflow-y:auto;display:flex;align-items:center;justify-content:center;padding:24px';
    ov.innerHTML = `
      <div style="width:100%;max-width:400px">

        <div style="text-align:center;margin-bottom:26px">
          <div style="width:52px;height:52px;margin:0 auto 12px;border-radius:15px;background:linear-gradient(140deg,#2dd4bf,#0d9488);display:flex;align-items:center;justify-content:center">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26">
              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
          </div>
          <div style="font-size:19px;font-weight:800">${obligatorio ? 'Cambia tu PIN' : 'Cambiar PIN'}</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:6px;line-height:1.5">
            ${obligatorio
              ? 'Por seguridad debes definir un PIN personal antes de continuar. Con el confirmaras la recepcion de material.'
              : 'Elige un PIN nuevo. Solo tu debes conocerlo.'}
          </div>
        </div>

        <div style="background:var(--bg-card,#161f2e);border:1px solid var(--border);border-radius:16px;padding:20px">
          <div class="form-field">
            <div class="form-label">PIN actual</div>
            <input class="form-input" id="pin-actual" type="password" inputmode="numeric" maxlength="8" placeholder="Tu PIN de ahora" autocomplete="off"/>
          </div>
          <div class="form-field">
            <div class="form-label">PIN nuevo</div>
            <input class="form-input" id="pin-nuevo" type="password" inputmode="numeric" maxlength="8" placeholder="4 a 8 digitos" autocomplete="off"/>
          </div>
          <div class="form-field">
            <div class="form-label">Confirma el PIN nuevo</div>
            <input class="form-input" id="pin-conf" type="password" inputmode="numeric" maxlength="8" placeholder="Repitelo" autocomplete="off"/>
          </div>

          <div id="pin-error" class="form-error" style="margin-bottom:10px"></div>

          <button class="btn-primary full" id="pin-guardar"><span id="pin-guardar-lbl">Guardar PIN</span></button>

          ${obligatorio
            ? `<button id="pin-salir" style="width:100%;height:42px;margin-top:10px;border-radius:12px;border:none;background:transparent;color:var(--text-4);font-size:12px;font-weight:600;cursor:pointer;font-family:'Outfit',sans-serif">Cerrar sesion</button>`
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

      if (!actual) return mostrarError('Ingresa tu PIN actual.');
      if (nuevo !== conf) return mostrarError('Los PIN nuevos no coinciden.');
      const err = validarPinNuevo(nuevo, actual);
      if (err) return mostrarError(err);

      btn.disabled = true;
      lbl.innerHTML = '<div class="spinner"></div>';

      try {
        // 1. Verificar el PIN actual contra Firestore
        const doc = await db.collection('users').doc(session.uid).get();
        if (!doc.exists) throw new Error('No se encontro tu usuario.');
        const u = doc.data();
        const hashActual = await hashPin(u.pinSalt, actual);
        if (hashActual !== u.pinHash) {
          btn.disabled = false;
          lbl.textContent = 'Guardar PIN';
          return mostrarError('El PIN actual no es correcto.');
        }

        // 2. Guardar el PIN nuevo con salt nuevo
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

// ── Configurar topbar ─────────────────────────────
function setupTopbar(session) {
  const { displayName, role, asignacionActual } = session;
  const area = asignacionActual?.area || null;

  document.getElementById('topbar-name').textContent = displayName;
  document.getElementById('topbar-sub').textContent  = getSubtitle(role, area);

  // Boton refresh para admin y asistente
  if (role === 'admin' || role === 'asistente') {
    document.getElementById('btn-refresh').style.display = '';
    document.getElementById('btn-refresh').addEventListener('click', () => {
      navigateTo(window.__router.currentTab || 'home');
    });
  }

  // Boton "Cambiar PIN" (todos los roles) — se inserta antes del de salir
  const acciones  = document.querySelector('.topbar-actions');
  const btnLogout = document.getElementById('btn-logout');
  if (acciones && btnLogout && !document.getElementById('btn-pin')) {
    const btnPin = document.createElement('div');
    btnPin.className = 'topbar-btn';
    btnPin.id = 'btn-pin';
    btnPin.title = 'Cambiar PIN';
    btnPin.innerHTML = `
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17">
        <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
      </svg>`;
    btnPin.addEventListener('click', () => abrirCambioPin(false));
    acciones.insertBefore(btnPin, btnLogout);
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
  await cerrarSesion();
});

// ── Splash + arranque ─────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const splash = document.getElementById('splash');
  const appEl  = document.getElementById('app');

  let debeCambiarPin = false;

  // Refrescar datos del usuario desde Firestore
  // Asi asignaciones y cambios de rol se reflejan sin cerrar sesion
  try {
    const doc = await db.collection('users').doc(session.uid).get();
    if (doc.exists) {
      const fresh = doc.data();
      session.role             = fresh.role;
      session.displayName      = fresh.displayName;
      session.asignacionActual = fresh.asignacionActual || null;
      session.pinChanged       = fresh.pinChanged === true;
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));

      // Nunca ha cambiado su PIN inicial -> obligarlo
      debeCambiarPin = fresh.pinChanged !== true;
    }
  } catch (err) {
    // Sin conexion — usar sesion cacheada, no bloquear el acceso
    console.warn('[app] Sin conexión, usando sesión cacheada');
  }

  splash.classList.add('hidden');
  appEl.style.display = 'flex';
  setupTopbar(session);

  // Bloquear la app hasta que cambie el PIN inicial
  if (debeCambiarPin) {
    await abrirCambioPin(true);
    setupTopbar(session);
  }

  initRouter(session);
  setTimeout(() => splash.remove(), 400);
});
