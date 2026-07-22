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

  return { ordenes, avisos };
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
    <div style="padding:20px 16px;max-width:520px;margin:0 auto">
      <div style="margin-bottom:16px">
        <div class="section-title">Caracterización de la Carga</div>
        <div style="font-size:12px;color:var(--text-4);margin-top:2px">Carga del día · cruce automático de suplentes</div>
      </div>
      <button class="btn-primary full" id="crc-cargar">Cargar órdenes del día (Excel de DELSUR)</button>
      <input type="file" id="crc-file" accept=".xlsx,.xls" style="display:none"/>
      <div id="crc-estado" style="margin-top:16px"></div>
    </div>`;

  const fileInput = container.querySelector('#crc-file');
  container.querySelector('#crc-cargar').onclick = () => fileInput.click();
  fileInput.onchange = (e) => manejarArchivo(e.target.files[0]);

  // Precargar el padrón en segundo plano
  cargarPadron().catch(err => {
    const est = container.querySelector('#crc-estado');
    if (est) est.innerHTML = `<div style="color:#ef4444;font-size:12px">No se pudo cargar el padrón base: ${err.message}</div>`;
  });
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

    const { ordenes, avisos } = construirOrdenesDesdeExcel(rows);
    mostrarPrevisualizacion(ordenes, avisos);
  } catch (err) {
    est.innerHTML = `<div style="color:#ef4444;font-size:12px">Error: ${err.message}</div>`;
  }
}

function mostrarPrevisualizacion(ordenes, avisos) {
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
      est.innerHTML = `<div style="text-align:center;padding:20px;color:#22c55e;font-size:13px;font-weight:700">${creadas} órdenes del día cargadas</div>`;
    } catch (err) {
      btn.disabled = false;
      container_.querySelector('#crc-confirmar-lbl').textContent = 'Reintentar';
      toast('Error al guardar: ' + err.message, 'error');
    }
  };
}
