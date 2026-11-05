/*
 * The two flows the site promises: a challenge sent at an account from the directory that lists it, and
 * a track filed with a post.
 *   npx tsc app/lib/games/challenges.ts app/lib/games/catalogue.ts app/lib/audio/forum-tracks.ts app/lib/audio/tags.ts app/lib/audio/tracks.ts app/lib/audio/sorts.ts app/lib/forum/anchors.ts app/lib/profile/presence.ts app/lib/profile/name-colours.ts app/lib/forum/format.ts --outDir Temp/flows-out --module commonjs --target es2020 --moduleResolution node --skipLibCheck --esModuleInterop --strict
 *   npx tsc app/components/ArcadeWindow.tsx app/components/ChallengeControl.tsx app/components/TrackControl.tsx app/components/TrackPickerWindow.tsx app/components/MusicWindow.tsx app/components/DockWindow.tsx --outDir Temp/flows-render --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-flows.cjs
 *
 * The rule this file keeps is the site's own: an action a reader starts on the board is two presses
 * away. Counting buttons on a page proves nothing (a page gets rearranged), so the flows are held to
 * what they *are* - the one module that sends a challenge, and the sentences that refuse one - and to
 * the shape of the surfaces that offer them:
 *
 *   1. a challenge is one call: the row is filed before the bell is rung, and a bell that fails does
 *      not lose the invitation;
 *   2. the refusal a reader meets comes from one table, so a dark plate and a refusing window say
 *      the same words;
 *   3. nothing outside that module files an invitation, so a second surface - the account directory's
 *      `[ CHALLENGE ]`, a name in the arcade's own roster - cannot grow its own half of the act;
 *   4. a track rides with the post from the composer it is written in;
 *   5. the arcade is a window rather than a page: one store opens and closes it, and the three
 *      addresses it answers to are built by the same module that reads them, so the header key, a
 *      post's plate and the bell's row all mean the same thing.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');

const { CHALLENGE_SELF, CHALLENGE_SIGN_IN, challengeRefusal, sendChallenge } = require('./flows-out/games/challenges.js');
// The store the window itself was built with, not a second copy: `ArcadeWindow` reads its own
// compiled twin of `lib/games/arcade-window`, and a check that opened the window in one copy while
// the component read another would prove nothing (it did, once).
const {
  ARCADE_DEFAULT_GAME,
  arcadeAddressSpentByClose,
  arcadeFocusFromSearch,
  arcadeHref,
  arcadeWindowState,
  closeArcade,
  openArcade,
  toggleArcade,
} = require('./flows-render/lib/games/arcade-window.js');
// The archive's window, read from the same compiled copy the window itself was built with.
const {
  MUSIC_HREF,
  closeMusic,
  musicRequested,
  musicWindowState,
  openMusic,
  subscribeToMusicWindow,
  toggleMusic,
} = require('./flows-render/lib/audio/music-window.js');

const read = (file) => fs.readFileSync(file, 'utf8');
const codeOf = (file) => read(file).replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '');

const amy = { id: 'amy', displayName: 'amy' };
const bo = { id: 'bo', displayName: 'bo' };

/** The smallest store a challenge needs: one row back, and what it was asked for. */
function fakeStore() {
  const calls = [];

  return {
    calls,
    create: async (input) => {
      calls.push(input);

      return {
        id: 'invite-1',
        game: input.game,
        fromUserId: input.from.id,
        fromName: input.from.displayName,
        toUserId: input.to.id,
        toName: input.to.displayName,
        status: 'pending',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
    },
  };
}

(async () => {
  /* 1. One press: the row first, the bell second, and only what the store takes ---- */
  const order = [];
  const rang = [];
  const store = fakeStore();

  const sent = await sendChallenge({
    repository: {
      create: async (input) => {
        order.push('filed');
        return store.create(input);
      },
    },
    notify: async (input) => {
      order.push('rung');
      rang.push(input);
    },
    from: amy,
    to: bo,
    game: 'tic-tac-toe',
  });

  assert.equal(sent.ok, true, 'a signed-in account can ask another for a game');
  assert.deepEqual(
    store.calls,
    [{ game: 'tic-tac-toe', from: { id: 'amy', displayName: 'amy' }, to: { id: 'bo', displayName: 'bo' } }],
    'one row, filed once, signed by the account doing the asking',
  );
  assert.deepEqual(order, ['filed', 'rung'], 'the row exists before anything tells anybody about it');
  assert.equal(rang.length, 1, 'the bell is rung once');
  assert.equal(rang[0].inviteId, 'invite-1', 'for the row that was filed');
  assert.equal(rang[0].toUserId, 'bo', 'for the account the challenge is addressed to');
  assert.equal(rang[0].gameTitle, 'TIC-TAC-TOE', 'naming the game the way the catalogue does');
  assert.equal(sent.notice, 'TIC-TAC-TOE SENT TO BO.', 'and saying so in one line');

  /* 2. A bell that cannot be rung does not lose the invitation --------------------- */
  const warned = [];
  const realWarn = console.warn;
  console.warn = (...args) => warned.push(args.join(' '));

  const survived = await sendChallenge({
    repository: fakeStore(),
    notify: async () => {
      throw new Error('feed down');
    },
    from: amy,
    to: bo,
    game: 'paddle-duel',
  });

  console.warn = realWarn;

  assert.equal(survived.ok, true, 'the challenge stands when only the alert fails');
  assert.equal(survived.invite.status, 'pending', 'because the row was already filed');
  assert.match(warned.join(' '), /bell could not be told/, 'and it is said out loud rather than swallowed');

  /* 3. A guest has no row to sign -------------------------------------------------- */
  const stranger = fakeStore();
  const refused = await sendChallenge({
    repository: stranger,
    notify: async () => undefined,
    from: null,
    to: bo,
    game: 'tic-tac-toe',
  });

  assert.equal(refused.ok, false, 'no account, no invitation');
  assert.equal(refused.error, CHALLENGE_SIGN_IN, 'and the refusal is the sentence a dark plate is titled with');
  assert.equal(stranger.calls.length, 0, 'nothing is filed for a guest');
  assert.equal(
    refused.error,
    challengeRefusal({ viewerId: null, targetId: 'bo', targetName: 'bo', status: 'online' }),
    'the sender and the plate refuse in the same words',
  );

  /* 4. Every refusal, from one table ---------------------------------------------- */
  const reason = (status) => challengeRefusal({ viewerId: 'amy', targetId: 'bo', targetName: 'bo', status });

  assert.equal(
    challengeRefusal({ viewerId: 'amy', targetId: 'amy', targetName: 'amy', status: 'online' }),
    CHALLENGE_SELF,
    'you cannot challenge yourself',
  );
  assert.match(reason('offline'), /^BO IS OFFLINE/, 'an account that is not on is named, and why is said');
  // (2026-10-27, Luke: "far more reactive" lamps) Yellow is AWAY now - a tab open but not in use - not
  // "online within the last hour"; somebody who left is red, and the tooltip says how long ago.
  // Away still has the site open, so the invitation reaches them: only offline is refused.
  assert.equal(reason('away'), null, 'somebody away (the site open in another tab) can still be asked');
  assert.match(reason('offline'), /OFFLINE/, "the lamp's own words, not a second vocabulary");
  // (2026-10-25, SPEC-less-text.md) The refusal shortened to `BO IS OFFLINE.`: the tail `- A MATCH NEEDS BOTH
  // SCREENS, AND AN INVITATION LASTS 10 MINUTES.` is cut (app/lib/games/challenges.ts challengeOfflineReason).
  assert.equal(reason('offline'), 'BO IS OFFLINE.', 'and says only that, with no explanation tail');
  assert.doesNotMatch(reason('offline'), /MINUTES|BOTH SCREENS/, 'no invitation window spelled out');
  assert.equal(reason('online'), null, 'somebody who is on can be asked');

  /* 5. One module files an invitation -------------------------------------------- */
  const hub = codeOf('app/components/GamesHub.tsx');

  assert.doesNotMatch(hub, /repository\.create\(/, 'the hub asks challenges.ts instead of filing an invitation itself');
  assert.doesNotMatch(hub, /notifyInvited\(\{/, 'and does not ring the bell around it either');
  assert.match(hub, /sendChallenge\(/, 'it asks, and the asking is the one call');

  /* 6. A track rides with the post, two presses from the composer it is written in ---- */
  const composer = codeOf('app/components/CommentComposer.tsx');
  const control = codeOf('app/components/TrackControl.tsx');
  const trackWindow = codeOf('app/components/TrackPickerWindow.tsx');
  const picker = codeOf('app/components/TrackAttachmentPicker.tsx');

  assert.match(composer, /<TrackControl/, 'the composer carries the control for it');
  assert.match(composer, /submitLabel/, 'in the same box as the post itself, not under everything else');
  assert.match(control, /\[ ♪ SOUNDTRACK \]/, 'and that control is one plate');
  assert.match(control, /<TrackPickerWindow/, 'pressing which opens the window');
  assert.match(trackWindow, /<PopoutWindow/, "which is the site's own window shell");
  assert.match(trackWindow, /<TrackAttachmentPicker/, 'carrying the three ways in');
  assert.match(picker, /ARCHIVE_LIST_MAX/, 'and the shelf list knows how much of the archive it draws');
  assert.match(
    picker,
    /useState<'file' \| 'archive' \| 'link'>\('archive'\)/,
    'the archive is what the window opens on, rather than a question about sources before any names',
  );
  assert.doesNotMatch(picker, /fieldset/, 'and no fieldset is left in the composer to scroll past');

  /* 7. The arcade is a window, and its three addresses are one grammar -------------- */
  assert.equal(arcadeWindowState().open, false, 'the arcade starts shut');
  assert.equal(arcadeWindowState(), arcadeWindowState(), 'and its snapshot is one object, so React can compare it');

  openArcade();
  assert.equal(arcadeWindowState().open, true, 'a plate opens it');
  assert.deepEqual(arcadeWindowState().focus, { kind: 'floor' }, 'on the floor, unless it was opened for something');

  const asked = { kind: 'challenge', opponentId: 'bo', game: 'paddle-duel' };
  openArcade(asked);
  assert.deepEqual(arcadeWindowState().focus, asked, 'and a challenge can be what it was opened for');

  closeArcade();
  assert.equal(arcadeWindowState().open, false, 'ESC, the desktop or [ CLOSE ] shuts it');

  for (const focus of [{ kind: 'floor' }, { kind: 'invite', inviteId: 'invite-1' }, asked]) {
    assert.deepEqual(
      arcadeFocusFromSearch(new URL(arcadeHref(focus), 'https://debaser.site').search),
      focus,
      `a link round-trips: ${arcadeHref(focus)}`,
    );
  }

  assert.match(
    arcadeHref({ kind: 'challenge', opponentId: 'bo', game: 'paddle-duel' }),
    /^\/forum\?challenge=bo&game=paddle-duel$/,
    "the address is the board's, because the board is the only page there is",
  );
  assert.equal(arcadeFocusFromSearch('?tag=design'), null, 'a link about something else opens nothing');
  assert.equal(arcadeFocusFromSearch(''), null, 'and neither does no link at all');
  assert.deepEqual(
    arcadeFocusFromSearch('?challenge=bo&game=checkers'),
    { kind: 'challenge', opponentId: 'bo', game: ARCADE_DEFAULT_GAME },
    'a game the arcade does not have is not what gets played',
  );

  /* 8. Nothing left behind: the page is gone, and no link points at it ------------- */
  assert.equal(fs.existsSync('app/games/page.tsx'), false, 'the arcade has no page of its own any more');

  /**
   * Every source file under `app`, walked rather than listed by directory: the last two addresses
   * that moved (the arcade's page, then the archive's) were each still named in a file a hand-written
   * list of directories did not reach - one of them in `app/lib/projects/links.ts`, which is a link
   * table nobody thinks of as a page.
   */
  const sources = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) walk(path);
      else if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) sources.push(path);
    }
  };

  walk('app');

  const stale = sources.filter((file) => /["'`]\/games(?:\?|["'`])/.test(codeOf(file)));
  assert.deepEqual(stale, [], 'and nothing still links to the address that page had');

  const staleMusic = sources.filter((file) => /["'`]\/music(?:\?|["'`])/.test(codeOf(file)));
  assert.deepEqual(staleMusic, [], 'nor to the one the archive had before it became a window');

  assert.equal(fs.existsSync('app/music/page.tsx'), false, 'the archive has no page of its own either');

  /* 9. The surfaces that offer the two presses ------------------------------------- */
  // The arcade's verb is offered where accounts are listed, and no longer on a post: the post's header
  // is a one-line credit strip now - the picture leading, then the name, the stamp - and a plate in the
  // middle of it turned a credit into a toolbar. The arcade itself is unchanged and still two presses
  // from anywhere (the side panel's key, the bell); what moved is only where the asking sits.
  assert.doesNotMatch(
    codeOf('app/components/ForumThreadCard.tsx'),
    /<ChallengeControl/,
    'a post no longer carries [ CHALLENGE ] in its credit strip',
  );
  assert.match(codeOf('app/components/UserDirectory.tsx'), /<ChallengeControl/, 'the account directory carries it');
  assert.match(codeOf('app/components/UserDirectoryRow.tsx'), /\{actions\}/, 'the row it sits in has the room for it');
  assert.match(codeOf('app/components/UserDirectory.tsx'), /compact \? undefined/, 'and the side panel`s glance-row stays one plate wide');
  assert.match(codeOf('app/components/ForumBoard.tsx'), /new-post-link|setComposerOpen/, 'the board still offers its own composer');
  assert.match(codeOf('app/components/DesktopSidebar.tsx'), /SIDE_ARCADE/, 'and the side panel is where the arcade key lives');
  assert.match(codeOf('app/components/ArcadeWindow.tsx'), /<GamesHub focus=/, 'the window is the hub, told what it was opened for');
  assert.match(codeOf('app/layout.tsx'), /<ArcadeWindow \/>/, 'drawn once for the whole site, the way the player bar is');
  assert.match(codeOf('app/components/NotificationMenu.tsx'), /openArcade\(\{ kind: 'invite'/, 'the bell answers a knock where the reader is standing');

  /* 10. The window and the plate, drawn -------------------------------------------- */
  const Module = require('node:module');
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const originalLoad = Module._load;

  /** The provider seams the hub reads, and the window shell, answered as the smallest thing that fits. */
  const stubs = {
    './flows-render/components/PopoutWindow.js': {
      __esModule: true,
      default: ({ title, badge, children }) => React.createElement('section', null, `${title} ${badge}`, children),
    },
    './flows-render/components/AuthProvider.js': {
      useAuth: () => ({ user: { id: 'amy', displayName: 'amy' } }),
    },
    './flows-render/components/CommsProvider.js': {
      // Updated on purpose (SPEC-test-accounts.md): the provider now hands lookups the whole account set
      // as `allAccounts` beside the listed `accounts`; nobody is hidden here, so the two are the same.
      useComms: () => {
        const accounts = [
          { id: 'amy', displayName: 'amy' },
          { id: 'bo', displayName: 'bo' },
        ];
        return { accounts, allAccounts: accounts, unreadTotal: 0 };
      },
    },
    './flows-render/components/NotificationsProvider.js': {
      useNotifications: () => ({ notifyInvited: () => Promise.resolve() }),
    },
    // Nobody is on in this render, which is the case worth drawing: the window has to say why rather
    // than offer a press that cannot work.
    './flows-render/components/PresenceProvider.js': {
      usePresenceDirectory: () => ({ ready: true, statusFor: () => 'offline', recordFor: () => undefined }),
    },
    './flows-render/components/UserDirectoryRow.js': {
      __esModule: true,
      default: ({ row, actions }) => React.createElement('li', null, row.account.displayName, actions),
    },
    // One track on the shelf, so the archive tab has something to list and `[ ATTACH ]` to offer.
    './flows-render/components/MusicPlayerProvider.js': {
      useMusicPlayer: () => ({
        queue: [{ src: 'https://example.test/one.mp3', title: 'ONE', credit: 'DEBASER', length: '1:11', shelf: 'archive' }],
        loading: false,
      }),
    },
  };

  Module._load = function load(request, parent, isMain) {
    const stub = stubs[request];
    if (stub !== undefined) return { __esModule: true, ...stub };

    return originalLoad.call(this, request, parent, isMain);
  };

  for (const [path, exports] of Object.entries(stubs)) {
    const resolved = require.resolve(path);
    require.cache[resolved] = { id: resolved, filename: resolved, loaded: true, exports };
  }

  const ArcadeWindow = require('./flows-render/components/ArcadeWindow.js').default;
  const ChallengeControl = require('./flows-render/components/ChallengeControl.js').default;
  const element = React.createElement;
  const textOf = (html) => html.replace(/<[^>]*>/g, '');

  /**
   * The window as a browser hands it over: a path, a query, and a router it can clear the query
   * with. `useSearchParams`, `usePathname` and `useRouter` all throw outside a real Next render, so
   * they are given the contexts `Temp/check-shell.cjs` gives its own components.
   */
  const { AppRouterContext } = require('next/dist/shared/lib/app-router-context.shared-runtime.js');
  const { PathnameContext, SearchParamsContext } = require('next/dist/shared/lib/hooks-client-context.shared-runtime.js');

  const router = {
    push: () => undefined,
    replace: () => undefined,
    refresh: () => undefined,
    back: () => undefined,
    forward: () => undefined,
    prefetch: () => undefined,
  };

  const at = (query) =>
    element(
      AppRouterContext.Provider,
      { value: router },
      element(
        PathnameContext.Provider,
        { value: '/forum' },
        element(SearchParamsContext.Provider, { value: new URLSearchParams(query) }, element(ArcadeWindow, {})),
      ),
    );

  assert.equal(renderToStaticMarkup(at('')), '', 'no window is drawn while none is open');

  // The store is opened directly here: an address opens it in an effect, and an effect is exactly
  // what a server render does not run. That the address *means* a challenge is section 7's business.
  openArcade({ kind: 'challenge', opponentId: 'bo', game: 'paddle-duel' });
  const drawn = renderToStaticMarkup(at(''));
  const drawnText = textOf(drawn);
  closeArcade();

  // (2026-10-23, SPEC-efficiency.md) The window is titled `ARCADE` whatever it was opened for; the challenge
  // panel's own title line (next) says what it was opened to do.
  assert.doesNotMatch(drawnText, /ARCADE :: CHALLENGE/, 'the window is not titled twice');
  assert.match(drawnText, /CHALLENGE \/\/ BO/, 'and names the account the post named');
  assert.match(drawn, /PADDLE DUEL/, 'the game it was opened on is drawn among the plates');
  // (2026-10-25, SPEC-less-text.md) `[ SEND INVITATION ]` -> `[ INVITE ]`.
  assert.match(drawnText, /\[ INVITE \]/, 'one press sends it, and it is the only press left');
  assert.doesNotMatch(drawnText, /\[ SEND INVITATION \]/, 'under its short name');
  // (2026-11-05, SPEC-privacy-phase-1.md) BO has no presence stamp here, which now means a lamp switched off. That says nothing about
  // whether BO is around, so the invitation is not refused. An account whose stamp says offline still is (`reason('offline')`, above).
  assert.doesNotMatch(drawnText, /BO IS OFFLINE/, 'a lamp that is off does not claim the account is offline');

  const plate = (props = {}) =>
    renderToStaticMarkup(
      element(ChallengeControl, { author: { id: 'bo', displayName: 'bo' }, viewerId: 'amy', ...props }),
    );

  assert.match(plate({ status: 'online' }), /\[ CHALLENGE \]/, 'the plate offers the verb while they are on');
  // (2026-10-25, SPEC-less-text.md) Tip `Ask bo for a game: the arcade opens over this thread` -> `Challenge bo`.
  assert.match(plate({ status: 'online' }), /title="Challenge bo"/, 'and names who pressing it challenges');
  assert.doesNotMatch(plate({ status: 'online' }), /the arcade opens over this thread/, 'in two words');
  assert.match(plate({ status: 'offline' }), /disabled/, 'it is dark while they are not on');
  assert.match(plate({ status: 'offline' }), /BO IS OFFLINE/, 'with the reason on it, rather than hidden');
  assert.equal(plate({ viewerId: null, status: 'online' }), '', 'a guest is not offered a verb they cannot use');
  assert.equal(plate({ viewerId: 'bo', status: 'online' }), '', 'and your own post does not offer it either');

  /* 11. The track control and the window it opens, drawn --------------------------- */
  const TrackControl = require('./flows-render/components/TrackControl.js').default;
  const TrackPickerWindow = require('./flows-render/components/TrackPickerWindow.js').default;

  const trackPlate = renderToStaticMarkup(
    element(TrackControl, { id: 'track', value: null, onChange: () => undefined, author: amy }),
  );

  assert.match(textOf(trackPlate), /\[ ♪ SOUNDTRACK \]/, "the composer's control is one plate");
  assert.doesNotMatch(trackPlate, /FROM THE ARCHIVE/, 'and the archive is not drawn until it is asked for');

  const filedPlate = renderToStaticMarkup(
    element(TrackControl, {
      id: 'track',
      value: { src: 'https://example.test/one.mp3', title: 'ONE', credit: 'DEBASER', tags: [], length: '1:11' },
      onChange: () => undefined,
      author: amy,
    }),
  );

  assert.match(textOf(filedPlate), /ONE :: 1:11/, 'a filed track shows itself in place of the plate');
  assert.match(textOf(filedPlate), /\[ CLEAR \]/, 'with the one control that takes it back off');

  const picking = renderToStaticMarkup(
    element(TrackPickerWindow, { id: 'track', author: amy, onClose: () => undefined, onPick: () => undefined }),
  );

  assert.match(textOf(picking), /SOUNDTRACK :: PICK A TRACK/, 'the window says what it is for');
  assert.match(textOf(picking), /FROM THE ARCHIVE/, 'and opens on the archive');
  assert.match(textOf(picking), /DEBASER :: 1:11/, 'listing what the shelf holds, with the file`s own credit');
  assert.match(textOf(picking), /\[ ATTACH \]/, 'one press a row: the list is the picking');

  /* 12. The archive's own way onto the board --------------------------------------- */
  const { forumTrackFromArchive } = require('./flows-out/audio/forum-tracks.js');
  const { normaliseAudioTags } = require('./flows-out/audio/tags.js');

  const archiveFile = {
    id: 'https://example.test/g.mp3',
    title: 'GLASS CORRIDOR',
    credit: 'HEXHAM',
    kind: 'ARCHIVE',
    src: 'https://example.test/g.mp3',
    length: '2:22',
    tags: ['Lo-Fi'],
    shelf: 'archive',
  };

  const carried = forumTrackFromArchive(archiveFile);

  assert.equal(carried.src, 'https://example.test/g.mp3', 'the post refers to the file where the archive keeps it');
  assert.equal(carried.title, 'GLASS CORRIDOR', 'under the name the archive gave it');
  assert.equal(carried.credit, 'HEXHAM', 'with the credit the file came with');
  assert.equal(carried.length, '2:22', 'and the running time it has, so the post and the row agree');
  assert.deepEqual(carried.tags, normaliseAudioTags(['Lo-Fi']), "audio tags go through the shelf's own normaliser");
  assert.equal(
    'length' in forumTrackFromArchive({ ...archiveFile, length: '' }),
    false,
    'a file nobody measured carries no length rather than an empty one',
  );

  // (2026-10-24, SPEC-media-catalogue.md) The shelf is the media page's AUDIO tab now.
  const directory = codeOf('app/components/MediaCatalogue.tsx');

  // (2026-10-25, Luke) The archive's `[ INJECT ]` is gone: a track is picked in the composer, so
  // the shelf's rows carry no key onto the board and open no composer of their own.
  assert.doesNotMatch(directory, /INJECT \]/, 'a row of the shelf no longer offers its file to a post');
  assert.doesNotMatch(directory, /<NewPostForm/, 'and opens no composer over the shelf');
  // (2026-11-04) MY MUSIC's post key moved into the song menu each of its rows opens (SongMenu.tsx, LibraryRow.tsx).
  assert.match(codeOf('app/components/SongMenu.tsx'), /forumTrackFromArchive\(song\)/, 'MY MUSIC still starts a post with the track filed, through that one conversion');
  assert.match(codeOf('app/components/LibraryRow.tsx'), /<SongMenuPanel/, 'from the menu on each row');
  assert.match(
    codeOf('app/components/NewPostForm.tsx'),
    /initialTrack/,
    'and the composer takes a track to start with, which is what makes it two presses',
  );

  /* 13. The windows, and the page they leave alone --------------------------------- */
  assert.equal(musicWindowState().open, false, 'the archive starts shut, like the arcade');
  assert.equal(musicWindowState(), musicWindowState(), 'and its snapshot is one object React can compare');

  openMusic();
  assert.equal(musicWindowState().open, true, 'a plate or a link opens it');
  closeMusic();
  assert.equal(musicWindowState().open, false, 'and closing it puts the state back');

  // The key's own answer: the first press opens, the second shuts. This is the behaviour a reader
  // gets from the board's plate and the side panel's key alike, so it is held here in the one place
  // both of them read, rather than trusted to each door.
  toggleMusic();
  assert.equal(musicWindowState().open, true, 'the archive`s key opens it on the first press');
  toggleMusic();
  assert.equal(musicWindowState().open, false, 'and shuts it on the second');
  toggleMusic();
  assert.equal(musicWindowState().open, true, 'and opens it again on the third, so it is a switch and not a one-way door');
  closeMusic();

  assert.equal(musicRequested('?music=1'), true, "the shelf's address asks for it");
  assert.equal(musicRequested('?music=1&tag=lo-fi'), true, 'a filtered one too');
  assert.equal(musicRequested('?arcade=1'), false, 'an address about something else opens nothing');
  assert.equal(musicRequested(''), false, 'and neither does no address at all');
  // 2026-10-24 (SPEC-media-catalogue.md): the archive is the AUDIO tab of the media page now, and
  // the window keeps MY MUSIC - so every "show me this file" link lands on the page.
  // 2026-11-04: that page is FILES at /files (Luke gave its old name to the search page).
  assert.match(MUSIC_HREF, /^\/files\?kind=audio$/, "the archive's address is the FILES page's audio tab");

  const DockWindow = require('./flows-render/components/DockWindow.js').default;
  const MusicWindow = require('./flows-render/components/MusicWindow.js').default;

  assert.equal(typeof MusicWindow, 'function', 'the archive window is a component, drawn in the layout');

  const docked = renderToStaticMarkup(
    element(DockWindow, { title: 'MUSIC :: THE ARCHIVE', badge: '[ MP3 ]', onClose: () => undefined }, 'CONTENTS'),
  );

  assert.match(textOf(docked), /MUSIC :: THE ARCHIVE/, 'a docked window wears a title bar like any other');
  // (2026-10-23, SPEC-efficiency.md) The foot's `[ CLOSE ]` is cut; the title line's `×` is the one control
  // that closes a docked window now.
  assert.doesNotMatch(textOf(docked), /\[ CLOSE \]/, 'with no second close key at its foot');
  assert.match(docked, /aria-label="Close MUSIC :: THE ARCHIVE"/, 'and carries the one control that closes it');
  assert.match(docked, /CONTENTS/, 'with the screen it was handed inside the frame');
  assert.match(docked, /cursor-move/, 'draggable by that title bar');
  assert.doesNotMatch(docked, /inset-0/, 'and it never covers the page: no full-screen frame');
  assert.doesNotMatch(docked, /bg-black/, 'no scrim either, so the feed stays readable behind it');
  assert.doesNotMatch(docked, /aria-modal/, 'it is not a dialogue, and does not claim to be one');
  assert.match(docked, /sm:right-2/, 'on a wide screen it docks to the side of the feed');
  assert.match(docked, /bottom-20/, 'and on a phone it becomes a sheet above the player bar');

  const archiveWindow = codeOf('app/components/MusicWindow.tsx');
  assert.match(archiveWindow, /<DockWindow/, 'the archive is drawn in that frame');
  // 2026-10-24 (SPEC-media-catalogue.md): the file browser moved to the media page; the window is the
  // reader's own music, and its ARCHIVE tab is the link there.
  assert.match(archiveWindow, /<PersonalLibrary \/>/, "with the reader's own music as its screen");
  assert.match(archiveWindow, /href=\{MUSIC_HREF\}/, 'and the archive tab a link to the media page');
  assert.doesNotMatch(archiveWindow, /<MusicDirectory/, 'the file browser is not drawn here any more');
  assert.match(archiveWindow, /subscribeToMusicWindow/, "and it reads the archive's own state, nowhere else");
  assert.doesNotMatch(archiveWindow, /useForum|useAuth|useComms/, 'the board is not this window`s business');

  const arcadeWindow = codeOf('app/components/ArcadeWindow.tsx');
  assert.match(arcadeWindow, /<DockWindow/, 'and the arcade is docked the same way');
  assert.match(arcadeWindow, /dock="bottom"/, 'at the foot of the page, where a game belongs');

  /* 14. What opens them cannot redraw the board ------------------------------------ */
  const layout = codeOf('app/layout.tsx');
  assert.ok(
    layout.indexOf('{children}') < layout.indexOf('<MusicWindow'),
    'both windows are drawn after the page, so their state is not the page`s',
  );
  assert.ok(layout.indexOf('{children}') < layout.indexOf('<ArcadeWindow'), 'the arcade included');

  // The board's title bar carries no window plates at all any more: `◄►` and `♪` both live in the
  // side panel's shelf, because both open *over* wherever the reader is standing. The board must not
  // draw them back - and it must not subscribe to either window's state either, which is what keeps
  // opening one from re-rendering the feed.
  const board = codeOf('app/components/ForumBoard.tsx');
  assert.doesNotMatch(board, /ICON_ARCADE|ICON_MUSIC/, 'the board`s title bar carries no window plates');
  assert.doesNotMatch(board, /openArcade\(|toggleArcade\(|toggleMusic\(/, 'and opens neither window');
  assert.doesNotMatch(board, /useSyncExternalStore/, 'without drawing from either: opening a window cannot re-render the feed');
  assert.doesNotMatch(codeOf('app/components/ForumThreadCard.tsx'), /useSyncExternalStore/, "and a post does not read a window's state either");

  // Both keys are switches on the screen their window is drawn over, so both shut on a second press.
  // Held here as behaviour rather than as markup, because it is the *answer* that matters.
  assert.equal(arcadeWindowState().open, false, 'the arcade starts shut');
  toggleArcade();
  assert.equal(arcadeWindowState().open, true, 'its key opens it on the first press');
  toggleArcade();
  assert.equal(arcadeWindowState().open, false, 'and shuts it on the second');
  assert.deepEqual(arcadeWindowState().focus, { kind: 'floor' }, 'and opens on the floor, which is what the key means');

  // A challenge on screen, then the key: the reader is leaving the arcade, not asking for the floor.
  openArcade({ kind: 'challenge', opponentId: 'bo', game: 'paddle-duel' });
  toggleArcade();
  assert.equal(arcadeWindowState().open, false, 'a press on the key closes a challenge too');

  // Every address that names the arcade is spent on close, and an address about anything else is not.
  assert.equal(arcadeAddressSpentByClose('?arcade=1'), true, 'the floor`s address is the arcade`s');
  assert.equal(arcadeAddressSpentByClose('?invite=abc'), true, 'so is an invitation`s');
  assert.equal(arcadeAddressSpentByClose('?challenge=bo&game=paddle-duel'), true, 'and a challenge`s');
  assert.equal(arcadeAddressSpentByClose('?music=1'), false, 'the archive`s address is not, so closing the arcade leaves it alone');
  assert.equal(arcadeAddressSpentByClose(''), false, 'and neither is no address at all');

  const archive = codeOf('app/components/MediaCatalogue.tsx');
  // (2026-10-25, Luke) The archive's `[ INJECT ]` is gone, and with it its accent plate there.
  assert.doesNotMatch(archive, /INJECT \]/, 'the archive no longer offers the verb onto the board');
  assert.doesNotMatch(archive, /PLATE_ACCENT/, 'so it wears no accent plate');
  assert.match(codeOf('app/lib/ui/controls.ts'), /PLATE_ACCENT/, 'declared with the controls, so no screen invents a second');

  console.log('flows      : a challenge is one call, and one table says why it cannot be sent');
  console.log(`challenge  : row filed then bell rung (${order.join(' -> ')}), and the row survives a failed bell`);
  console.log('refusals   : sign-in, yourself and offline each come from challengeRefusal');
  console.log('arcade     : a window over the board, opened from a post, the header key or the bell');
  console.log('presses    : [ CHALLENGE ] in the account directory, then [ SEND INVITATION ] - two of them');
  console.log('soundtrack : [ ♪ SOUNDTRACK ] then [ ATTACH ], and the archive starts the post for you');
  console.log('windows    : the archive and the arcade dock beside the feed, and opening either leaves the feed alone');
  console.log('surfaces   : the composer carries the track control, and only lib/games files an invitation');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
