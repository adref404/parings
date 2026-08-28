/**
 * 70_QA.js
 * QaService: checks Q1-Q20 (Seccion 38). La mayoria son funciones puras sobre estructuras en
 * memoria para poder correrlas tanto ANTES de escribir (pre-write, sobre lo que se va a escribir)
 * como DESPUES de escribir (post-write, sobre lo que realmente quedo en la hoja tras releerla).
 *
 * Cada check devuelve {code, passed, detail}. QaService.runAll(...) agrega la lista completa.
 */

if (typeof module !== 'undefined' && module.exports) {
  var __Config70 = require('./15_Config.js');
  var validateConfig70 = __Config70.validateConfig;
  var isSnapshotCertified70 = __Config70.isSnapshotCertified;
  var __BQ70 = require('./25_BigQueryGateway.js');
  var validateSchema70 = __BQ70.validateSchema;
  var sqlHasPartitionFilter70 = __BQ70.sqlHasPartitionFilter;
  var sqlIsReadOnly70 = __BQ70.sqlIsReadOnly;
  var sqlHasSelectStar70 = __BQ70.sqlHasSelectStar;
  var __Constants70 = require('./00_Constants.js');
  var PAIRINGS_DATA_HEADERS70 = __Constants70.PAIRINGS_DATA_HEADERS;
  var ELIGIBILITY_STATUS70 = __Constants70.ELIGIBILITY_STATUS;
} else {
  var validateConfig70 = validateConfig, isSnapshotCertified70 = isSnapshotCertified,
      validateSchema70 = validateSchema, sqlHasPartitionFilter70 = sqlHasPartitionFilter,
      sqlIsReadOnly70 = sqlIsReadOnly, sqlHasSelectStar70 = sqlHasSelectStar,
      PAIRINGS_DATA_HEADERS70 = PAIRINGS_DATA_HEADERS, ELIGIBILITY_STATUS70 = ELIGIBILITY_STATUS;
}

var FORMULA_ERROR_TOKENS = ['#REF!', '#VALUE!', '#N/A', '#ERROR!', '#DIV/0!', '#NAME?', '#NULL!', '#NUM!'];
var FORBIDDEN_NB_TOKENS = ['08:30', 'PDR', 'PSV', 'A319', 'A320', 'Calculadora PDR'];

function check(code, passed, detail) { return { code: code, passed: !!passed, detail: detail || '' }; }

