/**
 * js/app.js
 * Punto de entrada principal — cargado por index.html.
 * Verifica sesión, configura topbar, inicia router.
 */

import { auth, db } from './firebase.js';
import { initRouter, navigateTo, goBack, canGoBack } from './router.js';
import { hashPin, generateSalt } from './crypto.js';
import { toast as __appToast } from './ui.js';

const SESSION_KEY = 'innova_session';
const LOGIN_PATH  = '/STC-innova/login.html';

// Exponer navigateTo globalmente para los onclick de la navbar
window.__router = { navigateTo, goBack, canGoBack };

// ── Verificar sesión ──────────────────────────────
const raw = localStorage.getItem(SESSION_KEY);
if (!raw) {
  window.location.replace(LOGIN_PATH);
}

let session;
try {
  session = JSON.parse(raw);
} catch {
  localStorage.removeItem(SESSION_KEY);
  window.location.replace(LOGIN_PATH);
}

// ── Cerrar sesión ─────────────────────────────────
async function cerrarSesion() {
  try { await auth.signOut(); } catch {}
  localStorage.removeItem(SESSION_KEY);
  window.location.replace(LOGIN_PATH);
}

// ── Cambio de PIN ─────────────────────────────────
const PINS_PROHIBIDOS = ['1234','0000','1111','2222','3333','4444','5555','6666','7777','8888','9999','4321','1212','123456','000000'];

function validarPinNuevo(pin, pinActual) {
  if (!/^\d{4,8}$/.test(pin))        return 'El PIN debe tener entre 4 y 8 dígitos.';
  if (PINS_PROHIBIDOS.includes(pin)) return 'Ese PIN es muy fácil de adivinar. Elige otro.';
  if (/^(\d)\1+$/.test(pin))         return 'No uses todos los dígitos iguales.';
  if (pin === pinActual)             return 'El PIN nuevo debe ser distinto al actual.';
  return null;
}

