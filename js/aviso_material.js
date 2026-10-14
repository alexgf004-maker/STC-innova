/**
 * js/aviso_material.js
 * Aviso de material por recibir para el técnico, en TODA la app.
 *
 * Antes la tarjeta "Material por recibir" solo existía en el Inicio: si el
 * técnico estaba en el mapa o en sus órdenes ni se enteraba, y se le olvidaba
 * aceptar. Ahora, mientras tenga un despacho pendiente:
 *   - sale una ventana encima de cualquier pantalla con el material y los
 *     botones Aceptar / Rechazar (se puede posponer 10 minutos, y vuelve);
 *   - queda una franja fija arriba que la vuelve a abrir;
 *   - el teléfono vibra cuando llega uno nuevo, y si la app está en segundo
 *     plano y el técnico dio permiso, sale una notificación del sistema.
 * Aceptar y rechazar usan las mismas funciones del Inicio (home.js).
 */
import { db } from './firebase.js';
import { escapeHtml } from './ui.js';

const ID_VENTANA = 'aviso-material';
const ID_FRANJA = 'aviso-material-franja';
const CLAVE_POSPONER = 'aviso_material_hasta';
const POSPONER_MIN = 10;

let pendientes_ = [];
let vistos_ = new Set();
let off_ = null, timer_ = null, ocupado_ = false;

const esc = v => escapeHtml(v == null ? '' : String(v));
const AREA_TXT = { CAMBIOS: 'Cambio de Medidores', AMI: 'AMI', Caracterizacion: 'Caracterización', Reclamos: 'Reclamos SIGET', ReclamosSIGET: 'Reclamos SIGET', OTC: 'OTC', Factibilidades: 'Factibilidades' };
const ICO_CAJA = '<path d="M21 16V8a2 2 0 00-1-1.73l-7-4a2 2 0 00-2 0l-7 4A2 2 0 003 8v8a2 2 0 001 1.73l7 4a2 2 0 002 0l7-4A2 2 0 0021 16z"/><polyline points="3.27 6.96 12 12.01 20.73 6.96"/><line x1="12" y1="22.08" x2="12" y2="12"/>';
const svg = (d, n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${n}" height="${n}">${d}</svg>`;

function pospuestoHasta() {
  try { return Number(sessionStorage.getItem(CLAVE_POSPONER)) || 0; } catch { return 0; }
}
function posponer() {
  try { sessionStorage.setItem(CLAVE_POSPONER, String(Date.now() + POSPONER_MIN * 60000)); } catch {}
}
function quitarPosponer() {
  try { sessionStorage.removeItem(CLAVE_POSPONER); } catch {}
}

/** Arranca el aviso (solo técnicos). Lo llama app.js al entrar. */
export function iniciarAvisoMaterial(session) {
  if (!session || session.role !== 'tecnico' || !session.uid || off_) return;
  off_ = db.collection('despachos_pendientes')
    .where('tecnicoRecibeUid', '==', session.uid)
    .onSnapshot(snap => {
      pendientes_ = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (b.fecha?.seconds || 0) - (a.fecha?.seconds || 0));
      const nuevos = pendientes_.filter(p => !vistos_.has(p.id));
      pendientes_.forEach(p => vistos_.add(p.id));
      if (nuevos.length && !snap.metadata.hasPendingWrites) {
        quitarPosponer();   // uno nuevo se muestra aunque se haya pospuesto otro
        llamarAtencion(nuevos);
      }
      pintar();
    }, err => console.warn('[aviso material]', err.message));
  // Al volver a la app o al vencer el "más tarde", se muestra de nuevo
  timer_ = setInterval(pintar, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pintar(); });
}

function llamarAtencion(nuevos) {
  try { navigator.vibrate?.([400, 200, 400, 200, 400]); } catch {}
  // Notificación del sistema si la app no está a la vista y hay permiso
  if (document.hidden && 'Notification' in window && Notification.permission === 'granted') {
    const n = nuevos.length;
    const cuerpo = n === 1
      ? `${nuevos[0].entregadoPor || 'Bodega'} te envió material. Abre la app y acéptalo.`
      : `Tienes ${n} despachos de material por aceptar.`;
    navigator.serviceWorker?.ready
      .then(reg => reg.showNotification('Material por recibir', { body: cuerpo, tag: 'material-por-recibir', renotify: true, vibrate: [400, 200, 400] }))
      .catch(() => {});
  }
}

function pintar() {
  if (!pendientes_.length) {
    document.getElementById(ID_VENTANA)?.remove();
    document.getElementById(ID_FRANJA)?.remove();
    return;
  }
  pintarFranja();
  if (Date.now() >= pospuestoHasta()) abrirVentana();
}

