/**
 * js/consumo.js
 * Pantalla de declaración de material al marcar orden realizada.
 * Usada por cambios.js y otc.js
 * Exporta: abrirConsumoOrden({ orden, modulo, session, db, onSuccess })
 */

import { toast } from './ui.js';

const safeNum = v => { const n = Number(v); return isNaN(n) ? 0 : n; };
const safeStr = (v, fb='—') => (v !== undefined && v !== null && String(v).trim()) ? String(v).trim() : fb;
const tc = str => safeStr(str,'').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());

// Tipos que requieren medidor
const REQUIERE_MEDIDOR_OTC     = ['servicio_nuevo','cambio_voltaje'];
const REQUIERE_MEDIDOR_CAMBIOS = true; // todas las órdenes de cambios

function requiereMedidor(orden, modulo) {
  if (modulo === 'cambios') return REQUIERE_MEDIDOR_CAMBIOS;
  if (modulo === 'otc')     return REQUIERE_MEDIDOR_OTC.includes(orden.tipo);
  return false;
}

export async function abrirConsumoOrden({ orden, modulo, session, db, onSuccess }) {
  const destino = session.asignacionActual?.destino || session.displayName;
  const uid     = session.uid;
  const necMedidor = requiereMedidor(orden, modulo);

  // Mostrar loading mientras carga datos
  const ov = document.createElement('div');
  ov.style.cssText = 'position:fixed;inset:0;z-index:600;background:#0d1117;overflow-y:auto;-webkit-overflow-scrolling:touch;display:flex;align-items:center;justify-content:center;';
  ov.innerHTML = `<div class="spinner" style="width:32px;height:32px;border-width:3px"></div>`;
  document.body.appendChild(ov);

  // Cargar datos en paralelo
  let seriales = [], allItems = [], salidas = [], consumos = [];
  try {
    const queries = [
      db.collection('kardex').doc('inventario').collection('items').get(),
      db.collection('kardex').doc('movimientos').collection('salidas').get(),
      db.collection('kardex').doc('movimientos').collection('consumos').get(),
    ];
    if (necMedidor) {
      queries.push(
        db.collection('kardex').doc('seriales').collection('items')
          .where('estado', '==', 'disponible')
          .get()
      );
    }
    const results = await Promise.all(queries);
    allItems  = results[0].docs.map(d => ({ id: d.id, ...d.data() }));
    salidas   = results[1].docs.map(d => ({ id: d.id, ...d.data() }));
    consumos  = results[2].docs.map(d => ({ id: d.id, ...d.data() }));
    if (necMedidor && results[3]) {
      // Filtrar seriales del técnico
      seriales = results[3].docs
        .map(d => ({ id: d.id, ...d.data() }))
        .filter(s => s.usuarioDespacho === destino);
    }
  } catch(err) {
    ov.remove();
    alert('Error al cargar datos: ' + err.message);
    return;
  }

  // Calcular stock del técnico
  const stockU = {};
  salidas.forEach(s => {
    if ((s.usuarioResponsable || s.tecnicoNombre) !== destino) return;
    (s.items||[]).forEach(i => {
      const c = safeNum(i.cantidad);
      if (!i.itemId || c <= 0) return;
      stockU[i.itemId] = (stockU[i.itemId] || 0) + c;
    });
  });
  consumos.forEach(c => {
    if (c.usuarioOperativo !== destino) return;
    (c.items||[]).forEach(i => {
      const cant = safeNum(i.cantidad);
      if (!i.itemId || cant <= 0) return;
      stockU[i.itemId] = Math.max(0, (stockU[i.itemId] || 0) - cant);
    });
  });

  const miMaterial = Object.entries(stockU)
    .map(([id, cant]) => ({ cant, item: allItems.find(i => i.id === id) }))
    .filter(e => e.cant > 0 && e.item && !e.item.requiereSerial) // seriales van separados
    .sort((a, b) => safeStr(a.item.name).localeCompare(safeStr(b.item.name)));

  // Estado
  let actualizadoDelsur = null; // null = sin seleccionar
  let serialSeleccionado = null;
  let busqSerial = '';
  let cantidades = {}; // itemId -> cantidad usada

  function render() {
    const woLabel = safeStr(orden.wo || orden.WO);
    const totalMat = Object.values(cantidades).reduce((s,v) => s + v, 0);
    const listo = actualizadoDelsur !== null
      && (!necMedidor || serialSeleccionado)
      && totalMat > 0;

    ov.style.alignItems = '';
    ov.style.justifyContent = '';
    ov.innerHTML = `
      <div style="max-width:480px;margin:0 auto;padding:0 0 24px">

        <!-- Header -->
        <div style="padding:16px 20px;border-bottom:1px solid var(--border);display:flex;align-items:center;gap:12px;position:sticky;top:0;background:#0d1117;z-index:10">
          <button class="icon-btn" id="btn-cerrar-consumo">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="18" height="18"><polyline points="15 18 9 12 15 6"/></svg>
          </button>
          <div>
            <div style="font-size:15px;font-weight:800">Declarar material usado</div>
            <div style="font-size:11px;color:var(--text-4)">WO ${woLabel} · ${safeStr(orden.cliente)}</div>
          </div>
        </div>

        <div style="padding:16px 20px" class="flex-col gap-16">

          <!-- ¿Actualizaste en DELSUR? -->
          <div>
            <div class="form-label" style="margin-bottom:10px">¿Actualizaste en DELSUR?</div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
              <button id="btn-si" style="height:48px;border-radius:12px;border:2px solid ${actualizadoDelsur===true?'#22c55e':'var(--border)'};background:${actualizadoDelsur===true?'rgba(34,197,94,.12)':'var(--glass)'};color:${actualizadoDelsur===true?'#22c55e':'var(--text-3)'};font-size:14px;font-weight:700;font-family:'Outfit',sans-serif;cursor:pointer;transition:all .15s">
                ✓ Sí
              </button>
              <button id="btn-no" style="height:48px;border-radius:12px;border:2px solid ${actualizadoDelsur===false?'#f97316':'var(--border)'};background:${actualizadoDelsur===false?'rgba(249,115,22,.12)':'var(--glass)'};color:${actualizadoDelsur===false?'#f97316':'var(--text-3)'};font-size:14px;font-weight:700;font-family:'Outfit',sans-serif;cursor:pointer;transition:all .15s">
                ✗ No aún
              </button>
            </div>
          </div>

          <!-- Medidor (si aplica) -->
          ${necMedidor ? `
          <div>
            <div class="form-label" style="margin-bottom:4px">
              Serial del medidor instalado
              <span style="color:#ef4444;margin-left:2px">*</span>
            </div>
            <div style="font-size:10px;color:var(--text-4);margin-bottom:10px">${seriales.length} disponibles asignados a ti</div>

            ${serialSeleccionado ? `
            <div style="background:rgba(34,197,94,.08);border:2px solid rgba(34,197,94,.3);border-radius:12px;padding:12px 16px;display:flex;align-items:center;justify-content:space-between">
              <div>
                <div style="font-size:11px;color:var(--text-4);margin-bottom:2px">Seleccionado</div>
                <div style="font-size:16px;font-weight:800;font-family:monospace;color:#22c55e">${serialSeleccionado.serial}</div>
                <div style="font-size:10px;color:var(--text-4)">${safeStr(serialSeleccionado.itemNombre)}</div>
              </div>
              <button class="icon-btn" id="btn-quitar-serial" style="width:32px;height:32px">
                <svg viewBox="0 0 24 24" fill="none" stroke="#ef4444" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
              </button>
            </div>` : `
            <div class="buscar-wrap" style="margin-bottom:8px">
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14" style="color:var(--text-4);flex-shrink:0"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
              <input class="buscar-input" id="busq-serial" placeholder="Buscar por serial…" value="${busqSerial}" autocomplete="off"/>
            </div>
            <div id="lista-seriales" style="max-height:160px;overflow-y:auto;border:1px solid var(--border);border-radius:12px;overflow:hidden">
              ${renderListaSeriales()}
            </div>`}
          </div>` : ''}

          <!-- Material usado -->
          <div>
            <div class="form-label" style="margin-bottom:4px">
              Material utilizado
              <span style="color:#ef4444;margin-left:2px">*</span>
            </div>
            <div style="font-size:10px;color:var(--text-4);margin-bottom:10px">Toca la cantidad para editarla</div>

            ${!miMaterial.length ? `
            <div style="padding:16px;text-align:center;background:var(--glass);border:1px solid var(--border);border-radius:12px">
              <div style="font-size:12px;color:var(--text-4)">Sin material asignado en bodega</div>
            </div>` : `
            <div class="flex-col gap-6">
              ${miMaterial.map(e => {
                const cant = cantidades[e.item.id] || 0;
                const usado = cant > 0;
                return `
                <div style="display:flex;align-items:center;gap:12px;padding:12px 14px;background:${usado?'rgba(139,92,246,.06)':'var(--glass)'};border:1px solid ${usado?'rgba(139,92,246,.25)':'var(--border)'};border-radius:12px">
                  <div style="flex:1;min-width:0">
                    <div style="font-size:13px;font-weight:600">${tc(e.item.name)}</div>
                    <div style="font-size:10px;color:var(--text-4)">Disponible: ${e.cant} ${safeStr(e.item.unit,'')}</div>
                  </div>
                  <button class="btn-cant-mat" data-id="${e.item.id}" data-max="${e.cant}" data-unit="${safeStr(e.item.unit,'')}"
                    style="min-width:56px;height:44px;border-radius:10px;border:2px solid ${usado?'rgba(139,92,246,.4)':'var(--border)'};background:${usado?'rgba(139,92,246,.1)':'var(--glass)'};color:${usado?'var(--bod-light)':'var(--text-3)'};font-size:${cant>=100?'14px':'18px'};font-weight:800;font-family:'Outfit',sans-serif;cursor:pointer;padding:0 10px">
                    ${cant > 0 ? cant : '—'}
                  </button>
                </div>`;
              }).join('')}
            </div>`}
          </div>

        </div>

        <!-- Footer -->
        <div style="position:sticky;bottom:0;padding:12px 20px;background:#0d1117;border-top:1px solid var(--border)">
          <div id="consumo-error" class="form-error" style="margin-bottom:8px"></div>
          <button id="btn-confirmar-consumo" style="width:100%;height:52px;border-radius:14px;border:none;background:${listo?'linear-gradient(135deg,rgba(139,92,246,.8),rgba(99,58,200,.8))':'rgba(255,255,255,.06)'};color:${listo?'white':'var(--text-4)'};font-size:15px;font-weight:800;font-family:'Outfit',sans-serif;cursor:${listo?'pointer':'default'};transition:all .2s">
            <span id="btn-confirmar-lbl">Confirmar orden realizada ✓</span>
          </button>
        </div>

      </div>
    `;

    // Listeners
    document.getElementById('btn-cerrar-consumo')?.addEventListener('click', () => { ov.remove(); });
    document.getElementById('btn-si')?.addEventListener('click', () => { actualizadoDelsur = true; render(); });
    document.getElementById('btn-no')?.addEventListener('click', () => { actualizadoDelsur = false; render(); });
    document.getElementById('btn-quitar-serial')?.addEventListener('click', () => { serialSeleccionado = null; render(); });

    // Buscador serial
    document.getElementById('busq-serial')?.addEventListener('input', e => {
      busqSerial = e.target.value.trim();
      const lista = document.getElementById('lista-seriales');
      if (lista) lista.innerHTML = renderListaSeriales();
      bindSerialItems();
    });
    bindSerialItems();

    // Cantidades material
    document.querySelectorAll('.btn-cant-mat').forEach(btn => {
      btn.addEventListener('click', () => {
        const id   = btn.dataset.id;
        const max  = safeNum(btn.dataset.max);
        const unit = btn.dataset.unit;
        const item = miMaterial.find(e => e.item.id === id);
        abrirModalCantidad({
          nombre: item ? tc(item.item.name) : id,
          max, unit,
          valorActual: cantidades[id] || 0,
          onConfirm: val => {
            if (val === 0) delete cantidades[id];
            else cantidades[id] = val;
            render();
          }
        });
      });
    });

    // Confirmar
    document.getElementById('btn-confirmar-consumo')?.addEventListener('click', () => {
      if (listo) handleConfirmar();
    });
  }

  function renderListaSeriales() {
    const q = busqSerial.toLowerCase();
    const filtrados = q
      ? seriales.filter(s => s.serial.toLowerCase().includes(q))
      : seriales;
    if (!filtrados.length) return `<div style="padding:14px;text-align:center;font-size:12px;color:var(--text-4)">Sin seriales disponibles</div>`;
    return filtrados.map(s => `
      <div class="serial-item" data-id="${s.id}" style="padding:12px 16px;cursor:pointer;border-bottom:1px solid var(--border);display:flex;align-items:center;justify-content:space-between;background:#0d1117">
        <div>
          <div style="font-size:13px;font-weight:700;font-family:monospace">${s.serial}</div>
          <div style="font-size:10px;color:var(--text-4)">${safeStr(s.itemNombre)}</div>
        </div>
        <svg viewBox="0 0 24 24" fill="none" stroke="var(--text-4)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" width="14" height="14"><polyline points="9 18 15 12 9 6"/></svg>
      </div>
    `).join('');
  }

  function bindSerialItems() {
    document.querySelectorAll('.serial-item').forEach(row => {
      row.addEventListener('click', () => {
        const s = seriales.find(x => x.id === row.dataset.id);
        if (s) { serialSeleccionado = s; busqSerial = ''; render(); }
      });
    });
  }

  async function handleConfirmar() {
    const errEl = document.getElementById('consumo-error');
    errEl.style.display = 'none';
    setLoading('btn-confirmar-lbl', 'Guardando…', true);

    const itemsConsumo = Object.entries(cantidades).map(([itemId, cantidad]) => {
      const e = miMaterial.find(x => x.item.id === itemId);
      return { itemId, nombre: e?.item.name || itemId, unit: e?.item.unit || '', sapCode: e?.item.sapCode || null, cantidad };
    });

    if (necMedidor && serialSeleccionado) {
      itemsConsumo.push({
        itemId:   serialSeleccionado.itemId,
        nombre:   serialSeleccionado.itemNombre,
        unit:     'unidades',
        sapCode:  serialSeleccionado.sapCode || null,
        serial:   serialSeleccionado.serial,
        cantidad: 1,
      });
    }

    try {
      const now   = firebase.firestore.FieldValue.serverTimestamp();
      const batch = db.batch();

      // 1. Registrar consumo
      const consumoRef = db.collection('kardex').doc('movimientos').collection('consumos').doc();
      batch.set(consumoRef, {
        ordenId:          orden.id,
        wo:               orden.wo || orden.WO || '',
        modulo,
        usuarioOperativo: destino,
        usuarioUid:       uid,
        items:            itemsConsumo,
        actualizadoDelsur,
        fecha:            now,
      });

      // 2. Marcar serial como consumido
      if (necMedidor && serialSeleccionado) {
        const serialRef = db.collection('kardex').doc('seriales').collection('items').doc(serialSeleccionado.id);
        batch.update(serialRef, {
          estado:        'consumido',
          ordenId:       orden.id,
          wo:            orden.wo || orden.WO || '',
          fechaConsumo:  now,
        });
      }

      // 3. Marcar la orden como hecha
      const col = modulo === 'cambios' ? 'cambios_ordenes' : 'otc_ordenes';
      batch.update(db.collection(col).doc(orden.id), {
        estadoCampo:      'hecha',
        fechaHecha:       now,
        hechaPor:         session.displayName,
        actualizadaDelsur: actualizadoDelsur,
      });

      await batch.commit();

      ov.remove();
      toast('Orden marcada como realizada', 'ok');
      if (onSuccess) onSuccess({ actualizadoDelsur, itemsConsumo });
    } catch(err) {
      console.error('[consumo] Error:', err);
      errEl.textContent = `Error: ${err.message}`;
      errEl.style.display = 'block';
      setLoading('btn-confirmar-lbl', 'Confirmar orden realizada ✓', false);
    }
  }

  render();
}

