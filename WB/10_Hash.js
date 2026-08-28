/**
 * 10_Hash.js
 * SHA-256 puro en JavaScript (sin `Utilities.computeDigest`, sin `crypto` de Node) para que
 * el mismo codigo produzca hashes bit-identicos tanto en Apps Script V8 como en las pruebas
 * de Node (Seccion 20: "pairing_content_hash debe ser deterministico").
 *
 * No se usa con fines de seguridad criptografica: unicamente para identidad de contenido
 * (deduplicacion, deteccion de cambios, claves de snapshot/historico).
 *
 * Ademas incluye helpers de canonicalizacion: los campos se serializan con codificacion tipo
 * netstring (longitud + ':' + valor) para que un valor que contuviera el separador no pueda
 * producir colisiones por desplazamiento de campos.
 */

var SHA256_K = [
  0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
  0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
  0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
  0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
  0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
  0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
  0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
  0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
];

function sha256Rotr(x, n) { return (x >>> n) | (x << (32 - n)); }

/** Codifica un string JS (UTF-16) como array de bytes UTF-8. */
function sha256Utf8Bytes(str) {
  var bytes = [];
  for (var i = 0; i < str.length; i++) {
    var code = str.codePointAt(i);
    if (code > 0xFFFF) i++; // par subrogado consumido por codePointAt
    if (code < 0x80) {
      bytes.push(code);
    } else if (code < 0x800) {
      bytes.push(0xC0 | (code >> 6), 0x80 | (code & 0x3F));
    } else if (code < 0x10000) {
      bytes.push(0xE0 | (code >> 12), 0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F));
    } else {
      bytes.push(
        0xF0 | (code >> 18), 0x80 | ((code >> 12) & 0x3F),
        0x80 | ((code >> 6) & 0x3F), 0x80 | (code & 0x3F)
      );
    }
  }
  return bytes;
}

/**
 * SHA-256 de un string (interpretado como UTF-8). Devuelve digest hexadecimal minuscula (64 chars).
 */
function sha256Hex(message) {
  var bytes = sha256Utf8Bytes(String(message));
  var bitLenHigh = 0;
  var bitLenLow = bytes.length * 8;
  // padding: 0x80, ceros, longitud 64-bit big-endian, multiplo de 64 bytes
  bytes.push(0x80);
  while ((bytes.length % 64) !== 56) bytes.push(0);
  // longitud en bits como 2 x 32 bits big-endian (bitLenHigh siempre 0 para mensajes < 2^32 bytes)
  bytes.push(
    (bitLenHigh >>> 24) & 0xFF, (bitLenHigh >>> 16) & 0xFF, (bitLenHigh >>> 8) & 0xFF, bitLenHigh & 0xFF,
    (bitLenLow >>> 24) & 0xFF, (bitLenLow >>> 16) & 0xFF, (bitLenLow >>> 8) & 0xFF, bitLenLow & 0xFF
  );

  var h0 = 0x6a09e667, h1 = 0xbb67ae85, h2 = 0x3c6ef372, h3 = 0xa54ff53a;
  var h4 = 0x510e527f, h5 = 0x9b05688c, h6 = 0x1f83d9ab, h7 = 0x5be0cd19;

  var w = new Array(64);
  for (var chunkStart = 0; chunkStart < bytes.length; chunkStart += 64) {
    for (var t = 0; t < 16; t++) {
      var o = chunkStart + t * 4;
      w[t] = ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
    }
    for (t = 16; t < 64; t++) {
      var s0 = sha256Rotr(w[t - 15], 7) ^ sha256Rotr(w[t - 15], 18) ^ (w[t - 15] >>> 3);
      var s1 = sha256Rotr(w[t - 2], 17) ^ sha256Rotr(w[t - 2], 19) ^ (w[t - 2] >>> 10);
      w[t] = (w[t - 16] + s0 + w[t - 7] + s1) >>> 0;
    }

    var a = h0, b = h1, c = h2, d = h3, e = h4, f = h5, g = h6, hh = h7;
    for (t = 0; t < 64; t++) {
      var S1 = sha256Rotr(e, 6) ^ sha256Rotr(e, 11) ^ sha256Rotr(e, 25);
      var ch = (e & f) ^ ((~e) & g);
      var temp1 = (hh + S1 + ch + SHA256_K[t] + w[t]) >>> 0;
      var S0 = sha256Rotr(a, 2) ^ sha256Rotr(a, 13) ^ sha256Rotr(a, 22);
      var maj = (a & b) ^ (a & c) ^ (b & c);
      var temp2 = (S0 + maj) >>> 0;

      hh = g; g = f; f = e; e = (d + temp1) >>> 0;
      d = c; c = b; b = a; a = (temp1 + temp2) >>> 0;
    }

    h0 = (h0 + a) >>> 0; h1 = (h1 + b) >>> 0; h2 = (h2 + c) >>> 0; h3 = (h3 + d) >>> 0;
    h4 = (h4 + e) >>> 0; h5 = (h5 + f) >>> 0; h6 = (h6 + g) >>> 0; h7 = (h7 + hh) >>> 0;
  }

  var out = [h0, h1, h2, h3, h4, h5, h6, h7];
  return out.map(function (x) { return ('00000000' + (x >>> 0).toString(16)).slice(-8); }).join('');
}

/** Representacion canonica de un valor escalar: null/undefined -> '', resto -> String(v). */
function canonField(v) {
  if (v === null || v === undefined) return '';
  return String(v);
}

/**
 * Codificacion tipo netstring de una lista de campos: "<len>:<valor>" concatenados.
 * Evita colisiones por desplazamiento de separador (p.ej. ["AB","C"] vs ["A","BC"]).
 */
function canonJoin(fields) {
  var parts = [];
  for (var i = 0; i < fields.length; i++) {
    var s = canonField(fields[i]);
    parts.push(s.length + ':' + s);
  }
  return parts.join('');
}

/** sha256 hex de la union canonica de una lista de campos. */
function hashFields(fields) {
  return sha256Hex(canonJoin(fields));
}

/** JSON.stringify estable: ordena las claves del objeto de forma recursiva y determinista. */
function stableStringify(obj) {
  return JSON.stringify(sortKeysDeep(obj));
}

function sortKeysDeep(value) {
  if (Array.isArray(value)) return value.map(sortKeysDeep);
  if (value && typeof value === 'object') {
    var sorted = {};
    Object.keys(value).sort().forEach(function (k) { sorted[k] = sortKeysDeep(value[k]); });
    return sorted;
  }
  return value;
}

if (typeof module !== 'undefined' && module.exports) {
  module.exports = {
    sha256Hex: sha256Hex, canonField: canonField, canonJoin: canonJoin,
    hashFields: hashFields, stableStringify: stableStringify, sortKeysDeep: sortKeysDeep,
  };
}
