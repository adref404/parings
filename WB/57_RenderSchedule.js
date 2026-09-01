/**
 * 57_RenderSchedule.js
 * ScheduleRenderer: matriz horizontal de Cronograma reproduciendo la UX LIVE (correccion posterior
 * a D15): fila 1 = dia de semana completo en espanol MINUSCULA, fila 2 = fecha DD/MM/YYYY (texto,
 * D14: nunca Date nativo), filas 3+ = carriles operacionales. Los carriles se asignan via interval
 * partitioning (45_Lanes.js); el numero de carril es solo posicion visual de ESTA ejecucion, nunca
 * una identidad persistida.
 *
 * Sin guarda estatica: por defecto la grilla es EXACTAMENTE el mes de referencia (evidencia LIVE:
 * 30 columnas de septiembre + solo los dias reales hacia octubre que un pairing real ocupa = 32,
 * sin dias de guarda fantasma en ningun extremo). Solo se extiende dinamicamente cuando un pairing
 * REAL cruza el limite del mes, acotado por una cota de seguridad de +/-31 dias.
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
  var DOW_ES57 = require('./55_RenderSummary.js').DOW_ES;
  var buildLegDetailLines57 = require('./56_RenderFlights.js').buildLegDetailLines;
} else {
  var duEpochDay57 = duEpochDay, duFromEpochDay57 = duFromEpochDay, duSortKey57 = duSortKey,
      duFormatDisplay57 = duFormatDisplay, duDowCode57 = duDowCode, assignLanes57 = assignLanes,
      DOW_ES57 = DOW_ES, buildLegDetailLines57 = buildLegDetailLines;
}

/**
 * Etiqueta multilinea del bloque: identidad (Pairing ID + ruta + INS) seguida del detalle de legs,
 * estilo LIVE ("LCK B767 / - LIM-MIA / - LA 2480 (00:15-06:20 hrs)"). Nunca se guarda como PK/FK:
 * es solo el texto visible dentro del bloque.
 */
function buildBlockLabel(reconciledRow) {
  var p = reconciledRow.pairing;
  var header = reconciledRow.pairing_id + ' ' + (p.route_display || '') + (reconciledRow.INS ? (' - ' + reconciledRow.INS) : '');
  return [header].concat(buildLegDetailLines57(p)).join('\n');
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

  // Base = exactamente el mes de referencia, sin dias de guarda estaticos (ver cabecera del archivo).
  var minEpoch = duEpochDay57(monthStart);
  var maxEpoch = duEpochDay57(monthEnd);
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
    blocks.push({ lane: lanes.laneById[r.assignment_id], startColIndex: startCol, endColIndex: endCol, label: buildBlockLabel(r), assignment_id: r.assignment_id });
  });

  return { dateColumns: dateColumns, laneCount: Math.max(lanes.totalLanes, 1), blocks: blocks };
}

/** Fila 1: dia de semana completo en espanol, minuscula (contrato LIVE: "martes", "miércoles", ...). */
function scheduleWeekdayRow(dateColumns) {
  return dateColumns.map(function (d) { return (DOW_ES57[duDowCode57(d)] || '').toLowerCase(); });
}

/** Fila 2: fecha DD/MM/YYYY como texto (D14: nunca Date nativo). */
function scheduleDateRow(dateColumns) {
  return dateColumns.map(function (d) { return duFormatDisplay57(d); });
}

var ScheduleRenderer = {
  build: buildScheduleGrid,
  buildBlockLabel: buildBlockLabel,
  scheduleWeekdayRow: scheduleWeekdayRow,
  scheduleDateRow: scheduleDateRow,

  /**
   * Escribe la grilla en "Cronograma": rompe merges y limpia SOLO el rango que este renderer
   * administra (nunca la hoja completa, nunca clear() destructivo de formato), vuelve a escribir
   * valores en un unico batch y reaplica merges para los bloques multi-dia.
   */
  writeToSheet: function (sheet, grid) {
    var totalCols = grid.dateColumns.length;
    var totalRows = 2 + grid.laneCount;

    SheetStructure.ensureMinColumns(sheet, totalCols);
    SheetStructure.ensureMinRows(sheet, totalRows);

    // Rango administrado = maximo entre lo ya existente y lo nuevo, para no dejar bloques fantasma
    // de una corrida anterior con mas carriles/columnas.
    var manageRows = Math.max(totalRows, sheet.getLastRow());
    var manageCols = Math.max(totalCols, sheet.getLastColumn());
    if (manageRows > 0 && manageCols > 0) {
      var manageRange = sheet.getRange(1, 1, manageRows, manageCols);
      try { manageRange.breakApart(); } catch (e) { /* sin merges previos */ }
      manageRange.clearContent();
    }

    var matrix = [scheduleWeekdayRow(grid.dateColumns), scheduleDateRow(grid.dateColumns)];
    for (var lane = 0; lane < grid.laneCount; lane++) matrix.push(new Array(totalCols).fill(''));
    grid.blocks.forEach(function (b) { matrix[b.lane + 2][b.startColIndex] = b.label; });

    sheet.getRange(1, 1, totalRows, totalCols).setValues(matrix);

    grid.blocks.forEach(function (b) {
      var span = b.endColIndex - b.startColIndex + 1;
      if (span > 1) sheet.getRange(b.lane + 3, b.startColIndex + 1, 1, span).merge();
    });
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    buildScheduleGrid: buildScheduleGrid, buildBlockLabel: buildBlockLabel,
    scheduleWeekdayRow: scheduleWeekdayRow, scheduleDateRow: scheduleDateRow,
    ScheduleRenderer: ScheduleRenderer,
  };
}
