/**
 * 77_WorkbookIdentity.js
 * Logica PURA (sin SpreadsheetApp/DriveApp/PropertiesService/ScriptApp) del modelo "1 Apps Script
 * central + N Spreadsheets mensuales independientes" (D23 en docs/DECISIONS.md): calculo del mes
 * siguiente, nombre/clave canonicos de un archivo mensual, plan de reseteo de `_CONFIG` para un mes
 * recien creado, reconciliacion de `MONTH_FILE_ID` contra el ID real del archivo, y las decisiones
 * del trigger diario de auto-creacion. Toda la I/O real (Drive/Sheets/ScriptApp/PropertiesService)
 * vive en 85_MonthlyWorkbook.js, que consume estas funciones.
 *
 * Se numera 77 (antes de 80_Orchestrator.js, que necesita decideMonthFileIdSelfHeal) y despues de
 * 65_History.js (reutiliza SPANISH_MONTHS) y 00_Constants.js (reutiliza SNAPSHOT_CERTIFICATION).
 */

if (typeof module !== 'undefined' && module.exports) {
  var __History77 = require('./65_History.js');
  var SPANISH_MONTHS77 = __History77.SPANISH_MONTHS;
  var __Constants77 = require('./00_Constants.js');
  var SNAPSHOT_CERTIFICATION77 = __Constants77.SNAPSHOT_CERTIFICATION;
} else {
  var SPANISH_MONTHS77 = SPANISH_MONTHS;
  var SNAPSHOT_CERTIFICATION77 = SNAPSHOT_CERTIFICATION;
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
 * periodo nuevo, snapshot sin certificar, MONTH_FILE_ID apuntando al propio archivo. NO incluye
 * ninguna clave operacional (CREW_BASE_CODE, rutas, BIGQUERY_JOB_PROJECT_ID, etc.): esas se heredan
 * tal cual del archivo plantilla (copia de Septiembre), nunca se reescriben aqui.
 */
function buildMonthResetConfigValues(year, month, fileId) {
  return {
    REFERENCE_YEAR: String(parseInt(year, 10)),
    REFERENCE_MONTH: String(parseInt(month, 10)),
    MONTH_FILE_ID: String(fileId),
    LOAD_KEY_ID: 'PENDING_CERTIFICATION',
    LOAD_TYPE_CODE: 'PENDING_CERTIFICATION',
    LOAD_VERSION_ID: 'PENDING_CERTIFICATION',
    INGESTION_DATETIME: 'PENDING_CERTIFICATION',
    SNAPSHOT_CERTIFICATION: SNAPSHOT_CERTIFICATION77.PENDING,
  };
}

/**
 * Decide como reconciliar `_CONFIG.MONTH_FILE_ID` contra el ID real del Spreadsheet que lo contiene
 * (Seccion 1 y 6 de la mision): auto-asignacion segura si esta vacio (primera vez que se ve este
 * archivo -- incluye Septiembre migrando sin esta clave todavia), o bloqueo explicito si no
 * coincide (indicio de una copia hecha fuera de "Pairings WB > Meses > Crear mes", que arrastraria
 * el MONTH_FILE_ID del archivo de origen). Pura: no escribe nada, solo decide.
 */
function decideMonthFileIdSelfHeal(monthFileIdValue, selfId) {
  var current = String(monthFileIdValue || '').trim();
  if (!current) return { action: 'SELF_ASSIGN', value: String(selfId) };
  if (current !== String(selfId)) {
    return {
      action: 'MISMATCH',
      error: 'Este archivo no coincide con su propio MONTH_FILE_ID registrado en _CONFIG ' +
        '(esperado=' + selfId + ', encontrado=' + current + '). Probablemente es una copia hecha ' +
        'fuera de "Pairings WB > Meses > Crear mes". Contacte a un administrador antes de usarlo.',
    };
  }
  return { action: 'OK' };
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
    buildMonthResetConfigValues: buildMonthResetConfigValues,
    decideMonthFileIdSelfHeal: decideMonthFileIdSelfHeal,
    decideCanonicalTitle: decideCanonicalTitle,
    CENTRAL_AUTOMATION_DEFAULTS: CENTRAL_AUTOMATION_DEFAULTS,
    decideCentralAutomationSettings: decideCentralAutomationSettings,
    decideAutoCreateShouldRun: decideAutoCreateShouldRun,
  };
}
