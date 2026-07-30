/**
 * js/views/caracterizacion.js
 * Área de Caracterización de la Carga.
 *
 * Cada orden = 3 puntos en cascada: Titular + Suplente 1 + Suplente 2.
 * El técnico intenta en orden; al cerrar se registra cuál de los tres logró.
 *
 * Datos:
 *  - Padrón base fijo: /STC-innova/caracterizacion_padron.json (indexado por NC)
 *  - Órdenes del día: colección Firestore 'caracterizacion_ordenes'
 *
 * Este archivo arranca con la CARGA DEL DÍA (importador que cruza
 * titular -> suplentes usando el padrón). La vista de órdenes y el mapa
 * se agregan en pasos siguientes.
 */

import { db } from '../firebase.js';
import { toast } from '../ui.js';

const PADRON_URL = '/STC-innova/caracterizacion_padron.json';

let session_   = null;
let container_ = null;
let esAdmin_   = false;
let padron_    = null;   // { NC: {nc,nombre,direccion,ds,medidor,lat,lng,sup1?,sup2?} }
let ordenes_   = [];
let retiros_   = [];     // puntos de retiro (colección caracterizacion_retiros)
let pestana_   = 'instalacion';   // 'instalacion' | 'retiro'

// ── Carga del padrón (una vez, cacheado en memoria) ──
async function cargarPadron() {
  if (padron_) return padron_;
  const res = await fetch(PADRON_URL, { cache: 'force-cache' });
  if (!res.ok) throw new Error('No se pudo leer el padrón base.');
  padron_ = await res.json();
  return padron_;
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
  container.scrollTop = 0;
  container.innerHTML = `
    <div style="padding:4px 16px 32px;max-width:1100px;margin:0 auto">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:12px;margin-bottom:16px">
        <div style="flex:1;min-width:0">
          <div style="font-size:20px;font-weight:800;letter-spacing:-.01em;line-height:1.15">Caracterización de la Carga</div>
          <div style="font-size:12px;color:var(--text-4);margin-top:3px">${esAdmin_ ? 'Órdenes del día' : 'Tus órdenes del día'}</div>
        </div>
        ${esAdmin_ ? `
        <div style="display:flex;gap:8px;flex-shrink:0">
          <button class="icon-btn" id="crc-excel" title="Descargar Excel de trazabilidad">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <button class="icon-btn" id="crc-mapa" title="Mapa y asignación de zonas">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
          </button>
          <button class="icon-btn" id="crc-complemento" title="Completar datos desde BDTH">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M20 6H10M20 12H10M20 18H10"/><path d="M4 7l2 2 3-3"/><path d="M4 13l2 2 3-3"/><path d="M4 19l2 2 3-3"/></svg>
          </button>
          <button class="icon-btn" id="crc-cargar" title="Cargar órdenes del día">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </button>
          <button class="icon-btn" id="crc-cargar-retiro" title="Subir retiros" style="color:#f59e0b;border-color:rgba(245,158,11,.35);background:rgba(245,158,11,.1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M22 12v5a2 2 0 01-2 2H4a2 2 0 01-2-2v-5"/><polyline points="8 8 12 4 16 8"/><line x1="12" y1="4" x2="12" y2="16"/></svg>
          </button>
        </div>
        <input type="file" id="crc-file" accept=".xlsx,.xls" style="display:none"/>
        <input type="file" id="crc-file-comp" accept=".xlsx,.xls" style="display:none"/>
        <input type="file" id="crc-file-retiro" accept=".xlsx,.xls" style="display:none"/>` : `
        <button class="icon-btn" id="crc-mapa-tec" title="Ver mapa" style="flex-shrink:0">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
        </button>`}
      </div>

      <!-- Pestañas Instalación / Retiro -->
      <div class="area-tabs" style="margin-bottom:14px">
        <button class="area-tab crc-tab" data-tab="instalacion">Instalación</button>
        <button class="area-tab crc-tab" data-tab="retiro">Retiro</button>
      </div>

      <div id="crc-resumen"></div>
      <div id="crc-lista"></div>
      <div id="crc-estado"></div>
    </div>`;

  // Pestañas
  const tabs = container.querySelectorAll('.crc-tab');
  tabs.forEach(t => t.onclick = () => setPestana(t.dataset.tab));

  if (esAdmin_) {
    const fileInput = container.querySelector('#crc-file');
    container.querySelector('#crc-cargar').onclick = () => fileInput.click();
    container.querySelector('#crc-mapa').onclick = () => window.__router.navigateTo('caracterizacion_mapa');
    container.querySelector('#crc-excel').onclick = () => pestana_ === 'retiro' ? descargarExcelRetiros() : abrirDescargaExcel();
    const fileComp = container.querySelector('#crc-file-comp');
    container.querySelector('#crc-complemento').onclick = () => fileComp.click();
    fileComp.onchange = (e) => manejarComplemento(e.target.files[0]);
    fileInput.onchange = (e) => manejarArchivo(e.target.files[0]);
    const fileRet = container.querySelector('#crc-file-retiro');
    container.querySelector('#crc-cargar-retiro').onclick = () => fileRet.click();
    fileRet.onchange = (e) => manejarArchivoRetiro(e.target.files[0]);
    cargarPadron().catch(()=>{});
  } else {
    container.querySelector('#crc-mapa-tec').onclick = () => window.__router.navigateTo('caracterizacion_mapa');
  }

  setPestana(pestana_);
}

