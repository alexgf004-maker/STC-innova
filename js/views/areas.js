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
    grad: 'cm',
    detalle: 'Órdenes, mapa y confirmación',
    icon: '<circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  },
  {
    id: 'caracterizacion',
    tab: 'caracterizacion',
    label: 'Caracterización',
    sub: 'Instalación y retiro',
    color: '#ef4444',
    grad: 'cr',
    detalle: 'Titular, suplentes y retiros',
    icon: '<path d="M3 3v18h18"/><path d="M18 17V9M13 17V5M8 17v-3"/>',
  },
  {
    id: 'ami',
    tab: 'ami',
    label: 'AMI',
    sub: 'Medidores remotos',
    color: '#a78bfa',
    grad: 'am',
    detalle: 'Ruta del día, metas y condominios',
    icon: '<path d="M4.9 16.1a10 10 0 010-8.2M7.8 13.8a6 6 0 010-3.6M19.1 7.9a10 10 0 010 8.2M16.2 10.2a6 6 0 010 3.6"/><circle cx="12" cy="12" r="2"/>',
  },
  {
    id: 'reclamos',
    tab: 'reclamos',
    label: 'Reclamos SIGET',
    sub: 'Bitácora de órdenes',
    color: '#fbbf24',
    grad: 'rc',
    detalle: 'Registro de reclamos atendidos',
    icon: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/>',
  },  {
    id: 'factibilidades',
    tab: 'factibilidades',
    label: 'Factibilidades',
    sub: 'Verificación de conexión',
    color: '#f472b6',
    grad: 'fb',
    detalle: 'Semáforo de días hábiles y mapa',
    icon: '<path d="M9 11l3 3 8-8"/><path d="M20 12v7a2 2 0 01-2 2H6a2 2 0 01-2-2V5a2 2 0 012-2h9"/>',
  },
];

export function init(container, session) {
  const disponibles = AREAS_DISPONIBLES; // en el futuro: filtrar por permisos/campaña

  // Una sola área -> entrar directo, sin pantalla intermedia
  if (disponibles.length === 1) {
    navigateTo(disponibles[0].tab);
    return;
  }

  // Misma tarjeta con degradado que la de "Meta del día" del técnico (ds-pcard)
  const tarjeta = a => `
    <div class="ds-pcard ${a.grad}" onclick="window.__router.navigateTo('${a.tab}')" style="cursor:pointer;padding:19px 21px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:16px">
        <div style="width:42px;height:42px;border-radius:12px;background:rgba(255,255,255,.18);display:flex;align-items:center;justify-content:center">
          <svg viewBox="0 0 24 24" fill="none" stroke="#fff" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" width="21" height="21">${a.icon}</svg>
        </div>
        <div class="ds-pcard-badge">${a.sub}</div>
      </div>
      <div style="font-size:22px;font-weight:700;color:#fff;line-height:1.1">${a.label}</div>
      <div style="height:1px;background:rgba(255,255,255,.15);margin:14px 0 11px"></div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px">
        <div class="ds-pcard-foot" style="font-size:12px">${a.detalle}</div>
        <svg viewBox="0 0 24 24" fill="none" stroke="rgba(255,255,255,.8)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="flex-shrink:0"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    </div>`;

  container.scrollTop = 0;
  container.innerHTML = `
    <div class="ds-view anim-up">
      <div style="margin-bottom:22px">
        <div style="font-size:24px;font-weight:600;letter-spacing:-.02em;line-height:1.15">Áreas de trabajo</div>
        <div style="font-size:12px;color:var(--text-4);margin-top:4px">Elige el área que vas a gestionar</div>
      </div>
      <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:14px">
        ${disponibles.map(tarjeta).join('')}
      </div>
    </div>`;
}
