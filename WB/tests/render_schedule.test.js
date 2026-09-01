const test = require('node:test');
const assert = require('node:assert/strict');
const { buildScheduleGrid, buildBlockLabel, scheduleWeekdayRow, scheduleDateRow } = require('../57_RenderSchedule.js');
const { duParseDate } = require('../05_DateUtil.js');

const config = { REFERENCE_YEAR: '2026', REFERENCE_MONTH: '9' };

function leg(overrides) {
  return Object.assign({
    departure_airport_code: 'LIM', arrival_airport_code: 'MIA',
    flight_departure_time_crew_base: '00:15:00', flight_arrival_hour_block_time: '06:20:00',
    flight_number: '2480', carrier_code: 'LA',
  }, overrides);
}

function row(assignmentId, pairingId, startIso, endIso, ins, legs) {
  return {
    assignment_id: assignmentId,
    pairing_id: pairingId,
    INS: ins || '',
    pairing: {
      occupied_start_date: duParseDate(startIso), occupied_start_time: { h: 5, mi: 0, s: 0 },
      occupied_end_date: duParseDate(endIso), occupied_end_time: { h: 13, mi: 0, s: 0 },
      route_display: 'LIM-MIA-LIM',
      legs: legs || [{ row: leg({}) }],
    },
  };
}

test('buildScheduleGrid - la grilla de fechas cubre el mes completo de referencia', () => {
  const grid = buildScheduleGrid([row('A1', '226', '2026-09-01', '2026-09-03')], config);
  const isoList = grid.dateColumns.map(d => d.y + '-' + String(d.m).padStart(2, '0') + '-' + String(d.d).padStart(2, '0'));
  assert.ok(isoList.includes('2026-09-01'));
  assert.ok(isoList.includes('2026-09-30'));
});

test('buildScheduleGrid - sin pairings que crucen el limite, NO hay dias de guarda estaticos (T10, correccion post-D15)', () => {
  const grid = buildScheduleGrid([], config);
  assert.equal(grid.dateColumns.length, 30, 'septiembre 2026 tiene 30 dias, sin padding fantasma');
  const isoList = grid.dateColumns.map(d => d.y + '-' + String(d.m).padStart(2, '0') + '-' + String(d.d).padStart(2, '0'));
  assert.equal(isoList[0], '2026-09-01');
  assert.equal(isoList[isoList.length - 1], '2026-09-30');
});

test('buildScheduleGrid - guard band cubre un pairing que cruza el limite de mes hacia atras', () => {
  const grid = buildScheduleGrid([row('A1', '226', '2026-08-29', '2026-09-01')], config);
  const isoList = grid.dateColumns.map(d => d.y + '-' + String(d.m).padStart(2, '0') + '-' + String(d.d).padStart(2, '0'));
  assert.ok(isoList.includes('2026-08-29'), 'debe extender la grilla para cubrir el inicio real del pairing');
});

test('buildScheduleGrid - guard band cubre un pairing que cruza hacia el mes siguiente hasta 02/10 (T10)', () => {
  const grid = buildScheduleGrid([row('A1', '226', '2026-09-29', '2026-10-02')], config);
  const isoList = grid.dateColumns.map(d => d.y + '-' + String(d.m).padStart(2, '0') + '-' + String(d.d).padStart(2, '0'));
  assert.ok(isoList.includes('2026-10-02'));
  assert.equal(grid.dateColumns.length, 32, '30 dias de septiembre + 2 dias reales hacia octubre, sin guarda estatica extra');
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

test('buildScheduleGrid - la etiqueta incluye pairing_id, ruta e INS en la primera linea (T11)', () => {
  const grid = buildScheduleGrid([row('A1', '226', '2026-09-01', '2026-09-03', 'Juan Perez')], config);
  const firstLine = grid.blocks[0].label.split('\n')[0];
  assert.match(firstLine, /226/);
  assert.match(firstLine, /LIM-MIA-LIM/);
  assert.match(firstLine, /Juan Perez/);
});

test('buildBlockLabel - preserva formato textual de ruta/vuelo por leg, estilo LIVE multilinea (T11)', () => {
  const legs = [
    { row: leg({ departure_airport_code: 'LIM', arrival_airport_code: 'MIA', flight_number: '2480', flight_departure_time_crew_base: '00:15:00', flight_arrival_hour_block_time: '06:20:00' }) },
    { row: leg({ departure_airport_code: 'MIA', arrival_airport_code: 'LIM', flight_number: '2695', flight_departure_time_crew_base: '16:10:00', flight_arrival_hour_block_time: '22:00:00' }) },
  ];
  const label = buildBlockLabel(row('A1', '226', '2026-09-01', '2026-09-03', '', legs));
  const lines = label.split('\n');
  assert.ok(lines.includes('- LIM-MIA'));
  assert.ok(lines.includes('- LA 2480 (00:15-06:20 hrs)'));
  assert.ok(lines.includes('- MIA-LIM'));
  assert.ok(lines.includes('- LA 2695 (16:10-22:00 hrs)'));
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

test('scheduleWeekdayRow - fila 1: dia de semana completo en espanol, minuscula (T8)', () => {
  const dateColumns = [{ y: 2026, m: 9, d: 1 }, { y: 2026, m: 9, d: 2 }]; // martes, miercoles
  const weekdays = scheduleWeekdayRow(dateColumns);
  assert.equal(weekdays[0], 'martes');
  assert.equal(weekdays[1], 'miércoles');
});

test('scheduleDateRow - fila 2: fecha DD/MM/YYYY como texto, sin drift (T9)', () => {
  const dateColumns = [{ y: 2026, m: 9, d: 1 }, { y: 2026, m: 10, d: 2 }];
  const dates = scheduleDateRow(dateColumns);
  assert.equal(dates[0], '01/09/2026');
  assert.equal(dates[1], '02/10/2026');
  assert.equal(typeof dates[0], 'string');
});
