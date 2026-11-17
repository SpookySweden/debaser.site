'use client';

/**
 * LEAGUEBOT (SPEC-leaguebot.md, Luke 2026-11-17): enter a Riot ID and server, and read that player's League of Legends
 * stats, live game and reviews, with advice. Open to everyone (2A). Your own Riot ID can be kept on your account, private
 * (3B), or in this browser when signed out. Everything else is read live from OP.GG and U.GG and stored nowhere.
 *
 * The address carries the player looked at (`/leaguebot?id=Name%23TAG&server=EUW`), so a look-up can be linked.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { lookUpPlayer, LookupError } from '../lib/leaguebot/client';
import { DEFAULT_REGION, REGIONS, regionById, type RegionId } from '../lib/leaguebot/regions';
import { formatRiotId, parseRiotId, sameRiotId, type RiotId } from '../lib/leaguebot/riot-id';
import { riotIdInBrowser, riotIdStore, type SavedRiotId } from '../lib/leaguebot/riot-id-store';
import { loadStaticData, profileIconUrl, rankEmblemUrl, type StaticData } from '../lib/leaguebot/static-data';
import { rankText, type PlayerAnswer } from '../lib/leaguebot/types';
import { FIELD_TIGHT, PLATE, PLATE_MAIN, PLATE_PRESSED, TITLE_BAR } from '../lib/ui/controls';
import { useAuth } from './AuthProvider';
import LeagueIcon from './LeagueIcon';
import LeagueStats from './LeagueStats';

type Tab = 'stats';
const TABS: { tab: Tab; label: string }[] = [{ tab: 'stats', label: 'STATS' }];

type Looked = { id: RiotId; region: RegionId; answer: PlayerAnswer };

function readAddress(): { id: RiotId; region: RegionId } | null {
  const params = new URLSearchParams(window.location.search);
  const id = parseRiotId(params.get('id'));
  if (id === null) return null;
  return { id, region: regionById(params.get('server'))?.id ?? DEFAULT_REGION };
}

function writeAddress(id: RiotId, region: RegionId) {
  const url = new URL(window.location.href);
  url.searchParams.set('id', formatRiotId(id));
  url.searchParams.set('server', region);
  window.history.replaceState(window.history.state, '', url.toString());
}

export default function LeagueBot() {
  const { status } = useAuth();
  // A guest (an anonymous account) keeps theirs in the browser, like a visitor.
  const signedIn = status === 'signed-in';
  const [text, setText] = useState('');
  const [region, setRegion] = useState<RegionId>(DEFAULT_REGION);
  const [saved, setSaved] = useState<SavedRiotId | null>(null);
  const [looked, setLooked] = useState<Looked | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [data, setData] = useState<StaticData | null>(null);
  const [dataFailed, setDataFailed] = useState(false);
  const [tab, setTab] = useState<Tab>('stats');
  const asked = useRef(0);

  useEffect(() => {
    loadStaticData().then(setData, () => setDataFailed(true));
  }, []);

  const lookUp = useCallback(async (id: RiotId, where: RegionId, refresh = false) => {
    const ticket = (asked.current += 1);
    setBusy(true);
    setError(null);
    setNotice(null);
    writeAddress(id, where);
    try {
      const answer = await lookUpPlayer(id, where, refresh);
      if (ticket !== asked.current) return;
      if (answer.notFound) {
        setLooked(null);
        setError(`Nobody called ${formatRiotId(id)} plays on ${where}. Check the spelling, the tag after the #, and the server.`);
      } else {
        setLooked({ id, region: where, answer });
      }
    } catch (failure) {
      if (ticket !== asked.current) return;
      setError(failure instanceof LookupError ? failure.message : 'Something went wrong. Try again in a minute.');
    } finally {
      if (ticket === asked.current) setBusy(false);
    }
  }, []);

  // On arrival: the player in the address, or else your saved Riot ID.
  useEffect(() => {
    if (status === 'loading') return;
    let gone = false;
    void riotIdStore(signedIn)
      .load()
      .then((mine) => {
        if (gone) return;
        setSaved(mine);
        const start = readAddress() ?? (mine ? { id: { name: mine.name, tag: mine.tag }, region: mine.region } : null);
        if (start) {
          setText(formatRiotId(start.id));
          setRegion(start.region);
          void lookUp(start.id, start.region);
        }
      });
    return () => {
      gone = true;
    };
  }, [signedIn, status, lookUp]);

  const submit = (event: React.FormEvent) => {
    event.preventDefault();
    const id = parseRiotId(text);
    if (id === null) {
      setError('Write the Riot ID as Name#TAG: the name, a #, then the tag (it is under your name in the League client).');
      return;
    }
    void lookUp(id, region);
  };

  const isMine = looked !== null && saved !== null && saved.region === looked.region && sameRiotId(saved, looked.id);

  const saveMine = async () => {
    if (!looked) return;
    const next: SavedRiotId = { name: looked.id.name, tag: looked.id.tag, region: looked.region };
    const ok = await riotIdStore(signedIn).save(next);
    if (ok) {
      setSaved(next);
      setNotice(riotIdInBrowser(signedIn) ? 'Saved in this browser. LEAGUEBOT opens on it next time.' : 'Saved to your account, private. LEAGUEBOT opens on it next time.');
    } else setNotice("Couldn't save it. Try again in a minute.");
  };

  const forgetMine = async () => {
    const ok = await riotIdStore(signedIn).forget();
    if (ok) {
      setSaved(null);
      setNotice('Forgotten.');
    } else setNotice("Couldn't forget it. Try again in a minute.");
  };

  const answer = looked?.answer ?? null;
  const profile = answer?.profile ?? null;
  const solo = profile?.ranks.find((r) => r.queue === 'SOLO') ?? null;
  const flex = profile?.ranks.find((r) => r.queue === 'FLEX' && r.tier !== null) ?? null;
  const games = solo && solo.wins !== null && solo.losses !== null ? solo.wins + solo.losses : null;

  return (
    <div className="space-y-3" data-leaguebot>
      <section aria-labelledby="lb-find">
        <h2 id="lb-find" className={TITLE_BAR}>
          LEAGUEBOT
        </h2>
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2 p-2">
          <label className="flex min-w-0 flex-1 flex-col text-label text-ink sm:max-w-sm">
            RIOT ID
            <input
              value={text}
              onChange={(event) => setText(event.target.value)}
              placeholder="Name#TAG"
              autoComplete="off"
              spellCheck={false}
              maxLength={24}
              className={`${FIELD_TIGHT} mt-1 w-full`}
              data-leaguebot-id
            />
          </label>
          <label className="flex flex-col text-label text-ink">
            SERVER
            <select value={region} onChange={(event) => setRegion(event.target.value as RegionId)} className={`${FIELD_TIGHT} mt-1`} data-leaguebot-server>
              {REGIONS.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.id}
                </option>
              ))}
            </select>
          </label>
          <button type="submit" className={PLATE_MAIN} disabled={busy}>
            {busy ? 'LOOKING...' : 'LOOK UP'}
          </button>
          {saved && !isMine ? (
            <button
              type="button"
              className={PLATE}
              onClick={() => {
                const id = { name: saved.name, tag: saved.tag };
                setText(formatRiotId(id));
                setRegion(saved.region);
                void lookUp(id, saved.region);
              }}
            >
              [ MINE: {formatRiotId(saved)} ]
            </button>
          ) : null}
        </form>
        <p className="px-2 pb-1 text-label text-ink" role="status" aria-live="polite">
          {error ?? notice ?? (busy ? 'Reading OP.GG and U.GG...' : looked === null ? 'Any player on any server. Live data comes from OP.GG and U.GG; nothing about other players is stored.' : '')}
        </p>
      </section>

      {looked && answer ? (
        <>
          <section aria-labelledby="lb-player" className="flex flex-wrap items-center gap-3 px-2" data-leaguebot-player>
            {profile ? <LeagueIcon src={data && profile.iconId ? profileIconUrl(data.patch, profile.iconId) : null} name="Profile icon" size="lg" /> : null}
            <div className="min-w-0 flex-1">
              <h2 id="lb-player" className="text-title text-ink">
                {looked.id.name}
                <span className="text-ink"> #{looked.id.tag}</span>
              </h2>
              <p className="text-label text-ink">
                {looked.region}
                {profile?.level ? ` · LEVEL ${profile.level}` : ''}
              </p>
            </div>
            <div className="flex items-center gap-2">
              {solo?.tier ? <LeagueIcon src={rankEmblemUrl(solo.tier)} name={solo.tier} size="lg" /> : null}
              <div>
                <p className="text-heading text-ink">{solo ? rankText(solo.tier, solo.division, solo.lp) : profile ? 'UNRANKED' : 'RANK UNKNOWN'}</p>
                <p className="text-label tabular-nums text-ink">
                  RANKED SOLO
                  {solo && games ? ` · ${solo.wins}W ${solo.losses}L · ${Math.round(((solo.wins ?? 0) / games) * 100)}%` : ''}
                  {solo?.hotStreak ? ' · ON A WIN STREAK' : ''}
                </p>
                {flex ? <p className="text-label text-ink">FLEX: {rankText(flex.tier, flex.division, flex.lp)}</p> : null}
              </div>
            </div>
          </section>

          <div className="flex flex-wrap items-center gap-2 px-2 text-label text-ink">
            <span>
              {answer.profileSource ? `RANK FROM ${answer.profileSource}` : 'NO RANK'} · {answer.matchesSource ? `GAMES FROM ${answer.matchesSource}` : 'NO GAMES'}
            </span>
            <button type="button" className={PLATE} onClick={() => void lookUp(looked.id, looked.region, true)} disabled={busy}>
              [ REFRESH ]
            </button>
            {isMine ? (
              <>
                <span>· YOUR RIOT ID{riotIdInBrowser(signedIn) ? ', KEPT IN THIS BROWSER' : ', KEPT ON YOUR ACCOUNT'}</span>
                <button type="button" className={PLATE} onClick={() => void forgetMine()}>
                  [ FORGET ]
                </button>
              </>
            ) : (
              <button type="button" className={PLATE} onClick={() => void saveMine()}>
                [ THIS IS ME ]
              </button>
            )}
          </div>

          {answer.notes.length > 0 || dataFailed ? (
            <ul className="px-2 text-label text-ink" data-leaguebot-notes>
              {answer.notes.map((note) => (
                <li key={note}>! {note}</li>
              ))}
              {dataFailed ? <li>! Riot&apos;s champion names didn&apos;t load: champions show as numbers.</li> : null}
            </ul>
          ) : null}

          <div role="tablist" aria-label="LEAGUEBOT" className="flex flex-wrap gap-1 px-2">
            {TABS.map((each) => (
              <button key={each.tab} type="button" role="tab" aria-selected={tab === each.tab} onClick={() => setTab(each.tab)} className={tab === each.tab ? PLATE_PRESSED : PLATE}>
                {each.label}
              </button>
            ))}
          </div>

          <div role="tabpanel" aria-label={TABS.find((t) => t.tab === tab)?.label}>
            {tab === 'stats' ? (
              answer.matches ? (
                <LeagueStats profile={profile} matches={answer.matches} matchesSource={answer.matchesSource} data={data} />
              ) : (
                <p className="p-2 text-label text-ink">THE MATCH HISTORY DIDN&apos;T LOAD. TRY [ REFRESH ] IN A MINUTE.</p>
              )
            ) : null}
          </div>
        </>
      ) : null}

      <footer className="px-2 pt-2 text-label text-ink" data-leaguebot-notice>
        LEAGUEBOT isn&apos;t endorsed by Riot Games and doesn&apos;t reflect the views or opinions of Riot Games or anyone officially involved in producing or
        managing Riot Games properties. Riot Games and all associated properties are trademarks or registered trademarks of Riot Games, Inc. Player data from
        OP.GG and U.GG.
      </footer>
    </div>
  );
}
