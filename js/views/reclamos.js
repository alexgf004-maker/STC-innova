/**
 * js/views/reclamos.js
 * Área "Reclamos SIGET" — bitácora de trazabilidad.
 *
 * El técnico registra las órdenes que realiza (NC, WO, cliente,
 * concepto, detalle, serie); la fecha y el autor se guardan solos.
 * El asistente/admin consultan todo el historial, lo descargan en
 * Excel, y pueden cargar un histórico masivo desde un archivo.
 *
 * Datos: colección Firestore 'reclamos_siget'.
 *  { nc, wo, cliente, concept, detalle, serie,
 *    tecnicoUid, tecnicoNombre, fecha }
 *
 * Roles:
 *  - técnico: registra y ve SOLO sus órdenes.
 *  - admin/asistente: ve todas, con buscador, descarga y carga masiva.
 */

import { db } from '../firebase.js';
import { toast } from '../ui.js';

let container_ = null;
let session_   = null;
let esAdmin_   = false;
let registros_ = [];
let filtro_    = '';
let usuarios_  = [];   // para cruzar técnico del histórico con usuarios reales

// Opciones del desplegable Concept
const CONCEPTOS = ['Comprobación de medidor', 'Inspección', 'Inspección BT', 'Otro'];

export async function init(container, session) {
  container_ = container;
  session_   = session;
  esAdmin_   = (session.role === 'admin' || session.role === 'asistente');
  container.scrollTop = 0;

  container.innerHTML = `
    <div style="padding:16px 16px 32px;max-width:900px;margin:0 auto">
      <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;margin-bottom:16px">
        <div>
          <div class="section-title">Reclamos SIGET</div>
          <div style="font-size:12px;color:var(--text-4);margin-top:2px">Historial de órdenes registradas</div>
        </div>
        <div style="display:flex;gap:8px">
          ${esAdmin_ ? `
          <button class="icon-btn" id="rc-historico" title="Cargar histórico desde Excel" style="color:#fbbf24;border-color:rgba(251,191,36,.35);background:rgba(251,191,36,.1)">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M22 12v5a2 2 0 01-2 2H4a2 2 0 01-2-2v-5"/><polyline points="8 8 12 4 16 8"/><line x1="12" y1="4" x2="12" y2="16"/></svg>
          </button>
          <button class="icon-btn" id="rc-excel" title="Descargar historial en Excel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>
          <input type="file" id="rc-file" accept=".xlsx,.xls" style="display:none"/>` : `
          <button class="icon-btn" id="rc-nueva" title="Registrar orden" style="background:#fbbf24;border-color:#fbbf24;color:#0d1117">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>`}
        </div>
      </div>

      <div style="position:relative;margin-bottom:14px">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-4)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="position:absolute;left:12px;top:50%;transform:translateY(-50%)"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="rc-buscar" type="text" placeholder="Buscar por WO, NC, cliente, censo…" style="width:100%;padding:11px 12px 11px 36px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-2);font-size:13px;font-family:inherit;outline:none"/>
      </div>

      <div id="rc-estado"></div>
      <div id="rc-resumen"></div>
      <div id="rc-lista"></div>

      <!-- Hoja para registrar (técnico) -->
      <div id="rc-sheet" style="position:fixed;left:0;right:0;bottom:0;z-index:1200;transform:translateY(calc(100% + 140px));transition:transform .25s ease;background:#0d1117;border-top:1px solid var(--border);border-radius:20px 20px 0 0;padding:18px 20px calc(var(--navbar-h,72px) + 26px);max-height:85vh;overflow-y:auto"></div>
    </div>`;

  if (esAdmin_) {
    container.querySelector('#rc-excel').onclick = descargarExcel;
    const file = container.querySelector('#rc-file');
    container.querySelector('#rc-historico').onclick = () => file.click();
    file.onchange = (e) => manejarHistorico(e.target.files[0]);
  } else {
    container.querySelector('#rc-nueva').onclick = abrirNueva;
  }
  // El buscador está disponible para todos (el técnico consulta el histórico)
  const buscar = container.querySelector('#rc-buscar');
  buscar.oninput = (e) => { filtro_ = e.target.value.trim().toLowerCase(); renderLista(); };

  await cargar();
}

