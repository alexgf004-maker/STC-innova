/**
 * js/views/factibilidades_cerradas.js
 * Órdenes cerradas de Factibilidades: la revisión de la oficina y el
 * historial del técnico.
 *
 * Antes, al cerrarse, la orden desaparecía de la app: nadie podía consultar
 * su resultado ni corregir un cierre equivocado.
 *
 * Revisión (campo `revision` de la orden; solo lo escribe la oficina, las
 * reglas no dejan al técnico tocarlo):
 *   estado 'cerrada' sin `revision` o con 'devuelta' -> por revisar
 *   'aprobada'                                       -> revisada
 *   'devuelta' con la orden abierta                  -> la oficina se la
 *       regresó al técnico (con `motivoDevolucion`); al volver a cerrarla
 *       queda otra vez por revisar.
 * Cada acción de la oficina se agrega a `revisiones` (fecha, quién, qué hizo
 * y el resultado anterior) para que quede la trazabilidad.
 *
 * Historial del técnico: todas sus cerradas, con búsqueda, filtro por mes y
 * resultado, Excel, y en cada una su nota (`notaTecnico`) y la marca de
 * seguimiento (`seguimiento`), que solo escribe él (la oficina las ve).
 *
 * Exporta: porRevisar, renderCerradasOficina, renderHistorialTecnico,
 *          abrirFicha, cerrarHojasCerradas
 */

import { db } from '../firebase.js';
import { COL_ORDENES } from '../factibilidades_comun.js';
import { aFecha } from '../dias_habiles.js';
import { toast, escapeHtml, guardarConEspera } from '../ui.js';
import { RESULTADOS } from './factibilidades_acciones.js';

const esc = v => escapeHtml(v == null ? '' : String(v));
const ID_FICHA = 'fb-sheet-ficha';
const ID_DEVOLVER = 'fb-sheet-devolver';
const ID_CORREGIR = 'fb-sheet-corregir';

