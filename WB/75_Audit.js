/**
 * 75_Audit.js
 * AuditService: lectura/escritura append-only de _RUNS (Seccion 30-31). Migra el encabezado
 * agregando columnas nuevas al final si hace falta, preservando el orden de las columnas viejas
 * (compatibilidad hacia atras: nunca se reordenan ni se borran columnas existentes).
 */

var AuditService = {
  /** Asegura que _RUNS tenga al menos las columnas de RUNS_HEADERS, migrando el encabezado si hace falta. */
  ensureHeaders: function (ss) {
    var sheet = SheetStructure.getOrCreateSheet(ss, SHEET_NAMES.RUNS);
    var lastCol = sheet.getLastColumn();
    if (lastCol === 0) {
      SheetStructure.ensureMinColumns(sheet, RUNS_HEADERS.length);
      sheet.getRange(1, 1, 1, RUNS_HEADERS.length).setValues([RUNS_HEADERS]);
      return sheet;
    }
    var currentHeaders = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var missing = RUNS_HEADERS.filter(function (h) { return currentHeaders.indexOf(h) === -1; });
    if (missing.length > 0) {
      SheetStructure.ensureMinColumns(sheet, currentHeaders.length + missing.length);
      sheet.getRange(1, currentHeaders.length + 1, 1, missing.length).setValues([missing]);
    }
    return sheet;
  },

  /** Agrega una fila de run al final de _RUNS, mapeando por nombre de columna (nunca por indice fijo). */
  appendRun: function (ss, runRecord) {
    var sheet = AuditService.ensureHeaders(ss);
    var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
    var row = headers.map(function (h) {
      var v = runRecord[h];
      return v === undefined || v === null ? '' : v;
    });
    sheet.appendRow(row);
  },

  /** Devuelve el ultimo run registrado como objeto {header: valor}, o null si _RUNS esta vacio. */
  readLastRun: function (ss) {
    var sheet = ss.getSheetByName(SHEET_NAMES.RUNS);
    if (!sheet) return null;
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return null;
    var lastCol = sheet.getLastColumn();
    var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
    var values = sheet.getRange(lastRow, 1, 1, lastCol).getValues()[0];
    var obj = {};
    headers.forEach(function (h, i) { obj[h] = values[i]; });
    return obj;
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { AuditService: AuditService };
}
