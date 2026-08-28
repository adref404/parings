/**
 * 45_Lanes.js
 * Asignacion deterministica de "carriles" (lanes) para Cronograma mediante interval partitioning
 * (Seccion 23): assignments que se solapan en el tiempo van a carriles distintos; el numero de
 * carril es una posicion visual, nunca una identidad (no se guarda como PK de nada).
 */

/**
 * @param {Array} intervals [{id, startKey, endKey}], startKey/endKey numericos y comparables
 *   (p.ej. duSortKey de 05_DateUtil.js). Un intervalo con endKey <= startKey de otro se considera
 *   no solapado (limite exclusivo en endKey).
 * @returns {{laneById: Object, totalLanes: number}}
 */
function assignLanes(intervals) {
  var sorted = intervals.slice().sort(function (a, b) {
    if (a.startKey !== b.startKey) return a.startKey - b.startKey;
    return String(a.id) < String(b.id) ? -1 : (String(a.id) > String(b.id) ? 1 : 0);
  });

  var laneEnds = []; // laneEnds[lane] = endKey del ultimo intervalo asignado a ese carril
  var laneById = {};

  sorted.forEach(function (iv) {
    var chosenLane = -1;
    for (var lane = 0; lane < laneEnds.length; lane++) {
      if (laneEnds[lane] <= iv.startKey) { chosenLane = lane; break; }
    }
    if (chosenLane === -1) {
      chosenLane = laneEnds.length;
      laneEnds.push(iv.endKey);
    } else {
      laneEnds[chosenLane] = iv.endKey;
    }
    laneById[iv.id] = chosenLane;
  });

  return { laneById: laneById, totalLanes: laneEnds.length };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { assignLanes: assignLanes };
}
