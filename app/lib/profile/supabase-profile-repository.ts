import { getSupabaseBrowserClient } from '../supabase/client';
import type { RealtimeChannel } from '@supabase/supabase-js';
import { isNameColour } from './name-colours';
import type { PresenceRecord } from './presence';
import {
  validateAvatarNote,
  validateBio,
  validateLocation,
  validateNameColour,
  validateProfileComment,
  validateTagLabel,
  withVisibilityDefaults,
} from './visibility';
import type {
  AddAvatarVersionInput,
  AddProfileCommentInput,
  AvatarVersion,
  GiveTagInput,
  GivenTag,
  ProfileComment,
  ProfilePatch,
  ProfileRepository,
  PublicProfile,
} from './types';

/**
 * Profile storage in Supabase - the production implementation of
 * `ProfileRepository`. It stays dormant until the tables in `supabase/schema.sql`
 * exist and `NEXT_PUBLIC_PROFILE_DATA_SOURCE=supabase` is set (see ./repository.ts).
 *
 * Tables this code expects (all created by that script, with the RLS rules the
 * mock store keeps by construction):
 *
 *   profiles                 id, display_name, name_colour, bio, location,
 *                            show_tags, show_profile_comments, show_avatar_comments,
 *                            current_version_id, last_seen_at, is_online, updated_at
 *   profile_avatar_versions  id, user_id, version, src, alt, note,
 *                            restored_from_version, created_at
 *   profile_tags             id, user_id, label, colour, given_by, given_by_label,
 *                            given_at, hidden
 *   profile_comments         id, user_id, kind, avatar_version_id, author_id,
 *                            author_label, body, created_at
 *
 * Two differences from the mock store, both on purpose:
 *
 *   - Validation runs here as it does there (bio, place line, swatch, notes, tags,
 *     comments), so a hand-written request cannot get past the rules the forms keep.
 *   - Realtime is one channel for the whole page rather than one per name: every
 *     name on the board reads a profile, and a channel each would eat Supabase's
 *     per-connection limit for no gain.
 */

const PROFILES_TABLE = 'profiles';
const VERSIONS_TABLE = 'profile_avatar_versions';
const TAGS_TABLE = 'profile_tags';
const COMMENTS_TABLE = 'profile_comments';

/** One read per profile: the row plus everything that hangs off it. */
const PROFILE_SELECT = `*, ${VERSIONS_TABLE}(*), ${TAGS_TABLE}(*), ${COMMENTS_TABLE}(*)`;

type VersionRow = {
  id: string;
  version: number;
  src: string;
  alt: string;
  note: string;
  restored_from_version: number | null;
  created_at: string;
};

type TagRow = {
  id: string;
  label: string;
  colour: string | null;
  given_by: string | null;
  given_by_label: string;
  given_at: string;
  hidden: boolean;
};

type CommentRow = {
  id: string;
  kind: 'profile' | 'avatar';
  avatar_version_id: string | null;
  author_id: string | null;
  author_label: string;
  body: string;
  created_at: string;
};

type ProfileRow = {
  id: string;
  display_name: string;
  name_colour: string | null;
  bio: string;
  location: string;
  show_tags: boolean;
  show_profile_comments: boolean;
  show_avatar_comments: boolean;
  current_version_id: string | null;
  last_seen_at: string | null;
  is_online: boolean;
  updated_at: string;
  profile_avatar_versions?: VersionRow[] | null;
  profile_tags?: TagRow[] | null;
  profile_comments?: CommentRow[] | null;
};

type PresenceRow = {
  id: string;
  last_seen_at: string | null;
  is_online: boolean;
};

function toVersion(row: VersionRow): AvatarVersion {
  return {
    id: row.id,
    version: row.version,
    src: row.src,
    alt: row.alt,
    note: row.note,
    createdAt: row.created_at,
    ...(row.restored_from_version === null ? {} : { restoredFromVersion: row.restored_from_version }),
  };
}

