/**
 * 80_Orchestrator.js
 * Orquesta el ciclo completo (Seccion 18/32): Config -> Snapshot -> BigQuery -> Pairings -> Reglas
 * WB -> Reconciliacion -> Render -> QA -> Escritura -> Historico -> _RUNS. Depende de Apps Script
 * (SpreadsheetApp/BigQuery/LockService/Utilities): no testeable desde Node. Delega TODA la logica
 * de negocio real a los modulos puros ya probados (30-70); este archivo es orquestacion + I/O.
 *
 * Nunca escribe hojas operacionales antes de completar el QA pre-write (Seccion 32/38).
 */

var Orchestrator = {
  /** Carga config+rutas y valida estructura minima. No escribe nada salvo bootstrap de _CONFIG faltante. */
  loadContext: function () {
    var ss = SheetStructure.openProductionSpreadsheet();
    var ensured = ConfigService.ensureDefaults(ss); // solo rellena claves ausentes, nunca sobrescribe
    var config = canonicalizeConfig(ensured.values);
    var routes = normalizeRoutes(ensured.routes);
    var allowedDow = parseAllowedDow(config.ALLOWED_OCCUPIED_DOW);
    var configHash = computeConfigHash(config, routes);
    return { ss: ss, config: config, routes: routes, allowedDow: allowedDow, configHash: configHash };
  },

  /** Diagnostico completo de solo lectura (Seccion 25/26/39). Nunca escribe. */
  runDiagnostics: function () {
    var report = { timestamp: new Date().toISOString() };

    var ctx;
    try {
      ctx = Orchestrator.loadContext();
      report.spreadsheetOpened = true;
      report.spreadsheetId = ctx.ss.getId();
      report.spreadsheetName = ctx.ss.getName();
    } catch (e) {
      report.spreadsheetOpened = false;
      report.error = 'No se pudo abrir el Spreadsheet productivo: ' + e.message;
      return report;
    }

    var activeCtx = null;
    try { activeCtx = SpreadsheetApp.getActiveSpreadsheet(); } catch (e) { /* sin contexto activo: normal fuera de un trigger instalable */ }
    report.boundContext = activeCtx && activeCtx.getId() === ctx.ss.getId()
      ? 'ACTIVO (el menu deberia funcionar en esta sesion)'
      : 'SIN CONTEXTO ACTIVO (normal al correr desde el editor; ver BOUND_SCRIPT_GATE en docs/DECISIONS.md)';

    var configValidation = validateConfig(ctx.config, ctx.routes);
    report.configValid = configValidation.valid;
    report.configErrors = configValidation.errors;
    report.snapshotCertification = ctx.config.SNAPSHOT_CERTIFICATION;

    report.sheetHeaders = {};
    [
      [SHEET_NAMES.RESUMEN, RESUMEN_HEADERS],
      [SHEET_NAMES.DICCIONARIO, DICCIONARIO_HEADERS],
      [SHEET_NAMES.PAIRINGS_DATA, PAIRINGS_DATA_HEADERS],
      [SHEET_NAMES.RUNS, RUNS_HEADERS],
    ].forEach(function (pair) {
      report.sheetHeaders[pair[0]] = SheetStructure.diffHeaders(ctx.ss, pair[0], pair[1]);
    });

    // BigQuery separa DATA project (donde vive la tabla, fijo: operations-data-prod) de JOB
    // project (donde se crea/ejecuta/factura el query job, Seccion 5 del prompt maestro). Se
    // prueban por separado para poder diferenciar un fallo de permiso de creacion de job (IAM
    // en el job project) de un fallo de lectura de la fuente Carmen Gold (IAM en el data project),
    // en vez de colapsar ambos en un unico booleano "BigQuery alcanzable".
    report.dataProject = ctx.config.PROJECT_ID;
    report.jobProject = ctx.config.BIGQUERY_JOB_PROJECT_ID;
    try {
      BigQueryGateway.dryRun(JOB_CREATION_PROBE_SQL, ctx.config.BIGQUERY_JOB_PROJECT_ID);
      report.jobCreationOk = true;
      report.jobCreationError = null;
    } catch (e) {
      report.jobCreationOk = false;
      report.jobCreationError = e.message;
    }

    if (report.jobCreationOk) {
      try {
        var dry = BigQueryGateway.dryRun(buildDiscoverySql(ctx.config), ctx.config.BIGQUERY_JOB_PROJECT_ID);
        report.sourceAccessOk = true;
        report.sourceAccessError = null;
        report.bigQueryEstimatedBytes = dry.totalBytesProcessed;
      } catch (e) {
        report.sourceAccessOk = false;
        report.sourceAccessError = e.message;
      }
    } else {
      report.sourceAccessOk = false;
      report.sourceAccessError = 'No probado: fallo la creacion de job en el job project configurado.';
    }
    // Retrocompatibilidad: "alcanzable" = ambas pruebas pasaron.
    report.bigQueryReachable = report.jobCreationOk && report.sourceAccessOk;
    report.bigQueryError = report.jobCreationError || report.sourceAccessError || null;

    report.lastRun = AuditService.readLastRun(ctx.ss);

    return report;
  },

  /** Flujo A (Seccion 12): descubre snapshots candidatos para el mes configurado. No certifica nada. */
  discoverSnapshots: function () {
    var ctx = Orchestrator.loadContext();
    var validation = validateConfig(ctx.config, ctx.routes);
    if (!validation.valid) throw new Error('Configuracion invalida: ' + validation.errors.join(' | '));

    var sql = buildDiscoverySql(ctx.config);
    var result = BigQueryGateway.runQuery(sql, ctx.config.BIGQUERY_JOB_PROJECT_ID, { maximumBytesBilled: ctx.config.MAXIMUM_BYTES_BILLED });
    // BQ_DISCOVERY_FIELDS (10 columnas agregadas), NUNCA el default BQ_REQUIRED_FIELDS (84
    // columnas leg-level): buildDiscoverySql() es un GROUP BY, no un result set leg-level. Pasar
    // el default aqui producia SCHEMA_ERROR apenas el permiso de IAM se desbloqueara (bug latente).
    var candidates = parseRowsWithSchema(result.schema.fields, result.rows, BQ_DISCOVERY_FIELDS);
    var selection = selectSnapshotCandidate(candidates);

    return { candidates: candidates, selection: selection, jobId: result.jobId, bytesProcessed: result.totalBytesProcessed };
  },

  /** Flujo B (Seccion 12): certifica una identidad de carga exacta, elegida explicitamente por el usuario. */
  certifySnapshot: function (loadIdentity) {
    var ctx = Orchestrator.loadContext();
    ConfigService.writeSnapshotCertification(ctx.ss, loadIdentity);
    return { certified: true, loadIdentity: loadIdentity };
  },

  /**
   * Prueba NO DESTRUCTIVA (solo dry run: nunca ejecuta ni factura un job real) de un proyecto de
   * ejecucion BigQuery candidato (Seccion 5 del prompt maestro). Dos pruebas independientes:
   *   1. jobCreation: permiso bigquery.jobs.create en el candidato (SQL trivial, sin tocar la fuente).
   *   2. sourceAccess: dry run del SQL de descubrimiento REAL contra la fuente Carmen Gold fija,
   *      pero ejecutado bajo el candidato. Solo se intenta si (1) paso.
   * Nunca escribe _CONFIG. Nunca toca PROJECT_ID/DATASET_ID/TABLE_ID (fqTable() los usa tal cual
   * estan en ctx.config, sin importar el candidato de job project).
   */
  testJobProject: function (candidateJobProjectId) {
    var ctx = Orchestrator.loadContext();
    var report = {
      dataProject: ctx.config.PROJECT_ID,
      currentJobProject: ctx.config.BIGQUERY_JOB_PROJECT_ID,
      candidateJobProject: candidateJobProjectId,
    };

    try {
      BigQueryGateway.dryRun(JOB_CREATION_PROBE_SQL, candidateJobProjectId);
      report.jobCreation = { ok: true, error: null };
    } catch (e) {
      report.jobCreation = { ok: false, error: e.message };
      report.sourceAccess = { ok: false, error: 'No probado: fallo la creacion de job.', bytesProcessed: null };
      report.decision = decideJobProjectUpdate(candidateJobProjectId, report);
      return report;
    }

    try {
      var sourceDry = BigQueryGateway.dryRun(buildDiscoverySql(ctx.config), candidateJobProjectId);
      report.sourceAccess = { ok: true, error: null, bytesProcessed: sourceDry.totalBytesProcessed };
    } catch (e) {
      report.sourceAccess = { ok: false, error: e.message, bytesProcessed: null };
    }

    report.decision = decideJobProjectUpdate(candidateJobProjectId, report);
    return report;
  },

  /**
   * Aplica el plan de actualizacion de BIGQUERY_JOB_PROJECT_ID. El llamador (99_EntryPoints.js) es
   * responsable de solo invocar esto tras testJobProject() con decision.shouldWrite=true Y
   * confirmacion explicita del usuario (Seccion 5.5-5.6 del prompt maestro). Nunca certifica
   * snapshot, nunca toca ninguna otra clave de _CONFIG.
   */
  applyJobProject: function (candidateJobProjectId) {
    var ctx = Orchestrator.loadContext();
    var plan = buildJobProjectUpdatePlan(candidateJobProjectId);
    ConfigService.writeValues(ctx.ss, plan);
    return { applied: true, plan: plan };
  },

  /** Ejecuta el pipeline completo. dryRun=true nunca escribe hojas operacionales. */
  runPipeline: function (dryRun) {
    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      throw new Error('Ya hay un calculo de Pairings WB en curso. Intente nuevamente en unos minutos.');
    }

    var startedAt = new Date();
    var runId = 'RUN-' + Utilities.getUuid();

    try {
      var ctx = Orchestrator.loadContext();
      var qa = [];

      var configValidation = validateConfig(ctx.config, ctx.routes);
      qa.push({ code: 'Q1', passed: configValidation.valid, detail: configValidation.errors.join(' | ') });
      qa.push(QaService.q2RulesetCompatible(ctx.config));
      qa.push(QaService.q3SnapshotCertified(ctx.config, dryRun));
      failFastIfBlocked(qa, ['Q1', 'Q2', 'Q3']);

      var loadIdentity = {
        load_key_id: ctx.config.LOAD_KEY_ID, load_type_code: ctx.config.LOAD_TYPE_CODE,
        load_version_id: ctx.config.LOAD_VERSION_ID, ingestion_datetime: ctx.config.INGESTION_DATETIME,
      };

      var sql = buildCertifiedLegSql(ctx.config, loadIdentity);
      qa.push(QaService.q5PartitionFilter(sql));
      qa.push(QaService.q6ReadOnly(sql));
      qa.push(QaService.q7NoSelectStar(sql));
      failFastIfBlocked(qa, ['Q5', 'Q6', 'Q7']);

      var bqResult = BigQueryGateway.runQuery(sql, ctx.config.BIGQUERY_JOB_PROJECT_ID, { maximumBytesBilled: ctx.config.MAXIMUM_BYTES_BILLED });
      qa.push(QaService.q4RequiredColumns(bqResult.schema.fields));
      failFastIfBlocked(qa, ['Q4']);

      var rows = parseRowsWithSchema(bqResult.schema.fields, bqResult.rows);
      qa.push(QaService.q17DateShiftsZero(buildDateRoundTripSamples(rows)));

      var snapshotContext = buildSnapshotContext(ctx.config, loadIdentity);
      var snapshotKey = computeSnapshotKey(snapshotContext);

      var pairings = assemblePairings(rows, snapshotKey);
      var evaluated = pairings.map(function (p) {
        return Object.assign({}, p, evaluateWbRules(p, ctx.config, ctx.routes, ctx.allowedDow));
      });

      qa.push(QaService.q13MultiplicitiesPreserved(rows.length, evaluated));
      qa.push(QaService.q15UnknownRoutesReview(evaluated, ctx.routes.map(function (r) { return r.code; })));

      // pairingsDataContext/pairingsDataRendered se calculan aqui (no solo en publish) para que Q14
      // corra tambien en preview: es una operacion pura en memoria, sin costo de escribir nada.
      var pairingsDataContext = Object.assign({}, snapshotContext, { snapshot_key: snapshotKey });
      var pairingsDataRendered = PairingsDataRenderer.build(evaluated, pairingsDataContext);
      qa.push(QaService.q14PairingsDataSchemaCompatible(pairingsDataRendered.headers));

      var baseline = SheetStructure.readResumenRows(ctx.ss).rows;
      var diccionario = SheetStructure.readDiccionario(ctx.ss);
      var summary = SummaryRenderer.build(evaluated, baseline, diccionario, generateAssignmentId);

      qa.push(QaService.q8NoHumanDataChangedInDryRun(baseline, summary.reconciliation.rows));
      qa.push(QaService.q9AssignmentIdUnique(summary.reconciliation.rows));
      qa.push(QaService.q10NoPikAsHumanPk(summary.reconciliation.rows));
      qa.push(QaService.q11NoInsLoss(baseline, summary.reconciliation.rows));
      qa.push(QaService.q12NoActLoss(baseline, summary.reconciliation.rows));

      var pairingsEligible = evaluated.filter(function (p) { return p.eligibility_status === ELIGIBILITY_STATUS.ELIGIBLE; }).length;
      var pairingsReview = evaluated.length - pairingsEligible;

      var preWriteFailures = qa.filter(function (c) { return !c.passed; });

      var result = {
        runId: runId, dryRun: dryRun, snapshotKey: snapshotKey, loadIdentity: loadIdentity,
        bqJobId: bqResult.jobId, bqBytesProcessed: bqResult.totalBytesProcessed,
        legsReceived: rows.length, pairingsReceived: evaluated.length,
        pairingsEligible: pairingsEligible, pairingsReview: pairingsReview,
        assignmentsPreserved: summary.reconciliation.counts.preserved,
        assignmentsRelinked: summary.reconciliation.counts.relinked,
        assignmentsOrphaned: summary.reconciliation.counts.orphaned,
        contentChangesDetected: summary.reconciliation.counts.reviewChanged,
        assignmentsCreated: summary.reconciliation.counts.created,
        qa: qa, qaPassed: preWriteFailures.length === 0,
      };

      if (preWriteFailures.length > 0) {
        result.status = 'QA_FAILED';
        recordRun(ctx.ss, runId, startedAt, new Date(), 'QA_FAILED', ctx, snapshotKey, loadIdentity, bqResult, result, dryRun ? 'PREVIEW' : 'PUBLISH', null, null);
        return result;
      }

      if (dryRun) {
        result.status = 'PREVIEW_OK';
        recordRun(ctx.ss, runId, startedAt, new Date(), 'PREVIEW_OK', ctx, snapshotKey, loadIdentity, bqResult, result, 'PREVIEW', null, null);
        return result;
      }

      // --- Publicacion real: a partir de aqui SI se escribe. ---
      // pairingsDataRendered ya se calculo mas arriba (para que Q14 corriera tambien en preview).
      var flightsRendered = FlightsRenderer.build(summary.reconciliation.rows);
      var scheduleGrid = ScheduleRenderer.build(summary.reconciliation.rows, ctx.config);

      var resumenSheet = SheetStructure.getOrCreateSheet(ctx.ss, SHEET_NAMES.RESUMEN);
      SheetStructure.writeResumenMatrix(resumenSheet, summary.matrix);

      var pairingsDataSheet = SheetStructure.getOrCreateSheet(ctx.ss, SHEET_NAMES.PAIRINGS_DATA);
      PairingsDataRenderer.writeToSheet(pairingsDataSheet, pairingsDataRendered);

      var vuelosSheet = SheetStructure.getOrCreateSheet(ctx.ss, SHEET_NAMES.VUELOS);
      FlightsRenderer.writeToSheet(vuelosSheet, flightsRendered);

      var cronogramaSheet = SheetStructure.getOrCreateSheet(ctx.ss, SHEET_NAMES.CRONOGRAMA);
      ScheduleRenderer.writeToSheet(cronogramaSheet, scheduleGrid);

      SheetStructure.hideTechnicalSheets(ctx.ss);
      SpreadsheetApp.flush();

      // QA post-write: releer y re-verificar sobre el estado FISICO ya escrito.
      var reread = SheetStructure.readResumenRows(ctx.ss).rows;
      var postQa = [
        QaService.q11NoInsLoss(baseline, reread),
        QaService.q12NoActLoss(baseline, reread),
        QaService.q9AssignmentIdUnique(reread),
        QaService.q18q19q20FormulaErrors(resumenSheet.getDataRange().getValues()),
      ];
      result.postWriteQa = postQa;
      var postFailures = postQa.filter(function (c) { return !c.passed; });

      var historyInfo = null;
      if (postFailures.length === 0 && String(ctx.config.AUTO_ARCHIVE_ON_SUCCESS).toUpperCase() === 'TRUE') {
        var historyKey = computeHistoryKey({
          schema_version: SCHEMA_VERSION, ruleset_id: RULESET_ID,
          reference_year: ctx.config.REFERENCE_YEAR, reference_month: ctx.config.REFERENCE_MONTH,
          snapshot_key: snapshotKey, config_hash: ctx.configHash, query_version: QUERY_VERSION,
        });
        historyInfo = HistoryService.getOrCreate(ctx.ss.getId(), ctx.config.REFERENCE_YEAR, ctx.config.REFERENCE_MONTH, historyKey);
        historyInfo.historyKey = historyKey;
      }

      result.status = postFailures.length === 0 ? 'PUBLISHED' : 'PUBLISHED_WITH_QA_WARNINGS';
      result.historyInfo = historyInfo;

      recordRun(ctx.ss, runId, startedAt, new Date(), result.status, ctx, snapshotKey, loadIdentity, bqResult, result, 'PUBLISH', historyInfo, null);

      return result;
    } catch (err) {
      try {
        var ctxForError = Orchestrator.loadContext();
        recordRun(ctxForError.ss, runId, startedAt, new Date(), 'ERROR', ctxForError, null, null, null, {}, dryRun ? 'PREVIEW' : 'PUBLISH', null, err);
      } catch (e2) { /* si ni siquiera se pudo abrir el spreadsheet, no hay donde registrar el run */ }
      throw err;
    } finally {
      lock.releaseLock();
    }
  },

  runQaOnly: function () {
    var ctx = Orchestrator.loadContext();
    var baseline = SheetStructure.readResumenRows(ctx.ss).rows;
    return [
      QaService.q1ConfigValid(ctx.config, ctx.routes),
      QaService.q2RulesetCompatible(ctx.config),
      QaService.q3SnapshotCertified(ctx.config, true),
      QaService.q9AssignmentIdUnique(baseline),
      QaService.q10NoPikAsHumanPk(baseline),
    ];
  },
};

