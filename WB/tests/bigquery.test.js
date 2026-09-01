const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildDiscoverySql, buildCertifiedLegSql, sqlHasSelectStar, sqlHasPartitionFilter,
  sqlIsReadOnly, validateSchema, parseRowsWithSchema, computeGuardBandRange, fqTable,
} = require('../25_BigQueryGateway.js');
const { CONFIG_DEFAULTS, BQ_REQUIRED_FIELDS, BQ_DISCOVERY_FIELDS } = require('../00_Constants.js');

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

// ---------------------------------------------------------------------------
// D1-D5 (bug latente de discovery parser): buildDiscoverySql() devuelve un result set AGREGADO
// (BQ_DISCOVERY_FIELDS, ~10 columnas), no leg-level (BQ_REQUIRED_FIELDS, 84 columnas). Antes de
// este fix, parseRowsWithSchema() validaba SIEMPRE contra el default (BQ_REQUIRED_FIELDS), por lo
// que Orchestrator.discoverSnapshots() fallaria con SCHEMA_ERROR apenas el IAM de BigQuery se
// desbloqueara, aunque la respuesta de BigQuery fuera exactamente la esperada.
// ---------------------------------------------------------------------------

const discoverySchema = BQ_DISCOVERY_FIELDS.map((name) => ({ name }));

test('D1 - discovery: schema exacto de buildDiscoverySql() valida OK contra BQ_DISCOVERY_FIELDS', () => {
  const result = validateSchema(discoverySchema, BQ_DISCOVERY_FIELDS);
  assert.equal(result.ok, true, 'faltan: ' + JSON.stringify(result.missing));
});

test('D2 - discovery: si falta una columna propia del discovery (ej. load_key_id), FALLA', () => {
  const incomplete = discoverySchema.filter((f) => f.name !== 'load_key_id');
  const result = validateSchema(incomplete, BQ_DISCOVERY_FIELDS);
  assert.equal(result.ok, false);
  assert.ok(result.missing.indexOf('load_key_id') !== -1);
});

test('D3 - discovery: NO exige columnas leg-level (ej. flight_number, briefing_time) que nunca devuelve', () => {
  const result = validateSchema(discoverySchema, BQ_DISCOVERY_FIELDS);
  assert.equal(result.ok, true);
  // El schema de discovery deliberadamente no incluye columnas leg-level: si BQ_DISCOVERY_FIELDS
  // las exigiera, esta asercion fallaria y delataria una regresion hacia el bug original.
  assert.equal(BQ_DISCOVERY_FIELDS.indexOf('flight_number'), -1);
  assert.equal(BQ_DISCOVERY_FIELDS.indexOf('briefing_time'), -1);
});

test('D4 - certificado: un result set leg-level incompleto SIGUE fallando (contrato leg-level intacto)', () => {
  const certifiedIncomplete = BQ_REQUIRED_FIELDS.filter((f) => f !== 'pairing_start_date').map((name) => ({ name }));
  assert.throws(() => parseRowsWithSchema(certifiedIncomplete, []), /SCHEMA_ERROR/);
});

test('D5 - certificado: un result set leg-level completo SIGUE pasando (default = BQ_REQUIRED_FIELDS)', () => {
  const certifiedComplete = BQ_REQUIRED_FIELDS.map((name) => ({ name }));
  assert.doesNotThrow(() => parseRowsWithSchema(certifiedComplete, []));
});

// ---------------------------------------------------------------------------
// T150-T155 (Mision: separar BigQuery data project / job project)
// ---------------------------------------------------------------------------

const dataProjectId = 'operations-data-prod';
const configWithDifferentJobProject = Object.assign({}, CONFIG_DEFAULTS, {
  PROJECT_ID: dataProjectId, DATASET_ID: 'carmen_gold', TABLE_ID: 'crew_pairing_carmen_system',
  BIGQUERY_JOB_PROJECT_ID: 'datadem-home',
});

test('T150 - data project y job project pueden ser distintos sin romper la construccion de SQL', () => {
  assert.notEqual(configWithDifferentJobProject.PROJECT_ID, configWithDifferentJobProject.BIGQUERY_JOB_PROJECT_ID);
  const sql = buildDiscoverySql(configWithDifferentJobProject);
  assert.match(sql, /operations-data-prod\.carmen_gold\.crew_pairing_carmen_system/);
  // BIGQUERY_JOB_PROJECT_ID es un parametro de ejecucion (se pasa aparte a BigQuery.Jobs.query),
  // nunca un literal dentro del SQL generado.
  assert.doesNotMatch(sql, /datadem-home/);
});

test('T151 - fqTable() sigue apuntando a operations-data-prod aunque BIGQUERY_JOB_PROJECT_ID sea datadem-home', () => {
  assert.equal(fqTable(configWithDifferentJobProject), '`operations-data-prod.carmen_gold.crew_pairing_carmen_system`');
});

test('T152 - discovery: schema exacto pasa (duplicado explicito del escenario T15x pedido por la mision)', () => {
  assert.equal(validateSchema(discoverySchema, BQ_DISCOVERY_FIELDS).ok, true);
});

test('T153 - discovery: schema incompleto falla', () => {
  const incomplete = discoverySchema.filter((f) => f.name !== 'ingestion_datetime');
  assert.equal(validateSchema(incomplete, BQ_DISCOVERY_FIELDS).ok, false);
});

test('T154 - discovery: no exige BQ_REQUIRED_FIELDS leg-level completo', () => {
  // El schema real de discovery (10 columnas) jamas cumpliria el contrato leg-level completo
  // (84 columnas); validarlo contra BQ_DISCOVERY_FIELDS explicitamente es lo que lo hace pasar.
  assert.equal(validateSchema(discoverySchema).ok, false, 'sin requiredFields explicito cae al default leg-level y debe fallar');
  assert.equal(validateSchema(discoverySchema, BQ_DISCOVERY_FIELDS).ok, true);
});

test('T155 - certified leg schema si exige BQ_REQUIRED_FIELDS (sin relajar el contrato leg-level)', () => {
  const certifiedComplete = BQ_REQUIRED_FIELDS.map((name) => ({ name }));
  assert.equal(validateSchema(certifiedComplete).ok, true);
  const missingOne = certifiedComplete.filter((f) => f.name !== 'crew_base_code');
  assert.equal(validateSchema(missingOne).ok, false);
});
