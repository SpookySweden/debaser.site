'use client';

import { useMemo, useState } from 'react';
import { canonicalTagLabel, groupByNamespace, makeUserTag, tagKey, tagNamespace, type TagOption } from '../lib/forum/tag-vocabulary';
import { useForum } from './ForumProvider';
import { TagMark, tagMarkColour } from './TagBadge';
import TagCreatorWindow from './TagCreatorWindow';
import { PLATE } from '../lib/ui/controls';

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
    <fieldset id={id} className="mt-2">
      <legend className="px-1 text-label font-bold text-ink">
        TAGS ({value.length}/{max})
      </legend>

      <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-0.75 text-label font-bold text-ink">
        <span className="text-ink">SELECTED:</span>
        {value.length === 0 ? (
          <span className="text-ink">NONE</span>
        ) : (
          value.map((label) => {
            const tag = makeUserTag(label, tagColours[tagKey(label)]);
            return (
              <button
                key={tag.id}
                type="button"
                onClick={() => toggle(label)}
                title={`Remove tag ${tag.label}`}
                className="inline-flex cursor-pointer items-center gap-0.75 font-bold hover:underline"
              >
                <TagMark colour={tagMarkColour(tag)} compact />
                <span className="text-ink">{tagNamespace(tag)}:</span>
                <span>{tagKey(tag.label)}</span>
                <span className="text-ink">×</span>
              </button>
            );
          })
        )}
      </div>

      {/* Filed by namespace, the way the tags are written on a post: a chooser that lists forty tags
          is a wall, and one that says `theme:` and `user:` is a list you can read down. */}
      <div className="mt-2 space-y-0.5 text-label text-ink">
        {groupByNamespace(suggestions).map((group) => (
          <div key={group.namespace} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.75">
            <span className="w-12 shrink-0 font-bold text-ink">{group.namespace}:</span>

            {group.items.map((option) => {
              const tag = makeUserTag(option.label, option.colour);
              const isSelected = selectedKeys.includes(option.key);

              return (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => toggle(option.label)}
                  className={`inline-flex cursor-pointer items-center gap-0.75 px-1 font-bold max-sm:min-h-tap max-sm:px-2 max-sm:text-sm ${
                    isSelected ? 'bg-ena text-ink-bar' : 'text-ink hover:underline'
                  }`}
                >
                  <TagMark colour={tagMarkColour(tag)} compact />
                  {option.key}
                  {option.count > 0 ? (
                    <span className={isSelected ? 'text-ink' : 'text-ink'}>({option.count})</span>
                  ) : null}
                </button>
              );
            })}
          </div>
        ))}
      </div>

      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => setCreatorOpen(true)}
          className={PLATE}
        >
          [ + NEW TAG ]
        </button>

        {error === null ? null : (
          <p className="w-fit bg-bubble-pale px-1 text-label font-bold text-ink-bar">{error}</p>
        )}
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
