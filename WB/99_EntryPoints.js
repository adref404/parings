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
    lines.push('BigQuery alcanzable: ' + (r.bigQueryReachable ? ('SI (≈' + r.bigQueryEstimatedBytes + ' bytes estimados)') : ('NO — ' + r.bigQueryError)));
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
    ui.alert('Snapshot certificado: ' + chosen.load_key_id + ' (' + chosen.ingestion_datetime + '). Ya puede usar "Previsualizar cálculo" o "Calcular y publicar mes".');
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
      'Esto fue solo un análisis (dry run): no se modificó ninguna asignación. Use "Calcular y publicar mes" para aplicar.',
    ];
    ui.alert('Reconciliar cambios de fuente', lines.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Reconciliar cambios de fuente — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

function wbMenuCalcularYPublicar() {
  var ui = SpreadsheetApp.getUi();
  try {
    var preview = Orchestrator.runPipeline(true);
    if (!preview.qaPassed) {
      ui.alert('Calcular y publicar mes — Bloqueado', 'La previsualización detectó fallas de QA:\n' + formatQaList_(preview.qa), ui.ButtonSet.OK);
      return;
    }
    var confirmMsg = formatRunSummary_(preview) + '\n\n¿Confirma publicar estos cambios en RESUMEN/Vuelos/Cronograma/_PAIRINGS_DATA?';
    var confirm = ui.alert('Calcular y publicar mes', confirmMsg, ui.ButtonSet.YES_NO);
    if (confirm !== ui.Button.YES) return;

    var r = Orchestrator.runPipeline(false);
    var historyMsg = r.historyInfo
      ? ('\nHistórico: ' + (r.historyInfo.created ? 'creado' : 'ya existía') + ' (fileId=' + r.historyInfo.fileId + ')')
      : '\nHistórico: no generado (revisar AUTO_ARCHIVE_ON_SUCCESS o QA post-escritura).';
    ui.alert('Calcular y publicar mes — ' + r.status, formatRunSummary_(r) + historyMsg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Calcular y publicar mes — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

function wbMenuCrearVerificarHistorico() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ctx = Orchestrator.loadContext();
    var lastRun = AuditService.readLastRun(ctx.ss);
    if (!lastRun || (lastRun.status !== 'PUBLISHED' && lastRun.status !== 'PUBLISHED_WITH_QA_WARNINGS')) {
      ui.alert('No hay un run PUBLISHED reciente. Ejecute "Calcular y publicar mes" primero.');
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
  return [
    'Snapshot: ' + r.snapshotKey,
    'Legs recibidos: ' + r.legsReceived + ' | Pairings: ' + r.pairingsReceived + ' (elegibles=' + r.pairingsEligible + ', revisión=' + r.pairingsReview + ')',
    'Asignaciones — preservadas: ' + r.assignmentsPreserved + ', relinkeadas: ' + r.assignmentsRelinked +
      ', cambios de contenido: ' + r.contentChangesDetected + ', huérfanas: ' + r.assignmentsOrphaned + ', nuevas: ' + r.assignmentsCreated,
    'BigQuery job: ' + r.bqJobId + ' (' + r.bqBytesProcessed + ' bytes)',
    'QA: ' + (r.qaPassed ? 'PASS' : 'FAIL — ' + formatQaList_(r.qa.filter(function (c) { return !c.passed; }))),
  ].join('\n');
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {}; // sin logica pura: nada que exponer a Node.
}
