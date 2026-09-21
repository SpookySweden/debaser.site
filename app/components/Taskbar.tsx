import Image from 'next/image';

export default function Taskbar() {
  return (
    <div className="fixed bottom-0 left-0 right-0 bg-[#008000] p-1">
      <div className="flex items-center justify-between h-12">
        <div className="flex items-center">
          <div className="bg-gray-200 border-t-white border-l-white border-r-gray-800 border-b-gray-800 px-3 py-1 font-mono">
            Start
          </div>
        </div>
        <div className="bg-white border-t-white border-l-white border-r-gray-800 border-b-gray-800 p-2 font-mono">
          [Avatar Sprite Placeholder]
        <div className="mt-1 text-xs"><Image
            src="/assets/placeholders/avatar-sprite.png"
            alt="Avatar Sprite"
            width={64}
            height={64}
            className="w-16 h-16"
          /></div>
        </div>
        <div className="font-mono">
          [TIME]
        </div>
      </div>
    </div>
  );
}
