/**
 * js/views/factibilidades_importar.js
 * Importar el Excel de Factibilidades (clientes nuevos) — solo admin/asistente.
 *
 * Columnas que se usan: Orden, Contrato, Aviso, Fecha de aviso, Liberación
 * real, Texto breve (código con teléfono y referencia del vecino o
 * transformador), Población, Distrito, Calle, Descripción (= cliente),
 * Número de serie, Fabricante, Ubic.técn. y Pto.tbjo.resp. (usuario DELSUR
 * del técnico). Centro planif., Autor, Status usuario y Fecha fin real no.
 *
 * Asignación: cada usuario DELSUR (DGUERR, AAPERE…) se cruza con un técnico
 * del área; el cruce se guarda en factibilidades_config/general.codigosDelsur
 * y se recuerda para la próxima. Lo reasignado a mano en la app
 * (asignacionManual) no se pisa al volver a importar.
 *
 * El Excel no trae coordenadas. Se ubican con el padrón de ubicaciones
 * (ubicaciones.js): por el NC o medidor del propio cliente, o junto a la
 * referencia del vecino que viene en el Texto breve (MD/NC/DS). Las que no
 * se encuentren pueden ubicarse, si el admin lo pide, por dirección con
 * Google (geocodificar.js); eso es muy aproximado y queda marcado. El Excel
 * tampoco trae departamento: el "Centro planif." dice la zona de DELSUR y con
 * eso se limita la búsqueda en Google (ver CENTROS).
 */
import { db } from '../firebase.js';
import { toast, escapeHtml as esc } from '../ui.js';
import { COL_ORDENES, COL_CONFIG } from '../factibilidades_comun.js';
import { geocodificar, leerClave, guardarClave } from '../geocodificar.js';
import { cargarIndiceUbicaciones, ubicarPorCodigos, motivoSinUbicar } from '../ubicaciones.js';

const ID = 'fb-sheet-importar';
const norm = s => String(s ?? '').toUpperCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();

// Centro de planificación DELSUR -> departamento (zona de búsqueda en Google).
const CENTROS = { '1110': 'San Salvador', '2110': 'La Libertad', '3110': 'La Libertad', '3510': 'La Paz' };

let filas_ = [], plan_ = null, tecnicos_ = [], session_ = null, mapeo_ = {}, archivo_ = '', usarGoogle_ = false;

// ── Lectura del Excel ─────────────────────────────
function fechaExcel(v) {
  if (v === '' || v == null) return null;
  if (typeof v === 'number') {
    const p = XLSX.SSF.parse_date_code(v);
    return p ? new Date(p.y, p.m - 1, p.d) : null;   // fecha local, sin corrimiento de zona
  }
  const m = String(v).match(/(\d{1,2})[./-](\d{1,2})[./-](\d{4})/);
  return m ? new Date(+m[3], +m[2] - 1, +m[1]) : null;
}

// "1.2.1.1.[NC].1.[teléfono].1.[referencia]" -> { telefono, referencia }
function leerCodigo(t) {
  const partes = String(t || '').split('.').map(x => x.trim());
  const telefono = partes.find(x => /^[267]\d{7}$/.test(x)) || '';
  const ult = partes[partes.length - 1] || '';
  const referencia = ult && ult !== telefono && !/^\d{1,2}$/.test(ult) ? ult.replace(/\s+/g, '').toUpperCase() : '';
  return { telefono, referencia };
}

