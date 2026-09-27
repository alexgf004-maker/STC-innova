/**
 * js/views/ami_condominio.js
 * Vista Condominio de AMI: un edificio, sus niveles (cuartos eléctricos) y
 * sus medidores. Ver SPEC_AMI_Condominios.md (fases 2 y 3).
 *
 * - Técnico: busca por número de medidor (flujo principal) o entra por
 *   nivel, y marca cada medidor uno por uno con los mismos campos que el
 *   mapa (hecha / visita / ya cambiado). NO hay "marcar nivel completo".
 * - Admin/asistente: ve el avance por nivel, asigna niveles (o el edificio
 *   completo) a una pareja y confirma en lote lo que el técnico ya marcó.
 *
 * Cada medidor sigue siendo su propia orden en ami_ordenes. Esta vista no
 * lee Firestore por su cuenta: recibe las órdenes de quien la abre
 * (mapa o Panel) mediante `obtener()`, y se repinta con refrescarVistaCondominio().
 */

import { db } from '../firebase.js';
import { toast, escapeHtml } from '../ui.js';

const COL = 'ami_ordenes';
const MOTIVOS_VISITA = ['Cuarto eléctrico cerrado', 'Sin acceso al edificio', 'Medidor no encontrado', 'Cliente no permite', 'Otro'];
const ESTADO = {
  hecha:       { lbl: 'Cambiado',    cls: 'ok' },
  aprobada:    { lbl: 'Confirmado',  cls: 'ok-outline' },
  visita:      { lbl: 'Visita',      cls: 'warn' },
  ya_cambiado: { lbl: 'Ya cambiado', cls: 'warn' },
  mal_ubicado: { lbl: 'Mal ubicado', cls: 'warn' },
};

let vista_ = null;   // { ov, key, session, esAdmin, parejas, obtener, alCerrar, abiertos, busq }

export function claveEdificio(o) {
  return `${o.condominio || 'Sin nombre'}|${o.edificio || 'Sin edificio'}`;
}

// Orden natural de niveles: sótanos, PB, 1, 2 … 10 (no alfabético)
function claveNivel(n) {
  const t = String(n ?? '').toLowerCase().trim();
  const num = parseInt(t.replace(/\D/g, ''), 10);
  if (/s[oó]tano|^s\d/.test(t)) return -100 - (isNaN(num) ? 0 : num);
  if (/^pb$|planta ?baja|^p\.?b\.?$/.test(t)) return 0;
  return isNaN(num) ? 999 : num;
}

const esHecha = o => o.estadoCampo === 'hecha' || o.estadoCampo === 'aprobada';
const numMedidor = m => String(m ?? '').split('-')[0].trim();

export function abrirVistaCondominio({ key, session, parejas, obtener, alCerrar }) {
  cerrarVistaCondominio();
  const ov = document.createElement('div');
  ov.className = 'cd-flow';
  document.body.appendChild(ov);
  vista_ = {
    ov, key, session, obtener, alCerrar,
    esAdmin: session.role !== 'tecnico',
    parejas: parejas || [],
    abiertos: null,
    busq: '',
  };
  pintar();
}

export function refrescarVistaCondominio() {
  if (vista_ && !document.getElementById('cd-accion')) pintar();
}

export function cerrarVistaCondominio() {
  document.getElementById('cd-accion')?.remove();
  if (!vista_) return;
  const cb = vista_.alCerrar;
  vista_.ov.remove();
  vista_ = null;
  if (typeof cb === 'function') cb();
}

function ordenesDelEdificio() {
  return (vista_.obtener() || []).filter(o => claveEdificio(o) === vista_.key);
}

