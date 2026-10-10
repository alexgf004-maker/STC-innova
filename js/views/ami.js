/**
 * js/views/ami.js
 * Módulo AMI (medidores telegestionados / remotos).
 *
 * AMI es, en el fondo, un cambio de medidores igual que el área "Cambios",
 * pero para medidores telegestionados y en campaña separada. Diferencias:
 *   - Las órdenes NO traen WO; se identifican solo por NC.
 *   - Versión más sencilla: sin órdenes urgentes ni cargas de listados aparte.
 *
 * Este archivo es por ahora el CASCARÓN del área: deja el espacio creado,
 * las pestañas y la identidad visual (morado) listas, pero la lógica de
 * órdenes (importador, mapa, marcar hechas) se conecta cuando tengamos el
 * archivo real de órdenes de AMI. Así el área ya existe sin cargar todo de una.
 *
 * Exporta: init(container, session)
 *
 * Roles:
 *   admin / asistente → Panel de gestión + todas las parejas
 *   tecnico (AMI)     → Solo su pareja
 */

import { db } from '../firebase.js';
import { leer, tecnicosActivos } from '../vivo.js';
import { padronAmi } from './ami_padron.js';
import { toast, escapeHtml } from '../ui.js';
import { devolverAPendiente, puedeDevolverse } from './ami_devolver.js';

// ── Identidad del área ────────────────────────────
const AREA = 'AMI';
const COLECCION = 'ami_ordenes';        // colección propia en Firestore
const ACCENT = '#a78bfa';               // morado/violeta (distinto de las otras áreas)
const ACCENT_GLASS = 'rgba(139,92,246,.12)';
const ACCENT_BORDER = 'rgba(139,92,246,.35)';

// Parejas (mismas que Cambios; se ajustará si AMI usa otras cuadrillas)
const PAREJAS = ['Pareja 1', 'Pareja 2', 'Pareja 3', 'Pareja 4', 'Pareja 5', 'Pareja 6'];
const PALETA_PAREJA = ['#2dd4bf', '#f472b6', '#a78bfa', '#fbbf24', '#60a5fa', '#fb923c'];
function colorPareja(pareja) {
  const n = parseInt(String(pareja).replace(/\D/g, ''), 10);
  return PALETA_PAREJA[(n - 1) % PALETA_PAREJA.length] || '#94a3b8';
}

// ── Residuos (órdenes arrastradas de rutas anteriores) ──
// Una orden es "residuo" si sigue pendiente y su fechaRuta es de un día
// anterior a hoy. La ruta que DELSUR manda cada día trae fechaRuta = ese día.
function claveDiaAMI(ts) {
  const d = ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : (ts ? new Date(ts) : null));
  if (!d) return null;
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}
function diasArrastrada(o) {
  const clave = claveDiaAMI(o.fechaRuta);
  if (!clave) return 0;
  const [y,m,d] = clave.split('-').map(Number);
  const ruta = new Date(y, m-1, d); ruta.setHours(0,0,0,0);
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const dias = Math.round((hoy - ruta) / 86400000);
  return dias > 0 ? dias : 0;
}
function esResiduo(o) {
  const hecha = o.estadoCampo === 'hecha' || o.estadoCampo === 'aprobada';
  return !hecha && diasArrastrada(o) > 0;
}

// Cuántas órdenes marcó una pareja HOY (por fechaHecha), cuenten o no como
// arrastradas. Es el avance hacia la meta diaria.
function hechasHoyPorPareja(pareja) {
  const hoy = claveDiaAMI(firebase.firestore.Timestamp.now());
  // Incluye condominios: lo que la pareja cambia ahí también cuenta para su meta
  return [...ordenes_, ...condominios_].filter(o => {
    if (o.pareja !== pareja) return false;
    if (o.estadoCampo !== 'hecha' && o.estadoCampo !== 'aprobada') return false;
    return claveDiaAMI(o.fechaHecha) === hoy;
  }).length;
}

// ── Estado del módulo ─────────────────────────────
let container_, session_, role_, pareja_;
let ordenes_ = [];
let busquedaActuales_ = [];  // órdenes que salieron en la búsqueda por NC (para devolver)
let condominios_ = [];       // órdenes de condominio (tipoSitio:'condominio'), aparte de la ruta diaria
let activeTab_ = 'panel';   // 'panel' | 'resumen' | 'ordenes' | 'mapa'
let esAdmin_ = false;
let metas_ = {};            // { "Pareja 1": 25, ... } — meta diaria por pareja
let parejasActivas_ = [];   // parejas con al menos un técnico activo en AMI
let filtroOrd_ = 'pendientes', parejaF_ = 'todas', busq_ = '', limite_ = 40;
let revTipo_ = 'yc';        // hoja de revisión abierta: 'yc' (ya cambiadas) | 'mu' (mal ubicadas)

