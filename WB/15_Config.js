/**
 * 15_Config.js
 * ConfigService: lectura/escritura de la hoja _CONFIG y canonicalizacion/hash de configuracion.
 *
 * Layout esperado de _CONFIG (Seccion 6 y D10 de docs/DECISIONS.md):
 *   Columnas A:B desde la fila 1 = pares KEY/VALUE (fila de encabezado "KEY","VALUE" opcional).
 *   Una fila cuyo valor en A sea literalmente "ROUTES" marca el inicio de la tabla de rutas;
 *   las filas siguientes tienen columnas A:C = CODE, PRIORITY, ROLE hasta la primera fila vacia.
 *
 * Las funciones puras (canonicalizeConfig, computeConfigHash, parseAllowedDow, validateConfig,
 * normalizeRoutes) no dependen de SpreadsheetApp y se prueban desde Node. Las funciones de I/O
 * (ConfigService.read / ConfigService.ensureDefaults / ConfigService.certifySnapshot) si dependen
 * de SpreadsheetApp y solo se ejecutan dentro de Apps Script.
 */

// En Apps Script todos los archivos comparten un unico scope global (no hay modulos), por lo que
// sha256Hex/stableStringify/SHEET_NAMES/etc. de otros archivos ya son visibles directamente.
// En Node cada archivo es un modulo CommonJS aislado: este bloque solo se ejecuta ahi y crea
// bindings locales equivalentes para que el resto del archivo funcione igual en ambos entornos.
if (typeof module !== 'undefined' && module.exports) {
  var __Hash15 = require('./10_Hash.js');
  var sha256Hex = __Hash15.sha256Hex;
  var stableStringify = __Hash15.stableStringify;
  var __Constants15 = require('./00_Constants.js');
  var SNAPSHOT_CERTIFICATION = __Constants15.SNAPSHOT_CERTIFICATION;
  var RULESET_ID = __Constants15.RULESET_ID;
  var CONFIG_DEFAULTS = __Constants15.CONFIG_DEFAULTS;
  var CONFIG_DEFAULT_ROUTES = __Constants15.CONFIG_DEFAULT_ROUTES;
  var SHEET_NAMES = __Constants15.SHEET_NAMES;
}

/** Claves numericas que deben canonicalizarse como enteros para el hash (evita "9" vs "09" vs "9.0"). */
var CONFIG_NUMERIC_KEYS = ['REFERENCE_YEAR', 'REFERENCE_MONTH', 'MAX_OCCUPIED_DAYS'];

/** Claves que deben canonicalizarse en mayusculas (codigos). */
var CONFIG_UPPER_KEYS = [
  'RULESET_ID', 'SUBSIDIARY_CODE', 'CREW_BASE_CODE', 'CREW_RANGE_TYPE_CODE',
  'FLEET_SCOPE', 'SUBFLEET_CODES', 'SNAPSHOT_CERTIFICATION',
];

/**
 * Normaliza un objeto de configuracion plano {KEY: 'valor'} a una forma canonica:
 * trim de espacios, mayusculas en claves de codigo, enteros en claves numericas.
 * No muta el objeto de entrada.
 */
function canonicalizeConfig(config) {
  var out = {};
  Object.keys(config || {}).forEach(function (key) {
    var raw = config[key];
    var value = raw === null || raw === undefined ? '' : String(raw).trim();
    if (CONFIG_UPPER_KEYS.indexOf(key) !== -1) value = value.toUpperCase();
    if (CONFIG_NUMERIC_KEYS.indexOf(key) !== -1 && value !== '') {
      var n = parseInt(value, 10);
      value = isNaN(n) ? value : String(n);
    }
    out[key] = value;
  });
  return out;
}

/** Normaliza la tabla de rutas: trim, mayusculas en code/role, prioridad entera; ordena por prioridad. */
function normalizeRoutes(routes) {
  return (routes || [])
    .map(function (r) {
      return {
        code: String(r.code || '').trim().toUpperCase(),
        priority: parseInt(r.priority, 10),
        role: String(r.role || '').trim().toUpperCase(),
      };
    })
    .filter(function (r) { return r.code !== ''; })
    .sort(function (a, b) { return a.priority - b.priority; });
}