async function cargar() {
  const lista = container_.querySelector('#rc-lista');
  if (lista) lista.innerHTML = `<div style="text-align:center;padding:24px"><div class="spinner" style="margin:0 auto 8px"></div><div style="font-size:12px;color:var(--text-4)">Cargando…</div></div>`;
  try {
    // Todos ven todo el historial. El técnico solo consulta (no edita);
    // el admin/asistente pueden registrar y descargar.
    const snap = await db.collection('reclamos_siget').get();
    registros_ = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    registros_.sort((a, b) => (msDe(b.fecha) - msDe(a.fecha)));
    renderResumen();
    renderLista();
  } catch (err) {
    if (lista) lista.innerHTML = `<div style="color:#ef4444;font-size:12px;padding:16px">Error cargando: ${err.message}</div>`;
  }
}

function msDe(ts) {
  if (!ts) return 0;
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  return d.getTime();
}

function renderResumen() {
  const el = container_.querySelector('#rc-resumen');
  if (!el) return;
  const total = registros_.length;
  if (!total) { el.innerHTML = ''; return; }
  const ahora = new Date();
  const delMes = registros_.filter(r => {
    const d = r.fecha?.toDate ? r.fecha.toDate() : new Date(r.fecha);
    return d.getMonth() === ahora.getMonth() && d.getFullYear() === ahora.getFullYear();
  }).length;
  el.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:16px">
      <div style="flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px;text-align:center">
        <div style="font-size:22px;font-weight:800;color:#fbbf24">${total}</div>
        <div style="font-size:10px;color:var(--text-4)">Total registradas</div>
      </div>
      <div style="flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px;text-align:center">
        <div style="font-size:22px;font-weight:800;color:#2dd4bf">${delMes}</div>
        <div style="font-size:10px;color:var(--text-4)">Este mes</div>
      </div>
    </div>`;
}

function fmtFecha(ts) {
  if (!ts) return '';
  const d = ts.toDate ? ts.toDate() : new Date(ts);
  const p = n => String(n).padStart(2, '0');
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()}`;
}

