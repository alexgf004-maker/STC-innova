/**
 * js/views/caracterizacion.js
 * Área de Caracterización de la Carga.
 *
 * Cada orden = 3 puntos en cascada: Titular + Suplente 1 + Suplente 2.
 * El técnico intenta en orden; al cerrar se registra cuál de los tres logró.
 *
 * Datos:
 *  - Padrón base fijo: colección padrones/caracterizacion en Firestore (indexado por NC, ver padrones.js)
 *  - Órdenes del día: colección Firestore 'caracterizacion_ordenes'
 *
 * Este archivo arranca con la CARGA DEL DÍA (importador que cruza
 * titular -> suplentes usando el padrón). La vista de órdenes y el mapa
 * se agregan en pasos siguientes.
 */

import { db } from '../firebase.js';
import { leerPadron } from '../padrones.js';
import { leer } from '../vivo.js';
import { toast, escapeHtml } from '../ui.js';


let session_   = null;
let container_ = null;
let esAdmin_   = false;
let padron_    = null;   // { NC: {nc,nombre,direccion,ds,medidor,lat,lng,sup1?,sup2?} }
let ordenes_   = [];
let retiros_   = [];     // puntos de retiro (colección caracterizacion_retiros)
let pestana_   = 'panel';   // 'panel' (admin) | 'resumen' (técnico) | 'instalacion' | 'retiro'
let filtroInst_ = 'porhacer', filtroRet_ = 'porretirar', parejaF_ = 'todas', limite_ = 40;
let datosListos_ = false;

// Mismos colores de pareja que el mapa (por número, no solo 1-3)
const PALETA_PAREJA = ['#2dd4bf','#fbbf24','#a78bfa','#f472b6','#60a5fa'];
function colorPareja(pareja) {
  const n = parseInt(String(pareja).replace(/\D/g, ''), 10);
  return PALETA_PAREJA[(n - 1) % PALETA_PAREJA.length] || '#94a3b8';
}
// Título de sección con contador (patrón ds)
const secTitulo = (titulo, n, extra = '') => `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin:16px 0 10px">
  <div class="ds-sec" style="margin:0">${titulo}</div>
  <div style="display:flex;align-items:center;gap:8px">${extra}<span style="font-size:11px;font-weight:600;color:var(--text-3);background:var(--glass);border:1px solid var(--border);border-radius:10px;padding:2px 9px">${n}</span></div>
</div>`;
// Llevar al mapa con un punto abierto (el mapa lo lee al cargar)
function verEnMapa(tipo, id) {
  try { sessionStorage.setItem('crc_foco', JSON.stringify({ tipo, id })); } catch {}
  window.__router.navigateTo('caracterizacion_mapa');
}

// ── Carga del padrón (una vez, cacheado en memoria) ──
let padronFallo_ = false;   // si falló, se reintenta la próxima vez
async function cargarPadron() {
  if (padron_ && !padronFallo_) return padron_;
  // Timeout: si el padrón no responde en 20s, no colgar todo el proceso.
  // El padrón es un respaldo opcional; sin él se sigue con los datos del Excel.
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 20000);
  try {
    // Vive en Firestore (solo usuarios activos, ver padrones.js). Antes era
    // un archivo público del sitio.
    const datos = await Promise.race([
      leerPadron('caracterizacion'),
      new Promise((_, rej) => ctrl.signal.addEventListener('abort', () => rej(new Error('tiempo')))),
    ]);
    clearTimeout(t);
    if (!datos) throw new Error('El padrón base no está cargado.');
    padron_ = datos; padronFallo_ = false;
    return padron_;
  } catch (err) {
    clearTimeout(t);
    padronFallo_ = true;
    padron_ = padron_ || {};   // seguir sin padrón en vez de colgarse
    return padron_;
  }
}

// Busca un NC en el padrón y devuelve un punto listo para la orden
function puntoDesdePadron(nc) {
  const key = String(nc ?? '').trim();
  if (!key) return null;
  const p = padron_[key];
  if (!p) return { nc: key, encontrado: false };
  return {
    nc: p.nc,
    nombre: p.nombre || '',
    direccion: p.direccion || '',
    ds: p.ds || '',
    medidor: p.medidor || '',
    lat: p.lat ?? null,
    lng: p.lng ?? null,
    encontrado: true,
    tieneCoord: p.lat != null && p.lng != null,
  };
}

// ── Importar el Excel del día de DELSUR ──
// Devuelve { ordenes, avisos } sin guardar todavía (para previsualizar).
// ── Detección de UPR ──
// 1) Si el Excel trae una columna con "UPR" en el nombre, manda esa.
// 2) Si no viene esa columna, se aplica la regla: sin suplentes = UPR.
function valorEsSi(v) {
  const s = String(v ?? '').trim().toLowerCase();
  if (!s) return false;
  return ['si','sí','s','x','1','true','verdadero','upr','y','yes'].includes(s);
}

function detectarUPR(row, tieneSup1, tieneSup2) {
  // 1) La columna Tarifa manda: sus valores son R, G, R_UPR, G_UPR
  const tarifa = String(row['Tarifa'] ?? row['TARIFA'] ?? row['tarifa'] ?? '').trim();
  if (tarifa) {
    return { esUPR: tarifa.toUpperCase().includes('UPR'), fuente: 'tarifa', tarifa };
  }
  // 2) Por si algun dia mandan una columna dedicada a UPR
  for (const k of Object.keys(row)) {
    if (String(k).toLowerCase().replace(/[\s._-]/g, '').includes('upr')) {
      return { esUPR: valorEsSi(row[k]), fuente: 'columna', tarifa: '' };
    }
  }
  // 3) Sin nada de lo anterior: la regla — no tiene suplentes
  return { esUPR: !tieneSup1 && !tieneSup2, fuente: 'regla', tarifa: '' };
}

function construirOrdenesDesdeExcel(rows) {
  // rows: array de objetos (sheet_to_json con headers de la hoja "Información Clientes")
  const ordenes = [];
  const avisos = [];

  for (const r of rows) {
    // SOLO las filas marcadas "Titular" en la columna Categoria son órdenes.
    // Las filas "Suplente" no generan orden propia; son el respaldo de un titular.
    const categoria = String(r['Categoria'] ?? r['Categoría'] ?? '').trim().toLowerCase();
    if (categoria && categoria !== 'titular') continue;

    // Aceptar variantes de encabezado
    const ncTit = String(r['ID_Sorteado'] ?? r['Contrato'] ?? r['NC'] ?? '').trim();
    if (!ncTit) continue;

    const idSup1 = String(r['ID_Suplente1'] ?? r['ID_Suplente 1'] ?? '').trim();
    const idSup2 = String(r['ID_Suplente2'] ?? r['ID_Suplente 2'] ?? '').trim();

    // Titular: preferir datos del padrón; si no está, usar lo que trae el Excel
    let titular = puntoDesdePadron(ncTit);
    if (!titular || !titular.encontrado) {
      // Construir el titular con lo que venga en el Excel del día
      const lat = num(r['Latitud']);
      const lng = num(r['Longitud']);
      titular = {
        nc: ncTit,
        nombre: String(r['Nombre'] ?? '').trim(),
        direccion: [r['Calle'], r['Calle 4'], r['Población'], r['Distrito']].filter(Boolean).join(', '),
        ds: '',
        medidor: String(r['Medidor'] ?? '').trim(),
        lat, lng,
        encontrado: false,
        tieneCoord: lat != null && lng != null,
      };
      avisos.push(`Titular ${ncTit} no estaba en el padrón (se usó la info del archivo del día).`);
    }

    const sup1 = idSup1 ? puntoDesdePadron(idSup1) : null;
    const sup2 = idSup2 ? puntoDesdePadron(idSup2) : null;

    if (idSup1 && (!sup1 || !sup1.encontrado)) {
      avisos.push(`Suplente 1 (${idSup1}) del titular ${ncTit} no está en el padrón — la orden queda sin ese suplente.`);
    }
    if (idSup2 && (!sup2 || !sup2.encontrado)) {
      avisos.push(`Suplente 2 (${idSup2}) del titular ${ncTit} no está en el padrón — la orden queda sin ese suplente.`);
    }

    const s1ok = !!(sup1 && sup1.encontrado);
    const s2ok = !!(sup2 && sup2.encontrado);
    const upr = detectarUPR(r, s1ok, s2ok);

    ordenes.push({
      ncTitular: ncTit,
      titular,
      suplente1: s1ok ? sup1 : null,
      suplente2: s2ok ? sup2 : null,
      esUPR: upr.esUPR,
      uprFuente: upr.fuente,     // 'tarifa' | 'columna' | 'regla'
      tarifa: upr.tarifa || '',  // R, G, R_UPR, G_UPR
      estado: 'pendiente',       // pendiente | hecha | no_hecha
      logranoEn: null,           // 'titular' | 'suplente1' | 'suplente2' | null
      pareja: null,
    });
  }

  // Detectar choques: un NC que es titular del día Y suplente de otra orden.
  // No se corrige automáticamente; se avisa para que David decida.
  const setTitulares = new Set(ordenes.map(o => o.ncTitular));
  const choques = [];
  for (const o of ordenes) {
    if (o.suplente1 && setTitulares.has(o.suplente1.nc)) {
      choques.push(`NC ${o.suplente1.nc} es suplente 1 de ${o.ncTitular}, pero también es titular de su propia orden.`);
    }
    if (o.suplente2 && setTitulares.has(o.suplente2.nc)) {
      choques.push(`NC ${o.suplente2.nc} es suplente 2 de ${o.ncTitular}, pero también es titular de su propia orden.`);
    }
  }

  return { ordenes, avisos, choques };
}

function num(v) {
  const n = Number(v);
  return isNaN(n) ? null : n;
}

// ── Guardar las órdenes del día en Firestore ──
// Las que no existen se crean. Las que YA existen (mismo NC titular) NO se
// duplican ni se reinician: solo se les completan los datos informativos que
// pudieran faltar (tarifa, esUPR). Su estado, pareja y visitas quedan intactos.
async function guardarOrdenes(ordenes) {
  const existSnap = await db.collection('caracterizacion_ordenes').get();
  const porNC = new Map();
  existSnap.docs.forEach(d => {
    const nc = String(d.data().ncTitular ?? '').trim();
    if (nc) porNC.set(nc, { id: d.id, data: d.data() });
  });

  const nuevas = ordenes.filter(o => !porNC.has(o.ncTitular));

  // Existentes a las que les falta o les cambió el dato informativo
  const aActualizar = [];
  for (const o of ordenes) {
    const prev = porNC.get(o.ncTitular);
    if (!prev) continue;
    const cambios = {};
    if (prev.data.tarifa !== o.tarifa)  cambios.tarifa = o.tarifa || '';
    if (prev.data.esUPR  !== o.esUPR)   cambios.esUPR  = !!o.esUPR;
    if (prev.data.uprFuente !== o.uprFuente) cambios.uprFuente = o.uprFuente || '';
    if (Object.keys(cambios).length) aActualizar.push({ id: prev.id, cambios });
  }

  let batch = db.batch();
  let count = 0;
  const commits = [];

  for (const o of nuevas) {
    const ref = db.collection('caracterizacion_ordenes').doc();
    batch.set(ref, { ...o, importadaEn: firebase.firestore.Timestamp.now() });
    if (++count === 499) { commits.push(batch.commit()); batch = db.batch(); count = 0; }
  }
  for (const u of aActualizar) {
    batch.update(db.collection('caracterizacion_ordenes').doc(u.id), u.cambios);
    if (++count === 499) { commits.push(batch.commit()); batch = db.batch(); count = 0; }
  }

  if (count > 0) commits.push(batch.commit());
  await Promise.all(commits);

  const omitidas = ordenes.length - nuevas.length - aActualizar.length;
  return { creadas: nuevas.length, actualizadas: aActualizar.length, omitidas };
}

