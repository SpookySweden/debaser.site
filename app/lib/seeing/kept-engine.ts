import type { SeeAnswer, SeeingEngine } from './engine';
import { keptId } from './pages';
import { copyOfPage } from './pages-store';

/** A kept copy, drawn as any page is: in the sandboxed frame, with no scripts and nowhere to load from. */
export const keptEngine: SeeingEngine = {
  name: 'KEPT COPY',
  takes: (address) => keptId(address) !== null,
  async open(address, onStep): Promise<SeeAnswer> {
    onStep('ACQUIRING SOURCE');
    const id = keptId(address);
    const copy = id === null ? null : await copyOfPage(id);
    if (copy === null) return { ok: false, reason: 'NO COPY IS KEPT THERE' };
    return {
      ok: true,
      document: { address, title: copy.title, eye: 'KEPT COPY', html: copy.html, reading: copy.reading, watchers: [], media: [], files: 0, refused: 0, status: null, signIn: false, refresh: null, assets: null, scripts: false },
    };
  },
};
