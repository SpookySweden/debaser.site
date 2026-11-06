'use client';

import AnimateLoader from '../components/animate/AnimateLoader';
import { registerWorkers } from '../lib/animate/workers';

registerWorkers({
  save: () => new Worker(new URL('../lib/animate/save.worker.ts', import.meta.url)),
});

/** The studio, with its background workers told where they live. */
export default function AnimateBoot() {
  return <AnimateLoader />;
}
