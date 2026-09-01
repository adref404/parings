/**
 * 56_RenderFlights.js
 * FlightsRenderer: reconstruye "Vuelos" reproduciendo la UX de bloques del Spreadsheet LIVE
 * (correccion posterior a D15/docs/DECISIONS.md — el layout leg-level plano anterior NO estaba
 * aprobado). 17 columnas A:Q; filas 1-2 son notas operacionales humanas y NUNCA se tocan; fila 3
 * son encabezados; los bloques (uno por assignment_id, nunca por pairing_id solo — Seccion 7:
 * "un mismo pairing puede tener multiples assignment_id") empiezan en fila 5, con un piso visual
 * de VUELOS_BLOCK_MIN_HEIGHT filas (relleno con filas en blanco si el pairing tiene menos legs).
 *
 * La posicion del bloque es PURAMENTE visual: cada fila lleva su propio assignment_id (columna A)
 * y Pairing ID (columna B) — ningun calculo ni relacion usa el numero de fila como identidad.
 * INS (columna O) y el detalle multilinea de la columna Q se PROYECTAN desde la fila ya
 * reconciliada de RESUMEN; este renderer nunca se convierte en dueño de esos datos.
 */

if (typeof module !== 'undefined' && module.exports) {
  var __DateUtil56 = require('./05_DateUtil.js');
  var duParseDate = __DateUtil56.duParseDate;
  var duParseTime = __DateUtil56.duParseTime;
  var duFormatDisplay = __DateUtil56.duFormatDisplay;
  var duFormatTimeShort = __DateUtil56.duFormatTimeShort;
  var duDowCode = __DateUtil56.duDowCode;
  var DOW_ES = require('./55_RenderSummary.js').DOW_ES;
}

var VUELOS_HEADERS = [
  'assignment_id', 'Pairing ID', 'FECHA REAL', 'MES', 'Day of Week', 'Flight No', 'Dep Stn',
  'Arr Stn', 'STD', 'STA', 'DAY', 'AC Type', 'HBT', 'DIA_DUTY', 'INS', '', 'ACT',
];

/** Piso visual minimo de un bloque (Seccion "critical_findings" de la correccion): nunca identidad. */
var VUELOS_BLOCK_MIN_HEIGHT = 9;
var VUELOS_NOTES_ROWS = 2; // filas 1-2: notas operacionales humanas, jamas escritas por este renderer
var VUELOS_HEADER_ROW = VUELOS_NOTES_ROWS + 1; // fila 3
var VUELOS_FIRST_BLOCK_ROW = VUELOS_HEADER_ROW + 2; // fila 5 (fila 4 queda como separador en blanco)

/**
 * Lineas "- RUTA" / "- CARRIER FLIGHT (STD-STA hrs)" por leg del pairing, estilo detalle
 * multilinea observado en vivo. Puro: reusado tanto por Vuelos (columna Q) como por Cronograma
 * (etiqueta de bloque, 57_RenderSchedule.js).
 */
function buildLegDetailLines(pairing) {
  return pairing.legs.reduce(function (lines, leg) {
    var r = leg.row;
    var std = duFormatTimeShort(duParseTime(r.flight_departure_time_crew_base));
    var sta = duFormatTimeShort(duParseTime(r.flight_arrival_hour_block_time));
    lines.push('- ' + r.departure_airport_code + '-' + r.arrival_airport_code);
    lines.push('- ' + r.carrier_code + ' ' + r.flight_number + ' (' + std + '-' + sta + ' hrs)');
    return lines;
  }, []);
}

function buildLegRow(reconciledRow, leg) {
  var p = reconciledRow.pairing;
  var r = leg.row;
  var fecha = duParseDate(r.flight_start_date_local_time);
  var acType = r.fleet_type_code || '';
  var detail = [((reconciledRow.INS || '') + ' ' + acType).trim()].concat(buildLegDetailLines(p)).join('\n');

  return [
    reconciledRow.assignment_id,
    reconciledRow.pairing_id,
    fecha ? duFormatDisplay(fecha) : '',
    fecha ? (fecha.m < 10 ? '0' : '') + fecha.m : '',
    fecha ? (DOW_ES[duDowCode(fecha)] || '') : '',
    r.flight_number,
    r.departure_airport_code,
    r.arrival_airport_code,
    duFormatTimeShort(duParseTime(r.flight_departure_time_crew_base)),
    duFormatTimeShort(duParseTime(r.flight_arrival_hour_block_time)),
    r.duty_calendar_day_number,
    acType,
    duFormatTimeShort(duParseTime(r.duty_presentation_time_at)),
    r.duty_day_number,
    reconciledRow.INS || '',
    '',
    detail,
  ];
}

