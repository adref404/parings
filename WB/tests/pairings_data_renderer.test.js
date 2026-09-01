const test = require('node:test');
const assert = require('node:assert/strict');
const { assemblePairings } = require('../30_PairingAssembler.js');
const { evaluateWbRules } = require('../35_WBRules.js');
const { PairingsDataRenderer } = require('../60_PairingsDataRenderer.js');
const { PAIRINGS_DATA_HEADERS } = require('../00_Constants.js');
const { QaService } = require('../70_QA.js');

const config = { CREW_BASE_CODE: 'LIM', MAX_OCCUPIED_DAYS: '3' };
const routes = [{ code: 'MIA', priority: 1, role: 'PRIMARY' }];
const allowedDow = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

function leg(overrides) {
  return Object.assign({
    pairing_id: '226', pairing_name: 'P226', pairing_days_quantity: '3', subfleet_code: '763', fleet_type_code: 'B767',
    departure_airport_code: 'LIM', arrival_airport_code: 'MIA',
    flight_start_date_local_time: '2026-09-01', flight_departure_time_crew_base: '06:00:00',
    flight_arrival_hour_block_time: '12:00:00', flight_number: '507', carrier_code: 'LA',
    duty_presentation_date_at: '2026-09-01', duty_presentation_time_at: '05:00:00',
    duty_end_date_home_base_timezone: '2026-09-01', duty_end_time_hb: '13:00:00',
    pairing_end_date: '2026-09-01', pairing_end_time: '13:00:00',
  }, overrides);
}

const snapshotContext = {
  snapshot_key: 'SNAP1', load_key_id: 'FP_LP_WB_TM_09_2026_1', load_type_code: 'FP', load_version_id: '1',
  ingestion_datetime: '2026-08-20 00:00:00', subsidiary_code: 'LP', crew_base_code: 'LIM', crew_range_type_code: 'TM',
  reference_year: '2026', reference_month_number: '9',
};

function evaluatedPairings(rowsPerPairing) {
  return rowsPerPairing.map(function (rows) {
    const [p] = assemblePairings(rows, 'SNAP1');
    return Object.assign({}, p, evaluateWbRules(p, config, routes, allowedDow));
  });
}

test('PairingsDataRenderer.build - el header cumple Q14 (compatibilidad de esquema)', () => {
  const rendered = PairingsDataRenderer.build([], snapshotContext);
  assert.equal(QaService.q14PairingsDataSchemaCompatible(rendered.headers).passed, true);
  assert.deepEqual(rendered.headers, PAIRINGS_DATA_HEADERS);
});

test('PairingsDataRenderer.build - incluye pairings REVIEW (a diferencia de RESUMEN, ver D13)', () => {
  const eligible = evaluatedPairings([[leg({})]]);
  const review = evaluatedPairings([[leg({ pairing_id: '999', arrival_airport_code: 'BOG' })]]);
  assert.equal(eligible[0].eligibility_status, 'ELIGIBLE');
  assert.equal(review[0].eligibility_status, 'REVIEW');

  const rendered = PairingsDataRenderer.build(eligible.concat(review), snapshotContext);
  const pikIdx = rendered.headers.indexOf('pairing_id');
  const statusIdx = rendered.headers.indexOf('eligibility_status');
  const ids = rendered.matrix.map(r => r[pikIdx] + ':' + r[statusIdx]);
  assert.ok(ids.some(s => s === '226:ELIGIBLE'));
  assert.ok(ids.some(s => s === '999:REVIEW'));
});

test('PairingsDataRenderer.build - una fila por leg (no colapsa multiplicidades con DISTINCT)', () => {
  const rows = [leg({}), leg({ flight_number: '508', departure_airport_code: 'MIA', arrival_airport_code: 'LIM', flight_start_date_local_time: '2026-09-03', flight_departure_time_crew_base: '20:00:00' })];
  const [pairings] = [evaluatedPairings([rows])];
  const rendered = PairingsDataRenderer.build(pairings, snapshotContext);
  assert.equal(rendered.matrix.length, 2);
});

test('PairingsDataRenderer.build - registra source_row_multiplicity real por leg', () => {
  const dupRows = [leg({}), leg({})]; // fila fisicamente duplicada del mismo leg
  const pairings = evaluatedPairings([dupRows]);
  const rendered = PairingsDataRenderer.build(pairings, snapshotContext);
  const multIdx = rendered.headers.indexOf('source_row_multiplicity');
  assert.equal(rendered.matrix.length, 1, 'un unico leg logico');
  assert.equal(rendered.matrix[0][multIdx], 2);
});

test('PAIRINGS_DATA_HEADERS - contrato EXACTO de 54 columnas (T12, correccion post-D15)', () => {
  assert.equal(PAIRINGS_DATA_HEADERS.length, 54);
});

test('PairingsDataRenderer.build - route_airport_key persiste (T13)', () => {
  const pairings = evaluatedPairings([[leg({ route_airport_key: 'LIM-MIA' })]]);
  const rendered = PairingsDataRenderer.build(pairings, snapshotContext);
  const idx = rendered.headers.indexOf('route_airport_key');
  assert.ok(idx !== -1, 'route_airport_key debe existir en el contrato');
  assert.equal(rendered.matrix[0][idx], 'LIM-MIA');
});

test('PairingsDataRenderer.build - duty_presentation_date_at/time persisten (T14)', () => {
  const pairings = evaluatedPairings([[leg({ duty_presentation_date_at: '2026-09-01', duty_presentation_time_at: '05:00:00' })]]);
  const rendered = PairingsDataRenderer.build(pairings, snapshotContext);
  const dateIdx = rendered.headers.indexOf('duty_presentation_date_at');
  const timeIdx = rendered.headers.indexOf('duty_presentation_time_at');
  assert.ok(dateIdx !== -1 && timeIdx !== -1);
  assert.equal(rendered.matrix[0][dateIdx], '2026-09-01');
  assert.equal(rendered.matrix[0][timeIdx], '05:00:00');
});

test('PairingsDataRenderer.build - duty_end_date_home_base_timezone/time persisten (T15)', () => {
  const pairings = evaluatedPairings([[leg({ duty_end_date_home_base_timezone: '2026-09-01', duty_end_time_hb: '13:00:00' })]]);
  const rendered = PairingsDataRenderer.build(pairings, snapshotContext);
  const dateIdx = rendered.headers.indexOf('duty_end_date_home_base_timezone');
  const timeIdx = rendered.headers.indexOf('duty_end_time_hb');
  assert.ok(dateIdx !== -1 && timeIdx !== -1);
  assert.equal(rendered.matrix[0][dateIdx], '2026-09-01');
  assert.equal(rendered.matrix[0][timeIdx], '13:00:00');
});

test('PAIRINGS_DATA_HEADERS - connection_time/flight_operation_type_code NO se agregan al contrato persistido (T16)', () => {
  assert.equal(PAIRINGS_DATA_HEADERS.indexOf('connection_time'), -1);
  assert.equal(PAIRINGS_DATA_HEADERS.indexOf('flight_operation_type_code'), -1);
});
