import type { Metadata } from 'next';
import Link from 'next/link';
import CommentPopout from './components/CommentPopout';
import SiteWindow from './components/SiteWindow';
import { FORUM_ANCHORS } from './lib/forum/anchors';
import { ARCHIVE_PROJECTS, PROJECT_SECTIONS } from './lib/projects/debaser';
import { SHELF_CHIP } from './lib/ui/controls';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Portal Archive',
  description:
    'The central hub for Debaser comic book lore, concept art and the debaser project shelves: a board, an account directory, comms and the archive.',
};

export default function Home() {
  return (
    <SiteWindow title="DEBASER_OS - v1.0 [HOME LANDING]" active="home" status="Landing Page Active">
    <h1 className="text-xl font-bold mb-4">DEBASER.SITE // PORTAL ARCHIVE</h1>
    <p className="text-sm mb-4 leading-relaxed">
      Welcome to the central digital hub for comic book lore, design concepts, and interactive community message boards. 
      This platform serves as a retro-styled operating environment dedicated to organizing and showcasing serialized world-building assets, artwork, and collaborative discussions.
    </p>
    <div className="border border-black p-4 bg-ice-pale mt-6">
      <p className="text-xs font-bold mb-2">PROJECTS:</p>
      <ul className="space-y-2">
        {/* A project is a map entry: it opens its own landing page, and the
            shelves of that project live under there rather than on the taskbar. */}
        {ARCHIVE_PROJECTS.map((project) => (
          <li key={project.id}>
            <Link
              href={project.href}
              className="block border border-gray-500 bg-white p-2 hover:bg-yellow-100"
            >
              <span className="block text-xs font-bold">{project.title}</span>
              <span className="block text-[10px] font-bold">{project.subtitle}</span>
              <span className="block text-[10px] text-black">{project.summary}</span>
              <span className="block pt-1 text-[10px] font-bold">[ OPEN {project.href} ]</span>
            </Link>
          </li>
        ))}
      </ul>
    </div>

    <div className="border border-black p-4 bg-ice-pale mt-4">
      <p className="text-xs font-bold mb-2">QUICK NAVIGATION:</p>
      <ul className="text-xs space-y-1 list-disc list-inside">
        <li><strong>FORUM:</strong> Join live community discussions and real-time boards.</li>
        <li><strong>USERS:</strong> Every account on the site, with its online lamp.</li>
        <li><strong>COMMS:</strong> Direct messages between accounts.</li>
      </ul>

      {/* The project's shelves, one click from the map: on a phone the Start menu carries them, and
          a map that only names the project would make a reader open it to find out what is inside. */}
      <p className="mt-3 text-xs font-bold mb-1">SHELVES:</p>
      <ul className="flex flex-wrap gap-1 text-[10px] font-bold">
        {PROJECT_SECTIONS.map((section) => (
          <li key={section.id}>
            <Link
              href={section.href}
              title={section.summary}
              className={SHELF_CHIP}
            >
              [ {section.label} ]
            </Link>
          </li>
        ))}
      </ul>
    </div>

    {/* Comment control: pops an encased window holding this box's forum thread */}
    <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border border-black bg-ice-pale p-3">
      <span className="text-[10px] font-bold">
        COMMENTS ON THIS SUMMARY OPEN IN A POP-UP WINDOW. AUTHORS POST AS ANONYMOUS UNTIL AUTH IS LIVE.
      </span>
      <CommentPopout anchor={FORUM_ANCHORS.homeSummary} />
    </div>
    </SiteWindow>
  );
}