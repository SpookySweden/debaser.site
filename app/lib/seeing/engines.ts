import type { SeeingEngine } from './engine';
import { serverEngine } from './server-engine';
import { testEngine } from './test-engine';

/** Which eye an address is for: the built-in pages' own, or the server's. */
export function engineFor(address: string): SeeingEngine {
  return testEngine.takes(address) ? testEngine : serverEngine;
}
