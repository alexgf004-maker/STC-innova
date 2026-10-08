/**
 * js/views/factibilidades.js
 * Área Factibilidades: verificación de factibilidad de conexión.
 *
 * A diferencia de Cambios y AMI, cada técnico trabaja SOLO (sin pareja) y lo
 * central es el tiempo: el semáforo de días hábiles dirige qué se atiende
 * primero. El mapa (factibilidades_mapa.js) sirve para llegar al sitio.
 *
 * Exporta: init(container, session), cleanup(), initHomeTecnico(container, session)
 *
 * Roles:
 *   admin / asistente -> Panel, todas las órdenes y mapa completo
 *   tecnico           -> Resumen y sus órdenes abiertas
 */

import { suscribirAbiertas } from '../factibilidades_comun.js';
import { escapeHtml } from '../ui.js';

const ICO = {
  lista:  '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  mapa:   '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
  buscar: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
};
const svg = (d, n = 16, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${n}" height="${n}" ${extra}>${d}</svg>`;
const esc = v => escapeHtml(v == null ? '' : String(v));

let container_, session_, esAdmin_, activeTab_;
let ordenes_ = [], cargado_ = false, error_ = null;
let off_ = null, mapaMod_ = null;   // mapaMod_: mapa abierto como pestaña (oficina)

// ── Entry point ───────────────────────────────────
export function init(container, session) {
  cleanup();
  container_ = container;
  session_   = session;
  esAdmin_   = session.role === 'admin' || session.role === 'asistente';
  activeTab_ = esAdmin_ ? 'panel' : 'ordenes';
  ordenes_ = []; cargado_ = false; error_ = null;

  renderShell();
  setTab(activeTab_);
  off_ = suscribirAbiertas(session, (lista, err) => {
    if (err) { error_ = err; } else { ordenes_ = lista; error_ = null; }
    cargado_ = true;
    if (container_.isConnected && activeTab_ !== 'mapa') setTab(activeTab_);
  });
}

export function cleanup() {
  if (off_) { try { off_(); } catch {} off_ = null; }
  cerrarMapa();
}

function cerrarMapa() {
  if (mapaMod_) { try { mapaMod_.cleanup(); } catch {} mapaMod_ = null; }
}

// ── Shell ─────────────────────────────────────────
function renderShell() {
  const tabs = esAdmin_
    ? [{ id: 'panel', label: 'Panel' }, { id: 'ordenes', label: 'Órdenes' }, { id: 'mapa', label: 'Mapa' }]
    : [{ id: 'ordenes', label: 'Órdenes' }];

  container_.innerHTML = `
    <div style="max-width:1100px;margin:0 auto">
      <div style="margin-bottom:16px">
        <div style="font-size:24px;font-weight:600;letter-spacing:-.02em;line-height:1.15">Factibilidades</div>
        <div style="font-size:12px;color:var(--text-3);margin-top:4px">Verificación de conexión${esAdmin_ ? '' : ' · ' + esc(session_.displayName)}</div>
      </div>
      ${tabs.length > 1 ? `
      <div class="area-tabs" style="margin-bottom:14px">
        ${tabs.map(t => `<button class="area-tab fb-tab" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>` : ''}
      <div id="fb-content"></div>
    </div>`;
  container_.querySelectorAll('.fb-tab').forEach(t => { t.onclick = () => setTab(t.dataset.tab); });
}

function setTab(tab) {
  if (tab !== 'mapa') cerrarMapa();
  activeTab_ = tab;
  container_.querySelectorAll('.fb-tab').forEach(t => {
    const activa = t.dataset.tab === tab;
    t.classList.toggle('active', activa);
    t.classList.toggle('fb', activa);
  });
  const cont = container_.querySelector('#fb-content');
  if (!cont) return;
  if (tab === 'mapa') {
    cont.innerHTML = '';
    import('./factibilidades_mapa.js')
      .then(mod => { if (activeTab_ === 'mapa' && !mapaMod_) { mapaMod_ = mod; mod.init(cont, session_); } })
      .catch(err => {
        console.warn('[factibilidades] Error cargando el mapa:', err.message);
        cont.innerHTML = `<div class="dev-module"><div class="dev-title">No se pudo cargar el mapa</div><p>Intenta de nuevo en un momento.</p></div>`;
      });
    return;
  }
  if (!cargado_) { cont.innerHTML = `<div style="padding:32px 0;text-align:center"><div class="spinner" style="margin:0 auto"></div></div>`; return; }
  if (error_) { cont.innerHTML = `<div class="dev-module"><div class="dev-title">No se pudieron cargar las órdenes</div><p>${esc(error_.message)}</p></div>`; return; }
  if (tab === 'panel') renderPanel(cont);
  else renderOrdenes(cont);
}

// ── Panel (admin / asistente) ─────────────────────
function renderPanel(cont) {
  const sinAsignar = ordenes_.filter(o => !o.asignadoUid).length;
  cont.innerHTML = `
    <div class="ds-pcard fb" style="margin-bottom:22px">
      <div class="ds-pcard-lbl">Órdenes abiertas</div>
      <div style="font-size:38px;font-weight:500;letter-spacing:-.02em;line-height:1;color:#fff;margin-top:6px">${ordenes_.length}</div>
      <div style="font-size:12px;color:rgba(255,255,255,.85);margin-top:8px">${sinAsignar ? `${sinAsignar} sin asignar` : 'Todas asignadas'}</div>
    </div>
    ${ordenes_.length ? '' : `<div class="dev-module"><div class="dev-title">Aún no hay órdenes</div><p>El importador del Excel de DELSUR se habilita cuando llegue el archivo real.</p></div>`}`;
}

// ── Órdenes ───────────────────────────────────────
function renderOrdenes(cont) {
  const lista = ordenes_;
  cont.innerHTML = lista.length
    ? `<div class="crc-grid">${lista.map(tarjeta).join('')}</div>`
    : `<div class="dev-module"><div class="dev-title">${esAdmin_ ? 'Aún no hay órdenes' : 'No tienes órdenes abiertas'}</div><p>${esAdmin_ ? 'Las órdenes llegan con el Excel de DELSUR.' : 'Cuando te asignen órdenes aparecerán aquí.'}</p></div>`;
}

function tarjeta(o) {
  return `
    <div class="cm-ord" style="cursor:default">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="cm-wo">${esc(o.numeroOrden || '—')}</span>
        ${o.estado === 'visita' ? '<span class="cm-pill warn">Sin acceso</span>' : ''}
      </div>
      ${o.cliente ? `<div class="cm-cli">${esc(o.cliente)}</div>` : ''}
      ${o.direccion ? `<div class="cm-meta">${esc(o.direccion)}</div>` : ''}
      ${esAdmin_ ? `<div class="cm-meta">${o.asignadoNombre ? esc(o.asignadoNombre) : '<span style="color:#fbbf24">Sin asignar</span>'}</div>` : ''}
    </div>`;
}

// ── Inicio del técnico (lo abre home.js) ──────────
// Devuelve la función de limpieza para cuando el técnico sale del inicio.
export function initHomeTecnico(container, session) {
  const fechaCorta = new Date().toLocaleDateString('es-SV', { day: 'numeric', month: 'short' });
  container.innerHTML = `
    <div class="ds-view anim-up">
      <div id="home-despachos-slot"></div>
      <div class="ds-pcard fb" style="margin-bottom:24px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px">
          <div>
            <div style="font-size:18px;font-weight:700;color:#fff;line-height:1.1">${esc(session.displayName)}</div>
            <div style="font-size:13px;color:rgba(255,255,255,.75);margin-top:3px">Factibilidades</div>
          </div>
          <div class="ds-pcard-badge">${fechaCorta}</div>
        </div>
        <div class="ds-pcard-lbl" style="margin-bottom:4px">Órdenes abiertas</div>
        <div style="font-size:38px;font-weight:500;letter-spacing:-.02em;line-height:1;color:#fff" id="fbh-abiertas">—</div>
      </div>
      <div class="ds-acts" style="margin:28px 0;grid-template-columns:repeat(2,1fr)">
        <div class="ds-act" onclick="window.__router.navigateTo('factibilidades')">
          <div style="color:var(--fb-light)">${svg(ICO.lista, 20)}</div>
          <div class="ds-act-t">Órdenes</div>
        </div>
        <div class="ds-act" onclick="window.__router.navigateTo('factibilidades_mapa')">
          <div style="color:var(--fb-light)">${svg(ICO.mapa, 20)}</div>
          <div class="ds-act-t">Mapa</div>
        </div>
      </div>
    </div>`;
  return suscribirAbiertas(session, (lista) => {
    const el = container.querySelector('#fbh-abiertas');
    if (el && lista) el.textContent = lista.length;
  });
}
