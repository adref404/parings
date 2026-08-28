/**
 * 55_RenderSummary.js
 * SummaryRenderer: construye la matriz de RESUMEN a partir de pairings evaluados + reconciliacion
 * + Diccionario. Respeta ownership (Seccion 7/55): NUNCA sobrescribe INS/ACT (vienen ya resueltos
 * por AssignmentReconciler), BP se calcula en memoria (D8 en docs/DECISIONS.md) para evitar
 * formulas dependientes de locale y el error #N/A con INS vacio (Q20).
 *
 * D13 (docs/DECISIONS.md): solo los pairings con eligibility_status=ELIGIBLE se ofrecen como
 * candidatos a AssignmentReconciler; los REVIEW quedan documentados en _PAIRINGS_DATA pero no
 * generan fila en RESUMEN (RESUMEN es la tabla de asignaciones, no de candidatos en revision).
 * D14: Fecha/Inicio/Fin se escriben como TEXTO "DD/MM/YYYY" (nunca como Date nativo de JS) para
 * eliminar por diseño cualquier riesgo de drift UTC/local (Seccion 21).
 */

if (typeof module !== 'undefined' && module.exports) {
  var __Constants55 = require('./00_Constants.js');
  var RESUMEN_HEADERS = __Constants55.RESUMEN_HEADERS;
  var RESUMEN_COLUMNS = __Constants55.RESUMEN_COLUMNS;
  var ELIGIBILITY_STATUS = __Constants55.ELIGIBILITY_STATUS;
  var __DateUtil55 = require('./05_DateUtil.js');
  var duParseDate = __DateUtil55.duParseDate;
  var duFormatDisplay = __DateUtil55.duFormatDisplay;
  var duDowCode = __DateUtil55.duDowCode;
  var duParseDisplayDate = __DateUtil55.duParseDisplayDate;
  var duEpochDay = __DateUtil55.duEpochDay;
  var reconcileAssignments = require('./40_Reconciliation.js').reconcileAssignments;
}

var DOW_ES = { MON: 'LUN', TUE: 'MAR', WED: 'MIE', THU: 'JUE', FRI: 'VIE', SAT: 'SAB', SUN: 'DOM' };

var SummaryRenderer = {
  /**
   * @param {Array} evaluatedPairings pairings ensamblados + evaluateWbRules ya fusionado.
   * @param {Array} previousResumenRows filas previas de RESUMEN (SheetStructure.readResumenRows().rows).
   * @param {Array} diccionario [{INS, BP, NOMBRE}].
   * @param {Function} idGenerator () => assignment_id nuevo.
   * @returns {{matrix: Array<Array>, reconciliation: Object, rowsForRuns: Object}}
   */
  build: function (evaluatedPairings, previousResumenRows, diccionario, idGenerator) {
    var eligible = evaluatedPairings.filter(function (p) { return p.eligibility_status === ELIGIBILITY_STATUS.ELIGIBLE; });

    var previousAssignments = previousResumenRows
      .filter(function (r) { return r.assignment_id; })
      .map(function (r) {
        return {
          assignment_id: r.assignment_id,
          pairing_instance_key: r.pairing_instance_key,
          pairing_id: r.Pairing,
          pairing_content_hash: r.pairing_content_hash,
          source_snapshot_key: r.source_snapshot_key,
          INS: r.INS || '',
          ACT: r.ACT || '',
          Fecha: r.Fecha || '', DiaSEM: r.DiaSEM || '', Vuelo: r.Vuelo || '',
          Ruta: r.Ruta || '', Inicio: r.Inicio || '', Fin: r.Fin || '',
        };
      });

    var reconciliation = reconcileAssignments(previousAssignments, eligible, idGenerator);

    var bpByIns = {};
    diccionario.forEach(function (d) { if (d.INS) bpByIns[d.INS] = d.BP; });

    var matrix = reconciliation.rows
      .map(function (row) { return buildResumenRowArray(row, bpByIns); })
      // Orden estable por Fecha real (Fecha se escribe como texto DD/MM/YYYY por D14; se reparsea
      // solo para ordenar, nunca se guarda el numero). Filas sin fecha conocida van al final.
      .sort(function (a, b) {
        var ka = resumenSortKey_(a[RESUMEN_COLUMNS.Fecha]);
        var kb = resumenSortKey_(b[RESUMEN_COLUMNS.Fecha]);
        if (ka !== kb) return ka - kb;
        return String(a[RESUMEN_COLUMNS.pairing_instance_key]) < String(b[RESUMEN_COLUMNS.pairing_instance_key]) ? -1 : 1;
      });

    return { matrix: matrix, reconciliation: reconciliation };
  },
};