export function leerExcel(rows) {
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 6); i++) if ((rows[i] || []).some(x => norm(x) === 'ORDEN')) { h = i; break; }
  if (h === -1) return { error: 'No se encontró la columna "Orden". ¿Es el Excel de Factibilidades?' };
  const H = (rows[h] || []).map(norm);
  const c = (...a) => H.findIndex(x => a.includes(x));
  const ix = {
    orden: c('ORDEN'), nc: c('CONTRATO'), aviso: c('AVISO'), fAviso: c('FECHA DE AVISO'), fLib: c('LIBERACION REAL'),
    texto: c('TEXTO BREVE'), centro: c('CENTRO PLANIF.', 'CENTRO PLANIF'), poblacion: c('POBLACION'), distrito: c('DISTRITO'), calle: c('CALLE'),
    cliente: c('DESCRIPCION'), serie: c('NUMERO DE SERIE'), marca: c('FABRICANTE'), dsct: c('UBIC.TECN.'),
    codigo: c('PTO.TBJO.RESP.'),
  };
  if (ix.calle === -1 && ix.poblacion === -1) return { error: 'No se encontraron las columnas de dirección (Calle, Distrito, Población).' };
  const v = (r, i) => (i >= 0 ? String(r[i] ?? '').trim() : '');
  const vistos = new Set();
  const filas = [];
  let repetidas = 0;
  rows.slice(h + 1).forEach(r => {
    const numeroOrden = v(r, ix.orden);
    if (!numeroOrden) return;
    if (vistos.has(numeroOrden)) { repetidas++; return; }
    vistos.add(numeroOrden);
    const cod = leerCodigo(v(r, ix.texto));
    const calle = v(r, ix.calle), distrito = v(r, ix.distrito), poblacion = v(r, ix.poblacion);
    const departamento = CENTROS[v(r, ix.centro)] || '';
    filas.push({
      numeroOrden,
      nc: v(r, ix.nc),
      aviso: v(r, ix.aviso),
      cliente: v(r, ix.cliente),
      direccion: [calle, distrito, poblacion].filter(Boolean).join(', '),
      departamento,
      // Consultas para Google, de la más detallada a la más general (sin nombre del cliente).
      _geo: {
        zona: departamento,
        consultas: [
          [calle, distrito, poblacion, departamento],
          [distrito, poblacion, departamento],
          [poblacion, departamento],
        ].map(p => p.filter(Boolean)).filter(p => p.length > 1 || !departamento)
          .map(p => p.join(', ') + ', El Salvador'),
      },
      telefono: cod.telefono,
      referencia: cod.referencia,
      serieActual: v(r, ix.serie),
      marca: v(r, ix.marca),
      dsct: v(r, ix.dsct),
      codigoTecnico: v(r, ix.codigo).toUpperCase(),
      fechaAviso: fechaExcel(ix.fAviso >= 0 ? r[ix.fAviso] : ''),
      fechaLiberacion: fechaExcel(ix.fLib >= 0 ? r[ix.fLib] : ''),
    });
  });
  return { filas, repetidas };
}

// ── Comparar con lo que hay ───────────────────────
async function existentesPorOrden(nums) {
  const mapa = new Map();
  for (let i = 0; i < nums.length; i += 30) {
    const snap = await db.collection(COL_ORDENES).where('numeroOrden', 'in', nums.slice(i, i + 30)).get();
    snap.docs.forEach(d => mapa.set(String(d.data().numeroOrden), { id: d.id, ...d.data() }));
  }
  return mapa;
}

// Se ubica si no tiene punto o si el punto es aproximado y nadie lo corrigió
// en el sitio (al volver a subir el Excel se recalcula con la búsqueda mejor).
const hayQueUbicar = o => !o.coordCorregida && (!o.latitud || !o.longitud || o.ubicacionAprox);

