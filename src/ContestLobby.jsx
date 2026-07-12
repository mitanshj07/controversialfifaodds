import { useEffect, useMemo, useRef, useState } from "react";

export const FALLBACK_CONTESTS = [
  {
    id: "public-mega",
    name: "Matchday Mega Jury",
    description: "Free entry. Every Big Call. One giant room.",
    visibility: "public",
    featured: true,
    entryCredits: 0,
    prizePoolCredits: 2500,
    capacity: 5000,
    joinedCount: 3842,
    status: "joinable",
    sponsor: "Matchday Lab",
    payoutLadder: [{ rankFrom: 1, rankTo: 1, rewardCredits: 750 }],
  },
  {
    id: "public-main",
    name: "The Main Stand",
    description: "Four decisions. Top callers share the pool.",
    visibility: "public",
    featured: true,
    entryCredits: 50,
    prizePoolCredits: 5000,
    capacity: 100,
    joinedCount: 73,
    status: "joinable",
    payoutLadder: [{ rankFrom: 1, rankTo: 1, rewardCredits: 1250 }],
  },
  {
    id: "public-small",
    name: "Five-a-Side Jury",
    description: "A smaller room with a winner-heavy ladder.",
    visibility: "public",
    entryCredits: 25,
    prizePoolCredits: 250,
    capacity: 10,
    joinedCount: 7,
    status: "joinable",
    payoutLadder: [{ rankFrom: 1, rankTo: 1, rewardCredits: 125 }],
  },
];

const credits = (value) => `${Number(value || 0).toLocaleString()} DC`;

function useDialogFocus(open, onClose) {
  const dialogRef = useRef(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    if (!open || !dialogRef.current) return undefined;
    const dialog = dialogRef.current;
    const previousFocus = document.activeElement;
    const focusable = () => [...dialog.querySelectorAll('button:not(:disabled), input:not(:disabled), select:not(:disabled), [href], [tabindex]:not([tabindex="-1"])')];
    focusable()[0]?.focus();

    const onKeyDown = (event) => {
      if (event.key === "Escape") {
        event.preventDefault();
        closeRef.current?.();
        return;
      }
      if (event.key !== "Tab") return;
      const items = focusable();
      if (!items.length) return;
      const first = items[0];
      const last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      previousFocus?.focus?.();
    };
  }, [open]);

  return dialogRef;
}

function LobbyMark() {
  return <span className="lobby-mark" aria-hidden="true"><i />TC</span>;
}

function ContestCard({ contest, onSelect, onEnterLive, now }) {
  const joined = contest.membership?.joined === true || contest.joined === true;
  const full = contest.joinedCount >= contest.capacity;
  const free = Number(contest.entryCredits) === 0;
  const progress = Math.min(100, Math.round((contest.joinedCount / Math.max(1, contest.capacity)) * 100));
  const isLive = contest.status === "live";
  const isCompleted = contest.status === "completed";
  const deadline = contest.entryClosesAt ? new Date(contest.entryClosesAt).getTime() : null;
  const remainingMs = deadline ? Math.max(0, deadline - now) : null;
  const entryClosed = isCompleted || isLive || contest.status === "locked" || (deadline !== null && remainingMs === 0);
  const minutes = remainingMs === null ? null : Math.floor(remainingMs / 60_000);
  const seconds = remainingMs === null ? null : Math.floor((remainingMs % 60_000) / 1000);
  const lockLabel = remainingMs === null
    ? "Entry window opens with first join"
    : remainingMs > 0
      ? `Locks in ${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`
      : "Entry locked";

  let action = free ? "JOIN FREE" : `JOIN FOR ${credits(contest.entryCredits)}`;
  if (full && !joined) action = "CONTEST FULL";
  if (entryClosed && !joined) action = "ENTRY CLOSED";
  if (joined) action = isLive || contest.status === "locked" ? "ENTER LIVE ROOM" : "JOINED ✓ · VIEW ENTRY";
  if (isCompleted) action = "VIEW RESULTS";

  return (
    <article className={`contest-card ${contest.featured ? "is-featured" : ""}`}>
      <div className="contest-card-head">
        <span className={`mode-label ${free ? "is-sponsored" : ""}`}>
          {free ? "FREE · SPONSOR-FUNDED" : `${contest.visibility?.toUpperCase() || "PUBLIC"} · PRACTICE`}
        </span>
        {contest.featured ? <span className="featured-label">FEATURED</span> : null}
      </div>
      <h3>{contest.name}</h3>
      <p>{contest.description || "Call the match’s biggest decisions and climb the live table."}</p>

      <div className="contest-values">
        <div><small>{contest.poolType === "flexible" ? "Current pool" : "Prize pool"}</small><strong>{credits(contest.prizePoolCredits)}</strong></div>
        <div><small>Top reward</small><strong>{credits(contest.payoutLadder?.[0]?.rewardCredits)}</strong></div>
        <div><small>Entry</small><strong>{free ? "FREE" : credits(contest.entryCredits)}</strong></div>
      </div>

      <div className="capacity-line">
        <span>{Number(contest.joinedCount || 0).toLocaleString()} joined</span>
        <span>{Number(contest.capacity || 0).toLocaleString()} spots</span>
      </div>
      <div className="capacity-track"><span style={{ width: `${progress}%` }} /></div>

      <div className="contest-meta">
        <span>{lockLabel}</span>
        <span>{contest.payoutLadder?.length || 1} reward tiers</span>
      </div>

      <button
        className="contest-cta"
        type="button"
        disabled={(full || entryClosed) && !joined}
        onClick={() => joined && isLive ? onEnterLive(contest) : onSelect(contest)}
      >
        {action}<span aria-hidden="true">→</span>
      </button>
      <footer>{free ? "No purchase or entry payment required · Sponsor terms apply" : `${contest.fundingLabel ? `${contest.fundingLabel} · ` : ""}Demo Credits · No cash value`}</footer>
    </article>
  );
}

