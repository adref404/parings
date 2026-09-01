/**
 * 99_EntryPoints.js
 * Funciones colgadas del menu "Pairings WB" (90_Menu.js). Cada una: try/catch, mensajes
 * accionables (Seccion 39, nunca un "Error" generico), y confirmacion explicita SOLO para
 * acciones destructivas (escribir hojas operacionales). Toda la logica real vive en Orchestrator
 * y en los modulos puros; aqui solo se formatea entrada/salida de UI.
 */

/**
 * Diagnostico headless (sin SpreadsheetApp.getUi()): pensado para invocarse via `clasp run` o la
 * API de ejecucion de Apps Script (Seccion 47), donde no existe contexto de UI. Devuelve un objeto
 * JSON-serializable identico al que consume wbMenuDiagnostico.
 */
function wbDiagnosticoHeadless() {
  return Orchestrator.runDiagnostics();
}

// ---------------------------------------------------------------------------------------------
// Experiencia de USUARIO FINAL (menu de nivel superior "Pairings WB"): lenguaje operacional, sin
// mencionar BigQuery/snapshot/load_key/ingestion_datetime/job project/schema/hash/_CONFIG/_RUNS/
// QA. Cualquier incidencia administrativa se muestra como humanFriendlyBlockedMessage_(), nunca
// como traceback tecnico. Toda la logica real sigue viviendo en Orchestrator; estas funciones solo
// formatean entrada/salida.
// ---------------------------------------------------------------------------------------------

var MONTH_NAMES_ES_ = [
  'enero', 'febrero', 'marzo', 'abril', 'mayo', 'junio',
  'julio', 'agosto', 'septiembre', 'octubre', 'noviembre', 'diciembre',
];

