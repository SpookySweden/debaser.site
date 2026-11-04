/*
 * Scratch check for the lore pages (run from the root):
 *   npx tsc app/lib/lore/types.ts app/lib/lore/pages.ts app/lib/lore/session.ts app/lib/lore/repository.ts app/lib/lore/mock-lore-repository.ts app/lib/lore/supabase-lore-repository.ts app/lib/lore/use-lore-page.ts app/lib/forum/ids.ts app/lib/profile/name-colours.ts app/lib/supabase/client.ts --outDir Temp/lore-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   npx tsc app/components/LoreEditor.tsx app/components/LoreDirectory.tsx app/components/LorePageView.tsx app/components/NewLorePageWindow.tsx app/components/SiteNav.tsx app/components/AuthProvider.tsx app/components/PresenceProvider.tsx app/components/CommsProvider.tsx app/components/NotificationsProvider.tsx app/components/PopoutWindow.tsx app/components/TimeStamp.tsx --outDir Temp/lore-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-lore.cjs
 *
 * What it is for. A lore page is the one part of this site that is not a row somebody wrote: it is
 * a shared document, and everything worth checking about it is about what happens when two people
 * type:
 *
 *   1. the address rules - the slug a title makes, what counts as one, and what the index reads;
 *   2. the two stores - a page opened, refused, filed, and the seeded shelf that opens with its
 *      writing already in the document (not in a string the editor has to be told about);
 *   3. **the handshake** - two documents in one process, two sessions, and a room between them:
 *      what one types arrives in the other, both keep typing at once, and the presence list empties
 *      when somebody leaves. That is the whole feature, and it runs here without a browser;
 *   4. the screens - the new-page window, the shelf's initial state, and the editor's own source,
 *      which is where server rendering cannot reach (Tiptap needs a document, so the editor is
 *      stubbed out of the render below and read instead).
 *
 * The carets and the toolbar are a stubbed component's props and a source file's contents, which is
 * the honest limit of a check with no DOM: the parts that decide anything are all above that line.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

/** A module replaced before anything requires it. */
function stub(path, exports) {
  const resolved = require.resolve(path);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

/**
 * The writing in a fragment, with the node markup taken off.
 *
 * `XmlFragment.toString()` is the *markup* - `<paragraph>the corridor is glass</paragraph>` - and
 * the structure it shows is the thing being checked in one place (a paragraph ProseMirror will
 * merge into) while the words are the thing being checked in every other. Reading the words is this
 * reader's job, so a test about what the page says does not depend on how a block serialises.
 */
function writing(fragment) {
  return fragment
    .toArray()
    .map((node) => {
      const children = node instanceof Y.XmlElement ? node.toArray() : [node];

      return children.map((child) => child.toString()).join('');
    })
    .join('\n');
}

const {
  LORE_SLUG_LIMIT,
  isLoreSlug,
  lorePagePath,
  loreSlug,
  snippetOf,
  sortPagesByUpdated,
  titleFromSlug,
  wordCountOf,
} = require('./lore-out/lore/pages.js');
const { LORE_DOCUMENT_FIELD } = require('./lore-out/lore/types.js');
const { getMockLoreRepository, loreDocumentState } = require('./lore-out/lore/mock-lore-repository.js');
const { LORE_DATA_SOURCE } = require('./lore-out/lore/repository.js');
const {
  LORE_NEED_MIGRATION,
} = require('./lore-out/lore/supabase-lore-repository.js');
const { LORE_STATUS_LINES } = require('./lore-render/components/LoreEditor.js');

// The screens. `next/navigation` is stubbed before anything that navigates is required: a static
// render has no router, and the new-page window pushes to the page it just opened.
stub('next/navigation', {
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, back: () => undefined, forward: () => undefined, prefetch: () => undefined }),
  usePathname: () => '/lore',
  useSearchParams: () => new URLSearchParams(),
});

const LoreDirectory = require('./lore-render/components/LoreDirectory.js').default;
const LorePageView = require('./lore-render/components/LorePageView.js').default;
const NewLorePageWindow = require('./lore-render/components/NewLorePageWindow.js').default;
const AuthProvider = require('./lore-render/components/AuthProvider.js').default;

const Y = require('yjs');
const { Awareness } = require('y-protocols/awareness');

