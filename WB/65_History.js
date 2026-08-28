/**
 * 65_History.js
 * Identidad determinista del historico (Seccion 28): history_key + nombre amigable.
 * La creacion/lectura real del Google Sheet historico (DriveApp/SpreadsheetApp) vive en
 * HistoryService, dependiente de Apps Script y no testeable desde Node.
 */

if (typeof module !== 'undefined' && module.exports) {
  var __Hash65 = require('./10_Hash.js');
  var hashFields65 = __Hash65.hashFields;
} else {
  var hashFields65 = hashFields;
}

var SPANISH_MONTHS = [
  '', 'ENERO', 'FEBRERO', 'MARZO', 'ABRIL', 'MAYO', 'JUNIO',
  'JULIO', 'AGOSTO', 'SEPTIEMBRE', 'OCTUBRE', 'NOVIEMBRE', 'DICIEMBRE',
];

/** Orden explicito de los campos que componen el history_key (Seccion 28). */
var HISTORY_KEY_FIELD_ORDER = [
  'schema_version', 'ruleset_id', 'reference_year', 'reference_month',
  'snapshot_key', 'config_hash', 'query_version',
];

/** history_key deterministico: mismo run logico (aunque se ejecute otro dia) -> mismo hash. */
function computeHistoryKey(fields) {
  var ordered = HISTORY_KEY_FIELD_ORDER.map(function (f) { return fields[f]; });
  return hashFields65(ordered);
}

/** "Pairings WB SEPTIEMBRE-2026 [A1B2C3D4E5F6]" */
function buildHistoryFileName(referenceYear, referenceMonth, historyKey) {
  var monthName = SPANISH_MONTHS[parseInt(referenceMonth, 10)] || ('MES' + referenceMonth);
  var shortKey = historyKey.substring(0, 12).toUpperCase();
  return 'Pairings WB ' + monthName + '-' + referenceYear + ' [' + shortKey + ']';
}

/** Extrae el history_key corto (12 hex) embebido en un nombre de archivo generado por buildHistoryFileName. */
function extractShortKeyFromFileName(fileName) {
  var m = /\[([0-9A-F]{12})\]\s*$/.exec(String(fileName || '').trim());
  return m ? m[1] : null;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SPANISH_MONTHS: SPANISH_MONTHS, HISTORY_KEY_FIELD_ORDER: HISTORY_KEY_FIELD_ORDER,
    computeHistoryKey: computeHistoryKey, buildHistoryFileName: buildHistoryFileName,
    extractShortKeyFromFileName: extractShortKeyFromFileName,
  };
}
