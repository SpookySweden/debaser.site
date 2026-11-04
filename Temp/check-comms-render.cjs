/*
 * Scratch render check for the comms screens (run from the root):
 *   npx tsc app/lib/comms/threads.ts app/lib/comms/supabase-comms-repository.ts app/lib/supabase/client.ts --outDir Temp/comms-groups-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/CommsThreadPanel.tsx app/components/CommsConsole.tsx app/components/SidebarComms.tsx app/components/SiteNav.tsx --outDir Temp/render-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-comms-render.cjs
 *
 * (2026-10-25) It used to compile nothing and rely on check-comms.cjs's compile into Temp/render-out - but the
 * runner goes in name order and check-comms.cjs comes AFTER this file, so every run read the previous run's
 * compiled components. That is how this check passed against pre-SPEC-less-text code once the text had
 * changed. It compiles its own components now (check-comms-groups.cjs's line for GROUPS_NEED_MIGRATION, and
 * check-comms.cjs's line plus SidebarComms, which it also draws).
 *
 * What it is for: the states the console and the side panel draw when the store cannot
 * be read, and when the open conversation is a group. Both are markup decisions, so they
 * are checked on the real components - with the provider and the router handed in as
 * stubs, which is the only way to render a state that a read would normally produce.
 */
const assert = require('node:assert/strict');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

