/*
 * OWN WEB keeping a page OWN EYE showed (extension 0.8.2), against the live database with the kept test accounts A and B (hidden from every
 * list): the site's own `keepFromOwnEye` writes A's page with A's own session, and nobody but A reads its card, its words or its file. What
 * it makes, it deletes. Short; one session at a time. No rule in the database was changed for this: it proves the ones there already do.
 *
 *   node scripts/see-own-web-live.cjs
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
  globalThis.window ??= { crypto: globalThis.crypto };
  // The site's own keeper, its store being A's session on the live database and nothing kept before.
  const { keepFromOwnEye, OWN_WEB_TAG, OWN_EYE_TAG } = load('app/lib/seeing/own-web.ts', {
    'app/lib/seeing/pages-store': { keepPage: (page, copy) => mine.keep(page, copy), keptPages: () => [], removePage: (page) => mine.remove(page) },
    'app/lib/seeing/server-engine': { makeCopy: async () => 'NOT ASKED' },
  });
  const stamp = Date.now();
  const address = `https://own-web-live.example/letter-${stamp}`;
  const words = { href: address, title: 'A letter, signed in', description: 'A live proof', language: 'en', paragraphs: [{ heading: true, words: 'Dear reader' }, { heading: false, words: `private words ${stamp} <b>not markup</b>` }] };
  let page;
  try {
    ok((await keepFromOwnEye(words, { id: A.id, label: 'FORGED' })) === 'kept', "the site's own keeper writes the page with the reader's own session: no rule in the database refuses it");
    page = (await mine.list(A.id)).find((each) => each.address === address);
    ok(page !== undefined && page.private && page.ownerId === A.id && page.tags.includes(OWN_WEB_TAG) && page.tags.includes(OWN_EYE_TAG), 'its card is private, on that account, marked OWN WEB and OWN EYE');
    const copy = await mine.copyOf(page.id, A.id);
    ok(copy !== null && copy.html.includes('<h2>Dear reader</h2>') && copy.html.includes(`private words ${stamp} &lt;b&gt;not markup&lt;/b&gt;`), 'its owner reads the words back, written as plain text');
    ok((await A.client.from('seen_page_copies').select('words').eq('page', page.id)).data?.[0]?.words.includes(`private words ${stamp}`), 'and they can be searched by their owner');

    ok(!(await theirs.list(B.id)).some((each) => each.id === page.id) && (await B.client.from('seen_pages').select('id').eq('id', page.id)).data?.length === 0, 'another account does not see the card');
    ok((await theirs.copyOf(page.id, B.id)) === null && (await B.client.from('seen_page_copies').select('page, words').eq('page', page.id)).data?.length === 0, 'nor the words');
    ok((await B.client.storage.from('seen').download(`${A.id}/${page.id}`)).error !== null, 'nor the file, asked for by its exact place');
    ok(((await B.client.from('seen_page_copies').select('page').ilike('words', `%private words ${stamp}%`)).data ?? []).length === 0, 'nor finds it by searching for its words');
    await theirs.remove(page).catch(() => undefined);
    ok((await mine.list(A.id)).some((each) => each.id === page.id) && (await mine.copyOf(page.id, A.id)) !== null, 'and can delete neither');
    const { createClient } = require('@supabase/supabase-js');
    const visitor = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL, process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY, { auth: { persistSession: false } });
    ok(((await visitor.from('seen_pages').select('id').eq('id', page.id)).data ?? []).length === 0 && ((await visitor.from('seen_page_copies').select('page').eq('page', page.id)).data ?? []).length === 0 && (await visitor.storage.from('seen').download(`${A.id}/${page.id}`)).error !== null, 'a visitor who is not signed in sees none of it');
  } finally {
    if (page !== undefined) await mine.remove(page).catch(() => undefined);
    else await A.client.from('seen_pages').delete().eq('address', address);
    ok(!(await mine.list(A.id)).some((each) => each.address === address) && (await A.client.storage.from('seen').list(A.id)).data?.every((each) => each.name !== page?.id), 'its owner removes it: the card is gone, its file with it');
    await A.client.auth.signOut({ scope: 'local' });
    await B.client.auth.signOut({ scope: 'local' });
  }
  console.log(`\n${passed} passed`);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
