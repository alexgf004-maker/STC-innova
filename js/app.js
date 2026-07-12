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
  initRouter(session);

  // Pinta el botón y la franja según el estado (solo relevante para admin)
  if (session.role === 'admin') pintarEstadoMantenimiento();

  setTimeout(() => splash.remove(), 400);
});
