const test = require('node:test');
const assert = require('node:assert/strict');
const { assignLanes } = require('../45_Lanes.js');

test('assignLanes - intervalos no solapados van todos al carril 0', () => {
  const { laneById, totalLanes } = assignLanes([
    { id: 'A', startKey: 1, endKey: 5 },
    { id: 'B', startKey: 5, endKey: 10 },
    { id: 'C', startKey: 10, endKey: 15 },
  ]);
  assert.equal(totalLanes, 1);
  assert.equal(laneById.A, 0);
  assert.equal(laneById.B, 0);
  assert.equal(laneById.C, 0);
});

test('assignLanes - dos intervalos solapados van a carriles distintos', () => {
  const { laneById, totalLanes } = assignLanes([
    { id: 'A', startKey: 1, endKey: 10 },
    { id: 'B', startKey: 5, endKey: 15 },
  ]);
  assert.equal(totalLanes, 2);
  assert.notEqual(laneById.A, laneById.B);
});

test('assignLanes - reutiliza un carril libre en vez de crear uno nuevo innecesario', () => {
  const { laneById, totalLanes } = assignLanes([
    { id: 'A', startKey: 1, endKey: 5 },
    { id: 'B', startKey: 1, endKey: 8 }, // solapa con A -> carril nuevo
    { id: 'C', startKey: 6, endKey: 9 }, // ya no solapa con A (5<=6) -> reutiliza carril de A
  ]);
  assert.equal(totalLanes, 2);
  assert.equal(laneById.A, laneById.C);
  assert.notEqual(laneById.A, laneById.B);
});

test('assignLanes - deterministico: mismo input en distinto orden produce la misma particion', () => {
  const input1 = [
    { id: 'A', startKey: 1, endKey: 5 },
    { id: 'B', startKey: 2, endKey: 6 },
    { id: 'C', startKey: 3, endKey: 7 },
  ];
  const input2 = [input1[2], input1[0], input1[1]]; // mismo contenido, orden de entrada distinto
  const r1 = assignLanes(input1);
  const r2 = assignLanes(input2);
  assert.deepEqual(r1.laneById, r2.laneById);
  assert.equal(r1.totalLanes, r2.totalLanes);
});

test('assignLanes - el numero de carril no es identidad: recalcular con un elemento extra no rompe nada', () => {
  const base = assignLanes([{ id: 'A', startKey: 1, endKey: 5 }]);
  assert.equal(base.laneById.A, 0);
  const extended = assignLanes([{ id: 'A', startKey: 1, endKey: 5 }, { id: 'B', startKey: 100, endKey: 110 }]);
  assert.equal(extended.laneById.A, 0, 'A sigue siendo determinista independientemente de B');
});
