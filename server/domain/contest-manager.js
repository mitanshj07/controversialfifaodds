import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { RoomError } from './room-session.js';

export const TEST_CREDIT_CURRENCY = 'TEST_CREDITS';
export const DEFAULT_STARTING_BALANCE_CREDITS = 1_000;
export const DEFAULT_ENTRY_WINDOW_MS = 20_000;

export const CONTEST_LIMITS = Object.freeze({
  minEntryCredits: 10,
  maxEntryCredits: 500,
  minCapacity: 2,
  maxCapacity: 100,
  minNameLength: 3,
  maxNameLength: 48,
});

export class ContestError extends RoomError {
  constructor(code, message) {
    super(code, message);
    this.name = 'ContestError';
  }
}

const cleanNickname = (value) => {
  if (typeof value !== 'string') {
    throw new ContestError('INVALID_NICKNAME', 'Enter a nickname to continue.');
  }
  const nickname = value.trim().replace(/\s+/g, ' ');
  if (nickname.length < 2 || nickname.length > 24) {
    throw new ContestError('INVALID_NICKNAME', 'Nickname must be 2–24 characters.');
  }
  return nickname;
};

const cleanWalletAddress = (value) => {
  if (value === undefined || value === null || value === '') return null;
  if (typeof value !== 'string' || value.length < 32 || value.length > 44 || /\s/.test(value)) {
    throw new ContestError('INVALID_WALLET', 'Connect a valid Solana wallet before continuing.');
  }
  return value;
};

const cleanContestName = (value) => {
  if (typeof value !== 'string') {
    throw new ContestError('INVALID_CONTEST_NAME', 'Enter a name for the private contest.');
  }
  const name = value.trim().replace(/\s+/g, ' ');
  if (
    name.length < CONTEST_LIMITS.minNameLength
    || name.length > CONTEST_LIMITS.maxNameLength
  ) {
    throw new ContestError(
      'INVALID_CONTEST_NAME',
      `Contest name must be ${CONTEST_LIMITS.minNameLength}–${CONTEST_LIMITS.maxNameLength} characters.`,
    );
  }
  return name;
};

const integerInRange = (value, minimum, maximum, code, label) => {
  const number = Number(value);
  if (!Number.isInteger(number) || number < minimum || number > maximum) {
    throw new ContestError(code, `${label} must be a whole number from ${minimum} to ${maximum}.`);
  }
  return number;
};

const cloneMatch = (match) => ({
  id: match.id,
  competition: match.competition,
  home: { ...match.home },
  away: { ...match.away },
});

const defaultPrivatePayoutLadder = (prizePoolCredits, participantCount) => {
  if (participantCount <= 2) {
    return [{ rankFrom: 1, rankTo: 1, rewardCredits: prizePoolCredits }];
  }

  if (participantCount <= 5) {
    const second = Math.floor(prizePoolCredits * 0.3);
    return [
      { rankFrom: 1, rankTo: 1, rewardCredits: prizePoolCredits - second },
      { rankFrom: 2, rankTo: 2, rewardCredits: second },
    ];
  }

  const second = Math.floor(prizePoolCredits * 0.3);
  const third = Math.floor(prizePoolCredits * 0.2);
  return [
    { rankFrom: 1, rankTo: 1, rewardCredits: prizePoolCredits - second - third },
    { rankFrom: 2, rankTo: 2, rewardCredits: second },
    { rankFrom: 3, rankTo: 3, rewardCredits: third },
  ];
};