// 1. The address, read off a title.
assert.equal(loreSlug('THE GLASS CORRIDOR'), 'the-glass-corridor');
assert.equal(loreSlug('  Hexham Grid  '), 'hexham-grid');
assert.equal(loreSlug('CAFÉ / Night Shift!'), 'cafe-night-shift', 'an accent is folded, not dropped');
assert.equal(loreSlug('three___underscores'), 'three-underscores', 'runs of punctuation become one hyphen');
assert.equal(loreSlug('---leading and trailing---'), 'leading-and-trailing');
assert.equal(loreSlug('A'.repeat(120)).length, LORE_SLUG_LIMIT, 'a long title is cut to something a link can hold');
assert.equal(loreSlug('-'.repeat(LORE_SLUG_LIMIT) + 'Ends With A Letter'), 'ends-with-a-letter', 'and never ends on a hyphen');
assert.equal(loreSlug('!!!'), '', 'a title with nothing in it makes no address at all');

assert.equal(isLoreSlug('the-glass-corridor'), true);
assert.equal(isLoreSlug(''), false);
assert.equal(isLoreSlug('The-Glass-Corridor'), false, 'addresses are lower case');
assert.equal(isLoreSlug('glass--corridor'), false, 'and single-hyphened');
assert.equal(isLoreSlug('-glass'), false);
assert.equal(isLoreSlug('glass_2'), false);
assert.equal(isLoreSlug('x'.repeat(LORE_SLUG_LIMIT + 1)), false);

assert.equal(titleFromSlug('the-glass-corridor'), 'THE GLASS CORRIDOR');
assert.equal(titleFromSlug(''), 'LORE PAGE');
assert.equal(lorePagePath('hexham-grid'), '/lore/hexham-grid');

// What the index prints about a page's writing.
assert.equal(wordCountOf('one two three'), 3);
assert.equal(wordCountOf('   '), 0);
assert.equal(wordCountOf('a\n\nb  c'), 3, 'paragraph breaks are not words');
assert.equal(snippetOf('a '.repeat(200)).endsWith('...'), true);
assert.equal(snippetOf('short'), 'short');

assert.deepEqual(
  sortPagesByUpdated([
    { updatedAt: '2026-09-21T09:00:00.000Z', slug: 'older' },
    { updatedAt: '2026-09-22T09:00:00.000Z', slug: 'newer' },
  ]).map((page) => page.slug),
  ['newer', 'older'],
  'the shelf reads what was written in most recently, first',
);

// 2. The switch, with nothing configured: this site runs on its own stores by default.
assert.equal(LORE_DATA_SOURCE, 'mock', 'no project in the environment means the mock shelf');
assert.match(LORE_NEED_MIGRATION, /20260929000022_lore_pages\.sql/, 'a database that is behind is told which file to run');
assert.match(LORE_NEED_MIGRATION, /SECTION 22 OF supabase\/schema\.sql/, 'and which section of the whole script holds it');

const { base64ToBytes, bytesToBase64, createLoreSession, lorePresence } = require('./lore-out/lore/session.js');

