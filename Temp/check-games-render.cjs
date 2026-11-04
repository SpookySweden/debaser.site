/*
 * What the arcade draws: the hub, a match, the board and the court.
 *   npx tsc app/components/GamesHub.tsx app/components/GameMatch.tsx app/components/TicTacToeBoard.tsx app/components/PaddleDuelCourt.tsx app/components/ProfileName.tsx --outDir Temp/games-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 * (2026-11-04) The next steps compile all it requires: it had been passing on what earlier runs left in Temp/.
 *   npx tsc app/components/AuthProvider.tsx app/components/CommsProvider.tsx app/components/NotificationsProvider.tsx app/components/PresenceProvider.tsx app/components/ProfileName.tsx app/components/UserDirectoryRow.tsx app/components/GamesHub.tsx app/components/GameMatch.tsx app/components/TicTacToeBoard.tsx app/components/PaddleDuelCourt.tsx --rootDir app --outDir Temp/games-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   npx tsc app/lib/games/paddle-duel.ts --rootDir app/lib --outDir Temp/games-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-games-render.cjs
 *
 * Offline, and nothing is stubbed that matters: the providers the hub reads (who is signed in, who is
 * around, the bell) are replaced with the smallest thing that answers a question, so what is rendered
 * is the arcade's own markup. It is here because a screen nobody renders is a screen nobody has
 * looked at: the structure check asks for exactly this, and it is right to.
 *
 * What it holds the arcade to on screen:
 *
 *   the hub        both games, the roster, the chooser, and an empty invitation panel that says so
 *   a solo match   the badge, nine plates, rematch and leave, and no waiting on anybody
 *   a real match   the opponent's name and the board sealed while they have not arrived
 *   the board      a winning line marked, and the same rule read out in the line under it
 *   the court      the score, which paddle is yours, and the drag instruction
 */
const assert = require('node:assert/strict');
const Module = require('node:module');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const originalLoad = Module._load;