// ── Vista mínima (solo la carga del día por ahora) ──
export async function init(container, session) {
  container_ = container;
  session_ = session;
  esAdmin_ = (session.role === 'admin' || session.role === 'asistente');
  pestana_ = esAdmin_ ? 'panel' : 'resumen';
  filtroInst_ = 'porhacer'; filtroRet_ = 'porretirar'; parejaF_ = 'todas'; limite_ = 40;
  datosListos_ = false; ordenes_ = []; retiros_ = [];
  container.scrollTop = 0;

  const tabs = esAdmin_
    ? [['panel', 'Panel'], ['instalacion', 'Instalación'], ['retiro', 'Retiro']]
    : [['resumen', 'Resumen'], ['instalacion', 'Instalación'], ['retiro', 'Retiro']];

  container.innerHTML = `
    <div class="crc-scope" style="max-width:1100px;margin:0 auto">
      <div style="display:flex;align-items:flex-start;gap:10px;margin-bottom:16px">
        <div style="flex:1;min-width:0">
          <div style="font-size:24px;font-weight:600;letter-spacing:-.02em;line-height:1.15">Caracterización</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:4px">Caracterización de la carga · instalación y retiro</div>
        </div>
        <button class="cm-ico-btn" id="crc-mapa" title="Mapa">${svgC(ICO_C.mapa, 18)}</button>
        ${esAdmin_ ? `<button class="cm-ico-btn" id="crc-menu" title="Acciones">${svgC(ICO_C.dots, 18)}</button>` : ''}
      </div>

      <div class="area-tabs" style="margin-bottom:14px">
        ${tabs.map(([id, t]) => `<button class="area-tab crc-tab" data-tab="${id}">${t}</button>`).join('')}
      </div>

      <div class="buscar-wrap" style="margin-bottom:14px">
        ${svgC(ICO_C.buscar, 14, 'style="color:var(--text-4);flex-shrink:0"')}
        <input class="buscar-input" id="crc-buscar" type="text" placeholder="Buscar NC, medidor o nombre…" autocomplete="off"/>
      </div>
      <div id="crc-busqueda"></div>

      <div id="crc-estado"></div>
      <div id="crc-resumen"></div>
      <div id="crc-lista"></div>

      ${esAdmin_ ? `
      <input type="file" id="crc-file" accept=".xlsx,.xls" style="display:none"/>
      <input type="file" id="crc-file-comp" accept=".xlsx,.xls" style="display:none"/>
      <input type="file" id="crc-file-retiro" accept=".xlsx,.xls" style="display:none"/>

      <div class="sheet-backdrop" id="crc-sheet-acciones">
        <div class="sheet">
          <div class="sheet-handle"></div>
          <div class="sheet-title">Acciones de Caracterización</div>
          <div class="sheet-body"><div class="flex-col gap-8">
            ${accionC('crc-a-cargar', ICO_C.subir, 'Cargar órdenes del día', 'Excel de instalaciones de DELSUR')}
            ${accionC('crc-a-retiros', ICO_C.subir, 'Subir retiros', 'Excel con los puntos de retiro')}
            ${accionC('crc-a-bdth', ICO_C.check, 'Completar BDTH', 'Agregar datos que faltan a los puntos')}
            <div class="cm-acc-sep">Reportes</div>
            ${accionC('crc-a-excel', ICO_C.bajar, 'Trazabilidad por día', 'Excel de instalaciones del día que elijas')}
            ${accionC('crc-a-excel-ret', ICO_C.bajar, 'Excel de retiros', 'Todos los retiros con su estado')}
          </div></div>
        </div>
      </div>

      <div class="sheet-backdrop" id="crc-sheet-confirmar">
        <div class="sheet" style="max-height:92vh">
          <div class="sheet-handle"></div>
          <div class="sheet-title" id="crc-conf-title">Falta revisar</div>
          <div class="sheet-body" id="crc-conf-body" style="padding-bottom:16px"></div>
        </div>
      </div>` : ''}
    </div>`;

  container.querySelectorAll('.crc-tab').forEach(t => t.onclick = () => setPestana(t.dataset.tab));
  container.querySelector('#crc-mapa').onclick = () => window.__router.navigateTo('caracterizacion_mapa');

  if (esAdmin_) {
    const hoja = container.querySelector('#crc-sheet-acciones');
    const cerrarHoja = () => hoja.classList.remove('open');
    container.querySelector('#crc-menu').onclick = () => hoja.classList.add('open');
    ['crc-sheet-acciones', 'crc-sheet-confirmar'].forEach(id => {
      const el = container.querySelector('#' + id);
      el.addEventListener('click', e => { if (e.target === el) el.classList.remove('open'); });
    });
    const fileInput = container.querySelector('#crc-file');
    const fileComp = container.querySelector('#crc-file-comp');
    const fileRet = container.querySelector('#crc-file-retiro');
    container.querySelector('#crc-a-cargar').onclick = () => { cerrarHoja(); fileInput.click(); };
    container.querySelector('#crc-a-retiros').onclick = () => { cerrarHoja(); fileRet.click(); };
    container.querySelector('#crc-a-bdth').onclick = () => { cerrarHoja(); fileComp.click(); };
    container.querySelector('#crc-a-excel').onclick = () => { cerrarHoja(); abrirDescargaExcel(); };
    container.querySelector('#crc-a-excel-ret').onclick = () => { cerrarHoja(); descargarExcelRetiros(); };
    fileInput.onchange = (e) => manejarArchivo(e.target.files[0]);
    fileComp.onchange = (e) => manejarComplemento(e.target.files[0]);
    fileRet.onchange = (e) => manejarArchivoRetiro(e.target.files[0]);
    cargarPadron().catch(()=>{});
  }

  // Buscador (admin y técnico; el técnico solo encuentra lo de su pareja)
  const inpBuscar = container.querySelector('#crc-buscar');
  let tb = null;
  inpBuscar.oninput = () => { clearTimeout(tb); const v = inpBuscar.value; tb = setTimeout(() => buscarOrdenes(v), 250); };

  marcarPestana();
  cargarTodo();
}

