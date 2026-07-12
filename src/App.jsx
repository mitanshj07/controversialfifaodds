import { useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import ContestLobby, { FALLBACK_CONTESTS } from "./ContestLobby.jsx";

const SERVER_URL = import.meta.env.VITE_SERVER_URL || undefined;
const SESSION_KEY = "the-call-session-v1";

const FALLBACK_STATE = {
  roomCode: "JURY12",
  match: {
    home: { name: "Northport", code: "NPT" },
    away: { name: "Sierra Republic", code: "SRP" },
    homeScore: 1,
    awayScore: 1,
    clock: "67:14",
    phase: "Second half",
  },
  replay: { status: "loading", progress: 0.57 },
  participants: [],
  activeCall: null,
  history: [],
  activity: [],
};

function getSavedSession() {
  try {
    return JSON.parse(localStorage.getItem(SESSION_KEY) || "null");
  } catch {
    return null;
  }
}

function saveSession(session) {
  localStorage.setItem(SESSION_KEY, JSON.stringify(session));
}

function words(value = '') {
  return String(value)
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function socketRequest(socket, event, payload = {}) {
  return new Promise((resolve) => {
    if (!socket?.connected) {
      resolve({ ok: false, code: "OFFLINE", error: "The match desk is reconnecting." });
      return;
    }
    socket.emit(event, payload, (response) => resolve(response || { ok: false, error: "No response from the match desk." }));
  });
}

function normaliseState(payload) {
  if (!payload) return FALLBACK_STATE;

  const match = payload.match || {};
  const home = match.home || payload.homeTeam || {};
  const away = match.away || payload.awayTeam || {};
  const activeCall = payload.activeCall || payload.call || null;
  const counts = activeCall?.counts || activeCall?.votes || {};

  return {
    ...FALLBACK_STATE,
    ...payload,
    match: {
      ...FALLBACK_STATE.match,
      ...match,
      home: {
        ...FALLBACK_STATE.match.home,
        ...(typeof home === "string" ? { name: home, code: home.slice(0, 3) } : home),
      },
      away: {
        ...FALLBACK_STATE.match.away,
        ...(typeof away === "string" ? { name: away, code: away.slice(0, 3) } : away),
      },
      homeScore: match.homeScore ?? match.score?.home ?? payload.homeScore ?? 0,
      awayScore: match.awayScore ?? match.score?.away ?? payload.awayScore ?? 0,
      clock: match.clock || payload.clock || "00:00",
      phase: match.phase || match.status || payload.phase || "Pre-match",
    },
    replay: { ...FALLBACK_STATE.replay, ...(payload.replay || {}) },
    participants: payload.participants || [],
    activeCall: activeCall
      ? {
          ...activeCall,
          id: activeCall.id || activeCall.callId,
          kind: activeCall.kind || activeCall.type || "Big call",
          title: activeCall.title || activeCall.question || "What will the call be?",
          detail: activeCall.detail || activeCall.context || "The officials are reviewing the incident.",
          status: activeCall.status || (activeCall.result ? "settled" : "open"),
          result: activeCall.result || activeCall.verdict,
          counts: {
            stands: Number(counts.stands || 0),
            overturned: Number(counts.overturned || 0),
          },
        }
      : null,
    history: payload.history || payload.calls || [],
    activity: payload.activity || [],
  };
}

function useCountdown(closesAt, isOpen, serverTime) {
  const [now, setNow] = useState(Date.now());
  const serverOffset = serverTime ? new Date(serverTime).getTime() - Date.now() : 0;

  useEffect(() => {
    if (!isOpen || !closesAt) return undefined;
    const timer = window.setInterval(() => setNow(Date.now()), 100);
    return () => window.clearInterval(timer);
  }, [closesAt, isOpen]);

  if (!closesAt) return 0;
  return Math.max(0, (new Date(closesAt).getTime() - (now + serverOffset)) / 1000);
}

function Mark({ size = 26 }) {
  return (
    <svg className="brand-mark" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <rect x="2" y="3" width="28" height="20" fill="currentColor" />
      <path d="M10 11h12M10 16h7" stroke="#0d0d0b" strokeWidth="2.5" strokeLinecap="square" />
      <rect x="6" y="23" width="20" height="3" fill="currentColor" opacity="0.3" />
    </svg>
  );
}

function Header({ roomCode, connected, muted, onToggleMute }) {
  return (
    <header className="topbar">
      <a className="brand" href="/" aria-label="The Call home">
        <Mark />
        <span>THE CALL</span>
      </a>
      <p className="brand-subtitle">Fan jury · live decisions</p>
      <div className="topbar-actions">
        <span className={`connection-pill ${connected ? "is-live" : ""}`}>
          <i /> {connected ? "LIVE" : "···"}
        </span>
        <span className="room-pill">{roomCode || "—"}</span>
        <button className="icon-button" type="button" onClick={onToggleMute} aria-label={muted ? "Turn sound on" : "Mute sound"}>
          {muted ? "🔇" : "🔊"}
        </button>
      </div>
    </header>
  );
}

function JoinGate({ open, connected, error, onJoin }) {
  const [nickname, setNickname] = useState("");

  if (!open) return null;

  const submit = (event) => {
    event.preventDefault();
    if (!nickname.trim()) return;
    onJoin({ nickname: nickname.trim(), roomCode: "JURY12" });
  };

  return (
    <div className="join-shell">
      <div className="join-art" aria-hidden="true">
        <div className="pitch-ring ring-one" />
        <div className="pitch-ring ring-two" />
        <div className="decision-card card-one">STANDS</div>
        <div className="decision-card card-two">OVERTURNED</div>
        <span className="giant-question">?</span>
      </div>
      <section className="join-card" aria-labelledby="join-title">
        <div className="eyebrow"><span>Live</span> No wallet · no money · just calls</div>
        <h1 id="join-title">The ref has<br />a screen.<br />Now you do.</h1>
        <p className="join-copy">Pick a name. Enter the room. When a big decision drops, you've got seconds to call it before the officials do. Get it right, climb the board.</p>

        <form onSubmit={submit}>
          <label>
            Matchday name
            <input
              autoFocus
              maxLength={20}
              placeholder="e.g. Left Wing Maya"
              value={nickname}
              onChange={(event) => setNickname(event.target.value)}
            />
          </label>
          {error ? <p className="form-error">⚠ {error}</p> : null}
          <button className="primary-button" type="submit" disabled={!connected || !nickname.trim()}>
            {connected ? "Enter the jury" : "Connecting…"}
            <span aria-hidden="true">→</span>
          </button>
        </form>

        <div className="join-proof">
          <span className="proof-knot">◎</span>
          <p><strong>Real feed. Clean calls.</strong><br />Match events stream from a replayable TxLINE-shaped feed. Nothing is made up.</p>
        </div>
      </section>
    </div>
  );
}

function Scoreboard({ match, replay, onRestart, onNextCall, showDemoControls = true }) {
  const progress = Math.max(0, Math.min(1, Number(replay?.progress || 0)));

  return (
    <section className="scoreboard" aria-label="Match score">
      <div className="match-meta">
        <span className="live-tag"><i /> {replay?.status === "ended" ? "FT" : replay?.status === "idle" ? "WAITING" : "DEMO"}</span>
        <span>{words(match.phase)}</span>
        {showDemoControls ? <div className="replay-actions">
          <button type="button" onClick={onNextCall}>▶ Next call</button>
          <button type="button" onClick={onRestart}>↺ Restart</button>
        </div> : <span className="contest-feed-label">CONTEST FEED · SERVER CONTROLLED</span>}
      </div>
      <div className="scoreline">
        <div className="team home-team">
          <span className="team-badge badge-coral">{match.home.code}</span>
          <div><strong>{match.home.name}</strong><small>Home</small></div>
        </div>
        <div className="score">
          <div>
            <strong>{match.homeScore}</strong><span>–</span><strong>{match.awayScore}</strong>
          </div>
          <small>{match.clock}</small>
        </div>
        <div className="team away-team">
          <div><strong>{match.away.name}</strong><small>Away</small></div>
          <span className="team-badge badge-blue">{match.away.code}</span>
        </div>
      </div>
      <div className="replay-track" aria-label={`Replay ${Math.round(progress * 100)} percent complete`}>
        <span style={{ width: `${progress * 100}%` }} />
        <i style={{ left: `${progress * 100}%` }} />
      </div>
    </section>
  );
}

function VoteButton({ choice, label, sublabel, selected, disabled, onVote }) {
  return (
    <button
      type="button"
      className={`vote-button vote-${choice} ${selected ? "is-selected" : ""}`}
      disabled={disabled}
      onClick={() => onVote(choice)}
    >
      <span className="vote-check">{selected ? "✓" : choice === "stands" ? "↳" : "↯"}</span>
      <strong>{label}</strong>
      <small>{sublabel}</small>
    </button>
  );
}

function JuryPanel({ call, currentVote, onVote, serverTime }) {
  const isOpen = call?.status === "open";
  const remaining = useCountdown(call?.closesAt, isOpen, serverTime);
  const actualVotes = call?.counts?.stands + call?.counts?.overturned;
  const total = Math.max(1, actualVotes);
  const standsPct = actualVotes > 0 ? Math.round((call?.counts?.stands / total) * 100) : 0;
  const overturnedPct = actualVotes > 0 ? 100 - standsPct : 0;

  if (!call) {
    return (
      <section className="jury-panel is-waiting">
        <div className="waiting-orbit" aria-hidden="true"><span /><i /><b /></div>
        <div className="eyebrow"><span>Standby</span> Eyes on the pitch</div>
        <h2>Stay sharp.<br />The next call<br />is coming.</h2>
        <p>A VAR review, penalty shout, or red card will open a short window. Everyone in the room calls it at once.</p>
        <div className="waiting-rules">
          <span><b>01</b> See the incident</span>
          <span><b>02</b> Make your call</span>
          <span><b>03</b> Beat the room</span>
        </div>
      </section>
    );
  }

  const settled = call.status === "settled" || Boolean(call.result);
  const pending = !isOpen && !settled;
  const personalHeading = !currentVote
    ? "OFFICIAL DECISION"
    : currentVote === call.result
      ? "YOU CALLED IT ✓"
      : "NOT THIS TIME";

  return (
    <section className={`jury-panel ${settled ? "is-settled" : "is-open"}`}>
      <div className="call-banner">
        <span className="review-pulse"><i /> VAR REVIEW</span>
        <span className="call-kind">{words(call.kind)}</span>
      </div>

      {settled ? (
        <div className="settled-heading">
          <span className="verdict-stamp">Official verdict</span>
          <h2>{personalHeading}</h2>
          <p><strong>{call.result === "overturned" ? "OVERTURNED" : "STANDS"}</strong> · {call.settlementNote || call.detail}</p>
        </div>
      ) : pending ? (
        <div className="settled-heading pending-heading">
          <span className="verdict-stamp">Closed</span>
          <h2>JURY LOCKED</h2>
          <p>Waiting for the official verdict…</p>
        </div>
      ) : (
        <>
          <div className="countdown" aria-label={`${remaining.toFixed(1)} seconds remaining`}>
            <strong>{remaining.toFixed(1)}</strong><span>sec to call it</span>
          </div>
          <h2>{call.title}</h2>
          <p className="call-detail">{call.detail}</p>
        </>
      )}

      {!pending ? <div className="vote-grid">
        <VoteButton
          choice="stands"
          label="STANDS"
          sublabel="Original decision holds"
          selected={currentVote === "stands"}
          disabled={!isOpen || Boolean(currentVote)}
          onVote={onVote}
        />
        <VoteButton
          choice="overturned"
          label="OVERTURNED"
          sublabel="Officials reverse it"
          selected={currentVote === "overturned"}
          disabled={!isOpen || Boolean(currentVote)}
          onVote={onVote}
        />
      </div> : null}

      {settled ? <div className="crowd-meter">
        <div className="meter-label"><span>Room split</span><span>{call.counts.stands + call.counts.overturned} locked</span></div>
        <div className="meter-bar"><span style={{ width: `${standsPct}%` }} /><i style={{ width: `${overturnedPct}%` }} /></div>
        <div className="meter-values"><strong>{standsPct}% stands</strong><strong>{overturnedPct}% overturned</strong></div>
      </div> : (
        <div className="vote-seal">{currentVote ? `Locked in · ${currentVote}` : "Room split hidden until verdict drops"}</div>
      )}
    </section>
  );
}

function Leaderboard({ participants, participantId }) {
  const sorted = [...participants].sort((a, b) => (b.score || 0) - (a.score || 0));

  return (
    <section className="side-card leaderboard-card">
      <div className="section-heading">
        <div><span className="section-index">01</span><h3>The jury</h3></div>
        <span>{participants.length} in room</span>
      </div>
      <div className="participant-list">
        {sorted.length ? sorted.slice(0, 6).map((person, index) => (
          <div className={`participant ${person.id === participantId || person.participantId === participantId ? "is-you" : ""}`} key={person.id || person.participantId || person.nickname}>
            <span className="rank">{String(index + 1).padStart(2, "0")}</span>
            <span className={`avatar avatar-${index % 4}`}>{person.nickname?.slice(0, 1).toUpperCase()}</span>
            <div><strong>{person.nickname}{person.id === participantId || person.participantId === participantId ? " (you)" : ""}</strong><small>{person.contestEligible === false || person.isEligible === false || person.isDemoJuror ? "Demo juror · not prize eligible" : `${person.streak || 0} streak`}</small></div>
            <b>{person.score || 0}</b>
          </div>
        )) : (
          <p className="empty-copy">Room is open. Jurors incoming.</p>
        )}
      </div>
    </section>
  );
}

function CallHistory({ history }) {
  const rows = history.slice(-4).reverse();

  return (
    <section className="side-card history-card">
      <div className="section-heading">
        <div><span className="section-index">02</span><h3>Match calls</h3></div>
        <span>Server-settled</span>
      </div>
      <div className="history-list">
        {rows.length ? rows.map((item, index) => (
          <div className="history-row" key={item.id || `${item.title}-${index}`}>
            <span className="history-minute">{item.minute || item.clock || "—"}</span>
            <div><strong>{item.title || item.kind || "Big call"}</strong><small>{item.detail || "Settled"}</small></div>
            <span className={`history-result result-${item.result}`}>{item.result === "overturned" ? "TURNED" : "STANDS"}</span>
          </div>
        )) : <p className="empty-copy">No settled calls yet. First review lands here.</p>}
      </div>
    </section>
  );
}

function ProofRibbon({ lastProof, call }) {
  const isSettled = call?.status === "settled" || call?.result || Boolean(lastProof);
  return (
    <footer className="proof-ribbon">
      <div className="proof-title"><span>◎</span><div><strong>Proof desk</strong><small>Trust lives backstage</small></div></div>
      <div className="proof-step is-done"><i>1</i><div><strong>Match event</strong><small>TxLINE feed · seq locked</small></div></div>
      <span className="proof-arrow">→</span>
      <div className={`proof-step ${isSettled ? "is-done" : ""}`}><i>2</i><div><strong>Outcome</strong><small>{isSettled ? "Result received" : "Awaiting"}</small></div></div>
      <span className="proof-arrow">→</span>
      <div className={`proof-step ${lastProof ? "is-done" : ""}`}><i>3</i><div><strong>Reputation</strong><small>{typeof lastProof === "string" ? lastProof : lastProof?.label || lastProof?.hash || "Post-match batch"}</small></div></div>
    </footer>
  );
}

function LiveContestStrip({ contest, onBack }) {
  const waiting = contest?.status === "open" && contest?.entryClosesAt && new Date(contest.entryClosesAt).getTime() > Date.now();
  const secondsUntilOpen = useCountdown(contest?.entryClosesAt, Boolean(waiting), null);
  if (!contest) return null;
  const membership = contest.membership || {};
  const waitingClock = `${String(Math.floor(secondsUntilOpen / 60)).padStart(2, "0")}:${String(Math.floor(secondsUntilOpen % 60)).padStart(2, "0")}`;
  return (
    <section className="live-contest-strip" aria-label="Active contest">
      <button type="button" onClick={onBack}>← LOBBY</button>
      <div><span>{waiting ? `WAITING ROOM · OPENS IN ${waitingClock}` : "LIVE CONTEST"}</span><strong>{contest.name}</strong></div>
      <div><span>PRIZE POOL</span><strong>{Number(contest.prizePoolCredits || 0).toLocaleString()} DC</strong></div>
      <div><span>YOUR RANK</span><strong>{membership.rank ? `#${membership.rank}` : "—"} / {Number(contest.joinedCount || 0).toLocaleString()}</strong></div>
      <div><span>PROVISIONAL REWARD</span><strong>{Number(membership.projectedRewardCredits || 0).toLocaleString()} DC</strong></div>
    </section>
  );
}

export default function App() {
  const socketRef = useRef(null);
  const demoCallIndexRef = useRef(0);
  const [connected, setConnected] = useState(false);
  const [joined, setJoined] = useState(false);
  const [roomState, setRoomState] = useState(FALLBACK_STATE);
  const [session, setSession] = useState(() => getSavedSession());
  const [joinError, setJoinError] = useState("");
  const [currentVote, setCurrentVote] = useState(null);
  const [muted, setMuted] = useState(false);
  const [screen, setScreen] = useState("lobby");
  const [contests, setContests] = useState(FALLBACK_CONTESTS);
  const [wallet, setWallet] = useState({ balanceCredits: 1000, currency: "TEST_CREDITS", isWithdrawable: false });
  const [activeContest, setActiveContest] = useState(null);
  const activeCallId = roomState.activeCall?.id;

  useEffect(() => {
    const socket = io(SERVER_URL, { transports: ["websocket", "polling"] });
    socketRef.current = socket;

    socket.on("connect", () => {
      setConnected(true);
      const saved = getSavedSession();
      if (saved?.nickname && saved?.roomCode) {
        const applyContestSession = (response) => {
          if (response?.ok === false) return;
          const nextSession = {
            ...saved,
            ...(response?.session || {}),
          };
          saveSession(nextSession);
          setSession(nextSession);
          setJoined(true);
          setScreen("lobby");
          if (response.contests) setContests(response.contests);
          if (response.wallet) setWallet(response.wallet);
        };
        socket.emit("contest:session", saved, (response) => {
          if (response?.ok) return applyContestSession(response);
          socket.emit("contest:session", { nickname: saved.nickname }, applyContestSession);
        });
      }
    });
    socket.on("disconnect", () => setConnected(false));
    socket.on("room:state", (payload) => {
      setRoomState(normaliseState(payload));
      if (payload?.you?.wallet) setWallet(payload.you.wallet);
      if (payload?.contest) setActiveContest(payload.contest);
    });
    socket.on("contest:updated", () => {
      const saved = getSavedSession();
      socket.emit("contest:list", saved || {}, (response) => {
        if (response?.ok && response.contests) setContests(response.contests);
        if (response?.ok && response.wallet) setWallet(response.wallet);
      });
    });
    socket.on("call:opened", (payload) => {
      setCurrentVote(null);
      if (payload?.roomState) setRoomState(normaliseState(payload.roomState));
    });
    socket.on("call:settled", (payload) => {
      if (payload?.roomState) setRoomState(normaliseState(payload.roomState));
    });
    socket.on("replay:restarted", () => setCurrentVote(null));

    return () => socket.close();
  }, []);

  useEffect(() => setCurrentVote(null), [activeCallId]);

  const currentParticipant = useMemo(
    () => roomState.you || roomState.participants.find((person) => person.id === session?.participantId || person.participantId === session?.participantId),
    [roomState.participants, roomState.you, session?.participantId],
  );

  useEffect(() => {
    const serverVote = currentParticipant?.vote || currentParticipant?.currentVote;
    if (serverVote) setCurrentVote(serverVote);
  }, [currentParticipant]);

  const join = ({ nickname, roomCode }) => {
    setJoinError("");
    socketRef.current?.emit("contest:session", { nickname }, (response) => {
      if (!response || response.ok === false) {
        setJoinError(response?.error || "Could not open your contest profile. Try again.");
        return;
      }
      const nextSession = {
        nickname,
        roomCode: roomCode || "JURY12",
        ...(response.session || {}),
      };
      saveSession(nextSession);
      setSession(nextSession);
      setJoined(true);
      setScreen("lobby");
      if (response.contests) setContests(response.contests);
      if (response.wallet) setWallet(response.wallet);
    });
  };

  const vote = (choice) => {
    if (!activeCallId || currentVote) return;
    socketRef.current?.emit("vote:cast", { callId: activeCallId, choice }, (response) => {
      if (response?.ok === false) {
        setCurrentVote(null);
      } else {
        setCurrentVote(choice);
      }
      if (response?.state) setRoomState(normaliseState(response.state));
    });
  };

  const restart = () => {
    demoCallIndexRef.current = 0;
    setCurrentVote(null);
    socketRef.current?.emit("replay:restart", {}, (response) => {
      if (response?.state) setRoomState(normaliseState(response.state));
    });
  };

  const jumpToNextCall = () => {
    const callOffsets = [14_000, 43_000, 70_000, 97_000];
    const offsetMs = callOffsets[demoCallIndexRef.current % callOffsets.length];
    demoCallIndexRef.current += 1;
    setCurrentVote(null);
    socketRef.current?.emit("replay:restart", { offsetMs }, (response) => {
      if (response?.state) setRoomState(normaliseState(response.state));
    });
  };

  const refreshContests = async (credentials = session) => {
    const response = await socketRequest(socketRef.current, "contest:list", credentials || {});
    if (response.ok) {
      if (response.contests) setContests(response.contests);
      if (response.wallet) setWallet(response.wallet);
    }
    return response;
  };

  const mergeContestSession = (response, fallbackRoomCode = session?.roomCode || "JURY12") => {
    const nextSession = {
      ...session,
      ...(response?.session || {}),
      roomCode: response?.session?.roomCode || fallbackRoomCode,
    };
    if (nextSession.nickname && nextSession.participantId) {
      saveSession(nextSession);
      setSession(nextSession);
    }
    return nextSession;
  };

  const joinContest = async (contest) => {
    const response = await socketRequest(socketRef.current, "contest:join", {
      contestId: contest?.id,
      inviteCode: contest?.inviteCode,
      nickname: session?.nickname,
      participantId: session?.participantId,
      resumeToken: session?.resumeToken,
    });
    if (!response.ok) return response;
    mergeContestSession(response, contest?.roomCode);
    if (response.wallet) setWallet(response.wallet);
    if (response.contests) setContests(response.contests);
    else await refreshContests(response.session || session);
    const joinedContest = {
      ...contest,
      ...response.contest,
      membership: response.contest?.membership || { joined: true },
    };
    setActiveContest(joinedContest);
    return { ...response, contest: joinedContest };
  };

  const createContest = async (details) => {
    const response = await socketRequest(socketRef.current, "contest:create", {
      ...details,
      nickname: session?.nickname,
      participantId: session?.participantId,
      resumeToken: session?.resumeToken,
    });
    if (!response.ok) return response;
    mergeContestSession(response, response.contest?.roomCode);
    if (response.wallet) setWallet(response.wallet);
    if (response.contests) setContests(response.contests);
    else await refreshContests(response.session || session);
    const createdContest = {
      ...response.contest,
      membership: response.contest?.membership || { joined: true },
    };
    setActiveContest(createdContest);
    return { ...response, contest: createdContest };
  };

  const lookupPrivateContest = (inviteCode) => socketRequest(socketRef.current, "contest:lookup", {
    inviteCode,
    participantId: session?.participantId,
    resumeToken: session?.resumeToken,
  });

  const enterLiveContest = async (contest = activeContest) => {
    if (!contest?.roomCode) return { ok: false, error: "Join a contest before entering the live jury." };
    const response = await socketRequest(socketRef.current, "room:join", {
      roomCode: contest.roomCode,
      nickname: session?.nickname,
      participantId: session?.participantId,
      resumeToken: session?.resumeToken,
    });
    if (!response.ok) return response;
    const nextSession = {
      ...session,
      ...(response.session || {}),
      roomCode: contest.roomCode,
    };
    saveSession(nextSession);
    setSession(nextSession);
    if (response.state) {
      setRoomState(normaliseState(response.state));
      if (response.state.you?.wallet) setWallet(response.state.you.wallet);
    }
    setActiveContest(response.state?.contest || contest);
    setScreen("live");
    window.scrollTo({ top: 0, behavior: "smooth" });
    return response;
  };

  const backToLobby = async () => {
    setScreen("lobby");
    await refreshContests();
    window.scrollTo({ top: 0, behavior: "smooth" });
  };

  return (
    <>
      <JoinGate open={!joined} connected={connected} error={joinError} onJoin={join} />
      {joined && screen === "lobby" ? (
        <ContestLobby
          connected={connected}
          nickname={session?.nickname}
          wallet={wallet}
          contests={contests}
          onJoinContest={joinContest}
          onCreateContest={createContest}
          onLookupPrivate={lookupPrivateContest}
          onEnterLive={enterLiveContest}
        />
      ) : <div className={`app-shell ${!joined ? "is-obscured" : ""}`}>
        <Header roomCode={roomState.roomCode} connected={connected} muted={muted} onToggleMute={() => setMuted((value) => !value)} />
        <main>
          <LiveContestStrip contest={activeContest || roomState.contest} onBack={backToLobby} />
          <Scoreboard match={roomState.match} replay={roomState.replay} onRestart={restart} onNextCall={jumpToNextCall} showDemoControls={!activeContest && !roomState.contest} />
          <div className="workspace-grid">
            <JuryPanel call={roomState.activeCall} currentVote={currentVote} onVote={vote} serverTime={roomState.serverTime} />
            <aside>
              <Leaderboard participants={roomState.participants} participantId={session?.participantId} />
              <CallHistory history={roomState.history} />
            </aside>
          </div>
        </main>
        <ProofRibbon lastProof={roomState.lastProof} call={roomState.activeCall} />
      </div>}
    </>
  );
}
