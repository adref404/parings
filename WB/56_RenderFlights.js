/**
 * 56_RenderFlights.js
 * FlightsRenderer: reconstruye "Vuelos" como OUTPUT leg-level (Seccion 22). Nunca escribe INS/ACT
 * (los proyecta desde RESUMEN, ya reconciliado); nunca vuelve a ser dueño de esos datos.
 *
 * D15 (docs/DECISIONS.md): no se pudo leer el layout EXACTO de "Vuelos" en vivo (bloqueo D4), por
 * lo que este render usa una estructura leg-level explicita y auto-descriptiva (una fila por leg,
 * encabezados literales) en vez de restaurar posiciones fisicas heredadas (Seccion 22 prohibe
 * dependencias tipo R5/R14/R23). "Diagnostico del sistema" reporta si la hoja existente difiere
 * de este layout ANTES de que cualquier calculo productivo la sobrescriba.
 */

var VUELOS_HEADERS = ['Fecha', 'DiaSEM', 'Pairing', 'Vuelo', 'Ruta', 'Dep', 'Arr', 'STD', 'STA', 'INS', 'ACT', 'Inicio', 'Fin', 'assignment_status'];

var FlightsRenderer = {
  /**
   * @param {Array} reconciledRows filas de RESUMEN ya reconciliadas (SummaryRenderer.build().reconciliation.rows),
   *   cada una con `.pairing` (null si no hay pairing actual respaldando la fila: revision/orphan).
   */
  build: function (reconciledRows) {
    var matrix = [];
    reconciledRows.forEach(function (row) {
      var p = row.pairing;
      if (!p) return; // sin pairing actual (REVIEW_SOURCE_CHANGED/ORPHANED): nada que listar a nivel de vuelo
      p.legs.forEach(function (leg) {
        var r = leg.row;
        var fecha = duParseDate(r.flight_start_date_local_time);
        matrix.push([
          fecha ? duFormatDisplay(fecha) : '',
          fecha ? (DOW_ES[duDowCode(fecha)] || '') : '',
          row.pairing_id,
          r.flight_number,
          p.route_display || '',
          r.departure_airport_code,
          r.arrival_airport_code,
          duFormatTimeShort(duParseTime(r.flight_departure_time_crew_base)),
          duFormatTimeShort(duParseTime(r.flight_arrival_hour_block_time)),
          row.INS || '',
          row.ACT || '',
          p.occupied_start_date ? duFormatDisplay(p.occupied_start_date) : '',
          p.occupied_end_date ? duFormatDisplay(p.occupied_end_date) : '',
          row.assignment_status,
        ]);
      });
    });

    // Orden estable por Pairing y luego por STD (columna 7, indice 7) para lectura cronologica.
    matrix.sort(function (a, b) {
      if (a[2] !== b[2]) return String(a[2]) < String(b[2]) ? -1 : 1;
      return String(a[7]) < String(b[7]) ? -1 : (String(a[7]) > String(b[7]) ? 1 : 0);
    });

    return { headers: VUELOS_HEADERS, matrix: matrix };
  },

  /** Escribe {headers, matrix} en la hoja Vuelos en batch (limpia y reconstruye: es un OUTPUT). */
  writeToSheet: function (sheet, rendered) {
    sheet.clearContents();
    SheetStructure.ensureMinColumns(sheet, rendered.headers.length);
    sheet.getRange(1, 1, 1, rendered.headers.length).setValues([rendered.headers]);
    if (rendered.matrix.length > 0) {
      SheetStructure.ensureMinRows(sheet, rendered.matrix.length + 1);
      sheet.getRange(2, 1, rendered.matrix.length, rendered.headers.length).setValues(rendered.matrix);
    }
  },
};

if (typeof module !== 'undefined' && module.exports) {
  var __DateUtil56 = require('./05_DateUtil.js');
  var duParseDate = __DateUtil56.duParseDate;
  var duParseTime = __DateUtil56.duParseTime;
  var duFormatDisplay = __DateUtil56.duFormatDisplay;
  var duFormatTimeShort = __DateUtil56.duFormatTimeShort;
  var duDowCode = __DateUtil56.duDowCode;
  var DOW_ES = require('./55_RenderSummary.js').DOW_ES;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { FlightsRenderer: FlightsRenderer, VUELOS_HEADERS: VUELOS_HEADERS };
}
