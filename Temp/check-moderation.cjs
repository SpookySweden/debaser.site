/*
 * Moderation (SPEC-moderation.md): report, block, hide. The database's rules, asked of the live database.
 *   node Temp/check-moderation.cjs        (run it through `npm run checks`)
 *
 * Leaves nothing: the migration is run again (it is written to be re-runnable) and every question is asked inside one block that
 * always ends in an error, so the moderator row, the posts, the block and the report it makes are all rolled back. It acts as the
 * kept TEST ACCOUNTS A (made a moderator inside the block), B (who writes things) and C (who blocks and reports B).
 * MODERATION_CHECK_BREAK=hide runs the same questions with the hidden rule dropped first, which is how this check is shown catching
 * a hidden post that everybody can still read.
 */
const assert = require('node:assert/strict');
const { spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.join(__dirname, '..');
const read = (file) => fs.readFileSync(path.join(ROOT, file), 'utf8').replace(/\r\n/g, '\n');

// The moderation migration, then its report alerts on the bell (both re-runnable).
const MIGRATION = ['supabase/migrations/20261120090000_moderation.sql', 'supabase/migrations/20261120034700_moderation_report_alerts.sql'].map(read).join('\n');
assert.ok(!MIGRATION.includes('$migration_text$'), 'the migration must not use the dollar tag this check wraps it in');
assert.doesNotMatch(MIGRATION, /@[a-z0-9.-]+\.[a-z]+/i, 'the migration names no address (the first moderator is a write by account id, outside the repository)');

/* --- the database's side, rolled back ---------------------------------------------------------------------------------- */
const breakHide = process.env.MODERATION_CHECK_BREAK === 'hide'
  ? 'drop policy if exists "hidden by a moderator" on public.forum_threads;'
  : '';

const as = (who) => `perform set_config('request.jwt.claims', json_build_object('sub', ${who}::text, 'role', 'authenticated')::text, true); set local role authenticated;`;
const back = 'reset role;';
// A thing that must be refused: any error but our own FAIL counts as the refusal.
const q = (text) => text.replace(/'/g, "''");
const refused = (what, sql) => `begin ${sql}; raise exception using message = 'FAIL ${q(what)}', errcode = 'P0099'; exception when sqlstate 'P0099' then raise; when others then null; end;`;
const expect = (what, test) => `if not (${test}) then raise exception 'FAIL ${q(what)}'; end if;`;

const block = `do $check$
declare
  a uuid; b uuid; c uuid;
  t uuid; pc uuid; m uuid; r uuid;
  n integer;
  words text;
  dm text;
begin
  execute $migration_text$${MIGRATION}$migration_text$;
  ${breakHide}

  select id into a from auth.users where lower(email) = 'test-a@debaser.site';
  select id into b from auth.users where lower(email) = 'test-b@debaser.site';
  select id into c from auth.users where lower(email) = 'test-c@debaser.site';
  if a is null or b is null or c is null then raise exception 'FAIL the kept test accounts A, B and C are needed'; end if;
  delete from public.blocks where blocker in (a, b, c) or blocked in (a, b, c);
  delete from public.moderators where user_id in (a, b, c);
  insert into public.moderators (user_id) values (a);
  -- So the refusal below is the block's, not B and C already having a conversation (all rolled back).
  delete from public.comms_threads where kind = 'dm' and ((participant_a = b and participant_b = c) or (participant_a = c and participant_b = b));

  -- B writes a post, a profile comment on C's profile, and a message to A.
  ${as('b')}
  insert into public.forum_threads (title, body, author_id, author_label, anchor_kind, anchor_id, anchor_label, privacy_at_write) values ('moderation check', 'a post to hide', b, 'B', 'board', 'board-general', 'GENERAL BOARD', 'open') returning id into t;
  insert into public.profile_comments (user_id, kind, author_id, author_label, body) values (c, 'profile', b, 'B', 'a comment') returning id into pc;
  ${back}
  ${as('a')}
  select id into dm from public.comms_threads where kind = 'dm' and ((participant_a = a and participant_b = b) or (participant_a = b and participant_b = a));
  if dm is null then
    insert into public.comms_threads (id, participant_a, participant_b, kind, created_by) values ('moderation-check-dm', a, b, 'dm', a);
    dm := 'moderation-check-dm';
  end if;
  ${back}
  ${as('b')}
  insert into public.comms_messages (thread_id, author_id, author_name, body) values (dm, b, 'B', 'a private line') returning id into m;

  -- Not a moderator: B hides nothing, reads no reports or log, bans nobody, adds no moderator.
  ${refused('a non-moderator hid a post', "perform public.moderate_hide('thread', t::text, 'x')")}
  ${refused('a non-moderator banned somebody', "perform public.ban_account(c, 'x')")}
  ${refused('a non-moderator added a moderator', 'perform public.add_moderator(b)')}
  ${refused('an author wrote the hidden mark', 'update public.forum_threads set hidden_at = now() where id = t')}
  if public.is_admin() then raise exception 'FAIL B counts as a moderator'; end if;
  ${back}

  -- A, the moderator, hides the post.
  ${as('a')}
  ${expect('A is a moderator', 'public.is_admin()')}
  perform public.moderate_hide('thread', t::text, 'off topic');
  select count(*) into n from public.forum_threads where id = t and hidden_at is not null;
  ${expect('the moderator still reads the hidden post', 'n = 1')}
  ${refused('a moderator changed the hidden mark without the function', 'update public.forum_threads set hidden_at = null where id = t')}
  ${back}

  ${as('c')}
  select count(*) into n from public.forum_threads where id = t;
  ${expect('a hidden post is gone for everybody else', 'n = 0')}
  ${refused('a report copied a hidden line its reporter cannot read', "perform public.file_report(b, 'spam', '', 'thread', t::text)")}
  ${back}
  set local role anon;
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  select count(*) into n from public.forum_threads where id = t;
  ${expect('a hidden post is gone for visitors', 'n = 0')}
  ${back}

  ${as('b')}
  select count(*) into n from public.forum_threads where id = t and hidden_reason = 'off topic';
  ${expect('the author still reads their hidden post, with the reason', 'n = 1')}
  ${refused('the author unhid their own post', "update public.forum_threads set hidden_at = null, hidden_by = null, hidden_reason = '' where id = t")}
  ${back}

  ${as('a')}
  perform public.moderate_unhide('thread', t::text);
  perform public.block_account(b);
  select count(*) into n from public.forum_threads where id = t;
  ${expect('a block by a moderator hides nothing they moderate', 'n = 1')}
  perform public.unblock_account(b);
  ${refused('a moderator was banned', "perform public.ban_account(a, 'x')")}
  ${back}

  -- C blocks B.
  ${as('c')}
  ${refused('somebody blocked themselves', 'perform public.block_account(c)')}
  ${refused('an account asked about a block between two other people', 'perform public.has_blocked(a, b)')}
  perform public.block_account(b);
  select count(*) into n from public.forum_threads where id = t;
  ${expect("the blocker no longer reads the blocked person's post", 'n = 0')}
  select count(*) into n from public.profile_comments where id = pc;
  ${expect("the blocker no longer reads the blocked person's comment", 'n = 0')}
  select count(*) into n from public.blocks;
  ${expect('the blocker reads their own block', 'n = 1')}
  ${back}

  ${as('a')}
  select count(*) into n from public.forum_threads where id = t;
  ${expect('a block hides nothing from anybody else', 'n = 1')}
  select count(*) into n from public.blocks where blocker = c;
  ${expect('nobody else reads who blocked whom', 'n = 0')}
  ${back}

  ${as('b')}
  select count(*) into n from public.forum_threads where id = t;
  ${expect('the blocked person still reads their own post', 'n = 1')}
  ${refused("the blocked person commented on the blocker's profile", "insert into public.profile_comments (user_id, kind, author_id, author_label, body) values (c, 'profile', b, 'B', 'again')")}
  ${refused('the blocked person opened a conversation with the blocker', "insert into public.comms_threads (id, participant_a, participant_b, kind, created_by) values ('moderation-check-dm-2', b, c, 'dm', b)")}
  ${back}

  -- C reports B from the post (the line comes with it), and can't pull B's private message to A.
  ${as('c')}
  ${refused('a report copied a line its reporter cannot read', "perform public.file_report(b, 'spam', '', 'message', m::text)")}
  ${refused('a report named the wrong account for its line', "perform public.file_report(a, 'spam', '', 'thread', t::text)")}
  ${refused('a report had no reason', "perform public.file_report(b, 'because', '')")}
  r := public.file_report(b, 'spam', 'look', 'thread', t::text);
  ${refused('the same reporter reported the same account twice while open', "perform public.file_report(b, 'nasty', '')")}
  select count(*) into n from public.reports;
  ${expect('a reporter reads no reports, their own included', 'n = 0')}
  ${back}

  ${as('a')}
  select context_text into words from public.reports where id = r;
  ${expect('the report carries the line, copied by the database', "words = 'moderation check :: a post to hide'")}
  select count(*) into n from public.forum_notifications where user_id = a and kind = 'report' and ref = 'report:' || r::text and href = '/forum?reports=1';
  ${expect('a report tells the moderator on the bell, opening REPORTS', 'n = 1')}
  ${back}
  ${as('b')}
  insert into public.forum_notifications (user_id, kind, actor_id, actor_name, body) values (a, 'report', b, 'B', 'a made-up alert');
  ${back}
  select count(*) into n from public.forum_notifications where user_id = a and kind = 'report' and body = 'a made-up alert';
  ${expect('a browser cannot file a report alert of its own', 'n = 0')}
  ${as('b')}
  ${refused('an account that is not banned appealed', "perform public.file_appeal('please')")}
  ${back}
  ${as('a')}
  perform public.ban_account(b, 'spam', r);
  select count(*) into n from public.reports where id = r and state = 'acted';
  ${expect('banning from a report closes it', 'n = 1')}
  ${back}
  ${as('b')}
  perform public.file_appeal('please');
  ${refused('a second appeal while one is open', "perform public.file_appeal('again')")}
  ${expect('the banned person knows their appeal is open', "(select appeal_open and banned and reason = 'spam' from public.my_standing())")}
  ${back}

  -- The log has every step, and nobody can change it.
  select count(*) into n from public.moderation_log where target_id in (t::text, b::text);
  ${expect('the log has the hide, the unhide and the ban', 'n >= 3')}
  ${refused('a log line was changed', 'update public.moderation_log set reason = $$x$$ where target_id = t::text')}
  ${refused('a log line was deleted', 'delete from public.moderation_log where target_id = t::text')}

  raise exception 'ALL-HELD';
end
$check$;`;

const file = path.join(ROOT, 'Temp', '.check-moderation.sql');
fs.writeFileSync(file, block);
let answer;
try {
  answer = spawnSync(process.execPath, ['scripts/db.cjs', '--write', '--file', file], { cwd: ROOT, encoding: 'utf8', maxBuffer: 2 ** 24 });
} finally {
  fs.rmSync(file, { force: true });
}
const words = `${answer.stdout}\n${answer.stderr}`.replace(/raise exception '[^']*'/g, '').replace(/message = 'FAIL [^']*'/g, '');
const failed = /FAIL ([^"\n\\]*)/.exec(words);
assert.equal(failed?.[1] ?? null, null, `the moderation rules let this through: ${failed?.[1]}`);
assert.match(words, /ALL-HELD/, `the block did not finish: ${words.slice(-600)}`);
console.log('  ok    hide, block, report, appeal and the log hold on the live database (rolled back)');

/* --- the code's side -------------------------------------------------------------------------------------------------- */
const admin = read('app/components/ForumModerationControls.tsx');
assert.doesNotMatch(admin.slice(admin.indexOf('export function useAdmin'), admin.indexOf('function failure')), /isSiteAccount/,
  'who moderates is the moderator list, not the house account');
console.log('  ok    the board asks the moderator list, not the house account');

console.log('moderation: the rules hold, and nothing was left behind.');
