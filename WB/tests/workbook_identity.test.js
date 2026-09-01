const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeNextMonth, buildMonthKey, buildMonthlyWorkbookName, parseMonthlyWorkbookName,
  buildRegistryPropertyKey, buildMonthResetConfigValues, decideMonthFileIdSelfHeal,
  decideCanonicalTitle, CENTRAL_AUTOMATION_DEFAULTS, decideCentralAutomationSettings,
  decideAutoCreateShouldRun,
} = require('../77_WorkbookIdentity.js');

// --- computeNextMonth (M1, M2) -------------------------------------------------------------

test('M1 - computeNextMonth: Septiembre 2026 -> Octubre 2026', () => {
  assert.deepEqual(computeNextMonth(2026, 9), { year: 2026, month: 10 });
});

test('M2 - computeNextMonth: Diciembre 2026 -> Enero 2027 (corte de anio)', () => {
  assert.deepEqual(computeNextMonth(2026, 12), { year: 2027, month: 1 });
});

test('computeNextMonth - acepta strings, igual que _CONFIG las entrega', () => {
  assert.deepEqual(computeNextMonth('2026', '9'), { year: 2026, month: 10 });
});

// --- nombre/clave del archivo mensual ------------------------------------------------------

test('buildMonthlyWorkbookName - formato exacto "Pairings WB - OCTUBRE 2026"', () => {
  assert.equal(buildMonthlyWorkbookName(2026, 10), 'Pairings WB - OCTUBRE 2026');
});

test('buildMonthlyWorkbookName - Septiembre y Enero (bordes de anio)', () => {
  assert.equal(buildMonthlyWorkbookName(2026, 9), 'Pairings WB - SEPTIEMBRE 2026');
  assert.equal(buildMonthlyWorkbookName(2027, 1), 'Pairings WB - ENERO 2027');
});

test('parseMonthlyWorkbookName - inversa exacta de buildMonthlyWorkbookName (roundtrip)', () => {
  const name = buildMonthlyWorkbookName(2026, 10);
  assert.deepEqual(parseMonthlyWorkbookName(name), { year: 2026, month: 10 });
});

test('parseMonthlyWorkbookName - nombre no reconocible devuelve null, no lanza', () => {
  assert.equal(parseMonthlyWorkbookName('Pairings WB'), null);
  assert.equal(parseMonthlyWorkbookName('Cualquier otra cosa'), null);
  assert.equal(parseMonthlyWorkbookName(''), null);
  assert.equal(parseMonthlyWorkbookName(null), null);
});

test('buildRegistryPropertyKey - clave estable YYYY-MM con cero a la izquierda en el mes', () => {
  assert.equal(buildRegistryPropertyKey(2026, 9), 'WB_MONTH_FILE_2026-09');
  assert.equal(buildRegistryPropertyKey(2026, 10), 'WB_MONTH_FILE_2026-10');
});

test('buildMonthKey - mismo mes, mismo year/month en distintos tipos (string/number) -> misma clave', () => {
  assert.equal(buildMonthKey(2026, 10), buildMonthKey('2026', '10'));
});

// --- buildMonthResetConfigValues (M4, M9) --------------------------------------------------

test('M9 - buildMonthResetConfigValues: MONTH_FILE_ID apunta exactamente al fileId recibido', () => {
  const values = buildMonthResetConfigValues(2026, 10, 'FILE_OCT_123');
  assert.equal(values.MONTH_FILE_ID, 'FILE_OCT_123');
});

test('M4 - buildMonthResetConfigValues: snapshot/carga siempre PENDING_CERTIFICATION en un mes nuevo', () => {
  const values = buildMonthResetConfigValues(2026, 10, 'FILE_OCT');
  assert.equal(values.LOAD_KEY_ID, 'PENDING_CERTIFICATION');
  assert.equal(values.LOAD_TYPE_CODE, 'PENDING_CERTIFICATION');
  assert.equal(values.LOAD_VERSION_ID, 'PENDING_CERTIFICATION');
  assert.equal(values.INGESTION_DATETIME, 'PENDING_CERTIFICATION');
  assert.equal(values.SNAPSHOT_CERTIFICATION, 'PENDING');
});

test('buildMonthResetConfigValues - REFERENCE_YEAR/MONTH quedan en el mes nuevo, no en el de origen', () => {
  const values = buildMonthResetConfigValues(2026, 10, 'FILE_OCT');
  assert.equal(values.REFERENCE_YEAR, '2026');
  assert.equal(values.REFERENCE_MONTH, '10');
});

test('buildMonthResetConfigValues - NO incluye ninguna clave operacional (se hereda de la plantilla, nunca se reescribe)', () => {
  const values = buildMonthResetConfigValues(2026, 10, 'FILE_OCT');
  ['CREW_BASE_CODE', 'BIGQUERY_JOB_PROJECT_ID', 'MAX_OCCUPIED_DAYS', 'ALLOWED_OCCUPIED_DOW'].forEach((k) => {
    assert.equal(Object.prototype.hasOwnProperty.call(values, k), false, k + ' no debe estar en el plan de reseteo');
  });
});

// --- decideMonthFileIdSelfHeal (Seccion 1 y 6: identidad del archivo) ----------------------

