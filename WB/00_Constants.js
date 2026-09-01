/**
 * 00_Constants.js
 * Constantes compartidas de Pairings WB. Sin dependencias de otros modulos.
 * NO contiene secretos. Los IDs aqui son identificadores de recursos de Drive/BigQuery,
 * no credenciales.
 */

/** IDs de recursos productivos conocidos (Seccion 2 y 35 del prompt maestro). */
var WB_KNOWN = Object.freeze({
  EXPECTED_SPREADSHEET_ID: '13gUbtsbVT1HpXemyJl510EZLi-xemMJYSwBCH2q9K0c',
  SHEET_FOLDER_ID: '1T6KLxeLkII8WSUmFrxK3RUCsI6w9i1iZ',
  HISTORY_FOLDER_ID: '11Aqpqiw7JKhTzJkdM19wKIlHV8MhOZxv',
  BIGQUERY_PROJECT_ID: 'operations-data-prod',
  BIGQUERY_DATASET_ID: 'carmen_gold',
  BIGQUERY_TABLE_ID: 'crew_pairing_carmen_system',
  // Proyecto de EJECUCION (jobs.create/billing) candidato, DISTINTO del DATA project de arriba.
  // Verificado en vivo (dry run real, no teorico) el 2026-09-01 con la identidad que autoriza el
  // script: bigquery.jobs.create = PASS en este proyecto, y un dry run del SQL de descubrimiento
  // real contra `operations-data-prod.carmen_gold.crew_pairing_carmen_system` bajo este job
  // project tambien = PASS (~112MB estimados, dentro de MAXIMUM_BYTES_BILLED). Ver docs/DECISIONS.md.
  // Es solo la propuesta inicial del menu "Probar/configurar proyecto de ejecucion": nunca se
  // aplica a _CONFIG sin volver a probarse y confirmarse explicitamente (Seccion 5 del prompt maestro).
  CANDIDATE_BIGQUERY_JOB_PROJECT_ID: 'datadem-home',
});

/** Nombres de hoja visibles y tecnicas. */
var SHEET_NAMES = Object.freeze({
  VUELOS: 'Vuelos',
  CRONOGRAMA: 'Cronograma',
  RESUMEN: 'RESUMEN',
  DICCIONARIO: 'Diccionario',
  PAIRINGS_DATA: '_PAIRINGS_DATA',
  CONFIG: '_CONFIG',
  RUNS: '_RUNS',
});

var TECHNICAL_SHEETS = Object.freeze([
  SHEET_NAMES.PAIRINGS_DATA,
  SHEET_NAMES.CONFIG,
  SHEET_NAMES.RUNS,
]);

var VISIBLE_SHEETS = Object.freeze([
  SHEET_NAMES.VUELOS,
  SHEET_NAMES.CRONOGRAMA,
  SHEET_NAMES.RESUMEN,
  SHEET_NAMES.DICCIONARIO,
]);

/** Version de esquema y de contrato de consulta. Incrementar solo ante cambio semantico. */
var SCHEMA_VERSION = 'WB-PAIRINGS-2.1.0';
var QUERY_VERSION = 'WB_CARMEN_GOLD_V1';
var RULESET_ID = 'LP_WB_B767';

/** Esquema de RESUMEN: columna -> indice 0-based. Debe coincidir con Seccion 7. */
var RESUMEN_COLUMNS = Object.freeze({
  pairing_instance_key: 0, // A
  Pairing: 1,              // B
  Fecha: 2,                // C
  DiaSEM: 3,               // D
  Vuelo: 4,                // E
  Ruta: 5,                 // F
  INS: 6,                  // G  (HUMANO)
  ACT: 7,                  // H  (HUMANO)
  Inicio: 8,               // I
  Fin: 9,                  // J
  BP: 10,                  // K  (DERIVADO LOCAL)
  assignment_id: 11,       // L
  pairing_content_hash: 12,// M
  assignment_status: 13,   // N
  source_snapshot_key: 14, // O
});

var RESUMEN_HEADERS = Object.freeze([
  'pairing_instance_key', 'Pairing', 'Fecha', 'DíaSEM', 'Vuelo', 'Ruta',
  'INS', 'ACT', 'Inicio', 'Fin', 'BP',
  'assignment_id', 'pairing_content_hash', 'assignment_status', 'source_snapshot_key',
]);

/** Columnas de propiedad HUMANA en RESUMEN: nunca se sobrescriben en un refresh. */
var RESUMEN_HUMAN_COLUMNS = Object.freeze(['INS', 'ACT']);

var DICCIONARIO_HEADERS = Object.freeze(['INS', 'BP', 'NOMBRE']);

/** Estados de reconciliacion de asignaciones (Seccion 19). */
var ASSIGNMENT_STATUS = Object.freeze({
  ACTIVE: 'ACTIVE',
  RELINKED_IDENTICAL: 'RELINKED_IDENTICAL',
  REVIEW_SOURCE_CHANGED: 'REVIEW_SOURCE_CHANGED',
  ORPHANED_SOURCE_MISSING: 'ORPHANED_SOURCE_MISSING',
  NEW: 'NEW',
});

