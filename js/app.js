/**
 * js/app.js
 * Punto de entrada principal — cargado por index.html.
 * Verifica sesión, configura topbar, inicia router.
 */

import { auth } from './firebase.js';
import { initRouter, navigateTo } from './router.js';
import { toast } from './ui.js';

const SESSION_KEY = 'innova_session';
const LOGIN_PATH = '/STC-innova/login.html';
// Exponer navigateTo globalmente para los onclick de la navbar
window.__router = { navigateTo };

// ── Verificar sesión ──────────────────────────────
const raw = localStorage.getItem(SESSION_KEY);
if (!raw) {
  window.location.replace(LOGIN_PATH);
  throw new Error('No session'); // detiene ejecución
}

let session;
try {
  session = JSON.parse(raw);
} catch {
  localStorage.removeItem(SESSION_KEY);
  window.location.replace(LOGIN_PATH);
  throw new Error('Invalid session');
}

// ── Configurar topbar ─────────────────────────────
function setupTopbar(session) {
  const { displayName, role, asignacion } = session;
  const area = asignacion?.area;

  document.getElementById('topbar-name').textContent = displayName;
  document.getElementById('topbar-sub').textContent  = getSubtitle(role, area);

  // Botón refresh solo para madelyn
  if (role === 'madelyn') {
    document.getElementById('btn-refresh').style.display = '';
    document.getElementById('btn-refresh').addEventListener('click', () => {
      navigateTo(window.__router.currentTab || 'home');
    });
  }
}

function getSubtitle(role, area) {
  if (role === 'madelyn')   return 'Coordinadora · Vista ejecutiva';
  if (role === 'asistente') return 'Asistente · Operación diaria';
  if (role === 'tecnico') {
    if (!area) return 'Técnico · Sin asignación hoy';
    return `Técnico · Área ${area}`;
  }
  return 'INNOVA STC v2';
}

// ── Logout ────────────────────────────────────────
document.getElementById('btn-logout').addEventListener('click', async () => {
  if (!window.confirm('¿Cerrar sesión?')) return;
  try {
    await auth.signOut();
  } catch {}
  localStorage.removeItem(SESSION_KEY);
  window.location.replace(LOGIN_PATH);
});

// ── Splash + arranque ─────────────────────────────
window.addEventListener('DOMContentLoaded', () => {
  const splash = document.getElementById('splash');
  const appEl  = document.getElementById('app');

  // Mínimo 600ms de splash para evitar flash
  setTimeout(() => {
    splash.classList.add('hidden');
    appEl.style.display = 'flex';

    setupTopbar(session);
    initRouter(session);

    setTimeout(() => splash.remove(), 400);
  }, 600);
});
