import { assertFeedAdapter } from './feed-adapter.js';

const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

export class ScriptedReplayAdapter {
  constructor({
    events,
    durationMs,
    tickRateMs = 250,
    playbackRate = 1,
    now = Date.now,
    setIntervalFn = setInterval,
    clearIntervalFn = clearInterval,
    setTimeoutFn = setTimeout,
    clearTimeoutFn = clearTimeout,
  }) {
    if (!Array.isArray(events) || events.length === 0) {
      throw new TypeError('ScriptedReplayAdapter requires at least one event.');
    }
    if (!Number.isFinite(durationMs) || durationMs <= 0) {
      throw new TypeError('durationMs must be positive.');
    }
    if (!Number.isFinite(playbackRate) || playbackRate <= 0) {
      throw new TypeError('playbackRate must be positive.');
    }

    this.events = [...events].sort((a, b) => a.offsetMs - b.offsetMs);
    this.durationMs = durationMs;
    this.tickRateMs = tickRateMs;
    this.playbackRate = playbackRate;
    this.now = now;
    this.setIntervalFn = setIntervalFn;
    this.clearIntervalFn = clearIntervalFn;
    this.setTimeoutFn = setTimeoutFn;
    this.clearTimeoutFn = clearTimeoutFn;

    this.generation = 0;
    this.status = 'idle';
    this.sink = null;
    this.startedAt = null;
    this.nextEventIndex = 0;
    this.interval = null;
    this.initialTick = null;
  }

  start(sink, { offsetMs = 0 } = {}) {
    if (sink) this.sink = sink;
    if (!this.sink?.onEvent || !this.sink?.onClock || !this.sink?.onEnd) {
      throw new TypeError('A feed sink with onEvent, onClock and onEnd is required.');
    }

    this.stop();
    this.generation += 1;
    this.status = 'playing';
    const safeOffset = clamp(Number(offsetMs) || 0, 0, this.durationMs);
    this.startedAt = this.now() - safeOffset / this.playbackRate;
    this.nextEventIndex = 0;

    // Defer the first tick so the room can store the returned generation before
    // receiving events. This also makes restart boundaries deterministic.
    this.initialTick = this.setTimeoutFn(() => {
      this.initialTick = null;
      this.#tick();
    }, 0);
    this.interval = this.setIntervalFn(() => this.#tick(), this.tickRateMs);
    return this.generation;
  }

  restart(options = {}) {
    return this.start(undefined, options);
  }

  stop() {
    if (this.interval !== null) {
      this.clearIntervalFn(this.interval);
      this.interval = null;
    }
    if (this.initialTick !== null) {
      this.clearTimeoutFn(this.initialTick);
      this.initialTick = null;
    }
    if (this.status === 'playing') this.status = 'stopped';
  }

  snapshot() {
    const elapsedMs = this.startedAt === null
      ? 0
      : clamp((this.now() - this.startedAt) * this.playbackRate, 0, this.durationMs);
    return this.#clockSnapshot(elapsedMs);
  }

  #tick() {
    if (this.status !== 'playing') return;

    const elapsedMs = clamp(
      (this.now() - this.startedAt) * this.playbackRate,
      0,
      this.durationMs,
    );

    while (
      this.nextEventIndex < this.events.length
      && this.events[this.nextEventIndex].offsetMs <= elapsedMs
    ) {
      const event = this.events[this.nextEventIndex];
      this.nextEventIndex += 1;
      this.sink.onEvent({ ...event, generation: this.generation });
    }

    const clock = this.#clockSnapshot(elapsedMs);
    this.sink.onClock(clock);

    if (elapsedMs >= this.durationMs) {
      this.status = 'ended';
      if (this.interval !== null) {
        this.clearIntervalFn(this.interval);
        this.interval = null;
      }
      this.sink.onEnd({ ...clock, status: 'ended' });
    }
  }

  #clockSnapshot(elapsedMs) {
    const progress = clamp(elapsedMs / this.durationMs, 0, 1);
    const minute = Math.min(90, Math.floor(progress * 90));
    return {
      generation: this.generation,
      status: this.status === 'ended' ? 'ended' : this.status,
      startedAt: this.startedAt,
      elapsedMs: Math.round(elapsedMs),
      durationMs: this.durationMs,
      progress,
      playbackRate: this.playbackRate,
      minute,
      matchClock: progress >= 1 ? 'FT' : `${minute}′`,
    };
  }
}

// Exported for small dependency-injection checks and adapter conformance tests.
export const validateScriptedReplayAdapter = (adapter) => assertFeedAdapter(adapter);
