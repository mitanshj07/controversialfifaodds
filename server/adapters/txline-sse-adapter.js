import { FeedEventType, normalizedEvent } from './feed-adapter.js';

const sleep = (ms, signal) => new Promise((resolve, reject) => {
  const timer = setTimeout(resolve, ms);
  signal?.addEventListener('abort', () => {
    clearTimeout(timer);
    reject(signal.reason || new Error('Aborted'));
  }, { once: true });
});

const first = (...values) => values.find((value) => value !== undefined && value !== null);

const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asBoolean = (value) => {
  if (value === true || value === 'true' || value === 1 || value === '1') return true;
  if (value === false || value === 'false' || value === 0 || value === '0') return false;
  return null;
};

export function normaliseTxLineRecord(raw, sseId = null) {
  const data = first(raw?.dataSoccer, raw?.Data, raw?.data, {}) || {};
  const action = String(first(raw?.action, raw?.Action, data?.Action, '')).toLowerCase();
  const fixtureId = asNumber(first(raw?.fixtureId, raw?.FixtureId, raw?.fixtureID));
  const seq = asNumber(first(raw?.seq, raw?.Seq));
  const actionId = asNumber(first(raw?.actionId, raw?.ActionId, raw?.id, raw?.Id, data?.Id));
  const clock = first(raw?.clock, raw?.Clock, data?.Clock);
  const minute = asNumber(first(raw?.minute, raw?.Minute, clock?.Minute, clock?.minute));
  const occurredAtMs = asNumber(first(raw?.ts, raw?.TS, raw?.timestamp, raw?.Timestamp)) || Date.now();
  const reviewType = first(data?.Type, data?.type, raw?.reviewType, null);
  const outcome = first(data?.Outcome, data?.outcome, raw?.outcome, null);

  if (fixtureId === null || seq === null) return null;

  return {
    source: 'txline',
    fixtureId,
    seq,
    sseId,
    actionId,
    action,
    occurredAtMs,
    receivedAtMs: Date.now(),
    confirmed: asBoolean(first(raw?.confirmed, raw?.Confirmed, data?.Confirmed, null)),
    gameState: first(raw?.gameState, raw?.GameState, null),
    statusId: asNumber(first(raw?.statusId, raw?.StatusId)),
    minute,
    participant: asNumber(first(raw?.participant, raw?.Participant, data?.Participant)),
    var: {
      reviewType: reviewType == null ? null : String(reviewType),
      outcome: outcome == null ? null : String(outcome),
    },
    raw,
  };
}

export function mapVarKind(reviewType) {
  const value = String(reviewType || '').toLowerCase();
  if (value === 'goal') return 'goal_review';
  if (value === 'penalty') return 'penalty_review';
  if (value === 'redcard') return 'red_card_review';
  if (value === 'secondyellowcard') return 'second_yellow_review';
  if (value === 'cornerkick') return 'corner_review';
  if (value === 'mistakenidentity') return 'identity_review';
  return 'var_review';
}

function reviewCopy(reviewType) {
  const labels = {
    Goal: ['Goal under review', 'Will the goal stand?'],
    Penalty: ['Penalty under review', 'Will the penalty decision stand?'],
    RedCard: ['Red card under review', 'Will the red card stand?'],
    SecondYellowCard: ['Second yellow under review', 'Will the second yellow stand?'],
    CornerKick: ['Corner decision under review', 'Will the corner decision stand?'],
    MistakenIdentity: ['Player identity under review', 'Will the original decision stand?'],
  };
  return labels[reviewType] || ['Decision under review', 'What will the official call be?'];
}

