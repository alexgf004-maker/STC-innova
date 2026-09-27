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
// Mismo orden, textos e iconos que las tarjetas de Campañas del Dashboard.
const AREAS_DISPONIBLES = [
  {
    id: 'cambios',
    tab: 'cambios',
    label: 'Cambios',
    sub: 'Cambio de medidores',
    color: '#2dd4bf',
    icon: '<circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  },
  {
    id: 'caracterizacion',
    tab: 'caracterizacion',
    label: 'Caracterización',
    sub: 'Instalación y retiro',
    color: '#ef4444',
    icon: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  },
  {
    id: 'ami',
    tab: 'ami',
    label: 'AMI',
    sub: 'Medidores remotos',
    color: '#a78bfa',
    icon: '<path d="M4.9 16.1a10 10 0 010-8.2M7.8 13.8a6 6 0 010-3.6M19.1 7.9a10 10 0 010 8.2M16.2 10.2a6 6 0 010 3.6"/><circle cx="12" cy="12" r="2"/>',
  },
  {
    id: 'reclamos',
    tab: 'reclamos',
    label: 'Reclamos SIGET',
    sub: 'Bitácora de órdenes',
    color: '#fbbf24',
    icon: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  },
];

export function init(container, session) {
  const disponibles = AREAS_DISPONIBLES; // en el futuro: filtrar por permisos/campaña

  // Una sola área -> entrar directo, sin pantalla intermedia
  if (disponibles.length === 1) {
    navigateTo(disponibles[0].tab);
    return;
  }

  // Tarjetas iguales a los accesos del Dashboard (ds-act con icono en cuadro de color)
  const tarjeta = a => `
    <div class="ds-act" onclick="window.__router.navigateTo('${a.tab}')" style="text-align:left;padding:16px">
      <div style="display:flex;align-items:center;gap:12px">
        <div style="width:40px;height:40px;border-radius:12px;background:${a.color}22;display:flex;align-items:center;justify-content:center;flex-shrink:0">
          <svg viewBox="0 0 24 24" fill="none" stroke="${a.color}" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="20" height="20">${a.icon}</svg>
        </div>
        <div style="min-width:0">
          <div style="font-size:14px;font-weight:600;color:var(--text-1)">${a.label}</div>
          <div style="font-size:11px;color:var(--text-3);margin-top:1px">${a.sub}</div>
        </div>
      </div>
    </div>`;

  container.scrollTop = 0;
  container.innerHTML = `
    <div class="ds-view anim-up">
      <div style="margin-bottom:22px">
        <div style="font-size:24px;font-weight:600;letter-spacing:-.02em;line-height:1.15">Áreas de trabajo</div>
        <div style="font-size:12px;color:var(--text-4);margin-top:4px">Elige el área que vas a gestionar</div>
      </div>
      <div class="ds-sec">Campañas</div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:10px">
        ${disponibles.map(tarjeta).join('')}
      </div>
    </div>`;
}