/** "MON,TUE,WED" -> ['MON','TUE','WED']. Ignora espacios y entradas vacias. */
function parseAllowedDow(str) {
  return String(str || '')
    .split(',')
    .map(function (s) { return s.trim().toUpperCase(); })
    .filter(function (s) { return s !== ''; });
}

/**
 * Hash deterministico de la configuracion + rutas. Usado como config_hash en _RUNS y como
 * componente del snapshot_key/history_key. Se excluyen deliberadamente los campos de
 * certificacion de carga (LOAD_KEY_ID, LOAD_TYPE_CODE, LOAD_VERSION_ID, INGESTION_DATETIME,
 * SNAPSHOT_CERTIFICATION) porque esos ya forman parte explicita del snapshot_key: incluirlos
 * aqui tambien duplicaria la dependencia y complicaria la migracion de config sin cambiar de mes.
 */
function computeConfigHash(config, routes) {
  var excluded = ['LOAD_KEY_ID', 'LOAD_TYPE_CODE', 'LOAD_VERSION_ID', 'INGESTION_DATETIME', 'SNAPSHOT_CERTIFICATION'];
  var canon = canonicalizeConfig(config);
  excluded.forEach(function (k) { delete canon[k]; });
  var payload = { config: canon, routes: normalizeRoutes(routes) };
  return sha256Hex(stableStringify(payload));
}

/** Claves requeridas para que la configuracion se considere operable (Q1). */
var CONFIG_REQUIRED_KEYS = [
  'SCHEMA_VERSION', 'RULESET_ID', 'PROJECT_ID', 'DATASET_ID', 'TABLE_ID',
  'SUBSIDIARY_CODE', 'CREW_BASE_CODE', 'CREW_RANGE_TYPE_CODE', 'FLEET_SCOPE', 'SUBFLEET_CODES',
  'BASE_TIMEZONE', 'REFERENCE_YEAR', 'REFERENCE_MONTH', 'MAX_OCCUPIED_DAYS', 'ALLOWED_OCCUPIED_DOW',
];

/**
 * Valida la configuracion (Q1: config valida, Q2: ruleset compatible).
 * Devuelve {valid: boolean, errors: string[]}.
 */
function validateConfig(config, routes) {
  var errors = [];
  var canon = canonicalizeConfig(config);

  CONFIG_REQUIRED_KEYS.forEach(function (key) {
    if (!canon[key]) errors.push('Falta la clave de configuracion requerida: ' + key);
  });

  if (canon.RULESET_ID && canon.RULESET_ID !== RULESET_ID) {
    errors.push('RULESET_ID incompatible: configurado=' + canon.RULESET_ID + ' esperado=' + RULESET_ID);
  }

  var year = parseInt(canon.REFERENCE_YEAR, 10);
  if (!year || year < 2000 || year > 2100) errors.push('REFERENCE_YEAR invalido: ' + canon.REFERENCE_YEAR);

  var month = parseInt(canon.REFERENCE_MONTH, 10);
  if (!month || month < 1 || month > 12) errors.push('REFERENCE_MONTH invalido: ' + canon.REFERENCE_MONTH);

  var maxDays = parseInt(canon.MAX_OCCUPIED_DAYS, 10);
  if (!maxDays || maxDays < 1 || maxDays > 30) errors.push('MAX_OCCUPIED_DAYS invalido: ' + canon.MAX_OCCUPIED_DAYS);

  var dow = parseAllowedDow(canon.ALLOWED_OCCUPIED_DOW);
  if (dow.length === 0) errors.push('ALLOWED_OCCUPIED_DOW vacio o invalido');
  var validDow = { MON: 1, TUE: 1, WED: 1, THU: 1, FRI: 1, SAT: 1, SUN: 1 };
  dow.forEach(function (d) { if (!validDow[d]) errors.push('Codigo de dia invalido en ALLOWED_OCCUPIED_DOW: ' + d); });

  var normRoutes = normalizeRoutes(routes);
  if (normRoutes.length === 0) errors.push('No hay rutas configuradas (MIA/SCL/ATL esperadas)');
  var seenPriority = {};
  normRoutes.forEach(function (r) {
    if (!r.role) errors.push('Ruta ' + r.code + ' sin ROLE');
    if (isNaN(r.priority)) errors.push('Ruta ' + r.code + ' sin PRIORITY numerica');
    if (seenPriority[r.priority]) errors.push('Prioridad de ruta duplicada: ' + r.priority);
    seenPriority[r.priority] = true;
  });

  return { valid: errors.length === 0, errors: errors };
}

