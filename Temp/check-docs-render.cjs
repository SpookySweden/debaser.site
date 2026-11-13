/*
 * DOCS' screens, drawn (SPEC-live-docs.md): the file browser, a document, the lore shelf, and the windows they open.
 *   npx tsc app/components/DocView.tsx app/components/DocsBrowser.tsx app/components/LoreDirectory.tsx app/components/DocEditor.tsx app/components/DocHistoryWindow.tsx app/components/DocSharingWindow.tsx app/components/DocMargin.tsx app/components/DocPointers.tsx app/components/DocFace.tsx app/components/NewDocWindow.tsx app/components/NewDocFolderWindow.tsx app/components/AuthProvider.tsx app/components/ForumProvider.tsx app/components/CommsProvider.tsx --rootDir app --outDir Temp/docs-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-docs-render.cjs
 *
 * A server render is a component's first paint: the browser and lore shelf before their rows arrive, a document
 * before it is read, the windows as they open, a face with and without a picture. The live parts (the editor, the
 * carets, the pointers) are proven in two real browsers by scripts/drive-docs.cjs; this holds that every screen
 * draws without throwing and says the few words it should, signed in and out.
 */
const assert = require('node:assert/strict');
const path = require('node:path');
const React = require('react');
const { renderToStaticMarkup } = require('react-dom/server');

const OUT = path.join(__dirname, 'docs-render');
const el = React.createElement;

function stub(name, exports) {
  const resolved = require.resolve(name);
  require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
}

let searchParams = new URLSearchParams();
stub('next/navigation', {
  useRouter: () => ({ push: () => undefined, replace: () => undefined, refresh: () => undefined, back: () => undefined, forward: () => undefined, prefetch: () => undefined }),
  usePathname: () => '/docs',
  useSearchParams: () => searchParams,
});

const load = (file) => require(path.join(OUT, file));
const DocView = require('./docs-render/components/DocView.js').default;
const DocsBrowser = require('./docs-render/components/DocsBrowser.js').default;
const LoreDirectory = require('./docs-render/components/LoreDirectory.js').default;
const DocFace = require('./docs-render/components/DocFace.js').default;
const DocHistoryWindow = require('./docs-render/components/DocHistoryWindow.js').default;
const NewDocWindow = require('./docs-render/components/NewDocWindow.js').default;
const NewDocFolderWindow = require('./docs-render/components/NewDocFolderWindow.js').default;
const DocMargin = require('./docs-render/components/DocMargin.js').default;
require('./docs-render/components/DocEditor.js');
require('./docs-render/components/DocSharingWindow.js');
const DocPointers = require('./docs-render/components/DocPointers.js').default;
const AuthProvider = require('./docs-render/components/AuthProvider.js').default;
const ForumProvider = require('./docs-render/components/ForumProvider.js').default;
const CommsProvider = require('./docs-render/components/CommsProvider.js').default;
const { LORE_FOLDER_ID } = require('./docs-render/lib/docs/types.js');
const Y = require('yjs');

const wrap = (child) => el(AuthProvider, null, el(ForumProvider, null, el(CommsProvider, null, child)));
const draw = (child) => renderToStaticMarkup(wrap(child));
const text = (html) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

// The pages before their data: a reading line, never a crash.
assert.match(text(draw(el(DocView, { target: { id: 'doc-0b9d6f3e-1a2b-4c3d-8e9f-0a1b2c3d4e5f' } }))), /READING THE DOCUMENT/);
assert.match(text(draw(el(DocView, { target: { slug: 'hexham-grid' } }))), /READING THE DOCUMENT/);
assert.match(text(draw(el(DocsBrowser))), /FOLDERS/);
searchParams = new URLSearchParams(`folder=${LORE_FOLDER_ID}`);
assert.match(text(draw(el(DocsBrowser))), /PUBLIC DOCUMENTS/, 'signed out, the browser offers the public documents');
// The front page's big keys (the 2026-11-13 overhaul): where to look, and the text size, drawn before any row arrives.
searchParams = new URLSearchParams();
const front = draw(el(DocsBrowser));
assert.match(text(front), /\[ PUBLIC DOCUMENTS \].*\[ FOLDERS \]/, 'the places to look are keys across the top');
assert.match(text(front), /TEXT SIZE \[ A− \] \[ A\+ \]/, 'the text size keys are on the front page');
assert.match(front, /class="docs-ui" data-docs-size="2"/, 'the page is drawn at the starting text size until the browser says otherwise');
assert.match(text(draw(el(LoreDirectory))), /PAGES/);

