/*
 * The arcade: two games' rules, and the invitations between two accounts.
 *   npx tsc app/lib/games/tic-tac-toe.ts app/lib/games/paddle-duel.ts app/lib/games/invites.ts app/lib/games/catalogue.ts app/lib/games/mock-games-repository.ts app/lib/notifications/feed.ts --outDir Temp/games-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   node Temp/check-games.cjs
 *
 * Offline, and that is the point: the rules of both games are plain functions, so what a player can
 * and cannot do is checked here rather than by playing. The mock store is exercised through the same
 * interface the Supabase one implements, so an invitation walks the whole path - filed, read by the
 * account it names, answered, removed - without a project or a second browser.
 *
 * What it holds the arcade to:
 *
 *   tic-tac-toe   nine empty plates, X first, a taken plate refused, the eight lines, a draw, and a
 *                 computer that takes a win, blocks one, and never plays an occupied cell
 *   paddle duel   the court's bounds, the walls, a return off the face of a paddle, a point when the
 *                 ball passes it, the match ending at the target, and an opponent that stays inside
 *                 the court
 *   invitations   the four buckets a screen sorts them into, an expiry, the wording of a row, and
 *                 the store's own rules: no self-invites, both sides can read it, either can answer
 *   the feed      the third kind of notification, so an invitation is a row the bell can draw
 */
const assert = require('node:assert/strict');

const {
  tttBestMove,
  tttDraw,
  tttEmptyCells,
  tttPlay,
  tttStart,
  tttTurn,
  tttWinner,
  tttWinningLine,
  LINES,
} = require('./games-out/games/tic-tac-toe.js');
const {
  BALL_MAX_SPEED,
  COURT_HEIGHT,
  COURT_WIDTH,
  DUEL_TARGET,
  PADDLE_HEIGHT,
  duelAiTarget,
  duelStart,
  duelStatus,
  duelStep,
  duelWinner,
} = require('./games-out/games/paddle-duel.js');
const { GAME_CATALOGUE, gameById } = require('./games-out/games/catalogue.js');
const { inviteSummary, isInviteFresh, opponentOf, splitInvites } = require('./games-out/games/invites.js');
const { getMockGamesRepository } = require('./games-out/games/mock-games-repository.js');
const {
  notificationBreakdown,
  notificationKindCounts,
  notificationLabel,
  notificationVerb,
} = require('./games-out/notifications/feed.js');

const step = (state, input = { left: null, right: null }, dt = 1 / 60) => duelStep(state, input, dt);

/* 1. Tic-tac-toe: nine plates, eight lines, one turn order ------------------ */

const empty = tttStart();
assert.equal(empty.length, 9);
assert.deepEqual(tttEmptyCells(empty), [0, 1, 2, 3, 4, 5, 6, 7, 8]);
assert.equal(tttTurn(empty), 'X', 'X starts');
assert.equal(tttWinner(empty), null);
assert.equal(LINES.length, 8, 'four rows, four columns and two diagonals');

const oneMove = tttPlay(empty, 4, 'X');
assert.equal(oneMove[4], 'X');
assert.equal(empty[4], null, 'the board a move came from is never changed');
assert.equal(tttPlay(oneMove, 4, 'O'), null, 'a taken plate takes no second mark');
assert.equal(tttPlay(oneMove, 9, 'O'), null, 'and neither does a plate off the board');
assert.equal(tttTurn(oneMove), 'O');

// X takes a line, and the line is the one that was taken.
let board = tttStart();
board = tttPlay(board, 0, 'X');
board = tttPlay(board, 3, 'O');
board = tttPlay(board, 1, 'X');
board = tttPlay(board, 4, 'O');
board = tttPlay(board, 2, 'X');
assert.equal(tttWinner(board), 'X');
assert.deepEqual(tttWinningLine(board), [0, 1, 2]);
assert.equal(tttPlay(board, 5, 'O'), null, 'and a finished board takes no move at all');

// A drawn board: every plate taken, nobody with three.
const drawn = ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'];
assert.equal(tttWinner(drawn), null);
assert.equal(tttDraw(drawn), true);
assert.equal(tttEmptyCells(drawn).length, 0);


/* 2. Paddle duel: the court, the walls, the returns, the points ------------- */

const start = duelStart();
assert.equal(start.leftScore, 0);
assert.equal(start.rightScore, 0);
assert.equal(start.ballY, COURT_HEIGHT / 2, 'the ball starts in the middle');
assert.equal(start.leftY, COURT_HEIGHT / 2);

// However far a paddle is asked to go, it stays on the court.
const clamped = step(start, { left: -500, right: COURT_HEIGHT + 500 }, 1);
assert.ok(clamped.state.leftY >= PADDLE_HEIGHT / 2);
assert.ok(clamped.state.rightY <= COURT_HEIGHT - PADDLE_HEIGHT / 2);