// ── Cargar y renderizar las órdenes del día ──
async function cargarOrdenes() {
  const lista = container_.querySelector('#crc-lista');
  if (lista) lista.innerHTML = `<div style="text-align:center;padding:24px"><div class="spinner" style="margin:0 auto 8px"></div><div style="font-size:12px;color:var(--text-4)">Cargando órdenes…</div></div>`;
  try {
    const snap = await db.collection('caracterizacion_ordenes').get();
    let todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // El técnico ve SOLO las órdenes de su pareja
    if (!esAdmin_) {
      const miPareja = session_.asignacionActual?.destino || null;
      todas = miPareja ? todas.filter(o => o.pareja === miPareja) : [];
    }
    ordenes_ = todas;
    if (pestana_ === 'instalacion') { renderResumen(); renderLista(); }
  } catch (err) {
    if (lista) lista.innerHTML = `<div style="color:#ef4444;font-size:12px;padding:16px">Error cargando órdenes: ${err.message}</div>`;
  }
}

async function cargarRetiros() {
  const lista = container_.querySelector('#crc-lista');
  if (lista && pestana_ === 'retiro') lista.innerHTML = `<div style="text-align:center;padding:24px"><div class="spinner" style="margin:0 auto 8px"></div><div style="font-size:12px;color:var(--text-4)">Cargando retiros…</div></div>`;
  try {
    const snap = await db.collection('caracterizacion_retiros').get();
    let todos = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    if (!esAdmin_) {
      const miPareja = session_.asignacionActual?.destino || null;
      todos = miPareja ? todos.filter(r => r.pareja === miPareja) : [];
    }
    retiros_ = todos;
    if (pestana_ === 'retiro') { renderResumenRetiros(); renderListaRetiros(); }
  } catch (err) {
    if (lista && pestana_ === 'retiro') lista.innerHTML = `<div style="color:#ef4444;font-size:12px;padding:16px">Error cargando retiros: ${err.message}</div>`;
  }
}

function setPestana(tab) {
  pestana_ = tab;
  // Resaltar la pestaña activa con la clase estándar (color del área)
  container_.querySelectorAll('.crc-tab').forEach(t => {
    t.classList.toggle('active', t.dataset.tab === tab);
    t.classList.toggle('cr', t.dataset.tab === tab);
  });
  // Limpiar y cargar la pestaña elegida
  container_.querySelector('#crc-resumen').innerHTML = '';
  container_.querySelector('#crc-lista').innerHTML = '';
  container_.querySelector('#crc-estado').innerHTML = '';
  if (tab === 'retiro') cargarRetiros();
  else cargarOrdenes();
}


function renderResumen() {
  const el = container_.querySelector('#crc-resumen');
  if (!el) return;
  const total = ordenes_.length;
  if (!total) { el.innerHTML = ''; return; }
  const porConfirmar = ordenes_.filter(o => o.estado === 'por_confirmar').length;
  const confirmadas  = ordenes_.filter(o => o.estado === 'confirmada').length;
  const listas = porConfirmar + confirmadas;
  const pend = total - listas;
  const pct = total ? Math.round((listas / total) * 100) : 0;
  const totalVisitas = ordenes_.reduce((s, o) => s + (Array.isArray(o.visitas) ? o.visitas.length : 0), 0);

  el.innerHTML = `
    ${esAdmin_ ? panelParejas() : ''}
    <div class="progress-card" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
        <div style="font-size:13px;font-weight:700">${esAdmin_ ? 'Avance del día' : 'Tu avance del día'}</div>
        <div style="font-size:12px;color:var(--text-4)">${listas} de ${total} · ${pct}%</div>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill cr" style="width:${pct}%"></div>
      </div>
      <div class="progress-stats" style="margin-top:10px">
        <span><span class="stat-dot muted"></span>${pend} por hacer</span>
        <span><span class="stat-dot warn" style="background:#fbbf24"></span>${porConfirmar} falta revisar</span>
        <span><span class="stat-dot ok"></span>${confirmadas} listas</span>
        ${totalVisitas ? `<span><span class="stat-dot" style="background:#fbbf24"></span>${totalVisitas} visitas cobrables</span>` : ''}
      </div>
    </div>`;
}

