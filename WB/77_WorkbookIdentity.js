/**
 * 77_WorkbookIdentity.js
 * Logica PURA (sin SpreadsheetApp/DriveApp/PropertiesService/ScriptApp) del modelo "1 Apps Script
 * central + 1 MAIN permanente + N Spreadsheets mensuales independientes por carpeta anual" (D23/D24
 * en docs/DECISIONS.md): calculo del mes siguiente, nombre/clave canonicos de un archivo mensual,
 * plan de reseteo de `_CONFIG` para un mes recien creado, reconciliacion de `MONTH_FILE_ID`/
 * `MAIN_FILE_ID`/`WORKBOOK_ROLE` contra la identidad real del archivo, resolucion del mensual que
 * "ve" el MAIN (CURRENT_MONTH/LATEST_CREATED), y las decisiones del trigger diario de auto-creacion.
 * Toda la I/O real (Drive/Sheets/ScriptApp/PropertiesService) vive en 85_MonthlyWorkbook.js, que
 * consume estas funciones.
 *
 * Se numera 77 (antes de 80_Orchestrator.js, que necesita decideMonthFileIdSelfHeal) y despues de
 * 65_History.js (reutiliza SPANISH_MONTHS) y 00_Constants.js (reutiliza SNAPSHOT_CERTIFICATION,
 * WORKBOOK_ROLE).
 */

if (typeof module !== 'undefined' && module.exports) {
  var __History77 = require('./65_History.js');
  var SPANISH_MONTHS77 = __History77.SPANISH_MONTHS;
  var __Constants77 = require('./00_Constants.js');
  var SNAPSHOT_CERTIFICATION77 = __Constants77.SNAPSHOT_CERTIFICATION;
  var WORKBOOK_ROLE77 = __Constants77.WORKBOOK_ROLE;
} else {
  var SPANISH_MONTHS77 = SPANISH_MONTHS;
  var SNAPSHOT_CERTIFICATION77 = SNAPSHOT_CERTIFICATION;
  var WORKBOOK_ROLE77 = WORKBOOK_ROLE;
}

function pad2Month77_(n) {
  return (n < 10 ? '0' : '') + n;
}

/** {year, month} del mes calendario siguiente. Maneja el corte de anio (Diciembre -> Enero, M2). */
function computeNextMonth(year, month) {
  var y = parseInt(year, 10);
  var m = parseInt(month, 10);
  if (m === 12) return { year: y + 1, month: 1 };
  return { year: y, month: m + 1 };
}

/** "2026","10" -> "2026-10": clave estable YYYY-MM (mes siempre con cero a la izquierda). */
function buildMonthKey(year, month) {
  return parseInt(year, 10) + '-' + pad2Month77_(parseInt(month, 10));
}

/** Nombre EXACTO del archivo mensual (Seccion 2 de la mision): "Pairings WB - OCTUBRE 2026". */
function buildMonthlyWorkbookName(year, month) {
  var idx = parseInt(month, 10);
  var name = SPANISH_MONTHS77[idx] || ('MES' + idx);
  return 'Pairings WB - ' + name + ' ' + parseInt(year, 10);
}

/**
 * Inversa aproximada de buildMonthlyWorkbookName: extrae {year, month} de un titulo de archivo, o
 * null si no calza el patron exacto. Usado SOLO como candidato inicial al escanear la carpeta
 * (Seccion 5 de la mision) -- nunca como prueba suficiente por si sola, siempre se verifica ademas
 * contra `_CONFIG.REFERENCE_YEAR/REFERENCE_MONTH` del archivo (ver 85_MonthlyWorkbook.js).
 */
function parseMonthlyWorkbookName(name) {
  var s = String(name || '').trim();
  var m = /^Pairings WB - ([A-ZÁÉÍÓÚ]+) (\d{4})$/.exec(s);
  if (!m) return null;
  var monthIdx = SPANISH_MONTHS77.indexOf(m[1]);
  if (monthIdx < 1) return null;
  return { year: parseInt(m[2], 10), month: monthIdx };
}

/** Clave de Script Properties para el registro durable YYYY-MM -> spreadsheetId (Seccion 5). */
function buildRegistryPropertyKey(year, month) {
  return 'WB_MONTH_FILE_' + buildMonthKey(year, month);
}

