const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeNextMonth, buildMonthKey, buildMonthlyWorkbookName, parseMonthlyWorkbookName,
  buildRegistryPropertyKey, parseRegistryPropertyKey, buildMonthResetConfigValues,
  decideMonthFileIdSelfHeal, decideMainFileIdSelfHeal, decideWorkbookRole,
  decideCanonicalTitle, decideMainCanonicalTitle, MAIN_CANONICAL_TITLE,
  decidePipelineTargetAllowed, buildYearFolderName, decideEnsureFolderAction,
  MAIN_VIEW_MODE, MAIN_VIEW_DEFAULTS, decideMainViewSettings, rankMainViewCandidates,
  CENTRAL_AUTOMATION_DEFAULTS, decideCentralAutomationSettings,
  decideAutoCreateShouldRun,
} = require('../77_WorkbookIdentity.js');
const { WORKBOOK_ROLE } = require('../00_Constants.js');

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

// --- buildMonthResetConfigValues (M4, M9, D24) ----------------------------------------------

test('M9 - buildMonthResetConfigValues: MONTH_FILE_ID apunta exactamente al fileId recibido', () => {
  const values = buildMonthResetConfigValues(2026, 10, 'FILE_OCT_123', 'MAIN_ID');
  assert.equal(values.MONTH_FILE_ID, 'FILE_OCT_123');
});

test('M4 - buildMonthResetConfigValues: snapshot/carga siempre PENDING_CERTIFICATION en un mes nuevo', () => {
  const values = buildMonthResetConfigValues(2026, 10, 'FILE_OCT', 'MAIN_ID');
  assert.equal(values.LOAD_KEY_ID, 'PENDING_CERTIFICATION');
  assert.equal(values.LOAD_TYPE_CODE, 'PENDING_CERTIFICATION');
  assert.equal(values.LOAD_VERSION_ID, 'PENDING_CERTIFICATION');
  assert.equal(values.INGESTION_DATETIME, 'PENDING_CERTIFICATION');
  assert.equal(values.SNAPSHOT_CERTIFICATION, 'PENDING');
});

test('buildMonthResetConfigValues - REFERENCE_YEAR/MONTH quedan en el mes nuevo, no en el de origen', () => {
  const values = buildMonthResetConfigValues(2026, 10, 'FILE_OCT', 'MAIN_ID');
  assert.equal(values.REFERENCE_YEAR, '2026');
  assert.equal(values.REFERENCE_MONTH, '10');
});

test('D24 - buildMonthResetConfigValues: todo mes nuevo es WORKBOOK_ROLE=MONTH con MAIN_FILE_ID fijo, nunca hereda MAIN', () => {
  const values = buildMonthResetConfigValues(2026, 10, 'FILE_OCT', 'MAIN_ID_FIXED');
  assert.equal(values.WORKBOOK_ROLE, WORKBOOK_ROLE.MONTH);
  assert.equal(values.MAIN_FILE_ID, 'MAIN_ID_FIXED');
});

