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
    color: '#ef4444',
    icon: '<circle cx="12" cy="10" r="3"/><path d="M12 2a8 8 0 00-8 8c0 5.4 8 12 8 12s8-6.6 8-12a8 8 0 00-8-8z"/>',
  },
  {
    id: 'reclamos',
    tab: 'reclamos',
    label: 'Reclamos SIGET',
    sub: 'Bitácora de órdenes realizadas',
    color: '#fbbf24',
    icon: '<path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z"/><polyline points="14 2 14 8 20 8"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/><line x1="10" y1="9" x2="8" y2="9"/>',
  },
];

export function init(container, session) {
  const disponibles = AREAS_DISPONIBLES; // en el futuro: filtrar por permisos/campaña

  // Una sola área -> entrar directo, sin pantalla intermedia
  if (disponibles.length === 1) {
    navigateTo(disponibles[0].tab);
    return;
  }

  // Inyectar estilos del selector (una sola vez)
  if (!document.getElementById('areas-css')) {
    const st = document.createElement('style');
    st.id = 'areas-css';
    st.textContent = `
      .area-card{position:relative;display:flex;align-items:center;gap:16px;padding:20px;border-radius:16px;
        background:linear-gradient(180deg,rgba(255,255,255,.03),rgba(255,255,255,.01));
        border:1px solid var(--border);cursor:pointer;overflow:hidden;
        transition:transform .18s ease,border-color .18s ease,box-shadow .18s ease}
      .area-card::before{content:'';position:absolute;left:0;top:0;bottom:0;width:3px;background:var(--acc);opacity:.85}
      .area-card:hover{transform:translateY(-2px);border-color:var(--acc);box-shadow:0 8px 30px rgba(0,0,0,.35)}
      .area-ico{width:52px;height:52px;border-radius:14px;display:flex;align-items:center;justify-content:center;flex-shrink:0;
        background:var(--acc-bg);border:1px solid var(--acc-br)}
      .area-arrow{color:var(--text-4);transition:transform .18s ease,color .18s ease}
      .area-card:hover .area-arrow{transform:translateX(3px);color:var(--acc)}
    `;
    document.head.appendChild(st);
  }

  container.scrollTop = 0;
  container.innerHTML = `
    <div style="padding:32px 20px;max-width:680px;margin:0 auto">
      <div style="margin-bottom:24px">
        <div style="font-size:22px;font-weight:800;letter-spacing:-.01em">Áreas de trabajo</div>
        <div style="font-size:13px;color:var(--text-4);margin-top:4px">Elige el área que vas a gestionar</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr;gap:12px">
        ${disponibles.map(a => {
          const hex = a.color;
          const r = parseInt(hex.slice(1,3),16), g = parseInt(hex.slice(3,5),16), b = parseInt(hex.slice(5,7),16);
          return `
          <div class="area-card" style="--acc:${hex};--acc-bg:rgba(${r},${g},${b},.14);--acc-br:rgba(${r},${g},${b},.3)"
               onclick="window.__router.navigateTo('${a.tab}')">
            <div class="area-ico">
              <svg viewBox="0 0 24 24" fill="none" stroke="${hex}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26">${a.icon}</svg>
            </div>
            <div style="flex:1;min-width:0">
              <div style="font-size:15px;font-weight:700">${a.label}</div>
              <div style="font-size:12px;color:var(--text-4);margin-top:3px">${a.sub}</div>
            </div>
            <svg class="area-arrow" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><polyline points="9 18 15 12 9 6"/></svg>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}
