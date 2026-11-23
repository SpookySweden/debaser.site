/*
 * BROWSER's kept pages, notes, history, tabs and the visit record's writer, against the live database with the kept test accounts A and B (hidden from
 * every list): the code the site uses, and what others are refused. What it makes, it deletes. (The rules themselves were tried whole, undone,
 * before they were applied: 28 cases, 2026-11-23.)  Short; one session at a time.
 *
 *   npm run checks -- --only check-seeing     (compiles what this uses)
 *   node scripts/see-pages-live.cjs
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');
const { testAccountClient } = require('./browser.cjs');

const ROOT = path.join(__dirname, '..');
/** A TypeScript file of the site's as it is, with its neighbours. */
const made = new Map();
function load(file, stubs = {}) {
  const full = path.join(ROOT, file);
  if (made.has(full)) return made.get(full).exports;
  const module_ = { exports: {} };
  made.set(full, module_);
  const { outputText } = ts.transpileModule(fs.readFileSync(full, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } });
  new Function('module', 'exports', 'require', outputText)(module_, module_.exports, (name) => {
    if (!name.startsWith('.')) return require(name);
    const next = path.relative(ROOT, path.resolve(path.dirname(full), name)).replace(/\\/g, '/');
    return stubs[next] ?? load(`${next}.ts`, stubs);
  });
  return module_.exports;
}
let passed = 0;
const ok = (value, what) => {
  assert.ok(value, what);
  passed += 1;
  console.log(`  ok  ${what}`);
};

(async () => {
  const A = await testAccountClient('A');
  const B = await testAccountClient('B');
  process.env.NEXT_PUBLIC_SEEING_DATA_SOURCE = 'supabase';
  const { createSupabasePages } = load('app/lib/seeing/supabase-pages-repository.ts');
  const mine = createSupabasePages(A.client);
  const theirs = createSupabasePages(B.client);
  let who = A.client;
  const account = load('app/lib/seeing/account.ts', { 'app/lib/supabase/client': { isSupabaseConfigured: true, getSupabaseBrowserClient: () => who } });
  const stamp = Date.now();
  const page = { id: crypto.randomUUID(), ownerId: A.id, ownerLabel: 'FORGED', address: `https://seeing-live.example/${stamp}`, title: 'A live proof', description: '', site: 'seeing-live.example', picture: null, language: 'en', date: '2026-11-23', at: stamp, tags: ['PROOF'], note: '', quotes: ['a quote'], hasCopy: true, private: false };
  const noteId = crypto.randomUUID();
  try {
    await mine.keep(page, { html: '<p>the copy</p>', reading: '<p>the words</p>', title: 'A live proof' });
    const seen = (await theirs.list(B.id)).find((each) => each.id === page.id);
    ok(seen !== undefined && seen.ownerId === A.id && seen.ownerLabel !== 'FORGED' && seen.tags[0] === 'PROOF' && seen.date === '2026-11-23', "another account reads the card, under its maker's real name");
    ok((await theirs.copyOf(page.id, B.id))?.html === '<p>the copy</p>', 'and its copy');
    await theirs.remove(page).catch(() => undefined);
    ok((await mine.list(A.id)).some((each) => each.id === page.id) && (await mine.copyOf(page.id, A.id)) !== null, 'and can delete neither');
    ok((await B.client.from('seen_pages').update({ title: 'x' }).eq('id', page.id)).error !== null, 'nor change it');
    ok((await B.client.storage.from('seen').upload(`${A.id}/${page.id}x`, new Blob(['{}'], { type: 'application/json' }))).error !== null, "nor put a file in another's folder");
    const { createClient } = require('@supabase/supabase-js');
    const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    ok((await visitor.from('seen_pages').select('id').eq('id', page.id)).data?.length === 1, 'a visitor reads the card');
    ok((await visitor.storage.from('seen').download(`${A.id}/${page.id}`)).error !== null, 'and not the copy');
    ok((await visitor.from('seen_notes').select('id').limit(1)).error !== null, 'nor the notes');

    ok(await account.addSharedNote({ id: noteId, page: page.address, quote: 'a quote', note: 'a note', at: stamp }), 'a note is written');
    who = B.client;
    const notes = await account.notesOnPage(page.address);
    ok(notes.length === 1 && notes[0].ownerId === A.id && notes[0].note === 'a note', 'and read by another account on that page');
    await account.deleteSharedNote(noteId);
    ok(!(await account.hideSeen('note', noteId)), 'who can not hide it');
    ok((await account.notesOnPage(page.address)).length === 1, 'nor delete it');

    who = A.client;
    const row = { address: page.address, title: 'T', at: stamp, from: null };
    await account.addToAccountHistory([row]);
    ok((await account.accountHistory()).some((each) => each.address === page.address && each.at === stamp), 'history is kept on the account, to the millisecond');
    who = B.client;
    ok(!(await account.accountHistory()).some((each) => each.address === page.address), 'and nobody else reads it');
    who = A.client;
    await account.forgetInAccountHistory(row);
    ok(!(await account.accountHistory()).some((each) => each.address === page.address), 'and it is forgotten');
    const before = await account.accountTabs();
    const { freshTabs, visit } = load('app/lib/seeing/tabs.ts');
    const tabs = visit(freshTabs('a'), 'a', page.address);
    await account.saveAccountTabs(A.id, tabs);
    ok(JSON.stringify((await account.accountTabs()).tabs[0].stops[0].address) === JSON.stringify(page.address), 'tabs are kept on the account');
    if (before === null) await A.client.from('browse_tabs').delete().eq('person', A.id);
    else await account.saveAccountTabs(A.id, before);

    // The visit record: written with a reader's own session by the server's own code, read by nobody.
    const { createDatabaseVisits } = load('app/lib/seeing/server/visits.ts');
    const token = (await A.client.auth.getSession()).data.session.access_token;
    const visits = createDatabaseVisits(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY);
    ok(await visits.write(A.id, 'seeing-live.example', token), "a visit is written with the reader's own session");
    ok(!(await visits.write(A.id, 'seeing-live.example', 'not-a-session')), 'and with no other');
    ok(!(await visits.write(A.id, 'https://a.example/page?q=secret', token)), 'never an address');
    ok((await A.client.from('browse_log').select('site').limit(1)).error !== null, 'and read by nobody');
  } finally {
    await mine.remove(page).catch(() => undefined);
    who = A.client;
    await account.deleteSharedNote(noteId);
    ok(!(await mine.list(A.id)).some((each) => each.id === page.id) && (await A.client.storage.from('seen').list(A.id)).data?.every((each) => each.name !== page.id), 'what was made is gone, its file with it');
    await A.client.auth.signOut({ scope: 'local' });
    await B.client.auth.signOut({ scope: 'local' });
  }
  console.log(`\n${passed} passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