function toTag(row: TagRow): GivenTag {
  return {
    id: row.id,
    label: row.label,
    ...(row.colour === null ? {} : { colour: row.colour }),
    givenBy: { id: row.given_by, displayName: row.given_by_label },
    givenAt: row.given_at,
    hidden: row.hidden,
  };
}

function toProfile(row: ProfileRow): PublicProfile {
  const versions = (row.profile_avatar_versions ?? []).map(toVersion).sort((a, b) => a.version - b.version);
  const versionById = new Map(versions.map((version) => [version.id, version]));

  return {
    userId: row.id,
    displayName: row.display_name.length > 0 ? row.display_name : 'Anonymous',
    // Only a swatch hex is kept, exactly as the mock store does: a hand-edited
    // colour cannot smuggle an arbitrary hex onto a username.
    ...(row.name_colour !== null && isNameColour(row.name_colour) ? { nameColour: row.name_colour } : {}),
    bio: row.bio,
    location: row.location,
    avatar: { versions, currentVersionId: row.current_version_id },
    visibility: withVisibilityDefaults({
      showTags: row.show_tags,
      showProfileComments: row.show_profile_comments,
      showAvatarComments: row.show_avatar_comments,
    }),
    tags: (row.profile_tags ?? []).map(toTag).sort((a, b) => Date.parse(a.givenAt) - Date.parse(b.givenAt)),
    comments: (row.profile_comments ?? [])
      .map((comment): ProfileComment => {
        const attached = comment.avatar_version_id === null ? undefined : versionById.get(comment.avatar_version_id);

        return {
          id: comment.id,
          kind: comment.kind,
          author: { id: comment.author_id, displayName: comment.author_label },
          body: comment.body,
          createdAt: comment.created_at,
          ...(attached === undefined
            ? {}
            : { avatarVersionId: attached.id, avatarVersionNumber: attached.version }),
        };
      })
      .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt)),
    updatedAt: row.updated_at,
  };
}

function toPresence(row: PresenceRow): PresenceRecord {
  return {
    userId: row.id,
    lastSeenAt: row.last_seen_at ?? new Date().toISOString(),
    online: row.is_online,
  };
}

class SupabaseProfileRepository implements ProfileRepository {
  readonly source = 'supabase' as const;

  private client() {
    const client = getSupabaseBrowserClient();

    if (client === null) {
      throw new Error('Supabase is not configured: set NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.');
    }

    return client;
  }

  /** One shape of error reaches the UI, so a screen can print it as-is. */
  private fail(message: string | undefined): never {
    throw new Error((message ?? 'THE PROFILE STORE DID NOT ANSWER.').toUpperCase());
  }

  private async requireProfile(userId: string): Promise<PublicProfile> {
    const profile = await this.getProfile(userId);
    if (profile === null) this.fail('THAT PROFILE IS NOT THERE.');

    return profile;
  }

  async getProfile(userId: string): Promise<PublicProfile | null> {
    const { data, error } = await this.client()
      .from(PROFILES_TABLE)
      .select(PROFILE_SELECT)
      .eq('id', userId)
      .maybeSingle();

    if (error !== null) this.fail(error.message);

    return data === null ? null : toProfile(data as ProfileRow);
  }

