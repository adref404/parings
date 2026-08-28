/**
 * 05_DateUtil.js
 * Utilidades de fecha/hora SIN uso de `new Date(string)` ni dependencia del timezone
 * del interprete. BigQuery devuelve DATE/TIME/DATETIME como strings; aqui se parsean
 * a structs planos {y,m,d} / {h,m,s} y se opera con aritmetica de calendario pura
 * (algoritmo civil_from_days / days_from_civil de Howard Hinnant), evitando por completo
 * conversiones UTC/local que podrian correr una fecha 30/09 -> 29/09 o 01/10.
 *
 * Todo el modulo es puro (sin SpreadsheetApp/Utilities) para poder testearse con Node.
 */

var DOW_CODES = ['MON', 'TUE', 'WED', 'THU', 'FRI', 'SAT', 'SUN'];

/**
 * Parsea 'YYYY-MM-DD' (formato DATE de BigQuery) a {y,m,d}. Devuelve null si invalido.
 */
function duParseDate(str) {
  if (!str) return null;
  var s = String(str).trim();
  var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (!m) return null;
  return { y: parseInt(m[1], 10), m: parseInt(m[2], 10), d: parseInt(m[3], 10) };
}

/**
 * Parsea 'HH:MM:SS[.ffffff]' (formato TIME de BigQuery) a {h,m,s}. Devuelve null si invalido.
 */
function duParseTime(str) {
  if (str === null || str === undefined || str === '') return null;
  var s = String(str).trim();
  var m = /^(\d{1,2}):(\d{2}):(\d{2})/.exec(s);
  if (!m) return null;
  return { h: parseInt(m[1], 10), mi: parseInt(m[2], 10), s: parseInt(m[3], 10) };
}

/**
 * Parsea DATETIME de BigQuery ('YYYY-MM-DD HH:MM:SS' o con 'T') a {date, time}.
 */
function duParseDatetime(str) {
  if (!str) return null;
  var s = String(str).trim().replace('T', ' ');
  var parts = s.split(' ');
  var date = duParseDate(parts[0]);
  var time = parts[1] ? duParseTime(parts[1]) : { h: 0, mi: 0, s: 0 };
  if (!date) return null;
  return { date: date, time: time || { h: 0, mi: 0, s: 0 } };
}

/** Howard Hinnant days_from_civil: dias desde epoch 1970-01-01 (puede ser negativo). */
function duDaysFromCivil(y, mo, d) {
  y -= mo <= 2 ? 1 : 0;
  var era = Math.floor((y >= 0 ? y : y - 399) / 400);
  var yoe = y - era * 400; // [0, 399]
  var doy = Math.floor((153 * (mo + (mo > 2 ? -3 : 9)) + 2) / 5) + d - 1; // [0, 365]
  var doe = yoe * 365 + Math.floor(yoe / 4) - Math.floor(yoe / 100) + doy; // [0, 146096]
  return era * 146097 + doe - 719468;
}

/** Howard Hinnant civil_from_days: inverso de duDaysFromCivil. */
function duCivilFromDays(z) {
  z += 719468;
  var era = Math.floor((z >= 0 ? z : z - 146096) / 146097);
  var doe = z - era * 146097; // [0, 146096]
  var yoe = Math.floor((doe - Math.floor(doe / 1460) + Math.floor(doe / 36524) - Math.floor(doe / 146096)) / 365); // [0, 399]
  var y = yoe + era * 400;
  var doy = doe - (365 * yoe + Math.floor(yoe / 4) - Math.floor(yoe / 100)); // [0, 365]
  var mp = Math.floor((5 * doy + 2) / 153); // [0, 11]
  var d = doy - Math.floor((153 * mp + 2) / 5) + 1; // [1, 31]
  var m = mp + (mp < 10 ? 3 : -9); // [1, 12]
  return { y: y + (m <= 2 ? 1 : 0), m: m, d: d };
}

