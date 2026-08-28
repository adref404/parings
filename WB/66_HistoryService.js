/**
 * 66_HistoryService.js
 * Creacion/lectura del historico (Seccion 27-29). Depende de DriveApp/SpreadsheetApp: no
 * testeable desde Node (la identidad/nombre deterministicos SI se prueban, en 65_History.js).
 *
 * Idempotencia: se busca primero un archivo existente en HISTORY_FOLDER_ID cuyo nombre contenga
 * el history_key corto (Seccion 28); si existe, se devuelve sin duplicar. Nunca se sobrescribe ni
 * se borra un historico anterior.
 */

var HistoryService = {
  /** Busca un historico ya archivado para este history_key exacto. Devuelve el File o null. */
  findExisting: function (historyKey) {
    var shortKey = historyKey.substring(0, 12).toUpperCase();
    var folder = DriveApp.getFolderById(WB_KNOWN.HISTORY_FOLDER_ID);
    var it = folder.getFilesByType(MimeType.GOOGLE_SHEETS);
    while (it.hasNext()) {
      var file = it.next();
      if (extractShortKeyFromFileName(file.getName()) === shortKey) return file;
    }
    return null;
  },

  /**
   * Crea el historico: copia el Spreadsheet productivo, lo mueve a la carpeta de historicos,
   * congela formulas a valores en todas las hojas y renombra segun buildHistoryFileName.
   * Idempotente: si ya existe uno con el mismo history_key, lo devuelve sin crear un duplicado.
   */
  getOrCreate: function (prodSpreadsheetId, referenceYear, referenceMonth, historyKey) {
    var existing = HistoryService.findExisting(historyKey);
    if (existing) return { fileId: existing.getId(), created: false };

    var fileName = buildHistoryFileName(referenceYear, referenceMonth, historyKey);
    var folder = DriveApp.getFolderById(WB_KNOWN.HISTORY_FOLDER_ID);
    var prodFile = DriveApp.getFileById(prodSpreadsheetId);
    var copy = prodFile.makeCopy(fileName, folder);

    var copySs = SpreadsheetApp.openById(copy.getId());
    freezeAllSheetsToValues(copySs);
    SheetStructure.hideTechnicalSheets(copySs);

    return { fileId: copy.getId(), created: true };
  },
};

/** Convierte cualquier formula remanente en valor estatico, hoja por hoja (Seccion 27: VALUES-ONLY). */
function freezeAllSheetsToValues(ss) {
  ss.getSheets().forEach(function (sheet) {
    var lastRow = sheet.getLastRow();
    var lastCol = sheet.getLastColumn();
    if (lastRow === 0 || lastCol === 0) return;
    var range = sheet.getRange(1, 1, lastRow, lastCol);
    var values = range.getValues();
    range.setValues(values);
  });
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { HistoryService: HistoryService, freezeAllSheetsToValues: freezeAllSheetsToValues };
}
