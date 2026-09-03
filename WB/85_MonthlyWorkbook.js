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
  MAIN_VIEW_MODE: 'WB_CENTRAL_MAIN_VIEW_MODE',
  MAIN_VIEW_FILE_ID: 'WB_CENTRAL_MAIN_VIEW_FILE_ID',
};

// -------------------------------------------------------------------------------------------
// Carpetas anuales (D24, Seccion 3 de la mision): "WB/<year>/" agrupa los mensuales de un anio.
// Nunca duplican por retry/concurrencia PORQUE quien las crea (createMonth, migrateMainAndSeptember)
// ya sostiene el LockService de su propia seccion critica -- estas funciones no toman lock propio.
// -------------------------------------------------------------------------------------------

/** Busca (SIN crear) la carpeta del anio dentro de la carpeta operativa WB. null si no existe aun. */
function findYearFolder(year) {
  var parent = DriveApp.getFolderById(WB_KNOWN.SHEET_FOLDER_ID);
  var name = buildYearFolderName(year);
  var it = parent.getFoldersByName(name);
  var ids = [];
  while (it.hasNext()) ids.push(it.next().getId());
  var decision = decideEnsureFolderAction(ids);
  return decision.action === 'REUSE' ? DriveApp.getFolderById(decision.id) : null;
}

/** Reutiliza (si existe) o crea (si falta) la carpeta del anio, SIN duplicar. Ver decideEnsureFolderAction. */
function ensureYearFolder(year) {
  var existing = findYearFolder(year);
  if (existing) return existing;
  var parent = DriveApp.getFolderById(WB_KNOWN.SHEET_FOLDER_ID);
  return parent.createFolder(buildYearFolderName(year));
}

/**
 * {year, month, day} de HOY en el timezone del PROYECTO (Session.getScriptTimeZone(), nunca
 * `new Date(string)`/timezone implicito del proceso -- Seccion 21). Fuente UNICA reusada por
 * `autoCreateNextMonthDaily_`, `MainWorkbookService.resolveViewTarget` y el bootstrap de
 * `wbMenuCrearProximoMes` (99_EntryPoints.js) para que un futuro fix de timezone/DST se aplique una
 * sola vez, no en 3 copias independientes que podrian divergir.
 */
