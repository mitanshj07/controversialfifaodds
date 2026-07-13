import { FeedEventType, normalizedEvent } from './adapters/feed-adapter.js';

export const DEMO_MATCH = Object.freeze({
  id: 'demo-aurora-metro-2026',
  competition: 'Continental Cup',
  venue: 'Northbank Stadium',
  home: Object.freeze({ name: 'Aurora FC', code: 'AUR' }),
  away: Object.freeze({ name: 'Metro United', code: 'MET' }),
  durationMs: 120_000,
});

export const DEMO_JURORS = Object.freeze([
  Object.freeze({ id: 'bot_nia', nickname: 'NorthStand Nia', choices: ['stands', 'overturned', 'stands', 'overturned'] }),
  Object.freeze({ id: 'bot_priya', nickname: 'Pressing Priya', choices: ['stands', 'overturned', 'overturned', 'overturned'] }),
  Object.freeze({ id: 'bot_hugo', nickname: 'HalfSpace Hugo', choices: ['overturned', 'stands', 'stands', 'overturned'] }),
  Object.freeze({ id: 'bot_amina', nickname: 'AwayDays Amina', choices: ['stands', 'overturned', 'stands', 'stands'] }),
  Object.freeze({ id: 'bot_tom', nickname: 'TopBins Tom', choices: ['overturned', 'overturned', 'stands', 'overturned'] }),
]);

const event = (id, type, offsetMs, payload) =>
  normalizedEvent({ id, type, offsetMs, payload });

/**
 * A short, deterministic match designed for a live product demo. Event ids never
 * change between replay generations; the room's generation number supplies the
 * replay boundary used by the idempotency layer.
 */
export const DEMO_EVENTS = Object.freeze([
  event('demo-match-started', FeedEventType.MATCH_STARTED, 0, {
    phase: 'first_half',
    message: 'Kick-off at Northbank Stadium',
  }),
  event('demo-score-aurora-1', FeedEventType.SCORE_CHANGED, 8_000, {
    homeScore: 1,
    awayScore: 0,
    minute: 12,
    message: 'Aurora FC find the net — the assistant keeps the flag down.',
  }),
  event('demo-call-opener', FeedEventType.BIG_CALL_OPENED, 14_000, {
    callId: 'call-opener-offside',
    kind: 'goal_review',
    title: 'Will Aurora’s opener stand?',
    detail: 'VAR is checking a possible offside in the build-up.',
    minute: 13,
    windowMs: 11_000,
  }),
  event('demo-call-opener-result', FeedEventType.BIG_CALL_RESOLVED, 25_000, {
    callId: 'call-opener-offside',
    result: 'stands',
    minute: 14,
    message: 'Decision: goal stands.',
  }),
  event('demo-score-metro-1', FeedEventType.SCORE_CHANGED, 34_000, {
    homeScore: 1,
    awayScore: 1,
    minute: 31,
    message: 'Metro United level from a fast break.',
  }),
  event('demo-call-penalty', FeedEventType.BIG_CALL_OPENED, 43_000, {
    callId: 'call-metro-penalty',
    kind: 'penalty_review',
    title: 'Penalty to Metro — will it stand?',
    detail: 'The referee points to the spot, but VAR checks contact at the edge of the area.',
    minute: 39,
    windowMs: 11_000,
  }),
  event('demo-call-penalty-result', FeedEventType.BIG_CALL_RESOLVED, 54_000, {
    callId: 'call-metro-penalty',
    result: 'overturned',
    minute: 40,
    message: 'Decision overturned: no penalty.',
  }),
  event('demo-halftime', FeedEventType.PHASE_CHANGED, 60_000, {
    phase: 'halftime',
    minute: 45,
    message: 'Half-time: Aurora FC 1–1 Metro United.',
  }),
  event('demo-second-half', FeedEventType.PHASE_CHANGED, 64_000, {
    phase: 'second_half',
    minute: 46,
    message: 'The second half is under way.',
  }),
  event('demo-call-red', FeedEventType.BIG_CALL_OPENED, 70_000, {
    callId: 'call-aurora-red-card',
    kind: 'red_card_review',
    title: 'Red card shown — will it stand?',
    detail: 'VAR reviews the height and force of Aurora’s midfield challenge.',
    minute: 59,
    windowMs: 11_000,
  }),
  event('demo-call-red-result', FeedEventType.BIG_CALL_RESOLVED, 81_000, {
    callId: 'call-aurora-red-card',
    result: 'stands',
    minute: 60,
    message: 'Decision confirmed: Aurora are down to ten.',
  }),
  event('demo-score-aurora-2', FeedEventType.SCORE_CHANGED, 91_000, {
    homeScore: 2,
    awayScore: 1,
    minute: 76,
    message: 'Ten-player Aurora score from a corner.',
  }),
  event('demo-call-winner', FeedEventType.BIG_CALL_OPENED, 97_000, {
    callId: 'call-winner-handball',
    kind: 'goal_review',
    title: 'Late winner under review',
    detail: 'VAR checks a possible handball immediately before Aurora’s finish.',
    minute: 78,
    windowMs: 11_000,
  }),
  event('demo-call-winner-result', FeedEventType.BIG_CALL_RESOLVED, 108_000, {
    callId: 'call-winner-handball',
    result: 'overturned',
    minute: 79,
    message: 'Decision overturned: the goal is disallowed.',
  }),
  event('demo-score-correction', FeedEventType.SCORE_CHANGED, 109_000, {
    homeScore: 1,
    awayScore: 1,
    minute: 79,
    message: 'The score returns to 1–1.',
  }),
  event('demo-match-ended', FeedEventType.MATCH_ENDED, 120_000, {
    phase: 'full_time',
    minute: 90,
    homeScore: 1,
    awayScore: 1,
    statusId: 100,
    period: 100,
    outcome: 'draw',
    message: 'Full-time: Aurora FC 1–1 Metro United.',
  }),
]);
