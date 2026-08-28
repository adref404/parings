const test = require('node:test');
const assert = require('node:assert/strict');
const { sha256Hex, canonJoin, hashFields, stableStringify } = require('../10_Hash.js');

test('sha256Hex - vector vacio', () => {
  assert.equal(sha256Hex(''), 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
});

test('sha256Hex - vector "abc" (NIST)', () => {
  assert.equal(sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
});

test('sha256Hex - mensaje largo multi-bloque (>64 bytes)', () => {
  const msg = 'a'.repeat(200);
  const h1 = sha256Hex(msg);
  const h2 = sha256Hex(msg);
  assert.equal(h1, h2);
  assert.equal(h1.length, 64);
});

test('sha256Hex - UTF-8 multibyte (acentos) no lanza y es deterministico', () => {
  const a = sha256Hex('Pairing LIM-MIA-LIM ñ á é 日本語');
  const b = sha256Hex('Pairing LIM-MIA-LIM ñ á é 日本語');
  assert.equal(a, b);
  assert.equal(a.length, 64);
});

test('canonJoin - evita colisiones por desplazamiento de separador', () => {
  const a = canonJoin(['AB', 'C']);
  const b = canonJoin(['A', 'BC']);
  assert.notEqual(a, b);
});

test('hashFields - mismo contenido en distinto orden de columnas produce distinto hash', () => {
  const h1 = hashFields(['LIM', 'MIA', '2026-09-01']);
  const h2 = hashFields(['MIA', 'LIM', '2026-09-01']);
  assert.notEqual(h1, h2);
});

test('hashFields - determinista para las mismas entradas', () => {
  const fields = ['226', '2026-09-01', '2026-09-03', 'LIM', 'MIA'];
  assert.equal(hashFields(fields), hashFields(fields.slice()));
});

test('stableStringify - orden de claves no afecta el resultado', () => {
  const a = stableStringify({ b: 1, a: 2, c: { z: 1, y: 2 } });
  const b = stableStringify({ a: 2, c: { y: 2, z: 1 }, b: 1 });
  assert.equal(a, b);
});
