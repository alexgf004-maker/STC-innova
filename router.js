/**
 * js/router.js
 * Maneja la navegación entre tabs y renderizado de vistas.
 * Cada vista es un módulo en js/views/*.js que exporta init(container, session).
 */

import { getNavIcon } from './ui.js';

// Configuración de navbar por rol
const NAV_CONFIGS = {
  madelyn: [
    { id: 'home',     label: 'Dashboard', icon: 'home' },
    { id: 'cambios',  label: 'Cambios',   icon: 'zap',   color: 'cm' },
    { id: 'otc',      label: 'OTC',       icon: 'bolt',  color: 'otc' },
    { id: 'bodega',   label: 'Bodega',    icon: 'box' },
    { id: 'usuarios', label: 'Usuarios',  icon: 'users' },
  ],
  asistente: [
    { id: 'home',     label: 'Dashboard', icon: 'home' },
    { id: 'cambios',  label: 'Cambios',   icon: 'zap',   color: 'cm' },
    { id: 'otc',      label: 'OTC',       icon: 'bolt',  color: 'otc' },
    { id: 'bodega',   label: 'Bodega',    icon: 'box' },
    { id: 'usuarios', label: 'Usuarios',  icon: 'users' },
  ],
  tecnico_cm: [
    { id: 'home',    label: 'Inicio',  icon: 'home' },
    { id: 'ordenes', label: 'Órdenes', icon: 'list', color: 'cm' },
    { id: 'mapa',    label: 'Mapa',    icon: 'map',  color: 'cm' },
    { id: 'bodega',  label: 'Bodega',  icon: 'box' },
  ],
  tecnico_otc: [
    { id: 'home',    label: 'Inicio',  icon: 'home' },
    { id: 'ordenes', label: 'Órdenes', icon: 'list', color: 'otc' },
    { id: 'mapa',    label: 'Mapa',    icon: 'map',  color: 'otc' },
    { id: 'bodega',  label: 'Bodega',  icon: 'box' },
  ],
  tecnico_none: [
    { id: 'home', label: 'Inicio', icon: 'home' },
  ],
};

// Caché de módulos ya importados
const viewCache = {};

let currentTab    = null;
let currentSession = null;
const contentArea = document.getElementById('content-area');
const navbar      = document.getElementById('navbar');

/**
 * Inicializa el router con la sesión del usuario.
 * Construye la navbar y carga el home.
 */
export function initRouter(session) {
  currentSession = session;
  buildNavbar(session);
  navigateTo('home');
}

/**
 * Navega a un tab. Importa el módulo si no está en caché.
 */
export async function navigateTo(tabId) {
  if (currentTab === tabId) return;
  currentTab = tabId;

  // Marcar activo en navbar
  document.querySelectorAll('.nav-item').forEach(el => {
    const isActive = el.dataset.tab === tabId;
    el.classList.toggle('active', isActive);
  });

  // Scroll al inicio
  contentArea.scrollTop = 0;

  // Mostrar loading mínimo
  contentArea.innerHTML = '';

  try {
    // Importar módulo de vista bajo demanda
    if (!viewCache[tabId]) {
      viewCache[tabId] = await import(`./views/${tabId}.js`);
    }
    const mod = viewCache[tabId];
    mod.init(contentArea, currentSession);
  } catch (err) {
    console.warn(`[router] Vista '${tabId}' no implementada aún.`);
    renderPlaceholder(contentArea, tabId);
  }
}

/**
 * Placeholder para módulos no implementados.
 */
function renderPlaceholder(container, tabId) {
  container.innerHTML = `
    <div class="dev-module anim-up" style="margin-top:16px">
      <div class="dev-title">Módulo en desarrollo</div>
      <p>La sección <strong>${tabId}</strong> estará disponible próximamente.</p>
    </div>
  `;
}

/**
 * Construye la navbar según el rol del usuario.
 */
function buildNavbar(session) {
  const { role, asignacion } = session;
  const area = asignacion?.area;

  let configKey = role;
  if (role === 'tecnico') {
    configKey = area === 'CM'  ? 'tecnico_cm'
              : area === 'OTC' ? 'tecnico_otc'
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