  /**
   * Writes the parts of the profile the patch names, and nothing else.
   *
   * `upsert` rather than `update`: an account that predates the new-user trigger
   * has no row yet, and the owner's write is the moment to make one - the same
   * thing the mock store does when it first writes to a user id.
   */
  async saveProfile(userId: string, patch: ProfilePatch): Promise<PublicProfile> {
    if (patch.bio !== undefined) {
      const problem = validateBio(patch.bio);
      if (problem !== undefined) throw new Error(problem);
    }

    if (patch.location !== undefined) {
      const problem = validateLocation(patch.location);
      if (problem !== undefined) throw new Error(problem);
    }

    if (patch.nameColour !== undefined) {
      const problem = validateNameColour(patch.nameColour);
      if (problem !== undefined) throw new Error(problem);
    }

    const update: Record<string, unknown> = {};

    if (patch.displayName !== undefined && patch.displayName.trim().length > 0) {
      update.display_name = patch.displayName.trim();
    }
    if (patch.bio !== undefined) update.bio = patch.bio.trim();
    if (patch.location !== undefined) update.location = patch.location.trim();
    // An empty string is a real choice: it means "back to the page's own black".
    if (patch.nameColour !== undefined) update.name_colour = patch.nameColour.length === 0 ? null : patch.nameColour;

    if (patch.visibility !== undefined) {
      // Merged onto what is stored, not onto the defaults: a patch that only
      // switches one thing on must not switch the other two off.
      const current = (await this.getProfile(userId))?.visibility;
      const visibility = withVisibilityDefaults({ ...current, ...patch.visibility });

      update.show_tags = visibility.showTags;
      update.show_profile_comments = visibility.showProfileComments;
      update.show_avatar_comments = visibility.showAvatarComments;
    }

    if (Object.keys(update).length > 0) {
      const { error } = await this.client()
        .from(PROFILES_TABLE)
        .upsert({ id: userId, ...update }, { onConflict: 'id' });

      if (error !== null) this.fail(error.message);
    }

    return this.requireProfile(userId);
  }

  /** The picture on display, whoever filed it. */
  private async setCurrentVersion(userId: string, versionId: string): Promise<void> {
    const { error } = await this.client()
      .from(PROFILES_TABLE)
      .upsert({ id: userId, current_version_id: versionId }, { onConflict: 'id' });

    if (error !== null) this.fail(error.message);
  }

  async addAvatarVersion(userId: string, input: AddAvatarVersionInput): Promise<PublicProfile> {
    const noteProblem = validateAvatarNote(input.note ?? '');
    if (noteProblem !== undefined) throw new Error(noteProblem);
    if (input.src.trim().length === 0) throw new Error('NO PICTURE WAS CHOSEN.');

    const { data, error } = await this.client()
      .from(VERSIONS_TABLE)
      .select('version')
      .eq('user_id', userId)
      .order('version', { ascending: false })
      .limit(1);

    if (error !== null) this.fail(error.message);

    const highest = (data ?? [])[0] as { version: number } | undefined;
    const version = (highest?.version ?? 0) + 1;

    const { data: inserted, error: insertError } = await this.client()
      .from(VERSIONS_TABLE)
      .insert({
        user_id: userId,
        version,
        src: input.src.trim(),
        alt: input.alt === undefined || input.alt.length === 0 ? `Profile picture v${version}` : input.alt,
        note: (input.note ?? '').trim(),
      })
      .select('id')
      .single();

    if (insertError !== null) this.fail(insertError.message);

    await this.setCurrentVersion(userId, (inserted as { id: string }).id);

    return this.requireProfile(userId);
  }

  /** Restoring files a new version that copies the old drawing's file. */
  async restoreAvatarVersion(userId: string, versionId: string): Promise<PublicProfile> {
    const { data, error } = await this.client()
      .from(VERSIONS_TABLE)
      .select('*')
      .eq('id', versionId)
      .eq('user_id', userId)
      .maybeSingle();

    if (error !== null) this.fail(error.message);
    if (data === null) throw new Error('THAT VERSION IS NOT IN THE HISTORY.');

    const previous = data as VersionRow;

    return this.addAvatarVersion(userId, {
      src: previous.src,
      alt: previous.alt,
      note: `RESTORED FROM V${previous.version}${previous.note.length === 0 ? '' : ` :: ${previous.note}`}`,
    });
  }

  async giveTag(userId: string, input: GiveTagInput): Promise<PublicProfile> {
    const problem = validateTagLabel(input.label);
    if (problem !== undefined) throw new Error(problem);

    const { error } = await this.client()
      .from(TAGS_TABLE)
      .insert({
        user_id: userId,
        label: input.label.trim(),
        colour: input.colour ?? null,
        // A guest's tag is filed with no author and shown as Anonymous - the same
        // shape the board uses for a guest post.
        given_by: input.givenBy.id,
        given_by_label: input.givenBy.displayName.length > 0 ? input.givenBy.displayName : 'Anonymous',
        // Hidden until the owner decides to show it.
        hidden: true,
      });

    if (error !== null) this.fail(error.message);

    return this.requireProfile(userId);
  }

