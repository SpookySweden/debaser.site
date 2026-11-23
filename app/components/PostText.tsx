import Link from 'next/link';
import { Fragment, type ReactNode } from 'react';
import { parsePost, type PostPiece } from '../lib/forum/post-format';
import SeeKey from './SeeKey';

/**
 * A post's words with their small formatting (Luke, 2026-11-16, "3A"): **bold**, *italic*, links
 * and `#tag` words, read by `parsePost` and drawn here as React elements, never as HTML. A link opens
 * in a new tab with no way back to this page (`noopener noreferrer`); a `#tag` filters the board to
 * that tag, the same address a tag badge goes to.
 */
function draw(pieces: PostPiece[], keyPrefix: string): ReactNode[] {
  return pieces.map((piece, index) => {
    const key = `${keyPrefix}${index}`;
    switch (piece.kind) {
      case 'text':
        return piece.text;
      case 'bold':
        return (
          <strong key={key} className="font-bold">
            {draw(piece.pieces, `${key}.`)}
          </strong>
        );
      case 'italic':
        return (
          <em key={key} className="italic">
            {draw(piece.pieces, `${key}.`)}
          </em>
        );
      case 'link':
        return (
          <Fragment key={key}>
            <a href={piece.href} target="_blank" rel="noopener noreferrer nofollow" className="text-accent-ink underline wrap-anywhere">
              {piece.text}
            </a>
            <SeeKey href={piece.href} small />
          </Fragment>
        );
      case 'tag':
        return (
          <Link
            key={key}
            href={`/forum#tag-${piece.key}`}
            title={`Show every post tagged ${piece.label}`}
            className="font-bold text-accent-ink hover:underline"
          >
            {piece.text}
          </Link>
        );
    }
  });
}

export default function PostText({ body, className }: { body: string; className?: string }) {
  return <p className={className}>{draw(parsePost(body), 'p')}</p>;
}
