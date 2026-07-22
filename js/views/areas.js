/**
 * js/views/areas.js
 * Selector de áreas de trabajo. Punto único de entrada a las vistas de
 * órdenes (Cambios y, en el futuro, Caracterización y otras).
 *
 * Con UNA sola área habilitada, entra directo a esa área (sin pantalla
 * intermedia). Cuando haya más de una, muestra la lista para elegir.
 *
 * Para agregar un área nueva: se registra aquí en AREAS_DISPONIBLES.
 */

import { navigateTo } from '../router.js';

// Áreas con vista de órdenes propia. `tab` es el id del módulo en /views/.
const AREAS_DISPONIBLES = [
  {
    id: 'cambios',
    tab: 'cambios',
    label: 'Cambio de Medidores',
    sub: 'Órdenes de cambio y su seguimiento',
    color: '#2dd4bf',
    icon: '<path d="M13 2 3 14h9l-1 8 10-12h-9l1-8z"/>',
  },
  {
    id: 'caracterizacion',
    tab: 'caracterizacion',
    label: 'Caracterización de la Carga',
    sub: 'Órdenes del día con titular y suplentes',
    color: '#a78bfa',
    icon: '<circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 00-8 8c0 5.4 8 12 8 12s8-6.6 8-12a8 8 0 00-8-8z"/>',
  },
];

export function init(container, session) {
  const disponibles = AREAS_DISPONIBLES; // en el futuro: filtrar por permisos/campaña

  // Una sola área -> entrar directo, sin pantalla intermedia
  if (disponibles.length === 1) {
    navigateTo(disponibles[0].tab);
    return;
  }

  // Varias áreas -> mostrar el selector
  container.scrollTop = 0;
  container.innerHTML = `
    <div style="padding:20px 16px;max-width:520px;margin:0 auto">
      <div style="margin-bottom:20px">
        <div class="section-title">Áreas de trabajo</div>
        <div style="font-size:12px;color:var(--text-4);margin-top:2px">Elige el área que vas a gestionar</div>
      </div>
      <div class="flex-col gap-10">
        ${disponibles.map(a => `
          <div class="quick-card" style="cursor:pointer;display:flex;align-items:center;gap:14px;padding:16px" onclick="window.__router.navigateTo('${a.tab}')">
            <div style="width:44px;height:44px;border-radius:12px;background:${a.color}22;display:flex;align-items:center;justify-content:center;flex-shrink:0">
              <svg viewBox="0 0 24 24" fill="none" stroke="${a.color}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22">${a.icon}</svg>
            </div>
            <div style="flex:1">
              <div style="font-size:14px;font-weight:700">${a.label}</div>
              <div style="font-size:11px;color:var(--text-4);margin-top:2px">${a.sub}</div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-4)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="9 18 15 12 9 6"/></svg>
          </div>`).join('')}
      </div>
    </div>`;
}
