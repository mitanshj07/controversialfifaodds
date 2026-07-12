import assert from 'node:assert/strict';
import { once } from 'node:events';
import test from 'node:test';
import { io as connectSocket } from 'socket.io-client';
import { createTheCallServer } from '../index.js';

const emitAck = (socket, event, payload = {}) => new Promise((resolve) => {
  socket.emit(event, payload, resolve);
});

test('contest socket flow creates a wallet, charges entry, and enters the linked jury room', async () => {
  const server = createTheCallServer({ playbackRate: 0.25, tickRateMs: 10_000 });
  await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  const address = server.httpServer.address();
  const socket = connectSocket(`http://127.0.0.1:${address.port}`, {
    transports: ['websocket'],
  });

  try {
    await once(socket, 'connect');
    const opened = await emitAck(socket, 'contest:session', { nickname: 'Socket Alice' });
    assert.equal(opened.ok, true);
    assert.equal(opened.wallet.balanceCredits, 1_000);
    assert.ok(opened.contests.every((contest) => contest.membership.joined === false));

    const joined = await emitAck(socket, 'contest:join', {
      contestId: 'featured-grand-jury',
      participantId: opened.session.participantId,
      resumeToken: opened.session.resumeToken,
    });
    assert.equal(joined.ok, true);
    assert.equal(joined.wallet.balanceCredits, 900);
    assert.equal(joined.contest.membership.joined, true);

    const entered = await emitAck(socket, 'room:join', {
      roomCode: joined.contest.roomCode,
      nickname: joined.session.nickname,
      participantId: joined.session.participantId,
      resumeToken: joined.session.resumeToken,
    });
    assert.equal(entered.ok, true);
    assert.equal(entered.session.participantId, opened.session.participantId);
    assert.equal(entered.state.contest.membership.joined, true);
    assert.equal(entered.state.you.wallet.balanceCredits, 900);
    assert.equal(
      entered.state.participants.find(({ id }) => id === 'bot_nia').contestEligible,
      false,
    );

    const duplicate = await emitAck(socket, 'contest:join', {
      contestId: 'featured-grand-jury',
      participantId: opened.session.participantId,
      resumeToken: opened.session.resumeToken,
    });
    assert.equal(duplicate.ok, false);
    assert.equal(duplicate.code, 'ALREADY_JOINED');
    assert.equal(
      server.contests.walletSnapshot(opened.session.participantId).balanceCredits,
      900,
    );

    const restart = await emitAck(socket, 'replay:restart');
    assert.equal(restart.ok, false);
    assert.equal(restart.code, 'RESTART_NOT_ALLOWED');

    const created = await emitAck(socket, 'contest:create', {
      name: 'Socket Friends',
      entryCredits: 10,
      capacity: 2,
      participantId: opened.session.participantId,
      resumeToken: opened.session.resumeToken,
    });
    assert.equal(created.ok, true);
    assert.equal(created.wallet.balanceCredits, 890);
    assert.equal(created.contest.visibility, 'private');
    assert.ok(created.contest.inviteCode);

    const preview = await emitAck(socket, 'contest:lookup', {
      inviteCode: created.contest.inviteCode,
      participantId: opened.session.participantId,
      resumeToken: opened.session.resumeToken,
    });
    assert.equal(preview.ok, true);
    assert.equal(preview.contest.id, created.contest.id);
    assert.equal(preview.contest.inviteCode, undefined);
    assert.equal(
      server.contests.walletSnapshot(opened.session.participantId).balanceCredits,
      890,
    );
  } finally {
    socket.disconnect();
    await server.close();
  }
});

test('a demo-credit account cannot enter a contest room before joining it', async () => {
  const server = createTheCallServer({ playbackRate: 0.25, tickRateMs: 10_000 });
  await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  const address = server.httpServer.address();
  const socket = connectSocket(`http://127.0.0.1:${address.port}`, {
    transports: ['websocket'],
  });

  try {
    await once(socket, 'connect');
    const opened = await emitAck(socket, 'contest:session', { nickname: 'Socket Bob' });
    const denied = await emitAck(socket, 'room:join', {
      roomCode: 'GRAND-JURY',
      nickname: opened.session.nickname,
      participantId: opened.session.participantId,
      resumeToken: opened.session.resumeToken,
    });
    assert.equal(denied.ok, false);
    assert.equal(denied.code, 'CONTEST_MEMBERSHIP_REQUIRED');
  } finally {
    socket.disconnect();
    await server.close();
  }
});

test('contest room replay waits for the entry deadline and then locks new entries', async () => {
  const server = createTheCallServer({
    playbackRate: 0.25,
    tickRateMs: 10_000,
    entryWindowMs: 150,
  });
  await new Promise((resolve) => server.httpServer.listen(0, '127.0.0.1', resolve));
  const address = server.httpServer.address();
  const socket = connectSocket(`http://127.0.0.1:${address.port}`, {
    transports: ['websocket'],
  });

  try {
    await once(socket, 'connect');
    const alice = await emitAck(socket, 'contest:session', { nickname: 'Window Alice' });
    const joined = await emitAck(socket, 'contest:join', {
      contestId: 'featured-first-whistle',
      participantId: alice.session.participantId,
      resumeToken: alice.session.resumeToken,
    });
    assert.ok(joined.contest.entryClosesAt > Date.now());

    const replayStarted = new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        server.manager.off('state', onState);
        reject(new Error('Contest replay did not start after the entry deadline.'));
      }, 1_000);
      const onState = ({ roomCode }) => {
        const state = server.manager.snapshot(roomCode);
        if (roomCode !== joined.contest.roomCode || state?.replay.status !== 'playing') return;
        clearTimeout(timeout);
        server.manager.off('state', onState);
        resolve(state);
      };
      server.manager.on('state', onState);
    });

    const entered = await emitAck(socket, 'room:join', {
      roomCode: joined.contest.roomCode,
      nickname: joined.session.nickname,
      participantId: joined.session.participantId,
      resumeToken: joined.session.resumeToken,
    });
    assert.equal(entered.ok, true);
    assert.equal(entered.state.replay.status, 'waiting');
    assert.equal(entered.state.replay.scheduledStartAt, joined.contest.entryClosesAt);
    assert.equal(entered.state.contest.entryClosesAt, joined.contest.entryClosesAt);

    const playing = await replayStarted;
    assert.equal(playing.replay.status, 'playing');
    assert.ok(Date.now() >= joined.contest.entryClosesAt);
    assert.equal(
      server.contests.list({
        participantId: joined.session.participantId,
        resumeToken: joined.session.resumeToken,
      }).contests.find(({ id }) => id === joined.contest.id).status,
      'live',
    );

    const bob = await emitAck(socket, 'contest:session', { nickname: 'Window Bob' });
    const late = await emitAck(socket, 'contest:join', {
      contestId: joined.contest.id,
      participantId: bob.session.participantId,
      resumeToken: bob.session.resumeToken,
    });
    assert.equal(late.ok, false);
    assert.equal(late.code, 'ENTRY_CLOSED');
    assert.equal(bob.wallet.balanceCredits, 1_000);
  } finally {
    socket.disconnect();
    await server.close();
  }
});
