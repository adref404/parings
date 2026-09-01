/**
 * 50_SheetStructure.js
 * Acceso estructural a las hojas del Spreadsheet productivo. Puro glue de SpreadsheetApp: NO
 * decide reglas de negocio, solo lee/asegura estructura y expone lectura/escritura en batch.
 * No testeable desde Node (depende de SpreadsheetApp); se mantiene deliberadamente delgado.
 */

var SheetStructure = {
  /**
   * Abre CUALQUIER Spreadsheet del ecosistema WB por su ID explicito (D23: modelo 1 archivo = 1
   * mes). Reemplaza al antiguo openProductionSpreadsheet(), que abria SIEMPRE el mismo ID fijo
   * (Septiembre) y por eso era incompatible con multiples archivos mensuales independientes. Quien
   * decide QUE fileId corresponde es resolveWorkbookContext_() (85_MonthlyWorkbook.js), nunca este
   * metodo: aqui solo se abre, sin resolver identidad.
   */
  openWorkbookById: function (fileId) {
    return SpreadsheetApp.openById(fileId);
  },

  getOrCreateSheet: function (ss, name) {
    var sheet = ss.getSheetByName(name);
    if (!sheet) sheet = ss.insertSheet(name);
    return sheet;
  },

  /** Compara los encabezados actuales de una hoja (fila 1) contra los esperados. No escribe nada. */
  diffHeaders: function (ss, sheetName, expectedHeaders) {
    var sheet = ss.getSheetByName(sheetName);
    if (!sheet) return { exists: false, matches: false, actual: [] };
    var lastCol = Math.max(sheet.getLastColumn(), 1);
    var actual = sheet.getRange(1, 1, 1, lastCol).getValues()[0].filter(function (v) { return v !== ''; });
    var missing = expectedHeaders.filter(function (h) { return actual.indexOf(h) === -1; });
    return { exists: true, matches: missing.length === 0, actual: actual, missing: missing };
  },

  /** Crea la hoja con encabezados SOLO si no existe. Nunca sobrescribe una hoja ya presente. */
  ensureSheetWithHeaders: function (ss, sheetName, headers) {
    var sheet = ss.getSheetByName(sheetName);
    var created = false;
    if (!sheet) {
      sheet = ss.insertSheet(sheetName);
      sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
      created = true;
    }
    return { sheet: sheet, created: created };
  },

  hideTechnicalSheets: function (ss) {
    TECHNICAL_SHEETS.forEach(function (name) {
      var sheet = ss.getSheetByName(name);
      if (sheet && !sheet.isSheetHidden()) sheet.hideSheet();
    });
  },

  /** Asegura que la hoja tenga al menos `minRows` filas antes de escribir un rango que las necesite. */
  ensureMinRows: function (sheet, minRows) {
    var current = sheet.getMaxRows();
    if (current < minRows) sheet.insertRowsAfter(current, minRows - current);
  },

  /** Asegura que la hoja tenga al menos `minCols` columnas (p.ej. Cronograma, que puede superar las 26 por defecto). */
  ensureMinColumns: function (sheet, minCols) {
    var current = sheet.getMaxColumns();
    if (current < minCols) sheet.insertColumnsAfter(current, minCols - current);
  },

  /**
   * Lee RESUMEN completo como objetos {rowIndex (1-based), ...campos por RESUMEN_COLUMNS}.
   * Omite filas totalmente vacias. rowIndex se usa para escritura dirigida sin reconstruir toda la hoja.
   */
  readResumenRows: function (ss) {
    var sheet = ss.getSheetByName(SHEET_NAMES.RESUMEN);
    if (!sheet) return { sheet: null, rows: [] };
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return { sheet: sheet, rows: [] };
    var numCols = RESUMEN_HEADERS.length;
    var values = sheet.getRange(2, 1, lastRow - 1, numCols).getValues();
    var rows = [];
    values.forEach(function (row, i) {
      var isBlank = row.every(function (c) { return c === '' || c === null; });
      if (isBlank) return;
      var obj = { rowIndex: i + 2 };
      Object.keys(RESUMEN_COLUMNS).forEach(function (key) { obj[key] = row[RESUMEN_COLUMNS[key]]; });
      rows.push(obj);
    });
    return { sheet: sheet, rows: rows };
  },

  /** Escribe la matriz completa de RESUMEN (sin encabezado) de una sola vez (batch write). */
  writeResumenMatrix: function (sheet, matrix) {
    SheetStructure.ensureMinColumns(sheet, RESUMEN_HEADERS.length);
    sheet.getRange(1, 1, 1, RESUMEN_HEADERS.length).setValues([RESUMEN_HEADERS]);
    if (matrix.length === 0) return;
    SheetStructure.ensureMinRows(sheet, matrix.length + 1);
    sheet.getRange(2, 1, matrix.length, RESUMEN_HEADERS.length).setValues(matrix);
    var extraRows = sheet.getMaxRows() - (matrix.length + 1);
    // No se borran filas sobrantes automaticamente para evitar perder formato/validaciones humanas
    // fuera del rango escrito; si hay filas viejas mas alla del nuevo total, se limpian solo sus
    // valores (nunca formato) para que no queden datos fantasma de una fila eliminada.
    if (extraRows > 0) {
      sheet.getRange(matrix.length + 2, 1, extraRows, RESUMEN_HEADERS.length).clearContent();
    }
  },

  /** Lee Diccionario completo como [{INS, BP, NOMBRE}]. */
  readDiccionario: function (ss) {
    var sheet = ss.getSheetByName(SHEET_NAMES.DICCIONARIO);
    if (!sheet) return [];
    var lastRow = sheet.getLastRow();
    if (lastRow < 2) return [];
    var values = sheet.getRange(2, 1, lastRow - 1, DICCIONARIO_HEADERS.length).getValues();
    return values
      .filter(function (row) { return row[0] !== '' && row[0] !== null; })
      .map(function (row) { return { INS: row[0], BP: row[1], NOMBRE: row[2] }; });
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SheetStructure: SheetStructure };
}
