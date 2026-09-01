const test = require('node:test');
const assert = require('node:assert/strict');
const { buildPairingsWbMenuSpec_, buildGuiaHtmlContent_ } = require('../90_Menu.js');
const { SHEET_NAMES } = require('../00_Constants.js');

/** Aplana un nodo {type:'item'|'separator'|'submenu', ...} a la lista de handler fn (`item`) que contiene, recursivamente. */
function collectFns(items) {
  var out = [];
  items.forEach(function (entry) {
    if (entry.type === 'item') out.push(entry.fn);
    else if (entry.type === 'submenu') out = out.concat(collectFns(entry.items));
  });
  return out;
}

function findSubmenu(items, label) {
  return items.filter(function (e) { return e.type === 'submenu' && e.label === label; })[0];
}

// Handlers tecnicos/administrativos: NUNCA deben aparecer en el primer nivel del menu (M4).
const TECHNICAL_FNS = [
  'wbMenuDiagnostico', 'wbMenuVerConfiguracion', 'wbMenuConfigurarAnioMes',
  'wbMenuDetectarSnapshots', 'wbMenuCertificarSnapshot', 'wbMenuCompararSnapshotConResumen',
  'wbMenuProbarConsulta', 'wbMenuProbarConfigurarProyectoEjecucion',
  'wbMenuPrevisualizarCalculo', 'wbMenuReconciliarCambios',
  'wbMenuCrearVerificarHistorico', 'wbMenuAbrirCarpetaHistoricos',
  'wbMenuVerUltimoRun', 'wbMenuEjecutarQA', 'wbMenuGuiaDeUso',
];

const END_USER_FNS = [
  'wbMenuActualizarPairingsWB', 'wbMenuPrevisualizarCambios', 'wbMenuVerEstadoDelMes', 'wbMenuIrAResumen',
];

test('M1 - existe exactamente UN menu de nivel superior llamado "Pairings WB"', () => {
  const spec = buildPairingsWbMenuSpec_();
  assert.equal(typeof spec, 'object');
  assert.equal(spec.label, 'Pairings WB');
  // La especificacion es un unico objeto raiz (no un array de menus): estructuralmente solo puede
  // existir un menu de nivel superior.
  assert.equal(Array.isArray(spec), false);
});

test('M2 - las 4 acciones de usuario final aparecen, en orden, ANTES de "Administración"', () => {
  const spec = buildPairingsWbMenuSpec_();
  const topLabels = spec.items.filter((e) => e.type !== 'separator').map((e) => e.label);
  const adminIdx = topLabels.indexOf('Administración');
  assert.notEqual(adminIdx, -1, 'debe existir "Administración" en el nivel superior');

  const expectedOrder = ['Actualizar Pairings WB', 'Previsualizar cambios', 'Ver estado del mes', 'Ir a RESUMEN'];
  expectedOrder.forEach((label, i) => {
    assert.equal(topLabels[i], label, `posicion ${i} del menu debe ser "${label}"`);
  });
  assert.ok(adminIdx >= expectedOrder.length, 'Administración va despues de las 4 acciones de usuario final');

  const topFns = collectFns(spec.items.filter((e) => e.type === 'item'));
  assert.deepEqual(topFns.sort(), END_USER_FNS.slice().sort(), 'el nivel superior (fuera de Administración) son EXACTAMENTE las 4 acciones de usuario final');
});

test('M3 - existe el submenu "Administración"', () => {
  const spec = buildPairingsWbMenuSpec_();
  const admin = findSubmenu(spec.items, 'Administración');
  assert.ok(admin, 'debe existir un submenu "Administración"');
  assert.ok(Array.isArray(admin.items) && admin.items.length > 0);
});

test('M4 - ninguna herramienta tecnica/administrativa esta en el nivel superior', () => {
  const spec = buildPairingsWbMenuSpec_();
  const topFns = collectFns(spec.items.filter((e) => e.type === 'item')); // solo items DIRECTOS del top-level, no recursivo dentro de submenus
  TECHNICAL_FNS.forEach((fn) => {
    assert.equal(topFns.indexOf(fn), -1, `"${fn}" es una herramienta tecnica y no debe estar en el nivel superior`);
  });
});

test('M5 - "Administración" esta organizada en las 5 categorias requeridas', () => {
  const spec = buildPairingsWbMenuSpec_();
  const admin = findSubmenu(spec.items, 'Administración');
  const subLabels = admin.items.filter((e) => e.type === 'submenu').map((e) => e.label);
  assert.deepEqual(subLabels, ['Configuración', 'Fuente de datos', 'Proceso y reconciliación', 'Históricos', 'Auditoría y QA']);

  // Cada handler tecnico debe estar en ALGUNA de estas categorias (ninguno suelto directo en Administración, salvo la guia).
  const allFnsInSubcategories = subLabels.reduce((acc, label) => acc.concat(collectFns(findSubmenu(admin.items, label).items)), []);
  TECHNICAL_FNS.filter((fn) => fn !== 'wbMenuGuiaDeUso').forEach((fn) => {
    assert.ok(allFnsInSubcategories.indexOf(fn) !== -1, `"${fn}" debe estar dentro de una subcategoria de Administración`);
  });
});

test('M6 - "Guía de uso y administración" es la ULTIMA opcion de Administración', () => {
  const spec = buildPairingsWbMenuSpec_();
  const admin = findSubmenu(spec.items, 'Administración');
  const last = admin.items[admin.items.length - 1];
  assert.equal(last.type, 'item');
  assert.equal(last.label, 'Guía de uso y administración');
  assert.equal(last.fn, 'wbMenuGuiaDeUso');
});

test('M7 - la guia cubre las 7 hojas (visibles + tecnicas) por su nombre REAL (00_Constants.js)', () => {
  const html = buildGuiaHtmlContent_();
  const sheets = [
    SHEET_NAMES.VUELOS, SHEET_NAMES.CRONOGRAMA, SHEET_NAMES.RESUMEN, SHEET_NAMES.DICCIONARIO,
    SHEET_NAMES.PAIRINGS_DATA, SHEET_NAMES.CONFIG, SHEET_NAMES.RUNS,
  ];
  sheets.forEach((name) => {
    assert.ok(html.indexOf(name) !== -1, `la guia debe mencionar la hoja "${name}"`);
  });
});

test('la guia no depende de HtmlService/SpreadsheetApp (es pura, testeable en Node)', () => {
  assert.equal(typeof buildGuiaHtmlContent_(), 'string');
});
