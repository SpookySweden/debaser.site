'use client';

import { profileNameColour } from '../profile/name-colours';
import { usePublicProfile } from '../profile/use-public-profile';
import { canvasDraggable, useCanvasOpen, type CanvasDraggable } from './canvas-drag';
import { chatImageUrl } from './chat-images';
import type { WatchMessage } from './types';

/**
 * A room chat line, draggable onto the canvas while it is on screen (SPEC-stream-art.md): it lands as a line of
 * text in the site's font and the writer's name colour, credited to the writer; a line that is one GIPHY / Commons
 * picture lands as that picture. Null while no canvas is open, so the line is just a line.
 */
export function useChatLineDrag(message: WatchMessage): CanvasDraggable | null {
  const open = useCanvasOpen();
  const { profile } = usePublicProfile(message.authorId);
  if (!open) return null;
  return canvasDraggable(() => {
    const picture = chatImageUrl(message.body);
    if (picture !== null) return { type: 'picture', url: picture, title: message.authorLabel };
    return { type: 'text', text: message.body, writerId: message.authorId, writerLabel: message.authorLabel, colour: profileNameColour(profile) ?? '' };
  });
}
