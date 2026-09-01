/**
 * 55_RenderSummary.js
 * SummaryRenderer: construye la matriz de RESUMEN a partir de pairings evaluados + reconciliacion
 * + Diccionario. Respeta ownership (Seccion 7/55): NUNCA sobrescribe INS/ACT (vienen ya resueltos
 * por AssignmentReconciler), BP se calcula en memoria (D8 en docs/DECISIONS.md) para evitar
 * formulas dependientes de locale y el error #N/A con INS vacio (Q20).
 *
 * D13/D22 (docs/DECISIONS.md): solo los pairings con eligibility_status=ELIGIBLE pueden generar una
 * fila NUEVA (RESUMEN es la tabla de asignaciones, no de candidatos en revision); los REVIEW quedan
 * completamente documentados en _PAIRINGS_DATA. Pero TODO el snapshot (ELIGIBLE + REVIEW) se ofrece
 * a AssignmentReconciler para decidir el destino de una asignacion HUMANA ya existente: un pairing
 * que una fila humana ya reclamaba y que este mes paso a REVIEW sigue presente en Carmen Gold, asi
 * que su fila sigue ACTIVE/RELINKED_IDENTICAL (la decision humana no se borra) en vez de caer en
 * ORPHANED_SOURCE_MISSING solo por el cambio de elegibilidad.
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
  var duCanonicalDisplayDate = __DateUtil55.duCanonicalDisplayDate;
  var reconcileAssignments = require('./40_Reconciliation.js').reconcileAssignments;
}

/**
 * Dia de semana completo en espanol, capitalizado (contrato LIVE de RESUMEN.DíaSEM: "Lunes".."Domingo",
 * ver correccion post-D15). Cronograma reusa este mismo mapa en minuscula para su fila 1 (57_RenderSchedule.js).
 */
var DOW_ES = {
  MON: 'Lunes', TUE: 'Martes', WED: 'Miércoles', THU: 'Jueves',
  FRI: 'Viernes', SAT: 'Sábado', SUN: 'Domingo',
};

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
          // Fecha/Inicio/Fin pueden llegar como Date nativo (celda DATE real del Spreadsheet LIVE,
          // via SheetStructure.readResumenRows/getValues) o como texto ya escrito por una corrida
          // anterior de este mismo pipeline (D14). Se canonicalizan AQUI a "DD/MM/YYYY": si la fila
          // termina en REVIEW_SOURCE_CHANGED/ORPHANED_SOURCE_MISSING, lo que mergeRow preserva en
          // previousDisplay (40_Reconciliation.js) y buildResumenRowArray reescribe en RESUMEN debe
          // respetar siempre D14 -- nunca un objeto Date crudo -- y resumenSortKey_ (mas abajo) debe
          // poder reparsearlo para ordenar por fecha real.
          Fecha: duCanonicalDisplayDate(r.Fecha), DiaSEM: r.DiaSEM || '', Vuelo: r.Vuelo || '',
          Ruta: r.Ruta || '', Inicio: duCanonicalDisplayDate(r.Inicio), Fin: duCanonicalDisplayDate(r.Fin),
        };
      });

    // currentPairingsForMatching = TODO el snapshot (evaluatedPairings, ELIGIBLE+REVIEW): decide el
    // destino de asignaciones humanas existentes. currentPairingsForCreation = solo ELIGIBLE: unico
    // universo que puede originar una fila NEW. Ver D22 en docs/DECISIONS.md.
    var reconciliation = reconcileAssignments(previousAssignments, evaluatedPairings, eligible, idGenerator);

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

/**
 * Hechos visibles/operacionales de un pairing ensamblado, independientes de pairing_content_hash:
 * Fecha/DiaSEM del primer leg y Vuelo/Ruta/Inicio/Fin derivados de sus campos crudos. Reutilizado
 * por buildResumenRowArray (columnas Fecha/Vuelo/Ruta/Inicio/Fin de RESUMEN) y por
 * 58_LegacyBaseline.js (diagnostico "Comparar snapshot con RESUMEN actual", que compara estos
 * mismos hechos contra lo ya escrito en RESUMEN sin depender del hash legacy).
 */
function deriveVisiblePairingFacts(p) {
  var firstLeg = p.legs[0];
  var fechaDate = firstLeg ? duParseDate(firstLeg.row.flight_start_date_local_time) : null;
  return {
    Fecha: fechaDate ? duFormatDisplay(fechaDate) : '',
    DiaSEM: fechaDate ? (DOW_ES[duDowCode(fechaDate)] || '') : '',
    Vuelo: p.legs.map(function (l) { return l.row.flight_number; }).join('/'),
    Ruta: p.route_display || '',
    Inicio: p.occupied_start_date ? duFormatDisplay(p.occupied_start_date) : '',
    Fin: p.occupied_end_date ? duFormatDisplay(p.occupied_end_date) : '',
  };
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
    var facts = deriveVisiblePairingFacts(p);
    row[RESUMEN_COLUMNS.Fecha] = facts.Fecha;
    row[RESUMEN_COLUMNS.DiaSEM] = facts.DiaSEM;
    row[RESUMEN_COLUMNS.Vuelo] = facts.Vuelo;
    row[RESUMEN_COLUMNS.Ruta] = facts.Ruta;
    row[RESUMEN_COLUMNS.Inicio] = facts.Inicio;
    row[RESUMEN_COLUMNS.Fin] = facts.Fin;
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
  module.exports = {
    SummaryRenderer: SummaryRenderer, buildResumenRowArray: buildResumenRowArray, DOW_ES: DOW_ES,
    deriveVisiblePairingFacts: deriveVisiblePairingFacts,
  };
}