/**
 * Valores de `_CONFIG` que un mes RECIEN CREADO debe tener siempre (Seccion 2 de la mision):
 * periodo nuevo, snapshot sin certificar, MONTH_FILE_ID apuntando al propio archivo, rol MONTH y
 * MAIN_FILE_ID apuntando al MAIN fijo (D24: nunca hereda WORKBOOK_ROLE=MAIN de la plantilla). NO
 * incluye ninguna clave operacional (CREW_BASE_CODE, rutas, BIGQUERY_JOB_PROJECT_ID, etc.): esas se
 * heredan tal cual del archivo plantilla (el MAIN), nunca se reescriben aqui.
 */
function buildMonthResetConfigValues(year, month, fileId, mainFileId) {
  return {
    REFERENCE_YEAR: String(parseInt(year, 10)),
    REFERENCE_MONTH: String(parseInt(month, 10)),
    MONTH_FILE_ID: String(fileId),
    WORKBOOK_ROLE: WORKBOOK_ROLE77.MONTH,
    MAIN_FILE_ID: String(mainFileId),
    LOAD_KEY_ID: 'PENDING_CERTIFICATION',
    LOAD_TYPE_CODE: 'PENDING_CERTIFICATION',
    LOAD_VERSION_ID: 'PENDING_CERTIFICATION',
    INGESTION_DATETIME: 'PENDING_CERTIFICATION',
    SNAPSHOT_CERTIFICATION: SNAPSHOT_CERTIFICATION77.PENDING,
  };
}

/**
 * Nucleo generico compartido por decideMonthFileIdSelfHeal/decideMainFileIdSelfHeal: auto-asigna un
 * campo de identidad fijo si esta vacio, o bloquea con un mensaje accionable si no coincide con el
 * valor esperado. `fieldLabel`/`hint` solo cambian el texto del error, nunca la decision.
 */
function decideFixedIdSelfHeal_(currentValue, expectedId, fieldLabel, hint) {
  var current = String(currentValue || '').trim();
  if (!current) return { action: 'SELF_ASSIGN', value: String(expectedId) };
  if (current !== String(expectedId)) {
    return {
      action: 'MISMATCH',
      error: 'Este archivo no coincide con su ' + fieldLabel + ' esperado en _CONFIG ' +
        '(esperado=' + expectedId + ', encontrado=' + current + '). ' + hint,
    };
  }
  return { action: 'OK' };
}

/**
 * Decide como reconciliar `_CONFIG.MONTH_FILE_ID` contra el ID real del Spreadsheet que lo contiene
 * (Seccion 1 y 6 de la mision): auto-asignacion segura si esta vacio (primera vez que se ve este
 * archivo -- incluye Septiembre migrando sin esta clave todavia), o bloqueo explicito si no
 * coincide (indicio de una copia hecha fuera de "Pairings WB > Meses > Crear mes", que arrastraria
 * el MONTH_FILE_ID del archivo de origen). Pura: no escribe nada, solo decide.
 */
function decideMonthFileIdSelfHeal(monthFileIdValue, selfId) {
  return decideFixedIdSelfHeal_(monthFileIdValue, selfId, 'MONTH_FILE_ID',
    'Probablemente es una copia hecha fuera de "Pairings WB > Meses > Crear mes". Contacte a un administrador antes de usarlo.');
}

/**
 * Decide como reconciliar `_CONFIG.MAIN_FILE_ID` contra el MAIN fijo conocido (D24, Seccion 1 de la
 * mision): todo archivo del ecosistema (MAIN o MONTH) debe apuntar al mismo MAIN_FILE_ID. Vacio ->
 * auto-asignacion; distinto -> bloqueo (indicio de un archivo ajeno al ecosistema, o de una copia
 * de un MAIN/mensual de otro entorno). Pura.
 */
function decideMainFileIdSelfHeal(mainFileIdValue, expectedMainId) {
  return decideFixedIdSelfHeal_(mainFileIdValue, expectedMainId, 'MAIN_FILE_ID',
    'Todo archivo de Pairings WB (MAIN o mensual) debe apuntar al mismo MAIN_FILE_ID fijo. Contacte a un administrador antes de usarlo.');
}

