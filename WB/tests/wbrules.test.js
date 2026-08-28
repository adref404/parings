const test = require('node:test');
const assert = require('node:assert/strict');
const { classifyRoute, checkOccupiedDays, checkAllowedDow, evaluateWbRules } = require('../35_WBRules.js');

const config = { CREW_BASE_CODE: 'LIM', MAX_OCCUPIED_DAYS: '3' };
const routes = [
  { code: 'MIA', priority: 1, role: 'PRIMARY' },
  { code: 'SCL', priority: 2, role: 'SECONDARY' },
  { code: 'ATL', priority: 3, role: 'FALLBACK' },
];
const allowedDow = ['MON', 'TUE', 'WED', 'THU', 'FRI'];

function pairingWithLegs(airportPairs, occupiedDays, occupiedStartDate, extra) {
  return Object.assign({
    legs: airportPairs.map(function (pair) {
      return { row: { departure_airport_code: pair[0], arrival_airport_code: pair[1] } };
    }),
    occupied_days: occupiedDays,
    occupied_start_date: occupiedStartDate,
  }, extra);
}

test('classifyRoute - LIM-MIA-LIM roundtrip configurado -> OK, prioridad 1, PRIMARY', () => {
  const p = pairingWithLegs([['LIM', 'MIA'], ['MIA', 'LIM']]);
  const r = classifyRoute(p, config, routes);
  assert.equal(r.ok, true);
  assert.equal(r.primary_destination_code, 'MIA');
  assert.equal(r.route_priority, 1);
  assert.equal(r.route_role, 'PRIMARY');
});

test('classifyRoute - ruta NO configurada -> REVIEW aunque el destino sea unico (Seccion 8)', () => {
  const p = pairingWithLegs([['LIM', 'BOG'], ['BOG', 'LIM']]);
  const r = classifyRoute(p, config, routes);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'ROUTE_NOT_CONFIGURED');
});

test('classifyRoute - multi-destino no elige arbitrariamente, va a revision', () => {
  const p = pairingWithLegs([['LIM', 'MIA'], ['MIA', 'SCL'], ['SCL', 'LIM']]);
  const r = classifyRoute(p, config, routes);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'MULTI_DESTINATION_PAIRING');
});

test('classifyRoute - sin outstation detectado -> revision, no asume nada', () => {
  const p = pairingWithLegs([['LIM', 'LIM']]);
  const r = classifyRoute(p, config, routes);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'NO_OUTSTATION_DETECTED');
});

test('checkOccupiedDays - respeta MAX_OCCUPIED_DAYS de config, no un valor fijo', () => {
  assert.equal(checkOccupiedDays({ occupied_days: 3 }, config).ok, true);
  assert.equal(checkOccupiedDays({ occupied_days: 4 }, config).ok, false);
  assert.equal(checkOccupiedDays({ occupied_days: 5 }, { MAX_OCCUPIED_DAYS: '6' }).ok, true, 'debe leer el maximo de config, no hardcodear 3');
});

test('checkOccupiedDays - ventana de ocupacion ausente no se trata como elegible por defecto', () => {
  assert.equal(checkOccupiedDays({ occupied_days: null }, config).ok, false);
});

test('checkAllowedDow - usa el set de config, no MON-THU hardcodeado del script legacy', () => {
  // 2026-09-01 es martes (verificado externamente), y FRI esta permitido en config (a diferencia del legacy).
  assert.equal(checkAllowedDow({ occupied_start_date: { y: 2026, m: 9, d: 4 } }, allowedDow).ok, true); // viernes
  // 2026-09-05 es sabado, no esta en ALLOWED_OCCUPIED_DOW
  assert.equal(checkAllowedDow({ occupied_start_date: { y: 2026, m: 9, d: 5 } }, allowedDow).ok, false);
});

test('evaluateWbRules - ELIGIBLE cuando ruta+dias+dow pasan', () => {
  const p = pairingWithLegs([['LIM', 'MIA'], ['MIA', 'LIM']], 3, { y: 2026, m: 9, d: 1 }); // martes
  const result = evaluateWbRules(p, config, routes, allowedDow);
  assert.equal(result.eligibility_status, 'ELIGIBLE');
  assert.equal(result.requires_review, false);
});

test('evaluateWbRules - REVIEW acumula todas las razones de fallo, nunca REJECTED automatico', () => {
  const p = pairingWithLegs([['LIM', 'BOG'], ['BOG', 'LIM']], 5, { y: 2026, m: 9, d: 5 }); // sabado + 5 dias + ruta no configurada
  const result = evaluateWbRules(p, config, routes, allowedDow);
  assert.equal(result.eligibility_status, 'REVIEW');
  assert.equal(result.requires_review, true);
  assert.match(result.eligibility_reason, /ROUTE_NOT_CONFIGURED/);
  assert.match(result.eligibility_reason, /MAX_OCCUPIED_DAYS_EXCEEDED/);
  assert.match(result.eligibility_reason, /START_DOW_NOT_ALLOWED/);
});

test('evaluateWbRules - NO aplica contaminacion NB: la hora de salida no afecta elegibilidad', () => {
  const legsEarly = [{ row: { departure_airport_code: 'LIM', arrival_airport_code: 'MIA', flight_departure_time_crew_base: '05:00:00' } }, { row: { departure_airport_code: 'MIA', arrival_airport_code: 'LIM' } }];
  const legsLate = [{ row: { departure_airport_code: 'LIM', arrival_airport_code: 'MIA', flight_departure_time_crew_base: '23:00:00' } }, { row: { departure_airport_code: 'MIA', arrival_airport_code: 'LIM' } }]; // NB rechazaria >08:30
  const base = { occupied_days: 3, occupied_start_date: { y: 2026, m: 9, d: 1 } };
  const rEarly = evaluateWbRules(Object.assign({ legs: legsEarly }, base), config, routes, allowedDow);
  const rLate = evaluateWbRules(Object.assign({ legs: legsLate }, base), config, routes, allowedDow);
  assert.equal(rEarly.eligibility_status, 'ELIGIBLE');
  assert.equal(rLate.eligibility_status, 'ELIGIBLE', 'una salida tardia no debe rechazar el pairing WB (esa es una regla NB)');
});
