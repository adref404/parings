/**
 * 30_PairingAssembler.js
 * Reconstruye pairings a partir de filas leg-level de Carmen Gold ya parseadas por esquema
 * (Seccion 16-17). Responsabilidad: SOURCE (hechos crudos) -> DERIVED (orden, ocupacion, hash).
 * No decide elegibilidad de ruta/dias (eso es WBRulesEngine) ni toca datos HUMANOS.
 *
 * Todo el modulo es puro: recibe arrays de objetos JS ya parseados, no llama a BigQuery ni a Sheets.
 */

if (typeof module !== 'undefined' && module.exports) {
  var __Hash30 = require('./10_Hash.js');
  var hashFields30 = __Hash30.hashFields;
  var __DateUtil30 = require('./05_DateUtil.js');
  var duParseDate30 = __DateUtil30.duParseDate;
  var duParseTime30 = __DateUtil30.duParseTime;
  var duSortKey30 = __DateUtil30.duSortKey;
  var duDiffDays30 = __DateUtil30.duDiffDays;
  var duFormatIso30 = __DateUtil30.duFormatIso;
  var __Snapshot30 = require('./20_Snapshot.js');
  var computePairingInstanceKey30 = __Snapshot30.computePairingInstanceKey;
} else {
  var hashFields30 = hashFields, duParseDate30 = duParseDate, duParseTime30 = duParseTime,
      duSortKey30 = duSortKey, duDiffDays30 = duDiffDays, duFormatIso30 = duFormatIso,
      computePairingInstanceKey30 = computePairingInstanceKey;
}

/** Orden fijo de campos usado para el hash de fila cruda (deteccion de multiplicidades fisicas). */
var SOURCE_ROW_HASH_FIELDS = [
  'pairing_id', 'carrier_code', 'flight_number', 'departure_airport_code', 'arrival_airport_code',
  'flight_start_date_local_time', 'flight_departure_time_crew_base', 'flight_arrival_hour_block_time',
  'briefing_time', 'flight_block_time', 'connection_time',
  'duty_day_number', 'duty_calendar_day_number',
  'duty_presentation_date_at', 'duty_presentation_time_at',
  'duty_end_date_home_base_timezone', 'duty_end_time_hb',
  'is_crew_passenger', 'flight_operation_type_code', 'service_type_code', 'flight_type_code',
];

function sourceRowHash(row) {
  return hashFields30(SOURCE_ROW_HASH_FIELDS.map(function (f) { return row[f]; }));
}

/** Clave de leg dentro de un pairing: identidad de vuelo, no de fila fisica. */
function legKey(pairingInstanceKey, row) {
  return hashFields30([
    pairingInstanceKey, row.carrier_code, row.flight_number,
    row.departure_airport_code, row.arrival_airport_code,
    row.flight_start_date_local_time, row.flight_departure_time_crew_base,
  ]);
}

/**
 * Clave de orden determinista de un leg dentro del pairing: fecha+hora de salida local.
 * Nota: solo se usa flight_departure_time_crew_base porque es el UNICO campo de hora de salida que
 * BQ_REQUIRED_FIELDS realmente proyecta (Seccion 11/00_Constants.js); un leg con esa hora nula
 * ordena como 00:00 del dia correspondiente (duSortKey30 ya trata time=null asi), lo cual es una
 * limitacion aceptada y documentada, no un fallback silencioso a un campo nunca consultado.
 */
function legSortKey(row) {
  var date = duParseDate30(row.flight_start_date_local_time);
  var time = duParseTime30(row.flight_departure_time_crew_base);
  if (!date) return Number.MAX_SAFE_INTEGER; // legs sin fecha valida se empujan al final, nunca rompen el sort
  return duSortKey30(date, time);
}

/**
 * Agrupa filas leg-level en pairings, usando pairing_instance_key = hash(snapshotKey, pairing_id).
 * Devuelve un array de pairings ensamblados, cada uno con sus legs unicos ordenados y metadatos
 * de multiplicidad/ocupacion/hash de contenido.
 */
function assemblePairings(rows, snapshotKey) {
  var byPairing = {};
  var order = [];

  rows.forEach(function (row) {
    var pik = computePairingInstanceKey30(snapshotKey, row.pairing_id);
    if (!byPairing[pik]) { byPairing[pik] = []; order.push(pik); }
    byPairing[pik].push(row);
  });

  return order.map(function (pik) {
    return assembleOnePairing(pik, byPairing[pik], snapshotKey);
  });
}