function JoinContestSheet({ contest, balance, pending, error, now, onClose, onConfirm, onEnterLive }) {
  const dialogRef = useDialogFocus(Boolean(contest), onClose);
  const [copied, setCopied] = useState(false);
  useEffect(() => setCopied(false), [contest?.id]);
  if (!contest) return null;
  const joined = contest.membership?.joined === true || contest.joined === true;
  const entry = Number(contest.entryCredits || 0);
  const after = Number(balance || 0) - entry;
  const deadlinePassed = contest.entryClosesAt && new Date(contest.entryClosesAt).getTime() <= now;
  const entryClosed = !joined && (deadlinePassed || ["locked", "live", "completed"].includes(contest.status));

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="contest-sheet" role="dialog" aria-modal="true" aria-labelledby="contest-sheet-title">
        <button className="sheet-close" type="button" onClick={onClose} aria-label="Close contest details">×</button>
        <span className="mode-label">{contest.visibility?.toUpperCase() || "PUBLIC"} CONTEST</span>
        <h2 id="contest-sheet-title">{joined ? "YOUR ENTRY" : `JOIN ${contest.name.toUpperCase()}?`}</h2>
        <p>{contest.description || "Every confirmed Big Call counts toward the same live leaderboard."}</p>

        <div className="sheet-ledger">
          <div><span>{contest.poolType === "flexible" ? "Current funded pool" : "Prize pool"}</span><strong>{credits(contest.prizePoolCredits)}</strong></div>
          {contest.poolType === "flexible" && contest.maxPrizePoolCredits ? <div><span>Maximum at capacity</span><strong>{credits(contest.maxPrizePoolCredits)}</strong></div> : null}
          {contest.fundingLabel ? <div><span>Pool funding</span><strong>{contest.fundingLabel}</strong></div> : null}
          <div><span>Practice entry</span><strong>{entry === 0 ? "FREE" : credits(entry)}</strong></div>
          <div><span>Your balance</span><strong>{credits(balance)}</strong></div>
          {!joined && entry > 0 ? <div className="after-row"><span>Balance after joining</span><strong>{credits(after)}</strong></div> : null}
        </div>

        {joined && contest.visibility === "private" && contest.inviteCode ? (
          <div className="private-code-block">
            <div><span>PRIVATE INVITE CODE</span><strong>{contest.inviteCode}</strong></div>
            <button type="button" onClick={async () => { await navigator.clipboard?.writeText(contest.inviteCode); setCopied(true); }}>{copied ? "COPIED ✓" : "COPY CODE"}</button>
            <span className="sr-status" aria-live="polite">{copied ? "Invite code copied." : ""}</span>
          </div>
        ) : null}

        <div className="payout-preview">
          <span>Payout preview</span>
          {(contest.payoutLadder || []).slice(0, 4).map((tier) => (
            <div key={`${tier.rankFrom}-${tier.rankTo}`}>
              <b>{tier.rankFrom === tier.rankTo ? `#${tier.rankFrom}` : `#${tier.rankFrom}–${tier.rankTo}`}</b>
              <strong>{credits(tier.rewardCredits)}</strong>
            </div>
          ))}
        </div>

        {error ? <p className="contest-error" role="alert">{error}</p> : null}
        <p className="sheet-disclosure">Demo Credits are free test credits. They cannot be purchased, withdrawn, exchanged, or redeemed.</p>

        {joined ? (
          <button className="sheet-primary" type="button" disabled={pending} onClick={() => onEnterLive(contest)}>{pending ? "OPENING ROOM…" : contest.status === "open" ? "ENTER WAITING ROOM" : "ENTER LIVE JURY"} <span>→</span></button>
        ) : (
          <button className="sheet-primary" type="button" disabled={pending || after < 0 || entryClosed} onClick={() => onConfirm(contest)}>
            {entryClosed ? "ENTRY CLOSED" : pending ? "RESERVING YOUR SPOT…" : entry === 0 ? "CONFIRM FREE ENTRY" : "CONFIRM PRACTICE ENTRY"}<span>→</span>
          </button>
        )}
        <button className="sheet-secondary" type="button" onClick={onClose}>NOT NOW</button>
      </section>
    </div>
  );
}