// The ball travels, and the wall turns it around rather than letting it out.
const toWall = { ...start, ballX: 500, ballY: 10, vx: 300, vy: -400 };
const offWall = step(toWall);
assert.ok(offWall.state.ballY >= 13 - 0.001, 'it comes off the top wall');
assert.ok(offWall.state.vy > 0, 'and heads back down');
assert.equal(offWall.scored, null);
assert.ok(offWall.state.ballX > toWall.ballX, 'while carrying on across');

// A ball reaching the paddle's face with the paddle under it comes back the other way, faster.
const atFace = { ...start, ballX: 70, ballY: COURT_HEIGHT / 2 + 20, vx: -400, vy: 0, leftY: COURT_HEIGHT / 2 + 20 };
const returned = step(atFace);
assert.ok(returned.state.vx > 0, 'the left paddle returns it');
assert.ok(
  Math.hypot(returned.state.vx, returned.state.vy) > 400,
  'and a return is quicker than the ball that arrived',
);
assert.equal(returned.bounced, true);

// The same ball, with the paddle nowhere near it, is a point for the other side.
const past = { ...start, ballX: -20, ballY: 40, vx: -400, vy: 0, leftY: 520 };
const scored = step(past);
assert.equal(scored.scored, 'right', 'the right paddle takes the point');
assert.equal(scored.state.rightScore, 1);
assert.equal(scored.state.ballX, COURT_WIDTH / 2, 'and the ball is served again from the middle');
assert.equal(scored.state.serveTo, 'left', 'to the side that conceded');

// The match ends at the target, and says so.
const nearEnd = { ...start, leftScore: DUEL_TARGET - 1, ballX: 1020, ballY: 20, vx: 400, vy: 0, rightY: 520 };
const ended = step(nearEnd);
assert.equal(ended.scored, 'left');
assert.equal(duelWinner(ended.state), 'left');
// (2026-10-25, SPEC-less-text.md) `LEFT PADDLE TAKES IT 7-0` -> `LEFT WINS 7-0`.
assert.match(duelStatus(ended.state), /^LEFT WINS \d+-\d+$/);
assert.doesNotMatch(duelStatus(ended.state), /TAKES IT/);

// The computer's paddle follows the ball, and stays on the court doing it.
const chasing = { ...start, ballX: 800, ballY: 540, vx: 300, vy: 0 };
const chase = duelAiTarget(chasing, 'right');
assert.ok(chase >= PADDLE_HEIGHT / 2 && chase <= COURT_HEIGHT - PADDLE_HEIGHT / 2, 'inside the court');
assert.ok(chase > COURT_HEIGHT / 3, 'and drawn toward the ball it is facing');
assert.ok(duelAiTarget({ ...chasing, vx: -300 }, 'right') < chase, 'and back toward the middle as it leaves');
assert.ok(BALL_MAX_SPEED > 400);

/* 3. Invitations: the four buckets, the expiry, and the wording ------------- */

const now = Date.parse('2026-09-23T12:00:00.000Z');
const invite = (over) => ({
  id: over.id,
  game: 'tic-tac-toe',
  fromUserId: 'amy',
  fromName: 'amy',
  toUserId: 'bo',
  toName: 'bo',
  status: 'pending',
  createdAt: over.at,
  updatedAt: over.at,
  ...over,
});

const rows = [
  invite({ id: 'i1', at: '2026-09-23T11:59:00.000Z' }),
  invite({ id: 'i2', at: '2026-09-23T11:58:30.000Z', fromUserId: 'bo', fromName: 'bo', toUserId: 'amy', toName: 'amy', status: 'accepted' }),
  invite({ id: 'i3', at: '2026-09-20T11:00:00.000Z', status: 'declined' }),
];

const sorted = splitInvites(rows, 'bo', now);
assert.deepEqual(sorted.incoming.map((row) => row.id), ['i1'], 'what is waiting on the reader');
assert.deepEqual(sorted.sent.map((row) => row.id), [], 'and nothing they sent');
assert.deepEqual(sorted.answered.map((row) => row.id), ['i2'], 'answered inside the window');
assert.deepEqual(sorted.stale.map((row) => row.id), ['i3'], 'answered days ago is history');
assert.equal(splitInvites(rows, 'amy', now).sent.length + splitInvites(rows, 'amy', now).incoming.length, 1);