// Panel por pareja: ejecutadas (marcadas hechas, aunque falte confirmar),
// visitas, y avance contra la meta diaria.
const META_PAREJA = 7;
const PAREJA_COLOR = { 'Pareja 1':'#2dd4bf', 'Pareja 2':'#fbbf24', 'Pareja 3':'#a78bfa' };

function panelParejas() {
  // Agrupar por pareja. "Ejecutada" = el técnico la marcó hecha (logró un punto),
  // esté por_confirmar o confirmada. La META es DIARIA: solo cuenta las
  // ejecutadas HOY (por fechaHecha), igual que en Cambio de Medidores.
  const hoy = claveDia(firebase.firestore.Timestamp.now());
  const parejas = {};
  for (const o of ordenes_) {
    const p = o.pareja;
    if (!p) continue;
    if (!parejas[p]) parejas[p] = { ejecutadas: 0, visitas: 0, asignadas: 0 };
    parejas[p].asignadas++;
    const ejecutada = (o.estado === 'por_confirmar' || o.estado === 'confirmada')
      && o.logranoEn
      && o.fechaHecha && claveDia(o.fechaHecha) === hoy;
    if (ejecutada) parejas[p].ejecutadas++;
    parejas[p].visitas += Array.isArray(o.visitas) ? o.visitas.length : 0;
  }
  const nombres = Object.keys(parejas).sort();
  if (!nombres.length) return '';

  return `
    <div style="margin-bottom:16px">
      <div class="section-label" style="margin-bottom:8px">Avance por pareja · meta diaria ${META_PAREJA}</div>
      <div style="display:grid;grid-template-columns:repeat(${Math.min(nombres.length,3)},1fr);gap:10px">
        ${nombres.map(nombre => {
          const d = parejas[nombre];
          const color = PAREJA_COLOR[nombre] || '#94a3b8';
          const pct = Math.min(100, Math.round((d.ejecutadas / META_PAREJA) * 100));
          const cumplida = d.ejecutadas >= META_PAREJA;
          const acc = cumplida ? '#22c55e' : color;
          return `
            <div class="pareja-card" style="border-color:${cumplida?'rgba(34,197,94,.4)':'var(--border)'};background:var(--bg-card)">
              <div class="pareja-card-header">
                <div class="pareja-name" style="color:${acc};display:flex;align-items:center;gap:7px">
                  <span style="width:9px;height:9px;border-radius:50%;background:${color};display:inline-block"></span>${nombre}
                </div>
                <div style="display:flex;align-items:baseline;gap:4px">
                  <div style="font-size:24px;font-weight:900;color:${acc};line-height:1">${d.ejecutadas}</div>
                  <div style="font-size:10px;color:var(--text-4);font-weight:600">/ ${META_PAREJA} hoy</div>
                </div>
              </div>
              <div class="progress-bar-bg" style="margin:8px 0">
                <div class="progress-bar-fill" style="width:${pct}%;background:${acc}"></div>
              </div>
              <div class="pareja-stats">
                <span>${d.asignadas} asignadas</span>
                ${d.visitas ? `<span style="color:#fbbf24">· ${d.visitas} visita${d.visitas!==1?'s':''}</span>` : ''}
                ${cumplida ? `<span style="color:#22c55e;font-weight:700">· META &#10003;</span>` : ''}
              </div>
            </div>`;
        }).join('')}
      </div>
    </div>`;
}

const LOGRO_LABEL = { titular:'Titular', suplente1:'Suplente 1', suplente2:'Suplente 2' };

