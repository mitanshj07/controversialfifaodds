import assert from 'node:assert/strict';
import test from 'node:test';
import {
  ContestError,
  ContestManager,
  DEFAULT_STARTING_BALANCE_CREDITS,
  FEATURED_CONTESTS,
  TEST_CREDIT_CURRENCY,
} from './contest-manager.js';

const match = {
  id: 'test-match',
  competition: 'Test Cup',
  home: { name: 'Home FC', code: 'HOM' },
  away: { name: 'Away FC', code: 'AWY' },
};

const featured = ({
  id = 'test-featured',
  roomCode = 'TEST-FEAT',
  entryCredits = 100,
  prizePoolCredits = 300,
  capacity = 3,
} = {}) => ({
  id,
  name: 'Test Featured',
  roomCode,
  entryCredits,
  prizePoolCredits,
  capacity,
  payoutLadder: [
    { rankFrom: 1, rankTo: 1, rewardCredits: 150 },
    { rankFrom: 2, rankTo: 2, rewardCredits: 90 },
    { rankFrom: 3, rankTo: 3, rewardCredits: 60 },
  ],
});

const deterministicManager = (options = {}) => {
  let nextId = 0;
  let nextToken = 0;
  let nextInvite = 0;
  const inviteCodes = ['ABC123', 'DEF456', 'GHI789'];
  return new ContestManager({
    match,
    idFactory: () => `id${++nextId}`,
    tokenFactory: () => `token${++nextToken}`,
    inviteCodeFactory: () => inviteCodes[nextInvite++],
    now: () => 100_000 + nextId,
    ...options,
  });
};

test('seeds public featured contests with explicit non-cash test-credit terms', () => {
  const manager = deterministicManager();
  const listed = manager.list();

  assert.equal(listed.contests.length, FEATURED_CONTESTS.length);
  assert.equal(listed.wallet, undefined);
  for (const contest of listed.contests) {
    assert.equal(contest.visibility, 'public');
    assert.equal(contest.featured, true);
    assert.equal(contest.status, 'open');
    assert.equal(contest.entryClosesAt, null);
    assert.equal(contest.joinedCount, 0);
    assert.equal(contest.poolType, 'guaranteed');
    assert.equal(contest.maxPrizePoolCredits, contest.prizePoolCredits);
    assert.match(contest.fundingLabel, /demo treasury/i);
    assert.equal(contest.currency, TEST_CREDIT_CURRENCY);
    assert.equal(contest.isCash, false);
    assert.equal(contest.withdrawalsEnabled, false);
    assert.ok(contest.payoutLadder.length > 0);
  }
});

test('opens and resumes a contest wallet session without charging an entry', () => {
  const manager = deterministicManager();
  const opened = manager.session({ nickname: 'Alice' });
  assert.equal(opened.wallet.balanceCredits, DEFAULT_STARTING_BALANCE_CREDITS);
  assert.equal(opened.contests.length, FEATURED_CONTESTS.length);
  assert.ok(opened.contests.every((contest) => contest.membership.joined === false));

  const resumed = manager.session({
    nickname: 'Alice Updated',
    participantId: opened.session.participantId,
    resumeToken: opened.session.resumeToken,
  });
  assert.equal(resumed.session.participantId, opened.session.participantId);
  assert.equal(resumed.session.nickname, 'Alice Updated');
  assert.equal(resumed.wallet.balanceCredits, DEFAULT_STARTING_BALANCE_CREDITS);

  assert.throws(
    () => manager.session({
      nickname: 'Unknown',
      participantId: 'old-room-player',
      resumeToken: 'old-room-token',
    }),
    (error) => error instanceof ContestError && error.code === 'INVALID_SESSION',
  );
});

test('credits a verified wallet purchase once and rejects wallet mismatch or replay', () => {
  const manager = deterministicManager();
  const walletAddress = '11111111111111111111111111111111';
  const opened = manager.session({ nickname: 'Wallet Alice', walletAddress });
  const signature = 'a'.repeat(88);
  const credited = manager.buyPoints({
    participantId: opened.session.participantId,
    resumeToken: opened.session.resumeToken,
    walletAddress,
    amountCredits: 5_000,
    transactionId: signature,
  });
  assert.equal(credited.wallet.balanceCredits, 6_000);
  assert.throws(
    () => manager.buyPoints({
      participantId: opened.session.participantId,
      resumeToken: opened.session.resumeToken,
      walletAddress,
      amountCredits: 5_000,
      transactionId: signature,
    }),
    (error) => error instanceof ContestError && error.code === 'DUPLICATE_TRANSACTION',
  );
  assert.throws(
    () => manager.buyPoints({
      participantId: opened.session.participantId,
      resumeToken: opened.session.resumeToken,
      walletAddress: '22222222222222222222222222222222',
      amountCredits: 5_000,
      transactionId: 'b'.repeat(88),
    }),
    (error) => error instanceof ContestError && error.code === 'WALLET_MISMATCH',
  );
});

