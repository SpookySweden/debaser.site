/**
 * What is unsaved, and how to say it in words a reader recognises.
 *
 * **Why this is a separate module rather than a few `if`s in the window.** "Has anything changed?" is the kind of
 * question that goes wrong quietly: a comparison written inline beside fourteen `useState` calls is one that
 * forgets a field the next time a field is added, and the symptom - a save prompt that does not appear, or one
 * that appears when there is nothing to save - is the sort of thing nobody reports, because it looks like the
 * browser being odd. Here it is a pure function over plain data, so `Temp/check-customiser-guard.cjs` can drive
 * it without a browser - the same reason `post-layout.ts` and `drag.ts` are separate from their components.
 *
 * **A draft is `null` when untouched, and that is the whole model.** Every field in the customiser follows the
 * same rule: `null` means "show what is stored", a value means "the reader typed this". So change detection is a
 * difference between the draft and the stored value, and *setting a draft back to what was stored clears it* -
 * which is the behaviour a reader expects and the one a naive `!== null` test gets wrong.
 */
import type { ProfileVisibility } from './types';

/** One thing the reader changed, in the two forms the prompt needs. */
export type UnsavedChange = {
  /** Which tab it belongs to, so the prompt can say where the work is. */
  tab: 'profile' | 'character' | 'privacy';
  /** What it is, in as few words as fits a list row: `NAME`, `BIO`, `PICTURE`. */
  label: string;
  /** What changed about it: `"old" -> "new"`, or a sentence when there is no stored form to compare with. */
  detail: string;
};

/** The stored values, as the window reads them from the profile. */
export type StoredProfile = {
  displayName: string;
  bio: string;
  location: string;
  status: string;
  nameColour: string | null;
  visibility: {
    showTags: boolean;
    showProfileComments: boolean;
    showAvatarComments: boolean;
  };
};

/**
 * A partial set of visibility switches - the same shape the customiser's tab holds.
 *
 * **Declared here rather than imported from the component that defines it.** `ProfileVisibilityDraft` is exported
 * by `ProfileCustomiserOptionsTabs`, and a library module reaching into a component for a type is the dependency
 * running the wrong way: the *rule* about what counts as unsaved should not depend on a component that renders
 * switches. It is `Partial<ProfileVisibility>` either way, so the two cannot drift.
 */
export type VisibilityDraft = Partial<ProfileVisibility>;

/** The drafts, exactly as the window holds them. `null` is "not edited". */
export type ProfileDrafts = {
  name: string | null;
  bio: string | null;
  location: string | null;
  status: string | null;
  nameColour: string | null;
  visibility: VisibilityDraft;
  /** Set once a picture has been uploaded but not yet filed as a version. */
  pendingPicture: string | null;
  /** Set once a track has been uploaded but not yet filed. */
  pendingSong: string | null;
};

/**
 * A value worth showing, shortened so a long bio does not fill the prompt.
 *
 * Quoted and elided rather than dropped: the reader needs to recognise *which* edit this is, and a truncated
 * opening is what does that. An empty value reads as `(EMPTY)` rather than as nothing at all, because "I cleared
 * the bio" is a change and a blank space beside a label looks like a bug.
 */
function show(value: string, limit = 28): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) return '(EMPTY)';
  if (trimmed.length <= limit) return `"${trimmed}"`;
  return `"${trimmed.slice(0, limit)}…"`;
}

/**
 * Every unsaved change, in the order the tabs present them.
 *
 * **The order is the tabs' order, not the fields' importance.** A reader about to lose work is looking for a thing
 * they remember doing, and what they remember is the tab they were on and roughly when. Sorting by importance
 * would be a judgement this function has no business making.
 *
 * **A draft equal to the stored value is not a change.** Typing a character and deleting it again leaves
 * `bioDraft === profile.bio`, and reporting that as unsaved work would train a reader to dismiss the prompt -
 * which is how a prompt stops doing its job. `nameColour` is compared through `?? ''` because empty is how the
 * window spells "the page's own black", so an unset stored colour and a cleared draft are the same state.
 */
