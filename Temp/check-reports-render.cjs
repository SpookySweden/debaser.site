/*
 * SPEC-moderation.md's two windows, rendered with their real code and fake data (no network, no database): REPORT, the form a
 * person files a report with, and REPORTS, the moderators' window. What each person sees, and that each key asks the store for
 * the right thing.
 *   npx tsc app/components/ReportWindow.tsx app/components/ReportsWindow.tsx --rootDir app --outDir Temp/reports-render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-reports-render.cjs
 *
 * A server render draws a first paint only, and both windows read their rows in an effect. So, as in check-owed-renders:
 * `seeds` start a component's own `useState` where the rows have arrived, the effects the render asked for are kept and run by
 * hand, and a key's real `onClick` is called.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const jsxRuntime = require('react/jsx-runtime');
const { renderToStaticMarkup } = require('react-dom/server');

const OUT = path.join(__dirname, 'reports-render-out');
const el = React.createElement;

function stub(file, exports) {
  const resolved = require.resolve(file.startsWith('next/') ? file : path.join(OUT, file));
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports: { __esModule: true, ...exports } };
}

/* --- the harness ------------------------------------------------------------------------------------ */

let drawn = [];
for (const name of ['jsx', 'jsxs']) {
  const real = jsxRuntime[name];
  jsxRuntime[name] = (type, props, key) => {
    if (typeof type === 'string') drawn.push({ type, props });
    return real(type, props, key);
  };
}

let effects = [];
React.useEffect = (effect) => {
  effects.push(effect);
};

const realUseState = React.useState;
let seeds = {};
let stateCalls = new Map();
React.useState = (initial) => {
  const value = typeof initial === 'function' ? initial() : initial;
  const owner = /at (\w+) /.exec(new Error().stack.split('\n')[2] ?? '')?.[1] ?? '';
  const position = stateCalls.get(owner) ?? 0;
  stateCalls.set(owner, position + 1);
  const seeded = seeds[owner]?.[position];
  return realUseState(() => (seeded === undefined ? value : seeded));
};

function draw(element, seedsFor = {}) {
  drawn = [];
  effects = [];
  seeds = seedsFor;
  stateCalls = new Map();
  return renderToStaticMarkup(element);
}

const textOf = (node) => {
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  return node?.props ? textOf(node.props.children) : '';
};
const keys = () => drawn.filter(({ props }) => props.onClick).map(({ props }) => textOf(props.children));
function press(name, nth = 0) {
  const found = drawn.filter(({ props }) => props.onClick && textOf(props.children) === name);
  assert.ok(found[nth], `no key "${name}" on the screen`);
  return found[nth].props.onClick();
}
const tick = () => new Promise((resolve) => setImmediate(resolve));
const visible = (html) =>
  html
    .replace(/<[^>]*>/g, ' ')
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&amp;/g, '&')
    .replace(/\s+/g, ' ')
    .trim();

/* --- the fakes ------------------------------------------------------------------------------------- */

const ME = 'mod-1';
const auth = { user: { id: ME } };
const moderation = { role: { moderator: true, owner: true }, refresh: () => undefined };
const windows = { reportsOpen: true, target: null };

const calls = [];
const record = (name) => async (...args) => {
  calls.push([name, ...args]);
};
const store = {
  fileReport: record('fileReport'),
  hide: record('hide'),
  ban: record('ban'),
  unban: record('unban'),
  dismissReport: record('dismissReport'),
  addModerator: record('addModerator'),
  removeModerator: record('removeModerator'),
  listReports: async (tab) => {
    calls.push(['listReports', tab]);
    return [];
  },
  listLog: async () => {
    calls.push(['listLog']);
    return [];
  },
  listModerators: async () => [],
};