test('creates a private contest, charges its creator once, and lists personalized membership', () => {
  const manager = deterministicManager({ featuredContests: [] });
  const created = manager.create({
    name: 'Sunday VAR Crew',
    entryCredits: 100,
    capacity: 5,
    nickname: 'Alice',
  });

  assert.equal(created.wallet.balanceCredits, DEFAULT_STARTING_BALANCE_CREDITS - 100);
  assert.equal(created.contest.visibility, 'private');
  assert.equal(created.contest.prizePoolCredits, 100);
  assert.equal(created.contest.maxPrizePoolCredits, 500);
  assert.equal(created.contest.poolType, 'flexible');
  assert.match(created.contest.fundingLabel, /collected/i);
  assert.equal(created.contest.payoutLadder[0].rewardCredits, 100);
  assert.equal(created.contest.entryClosesAt, 120_002);
  assert.equal(created.contest.joinedCount, 1);
  assert.equal(created.contest.membership.joined, true);
  assert.equal(created.contest.inviteCode, 'ABC123');

  const beforeLookup = created.wallet.balanceCredits;
  const preview = manager.lookup({ inviteCode: 'abc123' });
  assert.equal(preview.id, created.contest.id);
  assert.equal(preview.inviteCode, undefined);
  assert.equal(manager.walletSnapshot(created.session.participantId).balanceCredits, beforeLookup);

  const personalized = manager.list({
    participantId: created.session.participantId,
    resumeToken: created.session.resumeToken,
  });
  assert.equal(personalized.contests.length, 1);
  assert.equal(personalized.contests[0].membership.joined, true);
  assert.equal(personalized.contests[0].inviteCode, 'ABC123');
});

test('join debit is atomic across duplicate, full, and insufficient-credit failures', () => {
  const manager = deterministicManager({ featuredContests: [] });
  const owner = manager.create({
    name: 'Two Seat Jury',
    entryCredits: 500,
    capacity: 2,
    nickname: 'Owner',
  });
  const bob = manager.join({ inviteCode: owner.contest.inviteCode, nickname: 'Bob' });
  assert.equal(bob.wallet.balanceCredits, 500);

  assert.throws(
    () => manager.join({
      inviteCode: owner.contest.inviteCode,
      participantId: bob.session.participantId,
      resumeToken: bob.session.resumeToken,
    }),
    (error) => error instanceof ContestError && error.code === 'ALREADY_JOINED',
  );
  assert.equal(manager.walletSnapshot(bob.session.participantId).balanceCredits, 500);

  assert.throws(
    () => manager.join({ inviteCode: owner.contest.inviteCode, nickname: 'Charlie' }),
    (error) => error instanceof ContestError && error.code === 'CONTEST_FULL',
  );
  assert.equal(owner.contest.capacity, owner.contest.joinedCount + 1);

  const expensiveManager = deterministicManager({
    startingBalanceCredits: 400,
    featuredContests: [featured({ entryCredits: 500, capacity: 3 })],
  });
  assert.throws(
    () => expensiveManager.join({ contestId: 'test-featured', nickname: 'Dana' }),
    (error) => error instanceof ContestError && error.code === 'INSUFFICIENT_CREDITS',
  );
  const [dana] = [...expensiveManager.accounts.values()];
  assert.equal(dana.balanceCredits, 400);
  assert.equal(expensiveManager.contests.get('test-featured').members.size, 0);
});

