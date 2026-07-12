import { createHash } from 'node:crypto';

const stableParticipants = (participants) => [...participants.values()]
  .map(({ id, nickname, score, streak, bestStreak }) => ({
    id,
    nickname,
    score,
    streak,
    bestStreak,
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

const stableHistory = (history) => history
  .map(({ id, result, minute, counts, totalVotes }) => ({
    id,
    result,
    minute,
    counts: { stands: counts.stands, overturned: counts.overturned },
    totalVotes,
  }))
  .sort((a, b) => a.id.localeCompare(b.id));

export function buildReputationCheckpoint({ matchId, roomCode, generation, history, participants }) {
  const manifest = {
    schema: 'the-call/reputation-v1',
    matchId,
    roomCode,
    generation,
    calls: stableHistory(history),
    participants: stableParticipants(participants),
  };
  const hash = createHash('sha256').update(JSON.stringify(manifest)).digest('hex');

  return Object.freeze({
    schema: manifest.schema,
    hash,
    callCount: manifest.calls.length,
    participantCount: manifest.participants.length,
    status: 'ready_for_devnet',
    label: `Root ${hash.slice(0, 10)}… · devnet pending`,
  });
}
