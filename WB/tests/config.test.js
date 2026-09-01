const test = require('node:test');
const assert = require('node:assert/strict');
const {
  canonicalizeConfig, normalizeRoutes, parseAllowedDow, computeConfigHash,
  validateConfig, isSnapshotCertified, computeConfigBootstrapPlan,
  buildJobProjectUpdatePlan, decideJobProjectUpdate,
} = require('../15_Config.js');
const { CONFIG_DEFAULTS, CONFIG_DEFAULT_ROUTES, SNAPSHOT_CERTIFICATION } = require('../00_Constants.js');

test('canonicalizeConfig - trim y uppercase de codigos, no de valores libres', () => {
  const canon = canonicalizeConfig({ SUBSIDIARY_CODE: ' lp ', LOAD_KEY_ID: ' MixedCase_1 ' });
  assert.equal(canon.SUBSIDIARY_CODE, 'LP');
  assert.equal(canon.LOAD_KEY_ID, 'MixedCase_1'); // no es clave de codigo, no se fuerza mayuscula
});

test('canonicalizeConfig - normaliza numeros (9 vs 09 vs "9 ")', () => {
  const a = canonicalizeConfig({ REFERENCE_MONTH: '9' });
  const b = canonicalizeConfig({ REFERENCE_MONTH: '09' });
  const c = canonicalizeConfig({ REFERENCE_MONTH: ' 9 ' });
  assert.equal(a.REFERENCE_MONTH, b.REFERENCE_MONTH);
  assert.equal(a.REFERENCE_MONTH, c.REFERENCE_MONTH);
});

test('parseAllowedDow - parsea lista separada por comas', () => {
  assert.deepEqual(parseAllowedDow('MON,TUE,WED,THU,FRI'), ['MON', 'TUE', 'WED', 'THU', 'FRI']);
  assert.deepEqual(parseAllowedDow(' mon , tue '), ['MON', 'TUE']);
  assert.deepEqual(parseAllowedDow(''), []);
});

test('normalizeRoutes - ordena por prioridad y normaliza codigos', () => {
  const routes = normalizeRoutes([
    { code: 'atl', priority: '3', role: 'fallback' },
    { code: 'mia', priority: '1', role: 'primary' },
    { code: 'scl', priority: '2', role: 'secondary' },
  ]);
  assert.deepEqual(routes.map(r => r.code), ['MIA', 'SCL', 'ATL']);
  assert.equal(routes[0].role, 'PRIMARY');
});

test('computeConfigHash - deterministico para el mismo config/rutas', () => {
  const h1 = computeConfigHash(CONFIG_DEFAULTS, CONFIG_DEFAULT_ROUTES);
  const h2 = computeConfigHash(CONFIG_DEFAULTS, CONFIG_DEFAULT_ROUTES);
  assert.equal(h1, h2);
});

test('computeConfigHash - cambia si cambia una regla WB relevante', () => {
  const base = computeConfigHash(CONFIG_DEFAULTS, CONFIG_DEFAULT_ROUTES);
  const changed = Object.assign({}, CONFIG_DEFAULTS, { MAX_OCCUPIED_DAYS: '4' });
  const h2 = computeConfigHash(changed, CONFIG_DEFAULT_ROUTES);
  assert.notEqual(base, h2);
});

test('computeConfigHash - NO cambia solo por certificar un snapshot (campos de carga excluidos)', () => {
  const before = computeConfigHash(CONFIG_DEFAULTS, CONFIG_DEFAULT_ROUTES);
  const afterCert = Object.assign({}, CONFIG_DEFAULTS, {
    LOAD_KEY_ID: 'FP_LP_WB_TM_09_2026_1',
    LOAD_TYPE_CODE: 'FP',
    LOAD_VERSION_ID: '1',
    INGESTION_DATETIME: '2026-08-20 00:00:00',
    SNAPSHOT_CERTIFICATION: 'CERTIFIED',
  });
  const after = computeConfigHash(afterCert, CONFIG_DEFAULT_ROUTES);
  assert.equal(before, after, 'certificar un snapshot no debe cambiar config_hash (son cosas distintas)');
});

test('validateConfig - defaults de fabrica son validos', () => {
  const result = validateConfig(CONFIG_DEFAULTS, CONFIG_DEFAULT_ROUTES);
  assert.equal(result.valid, true, JSON.stringify(result.errors));
});

test('validateConfig - detecta RULESET_ID incompatible (Q2)', () => {
  const bad = Object.assign({}, CONFIG_DEFAULTS, { RULESET_ID: 'NB_ALGO_INCOMPATIBLE' });
  const result = validateConfig(bad, CONFIG_DEFAULT_ROUTES);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.indexOf('RULESET_ID') !== -1));
});

test('validateConfig - detecta ausencia de rutas', () => {
  const result = validateConfig(CONFIG_DEFAULTS, []);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.indexOf('rutas') !== -1));
});

test('validateConfig - detecta prioridades de ruta duplicadas', () => {
  const dupRoutes = [{ code: 'MIA', priority: 1, role: 'PRIMARY' }, { code: 'SCL', priority: 1, role: 'SECONDARY' }];
  const result = validateConfig(CONFIG_DEFAULTS, dupRoutes);
  assert.equal(result.valid, false);
  assert.ok(result.errors.some(e => e.indexOf('duplicada') !== -1));
});

