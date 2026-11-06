/**
 * Who counts as having lost an account (app/lib/auth/lost-account.ts, 2026-11-06), and the migration's promises.
 *   npx tsc app/lib/auth/lost-account.ts --outDir Temp/out-lost-account --rootDir app --module commonjs --target es2022 --lib es2022,dom --skipLibCheck --esModuleInterop --moduleResolution node
 *   node Temp/check-lost-account.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { lostAccountFrom, parseLostAccount } = require(path.join(__dirname, 'out-lost-account', 'lib', 'auth', 'lost-account.js'));

const session = (user) => JSON.stringify({ access_token: 'secret-token', refresh_token: 'secret-too', user });
assert.deepEqual(lostAccountFrom(session({ email: 'a@b.c', created_at: '2026-09-21T00:00:00Z', user_metadata: { display_name: ' Bingle ' } })), { email: 'a@b.c', name: 'Bingle' }, 'an old account: its address and name');
assert.deepEqual(lostAccountFrom(session({ email: 'bingle@b.c', created_at: '2026-09-21T00:00:00Z' })), { email: 'bingle@b.c', name: 'bingle' }, 'no name saved: from the address');
assert.equal(JSON.stringify(lostAccountFrom(session({ email: 'a@b.c', created_at: '2026-09-21T00:00:00Z' }))).includes('token'), false, 'never a token');
assert.equal(lostAccountFrom(session({ email: 'a@b.c', created_at: '2026-11-06T21:24:01Z' })), null, 'an account made after the loss is alive');
assert.equal(lostAccountFrom(session({ email: 'a@b.c' })), null, 'no date: not assumed lost');
assert.equal(lostAccountFrom(session({ created_at: '2026-09-21T00:00:00Z', is_anonymous: true })), null, 'a guest has nothing to get back');
assert.equal(lostAccountFrom(session({ email: 'a@b.c', created_at: '2026-09-21T00:00:00Z', is_anonymous: true })), null);
assert.equal(lostAccountFrom(null), null);
assert.equal(lostAccountFrom('not json'), null);
assert.equal(parseLostAccount('{"email":1}'), null);

const root = path.join(__dirname, '..');
const migration = fs.readFileSync(path.join(root, 'supabase/migrations/20261106223000_lost_accounts.sql'), 'utf8');
assert.doesNotMatch(migration, /@(gmail|proton)\./, 'no address of anybody in this public repository');
assert.match(migration, /join public\.house_account h/, 'admin needs the row, not just the address');
assert.match(migration, /exception when others then/, 'a failed restore never stops a sign-up');
for (const table of ['house_account', 'house_account_gate', 'account_restores']) {
  assert.match(migration, new RegExp(`alter table public\\.${table} enable row level security`), table);
  assert.match(migration, new RegExp(`revoke all on public\\.${table} from anon, authenticated`), table);
}
const client = fs.readFileSync(path.join(root, 'app/lib/supabase/client.ts'), 'utf8');
assert.ok(client.indexOf('parkLostSession(supabaseAuthStorageKey()') < client.indexOf('browserClient = createClient'), 'the dead session is moved before any client can wipe it');
console.log('lost account checks passed');