// ── Modal de cantidad ─────────────────────────────
function abrirModalCantidad({ nombre, max, unit, valorActual, onConfirm }) {
  const m = document.createElement('div');
  m.style.cssText = 'position:fixed;inset:0;background:rgba(0,0,0,.7);display:flex;align-items:flex-end;z-index:700;';
  m.innerHTML = `
    <div style="background:#1a1f2e;width:100%;border-radius:20px 20px 0 0;padding:20px 20px max(32px,20px)">
      <div style="width:36px;height:4px;background:rgba(255,255,255,.15);border-radius:2px;margin:0 auto 16px"></div>
      <div style="font-size:15px;font-weight:700;margin-bottom:4px">${nombre}</div>
      <div style="font-size:11px;color:var(--text-4);margin-bottom:20px">Máximo disponible: ${max} ${unit}</div>
      <div style="display:flex;align-items:center;justify-content:space-between;gap:16px;margin-bottom:20px">
        <button id="mc-dec" class="icon-btn" style="width:56px;height:56px;font-size:28px;font-weight:300">−</button>
        <div style="flex:1;text-align:center">
          <input id="mc-cant" type="number" inputmode="numeric" min="0" max="${max}" value="${valorActual}"
            style="width:100%;text-align:center;font-size:44px;font-weight:900;color:var(--text);background:transparent;border:none;outline:none;font-family:'Outfit',sans-serif;"/>
          <div style="font-size:12px;color:var(--text-4)">${unit}</div>
        </div>
        <button id="mc-inc" class="icon-btn" style="width:56px;height:56px;font-size:28px;font-weight:300;color:var(--bod-light);border-color:var(--bod-border);background:var(--bod-glass)">+</button>
      </div>
      <div id="mc-err" class="form-error" style="margin-bottom:8px"></div>
      <div style="display:grid;grid-template-columns:1fr 1fr;gap:8px">
        <button id="mc-quitar" style="height:48px;border-radius:12px;border:1px solid var(--border);background:var(--glass);color:var(--text-3);font-size:13px;font-weight:600;font-family:'Outfit',sans-serif;cursor:pointer">
          Quitar
        </button>
        <button id="mc-ok" style="height:48px;border-radius:12px;border:none;background:linear-gradient(135deg,rgba(139,92,246,.8),rgba(99,58,200,.8));color:white;font-size:14px;font-weight:700;font-family:'Outfit',sans-serif;cursor:pointer">
          Confirmar
        </button>
      </div>
    </div>
  `;
  document.body.appendChild(m);

  const cantEl = m.querySelector('#mc-cant');
  setTimeout(() => { cantEl.focus(); cantEl.select(); }, 80);

  m.addEventListener('click', e => { if (e.target === m) m.remove(); });
  m.querySelector('#mc-dec').onclick = () => { const v = safeNum(cantEl.value); if (v > 0) cantEl.value = v - 1; };
  m.querySelector('#mc-inc').onclick = () => { const v = safeNum(cantEl.value); if (v < max) cantEl.value = v + 1; };
  m.querySelector('#mc-quitar').onclick = () => { m.remove(); onConfirm(0); };
  m.querySelector('#mc-ok').addEventListener('click', () => {
    const cant  = safeNum(cantEl.value);
    const errEl = m.querySelector('#mc-err');
    if (cant < 0) { errEl.textContent = 'Cantidad inválida.'; errEl.style.display = 'block'; return; }
    if (cant > max) { errEl.textContent = `Máximo: ${max} ${unit}`; errEl.style.display = 'block'; return; }
    m.remove();
    onConfirm(cant);
  });
}

function setLoading(labelId, text, loading) {
  const el = document.getElementById(labelId);
  if (!el) return;
  el.innerHTML = loading ? '<div class="spinner"></div>' : text;
}