function getTodayInProjectTimezone_() {
  var tz = Session.getScriptTimeZone();
  var today = new Date();
  return {
    year: parseInt(Utilities.formatDate(today, tz, 'yyyy'), 10),
    month: parseInt(Utilities.formatDate(today, tz, 'M'), 10),
    day: parseInt(Utilities.formatDate(today, tz, 'd'), 10),
  };
}

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
  var t = getTodayInProjectTimezone_();
  var decision = decideAutoCreateShouldRun(settings, t.year, t.month, t.day);
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
   * Resuelve el fileId de un mes YYYY-MM (Seccion 5; D24 Seccion 3: ahora vive en WB/<year>/):
   * primero el registro (Script Properties, rapido); si falta o el archivo ya no existe, escanea la
   * carpeta ANUAL correspondiente (findYearFolder, null-safe si el anio no existe todavia -- 0
   * candidatos) y verifica por METADATA (`_CONFIG.REFERENCE_YEAR/MONTH` del propio archivo
   * candidato), nunca solo por nombre (Seccion 5: "nunca confiar solo en nombre sin comprobar
   * ID/metadata"). Auto-sana el registro si lo encuentra asi. Devuelve {found:false} si no existe en
   * ningun lado.
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

    var yearFolder = findYearFolder(year);
    if (!yearFolder) return { found: false };

    var it = yearFolder.getFilesByType(MimeType.GOOGLE_SHEETS);
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
   * Limpia deterministicamente las hojas OPERACIONALES de un Spreadsheet (RESUMEN/Vuelos/
   * Cronograma/_PAIRINGS_DATA/_RUNS), preservando estructura/formato/protecciones/Diccionario.
   * NUNCA toca Diccionario ni _CONFIG. Compartida por dos flujos (D24): `resetMonthlyState_` (mes
   * recien creado) y la migracion del MAIN (`migrateMainAndSeptember`, que debe dejar al MAIN sin
   * las 32 asignaciones de Septiembre que traia como archivo original, para que nunca sea un
   * segundo owner de INS/ACT -- Seccion 2 de la mision D24).
   */
  clearOperationalSheetData_: function (ss) {
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

    // _RUNS: nuevo estado mensual, nunca runs heredados de la plantilla. Mismo motivo que arriba: se
    // reescribe el header directamente en vez de reusar AuditService.ensureHeaders (esa funcion
    // decide "que falta" comparando contra el header YA ESCRITO; tras un clearContents() no hay
    // garantia de que getLastColumn() quede en 0 si la plantilla tenia formato en el header, lo que
    // podria migrar RUNS_HEADERS a partir de una columna incorrecta en vez de la columna 1).
    var runs = SheetStructure.getOrCreateSheet(ss, SHEET_NAMES.RUNS);
    runs.clearContents();
    SheetStructure.ensureMinColumns(runs, RUNS_HEADERS.length);
    runs.getRange(1, 1, 1, RUNS_HEADERS.length).setValues([RUNS_HEADERS]);

    // Diccionario: NUNCA se toca (Seccion 2: se conserva como maestro/copied state).
  },

  /**
   * Limpia deterministicamente el estado MENSUAL de una copia recien hecha (Seccion 2 de la
   * mision), preservando estructura/formato/protecciones/Diccionario (heredados intactos de la
   * copia del MAIN). NUNCA toca Diccionario. Es la unica funcion de este archivo que muta un
   * Spreadsheet MONTH; se llama exactamente una vez, justo despues de makeCopy(), antes de registrar
   * el archivo como disponible.
   */
  resetMonthlyState_: function (ss, year, month, fileId) {
    MonthlyWorkbookService.clearOperationalSheetData_(ss);

    // _CONFIG: primero se completa con defaults (por si la plantilla tuviera algo incompleto),
    // LUEGO se pisa con los valores especificos del mes nuevo (nunca al reves: lo especifico gana).
    ConfigService.ensureDefaults(ss);
    ConfigService.writeValues(ss, buildMonthResetConfigValues(year, month, fileId, WB_KNOWN.MAIN_FILE_ID));
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

      // D24 Seccion 3: los mensuales viven en WB/<year>/, nunca directamente en WB/. La plantilla
      // sigue siendo el MAIN (WB_KNOWN.MAIN_FILE_ID) -- su rol de "template estructural" no cambia,
      // solo su rol de identidad (D24, nunca vuelve a ser "un mes").
      var yearFolder = ensureYearFolder(year);
      var templateFile = DriveApp.getFileById(WB_KNOWN.MAIN_FILE_ID);
      var copy = templateFile.makeCopy(name, yearFolder);
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

/**
 * MainWorkbookService (D24, Seccion 5 de la mision "MAIN VIEW STATE"): resuelve que archivo mensual
 * "ve"/opera el MAIN, a partir de la configuracion CENTRAL (Script Properties: MAIN_VIEW_MODE) y el
 * registro de meses (WorkbookRegistry). Toda la logica de ranking/decision PURA vive en
 * 77_WorkbookIdentity.js (rankMainViewCandidates/decideMainViewSettings); este objeto es I/O puro.
 */
var MainWorkbookService = {
  /** Enumera TODOS los meses conocidos por el registro (Script Properties), parseando sus claves. */
  listRegisteredMonths_: function () {
    var props = PropertiesService.getScriptProperties().getProperties();
    var out = [];
    Object.keys(props).forEach(function (key) {
      var parsed = parseRegistryPropertyKey(key);
      if (!parsed) return;
      out.push({ year: parsed.year, month: parsed.month, monthKey: buildMonthKey(parsed.year, parsed.month), fileId: props[key] });
    });
    return out;
  },

  readViewSettings_: function () {
    var raw = PropertiesService.getScriptProperties().getProperty(CENTRAL_PROPERTY_KEYS_.MAIN_VIEW_MODE);
    return decideMainViewSettings({ MAIN_VIEW_MODE: raw });
  },

  /** Admin: cambia MAIN_VIEW_MODE de forma central (Seccion 5 de la mision: "sin alterar los archivos mensuales"). */
  writeMainViewMode: function (mode) {
    var normalized = String(mode || '').trim().toUpperCase();
    if (normalized !== MAIN_VIEW_MODE.CURRENT_MONTH && normalized !== MAIN_VIEW_MODE.LATEST_CREATED) {
      throw new Error('MAIN_VIEW_MODE invalido: "' + mode + '". Valores validos: ' + MAIN_VIEW_MODE.CURRENT_MONTH + ', ' + MAIN_VIEW_MODE.LATEST_CREATED + '.');
    }
    PropertiesService.getScriptProperties().setProperty(CENTRAL_PROPERTY_KEYS_.MAIN_VIEW_MODE, normalized);
    return normalized;
  },

  /**
   * Verifica FISICAMENTE un candidato del registro (Seccion 3 de la mision: "no confiar solo en
   * nombre"): abre el archivo, confirma WORKBOOK_ROLE=MONTH, REFERENCE_YEAR/MONTH coincidentes con
   * lo registrado, y que su carpeta padre sea la carpeta anual correcta. Devuelve {ok:true, ss,
   * config} o {ok:false, reason}; nunca lanza (un candidato invalido simplemente se descarta).
   */
  verifyMonthCandidate_: function (candidate) {
    var ss;
    try {
      ss = SpreadsheetApp.openById(candidate.fileId);
    } catch (e) {
      return { ok: false, reason: 'No se pudo abrir el archivo (borrado/inaccesible).' };
    }
    var cfg = ConfigService.read(ss).values;
    if (String(cfg.WORKBOOK_ROLE || '').toUpperCase() !== WORKBOOK_ROLE.MONTH) {
      return { ok: false, reason: 'WORKBOOK_ROLE no es MONTH.' };
    }
    if (String(cfg.REFERENCE_YEAR) !== String(candidate.year) || String(cfg.REFERENCE_MONTH) !== String(candidate.month)) {
      return { ok: false, reason: 'REFERENCE_YEAR/MONTH no coincide con lo registrado.' };
    }
    var yearFolder = findYearFolder(candidate.year);
    if (!yearFolder) return { ok: false, reason: 'La carpeta del anio ' + candidate.year + ' no existe.' };
    var parents = DriveApp.getFileById(candidate.fileId).getParents();
    var inYearFolder = false;
    while (parents.hasNext()) { if (parents.next().getId() === yearFolder.getId()) inYearFolder = true; }
    if (!inYearFolder) return { ok: false, reason: 'El archivo no esta dentro de la carpeta del anio ' + candidate.year + '.' };
    return { ok: true, ss: ss, config: cfg };
  },

  /**
   * Resuelve el mensual objetivo del MAIN (Seccion 1/5 de la mision): CURRENT_MONTH por defecto (con
   * fallback al ultimo mensual valido si el mes calendario actual no existe todavia), o
   * LATEST_CREATED si asi se configuro centralmente. `forcedMode` (opcional) fuerza un modo puntual
   * SIN tocar la configuracion central (usado por "Previsualizar ultimo mes creado", Seccion 1: la
   * previsualizacion nunca altera archivos mensuales NI la configuracion central).
   */
  resolveViewTarget: function (forcedMode) {
    var settings = forcedMode ? { viewMode: forcedMode } : MainWorkbookService.readViewSettings_();
    var registered = MainWorkbookService.listRegisteredMonths_();

    var t = getTodayInProjectTimezone_();

    var ranked = rankMainViewCandidates(settings, registered, t.year, t.month);
    if (ranked.length === 0) {
      throw new Error('Todavia no hay ningun mes operativo creado. Use "Meses > Crear próximo mes" o "Crear mes manualmente" primero.');
    }

    var currentKey = buildMonthKey(t.year, t.month);
    for (var i = 0; i < ranked.length; i++) {
      var candidate = ranked[i];
      var verified = MainWorkbookService.verifyMonthCandidate_(candidate);
      if (!verified.ok) continue;
      var fallbackUsed = settings.viewMode === MAIN_VIEW_MODE.CURRENT_MONTH && candidate.monthKey !== currentKey;
      var resolution = {
        mode: settings.viewMode, fileId: candidate.fileId, year: candidate.year, month: candidate.month,
        monthKey: candidate.monthKey, fallbackUsed: fallbackUsed, ss: verified.ss, config: verified.config,
      };
      // Cache informativo, nunca autoritativo (Seccion 5): un fallo al escribirlo no debe bloquear
      // la resolucion, que ya se calculo por completo arriba.
      try { PropertiesService.getScriptProperties().setProperty(CENTRAL_PROPERTY_KEYS_.MAIN_VIEW_FILE_ID, candidate.fileId); } catch (e) { /* informativo */ }
      return resolution;
    }
    throw new Error('Hay meses registrados pero ninguno paso la verificacion fisica (archivo movido/corrupto/borrado). Revise Administración > Diagnóstico del sistema.');
  },

  /**
   * Punto de entrada UNICO para las acciones de menu de usuario final (Seccion 2 de la mision, "MAIN
   * COMO VISTA"): dado el Spreadsheet activo/explicito, si es MONTH devuelve su propio contexto
   * (identico al comportamiento previo a D24); si es MAIN, resuelve el mensual objetivo segun
   * MAIN_VIEW_MODE y devuelve el contexto de ESE archivo (con `.mainResolution` describiendo la
   * resolucion), nunca el del MAIN -- asi ninguna accion de calculo puede terminar operando sobre el
   * MAIN "como si fuera mensual" (Seccion 1). Para forzar LATEST_CREATED puntualmente sin pasar por
   * MAIN_VIEW_MODE (p.ej. "Previsualizar último mes creado"), usar `resolveViewTarget` directamente.
   */
  resolveContext: function (ss) {
    var ctx = Orchestrator.loadContext(ss);
    if (ctx.config.WORKBOOK_ROLE !== WORKBOOK_ROLE.MAIN) {
      ctx.mainResolution = null;
      return ctx;
    }
    var resolution = MainWorkbookService.resolveViewTarget();
    var targetCtx = Orchestrator.loadContext(resolution.ss);
    targetCtx.mainResolution = resolution;
    return targetCtx;
  },
};

// -------------------------------------------------------------------------------------------
// Migracion estructural UNICA (D24, Seccion 4 de la mision): conocidos de ESTE evento historico
// puntual, NO parametros genericos reutilizables para otra migracion futura.
// -------------------------------------------------------------------------------------------
var MIGRATION_SEPTEMBER_YEAR_ = 2026;
var MIGRATION_SEPTEMBER_MONTH_ = 9;
var MIGRATION_OCTOBER_FILE_ID_ = '1vUV7H5Xd95jIn_gu8cWr-DQ-P-sEnCM3I-zUbt86DhM';
var MIGRATION_OCTOBER_YEAR_ = 2026;
var MIGRATION_OCTOBER_MONTH_ = 10;

/**
 * Huella de una fila de RESUMEN para verificar la copia de Septiembre (Seccion 4 de la mision:
 * "nunca perder contenido antes de verificar"). Cubre exactamente los campos HUMANOS/identidad que
 * importa preservar bit a bit (assignment_id, INS, ACT, Pairing) -- deliberadamente MAS estricta que
 * comparar solo la CANTIDAD de filas, que no detectaria una copia con el mismo total pero contenido
 * distinto.
 */
function fingerprintResumenRow_(r) {
  return String(r.assignment_id) + '|' + String(r.INS) + '|' + String(r.ACT) + '|' + String(r.Pairing);
}

/** Compara dos listas de filas de RESUMEN por contenido (no por orden): true si son EXACTAMENTE el mismo conjunto. */
function resumenRowsMatchExactly_(rowsA, rowsB) {
  if (rowsA.length !== rowsB.length) return false;
  var a = rowsA.map(fingerprintResumenRow_).sort();
  var b = rowsB.map(fingerprintResumenRow_).sort();
  for (var i = 0; i < a.length; i++) { if (a[i] !== b[i]) return false; }
  return true;
}

/**
 * Migracion estructural UNICA (D24, Seccion 4 de la mision): "MAIN permanente + archivos mensuales
 * por anio". Restart-safe e idempotente en cada paso (A/B/C se auto-verifican antes de actuar: un
 * reintento tras una falla parcial nunca duplica nada). Ejecutar UNA SOLA VEZ, manualmente, desde el
 * editor de Apps Script (misma exigencia de autorizacion OAuth interactiva de D2).
 *
 * A. Si NO existe ya un mensual valido de Septiembre 2026 (MonthlyWorkbookService.resolveMonth),
 *    copia el MAIN (con su contenido actual: 32 asignaciones/INS/ACT/_PAIRINGS_DATA/_RUNS) a
 *    WB/2026/Pairings WB - SEPTIEMBRE 2026, le fuerza su identidad MONTH (nunca via self-heal: el
 *    MAIN ya tenia MONTH_FILE_ID=su-propio-ID por D23 auto-sanandolo cuando operaba como
 *    Septiembre, y ese valor STALE se copiaria tal cual -- debe sobrescribirse explicitamente, no
 *    dejarse al self-heal de loadContext, que lo veria como MISMATCH), y verifica que la copia
 *    conservo EXACTAMENTE el mismo contenido (assignment_id/INS/ACT/Pairing por fila, no solo la
 *    cantidad) que el MAIN tenia antes de tocarlo (Seccion 4: "nunca perder contenido antes de
 *    verificar la copia mensual de septiembre").
 * B. Mueve (no copia) el archivo de Octubre existente a WB/2026/, sin cambiar su ID ni resetearlo;
 *    su identidad ya es consistente (creada por `createMonth`), asi que `Orchestrator.loadContext`
 *    basta para auto-sanar WORKBOOK_ROLE/MAIN_FILE_ID (ambos ausentes hasta ahora, sin conflicto).
 * C. Restaura el MAIN: `Orchestrator.loadContext` auto-asigna WORKBOOK_ROLE=MAIN (su ID coincide con
 *    WB_KNOWN.MAIN_FILE_ID) y renombra a "Pairings WB"; luego limpia sus propias hojas operacionales
 *    (ya copiadas a salvo en el paso A) para que nunca vuelva a ser un segundo owner de INS/ACT.
 */
function migrateMainAndSeptember() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    throw new Error('Ya hay una migracion u otra operacion de Pairings WB en curso. Intente nuevamente en unos minutos.');
  }
  var log = [];
  try {
    var mainId = WB_KNOWN.MAIN_FILE_ID;
    var mainSs = SpreadsheetApp.openById(mainId);

    // --- A. Septiembre: copia mensual, SOLO si no existe ya una valida. ---------------------
    var septResolved = MonthlyWorkbookService.resolveMonth(MIGRATION_SEPTEMBER_YEAR_, MIGRATION_SEPTEMBER_MONTH_);
    var septFileId;
    if (septResolved.found) {
      septFileId = septResolved.fileId;
      log.push('Paso A: Septiembre 2026 ya existia como mensual valido (' + septFileId + '); no se duplico.');
    } else {
      var mainRowsBefore = SheetStructure.readResumenRows(mainSs).rows;
      var yearFolderForSept = ensureYearFolder(MIGRATION_SEPTEMBER_YEAR_);
      var septName = buildMonthlyWorkbookName(MIGRATION_SEPTEMBER_YEAR_, MIGRATION_SEPTEMBER_MONTH_);
      var septCopyFile = DriveApp.getFileById(mainId).makeCopy(septName, yearFolderForSept);
      septFileId = septCopyFile.getId();

      try {
        var septSs = SpreadsheetApp.openById(septFileId);
        var septRowsAfter = SheetStructure.readResumenRows(septSs).rows;
        // Verificacion de CONTENIDO (assignment_id/INS/ACT/Pairing), no solo de cantidad: una copia
        // con el mismo total de filas pero contenido distinto tambien debe abortar antes de tocar
        // el MAIN (Seccion 4: "nunca perder contenido antes de verificar la copia").
        if (!resumenRowsMatchExactly_(mainRowsBefore, septRowsAfter)) {
          throw new Error('La copia de Septiembre (' + septRowsAfter.length + ' asignaciones) no coincide exactamente ' +
            'con el contenido del MAIN antes de copiar (' + mainRowsBefore.length + ' asignaciones). Abortando sin tocar el MAIN.');
        }
        ConfigService.ensureDefaults(septSs);
        ConfigService.writeValues(septSs, {
          WORKBOOK_ROLE: WORKBOOK_ROLE.MONTH,
          MAIN_FILE_ID: mainId,
          MONTH_FILE_ID: septFileId,
          REFERENCE_YEAR: String(MIGRATION_SEPTEMBER_YEAR_),
          REFERENCE_MONTH: String(MIGRATION_SEPTEMBER_MONTH_),
        });
        WorkbookRegistry.set(MIGRATION_SEPTEMBER_YEAR_, MIGRATION_SEPTEMBER_MONTH_, septFileId);
        ensureOpenTriggerForSpreadsheet(septFileId);
        log.push('Paso A: Septiembre 2026 creado como mensual (' + septFileId + '), ' + septRowsAfter.length + ' asignaciones verificadas por contenido exacto contra el MAIN.');
      } catch (septError) {
        try { septCopyFile.setTrashed(true); } catch (cleanupError) { /* mejor esfuerzo: si ni el trash funciona, queda un archivo huerfano para revision manual */ }
        throw new Error('No se pudo inicializar la copia mensual de Septiembre (se revirtio la copia parcial): ' + septError.message);
      }
    }

    // --- B. Octubre: mover (no copiar) a la carpeta del anio. --------------------------------
    var yearFolderForOct = ensureYearFolder(MIGRATION_OCTOBER_YEAR_);
    var octFile = DriveApp.getFileById(MIGRATION_OCTOBER_FILE_ID_);
    var octParents = octFile.getParents();
    var alreadyInYearFolder = false;
    var otherParents = [];
    while (octParents.hasNext()) {
      var p = octParents.next();
      if (p.getId() === yearFolderForOct.getId()) alreadyInYearFolder = true;
      else otherParents.push(p);
    }
    if (!alreadyInYearFolder) {
      yearFolderForOct.addFile(octFile);
      otherParents.forEach(function (parentFolder) { parentFolder.removeFile(octFile); });
      log.push('Paso B: Octubre 2026 (' + MIGRATION_OCTOBER_FILE_ID_ + ') movido a la carpeta ' + MIGRATION_OCTOBER_YEAR_ + '.');
    } else {
      log.push('Paso B: Octubre 2026 ya estaba en la carpeta del anio; no se movio.');
    }
    // Identidad de Octubre ya es consistente (creado por createMonth): loadContext solo auto-sana
    // WORKBOOK_ROLE/MAIN_FILE_ID, ambos ausentes hasta ahora -- nunca un MISMATCH aqui.
    Orchestrator.loadContext(SpreadsheetApp.openById(MIGRATION_OCTOBER_FILE_ID_));
    WorkbookRegistry.set(MIGRATION_OCTOBER_YEAR_, MIGRATION_OCTOBER_MONTH_, MIGRATION_OCTOBER_FILE_ID_);
    ensureOpenTriggerForSpreadsheet(MIGRATION_OCTOBER_FILE_ID_);

    // --- C. Restaurar el MAIN. ----------------------------------------------------------------
    Orchestrator.loadContext(mainSs); // auto-asigna WORKBOOK_ROLE=MAIN, MAIN_FILE_ID=propio ID, renombra a "Pairings WB"
    MonthlyWorkbookService.clearOperationalSheetData_(mainSs); // ya copiado a salvo en el paso A
    log.push('Paso C: MAIN restaurado (WORKBOOK_ROLE=MAIN, título="' + mainSs.getName() + '"), hojas operacionales limpiadas.');

    return {
      log: log, mainFileId: mainId, septemberFileId: septFileId,
      octoberFileId: MIGRATION_OCTOBER_FILE_ID_, yearFolderId: yearFolderForOct.getId(),
    };
  } finally {
    lock.releaseLock();
  }
}