const ICO = {
  buscar: '<circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/>',
  check:  '<polyline points="20 6 9 17 4 12"/>',
  volver: '<polyline points="1 4 1 10 7 10"/><path d="M3.51 15a9 9 0 102.13-9.36L1 10"/>',
  editar: '<path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 013 3L7 19l-4 1 1-4L16.5 3.5z"/>',
  bajar:  '<path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/>',
  marca:  '<path d="M19 21l-7-5-7 5V5a2 2 0 012-2h10a2 2 0 012 2z"/>',
};
const svg = (d, n = 16, extra = '') => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${n}" height="${n}" ${extra}>${d}</svg>`;
const fmt = v => { const d = aFecha(v); return d ? d.toLocaleString('es-SV', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : ''; };
const pillRes = o => { const r = RESULTADOS[o.resultado]; return r ? `<span class="cm-pill ${r.pill}">${r.texto}</span>` : ''; };

export const porRevisar = o => o.estado === 'cerrada' && o.revision !== 'aprobada';

// ── Hojas ─────────────────────────────────────────
function hoja(id, titulo, cuerpo) {
  document.getElementById(id)?.remove();
  document.body.insertAdjacentHTML('beforeend', `
    <div class="sheet-backdrop" id="${id}">
      <div class="sheet" style="max-height:92vh">
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
  const sh = document.getElementById(id);
  if (!sh) return;
  sh.classList.remove('open');
  setTimeout(() => sh.remove(), 250);
}
export function cerrarHojasCerradas() {
  [ID_FICHA, ID_DEVOLVER, ID_CORREGIR].forEach(id => document.getElementById(id)?.remove());
}

// ── Acciones de la oficina ────────────────────────
const marca = (session, accion, extra = {}) => ({ fecha: firebase.firestore.Timestamp.now(), por: session.displayName, accion, ...extra });

async function aprobar(lista, session) {
  const ahora = firebase.firestore.Timestamp.now();
  for (let i = 0; i < lista.length; i += 450) {
    const lote = db.batch();
    lista.slice(i, i + 450).forEach(o => lote.update(db.collection(COL_ORDENES).doc(o.id), {
      revision: 'aprobada', revisadaPor: session.displayName, fechaRevision: ahora,
      revisiones: firebase.firestore.FieldValue.arrayUnion(marca(session, 'aprobada', { resultado: o.resultado || null })),
    }));
    await guardarConEspera(lote.commit());
  }
}

function abrirCorregir(o, session, alGuardar) {
  const opciones = Object.entries(RESULTADOS).filter(([, r]) => r.cierra);
  const sh = hoja(ID_CORREGIR, `Corregir resultado · ${esc(o.numeroOrden || '')}`, `
    <div style="font-size:12px;color:var(--text-3);line-height:1.5;margin-bottom:12px">El técnico la cerró como <b style="color:var(--text-2)">${esc(RESULTADOS[o.resultado]?.texto || 'sin resultado')}</b>. Al guardar queda corregida y revisada; el resultado anterior queda en el historial de la orden.</div>
    <div class="form-field">
      <div class="form-label">Resultado correcto</div>
      <div class="select-row flex-wrap" id="fbc-opciones">
        ${opciones.map(([k, r]) => `<div class="select-chip ${k === o.resultado ? 'active' : ''}" data-val="${k}">${r.texto}</div>`).join('')}
      </div>
    </div>
    <div class="form-field">
      <div class="form-label">Observación</div>
      <textarea class="form-input" id="fbc-obs" rows="3" style="resize:none">${esc(o.observacion || '')}</textarea>
    </div>
    <div class="form-error" id="fbc-error"></div>
    <button class="btn-primary full" id="fbc-guardar"><span id="fbc-guardar-lbl">Guardar corrección</span></button>`);
  let elegido = o.resultado && RESULTADOS[o.resultado]?.cierra ? o.resultado : null;
  sh.querySelectorAll('#fbc-opciones .select-chip').forEach(c => c.onclick = () => {
    sh.querySelectorAll('#fbc-opciones .select-chip').forEach(x => x.classList.toggle('active', x === c));
    elegido = c.dataset.val;
  });
  sh.querySelector('#fbc-guardar').onclick = async () => {
    const err = sh.querySelector('#fbc-error');
    const obs = sh.querySelector('#fbc-obs').value.trim();
    const falla = m => { err.textContent = m; err.style.display = 'block'; };
    if (!elegido) return falla('Elige el resultado.');
    if (RESULTADOS[elegido].obsObligatoria && obs.length < 3) return falla(`Escribe la observación: es obligatoria para "${RESULTADOS[elegido].texto}".`);
    if (elegido === o.resultado && obs === (o.observacion || '')) return falla('No cambiaste nada.');
    const btn = sh.querySelector('#fbc-guardar');
    btn.disabled = true;
    sh.querySelector('#fbc-guardar-lbl').innerHTML = '<div class="spinner"></div>';
    try {
      await guardarConEspera(db.collection(COL_ORDENES).doc(o.id).update({
        resultado: elegido, observacion: obs,
        revision: 'aprobada', revisadaPor: session.displayName, fechaRevision: firebase.firestore.Timestamp.now(),
        revisiones: firebase.firestore.FieldValue.arrayUnion(marca(session, 'corregida', {
          resultadoAnterior: o.resultado || null, observacionAnterior: o.observacion || '', resultado: elegido,
        })),
      }));
      cerrar(ID_CORREGIR);
      toast(`Resultado corregido · ${RESULTADOS[elegido].texto}`, 'ok');
      if (alGuardar) alGuardar();
    } catch (e) {
      console.error('[factibilidades] corregir:', e);
      falla('No se pudo guardar: ' + e.message);
      btn.disabled = false;
      sh.querySelector('#fbc-guardar-lbl').textContent = 'Guardar corrección';
    }
  };
}

function abrirDevolver(o, session, alGuardar) {
  const sh = hoja(ID_DEVOLVER, `Devolver al técnico · ${esc(o.numeroOrden || '')}`, `
    <div style="font-size:12px;color:var(--text-3);line-height:1.5;margin-bottom:12px">La orden se reabre y vuelve a la lista de <b style="color:var(--text-2)">${esc(o.asignadoNombre || 'su técnico')}</b>, con el motivo a la vista. Sigue contando días hábiles desde su liberación. El cierre anterior queda en el historial de la orden.</div>
    <div class="form-field">
      <div class="form-label">Motivo *</div>
      <textarea class="form-input" id="fbd-motivo" rows="3" style="resize:none" placeholder="Qué debe revisar o corregir"></textarea>
    </div>
    <div class="form-error" id="fbd-error"></div>
    <button class="btn-primary full" id="fbd-guardar"><span id="fbd-guardar-lbl">Devolver y reabrir</span></button>`);
  sh.querySelector('#fbd-guardar').onclick = async () => {
    const err = sh.querySelector('#fbd-error');
    const motivo = sh.querySelector('#fbd-motivo').value.trim();
    if (motivo.length < 3) { err.textContent = 'Escribe el motivo: el técnico lo verá en su lista.'; err.style.display = 'block'; return; }
    const btn = sh.querySelector('#fbd-guardar');
    btn.disabled = true;
    sh.querySelector('#fbd-guardar-lbl').innerHTML = '<div class="spinner"></div>';
    const borrar = firebase.firestore.FieldValue.delete();
    try {
      await guardarConEspera(db.collection(COL_ORDENES).doc(o.id).update({
        // Abierta otra vez: null, o 'visita' si ya tenía visitas sin acceso.
        // null EXPLÍCITO: las consultas de abiertas usan == null.
        estado: (Array.isArray(o.visitas) && o.visitas.length) ? 'visita' : null,
        resultado: null, observacion: '', fechaHecha: borrar, hechaPor: borrar,
        revision: 'devuelta', motivoDevolucion: motivo, devueltaPor: session.displayName,
        fechaDevolucion: firebase.firestore.Timestamp.now(),
        revisiones: firebase.firestore.FieldValue.arrayUnion(marca(session, 'devuelta', {
          motivo, resultadoAnterior: o.resultado || null, observacionAnterior: o.observacion || '',
          cerradaPor: o.hechaPor || null, fechaCierre: o.fechaHecha || null,
        })),
      }));
      cerrar(ID_DEVOLVER);
      toast(`Orden devuelta a ${o.asignadoNombre || 'su técnico'}`, 'ok');
      if (alGuardar) alGuardar();
    } catch (e) {
      console.error('[factibilidades] devolver:', e);
      err.textContent = 'No se pudo guardar: ' + e.message; err.style.display = 'block';
      btn.disabled = false;
      sh.querySelector('#fbd-guardar-lbl').textContent = 'Devolver y reabrir';
    }
  };
}

// ── Ficha de una orden cerrada ────────────────────
const TXT_ACCION = { aprobada: 'Aprobada', corregida: 'Resultado corregido', devuelta: 'Devuelta al técnico' };

/**
 * Detalle de la orden cerrada: resultado, observación, quién y cuándo, días
 * que tomó, visitas e historial de revisión. La oficina además puede
 * aprobarla, corregir el resultado o devolverla al técnico.
 * ctx: { sem, textoDias, alCambiar }
 */
export function abrirFicha(o, session, ctx) {
  const oficina = session.role === 'admin' || session.role === 'asistente';
  const propia = session.role === 'tecnico' && o.asignadoUid === session.uid;
  const { dias } = ctx.sem(o);
  const visitas = (Array.isArray(o.visitas) ? o.visitas : []).slice().sort((a, b) => (aFecha(a.fecha) || 0) - (aFecha(b.fecha) || 0));
  const revs = (Array.isArray(o.revisiones) ? o.revisiones : []).slice().sort((a, b) => (aFecha(a.fecha) || 0) - (aFecha(b.fecha) || 0));
  const fila = (k, v) => v ? `<div style="display:flex;justify-content:space-between;gap:12px;font-size:13px;padding:6px 0;border-bottom:1px solid var(--border)"><span style="color:var(--text-3)">${k}</span><span style="text-align:right">${v}</span></div>` : '';
  const estadoRev = o.revision === 'aprobada'
    ? `<span class="estado-badge ok">Revisada</span>`
    : `<span class="estado-badge warn">Por revisar</span>`;
  const sh = hoja(ID_FICHA, `Orden ${esc(o.numeroOrden || '')}`, `
    <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;margin-bottom:12px">
      ${pillRes(o)} ${estadoRev}
      ${o.revision === 'devuelta' ? '<span class="cm-pill violet">Corregida tras devolución</span>' : ''}
      ${o.seguimiento ? '<span class="cm-pill violet">En seguimiento</span>' : ''}
    </div>
    ${o.observacion ? `<div class="ds-hilite" style="font-size:13px;line-height:1.45;margin-bottom:12px">${esc(o.observacion)}</div>` : ''}
    <div style="margin-bottom:14px">
      ${fila('Cliente', esc(o.cliente || ''))}
      ${fila('Dirección', esc(o.direccion || ''))}
      ${fila('Técnico', esc(o.asignadoNombre || ''))}
      ${fila('Cerrada', `${esc(fmt(o.fechaHecha))}${o.hechaPor ? ' · ' + esc(o.hechaPor) : ''}`)}
      ${fila('Tiempo de atención', dias == null ? 'Sin fecha de liberación' : esc(ctx.textoDias(dias)))}
      ${fila('Coordenada', o.coordCorregida ? `Corregida${o.corregidaPor ? ' por ' + esc(o.corregidaPor) : ''}` : '')}
      ${o.revision === 'aprobada' ? fila('Revisada', `${esc(fmt(o.fechaRevision))}${o.revisadaPor ? ' · ' + esc(o.revisadaPor) : ''}`) : ''}
      ${!propia && o.notaTecnico ? fila('Nota del técnico', esc(o.notaTecnico)) : ''}
    </div>
    ${propia ? `
    <div class="ds-sec" style="margin-top:0">Mi seguimiento</div>
    <div class="form-field">
      <textarea class="form-input" id="fbf-nota" rows="3" style="resize:none" placeholder="Tu nota sobre esta orden (solo la ves tú y la oficina)">${esc(o.notaTecnico || '')}</textarea>
      ${o.notaTecnicoFecha ? `<div style="font-size:11px;color:var(--text-4);margin-top:4px">Última nota: ${esc(fmt(o.notaTecnicoFecha))}</div>` : ''}
    </div>
    <button class="fb-modo seg ${o.seguimiento ? 'on' : ''}" id="fbf-seg" type="button" style="margin-bottom:12px">
      <span class="fb-modo-sw"></span>Darle seguimiento
    </button>
    <div class="form-error" id="fbf-error"></div>
    <button class="btn-primary full" id="fbf-guardar-nota" style="margin-bottom:14px"><span id="fbf-guardar-lbl">Guardar</span></button>` : ''}
    ${visitas.length ? `
    <div class="ds-sec" style="margin-top:0">Visitas sin acceso</div>
    <div style="margin-bottom:14px">${visitas.map(v => `<div style="font-size:12px;color:var(--text-2);padding:5px 0;border-bottom:1px solid var(--border)"><b>${esc(fmt(v.fecha))}</b>${v.tecnico ? ' · ' + esc(v.tecnico) : ''}${v.observacion ? `<div style="color:var(--text-3);margin-top:2px">${esc(v.observacion)}</div>` : ''}</div>`).join('')}</div>` : ''}
    ${revs.length ? `
    <div class="ds-sec" style="margin-top:0">Historial de revisión</div>
    <div style="margin-bottom:14px">${revs.map(r => `<div style="font-size:12px;color:var(--text-2);padding:5px 0;border-bottom:1px solid var(--border)"><b>${esc(TXT_ACCION[r.accion] || r.accion || '')}</b> · ${esc(fmt(r.fecha))}${r.por ? ' · ' + esc(r.por) : ''}
      ${r.accion === 'corregida' ? `<div style="color:var(--text-3);margin-top:2px">${esc(RESULTADOS[r.resultadoAnterior]?.texto || 'Sin resultado')} &rarr; ${esc(RESULTADOS[r.resultado]?.texto || '')}</div>` : ''}
      ${r.accion === 'devuelta' ? `<div style="color:var(--text-3);margin-top:2px">${r.resultadoAnterior ? `Estaba como ${esc(RESULTADOS[r.resultadoAnterior]?.texto || r.resultadoAnterior)}. ` : ''}Motivo: ${esc(r.motivo || '')}</div>` : ''}
    </div>`).join('')}</div>` : ''}
    ${oficina ? `
    <div class="flex-col gap-8">
      ${o.revision !== 'aprobada' ? `<button class="btn-primary full" id="fbf-aprobar">${svg(ICO.check, 15)} Aprobar</button>` : ''}
      <div style="display:flex;gap:8px">
        <button class="cm-btn" id="fbf-corregir" style="flex:1;height:42px">${svg(ICO.editar, 14)} Corregir resultado</button>
        <button class="cm-btn" id="fbf-devolver" style="flex:1;height:42px">${svg(ICO.volver, 14)} Devolver al técnico</button>
      </div>
    </div>` : ''}`);
  if (propia) {
    let seg = !!o.seguimiento;
    const bSeg = sh.querySelector('#fbf-seg');
    bSeg.onclick = () => { seg = !seg; bSeg.classList.toggle('on', seg); };
    sh.querySelector('#fbf-guardar-nota').onclick = async e => {
      const btn = e.currentTarget;
      const err = sh.querySelector('#fbf-error');
      const nota = sh.querySelector('#fbf-nota').value.trim();
      if (nota === (o.notaTecnico || '') && seg === !!o.seguimiento) { err.textContent = 'No cambiaste nada.'; err.style.display = 'block'; return; }
      btn.disabled = true;
      sh.querySelector('#fbf-guardar-lbl').innerHTML = '<div class="spinner"></div>';
      const datos = { notaTecnico: nota, notaTecnicoFecha: firebase.firestore.Timestamp.now(), seguimiento: seg };
      try {
        await guardarConEspera(db.collection(COL_ORDENES).doc(o.id).update(datos));
        Object.assign(o, datos);   // el historial está en memoria: se actualiza aquí mismo
        cerrar(ID_FICHA);
        toast(seg ? 'Guardado · en seguimiento' : 'Guardado', 'ok');
        if (ctx.alCambiar) ctx.alCambiar();
      } catch (e2) {
        console.error('[factibilidades] nota:', e2);
        err.textContent = e2?.code === 'permission-denied'
          ? 'Todavía no está habilitado guardar notas. Avísale a la coordinación (falta un permiso en la base de datos).'
          : 'No se pudo guardar: ' + e2.message;
        err.style.display = 'block';
        btn.disabled = false;
        sh.querySelector('#fbf-guardar-lbl').textContent = 'Guardar';
      }
    };
  }
  if (!oficina) return;
  const listo = () => { cerrar(ID_FICHA); if (ctx.alCambiar) ctx.alCambiar(); };
  sh.querySelector('#fbf-aprobar')?.addEventListener('click', async e => {
    const btn = e.currentTarget;
    btn.disabled = true;
    try { await aprobar([o], session); toast('Orden aprobada', 'ok'); listo(); }
    catch (err) { console.error('[factibilidades] aprobar:', err); toast('No se pudo aprobar: ' + err.message, 'error'); btn.disabled = false; }
  });
  sh.querySelector('#fbf-corregir').onclick = () => { cerrar(ID_FICHA); abrirCorregir(o, session, ctx.alCambiar); };
  sh.querySelector('#fbf-devolver').onclick = () => { cerrar(ID_FICHA); abrirDevolver(o, session, ctx.alCambiar); };
}

// ── Tarjeta de una cerrada ────────────────────────
function tarjetaCerrada(o, ctx, conTecnico) {
  const { dias } = ctx.sem(o);
  return `
    <div class="cm-ord" data-ficha="${o.id}" style="cursor:pointer">
      <div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
        <span class="cm-wo">${esc(o.numeroOrden || '—')}</span>
        ${pillRes(o)}
        ${o.revision === 'aprobada' ? '<span class="cm-pill muted">Revisada</span>' : '<span class="cm-pill warn">Por revisar</span>'}
        ${o.seguimiento ? '<span class="cm-pill violet">Seguimiento</span>' : ''}
      </div>
      ${o.cliente ? `<div class="cm-cli">${esc(o.cliente)}</div>` : ''}
      ${o.observacion ? `<div class="cm-meta" style="white-space:nowrap;overflow:hidden;text-overflow:ellipsis">${esc(o.observacion)}</div>` : ''}
      ${o.notaTecnico ? `<div class="cm-meta" style="color:#c4b5fd;white-space:nowrap;overflow:hidden;text-overflow:ellipsis">Nota: ${esc(o.notaTecnico)}</div>` : ''}
      <div class="cm-meta">${esc(fmt(o.fechaHecha))}${dias != null ? ' · ' + esc(ctx.textoDias(dias)) : ''}${conTecnico && o.asignadoNombre ? ' · ' + esc(o.asignadoNombre) : ''}</div>
    </div>`;
}

// ── Pestaña Cerradas (oficina) ────────────────────
// Las cerradas que ya escucha la vista (desde el mes pasado). Una más
// antigua se busca por su número de orden con una consulta puntual.
let revF_ = 'revisar', tecFC_ = 'todos', busqC_ = '', limiteC_ = 40, antiguas_ = null;
const FILTROS_REV = [
  { id: 'revisar',   t: 'Por revisar', f: porRevisar },
  { id: 'aprobadas', t: 'Revisadas',   f: o => o.revision === 'aprobada' },
  { id: 'todas',     t: 'Todas',       f: () => true },
];

/** Pide abrir la pestaña ya filtrada (desde el Panel). */
export function filtrarCerradas(rev = 'revisar', tec = 'todos') { revF_ = rev; tecFC_ = tec; busqC_ = ''; limiteC_ = 40; antiguas_ = null; }

/** ctx: { cerradas, tecnicos, sem, textoDias, alCambiar } */
export function renderCerradasOficina(cont, session, ctx) {
  let cuerpo = cont.querySelector('#fbc-cuerpo');
  if (!cuerpo || !cont.querySelector('#fbc-buscar')) {
    cont.innerHTML = `
      <div class="buscar-wrap" style="margin-bottom:12px">
        ${svg(ICO.buscar, 14, 'style="color:var(--text-4);flex-shrink:0"')}
        <input class="buscar-input" id="fbc-buscar" enterkeyhint="search" placeholder="Buscar orden, cliente o técnico…" autocomplete="off" spellcheck="false" value="${esc(busqC_)}"/>
      </div>
      <div id="fbc-cuerpo"></div>`;
    const inp = cont.querySelector('#fbc-buscar');
    let tm = null;
    inp.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { busqC_ = inp.value; limiteC_ = 40; antiguas_ = null; renderCerradasOficina(cont, session, ctx); }, 200); };
    cuerpo = cont.querySelector('#fbc-cuerpo');
  }
  const q = busqC_.trim().toLowerCase();
  const porTec = o => tecFC_ === 'todos' || o.asignadoUid === tecFC_;
  const base = ctx.cerradas.filter(porTec);
  const filtro = FILTROS_REV.find(x => x.id === revF_) || FILTROS_REV[0];
  const recientes = (a, b) => (aFecha(b.fechaHecha) || 0) - (aFecha(a.fechaHecha) || 0);
  const mostrar = (q
    ? ctx.cerradas.filter(o => [o.numeroOrden, o.cliente, o.direccion, o.asignadoNombre].some(v => v && String(v).toLowerCase().includes(q)))
    : base.filter(filtro.f)).sort(recientes);
  const vis = mostrar.slice(0, limiteC_);
  const pendientesVisibles = !q && revF_ === 'revisar' ? mostrar : [];
  const tecs = [...new Map(ctx.cerradas.filter(o => o.asignadoUid).map(o => [o.asignadoUid, o.asignadoNombre || 'Sin nombre'])).entries()]
    .sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'es'));
  const numBuscado = q.replace(/\s+/g, '');

  cuerpo.innerHTML = `
    ${q ? `<div style="font-size:12px;color:var(--text-3);margin:2px 2px 10px">${mostrar.length} resultado${mostrar.length !== 1 ? 's' : ''} desde el mes pasado</div>` : `
    <div class="filter-row" style="margin-bottom:8px">
      ${[['todos', 'Todos los técnicos'], ...tecs].map(([id, n]) => `<div class="filter-chip ${tecFC_ === id ? 'active' : ''}" data-tecc="${esc(id)}">${esc(n)}</div>`).join('')}
    </div>
    <div class="cm-tabs-est">
      ${FILTROS_REV.map(x => { const n = base.filter(x.f).length; return `<div class="cm-est ${x.id === revF_ ? 'active' : ''} ${n ? '' : 'vacio'}" data-rev="${x.id}">${x.t}<span>${n}</span></div>`; }).join('')}
    </div>`}
    ${pendientesVisibles.length > 1 ? `<button class="cm-btn marca" id="fbc-aprobar-todas" style="width:100%;height:42px;margin-bottom:12px">${svg(ICO.check, 14)} Aprobar las ${pendientesVisibles.length}</button>` : ''}
    ${vis.length ? `<div class="crc-grid">${vis.map(o => tarjetaCerrada(o, ctx, true)).join('')}</div>
      ${mostrar.length > vis.length ? `<button class="cm-btn" id="fbc-ver-mas" style="width:100%;height:44px;margin-top:10px">Ver ${Math.min(40, mostrar.length - vis.length)} más (${mostrar.length - vis.length} restantes)</button>` : ''}`
      : `<div class="ds-card" style="text-align:center;padding:24px 16px;color:var(--text-3);font-size:13px">${q ? 'Nada coincide entre las cerradas desde el mes pasado.' : revF_ === 'revisar' ? 'No hay cierres por revisar.' : `No hay órdenes en "${filtro.t}".`}</div>`}
    ${q && /^\d{4,}$/.test(numBuscado) ? `
    <div style="margin-top:12px">
      ${antiguas_ === null ? `<button class="cm-btn" id="fbc-antiguas" style="width:100%;height:42px">${svg(ICO.buscar, 14)} Buscar la orden ${esc(numBuscado)} en todo el historial</button>`
        : antiguas_ === 'cargando' ? '<div style="padding:16px;text-align:center"><div class="spinner" style="margin:0 auto"></div></div>'
        : antiguas_.length ? `<div class="ds-sec" style="margin-top:4px">En todo el historial</div><div class="crc-grid">${antiguas_.map(o => tarjetaCerrada(o, ctx, true)).join('')}</div>`
        : `<div class="ds-card" style="text-align:center;padding:16px;color:var(--text-3);font-size:13px">No hay una orden cerrada con el número ${esc(numBuscado)}.</div>`}
    </div>` : ''}`;

  cuerpo.querySelectorAll('[data-rev]').forEach(c => c.onclick = () => { revF_ = c.dataset.rev; limiteC_ = 40; renderCerradasOficina(cont, session, ctx); });
  cuerpo.querySelectorAll('[data-tecc]').forEach(c => c.onclick = () => { tecFC_ = c.dataset.tecc; limiteC_ = 40; renderCerradasOficina(cont, session, ctx); });
  cuerpo.querySelector('#fbc-ver-mas')?.addEventListener('click', () => { limiteC_ += 40; renderCerradasOficina(cont, session, ctx); });
  const todas = [...ctx.cerradas, ...(Array.isArray(antiguas_) ? antiguas_ : [])];
  cuerpo.querySelectorAll('[data-ficha]').forEach(c => c.onclick = () => {
    const o = todas.find(x => x.id === c.dataset.ficha);
    if (o) abrirFicha(o, session, ctx);
  });
  cuerpo.querySelector('#fbc-aprobar-todas')?.addEventListener('click', async e => {
    const lista = pendientesVisibles;
    const btn = e.currentTarget;
    if (!confirm(`¿Aprobar ${lista.length} cierres${tecFC_ !== 'todos' ? ' de este técnico' : ''} tal como los dejaron los técnicos?`)) return;
    btn.disabled = true;
    try { await aprobar(lista, session); toast(`${lista.length} cierres aprobados`, 'ok'); }
    catch (err) { console.error('[factibilidades] aprobar todas:', err); toast('No se pudo aprobar: ' + err.message, 'error'); btn.disabled = false; }
  });
  cuerpo.querySelector('#fbc-antiguas')?.addEventListener('click', async () => {
    antiguas_ = 'cargando';
    renderCerradasOficina(cont, session, ctx);
    try {
      const snap = await db.collection(COL_ORDENES).where('numeroOrden', '==', numBuscado).get();
      antiguas_ = snap.docs.map(d => ({ id: d.id, ...d.data() })).filter(o => o.estado === 'cerrada');
    } catch (err) {
      console.warn('[factibilidades] buscar antigua:', err.message);
      antiguas_ = null;
      toast('No se pudo buscar: ' + err.message, 'error');
    }
    renderCerradasOficina(cont, session, ctx);
  });
}

// ── Historial del técnico ─────────────────────────
// Todas sus órdenes cerradas, para que lleve su propio control: buscar,
// filtrar por mes y resultado, anotar, marcar las que quiere seguir y
// bajarlas a Excel. Una consulta puntual (no queda escuchando) que se guarda
// mientras la app esté abierta; "Actualizar" la vuelve a leer. Solo filtros
// de igualdad (asignadoUid y estado): no necesita índice compuesto.
let historial_ = null, cargandoHist_ = false, uidHist_ = null;
let mesH_ = 'todos', resH_ = 'todas', busqH_ = '', limiteH_ = 40;
const claveMes = v => { const d = aFecha(v); return d ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}` : ''; };
const nombreMes = k => { const [a, m] = k.split('-'); const t = new Date(+a, +m - 1, 1).toLocaleDateString('es-SV', { month: 'short', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };
const FILTROS_RES = [
  { id: 'todas',       t: 'Todas',          f: () => true },
  { id: 'factible',    t: 'Factibles',      f: o => o.resultado === 'factible' },
  { id: 'no_factible', t: 'No factibles',   f: o => o.resultado === 'no_factible' },
  { id: 'seguimiento', t: 'En seguimiento', f: o => !!o.seguimiento },
];

export async function renderHistorialTecnico(cont, session, ctx, recargar = false) {
  if (uidHist_ !== session.uid) { historial_ = null; uidHist_ = session.uid; mesH_ = 'todos'; resH_ = 'todas'; busqH_ = ''; }
  if (recargar) historial_ = null;
  if (historial_ === null) {
    cont.innerHTML = '<div style="padding:32px 0;text-align:center"><div class="spinner" style="margin:0 auto"></div></div>';
    if (cargandoHist_) return;
    cargandoHist_ = true;
    try {
      const snap = await db.collection(COL_ORDENES).where('asignadoUid', '==', session.uid).where('estado', '==', 'cerrada').get();
      historial_ = snap.docs.map(d => ({ id: d.id, ...d.data() }))
        .sort((a, b) => (aFecha(b.fechaHecha) || 0) - (aFecha(a.fechaHecha) || 0));
    } catch (err) {
      console.warn('[factibilidades] historial:', err.message);
      cont.innerHTML = `<div class="dev-module"><div class="dev-title">No se pudo cargar tu historial</div><p>${esc(err.message)}</p></div>`;
      return;
    } finally { cargandoHist_ = false; }
    if (!cont.isConnected) return;
  }
  pintarHistorial(cont, session, ctx);
}

function pintarHistorial(cont, session, ctx) {
  const lista = historial_;
  if (!lista.length) {
    cont.innerHTML = `<div class="dev-module"><div class="dev-title">Aún no tienes órdenes cerradas</div><p>Aquí irán quedando todas las que cierres, con su resultado, para que las consultes, les pongas notas y les des seguimiento.</p></div>`;
    return;
  }
  // El buscador se crea una sola vez (si se vuelve a crear al escribir, el
  // teléfono cambia de teclado y se pierde lo que se escribe rápido)
  let cuerpo = cont.querySelector('#fbh-cuerpo');
  if (!cuerpo || !cont.querySelector('#fbh-buscar')) {
    cont.innerHTML = `
      <div style="display:flex;gap:8px;margin-bottom:12px">
        <div class="buscar-wrap" style="flex:1;margin:0">
          ${svg(ICO.buscar, 14, 'style="color:var(--text-4);flex-shrink:0"')}
          <input class="buscar-input" id="fbh-buscar" enterkeyhint="search" placeholder="Buscar orden, cliente, dirección o nota…" autocomplete="off" spellcheck="false" value="${esc(busqH_)}"/>
        </div>
        <button class="cm-ico-btn" id="fbh-recargar" title="Actualizar" style="flex-shrink:0">${svg(ICO.volver, 16)}</button>
      </div>
      <div id="fbh-cuerpo"></div>`;
    const inp = cont.querySelector('#fbh-buscar');
    let tm = null;
    inp.oninput = () => { clearTimeout(tm); tm = setTimeout(() => { busqH_ = inp.value; limiteH_ = 40; pintarHistorial(cont, session, ctx); }, 200); };
    cont.querySelector('#fbh-recargar').onclick = () => renderHistorialTecnico(cont, session, ctx, true);
    cuerpo = cont.querySelector('#fbh-cuerpo');
  }
  const q = busqH_.trim().toLowerCase();
  const meses = [...new Set(lista.map(o => claveMes(o.fechaHecha)).filter(Boolean))].sort().reverse();
  if (mesH_ !== 'todos' && !meses.includes(mesH_)) mesH_ = 'todos';
  const delMes = lista.filter(o => mesH_ === 'todos' || claveMes(o.fechaHecha) === mesH_);
  const filtro = FILTROS_RES.find(x => x.id === resH_) || FILTROS_RES[0];
  const mostrar = (q
    ? lista.filter(o => [o.numeroOrden, o.cliente, o.direccion, o.observacion, o.notaTecnico].some(v => v && String(v).toLowerCase().includes(q)))
    : delMes.filter(filtro.f));
  const vis = mostrar.slice(0, limiteH_);
  const n = f => delMes.filter(f).length;
  const factibles = n(FILTROS_RES[1].f), noFact = n(FILTROS_RES[2].f);

  cuerpo.innerHTML = `
    ${q ? `<div style="font-size:12px;color:var(--text-3);margin:2px 2px 10px">${mostrar.length} resultado${mostrar.length !== 1 ? 's' : ''} en todo tu historial</div>` : `
    <div class="filter-row" style="margin-bottom:10px">
      ${[['todos', 'Todo'], ...meses.map(k => [k, nombreMes(k)])].map(([k, t]) => `<div class="filter-chip ${mesH_ === k ? 'active' : ''}" data-mes="${k}">${esc(t)}</div>`).join('')}
    </div>
    <div class="ds-mini" style="margin-bottom:12px">
      <div class="ds-m"><div class="ds-num-md">${delMes.length}</div><div class="ds-lbl-sm" style="margin-top:6px">Cerradas</div></div>
      <div class="ds-m"><div class="ds-num-md" style="color:#22c55e">${factibles}</div><div class="ds-lbl-sm" style="margin-top:6px">Factibles${delMes.length ? ` · ${Math.round(factibles / delMes.length * 100)}%` : ''}</div></div>
      <div class="ds-m"><div class="ds-num-md" style="color:#f87171">${noFact}</div><div class="ds-lbl-sm" style="margin-top:6px">No factibles${delMes.length ? ` · ${Math.round(noFact / delMes.length * 100)}%` : ''}</div></div>
    </div>
    <div class="cm-tabs-est">
      ${FILTROS_RES.map(x => { const c = n(x.f); return `<div class="cm-est ${x.id === resH_ ? 'active' : ''} ${c ? '' : 'vacio'}" data-res="${x.id}">${x.t}<span>${c}</span></div>`; }).join('')}
    </div>`}
    ${mostrar.length ? `<button class="cm-btn" id="fbh-excel" style="width:100%;height:40px;margin-bottom:12px">${svg(ICO.bajar, 14)} Descargar en Excel (${mostrar.length})</button>` : ''}
    ${vis.length ? `<div class="crc-grid">${vis.map(o => tarjetaCerrada(o, ctx, false)).join('')}</div>
      ${mostrar.length > vis.length ? `<button class="cm-btn" id="fbh-ver-mas" style="width:100%;height:44px;margin-top:10px">Ver ${Math.min(40, mostrar.length - vis.length)} más (${mostrar.length - vis.length} restantes)</button>` : ''}`
      : `<div class="ds-card" style="text-align:center;padding:24px 16px;color:var(--text-3);font-size:13px">${q ? 'Nada coincide.' : resH_ === 'seguimiento' ? 'No tienes órdenes marcadas para seguimiento. Márcalas desde su ficha.' : `No hay órdenes en "${filtro.t}".`}</div>`}`;

  const repintar = () => pintarHistorial(cont, session, ctx);
  cuerpo.querySelectorAll('[data-mes]').forEach(c => c.onclick = () => { mesH_ = c.dataset.mes; limiteH_ = 40; repintar(); });
  cuerpo.querySelectorAll('[data-res]').forEach(c => c.onclick = () => { resH_ = c.dataset.res; limiteH_ = 40; repintar(); });
  cuerpo.querySelector('#fbh-ver-mas')?.addEventListener('click', () => { limiteH_ += 40; repintar(); });
  cuerpo.querySelector('#fbh-excel')?.addEventListener('click', () => {
    try { excelHistorial(mostrar, session, ctx, q ? 'busqueda' : (mesH_ === 'todos' ? 'todo' : mesH_)); }
    catch (err) { console.error('[factibilidades] excel historial:', err); toast('No se pudo generar el Excel: ' + err.message, 'error'); }
  });
  cuerpo.querySelectorAll('[data-ficha]').forEach(c => c.onclick = () => {
    const o = lista.find(x => x.id === c.dataset.ficha);
    if (o) abrirFicha(o, session, { ...ctx, alCambiar: repintar });
  });
}

function excelHistorial(lista, session, ctx, sufijo) {
  if (typeof XLSX === 'undefined') throw new Error('falta la librería de Excel (revisa la conexión)');
  const f = v => { const d = aFecha(v); return d ? d.toLocaleDateString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric' }) : ''; };
  const fh = v => { const d = aFecha(v); return d ? d.toLocaleString('es-SV', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }) : ''; };
  const filas = lista.map(o => ({
    'Orden': o.numeroOrden || '',
    'Tipo': o.claseActividad || '',
    'Cliente': o.cliente || '',
    'Dirección': o.direccion || '',
    'Fecha liberación': f(o.fechaLiberacion),
    'Fecha cierre': fh(o.fechaHecha),
    'Días hábiles': ctx.sem(o).dias ?? '',
    'Resultado': RESULTADOS[o.resultado]?.texto || '',
    'Observación': o.observacion || '',
    'Revisión': o.revision === 'aprobada' ? 'Revisada' : 'Por revisar',
    'Seguimiento': o.seguimiento ? 'Sí' : 'No',
    'Mi nota': o.notaTecnico || '',
    'Latitud': parseFloat(o.latitud) || '',
    'Longitud': parseFloat(o.longitud) || '',
  }));
  const ws = XLSX.utils.json_to_sheet(filas);
  const anchos = { 'Orden': 13, 'Cliente': 28, 'Dirección': 40, 'Fecha liberación': 14, 'Fecha cierre': 18, 'Observación': 36, 'Mi nota': 36 };
  ws['!cols'] = Object.keys(filas[0]).map(k => ({ wch: anchos[k] || Math.max(10, k.length + 2) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Mis factibilidades');
  const nombre = String(session.displayName || 'tecnico').normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^A-Za-z0-9]+/g, '_');
  XLSX.writeFile(wb, `Factibilidades_${nombre}_${sufijo}.xlsx`);
  toast(`Excel descargado · ${filas.length} órdenes`, 'ok');
}