function renderLista() {
  const el = container_.querySelector('#crc-lista');
  if (!el) return;
  if (!ordenes_.length) {
    el.innerHTML = `<div style="text-align:center;padding:32px 16px;color:var(--text-4);font-size:13px">No hay órdenes cargadas.<br>Usa el botón de arriba para cargar el Excel del día.</div>`;
    return;
  }

  const porConfirmar = ordenes_.filter(o => o.estado === 'por_confirmar');
  const pend = ordenes_.filter(o => !o.estado || o.estado === 'pendiente');
  const confirmadas = ordenes_.filter(o => o.estado === 'confirmada');

  const seccion = (titulo, arr, color) => arr.length ? `
    <div style="margin-bottom:6px;margin-top:14px;display:flex;align-items:center;gap:8px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:${color}">${titulo}</div>
      <div style="flex:1;height:1px;background:var(--border)"></div>
      <div style="font-size:11px;color:var(--text-4)">${arr.length}</div>
    </div>
    <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(300px,1fr));gap:10px">${arr.map(tarjetaOrden).join('')}</div>` : '';

  el.innerHTML = seccion('Hecha, falta revisar', porConfirmar, '#fbbf24')
               + seccion('Por hacer', pend, '#94a3b8')
               + seccion('Lista', confirmadas, '#22c55e');

  // Enganchar botones de confirmar
  el.querySelectorAll('[data-confirmar]').forEach(btn => {
    btn.onclick = () => confirmarDesdeLista(btn.dataset.confirmar);
  });
}

function tarjetaOrden(o) {
  const t = o.titular || {};
  const puntos = [o.titular ? 1 : 0, o.suplente1 ? 1 : 0, o.suplente2 ? 1 : 0].reduce((a,b)=>a+b,0);
  const porConfirmar = o.estado === 'por_confirmar';
  const confirmada = o.estado === 'confirmada';
  const visitas = Array.isArray(o.visitas) ? o.visitas : [];

  const dotClase = confirmada ? 'ok' : porConfirmar ? 'warn' : 'muted';
  const dotStyle = porConfirmar ? 'style="background:#fbbf24"' : o.esUPR && !confirmada && !porConfirmar ? 'style="background:#38bdf8"' : '';

  const badge = confirmada
    ? `<div class="estado-badge ok">${o.logranoEn ? LOGRO_LABEL[o.logranoEn] : 'Sin lograr'}</div>`
    : porConfirmar
    ? `<div class="estado-badge warn">Falta revisar</div>`
    : `<div class="estado-badge muted">${puntos} punto${puntos>1?'s':''}</div>`;

  const badgeUPR = o.esUPR
    ? `<div class="pareja-chip" style="color:#38bdf8;border-color:rgba(56,189,248,.4);background:rgba(56,189,248,.14)">UPR</div>`
    : '';

  const detalle = (porConfirmar || confirmada) ? `
    <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:8px;font-size:10px;color:var(--text-4)">
      ${o.logranoEn ? `<span>Hecha en <span style="color:#22c55e;font-weight:700">${LOGRO_LABEL[o.logranoEn]}</span></span>` : `<span style="color:#ef4444">Sin lograr</span>`}
      ${visitas.length ? `<span>· <span style="color:#fbbf24;font-weight:700">${visitas.length} visita${visitas.length>1?'s':''}</span> (${visitas.map(v=>LOGRO_LABEL[v]).join(', ')})</span>` : ''}
      ${o.pareja ? `<span>· ${o.pareja}</span>` : ''}
    </div>` : '';

  const botonConfirmar = (porConfirmar && esAdmin_)
    ? `<button data-confirmar="${o.id}" class="btn-action" style="margin-top:10px;height:38px;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);color:#22c55e">Marcar como lista</button>`
    : '';

  return `
    <div class="orden-card" style="flex-direction:column;align-items:stretch;cursor:default${o.esUPR?';border-left:3px solid #38bdf8':''}">
      <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
        <div class="orden-card-left" style="align-items:flex-start">
          <div class="status-dot ${dotClase}" ${dotStyle} style="margin-top:4px"></div>
          <div class="orden-info">
            <div class="orden-wo" style="font-weight:700">${t.nombre || o.ncTitular || '—'}</div>
            <div class="orden-dir">NC ${o.ncTitular}${o.tarifa ? ' · ' + o.tarifa : ''}${t.direccion ? ' · ' + t.direccion.split(',')[0] : ''}</div>
          </div>
        </div>
        <div class="orden-card-right" style="flex-direction:column;align-items:flex-end;gap:4px">
          ${badgeUPR}
          ${badge}
        </div>
      </div>
      ${detalle}
      ${botonConfirmar}
    </div>`;
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
    renderResumen(); renderLista();
    toast('Orden marcada como lista', 'ok');
  } catch (err) { toast('Error: ' + err.message, 'error'); }
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
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px">
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
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px">
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
  const n = parseFloat(String(v ?? '').trim());
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
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px">
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

