# THE CALL match desk

`server/index.js` runs an Express + Socket.IO server on port `3001`. Every room owns a server-authoritative 120-second scripted replay. Set `REPLAY_SPEED` from `0.25` to `8` to accelerate it. Contest rooms wait for their authoritative entry deadline before starting; `CONTEST_ENTRY_WINDOW_MS` defaults to 20,000 ms.

Socket events:

- `contest:session` `{ nickname, participantId?, resumeToken? }`
- `contest:list` `{ participantId?, resumeToken? }`
- `contest:lookup` `{ inviteCode, participantId?, resumeToken? }`
- `contest:create` `{ name, entryCredits, capacity, nickname?, participantId?, resumeToken? }`
- `contest:join` `{ contestId?, inviteCode?, nickname?, participantId?, resumeToken? }`
- `room:join` `{ roomCode, nickname, participantId?, resumeToken? }`
- `vote:cast` `{ callId, choice: "stands" | "overturned" }`
- `replay:restart` `{}`
- server broadcasts `contest:updated`, `room:state`, `call:opened`, `call:settled`, and `replay:restarted`

## Contest contract

All balances, entry fees, prize pools, and rewards are **non-cash test credits**.
There is no deposit, withdrawal, payment, token-transfer, or cash-redemption path.
A new `contest:session` starts with 1,000 `TEST_CREDITS`. Unknown saved
credentials return `INVALID_SESSION`; retry with only a nickname to create a
new demo wallet.

Contest acknowledgements use these shapes:

- `contest:session` returns `{ ok, session, wallet, contests }`.
- `contest:list` returns `{ ok, contests, wallet? }`; anonymous calls list only
  public contests, while authenticated calls also list the account's private
  contests and add `membership` to every summary.
- `contest:lookup` returns `{ ok, contest }` and never debits credits. It lets a
  player preview a private contest before confirming entry.
- `contest:create` returns `{ ok, session, wallet, contest, contests }`. The
  creator is atomically joined and charged. Private entry is 10–500 credits,
  capacity is 2–100, and its flexible prize pool is backed only by collected
  entries: `entryCredits * joinedCount`.
- `contest:join` returns `{ ok, session, wallet, contest }`. Joining by private
  id requires its invite code; joining by invite code alone is supported.

`session` is `{ participantId, resumeToken, nickname }`. `wallet` is
`{ participantId, balanceCredits, currency: "TEST_CREDITS", isWithdrawable: false }`.

A contest summary is:

```js
{
  id,
  name,
  visibility: "public" | "private",
  featured,
  roomCode,
  entryCredits,
  prizePoolCredits,
  maxPrizePoolCredits,
  poolType: "guaranteed" | "flexible",
  fundingLabel,
  capacity,
  joinedCount,
  status: "open" | "locked" | "live" | "completed",
  entryClosesAt,
  currency: "TEST_CREDITS",
  isCash: false,
  withdrawalsEnabled: false,
  payoutLadder: [{ rankFrom, rankTo, rewardCredits }],
  match,
  membership?: {
    joined,
    joinedAt?,
    rank?,
    score?,
    projectedRewardCredits?,
    rewardCredits?
  },
  inviteCode? // private members only
}
```

Public featured contests use a prize pool guaranteed by the demo treasury;
their current and maximum pool values are the advertised guaranteed amount.
Private contests use a flexible, player-funded test-credit pool.
`maxPrizePoolCredits` is `entryCredits * capacity`, while
`prizePoolCredits` and the payout ladder are recomputed after every successful
entry from credits actually collected. A solo private entrant can therefore
receive at most their own entry credits, never the unfilled maximum pool.

The first successful paid entry in **any contest for the match** (including a
private creator's automatic entry) creates the one match-wide deadline:
`entryClosesAt = serverNow + entryWindowMs`. Every existing contest receives
that timestamp, and any private contest created during the remaining window
inherits it rather than opening a fresh countdown. Entries are accepted only
while status is `open` and server time is strictly before the shared deadline.
At or after it they fail with `ENTRY_CLOSED`; once any room reports the match as
started/live/completed, every untouched contest is also locked. This prevents a
player from watching one contest's replay and then entering another contest for
the same match.

Paid members may enter their linked jury rooms during the window, but every
room replay remains `waiting` until the shared deadline. Room snapshots expose
that epoch as `replay.scheduledStartAt` while waiting and
`replay.matchStartedAt` after start. If a paid member first opens a room after
the deadline, its independent scripted adapter seeks to
`(serverNow - entryClosesAt) * playbackRate` rather than starting at offset 0.
Rooms opened early and late therefore observe the same authoritative match
clock, while the entry gate and private flexible-pool rules remain shared.

After joining, enter `contest.roomCode` through the existing `room:join` event
with the returned contest session. Contest-linked rooms reject non-members.
Their personalized `room:state` adds `contest`, adds `you.wallet`, and marks
each jury participant with `contestEligible`. Demo jurors remain useful visual
crowd members but never consume contest capacity and never receive contest
ranks or rewards.

During an open or locked call, aggregate vote counts, other participants'
`hasVoted` flags, and live vote activity are withheld. The viewer's own vote
remains in `you.vote`. Those crowd signals become visible after settlement.
Contest members cannot restart a replay; the match desk owns the contest feed.

Call settlements refresh projected rank and reward. Equal scores share the
same rank and the same averaged reward across their occupied payout positions,
so join time and response speed never break a tie. At full time, simulated
rewards are credited once using an idempotent match-generation settlement key.

Expected contest errors include `INVALID_SESSION`, `INVALID_INVITE_CODE`,
`CONTEST_NOT_FOUND`, `ALREADY_JOINED`, `CONTEST_FULL`,
`INSUFFICIENT_CREDITS`, `ENTRY_CLOSED`, `CONTEST_MEMBERSHIP_REQUIRED`, and
`RESTART_NOT_ALLOWED`. Errors retain the common `{ ok: false, code, error }`
shape.

Join acknowledgements return `{ ok, session: { participantId, resumeToken, nickname, roomCode }, state }`. Save the session fields to resume after reconnecting. Vote and restart acknowledgements also include the caller's latest personalized state.

The public state contains `roomCode`, `match`, `replay`, `participants`, `activeCall`, `history`, and `activity`. Personalized states add `you` and the viewer's `participants[].vote`. Call timestamps are absolute epoch milliseconds; `openedAtElapsedMs` and `closesAtElapsedMs` retain deterministic replay offsets.

The adapter boundary is in `adapters/feed-adapter.js`. A TxLINE SSE implementation should emit stable normalized event ids and the documented event types; `RoomSession` handles retries idempotently within each replay generation.

Health is available at `/health` and `/api/health`. A built frontend in `dist/` is served automatically.
Public contest discovery is also available over `GET /api/contests`; optional
`participantId` and `resumeToken` query parameters personalize the response.