/**
 * Q17 (Seccion 38): verifica sobre datos REALES recibidos de BigQuery que las fechas DATE
 * (formato 'YYYY-MM-DD') sobrevivan un roundtrip parse->format sin drift. Es la misma logica que
 * cubren los tests de 05_DateUtil.js, pero aplicada a la fuente viva en cada corrida, no solo a
 * fixtures sinteticos.
 */
function buildDateRoundTripSamples(rows) {
  var dateFields = ['pairing_start_date', 'pairing_end_date', 'flight_start_date_local_time', 'duty_presentation_date_at', 'duty_end_date_home_base_timezone'];
  var pairs = [];
  rows.forEach(function (r) {
    dateFields.forEach(function (f) {
      var original = r[f];
      if (!original) return;
      var parsed = duParseDate(original);
      pairs.push({ originalIso: original, roundTrippedIso: parsed ? duFormatIso(parsed) : 'PARSE_FALLIDO' });
    });
  });
  return pairs;
}

function failFastIfBlocked(qaList, codes) {
  var relevant = qaList.filter(function (c) { return codes.indexOf(c.code) !== -1; });
  var failed = relevant.filter(function (c) { return !c.passed; });
  if (failed.length > 0) {
    var msg = failed.map(function (c) { return c.code + ': ' + c.detail; }).join(' | ');
    throw new Error('QA_GATE_BLOCKED: ' + msg);
  }
}

