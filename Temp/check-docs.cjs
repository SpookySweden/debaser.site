/*
 * DOCS (SPEC-live-docs.md): the rules, the live handshake, pointers, and the mock store's access rules.
 *   npx tsc app/lib/docs/types.ts app/lib/docs/rules.ts app/lib/docs/session.ts app/lib/docs/mock-docs-repository.ts app/lib/docs/forum.ts app/lib/forum/ids.ts app/lib/ui/themes.ts --outDir Temp/docs-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   node Temp/check-docs.cjs
 *
 * It replaces check-lore.cjs: the lore pages are documents now (their own code is retired), and what that
 * check held - the address rules, the handshake between two tabs, two people typing at once - is held here
 * against the code that runs it today, plus what DOCS adds:
 *
 *   1. addresses, sharing levels, and who may do what (`docRoleFor`, the database's `doc_role` mirrored);
 *   2. pointers: about 8 a second, 2 a second above six people, stepped fade, and only own pictures drawn;
 *   3. the handshake: two documents, two sessions, one wire - typing arrives, two runs of edits merge, a
 *      pointer arrives as a place in the text, and a reader sends nothing at all;
 *   4. the mock store: a PRIVATE document is not listed or opened by anybody else, SHARED WITH follows
 *      the share, only the owner changes sharing, and the hourly copy is refused within the hour;
 *   5. the forum: the `doc` anchor, the one board post, and the [ OPEN DOC ] link read back out of it.
 *
 * The database's own rules are held live by Temp/check-docs-live.cjs (two accounts, the real tables).
 */
const assert = require('node:assert/strict');
const Y = require('yjs');
const { Awareness } = require('y-protocols/awareness');

const rules = require('./docs-out/docs/rules.js');
const { DOC_FIELD, LORE_FOLDER_ID } = require('./docs-out/docs/types.js');
const { createDocSession, bytesToBase64, base64ToBytes } = require('./docs-out/docs/session.js');
const { getMockDocsRepository, documentStateFromText } = require('./docs-out/docs/mock-docs-repository.js');
const { docAnchor, docAnnouncement, docLinkIn } = require('./docs-out/docs/forum.js');

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function writing(fragment) {
  return fragment
    .toArray()
    .map((node) => (node instanceof Y.XmlElement ? node.toArray() : [node]).map((child) => child.toString()).join(''))
    .join('\n');
}

// 1. Addresses.
assert.equal(rules.docSlug('THE GLASS CORRIDOR'), 'the-glass-corridor');
assert.equal(rules.docSlug('CAFÉ / Night Shift!'), 'cafe-night-shift', 'an accent is folded, not dropped');
assert.equal(rules.docSlug('!!!'), '', 'a title with nothing in it makes no address');
assert.equal(rules.docSlug('A'.repeat(120)).length, rules.DOC_SLUG_LIMIT);
assert.equal(rules.isDocSlug('glass--corridor'), false);
assert.equal(rules.titleFromSlug('hexham-grid'), 'HEXHAM GRID');
assert.equal(rules.isDocId('0b9d6f3e-1a2b-4c3d-8e9f-0a1b2c3d4e5f'), true);
assert.equal(rules.isDocId('doc-0b9d6f3e-1a2b-4c3d-8e9f-0a1b2c3d4e5f'), true, "the mock store's own ids");
assert.equal(rules.isDocId('../etc'), false);
assert.equal(rules.docPath({ id: 'abc-123456', slug: null }), '/docs/abc-123456');
assert.equal(rules.docPath({ id: 'x', slug: 'hexham-grid' }), '/lore/hexham-grid', 'a lore document keeps its lore address');
assert.equal(rules.folderPath(null), '/docs');

