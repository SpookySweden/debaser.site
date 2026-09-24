'use client';

import { useState } from 'react';
import { uploadAvatarDrawing } from '../lib/profile/avatar-upload';
import { uploadSongFile } from '../lib/profile/song-upload';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { validateBio, validateLocation, validateSongCredit, validateSongTitle, validateStatus } from '../lib/profile/visibility';
import { useAuth } from './AuthProvider';
import PopoutWindow from './PopoutWindow';
import { ProfileIdentityTab, ProfilePrivacyTab, type ProfileVisibilityDraft } from './ProfileCustomiserOptionsTabs';
import ProfileCustomiserPictureTab from './ProfileCustomiserPictureTab';
import ProfileCustomiserSongTab from './ProfileCustomiserSongTab';
import { ProfileTagsTab } from './ProfileCustomiserTagsTab';

type TabKey = 'profile' | 'privacy';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'profile', label: '[ PICTURE, BIO & TAGS ]' },
  { key: 'privacy', label: '[ SHOW / HIDE ]' },
];

/**
 * A heading inside the merged tab.
 *
 * The three panels that used to be three tabs still read as three things, without
 * the reader having to click between them to see the page they are dressing.
 */
function PanelHeading({ children }: { children: React.ReactNode }) {
  return <p className="bg-ena-deep px-2 py-1 text-[10px] font-bold text-paper">{children}</p>;
}

type ProfileCustomiserWindowProps = {
  userId: string;
  /** Called when the window is closed (ESC, the title bar, or a click behind it). */
  onClose: () => void;
};

/**
 * The customisation console for the public face of an account.
 *
 * Opened as a self-contained pop-up from the account page ("CUSTOMISE PUBLIC
 * PROFILE"), which is the only way in: the console is a window, not a page.
 * Nothing here writes to the board: it only styles the profile page visitors
 * reach from a username or a picture.
 */
