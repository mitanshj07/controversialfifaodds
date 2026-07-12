import test from 'node:test';
import assert from 'node:assert/strict';
import { mapVarKind, normaliseTxLineRecord } from './txline-sse-adapter.js';

test('normalises TxLINE casing and VAR outcome fields', () => {
  const record = normaliseTxLineRecord({
    FixtureId: 42,
    Seq: 19,
    Action: 'var_end',
    Id: 7,
    Confirmed: true,
    Minute: 63,
    Data: { Outcome: 'Overturned' },
  }, '123:4');

  assert.equal(record.fixtureId, 42);
  assert.equal(record.seq, 19);
  assert.equal(record.action, 'var_end');
  assert.equal(record.var.outcome, 'Overturned');
  assert.equal(record.sseId, '123:4');
});

test('maps documented review types to fan-jury kinds', () => {
  assert.equal(mapVarKind('Penalty'), 'penalty_review');
  assert.equal(mapVarKind('RedCard'), 'red_card_review');
  assert.equal(mapVarKind(null), 'var_review');
});
