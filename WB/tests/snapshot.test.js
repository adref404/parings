const test = require('node:test');
const assert = require('node:assert/strict');
const {
  buildSnapshotContext, computeSnapshotKey, computePairingInstanceKey, selectSnapshotCandidate,
} = require('../20_Snapshot.js');

const baseConfig = {
  SUBSIDIARY_CODE: 'LP', CREW_BASE_CODE: 'LIM', CREW_RANGE_TYPE_CODE: 'TM',
  REFERENCE_YEAR: '2026', REFERENCE_MONTH: '9', FLEET_SCOPE: 'B767', SUBFLEET_CODES: '763',
};

const loadA = { load_key_id: 'FP_LP_WB_TM_09_2026_1', load_type_code: 'FP', load_version_id: '1', ingestion_datetime: '2026-08-20 00:00:00' };
const loadB = { load_key_id: 'ES_LP_WB_TM_09_2026_PFv1', load_type_code: 'ES', load_version_id: 'PFv1', ingestion_datetime: '2026-08-21 00:00:00' };

test('computeSnapshotKey - deterministico para el mismo contexto', () => {
  const ctx = buildSnapshotContext(baseConfig, loadA);
  assert.equal(computeSnapshotKey(ctx), computeSnapshotKey(buildSnapshotContext(baseConfig, loadA)));
});

test('computeSnapshotKey - distinto load_key_id -> distinto snapshot_key (no mezclar cargas)', () => {
  const ctxA = buildSnapshotContext(baseConfig, loadA);
  const ctxB = buildSnapshotContext(baseConfig, loadB);
  assert.notEqual(computeSnapshotKey(ctxA), computeSnapshotKey(ctxB));
});

test('computeSnapshotKey - distinto mes de referencia -> distinto snapshot_key', () => {
  const ctx1 = buildSnapshotContext(baseConfig, loadA);
  const ctx2 = buildSnapshotContext(Object.assign({}, baseConfig, { REFERENCE_MONTH: '10' }), loadA);
  assert.notEqual(computeSnapshotKey(ctx1), computeSnapshotKey(ctx2));
});

test('computePairingInstanceKey - mismo pairing_id en dos snapshots distintos produce claves distintas', () => {
  const skA = computeSnapshotKey(buildSnapshotContext(baseConfig, loadA));
  const skB = computeSnapshotKey(buildSnapshotContext(baseConfig, loadB));
  const pikA = computePairingInstanceKey(skA, 226);
  const pikB = computePairingInstanceKey(skB, 226);
  assert.notEqual(pikA, pikB, 'pairing_id 226 en dos cargas distintas no debe colapsar a la misma instancia');
});

test('computePairingInstanceKey - mismo snapshot y mismo pairing_id -> misma clave (idempotencia)', () => {
  const sk = computeSnapshotKey(buildSnapshotContext(baseConfig, loadA));
  assert.equal(computePairingInstanceKey(sk, 226), computePairingInstanceKey(sk, 226));
});

test('selectSnapshotCandidate - 0 candidatos -> no auto-seleccionable', () => {
  const r = selectSnapshotCandidate([]);
  assert.equal(r.autoSelectable, false);
  assert.equal(r.reason, 'NO_CANDIDATES');
});

test('selectSnapshotCandidate - 1 candidato -> auto-seleccionable', () => {
  const r = selectSnapshotCandidate([{ load_key_id: 'X' }]);
  assert.equal(r.autoSelectable, true);
  assert.equal(r.candidate.load_key_id, 'X');
});

test('selectSnapshotCandidate - >1 candidatos -> NUNCA elige en silencio', () => {
  const r = selectSnapshotCandidate([{ load_key_id: 'X' }, { load_key_id: 'Y' }]);
  assert.equal(r.autoSelectable, false);
  assert.equal(r.candidate, null);
  assert.equal(r.reason, 'MULTIPLE_CANDIDATES');
  assert.equal(r.candidates.length, 2);
});
