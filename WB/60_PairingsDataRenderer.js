/**
 * 60_PairingsDataRenderer.js
 * Construye la matriz leg-level de _PAIRINGS_DATA (Seccion 16): TODOS los pairings evaluados
 * (ELIGIBLE y REVIEW), una fila por leg. Es el backend tecnico completo para auditoria; RESUMEN
 * (55_RenderSummary.js) es un subconjunto operacional (solo ELIGIBLE, una fila por pairing).
 *
 * D16: las fechas/horas aqui se escriben en ISO (YYYY-MM-DD / HH:MM) porque es una hoja tecnica
 * pensada para auditoria/joins, no para lectura humana directa (a diferencia de RESUMEN, D14).
 */

if (typeof module !== 'undefined' && module.exports) {
  var __DateUtil60 = require('./05_DateUtil.js');
  var duFormatIso60 = __DateUtil60.duFormatIso;
  var duFormatTimeShort60 = __DateUtil60.duFormatTimeShort;
  var __Constants60 = require('./00_Constants.js');
  var PAIRINGS_DATA_HEADERS60 = __Constants60.PAIRINGS_DATA_HEADERS;
  var sourceRowHash60 = require('./30_PairingAssembler.js').sourceRowHash;
} else {
  var duFormatIso60 = duFormatIso, duFormatTimeShort60 = duFormatTimeShort,
      PAIRINGS_DATA_HEADERS60 = PAIRINGS_DATA_HEADERS, sourceRowHash60 = sourceRowHash;
}

var PairingsDataRenderer = {
  /**
   * @param {Array} evaluatedPairings pairings ensamblados + campos de evaluateWbRules fusionados.
   * @param {Object} snapshotContext {snapshot_key, load_key_id, load_type_code, load_version_id,
   *   ingestion_datetime, subsidiary_code, crew_base_code, crew_range_type_code, reference_year,
   *   reference_month_number, fleet_type_code, subfleet_code}.
   */
  build: function (evaluatedPairings, snapshotContext) {
    var matrix = [];
    evaluatedPairings.forEach(function (p) {
      p.legs.forEach(function (leg) {
        var r = leg.row;
        matrix.push([
          snapshotContext.snapshot_key, snapshotContext.load_key_id, snapshotContext.load_type_code,
          snapshotContext.load_version_id, snapshotContext.ingestion_datetime,
          snapshotContext.subsidiary_code, snapshotContext.crew_base_code, snapshotContext.crew_range_type_code,
          snapshotContext.reference_year, snapshotContext.reference_month_number,
          r.fleet_type_code, r.subfleet_code,
          p.pairing_instance_key, p.pairing_id, p.pairing_name, p.pairing_content_hash,
          sourceRowHash60(r), leg.source_row_multiplicity,
          p.pairing_days_quantity_source,
          r.pairing_start_date, r.pairing_start_time, r.pairing_end_date, r.pairing_end_time,
          p.occupied_start_date ? duFormatIso60(p.occupied_start_date) : '',
          p.occupied_start_time ? duFormatTimeShort60(p.occupied_start_time) : '',
          p.occupied_end_date ? duFormatIso60(p.occupied_end_date) : '',
          p.occupied_end_time ? duFormatTimeShort60(p.occupied_end_time) : '',
          p.occupied_days,
          p.primary_destination_code, p.route_display, p.route_priority,
          p.eligibility_status, p.eligibility_reason, p.requires_review,
          leg.leg_key, leg.leg_sequence,
          r.flight_start_date_local_time, r.carrier_code, r.flight_number, r.departure_airport_code, r.arrival_airport_code,
          r.route_airport_key, r.flight_departure_time_crew_base, r.flight_arrival_hour_block_time,
          r.flight_block_time, r.is_crew_passenger, r.duty_day_number, r.duty_calendar_day_number,
          r.duty_presentation_date_at, r.duty_presentation_time_at,
          r.duty_end_date_home_base_timezone, r.duty_end_time_hb,
          r.service_type_code, r.flight_type_code,
        ]);
      });
    });

    matrix.sort(function (a, b) {
      var pikIdx = PAIRINGS_DATA_HEADERS60.indexOf('pairing_instance_key');
      var seqIdx = PAIRINGS_DATA_HEADERS60.indexOf('leg_sequence');
      if (a[pikIdx] !== b[pikIdx]) return String(a[pikIdx]) < String(b[pikIdx]) ? -1 : 1;
      return a[seqIdx] - b[seqIdx];
    });

    return { headers: PAIRINGS_DATA_HEADERS60, matrix: matrix };
  },

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
  module.exports = { PairingsDataRenderer: PairingsDataRenderer };
}
