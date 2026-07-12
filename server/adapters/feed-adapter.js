/**
 * Canonical events consumed by the domain layer. A future TxLINE adapter only
 * needs to translate SSE records into these event shapes.
 */
export const FeedEventType = Object.freeze({
  MATCH_STARTED: 'match_started',
  PHASE_CHANGED: 'phase_changed',
  SCORE_CHANGED: 'score_changed',
  BIG_CALL_OPENED: 'big_call_opened',
  BIG_CALL_RESOLVED: 'big_call_resolved',
  MATCH_ENDED: 'match_ended',
});

const KNOWN_TYPES = new Set(Object.values(FeedEventType));

export function normalizedEvent({ id, type, offsetMs, payload = {} }) {
  if (typeof id !== 'string' || id.trim() === '') {
    throw new TypeError('A normalized feed event needs a stable string id.');
  }
  if (!KNOWN_TYPES.has(type)) {
    throw new TypeError(`Unknown normalized feed event type: ${type}`);
  }
  if (!Number.isFinite(offsetMs) || offsetMs < 0) {
    throw new TypeError('A normalized feed event needs a non-negative offsetMs.');
  }

  return Object.freeze({
    id,
    type,
    offsetMs,
    payload: Object.freeze({ ...payload }),
  });
}

export function assertFeedAdapter(adapter) {
  for (const method of ['start', 'stop', 'restart']) {
    if (typeof adapter?.[method] !== 'function') {
      throw new TypeError(`Feed adapter must implement ${method}().`);
    }
  }
  return adapter;
}

/**
 * @typedef {object} FeedSink
 * @property {(event: object) => void} onEvent
 * @property {(clock: object) => void} onClock
 * @property {(clock: object) => void} onEnd
 *
 * Adapter contract:
 * - start(sink) registers the sink, begins the feed and returns its generation.
 * - restart() resets the same feed and returns the new generation.
 * - stop() releases timers/connections.
 * - every event id must be stable for a source record.
 * - events and clocks include the current generation.
 */

