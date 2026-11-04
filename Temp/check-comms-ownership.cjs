/*
 * Scratch check for group ownership (run from the root):
 *   npx tsc app/lib/comms/threads.ts app/lib/comms/mock-comms-repository.ts --outDir Temp/ownership-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop
 *   npx tsc app/components/CommsGroupBar.tsx --outDir Temp/ownership-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-comms-ownership.cjs
 *
 * The report this exists for: somebody who was invited to a group renamed it and claimed it as
 * his own. Both are a write to `public.comms_threads` - `name` and `created_by` - and the
 * update policy allowed either, because it asked only "are you in this conversation".
 *
 * So the rule is checked at both ends, because a rule kept in one of them is not kept:
 *
 *   1. the store: a member cannot rename, hand over, remove a member or add themselves; the
 *      owner can, and ownership moves two ways - a hand-over, or the owner leaving;
 *   2. the database, read as source: the column grant, the guard trigger and the four functions
 *      are asserted to be there, and the permissive update policy is asserted to be there *too*
 *      - sending a message stamps the conversation, and a fix that broke that would be worse
 *      than the hole it closed.
 */
const assert = require('node:assert/strict');
const { readFileSync, existsSync } = require('node:fs');

const { isGroupOwner, nextGroupOwner, openedThread } = require('./ownership-out/comms/threads.js');
const { getMockCommsRepository } = require('./ownership-out/comms/mock-comms-repository.js');

const OWNER = 'user-owner';
const MEMBER = 'user-member';
const THIRD = 'user-third';
const STRANGER = 'user-stranger';

/** The refusals a screen may print as-is. */
const REFUSED =
  /ONLY THE OWNER MAY CHANGE THIS GROUP|ONLY THE ACCOUNT THAT OPENED A GROUP CAN ADD ITSELF|YOU ARE NOT IN THIS GROUP|A GROUP CAN ONLY BE HANDED TO SOMEBODY IN IT/;

async function refused(what, work) {
  try {
    await work();
  } catch (caught) {
    assert.match(caught.message, REFUSED, `${what}: refused, and for the right reason (${caught.message})`);
    return;
  }

  assert.fail(`${what}: was allowed, and it should not have been`);
}