async function armarPlan(filas) {
  const [ex, cfg, clave] = await Promise.all([
    existentesPorOrden(filas.map(f => f.numeroOrden)),
    db.collection(COL_CONFIG).doc('general').get().catch(() => null),
    leerClave().catch(() => ''),
  ]);
  mapeo_ = { ...(cfg?.exists ? (cfg.data().codigosDelsur || {}) : {}) };
  // Si un código coincide con el usuario de la app de un técnico, se cruza solo.
  const codigos = [...new Set(filas.map(f => f.codigoTecnico).filter(Boolean))].sort();
  codigos.forEach(cod => {
    if (mapeo_[cod] && tecnicos_.some(t => t.id === mapeo_[cod])) return;
    const t = tecnicos_.find(u => norm(u.username) === cod);
    mapeo_[cod] = t ? t.id : (mapeo_[cod] || '');
  });
  const nuevas = filas.filter(f => !ex.has(f.numeroOrden));
  const existentes = filas.filter(f => ex.has(f.numeroOrden)).map(f => ({ f, o: ex.get(f.numeroOrden) }));

  // Ubicar con el padrón (NC / medidor del cliente o la referencia del vecino)
  const aUbicar = [...nuevas, ...existentes.filter(({ o }) => hayQueUbicar(o)).map(({ f }) => f)];
  const codigosDe = f => ({ nc: f.nc, medidor: f.serieActual, referencia: f.referencia, ds: f.dsct });
  const porPadron = new Map();
  let fuentes = [], resumenPadron = null;
  const porMotivo = {};
  if (aUbicar.length) {
    const r = await cargarIndiceUbicaciones(idx => aUbicar.some(f => !ubicarPorCodigos(idx, codigosDe(f))));
    fuentes = r.fuentes;
    resumenPadron = r.resumen;
    aUbicar.forEach(f => {
      const u = ubicarPorCodigos(r.indice, codigosDe(f));
      if (u) porPadron.set(f.numeroOrden, u);
      else { const m = motivoSinUbicar(codigosDe(f)); porMotivo[m] = (porMotivo[m] || 0) + 1; }
    });
  }
  const porFuente = {};
  porPadron.forEach(u => { porFuente[u.fuente] = (porFuente[u.fuente] || 0) + 1; });
  return {
    nuevas, existentes, codigos, hayClave: !!clave,
    aUbicar: aUbicar.length, porPadron, porFuente, porMotivo, resumenPadron, fuentes, sinPadronUbic: !fuentes.includes('ubicaciones'),
    porCodigo: Object.fromEntries(codigos.map(c => [c, filas.filter(f => f.codigoTecnico === c).length])),
    sinCodigo: filas.filter(f => !f.codigoTecnico).length,
  };
}

const n = x => Number(x || 0).toLocaleString('es-SV');

// "12 sin ninguna referencia · 30 solo con poste (DS) · 8 con medidor o contrato que no está en el padrón. "
function textoMotivos(m) {
  const partes = [
    m.ninguna && `${m.ninguna} sin ninguna referencia`,
    m.poste && `${m.poste} solo con poste o transformador (DS)`,
    m['medidor o contrato'] && `${m['medidor o contrato']} con medidor o contrato que no está en el padrón`,
  ].filter(Boolean);
  return partes.length ? partes.join(' · ') + '. ' : '';
}

// ── Hoja ──────────────────────────────────────────
function hoja() {
  let sh = document.getElementById(ID);
  if (!sh) {
    sh = document.createElement('div');
    sh.className = 'sheet-backdrop';
    sh.id = ID;
    sh.innerHTML = `<div class="sheet" style="max-height:92vh"><div class="sheet-handle"></div>
      <div class="sheet-title">Importar Excel de Factibilidades</div>
      <div class="sheet-body" id="fbi-cuerpo"></div></div>`;
    sh.addEventListener('click', e => { if (e.target === sh) sh.classList.remove('open'); });
    document.body.appendChild(sh);
  }
  return sh;
}

export function abrirImportar(session, tecnicos) {
  session_ = session;
  tecnicos_ = [...(tecnicos || [])].sort((a, b) => String(a.displayName).localeCompare(String(b.displayName), 'es'));
  filas_ = []; plan_ = null;
  const sh = hoja();
  sh.querySelector('#fbi-cuerpo').innerHTML = `
    <div style="font-size:12px;color:var(--text-4);margin-bottom:14px;line-height:1.6">
      Excel de clientes nuevos (Orden, Aviso, Población, Distrito, Calle…). Las órdenes que ya están no se duplican; lo reasignado a mano se respeta.
    </div>
    <div class="import-dropzone" id="fbi-zona">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" width="32" height="32" style="color:var(--text-4)"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
      <p>Toca para seleccionar el Excel</p><span>.xlsx · .xls</span>
    </div>
    <input type="file" id="fbi-archivo" accept=".xlsx,.xlsm,.xls" style="display:none"/>
    <div id="fbi-plan"></div>
    <div id="fbi-error" class="form-error"></div>
    <button class="btn-primary full" id="fbi-ok" style="display:none"><span id="fbi-ok-lbl">Importar</span></button>`;
  const inp = sh.querySelector('#fbi-archivo');
  sh.querySelector('#fbi-zona').onclick = () => inp.click();
  inp.onchange = () => { const f = inp.files[0]; inp.value = ''; if (f) cargarArchivo(f); };
  sh.querySelector('#fbi-ok').onclick = importar;
  sh.classList.add('open');
}

