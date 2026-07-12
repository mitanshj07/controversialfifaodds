import assert from 'node:assert/strict';
import test from 'node:test';
import {
  normalizeTxOddsFixture,
  parseTxOddsFixtures,
  TxOddsLiveService,
} from './txodds-live-service.js';

test('normalizes JSON TxOdds fixtures into the live-match contract', () => {
  const [fixture] = parseTxOddsFixtures(JSON.stringify({ fixtures: [{
    fixtureId: 42,
    homeTeam: { name: 'Aurora FC' },
    awayTeam: { name: 'Metro United' },
    league: 'Continental Cup',
    status: 'in_play',
    minute: 63,
    score: { home: 2, away: 1 },
  }] }));
  assert.deepEqual(fixture, {
    id: '42',
    home: 'Aurora FC',
    away: 'Metro United',
    competition: 'Continental Cup',
    startTime: null,
    status: 'live',
    live: true,
    minute: 63,
    homeScore: 2,
    awayScore: 1,
  });
});

test('parses the legacy TxOdds XML fixture response', () => {
  const xml = '<Fixtures><Match ID="99" Live="true" MatchTime="2026-07-13T18:00:00Z"><Home>Northport</Home><Away>Sierra Republic</Away><League>Demo Cup</League></Match></Fixtures>';
  const [fixture] = parseTxOddsFixtures(xml, { contentType: 'application/xml' });
  assert.equal(fixture.id, '99');
  assert.equal(fixture.home, 'Northport');
  assert.equal(fixture.away, 'Sierra Republic');
  assert.equal(fixture.competition, 'Demo Cup');
  assert.equal(fixture.live, true);
  assert.equal(fixture.status, 'live');
});

test('keeps a scheduled TxOdds XML fixture out of the live state', () => {
  const [fixture] = parseTxOddsFixtures('<Fixtures><Match ID="100" Live="false"><Home>A</Home><Away>B</Away></Match></Fixtures>', { contentType: 'application/xml' });
  assert.equal(fixture.status, 'scheduled');
  assert.equal(fixture.live, false);
});

test('returns an honest unconfigured state without fabricating fixtures', async () => {
  const service = new TxOddsLiveService({ fixturesUrl: '' });
  const result = await service.list();
  assert.equal(result.configured, false);
  assert.deepEqual(result.matches, []);
  assert.match(result.message, /TXODDS_FIXTURES_URL/);
});

test('caches a successful fixture response and sends credentials server-side', async () => {
  const requests = [];
  const service = new TxOddsLiveService({
    fixturesUrl: 'https://fixtures.example.test/live?Live=1',
    userId: 'demo-user',
    password: 'demo-password',
    jwt: 'guest-jwt',
    apiToken: 'api-token',
    fetchFn: async (url, options) => {
      requests.push({ url: String(url), options });
      return {
        ok: true,
        headers: { get: () => 'application/json' },
        text: async () => JSON.stringify([{ id: '1', home: 'A', away: 'B' }]),
      };
    },
  });
  const first = await service.list();
  const second = await service.list();
  assert.equal(first.matches[0].home, 'A');
  assert.equal(second.matches[0].id, '1');
  assert.equal(requests.length, 1);
  assert.match(requests[0].url, /UserID=demo-user/);
  assert.equal(requests[0].options.headers.Authorization, 'Bearer guest-jwt');
  assert.equal(requests[0].options.headers['X-Api-Token'], 'api-token');
});

test('drops malformed fixtures instead of rendering blank match cards', () => {
  assert.equal(normalizeTxOddsFixture({ id: 'broken', home: 'Only Home' }), null);
});
