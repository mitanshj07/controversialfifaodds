import assert from 'node:assert/strict';
import test from 'node:test';
import { RoomManager } from './room-manager.js';

const match = {
  id: 'shared-clock-match',
  competition: 'Test Cup',
  venue: 'Test Ground',
  home: { name: 'Home', code: 'HOM' },
  away: { name: 'Away', code: 'AWY' },
  durationMs: 90_000,
};

class CapturingAdapter {
  constructor() {
    this.generation = 0;
    this.startOptions = null;
  }

  start(_sink, options = {}) {
    this.generation += 1;
    this.startOptions = options;
    return this.generation;
  }

  restart() {
    this.generation += 1;
    return this.generation;
  }

  stop() {}
}

test('rooms share the match epoch and a late-opened room seeks to its playback-rate offset', () => {
  let now = 1_000;
  const timers = [];
  const adapters = new Map();
  const manager = new RoomManager({
    match,
    now: () => now,
    setTimeoutFn: (callback, delay) => {
      const timer = { callback, delay, unref() {} };
      timers.push(timer);
      return timer;
    },
    clearTimeoutFn: () => {},
    adapterFactory: ({ roomCode }) => {
      const adapter = new CapturingAdapter();
      adapters.set(roomCode, adapter);
      return adapter;
    },
  });

  const early = manager.join({
    roomCode: 'EARLY',
    nickname: 'Early Player',
    socketId: 'socket-early',
    startAt: 1_100,
    playbackRate: 2,
  });
  assert.equal(early.room.started, false);
  assert.equal(early.state.replay.status, 'waiting');
  assert.equal(early.state.replay.scheduledStartAt, 1_100);
  assert.equal(timers[0].delay, 100);

  now = 1_100;
  timers[0].callback();
  assert.equal(early.room.started, true);
  assert.equal(adapters.get('EARLY').startOptions.offsetMs, 0);

  now = 1_175;
  const late = manager.join({
    roomCode: 'LATE',
    nickname: 'Late Player',
    socketId: 'socket-late',
    startAt: 1_100,
    playbackRate: 2,
  });
  assert.equal(late.room.started, true);
  assert.equal(adapters.get('LATE').startOptions.offsetMs, 150);
  assert.equal(late.state.replay.elapsedMs, 150);
  assert.equal(late.state.replay.matchStartedAt, 1_100);
  assert.equal('scheduledStartAt' in late.state.replay, false);

  manager.close();
});
