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

import { db } from '../firebase.js';
import { tecnicosActivos } from '../vivo.js';
import { suscribirAbiertas, suscribirConfig, suscribirCerradas, guardarConfig, META_DEFECTO, AREA, COL_ORDENES } from '../factibilidades_comun.js';
import { semaforoOrden, SEMAFORO, aFecha, claveDia } from '../dias_habiles.js';
import { toast, escapeHtml } from '../ui.js';
import { abrirResultado, abrirReasignar, puedeActuar, cerrarHojas } from './factibilidades_acciones.js';

const ICO = {
  lista:  '<line x1="8" y1="6" x2="21" y2="6"/><line x1="8" y1="12" x2="21" y2="12"/><line x1="8" y1="18" x2="21" y2="18"/><line x1="3" y1="6" x2="3.01" y2="6"/><line x1="3" y1="12" x2="3.01" y2="12"/><line x1="3" y1="18" x2="3.01" y2="18"/>',
  mapa:   '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
  buscar: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  cal:    '<rect x="3" y="4" width="18" height="18" rx="2"/><line x1="16" y1="2" x2="16" y2="6"/><line x1="8" y1="2" x2="8" y2="6"/><line x1="3" y1="10" x2="21" y2="10"/>',
  chev:   '<polyline points="9 18 15 12 9 6"/>',
  check:  '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  nav:    '<polygon points="3 11 22 2 13 21 11 13 3 11"/>',
  alerta: '<path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>',
  meta:   '<circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/>',
  dots:   '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  bajar:  '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  usuario:'<path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/>',
  marcar: '<polyline points="20 6 9 17 4 12"/>',
  cerrar: '<line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/>',
  basura: '<polyline points="3 6 5 6 21 6"/><path d="M19 6v14a2 2 0 01-2 2H7a2 2 0 01-2-2V6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/>',
};
const svg = (d, n = 16, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${n}" height="${n}" ${extra}>${d}</svg>`;
const esc = v => escapeHtml(v == null ? '' : String(v));

let container_, session_, esAdmin_, activeTab_;
let ordenes_ = [], cargado_ = false, error_ = null;
let off_ = null, offCfg_ = null, mapaMod_ = null;   // mapaMod_: mapa abierto como pestaña (oficina)
let cfg_ = { festivos: [], festivosSet: new Set(), meta: META_DEFECTO };
let filtroSem_ = 'todas', busq_ = '', limite_ = 40;
let filtroPedido_ = null;          // el inicio del técnico pide abrir la lista ya filtrada
let cerradas_ = [], offCerr_ = null, tecnicos_ = [];   // oficina: cerradas del mes y técnicos del área
let tecF_ = 'todos', modoSel_ = false, selec_ = new Set();   // oficina: filtro por técnico y selección para reasignar

// Días hábiles y color de cada orden (una sola función compartida)
const sem = o => semaforoOrden(o, cfg_.festivosSet);
const textoDias = n => n == null ? 'Sin fecha' : `${n} día${n !== 1 ? 's' : ''} hábil${n !== 1 ? 'es' : ''}`;
const fmtFecha = v => { const d = aFecha(v); return d ? d.toLocaleDateString('es-SV', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'; };
// Más días primero (rojas arriba); las que no traen fecha, al final
const porDias = (a, b) => (sem(b).dias ?? -1) - (sem(a).dias ?? -1);

// ── Entry point ───────────────────────────────────
export function init(container, session) {
  cleanup();
  container_ = container;
  session_   = session;
  esAdmin_   = session.role === 'admin' || session.role === 'asistente';
  activeTab_ = esAdmin_ ? 'panel' : 'ordenes';
  ordenes_ = []; cargado_ = false; error_ = null;
  filtroSem_ = filtroPedido_ || 'todas'; filtroPedido_ = null; busq_ = ''; limite_ = 40;
  cerradas_ = []; tecnicos_ = [];
  tecF_ = 'todos'; modoSel_ = false; selec_ = new Set();

  renderShell();
  setTab(activeTab_);
  const repintar = () => { if (container_.isConnected && activeTab_ !== 'mapa') setTab(activeTab_); };
  offCfg_ = suscribirConfig(cfg => {
    cfg_ = cfg;
    repintar();
    if (container_.querySelector('#fb-sheet-festivos')?.classList.contains('open')) pintarFestivos();
  });
  off_ = suscribirAbiertas(session, (lista, err) => {
    if (err) { error_ = err; } else { ordenes_ = lista; error_ = null; }
    cargado_ = true;
    repintar();
  });
  if (esAdmin_) {
    // Cerradas del mes: cerradas hoy contra la meta y promedio de atención
    const hoy = new Date();
    offCerr_ = suscribirCerradas(session, new Date(hoy.getFullYear(), hoy.getMonth(), 1), (lista, err) => {
      if (err) { console.warn('[factibilidades] cerradas:', err.message); return; }
      cerradas_ = lista;
      if (activeTab_ === 'panel') repintar();
    });
    tecnicosActivos(db).then(lista => {
      tecnicos_ = lista.filter(u => u.asignacionActual?.area === AREA);
      if (activeTab_ === 'panel') repintar();
    }).catch(err => console.warn('[factibilidades] técnicos:', err.message));
  }
}

export function cleanup() {
  if (off_) { try { off_(); } catch {} off_ = null; }
  if (offCfg_) { try { offCfg_(); } catch {} offCfg_ = null; }
  if (offCerr_) { try { offCerr_(); } catch {} offCerr_ = null; }
  cerrarHojas();
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
    <div class="fb-scope" style="max-width:1100px;margin:0 auto">
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:16px">
        <div style="flex:1;min-width:0">
          <div style="font-size:24px;font-weight:600;letter-spacing:-.02em;line-height:1.15">Factibilidades</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:4px">Verificación de conexión${esAdmin_ ? '' : ' · ' + esc(session_.displayName)}</div>
        </div>
        ${esAdmin_ ? `<button class="cm-ico-btn" id="fb-menu" title="Acciones">${svg(ICO.dots, 18)}</button>` : ''}
      </div>
      ${tabs.length > 1 ? `
      <div class="area-tabs" style="margin-bottom:14px">
        ${tabs.map(t => `<button class="area-tab fb-tab" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>` : ''}
      <div id="fb-content"></div>
      ${esAdmin_ ? hoja('fb-sheet-festivos', 'Días festivos', '') + hoja('fb-sheet-meta', 'Meta diaria', '')
        + hoja('fb-sheet-acciones', 'Acciones de Factibilidades', `<div class="flex-col gap-8">
            ${accion('fb-a-excel', ICO.bajar, 'Exportar a Excel', 'Días hábiles, resultado y coordenada corregida')}
            ${accion('fb-a-meta', ICO.meta, 'Meta diaria', 'Órdenes cerradas por técnico al día')}
            ${accion('fb-a-festivos', ICO.cal, 'Días festivos', 'No cuentan como días hábiles')}
          </div>`)
        + hoja('fb-sheet-excel', 'Exportar a Excel', '') : ''}
    </div>`;
  container_.querySelectorAll('.fb-tab').forEach(t => { t.onclick = () => setTab(t.dataset.tab); });
  container_.querySelectorAll('.sheet-backdrop').forEach(sh => sh.addEventListener('click', e => { if (e.target === sh) sh.classList.remove('open'); }));
  if (!esAdmin_) return;
  const abrirH = id => container_.querySelector('#' + id).classList.add('open');
  const cerrarH = id => container_.querySelector('#' + id).classList.remove('open');
  container_.querySelector('#fb-menu').onclick = () => abrirH('fb-sheet-acciones');
  container_.querySelector('#fb-a-excel').onclick = () => { cerrarH('fb-sheet-acciones'); abrirExportar(); };
  container_.querySelector('#fb-a-meta').onclick = () => { cerrarH('fb-sheet-acciones'); abrirMeta(); };
  container_.querySelector('#fb-a-festivos').onclick = () => { cerrarH('fb-sheet-acciones'); abrirFestivos(); };
}

function accion(id, ico, txt, sub) {
  return `<button class="us-accion" id="${id}">${svg(ico, 18)}<span style="flex:1;text-align:left"><span style="display:block">${txt}</span><span class="us-accion-sub">${sub}</span></span></button>`;
}

function hoja(id, titulo, cuerpo) {
  return `
    <div class="sheet-backdrop" id="${id}">
      <div class="sheet" style="max-height:92vh">
        <div class="sheet-handle"></div>
        <div class="sheet-title" id="${id}-title">${titulo}</div>
        <div class="sheet-body" id="${id}-body" style="padding-bottom:16px">${cuerpo}</div>
      </div>
    </div>`;
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
const esHoy = v => { const d = aFecha(v); return !!d && claveDia(d) === claveDia(new Date()); };
const iniciales = n => String(n || '').trim().split(/\s+/).slice(0, 2).map(p => p[0] || '').join('').toUpperCase() || '?';
const barra = (n, meta, color) => `<div class="ds-bar" style="height:5px;margin-top:6px"><i style="width:${meta ? Math.min(100, Math.round(n / meta * 100)) : 0}%;background:${color}"></i></div>`;

// Resumen por técnico: pendientes, rojas, cerradas hoy y promedio de atención
function resumenTecnicos() {
  const filas = new Map();
  const fila = (uid, nombre) => {
    if (!filas.has(uid)) filas.set(uid, { uid, nombre, pend: 0, rojas: 0, hoy: 0, dias: [] });
    return filas.get(uid);
  };
  tecnicos_.forEach(u => fila(u.id, u.displayName));
  ordenes_.forEach(o => {
    if (!o.asignadoUid) return;
    const f = fila(o.asignadoUid, o.asignadoNombre || 'Sin nombre');
    f.pend++;
    if (sem(o).color === 'rojo') f.rojas++;
  });
  cerradas_.forEach(o => {
    if (!o.asignadoUid) return;
    const f = fila(o.asignadoUid, o.asignadoNombre || o.hechaPor || 'Sin nombre');
    if (esHoy(o.fechaHecha)) f.hoy++;
    const d = sem(o).dias;
    if (d != null) f.dias.push(d);
  });
  return [...filas.values()].sort((a, b) => b.rojas - a.rojas || b.pend - a.pend || String(a.nombre).localeCompare(String(b.nombre)));
}

function renderPanel(cont) {
  const sinAsignar = ordenes_.filter(o => !o.asignadoUid);
  const n = { verde: 0, amarillo: 0, rojo: 0 };
  ordenes_.forEach(o => { const c = sem(o).color; if (c) n[c]++; });
  const proximos = cfg_.festivos.filter(f => f >= claveDia(new Date()));
  const meta = cfg_.meta;
  const filas = resumenTecnicos();
  const hoyTotal = cerradas_.filter(o => esHoy(o.fechaHecha)).length;
  const prom = arr => arr.length ? (arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(1) : '—';

  cont.innerHTML = `
    <div class="ds-pcard fb" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div class="ds-pcard-lbl">Atrasadas · más de 5 días hábiles</div>
        <div class="ds-pcard-badge">${new Date().toLocaleDateString('es-SV', { day: 'numeric', month: 'short' })}</div>
      </div>
      <div style="font-size:38px;font-weight:500;letter-spacing:-.02em;line-height:1;color:#fff;margin-top:6px">${n.rojo}<span style="font-size:18px;color:rgba(255,255,255,.7)"> de ${ordenes_.length} pendientes</span></div>
      <div style="font-size:12px;color:rgba(255,255,255,.85);margin-top:8px">${hoyTotal} cerrada${hoyTotal !== 1 ? 's' : ''} hoy${sinAsignar.length ? ` · ${sinAsignar.length} sin asignar` : ''}</div>
    </div>
    <div class="ds-mini" style="margin-bottom:22px">
      ${['rojo', 'amarillo', 'verde'].map(c => `
        <div class="ds-m" data-ir="${c}" style="cursor:pointer"><div class="ds-num-md" style="color:${SEMAFORO[c].color}">${n[c]}</div><div class="ds-lbl-sm" style="margin-top:6px">${SEMAFORO[c].texto}</div></div>`).join('')}
    </div>

    ${sinAsignar.length ? `
    <div class="cm-lista" style="margin-bottom:22px">
      <div class="cm-fila" data-ir="sin">
        <div class="cm-fila-ic warn">${svg(ICO.alerta, 17)}</div>
        <div style="flex:1;min-width:0"><div class="cm-fila-t">${sinAsignar.length} sin asignar</div><div class="cm-fila-s">No cruzaron con ningún técnico al importar</div></div>
        ${svg(ICO.chev, 16, 'style="color:var(--text-3);flex-shrink:0"')}
      </div>
    </div>` : ''}

    <div class="ds-sec" style="display:flex;align-items:center">Por técnico
      <span style="margin-left:auto;font-size:11px;font-weight:600;color:var(--text-3);text-transform:none;letter-spacing:0">Meta ${meta} al día</span>
    </div>
    ${filas.length ? `
    <div class="cm-lista" style="margin-bottom:22px">
      ${filas.map(f => `
        <div class="cm-fila" data-tec="${esc(f.uid)}">
          <div class="user-avatar fb" style="width:36px;height:36px;font-size:12px;flex-shrink:0">${esc(iniciales(f.nombre))}</div>
          <div style="flex:1;min-width:0">
            <div class="cm-fila-t">${esc(f.nombre)}</div>
            <div class="cm-fila-s">${f.pend} pendiente${f.pend !== 1 ? 's' : ''}${f.rojas ? ` · <span style="color:${SEMAFORO.rojo.color};font-weight:600">${f.rojas} en rojo</span>` : ''} · prom. ${prom(f.dias)} días</div>
          </div>
          <div style="width:74px;flex-shrink:0;text-align:right">
            <div style="font-size:15px;font-weight:700;color:${f.hoy >= meta ? '#22c55e' : 'var(--text)'}">${f.hoy}<span style="font-size:11px;font-weight:500;color:var(--text-3)"> / ${meta}</span></div>
            ${barra(f.hoy, meta, f.hoy >= meta ? '#22c55e' : 'var(--fb-light)')}
          </div>
        </div>`).join('')}
    </div>` : `<div class="ds-card" style="text-align:center;padding:18px;color:var(--text-3);font-size:13px;margin-bottom:22px">No hay técnicos asignados a Factibilidades hoy.</div>`}
    ${ordenes_.length ? '' : `<div class="dev-module" style="margin-bottom:22px"><div class="dev-title">Aún no hay órdenes</div><p>El importador del Excel de DELSUR se habilita cuando llegue el archivo real.</p></div>`}

    <div class="ds-sec">Configuración</div>
    <div class="cm-lista">
      <div class="cm-fila" id="fb-abrir-meta">
        <div class="cm-fila-ic muted">${svg(ICO.meta, 17)}</div>
        <div style="flex:1;min-width:0"><div class="cm-fila-t">Meta diaria por técnico</div><div class="cm-fila-s">${meta} órdenes cerradas al día</div></div>
        ${svg(ICO.chev, 16, 'style="color:var(--text-3);flex-shrink:0"')}
      </div>
      <div class="cm-fila" id="fb-abrir-festivos">
        <div class="cm-fila-ic muted">${svg(ICO.cal, 17)}</div>
        <div style="flex:1;min-width:0"><div class="cm-fila-t">Días festivos</div><div class="cm-fila-s">${proximos.length ? `${proximos.length} próximo${proximos.length !== 1 ? 's' : ''} · no cuentan como días hábiles` : 'Ninguno próximo · no cuentan como días hábiles'}</div></div>
        ${svg(ICO.chev, 16, 'style="color:var(--text-3);flex-shrink:0"')}
      </div>
    </div>`;
  cont.querySelector('#fb-abrir-festivos').onclick = abrirFestivos;
  cont.querySelector('#fb-abrir-meta').onclick = abrirMeta;
  cont.querySelectorAll('[data-ir]').forEach(el => el.onclick = () => el.dataset.ir === 'sin' ? irALista('todas', 'sin') : irALista(el.dataset.ir));
  cont.querySelectorAll('[data-tec]').forEach(el => el.onclick = () => irALista('todas', el.dataset.tec));
}

function irALista(filtro, tec = 'todos') {
  filtroSem_ = filtro; tecF_ = tec; busq_ = ''; limite_ = 40;
  setTab('ordenes');
}

// ── Meta diaria (admin / asistente) ───────────────
function abrirMeta() {
  const body = container_.querySelector('#fb-sheet-meta-body');
  body.innerHTML = `
    <div style="font-size:12px;color:var(--text-3);line-height:1.5;margin-bottom:14px">Órdenes cerradas que se esperan de cada técnico al día. Es la misma para todos.</div>
    <div class="form-field">
      <div class="form-label">Meta por técnico</div>
      <input class="form-input" id="fb-meta-val" type="number" inputmode="numeric" min="1" max="99" value="${cfg_.meta}"/>
    </div>
    <button class="btn-primary full" id="fb-meta-guardar">Guardar meta</button>`;
  body.querySelector('#fb-meta-guardar').onclick = async () => {
    const v = parseInt(body.querySelector('#fb-meta-val').value, 10);
    if (!(v >= 1 && v <= 99)) { toast('Escribe una meta entre 1 y 99', 'warn'); return; }
    try {
      await guardarConfig({ meta: v, metaActualizadaPor: session_.displayName, metaActualizadaEn: firebase.firestore.Timestamp.now() });
      container_.querySelector('#fb-sheet-meta').classList.remove('open');
      toast('Meta guardada', 'ok');
    } catch (err) {
      console.error('[factibilidades] meta:', err);
      toast('No se pudo guardar: ' + err.message, 'error');
    }
  };
  container_.querySelector('#fb-sheet-meta').classList.add('open');
}

// ── Exportar a Excel (admin / asistente) ──────────
// Para reportar a DELSUR: abiertas y cerradas desde una fecha, con días
// hábiles, resultado y si la coordenada fue corregida.
function abrirExportar() {
  const hoy = new Date();
  const ini = claveDia(new Date(hoy.getFullYear(), hoy.getMonth(), 1));
  const body = container_.querySelector('#fb-sheet-excel-body');
  body.innerHTML = `
    <div style="font-size:12px;color:var(--text-3);line-height:1.5;margin-bottom:14px">Incluye todas las órdenes abiertas y las cerradas desde la fecha que elijas. Los días hábiles se calculan igual que en la app.</div>
    <div class="form-field">
      <div class="form-label">Cerradas desde</div>
      <input class="form-input" id="fb-exp-desde" type="date" value="${ini}" max="${claveDia(hoy)}"/>
    </div>
    <div class="form-error" id="fb-exp-error"></div>
    <button class="btn-primary full" id="fb-exp-btn"><span id="fb-exp-lbl">Descargar Excel</span></button>`;
  body.querySelector('#fb-exp-btn').onclick = async () => {
    const v = body.querySelector('#fb-exp-desde').value;
    const err = body.querySelector('#fb-exp-error');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { err.textContent = 'Elige la fecha.'; err.style.display = 'block'; return; }
    const btn = body.querySelector('#fb-exp-btn');
    btn.disabled = true;
    body.querySelector('#fb-exp-lbl').innerHTML = '<div class="spinner"></div>';
    try {
      await exportarExcel(aFecha(v));
      container_.querySelector('#fb-sheet-excel').classList.remove('open');
    } catch (e) {
      console.error('[factibilidades] excel:', e);
      err.textContent = 'No se pudo generar: ' + e.message; err.style.display = 'block';
    } finally {
      btn.disabled = false;
      body.querySelector('#fb-exp-lbl').textContent = 'Descargar Excel';
    }
  };
  container_.querySelector('#fb-sheet-excel').classList.add('open');
}

async function exportarExcel(desde) {
  if (typeof XLSX === 'undefined') throw new Error('falta la librería de Excel (revisa la conexión)');
  // Cerradas desde la fecha: una consulta puntual (no queda escuchando)
  const snap = await db.collection(COL_ORDENES).where('fechaHecha', '>=', firebase.firestore.Timestamp.fromDate(desde)).get();
  const cerradas = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => o.estado === 'cerrada');
  const ESTADO = { null: 'Abierta', visita: 'Abierta (sin acceso)', cerrada: 'Cerrada' };
  const RES = { factible: 'Factible', no_factible: 'No factible', sin_acceso: 'Sin acceso' };
  const f = v => { const d = aFecha(v); return d ? d.toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''; };
  const fh = v => { const d = aFecha(v); return d ? d.toLocaleString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; };
  const num = v => { const n = parseFloat(v); return isFinite(n) ? n : ''; };
  const filas = [...ordenes_, ...cerradas].sort(porDias).map(o => {
    const { dias, color } = sem(o);
    const visitas = Array.isArray(o.visitas) ? o.visitas : [];
    return {
      'Orden': o.numeroOrden || '',
      'Cliente': o.cliente || '',
      'Dirección': o.direccion || '',
      'Técnico': o.asignadoNombre || 'Sin asignar',
      'Reasignada en la app': o.asignacionManual ? 'Sí' : 'No',
      'Fecha liberación': f(o.fechaLiberacion),
      'Días hábiles': dias ?? '',
      'Semáforo': color ? SEMAFORO[color].texto : '',
      'Estado': ESTADO[o.estado ?? null] || o.estado || '',
      'Resultado': RES[o.resultado] || '',
      'Observación': o.observacion || '',
      'Visitas sin acceso': visitas.length || '',
      'Fecha cierre': fh(o.fechaHecha),
      'Cerrada por': o.hechaPor || '',
      'Coordenada corregida': o.coordCorregida ? 'Sí' : 'No',
      'Corregida por': o.corregidaPor || '',
      'Fecha corrección': fh(o.fechaCorreccion),
      'Latitud': num(o.latitud),
      'Longitud': num(o.longitud),
      'Latitud original': num(o.latOriginal),
      'Longitud original': num(o.lngOriginal),
    };
  });
  const ws = filas.length ? XLSX.utils.json_to_sheet(filas) : XLSX.utils.aoa_to_sheet([['Sin órdenes']]);
  const anchos = { 'Orden': 13, 'Cliente': 28, 'Dirección': 40, 'Técnico': 22, 'Fecha liberación': 14, 'Semáforo': 12, 'Estado': 20, 'Observación': 36, 'Fecha cierre': 18, 'Cerrada por': 20, 'Corregida por': 20, 'Fecha corrección': 18 };
  if (filas.length) ws['!cols'] = Object.keys(filas[0]).map(k => ({ wch: anchos[k] || Math.max(10, k.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Factibilidades');
  XLSX.writeFile(wb, `Factibilidades_${claveDia(new Date())}.xlsx`);
  toast(`Excel descargado · ${filas.length} órdenes`, 'ok');
}

// ── Festivos (admin / asistente) ──────────────────
// Lista editable: Semana Santa cambia cada año y pueden decretarse asuetos.
function abrirFestivos() {
  pintarFestivos();
  container_.querySelector('#fb-sheet-festivos').classList.add('open');
}

function pintarFestivos() {
  const body = container_.querySelector('#fb-sheet-festivos-body');
  if (!body) return;
  const hoy = claveDia(new Date());
  const proximos = cfg_.festivos.filter(f => f >= hoy);
  const pasados = cfg_.festivos.filter(f => f < hoy).reverse();
  const fila = f => {
    const finDeSemana = [0, 6].includes(aFecha(f).getDay());
    return `
    <div class="cm-fila" style="cursor:default">
      <div style="flex:1;min-width:0">
        <div class="cm-fila-t">${esc(aFecha(f).toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }))}</div>
        ${finDeSemana ? '<div class="cm-fila-s">Cae en fin de semana: no cambia el conteo</div>' : ''}
      </div>
      <button class="cm-ico-btn" data-quitar="${f}" title="Quitar">${svg(ICO.basura, 16)}</button>
    </div>`;
  };
  body.innerHTML = `
    <div style="font-size:12px;color:var(--text-3);line-height:1.5;margin-bottom:14px">Los festivos, sábados y domingos no cuentan en los días hábiles del semáforo. El cambio se ve al instante en todas las pantallas.</div>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <input class="form-input" id="fb-fest-nuevo" type="date" style="flex:1"/>
      <button class="btn-action marca" id="fb-fest-agregar" style="flex:0 0 auto;width:auto;padding:0 18px">Agregar</button>
    </div>
    <div class="ds-sec">Próximos</div>
    ${proximos.length ? `<div class="cm-lista" style="margin-bottom:16px">${proximos.map(fila).join('')}</div>` : '<div class="ds-card" style="text-align:center;padding:16px;color:var(--text-3);font-size:13px;margin-bottom:16px">No hay festivos próximos.</div>'}
    ${pasados.length ? `<div class="ds-sec">Pasados</div><div class="cm-lista">${pasados.map(fila).join('')}</div>` : ''}`;

  body.querySelector('#fb-fest-agregar').onclick = async () => {
    const v = body.querySelector('#fb-fest-nuevo').value;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(v)) { toast('Elige una fecha', 'warn'); return; }
    if (cfg_.festivosSet.has(v)) { toast('Esa fecha ya está en la lista', 'warn'); return; }
    await guardarFestivos([...cfg_.festivos, v].sort());
  };
  body.querySelectorAll('[data-quitar]').forEach(b => b.onclick = async () => {
    if (!confirm('¿Quitar este festivo? Las órdenes volverán a contar ese día.')) return;
    await guardarFestivos(cfg_.festivos.filter(f => f !== b.dataset.quitar));
  });
}

async function guardarFestivos(lista) {
  try {
    await guardarConfig({ festivos: lista, festivosActualizadoPor: session_.displayName, festivosActualizadoEn: firebase.firestore.Timestamp.now() });
    toast('Festivos guardados', 'ok');
  } catch (err) {
    console.error('[factibilidades] festivos:', err);
    toast('No se pudo guardar: ' + err.message, 'error');
  }
}

// ── Órdenes ───────────────────────────────────────
const FILTROS = [
  { id: 'todas',    t: 'Todas',      f: () => true },
  { id: 'rojo',     t: 'Atrasadas',  f: o => sem(o).color === 'rojo' },
  { id: 'amarillo', t: 'Por vencer', f: o => sem(o).color === 'amarillo' },
  { id: 'verde',    t: 'A tiempo',   f: o => sem(o).color === 'verde' },
  { id: 'visita',   t: 'Sin acceso', f: o => o.estado === 'visita' },
];

// Técnicos para filtrar y reasignar: los activos del área y quien tenga órdenes
function tecnicosConOrdenes() {
  const m = new Map(tecnicos_.map(u => [u.id, u.displayName]));
  ordenes_.forEach(o => { if (o.asignadoUid && !m.has(o.asignadoUid)) m.set(o.asignadoUid, o.asignadoNombre || 'Sin nombre'); });
  return [...m.entries()].map(([id, nombre]) => ({ id, nombre })).sort((a, b) => String(a.nombre).localeCompare(String(b.nombre), 'es'));
}
const pasaTec = o => tecF_ === 'todos' || (tecF_ === 'sin' ? !o.asignadoUid : o.asignadoUid === tecF_);

function renderOrdenes(cont) {
  if (!ordenes_.length) {
    cont.innerHTML = `<div class="dev-module"><div class="dev-title">${esAdmin_ ? 'Aún no hay órdenes' : 'No tienes órdenes abiertas'}</div><p>${esAdmin_ ? 'Las órdenes llegan con el Excel de DELSUR.' : 'Cuando te asignen órdenes aparecerán aquí.'}</p></div>`;
    return;
  }
  // Si el buscador tenía el foco, se devuelve después de repintar
  const enfocado = document.activeElement?.id === 'fb-buscar' ? document.activeElement.selectionStart : null;
  const q = busq_.trim().toLowerCase();
  const filtro = FILTROS.find(x => x.id === filtroSem_) || FILTROS[0];
  const base = ordenes_.filter(pasaTec);
  const mostrar = (q ? ordenes_ : base)
    .filter(o => q ? [o.numeroOrden, o.cliente, o.direccion, o.asignadoNombre].some(v => v && String(v).toLowerCase().includes(q)) : filtro.f(o))
    .sort(porDias);
  const vis = mostrar.slice(0, limite_);
  const tecs = esAdmin_ ? tecnicosConOrdenes() : [];
  [...selec_].forEach(id => { if (!ordenes_.some(o => o.id === id)) selec_.delete(id); });   // ya se cerraron

  cont.innerHTML = `
    <div class="buscar-wrap" style="margin-bottom:12px">
      ${svg(ICO.buscar, 14, 'style="color:var(--text-4);flex-shrink:0"')}
      <input class="buscar-input" id="fb-buscar" placeholder="Buscar orden, cliente o dirección…" autocomplete="off" spellcheck="false" value="${esc(busq_)}"/>
    </div>
    ${!q && esAdmin_ ? `
    <div class="filter-row" style="margin-bottom:8px">
      ${[{ id: 'todos', nombre: 'Todos los técnicos' }, ...tecs, { id: 'sin', nombre: 'Sin asignar' }].map(t => `<div class="filter-chip ${tecF_ === t.id ? 'active' : ''}" data-tecf="${esc(t.id)}">${esc(t.nombre)}</div>`).join('')}
    </div>` : ''}
    ${q ? `<div style="font-size:12px;color:var(--text-3);margin:2px 2px 10px">${mostrar.length} resultado${mostrar.length !== 1 ? 's' : ''}</div>` : `
    <div class="cm-tabs-est">
      ${FILTROS.map(x => { const n = base.filter(x.f).length; return `<div class="cm-est ${x.id === filtroSem_ ? 'active' : ''} ${n ? '' : 'vacio'}" data-sem="${x.id}">${x.t}<span>${n}</span></div>`; }).join('')}
    </div>`}
    ${esAdmin_ && mostrar.length ? (modoSel_ ? `
    <div class="ds-card" style="position:sticky;top:0;z-index:5;display:flex;align-items:center;gap:8px;padding:10px 12px;margin-bottom:12px">
      <button class="cm-ico-btn" id="fb-sel-salir" title="Cancelar" style="flex-shrink:0">${svg(ICO.cerrar, 16)}</button>
      <div style="flex:1;min-width:0;font-size:13px;font-weight:600;white-space:nowrap">${selec_.size} selec.</div>
      <button class="cm-btn" id="fb-sel-todas">${mostrar.every(o => selec_.has(o.id)) ? 'Ninguna' : `Todas (${mostrar.length})`}</button>
      <button class="cm-btn marca" id="fb-sel-reasignar" ${selec_.size ? '' : 'disabled style="opacity:.5"'}>Reasignar</button>
    </div>` : `
    <button class="cm-btn" id="fb-sel-entrar" style="width:100%;height:40px;margin-bottom:12px">${svg(ICO.usuario, 14)} Seleccionar para reasignar</button>`) : ''}
    ${vis.length ? `<div class="crc-grid">${vis.map(tarjeta).join('')}</div>
      ${mostrar.length > vis.length ? `<button class="cm-btn" id="fb-ver-mas" style="width:100%;height:44px;margin-top:10px">Ver ${Math.min(40, mostrar.length - vis.length)} más (${mostrar.length - vis.length} restantes)</button>` : ''}`
      : `<div class="ds-card" style="text-align:center;padding:24px 16px;color:var(--text-3);font-size:13px">${q ? 'Nada coincide.' : `No hay órdenes en "${filtro.t}".`}</div>`}`;

  const inp = cont.querySelector('#fb-buscar');
  if (enfocado != null) { inp.focus(); try { inp.setSelectionRange(enfocado, enfocado); } catch {} }
  let tm = null;
  inp.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { busq_ = inp.value; limite_ = 40; renderOrdenes(cont); }, 250); };
  cont.querySelectorAll('[data-sem]').forEach(c => c.onclick = () => { filtroSem_ = c.dataset.sem; limite_ = 40; renderOrdenes(cont); });
  cont.querySelectorAll('[data-tecf]').forEach(c => c.onclick = () => { tecF_ = c.dataset.tecf; limite_ = 40; renderOrdenes(cont); });
  cont.querySelector('#fb-sel-entrar')?.addEventListener('click', () => { modoSel_ = true; selec_.clear(); renderOrdenes(cont); });
  cont.querySelector('#fb-sel-salir')?.addEventListener('click', () => { modoSel_ = false; selec_.clear(); renderOrdenes(cont); });
  cont.querySelector('#fb-sel-todas')?.addEventListener('click', () => {
    if (mostrar.every(o => selec_.has(o.id))) mostrar.forEach(o => selec_.delete(o.id));
    else mostrar.forEach(o => selec_.add(o.id));
    renderOrdenes(cont);
  });
  cont.querySelector('#fb-sel-reasignar')?.addEventListener('click', () => {
    if (!selec_.size) return;
    abrirReasignar(ordenes_.filter(o => selec_.has(o.id)), session_, tecnicos_, () => { modoSel_ = false; selec_.clear(); renderOrdenes(cont); });
  });
  cont.querySelectorAll('[data-sel]').forEach(c => c.onclick = () => {
    const id = c.dataset.sel;
    if (selec_.has(id)) selec_.delete(id); else selec_.add(id);
    renderOrdenes(cont);
  });
  cont.querySelectorAll('[data-reasignar]').forEach(b => b.onclick = () => abrirReasignar([ordenes_.find(o => o.id === b.dataset.reasignar)], session_, tecnicos_));
  cont.querySelector('#fb-ver-mas')?.addEventListener('click', () => { limite_ += 40; renderOrdenes(cont); });
  cont.querySelectorAll('[data-resultado]').forEach(b => b.onclick = () => abrirResultado(ordenes_.find(o => o.id === b.dataset.resultado), session_));
  cont.querySelectorAll('[data-vermapa]').forEach(b => b.onclick = () => verEnMapa(b.dataset.vermapa));
  cont.querySelectorAll('[data-navegar]').forEach(b => b.onclick = () => {
    const o = ordenes_.find(x => x.id === b.dataset.navegar);
    if (o) window.open(`https://www.google.com/maps/dir/?api=1&destination=${o.latitud},${o.longitud}`, '_blank');
  });
}

// Abre la orden en el mapa (el técnico tiene su pestaña Mapa; la oficina, la del área)
async function verEnMapa(id) {
  try {
    const m = await import('./factibilidades_mapa.js');
    m.pedirAbrir(id);
    if (esAdmin_) setTab('mapa'); else window.__router.navigateTo('factibilidades_mapa');
  } catch (err) { console.warn('[factibilidades] mapa:', err.message); }
}

function tarjeta(o) {
  const { dias, color } = sem(o);
  const s = color ? SEMAFORO[color] : null;
  const sel = modoSel_ && esAdmin_;
  const marcada = sel && selec_.has(o.id);
  return `
    <div class="cm-ord" ${sel ? `data-sel="${o.id}"` : ''} style="cursor:${sel ? 'pointer' : 'default'}${s ? `;box-shadow:inset 3px 0 0 ${s.color}, var(--sh-card)` : ''}${marcada ? ';outline:2px solid var(--fb-light);outline-offset:-2px' : ''}">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        ${sel ? `<span style="width:20px;height:20px;border-radius:6px;flex-shrink:0;display:flex;align-items:center;justify-content:center;border:1.5px solid ${marcada ? 'var(--fb-light)' : 'var(--border-md)'};background:${marcada ? 'var(--fb-light)' : 'transparent'};color:#fff">${marcada ? svg(ICO.marcar, 13) : ''}</span>` : ''}
        <span class="cm-wo">${esc(o.numeroOrden || '—')}</span>
        <span class="cm-pill ${s ? s.pill : 'muted'}">${textoDias(dias)}</span>
        ${o.estado === 'visita' ? '<span class="cm-pill muted">Sin acceso</span>' : ''}
      </div>
      ${o.cliente ? `<div class="cm-cli">${esc(o.cliente)}</div>` : ''}
      ${o.direccion ? `<div class="cm-meta">${esc(o.direccion)}</div>` : ''}
      <div class="cm-meta">Liberada ${fmtFecha(o.fechaLiberacion)}</div>
      ${esAdmin_ ? `<div class="cm-meta">${o.asignadoNombre ? esc(o.asignadoNombre) : '<span style="color:#fbbf24">Sin asignar</span>'}${o.asignacionManual ? ' · reasignada' : ''}</div>` : ''}
      ${sel ? '' : `<div class="cm-ord-acc">
        ${puedeActuar(o, session_) ? `<button class="cm-btn marca" data-resultado="${o.id}" style="flex:1">${svg(ICO.check, 14)} Resultado</button>` : ''}
        ${esAdmin_ ? `<button class="cm-btn marca" data-reasignar="${o.id}" style="flex:1">${svg(ICO.usuario, 14)} Reasignar</button>` : ''}
        ${coordOk(o) ? `<button class="cm-btn" data-vermapa="${o.id}">${svg(ICO.mapa, 14)} Mapa</button>
        <button class="cm-btn" data-navegar="${o.id}">${svg(ICO.nav, 14)} Navegar</button>` : '<span class="cm-meta" style="margin:0">Sin coordenadas</span>'}
      </div>`}
    </div>`;
}

const coordOk = o => isFinite(parseFloat(o.latitud)) && isFinite(parseFloat(o.longitud));

// ── Inicio del técnico (lo abre home.js) ──────────
// Meta del día (cerradas hoy contra la meta) y, destacadas, las rojas y
// amarillas: es lo que debe atacar primero. Devuelve la limpieza.
export function initHomeTecnico(container, session) {
  const fechaCorta = new Date().toLocaleDateString('es-SV', { day: 'numeric', month: 'short' });
  let abiertas = null, cerradasHoy = null, cfg = { festivos: [], festivosSet: new Set(), meta: META_DEFECTO };

  container.innerHTML = `
    <div class="ds-view anim-up">
      <div id="home-despachos-slot"></div>
      <div class="ds-pcard fb" style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:18px">
          <div>
            <div style="font-size:18px;font-weight:700;color:#fff;line-height:1.1">${esc(session.displayName)}</div>
            <div style="font-size:13px;color:rgba(255,255,255,.75);margin-top:3px">Factibilidades</div>
          </div>
          <div class="ds-pcard-badge">${fechaCorta}</div>
        </div>
        <div class="ds-pcard-lbl" style="margin-bottom:4px">Meta del día</div>
        <div style="font-size:38px;font-weight:500;letter-spacing:-.02em;line-height:1;color:#fff" id="fbh-frac">—</div>
        <div class="ds-bar on-grad" style="margin-top:14px"><i id="fbh-bar" style="width:0%;background:#fff"></i></div>
        <div style="font-size:12px;color:rgba(255,255,255,.75);margin-top:9px" id="fbh-sub">Cargando…</div>
      </div>

      <div class="ds-mini" style="margin-bottom:10px">
        <div class="ds-m" data-ir="rojo" style="cursor:pointer"><div class="ds-num-md" id="fbh-rojo" style="color:${SEMAFORO.rojo.color}">—</div><div class="ds-lbl-sm" style="margin-top:6px">Atrasadas</div></div>
        <div class="ds-m" data-ir="amarillo" style="cursor:pointer"><div class="ds-num-md" id="fbh-amarillo" style="color:${SEMAFORO.amarillo.color}">—</div><div class="ds-lbl-sm" style="margin-top:6px">Por vencer</div></div>
        <div class="ds-m" data-ir="todas" style="cursor:pointer"><div class="ds-num-md" id="fbh-abiertas">—</div><div class="ds-lbl-sm" style="margin-top:6px">Abiertas</div></div>
      </div>
      <div style="font-size:12px;color:var(--text-3);margin:0 4px 6px" id="fbh-aviso"></div>

      <div class="ds-acts" style="margin:22px 0 26px;grid-template-columns:repeat(2,1fr)">
        <div class="ds-act" data-ir="todas">
          <div style="color:var(--fb-light)">${svg(ICO.lista, 20)}</div>
          <div class="ds-act-t">Órdenes</div>
        </div>
        <div class="ds-act" id="fbh-mapa">
          <div style="color:var(--fb-light)">${svg(ICO.mapa, 20)}</div>
          <div class="ds-act-t">Mapa</div>
        </div>
      </div>

      <div class="ds-sec">Cerradas hoy</div>
      <div id="fbh-hoy"><div class="ds-lbl" style="text-align:center;padding:16px">Cargando…</div></div>
    </div>`;

  container.querySelectorAll('[data-ir]').forEach(el => el.onclick = () => {
    filtroPedido_ = el.dataset.ir;
    window.__router.navigateTo('factibilidades');
  });
  container.querySelector('#fbh-mapa').onclick = () => window.__router.navigateTo('factibilidades_mapa');

  const pintar = () => {
    if (!container.isConnected) return;
    const meta = cfg.meta;
    const q = id => container.querySelector(id);
    if (cerradasHoy) {
      const n = cerradasHoy.length;
      q('#fbh-frac').innerHTML = `${n}<span style="font-size:18px;color:rgba(255,255,255,.7)"> / ${meta}</span>`;
      q('#fbh-bar').style.width = Math.min(100, Math.round(n / meta * 100)) + '%';
      q('#fbh-sub').textContent = n >= meta ? 'Meta alcanzada' : `Faltan ${meta - n} para la meta`;
      const res = { factible: ['ok', 'Factible'], no_factible: ['crit', 'No factible'] };
      q('#fbh-hoy').innerHTML = n ? `<div class="flex-col gap-8">${cerradasHoy
        .slice().sort((a, b) => (aFecha(b.fechaHecha) || 0) - (aFecha(a.fechaHecha) || 0))
        .map(o => {
          const r = res[o.resultado] || ['muted', o.resultado || 'Cerrada'];
          const d = aFecha(o.fechaHecha);
          return `
          <div class="cm-ord" style="cursor:default">
            <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
              <span class="cm-wo">${esc(o.numeroOrden || '—')}</span>
              <span class="cm-pill ${r[0]}">${r[1]}</span>
              <span class="cm-meta" style="margin:0 0 0 auto">${d ? d.toLocaleTimeString('es-SV', { hour: '2-digit', minute: '2-digit' }) : ''}</span>
            </div>
            ${o.direccion ? `<div class="cm-meta">${esc(o.direccion)}</div>` : ''}
          </div>`;
        }).join('')}</div>`
        : `<div class="ds-card" style="text-align:center;padding:22px 16px;color:var(--text-3);font-size:13px">Aún no has cerrado órdenes hoy.</div>`;
    }
    if (abiertas) {
      const c = { rojo: 0, amarillo: 0 };
      abiertas.forEach(o => { const k = semaforoOrden(o, cfg.festivosSet).color; if (k in c) c[k]++; });
      q('#fbh-rojo').textContent = c.rojo;
      q('#fbh-amarillo').textContent = c.amarillo;
      q('#fbh-abiertas').textContent = abiertas.length;
      q('#fbh-aviso').textContent = c.rojo ? `Empieza por las ${c.rojo} atrasada${c.rojo !== 1 ? 's' : ''}: llevan más de 5 días hábiles.` : '';
    }
  };

  const offs = [
    suscribirConfig(x => { cfg = x; pintar(); }),
    suscribirAbiertas(session, lista => { if (lista) { abiertas = lista; pintar(); } }),
    suscribirCerradas(session, new Date(), lista => { if (lista) { cerradasHoy = lista.filter(o => esHoy(o.fechaHecha)); pintar(); } }),
  ];
  return () => offs.forEach(off => { try { off(); } catch {} });
}
