const test = require('node:test');
const assert = require('node:assert/strict');
const { assemblePairings } = require('../30_PairingAssembler.js');
const { evaluateWbRules } = require('../35_WBRules.js');
const { deriveVisiblePairingFacts } = require('../55_RenderSummary.js');
const {
  isLegacyUnlinkedRow, detectLegacyUnlinkedBaseline, evaluatePublishGate, shouldBlockPublish,
  compareBaselineWithSnapshot,
} = require('../58_LegacyBaseline.js');

const config = { CREW_BASE_CODE: 'LIM', MAX_OCCUPIED_DAYS: '3' };
const routes = [{ code: 'MIA', priority: 1, role: 'PRIMARY' }, { code: 'SCL', priority: 2, role: 'SECONDARY' }];
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

/** Fila de RESUMEN con vinculacion tecnica AUSENTE (baseline migrado antes de snapshot certificado). */
function legacyRow(overrides) {
  return Object.assign({
    assignment_id: 'ASG-LEGACY-1', Pairing: '226',
    pairing_instance_key: '', source_snapshot_key: '',
    pairing_content_hash: 'LEGACY_HASH_226',
    INS: 'Juan Perez', ACT: 'Simulador',
    Fecha: '', Vuelo: '', Ruta: '', Inicio: '', Fin: '',
  }, overrides);
}

/** Fila de RESUMEN con vinculacion tecnica COMPLETA (ya paso por este pipeline). */
function linkedRow(overrides) {
  return Object.assign({
    assignment_id: 'ASG-LINKED-1', Pairing: '226',
    pairing_instance_key: 'PIK-SOME', source_snapshot_key: 'SNAP-SOME',
    pairing_content_hash: 'H1',
    INS: 'Maria Lopez', ACT: 'Vuelo',
    Fecha: '01/09/2026', Vuelo: '507', Ruta: 'LIM-MIA-LIM', Inicio: '01/09/2026', Fin: '01/09/2026',
  }, overrides);
}

// --- detectLegacyUnlinkedBaseline / isLegacyUnlinkedRow (M9) ---------------------------------

test('isLegacyUnlinkedRow - pairing_instance_key vacio -> legacy-unlinked', () => {
  assert.equal(isLegacyUnlinkedRow(legacyRow({ pairing_instance_key: '', source_snapshot_key: 'SNAP1' })), true);
});

test('isLegacyUnlinkedRow - source_snapshot_key vacio -> legacy-unlinked', () => {
  assert.equal(isLegacyUnlinkedRow(legacyRow({ pairing_instance_key: 'PIK1', source_snapshot_key: '' })), true);
});

test('isLegacyUnlinkedRow - ambos presentes -> NO legacy-unlinked', () => {
  assert.equal(isLegacyUnlinkedRow(linkedRow({})), false);
});

test('isLegacyUnlinkedRow - fila sin assignment_id (candidato NEW, no baseline humano) no cuenta', () => {
  assert.equal(isLegacyUnlinkedRow({ assignment_id: '', pairing_instance_key: '', source_snapshot_key: '' }), false);
});

test('detectLegacyUnlinkedBaseline - separa legacy de linked y cuenta correctamente', () => {
  const rows = [legacyRow({ assignment_id: 'A1' }), legacyRow({ assignment_id: 'A2' }), linkedRow({ assignment_id: 'A3' })];
  const d = detectLegacyUnlinkedBaseline(rows);
  assert.equal(d.hasLegacyUnlinked, true);
  assert.equal(d.legacyCount, 2);
  assert.equal(d.totalCount, 3);
  assert.equal(d.linkedRows.length, 1);
});

test('detectLegacyUnlinkedBaseline - baseline totalmente vinculado -> hasLegacyUnlinked false', () => {
  const d = detectLegacyUnlinkedBaseline([linkedRow({ assignment_id: 'A1' }), linkedRow({ assignment_id: 'A2' })]);
  assert.equal(d.hasLegacyUnlinked, false);
  assert.equal(d.legacyCount, 0);
});

// --- evaluatePublishGate / shouldBlockPublish (M10, M11) -------------------------------------

