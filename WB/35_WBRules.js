/**
 * 35_WBRules.js
 * WBRulesEngine (Seccion 8, 9, 18): clasificacion de ruta (MIA/SCL/ATL segun _CONFIG),
 * MAX_OCCUPIED_DAYS y ALLOWED_OCCUPIED_DOW. Ruleset LP_WB_B767.
 *
 * PROHIBIDO (Seccion 9): nada aqui aplica reglas NB (inicio > 08:30, conexion 50-90 min, PDR,
 * PSV NB, A319/A320, calculadora PDR). Este motor SOLO conoce ruta/dias/DOW segun _CONFIG.
 *
 * Una ruta o combinacion no configurada explicitamente NUNCA se vuelve elegible solo por cumplir
 * MAX_OCCUPIED_DAYS: siempre requiere coincidir con una fila de la tabla de rutas.
 * Ninguna condicion aqui produce REJECTED automatico: lo que no es claramente ELIGIBLE pasa a
 * REVIEW para juicio humano (Seccion 18: "no inventes un tie-breaker empresarial").
 */

if (typeof module !== 'undefined' && module.exports) {
  var __DateUtil35 = require('./05_DateUtil.js');
  var duDowCode = __DateUtil35.duDowCode;
  var __Constants35 = require('./00_Constants.js');
  var ELIGIBILITY_STATUS = __Constants35.ELIGIBILITY_STATUS;
}

/**
 * Determina el/los aeropuertos "fuera de base" tocados por el pairing. Un WB roundtrip tipico
 * es BASE-X-BASE; si aparece mas de un aeropuerto distinto de la base, o ninguno, se marca para
 * revision en vez de asumir cual es el destino principal.
 */
function detectOutstations(pairing, crewBaseCode) {
  var seen = {};
  pairing.legs.forEach(function (leg) {
    var r = leg.row;
    [r.departure_airport_code, r.arrival_airport_code].forEach(function (code) {
      if (code && code !== crewBaseCode) seen[code] = true;
    });
  });
  return Object.keys(seen);
}

/**
 * Clasifica la ruta del pairing contra la tabla de rutas configurada (normalizeRoutes de 15_Config.js;
 * aqui se recibe ya normalizada: [{code, priority, role}]).
 */
function classifyRoute(pairing, config, routes) {
  var outstations = detectOutstations(pairing, config.CREW_BASE_CODE);

  if (outstations.length === 0) {
    return { primary_destination_code: '', route_display: '', route_priority: null, route_role: '', ok: false, reason: 'NO_OUTSTATION_DETECTED' };
  }
  if (outstations.length > 1) {
    return { primary_destination_code: outstations.join('/'), route_display: config.CREW_BASE_CODE + '-' + outstations.join('/') + '-' + config.CREW_BASE_CODE, route_priority: null, route_role: '', ok: false, reason: 'MULTI_DESTINATION_PAIRING' };
  }

  var code = outstations[0];
  var match = null;
  for (var i = 0; i < routes.length; i++) {
    if (routes[i].code === code) { match = routes[i]; break; }
  }

  if (!match) {
    return { primary_destination_code: code, route_display: config.CREW_BASE_CODE + '-' + code + '-' + config.CREW_BASE_CODE, route_priority: null, route_role: '', ok: false, reason: 'ROUTE_NOT_CONFIGURED' };
  }

  return {
    primary_destination_code: code,
    route_display: config.CREW_BASE_CODE + '-' + code + '-' + config.CREW_BASE_CODE,
    route_priority: match.priority,
    route_role: match.role,
    ok: true,
    reason: 'OK',
  };
}

/** Q: MAX_OCCUPIED_DAYS. occupied_days debe existir (occupied_source != MISSING) y ser <= al maximo configurado. */
function checkOccupiedDays(pairing, config) {
  var max = parseInt(config.MAX_OCCUPIED_DAYS, 10);
  if (pairing.occupied_days === null || pairing.occupied_days === undefined) {
    return { ok: false, reason: 'OCCUPIED_WINDOW_MISSING' };
  }
  if (pairing.occupied_days > max) {
    return { ok: false, reason: 'MAX_OCCUPIED_DAYS_EXCEEDED(' + pairing.occupied_days + '>' + max + ')' };
  }
  return { ok: true, reason: 'OK' };
}

/** ALLOWED_OCCUPIED_DOW: se evalua sobre el dia de semana de occupied_start_date (ver D6 en docs/DECISIONS.md). */
function checkAllowedDow(pairing, allowedDowCodes) {
  if (!pairing.occupied_start_date) return { ok: false, reason: 'OCCUPIED_START_MISSING' };
  var code = duDowCode(pairing.occupied_start_date);
  var allowed = allowedDowCodes.indexOf(code) !== -1;
  return allowed ? { ok: true, reason: 'OK' } : { ok: false, reason: 'START_DOW_NOT_ALLOWED(' + code + ')' };
}

/**
 * Evalua el ruleset WB completo sobre un pairing ya ensamblado. Devuelve un objeto con
 * eligibility_status/eligibility_reason/requires_review + los campos de ruta derivados, listos
 * para fusionarse en el registro de _PAIRINGS_DATA.
 */
function evaluateWbRules(pairing, config, routes, allowedDowCodes) {
  var route = classifyRoute(pairing, config, routes);
  var days = checkOccupiedDays(pairing, config);
  var dow = checkAllowedDow(pairing, allowedDowCodes);

  var reasons = [];
  if (!route.ok) reasons.push(route.reason);
  if (!days.ok) reasons.push(days.reason);
  if (!dow.ok) reasons.push(dow.reason);

  var eligible = route.ok && days.ok && dow.ok;

  return {
    primary_destination_code: route.primary_destination_code,
    route_display: route.route_display,
    route_priority: route.route_priority,
    route_role: route.route_role,
    eligibility_status: eligible ? ELIGIBILITY_STATUS.ELIGIBLE : ELIGIBILITY_STATUS.REVIEW,
    eligibility_reason: eligible ? 'OK' : reasons.join('; '),
    requires_review: !eligible,
  };
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    detectOutstations: detectOutstations, classifyRoute: classifyRoute,
    checkOccupiedDays: checkOccupiedDays, checkAllowedDow: checkAllowedDow,
    evaluateWbRules: evaluateWbRules,
  };
}
