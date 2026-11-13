// Pruebas de js/dias_habiles.js (no se cargan en la app).
// Correr con:  TZ=America/El_Salvador node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { diasHabiles, semaforo, diasOrden, semaforoOrden, esHabil, claveDia, aFecha, fechaVence, vencimiento, textoVence, proximoHabil, cuandoProximoHabil } from '../js/dias_habiles.js';

// Octubre 2026: jueves 1, viernes 2, sábado 3, domingo 4, lunes 5 ...
const d = (s, h = 9) => { const [y, m, dd] = s.split('-').map(Number); return new Date(y, m - 1, dd, h, 30); };
const ts = s => ({ seconds: Math.floor(d(s).getTime() / 1000), toDate() { return d(s); } });

test('el día de liberación cuenta como día 1', () => {
  assert.equal(diasHabiles(d('2026-10-05'), d('2026-10-05', 17)), 1);   // lunes, mismo día
  assert.equal(diasHabiles(d('2026-10-05'), d('2026-10-06')), 2);
});

test('la hora no importa, solo el día', () => {
  assert.equal(diasHabiles(d('2026-10-05', 23), d('2026-10-06', 0)), 2);
  assert.equal(diasHabiles(d('2026-10-05', 0), d('2026-10-05', 23)), 1);
});

test('fines de semana no cuentan', () => {
  assert.equal(diasHabiles(d('2026-10-02'), d('2026-10-05')), 2);   // viernes a lunes
  assert.equal(diasHabiles(d('2026-10-03'), d('2026-10-04')), 0);   // sábado a domingo
  assert.equal(diasHabiles(d('2026-10-03'), d('2026-10-05')), 1);   // liberada sábado: empieza el lunes
  assert.equal(diasHabiles(d('2026-10-05'), d('2026-10-16')), 10);  // dos semanas completas
});

test('festivos no cuentan (texto, Date o Set)', () => {
  const fest = ['2026-10-07'];
  assert.equal(diasHabiles(d('2026-10-05'), d('2026-10-09'), fest), 4);
  assert.equal(diasHabiles(d('2026-10-05'), d('2026-10-09'), [d('2026-10-07')]), 4);
  assert.equal(diasHabiles(d('2026-10-05'), d('2026-10-09'), new Set(['2026-10-07'])), 4);
  assert.equal(diasHabiles(d('2026-10-07'), d('2026-10-07'), fest), 0);   // liberada en festivo
  assert.equal(diasHabiles(d('2026-10-05'), d('2026-10-09'), ['2026-10-10']), 5); // festivo en sábado: nada cambia
});

test('cruce de mes y de año', () => {
  assert.equal(diasHabiles(d('2026-09-28'), d('2026-10-02')), 5);   // lunes 28 sep a viernes 2 oct
  assert.equal(diasHabiles(d('2026-10-30'), d('2026-11-03'), ['2026-11-02']), 2); // viernes, lunes festivo, martes
  assert.equal(diasHabiles(d('2026-12-31'), d('2027-01-04'), ['2027-01-01']), 2);
  assert.equal(diasHabiles(d('2024-02-28'), d('2024-03-01')), 3);   // año bisiesto
});

test('hasta antes que desde da 0, fechas faltantes dan 0', () => {
  assert.equal(diasHabiles(d('2026-10-06'), d('2026-10-05')), 0);
  assert.equal(diasHabiles(null, d('2026-10-05')), 0);
});

test('rangos del semáforo', () => {
  assert.deepEqual([0, 1, 2, 3, 4, 5, 6, 30].map(semaforo),
    ['verde', 'verde', 'verde', 'verde', 'amarillo', 'amarillo', 'rojo', 'rojo']);
});

test('orden abierta cuenta hasta hoy; cerrada, hasta su cierre', () => {
  const hoy = d('2026-10-15');   // jueves
  const abierta = { fechaLiberacion: ts('2026-10-05'), estado: null };
  assert.equal(diasOrden(abierta, [], hoy), 9);
  assert.equal(semaforoOrden(abierta, [], hoy).color, 'rojo');

  const visita = { fechaLiberacion: ts('2026-10-12'), estado: 'visita' };   // sin acceso sigue contando
  assert.deepEqual(semaforoOrden(visita, [], hoy), { dias: 4, color: 'amarillo' });

  const cerrada = { fechaLiberacion: ts('2026-10-05'), estado: 'cerrada', fechaHecha: ts('2026-10-07') };
  assert.equal(diasOrden(cerrada, [], hoy), 3);
  assert.equal(diasOrden(cerrada, [], d('2027-03-01')), 3);   // no sigue creciendo

  assert.equal(diasOrden({ estado: null }, [], hoy), null);   // sin liberación
  assert.deepEqual(semaforoOrden({}, [], hoy), { dias: null, color: null });
});