function error(msg) {
  const e = document.getElementById('fbi-error');
  e.textContent = msg || '';
  e.style.display = msg ? 'block' : 'none';
}

async function cargarArchivo(file) {
  error('');
  archivo_ = file.name;
  const plan = document.getElementById('fbi-plan');
  plan.innerHTML = '<div class="import-info-box"><div class="import-info-label">Leyendo, comparando y buscando ubicaciones…</div></div>';
  document.getElementById('fbi-ok').style.display = 'none';
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    const rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, defval: '' });
    const r = leerExcel(rows);
    if (r.error) { plan.innerHTML = ''; error(r.error); return; }
    filas_ = r.filas;
    plan_ = await armarPlan(filas_);
    plan_.repetidas = r.repetidas;
    pintarPlan();
  } catch (e) {
    plan.innerHTML = '';
    error('No se pudo leer el archivo: ' + e.message);
  }
}

function pintarPlan() {
  const p = plan_;
  const fila = (n, txt, sub, color) => `
    <div style="display:flex;gap:12px;align-items:flex-start;padding:9px 0;border-bottom:1px solid var(--border)">
      <div style="min-width:42px;text-align:right;font-size:18px;font-weight:600;color:${color}">${n}</div>
      <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:600">${txt}</div>${sub ? `<div style="font-size:11.5px;color:var(--text-3);margin-top:2px">${sub}</div>` : ''}</div>
    </div>`;
  const tecOpc = sel => `<option value="">Sin asignar</option>` + tecnicos_.map(t => `<option value="${esc(t.id)}" ${t.id === sel ? 'selected' : ''}>${esc(t.displayName)}</option>`).join('');
  document.getElementById('fbi-plan').innerHTML = `
    <div style="font-size:11px;color:var(--text-4);margin:10px 0 6px">${esc(archivo_)} · ${filas_.length} órdenes</div>
    ${fila(p.nuevas.length, 'Órdenes nuevas', 'Entran abiertas, con la fecha de liberación del Excel', 'var(--fb-light, #f472b6)')}
    ${fila(p.existentes.length, 'Ya estaban en la app', 'Se actualizan sus datos; estado, resultado y reasignaciones manuales se respetan', '#60a5fa')}
    ${p.aUbicar ? fila(p.porPadron.size, 'Ubicadas con el padrón', Object.entries(p.porFuente).map(([f, n]) => `${n} por ${esc(f)}`).join(' · ') || 'Ninguna referencia se encontró en los padrones', '#22c55e') : ''}
    ${p.aUbicar - p.porPadron.size ? fila(p.aUbicar - p.porPadron.size, 'Sin encontrar en el padrón', textoMotivos(p.porMotivo) + (usarGoogle_ ? 'Se ubican por dirección con Google (muy aproximado).' : 'Entran sin punto nuevo en el mapa; el técnico fija la ubicación en el sitio.')
      + (p.hayClave ? `<label style="display:flex;align-items:center;gap:8px;margin-top:6px;color:var(--text-2)"><input type="checkbox" id="fbi-google" ${usarGoogle_ ? 'checked' : ''}/> Ubicarlas por dirección con Google</label>`
        : ' <a href="#" id="fbi-clave" style="color:#60a5fa">Poner clave de Google</a>'), '#fbbf24') : ''}
    ${p.resumenPadron ? `<div style="font-size:11px;color:var(--text-4);margin-top:6px">Padrón de ubicaciones: ${n(p.resumenPadron.filas)} registros · con NC ${n(p.resumenPadron.nc)} · con medidor ${n(p.resumenPadron.md)} · con DS ${n(p.resumenPadron.ds)}</div>` : ''}
    ${p.aUbicar && p.sinPadronUbic ? `<div style="font-size:11.5px;color:#fbbf24;margin-top:6px">Todavía no está el padrón de ubicaciones: súbelo en el menú, Padrones de clientes. Por ahora solo se busca en Caracterización y Contiguos.</div>` : ''}
    ${p.repetidas ? `<div style="font-size:11px;color:var(--text-4);margin-top:6px">${p.repetidas} órdenes repetidas en el archivo (se toma la primera).</div>` : ''}
    <div style="font-size:12px;font-weight:700;color:var(--text-2);margin:16px 0 4px">Asignar por usuario DELSUR</div>
    <div style="font-size:11.5px;color:var(--text-3);margin-bottom:8px">Se recuerda para la próxima. Después puedes reasignar orden por orden.</div>
    ${p.codigos.length ? p.codigos.map(cod => `
      <div style="display:flex;align-items:center;gap:10px;padding:7px 0">
        <div style="flex:1;min-width:0"><div style="font-size:13px;font-weight:700;font-family:monospace">${esc(cod)}</div><div style="font-size:11px;color:var(--text-3)">${p.porCodigo[cod]} órdenes</div></div>
        <select class="form-input" data-cod="${esc(cod)}" style="max-width:56%;padding:8px 10px">${tecOpc(mapeo_[cod])}</select>
      </div>`).join('') : '<div style="font-size:12px;color:var(--text-3)">El archivo no trae usuario responsable.</div>'}
    ${p.sinCodigo ? `<div style="font-size:11.5px;color:#fbbf24;margin-top:6px">${p.sinCodigo} órdenes sin usuario responsable: quedan sin asignar.</div>` : ''}
    ${!tecnicos_.length ? '<div style="font-size:11.5px;color:#fbbf24;margin-top:6px">No hay técnicos activos en Factibilidades: asígnalos en Usuarios para poder cruzarlos.</div>'
      : '<div style="font-size:11.5px;color:var(--text-3);margin-top:6px">¿No aparece un técnico? Asígnale el área Factibilidades en Usuarios.</div>'}`;
  document.querySelectorAll('#fbi-plan select[data-cod]').forEach(s => s.onchange = () => { mapeo_[s.dataset.cod] = s.value; });
  const chk = document.getElementById('fbi-google');
  if (chk) chk.onchange = () => { usarGoogle_ = chk.checked; pintarPlan(); };
  const lnk = document.getElementById('fbi-clave');
  if (lnk) lnk.onclick = async e => {
    e.preventDefault();
    const clave = window.prompt('Pega la clave de Google Maps (API key).\n\nSe guarda en Firebase y solo la ven admin y asistente.');
    if (!clave || !clave.trim()) return;
    try { await guardarClave(clave); plan_.hayClave = true; toast('Clave guardada', 'ok'); pintarPlan(); }
    catch (er) { toast('No se pudo guardar la clave: ' + er.message, 'error'); }
  };
  const btn = document.getElementById('fbi-ok');
  btn.style.display = '';
  btn.disabled = !filas_.length;
  document.getElementById('fbi-ok-lbl').textContent = p.nuevas.length ? `Importar ${p.nuevas.length} nueva${p.nuevas.length !== 1 ? 's' : ''}` : 'Actualizar datos';
}

