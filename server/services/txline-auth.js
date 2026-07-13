const normaliseBaseUrl = (baseUrl) => String(baseUrl || 'https://txline-dev.txodds.com').replace(/\/$/, '');

/**
 * Starts an anonymous TxLINE guest session. The returned JWT is intentionally
 * kept server-side and can be replaced whenever a previous guest session
 * expires; the activated API token remains the durable subscription secret.
 */
export async function createTxLineGuestJwt({
  baseUrl = 'https://txline-dev.txodds.com',
  fetchFn = fetch,
} = {}) {
  const response = await fetchFn(`${normaliseBaseUrl(baseUrl)}/auth/guest/start`, {
    method: 'POST',
    headers: { Accept: 'application/json' },
  });
  if (!response.ok) throw new Error(`TxLINE guest session failed with ${response.status}.`);
  const payload = await response.json();
  const token = typeof payload === 'string' ? payload : payload?.token;
  if (typeof token !== 'string' || token.trim() === '') {
    throw new Error('TxLINE guest session did not return a JWT.');
  }
  return token;
}

export { normaliseBaseUrl };
