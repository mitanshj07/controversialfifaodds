import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReputationCheckpoint } from './reputation-checkpoint.js';

const participant = (id, score) => [id, {
  id,
  nickname: id.toUpperCase(),
  score,
  streak: 1,
  bestStreak: 1,
}];

test('reputation checkpoint is stable across participant insertion order', () => {
  const shared = {
    matchId: 'match-1',
    roomCode: 'ROOM',
    generation: 3,
    history: [{
      id: 'call-1', result: 'stands', minute: 20,
      counts: { stands: 2, overturned: 1 }, totalVotes: 3,
    }],
  };
  const first = buildReputationCheckpoint({
    ...shared,
    participants: new Map([participant('b', 0), participant('a', 100)]),
  });
  const second = buildReputationCheckpoint({
    ...shared,
    participants: new Map([participant('a', 100), participant('b', 0)]),
  });

  assert.equal(first.hash, second.hash);
  assert.equal(first.status, 'ready_for_devnet');
});
