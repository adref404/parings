/**
 * 25_BigQueryGateway.js
 * Construccion de SQL (GoogleSQL, solo lectura, sin SELECT *, con poda de particion) y
 * parseo de resultados de BigQuery basado en el esquema devuelto (nunca en indices magicos
 * de columna, Seccion 15).
 *
 * La ejecucion real (BigQueryGateway.runQuery / dryRun) usa el servicio avanzado BigQuery de
 * Apps Script y solo puede probarse dentro de Apps Script; las funciones de construccion de SQL
 * y de parseo de filas son puras y se prueban desde Node.
 */

if (typeof module !== 'undefined' && module.exports) {
  var __Constants25 = require('./00_Constants.js');
  var BQ_REQUIRED_FIELDS = __Constants25.BQ_REQUIRED_FIELDS;
  var __DateUtil25 = require('./05_DateUtil.js');
  var duParseDate = __DateUtil25.duParseDate;
  var duAddDays = __DateUtil25.duAddDays;
  var duFormatIso = __DateUtil25.duFormatIso;
}

/** Numero de dias de guarda antes/despues del mes de referencia para no perder pairings que cruzan el limite de mes. */
var GUARD_BAND_DAYS = 6;

/** Escapa comillas simples para uso en literales SQL (los valores vienen de _CONFIG, editable por operaciones). */
function sqlQuote(value) {
  return "'" + String(value).replace(/'/g, "\\'") + "'";
}

/** "763,764" -> "'763','764'" para una clausula IN. */
function sqlQuoteList(csv) {
  return String(csv).split(',').map(function (s) { return s.trim(); }).filter(function (s) { return s !== ''; })
    .map(sqlQuote).join(', ');
}

/** Calcula el rango de guarda [inicio, fin] (fechas {y,m,d}) para el filtro de particion del mes de referencia. */
function computeGuardBandRange(referenceYear, referenceMonth) {
  var year = parseInt(referenceYear, 10);
  var month = parseInt(referenceMonth, 10);
  var firstDay = { y: year, m: month, d: 1 };
  var firstOfNextMonth = month === 12 ? { y: year + 1, m: 1, d: 1 } : { y: year, m: month + 1, d: 1 };
  var lastDay = duAddDays(firstOfNextMonth, -1);
  return {
    start: duAddDays(firstDay, -GUARD_BAND_DAYS),
    end: duAddDays(lastDay, GUARD_BAND_DAYS),
  };
}

/**
 * SQL trivial usada UNICAMENTE para probar el permiso bigquery.jobs.create en un proyecto de
 * ejecucion candidato (Seccion 5 del prompt maestro), sin tocar ninguna fuente de datos real. No
 * referencia `operations-data-prod.carmen_gold.crew_pairing_carmen_system` a proposito: aisla la
 * prueba de creacion de job de la prueba de acceso a la fuente (dos permisos IAM distintos).
 */
var JOB_CREATION_PROBE_SQL = 'SELECT 1';

var FQ_TABLE_TEMPLATE = '`{project}.{dataset}.{table}`';

function fqTable(config) {
  return FQ_TABLE_TEMPLATE
    .replace('{project}', config.PROJECT_ID)
    .replace('{dataset}', config.DATASET_ID)
    .replace('{table}', config.TABLE_ID);
}

/**
 * SQL de descubrimiento (Flujo A, Seccion 12): agrega por identidad de carga completa para el
 * mes de referencia configurado. Resultado pequeno (una fila por combinacion de carga distinta).
 * No usa SELECT *, filtra por particion, agrega early por columnas de bajo cardinality.
 */
function buildDiscoverySql(config) {
  var guard = computeGuardBandRange(config.REFERENCE_YEAR, config.REFERENCE_MONTH);
  return [
    'SELECT',
    '  load_key_id,',
    '  load_type_code,',
    '  load_version_id,',
    '  CAST(ingestion_datetime AS STRING) AS ingestion_datetime,',
    '  fleet_type_code,',
    '  subfleet_code,',
    '  COUNT(*) AS leg_count,',
    '  COUNT(DISTINCT pairing_id) AS pairing_count,',
    '  MIN(pairing_start_date) AS min_pairing_start_date,',
    '  MAX(pairing_start_date) AS max_pairing_start_date',
    'FROM ' + fqTable(config),
    'WHERE subsidiary_code = ' + sqlQuote(config.SUBSIDIARY_CODE),
    '  AND crew_base_code = ' + sqlQuote(config.CREW_BASE_CODE),
    '  AND crew_range_type_code = ' + sqlQuote(config.CREW_RANGE_TYPE_CODE),
    '  AND reference_year = ' + parseInt(config.REFERENCE_YEAR, 10),
    '  AND reference_month_number = ' + parseInt(config.REFERENCE_MONTH, 10),
    '  AND subfleet_code IN (' + sqlQuoteList(config.SUBFLEET_CODES) + ')',
    '  AND pairing_start_date BETWEEN ' + sqlQuote(duFormatIso(guard.start)) + ' AND ' + sqlQuote(duFormatIso(guard.end)),
    'GROUP BY 1, 2, 3, 4, 5, 6',
    'ORDER BY ingestion_datetime DESC',
    'LIMIT 500',
  ].join('\n');
}

/**
 * SQL leg-level para una identidad de carga YA CERTIFICADA (Flujo B). Proyecta unicamente las
 * columnas requeridas (Seccion 11), filtra por particion + identidad de carga exacta. Un unico
 * result set leg-level, sin SELECT *, sin DML.
 */
function buildCertifiedLegSql(config, loadIdentity) {
  var guard = computeGuardBandRange(config.REFERENCE_YEAR, config.REFERENCE_MONTH);
  var cols = BQ_REQUIRED_FIELDS.map(function (f) { return '  ' + f; }).join(',\n');
  return [
    'SELECT',
    cols + ',',
    '  CAST(ingestion_datetime AS STRING) AS ingestion_datetime_str',
    'FROM ' + fqTable(config),
    'WHERE subsidiary_code = ' + sqlQuote(config.SUBSIDIARY_CODE),
    '  AND crew_base_code = ' + sqlQuote(config.CREW_BASE_CODE),
    '  AND crew_range_type_code = ' + sqlQuote(config.CREW_RANGE_TYPE_CODE),
    '  AND reference_year = ' + parseInt(config.REFERENCE_YEAR, 10),
    '  AND reference_month_number = ' + parseInt(config.REFERENCE_MONTH, 10),
    '  AND subfleet_code IN (' + sqlQuoteList(config.SUBFLEET_CODES) + ')',
    '  AND load_key_id = ' + sqlQuote(loadIdentity.load_key_id),
    '  AND load_type_code = ' + sqlQuote(loadIdentity.load_type_code),
    '  AND load_version_id = ' + sqlQuote(loadIdentity.load_version_id),
    '  AND CAST(ingestion_datetime AS STRING) = ' + sqlQuote(loadIdentity.ingestion_datetime),
    '  AND pairing_start_date BETWEEN ' + sqlQuote(duFormatIso(guard.start)) + ' AND ' + sqlQuote(duFormatIso(guard.end)),
    'ORDER BY pairing_id, flight_start_date_local_time, flight_departure_time_crew_base',
  ].join('\n');
}

/** Q7: verifica que el SQL no contenga SELECT * (heuristica textual sobre el SQL generado). */
function sqlHasSelectStar(sql) {
  return /select\s+\*/i.test(sql);
}

/** Q5: verifica que el SQL referencie la columna de particion en el WHERE. */
function sqlHasPartitionFilter(sql, partitionColumn) {
  var re = new RegExp('WHERE[\\s\\S]*\\b' + partitionColumn + '\\b', 'i');
  return re.test(sql);
}

/** Q6: verifica ausencia de sentencias de escritura/DDL en el SQL generado. */
function sqlIsReadOnly(sql) {
  return !/\b(INSERT|UPDATE|DELETE|MERGE|CREATE|DROP|ALTER|TRUNCATE)\b/i.test(sql);
}

/**
 * Construye un mapa nombre-de-columna -> indice a partir del `schema.fields` devuelto por
 * BigQuery (Jobs.getQueryResults / Jobs.query). Nunca se asumen indices fijos (Seccion 15).
 */
function buildFieldIndex(schemaFields) {
  var index = {};
  (schemaFields || []).forEach(function (f, i) { index[f.name] = i; });
  return index;
}

/**
 * Valida que todas las columnas requeridas existan en el esquema devuelto. Si falta alguna,
 * devuelve {ok:false, missing:[...]} en vez de procesar filas (Seccion 15: SCHEMA_ERROR).
 */
function validateSchema(schemaFields, requiredFields) {
  var index = buildFieldIndex(schemaFields);
  var missing = (requiredFields || BQ_REQUIRED_FIELDS).filter(function (f) { return !(f in index); });
  return { ok: missing.length === 0, missing: missing, fieldIndex: index };
}

/**
 * Convierte las filas crudas de BigQuery (formato REST: row.f[i].v) en objetos {campo: valor}
 * usando el mapa de indices por nombre. Lanza si el esquema no es valido (llamar validateSchema antes).
 *
 * `requiredFields` es OPCIONAL y se reenvia tal cual a validateSchema (que ya sabe caer a
 * BQ_REQUIRED_FIELDS si no se pasa nada). Es imprescindible pasarlo explicitamente para result sets
 * que NO son leg-level, como el descubrimiento de snapshots (BQ_DISCOVERY_FIELDS): sin este
 * parametro, cualquier llamada terminaba validando ~10 columnas agregadas contra el contrato
 * leg-level completo (84 columnas) y fallaba con SCHEMA_ERROR aunque la respuesta fuera correcta.
 */
function parseRowsWithSchema(schemaFields, rows, requiredFields) {
  var validation = validateSchema(schemaFields, requiredFields);
  if (!validation.ok) {
    throw new Error('SCHEMA_ERROR: faltan columnas requeridas: ' + validation.missing.join(', '));
  }
  var names = (schemaFields || []).map(function (f) { return f.name; });
  return (rows || []).map(function (row) {
    var obj = {};
    var cells = row.f || [];
    for (var i = 0; i < names.length; i++) {
      obj[names[i]] = cells[i] ? cells[i].v : null;
    }
    return obj;
  });
}

// ---------------------------------------------------------------------------
// Ejecucion real (Apps Script BigQuery Advanced Service). No testeable desde Node.
// ---------------------------------------------------------------------------

var BigQueryGateway = {
  /** dry run: solo estima bytes procesados, no ejecuta el job de forma facturable. */
  dryRun: function (sql, jobProjectId) {
    var request = { query: sql, useLegacySql: false, dryRun: true };
    var response = BigQuery.Jobs.query(request, jobProjectId);
    return { totalBytesProcessed: response.totalBytesProcessed, schema: response.schema };
  },

  /**
   * Ejecuta `sql` (READ ONLY) contra `jobProjectId`, con polling hasta completar y paginacion
   * completa via pageToken. Devuelve {schema, rows, jobId, totalBytesProcessed} SIEMPRE que el job
   * de BigQuery haya completado, incluso si el esquema resultante no trae todas las columnas
   * requeridas: la validacion de esquema es responsabilidad exclusiva del llamador (QaService.q4RequiredColumns
   * + failFastIfBlocked en 80_Orchestrator.js), para que ese fallo se reporte como QA_FAILED con un
   * reporte estructurado en vez de una excepcion generica que tira el run a un status ERROR opaco.
   */
  runQuery: function (sql, jobProjectId, options) {
    options = options || {};
    var request = {
      query: sql,
      useLegacySql: false,
      useQueryCache: options.useQueryCache !== false,
    };
    if (options.maximumBytesBilled) request.maximumBytesBilled = String(options.maximumBytesBilled);

    var response = BigQuery.Jobs.query(request, jobProjectId);
    var jobId = response.jobReference.jobId;
    var location = response.jobReference.location;

    var pollAttempts = 0;
    while (!response.jobComplete) {
      pollAttempts++;
      if (pollAttempts > 60) throw new Error('BigQuery job ' + jobId + ' no completo tras 60 intentos de polling.');
      Utilities.sleep(1000);
      response = BigQuery.Jobs.getQueryResults(jobProjectId, jobId, { location: location });
    }

    var allRows = response.rows || [];
    var pageToken = response.pageToken;
    while (pageToken) {
      var page = BigQuery.Jobs.getQueryResults(jobProjectId, jobId, { pageToken: pageToken, location: location });
      allRows = allRows.concat(page.rows || []);
      pageToken = page.pageToken;
    }

    return {
      schema: response.schema,
      rows: allRows,
      jobId: jobId,
      totalBytesProcessed: response.totalBytesProcessed,
      cacheHit: response.cacheHit,
    };
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    GUARD_BAND_DAYS: GUARD_BAND_DAYS, sqlQuote: sqlQuote, sqlQuoteList: sqlQuoteList,
    computeGuardBandRange: computeGuardBandRange, fqTable: fqTable,
    JOB_CREATION_PROBE_SQL: JOB_CREATION_PROBE_SQL,
    buildDiscoverySql: buildDiscoverySql, buildCertifiedLegSql: buildCertifiedLegSql,
    sqlHasSelectStar: sqlHasSelectStar, sqlHasPartitionFilter: sqlHasPartitionFilter,
    sqlIsReadOnly: sqlIsReadOnly, buildFieldIndex: buildFieldIndex, validateSchema: validateSchema,
    parseRowsWithSchema: parseRowsWithSchema, BigQueryGateway: BigQueryGateway,
  };
}
