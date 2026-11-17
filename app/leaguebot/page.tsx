import type { Metadata } from 'next';
import LeagueBot from '../components/LeagueBot';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - LEAGUEBOT',
  description: 'League of Legends stats, live game scouting and post-game reviews for any Riot ID, with plain-English advice.',
};

/**
 * LEAGUEBOT (SPEC-leaguebot.md, Luke 2026-11-17): a League of Legends player's stats, live game and reviews, with advice.
 * Open to everyone, signed in or not. Reached from its top-bar key (ticked in MODULOS) and its key on the side panel's shelf.
 */
export default function LeagueBotPage() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [LEAGUEBOT]" active="leaguebot" tip="League of Legends stats, scouting and advice for any Riot ID.">
      <h1 className="sr-only">DEBASER.SITE // LEAGUEBOT</h1>
      <LeagueBot />
    </SiteWindow>
  );
}
