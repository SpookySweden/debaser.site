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
assert.match(text(draw(el(DocsBrowser))), /PUBLIC DOCS\//, 'signed out, the browser offers the public documents');
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
assert.match(text(draw(el(DocMargin, { editor: null, docId: 'doc-x', viewer, role: 'edit', draft: null, onDraftDone: () => undefined }))), /COMMENTS NONE YET\./);
const draftHtml = text(draw(el(DocMargin, { editor: null, docId: 'doc-x', viewer, role: 'edit', draft: { anchorFrom: 'AA', anchorTo: 'AA', quote: 'glass' }, onDraftDone: () => undefined })));
assert.match(draftHtml, /“glass”/, 'a new comment shows the words it is about');
assert.match(draftHtml, /\[ ADD COMMENT \]/, 'and its key is not the forum key [ COMMENT ]');
assert.match(draw(el(DocPointers, { editor: null, session: null, peers: [], frame: { current: null }, sends: true })), /doc-pointers/);

console.log('check-docs-render: the browser, a document, the lore shelf, faces, the margin, pointers and the windows all draw');
