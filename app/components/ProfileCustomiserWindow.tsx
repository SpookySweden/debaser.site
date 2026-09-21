'use client';

import { useState } from 'react';
import { MAX_AVATAR_BYTES } from '../lib/profile/avatar-catalogue';
import { usePublicProfile } from '../lib/profile/use-public-profile';
import { validateBio, validateLocation } from '../lib/profile/visibility';
import { useAuth } from './AuthProvider';
import PopoutWindow from './PopoutWindow';
import { ProfileIdentityTab, ProfilePrivacyTab, type ProfileVisibilityDraft } from './ProfileCustomiserOptionsTabs';
import ProfileCustomiserPictureTab from './ProfileCustomiserPictureTab';
import { ProfileTagsTab } from './ProfileCustomiserTagsTab';

type TabKey = 'picture' | 'identity' | 'privacy' | 'tags';

const TABS: { key: TabKey; label: string }[] = [
  { key: 'picture', label: '[ PROFILE PICTURE ]' },
  { key: 'identity', label: '[ BIO ]' },
  { key: 'privacy', label: '[ SHOW / HIDE ]' },
  { key: 'tags', label: '[ TAGS GIVEN TO YOU ]' },
];

type ProfileCustomiserWindowProps = {
  userId: string;
  /** 'popup' opens the Win95 window; 'inline' renders the panel on its own page. */
  variant?: 'popup' | 'inline';
  onClose?: () => void;
};

/**
 * The customisation console for the public face of an account.
 *
 * Opened as a self-contained pop-up from the account page ("CUSTOMISE PUBLIC
 * PROFILE") and mounted inline at /account/customise so the same panel can be
 * linked to directly. Nothing here writes to the board: it only styles the
 * profile page visitors reach from a username or a picture.
 */
export default function ProfileCustomiserWindow({
  userId,
  variant = 'popup',
  onClose,
}: ProfileCustomiserWindowProps) {
  const { profile, repository } = usePublicProfile(userId);
  const auth = useAuth();

  const [tab, setTab] = useState<TabKey>('picture');
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Picture drafts.
  const [pendingSrc, setPendingSrc] = useState<string | null>(null);
  const [note, setNote] = useState('');
  const [uploadMessage, setUploadMessage] = useState<string | null>(null);

  // Text and visibility drafts: null / empty means "show what is stored".
  const [nameDraft, setNameDraft] = useState<string | null>(null);
  const [bioDraft, setBioDraft] = useState<string | null>(null);
  const [locationDraft, setLocationDraft] = useState<string | null>(null);
  const [visibilityDraft, setVisibilityDraft] = useState<ProfileVisibilityDraft>({});

  const name = nameDraft ?? profile.displayName;
  const bio = bioDraft ?? profile.bio;
  const location = locationDraft ?? profile.location;
  const bioProblem = validateBio(bio);
  const locationProblem = validateLocation(location);

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

    if (file.size > MAX_AVATAR_BYTES) {
      setError(`THAT DRAWING IS TOO BIG - ${Math.round(MAX_AVATAR_BYTES / 1024)}KB MAX.`);
      return;
    }

    setBusy(true);

    try {
      const form = new FormData();
      form.append('file', file);
      form.append('userId', userId);

      const response = await fetch('/api/profile/avatar', { method: 'POST', body: form });
      const payload = (await response.json()) as { ok?: boolean; src?: string; error?: string };

      if (payload.ok !== true || payload.src === undefined) {
        setError(payload.error ?? 'THE UPLOAD WAS REFUSED.');
        return;
      }

      setPendingSrc(payload.src);
      setUploadMessage(`UPLOADED TO ${payload.src} - FILE IT AS A VERSION BELOW.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'UPLOAD FAILED.');
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

  async function handleSaveIdentity() {
    if (bioProblem !== undefined) {
      setError(bioProblem);
      return;
    }

    if (locationProblem !== undefined) {
      setError(locationProblem);
      return;
    }

    await run(async () => {
      await repository.saveProfile(userId, { displayName: name, bio, location });

      // The public name and the account name stay in step, so posts and the
      // profile page never disagree about who wrote something.
      if (name.trim().length > 0 && name !== auth.user?.displayName) {
        const result = await auth.updateDisplayName(name);
        if (!result.ok) throw new Error(result.error);
      }

      setNameDraft(null);
      setBioDraft(null);
      setLocationDraft(null);
    }, 'NAME, PLACE LINE AND BIO SAVED.');
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
    <div className="space-y-3 text-black">
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
              tab === entry.key ? 'bg-[#000080] text-white' : 'bg-[#c0c0c0] text-black hover:bg-gray-300'
            }`}
          >
            {entry.label}
          </button>
        ))}
      </div>

      {tab === 'picture' ? (
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
      ) : null}

      {tab === 'identity' ? (
        <ProfileIdentityTab
          profile={profile}
          name={name}
          bio={bio}
          location={location}
          onNameChange={setNameDraft}
          onBioChange={setBioDraft}
          onLocationChange={setLocationDraft}
          onSave={() => void handleSaveIdentity()}
          busy={busy}
          bioProblem={bioProblem}
          locationProblem={locationProblem}
        />
      ) : null}

      {tab === 'privacy' ? (
        <ProfilePrivacyTab
          profile={profile}
          draft={visibilityDraft}
          onToggle={(key, value) => setVisibilityDraft((current) => ({ ...current, [key]: value }))}
          onSave={() => void handleSavePrivacy()}
          busy={busy}
        />
      ) : null}

      {tab === 'tags' ? (
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
      ) : null}

      <div className="rounded-none border-2 border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-2 text-[10px] font-bold">
        <p>STATUS: {message ?? 'NOTHING SAVED IN THIS SESSION YET.'}</p>
        {error === null ? null : <p className="text-[#800000]">PROBLEM: {error}</p>}
        <p className="mt-1 text-gray-700">
          PROFILE STORE: {repository.source === 'mock' ? 'MOCK (THIS BROWSER, NOT SHARED)' : 'SUPABASE'} :: PICTURE
          FILES: {profile.avatar.versions.length} :: VISIBLE TO VISITORS: TAGS{' '}
          {profile.visibility.showTags ? 'YES' : 'NO'}, PROFILE COMMENTS{' '}
          {profile.visibility.showProfileComments ? 'YES' : 'NO'}, PICTURE COMMENTS{' '}
          {profile.visibility.showAvatarComments ? 'YES' : 'NO'}
        </p>
      </div>
    </div>
  );

  if (variant === 'inline') return panel;

  return (
    <PopoutWindow
      title="CUSTOMISE PUBLIC PROFILE"
      badge="[ ACCOUNT ]"
      onClose={onClose ?? (() => undefined)}
      maxWidth="max-w-3xl"
      status="PICK A TAB :: EVERY SAVE GOES STRAIGHT TO THE PROFILE STORE :: ESC CLOSES"
      actions={
        <a
          href={`/profile/${encodeURIComponent(userId)}`}
          className="rounded-none border border-black bg-[#c0c0c0] px-2 py-[2px] underline hover:bg-gray-300"
        >
          [ VIEW PUBLIC PAGE ]
        </a>
      }
    >
      {panel}
    </PopoutWindow>
  );
}
