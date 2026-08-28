/**
 * 20_Snapshot.js
 * Identidad de carga/snapshot (Seccion 12): LOAD INSTANCE -> PAIRING INSTANCE -> LEG.
 *
 * snapshot_key = hash(contexto canonico + identidad de carga exacta).
 * pairing_instance_key = hash(snapshot_key + pairing_id).
 *
 * `pairing_id` NUNCA se usa solo como identidad: dos cargas distintas pueden reusar el mismo
 * pairing_id con contenido distinto, por eso siempre se combina con snapshot_key.
 */

if (typeof module !== 'undefined' && module.exports) {
  var __Hash20 = require('./10_Hash.js');
  var hashFields = __Hash20.hashFields;
}

/** Orden explicito y estable de los campos que componen el snapshot_key. NO depende del orden de un objeto JS. */
var SNAPSHOT_KEY_FIELD_ORDER = [
  'subsidiary_code', 'crew_base_code', 'crew_range_type_code',
  'reference_year', 'reference_month_number',
  'fleet_scope', 'subfleet_codes',
  'load_key_id', 'load_type_code', 'load_version_id', 'ingestion_datetime',
];

/**
 * Construye el contexto canonico de snapshot a partir de config (ya canonicalizada por el
 * llamador) y de una identidad de carga concreta {load_key_id, load_type_code, load_version_id,
 * ingestion_datetime, fleet_type_code, subfleet_code}.
 */
function buildSnapshotContext(config, loadIdentity) {
  return {
    subsidiary_code: config.SUBSIDIARY_CODE,
    crew_base_code: config.CREW_BASE_CODE,
    crew_range_type_code: config.CREW_RANGE_TYPE_CODE,
    reference_year: config.REFERENCE_YEAR,
    reference_month_number: config.REFERENCE_MONTH,
    fleet_scope: config.FLEET_SCOPE,
    subfleet_codes: config.SUBFLEET_CODES,
    load_key_id: loadIdentity.load_key_id,
    load_type_code: loadIdentity.load_type_code,
    load_version_id: loadIdentity.load_version_id,
    ingestion_datetime: loadIdentity.ingestion_datetime,
  };
}

/** snapshot_key deterministico: mismo contexto -> mismo hash; cualquier campo distinto -> hash distinto. */
function computeSnapshotKey(context) {
  var ordered = SNAPSHOT_KEY_FIELD_ORDER.map(function (f) { return context[f]; });
  return hashFields(ordered);
}

/** pairing_instance_key = hash(snapshot_key, pairing_id). Nunca usar pairing_id solo. */
function computePairingInstanceKey(snapshotKey, pairingId) {
  return hashFields([snapshotKey, pairingId]);
}

/**
 * Dada una lista de candidatos agregados por identidad de carga (ya vienen de un GROUP BY en
 * BigQuery: un elemento por combinacion distinta de load_key_id/load_type_code/load_version_id/
 * ingestion_datetime), decide si se puede proponer automaticamente (exactamente 1 candidato) o si
 * requiere revision humana (0 o >1 candidatos). Nunca elige arbitrariamente entre varios.
 */
function selectSnapshotCandidate(candidates) {
  var list = candidates || [];
  if (list.length === 0) {
    return { autoSelectable: false, candidate: null, reason: 'NO_CANDIDATES', candidates: list };
  }
  if (list.length === 1) {
    return { autoSelectable: true, candidate: list[0], reason: 'SINGLE_CANDIDATE', candidates: list };
  }
  return { autoSelectable: false, candidate: null, reason: 'MULTIPLE_CANDIDATES', candidates: list };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    SNAPSHOT_KEY_FIELD_ORDER: SNAPSHOT_KEY_FIELD_ORDER,
    buildSnapshotContext: buildSnapshotContext,
    computeSnapshotKey: computeSnapshotKey,
    computePairingInstanceKey: computePairingInstanceKey,
    selectSnapshotCandidate: selectSnapshotCandidate,
  };
}