(async () => {
  // 1. The rules the screens read to decide what to draw at all.

  const group = { kind: 'group', ownerId: OWNER };
  const dm = { kind: 'dm', ownerId: null };

  assert.equal(isGroupOwner(group, OWNER), true, 'the opener owns the group');
  assert.equal(isGroupOwner(group, MEMBER), false, 'a member does not');
  assert.equal(isGroupOwner(group, null), false, 'nor does nobody');
  assert.equal(isGroupOwner(dm, OWNER), false, 'a dm has no owner to be');
  assert.equal(openedThread(group, OWNER), true, 'the opener opened it');
  assert.equal(openedThread(group, MEMBER), false);

  assert.equal(nextGroupOwner([OWNER, MEMBER, THIRD], OWNER), MEMBER, 'the next member in order takes over');
  assert.equal(nextGroupOwner([MEMBER], MEMBER), null, 'and nobody is left when the last one goes');
  assert.equal(nextGroupOwner([THIRD, MEMBER], MEMBER), THIRD, 'the order the store keeps is the order it uses');


  // 2. The store: the in-browser one, which is where a rule is easiest to forget.

  const comms = getMockCommsRepository();
  await comms.clearLocalThreads?.();

  const created = await comms.createGroup({
    creatorId: OWNER,
    creatorName: 'owner',
    name: 'THE GROUP',
    memberIds: [MEMBER, THIRD],
  });

  assert.equal(created.ownerId, OWNER, 'the account that opened it owns it');
  assert.equal(created.name, 'THE GROUP');

  // A member can talk, and may add somebody: that is what being in a group is for.
  await comms.sendMessage({ threadId: created.id, authorId: MEMBER, authorName: 'member', body: 'hello' });
  const added = await comms.addMember(created.id, STRANGER, MEMBER);
  assert.equal(added.participants.includes(STRANGER), true, 'a member may add somebody else');

  // A member cannot change the group, take anybody out, or add themselves to it.
  await refused('a member renaming', () => comms.renameGroup(created.id, 'DEMZOU WAS HERE', MEMBER));
  await refused('a member claiming ownership', () => comms.transferGroupOwnership(created.id, MEMBER, MEMBER));
  await refused('a member removing the owner', () => comms.removeMember(created.id, OWNER, MEMBER));
  await refused('a stranger adding themselves', () => comms.addMember(created.id, 'user-outsider', 'user-outsider'));

  const afterAttempts = (await comms.listThreads(OWNER)).find((thread) => thread.id === created.id);
  assert.equal(afterAttempts.name, 'THE GROUP', 'the name is untouched by the attempts');
  assert.equal(afterAttempts.ownerId, OWNER, 'and so is the owner');

  // The owner may rename, and an empty name is refused whoever asks.
  const renamed = await comms.renameGroup(created.id, 'RENAMED BY THE OWNER', OWNER);
  assert.equal(renamed.name, 'RENAMED BY THE OWNER');
  await assert.rejects(() => comms.renameGroup(created.id, '   ', OWNER), /A GROUP NEEDS A NAME/);

  // Handing it over: to somebody in the group, and then it is theirs.
  await refused('handing it to an outsider', () => comms.transferGroupOwnership(created.id, 'user-outsider', OWNER));

  const handed = await comms.transferGroupOwnership(created.id, MEMBER, OWNER);
  assert.equal(handed.ownerId, MEMBER, 'the group changes hands');

  // Leaving: anybody may, a member's exit moves nothing, the owner's exit hands the group on,
  // and the last one out closes it.
  const leftThird = await comms.leaveGroup(created.id, THIRD);
  assert.equal(leftThird.ownerId, MEMBER, 'a member leaving does not move ownership');

  // Succession, on a group small enough to read: the owner goes, the member who is left has it.
  const two = await comms.createGroup({
    creatorId: OWNER,
    creatorName: 'owner',
    name: 'SUCCESSION',
    memberIds: [MEMBER],
  });

  const succeeded = await comms.leaveGroup(two.id, OWNER);
  assert.notEqual(succeeded, null);
  assert.equal(succeeded.ownerId, MEMBER, 'the owner leaving hands it on');
  assert.equal(succeeded.participants.includes(OWNER), false, 'and the leaver is out of it');

  // The last one out closes the group: nobody could read it after that anyway.
  const last = await comms.leaveGroup(two.id, MEMBER);
  assert.equal(last, null, 'the last member out closes the group');
  assert.equal(
    (await comms.listThreads(MEMBER)).some((thread) => thread.id === two.id),
    false,
    'and it is gone',
  );

  await refused('the old owner renaming it afterwards', () => comms.renameGroup(created.id, 'MINE AGAIN', OWNER));
  assert.equal((await comms.renameGroup(created.id, 'THEIR GROUP', MEMBER)).name, 'THEIR GROUP', 'the new owner may');

  // 3. The database, read as source.
  //
  // The live project cannot be changed from this check - the privileges that would let it are
  // exactly the ones being taken away - so the migration is read instead: what it says, and
  // that the schema carries the same words.
  const MIGRATION = 'supabase/migrations/20260922000016_group_ownership.sql';
  assert.equal(existsSync(MIGRATION), true, 'the ownership migration exists');

  for (const file of [MIGRATION, 'supabase/schema.sql']) {
    const sql = readFileSync(file, 'utf8');
    const said = (pattern, what) => assert.match(sql, pattern, `${file}: ${what}`);

    said(/revoke update on public\.comms_threads from anon, authenticated;/, 'clients lose the whole row');
    said(/grant update \(updated_at\) on public\.comms_threads to authenticated;/, 'and keep the one column they write');

    said(/create or replace function public\.is_comms_owner\(thread text\)/, 'ownership is asked one way, in one function');
    said(/create or replace function public\.comms_threads_guard_metadata\(\)/, 'the guard function is there');
    said(/create trigger comms_threads_guard_metadata\r?\n\s*before update on public\.comms_threads/, 'and is attached');
    said(/raise exception 'only the owner of a group may change it'/, 'and refuses anybody else');
    said(/public\.is_admin\(\)/, 'with the house account able to repair what was taken');

    said(/create or replace function public\.rename_group\(thread text, new_name text\)/, 'renaming is a function');
    said(/create or replace function public\.transfer_group_ownership\(thread text, to_user uuid\)/, 'so is handing over');
    said(/create or replace function public\.leave_group\(thread text\)/, 'and leaving');
    said(/create or replace function public\.remove_group_member\(thread text, user_id uuid\)/, 'and removing a member');

    // The five definer functions: ownership is asked, renamed, handed over, left and removed
    // through them, so the column grant cannot lock the app out of its own group.
    assert.equal(
      (sql.match(/security definer/g) ?? []).length >= 5,
      true,
      `${file}: the functions may write what clients may not`,
    );

    said(/order by m\.joined_at, m\.user_id/, 'the group passes to whoever has been in it longest');
    said(/delete from public\.comms_threads t where t\.id = thread;/, 'and the last member out closes it');
    said(/created_by = auth\.uid\(\)/, 'a group can still be opened by its creator');
    said(
      /user_id = auth\.uid\(\) and public\.is_comms_owner\(thread_id\)/,
      'and nobody adds themselves to a group they were not invited to',
    );

    // The permissive update policy stays: sending a message stamps `updated_at`, and the
    // column grant - not the policy - is what stops a member touching the metadata.
  }

  assert.match(
    readFileSync('supabase/schema.sql', 'utf8'),
    /create policy "comms threads update by participant"/,
    'the schema still creates the update policy messaging needs',
  );

  // 4. The strip itself: what a member is shown, and what only the owner is.
  //
  // Hiding a control is not the protection - the API is what is protected - but a member being
  // *offered* a rename box on somebody else's group is what made the take-over look like a
  // feature, so this is asserted as well as the store behind it.

  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');

  // The names in the strip are drawn by `ProfileName`, which asks the presence store who is
  // about: a stub says nobody, which is what a name needs to be drawn at all.
  const presencePath = require.resolve('./ownership-render/components/PresenceProvider.js');
  require.cache[presencePath] = {
    id: presencePath,
    filename: presencePath,
    loaded: true,
    exports: {
      default: ({ children }) => children,
      usePresence: () => ({ ready: true, status: 'offline', record: undefined }),
      usePresenceDirectory: () => ({ ready: true, statusFor: () => 'offline', recordFor: () => undefined }),
    },
  };

  const CommsGroupBar = require('./ownership-render/components/CommsGroupBar.js').default;

  const barThread = {
    id: 'grp:1',
    participants: [MEMBER, OWNER, STRANGER],
    kind: 'group',
    name: 'THE GROUP',
    ownerId: OWNER,
    createdAt: '2026-09-21T10:00:00.000Z',
    updatedAt: '2026-09-21T10:00:00.000Z',
    messages: [],
    readAt: {},
  };

  const bar = (userId) =>
    renderToStaticMarkup(
      React.createElement(CommsGroupBar, {
        thread: barThread,
        userId,
        nameFor: (id) => id.replace('user-', ''),
        accounts: [{ id: 'user-outsider', displayName: 'outsider', createdAt: '2026-01-01T00:00:00.000Z' }],
        onAdd: async () => undefined,
        onRename: async () => undefined,
        onHandOver: async () => undefined,
        onRemove: async () => undefined,
        onLeave: async () => undefined,
      }),
    );

  const ownersView = bar(OWNER);
  assert.match(ownersView, />\[ RENAME \]</, 'the owner is offered the rename');
  assert.match(ownersView, /\[ HAND OVER \]/, 'and the hand-over');
  // (2026-10-25, SPEC-less-text.md) The header readback `3 / 8 IN THE GROUP :: YOU OWN IT` (or `OWNED BY X`)
  // is cut to the head count `3/8`: the member list's `[ OWNER ]` marker is what says whose group it is.
  assert.doesNotMatch(ownersView, /YOU OWN IT|IN THE GROUP ::/, 'without the ownership readback');
  assert.match(ownersView, />3\/\d+</, 'the header is the head count alone');
  assert.match(ownersView, /\[ YOU \]<\/span><span[^>]*>\[ OWNER \]/, 'and the owner is marked in the member list as themselves');
  assert.equal((ownersView.match(/>remove</g) ?? []).length, 2, 'and a remove control on the other members');

  // Their own chip carries no remove: taking yourself out is leaving, which is a button.
  const ownChip = ownersView.slice(ownersView.indexOf('[ OWNER ]'));
  assert.doesNotMatch(ownChip.slice(0, ownChip.indexOf('</li>')), /remove/, 'but never on themselves');

  const membersView = bar(MEMBER);
  assert.doesNotMatch(membersView, /\[ RENAME \]/, 'a member is not offered the rename');
  assert.doesNotMatch(membersView, /\[ HAND OVER \]/, 'nor the hand-over');
  assert.doesNotMatch(membersView, />remove</, 'nor the power to take anybody out');
  // (2026-10-25, SPEC-less-text.md) `OWNED BY OWNER` is cut with the readback: the owner's chip says it.
  assert.doesNotMatch(membersView, /OWNED BY/, 'without the readback');
  const ownerChip = (membersView.match(/<li[^>]*>(?:(?!<\/li>)[\s\S])*\[ OWNER \][\s\S]*?<\/li>/) ?? [''])[0];
  assert.match(ownerChip, />owner</, 'and is shown whose group it is by the [ OWNER ] mark on that member');
  assert.doesNotMatch(ownerChip, /\[ YOU \]/, 'which is not their own chip');
  assert.match(membersView, /\[ LEAVE GROUP \]/, 'while leaving stays theirs');
  assert.match(membersView, /\[ \+ ADD MEMBER \]/, 'and adding somebody is still any member s');

  console.log('group ownership checks passed');
  console.log('  rules      : the opener owns it; nobody else renames, hands over or removes');
  console.log('  leaving    : passes to the next member, and the last one out closes the group');
  console.log('  database   : one writable column, a guard trigger, and four checked functions');
})().catch((error) => {
  console.error('ownership check failed:', error.message);
  process.exitCode = 1;
});