test('rejects entries at the authoritative deadline and whenever play is live', () => {
  let now = 10_000;
  const manager = deterministicManager({
    now: () => now,
    entryWindowMs: 100,
    featuredContests: [featured({ capacity: 4 })],
  });
  const alice = manager.join({ contestId: 'test-featured', nickname: 'Alice' });
  assert.equal(alice.contest.entryClosesAt, 10_100);

  now = 10_099;
  const bob = manager.join({ contestId: 'test-featured', nickname: 'Bob' });
  assert.equal(bob.contest.joinedCount, 2);

  const charlie = manager.session({ nickname: 'Charlie' });
  now = 10_100;
  assert.throws(
    () => manager.join({
      contestId: 'test-featured',
      participantId: charlie.session.participantId,
      resumeToken: charlie.session.resumeToken,
    }),
    (error) => error instanceof ContestError && error.code === 'ENTRY_CLOSED',
  );
  assert.equal(manager.walletSnapshot(charlie.session.participantId).balanceCredits, 1_000);
  assert.equal(manager.list().contests[0].status, 'locked');

  let liveNow = 20_000;
  const liveManager = deterministicManager({
    now: () => liveNow,
    entryWindowMs: 1_000,
    featuredContests: [featured({ capacity: 3 })],
  });
  liveManager.join({ contestId: 'test-featured', nickname: 'First' });
  liveManager.updateFromRoomState('TEST-FEAT', {
    generation: 1,
    match: { phase: 'first_half' },
    replay: { status: 'playing' },
    participants: [],
  });
  assert.throws(
    () => liveManager.join({ contestId: 'test-featured', nickname: 'Too Late' }),
    (error) => error instanceof ContestError && error.code === 'ENTRY_CLOSED',
  );
});

test('one match-wide deadline closes untouched contests after another contest starts', () => {
  let now = 30_000;
  const manager = deterministicManager({
    now: () => now,
    entryWindowMs: 100,
    featuredContests: [
      featured({ id: 'contest-a', roomCode: 'CONTEST-A', capacity: 5 }),
      featured({ id: 'contest-b', roomCode: 'CONTEST-B', capacity: 5 }),
    ],
  });
  const alice = manager.join({ contestId: 'contest-a', nickname: 'Alice' });
  const initialList = manager.list().contests;
  assert.equal(initialList.find(({ id }) => id === 'contest-a').entryClosesAt, 30_100);
  assert.equal(initialList.find(({ id }) => id === 'contest-b').entryClosesAt, 30_100);

  now = 30_050;
  const privateContest = manager.create({
    name: 'Same Match Private',
    entryCredits: 10,
    capacity: 3,
    participantId: alice.session.participantId,
    resumeToken: alice.session.resumeToken,
  });
  assert.equal(privateContest.contest.entryClosesAt, 30_100);

  manager.updateFromRoomState('CONTEST-A', {
    generation: 1,
    match: { phase: 'full_time' },
    replay: { status: 'ended' },
    participants: [{
      id: alice.session.participantId,
      nickname: 'Alice',
      score: 100,
    }],
  });

  const bob = manager.session({ nickname: 'Bob' });
  assert.throws(
    () => manager.join({
      contestId: 'contest-b',
      participantId: bob.session.participantId,
      resumeToken: bob.session.resumeToken,
    }),
    (error) => error instanceof ContestError && error.code === 'ENTRY_CLOSED',
  );
  assert.equal(manager.walletSnapshot(bob.session.participantId).balanceCredits, 1_000);
  assert.equal(
    manager.list().contests.find(({ id }) => id === 'contest-b').status,
    'locked',
  );
});

test('a one-person private contest can receive only its collected entry pool', () => {
  const manager = deterministicManager({ featuredContests: [] });
  const created = manager.create({
    name: 'Solo Waiting Room',
    entryCredits: 100,
    capacity: 5,
    nickname: 'Solo Player',
  });
  assert.equal(created.contest.prizePoolCredits, 100);
  assert.equal(created.contest.maxPrizePoolCredits, 500);
  assert.deepEqual(created.contest.payoutLadder, [
    { rankFrom: 1, rankTo: 1, rewardCredits: 100 },
  ]);

  manager.updateFromRoomState(created.contest.roomCode, {
    generation: 1,
    match: { phase: 'full_time' },
    replay: { status: 'ended' },
    participants: [{
      id: created.session.participantId,
      nickname: created.session.nickname,
      score: 300,
    }],
  });
  const settled = manager.list({
    participantId: created.session.participantId,
    resumeToken: created.session.resumeToken,
  }).contests[0];
  assert.equal(settled.membership.rewardCredits, 100);
  assert.ok(settled.membership.rewardCredits <= settled.prizePoolCredits);
  assert.equal(manager.walletSnapshot(created.session.participantId).balanceCredits, 1_000);
});

