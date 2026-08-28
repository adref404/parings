const test = require('node:test');
const assert = require('node:assert/strict');
const { assemblePairings } = require('../30_PairingAssembler.js');
const { evaluateWbRules } = require('../35_WBRules.js');
const { SummaryRenderer } = require('../55_RenderSummary.js');
const { FlightsRenderer } = require('../56_RenderFlights.js');

const config = { CREW_BASE_CODE: 'LIM', MAX_OCCUPIED_DAYS: '3' };
const routes = [{ code: 'MIA', priority: 1, role: 'PRIMARY' }];
const allowedDow = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

function leg(overrides) {
  return Object.assign({
    pairing_id: '226', pairing_name: 'P226',
    departure_airport_code: 'LIM', arrival_airport_code: 'MIA',
    flight_start_date_local_time: '2026-09-01', flight_departure_time_crew_base: '06:00:00',
    flight_arrival_hour_block_time: '12:00:00',
    flight_number: '507', carrier_code: 'LA',
    duty_presentation_date_at: '2026-09-01', duty_presentation_time_at: '05:00:00',
    duty_end_date_home_base_timezone: '2026-09-01', duty_end_time_hb: '13:00:00',
    pairing_end_date: '2026-09-01', pairing_end_time: '13:00:00',
  }, overrides);
}

function evaluatedPairings(rows) {
  return assemblePairings(rows, 'SNAP1').map(function (p) {
    return Object.assign({}, p, evaluateWbRules(p, config, routes, allowedDow));
  });
}

let n = 0;
function idGen() { return 'AID-' + (++n); }

test('FlightsRenderer.build - una fila por leg, con INS/ACT proyectados desde RESUMEN (nunca editados aqui)', () => {
  const rows = [leg({}), leg({ flight_number: '508', departure_airport_code: 'MIA', arrival_airport_code: 'LIM', flight_start_date_local_time: '2026-09-01', flight_departure_time_crew_base: '20:00:00' })];
  const pairings = evaluatedPairings(rows);
  const previous = [{ pairing_instance_key: pairings[0].pairing_instance_key, Pairing: '226', pairing_content_hash: pairings[0].pairing_content_hash, assignment_id: 'A1', INS: 'Juan Perez', ACT: 'Simulador', source_snapshot_key: 'SNAP1' }];

  const { reconciliation } = SummaryRenderer.build(pairings, previous, [], idGen);
  const { headers, matrix } = FlightsRenderer.build(reconciliation.rows);

  assert.equal(matrix.length, 2, 'dos legs -> dos filas en Vuelos');
  const insIdx = headers.indexOf('INS');
  const actIdx = headers.indexOf('ACT');
  matrix.forEach(row => {
    assert.equal(row[insIdx], 'Juan Perez');
    assert.equal(row[actIdx], 'Simulador');
  });
});

test('FlightsRenderer.build - filas sin pairing actual (revision/orphan) no aportan vuelos', () => {
  const rows = [leg({})];
  const pairings = evaluatedPairings(rows);
  // Fuerza un caso ORPHANED: previous con un pairing_id que ya no existe en el snapshot actual.
  const previous = [{ pairing_instance_key: 'PIK_VIEJO', Pairing: '999', pairing_content_hash: 'H_VIEJO', assignment_id: 'A_ORPH', INS: 'Alguien', ACT: '', source_snapshot_key: 'SNAP_VIEJO' }];

  const { reconciliation } = SummaryRenderer.build(pairings, previous, [], idGen);
  const orphanRow = reconciliation.rows.find(r => r.assignment_status === 'ORPHANED_SOURCE_MISSING');
  assert.ok(orphanRow);

  const { matrix } = FlightsRenderer.build([orphanRow]);
  assert.equal(matrix.length, 0, 'un orphan sin pairing actual no debe generar filas de vuelo fantasma');
});
