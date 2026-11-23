import type { SeeingEngine } from './engine';
import { keptEngine } from './kept-engine';
import { serverEngine } from './server-engine';
import { testEngine } from './test-engine';

/** Which eye an address is for: a kept copy's, the built-in pages' own, or the server's. */
export function engineFor(address: string): SeeingEngine {
  if (keptEngine.takes(address)) return keptEngine;
  return testEngine.takes(address) ? testEngine : serverEngine;
}