/**
 * Decide el `WORKBOOK_ROLE` efectivo de un archivo (D24, Seccion 1 de la mision): si ya declara un
 * rol valido, lo respeta (con una verificacion de consistencia fisica para MAIN: su ID debe ser
 * exactamente el MAIN fijo, o es una copia indebida). Si esta vacio (archivo legacy pre-D24, o el
 * MAIN mismo la primera vez que corre este codigo), se auto-asigna por identidad fisica: MAIN si
 * `ssId === mainFileIdKnown`, MONTH en cualquier otro caso. Pura: no escribe nada, solo decide.
 * Esta es la garantia central de "MAIN nunca se renombra a un mes": ningun mensual puede terminar
 * con rol MAIN salvo que su ID sea literalmente el MAIN fijo.
 */
function decideWorkbookRole(roleValue, ssId, mainFileIdKnown) {
  var role = String(roleValue || '').trim().toUpperCase();
  if (role === WORKBOOK_ROLE77.MAIN) {
    if (String(ssId) !== String(mainFileIdKnown)) {
      return {
        action: 'MISMATCH',
        error: 'Este archivo declara WORKBOOK_ROLE=MAIN en _CONFIG pero su ID (' + ssId + ') no es ' +
          'el MAIN fijo (' + mainFileIdKnown + '). Probablemente es una copia indebida del archivo ' +
          'MAIN. Contacte a un administrador antes de usarlo.',
      };
    }
    return { action: 'OK', role: WORKBOOK_ROLE77.MAIN };
  }
  if (role === WORKBOOK_ROLE77.MONTH) {
    return { action: 'OK', role: WORKBOOK_ROLE77.MONTH };
  }
  if (role === '') {
    var inferred = String(ssId) === String(mainFileIdKnown) ? WORKBOOK_ROLE77.MAIN : WORKBOOK_ROLE77.MONTH;
    return { action: 'SELF_ASSIGN', role: inferred };
  }
  return { action: 'MISMATCH', error: 'WORKBOOK_ROLE desconocido en _CONFIG: "' + roleValue + '". Valores validos: MAIN, MONTH.' };
}

/**
 * Titulo canonico esperado para un archivo mensual dado su REFERENCE_YEAR/MONTH (Seccion 6 de la
 * mision: migracion segura del titulo de Septiembre, generalizada a cualquier mes). Pura: decide,
 * no renombra.
 */
function decideCanonicalTitle(currentTitle, year, month) {
  if (!year || !month) return { action: 'SKIP' }; // config aun sin periodo valido: nada que decidir
  var expected = buildMonthlyWorkbookName(year, month);
  if (String(currentTitle || '').trim() === expected) return { action: 'OK' };
  return { action: 'RENAME', value: expected };
}

/** Titulo fijo y permanente del MAIN (D24, Seccion 1 de la mision: "MAIN nunca se renombra a un mes"). */
var MAIN_CANONICAL_TITLE = 'Pairings WB';

/** Analogo a decideCanonicalTitle pero para el MAIN: su titulo NUNCA es un nombre de mes. Pura. */
function decideMainCanonicalTitle(currentTitle) {
  if (String(currentTitle || '').trim() === MAIN_CANONICAL_TITLE) return { action: 'OK' };
  return { action: 'RENAME', value: MAIN_CANONICAL_TITLE };
}

/**
 * Gate PURO (D24, Seccion 2 de la mision: "MAIN no debe convertirse en segundo owner de INS/ACT")
 * que decide si un rol puede ser el TARGET directo del pipeline de calculo (Orchestrator.runPipeline/
 * certifySnapshot/applyJobProject). El MAIN nunca es un target valido: toda accion de calculo debe
 * resolverse primero a un mensual concreto (ver MainWorkbookService.resolveContext,
 * 85_MonthlyWorkbook.js). Pura: solo decide, el llamador es quien lanza el error real.
 */
function decidePipelineTargetAllowed(role) {
  if (role === WORKBOOK_ROLE77.MAIN) {
    return {
      allowed: false,
      reason: 'El archivo MAIN es un centro de control, no un mes operativo. Esta accion debe ' +
        'ejecutarse sobre el mensual resuelto (mes actual o el ultimo creado), nunca sobre el MAIN ' +
        'directamente.',
    };
  }
  return { allowed: true, reason: 'OK' };
}

// -------------------------------------------------------------------------------------------
// Carpetas anuales (D24, Seccion 3 de la mision): "WB/<year>/" agrupa los mensuales de un anio.
// -------------------------------------------------------------------------------------------

/** Nombre EXACTO de la carpeta anual: el anio como string, sin ceros ni separadores ("2026"). Pura. */
function buildYearFolderName(year) {
  return String(parseInt(year, 10));
}

