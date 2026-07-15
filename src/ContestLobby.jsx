import { useEffect, useMemo, useRef, useState } from "react";
import { useConnection, useWallet } from '@solana/wallet-adapter-react';
import { WalletMultiButton } from '@solana/wallet-adapter-react-ui';
import { PublicKey, SystemProgram, Transaction } from '@solana/web3.js';

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
const SOLANA_TREASURY_WALLET = import.meta.env.VITE_SOLANA_TREASURY_WALLET || '6MS566y46t3C37p7TnnK7yieoSbLimWEwwKemXxFMJ5A';

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

function BuyPointsDialog({ open, onClose, onBuy }) {
  const { connection } = useConnection();
  const { publicKey, sendTransaction } = useWallet();
  const dialogRef = useDialogFocus(open, onClose);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  if (!open) return null;

  const TREASURY_WALLET = new PublicKey(SOLANA_TREASURY_WALLET);
  const PACKAGES = [
    { id: 'pack_1', sol: 0.1, lamports: 100_000_000, credits: 5000 },
    { id: 'pack_2', sol: 0.5, lamports: 500_000_000, credits: 30000 },
  ];

  const buyPackage = async (pack) => {
    if (!publicKey) return setError('Connect your wallet first.');
    setPending(true);
    setError('');
    try {
      const transaction = new Transaction().add(
        SystemProgram.transfer({
          fromPubkey: publicKey,
          toPubkey: TREASURY_WALLET,
          lamports: pack.lamports,
        })
      );
      const signature = await sendTransaction(transaction, connection, { preflightCommitment: 'confirmed' });
      await connection.confirmTransaction(signature, 'confirmed');
      const res = await onBuy(signature, pack.id);
      if (!res?.ok) throw new Error(res?.error || 'Server rejected purchase');
      onClose();
    } catch (err) {
      setError(err.message || 'Transaction failed');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="dialog-scrim" onMouseDown={(event) => event.target === event.currentTarget && !pending && onClose()}>
      <dialog open className="dialog-content" ref={dialogRef} onClick={(e) => e.stopPropagation()}>
        <div className="dialog-header">
          <h2>Purchase Points</h2>
          <button type="button" onClick={onClose} aria-label="Close" className="close-button">×</button>
        </div>
        <div className="dialog-body">
          <p>Get Demo Credits using Devnet SOL. These points have no cash value and cannot be withdrawn or redeemed.</p>
          <p className="wallet-network-note">Network: DEVNET · Wallet: {publicKey ? `${publicKey.toBase58().slice(0, 4)}…${publicKey.toBase58().slice(-4)}` : 'not connected'}</p>
          <p><a href="https://faucet.solana.com/" target="_blank" rel="noreferrer">Get free Devnet SOL from the Solana faucet ↗</a></p>
          {error && <p className="form-error" role="alert">⚠ {error}</p>}
          <div style={{ display: 'flex', flexDirection: 'column', gap: '1rem', marginTop: '1.5rem' }}>
            {PACKAGES.map((p) => (
              <button 
                key={p.id} 
                className="primary-button" 
                disabled={pending || !publicKey}
                onClick={() => buyPackage(p)}
              >
                {pending ? "Confirming on Devnet…" : `Get ${credits(p.credits)} for ${p.sol} Devnet SOL`}
              </button>
            ))}
          </div>
        </div>
      </dialog>
    </div>
  );
}

function LiveMatchesPanel({ data = {}, onRefresh }) {
  const matches = Array.isArray(data.matches) ? data.matches : [];
  const [filter, setFilter] = useState("all");
  const lastUpdated = data.fetchedAt ? new Date(data.fetchedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null;
  const providerLabel = data.provider === 'txodds' ? 'TXODDS' : 'TXLINE';
  const setup = data.setup || {};
  const missingCredentials = Array.isArray(setup.missing) ? setup.missing : [];
  const matchRank = (match) => ({ live: 0, scheduled: 1, completed: 2, cancelled: 3 }[match.status] ?? 4);
  const filteredMatches = matches
    .filter((match) => filter === "all" || (filter === "live" ? match.live : match.status === "scheduled"))
    .sort((left, right) => {
      const statusDifference = matchRank(left) - matchRank(right);
      if (statusDifference) return statusDifference;
      return new Date(left.startTime || 0).getTime() - new Date(right.startTime || 0).getTime();
    });
  const filterCount = (value) => value === "all"
    ? matches.length
    : value === "live"
      ? matches.filter((match) => match.live).length
      : matches.filter((match) => match.status === "scheduled").length;

  return (
    <section id="contest-panel-live" className="live-matches-panel" role="tabpanel" aria-labelledby="contest-tab-live">
      <div className="live-matches-heading">
        <div><span className="section-kicker">PRIMARY FEED · {providerLabel}</span><h2>Match centre</h2><p>Upcoming and live fixtures are fetched server-side. No mock cards are mixed into this board.</p></div>
        <button type="button" className="live-refresh-button" onClick={onRefresh} disabled={data.loading}>{data.loading ? "UPDATING…" : "REFRESH ↻"}</button>
      </div>

      {data.error ? <p className="contest-error" role="alert">{data.error}</p> : null}
      {!data.configured ? (
        <div className="live-empty-state">
          <span className="mode-label">TXLINE ACTIVATION NEEDED</span>
          <h3>Connect World Cup fixtures.</h3>
          <p>Complete the TxLINE World Cup Free Tier activation, then add the server-only credentials in Render. The browser never receives them.</p>
          {missingCredentials.length ? <p className="live-config-missing">Missing: {missingCredentials.map((name) => <code key={name}>{name}</code>)}</p> : null}
          <a className="live-guide-link" href={setup.activationGuide || 'https://txline-docs.txodds.com/documentation/worldcup'} target="_blank" rel="noreferrer">OPEN FREE-TIER GUIDE ↗</a>
        </div>
      ) : matches.length === 0 ? (
        <div className="live-empty-state">
          <span className="mode-label">{providerLabel} CONNECTED</span>
          <h3>No fixtures returned yet.</h3>
          <p>The feed is connected, but its current snapshot is empty. Check the World Cup/International Friendlies schedule, then refresh.</p>
        </div>
      ) : (
        <>
          <div className="fixture-filter" role="tablist" aria-label="Fixture status">
            {[['all', 'ALL'], ['upcoming', 'UPCOMING'], ['live', 'LIVE NOW']].map(([value, label]) => (
              <button key={value} type="button" role="tab" aria-selected={filter === value} className={filter === value ? 'is-active' : ''} onClick={() => setFilter(value)}>{label} <span>{filterCount(value)}</span></button>
            ))}
          </div>
          {filteredMatches.length ? <div className="live-match-grid">
            {filteredMatches.map((match) => (
              <article className="live-match-card" key={match.id}>
                <div className="live-match-card-head"><span className={match.live ? "live-state" : "scheduled-state"}>{match.live ? "LIVE NOW" : match.status?.toUpperCase() || "SCHEDULED"}</span><small>FIXTURE {match.id}</small></div>
                <p className="live-competition">{match.competition || "TxLINE fixture"}</p>
                <div className="live-teams"><strong>{match.home}</strong><b>{match.homeScore ?? "—"}</b><span>–</span><b>{match.awayScore ?? "—"}</b><strong>{match.away}</strong></div>
                <div className="live-match-meta"><span>{match.live && match.minute !== null ? `${match.minute}′` : match.startTime ? new Date(match.startTime).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : "Awaiting clock"}</span><span>{providerLabel} PRIMARY</span></div>
              </article>
            ))}
          </div> : <div className="live-empty-state compact"><span className="mode-label">NO {filter.toUpperCase()} FIXTURES</span><h3>Try another view.</h3><p>The current snapshot has no fixtures matching this filter.</p></div>}
        </>
      )}
      <footer className="live-matches-footer">{lastUpdated ? `Last server refresh ${lastUpdated}` : "Waiting for first server refresh"} · {providerLabel} credentials stay server-side</footer>
    </section>
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

function ScoringGuideSheet({ open, onClose }) {
  const dialogRef = useDialogFocus(open, onClose);
  if (!open) return null;

  return (
    <div className="sheet-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <section ref={dialogRef} className="contest-sheet scoring-sheet" role="dialog" aria-modal="true" aria-labelledby="scoring-guide-title">
        <button className="sheet-close" type="button" onClick={onClose} aria-label="Close scoring guide">×</button>
        <span className="mode-label">THE JURY RULEBOOK</span>
        <h2 id="scoring-guide-title">HOW SCORING WORKS</h2>
        <p>Call each review before the official verdict. You score for being correct — never for picking first.</p>
        <ol className="scoring-steps">
          <li><b>01</b><div><strong>Make your call</strong><span>Choose STANDS or OVERTURNED while the decision window is open.</span></div></li>
          <li><b>02</b><div><strong>Wait for the official result</strong><span>TxLINE marks the verified outcome and settles the call for everyone.</span></div></li>
          <li><b>03</b><div><strong>Earn accuracy points</strong><span>Correct calls add to your contest total. A wrong call earns zero — there are no deductions.</span></div></li>
        </ol>
        <div className="scoring-tiebreak"><span>TIEBREAK</span><strong>Higher accuracy wins. If accuracy is tied, the earlier correct call ranks higher.</strong></div>
        <p className="sheet-disclosure">Demo Credits and rewards are for the hackathon demo only. They have no cash value and cannot be withdrawn or redeemed.</p>
        <button className="sheet-primary" type="button" onClick={onClose}>I’M READY TO CALL <span>→</span></button>
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
  onBuyPoints,
  liveMatches,
  onRefreshLiveMatches,
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
  const [buyPointsOpen, setBuyPointsOpen] = useState(false);
  const [scoringOpen, setScoringOpen] = useState(false);
  const [now, setNow] = useState(Date.now());
  const balance = wallet?.balanceCredits ?? 1000;
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
        <div style={{ display: "flex", gap: "0.5rem" }}>
          <div className="lobby-wallet"><WalletMultiButton /></div>
          <button className="balance-pill" type="button" onClick={() => setBuyPointsOpen(true)} style={{ background: "#4caf50", color: "#fff" }}><small>GET</small><strong>POINTS</strong></button>
          <button className="balance-pill" type="button" onClick={() => setBalanceOpen(true)}><small>BALANCE</small><strong>{credits(balance)}</strong></button>
        </div>
      </header>

      <BuyPointsDialog open={buyPointsOpen} onClose={() => setBuyPointsOpen(false)} onBuy={onBuyPoints} />

      <div className="practice-strip"><strong>PRACTICE MODE</strong><span>Entry credits and rewards marked DC have no cash value.</span></div>

      <main className="lobby-main">
        <section className="lobby-match">
          <div><span>TODAY · DEMO MATCH</span><h1>Aurora FC <i>vs</i> Metro United</h1><p>Four controversial decisions · Live jury scoring</p></div>
          <div className="match-countdown"><small>ALL CONTESTS</small><strong>{matchStatus}</strong><span>{matchStatus === "OPEN" ? sharedClock ? `Lock together in ${sharedClock}` : "First entry opens shared window" : "One authoritative match clock"}</span></div>
        </section>

        <div className="lobby-welcome"><div><span>WELCOME BACK</span><h2>{nickname || "MATCHDAY JUROR"}</h2></div><div className="welcome-actions"><p>Accuracy wins. Speed never breaks ties.</p><button type="button" className="scoring-open" onClick={() => setScoringOpen(true)}>HOW SCORING WORKS <span>↗</span></button></div></div>

        <nav className="contest-tabs" aria-label="Contest categories" role="tablist">
          <button id="contest-tab-public" role="tab" aria-selected={tab === "public"} aria-controls="contest-panel-public" className={tab === "public" ? "is-active" : ""} type="button" onClick={() => setTab("public")}>PUBLIC</button>
          <button id="contest-tab-live" role="tab" aria-selected={tab === "live"} aria-controls="contest-panel-live" className={tab === "live" ? "is-active" : ""} type="button" onClick={() => setTab("live")}>LIVE MATCHES</button>
          <button id="contest-tab-private" role="tab" aria-selected={tab === "private"} aria-controls="contest-panel-private" className={tab === "private" ? "is-active" : ""} type="button" onClick={() => setTab("private")}>PRIVATE</button>
          <button id="contest-tab-mine" role="tab" aria-selected={tab === "mine"} aria-controls="contest-panel-mine" className={tab === "mine" ? "is-active" : ""} type="button" onClick={() => setTab("mine")}>MY ENTRIES</button>
        </nav>

        {tab === "live" ? (
          <LiveMatchesPanel data={liveMatches} onRefresh={onRefreshLiveMatches} />
        ) : tab === "private" ? (
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
        <button className={tab === "live" ? "is-active" : ""} type="button" onClick={() => setTab("live")}><i>●</i>LIVE</button>
        <button className={tab === "mine" ? "is-active" : ""} type="button" onClick={() => setTab("mine")}><i>≡</i>MY CONTESTS</button>
        <button type="button" onClick={() => setBalanceOpen(true)}><i>◎</i>PROFILE</button>
      </nav>

      <JoinContestSheet contest={selected} balance={balance} pending={joinPending} error={joinError} now={now} onClose={() => setSelected(null)} onConfirm={confirmJoin} onEnterLive={enterRoom} />
      <CreateRoomSheet open={createOpen} pending={createPending} error={createError} onClose={() => setCreateOpen(false)} onCreate={create} />
      <ScoringGuideSheet open={scoringOpen} onClose={() => setScoringOpen(false)} />
      <BalanceSheet open={balanceOpen} balance={balance} onClose={() => setBalanceOpen(false)} />
    </div>
  );
}
