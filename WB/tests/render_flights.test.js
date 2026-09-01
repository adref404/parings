const test = require('node:test');
const assert = require('node:assert/strict');
const { assemblePairings } = require('../30_PairingAssembler.js');
const { evaluateWbRules } = require('../35_WBRules.js');
const { SummaryRenderer } = require('../55_RenderSummary.js');
const {
  FlightsRenderer, VUELOS_HEADERS, VUELOS_BLOCK_MIN_HEIGHT, VUELOS_HEADER_ROW, VUELOS_FIRST_BLOCK_ROW,
} = require('../56_RenderFlights.js');

const config = { CREW_BASE_CODE: 'LIM', MAX_OCCUPIED_DAYS: '3' };
const routes = [{ code: 'MIA', priority: 1, role: 'PRIMARY' }];
const allowedDow = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

function leg(overrides) {
  return Object.assign({
    pairing_id: '226', pairing_name: 'P226', fleet_type_code: 'B767',
    departure_airport_code: 'LIM', arrival_airport_code: 'MIA',
    flight_start_date_local_time: '2026-09-01', flight_departure_time_crew_base: '06:00:00',
    flight_arrival_hour_block_time: '12:00:00',
    flight_number: '507', carrier_code: 'LA',
    duty_presentation_date_at: '2026-09-01', duty_presentation_time_at: '05:00:00',
    duty_end_date_home_base_timezone: '2026-09-01', duty_end_time_hb: '13:00:00',
    duty_day_number: 1, duty_calendar_day_number: 1,
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

test('VUELOS_HEADERS - A:Q, exactamente 17 columnas (T3)', () => {
  assert.equal(VUELOS_HEADERS.length, 17);
});

test('FlightsRenderer.build - una fila por leg dentro del bloque, con INS/ACT proyectados desde RESUMEN (T7, nunca editados aqui)', () => {
  const rows = [leg({}), leg({ flight_number: '508', departure_airport_code: 'MIA', arrival_airport_code: 'LIM', flight_start_date_local_time: '2026-09-01', flight_departure_time_crew_base: '20:00:00' })];
  const pairings = evaluatedPairings(rows);
  const previous = [{ pairing_instance_key: pairings[0].pairing_instance_key, Pairing: '226', pairing_content_hash: pairings[0].pairing_content_hash, assignment_id: 'A1', INS: 'Juan Perez', ACT: 'Simulador', source_snapshot_key: 'SNAP1' }];

  const { reconciliation } = SummaryRenderer.build(pairings, previous, [], idGen);
  const { headers, blocks } = FlightsRenderer.build(reconciliation.rows);

  assert.equal(blocks.length, 1, 'un solo assignment -> un solo bloque');
  assert.equal(blocks[0].rows.length, 2, 'dos legs -> dos filas dentro del bloque');
  const insIdx = headers.indexOf('INS');
  const detailIdx = headers.length - 1; // Q: detalle/ACT
  blocks[0].rows.forEach(row => {
    assert.equal(row[insIdx], 'Juan Perez');
    assert.match(String(row[detailIdx]), /Juan Perez/, 'columna Q proyecta INS dentro del detalle multilinea');
  });
});

test('FlightsRenderer.build - filas sin pairing actual (revision/orphan) no generan bloque', () => {
  const rows = [leg({})];
  const pairings = evaluatedPairings(rows);
  const previous = [{ pairing_instance_key: 'PIK_VIEJO', Pairing: '999', pairing_content_hash: 'H_VIEJO', assignment_id: 'A_ORPH', INS: 'Alguien', ACT: '', source_snapshot_key: 'SNAP_VIEJO' }];

  const { reconciliation } = SummaryRenderer.build(pairings, previous, [], idGen);
  const orphanRow = reconciliation.rows.find(r => r.assignment_status === 'ORPHANED_SOURCE_MISSING');
  assert.ok(orphanRow);

  const { blocks } = FlightsRenderer.build([orphanRow]);
  assert.equal(blocks.length, 0, 'un orphan sin pairing actual no debe generar un bloque fantasma');
});

test('FlightsRenderer - BLOCK_MIN_HEIGHT es una regla visual de al menos 9 filas (T4)', () => {
  assert.ok(VUELOS_BLOCK_MIN_HEIGHT >= 9);
  const rows = [leg({})]; // un unico leg -> el bloque real tiene 1 fila
  const pairings = evaluatedPairings(rows);
  const previous = [{ pairing_instance_key: pairings[0].pairing_instance_key, Pairing: '226', pairing_content_hash: pairings[0].pairing_content_hash, assignment_id: 'A1', INS: '', ACT: '', source_snapshot_key: 'SNAP1' }];
  const { reconciliation } = SummaryRenderer.build(pairings, previous, [], idGen);
  const { blocks } = FlightsRenderer.build(reconciliation.rows);
  const matrix = FlightsRenderer.layoutMatrix(blocks);
  assert.equal(matrix.length, VUELOS_BLOCK_MIN_HEIGHT, 'un bloque de 1 leg se rellena hasta el piso visual');
});

test('FlightsRenderer - BLOCK_MIN_HEIGHT es un piso, nunca un techo: un pairing con mas legs que el minimo no se trunca', () => {
  const rows = [];
  for (let i = 0; i < 10; i++) {
    rows.push(leg({ flight_number: String(500 + i), duty_calendar_day_number: i + 1 }));
  }
  const pairings = evaluatedPairings(rows);
  const previous = [{ pairing_instance_key: pairings[0].pairing_instance_key, Pairing: '226', pairing_content_hash: pairings[0].pairing_content_hash, assignment_id: 'A1', INS: '', ACT: '', source_snapshot_key: 'SNAP1' }];
  const { reconciliation } = SummaryRenderer.build(pairings, previous, [], idGen);
  const { blocks } = FlightsRenderer.build(reconciliation.rows);
  const matrix = FlightsRenderer.layoutMatrix(blocks);
  assert.equal(matrix.length, 10, 'con 10 legs reales, el bloque no se recorta a 9');
});

test('FlightsRenderer - multiples assignments del MISMO pairing generan bloques distintos por assignment_id (T5)', () => {
  const rows = [leg({})];
  const pairings = evaluatedPairings(rows);
  const previous = [
    { pairing_instance_key: pairings[0].pairing_instance_key, Pairing: '226', pairing_content_hash: pairings[0].pairing_content_hash, assignment_id: 'A1', INS: 'Juan', ACT: '', source_snapshot_key: 'SNAP1' },
  ];
  // Reconciliacion normal solo produce un assignment por pairing_instance_key; simulamos
  // directamente dos filas reconciliadas del MISMO pairing con dos assignment_id distintos
  // (Seccion 7: "un mismo pairing puede tener multiples assignment_id", ver D17 punto 10).
  const { reconciliation } = SummaryRenderer.build(pairings, previous, [], idGen);
  const baseRow = reconciliation.rows[0];
  const secondRow = Object.assign({}, baseRow, { assignment_id: 'A2', INS: 'Otro INS' });

  const { blocks } = FlightsRenderer.build([baseRow, secondRow]);
  assert.equal(blocks.length, 2, 'dos assignment_id -> dos bloques, aunque compartan pairing_id');
  const ids = blocks.map(b => b.assignment_id).sort();
  assert.deepEqual(ids, ['A1', 'A2']);
});

test('FlightsRenderer - ningun calculo usa la posicion de bloque/fila como identidad (T6)', () => {
  const rows = [leg({})];
  const pairings = evaluatedPairings(rows);
  const previous = [{ pairing_instance_key: pairings[0].pairing_instance_key, Pairing: '226', pairing_content_hash: pairings[0].pairing_content_hash, assignment_id: 'A1', INS: 'Juan', ACT: '', source_snapshot_key: 'SNAP1' }];
  const { reconciliation } = SummaryRenderer.build(pairings, previous, [], idGen);
  const baseRow = reconciliation.rows[0];
  const secondRow = Object.assign({}, baseRow, { assignment_id: 'A2', INS: 'Otro INS' });

  // Construir en un orden y en el orden inverso: la identidad (columna A por fila) debe seguir a
  // los datos, nunca a la posicion en la que el bloque termino escribiendose.
  const forward = FlightsRenderer.build([baseRow, secondRow]);
  const reversed = FlightsRenderer.build([secondRow, baseRow]);
  const assignmentIdIdx = 0;

  const forwardById = {};
  forward.blocks.forEach(b => { forwardById[b.assignment_id] = b.rows.map(r => r[assignmentIdIdx]); });
  const reversedById = {};
  reversed.blocks.forEach(b => { reversedById[b.assignment_id] = b.rows.map(r => r[assignmentIdIdx]); });

  assert.deepEqual(forwardById['A1'], ['A1']);
  assert.deepEqual(forwardById['A2'], ['A2']);
  assert.deepEqual(reversedById['A1'], ['A1']);
  assert.deepEqual(reversedById['A2'], ['A2']);
});

test('FlightsRenderer.writeToSheet - nunca toca las filas 1-2 (notas humanas) y escribe en un unico batch', () => {
  const writes = [];
  const fakeSheet = {
    getLastRow: () => 4,
    getRange: (row, col, numRows, numCols) => ({
      clearContent: () => writes.push({ op: 'clearContent', row, col, numRows, numCols }),
      setValues: (values) => writes.push({ op: 'setValues', row, col, numRows, numCols, values }),
    }),
  };
  global.SheetStructure = {
    ensureMinColumns: () => {}, ensureMinRows: () => {},
  };

  const rows = [leg({})];
  const pairings = evaluatedPairings(rows);
  const previous = [{ pairing_instance_key: pairings[0].pairing_instance_key, Pairing: '226', pairing_content_hash: pairings[0].pairing_content_hash, assignment_id: 'A1', INS: 'Juan', ACT: '', source_snapshot_key: 'SNAP1' }];
  const { reconciliation } = SummaryRenderer.build(pairings, previous, [], idGen);
  const rendered = FlightsRenderer.build(reconciliation.rows);

  FlightsRenderer.writeToSheet(fakeSheet, rendered);

  const touchedRows = writes.map(w => w.row);
  assert.ok(touchedRows.every(r => r >= VUELOS_HEADER_ROW), 'ninguna escritura/clear toca las filas 1-2');
  assert.equal(writes.filter(w => w.op === 'setValues').length, 1, 'una sola escritura batch de valores');

  delete global.SheetStructure;
});
