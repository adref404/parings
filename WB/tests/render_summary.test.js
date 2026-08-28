const test = require('node:test');
const assert = require('node:assert/strict');
const { assemblePairings } = require('../30_PairingAssembler.js');
const { evaluateWbRules } = require('../35_WBRules.js');
const { SummaryRenderer } = require('../55_RenderSummary.js');
const { RESUMEN_COLUMNS } = require('../00_Constants.js');

const config = { CREW_BASE_CODE: 'LIM', MAX_OCCUPIED_DAYS: '3' };
const routes = [{ code: 'MIA', priority: 1, role: 'PRIMARY' }, { code: 'SCL', priority: 2, role: 'SECONDARY' }, { code: 'ATL', priority: 3, role: 'FALLBACK' }];
const allowedDow = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

function leg(overrides) {
  return Object.assign({
    pairing_id: '226', pairing_name: 'P226',
    departure_airport_code: 'LIM', arrival_airport_code: 'MIA',
    flight_start_date_local_time: '2026-09-01', flight_departure_time_crew_base: '06:00:00',
    flight_number: '507', carrier_code: 'LA',
    duty_presentation_date_at: '2026-09-01', duty_presentation_time_at: '05:00:00',
    duty_end_date_home_base_timezone: '2026-09-01', duty_end_time_hb: '13:00:00',
    pairing_end_date: '2026-09-01', pairing_end_time: '13:00:00',
  }, overrides);
}

function evaluatedPairings(rows, snapshotKey) {
  return assemblePairings(rows, snapshotKey).map(function (p) {
    return Object.assign({}, p, evaluateWbRules(p, config, routes, allowedDow));
  });
}

let idCounter = 0;
function idGen() { return 'AID-' + (++idCounter); }

test('SummaryRenderer.build - preserva INS/ACT existentes (ownership humano intacto)', () => {
  const rows = [leg({}), leg({ flight_number: '508', departure_airport_code: 'MIA', arrival_airport_code: 'LIM', flight_start_date_local_time: '2026-09-01', flight_departure_time_crew_base: '20:00:00' })];
  const pairings = evaluatedPairings(rows, 'SNAP1');
  const pik = pairings[0].pairing_instance_key;

  const previous = [{ pairing_instance_key: pik, Pairing: '226', pairing_content_hash: pairings[0].pairing_content_hash, assignment_id: 'A1', INS: 'Juan Perez', ACT: 'Simulador', source_snapshot_key: 'SNAP1' }];

  const { matrix, reconciliation } = SummaryRenderer.build(pairings, previous, [], idGen);

  assert.equal(matrix.length, 1);
  assert.equal(matrix[0][RESUMEN_COLUMNS.INS], 'Juan Perez');
  assert.equal(matrix[0][RESUMEN_COLUMNS.ACT], 'Simulador');
  assert.equal(matrix[0][RESUMEN_COLUMNS.assignment_id], 'A1');
  assert.equal(reconciliation.counts.preserved, 1);
});

test('SummaryRenderer.build - BP se calcula via Diccionario, sin error cuando INS esta vacio (Q20)', () => {
  const pairings = evaluatedPairings([leg({})], 'SNAP1');
  const diccionario = [{ INS: 'Juan Perez', BP: 'BP-01', NOMBRE: 'Juan Perez Gomez' }];

  const withIns = SummaryRenderer.build(pairings, [{ pairing_instance_key: pairings[0].pairing_instance_key, Pairing: '226', pairing_content_hash: pairings[0].pairing_content_hash, assignment_id: 'A1', INS: 'Juan Perez', ACT: '', source_snapshot_key: 'SNAP1' }], diccionario, idGen);
  assert.equal(withIns.matrix[0][RESUMEN_COLUMNS.BP], 'BP-01');

  const withoutIns = SummaryRenderer.build(pairings, [], diccionario, idGen);
  assert.equal(withoutIns.matrix[0][RESUMEN_COLUMNS.BP], '', 'sin INS, BP debe quedar en blanco, nunca #N/A');
});

