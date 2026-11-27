'use client';

import { useState, useSyncExternalStore } from 'react';
import { engineChosen, ENGINE_GROUPS, ENGINE_NAME_MOST, enginesOf, moved, ownEngine, OWN_ENGINES_MOST, SEARCH_ALL_MOST, type Engine, type SearchChoices } from '../../lib/seeing/search';
import { changeSearch, searchChoices, searchChoicesOnServer, subscribeToSearch } from '../../lib/seeing/search-store';
import { FIELD_TIGHT, PLATE, PLATE_PRESSED, TITLE_BAR_INACTIVE } from '../../lib/ui/controls';
import { explain } from '../../lib/ui/explain';

/** The list of search engines: which is asked, which SEARCH ALL asks, their shortcuts, their order, and your own. */
export default function SeeingEngines({ ownEye, onClose }: { ownEye: boolean; onClose: (() => void) | null }) {
  const choices = useSyncExternalStore(subscribeToSearch, searchChoices, searchChoicesOnServer);
  const every = enginesOf(choices);
  // On a new tab the list is for reading (name and letters); its keys wait behind ARRANGE. The list from the box is always whole.
  const [arranging, setArranging] = useState(false);
  const whole = onClose !== null || arranging;
  return (
    <section aria-label="Search engines" className={onClose === null ? 'mt-4 text-label text-ink' : 'absolute inset-0 z-30 flex flex-col overflow-y-auto bg-paper p-2 text-label text-ink'} data-seeing-engines>
      <div className="flex items-center gap-1">
        <h2 className={`${TITLE_BAR_INACTIVE} flex-1`}>SEARCH ENGINES</h2>
        {onClose === null ? (
          <button type="button" aria-pressed={arranging} onClick={() => setArranging(!arranging)} className={arranging ? `${PLATE_PRESSED} cursor-pointer` : PLATE} {...explain('Shows every engine with its keys: which SEARCH ALL asks, the order, on or off, and a box to add your own. Press again to hide them.', 'To set the engines up the way you like; the list is remembered in this browser.')}>
            [ ARRANGE ]
          </button>
        ) : (
          <button type="button" aria-label="Close search engines" onClick={onClose} className={PLATE} {...explain('Closes the list of search engines.', 'Your choices are kept as they are.')}>
            [ × ]
          </button>
        )}
      </div>
      <p
        className="py-1"
        title="In the server's eye an engine sees the house's address, not yours. In OWN EYE or a new tab it sees yours. The words you search for are never stored on the server."
      >
        THE LETTERS BEFORE WORDS ASK THAT ENGINE ONCE: w fog. ↗ OPENS {ownEye ? 'HERE, IN OWN EYE' : 'IN A NEW TAB'}, AND SEES YOUR ADDRESS; THE REST SEE THE HOUSE&apos;S. NO WORDS ARE STORED ON THE SERVER.
      </p>
      <div className={whole ? 'grid gap-x-4 gap-y-2 lg:grid-cols-2' : 'grid gap-x-4 gap-y-2 sm:grid-cols-2 lg:grid-cols-3'}>
        {ENGINE_GROUPS.map((group) => {
          const mine = every.filter((each) => each.group === group && (whole || !choices.off.includes(each.id)));
          return mine.length === 0 ? null : (
            <div key={group}>
              <h3 className="title-line text-label font-bold text-ink">{group}</h3>
              <ul>
                {mine.map((engine, at) => (
                  whole ? (
                    <EngineRow key={engine.id} engine={engine} choices={choices} first={at === 0} last={at === mine.length - 1} />
                  ) : (
                    <EngineName key={engine.id} engine={engine} choices={choices} />
                  )
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {whole ? <AddOne choices={choices} /> : null}
    </section>
  );
}

/** A new tab's row: the engine (pressed, it is the one asked) and its letters. One that is off isn't listed here. */
function EngineName({ engine, choices }: { engine: Engine; choices: SearchChoices }) {
  const chosen = engineChosen(choices).id === engine.id;
  return (
    <li className="flex items-center gap-1 py-0.5">
      <span className="w-44">
        <button type="button" aria-pressed={chosen} disabled={engine.opens === 'site'} onClick={() => changeSearch({ ...choices, chosen: engine.id })} {...explain(`Makes ${engine.name} the engine GO asks when you type words.`, engine.opens === 'out' ? 'Marked ↗: its results open in your own browser, where the engine sees your address, not the house\'s.' : 'Its results come through the house, so the engine sees the house\'s address, not yours.')} className={chosen ? `${PLATE_PRESSED} cursor-pointer` : PLATE}>
          {engine.name}
          {engine.opens === 'out' ? ' ↗' : ''}
        </button>
      </span>
      <span className="text-ink-quiet">{engine.short}</span>
    </li>
  );
}

function EngineRow({ engine, choices, first, last }: { engine: Engine; choices: SearchChoices; first: boolean; last: boolean }) {
  const off = choices.off.includes(engine.id);
  const chosen = engineChosen(choices).id === engine.id;
  const inAll = choices.all.includes(engine.id);
  const set = (change: Partial<SearchChoices>) => changeSearch({ ...choices, ...change });
  return (
    <li className="flex flex-wrap items-center gap-1 py-0.5">
      <span className="w-44">
      <button type="button" aria-pressed={chosen} disabled={off || engine.opens === 'site'} onClick={() => set({ chosen: engine.id })} {...explain(`Makes ${engine.name} the engine GO asks when you type words.`, engine.opens === 'out' ? 'Marked ↗: its results open in your own browser, where the engine sees your address, not the house\'s.' : 'Its results come through the house, so the engine sees the house\'s address, not yours.')} className={chosen ? `${PLATE_PRESSED} cursor-pointer` : PLATE}>
        {engine.name}
        {engine.opens === 'out' ? ' ↗' : ''}
      </button>
      </span>
      <span className="w-10 text-ink-quiet">{engine.short}</span>
      <button
        type="button"
        aria-pressed={inAll}
        aria-label={`Search all asks ${engine.name}`}
        title="Asked by SEARCH ALL"
        disabled={off || engine.opens === 'site' || (!inAll && choices.all.length >= SEARCH_ALL_MOST)}
        onClick={() => set({ all: inAll ? choices.all.filter((each) => each !== engine.id) : [...choices.all, engine.id] })}
        className={inAll ? `${PLATE_PRESSED} cursor-pointer` : PLATE}
        {...explain(inAll ? `Takes ${engine.name} out of the engines ALL asks.` : `Puts ${engine.name} among the engines ALL asks.`, `ALL beside the address box asks up to ${SEARCH_ALL_MOST} engines at once, a tab each.`)}
      >
        ALL
      </button>
      <button type="button" aria-label={`Move ${engine.name} up`} title="Up" disabled={first} onClick={() => changeSearch(moved(choices, engine.id, -1))} className={PLATE} {...explain(`Moves ${engine.name} one place up its list.`, 'To put the engines you use most at the top.')}>
        ▲
      </button>
      <button type="button" aria-label={`Move ${engine.name} down`} title="Down" disabled={last} onClick={() => changeSearch(moved(choices, engine.id, 1))} className={PLATE} {...explain(`Moves ${engine.name} one place down its list.`)}>
        ▼
      </button>
      <button
        type="button"
        aria-pressed={!off}
        aria-label={`${engine.name} on`}
        disabled={!off && choices.off.length >= enginesOf(choices).length - 1}
        onClick={() => set({ off: off ? choices.off.filter((each) => each !== engine.id) : [...choices.off, engine.id], all: off ? choices.all : choices.all.filter((each) => each !== engine.id) })}
        className={off ? PLATE : `${PLATE_PRESSED} cursor-pointer`}
        {...explain(off ? `Turns ${engine.name} back on.` : `Turns ${engine.name} off: it leaves the lists and can't be asked.`, 'To hide engines you never use; one engine always stays on.')}
      >
        {off ? 'OFF' : 'ON'}
      </button>
      {engine.group === 'YOURS' ? (
        <button type="button" aria-label={`Remove ${engine.name}`} title="Remove" {...explain(`Removes ${engine.name}, an engine you added, from the list.`, 'To add it back, type its name and address again below.')} onClick={() => set({ own: choices.own.filter((each) => each.id !== engine.id), all: choices.all.filter((each) => each !== engine.id), off: choices.off.filter((each) => each !== engine.id) })} className={PLATE}>
          ×
        </button>
      ) : null}
    </li>
  );
}

function AddOne({ choices }: { choices: SearchChoices }) {
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [said, setSaid] = useState<string | null>(null);
  return (
    <form
      className="mt-2 flex flex-wrap items-center gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        const made = ownEngine(name, address, `own-${window.crypto.randomUUID()}`);
        if (typeof made === 'string') return setSaid(made);
        changeSearch({ ...choices, own: [...choices.own, made] });
        setName('');
        setAddress('');
        setSaid(null);
      }}
    >
      <input value={name} onChange={(event) => setName(event.target.value)} aria-label="Name of your engine" placeholder="NAME" maxLength={ENGINE_NAME_MOST} className={`${FIELD_TIGHT} w-32`} />
      <input value={address} onChange={(event) => setAddress(event.target.value)} aria-label="Address of your engine" placeholder="https://example.com/?q=%s" maxLength={500} spellCheck={false} className={`${FIELD_TIGHT} min-w-0 flex-1`} />
      <button type="submit" disabled={choices.own.length >= OWN_ENGINES_MOST} className={PLATE} {...explain('Adds your own search engine under YOURS, from the name and address typed beside it.', `The address is a search page with %s where the words go; up to ${OWN_ENGINES_MOST} of your own.`)}>
        [ ADD ]
      </button>
      {said !== null ? (
        <p role="status" className="basis-full">
          <span className="bg-bubble-pale px-1 text-ink-bar">{said}</span>
        </p>
      ) : null}
    </form>
  );
}