// ── Íconos y piezas de la vista ──
const ICO_C = {
  mapa:   '<polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/>',
  dots:   '<circle cx="12" cy="5" r="1.4"/><circle cx="12" cy="12" r="1.4"/><circle cx="12" cy="19" r="1.4"/>',
  buscar: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  subir:  '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/>',
  bajar:  '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  check:  '<path d="M22 11.08V12a10 10 0 11-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/>',
  pin:    '<path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0118 0z"/><circle cx="12" cy="10" r="3"/>',
  x:      '<circle cx="12" cy="12" r="10"/><line x1="15" y1="9" x2="9" y2="15"/><line x1="9" y1="9" x2="15" y2="15"/>',
  chev:   '<polyline points="9 18 15 12 9 6"/>',
};
const svgC = (d, n = 16, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${n}" height="${n}" ${extra}>${d}</svg>`;
function accionC(id, ico, txt, sub) {
  return `<button class="us-accion" id="${id}">${svgC(ico, 18)}<span style="flex:1;text-align:left"><span style="display:block">${txt}</span><span class="us-accion-sub">${sub}</span></span></button>`;
}
function filaC(cls, ico, titulo, sub, accion) {
  return `
    <div class="cm-fila" data-accion="${accion}">
      <div class="cm-fila-ic ${cls}">${svgC(ico, 17)}</div>
      <div style="flex:1;min-width:0"><div class="cm-fila-t">${titulo}</div><div class="cm-fila-s">${sub}</div></div>
      ${svgC(ICO_C.chev, 16, 'style="color:var(--text-3);flex-shrink:0"')}
    </div>`;
}
const esLograda   = o => (o.estado === 'por_confirmar' || o.estado === 'confirmada');
const esPorHacer  = o => !o.estado || o.estado === 'pendiente';
const retHecho    = r => r.estado === 'retirado' || r.estado === 'no_retirado';
const retFalta    = r => retHecho(r) && !r.confirmado;   // hecho, falta que admin lo revise
const ordenPareja = (a, b) => (parseInt(String(a).replace(/\D/g, ''), 10) || 0) - (parseInt(String(b).replace(/\D/g, ''), 10) || 0);

// ── Buscador global (admin): NC, medidor o nombre en instalaciones y retiros ──
async function buscarOrdenes(texto) {
  const cont = container_.querySelector('#crc-busqueda');
  const resumen = container_.querySelector('#crc-resumen');
  const lista = container_.querySelector('#crc-lista');
  if (!cont) return;
  const q = String(texto || '').trim().toLowerCase();

  if (!q) {
    // Sin búsqueda: restaurar la vista normal de la pestaña
    cont.innerHTML = '';
    if (resumen) resumen.style.display = '';
    if (lista) lista.style.display = '';
    return;
  }
  if (!datosListos_) return;
  if (resumen) resumen.style.display = 'none';
  if (lista) lista.style.display = 'none';
  cont.innerHTML = `<div style="text-align:center;padding:20px;color:var(--text-4);font-size:12px">Buscando…</div>`;

  // Asegurar que ambas colecciones estén cargadas (el admin puede buscar
  // sin haber abierto la pestaña de retiros todavía).
  try {
    if (!ordenes_.length) ordenes_ = await leerColeccion('caracterizacion_ordenes');
    if (!retiros_.length) retiros_ = await leerColeccion('caracterizacion_retiros');
  } catch (e) { /* seguimos con lo que haya */ }

  const norm = s => String(s ?? '').toLowerCase();
  const coincide = (...campos) => campos.some(c => norm(c).includes(q));

  // Instalaciones que coinciden — busca en titular Y en los suplentes
  // (por su NC, nombre o medidor), para poder ubicar por el suplente usado.
  const inst = ordenes_.filter(o => {
    const t = o.titular || {};
    const s1 = o.suplente1 || {};
    const s2 = o.suplente2 || {};
    return coincide(
      o.ncTitular, t.nombre, t.medidor,
      s1.nc, s1.nombre, s1.medidor,
      s2.nc, s2.nombre, s2.medidor
    );
  });
  // Retiros que coinciden
  const rets = retiros_.filter(r => coincide(r.nc, r.nombre, r.medidor));

  const estadoInst = (o) => o.estado === 'confirmada' ? 'Realizada'
    : o.estado === 'por_confirmar' ? 'Falta revisar' : 'Pendiente';
  const estadoRet = (r) => r.estado === 'retirado' ? 'Retirado'
    : r.estado === 'no_retirado' ? 'No se pudo' : 'Pendiente';
  const badgeClase = (txt) => txt === 'Realizada' || txt === 'Retirado' ? 'ok'
    : txt === 'Falta revisar' ? 'warn' : txt === 'No se pudo' ? 'crit' : 'muted';

  const fila = (etq, val) => val ? `<div style="display:flex;justify-content:space-between;gap:12px;font-size:12px;margin-bottom:3px"><span style="color:var(--text-4)">${etq}</span><span style="color:var(--text-2);text-align:right">${escapeHtml(val)}</span></div>` : '';

  const tarjetaInst = (o) => {
    const t = o.titular || {};
    const est = estadoInst(o);
    const yaHecha = o.estado === 'por_confirmar' || o.estado === 'confirmada';
    const faltaRevisar = o.estado === 'por_confirmar';
    return `
      <div class="orden-card stacked" style="border-left:3px solid #ef4444">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
          <div class="orden-wo" style="color:#ef4444">NC ${escapeHtml(o.ncTitular || '—')}</div>
          <div style="flex:1"></div>
          ${o.esUPR ? '<span class="pareja-chip" style="color:#38bdf8;border-color:rgba(56,189,248,.4);background:rgba(56,189,248,.14)">UPR</span>' : ''}
          <span class="estado-badge ${badgeClase(est)}">${est}</span>
        </div>
        <div style="background:var(--glass);border-radius:8px;padding:8px 10px">
          ${fila('Tipo', 'Instalación')}
          ${fila('Nombre', t.nombre)}
          ${fila('Medidor', t.medidor)}
          ${fila('Dirección', t.direccion)}
          ${fila('Pareja', o.pareja)}
          ${o.suplente1?.nc ? fila('Suplente 1', `NC ${o.suplente1.nc}${o.suplente1.nombre ? ' · ' + o.suplente1.nombre : ''}`) : ''}
          ${o.suplente2?.nc ? fila('Suplente 2', `NC ${o.suplente2.nc}${o.suplente2.nombre ? ' · ' + o.suplente2.nombre : ''}`) : ''}
          ${yaHecha && o.logranoEn ? fila('Se hizo con', `${LOGRO_LABEL[o.logranoEn] || o.logranoEn}${o[o.logranoEn]?.nc ? ' · NC ' + o[o.logranoEn].nc : ''}`) : ''}
          ${yaHecha && !o.logranoEn ? fila('Resultado', 'Sin lograr') : ''}
          ${yaHecha && o.hechaPor ? fila('Marcó', o.hechaPor) : ''}
        </div>
        <button class="crc-ver-mapa crc-acc" data-tipo="o" data-id="${o.id}" style="margin-top:8px;width:100%;justify-content:center">Ver en el mapa</button>
        ${faltaRevisar && esAdmin_ ? `
        <div style="margin-top:8px">
          <button class="crc-buscar-lista" data-orden="${o.id}"
            style="width:100%;padding:9px;border-radius:10px;border:1px solid rgba(34,197,94,.4);background:rgba(34,197,94,.12);color:#22c55e;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">Marcar como lista</button>
        </div>` : ''}
      </div>`;
  };
  const tarjetaRet = (r) => {
    const est = estadoRet(r);
    return `
      <div class="orden-card stacked" style="border-left:3px solid #f59e0b">
        <div style="display:flex;align-items:center;gap:8px;flex-wrap:wrap;margin-bottom:6px">
          <div class="orden-wo" style="color:#f59e0b">NC ${escapeHtml(r.nc || '—')}</div>
          <div style="flex:1"></div>
          <span class="estado-badge ${badgeClase(est)}">${est}</span>
        </div>
        <div style="background:var(--glass);border-radius:8px;padding:8px 10px">
          ${fila('Tipo', 'Retiro')}
          ${fila('Nombre', r.nombre)}
          ${fila('Medidor', r.medidor)}
          ${fila('Dirección', r.direccion)}
          ${fila('Pareja', r.pareja)}
        </div>
        <button class="crc-ver-mapa crc-acc" data-tipo="r" data-id="${r.id}" style="margin-top:8px;width:100%;justify-content:center">Ver en el mapa</button>
      </div>`;
  };

  const total = inst.length + rets.length;
  if (!total) {
    cont.innerHTML = `<div class="dev-module"><div class="dev-title">Sin resultados</div><p>Nada coincide con "${escapeHtml(texto)}".</p></div>`;
    return;
  }
  const seccion = (titulo, arr, html) => arr.length ? `
    ${secTitulo(titulo, arr.length)}
    <div style="display:flex;flex-direction:column;gap:8px">${arr.map(html).join('')}</div>` : '';

  cont.innerHTML = `
    ${seccion('Instalaciones', inst, tarjetaInst)}
    ${seccion('Retiros', rets, tarjetaRet)}`;
  cont.querySelectorAll('.crc-ver-mapa').forEach(b => b.onclick = () => verEnMapa(b.dataset.tipo, b.dataset.id));

  // Enganchar los botones de "marcar como lista"
  cont.querySelectorAll('.crc-buscar-lista').forEach(btn => {
    btn.onclick = () => marcarListaDesdeBuscador(btn.dataset.orden, texto);
  });
}

// Marca una instalación como LISTA (confirmada) desde el buscador.
// Escribe los MISMOS campos que confirmarDesdeLista, para ser consistente.
async function marcarListaDesdeBuscador(ordenId, textoBusqueda) {
  const o = ordenes_.find(x => x.id === ordenId);
  if (!o) return;
  if (!confirm(`Marcar NC ${o.ncTitular} como lista?`)) return;
  try {
    await db.collection('caracterizacion_ordenes').doc(ordenId).update({
      estado: 'confirmada',
      confirmadaPor: session_.displayName, fechaConfirmacion: firebase.firestore.Timestamp.now(),
    });
    o.estado = 'confirmada'; o.confirmadaPor = session_.displayName;
    if (typeof toast === 'function') toast('Orden marcada como lista', 'ok');
    buscarOrdenes(textoBusqueda);
  } catch (err) {
    if (typeof toast === 'function') toast('Error: ' + err.message, 'error');
  }
}

// El técnico solo lee lo de su pareja (consulta filtrada, no toda la
// colección); el admin lee todo. Sin pareja asignada, nada.
// Mismo listener que el mapa y el inicio (js/vivo.js)
async function leerColeccion(nombre) {
  if (esAdmin_) return leer(`${nombre}|*`, () => db.collection(nombre));
  const miPareja = session_.asignacionActual?.destino || null;
  if (!miPareja) return [];
  return leer(`${nombre}|${miPareja}`, () => db.collection(nombre).where('pareja', '==', miPareja));
}

// ── Carga: instalaciones y retiros una sola vez al entrar ──
// (antes cada cambio de pestaña volvía a leer la colección completa)
async function cargarTodo() {
  const res = container_.querySelector('#crc-resumen');
  if (res) res.innerHTML = `<div style="text-align:center;padding:24px"><div class="spinner" style="margin:0 auto 8px"></div><div style="font-size:12px;color:var(--text-4)">Cargando…</div></div>`;
  try {
    [ordenes_, retiros_] = await Promise.all([
      leerColeccion('caracterizacion_ordenes'),
      leerColeccion('caracterizacion_retiros'),
    ]);
    datosListos_ = true;
    render();
  } catch (err) {
    if (res) res.innerHTML = `<div style="color:#ef4444;font-size:12px;padding:16px">Error cargando: ${escapeHtml(err.message)}</div>`;
  }
}
async function cargarOrdenes() {
  try { ordenes_ = await leerColeccion('caracterizacion_ordenes'); datosListos_ = true; render(); }
  catch (err) { toast('Error cargando órdenes: ' + err.message, 'error'); }
}
async function cargarRetiros() {
  try { retiros_ = await leerColeccion('caracterizacion_retiros'); render(); }
  catch (err) { toast('Error cargando retiros: ' + err.message, 'error'); }
}

function marcarPestana() {
  container_.querySelectorAll('.crc-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === pestana_);
    t.classList.toggle('cr', t.dataset.tab === pestana_);
  });
}

function setPestana(tab) {
  pestana_ = tab; limite_ = 40;
  marcarPestana();
  const inp = container_.querySelector('#crc-buscar');
  if (inp) inp.value = '';
  const busq = container_.querySelector('#crc-busqueda');
  if (busq) busq.innerHTML = '';
  container_.querySelector('#crc-estado').innerHTML = '';
  render();
}

function render() {
  if (!datosListos_ || !container_) return;
  const res = container_.querySelector('#crc-resumen');
  const lista = container_.querySelector('#crc-lista');
  if (!res || !lista) return;
  res.style.display = ''; lista.style.display = '';
  res.innerHTML = ''; lista.innerHTML = '';
  if (pestana_ === 'panel') renderPanel();
  else if (pestana_ === 'resumen') renderResumenTec();
  else if (pestana_ === 'retiro') renderRetiros();
  else renderInstalaciones();
  const q = container_.querySelector('#crc-buscar')?.value;
  if (q && q.trim()) buscarOrdenes(q);
}
// Compatibilidad con llamadas anteriores
function renderResumen() { render(); }
function renderLista() { render(); }

// ── Panel (admin/asistente) ──
const META_PAREJA = 7;
const META_RETIROS = 12;