/**
 * Devuelve true si el snapshot esta certificado segun la configuracion (gate Seccion 12).
 * `allowPreview` permite operar en modo previsualizacion (dry run) SOBRE UN SNAPSHOT YA
 * SELECCIONADO sin exigir el estado CERTIFIED formal. Lo que `allowPreview` NUNCA bypasea es que
 * exista una identidad de carga real: si LOAD_KEY_ID sigue siendo el centinela
 * 'PENDING_CERTIFICATION' (nunca se corrio "Certificar snapshot"), tanto preview como publish deben
 * bloquearse — de lo contrario un dry run consultaria BigQuery con ese literal, obtendria 0 filas y
 * reportaria "QA PASS, 0 pairings" enmascarando que nunca se certifico nada.
 */
function isSnapshotCertified(config, allowPreview) {
  var canon = canonicalizeConfig(config);
  var hasRealIdentity = !!canon.LOAD_KEY_ID && canon.LOAD_KEY_ID !== 'PENDING_CERTIFICATION';
  if (allowPreview) return hasRealIdentity;
  return hasRealIdentity && canon.SNAPSHOT_CERTIFICATION === SNAPSHOT_CERTIFICATION.CERTIFIED;
}

/**
 * Decide SI hace falta escribir _CONFIG para completar defaults/rutas ausentes, y calcula las
 * filas resultantes si hiciera falta. Pura (no toca SpreadsheetApp): permite probar la decision
 * "no escribir si no falta nada" sin depender de un Spreadsheet real (ver ConfigService.ensureDefaults).
 * `current` = { values, routes, sheetFound } tal como lo devuelve ConfigService.read.
 */
function computeConfigBootstrapPlan(current) {
  var missingKeys = Object.keys(CONFIG_DEFAULTS).filter(function (k) {
    return !Object.prototype.hasOwnProperty.call(current.values, k);
  });
  var needsRoutesBootstrap = !current.routes || current.routes.length === 0;
  var needsWrite = !current.sheetFound || missingKeys.length > 0 || needsRoutesBootstrap;

  if (!needsWrite) {
    return { needsWrite: false, missingKeys: [], merged: current.values, routes: current.routes, rows: null };
  }

  var merged = {};
  Object.keys(CONFIG_DEFAULTS).forEach(function (k) { merged[k] = CONFIG_DEFAULTS[k]; });
  Object.keys(current.values).forEach(function (k) { merged[k] = current.values[k]; }); // lo existente gana

  var routes = needsRoutesBootstrap ? CONFIG_DEFAULT_ROUTES : current.routes;

  var rows = [['KEY', 'VALUE', '']];
  Object.keys(merged).sort().forEach(function (k) { rows.push([k, merged[k], '']); });
  rows.push(['ROUTES', '', '']);
  rows.push(['CODE', 'PRIORITY', 'ROLE']);
  normalizeRoutes(routes).forEach(function (r) { rows.push([r.code, r.priority, r.role]); });

  return { needsWrite: true, missingKeys: missingKeys, merged: merged, routes: routes, rows: rows };
}