// Who may do what. A: owner. B: someone else. null: a visitor.
const role = (access, viewer, share = null, banned = false) => rules.docRoleFor({ access, ownerId: 'A' }, viewer, share, banned);
assert.equal(role('private', 'A'), 'owner');
assert.equal(role('private', 'B'), null, 'PRIVATE: only the owner');
assert.equal(role('private', null), null);
assert.equal(role('shared', 'B'), null, 'SHARED WITH: nobody unnamed');
assert.equal(role('shared', 'B', { canEdit: true }), 'edit');
assert.equal(role('shared', 'B', { canEdit: false }), 'read');
assert.equal(role('shared', null, { canEdit: true }), null);
assert.equal(role('signed_in', 'B'), 'edit', 'ANYONE SIGNED IN: every account edits');
assert.equal(role('signed_in', null), null, 'and a visitor sees nothing');
assert.equal(role('public', 'B'), 'edit', 'PUBLIC: accounts edit, as lore');
assert.equal(role('public', null), 'read', 'and visitors read');
assert.equal(role('public', 'B', null, true), 'read', 'a banned account only reads');
assert.equal(role('private', 'A', null, true), 'read');
assert.equal(rules.announcesOnBoard('public'), true);
assert.equal(rules.announcesOnBoard('signed_in'), true);
assert.equal(rules.announcesOnBoard('shared'), false);
assert.equal(rules.announcesOnBoard('private'), false);

// 2. Pointers and pictures.
assert.equal(rules.pointerInterval(2), 125, 'about 8 a second');
assert.equal(rules.pointerInterval(6), 125);
assert.equal(rules.pointerInterval(7), 500, 'above six people, 2 a second: the safety valve');
assert.equal(rules.pointerOpacity(0), 1);
assert.equal(rules.pointerOpacity(9_999), 1, 'still for under 10 s: as it was');
assert.equal(rules.pointerOpacity(10_000), 0.66, 'then it fades in steps');
assert.equal(rules.pointerOpacity(10_700), 0.33);
assert.equal(rules.pointerOpacity(11_400), 0, 'and goes');
assert.equal(rules.versionDue(null, Date.now()), true);
assert.equal(rules.versionDue(new Date(Date.now() - 30 * 60_000).toISOString(), Date.now()), false, 'a copy an hour, not more');
assert.equal(rules.versionDue(new Date(Date.now() - 61 * 60_000).toISOString(), Date.now()), true);

const base = 'https://project.supabase.co';
assert.equal(rules.isOwnPicture(`${base}/storage/v1/object/public/doc-pictures/u/1.png`, base), true);
assert.equal(rules.isOwnPicture('https://tracker.example/pixel.gif', base), false, 'nothing from elsewhere');
assert.equal(rules.isOwnPicture(`${base}/storage/v1/object/public/avatars/u/1.png`, base), false, 'nor from another bucket');
assert.equal(rules.isOwnPicture(`${base}/storage/v1/object/public/doc-pictures/u/"onerror=x.png`, base), false);
assert.equal(rules.isOwnPicture('data:image/png;base64,AAAA', base), false, 'a data address only in the mock store');
assert.equal(rules.isOwnPicture('data:image/png;base64,AAAA', ''), true);
assert.equal(rules.isOwnPicture('javascript:alert(1)', ''), false);

function linkedRooms() {
  const listeners = [new Set(), new Set()];
  const counts = [0, 0];
  const room = (index) => ({
    name: `room-${index}`,
    send: (message) => {
      counts[index] += 1;
      for (const listener of listeners[1 - index]) listener(JSON.parse(JSON.stringify(message)));
    },
    listen: (handler) => {
      listeners[index].add(handler);
      return () => void listeners[index].delete(handler);
    },
    close: () => listeners[index].clear(),
  });
  return { a: room(0), b: room(1), counts };
}

