import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { FeedEventType, assertFeedAdapter } from '../adapters/feed-adapter.js';
import { buildReputationCheckpoint } from './reputation-checkpoint.js';

export const VOTE_OPTIONS = Object.freeze(['stands', 'overturned']);
const VOTE_OPTION_SET = new Set(VOTE_OPTIONS);
const MAX_PARTICIPANTS = 100;
const MAX_ACTIVITY = 16;
const MAX_HISTORY = 12;

export class RoomError extends Error {
  constructor(code, message) {
    super(message);
    this.name = 'RoomError';
    this.code = code;
  }
}

const safeInteger = (value, fallback = 0) =>
  Number.isInteger(value) && value >= 0 ? value : fallback;

const cleanNickname = (value) => {
  if (typeof value !== 'string') {
    throw new RoomError('INVALID_NICKNAME', 'Enter a nickname to join.');
  }
  const nickname = value.trim().replace(/\s+/g, ' ');
  if (nickname.length < 2 || nickname.length > 24) {
    throw new RoomError('INVALID_NICKNAME', 'Nickname must be 2–24 characters.');
  }
  return nickname;
};

const publicCounts = (votes) => {
  const counts = { stands: 0, overturned: 0 };
  for (const choice of votes.values()) counts[choice] += 1;
  return counts;
};

const pointsForStreak = (newStreak) =>
  Math.min(150, 100 + Math.max(0, newStreak - 1) * 25);

export class RoomSession extends EventEmitter {
  constructor({
    code,
    match,
    adapter,
    now = Date.now,
    idFactory = () => `p_${randomUUID()}`,
    tokenFactory = () => randomUUID(),
    demoJurors = [],
  }) {
    super();
    this.code = code;
    this.matchDefinition = match;
    this.adapter = assertFeedAdapter(adapter);
    this.now = now;
    this.idFactory = idFactory;
    this.tokenFactory = tokenFactory;

    this.createdAt = this.now();
    this.started = false;
    this.generation = 0;
    this.participants = new Map();
    this.socketBindings = new Map();
    this.processedEventIds = new Set();
    this.settledCallIds = new Set();
    this.history = [];
    this.activity = [];
    this.activeCall = null;
    this.lastProof = null;
    this.match = this.#initialMatch();
    this.replay = this.#initialReplay();

    for (const [index, juror] of demoJurors.entries()) {
      if (!juror?.id || !juror?.nickname || this.participants.has(juror.id)) continue;
      this.participants.set(juror.id, {
        id: juror.id,
        resumeToken: null,
        nickname: juror.nickname,
        score: 0,
        streak: 0,
        bestStreak: 0,
        votes: new Map(),
        sockets: new Set(),
        joinedAt: this.createdAt + index,
        isDemoJuror: true,
        choices: Array.isArray(juror.choices) ? [...juror.choices] : [],
      });
    }
  }

  start({ offsetMs = 0 } = {}) {
    if (this.started) return this.generation;
    this.started = true;
    const safeOffsetMs = Math.min(
      this.matchDefinition.durationMs,
      safeInteger(Math.round(Number(offsetMs) || 0)),
    );
    const generation = this.adapter.start({
      onEvent: (event) => this.processFeedEvent(event),
      onClock: (clock) => this.updateClock(clock),
      onEnd: (clock) => this.endReplay(clock),
    }, { offsetMs: safeOffsetMs });
    this.generation = generation;
    const adapterClock = typeof this.adapter.snapshot === 'function'
      ? this.adapter.snapshot()
      : null;
    const elapsedMs = safeInteger(
      Math.round(adapterClock?.elapsedMs),
      safeOffsetMs,
    );
    const progress = this.matchDefinition.durationMs > 0
      ? Math.min(1, elapsedMs / this.matchDefinition.durationMs)
      : 0;
    const playbackRate = Number.isFinite(adapterClock?.playbackRate)
      ? adapterClock.playbackRate
      : Number.isFinite(this.adapter.playbackRate) ? this.adapter.playbackRate : 1;
    this.replay = {
      ...this.replay,
      generation,
      status: 'playing',
      elapsedMs,
      progress,
      startedAt: adapterClock?.startedAt ?? this.now() - elapsedMs / playbackRate,
      playbackRate,
    };
    this.match.elapsedMs = elapsedMs;
    this.match.clock = adapterClock?.matchClock
      ?? (progress >= 1 ? 'FT' : `${Math.min(90, Math.floor(progress * 90))}′`);
    return generation;
  }

