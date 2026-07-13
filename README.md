# THE CALL

THE CALL is a realtime football fan-jury contest app. Players use **non-cash Demo Credits (DC)** to enter public or private rooms, predict whether controversial referee decisions will **stand** or be **overturned**, and climb a shared live leaderboard.

The MVP combines a fantasy-contest-style lobby with the existing server-authoritative fan jury: featured public contests, private invite codes, entry confirmation, Demo Credit wallets, capacity limits, a server-owned entry window, waiting rooms, live ranks, tie-safe payout ladders, and simulated rewards. A deterministic two-minute replay supplies four Big Calls for local demos.

> Demo Credits are non-cash test points. The optional top-up rail accepts Devnet SOL only, verifies the transfer on-chain, and credits Demo Credits; points cannot be withdrawn, exchanged, or redeemed. Mainnet payments are not enabled.

## Run it

```bash
npm install
npm run dev
```

- Web: `http://localhost:5173`
- Match desk: `http://localhost:3001`
- Health: `http://localhost:3001/api/health`

For a production-style local run:

```bash
npm run build
npm start
```

The Express server automatically serves `dist/`. Run `npm run check` for the backend tests and frontend production build.

## Fast demo

1. Open the app, connect a Solana wallet on Devnet, and enter the jury. A new demo account receives 1,000 DC for free.
2. Pick a featured public contest and review the exact entry deduction before confirming.
3. Enter its live jury, then choose **Stands** or **Overturned** before each server-controlled voting window closes.
4. Watch the official verdict, score, streak, shared rank, provisional reward, history, and reputation root update.
5. Return to the lobby and use **Private → Create private room** to choose a name, player cap, and DC entry. Share the generated invite code with another player; its flexible pool grows only from entries actually collected.

The first entry opens one match-wide 20-second demo enrollment window (`CONTEST_ENTRY_WINDOW_MS` is configurable). Every contest locks on that same deadline. Members can enter a waiting room immediately, but no replay starts before the shared match epoch; a room opened later seeks to the current authoritative match position instead of replaying known calls from zero. Public pools are explicitly demo-treasury guaranteed; private pools are backed only by their collected DC entries.

Contest balances and sessions are in memory for this MVP, so restarting the server resets them. The five seeded demo jurors are visibly labelled and never consume contest capacity, rank, or rewards.

## Architecture

```text
TxLINE SSE / scripted replay
            │
            ▼
      feed adapter boundary
            │ stable event IDs
            ▼
  RoomSession (authoritative clock,
  votes, settlement, scores, streaks)
            │
            ├── ContestManager (sessions, DC ledger,
            │   public/private rooms, ranks, rewards)
            │ Socket.IO
            ▼
  React contest lobby + fan-jury UI
            │
            └── SHA-256 reputation commitment
                (ready for a future devnet publisher)
```

- `src/` — React UI and Socket.IO client.
- `src/ContestLobby.jsx` — public/private lobby, entry confirmation, invite flow, and mobile contest navigation.
- `server/index.js` — Express, Socket.IO, health endpoints, and static serving.
- `server/domain/contest-manager.js` — demo sessions, credit ledger, contest membership, capacity, ranks, and idempotent simulated settlement.
- `server/domain/room-session.js` — gameplay state machine and idempotency.
- `server/adapters/scripted-replay-adapter.js` — deterministic judging/demo feed.
- `server/adapters/txline-sse-adapter.js` — server-side SSE normalization, resume cursor, deduplication, confirmed VAR settlement, and reconnect behavior.
- `server/domain/reputation-checkpoint.js` — stable commitment over calls and participant results.

## Socket contract

Client events:

- `contest:session` — `{ nickname, participantId?, resumeToken? }`
- `contest:list` — `{ participantId?, resumeToken? }`
- `contest:lookup` — `{ inviteCode, participantId?, resumeToken? }`
- `contest:create` — `{ name, entryCredits, capacity, nickname?, participantId?, resumeToken? }`
- `contest:join` — `{ contestId?, inviteCode?, nickname?, participantId?, resumeToken? }`
- `room:join` — `{ roomCode, nickname, participantId?, resumeToken? }`
- `vote:cast` — `{ callId, choice: "stands" | "overturned" }`
- `replay:restart` — `{ offsetMs? }`

Server events:

- `contest:updated`
- `room:state`
- `call:opened`
- `call:settled`
- `match:ended`
- `replay:restarted`

Contest-linked rooms require contest membership and do not allow participant replay restarts. Entry debit plus seat reservation is atomic and idempotent. Room playback is deferred until the authoritative entry deadline. Votes are immutable and checked against wall-clock cutoff time even between replay ticks. Live crowd choices and counts are withheld until a call settles.

Equal contest scores share rank and split the occupied payout positions; response speed and join time never break a reward tie. Simulated rewards credit exactly once after full time. See `server/README.md` for acknowledgement shapes, validation errors, and the full contest contract.

## Production boundary

This is a non-cash prototype, not a production wagering system. The Solana rail is Devnet-only and only tops up non-redeemable Demo Credits. Enabling mainnet or money entry would require a jurisdiction-specific legal determination plus age and identity checks, geofencing, payments and tax controls, responsible-play safeguards, fraud controls, persistent auditable ledgers, operator tooling, and real match-feed administration.

## TxLINE integration boundary

The production adapter expects the scores SSE endpoint with both server-side credentials:

```http
GET /api/scores/stream?fixtureId=...
Authorization: Bearer <guest-jwt>
X-Api-Token: <activated-api-token>
Last-Event-ID: <optional-resume-cursor>
```

It deduplicates deliveries by `fixtureId:seq`, preserves the SSE cursor, handles heartbeats and reconnects, opens calls from `var`, settles only a confirmed `var_end` containing `Stands` or `Overturned`, and finalises a room from TxLINE's `game_finalised` marker (`statusId=100`, `period=100`). The server selects this adapter automatically when `TXLINE_GUEST_JWT`, `TXLINE_API_TOKEN`, and `TXLINE_FIXTURE_ID` are all present; otherwise it uses the deterministic demo replay. Keep those credentials on the server.

Mainnet free service level `1` is documented as 60 seconds delayed; a 15-second live jury requires real-time level `12` or a verified zero-delay devnet service row.

## Proof boundary

The UI intentionally does **not** claim that a VAR decision is verified on Solana. TxLINE's public stat-validation flow proves numeric score/card/corner state, not the `var_end` outcome or causal relationship between VAR and that state.

The MVP therefore:

- settles the jury from the authenticated off-chain `var_end` message;
- can later attach a separate proof of the resulting numeric match statistic;
- generates a deterministic local reputation root after every settlement;
- labels that root **devnet pending** until a real program and scoped signer publish it.

This avoids presenting a local hash or simulated transaction as an on-chain fact.