export default function ProfileCustomiserWindow({ userId, onClose }: ProfileCustomiserWindowProps) {
  const { profile, repository } = usePublicProfile(userId);
  const auth = useAuth();

  const [tab, setTab] = useState<TabKey>('profile');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Picture drafts.
  const [pendingSrc, setPendingSrc] = useState<string | null>(null);
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
  const [locationDraft, setLocationDraft] = useState<string | null>(null);
  const [statusDraft, setStatusDraft] = useState<string | null>(null);
  const [nameColourDraft, setNameColourDraft] = useState<string | null>(null);
  const [visibilityDraft, setVisibilityDraft] = useState<ProfileVisibilityDraft>({});

  const name = nameDraft ?? profile.displayName;
  const bio = bioDraft ?? profile.bio;
  const location = locationDraft ?? profile.location;
  const status = statusDraft ?? profile.status;
  // Empty means the default: usernames are drawn in the page's own black.
  const nameColour = nameColourDraft ?? profile.nameColour ?? '';
  const bioProblem = validateBio(bio);
  const locationProblem = validateLocation(location);
  const statusProblem = validateStatus(status);

  async function run(action: () => Promise<unknown>, ok: string) {
    setBusy(true);
    setError(null);
    setMessage(null);

    try {
      await action();
      setMessage(ok);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'UNKNOWN ERROR');
    } finally {
      setBusy(false);
    }
  }

  async function handleUpload(file: File) {
    setUploadMessage(null);
    setError(null);

    setBusy(true);

    try {
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
      setPendingSrc(null);
      setNote('');
    }, 'NEW PICTURE VERSION FILED - THE OLD ONE STAYS IN THE HISTORY.');
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
      const result = await uploadSongFile({ file, userId, version: profile.song.versions.length + 1 });

      if (!result.ok) {
        setError(result.error);
        return;
      }

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
      setSongSrc(null);
      setSongTitle('');
      setSongCredit('');
      setSongNote('');
      setSongMessage(null);
    }, 'NEW TRACK VERSION FILED - THE EARLIER ONES STAY IN THE HISTORY.');
  }

  async function handleSaveIdentity() {
    if (bioProblem !== undefined) {
      setError(bioProblem);
      return;
    }

    if (locationProblem !== undefined) {
      setError(locationProblem);
      return;
    }

    if (statusProblem !== undefined) {
      setError(statusProblem);
      return;
    }

    await run(async () => {
      await repository.saveProfile(userId, { displayName: name, bio, location, status, nameColour });

      // The public name and the account name stay in step, so posts and the
      // profile page never disagree about who wrote something.
      if (name.trim().length > 0 && name !== auth.user?.displayName) {
        const result = await auth.updateDisplayName(name);
        if (!result.ok) throw new Error(result.error);
      }

      setNameDraft(null);
      setBioDraft(null);
      setLocationDraft(null);
      setStatusDraft(null);
      setNameColourDraft(null);
    }, 'NAME, NAME COLOUR, PLACE LINE, STATUS AND BIO SAVED.');
  }

  async function handleSavePrivacy() {
    await run(async () => {
      await repository.saveProfile(userId, { visibility: visibilityDraft });
      setVisibilityDraft({});
    }, 'VISIBILITY SAVED.');
  }

  async function handleSetAllHidden(hidden: boolean) {
    await run(async () => {
      for (const tag of profile.tags) await repository.setTagVisibility(userId, tag.id, hidden);
    }, hidden ? 'EVERY TAG HIDDEN.' : 'EVERY TAG SHOWN (IF THE GLOBAL SWITCH IS ON).');
  }

  const panel = (
    <div className="space-y-3 text-ink">
      <p className="text-[10px] font-bold">
        THIS CONSOLE STYLES WHAT OTHER PEOPLE SEE AT /profile/{userId} - THE PAGE A USERNAME OR A PICTURE OPENS FROM
        THE BOARD. IT DOES NOT CHANGE HOW YOUR POSTS LOOK ON THE BOARD ITSELF.
      </p>

      <div className="flex flex-wrap gap-1">
        {TABS.map((entry) => (
          <button
            key={entry.key}
            type="button"
            onClick={() => setTab(entry.key)}
            className={`cursor-pointer rounded-none border-t border-l border-white border-r-2 border-b-2 border-black px-3 py-1 text-xs font-bold ${
              tab === entry.key ? 'bg-ena text-paper' : 'bg-sun-pale text-ink hover:bg-ice'
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
          <PanelHeading>PICTURE</PanelHeading>
          <ProfileCustomiserPictureTab
            profile={profile}
            pendingSrc={pendingSrc}
            onSelectSrc={(src) => {
              setPendingSrc(src);
              setUploadMessage(null);
            }}
            note={note}
            onNoteChange={setNote}
            onUpload={(file) => void handleUpload(file)}
            onFileVersion={() => void handleFileVersion()}
            onRestore={(versionId) =>
              void run(
                () => repository.restoreAvatarVersion(userId, versionId),
                'OLDER DRAWING FILED AS A NEW VERSION.',
              )
            }
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
            onRestore={(versionId) =>
              void run(() => repository.restoreSongVersion(userId, versionId), 'OLDER TRACK FILED AS A NEW VERSION.')
            }
            busy={busy}
            uploadMessage={songMessage}
          />

          <PanelHeading>NAME, NAME COLOUR, PLACE LINE, STATUS AND BIO</PanelHeading>
          <ProfileIdentityTab
            profile={profile}
            name={name}
            bio={bio}
            location={location}
            status={status}
            nameColour={nameColour}
            onNameChange={setNameDraft}
            onBioChange={setBioDraft}
            onLocationChange={setLocationDraft}
            onStatusChange={setStatusDraft}
            onNameColourChange={setNameColourDraft}
            onSave={() => void handleSaveIdentity()}
            busy={busy}
            bioProblem={bioProblem}
            locationProblem={locationProblem}
            statusProblem={statusProblem}
          />

          <PanelHeading>TAGS GIVEN TO YOU</PanelHeading>
          <ProfileTagsTab
            profile={profile}
            busy={busy}
            onSetHidden={(tagId, hidden) =>
              void run(
                () => repository.setTagVisibility(userId, tagId, hidden),
                hidden ? 'TAG HIDDEN FROM VISITORS.' : 'TAG SHOWN TO VISITORS.',
              )
            }
            onRemove={(tagId) => void run(() => repository.removeTag(userId, tagId), 'TAG REMOVED.')}
            onSetAllHidden={(hidden) => void handleSetAllHidden(hidden)}
          />
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

      <div className="rounded-none border-2 border-t-white border-l-white border-r-black border-b-black bg-sun-pale p-2 text-[10px] font-bold">
        <p>STATUS: {message ?? 'NOTHING SAVED IN THIS SESSION YET.'}</p>
        {error === null ? null : <p className="text-bubble-pale">PROBLEM: {error}</p>}
        <p className="mt-1 text-ink">
          PICTURE FILES: {profile.avatar.versions.length} :: VISIBLE TO VISITORS: TAGS{' '}
          {profile.visibility.showTags ? 'YES' : 'NO'}, PROFILE COMMENTS{' '}
          {profile.visibility.showProfileComments ? 'YES' : 'NO'}, PICTURE COMMENTS{' '}
          {profile.visibility.showAvatarComments ? 'YES' : 'NO'}
        </p>
      </div>
    </div>
  );

  return (
    <PopoutWindow
      title="CUSTOMISE PUBLIC PROFILE"
      badge="[ ACCOUNT ]"
      onClose={onClose}
      maxWidth="max-w-3xl"
      status="PICK A TAB :: EVERY SAVE GOES STRAIGHT TO THE PROFILE STORE :: ESC CLOSES"
      actions={
        <a
          href={`/profile/${encodeURIComponent(userId)}`}
          className="rounded-none border border-black bg-sun-pale px-2 py-[2px] underline hover:bg-ice"
        >
          [ VIEW PUBLIC PAGE ]
        </a>
      }
    >
      {panel}
    </PopoutWindow>
  );
}
