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
    { id: 'mapa',    label: 'Mapa',    icon: 'map',  color: 'otc' },
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
  if (currentTab === tabId) return;
  currentTab = tabId;
  window.__router.currentTab = tabId;

  document.querySelectorAll('.nav-item').forEach(el => {
    el.classList.toggle('active', el.dataset.tab === tabId);
  });

  contentArea.scrollTop = 0;
  contentArea.innerHTML = '';

  try {
    if (!viewCache[tabId]) {
      viewCache[tabId] = await import(`./views/${tabId}.js`);
    }
    viewCache[tabId].init(contentArea, currentSession);
  } catch (err) {
    console.warn(`[router] Vista '${tabId}' no implementada:`, err.message);
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