function assembleOnePairing(pairingInstanceKey, rawRows, snapshotKey) {
  // 1) Detectar multiplicidad fisica: filas identicas en TODOS los campos relevantes.
  var byLeg = {};
  var legOrder = [];
  rawRows.forEach(function (row) {
    var lk = legKey(pairingInstanceKey, row);
    if (!byLeg[lk]) { byLeg[lk] = []; legOrder.push(lk); }
    byLeg[lk].push(row);
  });

  var legs = legOrder.map(function (lk) {
    var group = byLeg[lk];
    var representative = group[0];
    // Si dentro del mismo leg_key hay filas con distinto contenido de hecho (no solo duplicado fisico),
    // eso indica una limitacion de la fuente (no hay clave de origen que distinga ocurrencias): se
    // documenta contando hashes de fila distintos en vez de fabricar una PK inexistente.
    var distinctRowHashes = {};
    group.forEach(function (r) { distinctRowHashes[sourceRowHash(r)] = true; });
    return {
      leg_key: lk,
      row: representative,
      source_row_multiplicity: group.length,
      distinct_source_row_variants: Object.keys(distinctRowHashes).length,
      sortKey: legSortKey(representative),
    };
  });

  legs.sort(function (a, b) { return a.sortKey - b.sortKey; });
  legs.forEach(function (leg, i) { leg.leg_sequence = i + 1; });

  var occupied = computeOccupiedWindow(legs.map(function (l) { return l.row; }));
  var contentHash = computePairingContentHash(rawRows[0].pairing_id, occupied, legs);

  return {
    pairing_instance_key: pairingInstanceKey,
    snapshot_key: snapshotKey,
    pairing_id: rawRows[0].pairing_id,
    pairing_name: rawRows[0].pairing_name,
    pairing_days_quantity_source: rawRows[0].pairing_days_quantity,
    legs: legs,
    occupied_start_date: occupied.startDate,
    occupied_start_time: occupied.startTime,
    occupied_end_date: occupied.endDate,
    occupied_end_time: occupied.endTime,
    occupied_days: occupied.days,
    occupied_source: occupied.source,
    pairing_content_hash: contentHash,
  };
}

/**
 * Calcula la ventana de ocupacion (Seccion 10): primero por duty_presentation_date_at/time y
 * duty_end_date_home_base_timezone/duty_end_time_hb; si TODOS los legs carecen de esos campos,
 * usa como respaldo documentado los limites de vuelo
 * (flight_start_date_local_time/flight_departure_time_crew_base para el inicio,
 * pairing_end_date/pairing_end_time para el fin), marcando source='FLIGHT_FALLBACK' para que quede
 * auditable (no se inventa una regla nueva, se declara explicitamente cuando se usa el respaldo).
 */
function computeOccupiedWindow(rows) {
  var starts = [], ends = [];
  rows.forEach(function (r) {
    var sd = duParseDate30(r.duty_presentation_date_at);
    var st = duParseTime30(r.duty_presentation_time_at);
    if (sd) starts.push({ date: sd, time: st || { h: 0, mi: 0, s: 0 } });

    var ed = duParseDate30(r.duty_end_date_home_base_timezone);
    var et = duParseTime30(r.duty_end_time_hb);
    if (ed) ends.push({ date: ed, time: et || { h: 0, mi: 0, s: 0 } });
  });

  var source = 'DUTY';
  if (starts.length === 0) {
    source = 'FLIGHT_FALLBACK';
    rows.forEach(function (r) {
      var sd = duParseDate30(r.flight_start_date_local_time);
      var st = duParseTime30(r.flight_departure_time_crew_base);
      if (sd) starts.push({ date: sd, time: st || { h: 0, mi: 0, s: 0 } });
    });
  }
  if (ends.length === 0) {
    source = 'FLIGHT_FALLBACK';
    rows.forEach(function (r) {
      var ed = duParseDate30(r.pairing_end_date);
      var et = duParseTime30(r.pairing_end_time);
      if (ed) ends.push({ date: ed, time: et || { h: 0, mi: 0, s: 0 } });
    });
  }

  if (starts.length === 0 || ends.length === 0) {
    return { startDate: null, startTime: null, endDate: null, endTime: null, days: null, source: 'MISSING' };
  }

  var minStart = starts.reduce(function (best, cur) {
    return duSortKey30(cur.date, cur.time) < duSortKey30(best.date, best.time) ? cur : best;
  });
  var maxEnd = ends.reduce(function (best, cur) {
    return duSortKey30(cur.date, cur.time) > duSortKey30(best.date, best.time) ? cur : best;
  });

  var days = duDiffDays30(minStart.date, maxEnd.date) + 1;

  return {
    startDate: minStart.date, startTime: minStart.time,
    endDate: maxEnd.date, endTime: maxEnd.time,
    days: days, source: source,
  };
}

/**
 * pairing_content_hash (Seccion 20): depende de pairing_id, ventana de ocupacion y la secuencia
 * ORDENADA de legs (carrier, flight_number, dep, arr, STD, STA). NO depende de row/column number,
 * formato, INS/ACT/BP ni de la posicion en Cronograma. Los legs se ordenan SIEMPRE por sortKey
 * antes de hashear, por lo que el orden de llegada de las filas de entrada no afecta el resultado.
 */
function computePairingContentHash(pairingId, occupied, legs) {
  var fields = [
    pairingId,
    occupied.startDate ? duFormatIso30(occupied.startDate) : '',
    occupied.startTime ? (occupied.startTime.h + ':' + occupied.startTime.mi) : '',
    occupied.endDate ? duFormatIso30(occupied.endDate) : '',
    occupied.endTime ? (occupied.endTime.h + ':' + occupied.endTime.mi) : '',
  ];
  legs.forEach(function (leg) {
    var r = leg.row;
    fields.push(r.carrier_code, r.flight_number, r.departure_airport_code, r.arrival_airport_code,
      r.flight_departure_time_crew_base, r.flight_arrival_hour_block_time);
  });
  return hashFields30(fields);
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sourceRowHash: sourceRowHash, legKey: legKey, legSortKey: legSortKey,
    assemblePairings: assemblePairings, assembleOnePairing: assembleOnePairing,
    computeOccupiedWindow: computeOccupiedWindow, computePairingContentHash: computePairingContentHash,
    SOURCE_ROW_HASH_FIELDS: SOURCE_ROW_HASH_FIELDS,
  };
}
