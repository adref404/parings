/**
 * 85_MonthlyWorkbook.js
 * MonthlyWorkbookService + WorkbookRegistry (D23 en docs/DECISIONS.md): ciclo de vida de los
 * ARCHIVOS mensuales del ecosistema Pairings WB (crear/resolver/registrar), separado del calculo
 * de UN mes (eso sigue siendo 80_Orchestrator.js). Depende de DriveApp/SpreadsheetApp/
 * PropertiesService/ScriptApp: no testeable desde Node (igual que 66_HistoryService.js); toda la
 * logica de decision pura vive en 77_WorkbookIdentity.js.
 *
 * Se numera 85 (despues de 80_Orchestrator.js): createMonth() necesita
 * Orchestrator.discoverSnapshots/certifySnapshot para el auto-descubrimiento del punto 6-9 de la
 * mision, asi que este archivo depende de Orchestrator, nunca al reves.
 */

/** Registro durable YYYY-MM -> spreadsheetId (Seccion 5 de la mision). Fuente de verdad RAPIDA;
 * la carpeta de Drive sigue siendo la fuente FISICA verificable (MonthlyWorkbookService.resolveMonth
 * nunca confia solo en este registro sin poder auto-sanarlo desde la carpeta). */
var WorkbookRegistry = {
  get: function (year, month) {
    return PropertiesService.getScriptProperties().getProperty(buildRegistryPropertyKey(year, month));
  },
  set: function (year, month, fileId) {
    PropertiesService.getScriptProperties().setProperty(buildRegistryPropertyKey(year, month), String(fileId));
  },
};

var CENTRAL_PROPERTY_KEYS_ = {
  AUTO_CREATE_NEXT_MONTH: 'WB_CENTRAL_AUTO_CREATE_NEXT_MONTH',
  AUTO_CREATE_DAY: 'WB_CENTRAL_AUTO_CREATE_DAY',
};

/** Lee la automatizacion CENTRAL (Script Properties, no por-archivo) con defaults si no se configuro. */
function readCentralAutomationSettings_() {
  var props = PropertiesService.getScriptProperties();
  var raw = {};
  var nextMonth = props.getProperty(CENTRAL_PROPERTY_KEYS_.AUTO_CREATE_NEXT_MONTH);
  var day = props.getProperty(CENTRAL_PROPERTY_KEYS_.AUTO_CREATE_DAY);
  if (nextMonth !== null) raw.AUTO_CREATE_NEXT_MONTH = nextMonth;
  if (day !== null) raw.AUTO_CREATE_DAY = day;
  return decideCentralAutomationSettings(raw);
}

/**
 * Resuelve, a partir de HOY (timezone del proyecto, nunca new Date(string)), si corresponde crear
 * el mes calendario siguiente, y lo hace (createMonth ya es idempotente: no-op si ya existe).
 * Handler del trigger diario UNICO registrado por ensureDailyAutoCreateTrigger().
 */
function autoCreateNextMonthDaily_() {
  var settings = readCentralAutomationSettings_();
  var tz = Session.getScriptTimeZone();
  var today = new Date();
  var y = parseInt(Utilities.formatDate(today, tz, 'yyyy'), 10);
  var m = parseInt(Utilities.formatDate(today, tz, 'M'), 10);
  var d = parseInt(Utilities.formatDate(today, tz, 'd'), 10);
  var decision = decideAutoCreateShouldRun(settings, y, m, d);
  if (!decision.shouldRun) return;
  MonthlyWorkbookService.createMonth(decision.targetYear, decision.targetMonth);
}

/**
 * Registra (idempotente) el UNICO trigger diario global de auto-creacion (Seccion 4 de la mision).
 * Ejecutar UNA SOLA VEZ, manualmente, desde el editor de Apps Script (misma exigencia de
 * autorizacion OAuth interactiva que configurarMenuPairingsWB(), ver D2).
 */
function ensureDailyAutoCreateTrigger() {
  var existing = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'autoCreateNextMonthDaily_' && t.getEventType() === ScriptApp.EventType.CLOCK;
  });
  if (existing.length > 0) {
    return 'El trigger diario ya existia (' + existing.length + '). No se creo uno nuevo.';
  }
  ScriptApp.newTrigger('autoCreateNextMonthDaily_').timeBased().everyDays(1).atHour(3).create();
  return 'Trigger diario creado: cada dia revisa si ya paso AUTO_CREATE_DAY y, de ser asi, crea (si falta) el mes calendario siguiente. Nunca modifica el mes anterior.';
}

