/**
 * js/views/reclamos.js
 * Área "Reclamos SIGET" — bitácora de trazabilidad.
 *
 * El técnico registra las órdenes que realiza con una WO y una
 * descripción de lo que hizo; la fecha y el autor se guardan solos.
 * El asistente/admin consulta todo el historial y puede descargarlo
 * en Excel.
 *
 * Datos: colección Firestore 'reclamos_siget'.
 *  { wo, descripcion, tecnicoUid, tecnicoNombre, fecha }
 *
 * Roles:
 *  - técnico: registra y ve SOLO sus órdenes.
 *  - admin/asistente: ve todas, con buscador y descarga.
 */

import { db } from '../firebase.js';
import { toast } from '../ui.js';

let container_ = null;
let session_   = null;
let esAdmin_   = false;
let registros_ = [];
let filtro_    = '';

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
          <div style="font-size:12px;color:var(--text-4);margin-top:2px">${esAdmin_ ? 'Historial de órdenes registradas' : 'Tus órdenes registradas'}</div>
        </div>
        <div style="display:flex;gap:8px">
          ${esAdmin_ ? `
          <button class="icon-btn" id="rc-excel" title="Descargar historial en Excel">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
          </button>` : `
          <button class="icon-btn" id="rc-nueva" title="Registrar orden" style="background:#a78bfa;border-color:#a78bfa;color:#0d1117">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
          </button>`}
        </div>
      </div>

      ${esAdmin_ ? `
      <div style="position:relative;margin-bottom:14px">
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-4)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="position:absolute;left:12px;top:50%;transform:translateY(-50%)"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input id="rc-buscar" type="text" placeholder="Buscar por WO, técnico o descripción…" style="width:100%;padding:11px 12px 11px 36px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-2);font-size:13px;font-family:inherit;outline:none"/>
      </div>` : ''}

      <div id="rc-resumen"></div>
      <div id="rc-lista"></div>

      <!-- Hoja para registrar (técnico) -->
      <div id="rc-sheet" style="position:fixed;left:0;right:0;bottom:0;z-index:1200;transform:translateY(calc(100% + 140px));transition:transform .25s ease;background:#0d1117;border-top:1px solid var(--border);border-radius:20px 20px 0 0;padding:18px 20px calc(var(--navbar-h,72px) + 26px);max-height:80vh;overflow-y:auto"></div>
    </div>`;

  if (esAdmin_) {
    container.querySelector('#rc-excel').onclick = descargarExcel;
    const buscar = container.querySelector('#rc-buscar');
    buscar.oninput = (e) => { filtro_ = e.target.value.trim().toLowerCase(); renderLista(); };
  } else {
    container.querySelector('#rc-nueva').onclick = abrirNueva;
  }

  await cargar();
}

async function cargar() {
  const lista = container_.querySelector('#rc-lista');
  if (lista) lista.innerHTML = `<div style="text-align:center;padding:24px"><div class="spinner" style="margin:0 auto 8px"></div><div style="font-size:12px;color:var(--text-4)">Cargando…</div></div>`;
  try {
    let query = db.collection('reclamos_siget');
    // El técnico solo trae las suyas
    if (!esAdmin_) query = query.where('tecnicoUid', '==', session_.uid);
    const snap = await query.get();
    registros_ = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // Ordenar por fecha, más reciente primero
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

  // Contar las de este mes
  const ahora = new Date();
  const delMes = registros_.filter(r => {
    const d = r.fecha?.toDate ? r.fecha.toDate() : new Date(r.fecha);
    return d.getMonth() === ahora.getMonth() && d.getFullYear() === ahora.getFullYear();
  }).length;

  el.innerHTML = `
    <div style="display:flex;gap:10px;margin-bottom:16px">
      <div style="flex:1;background:var(--bg-card);border:1px solid var(--border);border-radius:12px;padding:14px;text-align:center">
        <div style="font-size:22px;font-weight:800;color:#a78bfa">${total}</div>
        <div style="font-size:10px;color:var(--text-4)">${esAdmin_ ? 'Total registradas' : 'Tus órdenes'}</div>
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
  return `${p(d.getDate())}/${p(d.getMonth()+1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function renderLista() {
  const el = container_.querySelector('#rc-lista');
  if (!el) return;

  let arr = registros_;
  if (esAdmin_ && filtro_) {
    arr = arr.filter(r =>
      String(r.wo || '').toLowerCase().includes(filtro_) ||
      String(r.tecnicoNombre || '').toLowerCase().includes(filtro_) ||
      String(r.descripcion || '').toLowerCase().includes(filtro_)
    );
  }

  if (!arr.length) {
    el.innerHTML = `<div style="text-align:center;padding:32px 16px;color:var(--text-4);font-size:13px">${
      registros_.length ? 'No hay resultados para tu búsqueda.' :
      esAdmin_ ? 'Aún no hay órdenes registradas.' : 'No has registrado órdenes.<br>Usa el botón + para agregar la primera.'
    }</div>`;
    return;
  }

  el.innerHTML = `<div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(280px,1fr));gap:10px">${
    arr.map(r => `
      <div style="background:var(--bg-card);border:1px solid var(--border);border-left:3px solid #a78bfa;border-radius:12px;padding:13px">
        <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;margin-bottom:6px">
          <div style="font-size:14px;font-weight:800;color:#a78bfa">WO ${r.wo || '—'}</div>
          <div style="font-size:10px;color:var(--text-4)">${fmtFecha(r.fecha)}</div>
        </div>
        <div style="font-size:12px;color:var(--text-2);line-height:1.5;margin-bottom:8px;white-space:pre-wrap">${escapar(r.descripcion || '')}</div>
        ${esAdmin_ ? `<div style="font-size:10px;color:var(--text-4);display:flex;align-items:center;gap:5px">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="11" height="11"><path d="M20 21v-2a4 4 0 00-4-4H8a4 4 0 00-4 4v2"/><circle cx="12" cy="7" r="4"/></svg>
          ${r.tecnicoNombre || 'Técnico'}
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
  sheet.innerHTML = `
    <div style="width:36px;height:4px;background:var(--border);border-radius:2px;margin:0 auto 16px"></div>
    <div style="font-size:16px;font-weight:800;margin-bottom:16px">Registrar orden</div>

    <div style="margin-bottom:14px">
      <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-bottom:6px">WO</div>
      <input id="rc-wo" type="text" inputmode="numeric" placeholder="Número de WO" style="width:100%;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-2);font-size:14px;font-family:inherit;outline:none"/>
    </div>

    <div style="margin-bottom:16px">
      <div style="font-size:12px;font-weight:600;color:var(--text-3);margin-bottom:6px">Descripción</div>
      <textarea id="rc-desc" rows="4" placeholder="¿Qué se hizo?" style="width:100%;padding:12px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-2);font-size:14px;font-family:inherit;outline:none;resize:vertical"></textarea>
    </div>

    <div id="rc-err" style="display:none;color:#f87171;font-size:12px;margin-bottom:10px"></div>

    <div style="display:flex;gap:8px">
      <button id="rc-cancel" style="flex:1;padding:13px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-3);font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">Cancelar</button>
      <button id="rc-guardar" style="flex:2;padding:13px;border-radius:12px;border:none;background:#a78bfa;color:#0d1117;font-size:13px;font-weight:800;cursor:pointer;font-family:inherit"><span id="rc-guardar-lbl">Guardar</span></button>
    </div>`;

  sheet.style.transform = 'translateY(0)';
  sheet.querySelector('#rc-cancel').onclick = cerrarSheet;
  sheet.querySelector('#rc-guardar').onclick = guardar;
  setTimeout(() => sheet.querySelector('#rc-wo')?.focus(), 300);
}

