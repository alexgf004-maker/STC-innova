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
import { toast } from '../ui.js';

// ── Identidad del área ────────────────────────────
const AREA = 'AMI';
const COLECCION = 'ami_ordenes';        // colección propia en Firestore
const ACCENT = '#a78bfa';               // morado/violeta (distinto de las otras áreas)
const ACCENT_GLASS = 'rgba(139,92,246,.12)';
const ACCENT_BORDER = 'rgba(139,92,246,.35)';

// Parejas (mismas que Cambios; se ajustará si AMI usa otras cuadrillas)
const PAREJAS = ['Pareja 1', 'Pareja 2', 'Pareja 3', 'Pareja 4'];
const PALETA_PAREJA = ['#2dd4bf', '#fbbf24', '#a78bfa', '#f472b6', '#60a5fa'];
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

// ── Estado del módulo ─────────────────────────────
let container_, session_, role_, pareja_;
let ordenes_ = [];
let activeTab_ = 'panel';   // 'panel' | 'ordenes' | 'mapa'
let esAdmin_ = false;

// ── Entry point ───────────────────────────────────
export async function init(container, session) {
  container_ = container;
  session_   = session;
  role_      = session.role;
  esAdmin_   = role_ === 'admin' || role_ === 'asistente';
  pareja_    = session.asignacionActual?.destino || null;
  activeTab_ = esAdmin_ ? 'panel' : 'resumen';

  renderShell();
  await cargarOrdenes();
  setTab(activeTab_);
}

// ── Cargar órdenes (lee la colección; aún puede estar vacía) ──
async function cargarOrdenes() {
  try {
    // Cargar el padrón de NC ya cambiados (para marcar/esconder)
    let padron = new Set();
    try {
      const pad = await db.collection('ami_cambiados').get();
      padron = new Set(pad.docs.map(d => String(d.data().nc ?? d.id).trim()));
    } catch (e) { /* si no existe aún, padrón vacío */ }

    const snap = await db.collection(COLECCION).get();
    let todas = snap.docs.map(d => ({ id: d.id, ...d.data() }));
    // El técnico ve solo las órdenes de su pareja
    if (!esAdmin_) {
      todas = pareja_ ? todas.filter(o => o.pareja === pareja_) : [];
    }
    // Cruce con el padrón: marcar ya cambiadas; al técnico se le esconden
    todas.forEach(o => { o._yaCambiada = padron.has(String(o.nc ?? '').trim()); });
    if (!esAdmin_) todas = todas.filter(o => !o._yaCambiada);
    ordenes_ = todas;
  } catch (err) {
    // Si la colección aún no existe o no hay permisos, no rompemos el cascarón
    console.warn('[ami] No se pudieron cargar órdenes todavía:', err.message);
    ordenes_ = [];
  }
}

// ── Shell (pestañas + contenedor) ─────────────────
function renderShell() {
  const tabs = esAdmin_
    ? [{ id: 'panel', label: 'Panel' }, { id: 'ordenes', label: 'Órdenes' }, { id: 'mapa', label: 'Mapa' }]
    : [{ id: 'resumen', label: 'Resumen' }, { id: 'ordenes', label: 'Órdenes' }];

  container_.innerHTML = `
    <div class="area-tabs" style="margin-bottom:14px">
      ${tabs.map((t, i) => `
        <button class="area-tab ami-tab ${i === 0 ? 'active am' : ''}" data-tab="${t.id}">${t.label}</button>
      `).join('')}
    </div>
    <div id="ami-content"></div>`;

  container_.querySelectorAll('.ami-tab').forEach(tab => {
    tab.onclick = () => setTab(tab.dataset.tab);
  });
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
    // Montar el mapa real (mismo módulo que usa el técnico)
    cont.innerHTML = '';
    import('./ami_mapa.js')
      .then(mod => mod.init(cont, session_))
      .catch(err => {
        cont.innerHTML = bloquePreparacion('No se pudo cargar el mapa', 'Intenta de nuevo en un momento.');
        console.warn('[ami] Error cargando ami_mapa:', err.message);
      });
  }
  else if (tab === 'ordenes') cont.innerHTML = renderOrdenes();
  else {
    cont.innerHTML = renderPanel();
    // Enganchar el botón de importar ruta (solo admin)
    const btn = cont.querySelector('#ami-btn-importar');
    const file = cont.querySelector('#ami-file-importar');
    if (btn && file) {
      btn.onclick = () => file.click();
      file.onchange = (e) => importarRuta(e.target.files[0]);
    }
    const btnH = cont.querySelector('#ami-btn-historial');
    const fileH = cont.querySelector('#ami-file-historial');
    if (btnH && fileH) {
      btnH.onclick = () => fileH.click();
      fileH.onchange = (e) => importarHistorial(e.target.files[0]);
    }
  }
}

