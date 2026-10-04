/**
 * js/ui.js
 * Helpers de UI compartidos por todos los módulos.
 * toast, spinner de pantalla completa, confirmación.
 */

// ── Toast ─────────────────────────────────────────
let toastContainer = null;
document.addEventListener('DOMContentLoaded', () => {
  toastContainer = document.getElementById('toast-container');
});

/**
 * Muestra un toast.
 * @param {string} msg
 * @param {'ok'|'error'|'warn'} type
 * @param {number} duration ms
 */
export function toast(msg, type = 'ok', duration = 3000) {
  if (!toastContainer) return;
  const el = document.createElement('div');
  el.className = `toast ${type}`;
  el.innerHTML = `<div class="toast-dot"></div><span></span>`;
  el.querySelector('span').textContent = String(msg ?? '');
  toastContainer.appendChild(el);
  setTimeout(() => {
    el.style.transition = 'opacity .3s ease';
    el.style.opacity = '0';
    setTimeout(() => el.remove(), 300);
  }, duration);
}

// Escapa texto para insertarlo en innerHTML. Usar en todo texto que venga de
// usuarios (comentarios, observaciones, motivos, notas) o de archivos Excel.
export function escapeHtml(v) {
  return String(v ?? '')
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Spinner de topbar (botón refresh) ────────────
export function setRefreshLoading(loading) {
  const btn = document.getElementById('btn-refresh');
  if (!btn) return;
  const svg = btn.querySelector('svg');
  if (svg) svg.style.animation = loading ? 'spin .7s linear infinite' : '';
}

export function setupRefreshBtn(onRefresh) {
  const btn = document.getElementById('btn-refresh');
  if (!btn) return;
  btn.style.display = '';
  btn.addEventListener('click', async () => {
    setRefreshLoading(true);
    try { await onRefresh(); } finally { setRefreshLoading(false); }
  });
}

// ── Confirmación simple ───────────────────────────
/**
 * Dialog de confirmación nativo (reemplazable por sheet en el futuro).
 * @param {string} msg
 * @returns {boolean}
 */
export function confirm(msg) {
  return window.confirm(msg);
}

// ── Helpers de elementos ──────────────────────────
/**
 * Shorthand para querySelector.
 */
export const $ = (sel, ctx = document) => ctx.querySelector(sel);
export const $$ = (sel, ctx = document) => [...ctx.querySelectorAll(sel)];

/**
 * Genera iconos SVG de navegación.
 */
export function getNavIcon(name) {
  const icons = {
    home:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 9l9-7 9 7v11a2 2 0 01-2 2H5a2 2 0 01-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/></svg>`,
    zap:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M12 2v2M12 20v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M2 12h2M20 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42"/></svg>`,
    bolt:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>`,
    box:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/></svg>`,
    users:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 21v-2a4 4 0 00-4-4H5a4 4 0 00-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 00-3-3.87"/><path d="M16 3.13a4 4 0 010 7.75"/></svg>`,
    list:   `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/></svg>`,
    map:    `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>`,
    alert:  `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`,
  };
  return icons[name] || icons.home;
}

// ── Pestañas animadas ─────────────────────────────
// A toda barra de pestañas (.cambios-tabs / .area-tabs) se le agrega una
// píldora del color del área que se estira hacia la pestaña nueva y luego
// se encoge, como una gota; el contenido entra deslizándose de ese lado.
// Las vistas no cambian: siguen poniendo y quitando la clase "active" y
// aquí se observa ese cambio.
const SEL_PESTANA = '.cambios-tab, .area-tab';
const RE_CONTENIDO = /-(content|estado|resumen|lista)$/;

function prepararBarra(bar) {
  if (bar._pildora) return;
  const ind = document.createElement('i');
  ind.className = 'tab-pildora';
  bar.appendChild(ind);
  bar.classList.add('tabs-anim');
  const st = bar._pildora = { ind, act: -1 };

  const colocar = anim => {
    const ps = [...bar.querySelectorAll(SEL_PESTANA)];
    const i = ps.findIndex(p => p.classList.contains('active'));
    if (i < 0) { ind.style.opacity = '0'; st.act = -1; return; }
    const p = ps[i];
    if (!p.offsetWidth) return;                         // barra oculta
    const l = p.offsetLeft, r = bar.clientWidth - l - p.offsetWidth;
    const mover = anim && st.act >= 0 && i !== st.act;
    if (mover) {
      // El borde que va adelante se mueve primero y el de atrás después.
      const ida = i > st.act, rap = '.28s cubic-bezier(.4,0,.2,1)', len = '.42s cubic-bezier(.4,0,.2,1)';
      ind.style.transition = ida ? `right ${rap}, left ${len} .12s` : `left ${rap}, right ${len} .12s`;
      // Al mapa no: va en position:fixed y, si se arma mientras el contenido
      // está desplazado (transform), Leaflet mide mal y queda descuadrado.
      if (p.dataset.tab !== 'mapa') deslizarContenido(bar, ida);
    } else {
      ind.style.transition = 'none';
    }
    ind.style.left = l + 'px';
    ind.style.right = r + 'px';
    ind.style.opacity = '1';
    st.act = i;
  };

  new MutationObserver(() => requestAnimationFrame(() => colocar(true)))
    .observe(bar, { attributes: true, attributeFilter: ['class'], subtree: true });
  if (window.ResizeObserver) new ResizeObserver(() => colocar(false)).observe(bar);
  requestAnimationFrame(() => colocar(false));
}

function deslizarContenido(bar, ida) {
  const cls = ida ? 'pestana-der' : 'pestana-izq';
  for (let el = bar.nextElementSibling; el; el = el.nextElementSibling) {
    if (!el.id || !RE_CONTENIDO.test(el.id) || el.querySelector('.leaflet-container')) continue;
    el.classList.remove('pestana-der', 'pestana-izq');
    void el.offsetWidth;
    el.classList.add(cls);
    const fin = e => { if (e.target !== el) return; el.classList.remove(cls); el.removeEventListener('animationend', fin); };
    el.addEventListener('animationend', fin);
  }
}

export function activarPestanasAnimadas(raiz) {
  if (!raiz) return;
  let pendiente = false;
  const buscar = () => {
    pendiente = false;
    raiz.querySelectorAll('.cambios-tabs:not(.tabs-anim), .area-tabs:not(.tabs-anim)').forEach(prepararBarra);
  };
  new MutationObserver(() => {
    if (!pendiente) { pendiente = true; requestAnimationFrame(buscar); }
  }).observe(raiz, { childList: true, subtree: true });
  buscar();
}
