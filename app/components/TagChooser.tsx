'use client';

import { useMemo, useState } from 'react';
import { canonicalTagLabel, makeUserTag, tagKey, type TagOption } from '../lib/forum/tag-vocabulary';
import { useForum } from './ForumProvider';
import { TagMark, tagChipClasses, tagMarkColour } from './TagBadge';
import TagCreatorWindow from './TagCreatorWindow';

type TagChooserProps = {
  id: string;
  /** Selected labels, in display order. */
  value: string[];
  onChange: (labels: string[]) => void;
  /** Ranked vocabulary: most used tags first, starter tags always present. */
  options: TagOption[];
  max?: number;
  /** How many suggestions to show. */
  suggestionLimit?: number;
};

/**
 * Colour coded tag chooser.
 *
 * Pick from the suggestions (starter tags plus whatever the board uses most),
 * click a selected chip to drop it, or type a brand new tag. New tags are
 * folded onto an existing one when the spelling is decidedly similar, and every
 * tag takes its colour from its canonical key, so the same tag is always the
 * same colour everywhere it appears.
 */
export default function TagChooser({
  id,
  value,
  onChange,
  options,
  max = 4,
  suggestionLimit = 16,
}: TagChooserProps) {
  const { tagColours, rememberTagColour } = useForum();
  const [creatorOpen, setCreatorOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const known = useMemo(() => options.map((option) => option.label), [options]);
  const selectedKeys = useMemo(() => value.map((label) => tagKey(label)), [value]);
  const suggestions = useMemo(() => options.slice(0, suggestionLimit), [options, suggestionLimit]);

  function toggle(label: string) {
    const key = tagKey(label);

    if (selectedKeys.includes(key)) {
      onChange(value.filter((item) => tagKey(item) !== key));
      setError(null);
      return;
    }

    if (value.length >= max) {
      setError(`MAX ${max} TAGS PER POST.`);
      return;
    }

    onChange([...value, canonicalTagLabel(label, known)]);
    setError(null);
  }

  /** A tag built in the editor pop-up: remember its colour, then select it. */
  function handleCreateTag(label: string, colour: string) {
    rememberTagColour(label, colour);
    setCreatorOpen(false);

    if (selectedKeys.includes(tagKey(label))) {
      setError(`"${label}" IS ALREADY SELECTED.`);
      return;
    }

    if (value.length >= max) {
      setError(`MAX ${max} TAGS PER POST.`);
      return;
    }

    onChange([...value, label]);
    setError(null);
  }

  return (
    <fieldset id={id} className="mt-2 rounded-none border border-gray-600 p-2">
      <legend className="px-1 text-[10px] font-bold text-black">
        TAGS ({value.length}/{max})
      </legend>

      <div className="flex flex-wrap items-center gap-1 text-[10px] font-bold text-black">
        <span>SELECTED:</span>
        {value.length === 0 ? (
          <span className="text-gray-700">NONE - PICK OR TYPE BELOW</span>
        ) : (
          value.map((label) => {
            const tag = makeUserTag(label, tagColours[tagKey(label)]);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggle(label)}
                title={`Remove tag ${tag.label}`}
                className={`${tagChipClasses(tag)} cursor-pointer hover:bg-gray-200`}
              >
                <TagMark colour={tagMarkColour(tag)} />
                {tag.label} ×
              </button>
            );
          })
        )}
      </div>

      <div className="mt-2 flex flex-wrap items-center gap-1 text-[10px] font-bold text-black">
        <span>SUGGESTED:</span>
        {suggestions.map((option) => {
          const tag = makeUserTag(option.label, option.colour);
          const isSelected = selectedKeys.includes(option.key);

          return (
            <button
              key={option.key}
              type="button"
              onClick={() => toggle(option.label)}
              title={option.starter ? 'Pre-made tag' : `Used on ${option.count} post(s)`}
              className={`${tagChipClasses(tag)} cursor-pointer ${
                isSelected ? 'outline-2 outline-black' : 'hover:bg-gray-200'
              }`}
            >
              <TagMark colour={tagMarkColour(tag)} />
              {option.label}
              {option.count > 0 ? ` (${option.count})` : ''}
            </button>
          );
        })}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCreatorOpen(true)}
          title="Open the tag editor to create and colour a new tag"
          className="cursor-pointer rounded-none border-t border-l border-white border-r border-b border-black bg-[#c0c0c0] px-2 py-[3px] text-[10px] font-bold text-black underline hover:bg-gray-300"
        >
          + NEW TAG...
        </button>

        <p className={`text-[10px] font-bold ${error === null ? 'text-black' : 'text-[#800000]'}`}>
          {error ?? 'TAGS ARE COLOUR CODED AND LINK EVERY POST THAT USES THEM.'}
        </p>
      </div>

      {creatorOpen ? (
        <TagCreatorWindow
          knownLabels={known}
          onCancel={() => setCreatorOpen(false)}
          onCreate={handleCreateTag}
        />
      ) : null}
    </fieldset>
  );
}
