// Pruebas de js/dias_habiles.js (no se cargan en la app).
// Correr con:  TZ=America/El_Salvador node --test tests/*.test.mjs
import test from 'node:test';
import assert from 'node:assert/strict';
import { diasHabiles, semaforo, diasOrden, semaforoOrden, esHabil, claveDia, aFecha } from '../js/dias_habiles.js';

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
