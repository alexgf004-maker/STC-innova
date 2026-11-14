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
 * Formato "Fact mapa" (también se acepta): Nombre completo, Meddior, Marca
 * MD, DS/CT, Municipio, Población, Distrito, Calle, Nº (edificio), Calle 4,
 * Texto cabecera de la orden (mismo código), Fe.aviso (fecha base del
 * semáforo: no trae liberación), Orden, Clase de actividad PM, Usuario
 * (usuario DELSUR) y Lat/Long (solo para los que ya tienen medidor: se usan
 * tal cual). El departamento sale del municipio (DEPTO_DE).
 *
 * Reemplazar mapa (por defecto, como en Cambios): DELSUR manda cada vez el
 * listado vigente. Lo cerrado no se toca; lo que sigue en el archivo se
 * actualiza; lo nuevo entra; y las ABIERTAS que ya no vienen salen del mapa.
 * No se borran: quedan con estado 'quitada' (y estadoAntesDeQuitar), así se
 * conserva su historial de visitas, y si DELSUR las vuelve a mandar, se
 * reactivan solas. Las devueltas por la oficina se conservan aunque no
 * vengan. "Solo agregar y actualizar" no quita nada.
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

// Formato nuevo (trae Municipio y no Centro planif.): municipio -> departamento.
// Nombres de municipio anteriores a la reforma, que son los que usa DELSUR.
const DEPTO_DE = {};
[
  ['La Libertad', 'La Libertad, Teotepeque, Chiltiupan, Tamanique, Jicalapa, Antiguo Cuscatlan, Nuevo Cuscatlan, Santa Tecla, Quezaltepeque, San Jose Villanueva, Huizucar, Zaragoza, Colon, Comasagua, Jayaque, Talnique, Tepecoyo, Sacacoyo, Ciudad Arce, San Juan Opico, San Pablo Tacachico, San Matias'],
  ['La Paz', 'Zacatecoluca, Santiago Nonualco, San Pedro Nonualco, San Juan Nonualco, San Rafael Obrajuelo, San Luis La Herradura, San Luis Talpa, San Juan Talpa, Santa Maria Ostuma, San Pedro Masahuat, San Antonio Masahuat, Olocuilta, El Rosario, Cuyultitan, Tapalhuaca, San Juan Tepezontes, San Miguel Tepezontes, San Emigdio, Paraiso de Osorio, San Francisco Chinameca, Jerusalen, Mercedes La Ceiba'],
  ['San Salvador', 'San Salvador, Panchimalco, Rosario de Mora, San Marcos, Santo Tomas, Santiago Texacuangos, Soyapango, Mejicanos, Ilopango, Apopa, Ayutuxtepeque, Cuscatancingo, Ciudad Delgado, Guazapa, Aguilares, El Paisnal, Nejapa, San Martin, Tonacatepeque'],
  ['San Vicente', 'San Vicente, Tecoluca, Apastepeque, Guadalupe, San Cayetano Istepeque, Verapaz, Tepetitan, San Ildefonso, Santa Clara, San Esteban Catarina, San Sebastian, Santo Domingo, San Lorenzo'],
].forEach(([dep, lista]) => lista.split(',').forEach(m => { DEPTO_DE[norm(m)] = dep; }));

let filas_ = [], plan_ = null, tecnicos_ = [], session_ = null, mapeo_ = {}, archivo_ = '', usarGoogle_ = false, modo_ = 'reemplazar';

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

// "1.2.1.1.[NC].1.[teléfono].1.[referencia]" -> { nc, telefono, referencia }
// La referencia es lo último: MD... (medidor del vecino), NC... (su
// contrato), DS.../CT... (poste o transformador) o un número solo, que se
// busca como medidor, contrato y DS (ver ubicaciones.js).
function leerCodigo(t) {
  const partes = String(t || '').split('.').map(x => x.trim());
  const telefono = partes.find(x => /^[267]\d{7}$/.test(x)) || '';
  const ult = partes[partes.length - 1] || '';
  const ref = ult && ult !== telefono && !/^\d{1,2}$/.test(ult) ? ult.replace(/\s+/g, '').toUpperCase() : '';
  // "DS" o "MD" sin número no sirven de referencia
  const referencia = /\d/.test(ref) ? ref : '';
  const nc = /^\d{6,}$/.test(partes[4] || '') ? partes[4] : '';
  return { nc, telefono, referencia };
}