function capitalize_(s) {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

/** "2026"/"9" -> "Septiembre 2026". Si el mes no calza, degrada a "mes 9 2026" en vez de fallar. */
function humanPeriodLabel_(year, month) {
  var idx = parseInt(month, 10) - 1;
  var name = MONTH_NAMES_ES_[idx];
  return (name ? capitalize_(name) : ('mes ' + month)) + ' ' + year;
}

/** Mensaje de bloqueo para el usuario final: nunca expone load_key/BigQuery/hash/traceback. */
function humanFriendlyBlockedMessage_(periodLabel) {
  return 'No se puede actualizar ' + (periodLabel || 'este mes') + ' todavía.\n\n' +
    'La preparación técnica del mes requiere revisión de un administrador.\n' +
    'Use Pairings WB > Administración.';
}

/**
 * Resumen humano de un resultado de Orchestrator.runPipeline (preview o publicacion), en el
 * formato pedido por la mision: cuenta como "conservadas" tanto ACTIVE (mismo snapshot) como
 * RELINKED_IDENTICAL (snapshot nuevo, contenido identico) — ambas preservan assignment_id/INS/ACT
 * sin necesitar revision humana — y como "requieren revisión" tanto REVIEW_SOURCE_CHANGED como
 * ORPHANED_SOURCE_MISSING, los dos estados que si la necesitan.
 */
function buildHumanUpdateSummary_(r, periodLabel) {
  var conserved = (r.assignmentsPreserved || 0) + (r.assignmentsRelinked || 0);
  var needsReview = (r.contentChangesDetected || 0) + (r.assignmentsOrphaned || 0);
  return [
    periodLabel,
    '',
    r.pairingsEligible + ' pairings disponibles',
    conserved + ' asignaciones actuales se conservarán',
    r.assignmentsCreated + ' pairings nuevos',
    needsReview + ' requieren revisión',
    '',
    'No se eliminará ninguna asignación de instructor.',
  ].join('\n');
}

/** true si el resultado de runPipeline esta en condiciones de publicarse sin problemas. */
function isCleanForPublish_(r) {
  return !!r.qaPassed && !(r.publishGate && r.publishGate.blocked);
}

/**
 * "Actualizar Pairings WB": el flujo normal para el usuario final (mision <end_user_experience>).
 * Comprueba silenciosamente configuración/snapshot/baseline (via el preview + gates existentes),
 * ejecuta una previsualización, muestra un resumen humano, pide confirmación, y publica SOLO si
 * todos los gates pasan. Ninguna incidencia tecnica se muestra cruda al usuario final.
 */
function wbMenuActualizarPairingsWB() {
  var ui = SpreadsheetApp.getUi();

  var ctx;
  try {
    ctx = Orchestrator.loadContext();
  } catch (e) {
    ui.alert('Pairings WB', humanFriendlyBlockedMessage_(), ui.ButtonSet.OK);
    return;
  }
  var periodLabel = humanPeriodLabel_(ctx.config.REFERENCE_YEAR, ctx.config.REFERENCE_MONTH);

  var preview;
  try {
    preview = Orchestrator.runPipeline(true);
  } catch (e) {
    ui.alert('Pairings WB', humanFriendlyBlockedMessage_(periodLabel), ui.ButtonSet.OK);
    return;
  }
  if (!isCleanForPublish_(preview)) {
    ui.alert('Pairings WB', humanFriendlyBlockedMessage_(periodLabel), ui.ButtonSet.OK);
    return;
  }

  var confirmMsg = buildHumanUpdateSummary_(preview, periodLabel) + '\n\n¿Desea actualizar Pairings WB?';
  var confirm = ui.alert('Pairings WB', confirmMsg, ui.ButtonSet.YES_NO);
  if (confirm !== ui.Button.YES) return;

  var result;
  try {
    result = Orchestrator.runPipeline(false);
  } catch (e) {
    ui.alert('Pairings WB', humanFriendlyBlockedMessage_(periodLabel), ui.ButtonSet.OK);
    return;
  }
  if (result.status !== 'PUBLISHED' && result.status !== 'PUBLISHED_WITH_QA_WARNINGS') {
    ui.alert('Pairings WB', humanFriendlyBlockedMessage_(periodLabel), ui.ButtonSet.OK);
    return;
  }
  ui.alert('Pairings WB', 'Pairings WB de ' + periodLabel + ' actualizado correctamente.\n\n' + buildHumanUpdateSummary_(result, periodLabel), ui.ButtonSet.OK);
}

/**
 * "Previsualizar cambios": mismo pipeline dry-run que "Actualizar Pairings WB" pero con resumen
 * humano y SIN pedir confirmacion ni publicar nunca (mision <end_user_experience> #2).
 */
function wbMenuPrevisualizarCambios() {
  var ui = SpreadsheetApp.getUi();

  var ctx;
  try {
    ctx = Orchestrator.loadContext();
  } catch (e) {
    ui.alert('Pairings WB', humanFriendlyBlockedMessage_(), ui.ButtonSet.OK);
    return;
  }
  var periodLabel = humanPeriodLabel_(ctx.config.REFERENCE_YEAR, ctx.config.REFERENCE_MONTH);

  var preview;
  try {
    preview = Orchestrator.runPipeline(true);
  } catch (e) {
    ui.alert('Pairings WB', humanFriendlyBlockedMessage_(periodLabel), ui.ButtonSet.OK);
    return;
  }

  var msg = buildHumanUpdateSummary_(preview, periodLabel);
  if (!isCleanForPublish_(preview)) {
    msg += '\n\nNota: la publicación real todavía requiere revisión de un administrador (Pairings WB > Administración).';
  }
  msg += '\n\nEsto es solo una previsualización: no se escribió ningún cambio.';
  ui.alert('Previsualizar cambios', msg, ui.ButtonSet.OK);
}

/**
 * "Ver estado del mes" (mision <end_user_experience> #3): barato, NUNCA ejecuta BigQuery. Solo lee
 * _CONFIG/RESUMEN/_RUNS (ya presentes en el Spreadsheet) para responder si el mes esta listo.
 */
function wbMenuVerEstadoDelMes() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ctx = Orchestrator.loadContext();
    var periodLabel = humanPeriodLabel_(ctx.config.REFERENCE_YEAR, ctx.config.REFERENCE_MONTH);
    var baseline = SheetStructure.readResumenRows(ctx.ss).rows.filter(function (r) { return r.assignment_id; });

    var configValidation = validateConfig(ctx.config, ctx.routes);
    var certified = ctx.config.SNAPSHOT_CERTIFICATION === SNAPSHOT_CERTIFICATION.CERTIFIED;
    var gate = evaluatePublishGate(baseline);
    var ready = configValidation.valid && certified && !gate.blocked;

    var lastRun = AuditService.readLastRun(ctx.ss);
    var lastSuccess = (lastRun && (lastRun.status === 'PUBLISHED' || lastRun.status === 'PUBLISHED_WITH_QA_WARNINGS'))
      ? lastRun.finished_at : null;

    var pendingReview = baseline.filter(function (r) { return r.assignment_status === ASSIGNMENT_STATUS.REVIEW_SOURCE_CHANGED; }).length;

    var lines = [
      periodLabel,
      '',
      'Preparación del mes: ' + (ready ? 'Lista' : 'Requiere administración'),
      'Última actualización exitosa: ' + (lastSuccess || 'Aún no hay actualizaciones publicadas'),
      'Cantidad actual de asignaciones: ' + baseline.length,
      'Revisión pendiente: ' + (pendingReview > 0 ? ('Sí (' + pendingReview + ')') : 'No'),
    ];
    ui.alert('Ver estado del mes', lines.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Ver estado del mes', 'No se pudo obtener el estado del mes en este momento.\nUse Pairings WB > Administración > Diagnóstico del sistema.', ui.ButtonSet.OK);
  }
}

