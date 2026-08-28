const test = require('node:test');
const assert = require('node:assert/strict');
const { reconcileAssignments } = require('../40_Reconciliation.js');

function idGen(prefix) {
  let n = 0;
  return () => `${prefix}-${++n}`;
}

test('ACTIVE - mismo snapshot, mismo contenido: preserva assignment_id/INS/ACT (idempotencia)', () => {
  const prev = [{ assignment_id: 'A1', pairing_instance_key: 'PIK1', pairing_id: '226', pairing_content_hash: 'H1', INS: 'Juan Perez', ACT: 'Simulador', source_snapshot_key: 'SNAP1' }];
  const current = [{ pairing_instance_key: 'PIK1', pairing_id: '226', pairing_content_hash: 'H1', snapshot_key: 'SNAP1' }];

  const { rows, counts } = reconcileAssignments(prev, current, idGen('NEW'));

  assert.equal(rows.length, 1);
  assert.equal(rows[0].assignment_id, 'A1');
  assert.equal(rows[0].INS, 'Juan Perez');
  assert.equal(rows[0].ACT, 'Simulador');
  assert.equal(rows[0].assignment_status, 'ACTIVE');
  assert.equal(counts.preserved, 1);
  assert.equal(counts.created, 0);
});

test('RELINKED_IDENTICAL - nuevo snapshot, contenido identico: preserva assignment_id/INS/ACT, actualiza puntero', () => {
  const prev = [{ assignment_id: 'A1', pairing_instance_key: 'PIK_OLD', pairing_id: '226', pairing_content_hash: 'H1', INS: 'Juan Perez', ACT: '', source_snapshot_key: 'SNAP_OLD' }];
  const current = [{ pairing_instance_key: 'PIK_NEW', pairing_id: '226', pairing_content_hash: 'H1', snapshot_key: 'SNAP_NEW' }];

  const { rows, counts } = reconcileAssignments(prev, current, idGen('NEW'));

  assert.equal(rows[0].assignment_id, 'A1', 'assignment_id se preserva');
  assert.equal(rows[0].INS, 'Juan Perez', 'INS se preserva');
  assert.equal(rows[0].pairing_instance_key, 'PIK_NEW', 'el puntero se actualiza al nuevo snapshot');
  assert.equal(rows[0].source_snapshot_key, 'SNAP_NEW');
  assert.equal(rows[0].assignment_status, 'RELINKED_IDENTICAL');
  assert.equal(counts.relinked, 1);
});

test('REVIEW_SOURCE_CHANGED - mismo pairing_id, contenido distinto: NO relink silencioso', () => {
  const prev = [{ assignment_id: 'A1', pairing_instance_key: 'PIK_OLD', pairing_id: '226', pairing_content_hash: 'H1', INS: 'Juan Perez', ACT: 'Simulador', source_snapshot_key: 'SNAP_OLD' }];
  const current = [{ pairing_instance_key: 'PIK_NEW', pairing_id: '226', pairing_content_hash: 'H2_DISTINTO', snapshot_key: 'SNAP_NEW' }];

  const { rows, counts } = reconcileAssignments(prev, current, idGen('NEW'));

  // La fila vieja se conserva intacta apuntando a su contenido/snapshot ORIGINAL.
  const oldRow = rows.find(r => r.assignment_id === 'A1');
  assert.equal(oldRow.assignment_status, 'REVIEW_SOURCE_CHANGED');
  assert.equal(oldRow.INS, 'Juan Perez', 'INS no se pierde aunque quede en revision');
  assert.equal(oldRow.pairing_instance_key, 'PIK_OLD', 'no se relinkea en silencio al pairing nuevo');

  // El pairing nuevo con contenido distinto aparece ademas como NEW (nadie lo reclamo).
  const newRow = rows.find(r => r.assignment_status === 'NEW');
  assert.ok(newRow, 'debe aparecer una fila NEW para el contenido cambiado');
  assert.equal(newRow.pairing_instance_key, 'PIK_NEW');
  assert.equal(newRow.INS, '');

  assert.equal(counts.reviewChanged, 1);
  assert.equal(counts.created, 1);
});

test('ORPHANED_SOURCE_MISSING - el pairing_id desaparece por completo: se preserva, nunca se borra', () => {
  const prev = [{ assignment_id: 'A1', pairing_instance_key: 'PIK_OLD', pairing_id: '999', pairing_content_hash: 'H1', INS: 'Juan Perez', ACT: 'Linea', source_snapshot_key: 'SNAP_OLD' }];
  const current = [{ pairing_instance_key: 'PIK_NEW', pairing_id: '226', pairing_content_hash: 'H2', snapshot_key: 'SNAP_NEW' }];

  const { rows, counts } = reconcileAssignments(prev, current, idGen('NEW'));

  const orphan = rows.find(r => r.assignment_id === 'A1');
  assert.equal(orphan.assignment_status, 'ORPHANED_SOURCE_MISSING');
  assert.equal(orphan.INS, 'Juan Perez');
  assert.equal(orphan.ACT, 'Linea');
  assert.equal(counts.orphaned, 1);

  // Ademas el pairing 226 (nuevo, sin reclamo previo) debe aparecer como NEW.
  assert.ok(rows.some(r => r.assignment_status === 'NEW' && r.pairing_id === '226'));
});