void (async () => {
  // 3. A document built from prose: what a seeded page opens with. The structure matters - a
  //    paragraph of ProseMirror is an `XmlElement('paragraph')` holding its text - because that is
  //    what the editor merges into when the page is opened for real.
  const seeded = new Y.Doc();
  Y.applyUpdate(seeded, base64ToBytes(loreDocumentState('First paragraph.\n\nSecond paragraph.')));
  const body = seeded.getXmlFragment(LORE_DOCUMENT_FIELD);

  assert.equal(body.length, 2, 'one node per paragraph');
  assert.equal(body.get(0).nodeName, 'paragraph', 'and a paragraph is what ProseMirror calls one');
  assert.equal(writing(body), 'First paragraph.\nSecond paragraph.', 'with the writing inside them');
  assert.equal(
    loreDocumentState('   '),
    loreDocumentState(''),
    'a body with nothing in it makes an empty document rather than a stray paragraph',
  );

  // 4. The mock shelf: the rules the database keeps, kept here too.
  const repository = getMockLoreRepository();
  const shipped = await repository.listPages();

  assert.equal(shipped.length, 2, 'the shelf opens with the two pages this archive ships');
  assert.deepEqual(shipped.map((page) => page.slug), ['the-glass-corridor', 'hexham-grid'], 'newest filed first');

  const corridor = await repository.getPage('the-glass-corridor');
  assert.ok(corridor !== null, 'a page can be read by its address');
  assert.equal(corridor.title, 'THE GLASS CORRIDOR');
  assert.ok(corridor.bodyText.length > 40, 'it has its writing as plain text');
  assert.ok(corridor.state.length > 0, 'and a document to open it in');
  assert.equal(await repository.getPage('nothing-here'), null, 'an address nobody took is nothing, not an error');

  // (2026-10-25, SPEC-less-text.md) The lore refusals shortened, in the mock and Supabase stores alike:
  // `... TAKES AN ACCOUNT - SIGN IN FIRST.` -> `SIGN IN FIRST.`; `THAT TITLE MAKES NO ADDRESS - ...` -> `TITLE NEEDS
  // A LETTER OR DIGIT.`; `A PAGE ALREADY LIVES AT THAT ADDRESS.` -> `THAT ADDRESS IS TAKEN.`; `THAT PAGE IS NOT
  // THERE - ...` -> `PAGE NOT FOUND.`
  await assert.rejects(
    () => repository.createPage({ title: 'A PAGE WITH NO ACCOUNT', summary: '', creatorId: null, creatorName: 'x' }),
    /^Error: SIGN IN FIRST\.$/,
    'a visitor cannot open a page - this is the one shelf that asks first',
  );
  await assert.rejects(
    () => repository.createPage({ title: '!!!', summary: '', creatorId: 'user-a', creatorName: 'sweden' }),
    /TITLE NEEDS A LETTER OR DIGIT\./,
    'and a title with nothing in it is refused before anything is written',
  );
  await assert.rejects(
    () => repository.createPage({ title: 'Hexham Grid', summary: '', creatorId: 'user-a', creatorName: 'sweden' }),
    /THAT ADDRESS IS TAKEN\./,
    'two pages cannot share an address, whatever the two titles look like',
  );

  const opened = await repository.createPage({
    title: 'The Drowned Floor',
    summary: 'below the grid.',
    creatorId: 'user-a',
    creatorName: 'sweden',
  });
  assert.equal(opened.slug, 'the-drowned-floor', 'the address is read off the title');
  assert.equal(opened.state, '', 'a page just opened is empty: nothing has been typed on it yet');
  assert.equal((await repository.listPages())[0].slug, 'the-drowned-floor', 'and it leads the shelf');

  await assert.rejects(
    () => repository.savePage({ id: opened.id, state: '', bodyText: 'x', editorId: null, editorName: 'x' }),
    /^Error: SIGN IN FIRST\.$/,
    'filing a page takes an account too',
  );
  await assert.rejects(
    () => repository.savePage({ id: 'not-a-page', state: '', bodyText: 'x', editorId: 'user-a', editorName: 'sweden' }),
    /PAGE NOT FOUND\./,
    'and a page that is not on the shelf cannot be filed',
  );

  const filed = await repository.savePage({
    id: opened.id,
    state: bytesToBase64(Y.encodeStateAsUpdate(seeded)),
    bodyText: 'what was typed',
    editorId: 'user-a',
    editorName: 'sweden',
  });
  assert.equal(filed.bodyText, 'what was typed', 'a save writes the plain copy the visitor reads');
  assert.equal(filed.updatedByLabel, 'sweden', 'and signs the row with whoever filed it');
  assert.equal(
    (await repository.getPage('the-drowned-floor')).updatedByLabel,
    'sweden',
    'which is what the shelf now says about it',
  );

  seeded.destroy();

  /**
   * Two rooms wired to each other the way a transport wires them: what one sends arrives at the
   * other, and never back at the sender - which is what `BroadcastChannel` does and what Realtime's
   * `broadcast: { self: false }` does. `hold` keeps the wire shut instead of delivering, which is
   * how two tabs typing at once are staged here: both edit, and only then do the two runs of edits
   * meet.
   */
  function linkedRooms() {
    const listeners = [new Set(), new Set()];
    const queued = [];
    const kinds = new Set();
    let held = false;

    function deliver(from, message) {
      kinds.add(message.kind);

      if (held) {
        queued.push([from, message]);
        return;
      }

      for (const listener of listeners[1 - from]) listener(message);
    }

    const room = (index) => ({
      name: `test-room-${index}`,
      send: (message) => deliver(index, message),
      listen: (handler) => {
        listeners[index].add(handler);
        return () => void listeners[index].delete(handler);
      },
      close: () => listeners[index].clear(),
    });

    return {
      channelA: room(0),
      channelB: room(1),
      kinds,
      hold: () => {
        held = true;
      },
      release: () => {
        held = false;
        while (queued.length > 0) {
          const next = queued.shift();
          if (next !== undefined) deliver(next[0], next[1]);
        }
      },
      listening: () => listeners.reduce((total, set) => total + set.size, 0),
    };
  }

  /** A room with nobody on the other end of it, for the tab that is on a page alone. */
  function lonelyRoom() {
    return {
      name: 'test-room-alone',
      send: () => undefined,
      listen: () => () => undefined,
      close: () => undefined,
    };
  }

  // 5. The handshake, and the merge. Two documents in one process, two sessions, one wire between
  //    them: what one types arrives in the other, and two runs of edits made at the same time both
  //    survive. This is the whole feature, and none of it needs a browser.
  const wire = linkedRooms();
  const docA = new Y.Doc();
  const awarenessA = new Awareness(docA);
  const sessionA = createLoreSession({
    room: wire.channelA,
    doc: docA,
    awareness: awarenessA,
    user: { name: 'sweden', colour: '#000080' },
  });

  assert.equal(sessionA.status(), 'SYNCING', 'a session asks for the document as it joins');

  // Somebody is already writing, before anybody else is here.
  const bodyA = docA.getXmlFragment(LORE_DOCUMENT_FIELD);
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText('')]);
  docA.transact(() => bodyA.insert(0, [paragraph]));
  paragraph.get(0).insert(0, 'the corridor is glass');
  assert.equal(writing(bodyA), 'the corridor is glass', 'the first tab has its writing');

  const docB = new Y.Doc();
  const awarenessB = new Awareness(docB);
  const sessionB = createLoreSession({
    room: wire.channelB,
    doc: docB,
    awareness: awarenessB,
    user: { name: 'luke', colour: '#008000' },
  });

  const bodyB = docB.getXmlFragment(LORE_DOCUMENT_FIELD);
  assert.equal(sessionB.status(), 'LIVE', 'a joiner is live as soon as the answer lands');
  assert.equal(writing(bodyB), 'the corridor is glass', 'and it arrived holding what was already written');
  assert.equal(sessionA.status(), 'LIVE', 'while the tab that answered now knows somebody is here');

  assert.deepEqual(
    sessionA.peers().map((peer) => `${peer.name}${peer.self ? '*' : ''}`),
    ['sweden*', 'luke'],
    'the room lists both tabs, this one first',
  );
  assert.deepEqual(sessionB.peers().map((peer) => peer.name), ['luke', 'sweden'], 'and each tab is first on its own');
  assert.equal(sessionA.peers()[1].colour, '#008000', "a peer's caret wears the colour their name wears elsewhere");

  // One tab types; the other has it before the key is let go.
  bodyB.get(0).get(0).insert(0, 'B: ');
  assert.equal(writing(bodyA), 'B: the corridor is glass', 'what one tab types is in the other');

  // Both tabs type at once, with the wire shut between them.
  wire.hold();
  const textA = bodyA.get(0).get(0);
  const textB = bodyB.get(0).get(0);
  textA.insert(textA.length, ' :: from sweden');
  textB.insert(textB.length, ' :: from luke');
  assert.equal(writing(bodyA), 'B: the corridor is glass :: from sweden', 'A holds its own words alone');
  assert.equal(writing(bodyB), 'B: the corridor is glass :: from luke', 'and so does B');

  wire.release();
  assert.equal(writing(bodyA), writing(bodyB), 'when the two runs of edits meet, both tabs agree');
  assert.match(writing(bodyA), /from sweden/);
  assert.match(writing(bodyA), /from luke/, 'and neither run of edits was lost');
  assert.deepEqual(
    [...wire.kinds].sort(),
    ['awareness', 'sync-request', 'sync-response', 'update'],
    'the four messages a shared page needs, and nothing else',
  );

  // Somebody closes the tab: their caret goes with them.
  const merged = writing(bodyA);
  sessionB.destroy();
  awarenessB.destroy();
  docB.destroy();

  assert.deepEqual(sessionA.peers().map((peer) => peer.name), ['sweden'], 'a tab that leaves takes its name out of the room');
  assert.equal(wire.listening(), 1, 'and lets go of its half of the wire');
  assert.equal(sessionA.status(), 'LIVE', 'while the tab that stayed is still in it');
  const stayedLive = sessionA.status();

  sessionA.destroy();
  awarenessA.destroy();
  docA.destroy();

  assert.deepEqual(
    lorePresence({ name: 'sweden', colour: '#000080' }),
    { name: 'sweden', colour: '#000080', color: '#000080' },
    "the wire carries the colour under both spellings: ours, and the caret extension's",
  );

  // 6. A page nobody else has open says so, rather than claiming to be shared.
  const aloneDoc = new Y.Doc();
  const alone = createLoreSession({
    room: lonelyRoom(),
    doc: aloneDoc,
    awareness: new Awareness(aloneDoc),
    user: { name: 'sweden', colour: '#000080' },
  });
  assert.equal(alone.status(), 'SYNCING');
  await new Promise((resolve) => setTimeout(resolve, 1700));
  assert.equal(alone.status(), 'ALONE', 'nobody answered, so the page is open here and nowhere else');
  alone.destroy();
  aloneDoc.destroy();

  // 7. The screens: what server rendering can reach (the shelf's first paint, the new-page window)
  //    and, where it cannot - the editor needs a document to build a ProseMirror view in - the
  //    component's own source.
  const element = React.createElement;
  const withSite = (child) => renderToStaticMarkup(element(AuthProvider, null, child));

  const shelf = withSite(element(LoreDirectory, null));
  // (2026-10-23, SPEC-efficiency.md) `LORE PAGES [ n FILED ]` is `PAGES` (no count in the title; the body says it is
  // reading). A visitor who cannot open a page is not shown a disabled `[ NEW PAGE ]` beside a sentence:
  // they get one line, `[ LOG IN ] TO OPEN A PAGE`.
  assert.match(shelf, /<span>PAGES<\/span>/, 'the shelf names itself');
  assert.doesNotMatch(shelf, /\[ READING\.\.\. \]|FILED \]/, 'with no count in its title');
  assert.match(shelf, /\[ LOG IN \]<\/a> TO OPEN A PAGE/, 'and one line saying what an account buys a visitor');
  assert.match(fs.readFileSync('app/components/LoreDirectory.tsx', 'utf8'), /\[ NEW PAGE \]/, 'while an account gets the way to open a page');
  assert.match(shelf, /READING THE SHELF\.\.\./, 'because the list is read on the client, which is what the first paint says');

  // The new-page window is a pop-out, and a pop-out renders through a portal into `<body>` - which
  // a static render has no document for, so it draws nothing at all. What it *says* is read from
  // its source instead, the same way the other checks handle a window that cannot be server-rendered.
  assert.equal(typeof NewLorePageWindow, 'function', 'the window is a component of its own');

  const newPageSource = fs.readFileSync('app/components/NewLorePageWindow.tsx', 'utf8');
  assert.match(newPageSource, /<PopoutWindow/, 'it is a pop-out, like every other form on the site');
  assert.match(newPageSource, /LIVES AT:/, 'and prints the address as the title is typed');
  // (2026-10-25, SPEC-less-text.md) `AN ADDRESS NEEDS A LETTER OR A DIGIT IN THE TITLE` -> `NEEDS A LETTER OR DIGIT`.
  assert.match(newPageSource, /'NEEDS A LETTER OR DIGIT'/, 'which is nothing until a title is typed');
  assert.doesNotMatch(newPageSource, /AN ADDRESS NEEDS A LETTER OR A DIGIT IN THE TITLE/, 'said short');
  assert.match(newPageSource, /router\.push\(lorePagePath\(page\.slug\)\)/, 'opening one goes straight to the page it made');
  assert.match(newPageSource, /repository\.createPage\(\{/, 'and the store is what files it');

  const page = withSite(element(LorePageView, { slug: 'the-glass-corridor' }));
  assert.match(page, /READING THE PAGE\.\.\./, 'a page says so before the store has answered');

  const editorSource = fs.readFileSync('app/components/LoreEditor.tsx', 'utf8');
  assert.match(
    editorSource,
    /StarterKit\.configure\(\{ undoRedo: false \}\)/,
    'history belongs to the collaboration extension, so undo is this editor`s own last edit',
  );
  assert.match(
    editorSource,
    /Collaboration\.configure\(\{ document: doc, field: LORE_DOCUMENT_FIELD \}\)/,
    'the page is the Yjs document, under the field the store filed it in',
  );
  assert.match(
    editorSource,
    /CollaborationCaret\.configure\(\{ provider: \{ awareness \}, user: lorePresence\(user\) \}\)/,
    "the carets ride on this tab's own presence",
  );
  assert.match(editorSource, /immediatelyRender: false/, 'and the editor is only ever built in a browser');
  assert.match(
    editorSource,
    /document\.addEventListener\('visibilitychange'/,
    'a tab being put away files what is on it, which is the moment before a browser closes',
  );

  for (const plate of ['[ BOLD ]', '[ ITALIC ]', '[ H1 ]', '[ BULLETS ]', '[ QUOTE ]', '[ UNDO ]', '[ SAVE NOW ]']) {
    assert.ok(editorSource.includes(plate), `the toolbar carries ${plate}`);
  }

  // (2026-10-25, SPEC-less-text.md) The room line was a sentence per state (`LIVE :: WHAT YOU TYPE IS ALREADY ON
  // EVERYBODY ELSE'S PAGE`); it is the state's word now. Each state still has its own, distinct line.
  assert.deepEqual(
    { ...LORE_STATUS_LINES },
    { SYNCING: 'CONNECTING...', LIVE: 'LIVE', ALONE: 'ALONE' },
    'the room line names the state in a word',
  );
  assert.equal(new Set(Object.values(LORE_STATUS_LINES)).size, 3, 'and no two states read the same');

  const viewSource = fs.readFileSync('app/components/LorePageView.tsx', 'utf8');
  // (2026-10-23, SPEC-efficiency.md) One line: `[ LOG IN ] TO WRITE ON THIS PAGE`.
  // (2026-10-25, SPEC-less-text.md) `[ LOG IN ] TO WRITE ON THIS PAGE` -> `[ LOG IN ] TO WRITE`.
  assert.match(viewSource, /\[ LOG IN \]\s*<\/Link>\{' '\}\s*TO WRITE\s*<\/p>/, 'a visitor is told what an account would let them do');
  assert.doesNotMatch(viewSource, /TO WRITE ON THIS PAGE/, 'in the short line');
  assert.match(viewSource, /paragraphs\.map/, 'and reads the plain-text copy, drawn as paragraphs');
  assert.match(viewSource, /<LoreEditor/, 'while an account gets the editor itself');

  const directorySource = fs.readFileSync('app/components/LoreDirectory.tsx', 'utf8');
  assert.match(directorySource, /lorePagePath\(page\.slug\)/, 'a row links to the page it names');
  assert.match(directorySource, /LAST FILED BY \{page\.updatedByLabel\}/, 'and says who touched it last');

  // 8. The database: the migration and the whole script have to say the same thing, because either
  //    one may be the one that was run.
  const migration = fs.readFileSync('supabase/migrations/20260929000022_lore_pages.sql', 'utf8');
  const whole = fs.readFileSync('supabase/schema.sql', 'utf8');

  const shared = [
    'create table if not exists public.lore_pages',
    'slug text not null unique',
    'body_text text not null default',
    'yjs_state text not null default',
    'lore_pages_slug_shape',
    '"lore pages readable"',
    '"lore pages opened by an account"',
    '"lore pages filed by an account"',
    '"lore pages removed by their opener or admin"',
  ];

  for (const line of shared) {
    assert.ok(migration.includes(line), `the migration carries ${line}`);
    assert.ok(whole.includes(line), `and so does schema.sql: ${line}`);
  }

  assert.match(whole, /-- 22\. Lore pages/, 'schema.sql numbers the page script as section 22');
  assert.doesNotMatch(
    whole,
    /alter publication supabase_realtime add table public\.lore_pages/,
    'a lore page is not published: its editors use a broadcast channel, not the change feed',
  );

  console.log('lore checks passed');
  console.log('  address   : THE GLASS CORRIDOR ->', loreSlug('THE GLASS CORRIDOR'), ':: a title with nothing in it makes none');
  console.log('  shelf     :', shipped.length, 'pages shipped,', (await repository.listPages()).length, 'after one was opened');
  console.log('  handshake : two tabs, one wire, both keeping', `"${merged}"`);
  console.log('  room      :', stayedLive, 'with a peer list that empties when a tab leaves');
  console.log('  screens   : the shelf, the new-page window, the page, and the editor`s own rules');
  console.log('  database  : table, four policies and the slug check, in the migration and in section 22');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});