export const FEATURED_CONTESTS = Object.freeze([
  Object.freeze({
    id: 'featured-grand-jury',
    name: 'Grand Jury',
    roomCode: 'GRAND-JURY',
    entryCredits: 100,
    prizePoolCredits: 10_000,
    capacity: 100,
    payoutLadder: Object.freeze([
      Object.freeze({ rankFrom: 1, rankTo: 1, rewardCredits: 3_000 }),
      Object.freeze({ rankFrom: 2, rankTo: 2, rewardCredits: 1_800 }),
      Object.freeze({ rankFrom: 3, rankTo: 3, rewardCredits: 1_200 }),
      Object.freeze({ rankFrom: 4, rankTo: 10, rewardCredits: 400 }),
      Object.freeze({ rankFrom: 11, rankTo: 20, rewardCredits: 120 }),
    ]),
  }),
  Object.freeze({
    id: 'featured-touchline-25',
    name: 'Touchline 25',
    roomCode: 'TOUCHLINE25',
    entryCredits: 50,
    prizePoolCredits: 2_500,
    capacity: 25,
    payoutLadder: Object.freeze([
      Object.freeze({ rankFrom: 1, rankTo: 1, rewardCredits: 1_000 }),
      Object.freeze({ rankFrom: 2, rankTo: 2, rewardCredits: 600 }),
      Object.freeze({ rankFrom: 3, rankTo: 3, rewardCredits: 400 }),
      Object.freeze({ rankFrom: 4, rankTo: 5, rewardCredits: 250 }),
    ]),
  }),
  Object.freeze({
    id: 'featured-first-whistle',
    name: 'First Whistle',
    roomCode: '1ST-WHISTLE',
    entryCredits: 20,
    prizePoolCredits: 1_000,
    capacity: 50,
    payoutLadder: Object.freeze([
      Object.freeze({ rankFrom: 1, rankTo: 1, rewardCredits: 400 }),
      Object.freeze({ rankFrom: 2, rankTo: 2, rewardCredits: 250 }),
      Object.freeze({ rankFrom: 3, rankTo: 3, rewardCredits: 150 }),
      Object.freeze({ rankFrom: 4, rankTo: 5, rewardCredits: 100 }),
    ]),
  }),
]);

const normalizedInviteCode = (value) => String(value ?? '').trim().toUpperCase();
const normalizedRoomCode = (value) => String(value ?? '').trim().toUpperCase();

const payoutAtPosition = (contest, position) => {
  const tier = contest.payoutLadder.find(
    ({ rankFrom, rankTo }) => position >= rankFrom && position <= rankTo,
  );
  return tier?.rewardCredits ?? 0;
};

/**
 * Owns demo-credit identities and contest accounting. All mutations are
 * synchronous so a join's validation, debit, and membership insert form one
 * atomic operation within the Node process.
 */
export class ContestManager extends EventEmitter {
  constructor({
    match,
    now = Date.now,
    idFactory = () => randomUUID(),
    tokenFactory = () => randomUUID(),
    inviteCodeFactory = () => randomUUID().replace(/-/g, '').slice(0, 6).toUpperCase(),
    startingBalanceCredits = DEFAULT_STARTING_BALANCE_CREDITS,
    entryWindowMs = DEFAULT_ENTRY_WINDOW_MS,
    featuredContests = FEATURED_CONTESTS,
  }) {
    super();
    this.match = match;
    this.now = now;
    this.idFactory = idFactory;
    this.tokenFactory = tokenFactory;
    this.inviteCodeFactory = inviteCodeFactory;
    this.startingBalanceCredits = startingBalanceCredits;
    this.entryWindowMs = Number.isFinite(entryWindowMs) && entryWindowMs > 0
      ? Math.round(entryWindowMs)
      : DEFAULT_ENTRY_WINDOW_MS;
    this.accounts = new Map();
    this.contests = new Map();
    this.inviteCodes = new Map();
    this.roomCodes = new Map();
    this.matchEntryClosesAt = null;
    this.matchStarted = false;
    this.matchEnded = false;

    for (const definition of featuredContests) this.#seedFeaturedContest(definition);
  }