test('evaluatePublishGate - baseline legacy-unlinked -> blocked=true con codigo y pairing_ids', () => {
  const gate = evaluatePublishGate([legacyRow({ assignment_id: 'A1', Pairing: '226' }), legacyRow({ assignment_id: 'A2', Pairing: '181' })]);
  assert.equal(gate.blocked, true);
  assert.equal(gate.code, 'LEGACY_BASELINE_UNLINKED');
  assert.deepEqual(gate.legacyPairingIds.sort(), ['181', '226']);
  assert.equal(gate.legacyCount, 2);
});

test('evaluatePublishGate - baseline totalmente vinculado -> blocked=false', () => {
  const gate = evaluatePublishGate([linkedRow({ assignment_id: 'A1' })]);
  assert.equal(gate.blocked, false);
});

test('evaluatePublishGate - sin baseline (mes nuevo) -> blocked=false', () => {
  assert.equal(evaluatePublishGate([]).blocked, false);
});

test('shouldBlockPublish - preview (dryRun=true) NUNCA se bloquea aunque el baseline sea legacy-unlinked (M10)', () => {
  const rows = [legacyRow({ assignment_id: 'A1' })];
  assert.equal(shouldBlockPublish(true, rows), false);
});

test('shouldBlockPublish - publicacion (dryRun=false) SI se bloquea con baseline legacy-unlinked (M11)', () => {
  const rows = [legacyRow({ assignment_id: 'A1' })];
  assert.equal(shouldBlockPublish(false, rows), true);
});

test('shouldBlockPublish - publicacion con baseline totalmente vinculado NO se bloquea', () => {
  const rows = [linkedRow({ assignment_id: 'A1' })];
  assert.equal(shouldBlockPublish(false, rows), false);
});

// --- multiplicidad de pairing_id (M13) --------------------------------------------------------

test('evaluatePublishGate/detectLegacyUnlinkedBaseline - 4 assignment_id del mismo pairing 181 se cuentan todos, sin colapsar', () => {
  const rows = [
    legacyRow({ assignment_id: 'A1', Pairing: '181' }),
    legacyRow({ assignment_id: 'A2', Pairing: '181' }),
    legacyRow({ assignment_id: 'A3', Pairing: '181' }),
    legacyRow({ assignment_id: 'A4', Pairing: '181' }),
  ];
  const d = detectLegacyUnlinkedBaseline(rows);
  assert.equal(d.legacyCount, 4, 'las 4 asignaciones humanas se cuentan, no se colapsan por compartir pairing_id');
  const gate = evaluatePublishGate(rows);
  assert.equal(gate.legacyCount, 4);
  assert.deepEqual(gate.legacyPairingIds, ['181'], 'el pairing_id unico aparece una sola vez en la lista');
});

// --- compareBaselineWithSnapshot (new_diagnostic) ----------------------------------------------

test('compareBaselineWithSnapshot - hechos visibles IDENTICOS pero hash distinto -> incompatibilidad de hash, no cambio real', () => {
  const pairings = evaluatedPairings([leg({})], 'SNAP1');
  const facts = deriveVisiblePairingFacts(pairings[0]);
  const baseline = [legacyRow({ assignment_id: 'A1', Pairing: '226', pairing_content_hash: 'LEGACY_HASH_DIFFERENTE', ...facts })];

  const report = compareBaselineWithSnapshot(baseline, pairings);

  assert.equal(report.summary.pairingIdsUniqueBaseline, 1);
  assert.equal(report.summary.pairingIdsPresent, 1);
  assert.equal(report.summary.pairingIdsAbsent, 0);
  assert.equal(report.summary.visibleExact, 1, 'hechos visibles identicos');
  assert.equal(report.summary.hashDifferent, 1, 'el hash legacy no coincide con el actual');
  assert.deepEqual(report.visibleExactHashDifferentPairingIds, ['226']);
  assert.equal(report.visibleDistinctPairingIds.length, 0);
});

test('compareBaselineWithSnapshot - hash IGUAL cuando coincide con el hash actual', () => {
  const pairings = evaluatedPairings([leg({})], 'SNAP1');
  const facts = deriveVisiblePairingFacts(pairings[0]);
  const baseline = [legacyRow({ assignment_id: 'A1', Pairing: '226', pairing_content_hash: pairings[0].pairing_content_hash, ...facts })];

  const report = compareBaselineWithSnapshot(baseline, pairings);

  assert.equal(report.summary.hashSame, 1);
  assert.equal(report.summary.hashDifferent, 0);
});