// ── Render ────────────────────────────────────────
function pintar() {
  const v = vista_;
  if (!v) return;
  const ordenes = ordenesDelEdificio();
  const [condo, edif] = v.key.split('|');
  const total = ordenes.length;
  const hechas = ordenes.filter(esHecha).length;
  const pct = total ? Math.round(hechas / total * 100) : 0;

  const porNivel = new Map();
  ordenes.forEach(o => {
    const n = o.nivel || 'Sin nivel';
    if (!porNivel.has(n)) porNivel.set(n, []);
    porNivel.get(n).push(o);
  });
  const niveles = [...porNivel.keys()].sort((a, b) => claveNivel(a) - claveNivel(b) || a.localeCompare(b));
  porNivel.forEach(arr => arr.sort((a, b) => String(a.etiqueta || a.medidor).localeCompare(String(b.etiqueta || b.medidor), 'es', { numeric: true })));

  // La primera vez: abrir el primer nivel con pendientes
  if (v.abiertos === null) {
    v.abiertos = new Set();
    const primero = niveles.find(n => porNivel.get(n).some(o => !esHecha(o)));
    if (primero) v.abiertos.add(primero);
  }

  // Parejas activas + las que ya tengan medidores aquí (aunque hoy no estén activas)
  const numP = x => parseInt(String(x).replace(/\D/g, ''), 10) || 0;
  const todasParejas = [...new Set([...v.parejas, ...ordenes.map(o => o.pareja).filter(Boolean)])].sort((a, b) => numP(a) - numP(b));
  // sel: nombre de pareja, '' = sin asignar, null = mezcla de varias
  const opcionesPareja = sel =>
    (sel === null ? `<option value="__mezcla" selected disabled>Varias parejas</option>` : '') +
    `<option value="" ${sel === '' ? 'selected' : ''}>Sin asignar</option>` +
    todasParejas.map(p => `<option value="${escapeHtml(p)}" ${sel === p ? 'selected' : ''}>${escapeHtml(p)}</option>`).join('');

  const tarjetaNivel = (n, i) => {
    const arr = porNivel.get(n);
    const h = arr.filter(esHecha).length;
    const p = arr.length ? Math.round(h / arr.length * 100) : 0;
    const abierto = v.abiertos.has(n);
    const parejas = [...new Set(arr.map(o => o.pareja || ''))];
    const parejaNivel = parejas.length === 1 ? parejas[0] : null;
    const porConfirmar = arr.filter(o => o.estadoCampo === 'hecha').length;
    const etiquetaPareja = !v.esAdmin ? '' : parejaNivel === ''
      ? '<span style="color:#fbbf24">Sin asignar</span>'
      : parejaNivel ? escapeHtml(parejaNivel) : 'Varias parejas';
    return `
      <div class="ds-card cd-nivel" style="padding:0;overflow:hidden;${h === arr.length ? 'border-color:rgba(34,197,94,.35)' : ''}">
        <div class="cd-nivel-head" data-i="${i}">
          <div style="flex:1;min-width:0">
            <div style="display:flex;align-items:baseline;justify-content:space-between;gap:8px">
              <span style="font-size:16px;font-weight:600">${escapeHtml(n)}</span>
              <span style="font-size:13px;color:${h === arr.length ? '#22c55e' : 'var(--text-3)'};font-weight:500">${h} / ${arr.length}</span>
            </div>
            <div class="ds-bar" style="margin-top:9px"><i style="width:${p}%;background:${h === arr.length ? '#22c55e' : 'var(--am-light)'}"></i></div>
            ${v.esAdmin ? `<div style="font-size:12px;color:var(--text-3);margin-top:8px">${etiquetaPareja}</div>` : ''}
          </div>
          <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-4)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="flex-shrink:0;transition:transform .2s;${abierto ? 'transform:rotate(90deg)' : ''}"><polyline points="9 18 15 12 9 6"/></svg>
        </div>
        ${abierto ? `
        <div class="cd-nivel-body">
          ${v.esAdmin ? `
          <div style="display:flex;gap:8px;align-items:center;margin-bottom:4px">
            <select class="form-input cd-sel cd-asignar-nivel" data-i="${i}" style="flex:1">${opcionesPareja(parejaNivel)}</select>
            ${porConfirmar ? `<button class="btn-action cm cd-confirmar-nivel" data-i="${i}" style="width:auto;height:40px;padding:0 14px;font-size:12px;flex-shrink:0">Confirmar ${porConfirmar}</button>` : ''}
          </div>` : ''}
          ${arr.map(filaMedidor).join('')}
        </div>` : ''}
      </div>`;
  };

  const parejasEdificio = [...new Set(ordenes.map(o => o.pareja || ''))];
  const parejaEdificio = parejasEdificio.length === 1 ? parejasEdificio[0] : null;

  v.ov.innerHTML = `<div class="cd-wrap">
    <div class="cd-head">
      <button class="icon-btn" id="cd-cerrar"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg></button>
      <div style="flex:1;min-width:0">
        <div style="font-size:20px;font-weight:700;letter-spacing:-.01em;line-height:1.2">${escapeHtml(edif)}</div>
        <div style="font-size:12px;color:var(--text-4);margin-top:2px">${escapeHtml(condo)} · ${niveles.length} nivel${niveles.length !== 1 ? 'es' : ''}</div>
      </div>
    </div>
    <div class="cd-body">
      <div class="ds-card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px">
          <div style="display:flex;align-items:baseline;gap:6px">
            <span class="ds-num-md" style="color:var(--text-1)">${hechas}</span>
            <span style="font-size:13px;color:var(--text-4)">de ${total} medidores</span>
          </div>
          <span style="font-size:15px;font-weight:600;color:var(--am-light)">${pct}%</span>
        </div>
        <div class="ds-bar"><i class="am" style="width:${pct}%"></i></div>
        ${v.esAdmin ? `
        <div style="display:flex;gap:8px;align-items:center;margin-top:14px">
          <span style="font-size:12px;color:var(--text-3);flex-shrink:0">Todo el edificio</span>
          <select class="form-input cd-sel" id="cd-asignar-edificio" style="flex:1">${opcionesPareja(parejaEdificio)}</select>
        </div>` : ''}
      </div>

      <div class="buscar-wrap" style="margin-bottom:0">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="16" height="16" style="color:var(--text-4);flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
        <input class="buscar-input" id="cd-buscar" placeholder="Número de medidor" inputmode="numeric" autocomplete="off" value="${escapeHtml(v.busq)}" style="font-size:16px"/>
      </div>
      <div id="cd-res" class="flex-col gap-6"></div>
      <div id="cd-niveles" class="flex-col gap-10">
        ${!total ? `<div class="dev-module"><div class="dev-title">Sin medidores</div><p>${v.esAdmin ? 'Este edificio ya no tiene órdenes cargadas.' : 'No tienes medidores asignados en este edificio.'}</p></div>` : niveles.map(tarjetaNivel).join('')}
      </div>
    </div>
  </div>`;

  // Eventos
  v.ov.querySelector('#cd-cerrar').onclick = cerrarVistaCondominio;
  v.ov.querySelectorAll('.cd-nivel-head').forEach(h => h.onclick = () => {
    const n = niveles[Number(h.dataset.i)];
    if (v.abiertos.has(n)) v.abiertos.delete(n); else v.abiertos.add(n);
    pintar();
  });
  v.ov.querySelectorAll('.cd-asignar-nivel').forEach(s => {
    s.onclick = e => e.stopPropagation();
    s.onchange = () => asignar(porNivel.get(niveles[Number(s.dataset.i)]), s.value, niveles[Number(s.dataset.i)]);
  });
  v.ov.querySelector('#cd-asignar-edificio')?.addEventListener('change', e => asignar(ordenes, e.target.value, 'todo el edificio'));
  v.ov.querySelectorAll('.cd-confirmar-nivel').forEach(b => b.onclick = () => {
    const n = niveles[Number(b.dataset.i)];
    confirmarLote(porNivel.get(n).filter(o => o.estadoCampo === 'hecha'), n);
  });
  enlazarFilas(v.ov.querySelector('#cd-niveles'));

  const inp = v.ov.querySelector('#cd-buscar');
  inp.oninput = () => { v.busq = inp.value; pintarResultados(); };
  pintarResultados();
}