test('SummaryRenderer.build - ORPHANED_SOURCE_MISSING conserva Fecha/Vuelo/Ruta/Inicio/Fin (no los deja en blanco)', () => {
  const pairings = evaluatedPairings([leg({})], 'SNAP1');
  const previous = [{
    pairing_instance_key: 'PIK_VIEJO', Pairing: '999', pairing_content_hash: 'H_VIEJO',
    assignment_id: 'A_ORPH', INS: 'Juan Perez', ACT: 'Linea', source_snapshot_key: 'SNAP_VIEJO',
    Fecha: '15/08/2026', DiaSEM: 'SAB', Vuelo: '999', Ruta: 'LIM-JFK-LIM', Inicio: '15/08/2026', Fin: '17/08/2026',
  }];

  const { matrix, reconciliation } = SummaryRenderer.build(pairings, previous, [], idGen);
  const orphanIdx = matrix.findIndex(r => r[RESUMEN_COLUMNS.assignment_id] === 'A_ORPH');
  assert.ok(orphanIdx !== -1);
  assert.equal(reconciliation.rows.find(r => r.assignment_id === 'A_ORPH').assignment_status, 'ORPHANED_SOURCE_MISSING');
  assert.equal(matrix[orphanIdx][RESUMEN_COLUMNS.Fecha], '15/08/2026', 'Fecha debe conservarse, no quedar en blanco');
  assert.equal(matrix[orphanIdx][RESUMEN_COLUMNS.Ruta], 'LIM-JFK-LIM');
  assert.equal(matrix[orphanIdx][RESUMEN_COLUMNS.Inicio], '15/08/2026');
  assert.equal(matrix[orphanIdx][RESUMEN_COLUMNS.Fin], '17/08/2026');
});

test('SummaryRenderer.build - ordena por fecha real, no por el hash de pairing_instance_key', () => {
  const pairingSept5 = evaluatedPairings([leg({ flight_start_date_local_time: '2026-09-04', duty_presentation_date_at: '2026-09-04', duty_end_date_home_base_timezone: '2026-09-04', pairing_end_date: '2026-09-04', pairing_id: '300' })], 'SNAP1');
  const pairingSept1 = evaluatedPairings([leg({ pairing_id: '100' })], 'SNAP1'); // 2026-09-01 (default del fixture)

  const { matrix } = SummaryRenderer.build(pairingSept5.concat(pairingSept1), [], [], idGen);
  assert.equal(matrix.length, 2);
  assert.equal(matrix[0][RESUMEN_COLUMNS.Fecha], '01/09/2026', 'la fecha mas temprana debe ir primero sin importar el hash');
  assert.equal(matrix[1][RESUMEN_COLUMNS.Fecha], '04/09/2026');
});

test('SummaryRenderer.build - pairings en REVIEW no generan fila en RESUMEN (D13)', () => {
  const reviewRows = [leg({ arrival_airport_code: 'BOG' }), leg({ flight_number: '508', departure_airport_code: 'BOG', arrival_airport_code: 'LIM' })]; // ruta no configurada
  const pairings = evaluatedPairings(reviewRows, 'SNAP1');
  assert.equal(pairings[0].eligibility_status, 'REVIEW');

  const { matrix } = SummaryRenderer.build(pairings, [], [], idGen);
  assert.equal(matrix.length, 0);
});

test('SummaryRenderer.build - Fecha/Inicio/Fin se escriben como texto DD/MM/YYYY (D14, sin drift)', () => {
  const pairings = evaluatedPairings([leg({})], 'SNAP1');
  const { matrix } = SummaryRenderer.build(pairings, [], [], idGen);
  assert.equal(matrix[0][RESUMEN_COLUMNS.Fecha], '01/09/2026');
  assert.equal(matrix[0][RESUMEN_COLUMNS.Inicio], '01/09/2026');
  assert.equal(typeof matrix[0][RESUMEN_COLUMNS.Fecha], 'string');
});