function renderPanel() {
  const el = container_.querySelector('#crc-resumen');
  const hoy = claveDia(firebase.firestore.Timestamp.now());
  const total = ordenes_.length;
  const faltaRevisar = ordenes_.filter(o => o.estado === 'por_confirmar');
  const listas = ordenes_.filter(o => o.estado === 'confirmada').length;
  const porHacer = ordenes_.filter(esPorHacer).length;
  const sinAsignar = ordenes_.filter(o => esPorHacer(o) && !o.pareja).length
                   + retiros_.filter(r => !retHecho(r) && !r.pareja).length;
  const noPudo = retiros_.filter(r => r.estado === 'no_retirado').length;
  const visitas = ordenes_.reduce((s, o) => s + (Array.isArray(o.visitas) ? o.visitas.length : 0), 0);

  // Hoy por pareja: instalaciones logradas (se hizo en algún punto) y retiros
  const parejas = {};
  const P = p => (parejas[p] = parejas[p] || { inst: 0, ret: 0, asign: 0 });
  ordenes_.forEach(o => {
    if (!o.pareja) return;
    P(o.pareja).asign++;
    if (esLograda(o) && o.logranoEn && o.fechaHecha && claveDia(o.fechaHecha) === hoy) P(o.pareja).inst++;
  });
  retiros_.forEach(r => {
    if (!r.pareja) return;
    P(r.pareja).asign++;
    if (retHecho(r) && r.fechaHecho && claveDia(r.fechaHecho) === hoy) P(r.pareja).ret++;
  });
  const nombres = Object.keys(parejas).sort(ordenPareja);
  const instHoy = nombres.reduce((a, p) => a + parejas[p].inst, 0);
  const retHoy  = nombres.reduce((a, p) => a + parejas[p].ret, 0);
  const seg = n => total ? (n / total * 100).toFixed(2) : 0;

  const revisar = [
    faltaRevisar.length ? filaC('warn', ICO_C.check, `${faltaRevisar.length} hecha${faltaRevisar.length > 1 ? 's' : ''}, falta revisar`, 'Marcar listas por día o todas', 'confirmar') : '',
    sinAsignar ? filaC('muted', ICO_C.pin, `${sinAsignar} sin asignar`, 'Asignar zonas en el mapa', 'mapa') : '',
    retiros_.some(retFalta) ? (() => { const n = retiros_.filter(retFalta).length; return filaC('warn', ICO_C.check, `${n} retiro${n > 1 ? 's' : ''}, falta revisar`, 'Revisar por día o todos (salen del mapa)', 'conf-ret'); })() : '',
  ].join('');

  el.innerHTML = `
    <div class="ds-pcard cr" style="margin-bottom:22px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div class="ds-pcard-lbl">Instalaciones hoy</div>
        <div class="ds-pcard-badge">${new Date().toLocaleDateString('es-SV', { day: 'numeric', month: 'short' })}</div>
      </div>
      <div style="font-size:38px;font-weight:500;letter-spacing:-.02em;line-height:1;color:#fff;margin-top:6px">${instHoy}${nombres.length ? `<span style="font-size:18px;color:rgba(255,255,255,.7)"> / ${nombres.length * META_PAREJA}</span>` : ''}</div>
      <div style="font-size:12px;color:rgba(255,255,255,.85);margin-top:8px">${nombres.length ? `${retHoy} retiro${retHoy !== 1 ? 's' : ''} hoy · meta ${META_PAREJA} instalaciones por pareja` : 'Aún no hay parejas con puntos asignados'}</div>
      ${nombres.length ? `
      <div style="height:1px;background:rgba(255,255,255,.2);margin:14px 0 12px"></div>
      <div class="flex-col" style="gap:12px">
        ${nombres.map(p => {
          const d = parejas[p];
          return `
          <div>
            <div style="display:flex;align-items:baseline;gap:8px">
              <span style="font-size:13px;font-weight:600;color:#fff">${escapeHtml(p)}</span>
              <span style="font-size:11.5px;color:rgba(255,255,255,.75);flex:1">${d.ret ? `${d.ret} retiro${d.ret > 1 ? 's' : ''}` : ''}</span>
              <span style="font-size:14px;font-weight:700;color:#fff">${d.inst}<span style="font-size:11px;font-weight:500;color:rgba(255,255,255,.7)"> / ${META_PAREJA}</span></span>
            </div>
            <div class="ds-bar on-grad" style="margin-top:6px;height:5px"><i style="width:${Math.min(100, Math.round(d.inst / META_PAREJA * 100))}%;background:#fff"></i></div>
          </div>`;
        }).join('')}
      </div>` : ''}
    </div>

    <div class="ds-sec">Para revisar</div>
    <div class="cm-lista" style="margin-bottom:22px">
      ${revisar || `<div class="cm-fila" style="cursor:default"><div class="cm-fila-ic ok">${svgC(ICO_C.check, 17)}</div><div style="flex:1"><div class="cm-fila-t">Todo al día</div><div class="cm-fila-s">Nada pendiente de revisar</div></div></div>`}
    </div>

    <div class="ds-sec">Avance general</div>
    <div class="ds-card" style="margin-bottom:12px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px">
        <div class="ds-num-md">${listas}<span style="font-size:14px;font-weight:500;color:var(--text-3)"> / ${total} instalaciones listas</span></div>
        <div style="font-size:15px;font-weight:600;color:var(--cr-light)">${total ? Math.round(listas / total * 100) : 0}%</div>
      </div>
      <div class="cm-seg">
        <i style="width:${seg(listas)}%;background:#22c55e"></i>
        <i style="width:${seg(faltaRevisar.length)}%;background:#fbbf24"></i>
      </div>
      <div class="cm-leyenda">
        <span><b style="background:#22c55e"></b>${listas} listas</span>
        <span><b style="background:#fbbf24"></b>${faltaRevisar.length} falta revisar</span>
        <span><b style="background:rgba(255,255,255,.15)"></b>${porHacer} por hacer</span>
        ${visitas ? `<span><b style="background:#fb923c"></b>${visitas} visitas cobrables</span>` : ''}
      </div>
    </div>
    ${retiros_.length ? (() => {
      const ret = retiros_.filter(r => r.estado === 'retirado').length;
      const pend = retiros_.length - ret - noPudo;
      const s2 = n => (n / retiros_.length * 100).toFixed(2);
      return `
    <div class="ds-card">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px">
        <div class="ds-num-md">${ret}<span style="font-size:14px;font-weight:500;color:var(--text-3)"> / ${retiros_.length} retiros</span></div>
        <div style="font-size:15px;font-weight:600;color:#f59e0b">${Math.round(ret / retiros_.length * 100)}%</div>
      </div>
      <div class="cm-seg">
        <i style="width:${s2(ret)}%;background:#22c55e"></i>
        <i style="width:${s2(noPudo)}%;background:#ef4444"></i>
      </div>
      <div class="cm-leyenda">
        <span><b style="background:#22c55e"></b>${ret} retirados</span>
        ${noPudo ? `<span><b style="background:#ef4444"></b>${noPudo} no se pudo</span>` : ''}
        <span><b style="background:rgba(255,255,255,.15)"></b>${pend} por retirar</span>
      </div>
    </div>`; })() : ''}`;

  el.querySelectorAll('[data-accion]').forEach(f => f.onclick = () => {
    const a = f.dataset.accion;
    if (a === 'confirmar') abrirConfirmarCrc('o');
    else if (a === 'conf-ret') abrirConfirmarCrc('r');
    else if (a === 'mapa') window.__router.navigateTo('caracterizacion_mapa');
    else if (a === 'nopudo') { filtroRet_ = 'nopudo'; setPestana('retiro'); }
  });
}

// ── Resumen del técnico ──
function renderResumenTec() {
  const el = container_.querySelector('#crc-resumen');
  const hoy = claveDia(firebase.firestore.Timestamp.now());
  if (!ordenes_.length && !retiros_.length) {
    const miPareja = session_.asignacionActual?.destino;
    el.innerHTML = `<div class="dev-module"><div class="dev-title">${miPareja ? 'No tienes puntos asignados' : 'Sin pareja asignada'}</div><p>${miPareja ? `Cuando te asignen puntos a ${escapeHtml(miPareja)} aparecerán aquí y en el mapa.` : 'Pide que te asignen a una pareja de Caracterización.'}</p></div>`;
    return;
  }
  const instHoy = ordenes_.filter(o => esLograda(o) && o.logranoEn && o.fechaHecha && claveDia(o.fechaHecha) === hoy);
  const retHoy  = retiros_.filter(r => retHecho(r) && r.fechaHecho && claveDia(r.fechaHecho) === hoy);
  const pi = Math.min(100, Math.round(instHoy.length / META_PAREJA * 100));
  const pr = Math.min(100, Math.round(retHoy.length / META_RETIROS * 100));
  const porHacer = ordenes_.filter(esPorHacer).length;
  const retPend = retiros_.filter(r => !retHecho(r)).length;
  const visitas = ordenes_.reduce((s, o) => s + (Array.isArray(o.visitas) ? o.visitas.length : 0), 0);
  const hechasHoy = [
    ...ordenes_.filter(o => esLograda(o) && o.fechaHecha && claveDia(o.fechaHecha) === hoy).map(o => ({ t: 'o', o, ts: o.fechaHecha.seconds || 0 })),
    ...retHoy.map(r => ({ t: 'r', o: r, ts: r.fechaHecho.seconds || 0 })),
  ].sort((a, b) => b.ts - a.ts);

  el.innerHTML = `
    <div class="ds-pcard cr" style="margin-bottom:14px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;margin-bottom:12px">
        <div class="ds-pcard-lbl">Meta del día</div>
        <div class="ds-pcard-badge">${escapeHtml(session_.asignacionActual?.destino || '')}</div>
      </div>
      <div style="margin-bottom:14px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
          <span style="font-size:13px;color:rgba(255,255,255,.85);font-weight:500">Instalaciones</span>
          <span style="font-size:17px;font-weight:700;color:#fff">${instHoy.length} / ${META_PAREJA}</span>
        </div>
        <div class="ds-bar on-grad"><i style="width:${pi}%;background:#fff"></i></div>
      </div>
      <div>
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:6px">
          <span style="font-size:13px;color:rgba(255,255,255,.85);font-weight:500">Retiros</span>
          <span style="font-size:17px;font-weight:700;color:#fff">${retHoy.length} / ${META_RETIROS}</span>
        </div>
        <div class="ds-bar on-grad"><i style="width:${pr}%;background:#fff"></i></div>
      </div>
    </div>

    <button class="btn-action marca" id="crc-abrir-mapa" style="margin-bottom:14px">${svgC(ICO_C.mapa, 16)} Abrir el mapa</button>

    <div class="ds-mini" style="margin-bottom:20px">
      <div class="ds-m" data-ir="instalacion"><div class="ds-num-md">${porHacer}</div><div class="ds-lbl-sm" style="margin-top:6px">Por instalar</div></div>
      <div class="ds-m" data-ir="retiro"><div class="ds-num-md" style="color:#f59e0b">${retPend}</div><div class="ds-lbl-sm" style="margin-top:6px">Por retirar</div></div>
      <div class="ds-m"><div class="ds-num-md" style="color:#fb923c">${visitas}</div><div class="ds-lbl-sm" style="margin-top:6px">Visitas</div></div>
    </div>

    <div class="ds-sec">Hoy</div>
    ${hechasHoy.length ? `<div class="flex-col gap-8">${hechasHoy.map(x => x.t === 'o' ? tarjetaInst(x.o) : tarjetaRet(x.o)).join('')}</div>`
      : `<div class="ds-card" style="text-align:center;padding:22px 16px;color:var(--text-3);font-size:13px">Aún no hay puntos hechos hoy.</div>`}`;

  el.querySelector('#crc-abrir-mapa').onclick = () => window.__router.navigateTo('caracterizacion_mapa');
  el.querySelectorAll('[data-ir]').forEach(m => { m.style.cursor = 'pointer'; m.onclick = () => setPestana(m.dataset.ir); });
  engancharTarjetas(el);
}

// ── Chips de filtro (pareja y estado) ──
function chipsParejas(lista) {
  if (!esAdmin_) return '';
  const ps = [...new Set(lista.map(x => x.pareja).filter(Boolean))].sort(ordenPareja);
  if (!ps.length) return '';
  return `<div class="filter-row" style="margin-bottom:8px">
    ${['todas', ...ps, 'sin'].map(p => `<div class="filter-chip ${parejaF_ === p ? 'active' : ''}" data-pareja="${escapeHtml(p)}">${p === 'todas' ? 'Todas las parejas' : p === 'sin' ? 'Sin asignar' : escapeHtml(p)}</div>`).join('')}
  </div>`;
}
const pasaPareja = x => parejaF_ === 'todas' || (parejaF_ === 'sin' ? !x.pareja : x.pareja === parejaF_);

function chipsEstado(grupos, actual) {
  return `<div class="cm-tabs-est">
    ${grupos.map(g => `<div class="cm-est ${g.id === actual ? 'active' : ''} ${g.arr.length ? '' : 'vacio'}" data-est="${g.id}">${g.t}<span>${g.arr.length}</span></div>`).join('')}
  </div>`;
}

function pintarLista(el, grupos, actual, tarjeta, extraArriba = '') {
  const g = grupos.find(x => x.id === actual) || grupos[0];
  const vis = g.arr.slice(0, limite_);
  el.innerHTML = `
    ${extraArriba}
    ${vis.length ? `<div class="crc-grid">${vis.map(tarjeta).join('')}</div>
      ${g.arr.length > vis.length ? `<button class="cm-btn" id="crc-ver-mas" style="width:100%;height:44px;margin-top:10px">Ver ${Math.min(40, g.arr.length - vis.length)} más (${g.arr.length - vis.length} restantes)</button>` : ''}`
    : `<div class="ds-card" style="text-align:center;padding:24px 16px;color:var(--text-3);font-size:13px">No hay puntos en "${g.t}".</div>`}`;
  el.querySelector('#crc-ver-mas')?.addEventListener('click', () => { limite_ += 40; render(); });
}