test('compareBaselineWithSnapshot - pairing_id ausente del snapshot actual', () => {
  const pairings = evaluatedPairings([leg({})], 'SNAP1'); // solo pairing_id '226'
  const baseline = [legacyRow({ assignment_id: 'A1', Pairing: '999' })];

  const report = compareBaselineWithSnapshot(baseline, pairings);

  assert.equal(report.summary.pairingIdsAbsent, 1);
  assert.equal(report.summary.pairingIdsPresent, 0);
  assert.deepEqual(report.absentPairingIds, ['999']);
});

test('compareBaselineWithSnapshot - contenido visible realmente DISTINTO (no solo el hash)', () => {
  const pairings = evaluatedPairings([leg({})], 'SNAP1');
  const baseline = [legacyRow({
    assignment_id: 'A1', Pairing: '226', pairing_content_hash: 'LEGACY_HASH_226',
    Fecha: '15/03/2020', Vuelo: '999', Ruta: 'XXX-YYY-XXX', Inicio: '15/03/2020', Fin: '16/03/2020',
  })];

  const report = compareBaselineWithSnapshot(baseline, pairings);

  assert.equal(report.summary.visibleDistinct, 1);
  assert.deepEqual(report.visibleDistinctPairingIds, ['226']);
  assert.equal(report.visibleExactHashDifferentPairingIds.length, 0, 'un cambio real no debe reportarse como incompatibilidad de hash');
});

test('compareBaselineWithSnapshot - coincidencia PARCIAL (algunos hechos visibles coinciden, otros no)', () => {
  const pairings = evaluatedPairings([leg({})], 'SNAP1');
  const facts = deriveVisiblePairingFacts(pairings[0]);
  const baseline = [legacyRow({
    assignment_id: 'A1', Pairing: '226', pairing_content_hash: 'LEGACY_HASH_226',
    ...facts, Fin: '31/12/2099', // se altera un solo campo
  })];

  const report = compareBaselineWithSnapshot(baseline, pairings);

  assert.equal(report.summary.visiblePartial, 1);
  assert.equal(report.summary.visibleExact, 0);
  assert.equal(report.summary.visibleDistinct, 0);
});

test('compareBaselineWithSnapshot - multiplicidad: pairing 181 con 4 assignment_id cuenta 4 baseline pero 1 pairing_id unico (M13)', () => {
  const rows181 = [leg({ pairing_id: '181' })];
  const pairings = evaluatedPairings(rows181, 'SNAP1');
  const facts = deriveVisiblePairingFacts(pairings[0]);
  const baseline = [
    legacyRow({ assignment_id: 'A1', Pairing: '181', ...facts }),
    legacyRow({ assignment_id: 'A2', Pairing: '181', ...facts }),
    legacyRow({ assignment_id: 'A3', Pairing: '181', ...facts }),
    legacyRow({ assignment_id: 'A4', Pairing: '181', ...facts }),
  ];

  const report = compareBaselineWithSnapshot(baseline, pairings);

  assert.equal(report.summary.assignmentsBaseline, 4);
  assert.equal(report.summary.pairingIdsUniqueBaseline, 1);
  assert.equal(report.summary.pairingIdsPresent, 1);
});

test('compareBaselineWithSnapshot - legacyTechnicalLinkageMissing refleja el baseline sin vinculacion', () => {
  const pairings = evaluatedPairings([leg({})], 'SNAP1');
  const baseline = [legacyRow({ assignment_id: 'A1', Pairing: '226' }), linkedRow({ assignment_id: 'A2', Pairing: '226' })];

  const report = compareBaselineWithSnapshot(baseline, pairings);

  assert.equal(report.summary.legacyTechnicalLinkageMissing, 1);
  assert.equal(report.summary.assignmentsBaseline, 2);
});

// --- normalizacion de fechas (F4, mision <date_normalization_fix>) ------------------------------