function renderLista() {
  const el = container_.querySelector('#rc-lista');
  if (!el) return;
  let arr = registros_;
  if (filtro_) {
    arr = arr.filter(r =>
      String(r.wo || '').toLowerCase().includes(filtro_) ||
      String(r.nc || '').toLowerCase().includes(filtro_) ||
      String(r.cliente || '').toLowerCase().includes(filtro_) ||
      String(r.tecnicoNombre || '').toLowerCase().includes(filtro_) ||
      String(r.concept || '').toLowerCase().includes(filtro_) ||
      String(r.detalle || '').toLowerCase().includes(filtro_) ||
      String(r.censoWo || '').toLowerCase().includes(filtro_)
    );
  }
  if (!arr.length) {
    el.innerHTML = `<div style="text-align:center;padding:32px 16px;color:var(--text-4);font-size:13px">${
      registros_.length ? 'No hay resultados para tu búsqueda.' :
      esAdmin_ ? 'Aún no hay órdenes registradas.' : 'No has registrado órdenes.<br>Usa el botón + para agregar la primera.'
    }</div>`;
    return;
  }
  el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(290px,1fr));gap:10px">${
    arr.map(r => `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-left:3px solid #fbbf24;border-radius:12px;padding:13px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:4px">
          <div style="font-size:14px;font-weight:800;color:#fbbf24">WO ${r.wo || '—'}</div>
          <div style="font-size:10px;color:var(--text-4)">${fmtFecha(r.fecha)}</div>
        </div>
        ${r.cliente ? `<div style="font-size:12px;font-weight:600;color:var(--text-2);margin-bottom:2px">${escapar(r.cliente)}</div>` : ''}
        <div style="font-size:10px;color:var(--text-4);margin-bottom:6px">${r.nc ? 'NC ' + escapar(r.nc) : ''}${r.serie ? ' · Serie ' + escapar(r.serie) : ''}</div>
        ${r.concept ? `<div style="display:inline-block;font-size:10px;font-weight:700;color:#93c5fd;background:rgba(59,130,246,.1);border:1px solid rgba(59,130,246,.25);border-radius:8px;padding:2px 8px;margin-bottom:6px">${escapar(r.concept)}</div>` : ''}
        ${r.censoCarga ? `<div style="display:inline-block;font-size:10px;font-weight:700;color:#34d399;background:rgba(52,211,153,.1);border:1px solid rgba(52,211,153,.3);border-radius:8px;padding:2px 8px;margin-bottom:6px;margin-left:4px">Censo de carga${r.censoWo ? ' · WO ' + escapar(r.censoWo) : ''}</div>` : ''}
        ${r.detalle ? `<div style="font-size:12px;color:var(--text-2);line-height:1.5;margin-bottom:8px;white-space:pre-wrap">${escapar(r.detalle)}</div>` : ''}
        ${esAdmin_ ? `<div style="font-size:10px;color:var(--text-4);display:flex;align-items:center;gap:5px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          ${escapar(r.tecnicoNombre || 'Técnico')}
        </div>` : ''}
      </div>`).join('')
  }</div>`;
}

function escapar(s) {
  return String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
}

// ── Registrar una orden (técnico) ──
function abrirNueva() {
  const sheet = container_.querySelector('#rc-sheet');
  const campo = (id, label, ph, opc) => `
    <div style="margin-bottom:12px">
      <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-bottom:6px">${label}${opc ? ' <span style="color:var(--text-4);font-weight:400">(opcional)</span>' : ''}</div>
      <input id="${id}" type="text" placeholder="${ph}" style="width:100%;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-2);font-size:14px;font-family:inherit;outline:none"/>
    </div>`;

  sheet.innerHTML = `
    <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 16px"></div>
    <div style="font-size:16px;font-weight:800;margin-bottom:16px">Registrar orden</div>
    ${campo('rc-nc', 'NC', 'Número de cliente')}
    ${campo('rc-wo', 'WO', 'Número de orden')}
    ${campo('rc-cliente', 'Cliente', 'Nombre del cliente')}
    <div style="margin-bottom:12px">
      <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-bottom:6px">Concepto</div>
      <select id="rc-concept" style="width:100%;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-2);font-size:14px;font-family:inherit;outline:none">
        <option value="">Selecciona…</option>
        ${CONCEPTOS.map(c => `<option value="${c}">${c}</option>`).join('')}
      </select>
    </div>
    <div id="rc-otro-wrap" style="margin-bottom:12px;display:none">
      <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-bottom:6px">Especifica el concepto</div>
      <input id="rc-otro" type="text" placeholder="¿Qué tipo de orden?" style="width:100%;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-2);font-size:14px;font-family:inherit;outline:none"/>
    </div>
    <div style="margin-bottom:12px">
      <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-bottom:6px">Detalle <span style="color:var(--text-4);font-weight:400">(opcional)</span></div>
      <textarea id="rc-detalle" rows="3" placeholder="Observaciones de lo que se hizo" style="width:100%;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-2);font-size:14px;font-family:inherit;outline:none;resize:vertical"></textarea>
    </div>
    ${campo('rc-serie', '# Serie', 'Serie del medidor', true)}
    <div style="margin-bottom:12px;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--glass)">
      <label style="display:flex;align-items:center;gap:10px;cursor:pointer">
        <input type="checkbox" id="rc-censo" style="width:18px;height:18px;accent-color:#fbbf24;cursor:pointer"/>
        <span style="font-size:13px;font-weight:600;color:var(--text-2)">Se hizo censo de carga</span>
      </label>
      <div id="rc-censo-wrap" style="display:none;margin-top:10px">
        <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-bottom:6px">WO del censo</div>
        <input id="rc-censo-wo" type="text" placeholder="Número de orden del censo" style="width:100%;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--bg-card);color:var(--text-2);font-size:14px;font-family:inherit;outline:none"/>
      </div>
    </div>
    <div id="rc-err" style="display:none;color:#f87171;font-size:12px;margin-bottom:10px"></div>
    <div style="display:flex;gap:8px">
      <button id="rc-cancel" style="flex:1;padding:13px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-3);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Cancelar</button>
      <button id="rc-guardar" style="flex:2;padding:13px;border-radius:12px;border:none;background:#fbbf24;color:#0d1117;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit"><span id="rc-guardar-lbl">Guardar</span></button>
    </div>`;

  sheet.style.transform = 'translateY(0)';
  const selConcept = sheet.querySelector('#rc-concept');
  selConcept.onchange = () => {
    sheet.querySelector('#rc-otro-wrap').style.display = selConcept.value === 'Otro' ? 'block' : 'none';
  };
  const chkCenso = sheet.querySelector('#rc-censo');
  chkCenso.onchange = () => {
    sheet.querySelector('#rc-censo-wrap').style.display = chkCenso.checked ? 'block' : 'none';
  };
  sheet.querySelector('#rc-cancel').onclick = cerrarSheet;
  sheet.querySelector('#rc-guardar').onclick = guardar;
  setTimeout(() => sheet.querySelector('#rc-nc')?.focus(), 300);
}

function cerrarSheet() {
  const sheet = container_.querySelector('#rc-sheet');
  if (sheet) sheet.style.transform = 'translateY(calc(100% + 140px))';
}

async function guardar() {
  const sheet = container_.querySelector('#rc-sheet');
  const val = id => sheet.querySelector(id).value.trim();
  const nc = val('#rc-nc'), wo = val('#rc-wo'), cliente = val('#rc-cliente');
  let concept = val('#rc-concept');
  const detalle = val('#rc-detalle'), serie = val('#rc-serie');
  const censoCarga = sheet.querySelector('#rc-censo').checked;
  const censoWo = censoCarga ? val('#rc-censo-wo') : '';
  const err = sheet.querySelector('#rc-err');

  const falta = [];
  if (!nc) falta.push('NC');
  if (!wo) falta.push('WO');
  if (!cliente) falta.push('Cliente');
  if (!concept) falta.push('Concepto');
  if (concept === 'Otro') {
    const otro = val('#rc-otro');
    if (!otro) falta.push('el concepto (Otro)');
    else concept = otro;
  }
  if (censoCarga && !censoWo) falta.push('WO del censo');
  if (falta.length) { err.textContent = 'Falta: ' + falta.join(', '); err.style.display = 'block'; return; }
  err.style.display = 'none';

  const btn = sheet.querySelector('#rc-guardar');
  btn.disabled = true;
  sheet.querySelector('#rc-guardar-lbl').textContent = 'Guardando…';
  try {
    const doc = {
      nc, wo, cliente, concept, detalle, serie,
      censoCarga, censoWo,
      tecnicoUid: session_.uid,
      tecnicoNombre: session_.displayName,
      fecha: firebase.firestore.Timestamp.now(),
    };
    const ref = await db.collection('reclamos_siget').add(doc);
    registros_.unshift({ id: ref.id, ...doc });
    cerrarSheet();
    renderResumen();
    renderLista();
    toast('Orden registrada', 'ok');
  } catch (e) {
    btn.disabled = false;
    sheet.querySelector('#rc-guardar-lbl').textContent = 'Reintentar';
    toast('Error: ' + e.message, 'error');
  }
}

// ── Descargar Excel (admin/asistente) ──
function descargarExcel() {
  try {
    if (!registros_.length) { toast('No hay órdenes para exportar', 'warn'); return; }
    const filas = registros_.map(r => ({
      'NC': r.nc || '',
      'WO': r.wo || '',
      'Cliente': r.cliente || '',
      'Concepto': r.concept || '',
      'Detalle': r.detalle || '',
      '# Serie': r.serie || '',
      'Censo de carga': r.censoCarga ? 'Sí' : 'No',
      'WO censo': r.censoWo || '',
      'Técnico': r.tecnicoNombre || '',
      'Fecha': fmtFecha(r.fecha),
    }));
    const headers = Object.keys(filas[0]);
    const ws = XLSX.utils.json_to_sheet(filas, { header: headers });
    ws['!cols'] = [{wch:14},{wch:14},{wch:26},{wch:24},{wch:40},{wch:12},{wch:14},{wch:14},{wch:22},{wch:12}];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reclamos SIGET');
    const hoy = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Reclamos_SIGET_${hoy}.xlsx`);
    toast('Historial descargado', 'ok');
  } catch (err) {
    toast('Error al generar el Excel: ' + err.message, 'error');
  }
}