// ── Guardar ───────────────────────────────────────
async function importar() {
  const p = plan_;
  if (!p) return;
  const btn = document.getElementById('fbi-ok');
  const lbl = document.getElementById('fbi-ok-lbl');
  btn.disabled = true;
  error('');
  try {
    const ts = d => (d ? firebase.firestore.Timestamp.fromDate(d) : null);
    const tec = cod => tecnicos_.find(t => t.id === mapeo_[cod]) || null;
    const ahora = firebase.firestore.Timestamp.now();

    // 1. Ubicar: con el padrón (ya calculado en el plan) y, si se pidió, el
    //    resto por dirección con Google.
    const aUbicar = [
      ...p.nuevas.map(f => ({ f })),
      ...p.existentes.filter(({ o }) => hayQueUbicar(o)).map(({ f, o }) => ({ f, o })),
    ];
    const geo = new Map();
    const resto = aUbicar.filter(x => !p.porPadron.has(x.f.numeroOrden));
    if (resto.length && p.hayClave && usarGoogle_) {
      const res = await geocodificar(resto.map(x => x.f._geo),
        (i, t) => { lbl.textContent = `Ubicando ${i}/${t}…`; });
      res.forEach((r, i) => { if (r) geo.set(resto[i].f.numeroOrden, r); });
    }
    const coord = f => {
      const u = p.porPadron.get(f.numeroOrden);
      if (u) return { latitud: u.lat, longitud: u.lng, ubicacionAprox: !u.exacta, ubicacionFuente: 'padron', ubicacionNivel: u.fuente, ubicacionTipo: '' };
      const r = geo.get(f.numeroOrden);
      return r ? { latitud: r.lat, longitud: r.lng, ubicacionAprox: true, ubicacionFuente: 'direccion', ubicacionTipo: r.tipo, ubicacionNivel: r.nivel || '' } : {};
    };
    const datos = f => ({
      numeroOrden: f.numeroOrden, nc: f.nc, aviso: f.aviso, cliente: f.cliente, direccion: f.direccion, departamento: f.departamento,
      telefono: f.telefono, referencia: f.referencia, serieActual: f.serieActual, marca: f.marca, dsct: f.dsct,
      codigoTecnico: f.codigoTecnico, fechaAviso: ts(f.fechaAviso), fechaLiberacion: ts(f.fechaLiberacion),
    });

    // 2. Escrituras
    const ops = [];
    p.nuevas.forEach(f => {
      const t = tec(f.codigoTecnico);
      ops.push(b => b.set(db.collection(COL_ORDENES).doc(), {
        ...datos(f), ...coord(f),
        estado: null, resultado: null,      // estado null explícito (ver factibilidades_comun.js)
        asignadoUid: t ? t.id : null, asignadoNombre: t ? t.displayName : null, asignacionManual: false,
        importadaEn: ahora, importadaPor: session_.displayName,
      }));
    });
    p.existentes.forEach(({ f, o }) => {
      const upd = { ...datos(f), actualizadaEn: ahora };
      if (hayQueUbicar(o)) Object.assign(upd, coord(f));
      if (!o.asignacionManual && o.estado !== 'cerrada') {
        const t = tec(f.codigoTecnico);
        upd.asignadoUid = t ? t.id : null;
        upd.asignadoNombre = t ? t.displayName : null;
      }
      ops.push(b => b.update(db.collection(COL_ORDENES).doc(o.id), upd));
    });
    lbl.textContent = 'Guardando…';
    for (let i = 0; i < ops.length; i += 400) {
      const lote = db.batch();
      ops.slice(i, i + 400).forEach(op => op(lote));
      await lote.commit();
    }
    // 3. Recordar el cruce usuario DELSUR -> técnico
    await db.collection(COL_CONFIG).doc('general').set({ codigosDelsur: mapeo_ }, { merge: true });

    document.getElementById(ID).classList.remove('open');
    const sinPunto = aUbicar.length - p.porPadron.size - geo.size;
    toast(`Factibilidades: ${p.nuevas.length} nuevas, ${p.existentes.length} actualizadas`
      + (aUbicar.length ? ` · ${p.porPadron.size} ubicadas con el padrón` + (geo.size ? `, ${geo.size} por dirección` : '') + (sinPunto ? `, ${sinPunto} sin punto nuevo` : '') : ''), 'ok', 6000);
  } catch (e) {
    console.error('[factibilidades] importar:', e);
    error('No se pudo importar: ' + e.message + '. Lo que alcanzó a guardarse queda; puedes volver a subir el archivo.');
  } finally {
    btn.disabled = false;
    if (plan_) lbl.textContent = 'Importar';
  }
}