/** Estados de elegibilidad WB (Seccion 8/18). */
var ELIGIBILITY_STATUS = Object.freeze({
  ELIGIBLE: 'ELIGIBLE',
  REVIEW: 'REVIEW',
  REJECTED: 'REJECTED',
});

/** Certificacion de snapshot (Seccion 12). */
var SNAPSHOT_CERTIFICATION = Object.freeze({
  PENDING: 'PENDING',
  CERTIFIED: 'CERTIFIED',
});

/** Claves de _CONFIG con valores por defecto de arranque (solo se usan si _CONFIG no existe aun). */
var CONFIG_DEFAULTS = Object.freeze({
  SCHEMA_VERSION: SCHEMA_VERSION,
  RULESET_ID: RULESET_ID,
  QUERY_VERSION: QUERY_VERSION,
  PROJECT_ID: WB_KNOWN.BIGQUERY_PROJECT_ID,
  DATASET_ID: WB_KNOWN.BIGQUERY_DATASET_ID,
  TABLE_ID: WB_KNOWN.BIGQUERY_TABLE_ID,
  // Default SOLO para instalaciones nuevas (ensureDefaults nunca sobrescribe una _CONFIG ya
  // existente, ver 15_Config.js computeConfigBootstrapPlan). Antes era WB_KNOWN.BIGQUERY_PROJECT_ID
  // (operations-data-prod), pero ese proyecto es el DATA project: la identidad que autoriza el
  // script no tiene bigquery.jobs.create ahi (confirmado en vivo, docs/DECISIONS.md). El candidato
  // ya verificado como JOB project (jobs.create + lectura de Carmen Gold, ambos PASS) es este.
  BIGQUERY_JOB_PROJECT_ID: WB_KNOWN.CANDIDATE_BIGQUERY_JOB_PROJECT_ID,
  BIGQUERY_LOCATION: 'US',
  MAXIMUM_BYTES_BILLED: '300000000',
  SUBSIDIARY_CODE: 'LP',
  CREW_BASE_CODE: 'LIM',
  CREW_RANGE_TYPE_CODE: 'TM',
  FLEET_SCOPE: 'B767',
  SUBFLEET_CODES: '763',
  BASE_TIMEZONE: 'America/Lima',
  REFERENCE_YEAR: '2026',
  REFERENCE_MONTH: '9',
  MAX_OCCUPIED_DAYS: '3',
  ALLOWED_OCCUPIED_DOW: 'MON,TUE,WED,THU,FRI',
  HISTORY_FOLDER_ID: WB_KNOWN.HISTORY_FOLDER_ID,
  EXPECTED_SPREADSHEET_ID: WB_KNOWN.EXPECTED_SPREADSHEET_ID,
  AUTO_ARCHIVE_ON_SUCCESS: 'TRUE',
  LOAD_TYPE_CODE: 'PENDING_CERTIFICATION',
  LOAD_KEY_ID: 'PENDING_CERTIFICATION',
  LOAD_VERSION_ID: 'PENDING_CERTIFICATION',
  INGESTION_DATETIME: 'PENDING_CERTIFICATION',
  SNAPSHOT_CERTIFICATION: SNAPSHOT_CERTIFICATION.PENDING,
});

var CONFIG_DEFAULT_ROUTES = Object.freeze([
  { code: 'MIA', priority: 1, role: 'PRIMARY' },
  { code: 'SCL', priority: 2, role: 'SECONDARY' },
  { code: 'ATL', priority: 3, role: 'FALLBACK' },
]);

/** Columnas leg-level requeridas desde BigQuery (Seccion 11). Si falta alguna -> SCHEMA_ERROR. */
var BQ_REQUIRED_FIELDS = Object.freeze([
  'pairing_id', 'pairing_days_quantity', 'pairing_name', 'crew_base_code',
  'pairing_start_date', 'pairing_start_time', 'pairing_end_date', 'pairing_end_time',
  'is_pairing_start_leg', 'pairing_end_leg_indicator',
  'flight_start_date_local_time',
  'carrier_code', 'flight_number', 'departure_airport_code', 'arrival_airport_code',
  'route_airport_key',
  'flight_departure_time_crew_base', 'flight_arrival_hour_block_time',
  'is_crew_passenger', 'subfleet_code',
  'briefing_time', 'flight_block_time', 'connection_time',
  'duty_day_number', 'duty_calendar_day_number',
  'duty_presentation_date_at', 'duty_presentation_time_at',
  'duty_end_date_home_base_timezone', 'duty_end_time_hb',
  'flight_operation_type_code',
  'load_key_id', 'load_type_code', 'subsidiary_code', 'fleet_type_code',
  'crew_range_type_code', 'reference_month_number', 'reference_year',
  'ingestion_datetime', 'load_version_id',
  'service_type_code', 'flight_type_code',
]);