function parseSseBlock(block) {
  const message = { id: null, event: 'message', data: '', retry: null };
  for (const rawLine of block.split(/\r?\n/)) {
    if (!rawLine || rawLine.startsWith(':')) continue;
    const colon = rawLine.indexOf(':');
    const field = colon === -1 ? rawLine : rawLine.slice(0, colon);
    let value = colon === -1 ? '' : rawLine.slice(colon + 1);
    if (value.startsWith(' ')) value = value.slice(1);
    if (field === 'data') message.data += `${value}\n`;
    if (field === 'event') message.event = value;
    if (field === 'id') message.id = value;
    if (field === 'retry') message.retry = asNumber(value);
  }
  message.data = message.data.replace(/\n$/, '');
  return message;
}

async function* readSse(response, signal) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('TxLINE stream response has no readable body.');
  const decoder = new TextDecoder();
  let buffer = '';

  while (!signal.aborted) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let match = buffer.match(/\r?\n\r?\n/);
    while (match?.index !== undefined) {
      const block = buffer.slice(0, match.index);
      buffer = buffer.slice(match.index + match[0].length);
      if (block.trim()) yield parseSseBlock(block);
      match = buffer.match(/\r?\n\r?\n/);
    }
  }
}

/**
 * Production TxLINE adapter. It stays dormant unless explicitly selected by
 * the server because the hackathon credentials belong on the server only.
 *
 * Important proof boundary: this adapter settles jury calls from authenticated
 * off-chain `var_end` events. TxLINE's public on-chain method proves resulting
 * numeric score/card stats, not the VAR action or its Stands/Overturned value.
 */
export class TxLineSseAdapter {
  constructor({
    baseUrl = 'https://txline.txodds.com',
    jwt,
    apiToken,
    fixtureId = null,
    voteWindowMs = 15_000,
    fetchFn = fetch,
    now = Date.now,
  }) {
    if (!jwt || !apiToken) throw new Error('TxLINE JWT and activated API token are required.');
    this.baseUrl = baseUrl.replace(/\/$/, '');
    this.jwt = jwt;
    this.apiToken = apiToken;
    this.fixtureId = fixtureId;
    this.voteWindowMs = voteWindowMs;
    this.fetchFn = fetchFn;
    this.now = now;
    this.generation = 0;
    this.sink = null;
    this.controller = null;
    this.lastEventId = null;
    this.retryMs = 1_000;
    this.processed = new Set();
    this.actions = new Map();
    this.activeReviewByFixture = new Map();
    this.startedAt = null;
  }