  stop() {
    this.adapter.stop();
    this.started = false;
  }

  join({ nickname, socketId, participantId, resumeToken, trustedIdentity = null }) {
    const cleanName = cleanNickname(nickname);
    let participant = null;

    if (participantId && this.participants.has(participantId)) {
      participant = this.participants.get(participantId);
      if (!resumeToken || resumeToken !== participant.resumeToken) {
        throw new RoomError('INVALID_RESUME_TOKEN', 'That player session cannot be resumed.');
      }
      participant.nickname = cleanName;
    } else {
      const participantCount = [...this.participants.values()]
        .filter((existingParticipant) => !existingParticipant.isDemoJuror)
        .length;
      if (participantCount >= MAX_PARTICIPANTS) {
        throw new RoomError('ROOM_FULL', 'This room is full.');
      }
      participant = {
        // A contest identity is accepted only through RoomManager's trusted
        // server-side path after ContestManager validates its membership.
        id: trustedIdentity?.id ?? this.idFactory(),
        resumeToken: trustedIdentity?.resumeToken ?? this.tokenFactory(),
        nickname: cleanName,
        score: 0,
        streak: 0,
        bestStreak: 0,
        votes: new Map(),
        sockets: new Set(),
        joinedAt: this.now(),
      };
      this.participants.set(participant.id, participant);
      this.#addActivity({
        id: `join:${participant.id}:${participant.joinedAt}`,
        type: 'participant_joined',
        message: `${participant.nickname} joined the jury`,
      });
    }

    participant.sockets.add(socketId);
    this.socketBindings.set(socketId, participant.id);
    this.emit('state');

    return {
      credentials: {
        id: participant.id,
        resumeToken: participant.resumeToken,
        nickname: participant.nickname,
      },
      state: this.snapshot(participant.id),
    };
  }

  disconnectSocket(socketId) {
    const participantId = this.socketBindings.get(socketId);
    if (!participantId) return false;
    this.socketBindings.delete(socketId);
    this.participants.get(participantId)?.sockets.delete(socketId);
    this.emit('state');
    return true;
  }

  castVote({ participantId, callId, choice }) {
    const participant = this.participants.get(participantId);
    if (!participant) {
      throw new RoomError('NOT_IN_ROOM', 'Join a room before voting.');
    }
    if (!this.activeCall || this.activeCall.id !== callId) {
      throw new RoomError('CALL_NOT_ACTIVE', 'That call is not active.');
    }

    const normalizedChoice = typeof choice === 'string' ? choice.toLowerCase() : '';
    if (!VOTE_OPTION_SET.has(normalizedChoice)) {
      throw new RoomError('INVALID_CHOICE', 'Vote must be stands or overturned.');
    }

    const authoritativeElapsedMs = this.#authoritativeElapsedMs();
    if (
      this.activeCall.status !== 'open'
      || authoritativeElapsedMs >= this.activeCall.closesAt
    ) {
      this.activeCall.status = 'locked';
      throw new RoomError('VOTING_CLOSED', 'The jury window is closed.');
    }

    const existingVote = this.activeCall.votes.get(participantId);
    if (existingVote) {
      if (existingVote === normalizedChoice) {
        return { accepted: true, duplicate: true, choice: existingVote };
      }
      throw new RoomError('ALREADY_VOTED', 'Your vote is locked for this call.');
    }

    this.activeCall.votes.set(participantId, normalizedChoice);
    participant.votes.set(callId, normalizedChoice);
    this.#addActivity({
      id: `vote:${this.generation}:${callId}:${participantId}`,
      type: 'vote_cast',
      message: `${participant.nickname} locked in a call`,
      minute: this.activeCall.minute,
    });
    this.emit('state');
    return { accepted: true, duplicate: false, choice: normalizedChoice };
  }

  processFeedEvent(event) {
    if (!event || typeof event.id !== 'string') {
      throw new TypeError('Feed events require a stable id.');
    }
    if (event.generation !== this.generation) {
      return { accepted: false, reason: 'stale_generation' };
    }

    const eventKey = `${event.generation}:${event.id}`;
    if (this.processedEventIds.has(eventKey)) {
      return { accepted: false, reason: 'duplicate' };
    }
    this.processedEventIds.add(eventKey);

    const payload = event.payload ?? {};
    switch (event.type) {
      case FeedEventType.MATCH_STARTED:
        this.match.phase = payload.phase ?? 'first_half';
        this.#addFeedActivity(event);
        break;
      case FeedEventType.PHASE_CHANGED:
        this.match.phase = payload.phase ?? this.match.phase;
        this.#addFeedActivity(event);
        break;
      case FeedEventType.SCORE_CHANGED:
        this.match.homeScore = safeInteger(payload.homeScore, this.match.homeScore);
        this.match.awayScore = safeInteger(payload.awayScore, this.match.awayScore);
        this.#addFeedActivity(event);
        break;
      case FeedEventType.BIG_CALL_OPENED:
        this.#openCall(event);
        break;
      case FeedEventType.BIG_CALL_RESOLVED:
        this.#settleCall(event);
        break;
      case FeedEventType.MATCH_ENDED:
        this.match.phase = payload.phase ?? 'full_time';
        this.#addFeedActivity(event);
        break;
      default:
        return { accepted: false, reason: 'unknown_type' };
    }

    this.emit('state');
    return { accepted: true };
  }

  updateClock(clock) {
    if (!clock || clock.generation !== this.generation) return false;
    this.replay = {
      generation: this.generation,
      status: clock.status === 'ended' ? 'ended' : 'playing',
      elapsedMs: safeInteger(clock.elapsedMs),
      durationMs: safeInteger(clock.durationMs, this.matchDefinition.durationMs),
      progress: Number.isFinite(clock.progress) ? clock.progress : 0,
      startedAt: clock.startedAt ?? this.replay.startedAt,
      playbackRate: Number.isFinite(clock.playbackRate) ? clock.playbackRate : 1,
    };
    this.match.clock = clock.matchClock ?? this.match.clock;
    this.match.elapsedMs = this.replay.elapsedMs;

    if (
      this.activeCall?.status === 'open'
      && this.replay.elapsedMs >= this.activeCall.closesAt
    ) {
      this.activeCall.status = 'locked';
    }
    if (
      this.activeCall?.status === 'settled'
      && this.replay.elapsedMs >= this.activeCall.revealUntil
    ) {
      this.activeCall = null;
    }
    this.emit('state');
    return true;
  }

  endReplay(clock) {
    if (!clock || clock.generation !== this.generation) return false;
    this.updateClock({ ...clock, status: 'ended' });
    this.replay.status = 'ended';
    this.match.clock = 'FT';
    this.match.phase = 'full_time';
    this.emit('state');
    return true;
  }

  restart(requestedByParticipantId, { offsetMs = 0 } = {}) {
    const participant = this.participants.get(requestedByParticipantId);
    if (!participant) {
      throw new RoomError('NOT_IN_ROOM', 'Join a room before restarting its replay.');
    }

    // Prime the expected generation before restart so even an adapter that emits
    // immediately cannot leak an event across replay boundaries.
    const expectedGeneration = this.generation + 1;
    this.#resetForReplay(expectedGeneration);
    const safeOffsetMs = Math.min(
      this.matchDefinition.durationMs,
      safeInteger(Math.round(Number(offsetMs) || 0)),
    );
    const actualGeneration = this.adapter.restart({ offsetMs: safeOffsetMs });
    this.generation = actualGeneration;
    this.replay.generation = actualGeneration;
    this.#addActivity({
      id: `restart:${actualGeneration}`,
      type: 'replay_restarted',
      message: `${participant.nickname} restarted the match`,
    });
    const payload = {
      roomCode: this.code,
      generation: actualGeneration,
      requestedBy: { id: participant.id, nickname: participant.nickname },
      offsetMs: safeOffsetMs,
    };
    this.emit('restarted', payload);
    this.emit('state');
    return payload;
  }

  snapshot(viewerParticipantId = null) {
    const activeCall = this.#publicActiveCall();
    const participants = [...this.participants.values()]
      .sort((a, b) =>
        b.score - a.score
        || b.streak - a.streak
        || a.joinedAt - b.joinedAt
        || a.nickname.localeCompare(b.nickname))
      .map((participant, index) => ({
        id: participant.id,
        nickname: participant.nickname,
        score: participant.score,
        streak: participant.streak,
        bestStreak: participant.bestStreak,
        rank: index + 1,
        connected: participant.sockets.size > 0,
        hasVoted: this.activeCall?.votes.has(participant.id) ?? false,
        ...(participant.id === viewerParticipantId
          ? { vote: this.activeCall?.votes.get(participant.id) ?? null }
          : {}),
      }));

    const viewer = viewerParticipantId
      ? this.participants.get(viewerParticipantId)
      : null;

    return {
      roomCode: this.code,
      generation: this.generation,
      serverTime: this.now(),
      match: {
        id: this.match.id,
        competition: this.match.competition,
        venue: this.match.venue,
        home: { ...this.match.home },
        away: { ...this.match.away },
        homeScore: this.match.homeScore,
        awayScore: this.match.awayScore,
        clock: this.match.clock,
        elapsedMs: this.match.elapsedMs,
        phase: this.match.phase,
      },
      replay: {
        status: this.replay.status,
        progress: this.replay.progress,
        elapsedMs: this.replay.elapsedMs,
        durationMs: this.replay.durationMs,
        startedAt: this.replay.startedAt,
        playbackRate: this.replay.playbackRate,
      },
      participants,
      activeCall,
      history: this.history.map((item) => ({ ...item, counts: { ...item.counts } })),
      activity: this.activity.map((item) => ({ ...item })),
      lastProof: this.lastProof ? { ...this.lastProof } : null,
      you: viewer
        ? {
            id: viewer.id,
            nickname: viewer.nickname,
            score: viewer.score,
            streak: viewer.streak,
            bestStreak: viewer.bestStreak,
            vote: this.activeCall?.votes.get(viewer.id) ?? null,
          }
        : null,
    };
  }

  connectedSockets() {
    return [...this.socketBindings.entries()].map(([socketId, participantId]) => ({
      socketId,
      participantId,
    }));
  }

  #initialMatch() {
    return {
      id: this.matchDefinition.id,
      competition: this.matchDefinition.competition,
      venue: this.matchDefinition.venue,
      home: { ...this.matchDefinition.home },
      away: { ...this.matchDefinition.away },
      homeScore: 0,
      awayScore: 0,
      clock: '0′',
      elapsedMs: 0,
      phase: 'pre_match',
    };
  }

  #initialReplay(generation = 0) {
    return {
      generation,
      status: generation === 0 ? 'waiting' : 'playing',
      progress: 0,
      elapsedMs: 0,
      durationMs: this.matchDefinition.durationMs,
      startedAt: null,
      playbackRate: 1,
    };
  }

  #resetForReplay(generation) {
    this.generation = generation;
    this.processedEventIds.clear();
    this.settledCallIds.clear();
    this.activeCall = null;
    this.lastProof = null;
    this.history = [];
    this.activity = [];
    this.match = this.#initialMatch();
    this.replay = this.#initialReplay(generation);
    for (const participant of this.participants.values()) {
      participant.score = 0;
      participant.streak = 0;
      participant.bestStreak = 0;
      participant.votes.clear();
    }
  }

  #openCall(event) {
    const payload = event.payload ?? {};
    const callId = payload.callId;
    if (!callId || this.settledCallIds.has(callId) || this.activeCall?.id === callId) return;

    if (this.activeCall && !this.settledCallIds.has(this.activeCall.id)) {
      // Normalized feeds should never overlap calls. Lock the prior one rather
      // than accepting votes into two ambiguous jury windows.
      this.activeCall.status = 'locked';
      return;
    }

    const windowMs = Number.isFinite(payload.windowMs) && payload.windowMs > 0
      ? Math.round(payload.windowMs)
      : 15_000;
    this.activeCall = {
      id: callId,
      sourceEventId: event.id,
      kind: payload.kind ?? 'var_review',
      title: payload.title ?? 'Big call under review',
      detail: payload.detail ?? '',
      minute: safeInteger(payload.minute),
      openedAt: event.offsetMs,
      closesAt: event.offsetMs + windowMs,
      status: 'open',
      votes: new Map(),
    };
    const callIndex = this.settledCallIds.size;
    for (const participant of this.participants.values()) {
      if (!participant.isDemoJuror) continue;
      const choice = participant.choices[callIndex % participant.choices.length];
      if (VOTE_OPTION_SET.has(choice)) {
        this.activeCall.votes.set(participant.id, choice);
        participant.votes.set(callId, choice);
      }
    }
    this.#addFeedActivity(event, 'call_opened');
    this.emit('callOpened', this.#publicActiveCall());
  }

  #settleCall(event) {
    const payload = event.payload ?? {};
    const callId = payload.callId;
    if (!callId || this.settledCallIds.has(callId)) return;
    if (!this.activeCall || this.activeCall.id !== callId) return;
    if (!VOTE_OPTION_SET.has(payload.result)) return;

    this.activeCall.status = 'settled';
    const result = payload.result;
    const counts = publicCounts(this.activeCall.votes);
    const results = [];

    for (const participant of this.participants.values()) {
      const choice = this.activeCall.votes.get(participant.id) ?? null;
      const correct = choice === result;
      let pointsAwarded = 0;
      if (correct) {
        participant.streak += 1;
        participant.bestStreak = Math.max(participant.bestStreak, participant.streak);
        pointsAwarded = pointsForStreak(participant.streak);
        participant.score += pointsAwarded;
      } else {
        participant.streak = 0;
      }
      results.push({
        participantId: participant.id,
        nickname: participant.nickname,
        choice,
        correct,
        pointsAwarded,
        streak: participant.streak,
        score: participant.score,
      });
    }

    const historyItem = {
      id: callId,
      kind: this.activeCall.kind,
      title: this.activeCall.title,
      detail: this.activeCall.detail,
      minute: safeInteger(payload.minute, this.activeCall.minute),
      result,
      counts,
      totalVotes: counts.stands + counts.overturned,
      correctVotes: results.filter((item) => item.correct).length,
      settledAt: event.offsetMs,
    };
    this.history.push(historyItem);
    this.history = this.history.slice(-MAX_HISTORY);
    this.settledCallIds.add(callId);
    this.#addFeedActivity(event, 'call_settled');

    const settlement = {
      roomCode: this.code,
      generation: this.generation,
      ...historyItem,
      results,
    };
    this.activeCall.result = result;
    this.activeCall.settlementNote = payload.message ?? '';
    this.activeCall.settledAt = event.offsetMs;
    this.activeCall.revealUntil = event.offsetMs + 6_000;
    this.lastProof = buildReputationCheckpoint({
      matchId: this.match.id,
      roomCode: this.code,
      generation: this.generation,
      history: this.history,
      participants: this.participants,
    });
    this.emit('callSettled', settlement);
  }

  #publicActiveCall() {
    if (!this.activeCall) return null;
    const counts = publicCounts(this.activeCall.votes);
    const playbackRate = this.replay.playbackRate || 1;
    const openedAt = this.replay.startedAt === null
      ? this.now()
      : this.replay.startedAt + this.activeCall.openedAt / playbackRate;
    const closesAt = this.replay.startedAt === null
      ? this.now() + Math.max(0, this.activeCall.closesAt - this.replay.elapsedMs) / playbackRate
      : this.replay.startedAt + this.activeCall.closesAt / playbackRate;
    return {
      id: this.activeCall.id,
      kind: this.activeCall.kind,
      title: this.activeCall.title,
      detail: this.activeCall.detail,
      minute: this.activeCall.minute,
      openedAt,
      closesAt,
      openedAtElapsedMs: this.activeCall.openedAt,
      closesAtElapsedMs: this.activeCall.closesAt,
      remainingMs: Math.max(0, this.activeCall.closesAt - this.replay.elapsedMs) / playbackRate,
      status: this.activeCall.status,
      result: this.activeCall.result ?? null,
      settlementNote: this.activeCall.settlementNote ?? null,
      options: [...VOTE_OPTIONS],
      counts,
      totalVotes: counts.stands + counts.overturned,
    };
  }

  #authoritativeElapsedMs() {
    if (
      this.replay.status === 'playing'
      && Number.isFinite(this.replay.startedAt)
      && Number.isFinite(this.replay.playbackRate)
    ) {
      return Math.max(
        this.replay.elapsedMs,
        (this.now() - this.replay.startedAt) * this.replay.playbackRate,
      );
    }
    return this.replay.elapsedMs;
  }

  #addFeedActivity(event, type = event.type) {
    const payload = event.payload ?? {};
    this.#addActivity({
      id: `feed:${this.generation}:${event.id}`,
      type,
      message: payload.message ?? payload.title ?? event.type,
      minute: safeInteger(payload.minute),
      at: event.offsetMs,
    });
  }

  #addActivity({ id, type, message, minute = null, at = this.replay.elapsedMs }) {
    this.activity.unshift({ id, type, message, minute, at });
    this.activity = this.activity.slice(0, MAX_ACTIVITY);
  }
}

export const scoring = Object.freeze({ pointsForStreak });