/**
 * Decide que hacer dado el conjunto de carpetas YA ENCONTRADAS que calzan con el nombre exacto del
 * anio (Seccion 3: "si existe, reutilizarla; si no, crear una sola; nunca duplicar por
 * retry/concurrencia"). Si hay 1+, se reutiliza SIEMPRE la primera (nunca se crea una nueva aunque
 * haya mas de una por una carrera historica -- eso se resuelve manualmente, no creando una tercera).
 * Pura: no toca DriveApp, solo decide sobre una lista ya obtenida por el llamador.
 */
function decideEnsureFolderAction(matchingFolderIds) {
  var ids = matchingFolderIds || [];
  if (ids.length > 0) return { action: 'REUSE', id: ids[0] };
  return { action: 'CREATE' };
}

// -------------------------------------------------------------------------------------------
// Registro de meses (Seccion 5 de la mision): inversa de buildRegistryPropertyKey, para poder
// enumerar TODOS los meses registrados a partir de las claves de Script Properties.
// -------------------------------------------------------------------------------------------

/** Inversa de buildRegistryPropertyKey: "WB_MONTH_FILE_2026-10" -> {year:2026, month:10}, o null si no calza. Pura. */
function parseRegistryPropertyKey(key) {
  var m = /^WB_MONTH_FILE_(\d{4})-(\d{2})$/.exec(String(key || ''));
  if (!m) return null;
  var month = parseInt(m[2], 10);
  if (month < 1 || month > 12) return null;
  return { year: parseInt(m[1], 10), month: month };
}

// -------------------------------------------------------------------------------------------
// Vista del MAIN (D24, Seccion 5 de la mision): que mensual "refleja/muestra" el MAIN por defecto.
// -------------------------------------------------------------------------------------------

var MAIN_VIEW_MODE = Object.freeze({ CURRENT_MONTH: 'CURRENT_MONTH', LATEST_CREATED: 'LATEST_CREATED' });
var MAIN_VIEW_DEFAULTS = Object.freeze({ MAIN_VIEW_MODE: MAIN_VIEW_MODE.CURRENT_MONTH });

/** Parsea el valor CENTRAL (Script Properties) de MAIN_VIEW_MODE, con default CURRENT_MONTH ante ausente/invalido. Pura. */
function decideMainViewSettings(props) {
  var raw = String((props && props.MAIN_VIEW_MODE) || '').trim().toUpperCase();
  var viewMode = (raw === MAIN_VIEW_MODE.CURRENT_MONTH || raw === MAIN_VIEW_MODE.LATEST_CREATED)
    ? raw : MAIN_VIEW_DEFAULTS.MAIN_VIEW_MODE;
  return { viewMode: viewMode };
}

/**
 * Ordena los mensuales REGISTRADOS (Seccion 5) por preferencia de resolucion del MAIN, sin tocar
 * DriveApp/PropertiesService (esos candidatos ya vienen resueltos por el llamador desde el
 * registro). `registryEntries`: [{year, month, monthKey, fileId}, ...] en cualquier orden.
 *
 * - LATEST_CREATED: todos, del mas nuevo al mas viejo (por monthKey "YYYY-MM", orden lexicografico
 *   ya es orden cronologico gracias al cero a la izquierda del mes).
 * - CURRENT_MONTH (default): primero el que calza exactamente con hoy, luego el resto del mas nuevo
 *   al mas viejo como fallback (Seccion 5: "si no existe, fallback = ultimo mensual registrado
 *   valido").
 *
 * Devuelve un ARREGLO ordenado (no un unico resultado) para que el llamador (I/O) pueda intentar
 * verificar fisicamente cada candidato en orden y saltar al siguiente si el primero no es valido
 * (archivo borrado/corrupto/movido) sin volver a resolver todo desde cero. Pura.
 */
function rankMainViewCandidates(settings, registryEntries, todayYear, todayMonth) {
  var entries = (registryEntries || []).slice();
  if (entries.length === 0) return [];

  var sortedDesc = entries.slice().sort(function (a, b) {
    return a.monthKey < b.monthKey ? 1 : (a.monthKey > b.monthKey ? -1 : 0);
  });

  if (settings.viewMode === MAIN_VIEW_MODE.LATEST_CREATED) return sortedDesc;

  var currentKey = buildMonthKey(todayYear, todayMonth);
  var exact = sortedDesc.filter(function (e) { return e.monthKey === currentKey; });
  var rest = sortedDesc.filter(function (e) { return e.monthKey !== currentKey; });
  return exact.concat(rest);
}