/**
 * Plan de escritura para alinear _CONFIG.BIGQUERY_JOB_PROJECT_ID a un proyecto de ejecucion ya
 * validado (Seccion 5 del prompt maestro: "Probar/configurar proyecto de ejecucion"). Deliberadamente
 * el unico campo del plan: cambiar donde se EJECUTA/FACTURA el job es ortogonal al DATA project
 * (PROJECT_ID/DATASET_ID/TABLE_ID, ver fqTable en 25_BigQueryGateway.js, que nunca lee
 * BIGQUERY_JOB_PROJECT_ID) y a la identidad/certificacion de snapshot (LOAD_KEY_ID, LOAD_TYPE_CODE,
 * LOAD_VERSION_ID, INGESTION_DATETIME, SNAPSHOT_CERTIFICATION, ver SNAPSHOT_KEY_FIELD_ORDER en
 * 20_Snapshot.js, que tampoco la incluye).
 */
function buildJobProjectUpdatePlan(candidateJobProjectId) {
  return { BIGQUERY_JOB_PROJECT_ID: String(candidateJobProjectId || '').trim() };
}

/**
 * Decide, a partir del resultado YA EJECUTADO de las dos pruebas no destructivas (permiso de crear
 * el job + acceso de lectura a la fuente Carmen Gold real, ambas dry run), si corresponde proponer
 * escribir BIGQUERY_JOB_PROJECT_ID. Pura: no ejecuta BigQuery ni toca _CONFIG. Si CUALQUIERA de las
 * dos pruebas fallo, `shouldWrite` es false y `plan` es null — asi ningun llamador puede escribir
 * _CONFIG a partir de un candidato solo parcialmente validado.
 */
function decideJobProjectUpdate(candidateJobProjectId, probeResult) {
  var jobOk = !!(probeResult && probeResult.jobCreation && probeResult.jobCreation.ok);
  var sourceOk = !!(probeResult && probeResult.sourceAccess && probeResult.sourceAccess.ok);
  if (!jobOk || !sourceOk) {
    return { shouldWrite: false, plan: null };
  }
  return { shouldWrite: true, plan: buildJobProjectUpdatePlan(candidateJobProjectId) };
}

// ---------------------------------------------------------------------------
// I/O dependiente de Apps Script (no testeable desde Node; sin logica de negocio propia).
// ---------------------------------------------------------------------------

