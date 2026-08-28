const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { QaService } = require('../70_QA.js');
const { CONFIG_DEFAULTS, CONFIG_DEFAULT_ROUTES } = require('../00_Constants.js');

test('Q1/Q2 - configuracion y ruleset de fabrica pasan', () => {
  assert.equal(QaService.q1ConfigValid(CONFIG_DEFAULTS, CONFIG_DEFAULT_ROUTES).passed, true);
  assert.equal(QaService.q2RulesetCompatible(CONFIG_DEFAULTS).passed, true);
});

test('Q3 - bloquea publicacion si snapshot no esta CERTIFIED (con identidad real seleccionada)', () => {
  const pending = Object.assign({}, CONFIG_DEFAULTS, { LOAD_KEY_ID: 'FP_LP_WB_TM_09_2026_1', SNAPSHOT_CERTIFICATION: 'PENDING' });
  assert.equal(QaService.q3SnapshotCertified(pending, false).passed, false);
  assert.equal(QaService.q3SnapshotCertified(pending, true).passed, true);
});

test('Q3 - bloquea incluso en preview si nunca se certifico nada (LOAD_KEY_ID sigue siendo el centinela)', () => {
  assert.equal(QaService.q3SnapshotCertified(CONFIG_DEFAULTS, true).passed, false);
  assert.match(QaService.q3SnapshotCertified(CONFIG_DEFAULTS, true).detail, /ningun snapshot fue certificado/);
});

test('Q8 - detecta cualquier cambio de INS/ACT durante un dry run (debe ser 0)', () => {
  const before = [{ assignment_id: 'A1', INS: 'Juan', ACT: '' }];
  const afterOk = [{ assignment_id: 'A1', INS: 'Juan', ACT: '' }];
  const afterBad = [{ assignment_id: 'A1', INS: 'OTRO', ACT: '' }];
  assert.equal(QaService.q8NoHumanDataChangedInDryRun(before, afterOk).passed, true);
  assert.equal(QaService.q8NoHumanDataChangedInDryRun(before, afterBad).passed, false);
});

test('Q9 - assignment_id duplicado se detecta', () => {
  const rows = [{ assignment_id: 'A1' }, { assignment_id: 'A1' }];
  assert.equal(QaService.q9AssignmentIdUnique(rows).passed, false);
  assert.equal(QaService.q9AssignmentIdUnique([{ assignment_id: 'A1' }, { assignment_id: 'A2' }]).passed, true);
});

test('Q10 - assignment_id igual a pairing_instance_key se marca como sospechoso', () => {
  const rows = [{ assignment_id: 'PIK1', pairing_instance_key: 'PIK1' }];
  assert.equal(QaService.q10NoPikAsHumanPk(rows).passed, false);
  assert.equal(QaService.q10NoPikAsHumanPk([{ assignment_id: 'A1', pairing_instance_key: 'PIK1' }]).passed, true);
});

test('Q11/Q12 - 0 perdida de INS/ACT tras reconciliar', () => {
  const before = [{ assignment_id: 'A1', INS: 'Juan', ACT: 'Linea' }];
  const afterOk = [{ assignment_id: 'A1', INS: 'Juan', ACT: 'Linea', assignment_status: 'ACTIVE' }];
  const afterLostIns = [{ assignment_id: 'A1', INS: '', ACT: 'Linea' }];
  assert.equal(QaService.q11NoInsLoss(before, afterOk).passed, true);
  assert.equal(QaService.q12NoActLoss(before, afterOk).passed, true);
  assert.equal(QaService.q11NoInsLoss(before, afterLostIns).passed, false);
});

test('Q13 - la suma de multiplicidades por leg debe igualar las filas crudas recibidas', () => {
  const pairings = [{ legs: [{ source_row_multiplicity: 2 }, { source_row_multiplicity: 1 }] }];
  assert.equal(QaService.q13MultiplicitiesPreserved(3, pairings).passed, true);
  assert.equal(QaService.q13MultiplicitiesPreserved(5, pairings).passed, false);
});

test('Q14 - _PAIRINGS_DATA con columnas faltantes falla', () => {
  assert.equal(QaService.q14PairingsDataSchemaCompatible(['pairing_id', 'leg_key']).passed, false);
  const { PAIRINGS_DATA_HEADERS } = require('../00_Constants.js');
  assert.equal(QaService.q14PairingsDataSchemaCompatible(PAIRINGS_DATA_HEADERS.slice()).passed, true);
});

test('Q15 - una ruta ELIGIBLE con destino no configurado es una falla de QA (nunca deberia ocurrir)', () => {
  const evaluated = [{ pairing_id: '1', eligibility_status: 'ELIGIBLE', primary_destination_code: 'BOG' }];
  assert.equal(QaService.q15UnknownRoutesReview(evaluated, ['MIA', 'SCL', 'ATL']).passed, false);
  const evaluatedOk = [{ pairing_id: '1', eligibility_status: 'REVIEW', primary_destination_code: 'BOG' }];
  assert.equal(QaService.q15UnknownRoutesReview(evaluatedOk, ['MIA', 'SCL', 'ATL']).passed, true);
});

test('Q16 - CERO contaminacion NB en el codigo fuente REAL de las reglas WB (regresion continua)', () => {
  const files = ['35_WBRules.js', '30_PairingAssembler.js', '15_Config.js'];
  const sourceTextsByFile = {};
  files.forEach(f => { sourceTextsByFile[f] = fs.readFileSync(path.join(__dirname, '..', f), 'utf8'); });
  const result = QaService.q16NbContaminationZero(sourceTextsByFile);
  assert.equal(result.passed, true, result.detail);
});

test('Q16 - detecta contaminacion si un token NB aparece en el codigo (prueba negativa del propio check)', () => {
  const result = QaService.q16NbContaminationZero({ 'fake.js': 'if (departureTime > "08:30") reject();' });
  assert.equal(result.passed, false);
  assert.match(result.detail, /08:30/);
});

test('Q17 - 0 desplazamientos de fecha', () => {
  assert.equal(QaService.q17DateShiftsZero([{ originalIso: '2026-09-30', roundTrippedIso: '2026-09-30' }]).passed, true);
  assert.equal(QaService.q17DateShiftsZero([{ originalIso: '2026-09-30', roundTrippedIso: '2026-10-01' }]).passed, false);
});

test('Q18-Q20 - detecta errores de formula en una matriz de valores', () => {
  assert.equal(QaService.q18q19q20FormulaErrors([['ok', 1], ['#N/A', 'ok']]).passed, false);
  assert.equal(QaService.q18q19q20FormulaErrors([['ok', 1], ['ok', 'ok']]).passed, true);
});