stub('components/AuthProvider.js', { useAuth: () => auth });
stub('components/ModerationProvider.js', { useModeration: () => moderation });
stub('components/DockWindow.js', {
  default: ({ title, children }) => el('section', { 'aria-label': title }, el('h2', null, title), children),
});
stub('lib/moderation/repository.js', { getModerationStore: () => store });
stub('lib/auth/auth-repository.js', { getAuthRepository: () => ({ listAccounts: async () => [] }) });
stub('lib/moderation/moderation-windows.js', {
  closeReport: () => undefined,
  closeReports: () => undefined,
  openReports: () => undefined,
  subscribeToReportWindow: () => () => undefined,
  subscribeToReportsWindow: () => () => undefined,
  reportWindowState: () => ({ target: windows.target }),
  reportWindowServerState: () => ({ target: windows.target }),
  reportsWindowState: () => ({ open: windows.reportsOpen }),
  reportsWindowServerState: () => ({ open: windows.reportsOpen }),
});
stub('next/link', { default: ({ href, children, className }) => el('a', { href, className }, children) });
stub('next/navigation', {
  usePathname: () => '/forum',
  useRouter: () => ({ replace: () => undefined, push: () => undefined }),
  useSearchParams: () => new URLSearchParams(),
});

const ReportWindow = require('./reports-render-out/components/ReportWindow.js').default;
const ReportsWindow = require('./reports-render-out/components/ReportsWindow.js').default;

/* --- REPORT: the form --------------------------------------------------------------------------------- */

windows.target = null;
assert.equal(draw(el(ReportWindow)), '', 'nothing asked to be reported: no window');
windows.target = { accountId: 'acct-9', name: 'TROLLFACE', context: { kind: 'reply', id: 'reply-3', text: 'a rude line' } };
auth.user = null;
assert.equal(draw(el(ReportWindow)), '', 'signed out: no window, since a report needs a reporter');
auth.user = { id: ME };

let page = visible(draw(el(ReportWindow)));
assert.match(page, /^REPORT TROLLFACE a rude line/, 'the window names the person and carries the line it was opened from');
assert.deepEqual(keys(), ['[ SPAM ]', '[ HARASSMENT ]', '[ NASTY ]', '[ OTHER ]', 'SEND REPORT'], 'the four reasons and SEND');
assert.match(page, /MORE \(OPTIONAL\)/);

