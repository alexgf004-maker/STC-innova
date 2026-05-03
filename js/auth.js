/**
 * js/auth.js
 * Maneja login, logout y verificación de sesión.
 * Cargado en login.html como módulo principal.
 */

import { db, auth } from './firebase.js';
import { hashPin, derivePassword, SEED } from './crypto.js';

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
}

async function doLogin() {
  const username = inpUser.value.trim().toLowerCase();
  const pin      = inpPin.value;
  if (!username || pin.length < 4) return;

  setLoading(true);
  clearError();

  try {
    // PASO 1 — Buscar usuario en Firestore
    const snap = await db.collection('users')
      .where('username', '==', username)
      .where('active', '==', true)
      .limit(1)
      .get();

    if (snap.empty) {
      showError('Usuario no encontrado o desactivado');
      setLoading(false);
      return;
    }

    const docRef = snap.docs[0];
    const data   = docRef.data();

    // PASO 2 — Firebase Auth con contraseña derivada
    const email    = `${username}@innova-stc.internal`;
    const password = await derivePassword(docRef.id, SEED);
    await auth.signInWithEmailAndPassword(email, password);

    // PASO 3 — Verificar PIN: hashPin(salt, pin)
    const hash = await hashPin(data.pinSalt || '', pin);
    if (hash !== data.pinHash) {
      await auth.signOut();
      showError('PIN incorrecto');
      setLoading(false);
      return;
    }

    // ✅ Acceso concedido
    const session = {
      uid:         docRef.id,
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
    } else if (err.code === 'auth/too-many-requests') {
      showError('Demasiados intentos. Espera un momento.');
    } else {
      showError('Error al iniciar sesión. Intenta de nuevo.');
    }
    setLoading(false);
  }
}
