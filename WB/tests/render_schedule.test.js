const test = require('node:test');
const assert = require('node:assert/strict');
const { buildScheduleGrid, dateColumnHeader } = require('../57_RenderSchedule.js');
const { duParseDate } = require('../05_DateUtil.js');

const config = { REFERENCE_YEAR: '2026', REFERENCE_MONTH: '9' };

function row(assignmentId, pairingId, startIso, endIso, ins) {
  return {
    assignment_id: assignmentId,
    pairing_id: pairingId,
    INS: ins || '',
    pairing: {
      occupied_start_date: duParseDate(startIso), occupied_start_time: { h: 5, mi: 0, s: 0 },
      occupied_end_date: duParseDate(endIso), occupied_end_time: { h: 13, mi: 0, s: 0 },
      route_display: 'LIM-MIA-LIM',
    },
  };
}

test('buildScheduleGrid - la grilla de fechas cubre el mes completo de referencia', () => {
  const grid = buildScheduleGrid([row('A1', '226', '2026-09-01', '2026-09-03')], config);
  const isoList = grid.dateColumns.map(d => d.y + '-' + String(d.m).padStart(2, '0') + '-' + String(d.d).padStart(2, '0'));
  assert.ok(isoList.includes('2026-09-01'));
  assert.ok(isoList.includes('2026-09-30'));
});

test('buildScheduleGrid - guard band cubre un pairing que cruza el limite de mes hacia atras', () => {
  const grid = buildScheduleGrid([row('A1', '226', '2026-08-29', '2026-09-01')], config);
  const isoList = grid.dateColumns.map(d => d.y + '-' + String(d.m).padStart(2, '0') + '-' + String(d.d).padStart(2, '0'));
  assert.ok(isoList.includes('2026-08-29'), 'debe extender la grilla para cubrir el inicio real del pairing');
});

test('buildScheduleGrid - guard band cubre un pairing que cruza hacia el mes siguiente', () => {
  const grid = buildScheduleGrid([row('A1', '226', '2026-09-29', '2026-10-02')], config);
  const isoList = grid.dateColumns.map(d => d.y + '-' + String(d.m).padStart(2, '0') + '-' + String(d.d).padStart(2, '0'));
  assert.ok(isoList.includes('2026-10-02'));
});

test('buildScheduleGrid - dos pairings solapados van a carriles distintos, no solapados comparten carril', () => {
  const grid = buildScheduleGrid([
    row('A1', '226', '2026-09-01', '2026-09-03'),
    row('A2', '227', '2026-09-02', '2026-09-04'), // solapa con A1
    row('A3', '228', '2026-09-05', '2026-09-06'), // no solapa con A1
  ], config);
  const laneA1 = grid.blocks.find(b => b.assignment_id === 'A1').lane;
  const laneA2 = grid.blocks.find(b => b.assignment_id === 'A2').lane;
  const laneA3 = grid.blocks.find(b => b.assignment_id === 'A3').lane;
  assert.notEqual(laneA1, laneA2);
  assert.equal(laneA1, laneA3);
  assert.equal(grid.laneCount, 2);
});

test('buildScheduleGrid - el bloque cubre exactamente desde occupied_start hasta occupied_end', () => {
  const grid = buildScheduleGrid([row('A1', '226', '2026-09-01', '2026-09-03')], config);
  const block = grid.blocks[0];
  const startDate = grid.dateColumns[block.startColIndex];
  const endDate = grid.dateColumns[block.endColIndex];
  assert.deepEqual(startDate, { y: 2026, m: 9, d: 1 });
  assert.deepEqual(endDate, { y: 2026, m: 9, d: 3 });
});

test('buildScheduleGrid - la etiqueta incluye pairing_id, ruta e INS', () => {
  const grid = buildScheduleGrid([row('A1', '226', '2026-09-01', '2026-09-03', 'Juan Perez')], config);
  assert.match(grid.blocks[0].label, /226/);
  assert.match(grid.blocks[0].label, /LIM-MIA-LIM/);
  assert.match(grid.blocks[0].label, /Juan Perez/);
});

test('buildScheduleGrid - un pairing con fecha muy lejana (fuera de la cota de seguridad) no produce indices negativos ni crashea', () => {
  // occupied_start 90 dias antes del mes de referencia: cae fuera de la cota de +/-31 dias.
  const grid = buildScheduleGrid([row('A1', '226', '2026-06-01', '2026-06-03')], config);
  assert.equal(grid.blocks.length, 0, 'debe excluirse en vez de generar un indice de columna invalido');
});

test('buildScheduleGrid - un pairing parcialmente dentro de la cota se recorta a los limites de la grilla, nunca indices negativos', () => {
  // occupied_start muy anterior (fuera de cota), pero occupied_end SI cae dentro de la grilla.
  const grid = buildScheduleGrid([row('A1', '226', '2026-06-01', '2026-08-27')], config);
  assert.equal(grid.blocks.length, 1);
  assert.ok(grid.blocks[0].startColIndex >= 0, 'startColIndex nunca debe ser negativo');
  assert.ok(grid.blocks[0].endColIndex <= grid.dateColumns.length - 1);
});

test('buildScheduleGrid - filas sin pairing actual (revision/orphan) no generan bloque', () => {
  const grid = buildScheduleGrid([{ assignment_id: 'A1', pairing_id: '999', INS: '', pairing: null }], config);
  assert.equal(grid.blocks.length, 0);
});

test('dateColumnHeader - formato DD/MM/YYYY + dia de semana en espanol', () => {
  const header = dateColumnHeader({ y: 2026, m: 9, d: 1 }); // martes
  assert.equal(header, '01/09/2026 MAR');
});