function filaMedidor(o) {
  const e = ESTADO[o.estadoCampo] || { lbl: 'Pendiente', cls: 'muted' };
  const sub = [o.etiqueta, o.forma, o.nc ? `NC ${o.nc}` : ''].filter(Boolean).map(escapeHtml).join(' · ');
  return `<div class="cd-med ${esHecha(o) ? 'done' : ''}" data-id="${o.id}">
    <div style="flex:1;min-width:0">
      <div class="cd-num">${escapeHtml(o.medidor || 'Sin medidor')}</div>
      <div class="cd-sub">${sub}</div>
    </div>
    <span class="estado-badge ${e.cls}" style="flex-shrink:0">${e.lbl}</span>
  </div>`;
}

function enlazarFilas(cont) {
  cont?.querySelectorAll('.cd-med').forEach(r => r.onclick = () => {
    const o = ordenesDelEdificio().find(x => x.id === r.dataset.id);
    if (o) abrirAccion(o);
  });
}

// Búsqueda por número de medidor (flujo principal del técnico). Mientras hay
// texto se esconden los niveles y se muestran solo las coincidencias.
function pintarResultados() {
  const v = vista_;
  const res = v.ov.querySelector('#cd-res');
  const niv = v.ov.querySelector('#cd-niveles');
  const q = v.busq.trim().toLowerCase();
  if (!q) { res.innerHTML = ''; niv.style.display = ''; return; }
  niv.style.display = 'none';
  const lista = ordenesDelEdificio().filter(o =>
    numMedidor(o.medidor).includes(q) || String(o.nc ?? '').startsWith(q) || String(o.etiqueta ?? '').toLowerCase().includes(q)
  ).slice(0, 30);
  res.innerHTML = lista.length
    ? lista.map(o => `<div style="font-size:11px;color:var(--text-4);margin:4px 2px 0">${escapeHtml(o.nivel || 'Sin nivel')}</div>${filaMedidor(o)}`).join('')
    : `<div class="dev-module"><div class="dev-title">Sin coincidencias</div><p>Ningún medidor de este edificio${v.esAdmin ? '' : ' asignado a tu pareja'} empieza o contiene "${escapeHtml(v.busq.trim())}".</p></div>`;
  enlazarFilas(res);
}

