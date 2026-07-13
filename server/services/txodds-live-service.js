const first = (...values) => values.find((value) => value !== undefined && value !== null && value !== '');

const asText = (value) => String(value ?? '').trim();

const decodeXml = (value) => asText(value)
  .replace(/&amp;/g, '&')
  .replace(/&lt;/g, '<')
  .replace(/&gt;/g, '>')
  .replace(/&quot;/g, '"')
  .replace(/&#39;/g, "'");

const asNumber = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

const asScore = (value) => {
  if (value && typeof value === 'object') return asNumber(first(value.score, value.goals, value.value));
  return asNumber(value);
};

const teamName = (value) => {
  if (value && typeof value === 'object') return asText(first(value.name, value.teamName, value.title, value.value));
  return asText(value);
};

const statusFromGameState = (value) => {
  const text = asText(value).toLowerCase();
  const numeric = Number(value);
  if (numeric === 1 || text === 'ns' || text.includes('scheduled')) return 'scheduled';
  // Current fixture snapshots use 6 for a cancelled fixture. Score-feed phase
  // values are handled separately by the TxLINE SSE adapter.
  if (numeric === 6 || text === 'c' || text.includes('cancel')) return 'cancelled';
  if ([2, 3, 4, 7, 8, 9, 12, 14].includes(numeric) || ['h1', 'ht', 'h2', 'et1', 'htet', 'et2', 'pe'].includes(text)) return 'live';
  if ([5, 10, 13].includes(numeric) || ['f', 'fet', 'fpe', 'ft', 'final', 'completed'].includes(text)) return 'completed';
  return '';
};

const pickArray = (payload) => {
  if (Array.isArray(payload)) return payload;
  return payload?.fixtures || payload?.matches || payload?.events || payload?.data || payload?.results || [];
};

const valueFromTags = (body, tag) => {
  const match = body.match(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  return match ? decodeXml(match[1].replace(/<[^>]+>/g, '')) : '';
};

const attributes = (value) => Object.fromEntries(
  [...value.matchAll(/([A-Za-z][A-Za-z0-9_-]*)=(?:"([^"]*)"|'([^']*)')/g)]
    .map((match) => [match[1].toLowerCase(), decodeXml(match[2] ?? match[3])]),
);

export function parseTxOddsXml(xml) {
  const matches = [];
  const pattern = /<Match\b([^>]*?)(?:\/>|>([\s\S]*?)<\/Match>)/gi;
  for (const match of xml.matchAll(pattern)) {
    const attrs = attributes(match[1] || '');
    const body = match[2] || '';
    matches.push({
      id: first(attrs.id, attrs.fixtureid, attrs.matchid),
      home: valueFromTags(body, 'Home'),
      away: valueFromTags(body, 'Away'),
      competition: valueFromTags(body, 'League') || valueFromTags(body, 'Competition'),
      startTime: first(attrs.matchtime, valueFromTags(body, 'MatchTime')),
      status: first(attrs.status, attrs.live === 'true' ? 'live' : attrs.live === 'false' ? 'scheduled' : '', valueFromTags(body, 'Status')),
      homeScore: asScore(first(attrs.homescore, valueFromTags(body, 'HomeScore'))),
      awayScore: asScore(first(attrs.awayscore, valueFromTags(body, 'AwayScore'))),
      minute: asNumber(first(attrs.minute, valueFromTags(body, 'Minute'))),
    });
  }
  return matches;
}

const normalizeStatus = (value, assumeLive) => {
  const status = asText(value).toLowerCase();
  const gameStateStatus = statusFromGameState(value);
  if (gameStateStatus) return gameStateStatus;
  if (status.includes('finish') || status === 'ft' || status.includes('ended')) return 'completed';
  if (status.includes('live') || status.includes('playing') || status.includes('running') || status.includes('inplay') || status.includes('in_play')) return 'live';
  if (assumeLive && !status) return 'live';
  return status || 'scheduled';
};

export function normalizeTxOddsFixture(raw, { assumeLive = true } = {}) {
  const nested = raw?.fixture || raw?.match || raw?.event || {};
  const participant1 = first(raw?.Participant1, raw?.participant1, nested?.Participant1, nested?.participant1);
  const participant2 = first(raw?.Participant2, raw?.participant2, nested?.Participant2, nested?.participant2);
  const participant1IsHome = first(raw?.Participant1IsHome, raw?.participant1IsHome, nested?.Participant1IsHome, nested?.participant1IsHome);
  const homeValue = participant1IsHome === false || participant1IsHome === 'false'
    ? participant2
    : participant1IsHome === true || participant1IsHome === 'true'
      ? participant1
      : first(raw?.home, raw?.homeTeam, raw?.Home, nested?.home, nested?.homeTeam, nested?.Home, participant1);
  const awayValue = participant1IsHome === false || participant1IsHome === 'false'
    ? participant1
    : participant1IsHome === true || participant1IsHome === 'true'
      ? participant2
      : first(raw?.away, raw?.awayTeam, raw?.Away, nested?.away, nested?.awayTeam, nested?.Away, participant2);
  const status = normalizeStatus(
    first(raw?.status, raw?.state, raw?.matchStatus, nested?.status, raw?.gameState, raw?.GameState),
    assumeLive,
  );
  const id = first(raw?.id, raw?.fixtureId, raw?.fixtureID, raw?.FixtureId, raw?.ID, raw?.matchId, nested?.id, nested?.fixtureId);
  const home = teamName(homeValue);
  const away = teamName(awayValue);
  if (!id || !home || !away) return null;
  return {
    id: String(id),
    home,
    away,
    competition: asText(first(raw?.competition, raw?.competitionName, raw?.Competition, raw?.CompetitionName, raw?.league, raw?.League, nested?.competition, nested?.league)),
    startTime: first(raw?.startTime, raw?.StartTime, raw?.matchTime, raw?.kickoff, raw?.MatchTime, nested?.startTime, nested?.matchTime) || null,
    status,
    live: status === 'live',
    minute: asNumber(first(raw?.minute, raw?.Minute, raw?.clock, raw?.elapsed, nested?.minute)),
    homeScore: asScore(first(raw?.homeScore, raw?.HomeScore, raw?.ScoreH, raw?.score?.home, raw?.homeGoals, nested?.homeScore)),
    awayScore: asScore(first(raw?.awayScore, raw?.AwayScore, raw?.ScoreA, raw?.score?.away, raw?.awayGoals, nested?.awayScore)),
  };
}

export function parseTxOddsFixtures(payload, { contentType = '', assumeLive = true } = {}) {
  const isXml = contentType.includes('xml') || (typeof payload === 'string' && payload.trim().startsWith('<'));
  const rawFixtures = isXml
    ? parseTxOddsXml(payload)
    : pickArray(typeof payload === 'string' ? JSON.parse(payload) : payload);
  return rawFixtures.map((fixture) => normalizeTxOddsFixture(fixture, { assumeLive })).filter(Boolean);
}

export class TxOddsLiveService {
  constructor({
    fixturesUrl = process.env.TXODDS_FIXTURES_URL || '',
    userId = process.env.TXODDS_USER_ID || '',
    password = process.env.TXODDS_PASSWORD || '',
    baseUrl = process.env.TXLINE_BASE_URL || 'https://txline-dev.txodds.com',
    jwt = process.env.TXLINE_GUEST_JWT || '',
    apiToken = process.env.TXLINE_API_TOKEN || '',
    fetchFn = fetch,
    cacheTtlMs = Number(process.env.TXODDS_FIXTURES_CACHE_MS) || 60_000,
    now = Date.now,
  } = {}) {
    this.baseUrl = String(baseUrl || 'https://txline-dev.txodds.com').replace(/\/$/, '');
    this.fixturesUrl = fixturesUrl || (jwt && apiToken
      ? `${this.baseUrl}/api/fixtures/snapshot`
      : '');
    this.userId = userId;
    this.password = password;
    this.jwt = jwt;
    this.apiToken = apiToken;
    this.usesLegacyTxOdds = Boolean(this.fixturesUrl) && !this.fixturesUrl.includes('/api/fixtures/');
    this.provider = this.usesLegacyTxOdds ? 'txodds' : 'txline';
    this.fetchFn = fetchFn;
    this.cacheTtlMs = cacheTtlMs;
    this.now = now;
    this.cache = null;
  }

  get configured() {
    return Boolean(this.fixturesUrl);
  }

  get setup() {
    const fixtureDiscoveryConfigured = Boolean(this.jwt && this.apiToken);
    const missing = this.usesLegacyTxOdds
      ? []
      : [
          ...(this.jwt ? [] : ['TXLINE_GUEST_JWT']),
          ...(this.apiToken ? [] : ['TXLINE_API_TOKEN']),
        ];
    return {
      provider: this.provider,
      mode: this.usesLegacyTxOdds ? 'legacy_txodds' : 'txline',
      baseUrl: this.usesLegacyTxOdds ? null : this.baseUrl,
      fixtureDiscoveryConfigured: this.usesLegacyTxOdds || fixtureDiscoveryConfigured,
      missing,
      activationGuide: 'https://txline-docs.txodds.com/documentation/worldcup',
    };
  }

  async list({ force = false } = {}) {
    if (!this.configured) {
      return {
        provider: this.provider,
        configured: false,
        setup: this.setup,
        matches: [],
        fetchedAt: null,
        message: 'Activate TXLINE and set TXLINE_GUEST_JWT plus TXLINE_API_TOKEN on the server, or configure the legacy TXODDS_FIXTURES_URL.',
      };
    }
    if (!force && this.cache && this.now() - this.cache.fetchedAt < this.cacheTtlMs) return this.cache;

    try {
      const url = new URL(this.fixturesUrl);
      if (this.userId) url.searchParams.set('UserID', this.userId);
      if (this.password) url.searchParams.set('PassID', this.password);
      const headers = { Accept: 'application/json, application/xml, text/xml' };
      if (this.jwt) headers.Authorization = `Bearer ${this.jwt}`;
      if (this.apiToken) headers['X-Api-Token'] = this.apiToken;
      const response = await this.fetchFn(url, { headers });
      if (!response.ok) throw new Error(`TxOdds fixture request failed with ${response.status}.`);
      const contentType = response.headers?.get?.('content-type') || '';
      const body = await response.text();
      const result = {
        provider: this.provider,
        configured: true,
        setup: this.setup,
        matches: parseTxOddsFixtures(body, { contentType, assumeLive: true }),
        fetchedAt: this.now(),
        message: null,
      };
      this.cache = result;
      return result;
    } catch (error) {
      return {
        ...(this.cache || { provider: this.provider, configured: true, setup: this.setup, matches: [], fetchedAt: null }),
        error: error.message,
        message: 'TxOdds is temporarily unavailable; showing the last successful fixture list.',
      };
    }
  }
}