function stub(path, exports) {
  const resolved = require.resolve(path);

  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

/** What `useComms` answers, per case. */
let comms = null;

// SidebarComms carries the notices key (<NotificationBell />, since 2026-09-24), which reads the notification
// feed. This check is about the comms rows, so the feed is a quiet one - and a quiet bell draws nothing.
stub('./render-out/components/NotificationsProvider.js', {
  default: ({ children }) => children,
  useNotifications: () => ({ items: [], userId: 'user-a', ready: true, error: null, unread: 0, summary: '', markRead: async () => undefined, markAllRead: async () => undefined, retry: () => undefined }),
});

stub('./render-out/components/CommsProvider.js', {
  default: ({ children }) => children,
  useComms: () => comms,
});

// The side panel's rows navigate; there is no router under a static render.
stub('next/navigation', {
  useRouter: () => ({ push() {} }),
  usePathname: () => '/comms',
  useSearchParams: () => new URLSearchParams(),
});

const CommsConsole = require('./render-out/components/CommsConsole.js').default;
const SidebarComms = require('./render-out/components/SidebarComms.js').default;
const AuthProvider = require('./render-out/components/AuthProvider.js').default;
const PresenceProvider = require('./render-out/components/PresenceProvider.js').default;
const { GROUPS_NEED_MIGRATION } = require('./comms-groups-out/comms/supabase-comms-repository.js');

/** The account and presence providers the names and lamps are drawn from. */
function withSite(element) {
  return renderToStaticMarkup(
    React.createElement(AuthProvider, null, React.createElement(PresenceProvider, null, element)),
  );
}

/** The context, with only the fields a case cares about. */
function context(overrides) {
  return {
    ready: true,
    userId: 'user-a',
    threads: [],
    unreadTotal: 0,
    accounts: [
      { id: 'user-a', email: '', displayName: 'sweden', createdAt: '2026-09-21T09:00:00.000Z', backend: 'supabase' },
      { id: 'user-b', email: '', displayName: 'luke', createdAt: '2026-09-21T09:30:00.000Z', backend: 'supabase' },
    ],
    accountsReady: true,
    nameById: new Map([
      ['user-a', 'sweden'],
      ['user-b', 'luke'],
    ]),
    error: null,
    retry: () => undefined,
    activeThreadId: null,
    setActiveThreadId: () => undefined,
    openThreadWith: async () => ({ id: 'dm:user-a|user-b' }),
    createGroup: async () => ({ id: 'grp:one' }),
    addMember: async () => ({ id: 'grp:one' }),
    send: async () => undefined,
    sendToThread: async () => undefined,
    markRead: async () => undefined,
    simulateIncoming: async () => ({ id: 'dm:user-a|user-b' }),
    source: 'supabase',
    ...overrides,
  };
}

const message = (id, authorId, body) => ({
  id,
  threadId: 'grp:one',
  authorId,
  authorName: authorId,
  body,
  createdAt: '2026-09-21T10:00:00.000Z',
});

const group = {
  id: 'grp:one',
  participants: ['user-a', 'user-b', 'user-z'],
  kind: 'group',
  name: 'THE WARD',
  createdAt: '2026-09-21T09:00:00.000Z',
  updatedAt: '2026-09-21T10:00:00.000Z',
  messages: [message('m1', 'user-b', 'anybody here'), message('m2', 'user-a', 'still here')],
  readAt: { 'user-a': '2026-09-21T10:00:00.000Z' },
};

// 1. A store that cannot be read is said out loud, with a way to ask again.
comms = context({ error: GROUPS_NEED_MIGRATION, retry: () => undefined });
const offline = withSite(React.createElement(CommsConsole, null));
assert.match(offline, /COMMS OFFLINE/, 'the console says the store is not answering');
assert.match(offline, /RETRY/, 'and offers a retry');
// The panel prints the store's own sentence rather than one of its own: whatever the store says,
// the reader reads. This is the string the group buttons fail with.
assert.ok(offline.includes(GROUPS_NEED_MIGRATION), 'with the store\'s own words');

// (2026-11-04) The side panel's list starts folded (`expanded` is false, on purpose: "this is a glance"), and a static
// render cannot press [ COMMS ]. So the fold is opened for real: the state's first `false` in SidebarComms itself
// reads true for that one render, and every row below is what the opened panel draws.
function SidebarOpened() {
  const realUseState = React.useState;
  let armed = true;
  React.useState = (initial) => {
    if (armed && initial === false) {
      armed = false;
      React.useState = realUseState;
      return realUseState(true);
    }
    return realUseState(initial);
  };
  return React.createElement(SidebarComms, null);
}
const openedPanel = () => withSite(React.createElement(SidebarOpened, null));

const foldedPanel = withSite(React.createElement(SidebarComms, null));
assert.match(foldedPanel, /aria-expanded="false"/, 'folded, the panel says it is folded');
assert.doesNotMatch(foldedPanel, /id="sidebar-comms-list"/, 'and draws no list');

const offlinePanel = openedPanel();
assert.match(offlinePanel, /aria-expanded="true"/, 'this render really is the opened panel');
assert.match(offlinePanel, /COMMS OFFLINE/, 'the side panel says so too, rather than "no conversations"');
assert.doesNotMatch(offlinePanel, /NO CONVERSATIONS YET/, 'and does not pretend the account has none');

// 2. An open group: the rail marks it, the page heads it, and it offers a member.
comms = context({ activeThreadId: 'grp:one', threads: [group] });
const open = withSite(React.createElement(CommsConsole, null));
assert.match(open, /\[ GROUP \] THE WARD \[ 3 \]/, 'the rail names the group and counts it');
// (2026-10-25, SPEC-less-text.md) The group bar's `3 / 12 IN THE GROUP :: OWNED BY X` readback is cut to the head
// count `3/12` (the member list below names everyone, and marks the owner).
assert.match(open, />3\/12</, 'the open group counts its members against the limit');
assert.doesNotMatch(open, /IN THE GROUP ::|OWNED BY|YOU OWN IT/, 'without the sentence around the count');
assert.match(open, /\+ ADD MEMBER/, 'and anybody in it can add somebody');
assert.match(open, /COMMS :: THE WARD \[ 3 \]/, 'the panel is headed by the group');
assert.match(open, /anybody here/, 'and the messages are drawn');
// Membership is shown by name, so that adding somebody is visible and not just a number.
// (2026-10-25) Was `IN THE GROUP`, which is cut with the readback: how many are in it is the member chips now.
assert.equal((open.match(/<li class="border border-ink bg-paper px-1">/g) ?? []).length, 3, 'the open group says how many are in it, one chip each');
assert.match(open, /user-z/, 'and names the account that was added');
assert.match(open, /\[ YOU \]/, 'marking which member is the reader');

const groupPanel = openedPanel();
assert.match(groupPanel, /\[ GROUP \] THE WARD \[ 3 \]/, 'the side panel marks it as a group too');

// 3. A direct conversation is unchanged: named after the other account.
const dm = {
  id: 'dm:user-a|user-b',
  participants: ['user-a', 'user-b'],
  kind: 'dm',
  name: '',
  createdAt: '2026-09-21T09:00:00.000Z',
  updatedAt: '2026-09-21T10:00:00.000Z',
  messages: [{ ...message('m1', 'user-b', 'hello'), threadId: 'dm:user-a|user-b' }],
  readAt: {},
};

comms = context({ activeThreadId: dm.id, threads: [dm] });
const direct = withSite(React.createElement(CommsConsole, null));
// (2026-10-23, SPEC-efficiency.md) `TO: name` is cut; the dm's field is addressed to the one account instead.
assert.match(direct, /aria-label="Message [^"]+"/, 'a dm is addressed to one account');
assert.doesNotMatch(direct, /TO:/, 'without a TO: line restating the title');
assert.doesNotMatch(direct, /ADD MEMBER/, 'and a third account would make it a group');
assert.doesNotMatch(direct, /\[ GROUP \]/, 'so nothing marks it as one');
assert.doesNotMatch(direct, /IN THE GROUP/, 'and there is no membership strip to draw');

console.log('comms render checks passed');
console.log('  offline    : console and side panel name the store failure, and offer a retry');
console.log('  group      :', 'THE WARD [ 3 ] in the rail, the panel and the side panel');
console.log('  direct     : still addressed to one account, with no group furniture');
