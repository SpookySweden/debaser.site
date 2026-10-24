'use client';

import { useEffect, useMemo, useState } from 'react';
import { MUSIC_BUCKET } from '../lib/audio/catalogue';
import { useCatalogue } from '../lib/media/catalogue';
import { findOriginal, recordMedia, type MediaFingerprint } from '../lib/media/upload';
import { itemForSrc, pictureTiles, recordUses } from '../lib/media/uses';
import { AVATAR_BUCKET, uploadAvatarDrawing } from '../lib/profile/avatar-upload';
import { uploadSongFile } from '../lib/profile/song-upload';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { validateBio, validateCountry, validateSongCredit, validateSongTitle, validateStatus } from '../lib/profile/visibility';
import {
  figureIsUnsaved,
  unsavedChanges,
  type UnsavedChange,
} from '../lib/profile/unsaved-changes';
import { useBenchFigure, useCharacterStore, useKeptFigure } from '../lib/character/store';
import { useAuth } from './AuthProvider';
import PopoutWindow from './PopoutWindow';
import UnsavedPrompt from './UnsavedPrompt';
import { ProfileIdentityTab, ProfilePrivacyTab, type ProfileVisibilityDraft } from './ProfileCustomiserOptionsTabs';
import ProfileCustomiserPictureTab from './ProfileCustomiserPictureTab';
import ProfileCustomiserSongTab from './ProfileCustomiserSongTab';
import { ProfileTagsTab } from './ProfileCustomiserTagsTab';
import CharacterEditorPanel from './CharacterEditorPanel';

type TabKey = 'profile' | 'character' | 'privacy';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'profile', label: '[ PROFILE ]' },
  // Between the two, because it is the middle thing: the page gets dressed first, the switches at the end are
  // about who may look, and the figure is neither - it is something built rather than described.
  { key: 'character', label: '[ CHAR 🐰 ]' },
  { key: 'privacy', label: '[ SHOW / HIDE ]' },
];

/**
 * A heading inside the merged tab.
 *
 * The three panels that used to be three tabs still read as three things, without
 * the reader having to click between them to see the page they are dressing.
 *
 * `text-ink-bar`, not `text-paper`: the bar is Nigrosine here and Black in the dark theme, so its ink
 * cannot be a token that moves with the field - `paper` was White on Nigrosine (17.83:1) in one theme
 * and Nigrosine on Black (1.18:1) in the other. `Temp/check-themes.cjs` reads this literal's pair, and
 * that is what found it.
 */
function PanelHeading({ children, tip }: { children: React.ReactNode; tip?: string }) {
  return (
    <p title={tip} className="bg-ena-deep px-2 py-1 text-label font-bold text-ink-bar">
      {children}
    </p>
  );
}

/** How long `SAVED` stays in the foot after a save: long enough to read, then out of the way. */
const SAVED_FLASH_MS = 2000;

type ProfileCustomiserWindowProps = {
  userId: string;
  /** Called when the window is closed (ESC, the title bar, or a click behind it). */
  onClose: () => void;
};

/**
 * The customisation console for the public face of an account.
 *
 * Opened as a self-contained pop-up from the account page ("[ EDIT PROFILE ]"),
 * which is the only way in: the console is a window, not a page.
 * Nothing here writes to the board: it only styles the profile page visitors
 * reach from a username or a picture.
 */