  async setTagVisibility(userId: string, tagId: string, hidden: boolean): Promise<PublicProfile> {
    const { error } = await this.client()
      .from(TAGS_TABLE)
      .update({ hidden })
      .eq('id', tagId)
      .eq('user_id', userId);

    if (error !== null) this.fail(error.message);

    return this.requireProfile(userId);
  }

  async removeTag(userId: string, tagId: string): Promise<PublicProfile> {
    const { error } = await this.client().from(TAGS_TABLE).delete().eq('id', tagId).eq('user_id', userId);
    if (error !== null) this.fail(error.message);

    return this.requireProfile(userId);
  }

  async addComment(userId: string, input: AddProfileCommentInput): Promise<PublicProfile> {
    const problem = validateProfileComment(input.body);
    if (problem !== undefined) throw new Error(problem);

    // A comment on the picture is filed against a version: the one the reader was
    // looking at, or whichever is on display now.
    let versionId: string | null = null;
    if (input.kind === 'avatar') {
      const profile = await this.getProfile(userId);
      versionId = input.avatarVersionId ?? profile?.avatar.currentVersionId ?? null;
    }

    const { error } = await this.client()
      .from(COMMENTS_TABLE)
      .insert({
        user_id: userId,
        kind: input.kind,
        avatar_version_id: versionId,
        author_id: input.author.id,
        author_label: input.author.displayName.length > 0 ? input.author.displayName : 'Anonymous',
        body: input.body.trim(),
      });

    if (error !== null) this.fail(error.message);

    return this.requireProfile(userId);
  }

  /**
   * The heartbeat: this browser saying the account is still at the keyboard.
   *
   * The stamp is written from here rather than from SQL so the value that comes
   * back is the one that was stored; the row's own owner policy is what allows the
   * write at all.
   */
  async markSeen(userId: string): Promise<PresenceRecord> {
    const { data, error } = await this.client()
      .from(PROFILES_TABLE)
      .upsert({ id: userId, last_seen_at: new Date().toISOString(), is_online: true }, { onConflict: 'id' })
      .select('id, last_seen_at, is_online')
      .single();

    if (error !== null) this.fail(error.message);

    return toPresence(data as PresenceRow);
  }

  /**
   * The goodbye: the tab is closing, or the visitor signed out.
   *
   * `last_seen_at` keeps the moment they were last around - that is what turns the
   * dot yellow rather than red - and saying goodbye twice never pushes it forward.
   */
  async markOffline(userId: string): Promise<PresenceRecord> {
    const previous = await this.getPresence(userId);

    const { data, error } = await this.client()
      .from(PROFILES_TABLE)
      .upsert(
        {
          id: userId,
          is_online: false,
          last_seen_at: previous === null || previous.online ? new Date().toISOString() : previous.lastSeenAt,
        },
        { onConflict: 'id' },
      )
      .select('id, last_seen_at, is_online')
      .single();

    if (error !== null) this.fail(error.message);

    return toPresence(data as PresenceRow);
  }

  async getPresence(userId: string): Promise<PresenceRecord | null> {
    const { data, error } = await this.client()
      .from(PROFILES_TABLE)
      .select('id, last_seen_at, is_online')
      .eq('id', userId)
      .maybeSingle();

    if (error !== null) this.fail(error.message);

    return data === null ? null : toPresence(data as PresenceRow);
  }

  /** No ids means everybody the table knows, which is what the directory wants. */
  async listPresence(userIds?: string[]): Promise<PresenceRecord[]> {
    const columns = 'id, last_seen_at, is_online';
    const query = this.client().from(PROFILES_TABLE).select(columns);
    const { data, error } =
      userIds === undefined || userIds.length === 0 ? await query : await query.in('id', userIds);

    if (error !== null) this.fail(error.message);

    return ((data ?? []) as PresenceRow[]).map(toPresence);
  }

