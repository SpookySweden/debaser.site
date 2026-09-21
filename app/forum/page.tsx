import type { Metadata } from 'next';
import ForumBoard from '../components/ForumBoard';
import SiteNav from '../components/SiteNav';

export const metadata: Metadata = {
  title: 'DEBASER.SITE - Forum Board',
  description: 'Anonymous message board for Debaser lore, concept art and continuity threads.',
};

export default function Forum() {
  return (
    <main className="min-h-screen bg-[#008080] p-4 font-mono select-none flex items-center justify-center">
      <div className="w-[95vw] h-[92vh] bg-[#c0c0c0] border-t-2 border-l-2 border-white border-r-2 border-b-2 border-black flex flex-col shadow-2xl rounded-none">

        {/* Title Bar */}
        <div className="bg-[#000080] text-white px-3 py-1 flex justify-between items-center font-bold text-sm">
          <span>DEBASER_OS - v1.0 [FORUM BOARD]</span>
          <div className="flex gap-1">
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">_</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">□</button>
            <button className="bg-[#c0c0c0] text-black px-2 border-t border-l border-white border-r border-b border-black text-xs font-bold">×</button>
          </div>
        </div>

        {/* Taskbar Navigation */}
        <SiteNav active="forum" />

        {/* Content Body - Board */}
        <div className="flex-1 bg-white border-inset border-2 border-gray-600 m-2 p-4 overflow-y-auto text-black">
          <h1 className="text-3xl font-bold mb-2">DEBASER.SITE // MESSAGE BOARD</h1>
          <p className="text-xs mb-4 leading-relaxed">
            Threads arrive from two places: the New Post form below, and the comment boxes attached to any asset or
            text box on the site. A comment left under an asset opens its thread automatically, and every post gets its
            badges generated from the copy. Authors post as Anonymous until Supabase Auth is switched on.
          </p>

          <ForumBoard />
        </div>

        {/* Status Bar */}
        <div className="px-3 py-1 text-xs bg-[#c0c0c0] border-t border-white flex justify-between text-black">
          <span>Status: Message Board Active</span>
          <span>UTF-8</span>
        </div>

      </div>
    </main>
  );
}