test('utilidades de fecha', () => {
  assert.equal(claveDia(d('2026-10-05', 23)), '2026-10-05');
  assert.equal(claveDia('2026-10-05'), '2026-10-05');
  assert.equal(claveDia(ts('2026-01-09')), '2026-01-09');
  assert.equal(esHabil('2026-10-03'), false);
  assert.equal(esHabil('2026-10-05', ['2026-10-05']), false);
  assert.equal(esHabil('2026-10-06'), true);
  assert.equal(aFecha('no es fecha'), null);
});

// ── Vencimiento (plazo de 5 días hábiles) ─────────
// Liberada el lunes 5 de octubre: el último día es el viernes 9.
const abierta = (lib, extra = {}) => ({ fechaLiberacion: ts(lib), estado: null, ...extra });

test('el último día del plazo es el 5º día hábil', () => {
  assert.equal(claveDia(fechaVence(abierta('2026-10-05'))), '2026-10-09');
  assert.equal(claveDia(fechaVence(abierta('2026-10-08'))), '2026-10-14');   // jueves: salta el fin de semana
  assert.equal(claveDia(fechaVence(abierta('2026-10-05'), ['2026-10-07'])), '2026-10-12');   // con festivo
  assert.equal(claveDia(fechaVence(abierta('2026-10-03'))), '2026-10-09');   // liberada sábado: empieza el lunes
  assert.equal(fechaVence({}), null);
});

test('vence mañana, vence hoy y vencida', () => {
  const o = abierta('2026-10-05');
  assert.equal(vencimiento(o, [], d('2026-10-07')).estado, null);        // día 3: a tiempo
  assert.equal(vencimiento(o, [], d('2026-10-08')).estado, 'manana');    // día 4
  assert.equal(vencimiento(o, [], d('2026-10-09')).estado, 'hoy');       // día 5
  const v = vencimiento(o, [], d('2026-10-13'));                         // día 7
  assert.equal(v.estado, 'vencida');
  assert.equal(v.atraso, 2);
  assert.equal(vencimiento({ ...o, estado: 'cerrada', fechaHecha: ts('2026-10-20') }, [], d('2026-10-20')).estado, null);
  assert.equal(vencimiento({ estado: null }, [], d('2026-10-20')).estado, null);   // sin liberación
});

test('el vencimiento coincide con el semáforo', () => {
  const o = abierta('2026-10-05');
  for (const dia of ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08', '2026-10-09', '2026-10-12', '2026-10-13']) {
    const ahora = d(dia);
    const color = semaforoOrden(o, [], ahora).color, est = vencimiento(o, [], ahora).estado;
    assert.equal(color === 'rojo', est === 'vencida', dia);
    assert.equal(color === 'amarillo', est === 'hoy' || est === 'manana', dia);
  }
});

test('textos del vencimiento', () => {
  const o = abierta('2026-10-05');
  const t = dia => textoVence(vencimiento(o, [], d(dia)), [], d(dia));
  assert.equal(t('2026-10-07'), '');
  assert.equal(t('2026-10-08'), 'Vence mañana');
  assert.equal(t('2026-10-09'), 'Vence hoy');
  assert.equal(t('2026-10-12'), 'Vencida hace 1 día hábil');
  assert.equal(t('2026-10-14'), 'Vencida hace 3 días hábiles');
  // Liberada el martes 6: el viernes 9 lleva 4 días y vence el lunes 12
  const o2 = abierta('2026-10-06');
  assert.equal(textoVence(vencimiento(o2, [], d('2026-10-09')), [], d('2026-10-09')), 'Vence el lunes 12');
  // Sábado en su último día: si se cierra hoy sigue en plazo
  const o3 = abierta('2026-10-05');
  assert.equal(textoVence(vencimiento(o3, [], d('2026-10-10')), [], d('2026-10-10')), 'Vence antes del lunes');
  assert.equal(claveDia(proximoHabil(d('2026-10-09'))), '2026-10-12');
});

test('próximo día hábil: mañana o el lunes', () => {
  assert.equal(cuandoProximoHabil([], d('2026-10-08')), 'mañana');      // jueves
  assert.equal(cuandoProximoHabil([], d('2026-10-09')), 'el lunes');    // viernes
  assert.equal(cuandoProximoHabil(['2026-10-13'], d('2026-10-12')), 'el miércoles');   // martes festivo
});