// obligatorio = true  -> pantalla bloqueante (primer ingreso)
// obligatorio = false -> con botón cancelar (cambio voluntario)
function abrirCambioPin(obligatorio) {
  return new Promise((resolve) => {
    const ov = document.createElement('div');
    ov.style.cssText = 'position:fixed;inset:0;z-index:900;background:#0a1628;overflow-y:auto;display:flex;align-items:center;justify-content:center;padding:24px';
    ov.innerHTML = `
      <div style="width:100%;max-width:400px">
        <div style="text-align:center;margin-bottom:24px">
          <div style="width:52px;height:52px;margin:0 auto 12px;border-radius:15px;background:linear-gradient(140deg,#2dd4bf,#0d9488);display:flex;align-items:center;justify-content:center">
            <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="26" height="26">
              <rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>
            </svg>
          </div>
          <div style="font-size:19px;font-weight:800">${obligatorio ? 'Crea tu PIN personal' : 'Cambiar PIN'}</div>
          <div style="font-size:12px;color:var(--text-3);margin-top:6px;line-height:1.5">
            ${obligatorio
              ? 'Tu PIN es tu firma dentro del sistema. Define uno propio, que solo tú conozcas, para continuar.'
              : 'Elige un PIN nuevo. Solo tú debes conocerlo.'}
          </div>
        </div>

        <div style="background:var(--bg-card,#161f2e);border:1px solid var(--border);border-radius:16px;padding:20px">
          <div class="form-field">
            <div class="form-label">PIN actual</div>
            <input class="form-input" id="pin-actual" type="password" inputmode="numeric" maxlength="8" placeholder="El que usas ahora" autocomplete="off"/>
          </div>
          <div class="form-field">
            <div class="form-label">PIN nuevo</div>
            <input class="form-input" id="pin-nuevo" type="password" inputmode="numeric" maxlength="8" placeholder="4 a 8 dígitos" autocomplete="off"/>
          </div>
          <div class="form-field">
            <div class="form-label">Confirma el PIN nuevo</div>
            <input class="form-input" id="pin-conf" type="password" inputmode="numeric" maxlength="8" placeholder="Repítelo" autocomplete="off"/>
          </div>

          <div id="pin-error" class="form-error" style="margin-bottom:10px"></div>
          <button class="btn-primary full" id="pin-guardar"><span id="pin-guardar-lbl">Guardar PIN</span></button>

          ${obligatorio
            ? `<button id="pin-salir" style="width:100%;height:42px;margin-top:10px;border-radius:12px;border:none;background:transparent;color:var(--text-4);font-size:12px;font-weight:600;cursor:pointer;font-family:'Outfit',sans-serif">Cerrar sesión</button>`
            : `<button id="pin-cancelar" style="width:100%;height:44px;margin-top:10px;border-radius:12px;border:1px solid var(--border);background:transparent;color:var(--text-3);font-size:13px;font-weight:600;cursor:pointer;font-family:'Outfit',sans-serif">Cancelar</button>`}
        </div>
      </div>`;
    document.body.appendChild(ov);

    const errEl = ov.querySelector('#pin-error');
    const btn   = ov.querySelector('#pin-guardar');
    const lbl   = ov.querySelector('#pin-guardar-lbl');
    const mostrarError = (msg) => { errEl.textContent = msg; errEl.style.display = 'block'; };

    ov.querySelector('#pin-salir')?.addEventListener('click', cerrarSesion);
    ov.querySelector('#pin-cancelar')?.addEventListener('click', () => { ov.remove(); resolve(false); });

    btn.addEventListener('click', async () => {
      errEl.style.display = 'none';
      const actual = ov.querySelector('#pin-actual').value.trim();
      const nuevo  = ov.querySelector('#pin-nuevo').value.trim();
      const conf   = ov.querySelector('#pin-conf').value.trim();

      if (!actual)        return mostrarError('Ingresa tu PIN actual.');
      if (nuevo !== conf) return mostrarError('Los PIN nuevos no coinciden.');
      const err = validarPinNuevo(nuevo, actual);
      if (err) return mostrarError(err);

      btn.disabled = true;
      lbl.innerHTML = '<div class="spinner"></div>';

      try {
        // Verificar el PIN actual contra Firestore
        const doc = await db.collection('users').doc(session.uid).get();
        if (!doc.exists) throw new Error('No se encontró tu usuario.');
        const u = doc.data();
        const hashActual = await hashPin(u.pinSalt || '', actual);
        if (hashActual !== u.pinHash) {
          btn.disabled = false;
          lbl.textContent = 'Guardar PIN';
          return mostrarError('El PIN actual no es correcto.');
        }

        // Guardar el PIN nuevo con salt nuevo
        const saltNuevo = generateSalt();
        const hashNuevo = await hashPin(saltNuevo, nuevo);
        await db.collection('users').doc(session.uid).update({
          pinHash: hashNuevo,
          pinSalt: saltNuevo,
          pinChanged: true,
        });

        session.pinChanged = true;
        localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        ov.remove();
        resolve(true);
      } catch (e) {
        console.error('[app] Error cambiando PIN:', e);
        btn.disabled = false;
        lbl.textContent = 'Guardar PIN';
        mostrarError('No se pudo guardar: ' + e.message);
      }
    });

    setTimeout(() => ov.querySelector('#pin-actual')?.focus(), 120);
  });
}

// ── Modo mantenimiento ────────────────────────────
// Lee config/app { maintenance: true|false, maintenanceMsg: "..." }
// Si está activo y el usuario NO es admin, bloquea la app.
let mantenimientoActivo_ = false;

async function estaEnMantenimiento() {
  try {
    const doc = await db.collection('config').doc('app').get();
    if (!doc.exists) return { activo: false, msg: '' };
    const d = doc.data();
    return { activo: d.maintenance === true, msg: d.maintenanceMsg || '' };
  } catch (err) {
    // Si no se puede leer, NO bloquear (mejor dejar pasar que trancar a todos)
    console.warn('[app] No se pudo leer config de mantenimiento:', err);
    return { activo: false, msg: '' };
  }
}

// Enciende/apaga el mantenimiento (solo admin)
async function toggleMantenimiento() {
  const encender = !mantenimientoActivo_;
  const texto = encender
    ? 'Activar modo mantenimiento?\n\nLos técnicos y asistentes no podrán usar la app hasta que lo apagues.'
    : 'Desactivar modo mantenimiento?\n\nTodos podrán volver a usar la app.';
  if (!window.confirm(texto)) return;

  try {
    await db.collection('config').doc('app').set({ maintenance: encender }, { merge: true });
    mantenimientoActivo_ = encender;
    pintarEstadoMantenimiento();
  } catch (err) {
    console.error('[app] Error cambiando mantenimiento:', err);
    window.alert('No se pudo cambiar: ' + err.message);
  }
}