assert.equal(isInviteFresh(rows[0], now), true);
assert.equal(isInviteFresh(rows[2], now), false);
assert.equal(opponentOf(rows[0], 'bo'), 'amy');
assert.equal(opponentOf(rows[0], 'amy'), 'bo');
assert.equal(inviteSummary(rows[0], 'bo', 'TIC-TAC-TOE'), 'TIC-TAC-TOE :: FROM amy');
assert.equal(inviteSummary(rows[0], 'amy', 'TIC-TAC-TOE'), 'TIC-TAC-TOE :: SENT TO bo');
assert.match(inviteSummary(rows[1], 'amy', 'PADDLE DUEL'), /ACCEPTED WITH bo/);

/* 4. The catalogue: what the hub may offer, and nothing else ---------------- */

assert.equal(GAME_CATALOGUE.length, 2);
assert.equal(new Set(GAME_CATALOGUE.map((game) => game.id)).size, 2, 'two games, two ids');
for (const game of GAME_CATALOGUE) {
  assert.ok(game.title.length > 0 && game.tagline.length > 0 && game.players.length > 0 && game.controls.length > 0);
  assert.equal(gameById(game.id).id, game.id);
}
assert.equal(gameById('paddle-duel').title, 'PADDLE DUEL');
assert.equal(gameById('not-a-game').id, GAME_CATALOGUE[0].id, 'an unknown id answers with the first game');

/* The computer: greedy, and beatable on purpose ---------------------------- */

const toWin = ['O', 'O', null, 'X', 'X', null, null, null, null];
assert.equal(tttBestMove(toWin, 'O'), 2, 'it takes a line it can take');
assert.equal(tttBestMove(['X', 'X', null, 'O', null, null, null, null, null].map((c) => (c === null ? null : c)), 'O'), 2, 'and blocks one it cannot');
assert.equal(tttBestMove(empty, 'O'), 4, 'opening in the middle');

/* 5. The store: an invitation walks the whole path -------------------------- */

(async () => {
  const store = getMockGamesRepository();

  const filed = await store.create({
    game: 'tic-tac-toe',
    from: { id: 'amy', displayName: 'amy' },
    to: { id: 'bo', displayName: 'bo' },
  });

  assert.equal(filed.status, 'pending', 'a new invitation is waiting');
  assert.equal(filed.fromName, 'amy');
  assert.deepEqual((await store.list('amy')).map((row) => row.id), [filed.id], 'the sender reads it');
  assert.deepEqual((await store.list('bo')).map((row) => row.id), [filed.id], 'and so does the account it names');
  assert.deepEqual(await store.list('cy'), [], 'and nobody else does');

  await assert.rejects(
    () => store.create({ game: 'paddle-duel', from: { id: 'amy', displayName: 'amy' }, to: { id: 'amy', displayName: 'amy' } }),
    /YOURSELF/,
    'nobody challenges themselves',
  );

  // Realtime: the listener hears about a write it did not make.
  const heard = [];
  const stop = store.subscribe('bo', (next) => heard.push(next.length));
  await store.create({ game: 'paddle-duel', from: { id: 'cy', displayName: 'cy' }, to: { id: 'bo', displayName: 'bo' } });
  stop();
  assert.ok(heard.length > 0 && heard.at(-1) === 2, 'the account it names is told, with the fresh list');

  await store.setStatus(filed.id, 'accepted');
  assert.equal((await store.list('bo')).find((row) => row.id === filed.id).status, 'accepted', 'either side answers');
  await assert.rejects(() => store.setStatus('no-such-invitation', 'declined'), /NOT THERE/);

  await store.remove(filed.id);
  assert.deepEqual((await store.list('amy')).map((row) => row.id).length, 0, 'either side clears it');
  await store.clearLocalInvites();

  /* 6. The feed: an invitation is a row the bell can draw ------------------ */

  assert.equal(notificationLabel('invite'), 'INVITED YOU TO A GAME');
  assert.equal(notificationVerb('invite'), 'INVITED');
  assert.deepEqual(
    notificationKindCounts([{ kind: 'tag' }, { kind: 'invite' }, { kind: 'reply' }]),
    { tag: 1, reply: 1, invite: 1 },
  );
  assert.equal(notificationBreakdown([{ kind: 'tag' }, { kind: 'invite' }]), '1 TAG :: 0 REPLIES :: 1 INVITE');
  assert.equal(
    notificationBreakdown([{ kind: 'tag' }, { kind: 'reply' }]),
    '1 TAG :: 1 REPLY',
    'and no word about games when there are none',
  );

  console.log(`rules      : ${LINES.length} lines, ${GAME_CATALOGUE.length} games, ${DUEL_TARGET} points to a match`);
  console.log(`invitations: ${splitInvites(rows, 'bo', now).incoming.length} waiting, ${heard.at(-1) ?? '-'} rows read over the wire`);
  console.log('games      : the boards, the court, the invitations and the feed all hold');
})().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});

assert.equal(tttBestMove(drawn, 'O'), null, 'and nothing on a board that is over');
