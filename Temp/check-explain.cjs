/**
 * EXPLAIN (Luke, 2026-11-27: "for mysake make it so that hovering over any buttons gives a detailed explaination of the function and
 * purpose so i can continue to work on the readability and functionality of the ui"): every key on the site carries its own
 * explanation, which the one box (`app/components/ExplainLayer.tsx`) shows on hover or keyboard focus while the reader's
 * `[ EXPLAIN ]` switch is on.
 *
 * This reads every page and component (`app/**\/*.tsx`) and lists, by file and line, every key with no explanation:
 *   - every `<button>`;
 *   - every element with `role="button"`;
 *   - every link drawn as a key (`<a>` or `<Link>` wearing a key's look, or whose words start with `[`);
 *   - every other plain element with an `onClick` (a clickable box).
 * A key is explained when it carries `data-explain` or spreads something named for it (`{...explain(...)}`, `{...explainFrom(...)}`,
 * `{...explainProps}`, which a shared key passes on from its caller).
 *
 * It also fails an explanation written in place that is too short to explain anything (under four words), or that only repeats the
 * key's own words ("CLOSE" on `[ CLOSE ]`).
 *
 * Rolled out area by area (Luke's order: top bar, side panel and shelf, room and music bar, MEDIA, BROWSER, profile and settings,
 * forum, then the rest). The files not done yet are on `STILL_TO_DO` below: their missing keys are counted, not failed. A file on the
 * list with nothing missing fails too, so the list only ever shrinks and is empty at the end. A new key with no words anywhere else
 * fails at once.
 *
 * Also holds where the box goes (`placeExplainBox` in `app/lib/ui/explain.ts`): never over the key, always inside the screen.
 *
 * And renders the box itself (`ExplainLayer.tsx`): on the server, and while the switch is off, it draws nothing at all.
 *
 *   npx tsc app/components/ExplainLayer.tsx app/lib/ui/explain-mode.ts --rootDir app --outDir Temp/explain-out --module commonjs --target es2020 --moduleResolution node --jsx react-jsx --skipLibCheck --esModuleInterop
 *   node Temp/check-explain.cjs           the check
 *   node Temp/check-explain.cjs --list    every file with keys missing words, done or not, with counts
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const ROOT = path.resolve(__dirname, '..');
const APP = path.join(ROOT, 'app');

/** Pages only the developer looks at, left out (Luke's OK, 2026-11-27: the specimen sheet of tokens). */
const EXEMPT = ['app/specimen/'];