test('NEW - pairing sin ninguna asignacion previa recibe assignment_id nuevo e INS/ACT en blanco', () => {
  const { rows, counts } = reconcileAssignments([], [{ pairing_instance_key: 'PIK1', pairing_id: '226', pairing_content_hash: 'H1', snapshot_key: 'SNAP1' }], idGen('NEW'));
  assert.equal(rows.length, 1);
  assert.equal(rows[0].assignment_status, 'NEW');
  assert.equal(rows[0].INS, '');
  assert.equal(rows[0].ACT, '');
  assert.equal(rows[0].assignment_id, 'NEW-1');
  assert.equal(counts.created, 1);
});

test('multiples assignment_id para el mismo pairing_instance_key NO se colapsan', () => {
  const prev = [
    { assignment_id: 'A1', pairing_instance_key: 'PIK1', pairing_id: '226', pairing_content_hash: 'H1', INS: 'Juan Perez', ACT: '', source_snapshot_key: 'SNAP1' },
    { assignment_id: 'A2', pairing_instance_key: 'PIK1', pairing_id: '226', pairing_content_hash: 'H1', INS: 'Maria Lopez', ACT: '', source_snapshot_key: 'SNAP1' },
  ];
  const current = [{ pairing_instance_key: 'PIK1', pairing_id: '226', pairing_content_hash: 'H1', snapshot_key: 'SNAP1' }];

  const { rows, counts } = reconcileAssignments(prev, current, idGen('NEW'));

  assert.equal(rows.length, 2, 'ambas asignaciones deben sobrevivir, no colapsarse en una');
  assert.equal(counts.preserved, 2);
  assert.deepEqual(rows.map(r => r.assignment_id).sort(), ['A1', 'A2']);
  assert.equal(counts.created, 0, 'no debe crearse una tercera fila NEW: el pairing ya fue reclamado');
});

test('multiples assignment_id que relinkean al mismo pairing en un snapshot NUEVO tampoco se colapsan (Case B, Seccion 7)', () => {
  // Dos asignaciones viejas (p.ej. instructor titular + backup) para el MISMO pairing_id con el
  // MISMO contenido, en un snapshot ANTERIOR. Al llegar un snapshot nuevo con contenido identico,
  // AMBAS deben relinkear de forma independiente al mismo pairing_instance_key nuevo: no es un bug
  // de "doble reserva", es exactamente la multiplicidad que la Seccion 7 exige preservar.
  const prev = [
    { assignment_id: 'A1', pairing_instance_key: 'PIK_OLD', pairing_id: '226', pairing_content_hash: 'H1', INS: 'Juan Perez', ACT: '', source_snapshot_key: 'SNAP_OLD' },
    { assignment_id: 'A2', pairing_instance_key: 'PIK_OLD', pairing_id: '226', pairing_content_hash: 'H1', INS: 'Maria Lopez', ACT: '', source_snapshot_key: 'SNAP_OLD' },
  ];
  const current = [{ pairing_instance_key: 'PIK_NEW', pairing_id: '226', pairing_content_hash: 'H1', snapshot_key: 'SNAP_NEW' }];

  const { rows, counts } = reconcileAssignments(prev, current, idGen('NEW'));

  assert.equal(rows.length, 2, 'ambas asignaciones deben sobrevivir el relink, no colapsarse en una');
  assert.equal(counts.relinked, 2);
  assert.ok(rows.every(r => r.assignment_status === 'RELINKED_IDENTICAL'));
  assert.ok(rows.every(r => r.pairing_instance_key === 'PIK_NEW'));
  assert.deepEqual(rows.map(r => r.INS).sort(), ['Juan Perez', 'Maria Lopez']);
  assert.equal(counts.created, 0, 'el pairing ya fue reclamado dos veces; no debe generarse una tercera fila NEW');
});

test('idempotencia total - correr reconcile dos veces sobre el mismo snapshot no cambia nada', () => {
  const prev = [{ assignment_id: 'A1', pairing_instance_key: 'PIK1', pairing_id: '226', pairing_content_hash: 'H1', INS: 'Juan Perez', ACT: 'Linea', source_snapshot_key: 'SNAP1' }];
  const current = [{ pairing_instance_key: 'PIK1', pairing_id: '226', pairing_content_hash: 'H1', snapshot_key: 'SNAP1' }];

  const run1 = reconcileAssignments(prev, current, idGen('NEW'));
  const run2 = reconcileAssignments(run1.rows, current, idGen('NEW'));

  assert.deepEqual(run1.rows.map(r => ({ id: r.assignment_id, ins: r.INS, act: r.ACT, status: r.assignment_status })),
    run2.rows.map(r => ({ id: r.assignment_id, ins: r.INS, act: r.ACT, status: r.assignment_status })));
  assert.equal(run2.counts.created, 0);
});