// ── Asignar por usuario DELSUR (en cualquier momento) ─────
// Pasa TODAS las órdenes abiertas de un usuario DELSUR (DGUERR, AAPERE…) a
// un técnico, y deja guardado el cruce para las próximas importaciones.
const ID_COD = 'fb-sheet-codigos';

export async function abrirAsignarCodigos(session, tecnicos, abiertas) {
  const tecs = [...(tecnicos || [])].sort((a, b) => String(a.displayName).localeCompare(String(b.displayName), 'es'));
  const porCod = new Map();
  (abiertas || []).forEach(o => {
    const c = String(o.codigoTecnico || '').toUpperCase();
    if (!c) return;
    if (!porCod.has(c)) porCod.set(c, []);
    porCod.get(c).push(o);
  });
  let mapeo = {};
  try {
    const d = await db.collection(COL_CONFIG).doc('general').get();
    mapeo = { ...(d.exists ? (d.data().codigosDelsur || {}) : {}) };
  } catch {}

  let sh = document.getElementById(ID_COD);
  if (!sh) {
    sh = document.createElement('div');
    sh.className = 'sheet-backdrop';
    sh.id = ID_COD;
    sh.addEventListener('click', e => { if (e.target === sh) sh.classList.remove('open'); });
    document.body.appendChild(sh);
  }
  const codigos = [...porCod.keys()].sort();
  const nombre = uid => tecs.find(t => t.id === uid)?.displayName || '';
  sh.innerHTML = `<div class="sheet" style="max-height:92vh"><div class="sheet-handle"></div>
    <div class="sheet-title">Asignar por usuario DELSUR</div>
    <div class="sheet-body">
      <div style="font-size:12px;color:var(--text-4);margin-bottom:12px;line-height:1.6">
        Elige a qué técnico van <b>todas</b> las órdenes abiertas de cada usuario. Queda guardado para las próximas importaciones.
      </div>
      ${codigos.length ? codigos.map(cod => {
        const lista = porCod.get(cod);
        const actuales = [...new Set(lista.map(o => o.asignadoNombre || 'Sin asignar'))];
        return `
        <div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;align-items:center;gap:10px">
            <div style="flex:1;min-width:0">
              <div style="font-size:13px;font-weight:700;font-family:monospace">${esc(cod)}</div>
              <div style="font-size:11px;color:var(--text-3)">${lista.length} abierta${lista.length !== 1 ? 's' : ''} · hoy: ${esc(actuales.slice(0, 2).join(', '))}${actuales.length > 2 ? '…' : ''}</div>
            </div>
            <select class="form-input" data-cod="${esc(cod)}" style="max-width:52%;padding:8px 10px">
              <option value="">Elegir técnico…</option>
              ${tecs.map(t => `<option value="${esc(t.id)}" ${t.id === mapeo[cod] ? 'selected' : ''}>${esc(t.displayName)}</option>`).join('')}
            </select>
          </div>
          <button class="cm-btn marca" data-aplicar="${esc(cod)}" style="width:100%;margin-top:8px">Pasar las ${lista.length} a este técnico</button>
        </div>`;
      }).join('') : '<div style="font-size:13px;color:var(--text-3)">No hay órdenes abiertas con usuario DELSUR.</div>'}
      <div style="font-size:11.5px;color:var(--text-3);margin-top:12px;line-height:1.5">¿No aparece el técnico? Asígnale el área <b>Factibilidades</b> en Usuarios y vuelve a abrir esta pantalla.</div>
    </div></div>`;
  sh.querySelectorAll('[data-aplicar]').forEach(btn => btn.onclick = async () => {
    const cod = btn.dataset.aplicar;
    const uid = sh.querySelector(`select[data-cod="${CSS.escape(cod)}"]`).value;
    if (!uid) { toast('Elige el técnico primero', 'warn'); return; }
    const lista = porCod.get(cod);
    if (!confirm(`¿Pasar las ${lista.length} órdenes abiertas de ${cod} a ${nombre(uid)}?\n\nIncluye las que se hayan reasignado a mano.`)) return;
    btn.disabled = true;
    btn.textContent = 'Guardando…';
    try {
      const datos = {
        asignadoUid: uid, asignadoNombre: nombre(uid), asignacionManual: false,
        reasignadoPor: session.displayName, reasignadoEn: firebase.firestore.Timestamp.now(),
      };
      for (let i = 0; i < lista.length; i += 400) {
        const lote = db.batch();
        lista.slice(i, i + 400).forEach(o => lote.update(db.collection(COL_ORDENES).doc(o.id), datos));
        await lote.commit();
      }
      mapeo[cod] = uid;
      await db.collection(COL_CONFIG).doc('general').set({ codigosDelsur: mapeo }, { merge: true });
      toast(`${lista.length} órdenes de ${cod} pasadas a ${nombre(uid)}`, 'ok');
      btn.textContent = 'Listo';
    } catch (e) {
      toast('No se pudo guardar: ' + e.message, 'error');
      btn.disabled = false;
      btn.textContent = `Pasar las ${lista.length} a este técnico`;
    }
  });
  sh.classList.add('open');
}