function PrivateRoomPanel({ creationClosed, onCreateOpen, onLookup, lookupPending, lookupError }) {
  const [code, setCode] = useState("");
  return (
    <section className="private-panel">
      <div className="private-intro">
        <span className="section-kicker">INVITE-ONLY</span>
        <h2>Your people.<br />Your jury room.</h2>
        <p>Create a practice contest for friends, or enter an invite code to find an existing room.</p>
        <button type="button" disabled={creationClosed} onClick={onCreateOpen}>{creationClosed ? "MATCH ENTRY CLOSED" : "CREATE PRIVATE ROOM"} <span>{creationClosed ? "×" : "＋"}</span></button>
      </div>
      <form className="invite-code-card" onSubmit={(event) => { event.preventDefault(); if (code.trim()) onLookup(code.trim().toUpperCase()); }}>
        <label htmlFor="invite-code">ENTER INVITE CODE</label>
        <div><input id="invite-code" value={code} maxLength={12} placeholder="CALL-7K2Q" onChange={(event) => setCode(event.target.value.toUpperCase())} /><button type="submit" disabled={lookupPending || code.length < 3}>{lookupPending ? "…" : "FIND"}</button></div>
        {lookupError ? <p className="contest-error" role="alert">{lookupError}</p> : null}
      </form>
    </section>
  );
}

function CreateRoomSheet({ open, pending, error, onClose, onCreate }) {
  const [name, setName] = useState("Saturday Night Jury");
  const [capacity, setCapacity] = useState(10);
  const [entryCredits, setEntryCredits] = useState(50);
  const dialogRef = useDialogFocus(open, onClose);
  if (!open) return null;
  const prize = capacity * entryCredits;

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="contest-sheet create-sheet" role="dialog" aria-modal="true" aria-labelledby="create-title">
        <button className="sheet-close" type="button" onClick={onClose} aria-label="Close private room creator">×</button>
        <span className="mode-label">PRIVATE · PRACTICE</span>
        <h2 id="create-title">CREATE A ROOM</h2>
        <label className="field-label">ROOM NAME<input value={name} maxLength={34} onChange={(event) => setName(event.target.value)} /></label>
        <div className="create-grid">
          <label className="field-label">PLAYERS<select value={capacity} onChange={(event) => setCapacity(Number(event.target.value))}>{[2, 5, 10, 20].map((value) => <option value={value} key={value}>{value}</option>)}</select></label>
          <label className="field-label">ENTRY<select value={entryCredits} onChange={(event) => setEntryCredits(Number(event.target.value))}>{[25, 50, 100].map((value) => <option value={value} key={value}>{credits(value)}</option>)}</select></label>
        </div>
        <div className="pool-equation"><span>{capacity} players</span><b>×</b><span>{credits(entryCredits)}</span><b>=</b><strong>up to {credits(prize)}</strong></div>
        <p className="no-fee">The pool starts with your entry and grows as friends join. No platform fee in demo mode.</p>
        {error ? <p className="contest-error" role="alert">{error}</p> : null}
        <p className="sheet-disclosure">Each player joins using Demo Credits. DC have no cash value and cannot be purchased or withdrawn.</p>
        <button className="sheet-primary" type="button" disabled={pending || name.trim().length < 3} onClick={() => onCreate({ name: name.trim(), capacity, entryCredits })}>{pending ? "CREATING…" : "CREATE PRACTICE ROOM"}<span>→</span></button>
      </section>
    </div>
  );
}

