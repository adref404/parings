/**
 * 57_RenderSchedule.js
 * ScheduleRenderer: matriz horizontal de Cronograma (Seccion 23). Carriles via interval
 * partitioning (45_Lanes.js); el numero de carril es solo posicion visual de ESTA ejecucion,
 * nunca una identidad persistida. Guard band para pairings que cruzan el limite del mes.
 *
 * La parte pura (buildScheduleGrid) es testeable desde Node; SOLO la escritura final a Sheets
 * (ScheduleRenderer.writeToSheet, con merge de celdas) depende de SpreadsheetApp.
 */

if (typeof module !== 'undefined' && module.exports) {
  var __DateUtil57 = require('./05_DateUtil.js');
  var duEpochDay57 = __DateUtil57.duEpochDay;
  var duFromEpochDay57 = __DateUtil57.duFromEpochDay;
  var duSortKey57 = __DateUtil57.duSortKey;
  var duFormatDisplay57 = __DateUtil57.duFormatDisplay;
  var duDowCode57 = __DateUtil57.duDowCode;
  var __Lanes57 = require('./45_Lanes.js');
  var assignLanes57 = __Lanes57.assignLanes;
  var GUARD_BAND_DAYS57 = require('./25_BigQueryGateway.js').GUARD_BAND_DAYS;
  var DOW_ES57 = require('./55_RenderSummary.js').DOW_ES;
} else {
  var duEpochDay57 = duEpochDay, duFromEpochDay57 = duFromEpochDay, duSortKey57 = duSortKey,
      duFormatDisplay57 = duFormatDisplay, duDowCode57 = duDowCode, assignLanes57 = assignLanes,
      GUARD_BAND_DAYS57 = GUARD_BAND_DAYS, DOW_ES57 = DOW_ES;
}

/**
 * Construye la grilla pura de Cronograma a partir de filas reconciliadas con pairing respaldando
 * (ACTIVE/RELINKED_IDENTICAL/NEW). No escribe nada; devuelve una estructura lista para renderizar.
 */
function buildScheduleGrid(reconciledRows, config) {
  var year = parseInt(config.REFERENCE_YEAR, 10);
  var month = parseInt(config.REFERENCE_MONTH, 10);
  var monthStart = { y: year, m: month, d: 1 };
  var monthStartNext = month === 12 ? { y: year + 1, m: 1, d: 1 } : { y: year, m: month + 1, d: 1 };
  var monthEnd = duFromEpochDay57(duEpochDay57(monthStartNext) - 1);

  var withPairing = reconciledRows.filter(function (r) { return r.pairing && r.pairing.occupied_start_date && r.pairing.occupied_end_date; });

  var minEpoch = duEpochDay57(monthStart) - GUARD_BAND_DAYS57;
  var maxEpoch = duEpochDay57(monthEnd) + GUARD_BAND_DAYS57;
  withPairing.forEach(function (r) {
    minEpoch = Math.min(minEpoch, duEpochDay57(r.pairing.occupied_start_date));
    maxEpoch = Math.max(maxEpoch, duEpochDay57(r.pairing.occupied_end_date));
  });
  // Cota de seguridad: nunca extender la grilla mas alla de un mes completo de guarda a cada lado.
  minEpoch = Math.max(minEpoch, duEpochDay57(monthStart) - 31);
  maxEpoch = Math.min(maxEpoch, duEpochDay57(monthEnd) + 31);

  var dateColumns = [];
  for (var e = minEpoch; e <= maxEpoch; e++) dateColumns.push(duFromEpochDay57(e));

  var intervals = withPairing.map(function (r) {
    return {
      id: r.assignment_id,
      startKey: duSortKey57(r.pairing.occupied_start_date, r.pairing.occupied_start_time),
      endKey: duSortKey57(r.pairing.occupied_end_date, r.pairing.occupied_end_time),
    };
  });
  var lanes = assignLanes57(intervals);

  // La cota de seguridad de arriba (+/-31 dias) puede, en teoria, dejar el rango real de un pairing
  // parcial o totalmente fuera de la grilla (dato defectuoso, o un occupied_days futuro mucho mayor
  // al actual MAX_OCCUPIED_DAYS). Cada bloque se acota a [0, dateColumns.length-1]; si el pairing
  // completo queda fuera, se excluye en vez de generar un indice negativo o un merge() invalido.
  var lastColIndex = dateColumns.length - 1;
  var blocks = [];
  withPairing.forEach(function (r) {
    var rawStart = duEpochDay57(r.pairing.occupied_start_date) - minEpoch;
    var rawEnd = duEpochDay57(r.pairing.occupied_end_date) - minEpoch;
    if (rawEnd < 0 || rawStart > lastColIndex) return; // totalmente fuera de la grilla
    var startCol = Math.max(0, rawStart);
    var endCol = Math.min(lastColIndex, rawEnd);
    var label = r.pairing_id + ' ' + (r.pairing.route_display || '') + (r.INS ? (' - ' + r.INS) : '');
    blocks.push({ lane: lanes.laneById[r.assignment_id], startColIndex: startCol, endColIndex: endCol, label: label, assignment_id: r.assignment_id });
  });

  return { dateColumns: dateColumns, laneCount: Math.max(lanes.totalLanes, 1), blocks: blocks };
}

/** Encabezados de columna de fecha: "DD/MM\nLUN". */
function dateColumnHeader(date) {
  return duFormatDisplay57(date) + ' ' + (DOW_ES57[duDowCode57(date)] || '');
}

var ScheduleRenderer = {
  build: buildScheduleGrid,
  dateColumnHeader: dateColumnHeader,

  /** Escribe la grilla en la hoja Cronograma: rompe merges previos, escribe valores, vuelve a fusionar. */
  writeToSheet: function (sheet, grid) {
    sheet.clearContents();
    if (sheet.getMaxRows() > 1) {
      try { sheet.getRange(1, 1, sheet.getMaxRows(), Math.max(sheet.getMaxColumns(), 1)).breakApart(); } catch (e) { /* sin merges previos */ }
    }

    var headerRow = ['Pairing / INS'].concat(grid.dateColumns.map(dateColumnHeader));
    var totalCols = headerRow.length;
    var totalRows = grid.laneCount + 1;

    var matrix = [headerRow];
    for (var lane = 0; lane < grid.laneCount; lane++) {
      matrix.push(new Array(totalCols).fill(''));
    }
    grid.blocks.forEach(function (b) {
      matrix[b.lane + 1][b.startColIndex + 1] = b.label;
    });

    SheetStructure.ensureMinRows(sheet, totalRows);
    SheetStructure.ensureMinColumns(sheet, totalCols);
    sheet.getRange(1, 1, totalRows, totalCols).setValues(matrix);

    grid.blocks.forEach(function (b) {
      var span = b.endColIndex - b.startColIndex + 1;
      if (span > 1) sheet.getRange(b.lane + 2, b.startColIndex + 2, 1, span).merge();
    });
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { buildScheduleGrid: buildScheduleGrid, dateColumnHeader: dateColumnHeader, ScheduleRenderer: ScheduleRenderer };
}
