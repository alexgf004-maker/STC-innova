/**
 * js/app.js
 * Punto de entrada principal — cargado por index.html.
 * Verifica sesión, configura topbar, inicia router.
 */

import { auth, db } from './firebase.js';
import { initRouter, navigateTo } from './router.js';

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

  // Refrescar datos del usuario desde Firestore
  // Así asignaciones y cambios de rol se reflejan sin cerrar sesión
  try {
    const doc = await db.collection('users').doc(session.uid).get();
    if (doc.exists) {
      const fresh = doc.data();
      session.role             = fresh.role;
      session.displayName      = fresh.displayName;
      session.asignacionActual = fresh.asignacionActual || null;
      // Actualizar localStorage con datos frescos
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    }
  } catch (err) {
    // Sin conexión — usar sesión cacheada
    console.warn('[app] Sin conexión, usando sesión cacheada');
  }

  splash.classList.add('hidden');
  appEl.style.display = 'flex';
  setupTopbar(session);
  initRouter(session);
  setTimeout(() => splash.remove(), 400);
});
