import assert from 'node:assert/strict';
import test from 'node:test';
import { createTxLineGuestJwt } from './txline-auth.js';

test('creates a guest JWT on the matching TxLINE host without exposing it', async () => {
  const requests = [];
  const token = await createTxLineGuestJwt({
    baseUrl: 'https://txline-dev.txodds.com/',
    fetchFn: async (url, options) => {
      requests.push({ url, options });
      return { ok: true, json: async () => ({ token: 'devnet-guest-jwt' }) };
    },
  });
  assert.equal(token, 'devnet-guest-jwt');
  assert.deepEqual(requests, [{
    url: 'https://txline-dev.txodds.com/auth/guest/start',
    options: { method: 'POST', headers: { Accept: 'application/json' } },
  }]);
});

test('rejects a guest-session response that does not return a token', async () => {
  await assert.rejects(
    createTxLineGuestJwt({ fetchFn: async () => ({ ok: true, json: async () => ({}) }) }),
    /did not return a JWT/,
  );
});
