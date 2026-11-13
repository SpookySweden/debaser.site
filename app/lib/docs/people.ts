'use client';

import { readProfile } from '../profile/profile-cache';
import { getProfileRepository } from '../profile/repository';
import { currentAvatarVersion } from '../profile/visibility';
import { inkOnNameColour } from '../profile/name-colours';
import { DYES } from '../ui/themes';

/**
 * Faces for the people in a document: the picture on a caret, the picture on a pointer.
 *
 * Only the account id travels on the channel; each tab looks the picture up itself from the profile
 * cache, so nobody can make a caret show a picture from anywhere but that person's own profile.
 */

/** The picture address an account wears, or null for none (the dithered slot stands in). */
export async function pictureFor(userId: string | null): Promise<string | null> {
  if (userId === null) return null;

  try {
    const profile = await readProfile(getProfileRepository(), userId);
    const src = currentAvatarVersion(profile)?.src;
    if (typeof src !== 'string') return null;
    // A site path or an https address; nothing else is put in an <img>.
    return src.startsWith('/') || src.startsWith('https://') ? src : null;
  } catch {
    return null;
  }
}

/**
 * A name tag in a person's colour: the colour is the tag's fill and the words take whichever of
 * Black or White reads on it, so it reads on every theme, dark name colours included (on a dark
 * page a dark fill would vanish, so the tag carries a thin paper edge too: the light strip).
 */
export function faceTag(name: string, colour: string, userId: string | null): HTMLElement {
  const tag = document.createElement('span');
  tag.className = 'doc-face';
  tag.style.backgroundColor = colour;
  tag.style.color = inkOnNameColour(colour);

  const picture = document.createElement('span');
  picture.className = 'doc-face__picture';
  picture.setAttribute('aria-hidden', 'true');
  tag.append(picture);

  void pictureFor(userId).then((src) => {
    if (src === null) return;
    const image = document.createElement('img');
    image.src = src;
    image.alt = '';
    image.width = 20;
    image.height = 20;
    image.loading = 'lazy';
    picture.replaceChildren(image);
    picture.classList.add('doc-face__picture--drawn');
  });

  tag.append(document.createTextNode(name));
  return tag;
}

/** The caret the collaboration extension draws for each other editor: a bar, with their face above it. */
export function renderCaret(user: Record<string, unknown>): HTMLElement {
  const colour = typeof user.colour === 'string' && /^#[0-9a-fA-F]{6}$/.test(user.colour) ? user.colour : DYES.royalBlue;
  const name = typeof user.name === 'string' && user.name.length > 0 ? user.name.slice(0, 60) : 'SOMEONE';
  const userId = typeof user.userId === 'string' && user.userId.length > 0 ? user.userId : null;

  const caret = document.createElement('span');
  caret.className = 'collaboration-carets__caret';
  caret.style.borderColor = colour;

  const label = faceTag(name, colour, userId);
  label.classList.add('collaboration-carets__label');
  caret.append(label);

  return caret;
}
