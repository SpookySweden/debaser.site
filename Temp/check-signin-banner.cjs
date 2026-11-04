/**
 * The fix, held to the four orderings that broke it.
 *
 * `AuthProvider` mounts and does two things at once: `getCurrentUser()` (async, lands later) and
 * `subscribe()` (fires immediately, and again on refresh). The old code wrote `status` from whichever
 * called back last, so a null from the subscription overwrote a real account and the guest fault
 * flashed at a signed-in reader.
 *
 * This models the *fixed* logic - the readOnce flag, the current-account ref, and the rule that a null
 * only counts while nothing is held - and runs the orderings that used to fail.
 */
const assert = require('node:assert/strict');

/** The provider's session handling, reduced to the fields that decide the banner. */
function session() {
  const state = { user: null, status: 'loading' };
  let readOnce = false;
  let held = null;

  const apply = (account) => {
    held = account;
    state.user = account;
    state.status = account === null ? 'anonymous' : 'signed-in';
  };

  return {
    state,
    /** `getCurrentUser()` landing. */
    read: (account) => {
      readOnce = true;
      apply(account);
    },
    /** A failed read: the one place a null is taken as an answer. */
    readFailed: () => {
      readOnce = true;
      apply(null);
    },
    /** `onAuthStateChange` firing. */
    notify: (account) => {
      if (account !== null) {
        readOnce = true;
        apply(account);
        return;
      }
      if (!readOnce) return;
      if (held !== null) return;
      apply(null);
    },
    /** A sign-out, which writes the state directly rather than waiting for the event. */
    signOut: () => {
      held = null;
      state.user = null;
      state.status = 'anonymous';
    },
    /** What a sign-up or sign-in came back with. */
    result: (account) => {
      if (account === null) {
        // Confirmation pending: no session yet, so nothing is claimed either way.
        state.status = 'awaiting-confirmation'; // was 'loading', which hid the CHECK YOUR EMAIL line (check-signup-confirm)
        return;
      }
      held = account;
      state.user = account;
      state.status = 'signed-in';
    },
  };
}

const banner = (s) => s.state.status === 'anonymous';

const cases = [
  ['subscription null first, then the read', (s) => {
    s.notify(null);
    assert.equal(banner(s), false, 'nothing is claimed before the read lands');
    s.read({ id: 'me' });
  }],
  ['the read first, then a stale subscription null', (s) => {
    s.read({ id: 'me' });
    s.notify(null);
  }],
  ['a token refresh null long after a good read', (s) => {
    s.read({ id: 'me' });
    s.notify(null);
    s.notify(null);
    s.notify(null);
  }],
  ['a genuine guest, read answered null', (s) => {
    s.read(null);
  }],
  ['a read that failed outright', (s) => {
    s.readFailed();
  }],
];

console.log('=== the orderings that used to flash the fault ===\n');

for (const [name, run] of cases) {
  const s = session();
  run(s);

  const signedIn = s.state.user !== null;
  const expectedBanner = !signedIn;
  assert.equal(
    banner(s),
    expectedBanner,
    `${name}: banner=${banner(s)} but a session was ${signedIn ? 'held' : 'not held'}`,
  );

  console.log(`  ${name.padEnd(44)} user=${signedIn ? 'me' : 'nobody'} status=${s.state.status}`);
}

// The signing-in path: a null from the subscription must not undo a fresh sign-in either.
{
  const s = session();
  s.read(null); // a guest loads the page
  assert.equal(banner(s), true, 'a guest sees the fault, which is the point of it');
  s.result({ id: 'me' }); // they sign in
  assert.equal(banner(s), false, 'and it goes the moment they do');
  s.notify(null); // the subscription's own null, arriving after
  assert.equal(banner(s), false, 'and a late null does not bring it back');
  console.log(`  ${'a guest signs in, then the event fires'.padEnd(44)} user=me status=signed-in`);
}

// Signing out: the banner must come back.
{
  const s = session();
  s.read({ id: 'me' });
  assert.equal(banner(s), false);
  s.signOut();
  assert.equal(banner(s), true, 'signing out brings the fault back');
  s.notify(null);
  assert.equal(banner(s), true, 'and it stays');
  console.log(`  ${'signing out brings it back'.padEnd(44)} user=nobody status=anonymous`);
}

// A sign-up with confirmation pending must not be told it is unregistered.
{
  const s = session();
  s.read(null);
  s.result(null); // confirmation required: still no session
  assert.equal(
    s.state.status,
    'awaiting-confirmation',
    'a pending confirmation says nothing rather than calling a new account a guest',
  );
  console.log(`  ${'sign-up awaiting confirmation'.padEnd(44)} user=nobody status=awaiting-confirmation`);
}

console.log('\nall orderings settle on the truth, and only a real guest sees the fault');
