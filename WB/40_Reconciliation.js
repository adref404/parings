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
 *   D) ningun pairing_id coincide en TODO el snapshot actual -> ORPHANED_SOURCE_MISSING
 *      (se preserva la fila completa, nunca se borra)
 *   E) pairing ELIGIBLE sin ninguna fila previa que lo reclame (via A o B) -> NEW
 *      (assignment_id nuevo via idGenerator inyectado; INS/ACT en blanco)
 *
 * D22 (docs/DECISIONS.md): los casos A-D se resuelven contra `currentPairingsForMatching`, que debe
 * ser TODO el snapshot actual (ELIGIBLE + REVIEW) -- un pairing_id que una asignacion humana ya
 * reclamaba y que este mes paso a REVIEW (p.ej. cambio de ruta) sigue existiendo en Carmen Gold, asi
 * que NO debe leerse como ORPHANED_SOURCE_MISSING solo por eso; la decision humana existente
 * (ACTIVE/RELINKED_IDENTICAL) se preserva igual. El caso E (NEW) en cambio solo mira
 * `currentPairingsForCreation` (tipicamente el subconjunto ELIGIBLE): nunca se crea una fila NEW
 * para un pairing en REVIEW.
 */

if (typeof module !== 'undefined' && module.exports) {
  var __Constants40 = require('./00_Constants.js');
  var ASSIGNMENT_STATUS = __Constants40.ASSIGNMENT_STATUS;
}

/**
 * @param {Array} previousAssignments Filas previas de RESUMEN con assignment_id no vacio, cada una
 *   {assignment_id, pairing_instance_key, pairing_id, pairing_content_hash, INS, ACT, source_snapshot_key}.
 * @param {Array} currentPairingsForMatching Universo COMPLETO del snapshot actual (ELIGIBLE +
 *   REVIEW), usado para decidir el destino de cada asignacion HUMANA existente (casos A-D). Cada
 *   uno con {pairing_instance_key, pairing_id, pairing_content_hash, snapshot_key, ...}. Debe ser
 *   TODO el snapshot: un pairing_id que sigue presente pero paso a REVIEW este mes no es lo mismo
 *   que un pairing_id realmente ausente de Carmen Gold (ver D22 en docs/DECISIONS.md).
 * @param {Array} currentPairingsForCreation Subconjunto (tipicamente solo ELIGIBLE) usado
 *   exclusivamente para el caso E (NEW): un pairing en REVIEW nunca genera fila nueva, aunque este
 *   presente en currentPairingsForMatching.
 * @param {Function} idGenerator () => string, genera un assignment_id nuevo y unico.
 */
function reconcileAssignments(previousAssignments, currentPairingsForMatching, currentPairingsForCreation, idGenerator) {
  var currentByPik = {};
  currentPairingsForMatching.forEach(function (p) { currentByPik[p.pairing_instance_key] = p; });

  var matchedPiks = {};
  var outRows = [];
  var counts = { preserved: 0, relinked: 0, reviewChanged: 0, orphaned: 0, created: 0 };

  previousAssignments.forEach(function (prev) {
    var exactCurrent = currentByPik[prev.pairing_instance_key];

    // Caso A: mismo snapshot, mismo contenido (re-ejecucion idempotente). Se busca en TODO el
    // snapshot (ELIGIBLE + REVIEW): la decision humana existente no se elimina solo porque el
    // pairing haya pasado a REVIEW este mes.
    if (exactCurrent && exactCurrent.pairing_content_hash === prev.pairing_content_hash) {
      matchedPiks[exactCurrent.pairing_instance_key] = true;
      counts.preserved++;
      outRows.push(mergeRow(prev, exactCurrent, ASSIGNMENT_STATUS.ACTIVE));
      return;
    }

    // Buscar por pairing_id en TODO el snapshot actual (puede estar en otro pairing_instance_key
    // porque el snapshot cambio, aunque el pairing_id se repita; y puede estar en REVIEW).
    var sameIdCandidates = currentPairingsForMatching.filter(function (p) { return String(p.pairing_id) === String(prev.pairing_id); });

    var identicalContent = sameIdCandidates.filter(function (p) { return p.pairing_content_hash === prev.pairing_content_hash; })[0];
    if (identicalContent) {
      // Caso B: nuevo snapshot, contenido identico -> relink (aunque el pairing este en REVIEW).
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

    // Caso D: el pairing_id ya no aparece en absoluto en TODO el snapshot actual (ni ELIGIBLE ni
    // REVIEW): recien aqui es correcto decir que la fuente lo perdio.
    counts.orphaned++;
    outRows.push(mergeRow(prev, null, ASSIGNMENT_STATUS.ORPHANED_SOURCE_MISSING));
  });

  // Caso E: pairings ELIGIBLE (currentPairingsForCreation) que ninguna fila previa reclamo. Un
  // pairing en REVIEW jamas llega aqui aunque este en currentPairingsForMatching.
  currentPairingsForCreation.forEach(function (p) {
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