function cerrarSheet() {
  const sheet = container_.querySelector('#rc-sheet');
  if (sheet) sheet.style.transform = 'translateY(calc(100% + 140px))';
}

async function guardar() {
  const sheet = container_.querySelector('#rc-sheet');
  const wo = sheet.querySelector('#rc-wo').value.trim();
  const desc = sheet.querySelector('#rc-desc').value.trim();
  const err = sheet.querySelector('#rc-err');

  if (!wo) { err.textContent = 'Ingresa el número de WO.'; err.style.display = 'block'; return; }
  if (!desc) { err.textContent = 'Escribe una descripción de lo que se hizo.'; err.style.display = 'block'; return; }
  err.style.display = 'none';

  const btn = sheet.querySelector('#rc-guardar');
  btn.disabled = true;
  sheet.querySelector('#rc-guardar-lbl').textContent = 'Guardando…';

  try {
    const doc = {
      wo, descripcion: desc,
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
      'WO': r.wo || '',
      'Descripción': r.descripcion || '',
      'Técnico': r.tecnicoNombre || '',
      'Fecha': fmtFecha(r.fecha),
    }));
    const headers = ['WO', 'Descripción', 'Técnico', 'Fecha'];
    const ws = XLSX.utils.json_to_sheet(filas, { header: headers });
    ws['!cols'] = [{ wch: 14 }, { wch: 50 }, { wch: 22 }, { wch: 18 }];
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, 'Reclamos SIGET');
    const hoy = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(wb, `Reclamos_SIGET_${hoy}.xlsx`);
    toast('Historial descargado', 'ok');
  } catch (err) {
    toast('Error al generar el Excel: ' + err.message, 'error');
  }
}