/**
 * Columnas EXACTAS que devuelve buildDiscoverySql() (Seccion 12, Flujo A: descubrimiento de
 * snapshots candidatos). Es un result set agregado (GROUP BY por identidad de carga), NO un
 * result set leg-level: nunca debe validarse contra BQ_REQUIRED_FIELDS (eso produciria un
 * SCHEMA_ERROR falso apenas IAM lo desbloquee). Ver 25_BigQueryGateway.js parseRowsWithSchema.
 */
var BQ_DISCOVERY_FIELDS = Object.freeze([
  'load_key_id', 'load_type_code', 'load_version_id', 'ingestion_datetime',
  'fleet_type_code', 'subfleet_code',
  'leg_count', 'pairing_count', 'min_pairing_start_date', 'max_pairing_start_date',
]);

/**
 * Esquema _PAIRINGS_DATA (encabezados de fila 1). Backend tecnico leg-level.
 * Contrato EXACTO de 54 columnas ya vigente en el Spreadsheet LIVE (ver correccion post-D15):
 * `connection_time` y `flight_operation_type_code` siguen disponibles en memoria desde BigQuery
 * (BQ_REQUIRED_FIELDS) para calculo, pero NO se persisten como columna de esta hoja.
 */
var PAIRINGS_DATA_HEADERS = Object.freeze([
  'snapshot_key', 'load_key_id', 'load_type_code', 'load_version_id', 'ingestion_datetime',
  'subsidiary_code', 'crew_base_code', 'crew_range_type_code',
  'reference_year', 'reference_month_number',
  'fleet_type_code', 'subfleet_code',
  'pairing_instance_key', 'pairing_id', 'pairing_name', 'pairing_content_hash',
  'source_row_hash', 'source_row_multiplicity',
  'pairing_days_quantity_source',
  'pairing_start_date', 'pairing_start_time', 'pairing_end_date', 'pairing_end_time',
  'occupied_start_date', 'occupied_start_time', 'occupied_end_date', 'occupied_end_time', 'occupied_days',
  'primary_destination_code', 'route_display', 'route_priority',
  'eligibility_status', 'eligibility_reason', 'requires_review',
  'leg_key', 'leg_sequence',
  'flight_start_date_local_time', 'carrier_code', 'flight_number', 'departure_airport_code', 'arrival_airport_code',
  'route_airport_key', 'flight_departure_time_crew_base', 'flight_arrival_hour_block_time',
  'flight_block_time', 'is_crew_passenger', 'duty_day_number', 'duty_calendar_day_number',
  'duty_presentation_date_at', 'duty_presentation_time_at',
  'duty_end_date_home_base_timezone', 'duty_end_time_hb',
  'service_type_code', 'flight_type_code',
]);

/** Esquema _RUNS (append-only; ver Seccion 31). */
var RUNS_HEADERS = Object.freeze([
  'run_id', 'started_at', 'finished_at', 'effective_user', 'status',
  'schema_version', 'config_hash', 'query_version',
  'reference_year', 'reference_month',
  'snapshot_key', 'load_key_id', 'load_type_code', 'load_version_id', 'ingestion_datetime',
  'bq_job_id',
  'legs_received', 'pairings_received', 'pairings_eligible', 'pairings_review',
  'assignments_preserved', 'assignments_relinked', 'assignments_orphaned', 'content_changes_detected',
  'duration_ms',
  'error_code', 'error_message',
  'run_type', 'history_status', 'history_file_id', 'history_key', 'query_bytes_processed',
]);

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    WB_KNOWN: WB_KNOWN, SHEET_NAMES: SHEET_NAMES, TECHNICAL_SHEETS: TECHNICAL_SHEETS,
    VISIBLE_SHEETS: VISIBLE_SHEETS, SCHEMA_VERSION: SCHEMA_VERSION, QUERY_VERSION: QUERY_VERSION,
    RULESET_ID: RULESET_ID, RESUMEN_COLUMNS: RESUMEN_COLUMNS, RESUMEN_HEADERS: RESUMEN_HEADERS,
    RESUMEN_HUMAN_COLUMNS: RESUMEN_HUMAN_COLUMNS, DICCIONARIO_HEADERS: DICCIONARIO_HEADERS,
    ASSIGNMENT_STATUS: ASSIGNMENT_STATUS, ELIGIBILITY_STATUS: ELIGIBILITY_STATUS,
    SNAPSHOT_CERTIFICATION: SNAPSHOT_CERTIFICATION, CONFIG_DEFAULTS: CONFIG_DEFAULTS,
    CONFIG_DEFAULT_ROUTES: CONFIG_DEFAULT_ROUTES, BQ_REQUIRED_FIELDS: BQ_REQUIRED_FIELDS,
    BQ_DISCOVERY_FIELDS: BQ_DISCOVERY_FIELDS,
    PAIRINGS_DATA_HEADERS: PAIRINGS_DATA_HEADERS, RUNS_HEADERS: RUNS_HEADERS,
  };
}
