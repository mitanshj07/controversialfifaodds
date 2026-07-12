import express from 'express';
import { createServer as createHttpServer } from 'node:http';
import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { Server as SocketIOServer } from 'socket.io';
import { ScriptedReplayAdapter } from './adapters/scripted-replay-adapter.js';
import { ContestManager } from './domain/contest-manager.js';
import { RoomError } from './domain/room-session.js';
import { RoomManager } from './domain/room-manager.js';
import { DEMO_EVENTS, DEMO_JURORS, DEMO_MATCH } from './match-script.js';
import { Connection, PublicKey } from '@solana/web3.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DEFAULT_PORT = 3001;
export const TREASURY_WALLET = new PublicKey('6MS566y46t3C37p7TnnK7yieoSbLimWEwwKemXxFMJ5A');
const solanaConnection = new Connection('https://api.devnet.solana.com');

const finitePlaybackRate = (value) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 && parsed <= 8 ? parsed : 1;
};

const clientError = (error) => ({
  ok: false,
  code: error instanceof RoomError ? error.code : 'SERVER_ERROR',
  error: error instanceof RoomError ? error.message : 'Something went wrong on the match desk.',
});

export function createTheCallServer({
  playbackRate = finitePlaybackRate(process.env.REPLAY_SPEED),
  allowedOrigin = process.env.CLIENT_ORIGIN || '*',
  tickRateMs = 250,
  entryWindowMs = Number(process.env.CONTEST_ENTRY_WINDOW_MS) || 20_000,
} = {}) {
  const app = express();
  const httpServer = createHttpServer(app);
  const io = new SocketIOServer(httpServer, {
    cors: { origin: allowedOrigin, methods: ['GET', 'POST'] },
  });

  const manager = new RoomManager({
    match: DEMO_MATCH,
    demoJurors: DEMO_JURORS,
    adapterFactory: () => new ScriptedReplayAdapter({
      events: DEMO_EVENTS,
      durationMs: DEMO_MATCH.durationMs,
      playbackRate,
      tickRateMs,
    }),
  });
  const contests = new ContestManager({ match: DEMO_MATCH, entryWindowMs });

  app.disable('x-powered-by');
  app.use((request, response, next) => {
    response.setHeader('Access-Control-Allow-Origin', allowedOrigin);
    response.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    response.setHeader('Access-Control-Allow-Methods', 'GET,OPTIONS');
    if (request.method === 'OPTIONS') return response.sendStatus(204);
    return next();
  });
  app.use(express.json({ limit: '32kb' }));

  const health = (_request, response) => response.json({
    ok: true,
    service: 'the-call-match-desk',
    now: Date.now(),
    replay: { source: 'scripted', playbackRate },
    contests: { entryWindowMs: contests.entryWindowMs },
    ...manager.health(),
  });
  app.get('/health', health);
  app.get('/api/health', health);
  app.get('/api/contests', (request, response) => {
    try {
      const result = contests.list({
        participantId: request.query.participantId,
        resumeToken: request.query.resumeToken,
      });
      return response.json({ ok: true, ...result });
    } catch (error) {
      return response.status(400).json(clientError(error));
    }
  });
  app.get('/api/rooms/:roomCode', (request, response) => {
    try {
      const state = manager.snapshot(request.params.roomCode);
      if (!state) return response.status(404).json({ ok: false, error: 'Room not found.' });
      return response.json({ ok: true, state: contests.decorateRoomState(state) });
    } catch (error) {
      return response.status(400).json(clientError(error));
    }
  });

  const distDirectory = resolve(__dirname, '..', 'dist');
  if (existsSync(distDirectory)) {
    app.use(express.static(distDirectory));
    app.get(/^(?!\/api\/|\/health$|\/socket\.io\/).*/, (_request, response) =>
      response.sendFile(join(distDirectory, 'index.html')));
  }

  const broadcastState = (roomCode) => {
    for (const { socketId, participantId } of manager.connectedSockets(roomCode)) {
      const state = manager.snapshot(roomCode, participantId);
      io.to(socketId).emit(
        'room:state',
        contests.decorateRoomState(state, participantId),
      );
    }
  };

  manager.on('state', ({ roomCode }) => {
    contests.updateFromRoomState(roomCode, manager.snapshot(roomCode));
    broadcastState(roomCode);
  });
  manager.on('callOpened', ({ roomCode, call }) => {
    if (contests.contestForRoom(roomCode)) {
      const { counts: _counts, totalVotes: _totalVotes, ...safeCall } = call;
      io.to(roomCode).emit('call:opened', { roomCode, ...safeCall, call: safeCall });
      return;
    }
    io.to(roomCode).emit('call:opened', { roomCode, ...call, call });
  });
  manager.on('callSettled', ({ roomCode, settlement }) => {
    io.to(roomCode).emit('call:settled', { roomCode, ...settlement, settlement });
  });
  manager.on('restarted', ({ roomCode, replay }) => {
    io.to(roomCode).emit('replay:restarted', replay);
  });
  contests.on('state', ({ contestId, type }) => {
    io.emit('contest:updated', { contestId, type });
  });

  const PACKAGES = {
    'pack_1': { priceLamports: 100_000_000, credits: 5000 },
    'pack_2': { priceLamports: 500_000_000, credits: 30000 },
  };

  io.on('connection', (socket) => {
    socket.on('wallet:buy_points', async (payload = {}, acknowledge = () => {}) => {
      try {
        const { signature, packageId, participantId, resumeToken } = payload;
        const pack = PACKAGES[packageId];
        if (!pack) throw new Error('Invalid package ID.');
        
        // Wait briefly for confirmation if needed (frontend should wait, but just in case)
        const tx = await solanaConnection.getParsedTransaction(signature, { maxSupportedTransactionVersion: 0 });
        if (!tx) throw new Error('Transaction not found or not confirmed yet.');
        if (tx.meta?.err) throw new Error('Transaction failed on-chain.');

        // Verify transfer instruction
        const instructions = tx.transaction.message.instructions;
        const isValidTransfer = instructions.some((ix) => {
          return ix.program === 'system' && 
                 ix.parsed?.type === 'transfer' && 
                 ix.parsed?.info?.destination === TREASURY_WALLET.toBase58() &&
                 ix.parsed?.info?.lamports >= pack.priceLamports;
        });

        if (!isValidTransfer) throw new Error('Invalid transfer details.');

        const result = contests.buyPoints({
          participantId,
          resumeToken,
          amountCredits: pack.credits,
          transactionId: signature,
        });

        acknowledge({ ok: true, ...result });
      } catch (error) {
        acknowledge(clientError(error));
      }
    });

    socket.on('contest:session', (payload = {}, acknowledge = () => {}) => {
      try {
        const result = contests.session(payload);
        acknowledge({ ok: true, ...result });
      } catch (error) {
        acknowledge(clientError(error));
      }
    });

    socket.on('contest:list', (payload = {}, acknowledge = () => {}) => {
      try {
        acknowledge({ ok: true, ...contests.list(payload) });
      } catch (error) {
        acknowledge(clientError(error));
      }
    });

    socket.on('contest:lookup', (payload = {}, acknowledge = () => {}) => {
      try {
        acknowledge({ ok: true, contest: contests.lookup(payload) });
      } catch (error) {
        acknowledge(clientError(error));
      }
    });

    socket.on('contest:create', (payload = {}, acknowledge = () => {}) => {
      try {
        const created = contests.create(payload);
        acknowledge({
          ok: true,
          ...created,
          contests: contests.list({
            participantId: created.session.participantId,
            resumeToken: created.session.resumeToken,
          }).contests,
        });
      } catch (error) {
        acknowledge(clientError(error));
      }
    });

    socket.on('contest:join', (payload = {}, acknowledge = () => {}) => {
      try {
        const joined = contests.join(payload);
        acknowledge({ ok: true, ...joined });
      } catch (error) {
        acknowledge(clientError(error));
      }
    });

    socket.on('room:join', async (payload = {}, acknowledge = () => {}) => {
      try {
        if (socket.data.roomCode) await socket.leave(socket.data.roomCode);
        const contestAccess = contests.authorizeRoomEntry(payload);
        const joined = manager.join({
          roomCode: payload.roomCode,
          nickname: contestAccess?.account.nickname ?? payload.nickname,
          participantId: contestAccess?.account.id ?? payload.participantId,
          resumeToken: contestAccess?.account.resumeToken ?? payload.resumeToken,
          trustedIdentity: contestAccess?.identity ?? null,
          startAt: contestAccess?.contest.entryClosesAt ?? null,
          playbackRate,
          socketId: socket.id,
        });
        await socket.join(joined.room.code);
        socket.data.roomCode = joined.room.code;
        socket.data.participantId = joined.credentials.id;
        const session = {
          participantId: joined.credentials.id,
          resumeToken: joined.credentials.resumeToken,
          nickname: joined.credentials.nickname,
          roomCode: joined.room.code,
        };
        const state = contests.decorateRoomState(
          manager.snapshot(joined.room.code, session.participantId),
          session.participantId,
        );
        acknowledge({ ok: true, session, state });
        broadcastState(joined.room.code);
      } catch (error) {
        const response = clientError(error);
        acknowledge(response);
        socket.emit('server:error', response);
      }
    });

    socket.on('vote:cast', (payload = {}, acknowledge = () => {}) => {
      try {
        contests.assertSocketMayPlay({
          roomCode: socket.data.roomCode,
          participantId: socket.data.participantId,
        });
        const vote = manager.castVote(socket.id, payload);
        const state = manager.snapshot(socket.data.roomCode, socket.data.participantId);
        acknowledge({
          ok: true,
          ...vote,
          state: contests.decorateRoomState(state, socket.data.participantId),
        });
      } catch (error) {
        acknowledge(clientError(error));
      }
    });

    socket.on('replay:restart', (payload = {}, acknowledge = () => {}) => {
      try {
        if (contests.contestForRoom(socket.data.roomCode)) {
          throw new RoomError(
            'RESTART_NOT_ALLOWED',
            'Contest replays are controlled by the match desk.',
          );
        }
        const replay = manager.restart(socket.id, { offsetMs: payload.offsetMs });
        const state = manager.snapshot(socket.data.roomCode, socket.data.participantId);
        acknowledge({ ok: true, replay, state });
      } catch (error) {
        acknowledge(clientError(error));
      }
    });

    socket.on('disconnect', () => {
      const roomCode = manager.disconnect(socket.id);
      if (roomCode) broadcastState(roomCode);
    });
  });

  const close = async () => {
    manager.close();
    await new Promise((done) => io.close(done));
    if (httpServer.listening) {
      await new Promise((done, reject) =>
        httpServer.close((error) => (error ? reject(error) : done())));
    }
  };

  return { app, httpServer, io, manager, contests, close };
}

export async function startTheCallServer({ port = Number(process.env.PORT) || DEFAULT_PORT } = {}) {
  const server = createTheCallServer();
  await new Promise((done) => server.httpServer.listen(port, done));
  const address = server.httpServer.address();
  const listeningPort = typeof address === 'object' && address ? address.port : port;
  console.log(`THE CALL match desk listening on http://localhost:${listeningPort}`);
  return server;
}

const invokedDirectly = process.argv[1]
  && fileURLToPath(import.meta.url) === resolve(process.argv[1]);
if (invokedDirectly) {
  startTheCallServer().catch((error) => {
    console.error(error);
    process.exitCode = 1;
  });
}
