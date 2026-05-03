/**
 * js/auth.js
 * Maneja login, logout y verificación de sesión.
 * Este archivo se carga en login.html como módulo principal.
 *
 * Flujo de autenticación:
 * 1. Buscar username en Firestore (colección 'users')
 * 2. signInWithEmailAndPassword con contraseña derivada
 * 3. Verificar PIN con hashPin(salt, pin)
 * 4. Guardar sesión en localStorage
 */

import { db, auth } from './firebase.js';
import { hashPin, derivePassword, SEED } from './crypto.js';

const SESSION_KEY = 'innova_session';
const BASE_PATH   = '/innova-stc-v2/';

// ── Verificar si ya hay sesión activa ────────────
const existingSession = localStorage.getItem(SESSION_KEY);
if (existingSession) {
  window.location.replace(BASE_PATH);
}

// ── Estado del PIN ────────────────────────────────
let pinValue = '';

const inpUser   = document.getElementById('inp-user');
const btnLogin  = document.getElementById('btn-login');
const btnLabel  = document.getElementById('btn-login-label');
const errEl     = document.getElementById('login-error');
const pinDigits = document.querySelectorAll('.pin-digit');

// ── Actualizar display del PIN ────────────────────
function updatePinDisplay() {
  pinDigits.forEach((el, i) => {
    el.classList.toggle('filled', i < pinValue.length);
    el.classList.toggle('active', i === pinValue.length);
    el.classList.remove('error');
  });
  checkReady();
}

function checkReady() {
  const userOk = inpUser.value.trim().length >= 2;
  const pinOk  = pinValue.length >= 4;
  btnLogin.disabled = !(userOk && pinOk);
}

// ── Teclado numérico ──────────────────────────────
document.querySelectorAll('.numpad-key[data-n]').forEach(key => {
  key.addEventListener('click', () => {
    if (pinValue.length < 8) {
      pinValue += key.dataset.n;
      updatePinDisplay();
    }
  });
});

document.getElementById('pin-del').addEventListener('click', () => {
  if (pinValue.length > 0) {
    pinValue = pinValue.slice(0, -1);
    updatePinDisplay();
  }
});

inpUser.addEventListener('input', () => {
  clearError();
  checkReady();
});

// ── Mostrar / limpiar error ───────────────────────
function showError(msg) {
  errEl.textContent = msg;
  errEl.classList.add('show');
  inpUser.classList.add('error');
  pinDigits.forEach(d => d.classList.add('error'));
  pinValue = '';
  setTimeout(updatePinDisplay, 300);
}

function clearError() {
  errEl.classList.remove('show');
  inpUser.classList.remove('error');
}

// ── Botón de login ────────────────────────────────
btnLogin.addEventListener('click', doLogin);

function setLoading(loading) {
  btnLogin.disabled = loading;
  btnLabel.innerHTML = loading
    ? '<div class="spinner"></div>'
    : 'Ingresar';
}

async function doLogin() {
  const username = inpUser.value.trim().toLowerCase();
  if (!username || pinValue.length < 4) return;

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

    // PASO 3 — Verificar PIN
    const hash = await hashPin(data.pinSalt || '', pinValue);
    if (hash !== data.pinHash) {
      await auth.signOut();
      showError('PIN incorrecto');
      setLoading(false);
      return;
    }

    // ✅ Acceso concedido — guardar sesión y redirigir
    const session = {
      uid:         docRef.id,
      username:    data.username,
      displayName: data.displayName,
      role:        data.role,
      asignacion:  data.asignacion || { area: null, pareja: null },
    };

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

// ── Init ──────────────────────────────────────────
updatePinDisplay();
