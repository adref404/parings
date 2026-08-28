const test = require('node:test');
const assert = require('node:assert/strict');
const du = require('../05_DateUtil.js');

test('duParseDate / duFormatIso - roundtrip', () => {
  const d = du.duParseDate('2026-09-30');
  assert.deepEqual(d, { y: 2026, m: 9, d: 30 });
  assert.equal(du.duFormatIso(d), '2026-09-30');
});

test('duAddDays - 30/09 + 1 dia = 01/10 (cruce de mes, sin drift UTC)', () => {
  const d = du.duParseDate('2026-09-30');
  const next = du.duAddDays(d, 1);
  assert.deepEqual(next, { y: 2026, m: 10, d: 1 });
});

test('duAddDays - fin de anio', () => {
  const d = du.duParseDate('2026-12-31');
  const next = du.duAddDays(d, 1);
  assert.deepEqual(next, { y: 2027, m: 1, d: 1 });
});

test('duAddDays - anio bisiesto (2028-02-29 existe)', () => {
  const d = du.duParseDate('2028-02-28');
  const next = du.duAddDays(d, 1);
  assert.deepEqual(next, { y: 2028, m: 2, d: 29 });
});

test('duDiffDays - calcula dias entre dos fechas inclusive+1 (occupied_days)', () => {
  const start = du.duParseDate('2026-09-01');
  const end = du.duParseDate('2026-09-03');
  const days = du.duDiffDays(start, end) + 1;
  assert.equal(days, 3);
});

test('duDowCode - 2026-09-01 es martes', () => {
  // Verificado externamente: 1 de septiembre de 2026 cae en martes.
  assert.equal(du.duDowCode({ y: 2026, m: 9, d: 1 }), 'TUE');
});

test('duDowCode - 1970-01-01 es jueves (referencia epoch)', () => {
  assert.equal(du.duDowCode({ y: 1970, m: 1, d: 1 }), 'THU');
});

test('duDowCode - fechas antes de la epoch (1969) tambien funcionan', () => {
  assert.equal(du.duDowCode({ y: 1969, m: 12, d: 31 }), 'WED');
});

test('duCompareDate - orden correcto', () => {
  const a = du.duParseDate('2026-09-01');
  const b = du.duParseDate('2026-09-02');
  assert.equal(du.duCompareDate(a, b), -1);
  assert.equal(du.duCompareDate(b, a), 1);
  assert.equal(du.duCompareDate(a, a), 0);
});

test('duSortKey - ordena por fecha y luego por hora dentro del mismo dia', () => {
  const k1 = du.duSortKey(du.duParseDate('2026-09-01'), du.duParseTime('23:59:59'));
  const k2 = du.duSortKey(du.duParseDate('2026-09-02'), du.duParseTime('00:00:00'));
  assert.ok(k1 < k2, 'un dia despues a medianoche debe ordenar despues que 23:59:59 del dia anterior');
});

test('duIsAllowedDow - respeta el set configurado, no hardcodea NB', () => {
  const allowed = ['MON', 'TUE', 'WED', 'THU', 'FRI'];
  assert.equal(du.duIsAllowedDow({ y: 2026, m: 9, d: 1 }, allowed), true); // martes
  // 2026-09-05 es sabado
  assert.equal(du.duIsAllowedDow({ y: 2026, m: 9, d: 5 }, allowed), false);
});

test('duParseDatetime - soporta separador T y espacio', () => {
  const a = du.duParseDatetime('2026-01-16T14:29:49');
  const b = du.duParseDatetime('2026-01-16 14:29:49');
  assert.deepEqual(a, b);
  assert.deepEqual(a.date, { y: 2026, m: 1, d: 16 });
  assert.deepEqual(a.time, { h: 14, mi: 29, s: 49 });
});

test('duParseDisplayDate - inversa exacta de duFormatDisplay (roundtrip)', () => {
  const d = { y: 2026, m: 9, d: 30 };
  assert.deepEqual(du.duParseDisplayDate(du.duFormatDisplay(d)), d);
});

test('duParseDisplayDate - invalido devuelve null, no lanza', () => {
  assert.equal(du.duParseDisplayDate(''), null);
  assert.equal(du.duParseDisplayDate('2026-09-30'), null); // formato ISO, no DD/MM/YYYY
  assert.equal(du.duParseDisplayDate('no es fecha'), null);
});

test('duParseDate - invalido devuelve null, no lanza', () => {
  assert.equal(du.duParseDate(''), null);
  assert.equal(du.duParseDate(null), null);
  assert.equal(du.duParseDate('no-es-fecha'), null);
});
