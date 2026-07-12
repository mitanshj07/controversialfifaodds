import { EventEmitter } from 'node:events';
import { RoomError, RoomSession } from './room-session.js';

export function normalizeRoomCode(value = 'DEMO') {
  const roomCode = String(value || 'DEMO').trim().toUpperCase();
  if (!/^[A-Z0-9-]{3,12}$/.test(roomCode)) {
    throw new RoomError(
      'INVALID_ROOM_CODE',
      'Room code must be 3–12 letters, numbers, or hyphens.',
    );
  }
  return roomCode;
}

export class RoomManager extends EventEmitter {
  constructor({
    match,
    adapterFactory,
    demoJurors = [],
    now = Date.now,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  }) {
    super();
    this.match = match;
    this.adapterFactory = adapterFactory;
    this.demoJurors = demoJurors;
    this.now = now;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;
    this.rooms = new Map();
    this.socketToRoom = new Map();
    this.roomStartTimers = new Map();
    this.roomStartDeadlines = new Map();
    this.startedAt = this.now();
  }

  join({
    roomCode,
    nickname,
    socketId,
    participantId,
    resumeToken,
    trustedIdentity = null,
    startAt = null,
    playbackRate = 1,
  }) {
    const code = normalizeRoomCode(roomCode);
    const priorCode = this.socketToRoom.get(socketId);
    if (priorCode) this.disconnect(socketId);

    let room = this.rooms.get(code);
    if (!room) {
      room = this.#createRoom(code);
      this.rooms.set(code, room);
    }

    const joined = room.join({
      nickname,
      socketId,
      participantId,
      resumeToken,
      trustedIdentity,
    });
    this.socketToRoom.set(socketId, code);
    this.#ensureRoomStart(room, startAt, playbackRate);
    joined.state = this.snapshot(code, joined.credentials.id);
    return { room, ...joined };
  }

  disconnect(socketId) {
    const roomCode = this.socketToRoom.get(socketId);
    if (!roomCode) return null;
    this.socketToRoom.delete(socketId);
    const room = this.rooms.get(roomCode);
    room?.disconnectSocket(socketId);
    return roomCode;
  }

  castVote(socketId, { callId, choice } = {}) {
    const binding = this.#bindingFor(socketId);
    return binding.room.castVote({ participantId: binding.participantId, callId, choice });
  }

  restart(socketId, options = {}) {
    const binding = this.#bindingFor(socketId);
    return binding.room.restart(binding.participantId, options);
  }

  snapshot(roomCode, viewerParticipantId = null) {
    const code = normalizeRoomCode(roomCode);
    const room = this.rooms.get(code);
    if (!room) return null;
    const state = room.snapshot(viewerParticipantId);
    const scheduledStartAt = this.roomStartDeadlines.get(code);
    if (scheduledStartAt === undefined) return state;
    return {
      ...state,
      replay: {
        ...state.replay,
        matchStartedAt: scheduledStartAt,
        ...(!room.started ? { scheduledStartAt } : {}),
      },
    };
  }

  connectedSockets(roomCode) {
    return this.rooms.get(normalizeRoomCode(roomCode))?.connectedSockets() ?? [];
  }

  health() {
    const rooms = [...this.rooms.values()];
    return {
      uptimeMs: this.now() - this.startedAt,
      rooms: rooms.length,
      participants: rooms.reduce((sum, room) => sum + room.participants.size, 0),
      connectedSockets: this.socketToRoom.size,
      waitingRooms: rooms.filter((room) => !room.started).length,
    };
  }

  close() {
    for (const timer of this.roomStartTimers.values()) this.clearTimeoutFn(timer);
    this.roomStartTimers.clear();
    this.roomStartDeadlines.clear();
    for (const room of this.rooms.values()) room.stop();
    this.rooms.clear();
    this.socketToRoom.clear();
  }

  #bindingFor(socketId) {
    const roomCode = this.socketToRoom.get(socketId);
    const room = roomCode ? this.rooms.get(roomCode) : null;
    const participantId = room?.socketBindings.get(socketId);
    if (!room || !participantId) {
      throw new RoomError('NOT_IN_ROOM', 'Join a room first.');
    }
    return { roomCode, room, participantId };
  }

  #ensureRoomStart(room, startAt, playbackRate) {
    if (room.started || this.roomStartTimers.has(room.code)) return;
    const scheduledAt = Number(startAt);
    const clockRate = Number.isFinite(Number(playbackRate)) && Number(playbackRate) > 0
      ? Number(playbackRate)
      : 1;
    if (!Number.isFinite(scheduledAt)) {
      this.#startRoom(room, 0);
      return;
    }

    this.roomStartDeadlines.set(room.code, scheduledAt);
    if (scheduledAt <= this.now()) {
      this.#startRoom(room, (this.now() - scheduledAt) * clockRate);
      return;
    }
    this.#scheduleRoomStartTimer(room, scheduledAt, clockRate);
  }

  #scheduleRoomStartTimer(room, scheduledAt, playbackRate) {
    const timer = this.setTimeoutFn(() => {
      this.roomStartTimers.delete(room.code);
      const remainingMs = scheduledAt - this.now();
      if (remainingMs > 0) {
        this.#scheduleRoomStartTimer(room, scheduledAt, playbackRate);
        return;
      }
      this.#startRoom(room, Math.max(0, -remainingMs) * playbackRate);
    }, Math.max(0, scheduledAt - this.now()));
    timer?.unref?.();
    this.roomStartTimers.set(room.code, timer);
  }

  #startRoom(room, offsetMs = 0) {
    if (room.started) return;
    room.start({ offsetMs });
    this.emit('state', { roomCode: room.code });
  }

  #createRoom(code) {
    const room = new RoomSession({
      code,
      match: this.match,
      adapter: this.adapterFactory({ roomCode: code }),
      demoJurors: this.demoJurors,
      now: this.now,
    });
    room.on('state', () => this.emit('state', { roomCode: code }));
    room.on('callOpened', (call) => this.emit('callOpened', { roomCode: code, call }));
    room.on('callSettled', (settlement) =>
      this.emit('callSettled', { roomCode: code, settlement }));
    room.on('restarted', (replay) => this.emit('restarted', { roomCode: code, replay }));
    return room;
  }
}