test('compareBaselineWithSnapshot - Date real de Sheets en Fecha/Inicio/Fin compara EXACT contra el pairing actual (F4, bug de fechas)', () => {
  const pairings = evaluatedPairings([leg({})], 'SNAP1'); // Fecha/Inicio/Fin reales = 2026-09-01
  const facts = deriveVisiblePairingFacts(pairings[0]); // texto "01/09/2026" (D14)
  const baseline = [legacyRow({
    assignment_id: 'A1', Pairing: '226', pairing_content_hash: 'LEGACY_HASH_226',
    Vuelo: facts.Vuelo, Ruta: facts.Ruta,
    // Simula la celda DATE real del Spreadsheet LIVE (Apps Script la entrega como Date nativo, no
    // como texto): mismo dia civil que facts.Fecha/Inicio/Fin, representado como objeto Date.
    Fecha: new Date(2026, 8, 1), Inicio: new Date(2026, 8, 1), Fin: new Date(2026, 8, 1),
  })];

  const report = compareBaselineWithSnapshot(baseline, pairings);

  assert.equal(report.summary.visibleExact, 1, 'Date real y texto DD/MM/YYYY del mismo dia deben canonicalizar igual, no DISTINCT');
  assert.equal(report.summary.visiblePartial, 0);
  assert.equal(report.summary.visibleDistinct, 0);
  assert.deepEqual(report.visibleExactHashDifferentPairingIds, ['226']);
});

test('compareBaselineWithSnapshot - Date real con dia realmente distinto SI se reporta DISTINCT', () => {
  const pairings = evaluatedPairings([leg({})], 'SNAP1'); // 2026-09-01
  const baseline = [legacyRow({
    assignment_id: 'A1', Pairing: '226', pairing_content_hash: 'LEGACY_HASH_226',
    Vuelo: '999', Ruta: 'XXX-YYY-XXX',
    Fecha: new Date(2020, 2, 15), Inicio: new Date(2020, 2, 15), Fin: new Date(2020, 2, 16),
  })];

  const report = compareBaselineWithSnapshot(baseline, pairings);

  assert.equal(report.summary.visibleDistinct, 1);
  assert.deepEqual(report.visibleDistinctPairingIds, ['226']);
});

// --- diagnostico de elegibilidad del baseline (F5-F7, mision <baseline_eligibility_diagnostic>) --

test('compareBaselineWithSnapshot - pairing presente y ELIGIBLE se reporta como presente+ELIGIBLE (F5)', () => {
  const pairings = evaluatedPairings([leg({})], 'SNAP1'); // MIA configurado -> ELIGIBLE
  const facts = deriveVisiblePairingFacts(pairings[0]);
  const baseline = [legacyRow({ assignment_id: 'A1', Pairing: '226', ...facts })];

  const report = compareBaselineWithSnapshot(baseline, pairings);

  assert.equal(report.summary.pairingIdsPresentEligible, 1);
  assert.equal(report.summary.pairingIdsPresentReview, 0);
  assert.deepEqual(report.presentEligiblePairingIds, ['226']);
  assert.deepEqual(report.presentReviewPairingIds, []);
});

test('compareBaselineWithSnapshot - pairing presente pero REVIEW NO se reporta como ausente (F6)', () => {
  // Ruta BOG no esta configurada (routes = MIA/SCL) -> eligibility_status REVIEW, pero el
  // pairing_id 226 SIGUE existiendo en el snapshot actual.
  const reviewRows = [leg({ arrival_airport_code: 'BOG' }), leg({ flight_number: '508', departure_airport_code: 'BOG', arrival_airport_code: 'LIM' })];
  const reviewPairings = evaluatedPairings(reviewRows, 'SNAP1');
  assert.equal(reviewPairings[0].eligibility_status, 'REVIEW');
  const baseline = [legacyRow({ assignment_id: 'A1', Pairing: '226' })];

  const report = compareBaselineWithSnapshot(baseline, reviewPairings);

  assert.equal(report.summary.pairingIdsAbsent, 0, 'presente pero REVIEW no debe contarse como ausente');
  assert.deepEqual(report.absentPairingIds, []);
  assert.equal(report.summary.pairingIdsPresent, 1);
  assert.equal(report.summary.pairingIdsPresentReview, 1);
  assert.deepEqual(report.presentReviewPairingIds, ['226']);
});