export default function ProfileCustomiserWindow({ userId, onClose }: ProfileCustomiserWindowProps) {
  const { profile, repository } = usePublicProfile(userId);
  const auth = useAuth();

  const [tab, setTab] = useState<TabKey>('profile');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /**
   * Counts saves while `SAVED` is showing; 0 means nothing to show. A counter rather than a flag, so a
   * second save inside the two seconds restarts the clock instead of being swallowed by the first.
   */
  const [savedTick, setSavedTick] = useState(0);

  useEffect(() => {
    if (savedTick === 0) return;
    const timer = window.setTimeout(() => setSavedTick(0), SAVED_FLASH_MS);
    return () => window.clearTimeout(timer);
  }, [savedTick]);

  // Picture drafts.
  const [pendingSrc, setPendingSrc] = useState<string | null>(null);
  /** The fingerprint of a drawing just uploaded, so filing it as a version can record it. */
  const [pendingUpload, setPendingUpload] = useState<{ file: File; fingerprint: MediaFingerprint } | null>(null);
  const [pendingSongUpload, setPendingSongUpload] = useState<{ file: File; fingerprint: MediaFingerprint } | null>(null);
  // The catalogue: what the picture tab offers beside the sheets, and where an upload is recorded.
  const catalogue = useCatalogue();
  const cataloguePictures = useMemo(
    () => pictureTiles(catalogue.items).filter((tile) => tile.preview.width > 0 && Math.abs(tile.preview.width / tile.preview.height - 1) <= 0.1),
    [catalogue.items],
  );
  const [note, setNote] = useState('');
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  // Track drafts: the same shape as the picture's, one shelf over.
  const [songSrc, setSongSrc] = useState<string | null>(null);
  const [songTitle, setSongTitle] = useState('');
  const [songCredit, setSongCredit] = useState('');
  const [songNote, setSongNote] = useState('');
  const [songMessage, setSongMessage] = useState<string | null>(null);

  // Text and visibility drafts: null / empty means "show what is stored".
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [bioDraft, setBioDraft] = useState<string | null>(null);
  const [countryDraft, setCountryDraft] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState<string | null>(null);
  const [nameColourDraft, setNameColourDraft] = useState<string | null>(null);
  const [visibilityDraft, setVisibilityDraft] = useState<ProfileVisibilityDraft>({});


  /**
   * What the reader asked for, held while the prompt is up.
   *
   * **The intent is stored, not re-derived when the prompt is answered.** A reader can press "switch tab", think
   * about it, and the `onStay` handler has to put them back where they were - so the tab they were *leaving* is
   * what has to be remembered, and `pendingIntent` carries both which action and where it was going.
   */
  const [pendingIntent, setPendingIntent] = useState<
    { kind: 'close' } | { kind: 'tab'; tab: TabKey } | null
  >(null);

  /**
   * Everything unsaved, in tab order, recomputed on every render from the drafts.
   *
   * **Derived, never stored.** There is no `hasUnsavedChanges` flag to fall out of step with the drafts, for the
   * reason `interactionMode` is derived in the character store: two stored facts can disagree and one derived
   * fact cannot. The cost is a comparison over nine fields on each render, which is not a cost.
   *
   * **The two figure fingerprints are read here for the same reason**, and they are the fix for two bugs: the
   * character entry used to be a `figureTouched` boolean the panel latched on any skeleton change, so throwing
   * changes away - which *is* a skeleton change - re-marked the figure as edited and the prompt named it again
   * at once. A comparison has no such state to corrupt: if the bench equals what was kept, nothing is at risk.
   */
  const benchFigure = useBenchFigure();
  const keptFigure = useKeptFigure();

  const unsaved: UnsavedChange[] = [
    ...unsavedChanges(
      {
        displayName: profile.displayName,
        bio: profile.bio,
        country: profile.country,
        status: profile.status,
        nameColour: profile.nameColour ?? null,
        visibility: {
          showTags: profile.visibility.showTags,
          showProfileComments: profile.visibility.showProfileComments,
          showAvatarComments: profile.visibility.showAvatarComments,
        },
      },
      {
        name: nameDraft,
        bio: bioDraft,
        country: countryDraft,
        status: statusDraft,
        nameColour: nameColourDraft,
        visibility: visibilityDraft,
        pendingPicture: pendingSrc,
        pendingSong: songSrc,
      },
    ),
    ...(() => {
      // The figure, compared with what was kept - the same model as every field above it, rather than a latch.
      const change = figureIsUnsaved({ bench: benchFigure, kept: keptFigure });
      return change === null ? [] : [change];
    })(),
  ];

  const name = nameDraft ?? profile.displayName;
  const bio = bioDraft ?? profile.bio;
  const country = countryDraft ?? profile.country;
  const status = statusDraft ?? profile.status;
  // Empty means the default: usernames are drawn in the page's own black.
  const nameColour = nameColourDraft ?? profile.nameColour ?? '';
  const bioProblem = validateBio(bio);
  const countryProblem = validateCountry(country);
  const statusProblem = validateStatus(status);

  /**
   * Every save goes through here: on success the foot says `SAVED` for a moment, and on failure the
   * problem stays on screen until the next try. There is no standing status line any more
   * (SPEC-efficiency.md, 2026-10-23) - a save that worked has nothing more to say than that.
   */
  async function run(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);

    try {
      await action();
      setSavedTick((tick) => tick + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'UNKNOWN ERROR');
    } finally {
      setBusy(false);
    }
  }

  /**
   * Ask before doing something that would lose unsaved work, and do it straight away if there is none.
   *
   * **One gate for both exits**, because "close" and "switch tab" have identical rules and writing the check twice
   * is how the second one comes to disagree with the first. The caller says what it wants; this decides whether the
   * reader has to be asked.
   *
   * **A tab press for the tab already showing is not a change of tab**, so it never prompts - a reader pressing the
   * current tab is either checking which one they are on or missing the one beside it, and a warning for that would
   * be noise.
   */
  function guard(intent: { kind: 'close' } | { kind: 'tab'; tab: TabKey }) {
    if (intent.kind === 'tab' && intent.tab === tab) return;
    if (unsaved.length === 0) {
      finish(intent);
      return;
    }

    setPendingIntent(intent);
  }

  /** Carry out what was asked, once it is safe to. */
  function finish(intent: { kind: 'close' } | { kind: 'tab'; tab: TabKey }) {
    setPendingIntent(null);

    if (intent.kind === 'close') {
      onClose();
      return;
    }

    setTab(intent.tab);
  }

  /**
   * Throw every draft away, and put the workbench back where it was kept.
   *
   * **This is what `[ THROW THEM AWAY ]` promises, and it was a lie until this existed.** The prompt said the work
   * would be lost, the reader agreed, and `finish()` merely cleared the prompt and carried on with the drafts
   * intact - so the one control whose entire purpose is to discard discarded nothing. A confirmation dialogue that
   * does not do what it says is worse than no dialogue, because it teaches the reader that the words on the
   * buttons are decoration.
   *
   * **Every field, not just the ones the prompt happened to list.** The prompt lists what `unsavedChanges` found,
   * and that function is deliberately conservative - it ignores a draft that matches what is stored. So a reader
   * who typed their old bio back would be shown one fewer row than there are drafts. Discarding resets all of them
   * regardless, because "throw away my changes" means the drafts, not the rows in a list.
   *
   * **The figure goes back to exactly the one last kept**, not to the blob the editor opens on: if a saved character
   * was loaded and then edited, throwing the edits away has to put the *saved* figure back. The store holds that
   * figure (`keptFigure`), so it is restored here, directly. It used to be signalled to the character panel with a
   * counter - which only worked while the CHAR tab was showing. Discarding on the way to another tab left the bench
   * edited, and the prompt came back the moment the reader returned.
   */
  function discardEverything() {
    setNameDraft(null);
    setBioDraft(null);
    setCountryDraft(null);
    setStatusDraft(null);
    setNameColourDraft(null);
    setVisibilityDraft({});

    // The uploads, both halves: the file that was staged and the note written about it.
    setPendingSrc(null);
    setNote('');
    setUploadMessage(null);
    setSongSrc(null);
    setSongTitle('');
    setSongCredit('');
    setSongNote('');
    setSongMessage(null);

    useCharacterStore.getState().revert();

    setError(null);
  }

  /**
   * Save whatever the prompt can save, then continue.
   *
   * **Only the identity and privacy drafts, and only when they are valid.** The picture and track are *uploaded*
   * rather than saved - the file is already somewhere and filing it is a separate press on a separate tab - so
   * "save what can be saved" cannot silently file them. A bio that fails validation is reported and the prompt
   * stays up, because saving half of it and closing would lose the other half without saying so.
   */
  async function saveThenFinish() {
    const intent = pendingIntent;
    if (intent === null) return;

    if (bioProblem !== undefined || countryProblem !== undefined || statusProblem !== undefined) {
      setError(bioProblem ?? countryProblem ?? statusProblem ?? 'SOMETHING IN THE PROFILE IS NOT VALID.');
      return;
    }

    const profileChanges = unsaved.filter((change) => change.tab === 'profile');
    const privacyChanges = unsaved.filter((change) => change.tab === 'privacy');

    await run(async () => {
      if (profileChanges.length > 0) {
        await repository.saveProfile(userId, { displayName: name, bio, country, status, nameColour });

        if (name.trim().length > 0 && name !== auth.user?.displayName) {
          const result = await auth.updateDisplayName(name);
          if (!result.ok) throw new Error(result.error);
        }

        setNameDraft(null);
        setBioDraft(null);
        setCountryDraft(null);
        setStatusDraft(null);
        setNameColourDraft(null);
      }

      if (privacyChanges.length > 0) {
        await repository.saveProfile(userId, { visibility: visibilityDraft });
        setVisibilityDraft({});
      }
    });

    finish(intent);
  }

  async function handleUpload(file: File) {
    setUploadMessage(null);
    setError(null);

    setBusy(true);

    try {
      // The catalogue's rule first (SPEC-media-catalogue.md, decision 4): the same drawing already
      // filed anywhere on the site is the same file, so its address is used and nothing is uploaded.
      const { fingerprint, original } = await findOriginal('image', file);
      if (original !== null) {
        setPendingSrc(original.src);
        setPendingUpload(null);
        setUploadMessage(`ALREADY IN THE CATALOGUE AS "${original.title}" - USING THE ORIGINAL. FILE IT AS A VERSION BELOW.`);
        return;
      }

      // Which store it lands in is the upload module's business: Supabase Storage
      // when profiles live there, the project's own assets folder otherwise.
      const result = await uploadAvatarDrawing({
        file,
        userId,
        version: profile.avatar.versions.length + 1,
      });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setPendingSrc(result.src);
      setPendingUpload({ file, fingerprint });
      setUploadMessage(`${result.note} - FILE IT AS A VERSION BELOW.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleFileVersion() {
    if (pendingSrc === null) return;

    await run(async () => {
      await repository.addAvatarVersion(userId, {
        src: pendingSrc,
        note,
        alt: `${name} profile picture`,
      });

      // Recorded in the catalogue as a picture of this account's, with the page as its use. A
      // drawing picked from the catalogue (or a sheet) already has its row; only the use is new.
      const recorded =
        pendingUpload === null
          ? (itemForSrc(catalogue.items, pendingSrc) ?? null)
          : await recordMedia({
              kind: 'image',
              file: pendingUpload.file,
              fingerprint: pendingUpload.fingerprint,
              bucket: pendingSrc.startsWith('/') ? '' : AVATAR_BUCKET,
              path: pendingSrc,
              src: pendingSrc,
              title: `${name.toUpperCase()} // PICTURE v${profile.avatar.versions.length + 1}`,
              credit: name,
              uploader: { id: userId, displayName: name },
            });
      if (recorded !== null && recorded.source !== 'sheet') {
        recordUses([recorded], { useKind: 'profile_picture', useId: `${userId}:v${profile.avatar.versions.length + 1}`, href: `/profile/${encodeURIComponent(userId)}`, label: `${name.toUpperCase()}'S PROFILE PICTURE`, addedBy: userId }, { mediaId: recorded.id });
      }

      setPendingSrc(null);
      setPendingUpload(null);
      setNote('');
    });
  }

  /**
   * Files the track: the audio is uploaded (Supabase Storage, or the project's own
   * assets folder through the mock route), then the version is written. The upload
   * happens on choosing the file rather than on filing it, so the version number in
   * the file name is the one it will be filed as.
   */
  async function handleSongUpload(file: File) {
    setSongMessage(null);
    setError(null);

    setBusy(true);

    try {
      // The same bytes already on the shelf or in the catalogue: the original plays from here too.
      const { fingerprint, original } = await findOriginal('audio', file);
      if (original !== null) {
        setSongSrc(original.src);
        setPendingSongUpload(null);
        if (songTitle.trim().length === 0) setSongTitle(original.title);
        if (songCredit.trim().length === 0) setSongCredit(original.credit);
        setSongMessage(`ALREADY IN THE CATALOGUE AS "${original.title}" - USING THE ORIGINAL. FILE IT AS A VERSION BELOW.`);
        return;
      }

      const result = await uploadSongFile({ file, userId, version: profile.song.versions.length + 1 });

      if (!result.ok) {
        setError(result.error);
        return;
      }

      setPendingSongUpload({ file, fingerprint });
      setSongSrc(result.src);
      if (songTitle.trim().length === 0) setSongTitle(file.name.replace(/\.[a-z0-9]+$/i, '').toUpperCase());
      setSongMessage(`${result.note} - FILE IT AS A VERSION BELOW.`);
    } finally {
      setBusy(false);
    }
  }

  async function handleFileSongVersion() {
    if (songSrc === null) return;

    const titleProblem = validateSongTitle(songTitle);
    if (titleProblem !== undefined) {
      setError(titleProblem);
      return;
    }

    const creditProblem = validateSongCredit(songCredit);
    if (creditProblem !== undefined) {
      setError(creditProblem);
      return;
    }

    await run(async () => {
      await repository.addSongVersion(userId, {
        src: songSrc,
        title: songTitle,
        credit: songCredit,
        note: songNote,
      });

      const recorded =
        pendingSongUpload === null
          ? (itemForSrc(catalogue.items, songSrc) ?? null)
          : await recordMedia({
              kind: 'audio',
              file: pendingSongUpload.file,
              fingerprint: pendingSongUpload.fingerprint,
              bucket: songSrc.startsWith('/') ? '' : MUSIC_BUCKET,
              path: songSrc,
              src: songSrc,
              title: songTitle,
              credit: songCredit,
              uploader: { id: userId, displayName: name },
            });
      if (recorded !== null) {
        recordUses([recorded], { useKind: 'profile_song', useId: `${userId}:v${profile.song.versions.length + 1}`, href: `/profile/${encodeURIComponent(userId)}`, label: `${name.toUpperCase()}'S PROFILE TRACK`, addedBy: userId }, { mediaId: recorded.id });
      }

      setSongSrc(null);
      setPendingSongUpload(null);
      setSongTitle('');
      setSongCredit('');
      setSongNote('');
      setSongMessage(null);
    });
  }

  async function handleSaveIdentity() {
    if (bioProblem !== undefined) {
      setError(bioProblem);
      return;
    }

    if (countryProblem !== undefined) {
      setError(countryProblem);
      return;
    }

    if (statusProblem !== undefined) {
      setError(statusProblem);
      return;
    }

    await run(async () => {
      await repository.saveProfile(userId, { displayName: name, bio, country, status, nameColour });

      // The public name and the account name stay in step, so posts and the
      // profile page never disagree about who wrote something.
      if (name.trim().length > 0 && name !== auth.user?.displayName) {
        const result = await auth.updateDisplayName(name);
        if (!result.ok) throw new Error(result.error);
      }

      setNameDraft(null);
      setBioDraft(null);
      setCountryDraft(null);
      setStatusDraft(null);
      setNameColourDraft(null);
    });
  }

  async function handleSavePrivacy() {
    await run(async () => {
      await repository.saveProfile(userId, { visibility: visibilityDraft });
      setVisibilityDraft({});
    });
  }

  async function handleSetAllHidden(hidden: boolean) {
    await run(async () => {
      for (const tag of profile.tags) await repository.setTagVisibility(userId, tag.id, hidden);
    });
  }

  const panel = (
    <div className="space-y-3 text-ink">
      <div className="flex flex-wrap gap-1">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => guard({ kind: 'tab', tab: entry.key })}
            className={`cursor-pointer px-3 py-1 text-key max-sm:min-h-tap ${
              tab === entry.key ? 'key key-fill [--key-fill:var(--color-ink)] text-paper' : 'key'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {/* The tab that dresses the page: the picture, then the name and bio, then the
          tags other people gave. They were three tabs; seeing them together is what
          makes the page they add up to visible while you work on it. */}
      {tab === 'profile' ? (
        <div className="space-y-3">
          {/* HOW IT WORKS used to be a paragraph beside the upload; it is this heading's hover tip now. */}
          <PanelHeading
            tip={`CHOOSE A PICTURE, SAY WHAT CHANGED, THEN FILE IT AS P${profile.avatar.versions.length + 1}. THE OLD ONE STAYS IN THE HISTORY BELOW, TOGETHER WITH THE COMMENTS WRITTEN AGAINST IT.`}
          >
            PICTURE
          </PanelHeading>
          <ProfileCustomiserPictureTab
            profile={profile}
            pendingSrc={pendingSrc}
            cataloguePictures={cataloguePictures}
            onSelectSrc={(src) => {
              setPendingSrc(src);
              setPendingUpload(null);
              setUploadMessage(null);
            }}
            note={note}
            onNoteChange={setNote}
            onUpload={(file) => void handleUpload(file)}
            onFileVersion={() => void handleFileVersion()}
            onRestore={(versionId) => void run(() => repository.restoreAvatarVersion(userId, versionId))}
            busy={busy}
            uploadMessage={uploadMessage}
          />

          <PanelHeading>THE TRACK BESIDE THE PICTURE</PanelHeading>
          <ProfileCustomiserSongTab
            profile={profile}
            pendingSrc={songSrc}
            title={songTitle}
            credit={songCredit}
            note={songNote}
            onTitleChange={setSongTitle}
            onCreditChange={setSongCredit}
            onNoteChange={setSongNote}
            onUpload={(file) => void handleSongUpload(file)}
            onFileVersion={() => void handleFileSongVersion()}
            onRestore={(versionId) => void run(() => repository.restoreSongVersion(userId, versionId))}
            busy={busy}
            uploadMessage={songMessage}
          />

          <PanelHeading>NAME, NAME COLOUR, COUNTRY FLAG, STATUS AND BIO</PanelHeading>
          <ProfileIdentityTab
            profile={profile}
            name={name}
            bio={bio}
            country={country}
            status={status}
            nameColour={nameColour}
            onNameChange={setNameDraft}
            onBioChange={setBioDraft}
            onCountryChange={setCountryDraft}
            onStatusChange={setStatusDraft}
            onNameColourChange={setNameColourDraft}
            onSave={() => void handleSaveIdentity()}
            busy={busy}
            bioProblem={bioProblem}
            countryProblem={countryProblem}
            statusProblem={statusProblem}
          />

          <PanelHeading>TAGS GIVEN TO YOU</PanelHeading>
          <ProfileTagsTab
            profile={profile}
            busy={busy}
            onSetHidden={(tagId, hidden) => void run(() => repository.setTagVisibility(userId, tagId, hidden))}
            onRemove={(tagId) => void run(() => repository.removeTag(userId, tagId))}
            onSetAllHidden={(hidden) => void handleSetAllHidden(hidden)}
          />
        </div>
      ) : null}

      {/* The character workbench, on a tab of its own between the dressing and the switches.
          It is the one thing in this console that is not *describing* the account but building an
          artefact to sit beside it, and a workbench needs the window's whole width - the two
          orthographic viewports and the layer list do not fit in a tab that is already three panels
          deep. See ./CharacterEditorPanel.tsx. */}
      {tab === 'character' ? (
        <div className="space-y-3">
          <CharacterEditorPanel />
        </div>
      ) : null}

      {/* Its own tab: these switches are about what other people get to see, not about
          the page you are dressing. */}
      {tab === 'privacy' ? (
        <ProfilePrivacyTab
          profile={profile}
          draft={visibilityDraft}
          onToggle={(key, value) => setVisibilityDraft((current) => ({ ...current, [key]: value }))}
          onSave={() => void handleSavePrivacy()}
          busy={busy}
        />
      ) : null}

      {/* A problem stays on screen until the next try; a success is the `SAVED` in the foot. */}
      {error === null ? null : (
        <p className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">PROBLEM: {error}</p>
      )}
    </div>
  );

  /**
   * The prompt, when something is unsaved and the window is trying to shut.
   *
   * **A window of its own rather than a panel inside this one**, which is the shape the brief asks for and the
   * right one for a second reason: the customiser's body scrolls and is three panels deep, so a decision about
   * losing work would arrive below the fold of a document the reader is already part-way down. A pop-up is in
   * front of everything by construction, and it stacks correctly because `PopoutWindow` portals to `<body>`.
   */
  const prompt =
    pendingIntent === null ? null : (
      <UnsavedPrompt
        changes={unsaved}
        intent={pendingIntent.kind === 'close' ? 'close' : 'switch-tab'}
        onStay={() => setPendingIntent(null)}
        onDiscard={() => {
          // Discard first, then carry out what was asked: the order matters, because `finish` closes the window
          // or moves the tab and there would be nothing left to reset if the drafts were cleared afterwards.
          discardEverything();
          finish(pendingIntent);
        }}
        // Offered only when there is something a save can actually keep - see `saveThenFinish`.
        onSave={unsaved.some((change) => change.tab !== 'character') ? saveThenFinish : undefined}
      />
    );

  return (
    <>
      <PopoutWindow
        title="CUSTOMISE PUBLIC PROFILE"
        onClose={() => guard({ kind: 'close' })}
        // Clicking the desktop does not close this one: it holds unsaved work, and a mis-aimed press is not a
        // decision to discard it. Every other window keeps the behaviour - see `PopoutWindow`.
        dismissOnBackdrop={false}
        // The workbench is a canvas window - a tool strip, two views and two panels - and needs the room. The other
        // tabs are forms and stay at a reading width.
        maxWidth={tab === 'character' ? 'max-w-6xl' : 'max-w-3xl'}
        status="PICK A TAB :: EVERY SAVE GOES STRAIGHT TO THE PROFILE STORE :: ESC ASKS BEFORE CLOSING"
        actions={
          <>
            {/* The foot sits outside the scrolling body, so `SAVED` is seen whichever section was saved.
                Its box is laid out whether or not the word is in it, so the key beside it never moves. */}
            <span aria-live="polite" className="inline-block w-12 text-right text-label text-ink">
              {savedTick > 0 ? 'SAVED' : ''}
            </span>
            <a
              href={`/profile/${encodeURIComponent(userId)}`}
              className="key px-1 py-1 max-sm:inline-flex max-sm:min-h-tap max-sm:items-center"
            >
              [ VIEW PROFILE ]
            </a>
          </>
        }
      >
        {panel}
      </PopoutWindow>

      {prompt}
    </>
  );
}