// ── Íconos y piezas ──
const ICO_A = {
  dots:   '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  buscar: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  subir:  '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  bajar:  '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  check:  '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  alerta: '<circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>',
  pin:    '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>',
  reloj:  '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>',
  edif:   '<rect x="4" y="2" width="16" height="20" rx="2"/><path d="M9 22v-4h6v4"/><path d="M8 6h.01M12 6h.01M16 6h.01M8 10h.01M12 10h.01M16 10h.01M8 14h.01M12 14h.01M16 14h.01"/>',
  mapa:   '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
  chev:   '<polyline points="9 18 15 12 9 6"/>',
};
const svgA = (d, n = 16, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${n}" height="${n}" ${extra}>${d}</svg>`;
const escA = v => escapeHtml(v == null ? '' : String(v));
function accionA(id, ico, txt, sub) {
  return `<button class="us-accion" id="${id}">${svgA(ico, 18)}<span style="flex:1;text-align:left"><span style="display:block">${txt}</span><span class="us-accion-sub">${sub}</span></span></button>`;
}
function filaA(cls, ico, titulo, sub, accion) {
  return `
    <div class="cm-fila" data-accion="${accion}">
      <div class="cm-fila-ic ${cls}">${svgA(ico, 17)}</div>
      <div style="flex:1;min-width:0"><div class="cm-fila-t">${titulo}</div><div class="cm-fila-s">${sub}</div></div>
      ${svgA(ICO_A.chev, 16, 'style="color:var(--text-3);flex-shrink:0"')}
    </div>`;
}
const realizada = o => o.estadoCampo === 'hecha' || o.estadoCampo === 'aprobada';
const fmtFA = (ts, conHora = true) => {
  const d = ts?.toDate ? ts.toDate() : (ts ? new Date(ts) : null);
  return d ? d.toLocaleString('es-SV', conHora ? { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' } : { day: 'numeric', month: 'short' }) : '';
};

// ── Entry point ───────────────────────────────────
export async function init(container, session) {
  container_ = container;
  session_   = session;
  role_      = session.role;
  esAdmin_   = role_ === 'admin' || role_ === 'asistente';
  pareja_    = session.asignacionActual?.destino || null;
  activeTab_ = esAdmin_ ? 'panel' : 'resumen';
  filtroOrd_ = 'pendientes'; parejaF_ = 'todas'; busq_ = ''; limite_ = 40;

  renderShell();
  await cargarOrdenes();
  setTab(activeTab_);
}

// ── Cargar órdenes ────────────────────────────────
// Admin: toda la colección. Técnico: SOLO las de su pareja (antes bajaba
// la colección completa y filtraba en el teléfono).
async function cargarOrdenes() {
  try {
    // Mismo listener que el mapa y el inicio (js/vivo.js)
    let todas = [];
    if (esAdmin_) {
      todas = await leer(`${COLECCION}|*`, () => db.collection(COLECCION));
    } else if (pareja_) {
      todas = await leer(`${COLECCION}|${pareja_}`, () => db.collection(COLECCION).where('pareja', '==', pareja_));
    }

    // Padrón de NC ya cambiados (para marcar/esconder). El admin lo lee
    // completo; el técnico solo pregunta por los NC de su ruta (el id del
    // documento es el NC), de 30 en 30.
    let padron = new Set();
    try { padron = await padronAmi(esAdmin_, todas.map(o => o.nc)); }
    catch (e) { /* si no existe aún, padrón vacío */ }

    todas.forEach(o => { o._yaCambiada = padron.has(String(o.nc ?? '').trim()); });
    if (!esAdmin_) todas = todas.filter(o => !o._yaCambiada);
    // Los condominios son una campaña de semanas con su propia vista: no se
    // mezclan con la ruta diaria (avance del día, listas, arrastradas).
    condominios_ = todas.filter(o => o.tipoSitio === 'condominio');
    ordenes_ = todas.filter(o => o.tipoSitio !== 'condominio');

    // Metas diarias por pareja (persistentes: se mantienen hasta cambiarlas)
    try {
      const cfg = await db.collection('ami_config').doc('metas').get();
      metas_ = cfg.exists ? (cfg.data().parejas || {}) : {};
    } catch (e) { metas_ = {}; }

    // Parejas activas: las que tienen al menos un técnico activo en AMI
    if (esAdmin_) {
      try {
        const set = new Set();
        (await tecnicosActivos(db)).forEach(u => { if (u.asignacionActual?.area === AREA && u.asignacionActual?.destino) set.add(u.asignacionActual.destino); });
        parejasActivas_ = [...set].sort((a, b) =>
          (parseInt(String(a).replace(/\D/g,''),10)||0) - (parseInt(String(b).replace(/\D/g,''),10)||0));
      } catch (e) { parejasActivas_ = []; }
    } else {
      parejasActivas_ = pareja_ ? [pareja_] : [];
    }
  } catch (err) {
    console.warn('[ami] No se pudieron cargar órdenes todavía:', err.message);
    ordenes_ = [];
  }
}

// ── Shell (pestañas, acciones y hojas) ────────────
function renderShell() {
  const tabs = esAdmin_
    ? [{ id: 'panel', label: 'Panel' }, { id: 'ordenes', label: 'Órdenes' }, { id: 'mapa', label: 'Mapa' }]
    : [{ id: 'resumen', label: 'Resumen' }, { id: 'ordenes', label: 'Órdenes' }];

  container_.innerHTML = `
    <div class="ami-scope" style="max-width:1100px;margin:0 auto">
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:16px">
        <div style="flex:1;min-width:0">
          <div style="font-size:24px;font-weight:600;letter-spacing:-.02em;line-height:1.15">AMI</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:4px">Cambio de medidores telegestionados${!esAdmin_ && pareja_ ? ' · ' + escA(pareja_) : ''}</div>
        </div>
        ${esAdmin_ ? `<button class="cm-ico-btn" id="ami-menu" title="Acciones">${svgA(ICO_A.dots, 18)}</button>` : ''}
      </div>
      <div class="area-tabs" style="margin-bottom:14px">
        ${tabs.map(t => `<button class="area-tab ami-tab" data-tab="${t.id}">${t.label}</button>`).join('')}
      </div>
      <div id="ami-content"></div>

      ${esAdmin_ ? `
      <input type="file" id="ami-file-importar" accept=".xlsx,.xls" style="display:none"/>
      <input type="file" id="ami-file-historial" accept=".xlsx,.xls" style="display:none"/>
      <input type="file" id="ami-file-condominio" accept=".xlsx,.xls" style="display:none"/>
      ${hoja('ami-sheet-acciones', 'Acciones de AMI', `<div class="flex-col gap-8">
        ${accionA('ami-a-ruta', ICO_A.subir, 'Cargar ruta del día', 'Excel con NC, nombre, dirección y coordenadas')}
        ${accionA('ami-a-condo', ICO_A.edif, 'Cargar condominio', 'Excel de un edificio, aparte de la ruta')}
        ${accionA('ami-a-hist', ICO_A.reloj, 'Cargar historial', 'Trabajos anteriores y padrón de ya cambiados')}
        <div class="cm-acc-sep">Reportes</div>
        ${accionA('ami-a-excel', ICO_A.bajar, 'Excel del día', 'Trabajo, ruta y resumen del día que elijas')}
      </div>`)}
      ${hoja('ami-sheet-confirmar', 'Por confirmar', '', true)}
      ${hoja('ami-sheet-rev', 'Revisar', '', true)}
      ${hoja('ami-sheet-metas', 'Metas del día por pareja', '')}` : ''}
    </div>`;

  container_.querySelectorAll('.ami-tab').forEach(tab => { tab.onclick = () => setTab(tab.dataset.tab); });
  if (!esAdmin_) return;

  container_.querySelectorAll('.sheet-backdrop').forEach(sh => sh.addEventListener('click', e => { if (e.target === sh) sh.classList.remove('open'); }));
  const abrirH = id => container_.querySelector('#' + id).classList.add('open');
  const cerrarH = id => container_.querySelector('#' + id).classList.remove('open');
  container_.querySelector('#ami-menu').onclick = () => abrirH('ami-sheet-acciones');
  const fRuta = container_.querySelector('#ami-file-importar');
  const fHist = container_.querySelector('#ami-file-historial');
  const fCondo = container_.querySelector('#ami-file-condominio');
  container_.querySelector('#ami-a-ruta').onclick = () => { cerrarH('ami-sheet-acciones'); fRuta.click(); };
  container_.querySelector('#ami-a-condo').onclick = () => { cerrarH('ami-sheet-acciones'); fCondo.click(); };
  container_.querySelector('#ami-a-hist').onclick = () => { cerrarH('ami-sheet-acciones'); fHist.click(); };
  container_.querySelector('#ami-a-excel').onclick = () => { cerrarH('ami-sheet-acciones'); abrirExportarDia(); };
  fRuta.onchange = (e) => importarRuta(e.target.files[0]);
  fHist.onchange = (e) => importarHistorial(e.target.files[0]);
  fCondo.onchange = (e) => { const f = e.target.files[0]; fCondo.value = ''; importarCondominio(f); };
}

function hoja(id, titulo, cuerpo, alta = false) {
  return `
    <div class="sheet-backdrop" id="${id}">
      <div class="sheet" ${alta ? 'style="max-height:92vh"' : ''}>
        <div class="sheet-handle"></div>
        <div class="sheet-title" id="${id}-title">${titulo}</div>
        <div class="sheet-body" id="${id}-body" style="padding-bottom:16px">${cuerpo}</div>
      </div>
    </div>`;
}

function setTab(tab) {
  activeTab_ = tab;
  container_.querySelectorAll('.ami-tab').forEach(t => {
    const activa = t.dataset.tab === tab;
    t.classList.toggle('active', activa);
    t.classList.toggle('am', activa);
  });
  const cont = container_.querySelector('#ami-content');
  if (!cont) return;
  if (tab === 'mapa') {
    cont.innerHTML = '';
    import('./ami_mapa.js')
      .then(mod => mod.init(cont, session_))
      .catch(err => {
        cont.innerHTML = bloquePreparacion('No se pudo cargar el mapa', 'Intenta de nuevo en un momento.');
        console.warn('[ami] Error cargando ami_mapa:', err.message);
      });
  }
  else if (tab === 'ordenes') renderOrdenes(cont);
  else if (tab === 'resumen') renderResumenTec(cont);
  else renderPanel(cont);
}

// Repinta la pestaña actual y las hojas abiertas (después de una acción)
function refrescar() {
  if (activeTab_ !== 'mapa') setTab(activeTab_);
  if (container_.querySelector('#ami-sheet-confirmar')?.classList.contains('open')) pintarConfirmar();
  if (container_.querySelector('#ami-sheet-rev')?.classList.contains('open')) pintarRevision();
}

function irAOrdenes(filtro) { filtroOrd_ = filtro; busq_ = ''; limite_ = 40; setTab('ordenes'); }

// ── Revisión admin: "ya cambiadas" y "mal ubicadas" ──
async function aprobarYaCambiadoAdmin(id) {
  if (!confirm('¿Confirmar que esta orden la hicimos nosotros? Pasará a aprobada y quedará registrada.')) return;
  try {
    await db.collection(COLECCION).doc(id).update({
      estadoCampo: 'aprobada',
      aprobadoPor: session_.displayName,
      fechaAprobacion: firebase.firestore.Timestamp.now(),
    });
    const o = ordenes_.find(x => x.id === id);
    if (o) { o.estadoCampo = 'aprobada'; o.aprobadoPor = session_.displayName; }
    refrescar();
    window.dispatchEvent(new CustomEvent('ami:updated'));
    toast('Orden confirmada como hecha por nosotros', 'ok');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

async function revertirYaCambiadoAdmin(id) {
  if (!confirm('¿Revertir esta orden a pendiente? El técnico podrá trabajarla de nuevo.')) return;
  try {
    await db.collection(COLECCION).doc(id).update({
      estadoCampo: null, yaCambiadoPor: null, yaCambiadoEn: null, yaCambiadoComentario: null,
    });
    const o = ordenes_.find(x => x.id === id);
    if (o) { o.estadoCampo = null; o.yaCambiadoPor = null; }
    refrescar();
    window.dispatchEvent(new CustomEvent('ami:updated'));
    toast('Orden revertida a pendiente', 'ok');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

async function corregirCoordenadasAdmin(id) {
  const lat = parseFloat(document.getElementById(`ami-lat-${id}`)?.value);
  const lng = parseFloat(document.getElementById(`ami-lng-${id}`)?.value);
  if (isNaN(lat) || isNaN(lng)) { toast('Ingresa coordenadas válidas', 'error'); return; }
  try {
    await db.collection(COLECCION).doc(id).update({
      latitud: lat, longitud: lng, estadoCampo: null, malUbicadoPor: null, malUbicadoEn: null,
    });
    const o = ordenes_.find(x => x.id === id);
    if (o) { o.latitud = lat; o.longitud = lng; o.estadoCampo = null; }
    refrescar();
    window.dispatchEvent(new CustomEvent('ami:updated'));
    toast('Coordenadas actualizadas', 'ok');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

async function revertirMalUbicadoAdmin(id) {
  if (!confirm('¿Revertir esta orden a pendiente?')) return;
  try {
    await db.collection(COLECCION).doc(id).update({
      estadoCampo: null, malUbicadoPor: null, malUbicadoEn: null,
    });
    const o = ordenes_.find(x => x.id === id);
    if (o) o.estadoCampo = null;
    refrescar();
    window.dispatchEvent(new CustomEvent('ami:updated'));
    toast('Orden revertida a pendiente', 'ok');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

// Guarda la meta de una pareja (persistente en ami_config/metas).
async function guardarMeta(pareja, valor) {
  const n = parseInt(valor, 10);
  metas_[pareja] = isNaN(n) || n < 0 ? 0 : n;
  try {
    await db.collection('ami_config').doc('metas').set({ parejas: metas_ }, { merge: true });
    if (activeTab_ !== 'ordenes' && activeTab_ !== 'mapa') setTab(activeTab_);
  } catch (err) {
    toast('No se pudo guardar la meta: ' + err.message, 'error');
  }
}

function abrirRevision(tipo) {
  revTipo_ = tipo;
  pintarRevision();
  container_.querySelector('#ami-sheet-rev')?.classList.add('open');
}

function pintarRevision() {
  const body = container_.querySelector('#ami-sheet-rev-body');
  if (!body) return;
  const yc = revTipo_ === 'yc';
  const arr = ordenes_.filter(o => o.estadoCampo === (yc ? 'ya_cambiado' : 'mal_ubicado'));
  container_.querySelector('#ami-sheet-rev-title').textContent = yc ? 'Reportadas como ya cambiadas' : 'Mal ubicadas';
  const ycCard = (o) => `
    <div class="cm-verif" style="flex-direction:column;align-items:stretch;gap:8px">
      <div style="display:flex;justify-content:space-between;gap:10px">
        <div style="min-width:0"><div class="cm-wo">NC ${escA(o.nc || '—')}</div><div class="cm-cli">${escA(o.cliente || '—')}</div></div>
        <div class="cm-meta" style="text-align:right;flex-shrink:0">${fmtFA(o.yaCambiadoEn)}<br>${escA(o.yaCambiadoPor || '—')}</div>
      </div>
      ${o.yaCambiadoComentario ? `<div style="font-size:12px;color:var(--text-2);padding:8px 10px;background:rgba(255,255,255,.04);border-radius:8px">${escA(o.yaCambiadoComentario)}</div>` : ''}
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="cm-btn ok ami-yc-aprobar" data-id="${o.id}">Lo hicimos nosotros</button>
        <button class="cm-btn ami-yc-revertir" data-id="${o.id}">Revertir</button>
      </div>
    </div>`;
  const muCard = (o) => `
    <div class="cm-verif" style="flex-direction:column;align-items:stretch;gap:8px">
      <div style="display:flex;justify-content:space-between;gap:10px">
        <div style="min-width:0"><div class="cm-wo">NC ${escA(o.nc || '—')}</div><div class="cm-cli">${escA(o.cliente || '—')}</div><div class="cm-meta">${escA(o.direccion || '')}</div></div>
        <div class="cm-meta" style="text-align:right;flex-shrink:0">${fmtFA(o.malUbicadoEn, false)}<br>${escA(o.malUbicadoPor || '—')}</div>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px">
        <input class="form-input" id="ami-lat-${o.id}" type="number" step="any" placeholder="Latitud" value="${escA(o.latitud || '')}" style="font-size:13px;padding:9px 10px"/>
        <input class="form-input" id="ami-lng-${o.id}" type="number" step="any" placeholder="Longitud" value="${escA(o.longitud || '')}" style="font-size:13px;padding:9px 10px"/>
      </div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button class="cm-btn ok ami-mu-guardar" data-id="${o.id}">Guardar coordenadas</button>
        <button class="cm-btn ami-mu-revertir" data-id="${o.id}">Revertir a pendiente</button>
      </div>
    </div>`;
  body.innerHTML = arr.length
    ? `<div style="font-size:12.5px;color:var(--text-3);margin-bottom:12px">${yc ? 'Confirma si las hicimos nosotros o devuélvelas a pendiente.' : 'Corrige las coordenadas o devuélvelas a pendiente.'}</div>
       <div class="flex-col gap-8">${arr.map(yc ? ycCard : muCard).join('')}</div>`
    : `<div style="text-align:center;padding:24px;color:var(--text-3);font-size:13px">Nada pendiente de revisar.</div>`;
  body.querySelectorAll('.ami-yc-aprobar').forEach(b => b.onclick = () => aprobarYaCambiadoAdmin(b.dataset.id));
  body.querySelectorAll('.ami-yc-revertir').forEach(b => b.onclick = () => revertirYaCambiadoAdmin(b.dataset.id));
  body.querySelectorAll('.ami-mu-guardar').forEach(b => b.onclick = () => corregirCoordenadasAdmin(b.dataset.id));
  body.querySelectorAll('.ami-mu-revertir').forEach(b => b.onclick = () => revertirMalUbicadoAdmin(b.dataset.id));
}

function abrirMetas() {
  const body = container_.querySelector('#ami-sheet-metas-body');
  if (!body) return;
  // Todas las parejas de AMI, no solo las que tienen técnicos asignados hoy:
  // si hoy nadie estaba asignado, la hoja salía vacía y no se podía editar.
  const parejas = [...new Set([...parejasActivas_, ...Object.keys(metas_), ...ordenes_.map(o => o.pareja)].filter(Boolean))]
    .sort((a, b) => (parseInt(String(a).replace(/\D/g, ''), 10) || 0) - (parseInt(String(b).replace(/\D/g, ''), 10) || 0));
  body.innerHTML = parejas.length ? `
    <div style="font-size:12.5px;color:var(--text-3);margin-bottom:12px">Cuántos cambios debe hacer cada pareja al día. Se guarda solo y se mantiene hasta que lo cambies.</div>
    <div class="flex-col gap-8">
      ${parejas.map(p => `
        <div class="cm-verif">
          <span class="cm-par-dot" style="background:${colorPareja(p)}"></span>
          <div style="flex:1;min-width:0"><div style="font-size:14px;font-weight:600">${escA(p)}</div>${parejasActivas_.includes(p) ? '' : '<div style="font-size:11px;color:var(--text-4)">Sin técnicos asignados hoy</div>'}</div>
          <input type="number" min="0" inputmode="numeric" class="form-input ami-meta-input" data-pareja="${escA(p)}" value="${Number(metas_[p] || 0) || ''}" placeholder="0" style="width:76px;text-align:center;font-size:15px;padding:9px"/>
        </div>`).join('')}
    </div>` : `<div style="text-align:center;padding:24px;color:var(--text-3);font-size:13px">No hay parejas asignadas a AMI. Asígnalas en Usuarios.</div>`;
  body.querySelectorAll('.ami-meta-input').forEach(inp => { inp.onchange = () => guardarMeta(inp.dataset.pareja, inp.value); });
  container_.querySelector('#ami-sheet-metas')?.classList.add('open');
}

// ── Panel (admin) ─────────────────────────────────
function renderPanel(cont) {
  const total = ordenes_.length;
  const confirmadas = ordenes_.filter(o => o.estadoCampo === 'aprobada').length;
  const porConfirmar = ordenes_.filter(o => o.estadoCampo === 'hecha');
  const visitas = ordenes_.filter(o => o.estadoCampo === 'visita').length;
  const pendientes = ordenes_.filter(o => !o.estadoCampo && !o._yaCambiada).length;
  const arrastradas = ordenes_.filter(o => esResiduo(o) && !o.estadoCampo && !o._yaCambiada).length;
  const padron = ordenes_.filter(o => o._yaCambiada).length;
  const yc = ordenes_.filter(o => o.estadoCampo === 'ya_cambiado').length;
  const mu = ordenes_.filter(o => o.estadoCampo === 'mal_ubicado').length;
  const parejas = parejasActivas_;
  const totalHoy = parejas.reduce((s, p) => s + hechasHoyPorPareja(p), 0);
  const totalMeta = parejas.reduce((s, p) => s + Number(metas_[p] || 0), 0);
  const seg = n => total ? (n / total * 100).toFixed(2) : 0;

  const revisar = [
    porConfirmar.length ? filaA('warn', ICO_A.check, `${porConfirmar.length} por confirmar`, 'Confirmar por día o todas', 'confirmar') : '',
    yc ? filaA('orange', ICO_A.alerta, `${yc} reportada${yc > 1 ? 's' : ''} como ya cambiada${yc > 1 ? 's' : ''}`, '¿Las hicimos nosotros o se revierten?', 'yc') : '',
    mu ? filaA('violet', ICO_A.pin, `${mu} mal ubicada${mu > 1 ? 's' : ''}`, 'Corregir coordenadas', 'mu') : '',
    arrastradas ? filaA('muted', ICO_A.reloj, `${arrastradas} arrastrada${arrastradas > 1 ? 's' : ''}`, 'Pendientes de rutas anteriores', 'arrastradas') : '',
  ].join('');

  cont.innerHTML = `
    <div class="ds-pcard am" style="margin-bottom:22px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div class="ds-pcard-lbl">Cambios hoy</div>
        <div class="ds-pcard-badge" id="ami-metas-btn" style="cursor:pointer">Metas</div>
      </div>
      <div style="font-size:38px;font-weight:500;letter-spacing:-.02em;line-height:1;color:#fff;margin-top:6px">${totalHoy}${totalMeta ? `<span style="font-size:18px;color:rgba(255,255,255,.7)"> / ${totalMeta}</span>` : ''}</div>
      <div style="font-size:12px;color:rgba(255,255,255,.85);margin-top:8px">${parejas.length ? `${parejas.length} pareja${parejas.length > 1 ? 's' : ''} en campo${totalMeta ? '' : ' · toca "Metas" para definirlas'}` : 'No hay parejas asignadas a AMI hoy'}</div>
      ${parejas.length ? `
      <div style="height:1px;background:rgba(255,255,255,.2);margin:14px 0 12px"></div>
      <div class="flex-col" style="gap:12px">
        ${parejas.map(p => {
          const n = hechasHoyPorPareja(p); const meta = Number(metas_[p] || 0);
          return `
          <div>
            <div style="display:flex;align-items:baseline;gap:8px">
              <span style="font-size:13px;font-weight:600;color:#fff;flex:1">${escA(p)}</span>
              <span style="font-size:14px;font-weight:700;color:#fff">${n}<span style="font-size:11px;font-weight:500;color:rgba(255,255,255,.7)"> / ${meta || '—'}</span></span>
            </div>
            <div class="ds-bar on-grad" style="margin-top:6px;height:5px"><i style="width:${meta ? Math.min(100, Math.round(n / meta * 100)) : 0}%;background:#fff"></i></div>
          </div>`;
        }).join('')}
      </div>` : ''}
    </div>

    <div class="ds-sec">Para revisar</div>
    <div class="cm-lista" style="margin-bottom:22px">
      ${revisar || `<div class="cm-fila" style="cursor:default"><div class="cm-fila-ic ok">${svgA(ICO_A.check, 17)}</div><div style="flex:1"><div class="cm-fila-t">Todo al día</div><div class="cm-fila-s">Nada pendiente de revisar</div></div></div>`}
    </div>

    ${condominios_.length ? `<div style="margin-bottom:22px">${renderResumenCondominios()}</div>` : ''}

    <div class="ds-sec">Avance de la ruta</div>
    ${total ? `
    <div class="ds-card">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px">
        <div class="ds-num-md">${confirmadas + porConfirmar.length}<span style="font-size:14px;font-weight:500;color:var(--text-3)"> / ${total} realizadas</span></div>
        <div style="font-size:15px;font-weight:600;color:var(--am-light)">${Math.round((confirmadas + porConfirmar.length) / total * 100)}%</div>
      </div>
      <div class="cm-seg">
        <i style="width:${seg(confirmadas)}%;background:#22c55e"></i>
        <i style="width:${seg(porConfirmar.length)}%;background:#fbbf24"></i>
        <i style="width:${seg(visitas)}%;background:#94a3b8"></i>
      </div>
      <div class="cm-leyenda">
        <span><b style="background:#22c55e"></b>${confirmadas} confirmadas</span>
        <span><b style="background:#fbbf24"></b>${porConfirmar.length} por confirmar</span>
        <span><b style="background:#94a3b8"></b>${visitas} visitas</span>
        <span><b style="background:rgba(255,255,255,.15)"></b>${pendientes} pendientes</span>
        ${padron ? `<span><b style="background:#16a34a"></b>${padron} ya en el padrón</span>` : ''}
      </div>
    </div>` : `<div class="dev-module"><div class="dev-title">Aún no hay ruta cargada</div><p>Usa los tres puntos de arriba, "Cargar ruta del día", para subir el Excel.</p></div>`}`;

  cont.querySelector('#ami-metas-btn').onclick = abrirMetas;
  cont.querySelectorAll('[data-accion]').forEach(f => f.onclick = () => {
    const a = f.dataset.accion;
    if (a === 'confirmar') abrirConfirmar();
    else if (a === 'yc' || a === 'mu') abrirRevision(a);
    else if (a === 'arrastradas') irAOrdenes('pendientes');
  });
  cont.querySelectorAll('.ami-condo-abrir').forEach(el => el.onclick = async () => {
    const mod = await import('./ami_condominio.js');
    mod.abrirVistaCondominio({
      key: el.dataset.key, session: session_, parejas: parejasActivas_,
      obtener: () => condominios_,
      alCerrar: async ({ eliminado } = {}) => {
        if (eliminado) await cargarOrdenes();
        if (activeTab_ === 'panel') setTab('panel');
      },
    });
  });
}

// ── Resumen (técnico) ─────────────────────────────
function renderResumenTec(cont) {
  if (!pareja_) {
    cont.innerHTML = `<div class="dev-module"><div class="dev-title">Sin pareja asignada</div><p>Pide que te asignen a una pareja de AMI.</p></div>`;
    return;
  }
  const hoy = claveDiaAMI(firebase.firestore.Timestamp.now());
  const meta = Number(metas_[pareja_] || 0);
  const n = hechasHoyPorPareja(pareja_);
  const pendientes = ordenes_.filter(o => !o.estadoCampo).length;
  const arrastradas = ordenes_.filter(o => esResiduo(o) && !o.estadoCampo).length;
  const visitasHoy = ordenes_.filter(o => o.estadoCampo === 'visita' && claveDiaAMI(o.fechaVisita) === hoy).length;
  const hoyLista = [...ordenes_, ...condominios_]
    .filter(o => (realizada(o) && claveDiaAMI(o.fechaHecha) === hoy) || (o.estadoCampo === 'visita' && claveDiaAMI(o.fechaVisita) === hoy))
    .sort((a, b) => ((b.fechaHecha || b.fechaVisita)?.seconds || 0) - ((a.fechaHecha || a.fechaVisita)?.seconds || 0));

  cont.innerHTML = `
    <div class="ds-pcard am" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div class="ds-pcard-lbl">Meta del día</div>
        <div class="ds-pcard-badge">${escA(pareja_)}</div>
      </div>
      <div style="font-size:38px;font-weight:500;letter-spacing:-.02em;line-height:1;color:#fff;margin-top:6px">${n}<span style="font-size:18px;color:rgba(255,255,255,.7)"> / ${meta || '—'}</span></div>
      <div class="ds-bar on-grad" style="margin-top:14px"><i style="width:${meta ? Math.min(100, Math.round(n / meta * 100)) : 0}%;background:#fff"></i></div>
      <div style="font-size:12px;color:rgba(255,255,255,.85);margin-top:9px">${meta ? (n >= meta ? 'Meta alcanzada' : `Faltan ${meta - n} para la meta`) : 'Sin meta definida · cambios de hoy'}</div>
    </div>

    <button class="btn-action marca" id="ami-abrir-mapa" style="margin-bottom:14px">${svgA(ICO_A.mapa, 16)} Abrir el mapa</button>

    <div class="ds-mini" style="margin-bottom:20px">
      <div class="ds-m" data-ir="pendientes" style="cursor:pointer"><div class="ds-num-md">${pendientes}</div><div class="ds-lbl-sm" style="margin-top:6px">Pendientes</div></div>
      <div class="ds-m" data-ir="pendientes" style="cursor:pointer"><div class="ds-num-md" style="color:${arrastradas ? '#f59e0b' : 'var(--text-3)'}">${arrastradas}</div><div class="ds-lbl-sm" style="margin-top:6px">Arrastradas</div></div>
      <div class="ds-m"><div class="ds-num-md" style="color:#fbbf24">${visitasHoy}</div><div class="ds-lbl-sm" style="margin-top:6px">Visitas hoy</div></div>
    </div>

    <div class="ds-sec">Hoy</div>
    ${hoyLista.length ? `<div class="flex-col gap-8">${hoyLista.map(o => tarjetaAmi(o, { estado: true })).join('')}</div>`
      : `<div class="ds-card" style="text-align:center;padding:22px 16px;color:var(--text-3);font-size:13px">Aún no hay cambios ni visitas hoy.</div>`}`;
  cont.querySelector('#ami-abrir-mapa').onclick = () => window.__router.navigateTo('ami_mapa');
  cont.querySelectorAll('[data-ir]').forEach(m => m.onclick = () => irAOrdenes(m.dataset.ir));
}

// ── Órdenes ───────────────────────────────────────
function gruposAmi(lista) {
  const reciente = arr => arr.sort((a, b) => (b.fechaHecha?.seconds || 0) - (a.fechaHecha?.seconds || 0));
  const g = [{ id: 'pendientes', t: 'Pendientes',
    arr: lista.filter(o => !o.estadoCampo && !o._yaCambiada).sort((a, b) => diasArrastrada(b) - diasArrastrada(a)) }];
  if (esAdmin_) {
    g.push({ id: 'porconfirmar', t: 'Por confirmar', arr: reciente(lista.filter(o => o.estadoCampo === 'hecha')) });
    g.push({ id: 'confirmadas',  t: 'Confirmadas',   arr: reciente(lista.filter(o => o.estadoCampo === 'aprobada')) });
  } else {
    g.push({ id: 'hechas', t: 'Hechas', arr: reciente(lista.filter(realizada)) });
  }
  g.push({ id: 'visitas', t: 'Visitas', arr: lista.filter(o => o.estadoCampo === 'visita') });
  if (esAdmin_) g.push({ id: 'padron', t: 'En el padrón', arr: lista.filter(o => o._yaCambiada && !o.estadoCampo) });
  return g;
}

function renderOrdenes(cont) {
  let lista = ordenes_;
  if (esAdmin_ && parejaF_ !== 'todas') lista = lista.filter(o => parejaF_ === 'sin' ? !o.pareja : o.pareja === parejaF_);
  const grupos = gruposAmi(lista);
  if (!grupos.some(g => g.id === filtroOrd_)) filtroOrd_ = 'pendientes';
  const grupo = grupos.find(g => g.id === filtroOrd_);
  const q = busq_.trim().toLowerCase();
  const mostrar = q
    ? [...ordenes_, ...condominios_].filter(o => [o.nc, o.cliente, o.medidor, o.direccion].some(v => v && String(v).toLowerCase().includes(q)))
    : grupo.arr;
  const vis = mostrar.slice(0, limite_);
  const parejasL = [...new Set(ordenes_.map(o => o.pareja).filter(Boolean))].sort((a, b) => (parseInt(String(a).replace(/\D/g,''),10)||0) - (parseInt(String(b).replace(/\D/g,''),10)||0));

  cont.innerHTML = `
    <div class="buscar-wrap" style="margin-bottom:12px">
      ${svgA(ICO_A.buscar, 14, 'style="color:var(--text-4);flex-shrink:0"')}
      <input class="buscar-input" id="ami-buscar" placeholder="Buscar NC, cliente o medidor…" autocomplete="off" spellcheck="false" value="${escA(busq_)}"/>
    </div>
    ${!q && esAdmin_ && parejasL.length ? `
    <div class="filter-row" style="margin-bottom:8px">
      ${['todas', ...parejasL, 'sin'].map(p => `<div class="filter-chip ${parejaF_ === p ? 'active' : ''}" data-pareja="${escA(p)}">${p === 'todas' ? 'Todas las parejas' : p === 'sin' ? 'Sin asignar' : escA(p)}</div>`).join('')}
    </div>` : ''}
    ${!q ? `
    <div class="cm-tabs-est">
      ${grupos.map(g => `<div class="cm-est ${g.id === filtroOrd_ ? 'active' : ''} ${g.arr.length ? '' : 'vacio'}" data-est="${g.id}">${g.t}<span>${g.arr.length}</span></div>`).join('')}
    </div>` : `<div style="font-size:12px;color:var(--text-3);margin:2px 2px 10px">${mostrar.length} resultado${mostrar.length !== 1 ? 's' : ''} en la ruta y condominios</div>`}
    ${!q && esAdmin_ && filtroOrd_ === 'porconfirmar' && grupo.arr.length ? `
    <button class="btn-action marca" id="ami-conf-btn" style="margin-bottom:12px">${svgA(ICO_A.check, 16)} Confirmar por día o todas</button>` : ''}
    ${vis.length ? `<div class="crc-grid">${vis.map(o => tarjetaAmi(o, { estado: !!q || ['hechas', 'confirmadas'].includes(filtroOrd_) })).join('')}</div>
      ${mostrar.length > vis.length ? `<button class="cm-btn" id="ami-ver-mas" style="width:100%;height:44px;margin-top:10px">Ver ${Math.min(40, mostrar.length - vis.length)} más (${mostrar.length - vis.length} restantes)</button>` : ''}`
      : `<div class="ds-card" style="text-align:center;padding:24px 16px;color:var(--text-3);font-size:13px">${q ? 'Nada coincide en la ruta actual.' : ordenes_.length ? `No hay órdenes en "${grupo.t}".` : 'Aún no hay ruta cargada.'}</div>`}
    <div id="ami-hist-resultados"></div>`;

  const inp = cont.querySelector('#ami-buscar');
  let tm = null;
  inp.oninput = () => {
    clearTimeout(tm);
    tm = setTimeout(() => {
      busq_ = inp.value; limite_ = 40;
      const pos = inp.selectionStart;
      renderOrdenes(cont);
      const n = cont.querySelector('#ami-buscar');
      if (n) { n.focus(); try { n.setSelectionRange(pos, pos); } catch {} }
    }, 250);
  };
  cont.querySelectorAll('[data-pareja]').forEach(c => c.onclick = () => { parejaF_ = c.dataset.pareja; limite_ = 40; renderOrdenes(cont); });
  cont.querySelectorAll('[data-est]').forEach(c => c.onclick = () => { filtroOrd_ = c.dataset.est; limite_ = 40; renderOrdenes(cont); });
  cont.querySelector('#ami-ver-mas')?.addEventListener('click', () => { limite_ += 40; renderOrdenes(cont); });
  cont.querySelector('#ami-conf-btn')?.addEventListener('click', abrirConfirmar);
  engancharTarjetasAmi(cont, () => renderOrdenes(cont));
  // Historial: solo el admin y cuando escribe un NC completo (consulta filtrada)
  if (esAdmin_ && /^\d{6,}$/.test(busq_.trim())) buscarHistorial(busq_.trim());
}

function tarjetaAmi(o, { estado = false } = {}) {
  const dias = diasArrastrada(o);
  const arrastrada = esResiduo(o) && !o.estadoCampo;
  const est = o.estadoCampo === 'aprobada' ? ['ok', 'Confirmada']
    : o.estadoCampo === 'hecha' ? (esAdmin_ ? ['warn', 'Por confirmar'] : ['ok', 'Hecha'])
    : o.estadoCampo === 'visita' ? ['warn', 'Visita']
    : o.estadoCampo === 'ya_cambiado' ? ['orange', 'Ya cambiado']
    : o.estadoCampo === 'mal_ubicado' ? ['violet', 'Mal ubicado']
    : ['muted', 'Pendiente'];
  const fecha = o.fechaHecha || o.fechaVisita;
  const meta = [
    realizada(o) && o.hechaPor ? escA(o.hechaPor) : '',
    o.estadoCampo === 'visita' && o.motivoVisita ? escA(o.motivoVisita) : '',
    (realizada(o) || o.estadoCampo === 'visita') && fecha ? fmtFA(fecha) : '',
    esAdmin_ ? (o.pareja ? escA(o.pareja) : '<span style="color:#fbbf24">Sin asignar</span>') : '',
  ].filter(Boolean).join(' · ');
  return `
    <div class="cm-ord" style="cursor:default${arrastrada ? ';box-shadow:inset 3px 0 0 #f59e0b, var(--sh-card)' : ''}">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="cm-wo">NC ${escA(o.nc || '—')}</span>
        ${arrastrada ? `<span class="cm-pill warn">Arrastrada · ${dias} día${dias > 1 ? 's' : ''}</span>` : ''}
        ${o.tipoSitio === 'condominio' ? `<span class="cm-pill violet">${escA(o.edificio || 'Condominio')}</span>` : ''}
        ${o._yaCambiada ? '<span class="cm-pill ok">En el padrón</span>' : ''}
        ${estado ? `<span class="cm-pill ${est[0]}">${est[1]}</span>` : ''}
      </div>
      ${o.cliente ? `<div class="cm-cli">${escA(o.cliente)}</div>` : ''}
      ${o.tipoSitio === 'condominio' ? `<div class="cm-cli">${escA([o.nivel, o.etiqueta, o.medidor ? 'Medidor ' + o.medidor : ''].filter(Boolean).join(' · '))}</div>` : ''}
      ${o.direccion ? `<div class="cm-meta">${escA(o.direccion)}</div>` : ''}
      ${meta ? `<div class="cm-meta">${meta}</div>` : ''}
      ${esAdmin_ && (o.estadoCampo === 'hecha' || puedeDevolverse(o)) ? `
      <div class="cm-ord-acc">
        ${o.estadoCampo === 'hecha' ? `<button class="cm-btn ok" data-confirmar="${o.id}">${svgA(ICO_A.check, 14)} Confirmar</button>` : ''}
        ${puedeDevolverse(o) ? `<button class="cm-btn" data-devolver="${o.id}" style="${o.estadoCampo === 'hecha' ? '' : 'flex:1'}">Devolver a pendiente</button>` : ''}
      </div>` : ''}
    </div>`;
}

function engancharTarjetasAmi(cont, repintar) {
  cont.querySelectorAll('[data-confirmar]').forEach(b => b.onclick = () => confirmarOrdenes([b.dataset.confirmar]));
  cont.querySelectorAll('[data-devolver]').forEach(b => b.onclick = async () => {
    const o = [...ordenes_, ...condominios_].find(x => x.id === b.dataset.devolver);
    if (o && await devolverAPendiente(o, session_)) repintar();
  });
}

// Confirmar (aprobar) órdenes hechas — una o varias en lote. Solo admin.
async function confirmarOrdenes(ids, etiqueta) {
  if (!ids || !ids.length) { toast('No hay órdenes por confirmar', 'warn'); return false; }
  const msg = ids.length === 1
    ? '¿Confirmar esta orden como aprobada?'
    : `¿Confirmar ${ids.length} órdenes${etiqueta ? ' ' + etiqueta : ''}?`;
  if (!confirm(msg)) return false;
  try {
    const ahora = firebase.firestore.Timestamp.now();
    for (let i = 0; i < ids.length; i += 400) {
      const batch = db.batch();
      ids.slice(i, i + 400).forEach(id => {
        batch.update(db.collection(COLECCION).doc(id), {
          estadoCampo: 'aprobada',
          aprobadoPor: session_.displayName,
          fechaAprobacion: ahora,
        });
      });
      await batch.commit();
    }
    ids.forEach(id => { const o = [...ordenes_, ...condominios_].find(x => x.id === id); if (o) { o.estadoCampo = 'aprobada'; o.aprobadoPor = session_.displayName; } });
    toast(ids.length === 1 ? 'Orden confirmada' : `${ids.length} órdenes confirmadas`, 'ok');
    refrescar();
    window.dispatchEvent(new CustomEvent('ami:updated'));
    return true;
  } catch (err) {
    toast('Error al confirmar: ' + err.message, 'error');
    return false;
  }
}

// ── Confirmar por día o todas ──
let confGruposAmi_ = [];
function abrirConfirmar() {
  pintarConfirmar();
  container_.querySelector('#ami-sheet-confirmar')?.classList.add('open');
}
function pintarConfirmar() {
  const body = container_.querySelector('#ami-sheet-confirmar-body');
  if (!body) return;
  const pareja = parejaF_ !== 'todas' && parejaF_ !== 'sin' ? parejaF_ : null;
  const lista = ordenes_.filter(o => o.estadoCampo === 'hecha' && (!pareja || o.pareja === pareja))
    .sort((a, b) => (b.fechaHecha?.seconds || 0) - (a.fechaHecha?.seconds || 0));
  const porDia = {};
  lista.forEach(o => { const k = claveDiaAMI(o.fechaHecha) || 'sin-fecha'; (porDia[k] = porDia[k] || []).push(o); });
  const hoy = claveDiaAMI(new Date()), ayerD = new Date(); ayerD.setDate(ayerD.getDate() - 1);
  const ayer = claveDiaAMI(ayerD);
  const etiqueta = k => {
    if (k === 'sin-fecha') return 'Sin fecha';
    const [y, m, d] = k.split('-').map(Number);
    const t = new Date(y, m - 1, d).toLocaleDateString('es-SV', { weekday: 'long', day: 'numeric', month: 'short' });
    return (k === hoy ? 'Hoy · ' : k === ayer ? 'Ayer · ' : '') + t.charAt(0).toUpperCase() + t.slice(1);
  };
  confGruposAmi_ = Object.keys(porDia).sort().reverse().map(k => ({ fecha: etiqueta(k), ordenes: porDia[k] }));
  container_.querySelector('#ami-sheet-confirmar-title').textContent = 'Por confirmar' + (pareja ? ' · ' + pareja : '');

  body.innerHTML = lista.length ? `
    <div style="font-size:12.5px;color:var(--text-3);margin-bottom:12px">${lista.length} realizada${lista.length > 1 ? 's' : ''} esperando confirmación${pareja ? '' : ' en todas las parejas'}.</div>
    <button class="btn-action marca" style="margin-bottom:16px" data-lote="-1">${svgA(ICO_A.check, 16)} Confirmar todas (${lista.length})</button>
    <div class="flex-col" style="gap:16px">
      ${confGruposAmi_.map((g, i) => `
        <div>
          <div class="cm-dia">
            <div style="flex:1;min-width:0"><div class="cm-dia-t">${g.fecha}</div><div class="cm-dia-s">${g.ordenes.length} ${g.ordenes.length > 1 ? 'órdenes' : 'orden'}</div></div>
            <button class="cm-btn ok" data-lote="${i}">${svgA(ICO_A.check, 14)} Confirmar día</button>
          </div>
          <div class="flex-col gap-6">
            ${g.ordenes.map(o => `
              <div class="cm-verif">
                <div style="flex:1;min-width:0">
                  <div class="cm-wo" style="font-size:13.5px">NC ${escA(o.nc || '—')}</div>
                  <div class="cm-cli">${escA(o.cliente || '—')}${!pareja && o.pareja ? ' · ' + escA(o.pareja) : ''}</div>
                  <div class="cm-meta">${escA(o.hechaPor || '—')}</div>
                </div>
                <button class="cm-btn ok" data-uno="${o.id}">${svgA(ICO_A.check, 14)}</button>
              </div>`).join('')}
          </div>
        </div>`).join('')}
    </div>` : `
    <div style="text-align:center;padding:26px 10px">
      <div class="hm-ic am" style="margin:0 auto 12px">${svgA(ICO_A.check, 20)}</div>
      <div style="font-size:15px;font-weight:600">Nada por confirmar</div>
      <div style="font-size:12.5px;color:var(--text-3);margin-top:4px">Todas las realizadas ya están confirmadas.</div>
    </div>`;
  body.querySelectorAll('[data-lote]').forEach(b => b.onclick = () => {
    const i = parseInt(b.dataset.lote, 10);
    const arr = i === -1 ? confGruposAmi_.flatMap(g => g.ordenes) : confGruposAmi_[i].ordenes;
    const etq = (i === -1 ? '' : 'del ' + confGruposAmi_[i].fecha.replace(/^(Hoy|Ayer) · /, '').toLowerCase()) + (pareja ? ' de ' + pareja : '');
    confirmarOrdenes(arr.map(o => o.id), etq);
  });
  body.querySelectorAll('[data-uno]').forEach(b => b.onclick = () => confirmarOrdenes([b.dataset.uno]));
}

// Historial por NC (ami_historial, consulta filtrada por NC exacto)
async function buscarHistorial(nc) {
  const cont = container_.querySelector('#ami-hist-resultados');
  if (!cont) return;
  try {
    const snapH = await db.collection('ami_historial').where('nc', '==', nc).get();
    if (snapH.empty || busq_.trim() !== nc) return;
    const regs = snapH.docs.map(d => d.data()).sort((a, b) => String(b.fecha || '').localeCompare(String(a.fecha || '')));
    cont.innerHTML = `
      <div class="ds-sec" style="margin-top:18px">Historial del NC <span style="color:var(--text-3);font-weight:500">· ${regs.length}</span></div>
      <div class="flex-col gap-8">
        ${regs.map(r => `
          <div class="cm-ord" style="cursor:default;box-shadow:inset 3px 0 0 #16a34a, var(--sh-card)">
            <div class="cm-wo" style="font-size:13.5px">${escA(r.trabajo || 'Trabajo')}</div>
            <div class="cm-meta">${[r.medidorNuevo ? 'Medidor nuevo ' + escA(r.medidorNuevo) : '', escA(r.pareja || ''), escA(r.fecha || '')].filter(Boolean).join(' · ')}</div>
          </div>`).join('')}
      </div>`;
  } catch (e) { /* sin historial */ }
}

// ── Importar ruta diaria (Excel) ──────────────────
// Columnas: NC, NOMBRE, DIRECCIÓN, DS, MEDIDOR, LATITUD, LONGITUD.
// NC nuevo -> crea orden con fechaRuta = hoy. NC existente -> actualiza datos
// pero CONSERVA su fechaRuta original (para no perder los días de arrastre).
async function importarRuta(file) {
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const matriz = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    if (!matriz.length) { toast('El archivo está vacío', 'error'); return; }

    const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\s._-]/g,'');
    // Buscar fila de encabezados (la que tenga "nc")
    let hIdx = matriz.findIndex(r => r.some(c => norm(c) === 'nc'));
    if (hIdx === -1) { toast('No se encontró la columna NC', 'error'); return; }
    const head = matriz[hIdx].map(norm);
    const col = (...alias) => head.findIndex(h => alias.includes(h));
    const idx = {
      nc:  col('nc'),
      nombre: col('nombre','cliente'),
      direccion: col('direccion','direccin','direc'),
      ds: col('ds'),
      medidor: col('medidor','serie'),
      lat: col('latitud','lat'),
      lng: col('longitud','long','lng'),
    };

    const filas = matriz.slice(hIdx + 1);
    const registros = [];
    for (const r of filas) {
      const nc = String(r[idx.nc] ?? '').trim();
      if (!nc) continue;
      registros.push({
        nc,
        nombre: idx.nombre>=0 ? String(r[idx.nombre] ?? '').trim() : '',
        direccion: idx.direccion>=0 ? String(r[idx.direccion] ?? '').trim() : '',
        ds: idx.ds>=0 ? String(r[idx.ds] ?? '').trim() : '',
        medidor: idx.medidor>=0 ? String(r[idx.medidor] ?? '').trim() : '',
        latitud: idx.lat>=0 ? String(r[idx.lat] ?? '').trim() : '',
        longitud: idx.lng>=0 ? String(r[idx.lng] ?? '').trim() : '',
      });
    }
    if (!registros.length) { toast('No se encontraron órdenes con NC', 'error'); return; }

    // Traer las órdenes existentes para saber cuáles ya están (por NC)
    const snap = await db.collection(COLECCION).get();
    const existentesPorNC = new Map();
    snap.docs.forEach(d => { const nc = String(d.data().nc ?? '').trim(); if (nc) existentesPorNC.set(nc, d.id); });

    const nuevos = registros.filter(r => !existentesPorNC.has(r.nc));
    const actualizar = registros.filter(r => existentesPorNC.has(r.nc));

    // Preguntar para qué fecha es la ruta (permite cargar hoy una ruta del
    // sábado sin que se marque como arrastrada). Por defecto: mañana.
    const manana = new Date(); manana.setDate(manana.getDate() + 1);
    const defFecha = `${manana.getFullYear()}-${String(manana.getMonth()+1).padStart(2,'0')}-${String(manana.getDate()).padStart(2,'0')}`;
    const entrada = prompt(
      `¿Para qué fecha es esta ruta? (AAAA-MM-DD)\n\nDéjalo en la fecha de mañana si la cargas por adelantado, o cámbiala al día que se trabajará. Las órdenes contarán como "ruta" de ese día.`,
      defFecha
    );
    if (entrada === null) return; // canceló
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(entrada.trim());
    if (!m) { toast('Fecha inválida. Usa el formato AAAA-MM-DD', 'error'); return; }
    const fechaRutaDate = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 6, 0, 0);
    if (isNaN(fechaRutaDate)) { toast('Fecha inválida', 'error'); return; }

    const etqFecha = fechaRutaDate.toLocaleDateString('es-SV', { weekday:'long', day:'numeric', month:'short' });
    if (!confirm(`Ruta del ${etqFecha}\n\n${registros.length} órdenes:\n${nuevos.length} nuevas\n${actualizar.length} ya existían (se actualizan sus datos)\n\n¿Continuar?`)) return;

    toast('Cargando ruta…', 'ok');
    const ahora = firebase.firestore.Timestamp.now();
    const fechaRutaTs = firebase.firestore.Timestamp.fromDate(fechaRutaDate);

    // Crear nuevas
    for (let i = 0; i < nuevos.length; i += 400) {
      const batch = db.batch();
      nuevos.slice(i, i + 400).forEach(r => {
        const ref = db.collection(COLECCION).doc();
        batch.set(ref, {
          nc: r.nc, nombre: r.nombre, cliente: r.nombre,
          direccion: r.direccion, ds: r.ds, medidor: r.medidor,
          latitud: r.latitud, longitud: r.longitud,
          pareja: null, estadoCampo: null,
          fechaRuta: fechaRutaTs, importadaEn: ahora,
        });
      });
      await batch.commit();
    }
    // Actualizar existentes (conservando fechaRuta y estado)
    for (let i = 0; i < actualizar.length; i += 400) {
      const batch = db.batch();
      actualizar.slice(i, i + 400).forEach(r => {
        batch.update(db.collection(COLECCION).doc(existentesPorNC.get(r.nc)), {
          nombre: r.nombre, cliente: r.nombre,
          direccion: r.direccion, ds: r.ds, medidor: r.medidor,
          latitud: r.latitud, longitud: r.longitud,
        });
      });
      await batch.commit();
    }

    toast(`Ruta cargada: ${nuevos.length} nuevas, ${actualizar.length} actualizadas`, 'ok');
    await cargarOrdenes();
    setTab('panel');
    window.dispatchEvent(new CustomEvent('ami:updated'));
  } catch (err) {
    toast('Error al cargar: ' + err.message, 'error');
  } finally {
    const inp = container_.querySelector('#ami-file-importar');
    if (inp) inp.value = '';
  }
}

// ══════════════════════════════════════════════════
// CONDOMINIOS — Fase 1: importador (ver SPEC_AMI_Condominios.md)
// Cada medidor sigue siendo su propia orden en ami_ordenes, con los campos
// tipoSitio:'condominio', condominio, edificio, nivel (+ etiqueta, forma).
// Sin fechaRuta: no entran a la lógica de arrastradas.
// ══════════════════════════════════════════════════

// Orden natural de niveles: PB/Sótano antes de 1, 2 antes de 10.
function claveNivel(n) {
  const t = String(n ?? '').toLowerCase();
  if (/s[oó]tano|^s\d/.test(t)) return -10 + (parseInt(t.replace(/\D/g, ''), 10) || 0) * -1;
  if (/^pb$|planta ?baja|^p\.?b\.?$/.test(t.trim())) return 0;
  const num = parseInt(t.replace(/\D/g, ''), 10);
  return isNaN(num) ? 999 : num;
}
const ordenarNiveles = arr => arr.slice().sort((a, b) => claveNivel(a) - claveNivel(b) || String(a).localeCompare(String(b)));

// "13.69, -89.19" · "13.69 -89.19" · enlace de Google Maps con "@13.69,-89.19"
function parseCoordenadas(txt) {
  const nums = String(txt || '').match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length < 2) return null;
  const lat = parseFloat(nums[0]), lng = parseFloat(nums[1]);
  // Mismo rango que valida el mapa (El Salvador / Centroamérica)
  if (!(lat > 12 && lat < 16 && lng > -92 && lng < -87)) return null;
  return { lat, lng };
}

// Resumen en el Panel (admin): qué condominios/edificios hay cargados y su avance
function renderResumenCondominios() {
  if (!condominios_.length) return '';
  const grupos = new Map();
  condominios_.forEach(o => {
    const k = `${o.condominio || 'Sin nombre'}|${o.edificio || 'Sin edificio'}`;
    if (!grupos.has(k)) grupos.set(k, []);
    grupos.get(k).push(o);
  });
  const filas = [...grupos.entries()].map(([k, arr]) => {
    const [condo, edif] = k.split('|');
    const hechas = arr.filter(o => o.estadoCampo === 'hecha' || o.estadoCampo === 'aprobada').length;
    const pct = arr.length ? Math.round(hechas / arr.length * 100) : 0;
    const niveles = new Set(arr.map(o => o.nivel || '')).size;
    const sinAsignar = arr.filter(o => !o.pareja).length;
    return `
      <div class="ami-condo-abrir" data-key="${escapeHtml(k)}" style="padding:12px 0;border-top:1px solid var(--border);cursor:pointer">
        <div style="display:flex;justify-content:space-between;align-items:baseline;gap:8px;margin-bottom:8px">
          <div style="min-width:0">
            <div style="font-size:14px;font-weight:600">${escapeHtml(edif)}</div>
            <div style="font-size:11px;color:var(--text-4);margin-top:2px">${escapeHtml(condo)} · ${niveles} nivel${niveles !== 1 ? 'es' : ''}${sinAsignar ? ` · ${sinAsignar} sin asignar` : ''}</div>
          </div>
          <div style="font-size:12px;color:var(--text-3);white-space:nowrap;display:flex;align-items:center;gap:6px">${hechas} / ${arr.length}
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-4)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg></div>
        </div>
        <div class="ds-bar"><i class="am" style="width:${pct}%"></i></div>
      </div>`;
  }).join('');
  return `
    <div class="ds-card" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:4px">
        <div style="font-size:14px;font-weight:600">Condominios</div>
        <div style="font-size:12px;color:var(--text-4)">${condominios_.length} medidores</div>
      </div>
      <div style="font-size:11px;color:var(--text-4);margin-bottom:6px">Aparte de la ruta diaria. Toca un edificio para asignar niveles a parejas y confirmar; el técnico lo ve en el mapa como una sola gota.</div>
      ${filas}
    </div>`;
}

async function importarCondominio(file) {
  if (!file) return;
  let matriz;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    matriz = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
  } catch (err) { toast('No se pudo leer el archivo: ' + err.message, 'error'); return; }
  if (!matriz.length) { toast('El archivo está vacío', 'error'); return; }

  const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[\s._/-]/g, '');
  // Encabezados: la fila que tenga NC o Contrato (en los Excel de condominio el NC viene como "Contrato")
  const hIdx = matriz.findIndex(r => r.some(c => ['nc', 'contrato'].includes(norm(c))));
  if (hIdx === -1) { toast('No se encontró la columna NC / Contrato', 'error'); return; }
  const head = matriz[hIdx].map(norm);
  const col = (...alias) => head.findIndex(h => alias.includes(h));
  const colIncl = (...parts) => head.findIndex(h => parts.some(p => h.includes(p)));
  const idx = {
    nc:        col('nc', 'contrato'),
    nivel:     colIncl('nivel', 'piso'),
    edificio:  colIncl('edificio', 'torre'),
    etiqueta:  colIncl('etiqueta', 'apartamento', 'apto', 'unidad', 'local'),
    medidor:   col('medidor', 'serie'),
    nombre:    col('nombre', 'cliente'),
    forma:     colIncl('forma'),
    direccion: col('direccion', 'direccin', 'direc'),
    ds:        col('ds'),
    lat:       col('latitud', 'lat'),
    lng:       col('longitud', 'long', 'lng'),
  };
  if (idx.nivel === -1) { toast('No se encontró la columna de Nivel / Piso', 'error'); return; }
  const val = (r, i) => i >= 0 ? String(r[i] ?? '').trim().replace(/\s+/g, ' ') : '';

  const filas = [];
  for (const r of matriz.slice(hIdx + 1)) {
    const nc = val(r, idx.nc);
    if (!nc) continue;
    filas.push({
      nc, nivel: val(r, idx.nivel), edificio: val(r, idx.edificio), etiqueta: val(r, idx.etiqueta),
      medidor: val(r, idx.medidor), nombre: val(r, idx.nombre), forma: val(r, idx.forma),
      direccion: val(r, idx.direccion), ds: val(r, idx.ds), latitud: val(r, idx.lat), longitud: val(r, idx.lng),
    });
  }
  if (!filas.length) { toast('No se encontraron medidores con NC', 'error'); return; }

  // Lo que ya existe en AMI (por NC) para no duplicar
  let existentesPorNC = new Map();
  try {
    const snap = await db.collection(COLECCION).get();
    snap.docs.forEach(d => { const nc = String(d.data().nc ?? '').trim(); if (nc) existentesPorNC.set(nc, { id: d.id, ...d.data() }); });
  } catch (err) { toast('No se pudieron leer las órdenes actuales: ' + err.message, 'error'); return; }

  // Edificio sugerido a partir del nombre del archivo: "Torre_A_clientes.xlsx" -> "Torre A"
  const sugerido = file.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ')
    .replace(/\b(clientes?|medidores|listado|lista)\b/gi, '').replace(/\s+/g, ' ').trim();
  const traeEdificio = filas.some(f => f.edificio);

  const sheet = document.createElement('div');
  sheet.className = 'sheet-backdrop open';
  document.body.appendChild(sheet);
  sheet.addEventListener('click', e => { if (e.target === sheet) sheet.remove(); });

  const estado = { condominio: '', edificio: traeEdificio ? '' : sugerido, coords: '' };

  function analizar() {
    const edifDe = f => f.edificio || estado.edificio.trim();
    const vistos = new Set(), repetidos = new Set();
    filas.forEach(f => { if (vistos.has(f.nc)) repetidos.add(f.nc); vistos.add(f.nc); });
    const unicas = filas.filter((f, i) => filas.findIndex(x => x.nc === f.nc) === i);
    const sinNivel = unicas.filter(f => !f.nivel).length;
    const sinMedidor = unicas.filter(f => !f.medidor).length;
    const yaExisten = unicas.filter(f => existentesPorNC.has(f.nc));
    const existenFuera = yaExisten.filter(f => existentesPorNC.get(f.nc).tipoSitio !== 'condominio').length;
    const porEdificio = new Map();
    unicas.forEach(f => {
      const e = edifDe(f) || 'Sin edificio';
      if (!porEdificio.has(e)) porEdificio.set(e, new Map());
      const m = porEdificio.get(e); const n = f.nivel || 'Sin nivel';
      m.set(n, (m.get(n) || 0) + 1);
    });
    return { unicas, repetidos: repetidos.size, sinNivel, sinMedidor, yaExisten, existenFuera, porEdificio };
  }

  function pintar() {
    const a = analizar();
    const coords = parseCoordenadas(estado.coords);
    const faltaCoordsFila = a.unicas.some(f => !parseCoordenadas(`${f.latitud},${f.longitud}`));
    const calcListo = () => !!(estado.condominio.trim() && (traeEdificio || estado.edificio.trim())
      && (parseCoordenadas(estado.coords) || !faltaCoordsFila) && !a.sinNivel);
    const listo = calcListo();
    const avisos = [
      a.sinNivel ? `<div class="form-error" style="display:block">${a.sinNivel} medidor${a.sinNivel > 1 ? 'es' : ''} sin nivel. Corrige el Excel antes de guardar.</div>` : '',
      a.repetidos ? `<div style="font-size:12px;color:#fbbf24">${a.repetidos} NC repetido${a.repetidos > 1 ? 's' : ''} en el archivo: se guarda una sola vez.</div>` : '',
      a.sinMedidor ? `<div style="font-size:12px;color:#fbbf24">${a.sinMedidor} sin número de medidor (no se podrán buscar por medidor).</div>` : '',
      a.yaExisten.length ? `<div style="font-size:12px;color:var(--text-3)">${a.yaExisten.length} ya estaban en AMI: no se duplican, solo se les agrega condominio, edificio y nivel (conservan su estado y pareja).${a.existenFuera ? ` ${a.existenFuera} de ellas estaban en la ruta diaria y pasan al condominio.` : ''}</div>` : '',
    ].filter(Boolean).join('');
    const resumen = [...a.porEdificio.entries()].map(([e, niveles]) => `
      <div style="margin-top:10px">
        <div style="font-size:13px;font-weight:600;margin-bottom:6px">${escapeHtml(e)}</div>
        <div style="display:flex;flex-wrap:wrap;gap:6px">
          ${ordenarNiveles([...niveles.keys()]).map(n => `<span class="estado-badge muted" style="text-transform:none;letter-spacing:0;font-size:11px">${escapeHtml(n)} · ${niveles.get(n)}</span>`).join('')}
        </div>
      </div>`).join('');

    sheet.innerHTML = `<div class="sheet" style="max-height:92vh">
      <div class="sheet-handle"></div>
      <div class="sheet-title">Cargar condominio</div>
      <div class="sheet-body flex-col gap-12">
        <div class="ds-card">
          <div style="display:flex;align-items:baseline;gap:6px">
            <span class="ds-num-md" style="color:${ACCENT}">${a.unicas.length}</span>
            <span style="font-size:12px;color:var(--text-3)">medidores en ${escapeHtml(file.name)}</span>
          </div>
          ${resumen}
        </div>
        ${avisos ? `<div class="flex-col gap-6">${avisos}</div>` : ''}
        <div class="form-field">
          <div class="form-label">Nombre del condominio *</div>
          <input class="form-input" id="cd-condo" value="${escapeHtml(estado.condominio)}" placeholder="Ej. Residencial Las Palmas" autocomplete="off"/>
        </div>
        ${traeEdificio ? '' : `
        <div class="form-field">
          <div class="form-label">Edificio / torre *</div>
          <input class="form-input" id="cd-edif" value="${escapeHtml(estado.edificio)}" placeholder="Ej. Torre A" autocomplete="off"/>
        </div>`}
        <div class="form-field">
          <div class="form-label">Ubicación del edificio ${faltaCoordsFila ? '*' : '(opcional)'}</div>
          <input class="form-input" id="cd-coords" value="${escapeHtml(estado.coords)}" placeholder="13.6929, -89.2182" autocomplete="off" inputmode="decimal"/>
          <div id="cd-coords-msg" style="font-size:11px;margin-top:6px;color:${estado.coords && !coords ? '#f87171' : 'var(--text-4)'}">${estado.coords && !coords ? 'No reconozco esas coordenadas. Pega latitud y longitud, por ejemplo desde Google Maps.' : coords ? `Se usará ${coords.lat.toFixed(6)}, ${coords.lng.toFixed(6)} para todos los medidores.` : 'Pega latitud y longitud (en Google Maps: mantén presionado el edificio y copia los números).'}</div>
        </div>
        <button class="btn-primary full" id="cd-guardar" style="border-color:${ACCENT_BORDER};background:${ACCENT_GLASS};color:${ACCENT};${listo ? '' : 'opacity:.45;'}" ${listo ? '' : 'disabled'}>
          <span id="cd-guardar-lbl">Guardar ${a.unicas.length} medidores</span>
        </button>
      </div>
    </div>`;

    // Al escribir solo se actualizan el botón y el mensaje de coordenadas
    // (repintar todo haría perder el foco o el toque en Guardar).
    const refrescar = () => {
      const ok = calcListo();
      const b = sheet.querySelector('#cd-guardar');
      if (b) { b.disabled = !ok; b.style.opacity = ok ? '' : '.45'; }
      const c = parseCoordenadas(estado.coords);
      const msg = sheet.querySelector('#cd-coords-msg');
      if (msg) {
        msg.style.color = estado.coords && !c ? '#f87171' : 'var(--text-4)';
        msg.textContent = estado.coords && !c ? 'No reconozco esas coordenadas. Pega latitud y longitud, por ejemplo desde Google Maps.'
          : c ? `Se usará ${c.lat.toFixed(6)}, ${c.lng.toFixed(6)} para todos los medidores.`
          : 'Pega latitud y longitud (en Google Maps: mantén presionado el edificio y copia los números).';
      }
    };
    const bind = (id, key) => {
      const el = sheet.querySelector(id); if (!el) return;
      el.addEventListener('input', () => { estado[key] = el.value; refrescar(); });
    };
    bind('#cd-condo', 'condominio'); bind('#cd-edif', 'edificio'); bind('#cd-coords', 'coords');
    sheet.querySelector('#cd-guardar')?.addEventListener('click', () => guardar(a, parseCoordenadas(estado.coords)));
  }

  async function guardar(a, coords) {
    const condominio = estado.condominio.trim();
    const edificioGeneral = estado.edificio.trim();
    if (!condominio) return;
    const btn = sheet.querySelector('#cd-guardar'); if (btn) btn.disabled = true;
    const lbl = sheet.querySelector('#cd-guardar-lbl'); if (lbl) lbl.textContent = 'Guardando…';
    try {
      const ahora = firebase.firestore.Timestamp.now();
      const datos = f => {
        const edificio = f.edificio || edificioGeneral;
        const fila = parseCoordenadas(`${f.latitud},${f.longitud}`);
        const c = coords || fila;
        return {
          tipoSitio: 'condominio', condominio, edificio, nivel: f.nivel,
          etiqueta: f.etiqueta, forma: f.forma,
          nombre: f.nombre, cliente: f.nombre, medidor: f.medidor, ds: f.ds,
          direccion: f.direccion || [condominio, edificio, f.etiqueta].filter(Boolean).join(' · '),
          latitud: c ? String(c.lat) : '', longitud: c ? String(c.lng) : '',
        };
      };
      const nuevas = a.unicas.filter(f => !existentesPorNC.has(f.nc));
      const existentes = a.unicas.filter(f => existentesPorNC.has(f.nc));
      for (let i = 0; i < nuevas.length; i += 400) {
        const batch = db.batch();
        nuevas.slice(i, i + 400).forEach(f => {
          batch.set(db.collection(COLECCION).doc(), {
            nc: f.nc, ...datos(f), pareja: null, estadoCampo: null, importadaEn: ahora,
          });
        });
        await batch.commit();
      }
      for (let i = 0; i < existentes.length; i += 400) {
        const batch = db.batch();
        existentes.slice(i, i + 400).forEach(f => {
          batch.update(db.collection(COLECCION).doc(existentesPorNC.get(f.nc).id), datos(f));
        });
        await batch.commit();
      }
      sheet.remove();
      toast(`Condominio cargado: ${nuevas.length} nuevas${existentes.length ? `, ${existentes.length} actualizadas` : ''}`, 'ok');
      await cargarOrdenes();
      setTab('panel');
      window.dispatchEvent(new CustomEvent('ami:updated'));
    } catch (err) {
      toast('Error al guardar: ' + err.message, 'error');
      if (btn) btn.disabled = false;
      if (lbl) lbl.textContent = `Guardar ${a.unicas.length} medidores`;
    }
  }

  pintar();
}

// ══════════════════════════════════════════════════
// EXTRACCIÓN POR DÍA (Excel) — admin/asistente
// Usa las órdenes que el Panel ya tiene en memoria (ruta + condominios), así
// que no hace lecturas extra a Firestore. Tres hojas:
//   Trabajo del día: lo que pasó ese día (realizada, visita, ya cambiado,
//                    mal ubicado) con toda la información de la gota.
//   Ruta del día:    las órdenes cargadas para ese día y su estado actual.
//   Resumen:         conteo por pareja.
// ══════════════════════════════════════════════════
const ESTADO_TXT = { hecha: 'Realizada', aprobada: 'Confirmada', visita: 'Visita', ya_cambiado: 'Ya cambiado', mal_ubicado: 'Mal ubicado' };
const aFecha = ts => ts?.toDate ? ts.toDate() : (ts instanceof Date ? ts : (ts ? new Date(ts) : null));
const txtFechaHora = ts => {
  const d = aFecha(ts); if (!d || isNaN(d)) return '';
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
};
const txtHora = ts => { const t = txtFechaHora(ts); return t ? t.slice(11) : ''; };

// Eventos de una orden en un día (una orden puede tener visita y luego realizada)
function eventosDelDia(o, dia) {
  const ev = [];
  if (claveDiaAMI(o.fechaVisita) === dia)  ev.push({ tipo: 'Visita', ts: o.fechaVisita });
  if (claveDiaAMI(o.fechaHecha) === dia && (o.estadoCampo === 'hecha' || o.estadoCampo === 'aprobada'))
    ev.push({ tipo: 'Realizada', ts: o.fechaHecha });
  if (claveDiaAMI(o.yaCambiadoEn) === dia) ev.push({ tipo: 'Ya cambiado', ts: o.yaCambiadoEn });
  if (claveDiaAMI(o.malUbicadoEn) === dia) ev.push({ tipo: 'Mal ubicado', ts: o.malUbicadoEn });
  return ev;
}

function datosDelDia(dia) {
  const todas = [...ordenes_, ...condominios_];
  const trabajo = [];
  todas.forEach(o => { const ev = eventosDelDia(o, dia); if (ev.length) trabajo.push({ o, ev }); });
  trabajo.sort((a, b) => (aFecha(a.ev[0].ts) || 0) - (aFecha(b.ev[0].ts) || 0));
  const ruta = todas.filter(o => claveDiaAMI(o.fechaRuta) === dia);
  return { trabajo, ruta };
}

function abrirExportarDia() {
  const hoy = claveDiaAMI(new Date());
  const sh = document.createElement('div');
  sh.className = 'sheet-backdrop open';
  document.body.appendChild(sh);
  sh.addEventListener('click', e => { if (e.target === sh) sh.remove(); });
  sh.innerHTML = `<div class="sheet">
    <div class="sheet-handle"></div>
    <div class="sheet-title">Extraer Excel del día</div>
    <div class="sheet-body flex-col gap-12">
      <div class="form-field">
        <div class="form-label">Día</div>
        <input class="form-input" id="exp-dia" type="date" value="${hoy}" max="${hoy}"/>
      </div>
      <div class="ds-card" id="exp-resumen"></div>
      <button class="btn-primary full" id="exp-descargar" style="border-color:${ACCENT_BORDER};background:${ACCENT_GLASS};color:${ACCENT}">Descargar Excel</button>
    </div>
  </div>`;
  const inp = sh.querySelector('#exp-dia');
  const btn = sh.querySelector('#exp-descargar');
  const pintarResumen = () => {
    const { trabajo, ruta } = datosDelDia(inp.value);
    const cuenta = t => trabajo.filter(x => x.ev.some(e => e.tipo === t)).length;
    const fila = (lbl, n, color) => `<div style="display:flex;justify-content:space-between;font-size:13px;padding:5px 0"><span style="color:var(--text-3)">${lbl}</span><span style="font-weight:600;${color ? 'color:' + color : ''}">${n}</span></div>`;
    sh.querySelector('#exp-resumen').innerHTML =
      fila('Realizadas', cuenta('Realizada'), '#22c55e') + fila('Visitas', cuenta('Visita'), '#fbbf24') +
      fila('Ya cambiado', cuenta('Ya cambiado')) + fila('Mal ubicado', cuenta('Mal ubicado')) +
      `<div style="height:1px;background:var(--border);margin:6px 0"></div>` +
      fila('Órdenes en la ruta de ese día', ruta.length);
    const vacio = !trabajo.length && !ruta.length;
    btn.disabled = vacio; btn.style.opacity = vacio ? '.45' : '';
    btn.textContent = vacio ? 'No hay datos ese día' : 'Descargar Excel';
  };
  inp.addEventListener('input', pintarResumen);
  btn.addEventListener('click', () => { if (exportarDia(inp.value)) sh.remove(); });
  pintarResumen();
}

function exportarDia(dia) {
  if (typeof XLSX === 'undefined') { toast('No se pudo cargar el generador de Excel. Revisa la conexión.', 'error'); return false; }
  const { trabajo, ruta } = datosDelDia(dia);
  if (!trabajo.length && !ruta.length) { toast('No hay datos para ese día', 'error'); return false; }
  const pareja = o => o.pareja || '';
  const cuadrilla = o => Array.isArray(o.parejaDelDia) ? o.parejaDelDia.join(', ') : (o.parejaDelDia || '');
  const reportadoPor = o => [o.yaCambiadoPor, o.malUbicadoPor].filter(Boolean).join(', ');

  const filasTrabajo = trabajo.map(({ o, ev }) => ({
    'Evento': ev.map(e => e.tipo).join(' + '),
    'Hora': ev.map(e => txtHora(e.ts)).join(' / '),
    'NC': o.nc || '',
    'Medidor': o.medidor || '',
    'Cliente': o.cliente || o.nombre || '',
    'Dirección': o.direccion || '',
    'DS': o.ds || '',
    'Pareja asignada': pareja(o),
    'Realizada por': o.hechaPor || '',
    'Cuadrilla del día': cuadrilla(o),
    'Estado actual': ESTADO_TXT[o.estadoCampo] || 'Pendiente',
    'Motivo visita': o.motivoVisita || '',
    'Observación visita': o.observacionVisita || '',
    'Visitada por': o.visitadoPor || '',
    'Comentario ya cambiado': o.yaCambiadoComentario || '',
    'Reportado por': reportadoPor(o),
    'Confirmada por': o.aprobadoPor || '',
    'Fecha confirmación': txtFechaHora(o.fechaAprobacion),
    'Observación': o.observacion || '',
    'Latitud': o.latitud || '',
    'Longitud': o.longitud || '',
    'Condominio': o.condominio || '',
    'Edificio': o.edificio || '',
    'Nivel': o.nivel || '',
    'Unidad': o.etiqueta || '',
    'Forma': o.forma || '',
    'Fecha ruta': txtFechaHora(o.fechaRuta).slice(0, 10),
    'Generada en campo': o.generadaEnCampo ? 'Sí' : '',
  }));

  const filasRuta = ruta.map(o => ({
    'NC': o.nc || '',
    'Medidor': o.medidor || '',
    'Cliente': o.cliente || o.nombre || '',
    'Dirección': o.direccion || '',
    'DS': o.ds || '',
    'Pareja asignada': pareja(o),
    'Estado actual': ESTADO_TXT[o.estadoCampo] || 'Pendiente',
    'Realizada': txtFechaHora(o.fechaHecha),
    'Realizada por': o.hechaPor || '',
    'Motivo visita': o.motivoVisita || '',
    'Latitud': o.latitud || '',
    'Longitud': o.longitud || '',
  }));

  // Resumen por pareja (según la pareja asignada a la orden)
  const porPareja = new Map();
  trabajo.forEach(({ o, ev }) => {
    const k = pareja(o) || 'Sin pareja';
    if (!porPareja.has(k)) porPareja.set(k, { 'Pareja': k, 'Realizadas': 0, 'Visitas': 0, 'Ya cambiado': 0, 'Mal ubicado': 0 });
    const r = porPareja.get(k);
    ev.forEach(e => { const col = e.tipo === 'Realizada' ? 'Realizadas' : e.tipo === 'Visita' ? 'Visitas' : e.tipo; r[col]++; });
  });
  const numP = x => parseInt(String(x).replace(/\D/g, ''), 10) || 999;
  const filasResumen = [...porPareja.values()].sort((a, b) => numP(a.Pareja) - numP(b.Pareja));
  if (filasResumen.length) {
    const tot = { 'Pareja': 'Total', 'Realizadas': 0, 'Visitas': 0, 'Ya cambiado': 0, 'Mal ubicado': 0 };
    filasResumen.forEach(r => ['Realizadas', 'Visitas', 'Ya cambiado', 'Mal ubicado'].forEach(c => tot[c] += r[c]));
    filasResumen.push(tot);
  }

  const hoja = (filas, anchos, vacio) => {
    const ws = filas.length ? XLSX.utils.json_to_sheet(filas) : XLSX.utils.aoa_to_sheet([[vacio]]);
    if (filas.length) ws['!cols'] = Object.keys(filas[0]).map(k => ({ wch: anchos[k] || Math.max(10, k.length + 2) }));
    return ws;
  };
  const anchos = { 'Evento': 14, 'Hora': 9, 'NC': 12, 'Medidor': 14, 'Cliente': 30, 'Dirección': 40, 'Pareja asignada': 14, 'Realizada por': 22, 'Cuadrilla del día': 30, 'Estado actual': 13, 'Motivo visita': 22, 'Observación visita': 30, 'Comentario ya cambiado': 30, 'Observación': 30, 'Latitud': 12, 'Longitud': 12, 'Realizada': 17 };
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, hoja(filasTrabajo, anchos, 'Sin trabajo registrado ese día'), 'Trabajo del día');
  XLSX.utils.book_append_sheet(wb, hoja(filasRuta, anchos, 'No hubo ruta cargada para ese día'), 'Ruta del día');
  XLSX.utils.book_append_sheet(wb, hoja(filasResumen, { 'Pareja': 14 }, 'Sin trabajo registrado ese día'), 'Resumen');
  XLSX.writeFile(wb, `AMI_${dia}.xlsx`);
  toast(`Excel del ${dia.split('-').reverse().join('/')} descargado`, 'ok');
  return true;
}

// ── Importar historial de trabajos hechos (Excel) ──
// Doble propósito: guarda el historial consultable (ami_historial) Y agrega
// cada NC al padrón de ya cambiados (ami_cambiados). Lee las dos hojas.
// Campos: NC, trabajo, medidor nuevo, pareja, fecha. Normaliza may/tildes.
function normalizaTexto(s) {
  let t = String(s ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  t = t.replace(/\s*-\s*/g, '-');                                  // "A - B" -> "A-B"
  t = t.normalize('NFD').replace(/[\u0300-\u036f]/g, '');          // quitar tildes
  t = t.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());      // Título
  return t;
}

async function importarHistorial(file) {
  if (!file) return;
  try {
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const norm = s => String(s ?? '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g,'').replace(/[\s._-]/g,'');

    const registros = [];
    for (const nombreHoja of wb.SheetNames) {
      const matriz = XLSX.utils.sheet_to_json(wb.Sheets[nombreHoja], { header: 1, defval: '' });
      if (!matriz.length) continue;
      const hIdx = matriz.findIndex(r => r.some(c => { const n = norm(c); return n.includes('orden') || n.includes('contrato'); }));
      if (hIdx === -1) continue;
      const head = matriz[hIdx].map(norm);
      const col = (...alias) => head.findIndex(h => alias.some(a => h.includes(a)));
      const idx = {
        nc:       col('contrato','orden'),
        trabajo:  col('trabajo'),
        medNuevo: col('medidornuevo'),
        pareja:   col('pareja'),
        fecha:    col('fecha'),
      };
      for (const r of matriz.slice(hIdx + 1)) {
        const nc = String(r[idx.nc] ?? '').trim();
        if (!nc) continue;
        let fecha = null;
        const rawF = r[idx.fecha];
        if (rawF) {
          if (typeof rawF === 'number') {
            const d = new Date(Math.round((rawF - 25569) * 86400 * 1000));
            if (!isNaN(d)) fecha = d.toISOString().split('T')[0];
          } else {
            const d = new Date(String(rawF));
            fecha = isNaN(d) ? String(rawF).split(' ')[0] : d.toISOString().split('T')[0];
          }
        }
        registros.push({
          nc,
          trabajo: idx.trabajo>=0 ? normalizaTexto(r[idx.trabajo]) : '',
          medidorNuevo: idx.medNuevo>=0 ? String(r[idx.medNuevo] ?? '').trim() : '',
          pareja: idx.pareja>=0 ? normalizaTexto(r[idx.pareja]) : '',
          fecha,
        });
      }
    }
    if (!registros.length) { toast('No se encontraron registros con NC', 'error'); return; }

    const ncsUnicos = new Set(registros.map(r => r.nc));
    if (!confirm(`Historial con ${registros.length} registros (${ncsUnicos.size} NC distintos).\n\nSe guardarán en el historial y esos NC se agregarán al padrón de "ya cambiados".\n\n¿Continuar?`)) return;

    toast('Cargando historial…', 'ok');
    const ahora = firebase.firestore.Timestamp.now();

    for (let i = 0; i < registros.length; i += 400) {
      const batch = db.batch();
      registros.slice(i, i + 400).forEach(r => {
        batch.set(db.collection('ami_historial').doc(), { ...r, cargadoEn: ahora });
      });
      await batch.commit();
    }
    const listaNC = [...ncsUnicos];
    for (let i = 0; i < listaNC.length; i += 400) {
      const batch = db.batch();
      listaNC.slice(i, i + 400).forEach(nc => {
        batch.set(db.collection('ami_cambiados').doc(nc), {
          nc, cargadoEn: ahora, cargadoPor: session_.displayName, origen: 'historial',
        }, { merge: true });
      });
      await batch.commit();
    }

    toast(`Historial: ${registros.length} registros, ${ncsUnicos.size} NC al padrón`, 'ok');
    await cargarOrdenes();
    setTab('panel');
    window.dispatchEvent(new CustomEvent('ami:updated'));
  } catch (err) {
    toast('Error al cargar historial: ' + err.message, 'error');
  } finally {
    const inp = container_.querySelector('#ami-file-historial');
    if (inp) inp.value = '';
  }
}

function bloquePreparacion(titulo, texto) {
  return `
    <div style="text-align:center;padding:36px 20px;border:1px dashed var(--border);border-radius:16px;background:var(--glass)">
      <div style="width:48px;height:48px;border-radius:14px;background:${ACCENT_GLASS};display:flex;align-items:center;justify-content:center;margin:0 auto 14px">
        <svg viewBox="0 0 24 24" fill="none" stroke="${ACCENT}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="22" height="22"><path d="M12 2v4"/><path d="M12 18v4"/><path d="M4.9 4.9l2.9 2.9"/><path d="M16.2 16.2l2.9 2.9"/><path d="M2 12h4"/><path d="M18 12h4"/><path d="M4.9 19.1l2.9-2.9"/><path d="M16.2 7.8l2.9-2.9"/></svg>
      </div>
      <div style="font-size:14px;font-weight:700;margin-bottom:6px">${titulo}</div>
      <div style="font-size:12px;color:var(--text-4);line-height:1.5;max-width:320px;margin:0 auto">${texto}</div>
    </div>`;
}
