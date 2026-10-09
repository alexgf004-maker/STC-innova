/**
 * js/auth.js
 * Maneja login, logout y verificación de sesión.
 * Cargado en login.html como módulo principal.
 */

import { db, auth, llamar, mensajeServidor } from './firebase.js';

const SESSION_KEY  = 'innova_session';
const REMEMBER_KEY = 'innova_remember_user';
const BASE_PATH    = '/STC-innova/';

// Redirigir si ya hay sesión
const existingSession = localStorage.getItem(SESSION_KEY);
if (existingSession) {
  window.location.replace(BASE_PATH);
}

// ── Elementos ─────────────────────────────────────
const inpUser    = document.getElementById('inp-user');
const inpPin     = document.getElementById('inp-pin');
const btnLogin   = document.getElementById('btn-login');
const btnLabel   = document.getElementById('btn-login-label');
const errEl      = document.getElementById('login-error');
const chkRemember = document.getElementById('chk-remember');

// Restaurar usuario recordado
const savedUser = localStorage.getItem(REMEMBER_KEY);
if (savedUser) {
  inpUser.value = savedUser;
  chkRemember.checked = true;
  inpPin.focus();
}

// ── Validación ────────────────────────────────────
function checkReady() {
  const userOk = inpUser.value.trim().length >= 2;
  const pinOk  = inpPin.value.length >= 4;
  btnLogin.disabled = !(userOk && pinOk);
}

inpUser.addEventListener('input', () => { clearError(); checkReady(); });
inpPin.addEventListener('input',  () => { clearError(); checkReady(); });

// Enter en PIN dispara login
inpPin.addEventListener('keydown', e => {
  if (e.key === 'Enter' && !btnLogin.disabled) doLogin();
});

// ── Error ─────────────────────────────────────────
function showError(msg) {
  errEl.textContent = msg;
  errEl.classList.add('show');
  inpUser.classList.add('error');
  inpPin.classList.add('error');
  inpPin.value = '';
  checkReady();
}

function clearError() {
  errEl.classList.remove('show');
  inpUser.classList.remove('error');
  inpPin.classList.remove('error');
}

// ── Login ─────────────────────────────────────────
btnLogin.addEventListener('click', doLogin);

function setLoading(loading) {
  btnLogin.disabled = loading;
  btnLabel.innerHTML = loading ? '<div class="spinner"></div>' : 'Ingresar';
  // Al terminar, el botón depende de los campos (tras un error el PIN se
  // borra y no debe quedar habilitado con el PIN vacío).
  if (!loading) checkReady();
}

async function doLogin() {
  const username = inpUser.value.trim().toLowerCase();
  const pin      = inpPin.value;
  if (!username || pin.length < 4) return;

  setLoading(true);
  clearError();

  try {
    // PASO 1 — El servidor revisa usuario y PIN (con límite de intentos) y
    // entrega un token de acceso. El PIN ya no se revisa en el teléfono.
    const { token } = await llamar('login', { username, pin });
    await auth.signInWithCustomToken(token);
    const uid = auth.currentUser.uid;

    // PASO 2 — Ya autenticado: leer el perfil completo
    const doc = await db.collection('users').doc(uid).get();
    if (!doc.exists) {
      await auth.signOut();
      showError('Usuario no encontrado');
      setLoading(false);
      return;
    }
    const data = doc.data();

    // Acceso concedido
    const session = {
      uid:         uid,
      username:    data.username,
      displayName: data.displayName,
      role:        data.role,
      asignacion:  data.asignacion || { area: null, pareja: null },
    };

    // Guardar o limpiar usuario recordado
    if (chkRemember.checked) {
      localStorage.setItem(REMEMBER_KEY, username);
    } else {
      localStorage.removeItem(REMEMBER_KEY);
    }

    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    window.location.replace(BASE_PATH);

  } catch (err) {
    console.error('[auth] Login error:', err);
    if (err.code === 'auth/network-request-failed') {
      showError('Sin conexión. Verifica tu internet.');
    } else if (String(err.code || '').startsWith('functions/')) {
      showError(mensajeServidor(err, 'Error al iniciar sesión. Intenta de nuevo.'));
    } else {
      showError('Error al iniciar sesión. Intenta de nuevo.');
    }
    setLoading(false);
  }
}
