/**
 * js/aviso_vencimientos.js
 * Aviso de vencimientos de Factibilidades al entrar a la app (una vez al día).
 *
 * El plazo de DELSUR es de 5 días hábiles desde la liberación y es un
 * indicador: las órdenes se estaban venciendo sin que nadie lo notara a
 * tiempo. Al entrar, si hay órdenes que vencen hoy, vencen mañana o ya se
 * vencieron, sale una ventana:
 *   - oficina (admin / asistente): cuántas hay de cada una y de qué técnico;
 *   - técnico de Factibilidades: cuáles son las suyas.
 * Con "Ver órdenes" se abre la lista de Factibilidades ya filtrada.
 * Sale una vez al día por persona (se recuerda en el teléfono); lo mismo se
 * ve siempre en el panel y en el Inicio del técnico.
 */
import { suscribirAbiertas, suscribirConfig } from './factibilidades_comun.js';
import { vencimiento, textoVence, claveDia, cuandoProximoHabil } from './dias_habiles.js';
import { escapeHtml } from './ui.js';

const ID = 'aviso-vencimientos';
const ESPERA_MS = 2500;   // para que lleguen los datos del servidor, no solo la copia del teléfono
const esc = v => escapeHtml(v == null ? '' : String(v));
const ICO = '<circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/>';
const svg = (d, n) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="${n}" height="${n}">${d}</svg>`;
const GRUPOS = [
  { k: 'hoy',     uno: 'vence hoy',    varias: 'vencen hoy',    color: '#fb923c' },
  { k: 'manana',  uno: 'vence mañana', varias: 'vencen mañana', color: '#fbbf24' },
  { k: 'vencida', uno: 'ya vencida',   varias: 'ya vencidas',   color: '#ef4444' },
];

const clave = uid => `aviso_vencimientos_${uid}`;
function yaSalioHoy(uid) { try { return localStorage.getItem(clave(uid)) === claveDia(new Date()); } catch { return false; } }
function marcarHoy(uid) { try { localStorage.setItem(clave(uid), claveDia(new Date())); } catch {} }

/** Lo llama app.js al entrar. */
export function iniciarAvisoVencimientos(session) {
  if (!session?.uid) return;
  const oficina = session.role === 'admin' || session.role === 'asistente';
  const tecnico = session.role === 'tecnico' && session.asignacionActual?.area === 'Factibilidades';
  if ((!oficina && !tecnico) || yaSalioHoy(session.uid)) return;

  let cfg = null, abiertas = null, tm = null, listo = false;
  const offs = [];
  const terminar = () => { listo = true; offs.forEach(off => { try { off(); } catch {} }); };
  const revisar = () => {
    if (listo || !cfg || !abiertas) return;
    clearTimeout(tm);
    tm = setTimeout(() => { if (!listo) { terminar(); mostrar(session, oficina, abiertas, cfg); } }, ESPERA_MS);
  };
  offs.push(suscribirConfig(x => { cfg = x; revisar(); }));
  offs.push(suscribirAbiertas(session, (lista, err) => {
    if (err) { console.warn('[aviso vencimientos]', err.message); terminar(); return; }
    abiertas = lista; revisar();
  }));
}

function mostrar(session, oficina, abiertas, cfg) {
  const grupos = { hoy: [], manana: [], vencida: [] };
  abiertas.forEach(o => {
    const v = vencimiento(o, cfg.festivosSet);
    if (v.estado) grupos[v.estado].push({ o, v });
  });
  const total = grupos.hoy.length + grupos.manana.length + grupos.vencida.length;
  if (!total) return;   // nada urgente: no se molesta
  marcarHoy(session.uid);

  // "vencen mañana", o "vencen el lunes" si mañana no es día hábil
  const cuando = cuandoProximoHabil(cfg.festivosSet);
  const titulo = (g, n) => g.k === 'manana' ? `${n === 1 ? 'vence' : 'vencen'} ${cuando}` : (n === 1 ? g.uno : g.varias);
  const cuerpo = GRUPOS.filter(g => grupos[g.k].length).map(g => {
    const lista = grupos[g.k].sort((a, b) => (b.v.dias || 0) - (a.v.dias || 0));
    const n = lista.length;
    let detalle;
    if (oficina) {
      // De quién son: técnico y cuántas
      const porTec = new Map();
      lista.forEach(({ o }) => { const k = o.asignadoNombre || 'Sin asignar'; porTec.set(k, (porTec.get(k) || 0) + 1); });
      detalle = [...porTec.entries()].sort((a, b) => b[1] - a[1])
        .map(([nombre, c]) => `<div class="am-item"><span${nombre === 'Sin asignar' ? ' style="color:#fbbf24"' : ''}>${esc(nombre)}</span><b>${c}</b></div>`).join('');
    } else {
      // Sus órdenes (las primeras), con el texto del vencimiento
      detalle = lista.slice(0, 6).map(({ o, v }) => `
        <div class="am-item"><span style="min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${esc(o.numeroOrden || '—')}${o.direccion ? ' · ' + esc(o.direccion) : ''}</span><b style="color:${g.color};font-size:11.5px">${esc(textoVence(v, cfg.festivosSet).replace(/^Vencida hace /, 'hace '))}</b></div>`).join('')
        + (n > 6 ? `<div class="am-item"><span style="color:var(--text-3)">y ${n - 6} más</span></div>` : '');
    }
    return `
      <div class="am-desp" style="border-color:${g.color}55">
        <div class="am-desp-cab"><span style="color:${g.color};font-weight:800;font-size:13px">${n} ${titulo(g, n)}</span></div>
        ${detalle}
      </div>`;
  }).join('');
  const urgente = grupos.hoy.length ? 'hoy' : grupos.vencida.length ? 'vencida' : 'manana';
  const colorUrg = GRUPOS.find(g => g.k === urgente).color;

  document.getElementById(ID)?.remove();
  const v = document.createElement('div');
  v.id = ID;
  v.className = 'am-fondo';
  v.innerHTML = `
    <div class="am-caja" role="dialog" aria-modal="true" aria-labelledby="av-titulo" style="border-color:${colorUrg}88">
      <div class="am-cab">
        <div class="am-ico" style="color:${colorUrg};background:${colorUrg}22;border-color:${colorUrg}66">${svg(ICO, 26)}</div>
        <div>
          <div class="am-tit" id="av-titulo">${oficina ? 'Vencimientos de Factibilidades' : 'Tus órdenes por vencer'}</div>
          <div class="am-sub">El plazo es de 5 días hábiles desde la liberación. ${oficina ? 'Esto es lo que hay que priorizar hoy.' : 'Atiende primero las que vencen hoy.'}</div>
        </div>
      </div>
      <div class="am-lista">${cuerpo}</div>
      <div class="am-botones">
        <button class="am-rechazar" id="av-ok" style="color:var(--text-2)">Entendido</button>
        <button class="btn-marca am-aceptar" id="av-ver">Ver órdenes</button>
      </div>
    </div>`;
  document.body.appendChild(v);
  v.addEventListener('click', e => { if (e.target === v) v.remove(); });
  v.querySelector('#av-ok').onclick = () => v.remove();
  v.querySelector('#av-ver').onclick = async () => {
    v.remove();
    try {
      const mod = await import('./views/factibilidades.js');
      mod.pedirLista(urgente);
      window.__router?.navigateTo('factibilidades');
    } catch (err) { console.warn('[aviso vencimientos]', err.message); }
  };
}
