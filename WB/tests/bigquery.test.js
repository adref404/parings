const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDiscoverySql, buildCertifiedLegSql, sqlHasSelectStar, sqlHasPartitionFilter,
  sqlIsReadOnly, validateSchema, parseRowsWithSchema, computeGuardBandRange,
} = require('../25_BigQueryGateway.js');
const { CONFIG_DEFAULTS, BQ_REQUIRED_FIELDS } = require('../00_Constants.js');

const config = Object.assign({}, CONFIG_DEFAULTS, {
  PROJECT_ID: 'operations-data-prod', DATASET_ID: 'carmen_gold', TABLE_ID: 'crew_pairing_carmen_system',
});
const loadIdentity = { load_key_id: 'FP_LP_WB_TM_09_2026_1', load_type_code: 'FP', load_version_id: '1', ingestion_datetime: '2026-08-20 00:00:00' };

test('buildDiscoverySql - sin SELECT *, read-only, con filtro de particion', () => {
  const sql = buildDiscoverySql(config);
  assert.equal(sqlHasSelectStar(sql), false);
  assert.equal(sqlIsReadOnly(sql), true);
  assert.equal(sqlHasPartitionFilter(sql, 'pairing_start_date'), true);
  assert.match(sql, /operations-data-prod\.carmen_gold\.crew_pairing_carmen_system/);
  assert.match(sql, /subsidiary_code = 'LP'/);
  assert.match(sql, /GROUP BY/);
});

test('buildCertifiedLegSql - proyecta columnas requeridas explicitas, no SELECT *', () => {
  const sql = buildCertifiedLegSql(config, loadIdentity);
  assert.equal(sqlHasSelectStar(sql), false);
  assert.equal(sqlIsReadOnly(sql), true);
  assert.equal(sqlHasPartitionFilter(sql, 'pairing_start_date'), true);
  BQ_REQUIRED_FIELDS.forEach(f => assert.match(sql, new RegExp('\\b' + f + '\\b'), `falta columna ${f} en el SELECT`));
  assert.match(sql, /load_key_id = 'FP_LP_WB_TM_09_2026_1'/);
});

test('buildCertifiedLegSql - escapa comillas simples en valores de config (defensivo)', () => {
  const evil = Object.assign({}, loadIdentity, { load_key_id: "FP_LP'; DROP TABLE x; --" });
  const sql = buildCertifiedLegSql(config, evil);
  assert.doesNotMatch(sql, /--\s*$/m);
  assert.match(sql, /\\'/);
});

test('computeGuardBandRange - cubre limites de mes (agosto/septiembre 2026) con banda de guarda', () => {
  const range = computeGuardBandRange('2026', '9');
  assert.deepEqual(range.start, { y: 2026, m: 8, d: 26 });
  assert.deepEqual(range.end, { y: 2026, m: 10, d: 6 });
});

test('computeGuardBandRange - diciembre cruza a enero del anio siguiente', () => {
  const range = computeGuardBandRange('2026', '12');
  assert.equal(range.end.y, 2027);
  assert.equal(range.end.m, 1);
});

test('validateSchema - detecta columnas faltantes sin adivinar indices (SCHEMA_ERROR)', () => {
  const schema = [{ name: 'pairing_id' }, { name: 'flight_number' }]; // esquema incompleto a proposito
  const result = validateSchema(schema);
  assert.equal(result.ok, false);
  assert.ok(result.missing.length > 0);
  assert.ok(result.missing.indexOf('pairing_start_date') !== -1);
});

test('validateSchema - PASA contra el esquema REAL de BigQuery (84 columnas, capturado en el audit vivo)', () => {
  const realSchema = require('./fixtures/carmen_gold_bq_schema_snapshot.json');
  assert.equal(realSchema.fields.length, 84);
  const result = validateSchema(realSchema.fields);
  assert.equal(result.ok, true, 'faltan: ' + JSON.stringify(result.missing));
});

test('parseRowsWithSchema - usa nombres de columna, no indices fijos (tolera reordenamiento)', () => {
  const schemaOrderA = [{ name: 'pairing_id' }, { name: 'flight_number' }].concat(
    BQ_REQUIRED_FIELDS.filter(f => f !== 'pairing_id' && f !== 'flight_number').map(n => ({ name: n }))
  );
  const schemaOrderB = schemaOrderA.slice().reverse(); // mismas columnas, orden fisico invertido

  function buildRow(schema, values) {
    return { f: schema.map(s => ({ v: values[s.name] !== undefined ? values[s.name] : null })) };
  }
  const values = { pairing_id: '226', flight_number: '507' };

  const rowsA = parseRowsWithSchema(schemaOrderA, [buildRow(schemaOrderA, values)]);
  const rowsB = parseRowsWithSchema(schemaOrderB, [buildRow(schemaOrderB, values)]);

  assert.equal(rowsA[0].pairing_id, '226');
  assert.equal(rowsB[0].pairing_id, '226');
  assert.equal(rowsA[0].flight_number, rowsB[0].flight_number);
});

test('parseRowsWithSchema - lanza SCHEMA_ERROR si falta una columna requerida', () => {
  const schema = [{ name: 'pairing_id' }];
  assert.throws(() => parseRowsWithSchema(schema, []), /SCHEMA_ERROR/);
});