  /** One channel for the whole page; see the note at the top of this file. */
  subscribe(listener: (profile: PublicProfile) => void): () => void {
    profileListeners.add(listener);
    openProfileChannel(this);

    return () => {
      profileListeners.delete(listener);
      if (profileListeners.size === 0) closeProfileChannel();
    };
  }

  subscribePresence(listener: (records: PresenceRecord[]) => void): () => void {
    presenceListeners.add(listener);
    openPresenceChannel(this);

    return () => {
      presenceListeners.delete(listener);
      if (presenceListeners.size === 0) closePresenceChannel();
    };
  }
}

// -----------------------------------------------------------------------------
// Realtime plumbing
// -----------------------------------------------------------------------------

/**
 * The listeners, and the one channel each family of events runs on.
 *
 * Keeping them out here rather than on the instance is what makes the channel
 * shared: the repository is a singleton, but a channel per `usePublicProfile`
 * would still be one per name on the page - and a board of forty posts reads
 * forty names.
 */
const profileListeners = new Set<(profile: PublicProfile) => void>();
const presenceListeners = new Set<(records: PresenceRecord[]) => void>();

let profileChannel: RealtimeChannel | null = null;
let presenceChannel: RealtimeChannel | null = null;

/** Which profile a change belongs to: the row itself, or the owner of a child row. */
function changedProfileId(table: string, payload: unknown): string | null {
  const change = payload as { old?: Record<string, unknown>; new?: Record<string, unknown> };
  const row = { ...(change.old ?? {}), ...(change.new ?? {}) };
  const candidate = table === PROFILES_TABLE ? row.id : (row.user_id ?? row.id);

  return typeof candidate === 'string' ? candidate : null;
}

function openProfileChannel(repository: SupabaseProfileRepository): void {
  if (profileChannel !== null) return;

  const client = getSupabaseBrowserClient();
  if (client === null) return;

  const respond = (table: string) => (payload: unknown) => {
    const id = changedProfileId(table, payload);
    if (id === null) return;

    void repository
      .getProfile(id)
      .then((profile) => {
        if (profile === null) return;
        for (const listener of profileListeners) listener(profile);
      })
      .catch(() => undefined);
  };

  profileChannel = client
    .channel('profile-directory')
    .on('postgres_changes', { event: '*', schema: 'public', table: PROFILES_TABLE }, respond(PROFILES_TABLE))
    .on('postgres_changes', { event: '*', schema: 'public', table: VERSIONS_TABLE }, respond(VERSIONS_TABLE))
    .on('postgres_changes', { event: '*', schema: 'public', table: TAGS_TABLE }, respond(TAGS_TABLE))
    .on('postgres_changes', { event: '*', schema: 'public', table: COMMENTS_TABLE }, respond(COMMENTS_TABLE))
    .subscribe();
}

function closeProfileChannel(): void {
  const client = getSupabaseBrowserClient();
  if (client === null || profileChannel === null) return;

  void client.removeChannel(profileChannel);
  profileChannel = null;
}

function openPresenceChannel(repository: SupabaseProfileRepository): void {
  if (presenceChannel !== null) return;

  const client = getSupabaseBrowserClient();
  if (client === null) return;

  presenceChannel = client
    .channel('profile-presence')
    .on('postgres_changes', { event: '*', schema: 'public', table: PROFILES_TABLE }, () => {
      void repository
        .listPresence()
        .then((records) => {
          for (const listener of presenceListeners) listener(records);
        })
        .catch(() => undefined);
    })
    .subscribe();
}

function closePresenceChannel(): void {
  const client = getSupabaseBrowserClient();
  if (client === null || presenceChannel === null) return;

  void client.removeChannel(presenceChannel);
  presenceChannel = null;
}

let supabaseProfileRepository: SupabaseProfileRepository | null = null;

export function getSupabaseProfileRepository(): ProfileRepository {
  if (supabaseProfileRepository === null) supabaseProfileRepository = new SupabaseProfileRepository();

  return supabaseProfileRepository;
}
