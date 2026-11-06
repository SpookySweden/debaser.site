import type { Metadata } from 'next';
import AnimateBoot from './AnimateBoot';
import SiteWindow from '../components/SiteWindow';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Animate',
  description: 'A frame-by-frame animator for hand-drawn work. Everything stays in your browser and in files you save.',
};

/**
 * ANIMATE (SPEC-animator.md): Luke's frame-by-frame animator. The studio runs entirely in the browser, so the page server-renders only its
 * frame; nothing is sent to the site, and it needs no account.
 */
export default function AnimatePage() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [ANIMATE]" active="animate" tip="Draw frame by frame. Your work stays in this browser." fill>
      <h1 className="sr-only">DEBASER.SITE // ANIMATE</h1>
      <AnimateBoot />
    </SiteWindow>
  );
}
