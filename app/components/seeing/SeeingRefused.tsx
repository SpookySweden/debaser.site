import { refusalHelp } from '../../lib/seeing/refusals';
import { PLATE, TITLE_BAR_INACTIVE } from '../../lib/ui/controls';

/** A page that didn't come: the reason, what it means, and what may still be tried, each a key. */
export default function SeeingRefused({ reason, address, canOld, ownEye, onAgain, onOld, onOwn }: { reason: string; address: string; canOld: boolean; ownEye: boolean; onAgain: () => void; onOld: () => void; onOwn: () => void }) {
  const help = refusalHelp(reason);
  const tries = help.tries.filter((each) => (each === 'old' ? canOld : each === 'own' ? ownEye : true));
  return (
    <section aria-label="The page did not come" className="min-w-0 flex-1 overflow-y-auto p-4 text-label text-ink" data-seeing-refused>
      <h2 className={TITLE_BAR_INACTIVE}>SOURCE REFUSED: {reason}</h2>
      <p className="mt-2 max-w-prose">{help.means}</p>
      {tries.length > 0 ? (
        <div className="mt-3 flex flex-wrap gap-2">
          {tries.map((each) =>
            each === 'again' ? (
              <button key={each} type="button" onClick={onAgain} className={PLATE}>
                [ TRY AGAIN ]
              </button>
            ) : each === 'old' ? (
              <button key={each} type="button" onClick={onOld} className={PLATE}>
                [ SEE AN OLD COPY ]
              </button>
            ) : each === 'own' ? (
              <button key={each} type="button" title="In your own browser, where you are signed in" onClick={onOwn} className={PLATE}>
                [ IN YOUR OWN EYE ↗ ]
              </button>
            ) : (
              <a key={each} href={address} target="_blank" rel="noopener noreferrer" className={PLATE}>
                [ ON ITS OWN SITE ↗ ]
              </a>
            ),
          )}
        </div>
      ) : null}
    </section>
  );
}
