import type { AudioTrack } from './tracks';
import type { ProfileElement } from '../profile/elements';
import type { PublicProfile } from '../profile/types';

/**
 * A profile's element - a drawing or a track - as the site's player wants it.
 *
 * One place for the translation, because three things hand a profile's song to the player:
 * the button beside the track, the comment window, and the account page (which hands over
 * the account's own song so a phone can play it with the bar folded away). The three
 * disagreeing about what a track is called would be three different tracks.
 *
 * What is on the display is what it is: the element's own title, the tag it carries
 * (`M1`), and the version in the `kind` line, so the readout says `PROFILE TRACK :: M1`
 * rather than `--` and a reader can match it to the row they pressed.
 */
export function elementAsTrack(profile: PublicProfile, element: ProfileElement): AudioTrack {
  return {
    id: `profile-track-${element.id}`,
    title: element.title,
    credit: element.credit.length === 0 ? profile.displayName : element.credit,
    kind: `PROFILE TRACK :: ${element.tag}`,
    src: element.src,
    length: '--:--',
    tags: [],
    shelf: 'bucket' as const,
  };
}