// ── Hoja de acción de un medidor ──────────────────
function abrirAccion(o) {
  const v = vista_;
  document.getElementById('cd-accion')?.remove();
  const sh = document.createElement('div');
  sh.id = 'cd-accion';
  sh.className = 'sheet-backdrop open';
  sh.style.zIndex = '700';
  document.body.appendChild(sh);
  const cerrar = () => sh.remove();
  sh.addEventListener('click', e => { if (e.target === sh) cerrar(); });

  const e = ESTADO[o.estadoCampo] || { lbl: 'Pendiente', cls: 'muted' };
  const fmt = ts => { const d = ts?.toDate ? ts.toDate() : null; return d ? d.toLocaleString('es-SV', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; };
  const detalle = [
    ['Nivel', o.nivel], ['Unidad', o.etiqueta], ['Forma', o.forma], ['NC', o.nc], ['Cliente', o.nombre || o.cliente],
    v.esAdmin ? ['Pareja', o.pareja || 'Sin asignar'] : null,
    o.hechaPor ? ['Cambiado por', `${o.hechaPor}${o.fechaHecha ? ' · ' + fmt(o.fechaHecha) : ''}`] : null,
    o.motivoVisita && o.estadoCampo === 'visita' ? ['Motivo', o.motivoVisita] : null,
  ].filter(x => x && x[1]);

  const puedeMarcar = !v.esAdmin && (!o.estadoCampo || o.estadoCampo === 'visita');

  sh.innerHTML = `<div class="sheet" style="max-height:90vh">
    <div class="sheet-handle"></div>
    <div class="sheet-body flex-col gap-12">
      <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:10px">
        <div>
          <div class="ds-lbl-sm">Medidor</div>
          <div style="font-size:30px;font-weight:700;letter-spacing:.02em;line-height:1.1;margin-top:4px;font-variant-numeric:tabular-nums">${escapeHtml(o.medidor || 'Sin medidor')}</div>
        </div>
        <span class="estado-badge ${e.cls}" style="flex-shrink:0;margin-top:4px">${e.lbl}</span>
      </div>
      <div class="ds-card" style="padding:4px 14px">
        ${detalle.map(([k, val], i) => `<div style="display:flex;justify-content:space-between;gap:12px;padding:9px 0;${i < detalle.length - 1 ? 'border-bottom:1px solid var(--border);' : ''}font-size:13px"><span style="color:var(--text-3)">${k}</span><span style="font-weight:600;text-align:right">${escapeHtml(val)}</span></div>`).join('')}
      </div>
      <div id="cd-acc-cuerpo" class="flex-col gap-8">
        ${puedeMarcar ? `
          <button class="btn-action cm" id="cd-hecha-si" style="height:52px;font-size:14px">Cambiado · ya actualizado en DELSUR</button>
          <button class="btn-action outline" id="cd-hecha-no" style="height:48px">Cambiado · falta actualizar en DELSUR</button>
          <div style="display:flex;gap:8px">
            <button class="btn-action warn" id="cd-visita" style="height:44px;font-size:12px">No se pudo</button>
            <button class="btn-action outline" id="cd-ya" style="height:44px;font-size:12px">Ya estaba cambiado</button>
          </div>` : ''}
        ${v.esAdmin && o.estadoCampo === 'hecha' ? `<button class="btn-action cm" id="cd-confirmar" style="height:50px">Confirmar cambio</button>` : ''}
        <button class="btn-action outline" id="cd-acc-cerrar" style="height:44px">Cerrar</button>
      </div>
    </div>
  </div>`;

  sh.querySelector('#cd-acc-cerrar').onclick = cerrar;
  sh.querySelector('#cd-hecha-si')?.addEventListener('click', () => marcarHecha(o, true, sh));
  sh.querySelector('#cd-hecha-no')?.addEventListener('click', () => marcarHecha(o, false, sh));
  sh.querySelector('#cd-confirmar')?.addEventListener('click', () => { cerrar(); confirmarLote([o], null); });
  sh.querySelector('#cd-visita')?.addEventListener('click', () => formVisita(o, sh));
  sh.querySelector('#cd-ya')?.addEventListener('click', () => formYaCambiado(o, sh));
}

function formVisita(o, sh) {
  const cuerpo = sh.querySelector('#cd-acc-cuerpo');
  cuerpo.innerHTML = `
    <div class="form-label" style="margin-bottom:0">¿Por qué no se pudo?</div>
    <div class="select-row flex-wrap" id="cd-motivos">
      ${MOTIVOS_VISITA.map(m => `<div class="select-chip" data-val="${escapeHtml(m)}">${escapeHtml(m)}</div>`).join('')}
    </div>
    <input class="form-input" id="cd-obs" placeholder="Observación (opcional)" autocomplete="off"/>
    <div id="cd-err" class="form-error"></div>
    <button class="btn-action warn" id="cd-guardar-visita" style="height:48px">Registrar visita</button>
    <button class="btn-action outline" id="cd-volver" style="height:44px">Volver</button>`;
  let motivo = '';
  cuerpo.querySelectorAll('#cd-motivos .select-chip').forEach(c => c.onclick = () => {
    cuerpo.querySelectorAll('#cd-motivos .select-chip').forEach(x => x.classList.remove('active'));
    c.classList.add('active'); motivo = c.dataset.val;
  });
  cuerpo.querySelector('#cd-volver').onclick = () => abrirAccion(o);
  cuerpo.querySelector('#cd-guardar-visita').onclick = async () => {
    const err = cuerpo.querySelector('#cd-err');
    if (!motivo) { err.textContent = 'Elige un motivo.'; err.style.display = 'block'; return; }
    const obs = cuerpo.querySelector('#cd-obs').value.trim();
    await guardar(o, {
      estadoCampo: 'visita',
      fechaVisita: firebase.firestore.Timestamp.now(),
      visitadoPor: vista_.session.displayName,
      motivoVisita: motivo,
      observacionVisita: obs || null,
    }, `Visita registrada: ${motivo}`, sh);
  };
}

function formYaCambiado(o, sh) {
  const cuerpo = sh.querySelector('#cd-acc-cuerpo');
  cuerpo.innerHTML = `
    <div style="font-size:13px;color:var(--text-2)">El medidor ya estaba cambiado cuando llegaron. El admin lo revisa en el Panel.</div>
    <input class="form-input" id="cd-com" placeholder="Comentario (opcional)" autocomplete="off"/>
    <button class="btn-action warn" id="cd-guardar-ya" style="height:48px">Reportar ya cambiado</button>
    <button class="btn-action outline" id="cd-volver" style="height:44px">Volver</button>`;
  cuerpo.querySelector('#cd-volver').onclick = () => abrirAccion(o);
  cuerpo.querySelector('#cd-guardar-ya').onclick = async () => {
    const com = cuerpo.querySelector('#cd-com').value.trim();
    await guardar(o, {
      estadoCampo: 'ya_cambiado',
      yaCambiadoPor: vista_.session.displayName,
      yaCambiadoEn: firebase.firestore.Timestamp.now(),
      yaCambiadoComentario: com || null,
    }, 'Reportado como ya cambiado', sh);
  };
}

// ── Escrituras ────────────────────────────────────
async function marcarHecha(o, actualizadaDelsur, sh) {
  const s = vista_.session;
  // Pareja del día: misma pareja Y misma área (regla del CLAUDE.md)
  let parejaDelDia = [s.displayName];
  try {
    const destino = s.asignacionActual?.destino;
    const area = s.asignacionActual?.area;
    if (destino && area) {
      const snap = await db.collection('users')
        .where('asignacionActual.destino', '==', destino)
        .where('asignacionActual.area', '==', area)
        .where('active', '==', true).get();
      parejaDelDia = snap.docs.map(d => d.data().displayName);
    }
  } catch { /* sin conexión: queda solo quien marca */ }
  await guardar(o, {
    estadoCampo: 'hecha',
    fechaHecha: firebase.firestore.Timestamp.now(),
    hechaPor: s.displayName,
    actualizadaDelsur,
    parejaDelDia,
  }, actualizadaDelsur ? `Medidor ${o.medidor || ''} cambiado` : `Medidor ${o.medidor || ''} cambiado · falta DELSUR`, sh);
}

async function guardar(o, datos, msgOk, sh) {
  sh?.querySelectorAll('button').forEach(b => b.disabled = true);
  try {
    await db.collection(COL).doc(o.id).update(datos);
    Object.assign(o, datos);
    sh?.remove();
    toast(msgOk, 'ok');
    // Tras marcar, limpiar la búsqueda para ir por el siguiente medidor
    if (vista_) vista_.busq = '';
    pintar();
    window.dispatchEvent(new CustomEvent('ami:updated'));
  } catch (err) {
    toast('Error al guardar: ' + err.message, 'error');
    sh?.querySelectorAll('button').forEach(b => b.disabled = false);
  }
}

// Asignar (admin): actualización en lote del campo `pareja`
async function asignar(ordenes, pareja, destinoTxt) {
  const lista = (ordenes || []).filter(o => (o.pareja || '') !== pareja);
  if (!lista.length) return;
  const txt = pareja ? `a ${pareja}` : 'como sin asignar';
  if (!confirm(`¿Asignar ${lista.length} medidor${lista.length > 1 ? 'es' : ''} de ${destinoTxt} ${txt}?`)) { pintar(); return; }
  try {
    const ts = firebase.firestore.Timestamp.now();
    for (let i = 0; i < lista.length; i += 400) {
      const batch = db.batch();
      lista.slice(i, i + 400).forEach(o => batch.update(db.collection(COL).doc(o.id), { pareja: pareja || null, asignadoEn: ts }));
      await batch.commit();
    }
    lista.forEach(o => { o.pareja = pareja || null; });
    toast(`${lista.length} medidor${lista.length > 1 ? 'es' : ''} ${pareja ? 'asignados a ' + pareja : 'sin asignar'}`, 'ok');
    pintar();
    window.dispatchEvent(new CustomEvent('ami:updated'));
  } catch (err) {
    toast('Error al asignar: ' + err.message, 'error');
    pintar();
  }
}

// Confirmar (admin) lo que el técnico ya marcó uno por uno
async function confirmarLote(ordenes, nivel) {
  const lista = (ordenes || []).filter(o => o.estadoCampo === 'hecha');
  if (!lista.length) return;
  if (nivel && !confirm(`¿Confirmar ${lista.length} medidor${lista.length > 1 ? 'es' : ''} cambiado${lista.length > 1 ? 's' : ''} de ${nivel}?`)) return;
  try {
    const datos = { estadoCampo: 'aprobada', aprobadoPor: vista_.session.displayName, fechaAprobacion: firebase.firestore.Timestamp.now() };
    for (let i = 0; i < lista.length; i += 400) {
      const batch = db.batch();
      lista.slice(i, i + 400).forEach(o => batch.update(db.collection(COL).doc(o.id), datos));
      await batch.commit();
    }
    lista.forEach(o => Object.assign(o, datos));
    toast(`${lista.length} confirmado${lista.length > 1 ? 's' : ''}`, 'ok');
    pintar();
    window.dispatchEvent(new CustomEvent('ami:updated'));
  } catch (err) {
    toast('Error al confirmar: ' + err.message, 'error');
  }
}