export function unsavedChanges(stored: StoredProfile, drafts: ProfileDrafts): UnsavedChange[] {
  const changes: UnsavedChange[] = [];

  if (drafts.name !== null && drafts.name !== stored.displayName) {
    changes.push({ tab: 'profile', label: 'NAME', detail: `${show(stored.displayName)} -> ${show(drafts.name)}` });
  }

  if (drafts.nameColour !== null && drafts.nameColour !== (stored.nameColour ?? '')) {
    changes.push({
      tab: 'profile',
      label: 'NAME COLOUR',
      detail: `${show(stored.nameColour ?? '')} -> ${show(drafts.nameColour)}`,
    });
  }

  if (drafts.bio !== null && drafts.bio !== stored.bio) {
    changes.push({ tab: 'profile', label: 'BIO', detail: `${show(stored.bio)} -> ${show(drafts.bio)}` });
  }

  if (drafts.location !== null && drafts.location !== stored.location) {
    changes.push({
      tab: 'profile',
      label: 'PLACE LINE',
      detail: `${show(stored.location)} -> ${show(drafts.location)}`,
    });
  }

  if (drafts.status !== null && drafts.status !== stored.status) {
    changes.push({ tab: 'profile', label: 'STATUS', detail: `${show(stored.status)} -> ${show(drafts.status)}` });
  }

  if (drafts.pendingPicture !== null) {
    changes.push({
      tab: 'profile',
      label: 'PICTURE UPLOADED',
      detail: 'UPLOADED BUT NOT FILED AS A VERSION',
    });
  }

  if (drafts.pendingSong !== null) {
    changes.push({ tab: 'profile', label: 'TRACK UPLOADED', detail: 'UPLOADED BUT NOT FILED' });
  }

  /**
   * The visibility switches, keyed by the fields the draft actually holds.
   *
   * A `for` over the three names rather than three `if`s, so a fourth switch added to the profile's visibility is
   * a change to this list and to the type - not a switch that silently cannot be reported as unsaved.
   */
  for (const key of ['showTags', 'showProfileComments', 'showAvatarComments'] as const) {
    const draft = drafts.visibility[key];
    if (draft === undefined || draft === stored.visibility[key]) continue;

    changes.push({
      tab: 'privacy',
      label: key
        .replace(/^show/, '')
        .replace(/([A-Z])/g, ' $1')
        .trim()
        .toUpperCase(),
      detail: `${stored.visibility[key] ? 'VISIBLE' : 'HIDDEN'} -> ${draft ? 'VISIBLE' : 'HIDDEN'}`,
    });
  }

  return changes;
}

/**
 * The figure, as an unsaved entry - **by comparing it with what was kept, not by remembering that it was touched.**
 *
 * **This replaced a latched boolean, and the two bugs it caused are the reason.** The old shape was
 * `figureIsUnsaved(figureTouched: boolean)`, where the flag was set by an effect watching the skeleton for any
 * change. That was wrong in both directions at once:
 *
 *   - **Throwing changes away re-marked the figure as unsaved.** Discarding puts the workbench back, and putting
 *     it back *is* a change to the skeleton - so the effect fired, set the flag again, and the prompt returned
 *     immediately citing a figure the reader had just discarded. Nothing was altered and the list still named it.
 *   - **The flag could never be cleared by discarding at all.** `discardEverything` reset the drafts and left the
 *     flag alone, so `CHARACTER FIGURE` sat in the list permanently once the workbench had been touched once.
 *
 * A comparison has neither failure: it is a function of what is on the bench and what is on the shelf, so
 * discarding clears it for free (the bench now equals the kept figure) and a figure that was never edited is
 * never reported. That is the same model every other field in this console uses - a draft compared against what
 * is stored - and the figure was the one field that had opted out of it.
 *
 * **`null` kept means "never saved", and an untouched default is still reported then.** The workbench opens on a
 * blob that is not on the shelf, so closing would lose whatever has been built on top of it - and the panel is
 * inside a console the reader is already editing, so being told once that the figure is not kept is the honest
 * reading rather than a false alarm. What the comparison fixes is the case that was actually wrong: a figure
 * *equal to what was kept* is never reported, however many times it was moved to get there.
 */
export function figureIsUnsaved(input: {
  /** The figure on the bench, serialised the same way the library stores it. */
  bench: string;
  /** The figure as last kept, or `null` when nothing was ever saved or loaded. */
  kept: string | null;
}): UnsavedChange | null {
  // Identical to what was kept: there is nothing to lose, so there is nothing to report.
  if (input.kept !== null && input.bench === input.kept) return null;

  return {
    tab: 'character',
    label: 'CHARACTER FIGURE',
    detail:
      input.kept === null
        ? 'NOT SAVED YET - USE [ SAVED CHARACTERS ] TO KEEP IT'
        : 'CHANGED SINCE IT WAS LAST KEPT',
  };
}

/** A one-line summary for the prompt's title bar: `3 UNSAVED CHANGES`. */
export function summarise(changes: readonly UnsavedChange[]): string {
  if (changes.length === 0) return 'NOTHING UNSAVED';
  return changes.length === 1 ? '1 UNSAVED CHANGE' : `${changes.length} UNSAVED CHANGES`;
}

