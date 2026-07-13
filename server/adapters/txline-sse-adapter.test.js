import test from 'node:test';
import assert from 'node:assert/strict';
import { TxLineSseAdapter, mapVarKind, normaliseTxLineRecord } from './txline-sse-adapter.js';

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

test('normalises TxLINE game finalisation markers and final scores', () => {
  const record = normaliseTxLineRecord({
    FixtureId: 17952170,
    Seq: 941,
    Action: 'game_finalised',
    StatusId: 100,
    Period: 100,
    Data: { ScoreH: 2, ScoreA: 1 },
  });

  assert.equal(record.action, 'game_finalised');
  assert.equal(record.statusId, 100);
  assert.equal(record.period, 100);
  assert.equal(record.homeScore, 2);
  assert.equal(record.awayScore, 1);
});

test('allows the server to create a guest JWT when the activated API token is present', () => {
  assert.doesNotThrow(() => new TxLineSseAdapter({
    baseUrl: 'https://txline-dev.txodds.com',
    apiToken: 'activated-api-token',
    fixtureId: 42,
  }));
});