/**
 * Registra (idempotente) el trigger instalable "On open" para UN archivo mensual especifico
 * (generaliza configurarMenuPairingsWB(), 90_Menu.js, que hacia esto solo para Septiembre). Todos
 * los archivos comparten el mismo handler onOpenInstalable_ (90_Menu.js): Apps Script resuelve el
 * Spreadsheet activo correctamente segun cual archivo disparo el evento, sin importar que el script
 * sea standalone (D2).
 */
function ensureOpenTriggerForSpreadsheet(fileId) {
  var existing = ScriptApp.getProjectTriggers().filter(function (t) {
    return t.getHandlerFunction() === 'onOpenInstalable_' &&
      t.getEventType() === ScriptApp.EventType.ON_OPEN &&
      t.getTriggerSourceId() === fileId;
  });
  if (existing.length > 0) return { created: false, alreadyExisted: true };
  ScriptApp.newTrigger('onOpenInstalable_').forSpreadsheet(fileId).onOpen().create();
  return { created: true, alreadyExisted: false };
}

/**
 * Resuelve el Spreadsheet TARGET de la accion actual (Seccion 1 de la mision): una accion de menu
 * usa el Spreadsheet activo (el que disparo el click); un trigger/background recibe/resuelve un
 * fileId explicito. NUNCA usa Septiembre como fallback silencioso: si no hay Spreadsheet activo y
 * no se paso fileId, lanza un error explicito en vez de adivinar.
 */
function resolveWorkbookContext_(fileId) {
  var ss = fileId ? SheetStructure.openWorkbookById(fileId) : SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw new Error('No hay una hoja de calculo activa. Ejecute esta accion desde el menu "Pairings WB" dentro del archivo del mes (no desde el editor de Apps Script).');
  }
  return ss;
}

