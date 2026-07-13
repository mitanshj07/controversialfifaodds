# Hackathon launch checklist

THE CALL is ready to run in demo mode immediately. To show real World Cup and
International Friendlies fixtures, activate the TxLINE World Cup Free Tier on
Solana **Devnet** and add the resulting credentials to Render.

## 1. Activate the free tier

Follow TxLINE's [World Cup Free Tier guide](https://txline-docs.txodds.com/documentation/worldcup)
or use its [runnable Devnet examples](https://txline-docs.txodds.com/documentation/examples/devnet-examples).

Use one network for every step:

```text
Network:    Solana Devnet
RPC:        https://api.devnet.solana.com
API host:   https://txline-dev.txodds.com
Program ID: 6pW64gN1s2uqjHkn1unFeEjAwJkPGHoppGvS715wyP2J
Service:    level 1, 4 weeks, leagues: []
```

The tier has no TxL subscription payment, but the wallet needs Devnet SOL for
the subscription transaction's network fees and possible account rent.

## 2. Obtain the two API credentials

1. Submit the on-chain `subscribe(1, 4)` transaction and retain `txSig`.
2. `POST /auth/guest/start` on the Devnet API host to receive the guest JWT.
3. With the same wallet that submitted `txSig`, sign exactly
   `${txSig}::${jwt}` for the standard `leagues: []` bundle.
4. Send the detached signature (base64) to `POST /api/token/activate` with the
   guest JWT in the `Authorization` header.
5. The response token is the activated API token.

The fixture snapshot and score stream require both headers. Refer to the
[authentication](https://txline-docs.txodds.com/api-reference/authentication/start-a-new-guest-session)
and [troubleshooting](https://txline-docs.txodds.com/documentation/examples/troubleshooting)
pages if activation fails.

## 3. Add secrets to Render

Open the `controversialfifaodds` Render service, choose **Environment**, and
set these server-only values:

```env
TXLINE_BASE_URL=https://txline-dev.txodds.com
TXLINE_GUEST_JWT=<guest JWT>
TXLINE_API_TOKEN=<activated API token>
TXLINE_FIXTURE_ID=<a FixtureId returned by the snapshot>
```

`TXLINE_GUEST_JWT` and `TXLINE_API_TOKEN` populate the upcoming/live fixture
board. `TXLINE_FIXTURE_ID` additionally selects the fixture whose score stream
drives the live jury room. Never put these values in Vercel, the browser, a
commit, or a public hackathon submission.

## 4. Verify before a demo

After Render redeploys, confirm:

```bash
curl https://controversialfifaodds.onrender.com/api/health
curl https://controversialfifaodds.onrender.com/api/live-matches
```

Health should show `txline.fixtureDiscoveryConfigured: true` and
`txline.streamConfigured: true`. The fixtures endpoint should include scheduled
World Cup/International Friendlies cards. The app's **Live Matches** panel
offers **All**, **Upcoming**, and **Live Now** views.

## Demo fallback

If credentials have not been activated yet, the app deliberately remains in its
non-cash scripted demo mode. The full-time settlement, results modal, public
and private jury rooms, and Devnet Demo Credit flow remain available for a
reliable judging presentation.