/** Elimina comentarios de bloque y de linea de una fuente JS (heuristica suficiente para este proyecto). */
function stripJsComments(source) {
  return String(source)
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

var QaService = {
  q1ConfigValid: function (config, routes) {
    var r = validateConfig70(config, routes);
    return check('Q1', r.valid, r.errors.join(' | '));
  },

  q2RulesetCompatible: function (config) {
    var r = validateConfig70(config, [{ code: 'X', priority: 1, role: 'PRIMARY' }]); // rutas irrelevantes para este check puntual
    var rulesetErrors = r.errors.filter(function (e) { return e.indexOf('RULESET_ID') !== -1; });
    return check('Q2', rulesetErrors.length === 0, rulesetErrors.join(' | '));
  },

  q3SnapshotCertified: function (config, allowPreview) {
    var passed = isSnapshotCertified70(config, allowPreview);
    var detail = 'LOAD_KEY_ID=' + config.LOAD_KEY_ID + ' SNAPSHOT_CERTIFICATION=' + config.SNAPSHOT_CERTIFICATION;
    if (!passed && config.LOAD_KEY_ID === 'PENDING_CERTIFICATION') {
      detail += ' — ningun snapshot fue certificado todavia; ejecute "Detectar snapshots del mes" y "Certificar snapshot" primero (incluso para previsualizar)';
    }
    return check('Q3', passed, detail);
  },

  q4RequiredColumns: function (schemaFields) {
    var r = validateSchema70(schemaFields);
    return check('Q4', r.ok, r.missing.join(', '));
  },

  q5PartitionFilter: function (sql) {
    return check('Q5', sqlHasPartitionFilter70(sql, 'pairing_start_date'), 'filtro de particion pairing_start_date');
  },

  q6ReadOnly: function (sql) {
    return check('Q6', sqlIsReadOnly70(sql), 'sin DML/DDL en el SQL generado');
  },

  q7NoSelectStar: function (sql) {
    return check('Q7', !sqlHasSelectStar70(sql), 'SELECT * detectado');
  },

  /** Compara INS/ACT antes/despues de un dry run: deben ser identicos byte a byte. */
  q8NoHumanDataChangedInDryRun: function (beforeRows, afterRows) {
    var beforeMap = {};
    beforeRows.forEach(function (r) { beforeMap[r.assignment_id] = r; });
    var diffs = [];
    afterRows.forEach(function (r) {
      var b = beforeMap[r.assignment_id];
      if (b && (b.INS !== r.INS || b.ACT !== r.ACT)) diffs.push(r.assignment_id);
    });
    return check('Q8', diffs.length === 0, diffs.length ? ('assignment_id afectados: ' + diffs.join(', ')) : '');
  },

  q9AssignmentIdUnique: function (rows) {
    var seen = {}, dups = [];
    rows.forEach(function (r) {
      if (!r.assignment_id) return;
      if (seen[r.assignment_id]) dups.push(r.assignment_id);
      seen[r.assignment_id] = true;
    });
    return check('Q9', dups.length === 0, dups.join(', '));
  },

  /** Heuristica: assignment_id nunca debe coincidir con pairing_instance_key (indicio de PK mal usada). */
  q10NoPikAsHumanPk: function (rows) {
    var offenders = rows.filter(function (r) { return r.assignment_id && r.assignment_id === r.pairing_instance_key; });
    return check('Q10', offenders.length === 0, offenders.map(function (r) { return r.assignment_id; }).join(', '));
  },

  /** 0 perdida de INS: todo assignment_id previo con INS no vacio debe seguir existiendo con el mismo INS. */
  q11NoInsLoss: function (beforeRows, afterRows) {
    return checkFieldPreserved('Q11', beforeRows, afterRows, 'INS');
  },

  q12NoActLoss: function (beforeRows, afterRows) {
    return checkFieldPreserved('Q12', beforeRows, afterRows, 'ACT');
  },

  /** Multiplicidades preservadas: la suma de source_row_multiplicity por leg debe igualar las filas crudas de entrada. */
  q13MultiplicitiesPreserved: function (rawRowCount, assembledPairings) {
    var sum = 0;
    assembledPairings.forEach(function (p) { p.legs.forEach(function (l) { sum += l.source_row_multiplicity; }); });
    return check('Q13', sum === rawRowCount, 'suma_multiplicidad=' + sum + ' filas_crudas=' + rawRowCount);
  },

  q14PairingsDataSchemaCompatible: function (headerRow) {
    var missing = PAIRINGS_DATA_HEADERS70.filter(function (h) { return headerRow.indexOf(h) === -1; });
    return check('Q14', missing.length === 0, missing.join(', '));
  },

  /** Ninguna ruta no configurada debe quedar marcada ELIGIBLE. */
  q15UnknownRoutesReview: function (evaluatedPairings, configuredRouteCodes) {
    var offenders = evaluatedPairings.filter(function (p) {
      return p.eligibility_status === ELIGIBILITY_STATUS70.ELIGIBLE && configuredRouteCodes.indexOf(p.primary_destination_code) === -1;
    });
    return check('Q15', offenders.length === 0, offenders.map(function (p) { return p.pairing_id; }).join(', '));
  },

  /**
   * Escanea el CODIGO (no los comentarios/documentacion) de los modulos de reglas por tokens NB
   * prohibidos (Seccion 9). Los comentarios se excluyen a proposito: este archivo y otros
   * documentan explicitamente que reglas NB estan excluidas (Seccion 9), lo cual mencionaria los
   * tokens sin que eso implique contaminacion real de logica.
   */
  q16NbContaminationZero: function (sourceTextsByFile) {
    var hits = [];
    Object.keys(sourceTextsByFile).forEach(function (file) {
      var codeOnly = stripJsComments(sourceTextsByFile[file]);
      FORBIDDEN_NB_TOKENS.forEach(function (token) {
        if (codeOnly.indexOf(token) !== -1) hits.push(file + ':' + token);
      });
    });
    return check('Q16', hits.length === 0, hits.join(', '));
  },

  /** Verifica que una fecha ISO original y su representacion parseada/reformateada coincidan (sin drift). */
  q17DateShiftsZero: function (pairs) {
    var offenders = pairs.filter(function (p) { return p.originalIso !== p.roundTrippedIso; });
    return check('Q17', offenders.length === 0, JSON.stringify(offenders));
  },

  /** Escanea una matriz de valores ya escrita/releida por tokens de error de formula. */
  q18q19q20FormulaErrors: function (matrix) {
    var offenders = [];
    (matrix || []).forEach(function (row, r) {
      (row || []).forEach(function (cell, c) {
        var s = String(cell === null || cell === undefined ? '' : cell);
        FORMULA_ERROR_TOKENS.forEach(function (token) {
          if (s.indexOf(token) !== -1) offenders.push('R' + (r + 1) + 'C' + (c + 1) + ':' + token);
        });
      });
    });
    return check('Q18-20', offenders.length === 0, offenders.join(', '));
  },
};

function checkFieldPreserved(code, beforeRows, afterRows, field) {
  var afterMap = {};
  afterRows.forEach(function (r) { afterMap[r.assignment_id] = r; });
  var offenders = [];
  beforeRows.forEach(function (b) {
    if (!b[field]) return; // nada que preservar
    var a = afterMap[b.assignment_id];
    if (!a || a[field] !== b[field]) offenders.push(b.assignment_id);
  });
  return check(code, offenders.length === 0, offenders.join(', '));
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = { QaService: QaService, FORMULA_ERROR_TOKENS: FORMULA_ERROR_TOKENS, FORBIDDEN_NB_TOKENS: FORBIDDEN_NB_TOKENS };
}