test('buildMonthResetConfigValues - NO incluye ninguna clave operacional (se hereda de la plantilla, nunca se reescribe)', () => {
  const values = buildMonthResetConfigValues(2026, 10, 'FILE_OCT', 'MAIN_ID');
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

// --- decideMainFileIdSelfHeal (D24, generico de decideMonthFileIdSelfHeal) -----------------

test('decideMainFileIdSelfHeal - MAIN_FILE_ID vacio -> auto-asignacion segura', () => {
  assert.deepEqual(decideMainFileIdSelfHeal('', 'MAIN_ID_123'), { action: 'SELF_ASSIGN', value: 'MAIN_ID_123' });
});

test('decideMainFileIdSelfHeal - coincide con el esperado -> OK', () => {
  assert.deepEqual(decideMainFileIdSelfHeal('MAIN_ID', 'MAIN_ID'), { action: 'OK' });
});

test('decideMainFileIdSelfHeal - no coincide -> MISMATCH con el campo correcto en el mensaje (nunca "MONTH_FILE_ID")', () => {
  const r = decideMainFileIdSelfHeal('OTRO_ID', 'MAIN_ID');
  assert.equal(r.action, 'MISMATCH');
  assert.match(r.error, /MAIN_FILE_ID/);
  assert.doesNotMatch(r.error, /MONTH_FILE_ID/);
});

test('decideMonthFileIdSelfHeal sigue mencionando MONTH_FILE_ID en su error (no se corrompio al generalizar)', () => {
  const r = decideMonthFileIdSelfHeal('OTRO_ID', 'ESTE_ID');
  assert.match(r.error, /MONTH_FILE_ID/);
});

// --- decideWorkbookRole (D24, Seccion 1 de la mision: "MAIN nunca se renombra a un mes") ---

test('decideWorkbookRole - vacio + ID del MAIN fijo -> SELF_ASSIGN MAIN', () => {
  assert.deepEqual(decideWorkbookRole('', 'MAIN_ID', 'MAIN_ID'), { action: 'SELF_ASSIGN', role: WORKBOOK_ROLE.MAIN });
});

test('decideWorkbookRole - vacio + ID distinto al MAIN fijo -> SELF_ASSIGN MONTH', () => {
  assert.deepEqual(decideWorkbookRole('', 'OCT_ID', 'MAIN_ID'), { action: 'SELF_ASSIGN', role: WORKBOOK_ROLE.MONTH });
});

test('decideWorkbookRole - ya declarado MAIN y el ID calza -> OK', () => {
  assert.deepEqual(decideWorkbookRole('MAIN', 'MAIN_ID', 'MAIN_ID'), { action: 'OK', role: WORKBOOK_ROLE.MAIN });
});

test('decideWorkbookRole - declarado MAIN pero el ID NO es el MAIN fijo -> MISMATCH (copia indebida del MAIN)', () => {
  const r = decideWorkbookRole('MAIN', 'COPIA_ID', 'MAIN_ID');
  assert.equal(r.action, 'MISMATCH');
  assert.match(r.error, /MAIN/);
});

test('decideWorkbookRole - ya declarado MONTH, sin importar el ID -> OK (ningun mensual necesita coincidir con nada fijo)', () => {
  assert.deepEqual(decideWorkbookRole('MONTH', 'CUALQUIER_ID', 'MAIN_ID'), { action: 'OK', role: WORKBOOK_ROLE.MONTH });
});

test('decideWorkbookRole - valor desconocido -> MISMATCH explicito', () => {
  const r = decideWorkbookRole('ALGO_RARO', 'X', 'MAIN_ID');
  assert.equal(r.action, 'MISMATCH');
  assert.match(r.error, /WORKBOOK_ROLE/);
});

test('decideWorkbookRole - acepta minusculas/espacios (mismo trato que otras claves de _CONFIG)', () => {
  assert.deepEqual(decideWorkbookRole(' main ', 'MAIN_ID', 'MAIN_ID'), { action: 'OK', role: WORKBOOK_ROLE.MAIN });
});

// --- decideMainCanonicalTitle (D24: el MAIN nunca se renombra a un mes) --------------------

test('decideMainCanonicalTitle - titulo ya "Pairings WB" -> OK, no renombra', () => {
  assert.deepEqual(decideMainCanonicalTitle('Pairings WB'), { action: 'OK' });
  assert.equal(MAIN_CANONICAL_TITLE, 'Pairings WB');
});

test('decideMainCanonicalTitle - titulo con nombre de mes (renombrado incorrectamente) -> RENAME a "Pairings WB"', () => {
  assert.deepEqual(decideMainCanonicalTitle('Pairings WB - SEPTIEMBRE 2026'), { action: 'RENAME', value: 'Pairings WB' });
});

test('decideMainCanonicalTitle - NUNCA devuelve un nombre de mes como valor, sin importar el titulo actual', () => {
  ['Pairings WB - OCTUBRE 2026', 'cualquier cosa', '', 'Pairings WB - ENERO 2027'].forEach((title) => {
    const r = decideMainCanonicalTitle(title);
    if (r.action === 'RENAME') assert.equal(r.value, 'Pairings WB');
  });
});

// --- decidePipelineTargetAllowed (D24, Seccion 2: MAIN nunca es owner duplicado de INS/ACT) -

test('decidePipelineTargetAllowed - MAIN nunca puede ser target de calculo', () => {
  assert.equal(decidePipelineTargetAllowed(WORKBOOK_ROLE.MAIN).allowed, false);
});

test('decidePipelineTargetAllowed - MONTH siempre puede ser target de calculo', () => {
  assert.equal(decidePipelineTargetAllowed(WORKBOOK_ROLE.MONTH).allowed, true);
});

// --- Carpetas anuales (D24, Seccion 3) ------------------------------------------------------

test('buildYearFolderName - el anio como string, sin ceros ni separadores', () => {
  assert.equal(buildYearFolderName(2026), '2026');
  assert.equal(buildYearFolderName('2027'), '2027');
});

test('decideEnsureFolderAction - ninguna carpeta encontrada -> CREATE', () => {
  assert.deepEqual(decideEnsureFolderAction([]), { action: 'CREATE' });
  assert.deepEqual(decideEnsureFolderAction(undefined), { action: 'CREATE' });
});

test('decideEnsureFolderAction - ya existe una (o mas, por una carrera historica) -> REUSE la primera, nunca crea otra', () => {
  assert.deepEqual(decideEnsureFolderAction(['FOLDER_A']), { action: 'REUSE', id: 'FOLDER_A' });
  assert.deepEqual(decideEnsureFolderAction(['FOLDER_A', 'FOLDER_B']), { action: 'REUSE', id: 'FOLDER_A' });
});

// --- parseRegistryPropertyKey (D24, Seccion 5: inversa de buildRegistryPropertyKey) --------

test('parseRegistryPropertyKey - roundtrip exacto con buildRegistryPropertyKey', () => {
  const key = buildRegistryPropertyKey(2026, 10);
  assert.deepEqual(parseRegistryPropertyKey(key), { year: 2026, month: 10 });
});

test('parseRegistryPropertyKey - clave ajena (otra automatizacion en el mismo proyecto) -> null, no lanza', () => {
  assert.equal(parseRegistryPropertyKey('WB_CENTRAL_AUTO_CREATE_DAY'), null);
  assert.equal(parseRegistryPropertyKey('WB_MONTH_FILE_2026-13'), null); // mes invalido
  assert.equal(parseRegistryPropertyKey(''), null);
  assert.equal(parseRegistryPropertyKey(null), null);
});

// --- decideMainViewSettings / rankMainViewCandidates (D24, Seccion 5: "MAIN VIEW STATE") ---

test('decideMainViewSettings - default documentado: CURRENT_MONTH', () => {
  assert.deepEqual(decideMainViewSettings({}), { viewMode: MAIN_VIEW_MODE.CURRENT_MONTH });
  assert.equal(MAIN_VIEW_DEFAULTS.MAIN_VIEW_MODE, MAIN_VIEW_MODE.CURRENT_MONTH);
});

test('decideMainViewSettings - respeta LATEST_CREATED configurado', () => {
  assert.deepEqual(decideMainViewSettings({ MAIN_VIEW_MODE: 'LATEST_CREATED' }), { viewMode: MAIN_VIEW_MODE.LATEST_CREATED });
});

test('decideMainViewSettings - valor invalido/basura -> default CURRENT_MONTH, nunca lanza', () => {
  assert.deepEqual(decideMainViewSettings({ MAIN_VIEW_MODE: 'ALGO_INVALIDO' }), { viewMode: MAIN_VIEW_MODE.CURRENT_MONTH });
});

function entry(year, month, fileId) {
  return { year, month, monthKey: buildMonthKey(year, month), fileId };
}

test('rankMainViewCandidates - sin meses registrados -> arreglo vacio, nunca lanza', () => {
  assert.deepEqual(rankMainViewCandidates({ viewMode: MAIN_VIEW_MODE.CURRENT_MONTH }, [], 2026, 9), []);
});

test('rankMainViewCandidates - CURRENT_MONTH: el mes de hoy va primero si existe', () => {
  const entries = [entry(2026, 9, 'SEPT'), entry(2026, 10, 'OCT')];
  const ranked = rankMainViewCandidates({ viewMode: MAIN_VIEW_MODE.CURRENT_MONTH }, entries, 2026, 10);
  assert.equal(ranked[0].fileId, 'OCT');
});

test('rankMainViewCandidates - CURRENT_MONTH: fallback al ultimo creado si el mes de hoy no existe', () => {
  const entries = [entry(2026, 9, 'SEPT'), entry(2026, 10, 'OCT')];
  const ranked = rankMainViewCandidates({ viewMode: MAIN_VIEW_MODE.CURRENT_MONTH }, entries, 2026, 11);
  assert.equal(ranked[0].fileId, 'OCT'); // no hay Noviembre: el mas nuevo es Octubre
});

test('rankMainViewCandidates - LATEST_CREATED: siempre el mas nuevo primero, sin importar hoy', () => {
  const entries = [entry(2026, 9, 'SEPT'), entry(2026, 10, 'OCT'), entry(2027, 1, 'ENE')];
  const ranked = rankMainViewCandidates({ viewMode: MAIN_VIEW_MODE.LATEST_CREATED }, entries, 2026, 9);
  assert.equal(ranked[0].fileId, 'ENE');
  assert.deepEqual(ranked.map((e) => e.fileId), ['ENE', 'OCT', 'SEPT']);
});

test('rankMainViewCandidates - devuelve TODOS los candidatos en orden, para permitir verificacion fisica en cascada', () => {
  const entries = [entry(2026, 9, 'SEPT'), entry(2026, 10, 'OCT')];
  const ranked = rankMainViewCandidates({ viewMode: MAIN_VIEW_MODE.CURRENT_MONTH }, entries, 2026, 9);
  assert.equal(ranked.length, 2);
  assert.deepEqual(ranked.map((e) => e.fileId).sort(), ['OCT', 'SEPT']);
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
