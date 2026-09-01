/**
 * 58_LegacyBaseline.js
 * (Numerado despues de 55_RenderSummary.js a proposito: reusa `deriveVisiblePairingFacts` de ese
 * archivo mediante una referencia global de nivel superior en la rama GAS de abajo, y Apps Script
 * ejecuta el codigo de nivel superior de cada archivo en orden de nombre — igual que 30_PairingAssembler.js
 * hace con 10_Hash.js/05_DateUtil.js/20_Snapshot.js — asi que el archivo que se referencia debe
 * cargar ANTES, nunca despues.)
 *
 * Diagnostico de vinculacion tecnica del baseline operacional migrado: asignaciones HUMANAS
 * (RESUMEN con assignment_id) que fueron migradas ANTES de que existiera un snapshot certificado,
 * por lo que `pairing_instance_key`/`source_snapshot_key` quedaron vacios en esas filas. Para ese
 * baseline, `AssignmentReconciler` (40_Reconciliation.js) nunca puede tomar el Caso A (mismo PIK)
 * y depende por completo de comparar `pairing_id` + `pairing_content_hash` (Caso B/C) — pero el
 * hash legacy puede venir de un contrato de canonicalizacion distinto al de
 * `30_PairingAssembler.js#computePairingContentHash`, lo que produciria `REVIEW_SOURCE_CHANGED`/
 * `ORPHANED_SOURCE_MISSING` en masa sin que el contenido real haya cambiado en Carmen Gold.
 *
 * Este modulo separa esas dos causas SIN tocar el hash ni la reconciliacion existente:
 *   1. detectLegacyUnlinkedBaseline / evaluatePublishGate / shouldBlockPublish: gate de seguridad
 *      de publicacion (mision: bloquear runPipeline(false) mientras el baseline siga sin
 *      vinculacion tecnica segura). El preview NUNCA se bloquea (shouldBlockPublish ignora el gate
 *      cuando dryRun=true).
 *   2. compareBaselineWithSnapshot: diagnostico DRY-RUN ("Comparar snapshot con RESUMEN actual")
 *      que compara, PARA CADA pairing_id del baseline, los HECHOS VISIBLES ya escritos en RESUMEN
 *      (Fecha/Vuelo/Ruta/Inicio/Fin) contra los del pairing actual del snapshot certificado,
 *      independientemente de si el hash coincide. Un pairing con hechos visibles IDENTICOS pero
 *      hash DISTINTO es evidencia de incompatibilidad de contrato de hash, no de cambio real.
 *
 * Nada aqui escribe Sheets, modifica snapshot/RESUMEN, reemplaza pairing_content_hash, ni genera
 * assignment_id: todas las funciones son puras (arrays/objetos ya leidos -> reporte en memoria).
 */

if (typeof module !== 'undefined' && module.exports) {
  var __Render42 = require('./55_RenderSummary.js');
  var deriveVisiblePairingFacts42 = __Render42.deriveVisiblePairingFacts;
  var duCanonicalDisplayDate58 = require('./05_DateUtil.js').duCanonicalDisplayDate;
  var ELIGIBILITY_STATUS58 = require('./00_Constants.js').ELIGIBILITY_STATUS;
} else {
  var deriveVisiblePairingFacts42 = deriveVisiblePairingFacts;
  var duCanonicalDisplayDate58 = duCanonicalDisplayDate;
  var ELIGIBILITY_STATUS58 = ELIGIBILITY_STATUS;
}

/** Campos visibles/operacionales usados para comparar SIN depender de pairing_content_hash. */
var VISIBLE_FACT_FIELDS = ['Fecha', 'Vuelo', 'Ruta', 'Inicio', 'Fin'];

/** Fecha/Inicio/Fin son fechas: el Spreadsheet LIVE las guarda como celda DATE real (Date nativo de
 * Apps Script al leerse con getValues()), mientras que `deriveVisiblePairingFacts` siempre produce
 * texto "DD/MM/YYYY" (D14). Sin canonicalizar, un Date real NUNCA calzaria con su propio texto
 * equivalente (String(Date) incluye hora/timezone) y todo baseline con fechas reales se reportaria
 * como DISTINCT por error. Vuelo/Ruta son texto libre, se comparan tal cual (trim). Ver D22.
 */
var VISIBLE_DATE_FIELDS_ = { Fecha: true, Inicio: true, Fin: true };

function normalizeVisibleValue_(field, v) {
  if (VISIBLE_DATE_FIELDS_[field]) return duCanonicalDisplayDate58(v);
  return String(v === null || v === undefined ? '' : v).trim();
}

/**
 * Compara dos conjuntos de hechos visibles campo a campo. Un campo vacio en AMBOS lados no cuenta
 * como coincidencia (evita que dos pairings sin datos parezcan "identicos" por ausencia).
 * Devuelve 'EXACT' (todos coinciden), 'DISTINCT' (ninguno coincide) o 'PARTIAL' (mezcla).
 */