// Refresca el estado en el menú de cuenta, el punto del avatar y la franja de aviso
function pintarEstadoMantenimiento() {
  const est = document.getElementById('menu-mant-estado');
  if (est) {
    est.textContent = mantenimientoActivo_ ? 'Activo' : 'Apagado';
    est.className = 'estado-badge ' + (mantenimientoActivo_ ? 'warn' : 'muted');
  }
  document.getElementById('btn-cuenta')?.classList.toggle('alerta', mantenimientoActivo_);

  document.getElementById('aviso-mant')?.remove();
  if (mantenimientoActivo_) {
    const aviso = document.createElement('div');
    aviso.id = 'aviso-mant';
    aviso.className = 'aviso-mant';   // flota arriba de la barra de navegación
    aviso.textContent = 'Modo mantenimiento activo — solo tú puedes entrar. Toca para apagar.';
    aviso.addEventListener('click', toggleMantenimiento);
    document.body.appendChild(aviso);
  }
}

// Pantalla para técnicos y asistentes mientras el admin tiene la app en
// mantenimiento. Revisa sola cada 30 s y entra en cuanto se apaga.
function mostrarPantallaMantenimiento(msg) {
  const SEG = 30;
  const nombre = String(session?.displayName || '').trim().split(/\s+/)[0] || '';
  const ov = document.createElement('div');
  ov.className = 'mnt-pantalla';
  ov.innerHTML = `
    <div class="mnt-marca">
      <div class="topbar-logo" style="width:30px;height:30px;border-radius:9px">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="15" height="15"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
      </div>
      <span>INNOVA STC</span>
    </div>

    <div class="mnt-centro">
      <div class="mnt-ilus">
        <span class="mnt-onda"></span><span class="mnt-onda d2"></span>
        <div class="mnt-icono">
          <svg class="mnt-engrane" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" width="34" height="34">
            <circle cx="12" cy="12" r="3"/>
            <path d="M19.4 15a1.65 1.65 0 00.33 1.82l.06.06a2 2 0 11-2.83 2.83l-.06-.06a1.65 1.65 0 00-1.82-.33 1.65 1.65 0 00-1 1.51V21a2 2 0 11-4 0v-.09A1.65 1.65 0 009 19.4a1.65 1.65 0 00-1.82.33l-.06.06a2 2 0 11-2.83-2.83l.06-.06A1.65 1.65 0 004.68 15a1.65 1.65 0 00-1.51-1H3a2 2 0 110-4h.09A1.65 1.65 0 004.6 9a1.65 1.65 0 00-.33-1.82l-.06-.06a2 2 0 112.83-2.83l.06.06A1.65 1.65 0 009 4.68a1.65 1.65 0 001-1.51V3a2 2 0 114 0v.09a1.65 1.65 0 001 1.51 1.65 1.65 0 001.82-.33l.06-.06a2 2 0 112.83 2.83l-.06.06A1.65 1.65 0 0019.4 9a1.65 1.65 0 001.51 1H21a2 2 0 110 4h-.09a1.65 1.65 0 00-1.51 1z"/>
          </svg>
        </div>
      </div>

      <div class="mnt-titulo">${nombre ? 'Un momento, <span id="mnt-nombre"></span>' : 'Un momento'}</div>
      <div class="mnt-sub">Ando haciéndole unas cosillas a la app</div>
      <div class="mnt-msg" id="mnt-msg"></div>

      <div class="ds-card mnt-estado">
        <div style="display:flex;align-items:center;gap:10px">
          <span class="mnt-punto"></span>
          <div style="flex:1;min-width:0;text-align:left">
            <div style="font-size:13px;font-weight:600">Te dejo entrar en cuanto termine</div>
            <div style="font-size:12px;color:var(--text-3);margin-top:2px" id="mnt-cuenta">Revisando…</div>
          </div>
        </div>
        <div class="ds-bar" style="margin-top:12px;height:4px"><i id="mnt-barra" style="width:0%;background:#fbbf24;transition:width 1s linear"></i></div>
      </div>
    </div>

    <div class="mnt-pie">
      <button class="mnt-btn" id="mnt-reintentar">Revisar ahora</button>
      <button class="mnt-btn-link" id="mnt-salir">Cerrar sesión</button>
      <div class="mnt-nota">Lo que ya guardaste no se pierde. Si es urgente, escríbeme.</div>
    </div>`;
  document.body.appendChild(ov);
  if (nombre) ov.querySelector('#mnt-nombre').textContent = nombre;
  ov.querySelector('#mnt-msg').textContent = msg || 'Ya casi queda, dame unos minutitos.';

  // Cuenta regresiva + revisión automática del estado
  let falta = SEG, revisando = false;
  const cuenta = ov.querySelector('#mnt-cuenta');
  const barra = ov.querySelector('#mnt-barra');
  const pintar = () => {
    cuenta.textContent = revisando ? 'Revisando…' : `Vuelvo a revisar en ${falta} s`;
    barra.style.width = `${((SEG - falta) / SEG) * 100}%`;
  };
  const revisar = async () => {
    if (revisando) return;
    revisando = true; pintar();
    const m = await estaEnMantenimiento();
    if (!m.activo) { cuenta.textContent = 'Listo, entrando…'; location.reload(); return; }
    if (m.msg) ov.querySelector('#mnt-msg').textContent = m.msg;
    revisando = false; falta = SEG; pintar();
  };
  const timer = setInterval(() => { if (revisando) return; falta--; if (falta <= 0) revisar(); else pintar(); }, 1000);
  pintar();

  ov.querySelector('#mnt-reintentar').addEventListener('click', revisar);
  ov.querySelector('#mnt-salir').addEventListener('click', async () => {
    clearInterval(timer);
    try { await auth.signOut(); } catch {}
    localStorage.removeItem(SESSION_KEY);
    window.location.replace(LOGIN_PATH);
  });
}

