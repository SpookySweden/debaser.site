'use client';

import { useSyncExternalStore } from 'react';
import { ledgeHeadroomState, serverLedgeHeadroom, subscribeToLedgeHeadroom } from './ledge';

/**
 * The room a stream room's window leaves above itself for companions to stand on its top edge (`ledge.ts`): one line in
 * the window, handed to `DockWindow`'s `headroom`. 0 while no companion is being drawn.
 */
export function useLedgeHeadroom(): number {
  return useSyncExternalStore(subscribeToLedgeHeadroom, ledgeHeadroomState, serverLedgeHeadroom);
}
