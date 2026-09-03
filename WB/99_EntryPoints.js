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
 * JSON-serializable identico al que consume wbMenuDiagnostico. `fileId` es OBLIGATORIO en la
 * practica (D23: sin Spreadsheet activo en un contexto headless, resolveWorkbookContext_ lanza en
 * vez de adivinar Septiembre como fallback silencioso).
 */
function wbDiagnosticoHeadless(fileId) {
  return Orchestrator.runDiagnostics(resolveWorkbookContext_(fileId));
}

// ---------------------------------------------------------------------------------------------
// Experiencia de USUARIO FINAL (menu de nivel superior "Pairings WB"): lenguaje operacional, sin
// mencionar BigQuery/snapshot/load_key/ingestion_datetime/job project/schema/hash/_CONFIG/_RUNS/
// QA. Cualquier incidencia administrativa se muestra como humanFriendlyBlockedMessage_(), nunca
// como traceback tecnico. Toda la logica real sigue viviendo en Orchestrator; estas funciones solo
// formatean entrada/salida.
// ---------------------------------------------------------------------------------------------

/** Texto humano UNICO (D24) para cuando MainWorkbookService resolvio por respaldo LATEST_CREATED
 * porque el mes calendario actual todavia no existe (Seccion 5 de la mision). Una sola fuente de
 * verdad para wbMenuVerEstadoDelMes/wbMenuAbrirMesActual/wbMenuAbrirMesOperativo, en vez de que cada
 * una redacte su propia variante (riesgo de que diverjan con el tiempo). */
var MAIN_FALLBACK_REASON_ = 'el mes calendario actual todavía no existe; mostrando el último mes creado';

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
 * "Actualizar mes actual": el flujo normal para el usuario final (mision <end_user_experience>).
 * Comprueba silenciosamente configuración/snapshot/baseline (via el preview + gates existentes),
 * ejecuta una previsualización, muestra un resumen humano, pide confirmación, y publica SOLO si
 * todos los gates pasan. Ninguna incidencia tecnica se muestra cruda al usuario final.
 */