function BalanceSheet({ open, balance, onClose }) {
  const dialogRef = useDialogFocus(open, onClose);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="contest-sheet balance-sheet" role="dialog" aria-modal="true" aria-labelledby="balance-title">
        <button className="sheet-close" type="button" onClick={onClose} aria-label="Close balance information">×</button>
        <span className="mode-label">PRACTICE MODE</span>
        <h2 id="balance-title">{credits(balance)}</h2>
        <p>Your Demo Credit balance is used only to test contest entry and reward mechanics.</p>
        <p className="sheet-disclosure">Demo Credits are free test credits. They cannot be purchased, withdrawn, transferred, exchanged, or redeemed.</p>
        <button className="sheet-primary" type="button" onClick={onClose}>GOT IT</button>
      </section>
    </div>
  );
}

export default function ContestLobby({
  connected,
  nickname,
  wallet,
  contests = FALLBACK_CONTESTS,
  onJoinContest,
  onCreateContest,
  onLookupPrivate,
  onEnterLive,
}) {
  const [tab, setTab] = useState("public");
  const [selected, setSelected] = useState(null);
  const [joinPending, setJoinPending] = useState(false);
  const [joinError, setJoinError] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [createPending, setCreatePending] = useState(false);
  const [createError, setCreateError] = useState("");
  const [lookupPending, setLookupPending] = useState(false);
  const [lookupError, setLookupError] = useState("");
  const [balanceOpen, setBalanceOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const balance = wallet?.balanceCredits ?? 1000;
  const firstJoinedContest = contests.find((contest) => contest.membership?.joined === true || contest.joined === true);
  const sharedEntryClosesAt = contests.find((contest) => contest.entryClosesAt)?.entryClosesAt;
  const sharedRemainingMs = sharedEntryClosesAt ? Math.max(0, new Date(sharedEntryClosesAt).getTime() - now) : null;
  const sharedClock = sharedRemainingMs === null ? null : `${String(Math.floor(sharedRemainingMs / 60_000)).padStart(2, "0")}:${String(Math.floor((sharedRemainingMs % 60_000) / 1000)).padStart(2, "0")}`;
  const matchStatus = contests.some((contest) => contest.status === "completed")
    ? "FT"
    : contests.some((contest) => contest.status === "live")
      ? "LIVE"
    : sharedRemainingMs === 0
      ? "LOCKED"
      : "OPEN";

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const shown = useMemo(() => {
    if (tab === "mine") return contests.filter((contest) => contest.membership?.joined === true || contest.joined === true);
    return contests.filter((contest) => contest.visibility !== "private");
  }, [contests, tab]);

  const confirmJoin = async (contest) => {
    setJoinPending(true);
    setJoinError("");
    const response = await onJoinContest(contest);
    setJoinPending(false);
    if (!response?.ok) {
      setJoinError(response?.error || "We could not reserve that spot.");
      return;
    }
    setSelected({ ...response.contest, membership: response.contest.membership || { joined: true } });
  };

  const create = async (payload) => {
    setCreatePending(true);
    setCreateError("");
    const response = await onCreateContest(payload);
    setCreatePending(false);
    if (!response?.ok) return setCreateError(response?.error || "Could not create the room.");
    setCreateOpen(false);
    setSelected({ ...response.contest, membership: response.contest.membership || { joined: true } });
  };

  const lookup = async (inviteCode) => {
    setLookupPending(true);
    setLookupError("");
    const response = await onLookupPrivate(inviteCode);
    setLookupPending(false);
    if (!response?.ok) return setLookupError(response?.error || "We could not find that room.");
    setSelected({ ...response.contest, inviteCode });
  };

  const enterRoom = async (contest) => {
    setJoinPending(true);
    setJoinError("");
    const response = await onEnterLive(contest);
    setJoinPending(false);
    if (!response?.ok) setJoinError(response?.error || "The contest room could not be opened.");
    return response;
  };

  return (
    <div className="contest-shell">
      <header className="lobby-header">
        <div className="lobby-brand"><LobbyMark /><div><strong>THE CALL</strong><small>CONTESTS</small></div></div>
        <span className={`lobby-connection ${connected ? "is-live" : ""}`}><i />{connected ? "LIVE" : "OFFLINE"}</span>
        <button className="balance-pill" type="button" onClick={() => setBalanceOpen(true)}><small>DEMO BALANCE</small><strong>{credits(balance)}</strong></button>
      </header>

      <div className="practice-strip"><strong>PRACTICE MODE</strong><span>Entry credits and rewards marked DC have no cash value.</span></div>

      <main className="lobby-main">
        <section className="lobby-match">
          <div><span>TODAY · DEMO MATCH</span><h1>Aurora FC <i>vs</i> Metro United</h1><p>Four controversial decisions · Live jury scoring</p></div>
          <div className="match-countdown"><small>ALL CONTESTS</small><strong>{matchStatus}</strong><span>{matchStatus === "OPEN" ? sharedClock ? `Lock together in ${sharedClock}` : "First entry opens shared window" : "One authoritative match clock"}</span></div>
        </section>

        <div className="lobby-welcome"><div><span>WELCOME BACK</span><h2>{nickname || "MATCHDAY JUROR"}</h2></div><p>Accuracy wins. Speed never breaks ties.</p></div>

        <nav className="contest-tabs" aria-label="Contest categories" role="tablist">
          <button id="contest-tab-public" role="tab" aria-selected={tab === "public"} aria-controls="contest-panel-public" className={tab === "public" ? "is-active" : ""} type="button" onClick={() => setTab("public")}>PUBLIC</button>
          <button id="contest-tab-private" role="tab" aria-selected={tab === "private"} aria-controls="contest-panel-private" className={tab === "private" ? "is-active" : ""} type="button" onClick={() => setTab("private")}>PRIVATE</button>
          <button id="contest-tab-mine" role="tab" aria-selected={tab === "mine"} aria-controls="contest-panel-mine" className={tab === "mine" ? "is-active" : ""} type="button" onClick={() => setTab("mine")}>MY ENTRIES</button>
        </nav>

        {tab === "private" ? (
          <div id="contest-panel-private" role="tabpanel" aria-labelledby="contest-tab-private"><PrivateRoomPanel creationClosed={matchStatus !== "OPEN"} onCreateOpen={() => setCreateOpen(true)} onLookup={lookup} lookupPending={lookupPending} lookupError={lookupError} /></div>
        ) : (
          <section id={`contest-panel-${tab}`} role="tabpanel" aria-labelledby={`contest-tab-${tab}`} className="contest-list" aria-label={tab === "mine" ? "My contests" : "Public contests"}>
            <div className="list-heading"><div><span>{tab === "mine" ? "YOUR ROOMS" : "OPEN CONTESTS"}</span><h2>{tab === "mine" ? "My entries" : "Choose your stand"}</h2></div><small>{shown.length} contests</small></div>
            {shown.length ? shown.map((contest) => <ContestCard key={contest.id} contest={contest} now={now} onSelect={(value) => { setJoinError(""); setSelected(value); }} onEnterLive={enterRoom} />) : <div className="empty-contests"><strong>NO ENTRIES YET</strong><p>Join a public contest or create a private room to see it here.</p></div>}
          </section>
        )}
      </main>

      <nav className="mobile-nav" aria-label="Main navigation">
        <button className={tab === "public" ? "is-active" : ""} type="button" onClick={() => setTab("public")}><i>⌂</i>LOBBY</button>
        <button type="button" disabled={!firstJoinedContest} onClick={() => enterRoom(firstJoinedContest)}><i>●</i>LIVE</button>
        <button className={tab === "mine" ? "is-active" : ""} type="button" onClick={() => setTab("mine")}><i>≡</i>MY CONTESTS</button>
        <button type="button" onClick={() => setBalanceOpen(true)}><i>◎</i>PROFILE</button>
      </nav>

      <JoinContestSheet contest={selected} balance={balance} pending={joinPending} error={joinError} now={now} onClose={() => setSelected(null)} onConfirm={confirmJoin} onEnterLive={enterRoom} />
      <CreateRoomSheet open={createOpen} pending={createPending} error={createError} onClose={() => setCreateOpen(false)} onCreate={create} />
      <BalanceSheet open={balanceOpen} balance={balance} onClose={() => setBalanceOpen(false)} />
    </div>
  );
}