void (async () => {
  // 3. The handshake.
  const wire = linkedRooms();
  const docA = new Y.Doc();
  const awarenessA = new Awareness(docA);
  const sessionA = createDocSession({ room: wire.a, doc: docA, awareness: awarenessA, user: { name: 'TEST A', colour: '#000080', userId: 'A' }, canSend: true });

  const bodyA = docA.getXmlFragment(DOC_FIELD);
  const paragraph = new Y.XmlElement('paragraph');
  paragraph.insert(0, [new Y.XmlText('')]);
  docA.transact(() => bodyA.insert(0, [paragraph]));
  paragraph.get(0).insert(0, 'the corridor is glass');

  const docB = new Y.Doc();
  const awarenessB = new Awareness(docB);
  const sessionB = createDocSession({ room: wire.b, doc: docB, awareness: awarenessB, user: { name: 'TEST B', colour: '#008000', userId: 'B' }, canSend: true });
  const bodyB = docB.getXmlFragment(DOC_FIELD);

  assert.equal(writing(bodyB), 'the corridor is glass', 'a joiner arrives holding what was written');
  assert.equal(sessionB.status(), 'LIVE');
  assert.deepEqual(sessionA.peers().map((peer) => `${peer.name}${peer.self ? '*' : ''}`), ['TEST A*', 'TEST B']);
  assert.equal(sessionA.peers()[1].userId, 'B', "a peer carries their account, so their caret can wear their picture");

  // Both type at once; both runs survive on both sides.
  bodyA.get(0).get(0).insert(0, 'A: ');
  bodyB.get(0).get(0).insert(bodyB.get(0).get(0).length, ' :B');
  assert.equal(writing(bodyA), writing(bodyB), 'both copies agree');
  assert.match(writing(bodyA), /^A: the corridor is glass :B$/);

  // A pointer: sent as a place in the text, throttled, heard as sent.
  const heard = [];
  sessionB.onPointer((from, pointer) => heard.push({ from, pointer }));
  const place = bytesToBase64(Y.encodeRelativePosition(Y.createRelativePositionFromTypeIndex(bodyA.get(0).get(0), 5)));
  const before = sessionA.stats().pointersSent;
  for (let step = 0; step < 10; step += 1) sessionA.sendPointer({ at: place, dx: step, dy: 2 });
  await sleep(30);
  assert.equal(sessionA.stats().pointersSent - before, 1, 'a burst of moves is one message');
  assert.equal(heard.at(-1).pointer.dx, 9, 'and it carries the latest spot');
  assert.equal(heard.at(-1).from, docA.clientID);
  const relative = Y.decodeRelativePosition(base64ToBytes(heard.at(-1).pointer.at));
  assert.equal(Y.createAbsolutePositionFromRelativePosition(relative, docB).index, 5, 'the place reads the same in the other copy');

  const started = Date.now();
  let moves = 0;
  while (Date.now() - started < 1000) {
    sessionA.sendPointer({ at: place, dx: moves, dy: 0 });
    moves += 1;
    await sleep(10);
  }
  const elapsed = (Date.now() - started) / 1000;
  await sleep(150);
  const perSecond = (sessionA.stats().pointersSent - before - 1) / elapsed;
  assert.ok(perSecond >= 6 && perSecond <= 9, `moving sends about 8 a second, whatever the mouse does (${moves} moves gave ${perSecond.toFixed(1)}/s)`);

  // A pointer with nonsense in it is dropped, not drawn.
  wire.a.send({ kind: 'pointer', from: docA.clientID, at: 'x', dx: 1e9, dy: 0 });
  assert.notEqual(heard.at(-1).pointer?.dx, 1e9);

  sessionA.sendPointer(null);
  await sleep(150);
  assert.equal(heard.at(-1).pointer, null, 'leaving the document takes the pointer away');

  // A reader: listens, sends nothing - not even the request for the document.
  const wire2 = linkedRooms();
  // A reader opens from the saved copy (it cannot ask anyone for the document), then hears what follows.
  const docR = new Y.Doc();
  Y.applyUpdate(docR, Y.encodeStateAsUpdate(docA), 'stored');
  const sessionEditor = createDocSession({ room: wire2.a, doc: docA, awareness: new Awareness(docA), user: { name: 'TEST A', colour: '#000080', userId: 'A' }, canSend: true });
  const sentBefore = wire2.counts[1];
  const sessionR = createDocSession({ room: wire2.b, doc: docR, awareness: new Awareness(docR), user: { name: 'TEST B', colour: '#008000', userId: 'B' }, canSend: false });
  sessionR.sendPointer({ at: place, dx: 0, dy: 0 });
  sessionR.announceSaved();
  bodyA.get(0).get(0).insert(0, '!');
  await sleep(200);
  assert.equal(wire2.counts[1] - sentBefore, 0, 'a reader sends nothing on the channel');
  assert.match(writing(docR.getXmlFragment(DOC_FIELD)), /^!/, 'but hears the changes made after it joined');
  let savedHeard = 0;
  sessionR.onSaved(() => (savedHeard += 1));
  sessionEditor.announceSaved();
  assert.equal(savedHeard, 1, 'and is told when a save lands, so it can read the saved copy again');

  for (const session of [sessionA, sessionB, sessionEditor, sessionR]) session.destroy();

  // A seeded lore page opens with its writing in the document.
  const seeded = new Y.Doc();
  Y.applyUpdate(seeded, base64ToBytes(documentStateFromText('First.\n\nSecond.')));
  assert.equal(writing(seeded.getXmlFragment(DOC_FIELD)), 'First.\nSecond.');

  // 4. The mock store's access rules.
  const store = getMockDocsRepository();
  const A = { id: 'user-a', name: 'TEST A' };
  const B = { id: 'user-b', name: 'TEST B' };

  store.setViewer(null);
  const lore = (await store.listDocs()).filter((doc) => doc.folderId === LORE_FOLDER_ID);
  assert.equal(lore.length, 2, 'a visitor sees the lore pages');
  assert.ok((await store.getDocBySlug('hexham-grid')) !== null, 'and opens one by its lore address');

  store.setViewer(A.id);
  const secret = await store.createDoc({ title: 'secret plan', summary: '', folderId: null, access: 'private', viewer: A });
  assert.equal(secret.title, 'SECRET PLAN');
  store.setViewer(B.id);
  assert.equal((await store.listDocs()).some((doc) => doc.id === secret.id), false, 'PRIVATE: not listed for B');
  assert.equal(await store.getDoc(secret.id), null, 'nor opened by B');
  await assert.rejects(() => store.saveDoc({ id: secret.id, state: '', bodyText: 'x', viewer: B }), /ONLY READ|NOT FOUND/);

  store.setViewer(A.id);
  await store.updateDoc(secret.id, { access: 'shared' });
  await store.setShare(secret.id, { personId: B.id, personLabel: B.name, canEdit: false });
  store.setViewer(B.id);
  assert.equal((await store.getDoc(secret.id)).role, 'read', 'shared with B, CAN READ');
  await assert.rejects(() => store.updateDoc(secret.id, { access: 'public' }), /ONLY READ|ONLY THE OWNER/, 'B cannot change sharing');
  store.setViewer(A.id);
  await store.setShare(secret.id, { personId: B.id, personLabel: B.name, canEdit: true });
  store.setViewer(B.id);
  assert.equal((await store.getDoc(secret.id)).role, 'edit', 'CAN EDIT');
  await assert.rejects(() => store.updateDoc(secret.id, { access: 'public' }), /ONLY THE OWNER/, 'an editor still cannot change sharing');
  await assert.rejects(() => store.deleteDoc(secret.id), /ONLY THE OWNER/);
  await store.updateDoc(secret.id, { title: 'renamed' });
  assert.equal((await store.getDoc(secret.id)).title, 'RENAMED', 'an editor may rename it');

  await assert.rejects(() => store.createDoc({ title: 'x', summary: '', folderId: LORE_FOLDER_ID, access: 'public', slug: 'hexham-grid', viewer: B }), /TAKEN/);

  const kept = await store.keepVersion({ docId: secret.id, state: 'AA==', snippet: 'one', name: null, viewer: B });
  assert.ok(kept !== null, 'the first hourly copy is kept');
  assert.equal(await store.keepVersion({ docId: secret.id, state: 'AA==', snippet: 'two', name: null, viewer: B }), null, 'a second within the hour is not');
  assert.ok((await store.keepVersion({ docId: secret.id, state: 'AA==', snippet: 'named', name: 'DRAFT 1', viewer: B })) !== null, 'a named one always is');

  // 5. The forum.
  const anchor = docAnchor({ id: secret.id, slug: null, title: 'ISSUE 3' });
  assert.equal(anchor.kind, 'doc');
  assert.equal(anchor.href, `/docs/${secret.id}`);
  const post = docAnnouncement({ id: secret.id, slug: null, title: 'ISSUE 3' }, 'The first lines of it.', 'https://debaser.site');
  assert.equal(post.title, 'NEW DOC :: ISSUE 3');
  assert.deepEqual(docLinkIn(post.body), { words: 'The first lines of it.', href: `/docs/${secret.id}` }, 'the board reads the link back out as [ OPEN DOC ]');
  assert.deepEqual(docLinkIn('A lore page\n\nhttps://debaser.site/lore/hexham-grid'), { words: 'A lore page', href: '/lore/hexham-grid' });
  assert.equal(docLinkIn('see https://evil.example/docs/../x'), null);
  assert.equal(docLinkIn('nothing here'), null);

  console.log('check-docs: addresses, sharing, pointers (8/s, 2/s crowded, stepped fade), handshake, readers silent, mock access rules, forum post: all hold');
  process.exit(0);
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
