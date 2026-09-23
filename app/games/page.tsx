import type { Metadata } from 'next';
import GamesHub from '../components/GamesHub';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Games',
  description: 'Two games and an invitation: play solo, or ask somebody who is on to a match.',
};

export default function GamesPage() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [GAMES]" active="games" status="Arcade Open" closeHref="/forum">
      <h1 className="text-xl font-bold mb-2">DEBASER.SITE // ARCADE</h1>
      <p className="text-xs mb-4 leading-relaxed">
        Two games, played here or with somebody else. Solo is one press; a match is an invitation -
        pick a game, invite an account that is on, and the board opens on both screens when they
        answer. The bell carries the invitation the moment it lands.
      </p>

      <GamesHub />
    </SiteWindow>
  );
}
