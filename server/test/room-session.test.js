import assert from 'node:assert/strict';
import test from 'node:test';
import { FeedEventType } from '../adapters/feed-adapter.js';
import { RoomError, RoomSession, scoring } from '../domain/room-session.js';

class ManualAdapter {
  constructor() {
    this.generation = 0;
    this.sink = null;
  }

  start(sink) {
    this.sink = sink ?? this.sink;
    this.generation += 1;
    return this.generation;
  }

  restart() {
    return this.start();
  }

  stop() {}
}

const match = {
  id: 'test-match',
  competition: 'Test Cup',
  venue: 'Test Ground',
  home: { name: 'Home', code: 'HOM' },
  away: { name: 'Away', code: 'AWY' },
  durationMs: 90_000,
};

const feedEvent = (generation, id, type, offsetMs, payload) => ({
  generation,
  id,
  type,
  offsetMs,
  payload,
});

function setupRoom() {
  let nextId = 0;
  const adapter = new ManualAdapter();
  const room = new RoomSession({
    code: 'TEST',
    match,
    adapter,
    now: () => 100_000,
    idFactory: () => `player-${++nextId}`,
    tokenFactory: () => `token-${nextId}`,
  });
  room.start();
  const alice = room.join({ nickname: 'Alice', socketId: 'socket-a' }).credentials;
  const bob = room.join({ nickname: 'Bob', socketId: 'socket-b' }).credentials;
  room.updateClock({
    generation: 1,
    status: 'playing',
    elapsedMs: 1_000,
    durationMs: 90_000,
    progress: 1 / 90,
    matchClock: '1′',
    startedAt: 99_000,
    playbackRate: 1,
  });
  return { room, adapter, alice, bob };
}

test('settles one immutable vote per participant and awards streak bonuses', () => {
  const { room, alice, bob } = setupRoom();
  const opened = feedEvent(1, 'open-1', FeedEventType.BIG_CALL_OPENED, 1_000, {
    callId: 'call-1', title: 'Will it stand?', detail: 'Offside check', minute: 20, windowMs: 10_000,
  });
  assert.deepEqual(room.processFeedEvent(opened), { accepted: true });
  assert.equal(room.snapshot(alice.id).activeCall.closesAt, 110_000);

  assert.equal(room.castVote({ participantId: alice.id, callId: 'call-1', choice: 'stands' }).duplicate, false);
  assert.equal(room.castVote({ participantId: alice.id, callId: 'call-1', choice: 'stands' }).duplicate, true);
  assert.throws(
    () => room.castVote({ participantId: alice.id, callId: 'call-1', choice: 'overturned' }),
    (error) => error instanceof RoomError && error.code === 'ALREADY_VOTED',
  );
  room.castVote({ participantId: bob.id, callId: 'call-1', choice: 'overturned' });

  const resolved = feedEvent(1, 'resolve-1', FeedEventType.BIG_CALL_RESOLVED, 11_000, {
    callId: 'call-1', result: 'stands', minute: 21,
  });
  room.processFeedEvent(resolved);
  assert.equal(room.participants.get(alice.id).score, 100);
  assert.equal(room.participants.get(alice.id).streak, 1);
  assert.equal(room.participants.get(bob.id).score, 0);
  assert.equal(room.history[0].result, 'stands');
  assert.deepEqual(room.history[0].counts, { stands: 1, overturned: 1 });

  assert.deepEqual(room.processFeedEvent(resolved), { accepted: false, reason: 'duplicate' });
  assert.equal(room.participants.get(alice.id).score, 100);

  room.activeCall = null;
  room.processFeedEvent(feedEvent(1, 'open-2', FeedEventType.BIG_CALL_OPENED, 20_000, {
    callId: 'call-2', title: 'Second call', windowMs: 10_000,
  }));
  room.updateClock({ generation: 1, status: 'playing', elapsedMs: 20_000, durationMs: 90_000, progress: 2 / 9, matchClock: '20′', startedAt: 99_000, playbackRate: 1 });
  room.castVote({ participantId: alice.id, callId: 'call-2', choice: 'overturned' });
  room.processFeedEvent(feedEvent(1, 'resolve-2', FeedEventType.BIG_CALL_RESOLVED, 30_000, {
    callId: 'call-2', result: 'overturned', minute: 30,
  }));
  assert.equal(room.participants.get(alice.id).score, 225);
  assert.equal(room.participants.get(alice.id).streak, 2);
});

test('restart creates a clean generation and rejects stale replay events', () => {
  const { room, alice } = setupRoom();
  room.processFeedEvent(feedEvent(1, 'score', FeedEventType.SCORE_CHANGED, 5_000, {
    homeScore: 1, awayScore: 0,
  }));
  assert.equal(room.snapshot().match.homeScore, 1);

  const replay = room.restart(alice.id);
  assert.equal(replay.generation, 2);
  assert.equal(room.snapshot().match.homeScore, 0);
  assert.equal(room.history.length, 0);
  assert.deepEqual(
    room.processFeedEvent(feedEvent(1, 'late', FeedEventType.SCORE_CHANGED, 6_000, {
      homeScore: 9, awayScore: 0,
    })),
    { accepted: false, reason: 'stale_generation' },
  );
  assert.equal(room.snapshot().match.homeScore, 0);
});

test('resume token reconnects the same scored participant', () => {
  const { room, alice } = setupRoom();
  room.participants.get(alice.id).score = 350;
  room.disconnectSocket('socket-a');
  const resumed = room.join({
    nickname: 'Alice Again',
    socketId: 'socket-a2',
    participantId: alice.id,
    resumeToken: alice.resumeToken,
  });
  assert.equal(resumed.credentials.id, alice.id);
  assert.equal(room.participants.get(alice.id).score, 350);
  assert.equal(room.participants.get(alice.id).nickname, 'Alice Again');
});

test('caps the points awarded for one correct call at 150', () => {
  assert.equal(scoring.pointsForStreak(1), 100);
  assert.equal(scoring.pointsForStreak(2), 125);
  assert.equal(scoring.pointsForStreak(3), 150);
  assert.equal(scoring.pointsForStreak(20), 150);
});

test('rejects a vote after the wall-clock cutoff even between replay clock ticks', () => {
  let now = 100_000;
  const adapter = new ManualAdapter();
  const room = new RoomSession({
    code: 'CUTOFF',
    match,
    adapter,
    now: () => now,
    idFactory: () => 'cutoff-player',
    tokenFactory: () => 'cutoff-token',
  });
  room.start();
  const player = room.join({ nickname: 'Cutoff Caller', socketId: 'cutoff-socket' }).credentials;
  room.updateClock({
    generation: 1,
    status: 'playing',
    elapsedMs: 1_000,
    durationMs: 90_000,
    progress: 1 / 90,
    matchClock: '1′',
    startedAt: 99_000,
    playbackRate: 1,
  });
  room.processFeedEvent(feedEvent(1, 'cutoff-open', FeedEventType.BIG_CALL_OPENED, 1_000, {
    callId: 'cutoff-call', title: 'Cutoff check', windowMs: 10_000,
  }));

  now = 110_000;
  assert.throws(
    () => room.castVote({ participantId: player.id, callId: 'cutoff-call', choice: 'stands' }),
    (error) => error instanceof RoomError && error.code === 'VOTING_CLOSED',
  );
});