function renderResumenRetiros() {
  const el = container_.querySelector('#crc-resumen');
  if (!el) return;
  const total = retiros_.length;
  if (!total) { el.innerHTML = ''; return; }
  const retirados = retiros_.filter(r => r.estado === 'retirado').length;
  const noPudo = retiros_.filter(r => r.estado === 'no_retirado').length;
  const pend = total - retirados - noPudo;
  const pct = total ? Math.round((retirados / total) * 100) : 0;
  el.innerHTML = `
    <div class="progress-card" style="margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
        <div style="font-size:13px;font-weight:700">${esAdmin_ ? 'Avance de retiros' : 'Tus retiros'}</div>
        <div style="font-size:12px;color:var(--text-4)">${retirados} de ${total} · ${pct}%</div>
      </div>
      <div class="progress-bar-bg">
        <div class="progress-bar-fill" style="width:${pct}%;background:#f59e0b"></div>
      </div>
      <div class="progress-stats" style="margin-top:10px">
        <span><span class="stat-dot" style="background:#f59e0b"></span>${pend} por retirar</span>
        <span><span class="stat-dot ok"></span>${retirados} retirados</span>
        ${noPudo ? `<span><span class="stat-dot" style="background:#ef4444"></span>${noPudo} no se pudo</span>` : ''}
      </div>
    </div>`;
}

function renderListaRetiros() {
  const el = container_.querySelector('#crc-lista');
  if (!el) return;
  if (!retiros_.length) {
    el.innerHTML = `<div style="text-align:center;padding:32px 16px;color:var(--text-4);font-size:13px">${esAdmin_ ? 'No hay retiros cargados. Usa el botón naranja para subir el Excel.' : 'No tienes retiros asignados.'}</div>`;
    return;
  }

  const pend = retiros_.filter(r => r.estado === 'pendiente' || !r.estado);
  const retirados = retiros_.filter(r => r.estado === 'retirado');
  const noPudo = retiros_.filter(r => r.estado === 'no_retirado');

  const tarjeta = (r) => {
    const dotClase = r.estado === 'retirado' ? 'ok' : r.estado === 'no_retirado' ? 'crit' : 'warn';
    const dotStyle = r.estado === 'pendiente' || !r.estado ? 'style="background:#f59e0b"' : r.estado === 'no_retirado' ? 'style="background:#ef4444"' : '';
    const badgeClase = r.estado === 'retirado' ? 'ok' : r.estado === 'no_retirado' ? 'crit' : 'warn';
    const etiqueta = r.estado === 'retirado' ? 'Retirado' : r.estado === 'no_retirado' ? 'No se pudo' : 'Por retirar';
    const color = r.estado === 'retirado' ? '#22c55e' : r.estado === 'no_retirado' ? '#ef4444' : '#f59e0b';
    const meta = (r.estado === 'retirado' || r.estado === 'no_retirado')
      ? `${r.hechoPor ? 'Por ' + r.hechoPor : ''}${r.fechaHecho ? ' · ' + fmtFechaHora(r.fechaHecho) : ''}${r.pareja ? ' · ' + r.pareja : ''}`
      : (r.pareja || '');
    return `
      <div class="orden-card" style="flex-direction:column;align-items:stretch;cursor:default;border-left:3px solid ${color}">
        <div style="display:flex;align-items:flex-start;justify-content:space-between;gap:10px">
          <div class="orden-card-left" style="align-items:flex-start">
            <div class="status-dot ${dotClase}" ${dotStyle} style="margin-top:4px"></div>
            <div class="orden-info">
              <div class="orden-wo" style="font-weight:700">${r.nombre || r.nc}</div>
              <div class="orden-dir">NC ${r.nc}${r.direccion ? ' · ' + r.direccion.split(',')[0] : ''}</div>
            </div>
          </div>
          <div class="orden-card-right">
            <div class="estado-badge ${badgeClase}">${etiqueta}</div>
          </div>
        </div>
        ${r.estado === 'no_retirado' && r.motivo ? `<div style="font-size:11px;color:#f87171;margin-top:8px">Motivo: ${r.motivo}</div>` : ''}
        ${meta ? `<div style="font-size:10px;color:var(--text-4);margin-top:8px">${meta}</div>` : ''}
      </div>`;
  };

  const seccion = (titulo, arr, color) => arr.length ? `
    <div style="display:flex;align-items:center;gap:8px;margin:14px 0 8px">
      <div style="font-size:11px;font-weight:800;letter-spacing:.04em;text-transform:uppercase;color:${color}">${titulo}</div>
      <div style="flex:1;height:1px;background:var(--border)"></div>
      <div style="font-size:11px;color:var(--text-4)">${arr.length}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">${arr.map(tarjeta).join('')}</div>` : '';

  el.innerHTML = seccion('Por retirar', pend, '#f59e0b')
               + seccion('Retirados', retirados, '#22c55e')
               + seccion('No se pudo', noPudo, '#ef4444');
}

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