test('decideMonthFileIdSelfHeal - MONTH_FILE_ID vacio (Septiembre migrando) -> auto-asignacion segura', () => {
  const r = decideMonthFileIdSelfHeal('', 'SELF_ID_ABC');
  assert.deepEqual(r, { action: 'SELF_ASSIGN', value: 'SELF_ID_ABC' });
});

test('decideMonthFileIdSelfHeal - undefined/null tambien cuentan como vacio', () => {
  assert.equal(decideMonthFileIdSelfHeal(undefined, 'X').action, 'SELF_ASSIGN');
  assert.equal(decideMonthFileIdSelfHeal(null, 'X').action, 'SELF_ASSIGN');
});

test('M10 - decideMonthFileIdSelfHeal: coincide con el propio ID -> OK (backend opera sobre CUALQUIER fileId, no uno fijo)', () => {
  assert.deepEqual(decideMonthFileIdSelfHeal('OCT_ID', 'OCT_ID'), { action: 'OK' });
});

test('decideMonthFileIdSelfHeal - no coincide -> MISMATCH con mensaje accionable (copia fuera de "Crear mes")', () => {
  const r = decideMonthFileIdSelfHeal('OTRO_ID', 'ESTE_ID');
  assert.equal(r.action, 'MISMATCH');
  assert.match(r.error, /Crear mes/);
});

// --- decideCanonicalTitle (Seccion 6: migracion segura de titulo) --------------------------

test('decideCanonicalTitle - titulo ya canonico -> OK, no renombra', () => {
  assert.deepEqual(decideCanonicalTitle('Pairings WB - SEPTIEMBRE 2026', 2026, 9), { action: 'OK' });
});

test('decideCanonicalTitle - titulo antiguo "Pairings WB" (Septiembre antes de esta mision) -> RENAME', () => {
  const r = decideCanonicalTitle('Pairings WB', 2026, 9);
  assert.deepEqual(r, { action: 'RENAME', value: 'Pairings WB - SEPTIEMBRE 2026' });
});

test('decideCanonicalTitle - sin year/month todavia (config recien creada) -> SKIP, no decide en falso', () => {
  assert.deepEqual(decideCanonicalTitle('Pairings WB', '', ''), { action: 'SKIP' });
});

// --- decideCentralAutomationSettings / decideAutoCreateShouldRun (Seccion 4) ---------------

test('decideCentralAutomationSettings - defaults documentados: TRUE / dia 20', () => {
  assert.deepEqual(decideCentralAutomationSettings({}), { enabled: true, autoCreateDay: 20 });
  assert.equal(CENTRAL_AUTOMATION_DEFAULTS.AUTO_CREATE_NEXT_MONTH, 'TRUE');
  assert.equal(CENTRAL_AUTOMATION_DEFAULTS.AUTO_CREATE_DAY, '20');
});

test('M14 - decideCentralAutomationSettings respeta un AUTO_CREATE_DAY configurado distinto al default', () => {
  const s = decideCentralAutomationSettings({ AUTO_CREATE_DAY: '5' });
  assert.equal(s.autoCreateDay, 5);
});

test('decideCentralAutomationSettings - AUTO_CREATE_NEXT_MONTH=FALSE se respeta', () => {
  assert.equal(decideCentralAutomationSettings({ AUTO_CREATE_NEXT_MONTH: 'FALSE' }).enabled, false);
});

test('M13/M14 - decideAutoCreateShouldRun: antes del dia configurado NO corre', () => {
  const settings = decideCentralAutomationSettings({ AUTO_CREATE_DAY: '20' });
  const r = decideAutoCreateShouldRun(settings, 2026, 9, 19);
  assert.equal(r.shouldRun, false);
});

test('M13/M14 - decideAutoCreateShouldRun: en o despues del dia configurado SI corre', () => {
  const settings = decideCentralAutomationSettings({ AUTO_CREATE_DAY: '20' });
  assert.equal(decideAutoCreateShouldRun(settings, 2026, 9, 20).shouldRun, true);
  assert.equal(decideAutoCreateShouldRun(settings, 2026, 9, 25).shouldRun, true);
});

test('M2 - decideAutoCreateShouldRun: Diciembre -> apunta a Enero del anio siguiente', () => {
  const settings = decideCentralAutomationSettings({ AUTO_CREATE_DAY: '20' });
  const r = decideAutoCreateShouldRun(settings, 2026, 12, 20);
  assert.equal(r.shouldRun, true);
  assert.deepEqual({ year: r.targetYear, month: r.targetMonth }, { year: 2027, month: 1 });
});

test('decideAutoCreateShouldRun - deshabilitado (AUTO_CREATE_NEXT_MONTH=FALSE) nunca corre, sin importar el dia', () => {
  const settings = decideCentralAutomationSettings({ AUTO_CREATE_NEXT_MONTH: 'FALSE', AUTO_CREATE_DAY: '1' });
  assert.equal(decideAutoCreateShouldRun(settings, 2026, 9, 30).shouldRun, false);
});

test('decideAutoCreateShouldRun - es PURA: no depende de Date/timezone, el llamador resuelve hoy', () => {
  // Mismos argumentos -> mismo resultado, sin importar cuando se ejecute el test.
  const settings = decideCentralAutomationSettings({});
  const a = decideAutoCreateShouldRun(settings, 2026, 9, 20);
  const b = decideAutoCreateShouldRun(settings, 2026, 9, 20);
  assert.deepEqual(a, b);
});
