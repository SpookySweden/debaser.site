import Link from 'next/link';
import CommentPopout from './components/CommentPopout';
import SiteNav from './components/SiteNav';
import { FORUM_ANCHORS } from './lib/forum/anchors';
import { ARCHIVE_PROJECTS } from './lib/projects/debaser';

export default function Home() {
  return (
    <main className="min-h-screen bg-[#008080] p-4 font-mono select-none flex items-center justify-center">
      <div className="w-[95vw] h-[92vh] bg-[#c0c0c0] border-t-2 border-l-2 border-white border-r-2 border-b-2 border-black flex flex-col shadow-2xl rounded-none">
        
        {/* Title Bar */}
        <div className="bg-[#000080] text-white px-3 py-1 flex justify-between items-center font-bold text-sm">
          <span>DEBASER_OS - v1.0 [HOME LANDING]</span>
          <div className="flex gap-1">
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">_</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">□</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">×</button>
          </div>
        </div>

        {/* Taskbar Navigation */}
        <SiteNav active="home" />

        {/* Content Body - Website Purpose Summary */}
        <div className="flex-1 bg-white border-inset border-2 border-gray-600 m-2 p-6 overflow-y-auto text-black">
          <h1 className="text-3xl font-bold mb-4">DEBASER.SITE // PORTAL ARCHIVE</h1>
          <p className="text-sm mb-4 leading-relaxed">
            Welcome to the central digital hub for comic book lore, design concepts, and interactive community message boards. 
            This platform serves as a retro-styled operating environment dedicated to organizing and showcasing serialized world-building assets, artwork, and collaborative discussions.
          </p>
          <div className="border border-black p-4 bg-[#f0f0f0] mt-6">
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

          <div className="border border-black p-4 bg-[#f0f0f0] mt-4">
            <p className="text-xs font-bold mb-2">QUICK NAVIGATION:</p>
            <ul className="text-xs space-y-1 list-disc list-inside">
              <li><strong>FORUM:</strong> Join live community discussions and real-time boards.</li>
              <li><strong>USERS:</strong> Every account on the site, with its online lamp.</li>
              <li><strong>COMMS:</strong> Direct messages between accounts.</li>
            </ul>
          </div>

          {/* Comment control: pops an encased window holding this box's forum thread */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-2 border border-black bg-[#f0f0f0] p-3">
            <span className="text-[10px] font-bold">
              COMMENTS ON THIS SUMMARY OPEN IN A POP-UP WINDOW. AUTHORS POST AS ANONYMOUS UNTIL AUTH IS LIVE.
            </span>
            <CommentPopout anchor={FORUM_ANCHORS.homeSummary} />
          </div>
        </div>

        {/* Status Bar */}
        <div className="px-3 py-1 text-xs bg-[#c0c0c0] border-t border-white flex justify-between text-black">
          <span>Status: Landing Page Active</span>
          <span>UTF-8</span>
        </div>

      </div>
    </main>
  );
}