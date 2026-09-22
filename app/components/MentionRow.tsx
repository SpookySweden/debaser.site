'use client';

import { mentionsIn, type Mentionable } from '../lib/forum/mentions';
import ProfileLink from './ProfileLink';

type MentionRowProps = {
  /** The post or reply the tags are read out of. */
  body: string;
  /** The accounts that can be tagged; a post by a guest tags nobody. */
  accounts: Mentionable[];
  className?: string;
};

/**
 * The accounts a post names, drawn as the tags they are.
 *
 * The tag is already in the words - that is what makes it survivable and readable - but a reader
 * scrolling past cannot tell a name from a tag, so this says it plainly and makes each one a link
 * to that account. It is read out of the body every time rather than stored beside it, so the
 * tags on screen are exactly the tags the post actually carries: edit the `@name` away and the
 * row changes with it.
 */
export default function MentionRow({ body, accounts, className }: MentionRowProps) {
  const mentioned = mentionsIn(body, accounts);
  if (mentioned.length === 0) return null;

  return (
    <p className={`flex flex-wrap items-center gap-1 text-[10px] font-bold text-black ${className ?? 'mt-1'}`}>
      <span>TAGGED:</span>
      {mentioned.map((account) => {
        const label = `@${account.displayName.trim().replace(/\s+/g, '_')}`;

        return account.id === null ? (
          <span key={account.displayName} className="font-normal text-gray-700" title="No account to tell">
            {label}
          </span>
        ) : (
          <ProfileLink
            key={account.id}
            author={{ id: account.id, displayName: account.displayName }}
            className="border border-gray-500 bg-white px-1 hover:bg-yellow-100"
          >
            {label}
          </ProfileLink>
        );
      })}
    </p>
  );
}