(async () => {
  calls.length = 0;
  await press('SEND REPORT');
  assert.deepEqual(calls, [], 'no reason picked: nothing is sent');

  // A reason picked and a line typed (the form's own state), then SEND: the report the store is handed.
  draw(el(ReportWindow), { ReportForm: ['harassment', '  keeps doing it  '] });
  await press('SEND REPORT');
  assert.deepEqual(
    calls,
    [['fileReport', ME, { accountId: 'acct-9', reason: 'harassment', note: 'keeps doing it', context: windows.target.context }]],
    'the reporter, the person, the reason, the trimmed note and the line',
  );
  page = visible(draw(el(ReportWindow), { ReportForm: [null, '', false, true] }));
  assert.match(page, /REPORT SENT\./, 'once sent, it says so');
  assert.deepEqual(keys(), ['[ CLOSE ]']);

  /* --- REPORTS: the moderators' window ------------------------------------------------------------- */

  moderation.role = { moderator: false, owner: false };
  assert.equal(draw(el(ReportsWindow)), '', 'not a moderator: REPORTS never draws, even when asked to open');
  moderation.role = { moderator: true, owner: true };
  windows.reportsOpen = false;
  assert.equal(draw(el(ReportsWindow)), '', 'shut: nothing');
  windows.reportsOpen = true;

  calls.length = 0;
  page = visible(draw(el(ReportsWindow)));
  assert.match(page, /^REPORTS OPEN \[ DONE \] \[ LOG \] \[ MODERATORS \] NOTHING WAITING\./, 'a moderator opens it on OPEN, empty');
  for (const effect of effects.splice(0)) effect();
  await tick();
  assert.deepEqual(calls.filter(([name]) => name === 'listReports'), [['listReports', 'open']], 'OPEN reads the open reports');

  const accounts = [
    { id: 'acct-9', displayName: 'TROLLFACE', hidden: false },
    { id: 'rep-1', displayName: 'KINDPERSON', hidden: false },
    { id: ME, displayName: 'SWEDEN', hidden: false },
  ];
  const at = '2026-11-20T10:00:00.000Z';
  const reports = [
    { id: 'r1', kind: 'report', reporterId: 'rep-1', accountId: 'acct-9', reason: 'harassment', note: 'keeps doing it', context: { kind: 'thread', id: 't-1', text: 'a rude post' }, state: 'open', handledAt: null, createdAt: at },
    { id: 'r2', kind: 'report', reporterId: 'rep-1', accountId: 'acct-9', reason: 'spam', note: '', context: { kind: 'room_line', id: 'line-1', text: 'buy coins', private: true }, state: 'open', handledAt: null, createdAt: at },
    { id: 'r3', kind: 'appeal', reporterId: null, accountId: 'acct-9', reason: null, note: 'sorry', context: null, state: 'open', handledAt: null, createdAt: at },
  ];
  // ReportsBody's state: tab, reports, log, accounts, error, asked.
  page = visible(draw(el(ReportsWindow), { ReportsBody: ['open', reports, [], accounts] }));
  assert.match(page, /TROLLFACE · HARASSMENT · FROM KINDPERSON/, 'who was reported, why, and by whom');
  assert.match(page, /keeps doing it POST a rude post/, "the reporter's note and the line, named by kind");
  assert.match(page, /ROOM CHAT · PRIVATE: THIS LINE ONLY buy coins/, 'a private line is marked as private');
  assert.match(page, /APPEAL FROM TROLLFACE/);
  assert.deepEqual(
    keys().filter((name) => !name.startsWith('[ DONE') && !name.startsWith('[ LOG') && !name.startsWith('[ MOD') && name !== 'OPEN'),
    ['[ HIDE ]', '[ BAN ]', '[ DISMISS ]', '[ BAN ]', '[ DISMISS ]', '[ UNBAN ]', '[ DISMISS ]'],
    'a public post can be hidden; a private line cannot, even a kind that can be (only the person banned); an appeal is answered with UNBAN',
  );
  assert.match(page, /REASON \(SHOWN TO THEM ON A HIDE OR BAN\)/);

  calls.length = 0;
  await press('[ HIDE ]');
  await press('[ BAN ]', 0);
  await press('[ UNBAN ]');
  await press('[ DISMISS ]', 1);
  assert.deepEqual(calls, [
    ['hide', ME, 'thread', 't-1', '', 'r1', { authorId: 'acct-9', text: 'a rude post' }],
    ['ban', ME, 'acct-9', '', 'r1'],
    ['unban', ME, 'acct-9', 'r3'],
    ['dismissReport', ME, 'r2', ''],
  ], 'each key hands the store the report it sits under');

  // DONE: a handled report says how, and offers nothing more to do.
  page = visible(draw(el(ReportsWindow), { ReportsBody: ['done', [{ ...reports[0], state: 'acted', handledAt: at }], [], accounts] }));
  assert.match(page, /ACTED ON/);
  assert.doesNotMatch(page, /\[ BAN \]|\[ HIDE \]|\[ DISMISS \]/, 'nothing left to press on a handled report');

  // LOG: every moderator action, with its reason and the words it was about.
  const log = [{ id: 'l1', at, actorId: ME, action: 'hide', targetKind: 'reply', targetId: 'x', targetAccountId: 'acct-9', reason: 'rude', excerpt: 'a rude line' }];
  page = visible(draw(el(ReportsWindow), { ReportsBody: ['log', [], log, accounts] }));
  assert.match(page, /SWEDEN HID REPLY BY TROLLFACE REASON: rude “a rude line”/);

  // MODERATORS: only the owner adds and takes off.
  const rows = [{ id: ME, owner: true, addedAt: at }, { id: 'rep-1', owner: false, addedAt: at }];
  page = visible(draw(el(ReportsWindow), { ReportsBody: ['moderators', [], [], accounts], Moderators: [rows] }));
  assert.match(page, /SWEDEN OWNER KINDPERSON \[ TAKE OFF \]/);
  assert.match(page, /ADD PICK SOMEBODY TROLLFACE/, 'the owner may add somebody who is not a moderator yet');
  moderation.role = { moderator: true, owner: false };
  page = visible(draw(el(ReportsWindow), { ReportsBody: ['moderators', [], [], accounts], Moderators: [rows] }));
  assert.doesNotMatch(page, /TAKE OFF|MAKE MODERATOR/, 'a moderator who is not the owner only reads the list');

  console.log('check-reports-render: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
