const test = require('node:test');
const assert = require('node:assert/strict');
const { computeHistoryKey, buildHistoryFileName, extractShortKeyFromFileName } = require('../65_History.js');

const baseFields = {
  schema_version: 'WB-PAIRINGS-2.1.0', ruleset_id: 'LP_WB_B767',
  reference_year: '2026', reference_month: '9',
  snapshot_key: 'SNAP123', config_hash: 'CFG123', query_version: 'WB_CARMEN_GOLD_V1',
};

test('computeHistoryKey - deterministico para el mismo run logico', () => {
  assert.equal(computeHistoryKey(baseFields), computeHistoryKey(Object.assign({}, baseFields)));
});

test('computeHistoryKey - cambia si cambia el snapshot (recalculo con otra carga)', () => {
  const k1 = computeHistoryKey(baseFields);
  const k2 = computeHistoryKey(Object.assign({}, baseFields, { snapshot_key: 'SNAP_OTRO' }));
  assert.notEqual(k1, k2);
});

test('computeHistoryKey - cambia si cambia config_hash (recalculo con otras reglas)', () => {
  const k1 = computeHistoryKey(baseFields);
  const k2 = computeHistoryKey(Object.assign({}, baseFields, { config_hash: 'CFG_OTRO' }));
  assert.notEqual(k1, k2);
});

test('computeHistoryKey - NO depende de la fecha/hora en que se ejecuta el run (mismo run logico = mismo key)', () => {
  // computeHistoryKey no recibe started_at/run_id en absoluto; verificamos que campos ajenos no filtren.
  const fieldsWithExtraNoise = Object.assign({}, baseFields, { started_at: '2026-08-28T10:00:00', run_id: 'RUN-XYZ' });
  assert.equal(computeHistoryKey(baseFields), computeHistoryKey(fieldsWithExtraNoise));
});

test('buildHistoryFileName - formato esperado con mes en espanol y key corto en mayusculas', () => {
  const key = computeHistoryKey(baseFields);
  const name = buildHistoryFileName('2026', '9', key);
  assert.match(name, /^Pairings WB SEPTIEMBRE-2026 \[[0-9A-F]{12}\]$/);
});

test('extractShortKeyFromFileName - permite reconocer un historico ya archivado por su nombre (idempotencia)', () => {
  const key = computeHistoryKey(baseFields);
  const name = buildHistoryFileName('2026', '9', key);
  const shortFromName = extractShortKeyFromFileName(name);
  assert.equal(shortFromName, key.substring(0, 12).toUpperCase());
});

test('idempotencia de nombre - mismo run logico produce el mismo nombre de archivo exacto', () => {
  const name1 = buildHistoryFileName('2026', '9', computeHistoryKey(baseFields));
  const name2 = buildHistoryFileName('2026', '9', computeHistoryKey(Object.assign({}, baseFields)));
  assert.equal(name1, name2);
});
