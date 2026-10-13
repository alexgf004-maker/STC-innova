/**
 * js/views/factibilidades_acciones.js
 * Acciones del técnico sobre una orden de Factibilidades, compartidas por la
 * lista y el mapa: registrar resultado y corregir la ubicación con el GPS.
 *
 * Cada acción guarda quién y cuándo (trazabilidad). El técnico solo toca los
 * campos que permiten las reglas de Firestore (SPEC sección 10): nunca
 * latOriginal/lngOriginal (los guarda el importador una sola vez),
 * asignadoUid ni fechaLiberacion.
 */

import { db } from '../firebase.js';
import { COL_ORDENES } from '../factibilidades_comun.js';
import { toast, escapeHtml, guardarConEspera } from '../ui.js';

const esc = v => escapeHtml(v == null ? '' : String(v));
const ID_RESULTADO = 'fb-sheet-resultado';
const ID_GPS = 'fb-sheet-gps';
const ID_REASIGNAR = 'fb-sheet-reasignar';

export const RESULTADOS = {
  factible:    { texto: 'Factible',    pill: 'ok',   cierra: true,  obsObligatoria: false },
  no_factible: { texto: 'No factible', pill: 'crit', cierra: true,  obsObligatoria: true },
  sin_acceso:  { texto: 'Sin acceso',  pill: 'warn', cierra: false, obsObligatoria: true },
};

/** ¿Puede este usuario registrar resultado o corregir la ubicación? */
export function puedeActuar(o, session) {
  return !!o && session.role === 'tecnico' && o.asignadoUid === session.uid && o.estado !== 'cerrada';
}