function generateAssignmentId() {
  return 'ASG-' + Utilities.getUuid();
}

/** `0` es un conteo valido (p.ej. 0 legs, 0 huerfanas): nunca usar `|| ''`, que lo confundiria con ausente. */
function orBlank(v) {
  return v === undefined || v === null ? '' : v;
}

function recordRun(ss, runId, startedAt, finishedAt, status, ctx, snapshotKey, loadIdentity, bqResult, result, runType, historyInfo, err) {
  var effectiveUser = '';
  try { effectiveUser = Session.getEffectiveUser().getEmail(); } catch (e) { /* puede no estar disponible segun autorizacion */ }

  AuditService.appendRun(ss, {
    run_id: runId, started_at: startedAt.toISOString(), finished_at: finishedAt.toISOString(),
    effective_user: effectiveUser, status: status,
    schema_version: SCHEMA_VERSION, config_hash: ctx ? ctx.configHash : '', query_version: QUERY_VERSION,
    reference_year: ctx ? ctx.config.REFERENCE_YEAR : '', reference_month: ctx ? ctx.config.REFERENCE_MONTH : '',
    snapshot_key: orBlank(snapshotKey), load_key_id: loadIdentity ? loadIdentity.load_key_id : '',
    load_type_code: loadIdentity ? loadIdentity.load_type_code : '', load_version_id: loadIdentity ? loadIdentity.load_version_id : '',
    ingestion_datetime: loadIdentity ? loadIdentity.ingestion_datetime : '',
    bq_job_id: bqResult ? bqResult.jobId : '',
    legs_received: orBlank(result.legsReceived), pairings_received: orBlank(result.pairingsReceived),
    pairings_eligible: orBlank(result.pairingsEligible), pairings_review: orBlank(result.pairingsReview),
    assignments_preserved: orBlank(result.assignmentsPreserved), assignments_relinked: orBlank(result.assignmentsRelinked),
    assignments_orphaned: orBlank(result.assignmentsOrphaned), content_changes_detected: orBlank(result.contentChangesDetected),
    duration_ms: finishedAt.getTime() - startedAt.getTime(),
    error_code: err ? 'ERROR' : '', error_message: err ? String(err.message || err) : '',
    run_type: runType, history_status: historyInfo ? (historyInfo.created ? 'CREATED' : 'REUSED') : '',
    history_file_id: historyInfo ? historyInfo.fileId : '', history_key: historyInfo ? historyInfo.historyKey : '',
    query_bytes_processed: orBlank(bqResult ? bqResult.totalBytesProcessed : ''),
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { Orchestrator: Orchestrator };
}