function engancharFiltros(el, alCambiarEstado) {
  el.querySelectorAll('[data-pareja]').forEach(c => c.onclick = () => { parejaF_ = c.dataset.pareja; limite_ = 40; render(); });
  el.querySelectorAll('[data-est]').forEach(c => c.onclick = () => { alCambiarEstado(c.dataset.est); limite_ = 40; render(); });
}

// ── Pestaña Instalación ──
function renderInstalaciones() {
  const res = container_.querySelector('#crc-resumen');
  const lista = container_.querySelector('#crc-lista');
  if (!ordenes_.length) {
    res.innerHTML = esAdmin_
      ? `<div class="dev-module"><div class="dev-title">No hay órdenes cargadas</div><p>Usa los tres puntos de arriba, "Cargar órdenes del día", para subir el Excel de DELSUR.</p></div>`
      : `<div class="dev-module"><div class="dev-title">No tienes instalaciones asignadas</div></div>`;
    return;
  }
  const base = ordenes_.filter(pasaPareja);
  const reciente = arr => arr.sort((a, b) => (b.fechaHecha?.seconds || 0) - (a.fechaHecha?.seconds || 0));
  const grupos = [
    { id: 'porhacer', t: 'Por hacer',     arr: base.filter(esPorHacer).sort((a, b) => (b.esUPR ? 1 : 0) - (a.esUPR ? 1 : 0)) },
    { id: 'falta',    t: esAdmin_ ? 'Falta revisar' : 'Hechas', arr: reciente(base.filter(o => o.estado === 'por_confirmar')) },
    { id: 'listas',   t: 'Listas',        arr: reciente(base.filter(o => o.estado === 'confirmada')) },
  ];
  res.innerHTML = chipsParejas(ordenes_) + chipsEstado(grupos, filtroInst_);
  engancharFiltros(res, id => { filtroInst_ = id; });
  const extra = esAdmin_ && filtroInst_ === 'falta' && grupos[1].arr.length
    ? `<button class="btn-action marca" id="crc-conf-btn" style="margin-bottom:12px">${svgC(ICO_C.check, 16)} Marcar listas por día o todas</button>` : '';
  pintarLista(lista, grupos, filtroInst_, tarjetaInst, extra);
  lista.querySelector('#crc-conf-btn')?.addEventListener('click', () => abrirConfirmarCrc('o'));
  engancharTarjetas(lista);
}

// ── Pestaña Retiro ──
function renderRetiros() {
  const res = container_.querySelector('#crc-resumen');
  const lista = container_.querySelector('#crc-lista');
  if (!retiros_.length) {
    res.innerHTML = esAdmin_
      ? `<div class="dev-module"><div class="dev-title">No hay retiros cargados</div><p>Usa los tres puntos de arriba, "Subir retiros", para cargar el Excel.</p></div>`
      : `<div class="dev-module"><div class="dev-title">No tienes retiros asignados</div></div>`;
    return;
  }
  const base = retiros_.filter(pasaPareja);
  const reciente = arr => arr.sort((a, b) => (b.fechaHecho?.seconds || 0) - (a.fechaHecho?.seconds || 0));
  const grupos = esAdmin_ ? [
    { id: 'porretirar', t: 'Por retirar',   arr: base.filter(r => !retHecho(r)) },
    { id: 'falta',      t: 'Falta revisar', arr: reciente(base.filter(retFalta)) },
    { id: 'revisados',  t: 'Revisados',     arr: reciente(base.filter(r => retHecho(r) && r.confirmado)) },
  ] : [
    { id: 'porretirar', t: 'Por retirar', arr: base.filter(r => !retHecho(r)) },
    { id: 'nopudo',     t: 'No se pudo',  arr: reciente(base.filter(r => r.estado === 'no_retirado')) },
    { id: 'retirados',  t: 'Retirados',   arr: reciente(base.filter(r => r.estado === 'retirado')) },
  ];
  if (!grupos.some(g => g.id === filtroRet_)) filtroRet_ = 'porretirar';
  res.innerHTML = chipsParejas(retiros_) + chipsEstado(grupos, filtroRet_);
  engancharFiltros(res, id => { filtroRet_ = id; });
  const extra = esAdmin_ && filtroRet_ === 'falta' && grupos[1].arr.length
    ? `<button class="btn-action marca" id="crc-conf-ret-btn" style="margin-bottom:12px">${svgC(ICO_C.check, 16)} Revisar por día o todos</button>` : '';
  pintarLista(lista, grupos, filtroRet_, tarjetaRet, extra);
  lista.querySelector('#crc-conf-ret-btn')?.addEventListener('click', () => abrirConfirmarCrc('r'));
  engancharTarjetas(lista);
}

// ── Tarjetas ──
const LOGRO_LABEL = { titular:'Titular', suplente1:'Suplente 1', suplente2:'Suplente 2' };

function tarjetaInst(o) {
  const t = o.titular || {};
  const falta = o.estado === 'por_confirmar';
  const lista = o.estado === 'confirmada';
  const visitas = Array.isArray(o.visitas) ? o.visitas : [];
  const puntos = [o.titular, o.suplente1, o.suplente2].filter(Boolean).length;
  const estado = lista ? '<span class="cm-pill ok">Lista</span>'
    : falta ? `<span class="cm-pill warn">${esAdmin_ ? 'Falta revisar' : 'Hecha'}</span>` : '';
  const resultado = (falta || lista)
    ? (o.logranoEn ? `Hecha en <b style="color:#22c55e">${LOGRO_LABEL[o.logranoEn]}</b>` : '<b style="color:#f87171">Sin lograr</b>')
    : `${puntos} punto${puntos !== 1 ? 's' : ''}`;
  const meta = [
    resultado,
    visitas.length ? `<span style="color:#fb923c">${visitas.length} visita${visitas.length > 1 ? 's' : ''}</span>` : '',
    esAdmin_ ? (o.pareja ? escapeHtml(o.pareja) : '<span style="color:#fbbf24">Sin asignar</span>') : '',
    (falta || lista) && o.hechaPor ? escapeHtml(o.hechaPor) : '',
  ].filter(Boolean).join(' · ');
  return `
    <div class="cm-ord" data-orden="${o.id}" style="${o.esUPR ? 'box-shadow:inset 3px 0 0 #38bdf8, var(--sh-card)' : ''}">
      <div style="display:flex;align-items:flex-start;gap:10px">
        <div style="flex:1;min-width:0">
          <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
            <span class="cm-wo">${escapeHtml(t.nombre || ('NC ' + o.ncTitular) || '—')}</span>
            ${o.esUPR ? '<span class="cm-pill" style="color:#38bdf8;background:rgba(56,189,248,.14);border-color:rgba(56,189,248,.35)">UPR</span>' : ''}
            ${estado}
          </div>
          <div class="cm-cli">NC ${escapeHtml(o.ncTitular || '—')}${o.tarifa ? ' · ' + escapeHtml(o.tarifa) : ''}${t.direccion ? ' · ' + escapeHtml(String(t.direccion).split(',')[0]) : ''}</div>
          <div class="cm-meta">${meta}</div>
        </div>
      </div>
      ${falta && esAdmin_ ? `
      <div class="cm-ord-acc">
        <button class="cm-btn ok" data-confirmar="${o.id}">${svgC(ICO_C.check, 14)} Marcar lista</button>
      </div>` : ''}
    </div>`;
}

function tarjetaRet(r) {
  const est = r.estado === 'retirado' ? '<span class="cm-pill ok">Retirado</span>'
    : r.estado === 'no_retirado' ? '<span class="cm-pill crit">No se pudo</span>'
    : '<span class="cm-pill" style="color:#f59e0b;background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.3)">Por retirar</span>';
  const meta = [
    retHecho(r) && r.hechoPor ? escapeHtml(r.hechoPor) : '',
    retHecho(r) && r.fechaHecho ? fmtFechaHora(r.fechaHecho) : '',
    esAdmin_ ? (r.pareja ? escapeHtml(r.pareja) : '<span style="color:#fbbf24">Sin asignar</span>') : '',
  ].filter(Boolean).join(' · ');
  return `
    <div class="cm-ord" data-retiro="${r.id}">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="cm-wo">${escapeHtml(r.nombre || ('NC ' + r.nc))}</span>${est}
      </div>
      <div class="cm-cli">NC ${escapeHtml(r.nc || '—')}${r.direccion ? ' · ' + escapeHtml(String(r.direccion).split(',')[0]) : ''}</div>
      ${r.estado === 'no_retirado' && r.motivo ? `<div class="cm-meta" style="color:#f87171">Motivo: ${escapeHtml(r.motivo)}</div>` : ''}
      ${meta ? `<div class="cm-meta">${meta}</div>` : ''}
      ${esAdmin_ && r.confirmado ? `<div class="cm-meta" style="color:#22c55e">Revisado${r.confirmadoPor ? ' por ' + escapeHtml(r.confirmadoPor) : ''}</div>` : ''}
      ${esAdmin_ && retFalta(r) ? `
      <div class="cm-ord-acc">
        <button class="cm-btn ok" data-confirmar-ret="${r.id}">${svgC(ICO_C.check, 14)} Revisado</button>
      </div>` : ''}
    </div>`;
}

function engancharTarjetas(el) {
  el.querySelectorAll('[data-confirmar]').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); confirmarDesdeLista(btn.dataset.confirmar); });
  el.querySelectorAll('[data-confirmar-ret]').forEach(btn => btn.onclick = (e) => { e.stopPropagation(); confirmarLoteCrc(null, [retiros_.find(x => x.id === btn.dataset.confirmarRet)].filter(Boolean)); });
  el.querySelectorAll('.cm-ord[data-orden]').forEach(c => c.onclick = () => verEnMapa('o', c.dataset.orden));
  el.querySelectorAll('.cm-ord[data-retiro]').forEach(c => c.onclick = () => verEnMapa('r', c.dataset.retiro));
}