var MonthlyWorkbookService = {
  /**
   * Resuelve el fileId de un mes YYYY-MM (Seccion 5): primero el registro (Script Properties,
   * rapido); si falta o el archivo ya no existe, escanea la carpeta operativa WB y verifica por
   * METADATA (`_CONFIG.REFERENCE_YEAR/MONTH` del propio archivo candidato), nunca solo por nombre
   * (Seccion 5: "nunca confiar solo en nombre sin comprobar ID/metadata"). Auto-sana el registro si
   * lo encuentra asi. Devuelve {found:false} si no existe en ningun lado.
   */
  resolveMonth: function (year, month) {
    var registered = WorkbookRegistry.get(year, month);
    if (registered) {
      try {
        var file = DriveApp.getFileById(registered);
        if (!file.isTrashed()) {
          return { found: true, fileId: registered, url: 'https://docs.google.com/spreadsheets/d/' + registered + '/edit' };
        }
      } catch (e) { /* borrado/inaccesible: cae al escaneo de carpeta */ }
    }

    var folder = DriveApp.getFolderById(WB_KNOWN.SHEET_FOLDER_ID);
    var it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    while (it.hasNext()) {
      var f = it.next();
      var parsed = parseMonthlyWorkbookName(f.getName());
      if (!parsed || parsed.year !== parseInt(year, 10) || parsed.month !== parseInt(month, 10)) continue;
      var candidateId = f.getId();
      try {
        var candidateSs = SpreadsheetApp.openById(candidateId);
        var cfg = ConfigService.read(candidateSs);
        if (String(cfg.values.REFERENCE_YEAR) === String(parseInt(year, 10)) &&
            String(cfg.values.REFERENCE_MONTH) === String(parseInt(month, 10))) {
          WorkbookRegistry.set(year, month, candidateId); // auto-sana el registro
          return { found: true, fileId: candidateId, url: candidateSs.getUrl() };
        }
      } catch (e) { /* archivo homonimo invalido: seguir buscando */ }
    }
    return { found: false };
  },

  /**
   * Limpia deterministicamente el estado MENSUAL de una copia recien hecha (Seccion 2 de la
   * mision), preservando estructura/formato/protecciones/Diccionario (heredados intactos de la
   * copia de Septiembre). NUNCA toca Diccionario. Es la unica funcion de este archivo que muta un
   * Spreadsheet; se llama exactamente una vez, justo despues de makeCopy(), antes de registrar el
   * archivo como disponible.
   */
  resetMonthlyState_: function (ss, year, month, fileId) {
    // RESUMEN: preserva header/formato/validaciones/protecciones; borra SOLO filas de datos.
    var resumen = ss.getSheetByName(SHEET_NAMES.RESUMEN);
    if (resumen && resumen.getLastRow() > 1) {
      var resumenCols = Math.max(resumen.getMaxColumns(), RESUMEN_HEADERS.length);
      resumen.getRange(2, 1, resumen.getMaxRows() - 1, resumenCols).clearContent();
    }

    // Vuelos: preserva notas humanas (filas 1-2), el header (fila 3, VUELOS_HEADER_ROW, estatico
    // e identico todos los meses) y el separador (fila 4); borra SOLO los bloques de datos del mes
    // anterior, desde VUELOS_FIRST_BLOCK_ROW (fila 5). Limpiar desde el header lo dejaria en blanco
    // hasta la primera corrida real (FlightsRenderer.writeToSheet lo reescribe siempre) -- esta
    // funcion promete preservar el layout de inmediato, no solo eventualmente.
    var vuelos = ss.getSheetByName(SHEET_NAMES.VUELOS);
    if (vuelos && vuelos.getMaxRows() >= VUELOS_FIRST_BLOCK_ROW) {
      vuelos.getRange(VUELOS_FIRST_BLOCK_ROW, 1, vuelos.getMaxRows() - VUELOS_FIRST_BLOCK_ROW + 1, vuelos.getMaxColumns()).clearContent();
    }

    // Cronograma: 100% OUTPUT (D15), sin filas humanas que preservar; se reconstruye por completo
    // en cada calculo real, asi que limpiarlo entero ahora es seguro.
    var cronograma = ss.getSheetByName(SHEET_NAMES.CRONOGRAMA);
    if (cronograma) cronograma.clearContents();

    // _PAIRINGS_DATA: tecnica, "headers unicamente" (Seccion 2). Rewrite directo del header (no
    // AuditService.ensureHeaders, que esta pensada para MIGRAR un header existente agregando
    // columnas faltantes al final, no para arrancar de cero): tras clearContents() el header se
    // reescribe explicitamente para que quede en la columna 1, siempre.
    var pairingsData = SheetStructure.getOrCreateSheet(ss, SHEET_NAMES.PAIRINGS_DATA);
    pairingsData.clearContents();
    SheetStructure.ensureMinColumns(pairingsData, PAIRINGS_DATA_HEADERS.length);
    pairingsData.getRange(1, 1, 1, PAIRINGS_DATA_HEADERS.length).setValues([PAIRINGS_DATA_HEADERS]);

    // _RUNS: nuevo estado mensual, nunca runs copiados de Septiembre. Mismo motivo que arriba: se
    // reescribe el header directamente en vez de reusar AuditService.ensureHeaders (esa funcion
    // decide "que falta" comparando contra el header YA ESCRITO; tras un clearContents() no hay
    // garantia de que getLastColumn() quede en 0 si la plantilla tenia formato en el header, lo que
    // podria migrar RUNS_HEADERS a partir de una columna incorrecta en vez de la columna 1).
    var runs = SheetStructure.getOrCreateSheet(ss, SHEET_NAMES.RUNS);
    runs.clearContents();
    SheetStructure.ensureMinColumns(runs, RUNS_HEADERS.length);
    runs.getRange(1, 1, 1, RUNS_HEADERS.length).setValues([RUNS_HEADERS]);

    // _CONFIG: primero se completa con defaults (por si la plantilla tuviera algo incompleto),
    // LUEGO se pisa con los valores especificos del mes nuevo (nunca al reves: lo especifico gana).
    ConfigService.ensureDefaults(ss);
    ConfigService.writeValues(ss, buildMonthResetConfigValues(year, month, fileId));

    // Diccionario: NUNCA se toca (Seccion 2: se conserva como maestro/copied state).
  },

  /**
   * Crea (o reutiliza, IDEMPOTENTE) el archivo mensual YYYY-MM (Seccion 2/8 de la mision). Copia
   * Septiembre como plantilla visual/estructural, resetea su estado mensual, lo registra, le asegura
   * su propio trigger onOpen, e intenta descubrir/certificar su snapshot en un mejor-esfuerzo que
   * NUNCA aborta la creacion del archivo si BigQuery falla (IAM/red/etc: ver docs/DECISIONS.md D3).
   *
   * El LockService (mismo mecanismo que `Orchestrator.runPipeline`, pero NUNCA el mismo momento:
   * es un lock a nivel de SCRIPT completo, compartido por todas las hojas) protege SOLO la ventana
   * copiar+resetear+registrar (la unica que puede producir un duplicado ante dos clicks
   * simultaneos, M3) -- se libera ANTES de intentar el descubrimiento de snapshot en BigQuery, que
   * puede ser lento y no debe bloquear a otro usuario ejecutando `runPipeline`/`createMonth` sobre
   * un archivo o mes completamente distinto mientras tanto.
   *
   * Si el reseteo falla a mitad de camino (ya se copio el archivo pero no quedo registrado), la
   * copia parcial se envia a la papelera (mejor esfuerzo) para que `resolveMonth` nunca la
   * encuentre y un reintento no produzca un duplicado fantasma.
   */
  createMonth: function (year, month) {
    var name = buildMonthlyWorkbookName(year, month);
    var fileId, copySs;

    var lock = LockService.getScriptLock();
    if (!lock.tryLock(30000)) {
      throw new Error('Ya hay una creacion de mes de Pairings WB en curso. Intente nuevamente en unos minutos.');
    }
    try {
      var existing = MonthlyWorkbookService.resolveMonth(year, month);
      if (existing.found) {
        return { created: false, fileId: existing.fileId, url: existing.url, name: name, snapshotStatus: 'UNKNOWN_EXISTING', candidatesCount: null };
      }

      var templateFile = DriveApp.getFileById(WB_KNOWN.EXPECTED_SPREADSHEET_ID);
      var targetFolder = DriveApp.getFolderById(WB_KNOWN.SHEET_FOLDER_ID);
      var copy = templateFile.makeCopy(name, targetFolder);
      fileId = copy.getId();

      try {
        copySs = SpreadsheetApp.openById(fileId);
        MonthlyWorkbookService.resetMonthlyState_(copySs, year, month, fileId);
        WorkbookRegistry.set(year, month, fileId);
        ensureOpenTriggerForSpreadsheet(fileId);
      } catch (resetError) {
        try { copy.setTrashed(true); } catch (cleanupError) { /* mejor esfuerzo: si ni el trash funciona, queda un archivo huerfano para revision manual */ }
        throw new Error('No se pudo inicializar el archivo del mes nuevo (se revirtio la copia parcial): ' + resetError.message);
      }
    } finally {
      lock.releaseLock();
    }

    // Fuera del lock: el archivo YA quedo creado y registrado de forma unica: el descubrimiento de
    // snapshot (BigQuery, puede ser lento) ya no arriesga un duplicado si tarda.
    var snapshotStatus = 'PENDING_NOT_ATTEMPTED';
    var candidatesCount = null;
    try {
      var discovered = Orchestrator.discoverSnapshots(copySs);
      candidatesCount = discovered.candidates.length;
      if (candidatesCount === 1 && discovered.selection.autoSelectable) {
        var c = discovered.candidates[0];
        Orchestrator.certifySnapshot(copySs, {
          load_key_id: c.load_key_id, load_type_code: c.load_type_code,
          load_version_id: c.load_version_id, ingestion_datetime: c.ingestion_datetime,
        });
        snapshotStatus = 'CERTIFIED';
      } else if (candidatesCount === 0) {
        snapshotStatus = 'PENDING_NONE';
      } else {
        snapshotStatus = 'PENDING_AMBIGUOUS';
      }
    } catch (e) {
      // Descubrimiento fallido (BigQuery/IAM/red): el archivo YA quedo creado y registrado
      // correctamente; el snapshot simplemente queda PENDING para revision administrativa.
      snapshotStatus = 'PENDING_DISCOVERY_FAILED';
    }

    return { created: true, fileId: fileId, url: copySs.getUrl(), name: name, snapshotStatus: snapshotStatus, candidatesCount: candidatesCount };
  },

  /** Crea el mes calendario siguiente al indicado (Sep 2026 -> Oct 2026; Dic -> Ene siguiente). */
  createNextMonth: function (currentYear, currentMonth) {
    var next = computeNextMonth(currentYear, currentMonth);
    return MonthlyWorkbookService.createMonth(next.year, next.month);
  },
};