var ConfigService = {
  /**
   * Lee _CONFIG desde el spreadsheet dado. Devuelve {values, routes, sheetFound}.
   * No lanza si la hoja no existe: devuelve sheetFound=false y values={}, routes=[].
   */
  read: function (ss) {
    var sheet = ss.getSheetByName(SHEET_NAMES.CONFIG);
    if (!sheet) return { values: {}, routes: [], sheetFound: false };

    var lastRow = sheet.getLastRow();
    if (lastRow === 0) return { values: {}, routes: [], sheetFound: true };

    var data = sheet.getRange(1, 1, lastRow, 3).getValues();
    var values = {};
    var routes = [];
    var inRoutes = false;

    for (var i = 0; i < data.length; i++) {
      var a = data[i][0], b = data[i][1], c = data[i][2];
      var aStr = (a === null || a === undefined) ? '' : String(a).trim();
      if (aStr.toUpperCase() === 'KEY' && String(b).trim().toUpperCase() === 'VALUE') continue; // encabezado
      if (aStr.toUpperCase() === 'ROUTES') { inRoutes = true; continue; }
      if (aStr === '') continue;

      if (inRoutes) {
        if (aStr.toUpperCase() === 'CODE') continue; // encabezado de sub-tabla
        routes.push({ code: aStr, priority: b, role: c });
      } else {
        values[aStr] = (b === null || b === undefined) ? '' : b;
      }
    }

    return { values: values, routes: routes, sheetFound: true };
  },

  /**
   * Crea o completa _CONFIG con los valores por defecto SOLO para las claves ausentes.
   * Nunca sobrescribe una clave ya presente. Devuelve la configuracion resultante (merge).
   * Si no falta nada, NO TOCA LA HOJA (ver computeConfigBootstrapPlan): esto es lo que hace
   * seguro llamar loadContext() desde acciones de solo lectura (Diagnostico/Previsualizar/Ver
   * configuracion) sin reescribir _CONFIG en cada clic.
   */
  ensureDefaults: function (ss) {
    var current = ConfigService.read(ss);
    var plan = computeConfigBootstrapPlan(current);

    if (!plan.needsWrite) {
      return { values: current.values, routes: normalizeRoutes(current.routes) };
    }

    var sheet = ss.getSheetByName(SHEET_NAMES.CONFIG);
    if (!sheet) sheet = ss.insertSheet(SHEET_NAMES.CONFIG);

    // Limpiar solo A:C (nunca sheet.clearContents() completo): _CONFIG podria tener columnas D+
    // con notas del operador que no forman parte del contrato de esta hoja y no deben perderse.
    var rowsToClear = Math.max(sheet.getLastRow(), plan.rows.length);
    SheetStructure.ensureMinColumns(sheet, 3);
    SheetStructure.ensureMinRows(sheet, rowsToClear);
    if (rowsToClear > 0) sheet.getRange(1, 1, rowsToClear, 3).clearContent();
    sheet.getRange(1, 1, plan.rows.length, 3).setValues(plan.rows);

    return { values: plan.merged, routes: normalizeRoutes(plan.routes) };
  },

  /**
   * Escribe el resultado de una certificacion de snapshot en _CONFIG (LOAD_KEY_ID, LOAD_TYPE_CODE,
   * LOAD_VERSION_ID, INGESTION_DATETIME, SNAPSHOT_CERTIFICATION). No toca ninguna otra clave.
   */
  writeSnapshotCertification: function (ss, loadIdentity) {
    ConfigService.writeValues(ss, {
      LOAD_KEY_ID: loadIdentity.load_key_id,
      LOAD_TYPE_CODE: loadIdentity.load_type_code,
      LOAD_VERSION_ID: loadIdentity.load_version_id,
      INGESTION_DATETIME: loadIdentity.ingestion_datetime,
      SNAPSHOT_CERTIFICATION: SNAPSHOT_CERTIFICATION.CERTIFIED,
    });
  },

  /**
   * Escribe/actualiza un conjunto arbitrario de claves KEY/VALUE en _CONFIG. Actualiza in-place
   * las claves ya existentes (fila y columna B); agrega al final las que no existian. Nunca toca
   * ninguna otra clave ni la tabla de rutas.
   */
  writeValues: function (ss, keyValueMap) {
    var sheet = ss.getSheetByName(SHEET_NAMES.CONFIG);
    if (!sheet) throw new Error('_CONFIG no existe; ejecute "Diagnostico del sistema" primero.');
    var lastRow = sheet.getLastRow();
    var data = sheet.getRange(1, 1, lastRow, 2).getValues();
    var found = {};
    for (var i = 0; i < data.length; i++) {
      var key = String(data[i][0] || '').trim();
      if (Object.prototype.hasOwnProperty.call(keyValueMap, key)) {
        sheet.getRange(i + 1, 2).setValue(keyValueMap[key]);
        found[key] = true;
      }
    }
    var appendKeys = Object.keys(keyValueMap).filter(function (k) { return !found[k]; });
    if (appendKeys.length) {
      var startRow = sheet.getLastRow() + 1;
      var newRows = appendKeys.map(function (k) { return [k, keyValueMap[k], '']; });
      sheet.getRange(startRow, 1, newRows.length, 3).setValues(newRows);
    }
  },
};

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    canonicalizeConfig: canonicalizeConfig, normalizeRoutes: normalizeRoutes,
    parseAllowedDow: parseAllowedDow, computeConfigHash: computeConfigHash,
    validateConfig: validateConfig, isSnapshotCertified: isSnapshotCertified,
    computeConfigBootstrapPlan: computeConfigBootstrapPlan,
    buildJobProjectUpdatePlan: buildJobProjectUpdatePlan, decideJobProjectUpdate: decideJobProjectUpdate,
    CONFIG_REQUIRED_KEYS: CONFIG_REQUIRED_KEYS, ConfigService: ConfigService,
  };
}