/**
 * "Ir a RESUMEN" (mision <end_user_experience> #4): valida SIEMPRE EXPECTED_SPREADSHEET_ID antes
 * de actuar, para nunca activar una hoja en el Spreadsheet equivocado.
 */
function wbMenuIrAResumen() {
  var ui = SpreadsheetApp.getUi();
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (!active || active.getId() !== WB_KNOWN.EXPECTED_SPREADSHEET_ID) {
      ui.alert('Pairings WB', 'No se pudo ir a RESUMEN: este menú debe ejecutarse desde el Spreadsheet "Pairings WB" correcto.', ui.ButtonSet.OK);
      return;
    }
    var sheet = active.getSheetByName(SHEET_NAMES.RESUMEN);
    if (!sheet) {
      ui.alert('Pairings WB', 'La hoja RESUMEN no existe todavía. Use "Actualizar Pairings WB" primero.', ui.ButtonSet.OK);
      return;
    }
    sheet.activate();
  } catch (e) {
    ui.alert('Ir a RESUMEN — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

/**
 * "Guía de uso y administración" (mision <admin_help>): sidebar HtmlService, sin framework ni
 * asset externo. El contenido puro vive en buildGuiaHtmlContent_ (90_Menu.js) para poder testearse
 * en Node; aqui solo se envuelve en HtmlOutput y se muestra.
 */
function wbMenuGuiaDeUso() {
  var ui = SpreadsheetApp.getUi();
  try {
    var html = HtmlService.createHtmlOutput(buildGuiaHtmlContent_())
      .setTitle('Pairings WB — Guía')
      .setWidth(360);
    ui.showSidebar(html);
  } catch (e) {
    ui.alert('Guía de uso y administración — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

/**
 * Administración > Fuente de datos > "Comparar snapshot con RESUMEN actual" (mision
 * <new_diagnostic>): diagnostico tecnico DRY-RUN, salida detallada para uso administrativo (a
 * diferencia de las opciones de usuario final, aqui SI se muestran IDs/hash porque la audiencia es
 * un administrador resolviendo el gate de baseline legacy).
 */
function wbMenuCompararSnapshotConResumen() {
  var ui = SpreadsheetApp.getUi();
  try {
    var report = Orchestrator.compareBaselineWithSnapshot();
    var s = report.summary;
    var lines = [
      'Snapshot: ' + report.snapshotKey,
      'BigQuery job: ' + report.bqJobId + ' (' + report.bqBytesProcessed + ' bytes)',
      '',
      'Asignaciones baseline: ' + s.assignmentsBaseline,
      'Pairing IDs únicos baseline: ' + s.pairingIdsUniqueBaseline,
      'Con vinculación técnica ausente (legacy-unlinked): ' + s.legacyTechnicalLinkageMissing,
      '',
      'Presentes en snapshot actual: ' + s.pairingIdsPresent,
      'Ausentes del snapshot actual: ' + s.pairingIdsAbsent,
      '',
      'Coincidencia visible exacta (Fecha/Vuelo/Ruta/Inicio/Fin): ' + s.visibleExact,
      'Coincidencia visible parcial: ' + s.visiblePartial,
      'Contenido visible distinto: ' + s.visibleDistinct,
      '',
      'Hash actual igual al legacy: ' + s.hashSame,
      'Hash actual distinto al legacy: ' + s.hashDifferent,
    ];
    if (report.absentPairingIds.length) lines.push('', 'Ausentes: ' + report.absentPairingIds.join(', '));
    if (report.visibleExactHashDifferentPairingIds.length) {
      lines.push('', 'Visible IGUAL pero hash distinto (indicio de incompatibilidad de contrato de hash legacy): ' + report.visibleExactHashDifferentPairingIds.join(', '));
    }
    if (report.visibleDistinctPairingIds.length) lines.push('', 'Visible DISTINTO (cambio real de contenido): ' + report.visibleDistinctPairingIds.join(', '));
    lines.push('', 'Esto fue un DRY RUN de solo lectura: no se modificó snapshot, RESUMEN, hashes ni assignment_id.');
    ui.alert('Comparar snapshot con RESUMEN actual', lines.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Comparar snapshot con RESUMEN actual — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

function wbMenuDiagnostico() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = Orchestrator.runDiagnostics();
    var lines = [];
    lines.push('Spreadsheet: ' + (r.spreadsheetOpened ? (r.spreadsheetName + ' (' + r.spreadsheetId + ')') : 'NO SE PUDO ABRIR'));
    if (!r.spreadsheetOpened) { ui.alert('Diagnóstico del sistema', 'Spreadsheet: ' + r.error, ui.ButtonSet.OK); return; }
    lines.push('Contexto de menú: ' + r.boundContext);
    lines.push('Config válida: ' + (r.configValid ? 'SI' : 'NO — ' + r.configErrors.join(' | ')));
    lines.push('Snapshot certificado: ' + r.snapshotCertification);
    Object.keys(r.sheetHeaders).forEach(function (name) {
      var h = r.sheetHeaders[name];
      lines.push('Hoja ' + name + ': ' + (!h.exists ? 'NO EXISTE (se creará al calcular)' : (h.matches ? 'OK' : 'DIFIERE, faltan: ' + h.missing.join(', '))));
    });
    lines.push('BigQuery — data project (fuente, fijo): ' + r.dataProject);
    lines.push('BigQuery — job project (ejecución/facturación): ' + r.jobProject);
    lines.push('BigQuery — creación de job (bigquery.jobs.create): ' + (r.jobCreationOk ? 'OK' : 'FAIL — ' + r.jobCreationError));
    lines.push('BigQuery — acceso a fuente Carmen Gold: ' + (r.sourceAccessOk ? ('OK (≈' + r.bigQueryEstimatedBytes + ' bytes estimados)') : ('FAIL — ' + r.sourceAccessError)));
    lines.push('Último run: ' + (r.lastRun ? (r.lastRun.run_id + ' / ' + r.lastRun.status + ' / ' + r.lastRun.finished_at) : 'ninguno registrado aún'));
    ui.alert('Diagnóstico del sistema', lines.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Diagnóstico del sistema — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

function wbMenuVerConfiguracion() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ctx = Orchestrator.loadContext();
    var lines = Object.keys(ctx.config).sort().map(function (k) { return k + ' = ' + ctx.config[k]; });
    lines.push('');
    lines.push('Rutas:');
    ctx.routes.forEach(function (r) { lines.push('  ' + r.priority + '. ' + r.code + ' (' + r.role + ')'); });
    lines.push('');
    lines.push('config_hash = ' + ctx.configHash);
    ui.alert('Configuración actual', lines.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Ver configuración — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

function wbMenuConfigurarAnioMes() {
  var ui = SpreadsheetApp.getUi();
  try {
    var resp = ui.prompt('Configurar año y mes', 'Ingrese el periodo en formato AAAA-MM (ej: 2026-09):', ui.ButtonSet.OK_CANCEL);
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    var m = /^(\d{4})-(\d{1,2})$/.exec(resp.getResponseText().trim());
    if (!m) { ui.alert('Formato inválido. Use AAAA-MM, por ejemplo 2026-09.'); return; }
    var year = m[1], month = String(parseInt(m[2], 10));

    var ctx = Orchestrator.loadContext();
    // Cambiar de mes invalida cualquier certificacion previa (es especifica de un mes): se resetea
    // explicitamente a PENDING en vez de arrastrar una certificacion que ya no corresponde.
    ConfigService.writeValues(ctx.ss, {
      REFERENCE_YEAR: year, REFERENCE_MONTH: month,
      LOAD_KEY_ID: 'PENDING_CERTIFICATION', LOAD_TYPE_CODE: 'PENDING_CERTIFICATION',
      LOAD_VERSION_ID: 'PENDING_CERTIFICATION', INGESTION_DATETIME: 'PENDING_CERTIFICATION',
      SNAPSHOT_CERTIFICATION: SNAPSHOT_CERTIFICATION.PENDING,
    });
    ui.alert('Periodo actualizado a ' + year + '-' + month + '. La certificación de snapshot se reinició a PENDING: use "Detectar snapshots del mes" y "Certificar snapshot" antes de calcular.');
  } catch (e) {
    ui.alert('Configurar año y mes — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

function wbMenuDetectarSnapshots() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = Orchestrator.discoverSnapshots();
    if (r.candidates.length === 0) {
      ui.alert('Detectar snapshots', 'No se encontraron cargas compatibles para el periodo/config actual en Carmen Gold.', ui.ButtonSet.OK);
      return;
    }
    var lines = r.candidates.map(function (c, i) {
      return (i + 1) + '. load_key=' + c.load_key_id + ' tipo=' + c.load_type_code + ' version=' + c.load_version_id +
        ' ingestion=' + c.ingestion_datetime + ' fleet=' + c.fleet_type_code + '/' + c.subfleet_code +
        ' legs=' + c.leg_count + ' pairings=' + c.pairing_count +
        ' rango=' + c.min_pairing_start_date + '..' + c.max_pairing_start_date;
    });
    var header = r.selection.autoSelectable
      ? 'Hay exactamente 1 candidato compatible (puede certificarse directamente):'
      : 'Hay ' + r.candidates.length + ' candidatos: elija cuál certificar con "Certificar snapshot".';
    ui.alert('Detectar snapshots del mes', header + '\n\n' + lines.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Detectar snapshots — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

function wbMenuCertificarSnapshot() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = Orchestrator.discoverSnapshots();
    if (r.candidates.length === 0) {
      ui.alert('No hay candidatos para certificar. Ejecute primero "Detectar snapshots del mes".');
      return;
    }
    var chosen;
    if (r.candidates.length === 1) {
      var confirm = ui.alert('Certificar snapshot', 'Se certificará:\n' + r.candidates[0].load_key_id + ' / ' + r.candidates[0].ingestion_datetime + '\n\n¿Confirmar?', ui.ButtonSet.YES_NO);
      if (confirm !== ui.Button.YES) return;
      chosen = r.candidates[0];
    } else {
      var lines = r.candidates.map(function (c, i) { return (i + 1) + '. ' + c.load_key_id + ' / ' + c.ingestion_datetime + ' (legs=' + c.leg_count + ')'; });
      var resp = ui.prompt('Certificar snapshot', 'Hay ' + r.candidates.length + ' candidatos. Ingrese el número a certificar:\n' + lines.join('\n'), ui.ButtonSet.OK_CANCEL);
      if (resp.getSelectedButton() !== ui.Button.OK) return;
      var idx = parseInt(resp.getResponseText().trim(), 10) - 1;
      if (isNaN(idx) || idx < 0 || idx >= r.candidates.length) { ui.alert('Número inválido.'); return; }
      chosen = r.candidates[idx];
    }
    Orchestrator.certifySnapshot({
      load_key_id: chosen.load_key_id, load_type_code: chosen.load_type_code,
      load_version_id: chosen.load_version_id, ingestion_datetime: chosen.ingestion_datetime,
    });
    ui.alert('Snapshot certificado: ' + chosen.load_key_id + ' (' + chosen.ingestion_datetime + '). Ya puede usar "Previsualizar cambios" o "Actualizar Pairings WB".');
  } catch (e) {
    ui.alert('Certificar snapshot — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

function wbMenuProbarConsulta() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ctx = Orchestrator.loadContext();
    var sql = buildDiscoverySql(ctx.config);
    var dry = BigQueryGateway.dryRun(sql, ctx.config.BIGQUERY_JOB_PROJECT_ID);
    ui.alert('Probar consulta (dry run)', 'La consulta es válida.\nBytes estimados a procesar: ' + dry.totalBytesProcessed + '\n\nEsto NO ejecuta ni factura la consulta, solo la valida.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Probar consulta — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

/**
 * BigQuery -> Probar/configurar proyecto de ejecución (Seccion 5 del prompt maestro).
 * Nunca escribe _CONFIG salvo que AMBAS pruebas no destructivas pasen Y el usuario confirme
 * explícitamente. Nunca toca PROJECT_ID/DATASET_ID/TABLE_ID ni la identidad/certificación de
 * snapshot: solo puede terminar escribiendo BIGQUERY_JOB_PROJECT_ID.
 */
function wbMenuProbarConfigurarProyectoEjecucion() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ctx = Orchestrator.loadContext();
    var resp = ui.prompt(
      'BigQuery — Probar/configurar proyecto de ejecución',
      'Data project (fuente, fijo, nunca cambia) = ' + ctx.config.PROJECT_ID +
        '\nJob project actual = ' + ctx.config.BIGQUERY_JOB_PROJECT_ID +
        '\n\nProyecto de ejecución candidato a probar (dejar vacío para usar la propuesta "' +
        WB_KNOWN.CANDIDATE_BIGQUERY_JOB_PROJECT_ID + '"):',
      ui.ButtonSet.OK_CANCEL);
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    var candidate = resp.getResponseText().trim() || WB_KNOWN.CANDIDATE_BIGQUERY_JOB_PROJECT_ID;

    var report = Orchestrator.testJobProject(candidate);
    var lines = [
      'Data project = ' + report.dataProject,
      'Job project actual = ' + report.currentJobProject,
      'Job project candidato = ' + report.candidateJobProject,
      '',
      'Permiso de crear job (bigquery.jobs.create): ' +
        (report.jobCreation.ok ? 'PASS' : 'FAIL — ' + report.jobCreation.error),
      'Acceso a la fuente Carmen Gold (dry run del descubrimiento real): ' +
        (report.sourceAccess.ok
          ? ('PASS (≈' + report.sourceAccess.bytesProcessed + ' bytes estimados)')
          : ('FAIL — ' + report.sourceAccess.error)),
    ];

    if (!report.decision.shouldWrite) {
      lines.push('');
      lines.push('_CONFIG NO fue modificado.');
      if (!report.jobCreation.ok) {
        lines.push('Hace falta roles/bigquery.jobUser (o equivalente) para la identidad que autoriza el script en el proyecto "' + candidate + '".');
      }
      ui.alert('Proyecto de ejecución — resultado', lines.join('\n'), ui.ButtonSet.OK);
      return;
    }

    lines.push('');
    lines.push('Ambas pruebas PASARON. ¿Confirma actualizar _CONFIG.BIGQUERY_JOB_PROJECT_ID a "' + candidate + '"?');
    lines.push('(No toca PROJECT_ID/DATASET_ID/TABLE_ID ni la identidad/certificación de snapshot.)');
    var confirm = ui.alert('Proyecto de ejecución — confirmar', lines.join('\n'), ui.ButtonSet.YES_NO);
    if (confirm !== ui.Button.YES) {
      ui.alert('No se modificó _CONFIG.');
      return;
    }

    var applied = Orchestrator.applyJobProject(candidate);
    ui.alert('_CONFIG actualizado: BIGQUERY_JOB_PROJECT_ID = ' + applied.plan.BIGQUERY_JOB_PROJECT_ID);
  } catch (e) {
    ui.alert('Proyecto de ejecución — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

function wbMenuPrevisualizarCalculo() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = Orchestrator.runPipeline(true);
    ui.alert('Previsualizar cálculo', formatRunSummary_(r) + '\n\nEsto fue un DRY RUN: no se escribió ninguna hoja operacional.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Previsualizar cálculo — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

function wbMenuReconciliarCambios() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = Orchestrator.runPipeline(true);
    var lines = [
      'Asignaciones preservadas (ACTIVE): ' + r.assignmentsPreserved,
      'Relinkeadas a nuevo snapshot (RELINKED_IDENTICAL): ' + r.assignmentsRelinked,
      'Contenido cambiado, requieren revisión (REVIEW_SOURCE_CHANGED): ' + r.contentChangesDetected,
      'Huérfanas (ORPHANED_SOURCE_MISSING): ' + r.assignmentsOrphaned,
      'Nuevas (NEW): ' + r.assignmentsCreated,
      '',
      'Esto fue solo un análisis (dry run): no se modificó ninguna asignación. Use "Actualizar Pairings WB" para aplicar.',
    ];
    ui.alert('Reconciliar cambios de fuente', lines.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Reconciliar cambios de fuente — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

function wbMenuCrearVerificarHistorico() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ctx = Orchestrator.loadContext();
    var lastRun = AuditService.readLastRun(ctx.ss);
    if (!lastRun || (lastRun.status !== 'PUBLISHED' && lastRun.status !== 'PUBLISHED_WITH_QA_WARNINGS')) {
      ui.alert('No hay un run PUBLISHED reciente. Ejecute "Actualizar Pairings WB" primero.');
      return;
    }
    var historyKey = computeHistoryKey({
      schema_version: lastRun.schema_version, ruleset_id: RULESET_ID,
      reference_year: lastRun.reference_year, reference_month: lastRun.reference_month,
      snapshot_key: lastRun.snapshot_key, config_hash: lastRun.config_hash, query_version: lastRun.query_version,
    });
    var info = HistoryService.getOrCreate(ctx.ss.getId(), lastRun.reference_year, lastRun.reference_month, historyKey);
    ui.alert('Histórico ' + (info.created ? 'creado' : 'ya existía') + '.\nfileId=' + info.fileId + '\nhistory_key=' + historyKey);
  } catch (e) {
    ui.alert('Crear/verificar histórico — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

function wbMenuAbrirCarpetaHistoricos() {
  var ui = SpreadsheetApp.getUi();
  ui.alert('Carpeta de históricos', 'https://drive.google.com/drive/folders/' + WB_KNOWN.HISTORY_FOLDER_ID, ui.ButtonSet.OK);
}

function wbMenuVerUltimoRun() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ctx = Orchestrator.loadContext();
    var lastRun = AuditService.readLastRun(ctx.ss);
    if (!lastRun) { ui.alert('Todavía no hay ningún run registrado en _RUNS.'); return; }
    var lines = Object.keys(lastRun).map(function (k) { return k + ': ' + lastRun[k]; });
    ui.alert('Último run', lines.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Ver último run — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

function wbMenuEjecutarQA() {
  var ui = SpreadsheetApp.getUi();
  try {
    var results = Orchestrator.runQaOnly();
    ui.alert('Ejecutar QA', formatQaList_(results), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Ejecutar QA — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

function formatQaList_(qaList) {
  return qaList.map(function (c) { return (c.passed ? 'PASS' : 'FAIL') + ' ' + c.code + (c.detail ? (' — ' + c.detail) : ''); }).join('\n');
}

function formatRunSummary_(r) {
  var lines = [
    'Snapshot: ' + r.snapshotKey,
    'Legs recibidos: ' + r.legsReceived + ' | Pairings: ' + r.pairingsReceived + ' (elegibles=' + r.pairingsEligible + ', revisión=' + r.pairingsReview + ')',
    'Asignaciones — preservadas: ' + r.assignmentsPreserved + ', relinkeadas: ' + r.assignmentsRelinked +
      ', cambios de contenido: ' + r.contentChangesDetected + ', huérfanas: ' + r.assignmentsOrphaned + ', nuevas: ' + r.assignmentsCreated,
    'BigQuery job: ' + r.bqJobId + ' (' + r.bqBytesProcessed + ' bytes)',
    'QA: ' + (r.qaPassed ? 'PASS' : 'FAIL — ' + formatQaList_(r.qa.filter(function (c) { return !c.passed; }))),
  ];
  if (r.publishGate && r.publishGate.blocked) {
    lines.push('Gate de publicación: BLOQUEADO — ' + r.publishGate.reason);
    lines.push('Recomendación: use "Comparar snapshot con RESUMEN actual" (Administración > Fuente de datos).');
  } else {
    lines.push('Gate de publicación: OK');
  }
  return lines.join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {}; // sin logica pura: nada que exponer a Node.
}