// Franja fija arriba: siempre visible mientras haya pendientes
function pintarFranja() {
  let f = document.getElementById(ID_FRANJA);
  if (!f) {
    f = document.createElement('button');
    f.id = ID_FRANJA;
    f.className = 'am-franja';
    f.onclick = () => { quitarPosponer(); abrirVentana(); };
    document.body.appendChild(f);
  }
  // Justo debajo de la barra superior (su alto cambia según el teléfono)
  const tb = document.querySelector('.topbar');
  const abajo = tb && tb.offsetParent !== null ? tb.getBoundingClientRect().bottom : 0;
  if (abajo > 0) f.style.top = `${Math.round(abajo) + 8}px`;
  const n = pendientes_.length;
  f.innerHTML = `${svg(ICO_CAJA, 16)}<span>${n === 1 ? 'Tienes material por recibir' : `Tienes ${n} despachos por recibir`}</span><b>Ver</b>`;
}

function abrirVentana() {
  if (ocupado_) return;
  let v = document.getElementById(ID_VENTANA);
  if (!v) {
    v = document.createElement('div');
    v.id = ID_VENTANA;
    v.className = 'am-fondo';
    document.body.appendChild(v);
  }
  const n = pendientes_.length;
  const permisoAvisos = 'Notification' in window && Notification.permission === 'default';
  v.innerHTML = `
    <div class="am-caja" role="dialog" aria-modal="true" aria-labelledby="am-titulo">
      <div class="am-cab">
        <div class="am-ico">${svg(ICO_CAJA, 26)}</div>
        <div>
          <div class="am-tit" id="am-titulo">${n === 1 ? 'Tienes material por recibir' : `Tienes ${n} despachos por recibir`}</div>
          <div class="am-sub">Revisa que te entregaron todo y acéptalo. Mientras no lo aceptes, el material no queda a tu nombre.</div>
        </div>
      </div>
      <div class="am-lista">
        ${pendientes_.map(p => {
          const total = (p.items || []).reduce((a, i) => a + (Number(i.cantidad) || 0), 0);
          return `
          <div class="am-desp">
            <div class="am-desp-cab">
              <span>${esc(AREA_TXT[p.area] || p.area || 'Material')} · te lo entrega ${esc(p.entregadoPor || 'bodega')}</span>
              <span class="am-total">${total} items</span>
            </div>
            ${(p.items || []).map(m => `
              <div class="am-item"><span>${esc(m.nombre || m.name || '—')}</span><b>${esc(m.cantidad)} ${esc(m.unit || '')}</b></div>`).join('')}
            <div class="am-botones">
              <button class="am-rechazar" data-rechazar="${esc(p.id)}">Rechazar</button>
              <button class="btn-marca am-aceptar" data-aceptar="${esc(p.id)}">Aceptar material</button>
            </div>
          </div>`;
        }).join('')}
      </div>
      <button class="am-luego" id="am-luego">Recordarme en ${POSPONER_MIN} minutos</button>
      ${permisoAvisos ? '<button class="am-permiso" id="am-permiso">Activar avisos del teléfono</button>' : ''}
    </div>`;

  v.querySelector('#am-luego').onclick = () => { posponer(); v.remove(); };
  v.querySelector('#am-permiso')?.addEventListener('click', async e => {
    try { await Notification.requestPermission(); } catch {}
    e.target.remove();
  });
  const accion = async (id, fn) => {
    const p = pendientes_.find(x => x.id === id);
    if (!p) return;
    ocupado_ = true;
    v.querySelectorAll('button').forEach(b => { b.disabled = true; });
    try {
      const mod = await import('./views/home.js');
      const ok = await mod[fn](id, p);
      if (ok) { pendientes_ = pendientes_.filter(x => x.id !== id); }
    } catch (err) {
      console.error('[aviso material]', err);
      alert('No se pudo completar: ' + err.message);
    } finally {
      ocupado_ = false;
      v.querySelectorAll('button').forEach(b => { b.disabled = false; });
      if (!pendientes_.length) { v.remove(); document.getElementById(ID_FRANJA)?.remove(); }
      else abrirVentana();
    }
  };
  v.querySelectorAll('[data-aceptar]').forEach(b => b.onclick = () => accion(b.dataset.aceptar, 'aceptarDespachoPendiente'));
  v.querySelectorAll('[data-rechazar]').forEach(b => b.onclick = () => accion(b.dataset.rechazar, 'rechazarDespachoPendiente'));
}