// A face: a picture slot always, the name, the colour as the fill.
const face = draw(el(DocFace, { name: 'TEST ACCOUNT A', colour: '#1d3ca6', userId: null, self: true }));
assert.match(face, /doc-face__picture/);
assert.match(text(face), /TEST ACCOUNT A \(YOU\)/);
assert.match(face, /background-color:#1d3ca6/);

const viewer = { id: 'user-a', name: 'TEST ACCOUNT A' };

// The windows as they open.
const lore = { id: LORE_FOLDER_ID, name: 'LORE', parentId: null, kind: 'shared', ownerId: null, ownerLabel: 'debaser.site', defaultAccess: 'public', createdAt: '2026-11-13T00:00:00.000Z' };
const newLore = text(draw(el(NewDocWindow, { viewer, folder: lore, onClose: () => undefined })));
// PopoutWindow draws into a portal after mounting, so its first paint may be empty; it must not throw either way.
assert.equal(typeof newLore, 'string');
assert.equal(typeof text(draw(el(NewDocWindow, { viewer, folder: null, onClose: () => undefined }))), 'string');
assert.equal(typeof text(draw(el(NewDocFolderWindow, { viewer, parent: null, kind: 'shared', onMade: () => undefined, onClose: () => undefined }))), 'string');
const doc = new Y.Doc();
assert.equal(typeof text(draw(el(DocHistoryWindow, { docId: 'doc-x', doc, editor: null, viewer, editing: true, owner: true, onKept: () => undefined, onClose: () => undefined }))), 'string');

// The margin with nothing in it yet, and the pointer layer with nobody moving.
const margin = { editor: null, docId: 'doc-x', viewer, role: 'edit', beside: true, onCount: () => undefined, onDraftDone: () => undefined };
assert.match(text(draw(el(DocMargin, { ...margin, draft: null }))), /COMMENTS NONE YET\./);
const draftHtml = text(draw(el(DocMargin, { ...margin, draft: { anchorFrom: 'AA', anchorTo: 'AA', quote: 'glass' } })));
assert.match(draftHtml, /“glass”/, 'a new comment shows the words it is about');
assert.match(draftHtml, /\[ ADD COMMENT \]/, 'and its key is not the forum key [ COMMENT ]');
assert.match(draw(el(DocPointers, { editor: null, session: null, peers: [], frame: { current: null }, sends: true })), /doc-pointers/);

// A row of the list: the title, then who can open it, whose it is and when it changed, in plain words; the whole row is the link.
const { DocRow, FolderRow } = require('./docs-render/components/DocRows.js');
const DocMoveWindow = require('./docs-render/components/DocMoveWindow.js').default;
const ui = require('./docs-render/lib/docs/ui.js');
const noon = new Date(2026, 10, 13, 12, 0).getTime();
const iso = (...parts) => new Date(...parts).toISOString();
const summary = { id: 'doc-0b9d6f3e-1a2b-4c3d-8e9f-0a1b2c3d4e5f', slug: null, title: 'SHOPPING LIST', summary: '', access: 'private', folderId: null, ownerId: 'user-a', ownerLabel: 'TEST ACCOUNT A', createdAt: iso(2026, 10, 13, 9, 0), createdByLabel: 'TEST ACCOUNT A', updatedAt: iso(2026, 10, 13, 11, 55), updatedByLabel: 'TEST ACCOUNT A' };
const mineRow = renderToStaticMarkup(el('ul', null, el(DocRow, { doc: summary, viewerId: 'user-a', now: noon })));
assert.match(text(mineRow), /SHOPPING LIST ONLY YOU · BY YOU · CHANGED 5 MINUTES AGO/, 'my own row, in plain words');
assert.match(mineRow, /<a [^>]*href="\/docs\/doc-0b9d6f3e-1a2b-4c3d-8e9f-0a1b2c3d4e5f"/, 'the row is a link to the document');
const theirRow = text(renderToStaticMarkup(el('ul', null, el(DocRow, { doc: { ...summary, access: 'shared', updatedAt: iso(2026, 10, 12, 9, 10) }, viewerId: 'user-b', now: noon, folderName: 'NOTES' }))));
assert.match(theirRow, /SHARED WITH YOU · BY TEST ACCOUNT A · IN NOTES · CHANGED YESTERDAY AT 09:10/, 'somebody else\'s row says whose it is and where');
assert.match(text(renderToStaticMarkup(el('ul', null, el(FolderRow, { folder: lore, href: '/docs?folder=x' })))), /LORE FOLDER · BY debaser\.site/);
assert.equal(typeof text(draw(el(DocMoveWindow, { doc: summary, folders: [lore], onMove: async () => undefined, onClose: () => undefined }))), 'string');

// The plain words themselves (app/lib/docs/ui.ts).
assert.equal(ui.whenWords(iso(2026, 10, 13, 11, 59, 40), noon), 'JUST NOW');
assert.equal(ui.whenWords(iso(2026, 10, 13, 11, 59), noon), '1 MINUTE AGO');
assert.equal(ui.whenWords(iso(2026, 10, 13, 8, 5), noon), 'TODAY AT 08:05');
assert.equal(ui.whenWords(iso(2026, 10, 12, 23, 30), noon), 'YESTERDAY AT 23:30');
assert.equal(ui.whenWords(iso(2026, 10, 10, 15, 0), noon), '3 DAYS AGO');
assert.equal(ui.whenWords(iso(2026, 9, 2, 15, 0), noon), '2 OCT 2026');
assert.equal(ui.whenWords('not a date', noon), 'SOME TIME AGO');
assert.equal(ui.dateWords(iso(2026, 10, 13, 15, 49)), '13 NOV 2026, 15:49');
assert.deepEqual(['private', 'shared', 'signed_in', 'public'].map((level) => ui.accessWords(level, true)), ['ONLY YOU', 'PEOPLE YOU PICKED', 'ANYONE SIGNED IN', 'EVERYONE']);
assert.equal(ui.accessWords('shared', false), 'SHARED WITH YOU');
assert.equal(ui.roomWords(true, 0, true), 'CONNECTING...');
assert.equal(ui.roomWords(false, 0, true), 'ONLY YOU HERE');
assert.equal(ui.roomWords(false, 2, true), '3 PEOPLE HERE');
assert.equal(ui.roomWords(false, 0, false), 'NOBODY WRITING NOW');
assert.deepEqual([0, 1, 3.4, 6, 9, Number.NaN].map(ui.clampDocsSize), [1, 1, 3, 6, 6, 2], 'a text size is always one of the six steps');

console.log('check-docs-render: the browser, a document, the lore shelf, rows, faces, the margin, pointers and the windows all draw, in plain words');