/** Files whose keys have no words yet. Each area's files come off as that area is done. */
const STILL_TO_DO = new Set([
  // STILL_TO_DO_START
  'app/beatbox/credits/page.tsx',
  'app/components/AccountConsole.tsx',
  'app/components/AccountDetails.tsx',
  'app/components/AccountForms.tsx',
  'app/components/AccountGoogleLink.tsx',
  'app/components/AccountProfilePanel.tsx',
  'app/components/AccountSecurityPanel.tsx',
  'app/components/AddToLetterKey.tsx',
  'app/components/AddToPlaylistKey.tsx',
  'app/components/AnchorLink.tsx',
  'app/components/AsciiEmoticonPicker.tsx',
  'app/components/AudioTagChooser.tsx',
  'app/components/AudioTagPill.tsx',
  'app/components/BackdropSettingsWindow.tsx',
  'app/components/BeatBoxRoom.tsx',
  'app/components/BeatBoxSongs.tsx',
  'app/components/BlankScreen.tsx',
  'app/components/BookEditions.tsx',
  'app/components/BookPage.tsx',
  'app/components/CanvasToggle.tsx',
  'app/components/ChallengeControl.tsx',
  'app/components/CharacterBrowserWindow.tsx',
  'app/components/CharacterEditorPanel.tsx',
  'app/components/CharacterPresetPicker.tsx',
  'app/components/CharacterViewport.tsx',
  'app/components/CommentComposer.tsx',
  'app/components/CommentNodeCard.tsx',
  'app/components/CommentPopout.tsx',
  'app/components/CommentSlider.tsx',
  'app/components/CommentWindow.tsx',
  'app/components/CommsConsole.tsx',
  'app/components/CommsGroupBar.tsx',
  'app/components/CommsThreadPanel.tsx',
  'app/components/CompanionPreferences.tsx',
  'app/components/CytubeLayout.tsx',
  'app/components/CytubePage.tsx',
  'app/components/DeskWindow.tsx',
  'app/components/DeviceShareGate.tsx',
  'app/components/DocEditor.tsx',
  'app/components/DocHistoryWindow.tsx',
  'app/components/DocMargin.tsx',
  'app/components/DocMoveWindow.tsx',
  'app/components/DocSharingWindow.tsx',
  'app/components/DocView.tsx',
  'app/components/DocsBrowser.tsx',
  'app/components/DocsScale.tsx',
  'app/components/ElementComments.tsx',
  'app/components/ExtensionWindow.tsx',
  'app/components/FeedbackKey.tsx',
  'app/components/FindInRoomKey.tsx',
  'app/components/FirstVisitTour.tsx',
  'app/components/FloatingPlayer.tsx',
  'app/components/FloatingStageBar.tsx',
  'app/components/ForYou.tsx',
  'app/components/ForYouCommunity.tsx',
  'app/components/ForYouParts.tsx',
  'app/components/ForYouYouTube.tsx',
  'app/components/ForumBoard.tsx',
  'app/components/ForumGalleryTile.tsx',
  'app/components/ForumModerationControls.tsx',
  'app/components/ForumPinPanel.tsx',
  'app/components/ForumSearchBox.tsx',
  'app/components/ForumSearchResults.tsx',
  'app/components/ForumThreadCard.tsx',
  'app/components/GameMatch.tsx',
  'app/components/GamesHub.tsx',
  'app/components/GetThisBook.tsx',
  'app/components/GoLiveKey.tsx',
  'app/components/GoLiveWindow.tsx',
  'app/components/GuestPrompt.tsx',
  'app/components/GuestWindow.tsx',
  'app/components/HistoryPanel.tsx',
  'app/components/HistoryWindow.tsx',
  'app/components/ImportYouTubeHistory.tsx',
  'app/components/IncomingMessageWindow.tsx',
  'app/components/InlineTrackPlayer.tsx',
  'app/components/KeptPagesLane.tsx',
  'app/components/KinoSources.tsx',
  'app/components/LeagueBot.tsx',
  'app/components/LeagueLive.tsx',
  'app/components/LeagueReview.tsx',
  'app/components/LetterCanvas.tsx',
  'app/components/LetterItemPopout.tsx',
  'app/components/LetterLinkForm.tsx',
  'app/components/LetterSendBox.tsx',
  'app/components/LetterSettings.tsx',
  'app/components/LetterWindow.tsx',
  'app/components/LibraryRow.tsx',
  'app/components/ListRow.tsx',
  'app/components/LiveWatchKey.tsx',
  'app/components/LoopPopout.tsx',
  'app/components/LoreDirectory.tsx',
  'app/components/MadeRecord.tsx',
  'app/components/MainRoomKeys.tsx',
  'app/components/MediaCatalogue.tsx',
  'app/components/MediaPicker.tsx',
  'app/components/MediaUploadWindow.tsx',
  'app/components/MentionPicker.tsx',
  'app/components/ModerationKeys.tsx',
  'app/components/ModerationStanding.tsx',
  'app/components/MusicOptionsPrompt.tsx',
  'app/components/MusicPlayer.tsx',
  'app/components/MusicWindow.tsx',
  'app/components/NameColourWindow.tsx',
  'app/components/NewArchiveFileWindow.tsx',
  'app/components/NewArchiveFolderWindow.tsx',
  'app/components/NewDocFolderWindow.tsx',
  'app/components/NewDocWindow.tsx',
  'app/components/NewsTicker.tsx',
  'app/components/NotificationBalloon.tsx',
  'app/components/NotificationSwitches.tsx',
  'app/components/OwnRoomWindow.tsx',
  'app/components/PersonalLibrary.tsx',
  'app/components/PicturePicker.tsx',
  'app/components/PlayerBox.tsx',
  'app/components/PrivacyFirstLook.tsx',
  'app/components/PrivacySwitches.tsx',
  'app/components/ProfileBoardActivity.tsx',
  'app/components/ProfileCharacter.tsx',
  'app/components/ProfileCharacterPicker.tsx',
  'app/components/ProfileCommentBox.tsx',
  'app/components/ProfileCommentMenu.tsx',
  'app/components/ProfileCommentPin.tsx',
  'app/components/ProfileCommentWindow.tsx',
  'app/components/ProfileControl.tsx',
  'app/components/ProfileCustomiserOptionsTabs.tsx',
  'app/components/ProfileCustomiserPictureTab.tsx',
  'app/components/ProfileCustomiserSongTab.tsx',
  'app/components/ProfileCustomiserTagsTab.tsx',
  'app/components/ProfileCustomiserWindow.tsx',
  'app/components/ProfileLetters.tsx',
  'app/components/ProfileModerationKeys.tsx',
  'app/components/ProfilePictureSearch.tsx',
  'app/components/ProfileTagList.tsx',
  'app/components/ProfileTrackPanel.tsx',
  'app/components/ProjectSectionNav.tsx',
  'app/components/PublicProfileWindow.tsx',
  'app/components/QueuePictureKey.tsx',
  'app/components/QueuePlaylists.tsx',
  'app/components/QueueProfilePopout.tsx',
  'app/components/QueueSearchFilters.tsx',
  'app/components/QueueWindow.tsx',
  'app/components/QueuedPicture.tsx',
  'app/components/RadioLoops.tsx',
  'app/components/RecommendationComposer.tsx',
  'app/components/RecommendationsPage.tsx',
  'app/components/ReportWindow.tsx',
  'app/components/RoomCanvas.tsx',
  'app/components/RoomDeviceScreen.tsx',
  'app/components/RoomDoor.tsx',
  'app/components/RoomPrivacyPicker.tsx',
  'app/components/RoomRdpScreen.tsx',
  'app/components/RoomScreen.tsx',
  'app/components/RoomSettingsWindow.tsx',
  'app/components/RoomVisualiser.tsx',
  'app/components/ScreenToggle.tsx',
  'app/components/SeeKey.tsx',
  'app/components/ServerPickers.tsx',
  'app/components/ShareSongToForum.tsx',
  'app/components/SongCoverCard.tsx',
  'app/components/SongMenu.tsx',
  'app/components/SoundGraph.tsx',
  'app/components/SpeechAudioKey.tsx',
  'app/components/SplitKey.tsx',
  'app/components/StageKey.tsx',
  'app/components/StreamArtShelf.tsx',
  'app/components/StreamBarKeys.tsx',
  'app/components/StreamChatFolds.tsx',
  'app/components/StreamQueueWindow.tsx',
  'app/components/StreamRecord.tsx',
  'app/components/TagChooser.tsx',
  'app/components/TagCreatorWindow.tsx',
  'app/components/TagStation.tsx',
  'app/components/TagStationFilters.tsx',
  'app/components/TagStationGate.tsx',
  'app/components/TagStationLink.tsx',
  'app/components/TagStationList.tsx',
  'app/components/TagStationMap.tsx',
  'app/components/TagStationParts.tsx',
  'app/components/TagStationPresets.tsx',
  'app/components/TagStrip.tsx',
  'app/components/TagWindow.tsx',
  'app/components/Taskbar.tsx',
  'app/components/ThreadSubjectRow.tsx',
  'app/components/TicTacToeBoard.tsx',
  'app/components/TrackAttachmentPicker.tsx',
  'app/components/TrackControl.tsx',
  'app/components/TreePicker.tsx',
  'app/components/TwitchSignInNote.tsx',
  'app/components/UnsavedPrompt.tsx',
  'app/components/UnsubscribePanel.tsx',
  'app/components/VanityView.tsx',
  'app/components/VisualiserToggle.tsx',
  'app/components/WatchInRoomKey.tsx',
  'app/components/WatchKey.tsx',
  'app/components/WatchRoom.tsx',
  'app/components/WatchWindow.tsx',
  'app/components/WebBridgeKeys.tsx',
  'app/components/WebCatalogueFinds.tsx',
  'app/components/WebLiveRooms.tsx',
  'app/components/WebMediaRow.tsx',
  'app/components/WebPickedList.tsx',
  'app/components/WebRowKeys.tsx',
  'app/components/WebSiteFiles.tsx',
  'app/components/WebStream.tsx',
  'app/components/WebViewKey.tsx',
  'app/components/WebYouTubeHome.tsx',
  'app/components/animate/AnimateBars.tsx',
  'app/components/animate/AnimateExportPanel.tsx',
  'app/components/animate/AnimateFramesMenu.tsx',
  'app/components/animate/AnimateLayers.tsx',
  'app/components/animate/AnimateMenu.tsx',
  'app/components/animate/AnimateOnionPanel.tsx',
  'app/components/animate/AnimatePalettePanel.tsx',
  'app/components/animate/AnimatePanels.tsx',
  'app/components/animate/AnimatePopup.tsx',
  'app/components/animate/AnimateSettings.tsx',
  'app/components/animate/AnimateSoundPanel.tsx',
  'app/components/animate/AnimateTagPanel.tsx',
  'app/components/animate/AnimateTiles.tsx',
  'app/components/animate/AnimateTimeline.tsx',
  'app/components/backdrops/BackdropControls.tsx',
  'app/components/comic/ComicChapter.tsx',
  'app/components/comic/ComicFollowKey.tsx',
  'app/components/comic/ComicHome.tsx',
  'app/components/comic/ComicStudio.tsx',
  'app/components/comic/ComicZoom.tsx',
  'app/components/comic/StudioLore.tsx',
  'app/components/comic/StudioPages.tsx',
  'app/components/comic/StudioPanels.tsx',
  'app/components/comic/StudioRelease.tsx',
  'app/components/reader/HighlightBar.tsx',
  'app/components/reader/OwnFileDrop.tsx',
  'app/components/reader/ReaderPage.tsx',
  'app/components/reader/ReaderPanels.tsx',
  'app/components/reader/ReadingShelf.tsx',
  'app/components/seeing/SeeingAcquiring.tsx',
  'app/components/seeing/SeeingEngines.tsx',
  'app/components/seeing/SeeingGraffiti.tsx',
  'app/components/seeing/SeeingHistory.tsx',
  'app/components/seeing/SeeingKeep.tsx',
  'app/components/seeing/SeeingKept.tsx',
  'app/components/seeing/SeeingLenses.tsx',
  'app/components/seeing/SeeingMachine.tsx',
  'app/components/seeing/SeeingMargins.tsx',
  'app/components/seeing/SeeingRefused.tsx',
  'app/components/seeing/SeeingStart.tsx',
  'app/components/seeing/SeeingTabs.tsx',
  'app/components/seeing/SeeingToolbar.tsx',
  'app/components/seeing/SeeingTools.tsx',
  'app/components/seeing/SeeingXray.tsx',
  'app/components/seeing/SeenTogether.tsx',
  'app/features/beatbox/ui/BarKeys.tsx',
  'app/features/beatbox/ui/BarRow.tsx',
  'app/features/beatbox/ui/BeatBox.tsx',
  'app/features/beatbox/ui/ChoiceGroup.tsx',
  'app/features/beatbox/ui/GridSizeKeys.tsx',
  'app/features/beatbox/ui/HelpPanel.tsx',
  'app/features/beatbox/ui/InOut.tsx',
  'app/features/beatbox/ui/KeysPanel.tsx',
  'app/features/beatbox/ui/MidiConnect.tsx',
  'app/features/beatbox/ui/NoteGrid.tsx',
  'app/features/beatbox/ui/Pads.tsx',
  'app/features/beatbox/ui/PopWindow.tsx',
  'app/features/beatbox/ui/RecentSongs.tsx',
  'app/features/beatbox/ui/RecordPanel.tsx',
  'app/features/beatbox/ui/ScrollRail.tsx',
  'app/features/beatbox/ui/SoundsPanel.tsx',
  'app/links/page.tsx',
  // STILL_TO_DO_END
]);