function hoja(id, titulo, cuerpo) {
  document.getElementById(id)?.remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div class="sheet-backdrop" id="${id}">
      <div class="sheet">
        <div class="sheet-handle"></div>
        <div class="sheet-title">${titulo}</div>
        <div class="sheet-body" style="padding-bottom:16px">${cuerpo}</div>
      </div>
    </div>`);
  const sh = document.getElementById(id);
  sh.addEventListener('click', e => { if (e.target === sh) cerrar(id); });
  requestAnimationFrame(() => sh.classList.add('open'));
  return sh;
}

function cerrar(id) {
  if (id === ID_GPS) pararGps();
  const sh = document.getElementById(id);
  if (!sh) return;
  sh.classList.remove('open');
  setTimeout(() => sh.remove(), 250);
}

/** Quitar las hojas al salir de la vista. */
export function cerrarHojas() {
  pararGps();
  [ID_RESULTADO, ID_GPS, ID_REASIGNAR].forEach(id => document.getElementById(id)?.remove());
}

// ── Registrar resultado ───────────────────────────
// Factible y No factible cierran la orden. Sin acceso la deja abierta
// (sigue contando días) y suma la visita al historial.
export function abrirResultado(o, session, alGuardar) {
  if (!puedeActuar(o, session)) return;
  const sh = hoja(ID_RESULTADO, `Resultado · ${esc(o.numeroOrden || '')}`, `
    <div class="form-field">
      <div class="form-label">Resultado</div>
      <div class="select-row flex-wrap" id="fbr-opciones">
        ${Object.entries(RESULTADOS).map(([k, r]) => `<div class="select-chip" data-val="${k}">${r.texto}</div>`).join('')}
      </div>
    </div>
    <div class="form-field">
      <div class="form-label" id="fbr-obs-lbl">Observación</div>
      <textarea class="form-input" id="fbr-obs" rows="3" style="resize:none" placeholder="Qué se encontró en el sitio"></textarea>
    </div>
    <div style="font-size:12px;color:var(--text-3);line-height:1.5;margin:-2px 0 12px" id="fbr-ayuda"></div>
    <div class="form-error" id="fbr-error"></div>
    <button class="btn-primary full" id="fbr-guardar"><span id="fbr-guardar-lbl">Guardar resultado</span></button>`);

  let elegido = null;
  const ayuda = {
    factible:    'La orden se cierra como factible.',
    no_factible: 'La orden se cierra. Explica por qué no es factible.',
    sin_acceso:  'La orden sigue abierta y sigue contando días. Queda registrada la visita.',
  };
  sh.querySelectorAll('#fbr-opciones .select-chip').forEach(c => c.onclick = () => {
    sh.querySelectorAll('#fbr-opciones .select-chip').forEach(x => x.classList.toggle('active', x === c));
    elegido = c.dataset.val;
    sh.querySelector('#fbr-obs-lbl').textContent = RESULTADOS[elegido].obsObligatoria ? 'Observación *' : 'Observación (opcional)';
    sh.querySelector('#fbr-ayuda').textContent = ayuda[elegido];
    sh.querySelector('#fbr-error').style.display = 'none';
  });

  sh.querySelector('#fbr-guardar').onclick = async () => {
    const err = sh.querySelector('#fbr-error');
    const obs = sh.querySelector('#fbr-obs').value.trim();
    const falla = m => { err.textContent = m; err.style.display = 'block'; };
    if (!elegido) return falla('Elige el resultado.');
    const r = RESULTADOS[elegido];
    if (r.obsObligatoria && obs.length < 3) return falla('Escribe la observación: es obligatoria para "' + r.texto + '".');

    const btn = sh.querySelector('#fbr-guardar');
    btn.disabled = true;
    sh.querySelector('#fbr-guardar-lbl').innerHTML = '<div class="spinner"></div>';
    const ahora = firebase.firestore.Timestamp.now();
    const cambios = r.cierra
      ? { estado: 'cerrada', resultado: elegido, observacion: obs, fechaHecha: ahora, hechaPor: session.displayName }
      : { estado: 'visita', resultado: elegido, observacion: obs,
          visitas: firebase.firestore.FieldValue.arrayUnion({ fecha: ahora, tecnico: session.displayName, observacion: obs }) };
    try {
      await guardarConEspera(db.collection(COL_ORDENES).doc(o.id).update(cambios));
      cerrar(ID_RESULTADO);
      toast(r.cierra ? `Orden cerrada · ${r.texto}` : 'Visita sin acceso registrada', 'ok');
      if (alGuardar) alGuardar(elegido);
    } catch (e) {
      console.error('[factibilidades] resultado:', e);
      falla('No se pudo guardar: ' + e.message);
      btn.disabled = false;
      sh.querySelector('#fbr-guardar-lbl').textContent = 'Guardar resultado';
    }
  };
}

// ── Corregir ubicación con el GPS ─────────────────
// Estando en el sitio, toma la posición del teléfono como la coordenada
// correcta. La precisión se actualiza en vivo mientras la hoja está abierta
// (mejora a los pocos segundos) y se pide confirmar antes de guardar.
const PRECISION_BUENA = 25;    // metros
const PRECISION_MAXIMA = 100;  // con más error que esto no se deja guardar
let pararGps_ = null;
function pararGps() { if (pararGps_) { try { pararGps_(); } catch {} pararGps_ = null; } }

// Fuente de posiciones: fn(ok, fallo) -> función para dejar de escuchar.
// El mapa pasa la suya (ya tiene el GPS encendido); si no, se abre uno aquí.
function gpsPropio(ok, fallo) {
  const id = navigator.geolocation.watchPosition(
    p => ok({ lat: p.coords.latitude, lng: p.coords.longitude, precision: p.coords.accuracy }),
    fallo, { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 });
  return () => navigator.geolocation.clearWatch(id);
}

function distanciaM(a, b) {
  const R = 6371000, rad = x => x * Math.PI / 180;
  const dLat = rad(b[0] - a[0]), dLng = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
const fmtDist = m => m >= 1000 ? (m / 1000).toFixed(1) + ' km' : Math.round(m) + ' m';

// Coordenadas escritas o pegadas: "13.70123, -89.21234", "13.70123 -89.21234",
// con coma decimal ("13,70123 -89,21234") o un enlace de Google Maps. Si
// falta el signo de la longitud o vienen al revés, se corrige (El Salvador).
const enSV = (lat, lng) => lat > 12.9 && lat < 14.6 && lng > -90.3 && lng < -87.5;
export function leerCoordenadas(texto) {
  let t = String(texto || '').trim();
  if (!t) return null;
  const enlace = t.match(/@(-?\d+\.\d+),(-?\d+\.\d+)/) || t.match(/[?&](?:q|query|ll)=(-?\d+\.\d+),\s*(-?\d+\.\d+)/);
  let nums;
  if (enlace) nums = [enlace[1], enlace[2]];
  else if (/^-?\d+,\d+[\s;]+-?\d+,\d+$/.test(t)) nums = t.split(/[\s;]+/).map(x => x.replace(',', '.'));
  else nums = t.match(/-?\d+(?:\.\d+)?/g);
  if (!nums || nums.length !== 2) return null;
  let [a, b] = nums.map(Number);
  if (!isFinite(a) || !isFinite(b)) return null;
  for (const [lat, lng] of [[a, b], [b, a], [a, -Math.abs(b)], [b, -Math.abs(a)]]) if (enSV(lat, lng)) return { lat, lng };
  return null;
}

export function corregirUbicacion(o, session, alGuardar, fuenteGps = gpsPropio) {
  if (!puedeActuar(o, session)) return;
  const hayGps = !!navigator.geolocation;

  const sh = hoja(ID_GPS, 'Corregir ubicación', `
    <div style="font-size:13px;color:var(--text-2);line-height:1.5;margin-bottom:14px">Usa esto <b>estando en el sitio</b> de la orden ${esc(o.numeroOrden || '')}: la posición actual del teléfono queda como la ubicación correcta.</div>
    <div class="ds-card" id="fbg-estado" style="padding:14px 16px;margin-bottom:14px;display:flex;align-items:center;gap:12px">
      <div class="spinner" style="flex-shrink:0"></div>
      <div style="font-size:13px;color:var(--text-2)">Buscando tu posición…</div>
    </div>
    <div class="form-error" id="fbg-error"></div>
    <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
      <button class="btn-action outline" id="fbg-cancelar">Cancelar</button>
      <button class="btn-action marca" id="fbg-guardar" disabled style="opacity:.5">Usar esta ubicación</button>
    </div>
    <button class="cm-btn" id="fbg-manual-abrir" style="width:100%;height:42px;margin-top:12px">Escribir las coordenadas a mano</button>
    <div id="fbg-manual" style="display:none;margin-top:14px;padding-top:14px;border-top:1px solid var(--border)">
      <div class="form-label">Coordenadas</div>
      <input class="form-input" id="fbg-manual-val" inputmode="text" autocomplete="off" spellcheck="false" placeholder="13.70123, -89.21234"/>
      <div style="font-size:11.5px;color:var(--text-3);margin-top:6px;line-height:1.45">Latitud y longitud, o pega el enlace o las coordenadas que copias de Google Maps.</div>
      <div id="fbg-manual-info" style="font-size:12.5px;margin-top:8px;min-height:18px"></div>
      <button class="btn-action marca" id="fbg-manual-guardar" disabled style="opacity:.5;width:100%;margin-top:8px">Guardar estas coordenadas</button>
    </div>`);

  let pos = null;
  const btnG = sh.querySelector('#fbg-guardar');
  const actual = [parseFloat(o.latitud), parseFloat(o.longitud)];
  const hayActual = isFinite(actual[0]) && isFinite(actual[1]);

  const medir = () => {
    pararGps();
    pararGps_ = fuenteGps(p => {
      if (!document.getElementById(ID_GPS)) return;
      pos = p;
      sh.querySelector('#fbg-error').style.display = 'none';
      const buena = pos.precision <= PRECISION_BUENA;
      const usable = pos.precision <= PRECISION_MAXIMA;
      const color = buena ? '#22c55e' : usable ? '#fbbf24' : '#ef4444';
      const dist = hayActual ? distanciaM(actual, [pos.lat, pos.lng]) : null;
      sh.querySelector('#fbg-estado').innerHTML = `
        <div style="width:44px;height:44px;border-radius:12px;flex-shrink:0;display:flex;align-items:center;justify-content:center;background:${color}22;color:${color}">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="20" height="20"><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/></svg>
        </div>
        <div style="flex:1;min-width:0">
          <div style="font-size:14px;font-weight:700;color:#fff">Precisión: ±${Math.round(pos.precision)} m</div>
          <div style="font-size:12px;color:${color};margin-top:2px">${buena ? 'Buena señal' : usable ? 'Señal regular: si puedes, espera unos segundos a cielo abierto' : 'Señal muy débil: espera a cielo abierto, se actualiza sola'}</div>
          ${dist != null ? `<div style="font-size:12px;color:var(--text-3);margin-top:2px">El punto se moverá ${fmtDist(dist)}</div>` : ''}
        </div>`;
      btnG.disabled = !usable; btnG.style.opacity = usable ? '' : '.5';
    }, e => {
      if (!document.getElementById(ID_GPS) || pos) return;
      const err = sh.querySelector('#fbg-error');
      err.textContent = e.code === 1 ? 'Permite el acceso a la ubicación para esta app.' : 'El GPS aún no responde. Sal a cielo abierto y espera un momento.';
      err.style.display = 'block';
    });
  };
  sh.querySelector('#fbg-cancelar').onclick = () => cerrar(ID_GPS);
  if (hayGps) medir();
  else sh.querySelector('#fbg-estado').innerHTML = '<div style="font-size:13px;color:var(--text-2)">Este teléfono no tiene GPS disponible: escribe las coordenadas a mano.</div>';

  // Guarda la ubicación (por GPS o escrita a mano) con los mismos campos
  const guardar = async (p, boton, pregunta) => {
    const dist = hayActual ? distanciaM(actual, [p.lat, p.lng]) : null;
    if (dist != null && dist > 2000 && !confirm(`La nueva ubicación está a ${fmtDist(dist)} del punto actual. ${pregunta}`)) return;
    boton.disabled = true;
    try {
      await guardarConEspera(db.collection(COL_ORDENES).doc(o.id).update({
        latitud: p.lat, longitud: p.lng,
        coordCorregida: true,
        corregidaPor: session.displayName,
        fechaCorreccion: firebase.firestore.Timestamp.now(),
      }));
      cerrar(ID_GPS);
      toast('Ubicación corregida', 'ok');
      if (alGuardar) alGuardar(p);
    } catch (e) {
      console.error('[factibilidades] ubicación:', e);
      const err = sh.querySelector('#fbg-error');
      err.textContent = 'No se pudo guardar: ' + e.message;
      err.style.display = 'block';
      boton.disabled = false;
    }
  };

  btnG.onclick = () => { if (pos) guardar(pos, btnG, '¿Seguro que estás en el sitio de la orden?'); };

  // A mano: se valida mientras escribe y se dice cuánto se moverá el punto
  const caja = sh.querySelector('#fbg-manual');
  const inpM = sh.querySelector('#fbg-manual-val');
  const infoM = sh.querySelector('#fbg-manual-info');
  const btnM = sh.querySelector('#fbg-manual-guardar');
  let manual = null;
  sh.querySelector('#fbg-manual-abrir').onclick = e => {
    caja.style.display = 'block';
    e.currentTarget.style.display = 'none';
    inpM.focus();
  };
  if (!hayGps) sh.querySelector('#fbg-manual-abrir').click();
  inpM.oninput = () => {
    manual = leerCoordenadas(inpM.value);
    if (!inpM.value.trim()) infoM.innerHTML = '';
    else if (!manual) infoM.innerHTML = '<span style="color:#f87171">No se entienden o no caen en El Salvador. Ejemplo: 13.70123, -89.21234</span>';
    else {
      const d = hayActual ? distanciaM(actual, [manual.lat, manual.lng]) : null;
      infoM.innerHTML = `<span style="color:#86efac">${manual.lat.toFixed(6)}, ${manual.lng.toFixed(6)}</span>`
        + (d != null ? `<span style="color:var(--text-3)"> · el punto se moverá ${fmtDist(d)}</span>` : '');
    }
    btnM.disabled = !manual; btnM.style.opacity = manual ? '' : '.5';
  };
  btnM.onclick = () => { if (manual) guardar(manual, btnM, '¿Seguro que son las coordenadas de esta orden?'); };
}

// ── Reasignar (admin / asistente) ─────────────────
// Una o varias órdenes a otro técnico del área. Marca asignacionManual para
// que una nueva importación del Excel no pise la decisión del admin.
export function abrirReasignar(ordenes, session, tecnicos, alGuardar) {
  const lista = (ordenes || []).filter(Boolean);
  if (!lista.length || session.role === 'tecnico') return;
  const tecs = [...tecnicos].sort((a, b) => String(a.displayName).localeCompare(String(b.displayName), 'es'));
  const actual = new Set(lista.map(o => o.asignadoUid || ''));
  const unico = actual.size === 1 ? [...actual][0] : null;
  const sh = hoja(ID_REASIGNAR, lista.length === 1 ? `Reasignar · ${esc(lista[0].numeroOrden || '')}` : `Reasignar ${lista.length} órdenes`, `
    <div class="form-field">
      <div class="form-label">Asignar a</div>
      ${tecs.length ? `<div class="select-row flex-wrap" id="fbx-tecs">
        ${tecs.map(u => `<div class="select-chip ${unico === u.id ? 'active' : ''}" data-uid="${esc(u.id)}">${esc(u.displayName)}</div>`).join('')}
        <div class="select-chip ${unico === '' ? 'active' : ''}" data-uid="">Sin asignar</div>
      </div>` : '<div style="font-size:13px;color:var(--text-3)">No hay técnicos activos asignados a Factibilidades. Asígnalos en Usuarios.</div>'}
    </div>
    <div class="form-error" id="fbx-error"></div>
    <button class="btn-primary full" id="fbx-guardar" ${tecs.length ? '' : 'disabled'}><span id="fbx-guardar-lbl">Reasignar</span></button>`);

  let elegido = unico;
  sh.querySelectorAll('#fbx-tecs .select-chip').forEach(c => c.onclick = () => {
    sh.querySelectorAll('#fbx-tecs .select-chip').forEach(x => x.classList.toggle('active', x === c));
    elegido = c.dataset.uid;
  });
  sh.querySelector('#fbx-guardar').onclick = async () => {
    const err = sh.querySelector('#fbx-error');
    if (elegido == null) { err.textContent = 'Elige a quién asignar.'; err.style.display = 'block'; return; }
    const tec = tecs.find(u => u.id === elegido) || null;
    const btn = sh.querySelector('#fbx-guardar');
    btn.disabled = true;
    sh.querySelector('#fbx-guardar-lbl').innerHTML = '<div class="spinner"></div>';
    const datos = {
      asignadoUid: tec ? tec.id : null,
      asignadoNombre: tec ? tec.displayName : null,
      asignacionManual: true,
      reasignadoPor: session.displayName,
      reasignadoEn: firebase.firestore.Timestamp.now(),
    };
    try {
      // Lotes de hasta 450 escrituras (el límite de Firestore es 500)
      for (let i = 0; i < lista.length; i += 450) {
        const lote = db.batch();
        lista.slice(i, i + 450).forEach(o => lote.update(db.collection(COL_ORDENES).doc(o.id), datos));
        await guardarConEspera(lote.commit());
      }
      cerrar(ID_REASIGNAR);
      toast(`${lista.length === 1 ? 'Orden reasignada' : lista.length + ' órdenes reasignadas'} ${tec ? 'a ' + tec.displayName : 'sin técnico'}`, 'ok');
      if (alGuardar) alGuardar(tec);
    } catch (e) {
      console.error('[factibilidades] reasignar:', e);
      err.textContent = 'No se pudo guardar: ' + e.message; err.style.display = 'block';
      btn.disabled = false;
      sh.querySelector('#fbx-guardar-lbl').textContent = 'Reasignar';
    }
  };
}