var FlightsRenderer = {
  headers: VUELOS_HEADERS,
  blockMinHeight: VUELOS_BLOCK_MIN_HEIGHT,

  /**
   * Construye bloques (uno por assignment_id) a partir de filas de RESUMEN ya reconciliadas.
   * @param {Array} reconciledRows SummaryRenderer.build().reconciliation.rows.
   * @returns {Array<{assignment_id, pairing_id, rows: Array<Array>}>}
   */
  buildBlocks: function (reconciledRows) {
    var blocks = reconciledRows
      .filter(function (row) { return !!row.pairing; }) // sin pairing actual (revision/orphan): nada que listar
      .map(function (row) {
        var rows = row.pairing.legs.map(function (leg) { return buildLegRow(row, leg); });
        return { assignment_id: row.assignment_id, pairing_id: row.pairing_id, rows: rows };
      });

    // Orden estable por Pairing ID y luego assignment_id — nunca por una posicion fisica previa.
    blocks.sort(function (a, b) {
      if (a.pairing_id !== b.pairing_id) return String(a.pairing_id) < String(b.pairing_id) ? -1 : 1;
      return String(a.assignment_id) < String(b.assignment_id) ? -1 : 1;
    });
    return blocks;
  },

  build: function (reconciledRows) {
    return { headers: VUELOS_HEADERS, blocks: FlightsRenderer.buildBlocks(reconciledRows) };
  },

  /** Aplana bloques a una matriz de filas, respetando BLOCK_MIN_HEIGHT como piso (nunca techo). */
  layoutMatrix: function (blocks) {
    var matrix = [];
    blocks.forEach(function (block) {
      var rows = block.rows.slice();
      while (rows.length < VUELOS_BLOCK_MIN_HEIGHT) rows.push(new Array(VUELOS_HEADERS.length).fill(''));
      matrix = matrix.concat(rows);
    });
    return matrix;
  },

  /**
   * Escribe {headers, blocks} en "Vuelos" en un unico batch, preservando SIEMPRE las filas 1-2
   * (notas humanas) y sin usar sheet.clear(): el clearContent se limita al rango de datos que este
   * renderer administra (fila 3 en adelante), nunca a la hoja completa.
   */
  writeToSheet: function (sheet, rendered) {
    var matrix = FlightsRenderer.layoutMatrix(rendered.blocks);
    var full = [rendered.headers, new Array(rendered.headers.length).fill('')].concat(matrix);
    var totalRows = full.length;
    var lastDataRow = VUELOS_HEADER_ROW + totalRows - 1;

    SheetStructure.ensureMinColumns(sheet, rendered.headers.length);
    SheetStructure.ensureMinRows(sheet, lastDataRow);

    // Limpia hasta el maximo entre lo ya existente y lo nuevo, para no dejar bloques fantasma de
    // una corrida anterior con mas assignments; nunca toca las filas 1-2.
    var clearThrough = Math.max(sheet.getLastRow(), lastDataRow);
    var clearRows = clearThrough - VUELOS_HEADER_ROW + 1;
    if (clearRows > 0) {
      sheet.getRange(VUELOS_HEADER_ROW, 1, clearRows, rendered.headers.length).clearContent();
    }
    sheet.getRange(VUELOS_HEADER_ROW, 1, totalRows, rendered.headers.length).setValues(full);
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    FlightsRenderer: FlightsRenderer,
    VUELOS_HEADERS: VUELOS_HEADERS,
    VUELOS_BLOCK_MIN_HEIGHT: VUELOS_BLOCK_MIN_HEIGHT,
    VUELOS_NOTES_ROWS: VUELOS_NOTES_ROWS,
    VUELOS_HEADER_ROW: VUELOS_HEADER_ROW,
    VUELOS_FIRST_BLOCK_ROW: VUELOS_FIRST_BLOCK_ROW,
    buildLegDetailLines: buildLegDetailLines,
  };
}