  list({ participantId, resumeToken } = {}) {
    const account = participantId || resumeToken
      ? this.authenticate({ participantId, resumeToken })
      : null;
    const contests = [...this.contests.values()]
      .filter((contest) => contest.visibility === 'public' || account?.contestIds.has(contest.id))
      .sort((a, b) =>
        Number(b.featured) - Number(a.featured)
        || a.entryCredits - b.entryCredits
        || a.createdAt - b.createdAt)
      .map((contest) => this.#contestSnapshot(contest, account));
    return {
      contests,
      ...(account ? { wallet: this.walletSnapshot(account) } : {}),
    };
  }

  session({ nickname, participantId, resumeToken, walletAddress } = {}) {
    const account = this.#resolveOrCreateAccount({ nickname, participantId, resumeToken, walletAddress });
    return {
      session: this.#sessionSnapshot(account),
      wallet: this.walletSnapshot(account),
      contests: this.list({
        participantId: account.id,
        resumeToken: account.resumeToken,
      }).contests,
    };
  }

  buyPoints({ participantId, resumeToken, walletAddress, amountCredits, transactionId }) {
    const account = this.authenticate({ participantId, resumeToken });
    const cleanWallet = cleanWalletAddress(walletAddress);
    if (!cleanWallet || account.walletAddress !== cleanWallet) {
      throw new ContestError('WALLET_MISMATCH', 'Reconnect the wallet used to open this demo account.');
    }
    if (!Number.isInteger(amountCredits) || amountCredits <= 0) {
      throw new ContestError('INVALID_CREDIT_AMOUNT', 'The credit package amount is invalid.');
    }
    if (typeof transactionId !== 'string' || transactionId.length < 80) {
      throw new ContestError('INVALID_PAYMENT', 'The Solana transaction signature is invalid.');
    }
    if (account.transactions.some((t) => t.id === transactionId)) {
      throw new ContestError('DUPLICATE_TRANSACTION', 'This purchase has already been credited.');
    }
    account.balanceCredits += amountCredits;
    account.transactions.push({
      id: transactionId,
      type: 'purchase_credits',
      amountCredits,
      at: this.now(),
    });
    return {
      session: this.#sessionSnapshot(account),
      wallet: this.walletSnapshot(account),
    };
  }

  lookup({ inviteCode, participantId, resumeToken } = {}) {
    const code = normalizedInviteCode(inviteCode);
    const contestId = this.inviteCodes.get(code);
    if (!code || !contestId) {
      throw new ContestError('INVALID_INVITE_CODE', 'That private contest code was not found.');
    }
    const account = participantId || resumeToken
      ? this.authenticate({ participantId, resumeToken })
      : null;
    return this.#contestSnapshot(this.contests.get(contestId), account, { revealInviteCode: false });
  }

  create({
    name,
    entryCredits,
    capacity,
    nickname,
    participantId,
    resumeToken,
  } = {}) {
    const account = this.#resolveOrCreateAccount({
      nickname,
      participantId,
      resumeToken,
    });
    const contestName = cleanContestName(name);
    const safeEntryCredits = integerInRange(
      entryCredits,
      CONTEST_LIMITS.minEntryCredits,
      CONTEST_LIMITS.maxEntryCredits,
      'INVALID_ENTRY_CREDITS',
      'Entry credits',
    );
    const safeCapacity = integerInRange(
      capacity,
      CONTEST_LIMITS.minCapacity,
      CONTEST_LIMITS.maxCapacity,
      'INVALID_CAPACITY',
      'Capacity',
    );
    if (account.balanceCredits < safeEntryCredits) {
      throw new ContestError(
        'INSUFFICIENT_CREDITS',
        `You need ${safeEntryCredits} test credits to create and join this contest.`,
      );
    }