/** {y,m,d} -> entero de dia epoch (dias desde 1970-01-01). */
function duEpochDay(date) {
  return duDaysFromCivil(date.y, date.m, date.d);
}

/** entero de dia epoch -> {y,m,d}. */
function duFromEpochDay(epochDay) {
  return duCivilFromDays(epochDay);
}

/** Suma n dias (puede ser negativo) a una fecha {y,m,d}. */
function duAddDays(date, n) {
  return duFromEpochDay(duEpochDay(date) + n);
}

/** Diferencia en dias enteros: epochDay(b) - epochDay(a). */
function duDiffDays(a, b) {
  return duEpochDay(b) - duEpochDay(a);
}

/** Compara dos fechas {y,m,d}: -1, 0, 1. */
function duCompareDate(a, b) {
  var ea = duEpochDay(a), eb = duEpochDay(b);
  return ea < eb ? -1 : (ea > eb ? 1 : 0);
}

/** Segundos dentro del dia para {h,mi,s}. */
function duTimeToSeconds(time) {
  if (!time) return 0;
  return time.h * 3600 + time.mi * 60 + time.s;
}

/**
 * Clave numerica ordenable para (fecha, hora): epochDay * 100000 + segundosDelDia.
 * segundosDelDia < 86400 < 100000, por lo que el orden lexicografico numerico es correcto.
 */
function duSortKey(date, time) {
  return duEpochDay(date) * 100000 + duTimeToSeconds(time || { h: 0, mi: 0, s: 0 });
}

/** Codigo de dia de semana MON..SUN para una fecha {y,m,d}. 1970-01-01 fue jueves. */
function duDowCode(date) {
  var e = duEpochDay(date);
  var idx = ((e % 7) + 3 + 7) % 7; // 0=MON .. 6=SUN
  return DOW_CODES[idx];
}

/** Formatea {y,m,d} como DD/MM/YYYY para display en Sheets. */
function duFormatDisplay(date) {
  if (!date) return '';
  return pad2(date.d) + '/' + pad2(date.m) + '/' + date.y;
}

/** Formatea {y,m,d} como YYYY-MM-DD (ISO). */
function duFormatIso(date) {
  if (!date) return '';
  return date.y + '-' + pad2(date.m) + '-' + pad2(date.d);
}

/** Inversa de duFormatDisplay: parsea 'DD/MM/YYYY' -> {y,m,d}. Devuelve null si el formato no calza. */
function duParseDisplayDate(str) {
  if (!str) return null;
  var m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(String(str).trim());
  if (!m) return null;
  return { y: parseInt(m[3], 10), m: parseInt(m[2], 10), d: parseInt(m[1], 10) };
}

/** Formatea {h,mi,s} como HH:MM. */
function duFormatTimeShort(time) {
  if (!time) return '';
  return pad2(time.h) + ':' + pad2(time.mi);
}

function pad2(n) {
  return (n < 10 ? '0' : '') + n;
}

/** Devuelve true si el codigo de dia de semana de `date` esta en el set permitido (array de codigos). */
function duIsAllowedDow(date, allowedCodes) {
  var code = duDowCode(date);
  for (var i = 0; i < allowedCodes.length; i++) {
    if (allowedCodes[i] === code) return true;
  }
  return false;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    duParseDate: duParseDate, duParseTime: duParseTime, duParseDatetime: duParseDatetime,
    duEpochDay: duEpochDay, duFromEpochDay: duFromEpochDay, duAddDays: duAddDays,
    duDiffDays: duDiffDays, duCompareDate: duCompareDate, duTimeToSeconds: duTimeToSeconds,
    duSortKey: duSortKey, duDowCode: duDowCode, duFormatDisplay: duFormatDisplay,
    duFormatIso: duFormatIso, duFormatTimeShort: duFormatTimeShort, duIsAllowedDow: duIsAllowedDow,
    duParseDisplayDate: duParseDisplayDate, DOW_CODES: DOW_CODES,
  };
}
