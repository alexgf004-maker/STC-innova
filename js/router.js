/**
 * js/router.js
 * Navegación entre tabs y renderizado de vistas.
 * Cada vista exporta init(container, session).
 */

import { getNavIcon } from './ui.js';

const NAV_CONFIGS = {
  admin: [
    { id: 'home',     label: 'Dashboard', icon: 'home' },
    { id: 'cambios',  label: 'Cambios',   icon: 'zap',   color: 'cm'  },
    { id: 'otc',      label: 'OTC',       icon: 'bolt',  color: 'otc' },
    { id: 'bodega',   label: 'Bodega',    icon: 'box'  },
    { id: 'usuarios', label: 'Usuarios',  icon: 'users' },
  ],
  asistente: [
    { id: 'home',     label: 'Dashboard', icon: 'home' },
    { id: 'cambios',  label: 'Cambios',   icon: 'zap',   color: 'cm'  },
    { id: 'otc',      label: 'OTC',       icon: 'bolt',  color: 'otc' },
    { id: 'bodega',   label: 'Bodega',    icon: 'box'  },
    { id: 'usuarios', label: 'Usuarios',  icon: 'users' },
  ],
  tecnico_cambios: [
    { id: 'home',    label: 'Inicio',  icon: 'home' },
    { id: 'cambios', label: 'Órdenes', icon: 'list', color: 'cm' },
    { id: 'mapa',    label: 'Mapa',    icon: 'map',  color: 'cm' },
    { id: 'bodega',  label: 'Bodega',  icon: 'box'  },
  ],
  tecnico_otc: [
    { id: 'home',    label: 'Inicio',  icon: 'home' },
    { id: 'otc',     label: 'Órdenes', icon: 'list', color: 'otc' },
    { id: 'otc_mapa',label: 'Mapa',    icon: 'map',  color: 'otc' },
    { id: 'bodega',  label: 'Bodega',  icon: 'box'  },
  ],
  tecnico_none: [
    { id: 'home', label: 'Inicio', icon: 'home' },
  ],
};

const viewCache   = {};
let currentTab    = null;
let currentSession = null;
const contentArea = document.getElementById('content-area');
const navbar      = document.getElementById('navbar');

export function initRouter(session) {
  currentSession = session;
  buildNavbar(session);
  navigateTo('home');
}

export async function navigateTo(tabId) {
  if (currentTab === tabId && tabId !== 'otc_mapa') return;

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tabId);
  });

  // otc_mapa — renderiza mapa OTC directamente
  if (tabId === 'otc_mapa') {
    currentTab = tabId;
    window.__router.currentTab = tabId;
    contentArea.scrollTop = 0;
    contentArea.innerHTML = '';
    try {
      if (!viewCache['otc']) viewCache['otc'] = await import('./views/otc.js');
      await viewCache['otc'].initConTab(contentArea, currentSession, 'mapa');
    } catch (err) {
      console.warn('[router] Error cargando otc_mapa:', err.message);
    }
    return;
  }

  // Guardar contenido actual por si falla offline
  const prevContent = contentArea.innerHTML;
  const prevTab     = currentTab;

  currentTab = tabId;
  window.__router.currentTab = tabId;

  // Solo limpiar si hay que cargar el módulo (no está en caché)
  if (!viewCache[tabId]) {
    contentArea.innerHTML = `
      <div style="padding:32px 20px;text-align:center">
        <div class="spinner" style="margin:0 auto 12px"></div>
        <p style="font-size:12px;color:var(--text-4)">Cargando…</p>
      </div>`;
  }

  try {
    if (!viewCache[tabId]) {
      viewCache[tabId] = await import(`./views/${tabId}.js`);
    }
    contentArea.scrollTop = 0;
    contentArea.innerHTML = '';
    viewCache[tabId].init(contentArea, currentSession);
  } catch (err) {
    console.warn(`[router] Vista '${tabId}' error:`, err.message);

    // Si es error de red/offline y había contenido previo, restaurarlo
    if (!navigator.onLine && prevContent) {
      currentTab = prevTab;
      window.__router.currentTab = prevTab;
      contentArea.innerHTML = prevContent;
      // Restaurar nav item activo
      document.querySelectorAll('.nav-item').forEach(el => {
        el.classList.toggle('active', el.dataset.tab === prevTab);
      });
      // Mostrar toast de offline
      const t = document.createElement('div');
      t.style.cssText = 'position:fixed;bottom:90px;left:50%;transform:translateX(-50%);background:#1f2937;color:#9ca3af;border:1px solid #374151;padding:10px 20px;border-radius:20px;font-size:12px;font-weight:600;z-index:9999;font-family:Outfit,sans-serif;white-space:nowrap';
      t.textContent = '📵 Sin señal — usando datos guardados';
      document.body.appendChild(t);
      setTimeout(() => t.remove(), 3000);
      return;
    }

    // Si el módulo simplemente no existe
    contentArea.innerHTML = `
      <div class="dev-module anim-up" style="margin-top:16px">
        <div class="dev-title">Módulo en desarrollo</div>
        <p>La sección <strong>${tabId}</strong> estará disponible próximamente.</p>
      </div>
    `;
  }
}

function buildNavbar(session) {
  const { role, asignacionActual } = session;
  const area = asignacionActual?.area || null;

  let configKey = role;
  if (role === 'tecnico') {
    configKey = area === 'CAMBIOS' ? 'tecnico_cambios'
              : area === 'OTC'     ? 'tecnico_otc'
              : 'tecnico_none';
  }

  const items = NAV_CONFIGS[configKey] || NAV_CONFIGS.asistente;

  navbar.innerHTML = items.map(item => `
    <div class="nav-item${item.color ? ' ' + item.color : ''}"
         data-tab="${item.id}"
         onclick="window.__router.navigateTo('${item.id}')">
      ${getNavIcon(item.icon)}
      <span>${item.label}</span>
    </div>
  `).join('');
}