test('compareBaselineWithSnapshot - eligibility_reason se reporta por pairing_id y agrupado (F7)', () => {
  const reviewRows = [leg({ arrival_airport_code: 'BOG' }), leg({ flight_number: '508', departure_airport_code: 'BOG', arrival_airport_code: 'LIM' })];
  const reviewPairings = evaluatedPairings(reviewRows, 'SNAP1');
  assert.equal(reviewPairings[0].eligibility_reason, 'ROUTE_NOT_CONFIGURED');
  const baseline = [legacyRow({ assignment_id: 'A1', Pairing: '226' })];

  const report = compareBaselineWithSnapshot(baseline, reviewPairings);

  assert.deepEqual(report.reviewPairingReasons, [{ pairing_id: '226', eligibility_reason: 'ROUTE_NOT_CONFIGURED' }]);
  assert.equal(report.reviewReasonCounts['ROUTE_NOT_CONFIGURED'], 1);
});

test('compareBaselineWithSnapshot - un pairing en REJECTED (definido pero no producido hoy) NO se etiqueta como REVIEW', () => {
  // 35_WBRules.js nunca emite REJECTED (solo ELIGIBLE/REVIEW), pero el valor existe en
  // ELIGIBILITY_STATUS (00_Constants.js): el diagnostico no debe conflar un estado mas definitivo
  // con "en revision" si algun dia se produjera.
  const rejectedPairing = Object.assign({}, evaluatedPairings([leg({})], 'SNAP1')[0], { eligibility_status: 'REJECTED', eligibility_reason: 'ALGO' });
  const baseline = [legacyRow({ assignment_id: 'A1', Pairing: '226' })];

  const report = compareBaselineWithSnapshot(baseline, [rejectedPairing]);

  assert.equal(report.summary.pairingIdsPresent, 1, 'sigue contando como presente');
  assert.equal(report.summary.pairingIdsPresentEligible, 0);
  assert.equal(report.summary.pairingIdsPresentReview, 0, 'REJECTED no debe contarse como REVIEW');
  assert.deepEqual(report.presentReviewPairingIds, []);
  assert.deepEqual(report.reviewPairingReasons, [], 'REJECTED no debe generar una entrada de razon de REVIEW');
});

// --- read-only / no side effects (M8) -----------------------------------------------------------

test('compareBaselineWithSnapshot - es de solo lectura: no muta baseline ni currentPairings', () => {
  const pairings = evaluatedPairings([leg({})], 'SNAP1');
  const facts = deriveVisiblePairingFacts(pairings[0]);
  const baseline = [legacyRow({ assignment_id: 'A1', Pairing: '226', ...facts })];

  // structuredClone (no JSON.stringify): preserva claves con valor `undefined` tal cual las deja
  // assemblePairings (p.ej. pairing_days_quantity_source), que JSON.stringify eliminaria y haria
  // parecer una mutacion falsa.
  const baselineBefore = structuredClone(baseline);
  const pairingsBefore = structuredClone(pairings);

  compareBaselineWithSnapshot(baseline, pairings);
  evaluatePublishGate(baseline);
  detectLegacyUnlinkedBaseline(baseline);

  assert.deepEqual(baseline, baselineBefore, 'el baseline no debe mutarse');
  assert.deepEqual(pairings, pairingsBefore, 'los pairings del snapshot actual no deben mutarse');
});

// --- nunca modifica INS/ACT (M12) ---------------------------------------------------------------

test('el diagnostico y el gate nunca leen ni exponen una version modificada de INS/ACT', () => {
  const pairings = evaluatedPairings([leg({})], 'SNAP1');
  const facts = deriveVisiblePairingFacts(pairings[0]);
  const baseline = [legacyRow({ assignment_id: 'A1', Pairing: '226', INS: 'Juan Perez', ACT: 'Simulador', ...facts })];

  const report = compareBaselineWithSnapshot(baseline, pairings);
  const gate = evaluatePublishGate(baseline);

  // INS/ACT del objeto de entrada permanecen intactos, y ninguna funcion nueva genero assignment_id.
  assert.equal(baseline[0].INS, 'Juan Perez');
  assert.equal(baseline[0].ACT, 'Simulador');
  assert.equal(JSON.stringify(report).indexOf('Juan Perez'), -1, 'el reporte agregado no expone INS');
  assert.equal(JSON.stringify(gate).indexOf('Simulador'), -1, 'el gate no expone ACT');
});