async function confirmarDesdeLista(ordenId) {
  const o = ordenes_.find(x => x.id === ordenId);
  if (!o) return;
  try {
    await db.collection('caracterizacion_ordenes').doc(ordenId).update({
      estado: 'confirmada',
      confirmadaPor: session_.displayName, fechaConfirmacion: firebase.firestore.Timestamp.now(),
    });
    o.estado = 'confirmada'; o.confirmadaPor = session_.displayName;
    if (container_.querySelector('#crc-sheet-confirmar')?.classList.contains('open')) renderConfirmarCrc();
    render();
    toast('Orden marcada como lista', 'ok');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
}

// ── Marcar listas (instalaciones) o revisados (retiros): por día o todas ──
let confGruposCrc_ = [];
let confTipo_ = 'o';

function abrirConfirmarCrc(tipo = 'o') {
  confTipo_ = tipo;
  renderConfirmarCrc();
  container_.querySelector('#crc-sheet-confirmar')?.classList.add('open');
}

function renderConfirmarCrc() {
  const body = container_.querySelector('#crc-conf-body');
  if (!body) return;
  const esRet = confTipo_ === 'r';
  const pareja = parejaF_ !== 'todas' && parejaF_ !== 'sin' ? parejaF_ : null;
  const fechaDe = x => esRet ? x.fechaHecho : x.fechaHecha;
  const lista = (esRet ? retiros_.filter(retFalta) : ordenes_.filter(o => o.estado === 'por_confirmar'))
    .filter(x => !pareja || x.pareja === pareja)
    .sort((a, b) => (fechaDe(b)?.seconds || 0) - (fechaDe(a)?.seconds || 0));
  const porDia = {};
  lista.forEach(x => { const k = claveDia(fechaDe(x)) || 'sin-fecha'; (porDia[k] = porDia[k] || []).push(x); });
  confGruposCrc_ = Object.keys(porDia).sort().reverse().map(k => ({ k, fecha: k === 'sin-fecha' ? 'Sin fecha' : etiquetaDia(k), items: porDia[k] }));
  container_.querySelector('#crc-conf-title').textContent = (esRet ? 'Retiros, falta revisar' : 'Falta revisar') + (pareja ? ' · ' + pareja : '');
  const verbo = esRet ? 'Revisar' : 'Marcar';

  const fila = x => esRet ? `
    <div class="cm-verif">
      <div style="flex:1;min-width:0">
        <div class="cm-wo" style="font-size:13.5px">${escapeHtml(x.nombre || 'NC ' + x.nc)}</div>
        <div class="cm-cli">NC ${escapeHtml(x.nc || '—')}${!pareja && x.pareja ? ' · ' + escapeHtml(x.pareja) : ''}</div>
        <div class="cm-meta">${x.estado === 'retirado' ? '<span style="color:#22c55e">Retirado</span>' : `<span style="color:#f87171">No se pudo${x.motivo ? ': ' + escapeHtml(x.motivo) : ''}</span>`}${x.hechoPor ? ' · ' + escapeHtml(x.hechoPor) : ''}</div>
      </div>
      <button class="cm-btn ok" data-uno="${x.id}">${svgC(ICO_C.check, 14)}</button>
    </div>` : `
    <div class="cm-verif">
      <div style="flex:1;min-width:0">
        <div class="cm-wo" style="font-size:13.5px">${escapeHtml(x.titular?.nombre || 'NC ' + x.ncTitular)}</div>
        <div class="cm-cli">NC ${escapeHtml(x.ncTitular || '—')}${!pareja && x.pareja ? ' · ' + escapeHtml(x.pareja) : ''}</div>
        <div class="cm-meta">${x.logranoEn ? `Hecha en ${LOGRO_LABEL[x.logranoEn]}` : '<span style="color:#f87171">Sin lograr</span>'}${x.hechaPor ? ' · ' + escapeHtml(x.hechaPor) : ''}</div>
      </div>
      <button class="cm-btn ok" data-uno="${x.id}">${svgC(ICO_C.check, 14)}</button>
    </div>`;

  body.innerHTML = lista.length ? `
    <div style="font-size:12.5px;color:var(--text-3);margin-bottom:12px">${lista.length} ${esRet ? `retiro${lista.length > 1 ? 's' : ''} hecho${lista.length > 1 ? 's' : ''} esperando revisión. Al revisarlos salen del mapa.` : `hecha${lista.length > 1 ? 's' : ''} esperando revisión${pareja ? '' : ' en todas las parejas'}.`}</div>
    <button class="btn-action marca" style="margin-bottom:16px" data-lote="-1">${svgC(ICO_C.check, 16)} ${esRet ? `Revisar todos (${lista.length})` : `Marcar todas como listas (${lista.length})`}</button>
    <div class="flex-col" style="gap:16px">
      ${confGruposCrc_.map((g, i) => `
        <div>
          <div class="cm-dia">
            <div style="flex:1;min-width:0"><div class="cm-dia-t">${g.fecha}</div><div class="cm-dia-s">${g.items.length} ${g.items.length > 1 ? 'puntos' : 'punto'}</div></div>
            <button class="cm-btn ok" data-lote="${i}">${svgC(ICO_C.check, 14)} ${verbo} día</button>
          </div>
          <div class="flex-col gap-6">${g.items.map(fila).join('')}</div>
        </div>`).join('')}
    </div>` : `
    <div style="text-align:center;padding:26px 10px">
      <div class="hm-ic cr" style="margin:0 auto 12px">${svgC(ICO_C.check, 20)}</div>
      <div style="font-size:15px;font-weight:600">Nada por revisar</div>
      <div style="font-size:12.5px;color:var(--text-3);margin-top:4px">${esRet ? 'Todos los retiros hechos ya están revisados.' : 'Todas las hechas ya están listas.'}</div>
    </div>`;
  body.querySelectorAll('[data-lote]').forEach(b => b.onclick = () => confirmarLoteCrc(parseInt(b.dataset.lote, 10)));
  body.querySelectorAll('[data-uno]').forEach(b => b.onclick = () => esRet
    ? confirmarLoteCrc(null, [retiros_.find(x => x.id === b.dataset.uno)].filter(Boolean))
    : confirmarDesdeLista(b.dataset.uno));
}

// i: índice del día (-1 = todos) en la hoja abierta; o una lista directa de retiros
async function confirmarLoteCrc(i, directa = null) {
  const esRet = directa ? true : confTipo_ === 'r';
  const lista = directa || (i === -1 ? confGruposCrc_.flatMap(g => g.items) : (confGruposCrc_[i]?.items || []));
  if (!lista.length) return;
  if (!directa) {
    const que = i === -1 ? `todos (${lista.length})` : `${lista.length} del ${confGruposCrc_[i].fecha.replace(/^(Hoy|Ayer) · /, '')}`;
    if (!confirm(esRet ? `¿Marcar como revisados ${que}? Saldrán del mapa.` : `¿Marcar como listas ${que}?`)) return;
  }
  const ahora = firebase.firestore.Timestamp.now();
  const datos = esRet
    ? { confirmado: true, confirmadoPor: session_.displayName, fechaConfirmacion: ahora }
    : { estado: 'confirmada', confirmadaPor: session_.displayName, fechaConfirmacion: ahora };
  const col = esRet ? 'caracterizacion_retiros' : 'caracterizacion_ordenes';
  try {
    for (let k = 0; k < lista.length; k += 400) {
      const batch = db.batch();
      lista.slice(k, k + 400).forEach(x => batch.update(db.collection(col).doc(x.id), datos));
      await batch.commit();
    }
    lista.forEach(x => Object.assign(x, datos));
    toast(esRet ? `${lista.length} retiro${lista.length > 1 ? 's' : ''} revisado${lista.length > 1 ? 's' : ''}` : `${lista.length} marcada${lista.length > 1 ? 's' : ''} como lista${lista.length > 1 ? 's' : ''}`, 'ok');
    if (container_.querySelector('#crc-sheet-confirmar')?.classList.contains('open')) renderConfirmarCrc();
    render();
  } catch (err) {
    toast('Error: ' + err.message, 'error');
  }
}

async function manejarArchivo(file) {
  if (!file) return;
  const est = container_.querySelector('#crc-estado');
  est.innerHTML = `<div style="text-align:center;padding:16px"><div class="spinner" style="margin:0 auto 8px"></div><div style="font-size:12px;color:var(--text-4)">Procesando…</div></div>`;

  try {
    await cargarPadron();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    // Preferir la hoja "Información Clientes"; si no, la primera
    const hoja = wb.SheetNames.find(n => /informaci/i.test(n)) || wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { defval: '' });
    if (!rows.length) { est.innerHTML = `<div style="color:#ef4444;font-size:12px">El archivo está vacío.</div>`; return; }

    const { ordenes, avisos, choques } = construirOrdenesDesdeExcel(rows);
    mostrarPrevisualizacion(ordenes, avisos, choques);
  } catch (err) {
    est.innerHTML = `<div style="color:#ef4444;font-size:12px">Error: ${err.message}</div>`;
  }
}

function mostrarPrevisualizacion(ordenes, avisos, choques = []) {
  const est = container_.querySelector('#crc-estado');
  const conTres = ordenes.filter(o => o.suplente1 && o.suplente2).length;
  const cantUPR = ordenes.filter(o => o.esUPR).length;
  const sinCoordTit = ordenes.filter(o => !o.titular.tieneCoord).length;

  est.innerHTML = `
    <div style="background:var(--glass);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:12px">
      <div style="font-size:15px;font-weight:800;margin-bottom:10px">${ordenes.length} órdenes listas para cargar</div>
      <div class="flex-col gap-4" style="font-size:12px">
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">Con titular + 2 suplentes</span><span style="font-weight:700;color:#22c55e">${conTres}</span></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">Titulares sin ubicación</span><span style="font-weight:700;color:${sinCoordTit?'#fbbf24':'var(--text-4)'}">${sinCoordTit}</span></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">Puntos UPR</span><span style="font-weight:700;color:${cantUPR?'#38bdf8':'var(--text-4)'}">${cantUPR}</span></div>
      </div>
    </div>
    ${choques.length ? `
      <div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.35);border-radius:10px;padding:12px;margin-bottom:12px">
        <div style="font-size:11px;font-weight:800;color:#f87171;margin-bottom:4px">${choques.length} choque${choques.length>1?'s':''}: un cliente es titular Y suplente</div>
        <div style="font-size:10px;color:var(--text-4);margin-bottom:8px">Revisa estos casos. Puedes cargar igual y ajustar después, o corregir el Excel de DELSUR.</div>
        <div style="font-size:10px;color:var(--text-3);max-height:140px;overflow-y:auto;line-height:1.6">${choques.slice(0,50).map(c=>`• ${c}`).join('<br>')}${choques.length>50?`<br>… y ${choques.length-50} más`:''}</div>
      </div>` : ''}
    ${avisos.length ? `
      <div style="background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.3);border-radius:10px;padding:12px;margin-bottom:12px">
        <div style="font-size:11px;font-weight:700;color:#fbbf24;margin-bottom:6px">${avisos.length} aviso${avisos.length>1?'s':''}</div>
        <div style="font-size:10px;color:var(--text-3);max-height:120px;overflow-y:auto;line-height:1.6">${avisos.slice(0,40).map(a=>`• ${a}`).join('<br>')}${avisos.length>40?`<br>… y ${avisos.length-40} más`:''}</div>
      </div>` : ''}
    <button class="btn-primary full" id="crc-confirmar"><span id="crc-confirmar-lbl">Confirmar y cargar ${ordenes.length} órdenes</span></button>`;

  container_.querySelector('#crc-confirmar').onclick = async () => {
    const btn = container_.querySelector('#crc-confirmar');
    btn.disabled = true;
    container_.querySelector('#crc-confirmar-lbl').textContent = 'Guardando…';
    try {
      const { creadas, actualizadas, omitidas } = await guardarOrdenes(ordenes);
      const partes = [];
      if (creadas) partes.push(`${creadas} cargadas`);
      if (actualizadas) partes.push(`${actualizadas} actualizadas`);
      if (omitidas) partes.push(`${omitidas} sin cambios`);
      toast(partes.length ? partes.join(' · ') : 'Sin cambios que aplicar', 'ok');
      est.innerHTML = '';
      await cargarOrdenes();
    } catch (err) {
      btn.disabled = false;
      container_.querySelector('#crc-confirmar-lbl').textContent = 'Reintentar';
      toast('Error al guardar: ' + err.message, 'error');
    }
  };
}