function wbMenuActualizarPairingsWB() {
  var ui = SpreadsheetApp.getUi();

  var ss, ctx;
  try {
    ctx = MainWorkbookService.resolveContext(resolveWorkbookContext_());
    ss = ctx.ss; // D24: si el archivo activo es el MAIN, ctx/ss ya son los del mes operativo resuelto, nunca el MAIN.
  } catch (e) {
    ui.alert('Pairings WB', humanFriendlyBlockedMessage_(), ui.ButtonSet.OK);
    return;
  }
  var periodLabel = humanPeriodLabel_(ctx.config.REFERENCE_YEAR, ctx.config.REFERENCE_MONTH);

  var preview;
  try {
    preview = Orchestrator.runPipeline(ss, true);
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
    result = Orchestrator.runPipeline(ss, false);
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
 * "Previsualizar cambios": mismo pipeline dry-run que "Actualizar mes actual" pero con resumen
 * humano y SIN pedir confirmacion ni publicar nunca (mision <end_user_experience> #2).
 */
function wbMenuPrevisualizarCambios() {
  var ui = SpreadsheetApp.getUi();

  var ss, ctx;
  try {
    ctx = MainWorkbookService.resolveContext(resolveWorkbookContext_());
    ss = ctx.ss;
  } catch (e) {
    ui.alert('Pairings WB', humanFriendlyBlockedMessage_(), ui.ButtonSet.OK);
    return;
  }
  var periodLabel = humanPeriodLabel_(ctx.config.REFERENCE_YEAR, ctx.config.REFERENCE_MONTH);

  var preview;
  try {
    preview = Orchestrator.runPipeline(ss, true);
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
    var ctx = MainWorkbookService.resolveContext(resolveWorkbookContext_());
    var periodLabel = humanPeriodLabel_(ctx.config.REFERENCE_YEAR, ctx.config.REFERENCE_MONTH);
    if (ctx.mainResolution && ctx.mainResolution.fallbackUsed) {
      periodLabel += ' (' + MAIN_FALLBACK_REASON_ + ')';
    }
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

/** Activa la hoja RESUMEN de `active` si existe; si no, avisa. Comportamiento simple, sin identidad. */
function activateResumenSheet_(ui, active) {
  var sheet = active.getSheetByName(SHEET_NAMES.RESUMEN);
  if (!sheet) {
    ui.alert('Pairings WB', 'La hoja RESUMEN no existe todavía. Use "Actualizar mes actual" primero.', ui.ButtonSet.OK);
    return;
  }
  sheet.activate();
}

/**
 * "Abrir mes operativo" (D24, Seccion 1 de la mision; reemplaza a la antigua "Ir a RESUMEN"): desde
 * un archivo MONTH, activa su propia hoja RESUMEN (misma UX de siempre: navegacion en el mismo
 * archivo). Desde el MAIN, NO puede "activar" una hoja de otro Spreadsheet abierto en otra pestaña
 * -- en su lugar resuelve el mes operativo objetivo y muestra su periodo/enlace para que el usuario
 * lo abra (mismo patron ya usado para "Abrir carpeta de Pairings WB").
 *
 * Una UNICA llamada a `MainWorkbookService.resolveContext` decide todo (nunca dos lecturas de
 * `_CONFIG` sobre el mismo archivo activo). Si la identidad de `active` no se puede resolver (p.ej.
 * una copia hecha fuera del flujo oficial, MISMATCH de MONTH_FILE_ID), esta accion en particular
 * NUNCA debe bloquear una simple navegacion de solo lectura: degrada al comportamiento simple
 * (activar RESUMEN si existe), igual que la antigua "Ir a RESUMEN" siempre hizo antes de D24.
 */
function wbMenuAbrirMesOperativo() {
  var ui = SpreadsheetApp.getUi();
  try {
    var active = SpreadsheetApp.getActiveSpreadsheet();
    if (!active) {
      ui.alert('Pairings WB', 'No se pudo abrir el mes operativo: ejecute este menú desde dentro de un archivo de Pairings WB.', ui.ButtonSet.OK);
      return;
    }

    var ctx;
    try {
      ctx = MainWorkbookService.resolveContext(active);
    } catch (identityError) {
      activateResumenSheet_(ui, active);
      return;
    }

    if (!ctx.mainResolution) {
      activateResumenSheet_(ui, active);
      return;
    }

    var periodLabel = humanPeriodLabel_(ctx.config.REFERENCE_YEAR, ctx.config.REFERENCE_MONTH);
    var note = ctx.mainResolution.fallbackUsed ? '\n\n(' + capitalize_(MAIN_FALLBACK_REASON_) + '.)' : '';
    ui.alert('Abrir mes operativo', periodLabel + '\nEnlace: ' + ctx.ss.getUrl() + note, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Abrir mes operativo — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

// ---------------------------------------------------------------------------------------------
// "Meses" (D23 en docs/DECISIONS.md): 1 Apps Script central + N archivos mensuales independientes.
// Nunca se reutiliza el archivo de un mes para el siguiente; estas son las unicas vias de usuario
// final para crear/abrir esos archivos. La logica real vive en MonthlyWorkbookService
// (85_MonthlyWorkbook.js); aqui solo se formatea entrada/salida de UI, igual que el resto de este
// archivo. No se muestran detalles de BigQuery al usuario final (Seccion 3 de la mision).
// ---------------------------------------------------------------------------------------------

/** Resumen humano del resultado de MonthlyWorkbookService.createMonth/createNextMonth. */
function buildMonthCreationSummary_(result) {
  var lines = [
    result.created ? ('Archivo creado: ' + result.name) : ('El archivo ya existía: ' + result.name),
    'Enlace: ' + result.url,
  ];
  if (result.created) {
    lines.push('');
    if (result.snapshotStatus === 'CERTIFIED') {
      lines.push('Snapshot: se encontró una única carga compatible y quedó certificada automáticamente.');
    } else if (result.snapshotStatus === 'PENDING_AMBIGUOUS') {
      lines.push('Snapshot: hay ' + result.candidatesCount + ' cargas candidatas — requiere administración ("Fuente de datos > Certificar snapshot").');
    } else if (result.snapshotStatus === 'PENDING_NONE') {
      lines.push('Snapshot: todavía no hay ninguna carga disponible para este mes en la fuente — requiere administración.');
    } else if (result.snapshotStatus === 'PENDING_DISCOVERY_FAILED') {
      lines.push('Snapshot: no se pudo revisar la fuente en este momento — requiere administración.');
    }
    lines.push('El mes nuevo empieza sin asignaciones, sin INS/ACT heredados y sin afectar a ningún otro mes.');
  }
  return lines.join('\n');
}

/**
 * "Meses > Crear próximo mes": crea (idempotente) el archivo del mes calendario siguiente. Desde un
 * archivo MONTH, es el mes siguiente A ESE ARCHIVO (no al de hoy) -- ej. abierto desde Septiembre
 * 2026, crea Octubre 2026 (comportamiento identico a D23). Desde el MAIN (D24), es el mes siguiente
 * al mes operativo resuelto (Seccion 1 de la mision: "crear meses" es una capacidad del MAIN); si el
 * MAIN todavía no tiene ningún mes creado, usa el mes calendario de HOY como base (bootstrap).
 */
function wbMenuCrearProximoMes() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ownCtx = Orchestrator.loadContext(resolveWorkbookContext_());
    var baseYear, baseMonth, baseLabel;

    if (ownCtx.config.WORKBOOK_ROLE === WORKBOOK_ROLE.MAIN) {
      try {
        var resolved = MainWorkbookService.resolveViewTarget();
        baseYear = resolved.year; baseMonth = resolved.month;
        baseLabel = 'el mes operativo actual (' + humanPeriodLabel_(baseYear, baseMonth) + ')';
      } catch (e) {
        var t = getTodayInProjectTimezone_();
        baseYear = t.year; baseMonth = t.month;
        baseLabel = 'el mes calendario actual (' + humanPeriodLabel_(baseYear, baseMonth) + '), porque el MAIN todavía no tiene ningún mes creado';
      }
    } else {
      baseYear = ownCtx.config.REFERENCE_YEAR; baseMonth = ownCtx.config.REFERENCE_MONTH;
      baseLabel = 'este archivo (' + humanPeriodLabel_(baseYear, baseMonth) + ')';
    }

    var confirm = ui.alert('Crear próximo mes', 'Se creará el mes siguiente a ' + baseLabel + '. ¿Continuar?', ui.ButtonSet.YES_NO);
    if (confirm !== ui.Button.YES) return;

    var result = MonthlyWorkbookService.createNextMonth(baseYear, baseMonth);
    ui.alert('Crear próximo mes', buildMonthCreationSummary_(result), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Crear próximo mes — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

/** "Meses > Crear mes manualmente": pide año y mes explícitos; mismo motor idempotente que "Crear próximo mes". */
function wbMenuCrearMesManualmente() {
  var ui = SpreadsheetApp.getUi();
  try {
    var resp = ui.prompt('Crear mes manualmente', 'Ingrese el periodo en formato AAAA-MM (ej: 2026-11):', ui.ButtonSet.OK_CANCEL);
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    var m = /^(\d{4})-(\d{1,2})$/.exec(resp.getResponseText().trim());
    if (!m) { ui.alert('Formato inválido. Use AAAA-MM, por ejemplo 2026-11.'); return; }
    var year = parseInt(m[1], 10), month = parseInt(m[2], 10);
    if (month < 1 || month > 12) { ui.alert('Mes inválido: ' + month + '. Debe estar entre 1 y 12.'); return; }

    var result = MonthlyWorkbookService.createMonth(year, month);
    ui.alert('Crear mes manualmente', buildMonthCreationSummary_(result), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Crear mes manualmente — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

/**
 * "Meses > Abrir mes actual": desde un archivo MONTH, muestra su propio periodo y enlace (igual que
 * D23). Desde el MAIN (D24), resuelve y muestra el mes operativo actual (con aviso si es un
 * respaldo al último creado porque el mes calendario todavía no existe).
 */
function wbMenuAbrirMesActual() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ctx = MainWorkbookService.resolveContext(resolveWorkbookContext_());
    var periodLabel = humanPeriodLabel_(ctx.config.REFERENCE_YEAR, ctx.config.REFERENCE_MONTH);
    var note = ctx.mainResolution && ctx.mainResolution.fallbackUsed
      ? '\n\n(' + capitalize_(MAIN_FALLBACK_REASON_) + '.)' : '';
    ui.alert('Abrir mes actual', periodLabel + '\nEnlace: ' + ctx.ss.getUrl() + note, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Abrir mes actual — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

/**
 * "Meses > Previsualizar último mes creado" (D24, Seccion 1 de la mision): previsualización de solo
 * lectura del mensual MÁS RECIENTE registrado, forzando el modo LATEST_CREATED puntualmente (nunca
 * cambia la configuración central MAIN_VIEW_MODE ni ningún archivo mensual). Disponible desde
 * cualquier archivo del ecosistema, no solo desde el MAIN.
 */
function wbMenuPrevisualizarUltimoMesCreado() {
  var ui = SpreadsheetApp.getUi();
  try {
    var resolved = MainWorkbookService.resolveViewTarget(MAIN_VIEW_MODE.LATEST_CREATED);
    var ctx = Orchestrator.loadContext(resolved.ss);
    var periodLabel = humanPeriodLabel_(ctx.config.REFERENCE_YEAR, ctx.config.REFERENCE_MONTH);
    var preview = Orchestrator.runPipeline(resolved.ss, true);
    var msg = buildHumanUpdateSummary_(preview, 'Último mes creado: ' + periodLabel);
    msg += '\n\nEsto es solo una previsualización: no se escribió ningún cambio, ni en este mes ni en el MAIN.';
    ui.alert('Previsualizar último mes creado', msg, ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Previsualizar último mes creado — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

/** "Meses > Abrir carpeta de Pairings WB": enlace a la carpeta operativa con todos los años/meses. */
function wbMenuAbrirCarpetaPairingsWB() {
  var ui = SpreadsheetApp.getUi();
  ui.alert('Carpeta de Pairings WB', 'https://drive.google.com/drive/folders/' + WB_KNOWN.SHEET_FOLDER_ID, ui.ButtonSet.OK);
}

/**
 * Administración > Configuración > "Cambiar vista del MAIN" (D24, Seccion 5 de la mision): cambia
 * MAIN_VIEW_MODE central (CURRENT_MONTH/LATEST_CREATED). Nunca altera ningún archivo mensual ni el
 * MAIN mismo -- solo la configuración CENTRAL de resolución.
 */
function wbMenuCambiarVistaDelMain() {
  var ui = SpreadsheetApp.getUi();
  try {
    var resp = ui.prompt(
      'Cambiar vista del MAIN',
      'Modo actual de vista: ' + MainWorkbookService.readViewSettings_().viewMode +
        '\n\nIngrese el nuevo modo:\n  1 = ' + MAIN_VIEW_MODE.CURRENT_MONTH + ' (mes calendario actual, con respaldo al último creado)\n  2 = ' + MAIN_VIEW_MODE.LATEST_CREATED + ' (siempre el último mes creado)',
      ui.ButtonSet.OK_CANCEL);
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    var choice = resp.getResponseText().trim();
    var mode = choice === '2' ? MAIN_VIEW_MODE.LATEST_CREATED : (choice === '1' ? MAIN_VIEW_MODE.CURRENT_MONTH : choice.toUpperCase());
    var applied = MainWorkbookService.writeMainViewMode(mode);
    ui.alert('Vista del MAIN actualizada a: ' + applied);
  } catch (e) {
    ui.alert('Cambiar vista del MAIN — Error', String(e.message || e), ui.ButtonSet.OK);
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
    var report = Orchestrator.compareBaselineWithSnapshot(resolveWorkbookContext_());
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
      '  Presentes y ELIGIBLE: ' + s.pairingIdsPresentEligible,
      '  Presentes pero en REVISIÓN (siguen en Carmen Gold, no ausentes): ' + s.pairingIdsPresentReview,
      'Ausentes del snapshot actual (realmente ya no existen): ' + s.pairingIdsAbsent,
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
    if (Object.keys(report.reviewReasonCounts).length) {
      lines.push('', 'Razones de REVISIÓN entre los baseline (agrupadas):');
      Object.keys(report.reviewReasonCounts).sort().forEach(function (reason) {
        lines.push('  ' + reason + ': ' + report.reviewReasonCounts[reason]);
      });
    }
    if (report.reviewPairingReasons.length) {
      lines.push('', 'Pairing IDs del baseline en REVISIÓN (motivo):');
      report.reviewPairingReasons.forEach(function (r) { lines.push('  ' + r.pairing_id + ' -> ' + r.eligibility_reason); });
    }
    lines.push('', 'Esto fue un DRY RUN de solo lectura: no se modificó snapshot, RESUMEN, hashes ni assignment_id.');
    ui.alert('Comparar snapshot con RESUMEN actual', lines.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Comparar snapshot con RESUMEN actual — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

function wbMenuDiagnostico() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = Orchestrator.runDiagnostics(resolveWorkbookContext_());
    var lines = [];
    lines.push('Spreadsheet: ' + (r.spreadsheetOpened ? (r.spreadsheetName + ' (' + r.spreadsheetId + ')') : 'NO SE PUDO ABRIR'));
    if (!r.spreadsheetOpened) { ui.alert('Diagnóstico del sistema', 'Spreadsheet: ' + r.error, ui.ButtonSet.OK); return; }
    lines.push('Contexto de menú: ' + r.boundContext);
    lines.push('Rol del archivo (WORKBOOK_ROLE): ' + r.workbookRole);
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
    lines.push('Trigger creación automática: ' + (r.autoCreateTriggerInstalled ? 'INSTALADO' : 'NO INSTALADO'));
    ui.alert('Diagnóstico del sistema', lines.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Diagnóstico del sistema — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

function wbMenuVerConfiguracion() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ctx = Orchestrator.loadContext(resolveWorkbookContext_());
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

    var ctx = Orchestrator.loadContext(resolveWorkbookContext_());
    if (ctx.config.WORKBOOK_ROLE === WORKBOOK_ROLE.MAIN) {
      ui.alert('El MAIN no tiene un periodo operativo propio (es un centro de control, D24). Abra el archivo del mes que quiere configurar, o use "Meses > Crear mes manualmente".');
      return;
    }
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
    var r = Orchestrator.discoverSnapshots(resolveWorkbookContext_());
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
    var ss = resolveWorkbookContext_();
    var r = Orchestrator.discoverSnapshots(ss);
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
    Orchestrator.certifySnapshot(ss, {
      load_key_id: chosen.load_key_id, load_type_code: chosen.load_type_code,
      load_version_id: chosen.load_version_id, ingestion_datetime: chosen.ingestion_datetime,
    });
    ui.alert('Snapshot certificado: ' + chosen.load_key_id + ' (' + chosen.ingestion_datetime + '). Ya puede usar "Previsualizar cambios" o "Actualizar mes actual".');
  } catch (e) {
    ui.alert('Certificar snapshot — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

function wbMenuProbarConsulta() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ctx = Orchestrator.loadContext(resolveWorkbookContext_());
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
    var ss = resolveWorkbookContext_();
    var ctx = Orchestrator.loadContext(ss);
    var resp = ui.prompt(
      'BigQuery — Probar/configurar proyecto de ejecución',
      'Data project (fuente, fijo, nunca cambia) = ' + ctx.config.PROJECT_ID +
        '\nJob project actual = ' + ctx.config.BIGQUERY_JOB_PROJECT_ID +
        '\n\nProyecto de ejecución candidato a probar (dejar vacío para usar la propuesta "' +
        WB_KNOWN.CANDIDATE_BIGQUERY_JOB_PROJECT_ID + '"):',
      ui.ButtonSet.OK_CANCEL);
    if (resp.getSelectedButton() !== ui.Button.OK) return;
    var candidate = resp.getResponseText().trim() || WB_KNOWN.CANDIDATE_BIGQUERY_JOB_PROJECT_ID;

    var report = Orchestrator.testJobProject(ss, candidate);
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

    var applied = Orchestrator.applyJobProject(ss, candidate);
    ui.alert('_CONFIG actualizado: BIGQUERY_JOB_PROJECT_ID = ' + applied.plan.BIGQUERY_JOB_PROJECT_ID);
  } catch (e) {
    ui.alert('Proyecto de ejecución — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

/**
 * Previsualizacion tecnica (Proceso y reconciliacion): a diferencia de Diagnostico/Ver configuracion
 * (que si muestran el archivo ACTIVO tal cual, D24), esta invoca `Orchestrator.runPipeline` -- que
 * rechaza al MAIN como target incluso en dry run (`assertNotMainTarget_`, Seccion 2 de la mision:
 * "MAIN no debe convertirse en segundo owner de INS/ACT", ni siquiera en preview con datos ya
 * inertes tras la migracion). Por eso resuelve el mensual objetivo primero, igual que las 4 acciones
 * de usuario final.
 */
function wbMenuPrevisualizarCalculo() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = Orchestrator.runPipeline(MainWorkbookService.resolveContext(resolveWorkbookContext_()).ss, true);
    ui.alert('Previsualizar cálculo', formatRunSummary_(r) + '\n\nEsto fue un DRY RUN: no se escribió ninguna hoja operacional.', ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Previsualizar cálculo — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

/** Mismo motivo que wbMenuPrevisualizarCalculo: invoca runPipeline, asi que resuelve el mensual objetivo primero. */
function wbMenuReconciliarCambios() {
  var ui = SpreadsheetApp.getUi();
  try {
    var r = Orchestrator.runPipeline(MainWorkbookService.resolveContext(resolveWorkbookContext_()).ss, true);
    var lines = [
      'Asignaciones preservadas (ACTIVE): ' + r.assignmentsPreserved,
      'Relinkeadas a nuevo snapshot (RELINKED_IDENTICAL): ' + r.assignmentsRelinked,
      'Contenido cambiado, requieren revisión (REVIEW_SOURCE_CHANGED): ' + r.contentChangesDetected,
      'Huérfanas (ORPHANED_SOURCE_MISSING): ' + r.assignmentsOrphaned,
      'Nuevas (NEW): ' + r.assignmentsCreated,
      '',
      'Esto fue solo un análisis (dry run): no se modificó ninguna asignación. Use "Actualizar mes actual" para aplicar.',
    ];
    ui.alert('Reconciliar cambios de fuente', lines.join('\n'), ui.ButtonSet.OK);
  } catch (e) {
    ui.alert('Reconciliar cambios de fuente — Error', String(e.message || e), ui.ButtonSet.OK);
  }
}

function wbMenuCrearVerificarHistorico() {
  var ui = SpreadsheetApp.getUi();
  try {
    var ctx = Orchestrator.loadContext(resolveWorkbookContext_());
    var lastRun = AuditService.readLastRun(ctx.ss);
    if (!lastRun || (lastRun.status !== 'PUBLISHED' && lastRun.status !== 'PUBLISHED_WITH_QA_WARNINGS')) {
      ui.alert('No hay un run PUBLISHED reciente. Ejecute "Actualizar mes actual" primero.');
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
    var ctx = Orchestrator.loadContext(resolveWorkbookContext_());
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
    var results = Orchestrator.runQaOnly(resolveWorkbookContext_());
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