function compareVisibleFacts_(baselineFacts, currentFacts) {
  var matches = 0;
  VISIBLE_FACT_FIELDS.forEach(function (f) {
    var a = normalizeVisibleValue_(f, baselineFacts[f]);
    var b = normalizeVisibleValue_(f, currentFacts[f]);
    if (a !== '' && a === b) matches++;
  });
  if (matches === VISIBLE_FACT_FIELDS.length) return 'EXACT';
  if (matches === 0) return 'DISTINCT';
  return 'PARTIAL';
}

/** Una fila de RESUMEN con assignment_id pero sin vinculacion tecnica real (PIK/snapshot vacios). */
function isLegacyUnlinkedRow(row) {
  return !!row.assignment_id && (!row.pairing_instance_key || !row.source_snapshot_key);
}

/**
 * Detecta, sobre el baseline operacional ya leido de RESUMEN, cuantas filas HUMANAS (assignment_id
 * no vacio) carecen de vinculacion tecnica (`pairing_instance_key`/`source_snapshot_key` vacios).
 * @param {Array} previousAssignmentRows filas de RESUMEN (SheetStructure.readResumenRows().rows).
 */
function detectLegacyUnlinkedBaseline(previousAssignmentRows) {
  var rows = (previousAssignmentRows || []).filter(function (r) { return r.assignment_id; });
  var legacyRows = rows.filter(isLegacyUnlinkedRow);
  var linkedRows = rows.filter(function (r) { return !isLegacyUnlinkedRow(r); });
  return {
    hasLegacyUnlinked: legacyRows.length > 0,
    legacyRows: legacyRows,
    linkedRows: linkedRows,
    legacyCount: legacyRows.length,
    totalCount: rows.length,
  };
}

/**
 * Gate de publicacion (mision <publish_safety>): mientras el baseline tenga asignaciones humanas
 * sin vinculacion tecnica, publicar queda bloqueado. No ofrece "forzar"; el unico camino
 * documentado es "Comparar snapshot con RESUMEN actual" seguido de una reconciliacion/bootstrap
 * certificado (fuera de alcance de esta mision).
 */
function evaluatePublishGate(previousAssignmentRows) {
  var detection = detectLegacyUnlinkedBaseline(previousAssignmentRows);
  if (!detection.hasLegacyUnlinked) {
    return { blocked: false, code: null, legacyCount: 0, legacyPairingIds: [], reason: '' };
  }
  var uniquePairingIds = [];
  var seen = {};
  detection.legacyRows.forEach(function (r) {
    var id = String(r.Pairing || '');
    if (id && !seen[id]) { seen[id] = true; uniquePairingIds.push(id); }
  });
  return {
    blocked: true,
    code: 'LEGACY_BASELINE_UNLINKED',
    legacyCount: detection.legacyCount,
    legacyPairingIds: uniquePairingIds,
    reason: 'El baseline operacional tiene ' + detection.legacyCount + ' asignacion(es) humana(s) con ' +
      'pairing_instance_key/source_snapshot_key vacios (migradas antes de contar con snapshot ' +
      'certificado). Publicar arriesgaria reconciliarlas contra el snapshot actual usando un hash ' +
      'legacy no verificado como compatible. Use "Comparar snapshot con RESUMEN actual" (Pairings WB ' +
      '> Administracion > Fuente de datos) antes de continuar.',
  };
}

/**
 * Decide si runPipeline(dryRun) debe bloquear la escritura por el gate de baseline legacy.
 * El preview (dryRun=true) NUNCA se bloquea por este gate.
 */
function shouldBlockPublish(dryRun, previousAssignmentRows) {
  if (dryRun) return false;
  return evaluatePublishGate(previousAssignmentRows).blocked;
}

/**
 * Diagnostico DRY-RUN (mision <new_diagnostic>): para cada pairing_id UNICO del baseline, compara
 * los hechos visibles ya escritos en RESUMEN contra los del pairing actual del snapshot
 * certificado, y por separado si el hash coincide. Objetivo: separar "hash legacy incompatible"
 * (hechos visibles iguales, hash distinto) de "snapshot realmente distinto" (hechos visibles
 * distintos). NUNCA escribe, NUNCA modifica snapshot/RESUMEN/hash, NUNCA genera assignment_id.
 *
 * @param {Array} previousAssignmentRows filas de RESUMEN (SheetStructure.readResumenRows().rows).
 * @param {Array} currentPairings pairings ensamblados+evaluados del snapshot certificado, SIN
 *   filtrar por elegibilidad WB (para no confundir "no elegible este mes" con "ya no existe en
 *   Carmen Gold"). Cada uno con pairing_id/pairing_content_hash/eligibility_status/
 *   eligibility_reason y los campos que alimenta deriveVisiblePairingFacts (legs, occupied_*,
 *   route_display).
 */
