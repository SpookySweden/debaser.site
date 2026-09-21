import Image from 'next/image';

export default function ConceptArtWindow() {
  return (
    <div className="border-t-white border-l-white border-r-gray-800 border-b-gray-800 bg-[#c0c0c0] p-4">
      <div className="bg-[#000080] text-white font-bold px-2 py-1 flex justify-between items-center mb-2">
        <span>Concept Art Viewer</span>
        <span>F1</span>
      </div>
      <div className="bg-white p-2">
        <Image
          src="/assets/placeholders/concept-art.png"
          alt="Concept Art Placeholder"
          width={400}
          height={300}
          className="w-full h-auto"
        />
      </div>
      <div className="mt-2 text-sm font-mono">
        <div className="bg-gray-200 p-2">Caption: [Concept Art Placeholder]</div>
      </div>
      <div className="mt-2 flex justify-between">
        <button className="bg-gray-300 border-t-white border-l-white border-r-gray-800 border-b-gray-800 px-3 py-1 font-mono">
          [&lt; PREV]
        </button>
        <button className="bg-gray-300 border-t-white border-l-white border-r-gray-800 border-b-gray-800 px-3 py-1 font-mono">
          [NEXT &gt;]
        </button>
      </div>
    </div>
  );
}