export function leerExcel(rows) {
  let h = -1;
  for (let i = 0; i < Math.min(rows.length, 6); i++) if ((rows[i] || []).some(x => norm(x) === 'ORDEN')) { h = i; break; }
  if (h === -1) return { error: 'No se encontró la columna "Orden". ¿Es el Excel de Factibilidades?' };
  const H = (rows[h] || []).map(norm);
  const c = (...a) => H.findIndex(x => a.includes(x));
  // Dos formatos de DELSUR: el primero (Contrato, Aviso, Liberación real,
  // Texto breve, Centro planif.) y el de "Fact mapa" (Texto cabecera,
  // Municipio, Nº, Usuario, Lat/Long para los que ya tienen medidor).
  const ix = {
    orden: c('ORDEN'), nc: c('CONTRATO'), aviso: c('AVISO'), fAviso: c('FECHA DE AVISO', 'FE.AVISO', 'FE. AVISO'), fLib: c('LIBERACION REAL'),
    texto: c('TEXTO BREVE', 'TEXTO CABECERA DE LA ORDEN'), centro: c('CENTRO PLANIF.', 'CENTRO PLANIF'),
    municipio: c('MUNICIPIO'), poblacion: c('POBLACION'), distrito: c('DISTRITO'), calle: c('CALLE'),
    numero: c('Nº (EDIFICIO)', 'NO (EDIFICIO)', 'N (EDIFICIO)', 'NUMERO'), calle2: c('CALLE 4', 'CALLE 2', 'CALLE 3'),
    cliente: c('DESCRIPCION', 'NOMBRE COMPLETO', 'NOMBRE'), serie: c('NUMERO DE SERIE', 'MEDIDOR', 'MEDDIOR'),
    marca: c('FABRICANTE', 'MARCA MD', 'MARCA'), dsct: c('UBIC.TECN.', 'DS/CT'),
    codigo: c('PTO.TBJO.RESP.', 'USUARIO'), clase: c('CLASE DE ACTIVIDAD PM'),
    lat: c('LAT', 'LATITUD'), lng: c('LONG', 'LONGITUD'),
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
    const calle = [v(r, ix.calle), v(r, ix.numero)].filter(Boolean).join(' ');
    const calle2 = v(r, ix.calle2), distrito = v(r, ix.distrito), poblacion = v(r, ix.poblacion), municipio = v(r, ix.municipio);
    const departamento = CENTROS[v(r, ix.centro)] || DEPTO_DE[norm(municipio)] || '';
    // Coordenadas del archivo (las trae para clientes que ya tienen medidor)
    const lat = ix.lat >= 0 ? parseFloat(String(r[ix.lat]).replace(',', '.')) : NaN;
    const lng = ix.lng >= 0 ? parseFloat(String(r[ix.lng]).replace(',', '.')) : NaN;
    const coordOk = lat > 12.9 && lat < 14.6 && lng > -90.3 && lng < -87.5;
    const lugar = municipio && norm(municipio) !== norm(poblacion) ? [poblacion, municipio] : [poblacion];
    filas.push({
      numeroOrden,
      nc: v(r, ix.nc) || cod.nc,
      aviso: v(r, ix.aviso),
      cliente: v(r, ix.cliente),
      direccion: [calle, calle2, distrito, ...lugar].filter(Boolean).join(', '),
      departamento,
      claseActividad: v(r, ix.clase).replace(/^Factibilidad\s+/i, ''),
      _coord: coordOk ? { lat, lng } : null,
      // Consultas para Google, de la más detallada a la más general (sin nombre del cliente).
      _geo: {
        zona: departamento,
        consultas: [
          [calle, distrito, ...lugar, departamento],
          [distrito, ...lugar, departamento],
          [...lugar, departamento],
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
      // El formato nuevo no trae liberación: los días (DíasTransc de DELSUR)
      // se cuentan desde el aviso, así que esa es la fecha base del semáforo.
      fechaLiberacion: fechaExcel(ix.fLib >= 0 ? r[ix.fLib] : (ix.fAviso >= 0 ? r[ix.fAviso] : '')),
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
  const [ex, cfg, clave, abNull, abVisita] = await Promise.all([
    existentesPorOrden(filas.map(f => f.numeroOrden)),
    db.collection(COL_CONFIG).doc('general').get().catch(() => null),
    leerClave().catch(() => ''),
    db.collection(COL_ORDENES).where('estado', '==', null).get(),
    db.collection(COL_ORDENES).where('estado', '==', 'visita').get(),
  ]);
  // Abiertas que ya no vienen en el archivo (salen al reemplazar el mapa).
  // Las que la oficina devolvió al técnico se conservan.
  const enArchivo = new Set(filas.map(f => f.numeroOrden));
  const quitar = [], conservadas = [];
  [...abNull.docs, ...abVisita.docs].forEach(d => {
    const o = { id: d.id, ...d.data() };
    if (enArchivo.has(String(o.numeroOrden ?? '').trim())) return;
    (o.revision === 'devuelta' ? conservadas : quitar).push(o);
  });
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
  // Las que traen coordenadas en el archivo no se buscan: se usan esas
  const aUbicar = [...nuevas, ...existentes.filter(({ o }) => hayQueUbicar(o)).map(({ f }) => f)].filter(f => !f._coord);
  const conCoordArchivo = filas.filter(f => f._coord).length;
  const codigosDe = f => ({ nc: f.nc, medidor: f.serieActual, referencia: f.referencia, ds: f.dsct });
  const porPadron = new Map();
  let fuentes = [], resumenPadron = null, fallos = {};
  const porMotivo = {};
  if (aUbicar.length) {
    const r = await cargarIndiceUbicaciones(idx => aUbicar.some(f => !ubicarPorCodigos(idx, codigosDe(f))));
    fuentes = r.fuentes;
    resumenPadron = r.resumen;
    fallos = r.fallos || {};
    aUbicar.forEach(f => {
      const u = ubicarPorCodigos(r.indice, codigosDe(f));
      if (u) porPadron.set(f.numeroOrden, u);
      else { const m = motivoSinUbicar(codigosDe(f)); porMotivo[m] = (porMotivo[m] || 0) + 1; }
    });
  }
  const porFuente = {};
  porPadron.forEach(u => { porFuente[u.fuente] = (porFuente[u.fuente] || 0) + 1; });
  return {
    nuevas, existentes, codigos, hayClave: !!clave, quitar, conservadas,
    reactivar: existentes.filter(({ o }) => o.estado === 'quitada').length,
    cerradasEnArchivo: existentes.filter(({ o }) => o.estado === 'cerrada').length,
    aUbicar: aUbicar.length, conCoordArchivo, porPadron, porFuente, porMotivo, resumenPadron, fuentes, fallos, sinPadronUbic: !fuentes.includes('ubicaciones'),
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
  filas_ = []; plan_ = null; modo_ = 'reemplazar';
  const sh = hoja();
  sh.querySelector('#fbi-cuerpo').innerHTML = `
    <div style="font-size:12px;color:var(--text-4);margin-bottom:14px;line-height:1.6">
      Excel de DELSUR (Orden, Aviso, Población, Distrito, Calle…). Reemplaza el mapa: lo cerrado se conserva, las órdenes que ya están no se duplican y lo reasignado a mano se respeta.
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

// Qué pasó con los padrones al buscar ubicaciones: el motivo real si una
// lectura falló (conexión, permiso, padrón incompleto) o si no está subido.
const NOMBRE_PADRON = { ubicaciones: 'ubicaciones', caracterizacion: 'Caracterización', contiguos: 'Contiguos' };
const MOTIVO_FALLO = {
  conexion: 'falló la conexión a internet',
  permiso: 'tu usuario no tiene permiso para leerlo, según las reglas de Firestore',
  incompleto: 'está incompleto, faltan partes de la última subida (vuelve a subirlo en el menú, Padrones de clientes)',
};
function avisoPadrones(p) {
  const f = p.fallos || {};
  const linea = (txt, color = '#fbbf24') => `<div style="font-size:11.5px;color:${color};margin-top:6px">${txt}</div>`;
  const motivo = x => MOTIVO_FALLO[x.error] || `error al leerlo (${esc(x.detalle || 'desconocido')})`;
  const partes = [];
  if (f.ubicaciones) partes.push(linea(`No se pudo leer el padrón de ubicaciones: ${motivo(f.ubicaciones)}. Estas órdenes se buscaron solo en Caracterización y Contiguos.`, '#f87171'));
  else if (p.sinPadronUbic) partes.push(linea('Todavía no está el padrón de ubicaciones: súbelo en el menú, Padrones de clientes. Por ahora solo se busca en Caracterización y Contiguos.'));
  const otros = Object.keys(f).filter(k => k !== 'ubicaciones');
  if (otros.length) partes.push(linea(`Tampoco se pudo leer: ${otros.map(k => `${NOMBRE_PADRON[k]} (${motivo(f[k])})`).join(' · ')}.`, '#f87171'));
  if (Object.keys(f).length) partes.push(`<a href="#" id="fbi-reintentar" style="display:inline-block;margin-top:6px;font-size:12px;font-weight:600;color:#60a5fa">Volver a intentar</a>`);
  return partes.join('');
}

// Vuelve a armar el plan (por ejemplo, después de una falla de conexión),
// sin perder el modo ni los técnicos elegidos.
async function reintentarPlan(e) {
  e?.preventDefault();
  const elegidos = { ...mapeo_ }, repetidas = plan_?.repetidas;
  const plan = document.getElementById('fbi-plan');
  plan.innerHTML = '<div class="import-info-box"><div class="import-info-label">Buscando ubicaciones otra vez…</div></div>';
  document.getElementById('fbi-ok').style.display = 'none';
  try {
    plan_ = await armarPlan(filas_);
    plan_.repetidas = repetidas;
    Object.assign(mapeo_, elegidos);
    pintarPlan();
  } catch (er) {
    plan.innerHTML = '';
    error('No se pudo volver a comparar: ' + er.message);
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
  const reemplazar = modo_ === 'reemplazar';
  const siguen = p.existentes.length - p.reactivar - p.cerradasEnArchivo;
  const qAsig = p.quitar.filter(o => o.asignadoUid).length, qVisita = p.quitar.filter(o => o.estado === 'visita').length;
  document.getElementById('fbi-plan').innerHTML = `
    <div style="font-size:11px;color:var(--text-4);margin:10px 0 6px">${esc(archivo_)} · ${filas_.length} órdenes</div>
    <div style="display:flex;gap:6px;margin-bottom:6px">
      <button class="cm-est ${reemplazar ? 'active' : ''}" data-modo="reemplazar" style="flex:1">Reemplazar mapa</button>
      <button class="cm-est ${reemplazar ? '' : 'active'}" data-modo="agregar" style="flex:1">Solo agregar y actualizar</button>
    </div>
    ${fila(p.nuevas.length, 'Órdenes nuevas', 'Entran abiertas, con la fecha de liberación del Excel', 'var(--fb-light, #f472b6)')}
    ${fila(siguen, 'Siguen en el mapa', 'Se actualizan sus datos; estado, resultado y reasignaciones manuales se respetan', '#60a5fa')}
    ${p.reactivar ? fila(p.reactivar, 'Vuelven al mapa', 'Se habían quitado en una carga anterior y DELSUR las vuelve a mandar', '#a78bfa') : ''}
    ${p.cerradasEnArchivo ? fila(p.cerradasEnArchivo, 'Ya cerradas', 'Se quedan como están (resultado e historial intactos)', '#22c55e') : ''}
    <div style="${reemplazar ? '' : 'opacity:.4'}">${fila(p.quitar.length, 'Abiertas que ya no vienen', reemplazar
      ? `Salen del mapa y de las listas${qAsig ? ` · ${qAsig} estaban asignadas a un técnico` : ''}${qVisita ? ` · ${qVisita} con visita sin acceso` : ''}. No se borran: si vuelven en otra carga, se reactivan`
      : 'Con "Solo agregar y actualizar" se quedan', '#f87171')}</div>
    ${p.conservadas.length ? fila(p.conservadas.length, 'Devueltas por la oficina fuera del archivo', 'Se conservan', 'var(--text-3)') : ''}
    ${p.conCoordArchivo ? fila(p.conCoordArchivo, 'Con coordenadas en el archivo', 'Ya tienen medidor: se ubican en su punto exacto (no se toca una ubicación corregida en el sitio)', '#22c55e') : ''}
    ${p.aUbicar ? fila(p.porPadron.size, 'Ubicadas con el padrón', Object.entries(p.porFuente).map(([f, n]) => `${n} por ${esc(f)}`).join(' · ') || 'Ninguna referencia se encontró en los padrones', '#22c55e') : ''}
    ${p.aUbicar - p.porPadron.size ? fila(p.aUbicar - p.porPadron.size, 'Sin encontrar en el padrón', textoMotivos(p.porMotivo) + (usarGoogle_ ? 'Se ubican por dirección con Google (muy aproximado).' : 'Entran sin punto nuevo en el mapa; el técnico fija la ubicación en el sitio.')
      + (p.hayClave ? `<label style="display:flex;align-items:center;gap:8px;margin-top:6px;color:var(--text-2)"><input type="checkbox" id="fbi-google" ${usarGoogle_ ? 'checked' : ''}/> Ubicarlas por dirección con Google</label>`
        : ' <a href="#" id="fbi-clave" style="color:#60a5fa">Poner clave de Google</a>'), '#fbbf24') : ''}
    ${p.resumenPadron ? `<div style="font-size:11px;color:var(--text-4);margin-top:6px">Padrón de ubicaciones: ${n(p.resumenPadron.filas)} registros · con NC ${n(p.resumenPadron.nc)} · con medidor ${n(p.resumenPadron.md)} · con DS ${n(p.resumenPadron.ds)}</div>` : ''}
    ${p.aUbicar ? avisoPadrones(p) : ''}
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
  document.querySelectorAll('#fbi-plan [data-modo]').forEach(b => b.onclick = () => { modo_ = b.dataset.modo; pintarPlan(); });
  const reint = document.getElementById('fbi-reintentar');
  if (reint) reint.onclick = reintentarPlan;
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
  document.getElementById('fbi-ok-lbl').textContent = textoBoton();
}

const textoBoton = () => modo_ === 'reemplazar' ? 'Reemplazar mapa'
  : plan_?.nuevas.length ? `Importar ${plan_.nuevas.length} nueva${plan_.nuevas.length !== 1 ? 's' : ''}` : 'Actualizar datos';

// ── Guardar ───────────────────────────────────────
async function importar() {
  const p = plan_;
  if (!p) return;
  const reemplazar = modo_ === 'reemplazar';
  if (reemplazar && p.quitar.length) {
    const asig = p.quitar.filter(o => o.asignadoUid).length;
    if (!confirm(`Saldrán del mapa ${p.quitar.length} órdenes abiertas que ya no vienen en el archivo${asig ? ` (${asig} asignadas a técnicos)` : ''}.\n\nLo cerrado no se toca y no se borra nada: si vuelven en otra carga, se reactivan. ¿Reemplazar el mapa?`)) return;
  }
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
    ].filter(x => !x.f._coord);
    const geo = new Map();
    const resto = aUbicar.filter(x => !p.porPadron.has(x.f.numeroOrden));
    if (resto.length && p.hayClave && usarGoogle_) {
      const res = await geocodificar(resto.map(x => x.f._geo),
        (i, t) => { lbl.textContent = `Ubicando ${i}/${t}…`; });
      res.forEach((r, i) => { if (r) geo.set(resto[i].f.numeroOrden, r); });
    }
    const coord = f => {
      if (f._coord) return { latitud: f._coord.lat, longitud: f._coord.lng, ubicacionAprox: false, ubicacionFuente: 'excel', ubicacionNivel: '', ubicacionTipo: '' };
      const u = p.porPadron.get(f.numeroOrden);
      if (u) return { latitud: u.lat, longitud: u.lng, ubicacionAprox: !u.exacta, ubicacionFuente: 'padron', ubicacionNivel: u.fuente, ubicacionTipo: '' };
      const r = geo.get(f.numeroOrden);
      return r ? { latitud: r.lat, longitud: r.lng, ubicacionAprox: true, ubicacionFuente: 'direccion', ubicacionTipo: r.tipo, ubicacionNivel: r.nivel || '' } : {};
    };
    const datos = f => ({
      numeroOrden: f.numeroOrden, nc: f.nc, aviso: f.aviso, cliente: f.cliente, direccion: f.direccion, departamento: f.departamento,
      telefono: f.telefono, referencia: f.referencia, serieActual: f.serieActual, marca: f.marca, dsct: f.dsct,
      codigoTecnico: f.codigoTecnico, fechaAviso: ts(f.fechaAviso), fechaLiberacion: ts(f.fechaLiberacion),
      claseActividad: f.claseActividad || '',
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
    const borrar = firebase.firestore.FieldValue.delete();
    p.existentes.forEach(({ f, o }) => {
      const upd = { ...datos(f), actualizadaEn: ahora };
      // Quitada en una carga anterior y DELSUR la vuelve a mandar: se reactiva
      if (o.estado === 'quitada') Object.assign(upd, {
        estado: o.estadoAntesDeQuitar === 'visita' ? 'visita' : null,
        estadoAntesDeQuitar: borrar, quitadaEn: borrar, quitadaPor: borrar, quitadaArchivo: borrar, reactivadaEn: ahora,
      });
      // Coordenadas del archivo: mandan, salvo que alguien corrigió el punto en el sitio
      if (f._coord ? !o.coordCorregida : hayQueUbicar(o)) Object.assign(upd, coord(f));
      if (!o.asignacionManual && o.estado !== 'cerrada') {
        const t = tec(f.codigoTecnico);
        upd.asignadoUid = t ? t.id : null;
        upd.asignadoNombre = t ? t.displayName : null;
      }
      ops.push(b => b.update(db.collection(COL_ORDENES).doc(o.id), upd));
    });
    if (reemplazar) p.quitar.forEach(o => ops.push(b => b.update(db.collection(COL_ORDENES).doc(o.id), {
      estado: 'quitada', estadoAntesDeQuitar: o.estado ?? null,
      quitadaEn: ahora, quitadaPor: session_.displayName, quitadaArchivo: archivo_,
    })));
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
    toast(`Factibilidades: ${p.nuevas.length} nuevas, ${p.existentes.length} actualizadas${reemplazar && p.quitar.length ? `, ${p.quitar.length} quitadas del mapa` : ''}${p.reactivar ? `, ${p.reactivar} de vuelta` : ''}`
      + (aUbicar.length ? ` · ${p.porPadron.size} ubicadas con el padrón` + (geo.size ? `, ${geo.size} por dirección` : '') + (sinPunto ? `, ${sinPunto} sin punto nuevo` : '') : ''), 'ok', 6000);
  } catch (e) {
    console.error('[factibilidades] importar:', e);
    error('No se pudo importar: ' + e.message + '. Lo que alcanzó a guardarse queda; puedes volver a subir el archivo.');
  } finally {
    btn.disabled = false;
    if (plan_) lbl.textContent = textoBoton();
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
