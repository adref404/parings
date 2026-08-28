/**
 * 40_Reconciliation.js
 * AssignmentReconciler (Seccion 19): decide que pasa con cada asignacion HUMANA existente cuando
 * llega un nuevo snapshot de Carmen Gold. Nunca borra INS/ACT; nunca usa pairing_instance_key
 * como PK humana; nunca colapsa multiples assignment_id de un mismo pairing.
 *
 * Semantica implementada (ver docs/DECISIONS.md D12 para el caso REVIEW_SOURCE_CHANGED, cuya
 * redaccion en la Seccion 19 es mas escueta que las otras tres):
 *
 *   A) mismo pairing_instance_key + mismo pairing_content_hash -> ACTIVE
 *      (preserva assignment_id/INS/ACT; ocurre al re-ejecutar el MISMO snapshot: idempotencia)
 *   B) pairing_id igual + pairing_content_hash igual mas alla del snapshot -> RELINKED_IDENTICAL
 *      (preserva assignment_id/INS/ACT; actualiza el puntero al nuevo pairing_instance_key)
 *   C) pairing_id igual + pairing_content_hash distinto -> REVIEW_SOURCE_CHANGED
 *      (NO se relinkea en silencio: la fila vieja se conserva apuntando a su snapshot/contenido
 *      original con este estado; el pairing nuevo con contenido cambiado aparece ademas como NEW)
 *   D) ningun pairing_id coincide en el snapshot actual -> ORPHANED_SOURCE_MISSING
 *      (se preserva la fila completa, nunca se borra)
 *   E) pairing actual sin ninguna fila previa que lo reclame (via A o B) -> NEW
 *      (assignment_id nuevo via idGenerator inyectado; INS/ACT en blanco)
 */

if (typeof module !== 'undefined' && module.exports) {
  var __Constants40 = require('./00_Constants.js');
  var ASSIGNMENT_STATUS = __Constants40.ASSIGNMENT_STATUS;
}

/**
 * @param {Array} previousAssignments Filas previas de RESUMEN con assignment_id no vacio, cada una
 *   {assignment_id, pairing_instance_key, pairing_id, pairing_content_hash, INS, ACT, source_snapshot_key}.
 * @param {Array} currentPairings Pairings ensamblados del snapshot actual, cada uno con
 *   {pairing_instance_key, pairing_id, pairing_content_hash, snapshot_key, ...campos derivados}.
 * @param {Function} idGenerator () => string, genera un assignment_id nuevo y unico.
 */
function reconcileAssignments(previousAssignments, currentPairings, idGenerator) {
  var currentByPik = {};
  currentPairings.forEach(function (p) { currentByPik[p.pairing_instance_key] = p; });

  var matchedPiks = {};
  var outRows = [];
  var counts = { preserved: 0, relinked: 0, reviewChanged: 0, orphaned: 0, created: 0 };

  previousAssignments.forEach(function (prev) {
    var exactCurrent = currentByPik[prev.pairing_instance_key];

    // Caso A: mismo snapshot, mismo contenido (re-ejecucion idempotente).
    if (exactCurrent && exactCurrent.pairing_content_hash === prev.pairing_content_hash) {
      matchedPiks[exactCurrent.pairing_instance_key] = true;
      counts.preserved++;
      outRows.push(mergeRow(prev, exactCurrent, ASSIGNMENT_STATUS.ACTIVE));
      return;
    }

    // Buscar por pairing_id en TODO el snapshot actual (puede estar en otro pairing_instance_key
    // porque el snapshot cambio, aunque el pairing_id se repita).
    var sameIdCandidates = currentPairings.filter(function (p) { return String(p.pairing_id) === String(prev.pairing_id); });

    var identicalContent = sameIdCandidates.filter(function (p) { return p.pairing_content_hash === prev.pairing_content_hash; })[0];
    if (identicalContent) {
      // Caso B: nuevo snapshot, contenido identico -> relink.
      matchedPiks[identicalContent.pairing_instance_key] = true;
      counts.relinked++;
      outRows.push(mergeRow(prev, identicalContent, ASSIGNMENT_STATUS.RELINKED_IDENTICAL));
      return;
    }

    if (sameIdCandidates.length > 0) {
      // Caso C: mismo pairing_id, contenido distinto -> NO relink silencioso, queda para revision
      // apuntando a su snapshot/contenido ORIGINAL (no se toca el puntero).
      counts.reviewChanged++;
      outRows.push(mergeRow(prev, null, ASSIGNMENT_STATUS.REVIEW_SOURCE_CHANGED));
      return;
    }

    // Caso D: el pairing_id ya no aparece en absoluto en el snapshot actual.
    counts.orphaned++;
    outRows.push(mergeRow(prev, null, ASSIGNMENT_STATUS.ORPHANED_SOURCE_MISSING));
  });

  // Caso E: pairings del snapshot actual que ninguna fila previa reclamo.
  currentPairings.forEach(function (p) {
    if (matchedPiks[p.pairing_instance_key]) return;
    counts.created++;
    outRows.push({
      assignment_id: idGenerator(),
      pairing_instance_key: p.pairing_instance_key,
      pairing_id: p.pairing_id,
      pairing_content_hash: p.pairing_content_hash,
      source_snapshot_key: p.snapshot_key,
      INS: '',
      ACT: '',
      assignment_status: ASSIGNMENT_STATUS.NEW,
      pairing: p,
    });
  });

  return { rows: outRows, counts: counts };
}

/**
 * Combina una fila previa (dueña de assignment_id/INS/ACT) con el pairing actual que la reclamo
 * (o null si se preserva apuntando al pairing/snapshot original, casos C y D).
 */
function mergeRow(prev, current, status) {
  var target = current || {
    pairing_instance_key: prev.pairing_instance_key,
    pairing_id: prev.pairing_id,
    pairing_content_hash: prev.pairing_content_hash,
    snapshot_key: prev.source_snapshot_key,
  };
  return {
    assignment_id: prev.assignment_id,
    pairing_instance_key: target.pairing_instance_key,
    pairing_id: target.pairing_id,
    pairing_content_hash: target.pairing_content_hash,
    source_snapshot_key: target.snapshot_key,
    INS: prev.INS,
    ACT: prev.ACT,
    assignment_status: status,
    pairing: current, // null si no hay pairing actual que respalde la fila (revision/orphan)
    // Cuando no hay pairing actual (REVIEW_SOURCE_CHANGED/ORPHANED_SOURCE_MISSING), el renderer
    // (55_RenderSummary.js) usa esto para no dejar Fecha/Vuelo/Ruta/Inicio/Fin en blanco: la fila
    // se conserva realmente INTACTA (ver D12 en docs/DECISIONS.md), no solo su assignment_id/INS/ACT.
    previousDisplay: {
      Fecha: prev.Fecha, DiaSEM: prev.DiaSEM, Vuelo: prev.Vuelo,
      Ruta: prev.Ruta, Inicio: prev.Inicio, Fin: prev.Fin,
    },
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { reconcileAssignments: reconcileAssignments, mergeRow: mergeRow };
}