/** Elements that are fields, not keys: an `onClick` on one of these is not a clickable box. */
const NOT_A_BOX = new Set(['button', 'a', 'input', 'select', 'textarea', 'label', 'form', 'option', 'summary', 'details']);
/** What a link drawn as a key wears. */
const KEY_LOOK = /\bkey\b|module-key|\bPLATE|_KEY\b|\bKEY\b|TITLE_BAR_BUTTON|GLYPH_BUTTON|SHELF_CHIP/;

function walk(dir, out) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, out);
    else if (entry.name.endsWith('.tsx')) out.push(full);
  }
  return out;
}

function attribute(node, name) {
  return node.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText() === name);
}

function literalOf(expression) {
  if (expression === undefined) return null;
  if (ts.isStringLiteral(expression) || ts.isNoSubstitutionTemplateLiteral(expression)) return expression.text;
  if (ts.isTemplateExpression(expression)) return [expression.head.text, ...expression.templateSpans.map((span) => `X ${span.literal.text}`)].join('');
  if (ts.isConditionalExpression(expression)) return literalOf(expression.whenTrue);
  return null;
}

function attributeText(prop) {
  if (prop === undefined || prop.initializer === undefined) return null;
  if (ts.isStringLiteral(prop.initializer)) return prop.initializer.text;
  if (ts.isJsxExpression(prop.initializer)) return literalOf(prop.initializer.expression) ?? prop.initializer.expression?.getText() ?? null;
  return null;
}