// ══════════════════════════════════════════════════════════════
//  DESCARGA DE EXCEL — trazabilidad por día (admin/asistente)
// ══════════════════════════════════════════════════════════════

// Convierte importadaEn (Timestamp) a una clave de día YYYY-MM-DD local
function claveDia(ts) {
  if (!ts) return null;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${dd}`;
}

function etiquetaDia(clave) {
  const [y, m, d] = clave.split('-').map(Number);
  const fecha = new Date(y, m - 1, d);
  const hoy = new Date(); hoy.setHours(0,0,0,0);
  const ayer = new Date(hoy); ayer.setDate(ayer.getDate() - 1);
  const meses = ['ene','feb','mar','abr','may','jun','jul','ago','sep','oct','nov','dic'];
  let prefijo = '';
  if (fecha.getTime() === hoy.getTime()) prefijo = 'Hoy · ';
  else if (fecha.getTime() === ayer.getTime()) prefijo = 'Ayer · ';
  return `${prefijo}${d} ${meses[m-1]} ${y}`;
}

function abrirDescargaExcel() {
  // Agrupar las órdenes por día de carga
  const porDia = {};
  for (const o of ordenes_) {
    const k = claveDia(o.importadaEn);
    if (!k) continue;
    if (!porDia[k]) porDia[k] = [];
    porDia[k].push(o);
  }
  const dias = Object.keys(porDia).sort().reverse();  // más reciente primero

  let modal = document.getElementById('crc-excel-modal');
  if (modal) modal.remove();
  modal = document.createElement('div');
  modal.id = 'crc-excel-modal';
  modal.style.cssText = 'position:fixed;inset:0;z-index:2000;background:rgba(0,0,0,.6);display:flex;align-items:center;justify-content:center;padding:20px';

  if (!dias.length) {
    modal.innerHTML = `<div style="background:#0d1117;border:1px solid var(--border);border-radius:16px;padding:24px;max-width:360px;width:100%;text-align:center">
      <div style="font-size:14px;color:var(--text-3);margin-bottom:16px">No hay órdenes con fecha de carga para exportar.</div>
      <button id="crc-excel-cerrar" style="padding:10px 20px;border-radius:10px;border:1px solid var(--border);background:var(--glass);color:var(--text-2);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Cerrar</button>
    </div>`;
  } else {
    modal.innerHTML = `<div style="background:#0d1117;border:1px solid var(--border);border-radius:16px;padding:20px;max-width:380px;width:100%;max-height:80vh;overflow-y:auto">
      <div style="font-size:16px;font-weight:800;margin-bottom:4px">Descargar trazabilidad</div>
      <div style="font-size:12px;color:var(--text-4);margin-bottom:16px">Elige el día a exportar</div>
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
        ${dias.map(k => {
          const arr = porDia[k];
          const hechas = arr.filter(o => o.estado === 'por_confirmar' || o.estado === 'confirmada').length;
          return `<button class="crc-dia-btn" data-dia="${k}" style="display:flex;align-items:center;justify-content:space-between;gap:10px;padding:13px 15px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-2);cursor:pointer;font-family:inherit;text-align:left">
            <div>
              <div style="font-size:13px;font-weight:700">${etiquetaDia(k)}</div>
              <div style="font-size:10px;color:var(--text-4);margin-top:2px">${arr.length} órdenes · ${hechas} hechas</div>
            </div>
            <svg viewBox="0 0 24 24" fill="none" stroke="#a78bfa" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>`;
        }).join('')}
      </div>
      <button id="crc-excel-cerrar" style="width:100%;padding:11px;border-radius:10px;border:1px solid var(--border);background:transparent;color:var(--text-4);font-size:12px;font-weight:600;cursor:pointer;font-family:inherit">Cancelar</button>
    </div>`;
  }

  document.body.appendChild(modal);
  modal.querySelector('#crc-excel-cerrar').onclick = () => modal.remove();
  modal.onclick = (e) => { if (e.target === modal) modal.remove(); };
  modal.querySelectorAll('.crc-dia-btn').forEach(btn => {
    btn.onclick = () => { generarExcelDia(btn.dataset.dia, porDia[btn.dataset.dia]); modal.remove(); };
  });
}

function fmtFechaHora(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

const ESTADO_LABEL = { pendiente:'Por hacer', por_confirmar:'Hecha, falta revisar', confirmada:'Lista' };
const PUNTO_LABEL = { titular:'Titular', suplente1:'Suplente 1', suplente2:'Suplente 2' };

function generarExcelDia(clave, ordenes) {
  try {
    const filas = ordenes.map(o => {
      const t = o.titular || {};
      const s1 = o.suplente1 || {};
      const s2 = o.suplente2 || {};
      const visitas = Array.isArray(o.visitas) ? o.visitas : [];
      return {
        'NC Titular': o.ncTitular || '',
        'Nombre Titular': t.nombre || '',
        'Dirección': t.direccion || '',
        'DS': t.ds || '',
        'Medidor': t.medidor || '',
        'NC Suplente 1': s1.nc || '',
        'Nombre Suplente 1': s1.nombre || '',
        'NC Suplente 2': s2.nc || '',
        'Nombre Suplente 2': s2.nombre || '',
        'Tarifa': o.tarifa || '',
        'UPR': o.esUPR ? 'Sí' : 'No',
        'Pareja': o.pareja || 'Sin asignar',
        'Estado': ESTADO_LABEL[o.estado] || 'Pendiente',
        'Hecha en': o.logranoEn ? PUNTO_LABEL[o.logranoEn] : (o.estado && o.estado !== 'pendiente' ? 'Sin lograr' : ''),
        'Visitas (cantidad)': visitas.length,
        'Visitas (puntos)': visitas.map(v => PUNTO_LABEL[v]).join(', '),
        'Marcada por': o.hechaPor || '',
        'Fecha marcada': fmtFechaHora(o.fechaHecha),
        'Confirmada por': o.confirmadaPor || '',
        'Fecha confirmada': fmtFechaHora(o.fechaConfirmacion),
        'Cargada': fmtFechaHora(o.importadaEn),
      };
    });

    const headers = Object.keys(filas[0] || {
      'NC Titular':'','Nombre Titular':'','Dirección':'','DS':'','Medidor':'',
      'NC Suplente 1':'','Nombre Suplente 1':'','NC Suplente 2':'','Nombre Suplente 2':'',
      'Pareja':'','Estado':'','Hecha en':'','Visitas (cantidad)':'','Visitas (puntos)':'',
      'Marcada por':'','Fecha marcada':'','Confirmada por':'','Fecha confirmada':'','Cargada':''
    });

    const ws = XLSX.utils.json_to_sheet(filas, { header: headers });
    // Anchos de columna cómodos
    ws['!cols'] = headers.map(h => ({ wch: Math.max(12, Math.min(34, h.length + 4)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Caracterización');
    XLSX.writeFile(wb, `Caracterizacion_${clave}.xlsx`);
    toast(`Excel de ${etiquetaDia(clave)} descargado`, 'ok');
  } catch (err) {
    toast('Error al generar el Excel: ' + err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════
//  COMPLETAR DATOS DESDE LA BDTH (admin/asistente)
//  Sube un Excel con NC + nombre (y opcionalmente dirección, DS,
//  medidor) y completa las órdenes ya cargadas. Sirve para los UPR,
//  que no están en el padrón y llegan sin nombre.
//  Sobrescribe con lo del complemento y aplica a titular y suplentes.
//  NO toca estado, pareja, visitas ni confirmaciones.
// ══════════════════════════════════════════════════════════════

function normHeader(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')   // quitar acentos
    .toLowerCase().replace(/[\s._\-\/]/g, '');
}

const ALIAS_COMP = {
  nc:        ['contrato','nc','id','idsorteado','nic','numerocliente','cuenta','numerodecuenta'],
  nombre:    ['nombredepila','nombre','nombrecliente','nombredelcliente','titular','cliente'],
  direccion: ['direccion','dir','direccioncompleta','domicilio'],
  ds:        ['ubicaciontecnica','ds','ubicacion'],
  medidor:   ['aparato','medidor','nromedidor','numerodemedidor','nmedidor'],
};

// Detecta qué encabezado del archivo corresponde a cada campo
function mapearColumnas(rows) {
  const claves = Object.keys(rows[0] || {});
  const encontrado = {};
  for (const campo of Object.keys(ALIAS_COMP)) {
    for (const k of claves) {
      if (ALIAS_COMP[campo].includes(normHeader(k))) { encontrado[campo] = k; break; }
    }
  }
  return encontrado;
}

function construirMapaComplemento(rows) {
  const cols = mapearColumnas(rows);
  if (!cols.nc) return { mapa: null, cols };
  const mapa = new Map();
  for (const r of rows) {
    const nc = String(r[cols.nc] ?? '').trim();
    if (!nc) continue;
    const info = {};
    if (cols.nombre)    info.nombre    = String(r[cols.nombre] ?? '').trim();
    if (cols.direccion) info.direccion = String(r[cols.direccion] ?? '').trim();
    if (cols.ds)        info.ds        = String(r[cols.ds] ?? '').trim();
    if (cols.medidor)   info.medidor   = String(r[cols.medidor] ?? '').trim();
    // Solo guardar si aporta algo
    if (Object.values(info).some(v => v)) mapa.set(nc, info);
  }
  return { mapa, cols };
}

// Aplica el complemento sobre un punto (titular o suplente) y dice si cambió
function completarPunto(punto, info) {
  if (!punto || !info) return null;
  const nuevo = { ...punto };
  let cambio = false;
  for (const campo of ['nombre','direccion','ds','medidor']) {
    const val = info[campo];
    if (val && nuevo[campo] !== val) { nuevo[campo] = val; cambio = true; }
  }
  return cambio ? nuevo : null;
}

async function manejarComplemento(file) {
  if (!file) return;
  const est = container_.querySelector('#crc-estado');
  est.innerHTML = `<div style="text-align:center;padding:20px"><div class="spinner" style="margin:0 auto 8px"></div><div style="font-size:12px;color:var(--text-4)">Leyendo el complemento…</div></div>`;

  try {
    if (!ordenes_.length) throw new Error('Primero carga las órdenes del día.');

    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const hoja = wb.SheetNames[0];
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[hoja], { defval: '' });
    if (!rows.length) throw new Error('El archivo está vacío.');

    const { mapa, cols } = construirMapaComplemento(rows);
    if (!mapa) {
      throw new Error('No encontré la columna del NC. Debe llamarse Contrato, NC o ID.');
    }
    if (!cols.nombre && !cols.direccion && !cols.ds && !cols.medidor) {
      throw new Error('El archivo no trae Nombre, Dirección, DS ni Medidor.');
    }

    // Calcular qué órdenes se completarían
    const cambios = [];   // { id, patch:{}, detalles:[] }
    const ncsUsados = new Set();
    for (const o of ordenes_) {
      const patch = {};
      const detalles = [];
      for (const nivel of ['titular','suplente1','suplente2']) {
        const p = o[nivel];
        if (!p || !p.nc) continue;
        const info = mapa.get(String(p.nc).trim());
        if (!info) continue;
        const nuevo = completarPunto(p, info);
        if (nuevo) {
          patch[nivel] = nuevo;
          detalles.push(nivel);
          ncsUsados.add(String(p.nc).trim());
        }
      }
      if (Object.keys(patch).length) cambios.push({ id: o.id, patch, detalles, nc: o.ncTitular });
    }

    const sinUsar = mapa.size - ncsUsados.size;
    mostrarPrevisualizacionComplemento(cambios, mapa.size, sinUsar, cols);

  } catch (err) {
    est.innerHTML = `<div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:14px;font-size:12px;color:#f87171">${err.message}</div>`;
  } finally {
    const inp = container_.querySelector('#crc-file-comp');
    if (inp) inp.value = '';
  }
}

