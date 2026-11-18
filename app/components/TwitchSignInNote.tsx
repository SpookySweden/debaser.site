/**
 * Why Twitch's player asks to log in, and the two ways on (Luke, 2026-11-18: "Mark, explain, list playable first").
 *
 * Twitch's embedded player shows a stream labelled for certain audiences (a mature-rated game, gambling, sexual themes...)
 * only to a viewer signed in to Twitch, and nothing on this site can lift that. A media row's player (`row`) and a stream
 * room's stage (`stage`, over Twitch's own "log in to continue", whose link stays pressable) say so here. The sign-in
 * address is Twitch's own, fixed; the channel's page comes checked from the caller (WebStream's `link`, WatchRoom's
 * validated login). Signed in to Twitch in this browser, its player shows the stream, where the browser allows it.
 */
const TWITCH_SIGN_IN = 'https://www.twitch.tv/login';
const WHY = 'TWITCH ONLY SHOWS THIS STREAM AFTER YOU SIGN IN: IT’S LABELLED FOR CERTAIN AUDIENCES.';

export function TwitchSignInNote({ channelPage, place, linkClass }: { channelPage: string | null; place: 'row' | 'stage'; linkClass: string }) {
  const keys = (
    <>
      <a href={TWITCH_SIGN_IN} target="_blank" rel="noopener noreferrer nofollow" className={linkClass} aria-label="Sign in to Twitch (new tab)" data-twitch-sign-in>
        [ SIGN IN TO TWITCH ↗ ]
      </a>
      {channelPage !== null ? (
        <a href={channelPage} target="_blank" rel="noopener noreferrer nofollow" className={linkClass} aria-label="Watch on Twitch (new tab)">
          [ WATCH ON TWITCH ↗ ]
        </a>
      ) : null}
    </>
  );
  if (place === 'row') {
    return (
      <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-label text-ink" data-sign-in-why>
        <span>{WHY}</span>
        {keys}
      </p>
    );
  }
  // Side margins keep it clear of the stage's own keys in the corners ([ VIS ]).
  return (
    <div className="pointer-events-none absolute inset-0 z-20 flex items-start justify-center px-16 pt-2" data-watch-sign-in>
      <p className="flex w-fit flex-wrap items-center gap-x-2 bg-bubble-pale px-1 text-label font-bold text-ink-bar" role="status">
        <span>{WHY}</span>
        {keys}
      </p>
    </div>
  );
}
