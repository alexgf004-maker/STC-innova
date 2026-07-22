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
let padron_    = null;   // { NC: {nc,nombre,direccion,ds,medidor,lat,lng,sup1?,sup2?} }
let ordenes_   = [];

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

    ordenes.push({
      ncTitular: ncTit,
      titular,
      suplente1: (sup1 && sup1.encontrado) ? sup1 : null,
      suplente2: (sup2 && sup2.encontrado) ? sup2 : null,
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

// ── Guardar las órdenes del día en Firestore (sin duplicar por NC titular) ──
async function guardarOrdenes(ordenes) {
  const existSnap = await db.collection('caracterizacion_ordenes').get();
  const existentes = new Set();
  existSnap.docs.forEach(d => {
    const nc = String(d.data().ncTitular ?? '').trim();
    if (nc) existentes.add(nc);
  });

  const nuevas = ordenes.filter(o => !existentes.has(o.ncTitular));
  const omitidas = ordenes.length - nuevas.length;

  let batch = db.batch();
  let count = 0;
  const commits = [];
  for (const o of nuevas) {
    const ref = db.collection('caracterizacion_ordenes').doc();
    batch.set(ref, { ...o, importadaEn: firebase.firestore.Timestamp.now() });
    if (++count === 499) { commits.push(batch.commit()); batch = db.batch(); count = 0; }
  }
  if (count > 0) commits.push(batch.commit());
  await Promise.all(commits);

  return { creadas: nuevas.length, omitidas };
}

// ── Vista mínima (solo la carga del día por ahora) ──
export async function init(container, session) {
  container_ = container;
  session_ = session;
  container.scrollTop = 0;
  container.innerHTML = `
    <div style="padding:16px 16px 32px;max-width:560px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px">
        <div>
          <div class="section-title">Caracterización de la Carga</div>
          <div style="font-size:12px;color:var(--text-4);margin-top:2px">Órdenes del día</div>
        </div>
        <div style="display:flex;gap:8px">
          <button class="icon-btn" id="crc-mapa" title="Mapa y asignación de zonas">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polygon points="1 6 1 22 8 18 16 22 23 18 23 2 16 6 8 2 1 6"/><line x1="8" y1="2" x2="8" y2="18"/><line x1="16" y1="6" x2="16" y2="22"/></svg>
          </button>
          <button class="icon-btn" id="crc-cargar" title="Cargar órdenes del día">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
          </button>
        </div>
        <input type="file" id="crc-file" accept=".xlsx,.xls" style="display:none"/>
      </div>
      <div id="crc-resumen"></div>
      <div id="crc-lista"></div>
      <div id="crc-estado"></div>
    </div>`;

  const fileInput = container.querySelector('#crc-file');
  container.querySelector('#crc-cargar').onclick = () => fileInput.click();
  container.querySelector('#crc-mapa').onclick = () => window.__router.navigateTo('caracterizacion_mapa');
  fileInput.onchange = (e) => manejarArchivo(e.target.files[0]);

  cargarPadron().catch(()=>{});   // precargar en segundo plano
  await cargarOrdenes();
}

// ── Cargar y renderizar las órdenes del día ──
async function cargarOrdenes() {
  const lista = container_.querySelector('#crc-lista');
  const resumen = container_.querySelector('#crc-resumen');
  if (lista) lista.innerHTML = `<div style="text-align:center;padding:24px"><div class="spinner" style="margin:0 auto 8px"></div><div style="font-size:12px;color:var(--text-4)">Cargando órdenes…</div></div>`;
  try {
    const snap = await db.collection('caracterizacion_ordenes').get();
    ordenes_ = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    renderResumen();
    renderLista();
  } catch (err) {
    if (lista) lista.innerHTML = `<div style="color:#ef4444;font-size:12px;padding:16px">Error cargando órdenes: ${err.message}</div>`;
  }
}

function renderResumen() {
  const el = container_.querySelector('#crc-resumen');
  if (!el) return;
  const total = ordenes_.length;
  if (!total) { el.innerHTML = ''; return; }
  const hechas    = ordenes_.filter(o => o.estado === 'hecha').length;
  const noHechas  = ordenes_.filter(o => o.estado === 'no_hecha').length;
  const pend      = total - hechas - noHechas;
  const pct = total ? Math.round((hechas / total) * 100) : 0;
  el.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:14px;padding:16px;margin-bottom:16px">
      <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
        <div style="font-size:13px;font-weight:700">Avance del día</div>
        <div style="font-size:12px;color:var(--text-4)">${hechas} de ${total} · ${pct}%</div>
      </div>
      <div style="height:8px;border-radius:4px;background:var(--glass);overflow:hidden;margin-bottom:12px">
        <div style="height:100%;width:${pct}%;background:#a78bfa;border-radius:4px"></div>
      </div>
      <div style="display:flex;gap:8px">
        <div style="flex:1;text-align:center"><div style="font-size:18px;font-weight:800;color:#fbbf24">${pend}</div><div style="font-size:10px;color:var(--text-4)">Pendientes</div></div>
        <div style="flex:1;text-align:center"><div style="font-size:18px;font-weight:800;color:#22c55e">${hechas}</div><div style="font-size:10px;color:var(--text-4)">Hechas</div></div>
        <div style="flex:1;text-align:center"><div style="font-size:18px;font-weight:800;color:#ef4444">${noHechas}</div><div style="font-size:10px;color:var(--text-4)">No hechas</div></div>
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

  const pend = ordenes_.filter(o => o.estado !== 'hecha' && o.estado !== 'no_hecha');
  const hechas = ordenes_.filter(o => o.estado === 'hecha');
  const noHechas = ordenes_.filter(o => o.estado === 'no_hecha');

  const seccion = (titulo, arr, color) => arr.length ? `
    <div style="margin-bottom:6px;margin-top:14px;display:flex;align-items:center;gap:8px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:${color}">${titulo}</div>
      <div style="flex:1;height:1px;background:var(--border)"></div>
      <div style="font-size:11px;color:var(--text-4)">${arr.length}</div>
    </div>
    <div class="flex-col gap-8">${arr.map(tarjetaOrden).join('')}</div>` : '';

  el.innerHTML = seccion('Pendientes', pend, '#fbbf24')
               + seccion('Hechas', hechas, '#22c55e')
               + seccion('No hechas', noHechas, '#ef4444');
}

function tarjetaOrden(o) {
  const t = o.titular || {};
  const puntos = [
    o.titular   ? 'Titular' : null,
    o.suplente1 ? 'Sup 1' : null,
    o.suplente2 ? 'Sup 2' : null,
  ].filter(Boolean);
  const hecha = o.estado === 'hecha';
  const noHecha = o.estado === 'no_hecha';
  const acento = hecha ? '#22c55e' : noHecha ? '#ef4444' : '#a78bfa';

  return `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-left:3px solid ${acento};border-radius:12px;padding:13px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
        <div style="flex:1;min-width:0">
          <div style="font-size:13px;font-weight:700;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${t.nombre || o.ncTitular || '—'}</div>
          <div style="font-size:10px;color:var(--text-4);margin-top:1px">NC ${o.ncTitular}${t.direccion ? ' · ' + t.direccion.split(',')[0] : ''}</div>
        </div>
        ${hecha ? `<div style="font-size:10px;font-weight:700;color:#22c55e;background:rgba(34,197,94,.12);border:1px solid rgba(34,197,94,.3);padding:3px 9px;border-radius:12px;white-space:nowrap">${LOGRO_LABEL[o.logranoEn] || 'Hecha'}</div>`
          : noHecha ? `<div style="font-size:10px;font-weight:700;color:#ef4444;background:rgba(239,68,68,.1);border:1px solid rgba(239,68,68,.3);padding:3px 9px;border-radius:12px">No hecha</div>`
          : `<div style="font-size:10px;color:var(--text-4);background:var(--glass);border:1px solid var(--border);padding:3px 9px;border-radius:12px">${puntos.length} punto${puntos.length>1?'s':''}</div>`}
      </div>
      ${(hecha && o.pareja) ? `<div style="font-size:10px;color:var(--text-4);margin-top:7px">Realizada por ${o.pareja}</div>` : ''}
    </div>`;
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
  const sinCoordTit = ordenes.filter(o => !o.titular.tieneCoord).length;

  est.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px">
      <div style="font-size:15px;font-weight:800;margin-bottom:10px">${ordenes.length} órdenes listas para cargar</div>
      <div class="flex-col gap-4" style="font-size:12px">
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">Con titular + 2 suplentes</span><span style="font-weight:700;color:#22c55e">${conTres}</span></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">Titulares sin ubicación</span><span style="font-weight:700;color:${sinCoordTit?'#fbbf24':'var(--text-4)'}">${sinCoordTit}</span></div>
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
      const { creadas, omitidas } = await guardarOrdenes(ordenes);
      toast(`${creadas} órdenes cargadas${omitidas ? ` · ${omitidas} ya existían` : ''}`, 'ok');
      est.innerHTML = '';
      await cargarOrdenes();
    } catch (err) {
      btn.disabled = false;
      container_.querySelector('#crc-confirmar-lbl').textContent = 'Reintentar';
      toast('Error al guardar: ' + err.message, 'error');
    }
  };
}