function mostrarPrevisualizacionComplemento(cambios, totalArchivo, sinUsar, cols) {
  const est = container_.querySelector('#crc-estado');
  const titulares = cambios.filter(c => c.detalles.includes('titular')).length;
  const suplentes = cambios.reduce((s, c) => s + c.detalles.filter(d => d !== 'titular').length, 0);
  const campos = ['nombre','direccion','ds','medidor'].filter(k => cols[k]);

  if (!cambios.length) {
    est.innerHTML = `
      <div style="background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.3);border-radius:10px;padding:14px;font-size:12px;color:#fbbf24">
        El archivo tiene ${totalArchivo} registros, pero ninguno coincide con las órdenes cargadas (o ya estaban completas).
      </div>`;
    return;
  }

  est.innerHTML = `
    <div style="background:var(--glass);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:12px">
      <div style="font-size:15px;font-weight:800;margin-bottom:10px">${cambios.length} órdenes se completarán</div>
      <div class="flex-col gap-4" style="font-size:12px">
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">Titulares a completar</span><span style="font-weight:700;color:#38bdf8">${titulares}</span></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">Suplentes a completar</span><span style="font-weight:700;color:${suplentes?'#a78bfa':'var(--text-4)'}">${suplentes}</span></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">Registros del archivo sin usar</span><span style="font-weight:700;color:var(--text-4)">${sinUsar}</span></div>
      </div>
      <div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:10px;color:var(--text-4)">
        Campos que trae el archivo: ${campos.join(', ')}
      </div>
    </div>
    <button class="btn-primary full" id="crc-comp-confirmar"><span id="crc-comp-lbl">Aplicar a ${cambios.length} órdenes</span></button>`;

  container_.querySelector('#crc-comp-confirmar').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    container_.querySelector('#crc-comp-lbl').textContent = 'Aplicando…';
    try {
      let batch = db.batch();
      let count = 0;
      const commits = [];
      for (const c of cambios) {
        batch.update(db.collection('caracterizacion_ordenes').doc(c.id), c.patch);
        if (++count === 499) { commits.push(batch.commit()); batch = db.batch(); count = 0; }
      }
      if (count > 0) commits.push(batch.commit());
      await Promise.all(commits);

      est.innerHTML = '';
      toast(`${cambios.length} órdenes completadas`, 'ok');
      await cargarOrdenes();
    } catch (err) {
      btn.disabled = false;
      container_.querySelector('#crc-comp-lbl').textContent = 'Reintentar';
      toast('Error al aplicar: ' + err.message, 'error');
    }
  };
}

// ══════════════════════════════════════════════════════════════
//  RETIROS — fase paralela a la instalación
//  Se sube un Excel (NC, NOMBRE, DIRECCIÓN, DS, MEDIDOR, LAT, LNG).
//  Lo que falte se completa con el padrón por NC. Sin cascada:
//  cada punto se marca "Retirado" o "No se pudo retirar" (con motivo).
//  Colección: caracterizacion_retiros.
// ══════════════════════════════════════════════════════════════

const ALIAS_RETIRO = {
  nc:        ['nc','contrato','id','idsorteado','nic','numerocliente'],
  nombre:    ['nombre','nombredepila','nombrecliente','titular','cliente'],
  direccion: ['direccion','dir','domicilio'],
  ds:        ['ds','ubicaciontecnica','ubicacion'],
  medidor:   ['medidor','aparato','nromedidor'],
  lat:       ['latitud','lat','y'],
  lng:       ['longitud','long','lng','lon','x'],
};

function mapearColumnasRetiro(rows) {
  const claves = Object.keys(rows[0] || {});
  const enc = {};
  for (const campo of Object.keys(ALIAS_RETIRO)) {
    for (const k of claves) {
      if (ALIAS_RETIRO[campo].includes(normHeader(k))) { enc[campo] = k; break; }
    }
  }
  return enc;
}

function numeroONull(v) {
  if (v == null) return null;
  // Si ya es número, usarlo directo
  if (typeof v === 'number') return Number.isFinite(v) ? v : null;
  let s = String(v).trim();
  if (!s) return null;
  // Aceptar coordenadas con coma decimal (13,64) además de punto (13.64).
  // Si hay coma y punto (formato 1.234,56), el punto es de miles: se quita.
  if (s.includes(',') && s.includes('.')) {
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (s.includes(',')) {
    s = s.replace(',', '.');
  }
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
}

async function manejarArchivoRetiro(file) {
  if (!file) return;
  const est = container_.querySelector('#crc-estado');
  est.innerHTML = `<div style="text-align:center;padding:20px"><div class="spinner" style="margin:0 auto 8px"></div><div style="font-size:12px;color:var(--text-4)">Leyendo el archivo de retiros…</div></div>`;

  try {
    await cargarPadron().catch(()=>{});
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    if (!rows.length) throw new Error('El archivo está vacío.');

    const cols = mapearColumnasRetiro(rows);
    if (!cols.nc) throw new Error('No encontré la columna del NC.');

    const nuevos = [];
    const sinCoord = [];
    for (const r of rows) {
      const nc = String(r[cols.nc] ?? '').trim();
      if (!nc) continue;

      // Datos del archivo, con respaldo al padrón para lo que falte
      const base = padron_ && padron_[nc] ? padron_[nc] : {};
      const nombre    = String(r[cols.nombre]    ?? '').trim() || base.nombre    || '';
      const direccion = String(r[cols.direccion] ?? '').trim() || base.direccion || '';
      const ds        = String(r[cols.ds]        ?? '').trim() || base.ds        || '';
      const medidor   = String(r[cols.medidor]   ?? '').trim() || base.medidor   || '';
      let lat = cols.lat ? numeroONull(r[cols.lat]) : null;
      let lng = cols.lng ? numeroONull(r[cols.lng]) : null;
      if (lat == null || lng == null) {
        if (base.lat != null && base.lng != null) { lat = base.lat; lng = base.lng; }
      }
      if (lat == null || lng == null) sinCoord.push(nc);

      nuevos.push({
        nc, nombre, direccion, ds, medidor, lat, lng,
        estado: 'pendiente',   // pendiente | retirado | no_retirado
        pareja: null,
        motivo: '',
      });
    }

    if (!nuevos.length) throw new Error('No se encontraron filas con NC válido.');
    previsualizarRetiros(nuevos, sinCoord);
  } catch (err) {
    est.innerHTML = `<div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:14px;font-size:12px;color:#f87171">${err.message}</div>`;
  } finally {
    const inp = container_.querySelector('#crc-file-retiro');
    if (inp) inp.value = '';
  }
}

function previsualizarRetiros(nuevos, sinCoord) {
  const est = container_.querySelector('#crc-estado');
  const existentesNC = new Set(retiros_.map(r => r.nc));
  const aCrear = nuevos.filter(n => !existentesNC.has(n.nc));
  const yaExisten = nuevos.length - aCrear.length;

  est.innerHTML = `
    <div style="background:var(--glass);border:1px solid var(--border);border-radius:16px;padding:16px;margin-bottom:12px">
      <div style="font-size:15px;font-weight:800;margin-bottom:10px">${aCrear.length} retiros a cargar</div>
      <div class="flex-col gap-4" style="font-size:12px">
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">Nuevos</span><span style="font-weight:700;color:#f59e0b">${aCrear.length}</span></div>
        ${yaExisten ? `<div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">Ya estaban cargados</span><span style="font-weight:700;color:var(--text-4)">${yaExisten}</span></div>` : ''}
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">Sin coordenadas</span><span style="font-weight:700;color:${sinCoord.length?'#fbbf24':'var(--text-4)'}">${sinCoord.length}</span></div>
      </div>
      ${sinCoord.length ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:10px;color:var(--text-4)">Los que no tienen coordenadas (ni en el archivo ni en el padrón) no aparecerán en el mapa, pero sí en la lista.</div>` : ''}
    </div>
    ${aCrear.length ? `<button class="btn-primary full" id="crc-ret-confirmar" style="border-color:rgba(245,158,11,.4);color:#f59e0b;background:rgba(245,158,11,.1)"><span id="crc-ret-lbl">Cargar ${aCrear.length} retiros</span></button>` : ''}`;

  const btn = est.querySelector('#crc-ret-confirmar');
  if (btn) btn.onclick = async () => {
    btn.disabled = true;
    est.querySelector('#crc-ret-lbl').textContent = 'Guardando…';
    try {
      let batch = db.batch(), count = 0; const commits = [];
      for (const r of aCrear) {
        const ref = db.collection('caracterizacion_retiros').doc();
        batch.set(ref, { ...r, cargadoEn: firebase.firestore.Timestamp.now() });
        if (++count === 499) { commits.push(batch.commit()); batch = db.batch(); count = 0; }
      }
      if (count > 0) commits.push(batch.commit());
      await Promise.all(commits);
      est.innerHTML = '';
      toast(`${aCrear.length} retiros cargados`, 'ok');
      await cargarRetiros();
    } catch (err) {
      btn.disabled = false;
      est.querySelector('#crc-ret-lbl').textContent = 'Reintentar';
      toast('Error al guardar: ' + err.message, 'error');
    }
  };
}

function renderResumenRetiros() { render(); }
function renderListaRetiros() { render(); }

function descargarExcelRetiros() {
  try {
    if (!retiros_.length) { toast('No hay retiros para exportar', 'warn'); return; }
    const ESTADO_RET = { pendiente:'Por retirar', retirado:'Retirado', no_retirado:'No se pudo' };
    const filas = retiros_.map(r => ({
      'NC': r.nc || '',
      'Nombre': r.nombre || '',
      'Dirección': r.direccion || '',
      'DS': r.ds || '',
      'Medidor': r.medidor || '',
      'Pareja': r.pareja || 'Sin asignar',
      'Estado': ESTADO_RET[r.estado] || 'Por retirar',
      'Motivo': r.motivo || '',
      'Hecho por': r.hechoPor || '',
      'Fecha': r.fechaHecho ? fmtFechaHora(r.fechaHecho) : '',
      'Revisado': r.confirmado ? 'Sí' : 'No',
      'Revisado por': r.confirmadoPor || '',
    }));
    const headers = Object.keys(filas[0]);
    const ws = XLSX.utils.json_to_sheet(filas, { header: headers });
    ws['!cols'] = headers.map(h => ({ wch: Math.max(12, Math.min(34, h.length + 4)) }));
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Retiros');
    const hoy = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Retiros_${hoy}.xlsx`);
    toast('Excel de retiros descargado', 'ok');
  } catch (err) {
    toast('Error al generar el Excel: ' + err.message, 'error');
  }
}