/** The words a key shows: its own text, without the brackets and marks around it. */
function shownWords(node) {
  const element = ts.isJsxOpeningElement(node) ? node.parent : null;
  if (element === null) return '';
  const words = [];
  const visit = (child) => {
    if (ts.isJsxText(child)) words.push(child.text);
    else if (ts.isJsxElement(child)) child.children.forEach(visit);
  };
  element.children.forEach(visit);
  return words.join(' ');
}

const plain = (text) => text.toUpperCase().replace(/[^A-Z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
const wordCount = (text) => plain(text).split(' ').filter((word) => word !== '').length;

/** Why a key is a key, or null when it isn't one. */
function keyKind(node) {
  const tag = node.tagName.getText();
  const role = attributeText(attribute(node, 'role'));
  if (tag === 'button') return 'button';
  if (role === 'button') return 'role=button';
  if (tag === 'a' || tag === 'Link') {
    const look = attribute(node, 'className')?.initializer?.getText() ?? '';
    if (KEY_LOOK.test(look)) return 'link drawn as a key';
    if (plain(shownWords(node)) !== '' && shownWords(node).trim().startsWith('[')) return 'link drawn as a key';
    return null;
  }
  // An invisible catcher behind a menu (`aria-hidden`, a click anywhere outside closes it) is not a key: words on it would open
  // the box wherever the pointer went.
  if (/^[a-z]/.test(tag) && !NOT_A_BOX.has(tag) && attribute(node, 'onClick') !== undefined && attribute(node, 'aria-hidden') === undefined) return 'clickable box';
  return null;
}

/** The key's explanation, as far as it can be read from the source: `{ found, words }`, words null when it isn't written in place. */
function explanationOf(node) {
  const direct = attribute(node, 'data-explain');
  if (direct !== undefined) return { found: true, words: attributeText(direct) };
  for (const prop of node.attributes.properties) {
    if (!ts.isJsxSpreadAttribute(prop) || !/explain/i.test(prop.expression.getText())) continue;
    const call = prop.expression;
    if (ts.isCallExpression(call) && call.expression.getText() === 'explain') return { found: true, words: literalOf(call.arguments[0]) };
    return { found: true, words: null };
  }
  return { found: false, words: null };
}

function scan() {
  const files = walk(APP, []);
  const missing = new Map();
  const weak = [];
  let explained = 0;
  for (const file of files) {
    const rel = path.relative(ROOT, file).split(path.sep).join('/');
    if (EXEMPT.some((prefix) => rel.startsWith(prefix))) continue;
    const source = ts.createSourceFile(file, fs.readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    const visit = (node) => {
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const kind = keyKind(node);
        if (kind !== null) {
          const line = source.getLineAndCharacterOfPosition(node.getStart()).line + 1;
          const { found, words } = explanationOf(node);
          if (!found) {
            if (!missing.has(rel)) missing.set(rel, []);
            missing.get(rel).push(`${rel}:${line} (${kind})`);
          } else {
            explained += 1;
            if (words !== null) {
              const own = plain(shownWords(node));
              if (wordCount(words) < 4) weak.push(`${rel}:${line} too short to explain anything: "${words}"`);
              else if (own !== '' && plain(words) === own) weak.push(`${rel}:${line} only repeats the key's own words: "${words}"`);
            }
          }
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(source);
  }
  return { files, missing, weak, explained };
}

/** `placeExplainBox`, compiled from the TypeScript as it is. */
function loadPlacement() {
  const source = fs.readFileSync(path.join(APP, 'lib/ui/explain.ts'), 'utf8');
  const { outputText } = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 } });
  const module = { exports: {} };
  new Function('module', 'exports', 'require', outputText)(module, module.exports, require);
  return module.exports;
}

function checkPlacement() {
  const { placeExplainBox, explain } = loadPlacement();
  const overlaps = (key, box, at) => at.left < key.right && at.left + box.width > key.left && at.top < key.bottom && at.top + box.height > key.top;
  const inside = (box, at, width, height) => at.left >= 0 && at.top >= 0 && at.left + box.width <= width && at.top + box.height <= height;
  const box = { width: 300, height: 120 };
  const cases = [
    { name: 'a key on the top bar', key: { left: 40, top: 10, right: 120, bottom: 38 } },
    { name: 'a key at the right edge', key: { left: 1380, top: 10, right: 1436, bottom: 38 } },
    { name: 'a key on the music bar at the foot', key: { left: 600, top: 860, right: 680, bottom: 890 } },
    { name: 'a whole row, too tall for above or below', key: { left: 0, top: 50, right: 700, bottom: 860 } },
  ];
  for (const { name, key } of cases) {
    const at = placeExplainBox(key, box, 1440, 900);
    assert.ok(!overlaps(key, box, at), `the box never covers the key: ${name} (${JSON.stringify(at)})`);
    assert.ok(inside(box, at, 1440, 900), `the box stays inside the screen: ${name} (${JSON.stringify(at)})`);
  }
  assert.deepEqual(explain('Does a thing for you.'), { 'data-explain': 'Does a thing for you.' }, 'no empty why or note attributes');
  assert.equal(explain('a', 'b', 'c')['data-explain-note'], 'c');
}

/** The box, rendered as the server draws it: the switch can't be read there, so it is off and nothing is drawn. */
function checkRender() {
  const out = path.join(__dirname, 'explain-out');
  if (!fs.existsSync(path.join(out, 'components/ExplainLayer.js'))) {
    console.log('check-explain: no compiled box (run through `npm run checks`, which compiles it first); render skipped');
    return;
  }
  const React = require('react');
  const { renderToStaticMarkup } = require('react-dom/server');
  const ExplainLayer = require('./explain-out/components/ExplainLayer.js').default;
  assert.equal(renderToStaticMarkup(React.createElement(ExplainLayer)), '', 'off (and on the server), the box draws nothing');
  const { explainOnFrom } = require('./explain-out/lib/ui/explain-mode.js');
  assert.equal(explainOnFrom(null), false, 'nothing stored: off (Luke: "A: a switch, off")');
  assert.equal(explainOnFrom('1'), true);
  assert.equal(explainOnFrom('0'), false);
  assert.equal(explainOnFrom('yes'), false, 'anything else stored: off');
}

const { files, missing, weak, explained } = scan();

if (process.argv.includes('--list')) {
  for (const [file, rows] of [...missing].sort()) console.log(`${String(rows.length).padStart(4)}  ${file}${STILL_TO_DO.has(file) ? '' : '   <- not on STILL_TO_DO'}`);
  console.log(`${explained} keys explained; ${[...missing.values()].flat().length} without words in ${missing.size} files.`);
  process.exit(0);
}

checkPlacement();
checkRender();

const failures = [];
for (const [file, rows] of missing) if (!STILL_TO_DO.has(file)) failures.push(...rows.map((row) => `no explanation: ${row}`));
for (const file of STILL_TO_DO) {
  if (!fs.existsSync(path.join(ROOT, file))) failures.push(`${file} is on STILL_TO_DO but is gone: take it off the list`);
  else if (!missing.has(file)) failures.push(`${file} is on STILL_TO_DO but every key in it has words now: take it off the list`);
}
failures.push(...weak);

const waiting = [...STILL_TO_DO].reduce((sum, file) => sum + (missing.get(file)?.length ?? 0), 0);
if (failures.length > 0) {
  console.error(failures.join('\n'));
  console.error(`check-explain: ${failures.length} problem(s). ${explained} keys explained; ${waiting} still to do in ${STILL_TO_DO.size} files.`);
  process.exit(1);
}
console.log(`check-explain: passed. ${explained} keys explained across ${files.length} files; ${waiting} still to do in ${STILL_TO_DO.size} files.`);
