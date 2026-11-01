import type { Metadata } from 'next';
import { redirect } from 'next/navigation';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Message Board',
  description: 'The anonymous Debaser message board for comic book lore, concept art and community threads.',
};

export default function Home() {
  redirect('/forum');
}