// ══════════════════════════════════════════════════════════════
//  CARGA MASIVA DEL HISTÓRICO (admin) — desde Excel
//  Columnas: Fecha, NC, WO, # series, Concept, WO Class (detalle),
//  Resp. (técnico), Cliente. Cruza el técnico con los usuarios de
//  la app (normalizando mayúsculas/acentos). No duplica por WO.
// ══════════════════════════════════════════════════════════════

function normTxt(s) {
  return String(s ?? '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .toLowerCase().trim().replace(/\s+/g, ' ');
}
function normHeader(s) {
  return normTxt(s).replace(/[\s._\-#/]/g, '');
}

const ALIAS_HIST = {
  fecha:   ['fechadeejecucion', 'fecha', 'fechaejecucion'],
  nc:      ['nc', 'contrato'],
  wo:      ['wo', 'orden', 'numeroorden'],
  serie:   ['series', 'serie', 'numeroserie', 'numserie'],
  concept: ['concept', 'concepto'],
  detalle: ['woclass', 'detalle', 'clase', 'observaciones'],
  resp:    ['resp', 'responsable', 'tecnico'],
  cliente: ['cliente', 'nombre', 'nombrecliente'],
  ordenExtra: ['ordenextra', 'extra'],
  censoWo:    ['wo1', 'wo_1', 'woextra', 'wocenso'],
};

function mapearColsHist(rows) {
  const claves = Object.keys(rows[0] || {});
  const enc = {};
  for (const campo of Object.keys(ALIAS_HIST)) {
    for (const k of claves) {
      if (ALIAS_HIST[campo].includes(normHeader(k))) { enc[campo] = k; break; }
    }
  }
  return enc;
}

function fechaDeExcel(v) {
  if (v == null || v === '') return null;
  if (v instanceof Date) return v;
  // Número serial de Excel
  if (typeof v === 'number') {
    const epoch = new Date(Date.UTC(1899, 11, 30));
    return new Date(epoch.getTime() + v * 86400000);
  }
  const d = new Date(v);
  return isNaN(d.getTime()) ? null : d;
}

async function cargarUsuarios() {
  if (usuarios_.length) return;
  try {
    const snap = await db.collection('users').where('active', '==', true).get();
    usuarios_ = snap.docs.map(d => ({ uid: d.id, ...d.data() }));
  } catch { usuarios_ = []; }
}

// Cruza un nombre del Excel con un usuario de la app
function cruzarTecnico(nombreExcel) {
  const n = normTxt(nombreExcel);
  if (!n) return null;
  // Coincidencia exacta normalizada
  let u = usuarios_.find(x => normTxt(x.displayName) === n);
  if (u) return u;
  // Coincidencia por primer + último token (por si el orden difiere)
  const toks = n.split(' ').filter(Boolean);
  if (toks.length >= 2) {
    const first = toks[0], last = toks[toks.length - 1];
    u = usuarios_.find(x => {
      const xn = normTxt(x.displayName);
      return xn.includes(first) && xn.includes(last);
    });
    if (u) return u;
  }
  // Coincidencia por solo nombre de pila si es único
  const soloNombre = usuarios_.filter(x => normTxt(x.displayName).split(' ')[0] === n.split(' ')[0]);
  if (soloNombre.length === 1) return soloNombre[0];
  return null;
}

async function manejarHistorico(file) {
  if (!file) return;
  const est = container_.querySelector('#rc-estado');
  est.innerHTML = `<div style="text-align:center;padding:20px"><div class="spinner" style="margin:0 auto 8px"></div><div style="font-size:12px;color:var(--text-4)">Leyendo el histórico…</div></div>`;
  try {
    await cargarUsuarios();
    const buf = await file.arrayBuffer();
    const wb = XLSX.read(buf, { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
    if (!rows.length) throw new Error('El archivo está vacío.');

    const cols = mapearColsHist(rows);
    if (!cols.wo) throw new Error('No encontré la columna WO.');

    // WO ya existentes en la app (para no duplicar)
    const woExistentes = new Set(registros_.map(r => String(r.wo ?? '').trim()));

    const nuevos = [];
    const sinTecnico = new Set();
    let duplicados = 0, sinWO = 0;
    const woEnArchivo = new Set();

    for (const r of rows) {
      const wo = String(r[cols.wo] ?? '').trim();
      if (!wo) { sinWO++; continue; }
      if (woExistentes.has(wo) || woEnArchivo.has(wo)) { duplicados++; continue; }
      woEnArchivo.add(wo);

      const respNombre = cols.resp ? String(r[cols.resp] ?? '').trim() : '';
      const u = respNombre ? cruzarTecnico(respNombre) : null;
      if (respNombre && !u) sinTecnico.add(respNombre);

      const fecha = cols.fecha ? fechaDeExcel(r[cols.fecha]) : null;

      // Censo de carga: la col J (segunda WO) trae el WO del censo; la col I
      // ("Orden extra") suele decir "censo de carga". Si hay WO en J, hubo censo.
      const censoWo = cols.censoWo ? String(r[cols.censoWo] ?? '').trim() : '';
      const ordenExtra = cols.ordenExtra ? String(r[cols.ordenExtra] ?? '').trim() : '';
      const censoCarga = !!censoWo || /censo/i.test(ordenExtra);

      nuevos.push({
        nc:      cols.nc ? String(r[cols.nc] ?? '').trim() : '',
        wo,
        cliente: cols.cliente ? String(r[cols.cliente] ?? '').trim() : '',
        concept: cols.concept ? String(r[cols.concept] ?? '').trim() : '',
        detalle: cols.detalle ? String(r[cols.detalle] ?? '').trim() : '',
        serie:   cols.serie ? String(r[cols.serie] ?? '').trim() : '',
        censoCarga, censoWo,
        // El técnico: uid si cruzó; el nombre del Excel SIEMPRE se guarda
        tecnicoUid: u ? u.uid : null,
        tecnicoNombre: u ? u.displayName : (respNombre || 'Sin técnico'),
        fecha: fecha ? firebase.firestore.Timestamp.fromDate(fecha) : firebase.firestore.Timestamp.now(),
        importado: true,
      });
    }

    previsualizarHistorico(nuevos, { duplicados, sinWO, sinTecnico: [...sinTecnico] });
  } catch (err) {
    est.innerHTML = `<div style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.3);border-radius:10px;padding:14px;font-size:12px;color:#f87171">${err.message}</div>`;
  } finally {
    const inp = container_.querySelector('#rc-file');
    if (inp) inp.value = '';
  }
}

function previsualizarHistorico(nuevos, info) {
  const est = container_.querySelector('#rc-estado');
  if (!nuevos.length) {
    est.innerHTML = `<div style="background:rgba(251,191,36,.08);border:1px solid rgba(251,191,36,.3);border-radius:10px;padding:14px;font-size:12px;color:#fbbf24">No hay órdenes nuevas que cargar${info.duplicados ? ` · ${info.duplicados} ya existían` : ''}.</div>`;
    return;
  }
  const conTec = nuevos.filter(n => n.tecnicoUid).length;
  const sinCruce = nuevos.length - conTec;
  const conCenso = nuevos.filter(n => n.censoCarga).length;

  est.innerHTML = `
    <div style="background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:16px;margin-bottom:12px">
      <div style="font-size:15px;font-weight:800;margin-bottom:10px">${nuevos.length} órdenes a cargar</div>
      <div class="flex-col gap-4" style="font-size:12px">
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">Técnico enlazado a un usuario</span><span style="font-weight:700;color:#22c55e">${conTec}</span></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">Solo con nombre (sin enlazar)</span><span style="font-weight:700;color:${sinCruce?'#fbbf24':'var(--text-4)'}">${sinCruce}</span></div>
        <div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">Con censo de carga</span><span style="font-weight:700;color:${conCenso?'#34d399':'var(--text-4)'}">${conCenso}</span></div>
        ${info.duplicados ? `<div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">WO ya existentes (omitidos)</span><span style="font-weight:700;color:var(--text-4)">${info.duplicados}</span></div>` : ''}
        ${info.sinWO ? `<div style="display:flex;justify-content:space-between"><span style="color:var(--text-3)">Filas sin WO (omitidas)</span><span style="font-weight:700;color:var(--text-4)">${info.sinWO}</span></div>` : ''}
      </div>
      ${info.sinTecnico.length ? `<div style="margin-top:10px;padding-top:10px;border-top:1px solid var(--border);font-size:10px;color:var(--text-4)">Nombres que no cruzaron con un usuario (se guardan como texto): ${info.sinTecnico.map(escapar).join(', ')}</div>` : ''}
    </div>
    <button class="btn-primary full" id="rc-hist-confirmar" style="border-color:rgba(251,191,36,.4);color:#fbbf24;background:rgba(251,191,36,.1)"><span id="rc-hist-lbl">Cargar ${nuevos.length} órdenes</span></button>`;

  est.querySelector('#rc-hist-confirmar').onclick = async (e) => {
    const btn = e.currentTarget;
    btn.disabled = true;
    est.querySelector('#rc-hist-lbl').textContent = 'Guardando…';
    try {
      let batch = db.batch(), count = 0; const commits = [];
      for (const o of nuevos) {
        const ref = db.collection('reclamos_siget').doc();
        batch.set(ref, o);
        if (++count === 499) { commits.push(batch.commit()); batch = db.batch(); count = 0; }
      }
      if (count > 0) commits.push(batch.commit());
      await Promise.all(commits);
      est.innerHTML = '';
      toast(`${nuevos.length} órdenes cargadas`, 'ok');
      await cargar();
    } catch (err) {
      btn.disabled = false;
      est.querySelector('#rc-hist-lbl').textContent = 'Reintentar';
      toast('Error al guardar: ' + err.message, 'error');
    }
  };
}