/** Defaults de la automatizacion CENTRAL (Script Properties, NO por-archivo: Seccion 4 de la mision). */
var CENTRAL_AUTOMATION_DEFAULTS = Object.freeze({ AUTO_CREATE_NEXT_MONTH: 'TRUE', AUTO_CREATE_DAY: '20' });

/**
 * Parsea el objeto plano de Script Properties centrales (o {}/valores ausentes) a settings
 * tipados, aplicando CENTRAL_AUTOMATION_DEFAULTS para cualquier clave no configurada todavia.
 */
function decideCentralAutomationSettings(props) {
  var p = props || {};
  var enabledRaw = p.AUTO_CREATE_NEXT_MONTH !== undefined && p.AUTO_CREATE_NEXT_MONTH !== null
    ? p.AUTO_CREATE_NEXT_MONTH : CENTRAL_AUTOMATION_DEFAULTS.AUTO_CREATE_NEXT_MONTH;
  var dayRaw = p.AUTO_CREATE_DAY !== undefined && p.AUTO_CREATE_DAY !== null
    ? p.AUTO_CREATE_DAY : CENTRAL_AUTOMATION_DEFAULTS.AUTO_CREATE_DAY;
  var day = parseInt(dayRaw, 10);
  return {
    enabled: String(enabledRaw).trim().toUpperCase() === 'TRUE',
    autoCreateDay: isNaN(day) ? parseInt(CENTRAL_AUTOMATION_DEFAULTS.AUTO_CREATE_DAY, 10) : day,
  };
}

/**
 * Decision PURA del trigger diario (Seccion 4 de la mision): dado el dia/mes/anio de HOY (ya
 * resueltos por el llamador via Session.getScriptTimeZone(), nunca por este modulo -- mantiene la
 * regla del proyecto de no usar new Date(string)/timezone implicito aqui), decide si corresponde
 * intentar crear el mes calendario siguiente. Nunca decide CREAR de verdad: eso es I/O
 * (MonthlyWorkbookService.createMonth), que ya es idempotente por si solo.
 */
function decideAutoCreateShouldRun(settings, todayYear, todayMonth, todayDayOfMonth) {
  if (!settings.enabled) return { shouldRun: false, reason: 'AUTO_CREATE_NEXT_MONTH=FALSE' };
  var day = parseInt(todayDayOfMonth, 10);
  if (day < settings.autoCreateDay) {
    return { shouldRun: false, reason: 'dia ' + day + ' < AUTO_CREATE_DAY (' + settings.autoCreateDay + ')' };
  }
  var target = computeNextMonth(todayYear, todayMonth);
  return { shouldRun: true, targetYear: target.year, targetMonth: target.month, reason: 'OK' };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    computeNextMonth: computeNextMonth,
    buildMonthKey: buildMonthKey,
    buildMonthlyWorkbookName: buildMonthlyWorkbookName,
    parseMonthlyWorkbookName: parseMonthlyWorkbookName,
    buildRegistryPropertyKey: buildRegistryPropertyKey,
    parseRegistryPropertyKey: parseRegistryPropertyKey,
    buildMonthResetConfigValues: buildMonthResetConfigValues,
    decideMonthFileIdSelfHeal: decideMonthFileIdSelfHeal,
    decideMainFileIdSelfHeal: decideMainFileIdSelfHeal,
    decideWorkbookRole: decideWorkbookRole,
    decideCanonicalTitle: decideCanonicalTitle,
    decideMainCanonicalTitle: decideMainCanonicalTitle,
    MAIN_CANONICAL_TITLE: MAIN_CANONICAL_TITLE,
    decidePipelineTargetAllowed: decidePipelineTargetAllowed,
    buildYearFolderName: buildYearFolderName,
    decideEnsureFolderAction: decideEnsureFolderAction,
    MAIN_VIEW_MODE: MAIN_VIEW_MODE,
    MAIN_VIEW_DEFAULTS: MAIN_VIEW_DEFAULTS,
    decideMainViewSettings: decideMainViewSettings,
    rankMainViewCandidates: rankMainViewCandidates,
    CENTRAL_AUTOMATION_DEFAULTS: CENTRAL_AUTOMATION_DEFAULTS,
    decideCentralAutomationSettings: decideCentralAutomationSettings,
    decideAutoCreateShouldRun: decideAutoCreateShouldRun,
  };
}