// ── Configurar topbar ─────────────────────────────
function setupTopbar(session) {
  const { displayName, role, asignacionActual } = session;
  const area = asignacionActual?.area || null;

  document.getElementById('topbar-name').textContent = displayName;
  document.getElementById('topbar-sub').textContent  = getSubtitle(role, area);

  // Botón refresh para admin y asistente
  if (role === 'admin' || role === 'asistente') {
    document.getElementById('btn-refresh').style.display = '';
    // onclick (no addEventListener): setupTopbar corre dos veces al arrancar
    document.getElementById('btn-refresh').onclick = () => {
      navigateTo(window.__router.currentTab || 'home');
    };
  }

  // Menú de cuenta (avatar con iniciales): Cambiar PIN, mantenimiento (admin)
  // y Cerrar sesión. Deja la barra con solo lo esencial a la vista.
  const acc = document.querySelector('.topbar-actions');
  const salir = document.getElementById('btn-logout');
  if (acc && salir && !document.getElementById('btn-cuenta')) {
    salir.style.display = 'none';   // su acción se dispara desde el menú
    const ini = iniciales(displayName);
    const btn = document.createElement('div');
    btn.className = 'topbar-avatar';
    btn.id = 'btn-cuenta';
    btn.title = 'Tu cuenta';
    btn.textContent = ini;
    acc.appendChild(btn);

    const menu = document.createElement('div');
    menu.className = 'topbar-menu';
    menu.id = 'menu-cuenta';
    const icono = d => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="17" height="17">${d}</svg>`;
    menu.innerHTML = `
      <div class="topbar-menu-head">
        <div class="topbar-avatar" style="cursor:default">${ini}</div>
        <div style="min-width:0">
          <div style="font-size:14px;font-weight:600;white-space:nowrap;overflow:hidden;text-overflow:ellipsis" id="menu-nombre"></div>
          <div style="font-size:11px;color:var(--text-3);margin-top:2px" id="menu-rol"></div>
        </div>
      </div>
      <div class="topbar-menu-item" id="menu-pin">${icono('<rect x="3" y="11" width="18" height="11" rx="2"/><path d="M7 11V7a5 5 0 0110 0v4"/>')}<span>Cambiar PIN</span></div>
      ${role === 'admin' ? `<div class="topbar-menu-item" id="menu-mant">${icono('<path d="M14.7 6.3a1 1 0 000 1.4l1.6 1.6a1 1 0 001.4 0l3.77-3.77a6 6 0 01-7.94 7.94l-6.91 6.91a2.12 2.12 0 01-3-3l6.91-6.91a6 6 0 017.94-7.94l-3.76 3.76z"/>')}<span>Modo mantenimiento</span><span class="estado-badge muted" id="menu-mant-estado" style="margin-left:auto">Apagado</span></div>` : ''}
      <div class="topbar-menu-item salir" id="menu-salir">${icono('<path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>')}<span>Cerrar sesión</span></div>`;
    document.getElementById('topbar').appendChild(menu);

    const cerrar = () => menu.classList.remove('abierto');
    btn.addEventListener('click', e => { e.stopPropagation(); menu.classList.toggle('abierto'); });
    document.addEventListener('click', e => { if (!menu.contains(e.target)) cerrar(); });
    menu.querySelector('#menu-pin').addEventListener('click', () => { cerrar(); abrirCambioPin(false); });
    menu.querySelector('#menu-mant')?.addEventListener('click', () => { cerrar(); toggleMantenimiento(); });
    menu.querySelector('#menu-salir').addEventListener('click', () => { cerrar(); salir.click(); });
  }
  // Datos del menú (se actualizan si la sesión se refrescó)
  const nom = document.getElementById('menu-nombre');
  if (nom) nom.textContent = displayName || '';
  const rol = document.getElementById('menu-rol');
  if (rol) rol.textContent = getSubtitle(role, area);
  const av = document.getElementById('btn-cuenta');
  if (av) av.textContent = iniciales(displayName);
}

function iniciales(nombre) {
  return String(nombre || '').trim().split(/\s+/).slice(0, 2)
    .map(p => (p.match(/[\p{L}\p{N}]/u) || [''])[0]).join('').toUpperCase() || '?';
}

function getSubtitle(role, area) {
  if (role === 'admin')     return 'Coordinadora · Vista ejecutiva';
  if (role === 'asistente') return 'Asistente · Operación diaria';
  if (role === 'tecnico') {
    if (!area) return 'Técnico · Sin asignación hoy';
    const AREA_TXT = { CAMBIOS: 'Cambios', Caracterizacion: 'Caracterización', Reclamos: 'Reclamos SIGET', AMI: 'AMI' };
    return `Técnico · ${AREA_TXT[area] || area}`;
  }
  return 'INNOVA STC';
}

// ── Logout ────────────────────────────────────────
document.getElementById('btn-logout').addEventListener('click', async () => {
  if (!window.confirm('¿Cerrar sesión?')) return;
  try { await auth.signOut(); } catch {}
  localStorage.removeItem(SESSION_KEY);
  window.location.replace(LOGIN_PATH);
});

// ── Splash + arranque ─────────────────────────────
window.addEventListener('DOMContentLoaded', async () => {
  const splash = document.getElementById('splash');
  const appEl  = document.getElementById('app');

  let debeCambiarPin = false;
  let sinAcceso = false;

  // Refrescar datos del usuario desde Firestore
  // Así asignaciones y cambios de rol se reflejan sin cerrar sesión
  try {
    const doc = await db.collection('users').doc(session.uid).get();
    // Usuario eliminado o desactivado por el admin: pierde el acceso aquí,
    // no solo en el próximo login.
    if (!doc.exists || doc.data().active === false) sinAcceso = true;
    else {
      const fresh = doc.data();
      // OJO: solo sobrescribir si el dato viene bien. Si Firestore devuelve
      // algo incompleto, NO pisamos la sesión buena con undefined.
      if (fresh.role)        session.role        = fresh.role;
      if (fresh.displayName) session.displayName = fresh.displayName;
      session.asignacionActual = fresh.asignacionActual || null;
      session.pinChanged       = fresh.pinChanged === true;
      localStorage.setItem(SESSION_KEY, JSON.stringify(session));

      // Nunca ha personalizado su PIN -> obligarlo
      debeCambiarPin = fresh.pinChanged !== true;
    }
  } catch (err) {
    // Sin conexión o cuota agotada — usar sesión cacheada, no bloquear el acceso
    console.warn('[app] No se pudo refrescar el usuario, usando sesión cacheada');
  }

  // ── Sesión válida o nada ──────────────────────────
  // Sin un rol conocido la app NO arranca. Antes caía al menú de asistente
  // y un técnico terminaba viendo pantallas que no le tocaban.
  const ROLES_VALIDOS = ['admin', 'asistente', 'tecnico'];
  if (sinAcceso) {
    console.warn('[app] Usuario desactivado o eliminado — cerrando sesión');
    await cerrarSesion();
    return;
  }
  if (!session.uid || !ROLES_VALIDOS.includes(session.role)) {
    console.error('[app] Sesión inválida (rol:', session.role, ') — cerrando sesión');
    await cerrarSesion();
    return;
  }

  splash.classList.add('hidden');

  // ── Muro de mantenimiento (todos menos admin) ──
  const mnt = await estaEnMantenimiento();
  mantenimientoActivo_ = mnt.activo;

  if (mnt.activo && session.role !== 'admin') {
    splash.remove();
    mostrarPantallaMantenimiento(mnt.msg);
    return;   // no se monta la app
  }

  appEl.style.display = 'flex';
  setupTopbar(session);

  // ── PIN obligatorio: bloquea hasta que defina uno propio ──
  if (debeCambiarPin) {
    await abrirCambioPin(true);
    setupTopbar(session);
  }

  initRouter(session);

  // Aviso de solicitudes de material (admin/asistente)
  if (session.role === 'admin' || session.role === 'asistente') {
    iniciarAvisoSolicitudes(session);
  }

  // Pinta el botón y la franja según el estado (solo relevante para admin)
  if (session.role === 'admin') pintarEstadoMantenimiento();

  setTimeout(() => splash.remove(), 400);
});

// ══════════════════════════════════════════════════════════════
//  AVISO DE SOLICITUDES DE MATERIAL (admin / asistente)
//  Listener en vivo: badge en la pestaña Bodega + vibración/sonido
//  al llegar una solicitud nueva. Se guarda el conteo por campaña.
// ══════════════════════════════════════════════════════════════

let __unsubSolic = null;
let __solicConocidas = null;   // Set de IDs ya vistos (para detectar nuevas)
window.__solicPorCampana = {}; // { CAMBIOS: 3, AMI: 1, ... }

const CAMP_LABEL_AVISO = {
  CAMBIOS:'Cambio de Medidores', AMI:'AMI',
  Caracterizacion:'Caracterización', ReclamosSIGET:'Reclamos SIGET', OTC:'OTC',
};

function iniciarAvisoSolicitudes(session){
  try{
    // Cerrar listener anterior si lo hubiera
    if (__unsubSolic) { try{ __unsubSolic(); }catch{} __unsubSolic=null; }

    __unsubSolic = db.collection('solicitudes_material')
      .where('estado','==','pendiente')
      .onSnapshot(snap=>{
        const porCampana={};
        const idsActuales=new Set();
        snap.forEach(doc=>{
          const s=doc.data();
          idsActuales.add(doc.id);
          const c=s.area||'CAMBIOS';
          porCampana[c]=(porCampana[c]||0)+1;
        });
        window.__solicPorCampana=porCampana;

        // Detectar solicitudes NUEVAS (no en la primera carga)
        if (__solicConocidas !== null){
          let hayNueva=false;
          idsActuales.forEach(id=>{ if(!__solicConocidas.has(id)) hayNueva=true; });
          if (hayNueva) avisarSolicitudNueva();
        }
        __solicConocidas=idsActuales;

        pintarBadgeSolicitudes();
      }, err=>{
        console.warn('[app] Listener de solicitudes falló:', err.message);
      });
  }catch(e){
    console.warn('[app] No se pudo iniciar aviso de solicitudes:', e.message);
  }
}

// Pinta el badge rojo sobre la pestaña Bodega con el total pendiente
function pintarBadgeSolicitudes(){
  const total=Object.values(window.__solicPorCampana||{}).reduce((a,b)=>a+b,0);
  const badge=document.querySelector('.nav-badge[data-badge-for="bodega"]');
  if(badge){
    if(total>0){ badge.textContent=total>99?'99+':String(total); badge.style.display=''; }
    else badge.style.display='none';
  }
  // Avisar al dashboard si está escuchando
  if(window.__onSolicitudesCambio) window.__onSolicitudesCambio(window.__solicPorCampana);
}
window.__pintarBadgeSolicitudes = pintarBadgeSolicitudes;

// Vibración + sonido corto al llegar una solicitud nueva
function avisarSolicitudNueva(){
  try{ if(navigator.vibrate) navigator.vibrate([120,60,120]); }catch{}
  try{
    const ctx=new (window.AudioContext||window.webkitAudioContext)();
    const o=ctx.createOscillator(), g=ctx.createGain();
    o.connect(g); g.connect(ctx.destination);
    o.frequency.value=880; o.type='sine';
    g.gain.setValueAtTime(0.001,ctx.currentTime);
    g.gain.exponentialRampToValueAtTime(0.25,ctx.currentTime+0.03);
    g.gain.exponentialRampToValueAtTime(0.001,ctx.currentTime+0.4);
    o.start(); o.stop(ctx.currentTime+0.42);
  }catch{}
  // Toast si está disponible
  try{ __appToast('Nueva solicitud de material','ok'); }catch{}
}