  start(sink) {
    if (sink) this.sink = sink;
    if (!this.sink?.onEvent || !this.sink?.onClock || !this.sink?.onEnd) {
      throw new TypeError('A feed sink with onEvent, onClock and onEnd is required.');
    }
    this.stop();
    this.generation += 1;
    this.startedAt = this.now();
    const controller = new AbortController();
    this.controller = controller;
    this.#connectLoop(controller.signal).catch((error) => {
      if (!controller.signal.aborted) this.sink.onEnd({
        generation: this.generation,
        status: 'degraded',
        error: error.message,
      });
    });
    return this.generation;
  }

  restart() {
    this.processed.clear();
    this.actions.clear();
    this.activeReviewByFixture.clear();
    this.lastEventId = null;
    return this.start();
  }

  stop() {
    this.controller?.abort();
    this.controller = null;
  }

  async #connectLoop(signal) {
    while (!signal.aborted) {
      try {
        const query = this.fixtureId == null ? '' : `?fixtureId=${encodeURIComponent(this.fixtureId)}`;
        const headers = {
          Authorization: `Bearer ${this.jwt}`,
          'X-Api-Token': this.apiToken,
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        };
        if (this.lastEventId) headers['Last-Event-ID'] = this.lastEventId;

        const response = await this.fetchFn(`${this.baseUrl}/api/scores/stream${query}`, {
          headers,
          signal,
        });
        if (response.status === 401) throw new Error('TxLINE JWT expired; refresh it on the same network host.');
        if (response.status === 403) throw new Error('TxLINE subscription is invalid, expired, or on the wrong network.');
        if (!response.ok) throw new Error(`TxLINE stream failed with ${response.status}.`);

        for await (const message of readSse(response, signal)) {
          if (message.retry) this.retryMs = Math.max(250, message.retry);
          if (message.event === 'heartbeat') {
            this.#emitClock('playing');
            continue;
          }
          if (!message.data) continue;
          let raw;
          try { raw = JSON.parse(message.data); } catch { continue; }
          const record = normaliseTxLineRecord(raw, message.id);
          if (!record) continue;
          this.#handleRecord(record);
          if (message.id) this.lastEventId = message.id;
        }
      } catch (error) {
        if (signal.aborted) break;
        if (/401|403|expired|wrong network/i.test(error.message)) throw error;
        const jitter = Math.round(Math.random() * Math.min(750, this.retryMs / 2));
        await sleep(this.retryMs + jitter, signal);
        this.retryMs = Math.min(15_000, this.retryMs * 2);
      }
    }
  }

  #handleRecord(record) {
    const dedupKey = `${record.fixtureId}:${record.seq}`;
    if (this.processed.has(dedupKey)) return;
    this.processed.add(dedupKey);
    if (this.processed.size > 20_000) this.processed.clear();

    const actionKey = `${record.fixtureId}:${record.actionId ?? record.seq}`;
    this.actions.set(actionKey, record);
    this.#emitClock('playing', record);

    if (record.action === 'action_discarded') {
      const targetId = record.actionId
        ?? asNumber(first(record.raw?.Data?.Id, record.raw?.dataSoccer?.Id));
      const active = this.activeReviewByFixture.get(record.fixtureId);
      if (active?.actionId === targetId) this.activeReviewByFixture.delete(record.fixtureId);
      return;
    }

    if (record.action === 'var') {
      if (this.activeReviewByFixture.has(record.fixtureId)) return;
      const callId = `txline:${record.fixtureId}:var:${record.actionId ?? record.seq}`;
      this.activeReviewByFixture.set(record.fixtureId, { callId, actionId: record.actionId });
      const [detail, title] = reviewCopy(record.var.reviewType);
      this.sink.onEvent({
        ...normalizedEvent({
          id: `${dedupKey}:open`,
          type: FeedEventType.BIG_CALL_OPENED,
          offsetMs: Math.max(0, record.receivedAtMs - this.startedAt),
          payload: {
            callId,
            kind: mapVarKind(record.var.reviewType),
            title,
            detail,
            minute: record.minute,
            windowMs: this.voteWindowMs,
            source: { fixtureId: record.fixtureId, seq: record.seq, sseId: record.sseId },
          },
        }),
        generation: this.generation,
      });
      return;
    }

    if (record.action === 'var_end' && record.confirmed === true) {
      const active = this.activeReviewByFixture.get(record.fixtureId);
      const result = String(record.var.outcome || '').toLowerCase();
      if (!active || !['stands', 'overturned'].includes(result)) return;
      this.activeReviewByFixture.delete(record.fixtureId);
      this.sink.onEvent({
        ...normalizedEvent({
          id: `${dedupKey}:resolve`,
          type: FeedEventType.BIG_CALL_RESOLVED,
          offsetMs: Math.max(0, record.receivedAtMs - this.startedAt),
          payload: {
            callId: active.callId,
            result,
            minute: record.minute,
            message: `Official decision: ${result}.`,
            source: { fixtureId: record.fixtureId, seq: record.seq, sseId: record.sseId },
          },
        }),
        generation: this.generation,
      });
    }
  }

  #emitClock(status, record = null) {
    const elapsedMs = Math.max(0, this.now() - this.startedAt);
    this.sink.onClock({
      generation: this.generation,
      status,
      startedAt: this.startedAt,
      elapsedMs,
      durationMs: null,
      progress: 0,
      minute: record?.minute ?? null,
      matchClock: record?.minute == null ? 'LIVE' : `${record.minute}′`,
    });
  }
}