test('isSnapshotCertified - Q3 gate: bloquea si no esta CERTIFIED (con identidad real) salvo preview', () => {
  const pendienteConIdentidad = Object.assign({}, CONFIG_DEFAULTS, {
    LOAD_KEY_ID: 'FP_LP_WB_TM_09_2026_1', SNAPSHOT_CERTIFICATION: SNAPSHOT_CERTIFICATION.PENDING,
  });
  assert.equal(isSnapshotCertified(pendienteConIdentidad, false), false);
  assert.equal(isSnapshotCertified(pendienteConIdentidad, true), true, 'preview sobre un snapshot ya seleccionado (con identidad real) debe permitir avanzar');

  const certificado = Object.assign({}, CONFIG_DEFAULTS, {
    LOAD_KEY_ID: 'FP_LP_WB_TM_09_2026_1', SNAPSHOT_CERTIFICATION: SNAPSHOT_CERTIFICATION.CERTIFIED,
  });
  assert.equal(isSnapshotCertified(certificado, false), true);
});

test('isSnapshotCertified - NUNCA bypasea el centinela PENDING_CERTIFICATION, ni siquiera en preview', () => {
  // CONFIG_DEFAULTS.LOAD_KEY_ID es literalmente 'PENDING_CERTIFICATION': nunca se corrio "Certificar snapshot".
  assert.equal(CONFIG_DEFAULTS.LOAD_KEY_ID, 'PENDING_CERTIFICATION');
  assert.equal(isSnapshotCertified(CONFIG_DEFAULTS, true), false, 'previsualizar sin haber certificado NUNCA debe pasar silenciosamente');
  assert.equal(isSnapshotCertified(CONFIG_DEFAULTS, false), false);
});

test('computeConfigBootstrapPlan - NO hace falta escribir si ya estan todas las claves y rutas (evita reescribir _CONFIG en cada diagnostico)', () => {
  const current = { values: Object.assign({}, CONFIG_DEFAULTS), routes: CONFIG_DEFAULT_ROUTES.slice(), sheetFound: true };
  const plan = computeConfigBootstrapPlan(current);
  assert.equal(plan.needsWrite, false);
  assert.equal(plan.rows, null);
});

test('computeConfigBootstrapPlan - hoja nueva (sheetFound=false) SI requiere escritura', () => {
  const plan = computeConfigBootstrapPlan({ values: {}, routes: [], sheetFound: false });
  assert.equal(plan.needsWrite, true);
  assert.ok(plan.rows.length > 0);
});

test('computeConfigBootstrapPlan - claves faltantes SI requieren escritura, pero preservan lo existente', () => {
  const current = { values: { SUBSIDIARY_CODE: 'LP' }, routes: CONFIG_DEFAULT_ROUTES.slice(), sheetFound: true };
  const plan = computeConfigBootstrapPlan(current);
  assert.equal(plan.needsWrite, true);
  assert.ok(plan.missingKeys.indexOf('SUBSIDIARY_CODE') === -1, 'SUBSIDIARY_CODE ya existia, no es una clave faltante');
  assert.ok(plan.missingKeys.indexOf('CREW_BASE_CODE') !== -1);
  assert.equal(plan.merged.SUBSIDIARY_CODE, 'LP', 'el valor existente nunca se sobrescribe con el default');
});

test('computeConfigBootstrapPlan - rutas vacias SI requieren escritura (bootstrap de rutas por defecto)', () => {
  const current = { values: Object.assign({}, CONFIG_DEFAULTS), routes: [], sheetFound: true };
  const plan = computeConfigBootstrapPlan(current);
  assert.equal(plan.needsWrite, true);
  assert.equal(plan.routes, CONFIG_DEFAULT_ROUTES);
});

// ---------------------------------------------------------------------------
// T156-T157 (Mision: BigQuery -> Probar/configurar proyecto de ejecucion)
// ---------------------------------------------------------------------------

test('T156 - un fallo del job project (creacion de job o acceso a la fuente) NO produce un plan de escritura', () => {
  const jobCreationFailed = { jobCreation: { ok: false, error: '403 jobs.create denied' }, sourceAccess: { ok: false, error: 'No probado' } };
  const d1 = decideJobProjectUpdate('datadem-home', jobCreationFailed);
  assert.equal(d1.shouldWrite, false);
  assert.equal(d1.plan, null);

  const sourceAccessFailed = { jobCreation: { ok: true, error: null }, sourceAccess: { ok: false, error: '403 dataViewer denied' } };
  const d2 = decideJobProjectUpdate('datadem-home', sourceAccessFailed);
  assert.equal(d2.shouldWrite, false);
  assert.equal(d2.plan, null, 'creacion de job OK no alcanza: tambien debe pasar el acceso a la fuente');
});

test('T157 - un job project validado (ambas pruebas PASS) genera un plan de escritura UNICAMENTE de BIGQUERY_JOB_PROJECT_ID', () => {
  const bothPassed = { jobCreation: { ok: true, error: null }, sourceAccess: { ok: true, error: null, bytesProcessed: 111890909 } };
  const decision = decideJobProjectUpdate('datadem-home', bothPassed);
  assert.equal(decision.shouldWrite, true);
  assert.deepEqual(Object.keys(decision.plan), ['BIGQUERY_JOB_PROJECT_ID']);
  assert.equal(decision.plan.BIGQUERY_JOB_PROJECT_ID, 'datadem-home');
  assert.deepEqual(buildJobProjectUpdatePlan('datadem-home'), { BIGQUERY_JOB_PROJECT_ID: 'datadem-home' });
});