    const idSuffix = String(this.idFactory()).replace(/[^a-zA-Z0-9]/g, '').slice(0, 10);
    const id = `private-${idSuffix}`;
    const roomCode = this.#uniqueRoomCode(idSuffix);
    const inviteCode = this.#uniqueInviteCode();
    const maxPrizePoolCredits = safeEntryCredits * safeCapacity;
    const contest = this.#newContest({
      id,
      name: contestName,
      roomCode,
      entryCredits: safeEntryCredits,
      prizePoolCredits: 0,
      maxPrizePoolCredits,
      capacity: safeCapacity,
      payoutLadder: [],
      poolType: 'flexible',
      fundingLabel: '100% of collected test-credit entries',
      visibility: 'private',
      featured: false,
      inviteCode,
      createdByParticipantId: account.id,
    });

    this.contests.set(contest.id, contest);
    this.inviteCodes.set(inviteCode, contest.id);
    this.roomCodes.set(roomCode, contest.id);
    try {
      this.#joinExistingContest(contest, account);
    } catch (error) {
      this.contests.delete(contest.id);
      this.inviteCodes.delete(inviteCode);
      this.roomCodes.delete(roomCode);
      throw error;
    }
    this.emit('state', { contestId: contest.id, type: 'created' });
    return this.#actionResult(contest, account);
  }

  join({
    contestId,
    inviteCode,
    nickname,
    participantId,
    resumeToken,
  } = {}) {
    const account = this.#resolveOrCreateAccount({ nickname, participantId, resumeToken });
    const contest = this.#resolveContest({ contestId, inviteCode });
    this.#joinExistingContest(contest, account, { inviteCode });
    this.emit('state', { contestId: contest.id, type: 'joined' });
    return this.#actionResult(contest, account);
  }

  authenticate({ participantId, resumeToken } = {}) {
    const account = typeof participantId === 'string' ? this.accounts.get(participantId) : null;
    if (!account || !resumeToken || account.resumeToken !== resumeToken) {
      throw new ContestError('INVALID_SESSION', 'That demo-credit session could not be resumed.');
    }
    return account;
  }

  contestForRoom(roomCode) {
    const contestId = this.roomCodes.get(normalizedRoomCode(roomCode));
    return contestId ? this.contests.get(contestId) ?? null : null;
  }

  authorizeRoomEntry({ roomCode, participantId, resumeToken, nickname } = {}) {
    const contest = this.contestForRoom(roomCode);
    if (!contest) return null;
    this.#refreshEntryStatus(contest);
    const account = this.authenticate({ participantId, resumeToken });
    if (!contest.members.has(account.id)) {
      throw new ContestError(
        'CONTEST_MEMBERSHIP_REQUIRED',
        'Join this contest before entering its jury room.',
      );
    }
    if (nickname !== undefined) account.nickname = cleanNickname(nickname);
    return {
      account,
      contest,
      identity: { id: account.id, resumeToken: account.resumeToken },
    };
  }

  assertSocketMayPlay({ roomCode, participantId } = {}) {
    const contest = this.contestForRoom(roomCode);
    if (!contest) return null;
    if (!participantId || !contest.members.has(participantId)) {
      throw new ContestError(
        'CONTEST_MEMBERSHIP_REQUIRED',
        'Only contest members can play in this jury room.',
      );
    }
    return contest;
  }

  updateFromRoomState(roomCode, roomState) {
    const contest = this.contestForRoom(roomCode);
    if (!contest || !roomState) return null;
    this.#refreshEntryStatus(contest);
    this.#refreshRankings(contest, roomState);

    const matchPhase = roomState.match?.phase;
    const replayStatus = roomState.replay?.status;
    const matchStarted = (
      typeof matchPhase === 'string' && matchPhase !== 'pre_match'
    ) || replayStatus === 'playing' || replayStatus === 'ended';
    if (matchStarted) {
      this.matchStarted = true;
      for (const matchContest of this.contests.values()) {
        if (matchContest.status === 'open') matchContest.status = 'locked';
      }
    }

    if (contest.status !== 'completed' && matchStarted) {
      contest.status = 'live';
    }

    const matchEnded = roomState.match?.phase === 'full_time'
      || roomState.replay?.status === 'ended';
    if (matchEnded) {
      this.matchEnded = true;
    }
    if (matchEnded) this.#settleContest(contest, roomState);
    return contest;
  }

  decorateRoomState(roomState, viewerParticipantId = null) {
    if (!roomState) return roomState;
    const contest = this.contestForRoom(roomState.roomCode);
    if (!contest) return roomState;
    const account = viewerParticipantId ? this.accounts.get(viewerParticipantId) : null;
    const hideLiveVoteSignals = Boolean(
      roomState.activeCall && roomState.activeCall.status !== 'settled',
    );
    let activeCall = roomState.activeCall;
    if (hideLiveVoteSignals) {
      const { counts: _counts, totalVotes: _totalVotes, ...safeActiveCall } = activeCall;
      activeCall = safeActiveCall;
    }
    const participants = roomState.participants.map((participant) => {
      const participantWithEligibility = {
        ...participant,
        contestEligible: contest.members.has(participant.id),
      };
      if (!hideLiveVoteSignals) return participantWithEligibility;
      const {
        hasVoted: _hasVoted,
        vote: _vote,
        ...safeParticipant
      } = participantWithEligibility;
      return safeParticipant;
    });
    const activity = hideLiveVoteSignals
      ? roomState.activity.filter((item) => item.type !== 'vote_cast')
      : roomState.activity;

    return {
      ...roomState,
      activeCall,
      participants,
      activity,
      contest: this.#contestSnapshot(contest, account),
      you: roomState.you
        ? {
            ...roomState.you,
            ...(account ? { wallet: this.walletSnapshot(account) } : {}),
          }
        : null,
    };
  }

  walletSnapshot(accountOrParticipantId) {
    const account = typeof accountOrParticipantId === 'string'
      ? this.accounts.get(accountOrParticipantId)
      : accountOrParticipantId;
    if (!account) return null;
    return {
      participantId: account.id,
      balanceCredits: account.balanceCredits,
      currency: TEST_CREDIT_CURRENCY,
      isWithdrawable: false,
    };
  }

  #resolveOrCreateAccount({ nickname, participantId, resumeToken, walletAddress }) {
    const cleanWallet = cleanWalletAddress(walletAddress);
    if (participantId || resumeToken) {
      const account = this.authenticate({ participantId, resumeToken });
      if (cleanWallet && account.walletAddress && account.walletAddress !== cleanWallet) {
        throw new ContestError('WALLET_MISMATCH', 'Reconnect the wallet used to open this demo account.');
      }
      if (cleanWallet && !account.walletAddress) account.walletAddress = cleanWallet;
      if (nickname !== undefined) account.nickname = cleanNickname(nickname);
      return account;
    }
    const id = `player-${this.idFactory()}`;
    const account = {
      id,
      resumeToken: this.tokenFactory(),
      nickname: cleanNickname(nickname),
      walletAddress: cleanWallet,
      balanceCredits: this.startingBalanceCredits,
      contestIds: new Set(),
      transactions: [],
      createdAt: this.now(),
    };
    this.accounts.set(id, account);
    return account;
  }

  #resolveContest({ contestId, inviteCode }) {
    const code = normalizedInviteCode(inviteCode);
    const idFromCode = code ? this.inviteCodes.get(code) : null;
    let contest = contestId ? this.contests.get(String(contestId)) : null;
    if (!contest && idFromCode) contest = this.contests.get(idFromCode);
    if (!contest) {
      throw new ContestError(
        code ? 'INVALID_INVITE_CODE' : 'CONTEST_NOT_FOUND',
        code ? 'That private contest code was not found.' : 'That contest was not found.',
      );
    }
    if (contest.visibility === 'private' && code !== contest.inviteCode) {
      throw new ContestError('INVALID_INVITE_CODE', 'Enter the private contest invite code.');
    }
    return contest;
  }

  #joinExistingContest(contest, account) {
    const attemptedAt = this.now();
    this.#refreshEntryStatus(contest, attemptedAt);
    if (contest.status !== 'open') {
      throw new ContestError(
        'ENTRY_CLOSED',
        'Entries are closed because this contest has started or its entry window ended.',
      );
    }
    if (contest.members.has(account.id)) {
      throw new ContestError('ALREADY_JOINED', 'You have already joined this contest.');
    }
    if (contest.members.size >= contest.capacity) {
      throw new ContestError('CONTEST_FULL', 'This contest is full.');
    }
    if (account.balanceCredits < contest.entryCredits) {
      throw new ContestError(
        'INSUFFICIENT_CREDITS',
        `You need ${contest.entryCredits} test credits to join this contest.`,
      );
    }

    const joinedAt = attemptedAt;
    const transactionId = `entry:${contest.id}:${account.id}`;
    account.balanceCredits -= contest.entryCredits;
    account.contestIds.add(contest.id);
    account.transactions.push({
      id: transactionId,
      type: 'contest_entry',
      contestId: contest.id,
      amountCredits: -contest.entryCredits,
      at: joinedAt,
    });
    contest.members.set(account.id, {
      participantId: account.id,
      nickname: account.nickname,
      joinedAt,
      score: 0,
      rank: 1,
      projectedRewardCredits: 0,
      rewardCredits: 0,
      rewardTransactionId: null,
    });
    if (this.matchEntryClosesAt === null) {
      this.#setMatchEntryDeadline(joinedAt + this.entryWindowMs);
    }
    contest.entryClosesAt = this.matchEntryClosesAt;
    if (contest.poolType === 'flexible') this.#refreshFlexiblePool(contest);
    this.#refreshRankings(contest, null);
  }

  #refreshEntryStatus(contest, currentTime = this.now()) {
    if (this.matchEntryClosesAt !== null) {
      contest.entryClosesAt = this.matchEntryClosesAt;
    }
    if (
      contest.status === 'open'
      && (
        this.matchStarted
        || this.matchEnded
        || (
          contest.entryClosesAt !== null
          && currentTime >= contest.entryClosesAt
        )
      )
    ) {
      contest.status = 'locked';
    }
  }

  #setMatchEntryDeadline(entryClosesAt) {
    if (this.matchEntryClosesAt !== null) return;
    this.matchEntryClosesAt = entryClosesAt;
    for (const contest of this.contests.values()) {
      contest.entryClosesAt = entryClosesAt;
    }
  }

  #refreshFlexiblePool(contest) {
    contest.prizePoolCredits = contest.entryCredits * contest.members.size;
    contest.payoutLadder = defaultPrivatePayoutLadder(
      contest.prizePoolCredits,
      contest.members.size,
    );
  }

  #refreshRankings(contest, roomState) {
    const roomParticipants = new Map(
      (roomState?.participants ?? []).map((participant) => [participant.id, participant]),
    );
    const eligible = [...contest.members.values()];
    for (const member of eligible) {
      const roomParticipant = roomParticipants.get(member.participantId);
      member.score = roomParticipant?.score ?? member.score ?? 0;
      member.nickname = this.accounts.get(member.participantId)?.nickname ?? member.nickname;
    }
    eligible.sort((a, b) =>
      b.score - a.score
      || a.nickname.localeCompare(b.nickname)
      || a.participantId.localeCompare(b.participantId));

    let index = 0;
    while (index < eligible.length) {
      const score = eligible[index].score;
      let groupEnd = index + 1;
      while (groupEnd < eligible.length && eligible[groupEnd].score === score) groupEnd += 1;
      const occupiedPositions = [];
      for (let position = index + 1; position <= groupEnd; position += 1) {
        occupiedPositions.push(payoutAtPosition(contest, position));
      }
      const sharedReward = Math.floor(
        occupiedPositions.reduce((sum, reward) => sum + reward, 0) / (groupEnd - index),
      );
      for (let memberIndex = index; memberIndex < groupEnd; memberIndex += 1) {
        eligible[memberIndex].rank = index + 1;
        eligible[memberIndex].projectedRewardCredits = sharedReward;
      }
      index = groupEnd;
    }
    contest.rankings = eligible.map((member) => ({
      participantId: member.participantId,
      nickname: member.nickname,
      score: member.score,
      rank: member.rank,
      projectedRewardCredits: member.projectedRewardCredits,
      rewardCredits: member.rewardCredits,
    }));
  }

  #settleContest(contest, roomState) {
    const settlementId = `${this.match.id}:${roomState.generation ?? 0}`;
    if (contest.settlementId) return contest.settlementId === settlementId;
    this.#refreshRankings(contest, roomState);
    for (const member of contest.members.values()) {
      const rewardCredits = member.projectedRewardCredits;
      const transactionId = `reward:${contest.id}:${settlementId}:${member.participantId}`;
      if (member.rewardTransactionId || rewardCredits <= 0) {
        member.rewardCredits = member.rewardCredits || 0;
        continue;
      }
      const account = this.accounts.get(member.participantId);
      if (!account || account.transactions.some(({ id }) => id === transactionId)) continue;
      account.balanceCredits += rewardCredits;
      account.transactions.push({
        id: transactionId,
        type: 'simulated_contest_reward',
        contestId: contest.id,
        amountCredits: rewardCredits,
        at: this.now(),
      });
      member.rewardCredits = rewardCredits;
      member.rewardTransactionId = transactionId;
    }
    contest.status = 'completed';
    contest.settlementId = settlementId;
    contest.settledAt = this.now();
    this.#refreshRankings(contest, roomState);
    this.emit('state', { contestId: contest.id, type: 'settled' });
    return true;
  }

  #contestSnapshot(contest, account, { revealInviteCode = true } = {}) {
    this.#refreshEntryStatus(contest);
    const member = account ? contest.members.get(account.id) : null;
    const membership = account
      ? {
          joined: Boolean(member),
          ...(member
            ? {
                joinedAt: member.joinedAt,
                rank: member.rank,
                score: member.score,
                projectedRewardCredits: member.projectedRewardCredits,
                rewardCredits: member.rewardCredits,
              }
            : {}),
        }
      : undefined;
    return {
      id: contest.id,
      name: contest.name,
      visibility: contest.visibility,
      featured: contest.featured,
      roomCode: contest.roomCode,
      entryCredits: contest.entryCredits,
      prizePoolCredits: contest.prizePoolCredits,
      maxPrizePoolCredits: contest.maxPrizePoolCredits,
      poolType: contest.poolType,
      fundingLabel: contest.fundingLabel,
      capacity: contest.capacity,
      joinedCount: contest.members.size,
      status: contest.status,
      entryClosesAt: contest.entryClosesAt,
      currency: TEST_CREDIT_CURRENCY,
      isCash: false,
      withdrawalsEnabled: false,
      payoutLadder: contest.payoutLadder.map((tier) => ({ ...tier })),
      match: cloneMatch(contest.match),
      ...(membership ? { membership } : {}),
      ...(contest.visibility === 'private' && member && revealInviteCode
        ? { inviteCode: contest.inviteCode }
        : {}),
    };
  }

  #actionResult(contest, account) {
    return {
      session: this.#sessionSnapshot(account),
      wallet: this.walletSnapshot(account),
      contest: this.#contestSnapshot(contest, account),
    };
  }

  #sessionSnapshot(account) {
    return {
      participantId: account.id,
      resumeToken: account.resumeToken,
      nickname: account.nickname,
      ...(account.walletAddress ? { walletAddress: account.walletAddress } : {}),
    };
  }

  #seedFeaturedContest(definition) {
    const contest = this.#newContest({
      ...definition,
      maxPrizePoolCredits: definition.prizePoolCredits,
      poolType: 'guaranteed',
      fundingLabel: 'Guaranteed by demo treasury',
      visibility: 'public',
      featured: true,
      inviteCode: null,
      createdByParticipantId: null,
    });
    this.contests.set(contest.id, contest);
    this.roomCodes.set(contest.roomCode, contest.id);
  }

  #newContest({
    id,
    name,
    roomCode,
    entryCredits,
    prizePoolCredits,
    maxPrizePoolCredits,
    capacity,
    payoutLadder,
    poolType,
    fundingLabel,
    visibility,
    featured,
    inviteCode,
    createdByParticipantId,
  }) {
    return {
      id,
      name,
      roomCode: normalizedRoomCode(roomCode),
      entryCredits,
      prizePoolCredits,
      maxPrizePoolCredits,
      capacity,
      payoutLadder: payoutLadder.map((tier) => ({ ...tier })),
      poolType,
      fundingLabel,
      visibility,
      featured,
      inviteCode,
      createdByParticipantId,
      match: cloneMatch(this.match),
      status: 'open',
      entryClosesAt: this.matchEntryClosesAt,
      createdAt: this.now(),
      settledAt: null,
      settlementId: null,
      members: new Map(),
      rankings: [],
    };
  }

  #uniqueInviteCode() {
    for (let attempt = 0; attempt < 20; attempt += 1) {
      const code = normalizedInviteCode(this.inviteCodeFactory());
      if (/^[A-Z0-9]{6}$/.test(code) && !this.inviteCodes.has(code)) return code;
    }
    throw new ContestError('CODE_GENERATION_FAILED', 'Could not create a unique invite code.');
  }

  #uniqueRoomCode(seed) {
    const base = `P-${String(seed).toUpperCase()}`.slice(0, 12);
    if (!this.roomCodes.has(base)) return base;
    for (let suffix = 2; suffix < 100; suffix += 1) {
      const code = `${base.slice(0, 12 - String(suffix).length)}${suffix}`;
      if (!this.roomCodes.has(code)) return code;
    }
    throw new ContestError('CODE_GENERATION_FAILED', 'Could not create a unique room code.');
  }
}