test('ranks tied scores without join-time advantage and pays simulated rewards once', () => {
  const manager = deterministicManager({
    featuredContests: [featured({ entryCredits: 10 })],
  });
  const alice = manager.join({ contestId: 'test-featured', nickname: 'Alice' });
  const bob = manager.join({ contestId: 'test-featured', nickname: 'Bob' });
  const charlie = manager.join({ contestId: 'test-featured', nickname: 'Charlie' });
  const participants = [
    { id: 'bot-demo', nickname: 'Demo Bot', score: 999 },
    { id: alice.session.participantId, nickname: 'Alice', score: 100 },
    { id: bob.session.participantId, nickname: 'Bob', score: 100 },
    { id: charlie.session.participantId, nickname: 'Charlie', score: 0 },
  ];

  manager.updateFromRoomState('TEST-FEAT', {
    generation: 1,
    match: { phase: 'second_half' },
    replay: { status: 'playing' },
    participants,
  });
  const liveAlice = manager.list({
    participantId: alice.session.participantId,
    resumeToken: alice.session.resumeToken,
  }).contests[0];
  const liveBob = manager.list({
    participantId: bob.session.participantId,
    resumeToken: bob.session.resumeToken,
  }).contests[0];
  assert.equal(liveAlice.status, 'live');
  assert.equal(liveAlice.membership.rank, 1);
  assert.equal(liveBob.membership.rank, 1);
  assert.equal(liveAlice.membership.projectedRewardCredits, 120);
  assert.equal(liveBob.membership.projectedRewardCredits, 120);
  assert.equal(liveAlice.joinedCount, 3, 'an in-room demo bot is not contest eligible');

  const finalState = {
    generation: 1,
    match: { phase: 'full_time' },
    replay: { status: 'ended' },
    participants,
  };
  manager.updateFromRoomState('TEST-FEAT', finalState);
  assert.equal(manager.walletSnapshot(alice.session.participantId).balanceCredits, 1_110);
  assert.equal(manager.walletSnapshot(bob.session.participantId).balanceCredits, 1_110);
  assert.equal(manager.walletSnapshot(charlie.session.participantId).balanceCredits, 1_050);

  manager.updateFromRoomState('TEST-FEAT', finalState);
  assert.equal(manager.walletSnapshot(alice.session.participantId).balanceCredits, 1_110);
  assert.equal(manager.contests.get('test-featured').status, 'completed');
});

test('contest room state hides live crowd signals while retaining the viewer vote privately', () => {
  const manager = deterministicManager({ featuredContests: [featured()] });
  const alice = manager.join({ contestId: 'test-featured', nickname: 'Alice' });
  const rawState = {
    roomCode: 'TEST-FEAT',
    activeCall: {
      id: 'call-1',
      status: 'open',
      counts: { stands: 4, overturned: 2 },
      totalVotes: 6,
    },
    participants: [
      { id: alice.session.participantId, nickname: 'Alice', hasVoted: true, vote: 'stands' },
      { id: 'bot-demo', nickname: 'Bot', hasVoted: true },
    ],
    activity: [
      { id: 'vote-1', type: 'vote_cast', message: 'Alice voted' },
      { id: 'join-1', type: 'participant_joined', message: 'Alice joined' },
    ],
    you: { id: alice.session.participantId, nickname: 'Alice', vote: 'stands' },
  };
  const safe = manager.decorateRoomState(rawState, alice.session.participantId);

  assert.equal('counts' in safe.activeCall, false);
  assert.equal('totalVotes' in safe.activeCall, false);
  assert.equal('hasVoted' in safe.participants[0], false);
  assert.equal('vote' in safe.participants[0], false);
  assert.equal(safe.participants[0].contestEligible, true);
  assert.equal(safe.participants[1].contestEligible, false);
  assert.deepEqual(safe.activity.map(({ type }) => type), ['participant_joined']);
  assert.equal(safe.you.vote, 'stands');
  assert.equal(safe.you.wallet.balanceCredits, 900);
  assert.equal(safe.contest.membership.joined, true);
});

test('contest jury rooms require a paid membership', () => {
  const manager = deterministicManager({ featuredContests: [featured()] });
  const alice = manager.join({ contestId: 'test-featured', nickname: 'Alice' });
  const access = manager.authorizeRoomEntry({
    roomCode: 'test-feat',
    participantId: alice.session.participantId,
    resumeToken: alice.session.resumeToken,
    nickname: 'Alice',
  });
  assert.equal(access.identity.id, alice.session.participantId);

  const outsider = manager.create({
    name: 'Outsider Room',
    entryCredits: 10,
    capacity: 2,
    nickname: 'Outsider',
  });
  assert.throws(
    () => manager.authorizeRoomEntry({
      roomCode: 'TEST-FEAT',
      participantId: outsider.session.participantId,
      resumeToken: outsider.session.resumeToken,
    }),
    (error) => error instanceof ContestError && error.code === 'CONTEST_MEMBERSHIP_REQUIRED',
  );
});
