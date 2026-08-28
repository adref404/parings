const test = require('node:test');
const assert = require('node:assert/strict');
const { assemblePairings, computeOccupiedWindow, computePairingContentHash } = require('../30_PairingAssembler.js');

const SNAPSHOT_KEY = 'snap-test-key';

/** Fabrica un leg sintetico realista (nombres de campo = esquema REAL confirmado en el audit). */
function leg(overrides) {
  return Object.assign({
    pairing_id: '226',
    pairing_name: 'P226',
    pairing_days_quantity: '3',
    crew_base_code: 'LIM',
    pairing_start_date: '2026-09-01',
    pairing_start_time: '05:00:00',
    pairing_end_date: '2026-09-03',
    pairing_end_time: '23:10:00',
    carrier_code: 'LA',
    flight_number: '507',
    departure_airport_code: 'LIM',
    arrival_airport_code: 'MIA',
    flight_start_date_local_time: '2026-09-01',
    flight_departure_time_crew_base: '06:00:00',
    flight_arrival_hour_block_time: '12:30:00',
    briefing_time: '00:45:00',
    flight_block_time: '06:30:00',
    connection_time: '01:00:00',
    duty_day_number: '1',
    duty_calendar_day_number: '1',
    duty_presentation_date_at: '2026-09-01',
    duty_presentation_time_at: '05:00:00',
    duty_end_date_home_base_timezone: '2026-09-01',
    duty_end_time_hb: '13:15:00',
    is_crew_passenger: 'NO',
    flight_operation_type_code: 'INT',
    service_type_code: 'J',
    flight_type_code: 'INT',
  }, overrides);
}

test('assemblePairings - agrupa por pairing_instance_key, no por pairing_id crudo', () => {
  const rows = [
    leg({ pairing_id: '100' }),
    leg({ pairing_id: '200' }),
  ];
  const pairings = assemblePairings(rows, SNAPSHOT_KEY);
  assert.equal(pairings.length, 2);
  assert.notEqual(pairings[0].pairing_instance_key, pairings[1].pairing_instance_key);
});

test('assemblePairings - ordena legs por fecha/hora de salida sin importar el orden de llegada de filas', () => {
  const rows = [
    leg({ flight_start_date_local_time: '2026-09-03', flight_departure_time_crew_base: '20:00:00', flight_number: '508', departure_airport_code: 'MIA', arrival_airport_code: 'LIM' }),
    leg({ flight_start_date_local_time: '2026-09-01', flight_departure_time_crew_base: '06:00:00', flight_number: '507' }),
  ];
  const [p] = assemblePairings(rows, SNAPSHOT_KEY);
  assert.equal(p.legs.length, 2);
  assert.equal(p.legs[0].leg_sequence, 1);
  assert.equal(p.legs[0].row.flight_number, '507');
  assert.equal(p.legs[1].leg_sequence, 2);
  assert.equal(p.legs[1].row.flight_number, '508');
});

test('computeOccupiedWindow - usa duty_presentation_* / duty_end_*_hb (no primer/ultimo vuelo)', () => {
  const rows = [
    leg({ duty_presentation_date_at: '2026-08-31', duty_presentation_time_at: '22:30:00' }), // antes del primer vuelo
    leg({ duty_end_date_home_base_timezone: '2026-09-03', duty_end_time_hb: '23:50:00', flight_start_date_local_time: '2026-09-03' }),
  ];
  const w = computeOccupiedWindow(rows);
  assert.equal(w.source, 'DUTY');
  assert.deepEqual(w.startDate, { y: 2026, m: 8, d: 31 });
  assert.deepEqual(w.endDate, { y: 2026, m: 9, d: 3 });
  assert.equal(w.days, 4); // 31 ago -> 3 sep inclusive = 4 dias
});

test('computeOccupiedWindow - fallback documentado a campos de vuelo si faltan TODOS los campos de duty', () => {
  const rows = [
    leg({ duty_presentation_date_at: null, duty_presentation_time_at: null, duty_end_date_home_base_timezone: null, duty_end_time_hb: null }),
  ];
  const w = computeOccupiedWindow(rows);
  assert.equal(w.source, 'FLIGHT_FALLBACK');
  assert.deepEqual(w.startDate, { y: 2026, m: 9, d: 1 }); // flight_start_date_local_time
  assert.deepEqual(w.endDate, { y: 2026, m: 9, d: 3 }); // pairing_end_date
});

test('computeOccupiedWindow - sin ningun dato de fecha devuelve MISSING sin lanzar', () => {
  const rows = [leg({
    duty_presentation_date_at: null, duty_end_date_home_base_timezone: null,
    flight_start_date_local_time: null, pairing_end_date: null,
  })];
  const w = computeOccupiedWindow(rows);
  assert.equal(w.source, 'MISSING');
  assert.equal(w.days, null);
});

test('pairing_content_hash - independiente del orden de filas de entrada (Seccion 20)', () => {
  const rowA = leg({ flight_number: '507', flight_start_date_local_time: '2026-09-01', flight_departure_time_crew_base: '06:00:00' });
  const rowB = leg({ flight_number: '508', departure_airport_code: 'MIA', arrival_airport_code: 'LIM', flight_start_date_local_time: '2026-09-03', flight_departure_time_crew_base: '20:00:00' });

  const [p1] = assemblePairings([rowA, rowB], SNAPSHOT_KEY);
  const [p2] = assemblePairings([rowB, rowA], SNAPSHOT_KEY); // mismo contenido, orden de entrada invertido

  assert.equal(p1.pairing_content_hash, p2.pairing_content_hash);
});

test('pairing_content_hash - cambia si cambia la secuencia real de vuelos', () => {
  const [p1] = assemblePairings([leg({ flight_number: '507' })], SNAPSHOT_KEY);
  const [p2] = assemblePairings([leg({ flight_number: '999' })], SNAPSHOT_KEY);
  assert.notEqual(p1.pairing_content_hash, p2.pairing_content_hash);
});

test('pairing_content_hash - NO depende de campos ajenos al contenido (el modulo nunca ve INS/ACT/BP)', () => {
  const row = leg({});
  assert.equal(row.INS, undefined);
  assert.equal(row.ACT, undefined);
  assert.equal(row.BP, undefined);
});

test('multiplicidad fisica - filas identicas del mismo leg se cuentan, no se ocultan con DISTINCT ciego', () => {
  const dup1 = leg({});
  const dup2 = leg({}); // identico
  const [p] = assemblePairings([dup1, dup2], SNAPSHOT_KEY);
  assert.equal(p.legs.length, 1, 'un unico leg logico');
  assert.equal(p.legs[0].source_row_multiplicity, 2);
  assert.equal(p.legs[0].distinct_source_row_variants, 1, 'contenido identico -> 1 variante distinta');
});

test('multiplicidad con variantes distintas - se documenta en vez de fabricar una PK inexistente', () => {
  const variantA = leg({ duty_end_time_hb: '13:15:00' });
  const variantB = leg({ duty_end_time_hb: '13:45:00' }); // mismo leg_key, contenido de duty distinto
  const [p] = assemblePairings([variantA, variantB], SNAPSHOT_KEY);
  assert.equal(p.legs.length, 1);
  assert.equal(p.legs[0].source_row_multiplicity, 2);
  assert.equal(p.legs[0].distinct_source_row_variants, 2, 'contenido distinto -> se documentan 2 variantes, no se colapsan en silencio');
});