function compareBaselineWithSnapshot(previousAssignmentRows, currentPairings) {
  var baselineRows = (previousAssignmentRows || []).filter(function (r) { return r.assignment_id; });
  var detection = detectLegacyUnlinkedBaseline(baselineRows);

  var byPairingId = {};
  (currentPairings || []).forEach(function (p) {
    var id = String(p.pairing_id);
    if (!byPairingId[id]) byPairingId[id] = [];
    byPairingId[id].push(p);
  });

  var uniquePairingIds = [];
  var seenIds = {};
  baselineRows.forEach(function (r) {
    var id = String(r.Pairing || '');
    if (id && !seenIds[id]) { seenIds[id] = true; uniquePairingIds.push(id); }
  });

  var summary = {
    assignmentsBaseline: baselineRows.length,
    pairingIdsUniqueBaseline: uniquePairingIds.length,
    pairingIdsPresent: 0,
    pairingIdsAbsent: 0,
    // Desglose de "presente" por elegibilidad (mision <diagnostic_reliability>, seccion 2): un
    // pairing_id presente pero REVIEW NO es lo mismo que ausente -- ver D22 en docs/DECISIONS.md.
    pairingIdsPresentEligible: 0,
    pairingIdsPresentReview: 0,
    visibleExact: 0,
    visiblePartial: 0,
    visibleDistinct: 0,
    hashSame: 0,
    hashDifferent: 0,
    legacyTechnicalLinkageMissing: detection.legacyCount,
  };

  var absentIds = [];
  var presentIds = [];
  var presentEligibleIds = [];
  var presentReviewIds = [];
  var visibleExactHashDifferentIds = [];
  var visibleDistinctIds = [];
  var reviewReasonCounts = {};
  var reviewPairingReasons = [];

  uniquePairingIds.forEach(function (id) {
    var baselineRow = baselineRows.filter(function (r) { return String(r.Pairing || '') === id; })[0];
    var candidates = byPairingId[id] || [];

    if (candidates.length === 0) {
      summary.pairingIdsAbsent++;
      absentIds.push(id);
      return;
    }
    summary.pairingIdsPresent++;
    presentIds.push(id);

    // Reporte AGREGADO por pairing_id (la mision pide un resumen, no un detalle por cada
    // ocurrencia fisica): si el pairing_id tiene multiplicidad en el snapshot actual, se usa el
    // primer candidato. La multiplicidad fisica de legs ya la cubre Q13/30_PairingAssembler.js.
    var current = candidates[0];

    if (current.eligibility_status === ELIGIBILITY_STATUS58.ELIGIBLE) {
      summary.pairingIdsPresentEligible++;
      presentEligibleIds.push(id);
    } else if (current.eligibility_status === ELIGIBILITY_STATUS58.REVIEW) {
      summary.pairingIdsPresentReview++;
      presentReviewIds.push(id);
      var reasonStr = current.eligibility_reason || '';
      reviewPairingReasons.push({ pairing_id: id, eligibility_reason: reasonStr });
      reasonStr.split(';').map(function (s) { return s.trim(); }).filter(function (s) { return s; })
        .forEach(function (reasonToken) { reviewReasonCounts[reasonToken] = (reviewReasonCounts[reasonToken] || 0) + 1; });
    }
    // else: ELIGIBILITY_STATUS.REJECTED existe en 00_Constants.js pero ningun codigo lo produce hoy
    // (35_WBRules.js solo devuelve ELIGIBLE o REVIEW, nunca REJECTED automatico). Deliberadamente NO
    // se cuenta como ELIGIBLE ni se etiqueta "en revision" -- mezclarlo con REVIEW confundiria un
    // estado mas definitivo con uno que espera juicio humano. Sigue contando en pairingIdsPresent.

    var baselineFacts = {
      Fecha: baselineRow.Fecha, Vuelo: baselineRow.Vuelo, Ruta: baselineRow.Ruta,
      Inicio: baselineRow.Inicio, Fin: baselineRow.Fin,
    };
    var currentFacts = deriveVisiblePairingFacts42(current);
    var visibleResult = compareVisibleFacts_(baselineFacts, currentFacts);

    if (visibleResult === 'EXACT') summary.visibleExact++;
    else if (visibleResult === 'PARTIAL') summary.visiblePartial++;
    else { summary.visibleDistinct++; visibleDistinctIds.push(id); }

    var hashSame = !!baselineRow.pairing_content_hash && baselineRow.pairing_content_hash === current.pairing_content_hash;
    if (hashSame) {
      summary.hashSame++;
    } else {
      summary.hashDifferent++;
      if (visibleResult === 'EXACT') visibleExactHashDifferentIds.push(id);
    }
  });

  return {
    summary: summary,
    absentPairingIds: absentIds,
    presentPairingIds: presentIds,
    presentEligiblePairingIds: presentEligibleIds,
    presentReviewPairingIds: presentReviewIds,
    reviewReasonCounts: reviewReasonCounts,
    reviewPairingReasons: reviewPairingReasons,
    visibleExactHashDifferentPairingIds: visibleExactHashDifferentIds,
    visibleDistinctPairingIds: visibleDistinctIds,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    VISIBLE_FACT_FIELDS: VISIBLE_FACT_FIELDS,
    isLegacyUnlinkedRow: isLegacyUnlinkedRow,
    detectLegacyUnlinkedBaseline: detectLegacyUnlinkedBaseline,
    evaluatePublishGate: evaluatePublishGate,
    shouldBlockPublish: shouldBlockPublish,
    compareBaselineWithSnapshot: compareBaselineWithSnapshot,
  };
}