// ── Panel (resumen del área) ──────────────────────
function renderPanel() {
  const total = ordenes_.length;
  const hechas = ordenes_.filter(o => o.estadoCampo === 'hecha' || o.estadoCampo === 'aprobada').length;
  const pend = ordenes_.filter(o => !o.estadoCampo && !o._yaCambiada).length;
  const residuos = ordenes_.filter(esResiduo).length;
  const yaCambiadas = ordenes_.filter(o => o._yaCambiada).length;
  const pct = total ? Math.round((hechas / total) * 100) : 0;

  return `
    <div class="welcome-card am" style="border-color:${ACCENT_BORDER};background:${ACCENT_GLASS};border-radius:16px;padding:18px;margin-bottom:16px">
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:6px">
        <div style="width:10px;height:10px;border-radius:50%;background:${ACCENT}"></div>
        <div style="font-size:16px;font-weight:800;color:${ACCENT}">AMI · Medidores telegestionados</div>
      </div>
      <div style="font-size:12px;color:var(--text-3);line-height:1.5">
        Cambio de medidores remotos, en campaña separada. Las órdenes se identifican por NC.
      </div>
    </div>

    ${esAdmin_ ? `
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <button id="ami-btn-importar" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:12px;border-radius:12px;border:1px solid ${ACCENT_BORDER};background:${ACCENT_GLASS};color:${ACCENT};font-size:13px;font-weight:700;cursor:pointer;font-family:inherit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
        Cargar ruta (Excel)
      </button>
      <input type="file" id="ami-file-importar" accept=".xlsx,.xls" style="display:none"/>
    </div>
    <div style="display:flex;gap:8px;margin-bottom:16px">
      <button id="ami-btn-historial" style="flex:1;display:flex;align-items:center;justify-content:center;gap:8px;padding:11px;border-radius:12px;border:1px solid rgba(22,163,74,.35);background:rgba(22,163,74,.1);color:#16a34a;font-size:12px;font-weight:700;cursor:pointer;font-family:inherit">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="9"/></svg>
        Cargar historial (Excel)
      </button>
      <input type="file" id="ami-file-historial" accept=".xlsx,.xls" style="display:none"/>
    </div>` : ''}

    ${total === 0
      ? bloquePreparacion('Aún no hay órdenes cargadas',
          'Cuando se cargue el listado de órdenes de AMI, aquí verás el avance por cuadrilla y el estado del día, igual que en Cambios.')
      : `
      <div class="progress-card" style="margin-bottom:16px">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:10px">
          <div style="font-size:13px;font-weight:700">Avance del día</div>
          <div style="font-size:12px;color:var(--text-4)">${hechas} de ${total} · ${pct}%</div>
        </div>
        <div class="progress-bar-bg">
          <div class="progress-bar-fill" style="width:${pct}%;background:${ACCENT}"></div>
        </div>
        <div class="progress-stats" style="margin-top:10px">
          <span><span class="stat-dot muted"></span>${pend} pendientes</span>
          <span><span class="stat-dot ok"></span>${hechas} hechas</span>
          ${residuos ? `<span><span class="stat-dot" style="background:#f59e0b"></span>${residuos} arrastradas</span>` : ''}
          ${yaCambiadas ? `<span><span class="stat-dot" style="background:#16a34a"></span>${yaCambiadas} ya cambiadas</span>` : ''}
        </div>
      </div>`}`;
}

// ── Órdenes (lista) ───────────────────────────────
function renderOrdenes() {
  if (!ordenes_.length) {
    return bloquePreparacion('Sin órdenes por ahora',
      'El listado de órdenes AMI se cargará más adelante. Cada orden se identificará por su NC (estos medidores no traen WO).');
  }
  const residuos = ordenes_.filter(esResiduo);
  const resto = ordenes_.filter(o => !esResiduo(o));

  const tarjeta = (o) => {
    const dias = diasArrastrada(o);
    const residuo = esResiduo(o);
    return `
      <div class="orden-card" style="flex-direction:column;align-items:stretch;cursor:default;border-left:3px solid ${o._yaCambiada ? '#16a34a' : residuo ? '#f59e0b' : ACCENT}">
        <div style="display:flex;align-items:center;gap:10px;flex-wrap:wrap">
          <div class="orden-wo" style="color:${ACCENT}">NC ${o.nc || '—'}</div>
          ${o.cliente ? `<div class="orden-cliente" style="flex:1;min-width:120px">${o.cliente}</div>` : '<div style="flex:1"></div>'}
          ${o._yaCambiada ? `<span class="estado-badge ok" style="background:rgba(22,163,74,.15);border-color:rgba(22,163,74,.4);color:#16a34a">Ya cambiada</span>` : ''}
          ${residuo && !o._yaCambiada ? `<span class="estado-badge warn">Arrastrada &middot; ${dias} d&iacute;a${dias>1?'s':''}</span>` : ''}
          <div class="estado-badge ${o.estadoCampo === 'hecha' || o.estadoCampo === 'aprobada' ? 'ok' : 'muted'}">${o.estadoCampo || 'pendiente'}</div>
        </div>
        ${o.direccion ? `<div class="orden-dir" style="margin-top:6px">${o.direccion}</div>` : ''}
      </div>`;
  };

  const seccion = (titulo, arr, color) => arr.length ? `
    <div style="display:flex;align-items:center;gap:8px;margin:14px 0 8px">
      <div style="font-size:11px;font-weight:800;text-transform:uppercase;letter-spacing:.04em;color:${color}">${titulo}</div>
      <div style="flex:1;height:1px;background:var(--border)"></div>
      <div style="font-size:11px;color:var(--text-4)">${arr.length}</div>
    </div>
    <div style="display:flex;flex-direction:column;gap:8px">${arr.map(tarjeta).join('')}</div>` : '';

  return seccion('Arrastradas (rutas anteriores)', residuos, '#f59e0b')
       + seccion('Ruta actual', resto, ACCENT);
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

    if (!confirm(`Ruta con ${registros.length} órdenes:\n${nuevos.length} nuevas (se crean con fecha de hoy)\n${actualizar.length} ya existían (se actualizan sus datos)\n\n¿Continuar?`)) return;

    toast('Cargando ruta…', 'ok');
    const ahora = firebase.firestore.Timestamp.now();

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
          fechaRuta: ahora, importadaEn: ahora,
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