function resumenSortKey_(fechaDisplayText) {
  var d = duParseDisplayDate(fechaDisplayText);
  return d ? duEpochDay(d) : Number.MAX_SAFE_INTEGER;
}

function buildResumenRowArray(reconciledRow, bpByIns) {
  var p = reconciledRow.pairing; // null en REVIEW_SOURCE_CHANGED/ORPHANED_SOURCE_MISSING
  var row = new Array(RESUMEN_HEADERS.length).fill('');

  row[RESUMEN_COLUMNS.pairing_instance_key] = reconciledRow.pairing_instance_key;
  row[RESUMEN_COLUMNS.Pairing] = reconciledRow.pairing_id;
  row[RESUMEN_COLUMNS.INS] = reconciledRow.INS || '';
  row[RESUMEN_COLUMNS.ACT] = reconciledRow.ACT || '';
  row[RESUMEN_COLUMNS.assignment_id] = reconciledRow.assignment_id;
  row[RESUMEN_COLUMNS.pairing_content_hash] = reconciledRow.pairing_content_hash;
  row[RESUMEN_COLUMNS.assignment_status] = reconciledRow.assignment_status;
  row[RESUMEN_COLUMNS.source_snapshot_key] = reconciledRow.source_snapshot_key;

  var ins = reconciledRow.INS || '';
  row[RESUMEN_COLUMNS.BP] = ins && bpByIns[ins] !== undefined ? bpByIns[ins] : '';

  if (p) {
    var firstLeg = p.legs[0];
    var fechaDate = firstLeg ? duParseDate(firstLeg.row.flight_start_date_local_time) : null;
    row[RESUMEN_COLUMNS.Fecha] = fechaDate ? duFormatDisplay(fechaDate) : '';
    row[RESUMEN_COLUMNS.DiaSEM] = fechaDate ? (DOW_ES[duDowCode(fechaDate)] || '') : '';
    row[RESUMEN_COLUMNS.Vuelo] = p.legs.map(function (l) { return l.row.flight_number; }).join('/');
    row[RESUMEN_COLUMNS.Ruta] = p.route_display || '';
    row[RESUMEN_COLUMNS.Inicio] = p.occupied_start_date ? duFormatDisplay(p.occupied_start_date) : '';
    row[RESUMEN_COLUMNS.Fin] = p.occupied_end_date ? duFormatDisplay(p.occupied_end_date) : '';
  } else if (reconciledRow.previousDisplay) {
    // Sin pairing actual (REVIEW_SOURCE_CHANGED/ORPHANED_SOURCE_MISSING): la fila se conserva
    // REALMENTE intacta (D12) — se recupera lo que ya estaba escrito en RESUMEN, no se deja en blanco.
    var pd = reconciledRow.previousDisplay;
    row[RESUMEN_COLUMNS.Fecha] = pd.Fecha || '';
    row[RESUMEN_COLUMNS.DiaSEM] = pd.DiaSEM || '';
    row[RESUMEN_COLUMNS.Vuelo] = pd.Vuelo || '';
    row[RESUMEN_COLUMNS.Ruta] = pd.Ruta || '';
    row[RESUMEN_COLUMNS.Inicio] = pd.Inicio || '';
    row[RESUMEN_COLUMNS.Fin] = pd.Fin || '';
  }

  return row;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SummaryRenderer: SummaryRenderer, buildResumenRowArray: buildResumenRowArray, DOW_ES: DOW_ES };
}