/** A module pre-loaded into the cache, which is how a provider seam is closed for a render. */
function stub(path, exports) {
  const resolved = require.resolve(path);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

/** The provider seams the hub reads, answered as the smallest object that fits. */
const stubs = {
  './games-render/components/AuthProvider.js': {
    useAuth: () => ({ user: { id: 'amy', displayName: 'amy' } }),
  },
  './games-render/components/CommsProvider.js': {
    useComms: () => ({
      accounts: [
        { id: 'amy', displayName: 'amy' },
        { id: 'bo', displayName: 'bo' },
        { id: 'cy', displayName: 'cy' },
      ],
      unreadTotal: 0,
    }),
  },
  './games-render/components/NotificationsProvider.js': {
    useNotifications: () => ({
      notifyInvited: () => Promise.resolve(),
      items: [],
      summary: 'NO NOTIFICATIONS',
      error: null,
      ready: true,
      userId: 'amy',
      markRead: () => Promise.resolve(),
      markAllRead: () => Promise.resolve(),
      retry: () => undefined,
      notifyTagged: () => Promise.resolve(),
      source: 'mock',
    }),
  },
  './games-render/components/PresenceProvider.js': {
    // Two accounts are on and one has gone quiet, which is what the roster is for.
    usePresenceDirectory: () => ({
      statusFor: (id) => (id === 'bo' ? 'online' : 'offline'),
      recordFor: () => undefined,
    }),
  },
  './games-render/components/ProfileName.js': {
    __esModule: true,
    default: ({ author }) => React.createElement('span', null, author.displayName),
  },
  // The row itself is rendered for real by Temp/check-user-directory.cjs, including the actions slot
  // this page passes it; here it stands in so the hub's own markup is what is being read.
  './games-render/components/UserDirectoryRow.js': {
    __esModule: true,
    default: ({ row, actions }) => React.createElement('li', null, row.account.displayName, actions),
  },
};

Module._load = function load(request, parent, isMain) {
  const stub = stubs[request];
  if (stub !== undefined) return { __esModule: true, ...stub };

  return originalLoad.call(this, request, parent, isMain);
};
for (const [path, exports] of Object.entries(stubs)) stub(path, exports);


const GamesHub = require('./games-render/components/GamesHub.js').default;
const GameMatch = require('./games-render/components/GameMatch.js').default;
const TicTacToeBoard = require('./games-render/components/TicTacToeBoard.js').default;
const PaddleDuelCourt = require('./games-render/components/PaddleDuelCourt.js').default;
const { duelStart } = require('./games-out/games/paddle-duel.js');

const element = React.createElement;
const render = (child) => renderToStaticMarkup(child);
const textOf = (html) => html.replace(/<[^>]*>/g, '');

const me = { id: 'amy', displayName: 'amy' };
const invite = {
  id: 'invite-1',
  game: 'tic-tac-toe',
  fromUserId: 'amy',
  fromName: 'amy',
  toUserId: 'bo',
  toName: 'bo',
  status: 'accepted',
  createdAt: '2026-09-23T11:00:00.000Z',
  updatedAt: '2026-09-23T11:00:00.000Z',
};

/* The hub ------------------------------------------------------------------ */

const hub = render(element(GamesHub));
const hubText = textOf(hub);

// (2026-10-25) This used to pass on `READING THE ARCADE STORE...` alone: the panel has been titled GAMES since
// SPEC-efficiency.md (the window is the one titled ARCADE). It asks for the panel's own title now.
assert.match(hub, /<span>GAMES<\/span>/, 'the games panel is the first panel');
assert.match(hubText, /TIC-TAC-TOE/);
assert.match(hubText, /PADDLE DUEL/);
assert.equal((hubText.match(/\[ PLAY SOLO \]/g) ?? []).length, 2, 'solo is one press per game');
// (2026-10-25, SPEC-less-text.md) The card key `[ INVITE SOMEONE ]` -> `[ PICK ]`, and each row's
// `[ INVITE TO GAME ]` -> `[ INVITE ]`.
assert.match(hubText, /\[ PICK(ED)? \]/, 'each game card picks the game an invitation sends');
assert.doesNotMatch(hubText, /\[ INVITE SOMEONE \]|\[ INVITE TO GAME \]/, 'under the short names');
// (2026-10-23, SPEC-efficiency.md) The second row of game plates (`PLAYING:` / `INVITE THEM TO:`) is cut: each
// game card's own keys cover solo, invite and a challenge, and the invite key's tip names the game.
assert.doesNotMatch(hubText, /INVITE THEM TO:|PLAYING:/);
// (2026-10-25, SPEC-less-text.md) The invite key's tip `Invite bo to TIC-TAC-TOE` -> the game's title alone
// (it sits on the row of the account it invites).
assert.doesNotMatch(hub, /title="Invite [^"]+ to [^"]+"/, 'the invite tip no longer repeats the row');
// `READING THE ARCADE STORE...` -> `READING...`.
assert.match(hubText, /READING\.\.\./, 'and it says so while the store is answering');
assert.doesNotMatch(hubText, /READING THE ARCADE STORE/, 'in one word');
assert.match(hubText, /WHO IS AROUND/);
assert.match(hubText, /bo/, 'an account with its lamp on is offered');
assert.doesNotMatch(hubText, /cy/, 'one that has gone quiet is not');

/* A solo match ------------------------------------------------------------- */

const solo = render(element(GameMatch, { game: 'tic-tac-toe', invite: null, me, onLeave: () => undefined }));
const soloText = textOf(solo);

assert.match(soloText, /TIC-TAC-TOE/);
assert.match(soloText, /SOLO/);
assert.equal((solo.match(/aria-label="Cell/g) ?? []).length, 9, 'nine plates');
// (2026-10-25, SPEC-less-text.md) The board's `YOU ARE X. 8 WAYS TO TAKE IT.` line is cut: the side panel's
// `X :: amy` already says which mark is yours.
assert.match(soloText, /X :: amy/, 'the side panel says which mark is yours');
assert.doesNotMatch(soloText, /YOU ARE X\.|WAYS TO TAKE IT/, 'so the board does not say it again');
assert.match(soloText, /YOUR MOVE/);
assert.match(soloText, /\[ REMATCH \]/);
assert.match(soloText, /\[ LEAVE \]/);
assert.match(soloText, /THE COMPUTER/, 'solo names its opponent');
assert.doesNotMatch(soloText, /WAITING FOR/);

/* A match, waiting for the other account ----------------------------------- */

const waitingMatch = render(element(GameMatch, { game: 'tic-tac-toe', invite, me, onLeave: () => undefined }));
const waitingText = textOf(waitingMatch);

assert.match(waitingText, /MATCH :: bo/);
assert.match(waitingText, /WAITING FOR bo/);
assert.match(waitingMatch, /disabled/, 'and the board takes no move until they have arrived');
assert.equal((waitingMatch.match(/aria-label="Cell/g) ?? []).length, 9);

/* The board's own rules, drawn --------------------------------------------- */

const taken = render(
  element(TicTacToeBoard, {
    board: ['X', 'X', 'X', null, 'O', null, null, null, 'O'],
    myMark: 'X',
    onPlay: () => undefined,
  }),
);

// (2026-10-25, SPEC-less-text.md) `X TAKES IT. WELL PLAYED.` -> `YOU WIN` (for your own mark), `O WINS` otherwise.
assert.match(textOf(taken), /YOU WIN/, 'the line under the board says who won');
assert.doesNotMatch(textOf(taken), /TAKES IT|WELL PLAYED/, 'in two words');
assert.match(taken, /bg-sun-pale/, 'and the three plates that did it are marked');

const drawnBoard = render(
  element(TicTacToeBoard, {
    board: ['X', 'O', 'X', 'X', 'O', 'O', 'O', 'X', 'X'],
    myMark: 'X',
    onPlay: () => undefined,
  }),
);

// (2026-10-25, SPEC-less-text.md) `ALL NINE PLATES TAKEN. NOBODY WINS THIS ONE.` -> `DRAW`.
assert.match(textOf(drawnBoard), /DRAW/);
assert.doesNotMatch(textOf(drawnBoard), /NOBODY WINS THIS ONE/);

/* The court ---------------------------------------------------------------- */

const court = render(element(PaddleDuelCourt, { state: duelStart(), mySide: 'left', onAim: () => undefined }));
const courtText = textOf(court);

assert.match(courtText, /0 - 0/);
// (2026-10-25, SPEC-less-text.md) `YOU ARE THE LEFT PADDLE. DRAG ANYWHERE TO MOVE IT.` -> `YOU: LEFT`; the
// control is said once, in the match panel (`DRAG THE COURT.`, asserted on the duel match below).
assert.match(courtText, /YOU: LEFT/);
assert.doesNotMatch(courtText, /YOU ARE THE LEFT PADDLE|DRAG ANYWHERE TO MOVE IT/, 'in two words, with no how-to');
assert.match(court, /touch-none/, 'and the court takes the gesture rather than scrolling the page');

const heldCourt = render(
  element(PaddleDuelCourt, { state: duelStart(), mySide: 'right', onAim: () => undefined, scoresHidden: true }),
);

// (2026-10-25, SPEC-less-text.md) `WAITING FOR THE OTHER PLAYER. THE BALL HOLDS STILL UNTIL THEY ARE HERE.` ->
// `WAITING FOR <name>` (the match hands the name in; `THE OTHER PLAYER` is the default).
assert.match(textOf(heldCourt), /WAITING FOR THE OTHER PLAYER/);
assert.doesNotMatch(textOf(heldCourt), /THE BALL HOLDS STILL/);

const duelMatch = render(element(GameMatch, { game: 'paddle-duel', invite: { ...invite, game: 'paddle-duel' }, me, onLeave: () => undefined }));
assert.match(textOf(duelMatch), /MATCH :: bo/);
assert.match(textOf(duelMatch), /FIRST TO 7/, 'the match says what it is playing to');
assert.match(textOf(duelMatch), /DRAG THE COURT\./, 'and the one control the game needs, said once, in the match panel');
assert.match(textOf(duelMatch), /WAITING FOR bo/, 'and the court names who it is waiting for');

console.log(`hub        : ${hubText.includes('[ PLAY SOLO ]') ? 'both games, solo or invited' : 'MISSING'}`);
console.log(`match      : nine plates alone, and the board sealed while the other account is away`);
console.log('arcade     : the hub, the board and the court all draw');
